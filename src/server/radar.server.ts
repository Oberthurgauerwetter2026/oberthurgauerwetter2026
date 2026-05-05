// Radar / Niederschlags-Nowcast.
//
// Wir nutzen Open-Meteo als Proxy für die MeteoSchweiz-Radar-Composite:
// - `past_hours` liefert für vergangene Stunden bereits an Beobachtungen
//   (inkl. Radar) angepasste Werte.
// - `forecast_hours=2` liefert die Kürzestfrist (Nowcast).
// Damit vermeiden wir das eigene Parsen von GeoTIFF-Radarframes im Worker.
//
// Bevorzugt wird das hochaufgelöste MeteoSchweiz-ICON-CH1 (Open-Meteo „meteoswiss_icon_ch1"),
// das die Radar-Assimilation der MeteoSchweiz nutzt.

import { getOrSetCache } from "./weather-cache.server";

export type RadarSnapshot = {
  fetched_at: string;
  observed: {
    hours: { time: string; mm: number }[];
    last_1h_mm: number;
    last_3h_mm: number;
  };
  forecast_next_2h: {
    hours: { time: string; mm: number }[];
    next_2h_mm: number;
  };
  forecast_hours: { time: string; mm: number }[]; // bis zu 6h
  model_expected_past_3h_mm: number | null;
  source: string;
};

async function fetchOMPrecip(lat: number, lon: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("hourly", "precipitation");
  url.searchParams.set("past_hours", "3");
  url.searchParams.set("forecast_hours", "6");
  url.searchParams.set("models", "meteoswiss_icon_ch1");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo radar proxy ${res.status}`);
  return res.json();
}

async function fetchOMModelExpectedPast(lat: number, lon: number) {
  // Gleiche Stunden, aber Best-Match-Modell (ohne Radar-Assimilation) als Vergleich.
  // Open-Meteo gibt keinen klaren Schalter für „nur Vorhersage", liefert aber für
  // ICON-EU/D2 typischerweise reine Modellwerte zurück.
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("hourly", "precipitation");
  url.searchParams.set("past_hours", "3");
  url.searchParams.set("forecast_hours", "1");
  url.searchParams.set("models", "icon_d2");
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  return res.json();
}

export async function fetchRadarSnapshot(lat: number, lon: number): Promise<RadarSnapshot | null> {
  const cacheKey = `radar:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return getOrSetCache(
    cacheKey,
    async () => {
      try {
        const [obs, modelOnly] = await Promise.all([
          fetchOMPrecip(lat, lon),
          fetchOMModelExpectedPast(lat, lon).catch(() => null),
        ]);
        const times: string[] = obs?.hourly?.time ?? [];
        const precs: number[] = obs?.hourly?.precipitation ?? [];
        const now = Date.now();

        const past: { time: string; mm: number }[] = [];
        const future: { time: string; mm: number }[] = [];
        for (let i = 0; i < times.length; i++) {
          const t = Date.parse(times[i]);
          const mm = Number.isFinite(precs[i]) ? Number(precs[i]) : 0;
          if (t <= now) past.push({ time: times[i], mm });
          else future.push({ time: times[i], mm });
        }
        // Letzte 3 / 1 Stunden
        const last3 = past.slice(-3);
        const last1 = past.slice(-1);
        const sum = (xs: { mm: number }[]) => xs.reduce((a, b) => a + b.mm, 0);

        // Modell-Erwartung für die gleichen vergangenen 3h (zum Vergleich)
        let modelExpectedPast: number | null = null;
        const mTimes: string[] = modelOnly?.hourly?.time ?? [];
        const mPrecs: number[] = modelOnly?.hourly?.precipitation ?? [];
        if (mTimes.length) {
          const targetTimes = new Set(last3.map((h) => h.time));
          let s = 0;
          let found = 0;
          for (let i = 0; i < mTimes.length; i++) {
            if (targetTimes.has(mTimes[i])) {
              s += Number.isFinite(mPrecs[i]) ? Number(mPrecs[i]) : 0;
              found++;
            }
          }
          if (found > 0) modelExpectedPast = Math.round(s * 10) / 10;
        }

        return {
          fetched_at: new Date().toISOString(),
          observed: {
            hours: last3,
            last_1h_mm: Math.round(sum(last1) * 10) / 10,
            last_3h_mm: Math.round(sum(last3) * 10) / 10,
          },
          forecast_next_2h: {
            hours: future.slice(0, 2),
            next_2h_mm: Math.round(sum(future.slice(0, 2)) * 10) / 10,
          },
          model_expected_past_3h_mm: modelExpectedPast,
          source: "open-meteo:meteoswiss_icon_ch1 (radar-assimiliert) + icon_d2 (Vergleich)",
        };
      } catch (e) {
        console.warn("[radar] fetch failed", e);
        return null;
      }
    },
    5 * 60 * 1000, // 5 min TTL
  );
}

// Wendet die Radar-Korrektur auf den Tag-0-Datensatz an. Mutiert nicht direkt,
// gibt einen Korrektur-Block zurück, der angehängt wird.
export function buildRadarCorrection(
  day: { precip?: { avg?: number } | null; precip_prob?: { avg?: number } | null } | null,
  radar: RadarSnapshot | null,
  strengthPct: number,
): {
  applied: boolean;
  reason: string;
  ratio: number;
  before_precip_mm: number | null;
  after_precip_mm: number | null;
  radar_observed_3h_mm: number;
  model_expected_3h_mm: number | null;
  nowcast_next_2h_mm: number;
} | null {
  if (!day || !radar) return null;
  const obs = radar.observed.last_3h_mm;
  const modelExp = radar.model_expected_past_3h_mm;
  const before = day.precip?.avg ?? null;
  const next2 = radar.forecast_next_2h.next_2h_mm;

  // Trigger: signifikante Abweichung Beobachtung vs. Modell-Erwartung
  let ratio = 1;
  let reason = "Beobachtung deckt sich mit Modell, keine Korrektur";
  let applied = false;

  if (modelExp != null && (obs >= 0.3 || modelExp >= 0.3)) {
    const denom = Math.max(modelExp, 0.1);
    const raw = obs / denom;
    // dämpfen mit strength (0..1) und deckeln
    const s = Math.max(0, Math.min(1, strengthPct / 100));
    const damped = 1 + (raw - 1) * s;
    ratio = Math.max(0.3, Math.min(3.0, damped));
    if (Math.abs(raw - 1) >= 0.5 && Math.abs(obs - modelExp) >= 0.3) {
      applied = true;
      reason =
        raw > 1
          ? `Radar zeigt mehr Niederschlag als Modell (${obs} mm vs. ${modelExp} mm in 3h) → Tagessumme erhöht`
          : `Radar zeigt weniger Niederschlag als Modell (${obs} mm vs. ${modelExp} mm in 3h) → Tagessumme reduziert`;
    }
  } else if (obs >= 0.5 && (before == null || before < obs)) {
    // Modell-Vergleich nicht verfügbar, aber Beobachtung > Modell-Tagessumme.
    applied = true;
    ratio = Math.min(2.5, (obs + (before ?? 0)) / Math.max(before ?? 0.1, 0.1));
    reason = `Radar zeigt ${obs} mm in den letzten 3h, Modell sieht für den ganzen Tag nur ${before ?? 0} mm`;
  }

  let after: number | null = before;
  if (applied && before != null) {
    after = Math.max(0, Math.round(before * ratio * 10) / 10);
  } else if (applied && before == null) {
    after = obs;
  }

  return {
    applied,
    reason,
    ratio: Math.round(ratio * 100) / 100,
    before_precip_mm: before,
    after_precip_mm: after,
    radar_observed_3h_mm: obs,
    model_expected_3h_mm: modelExp,
    nowcast_next_2h_mm: next2,
  };
}
