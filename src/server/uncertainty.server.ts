// Ensemble-Spread / Unsicherheits-Quantifizierung für Trend Tag 4-10.
//
// Wir holen Open-Meteo-Ensembles (icon_eps, ecmwf_ifs025_ensemble) und
// berechnen pro Tag die Streuung (Median, P10, P90, sigma) für Tmax und
// Niederschlag. Daraus wird eine qualitative Unsicherheits-Stufe abgeleitet,
// die in den Trend-Prompt einfliesst.
//
// Fail-soft: Wenn der Endpoint nicht antwortet, wird der gesamte Layer
// stillschweigend übersprungen.

import { getOrSetCache } from "./weather-cache.server";

export type EnsembleDay = {
  date: string;                       // YYYY-MM-DD
  tmax: { p10: number; median: number; p90: number; sigma: number } | null;
  precip_prob_ensemble: number | null;  // % Member mit > 1 mm
  precip_bimodal: boolean;              // dry/wet split deutlich (>30% in beide Lager)
};

export type EnsembleData = {
  fetched_at: string;
  byDate: Record<string, EnsembleDay>;
  source: string;
};

const ENSEMBLE_MODELS = "icon_seamless,ecmwf_ifs025";
// Hinweis: Open-Meteo bietet ein dediziertes ensemble-Endpunkt. Wir nutzen den
// Forecast-Endpoint mit `ensemble=true`-Variante.

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

// Open-Meteo Ensemble-API. Liefert pro Variable mehrere Member-Spalten als
// `temperature_2m_max_member01`, `_member02`, ...
async function fetchOpenMeteoEnsemble(lat: number, lon: number) {
  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("forecast_days", "10");
  url.searchParams.set("daily", "temperature_2m_max,precipitation_sum");
  url.searchParams.set("models", ENSEMBLE_MODELS);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ensemble HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  return res.json();
}

// Open-Meteo gibt Ensembles als Array von { ...daily }-Objekten zurück
// (eines pro Modell), oder ein einzelnes Objekt bei nur einem Modell.
// Wir aggregieren über alle Modelle UND alle Member.
function extractMemberValues(daily: any, varName: string, dayIdx: number): number[] {
  const values: number[] = [];
  for (const key of Object.keys(daily)) {
    if (key === varName || key.startsWith(varName + "_member")) {
      const arr = daily[key];
      if (Array.isArray(arr) && Number.isFinite(arr[dayIdx])) {
        values.push(arr[dayIdx]);
      }
    }
  }
  return values;
}

export async function fetchEnsembleData(lat: number, lon: number): Promise<EnsembleData | null> {
  const cacheKey = `ens:v1:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return getOrSetCache(
    cacheKey,
    async () => {
      try {
        const raw = await fetchOpenMeteoEnsemble(lat, lon);
        // Bei mehreren Modellen liefert die API ein Array; sonst ein Objekt.
        const blocks: any[] = Array.isArray(raw) ? raw : [raw];
        const byDate = new Map<string, EnsembleDay>();
        for (const block of blocks) {
          const daily = block?.daily;
          const times: string[] = daily?.time ?? [];
          for (let i = 0; i < times.length; i++) {
            const date = times[i];
            const tmaxValues = extractMemberValues(daily, "temperature_2m_max", i);
            const pcpValues = extractMemberValues(daily, "precipitation_sum", i);

            // Wenn schon Eintrag existiert, Member zusammenführen
            const prev = byDate.get(date);
            const allTmax = prev?.tmax ? null : tmaxValues; // wir aggregieren neu mit allen Werten
            // Einfacher: per-date alle Member sammeln, am Ende quantile bilden
            byDate.set(date, {
              date,
              tmax: null,
              precip_prob_ensemble: null,
              precip_bimodal: false,
              // temporäre Felder
              ...(prev ?? {}),
              _tmax: [...((prev as any)?._tmax ?? []), ...tmaxValues],
              _pcp: [...((prev as any)?._pcp ?? []), ...pcpValues],
            } as any);
          }
        }
        // Quantile berechnen
        for (const [date, entry] of byDate.entries()) {
          const tmaxAll: number[] = (entry as any)._tmax ?? [];
          const pcpAll: number[] = (entry as any)._pcp ?? [];
          if (tmaxAll.length >= 5) {
            const sorted = [...tmaxAll].sort((a, b) => a - b);
            entry.tmax = {
              p10: Math.round(quantile(sorted, 0.1) * 10) / 10,
              median: Math.round(quantile(sorted, 0.5) * 10) / 10,
              p90: Math.round(quantile(sorted, 0.9) * 10) / 10,
              sigma: Math.round(stddev(tmaxAll) * 10) / 10,
            };
          }
          if (pcpAll.length >= 5) {
            const wet = pcpAll.filter((v) => v > 1).length;
            const dry = pcpAll.filter((v) => v < 0.2).length;
            entry.precip_prob_ensemble = Math.round((wet / pcpAll.length) * 100);
            // bimodal: sowohl deutliche Dry- als auch Wet-Anteile (≥ 30%)
            const dryFrac = dry / pcpAll.length;
            const wetFrac = wet / pcpAll.length;
            entry.precip_bimodal = dryFrac >= 0.3 && wetFrac >= 0.3;
          }
          // temporäre Felder entfernen
          delete (entry as any)._tmax;
          delete (entry as any)._pcp;
        }
        return {
          fetched_at: new Date().toISOString(),
          byDate,
          source: `open-meteo:ensemble (${ENSEMBLE_MODELS})`,
        };
      } catch (e) {
        console.warn("[ensemble] fetch failed", e);
        return null;
      }
    },
    60 * 60 * 1000, // 1 h TTL — Ensembles laufen 4× täglich
  );
}

// Liefert einen kompakten Hinweis-Text für den Trend-Prompt (Tage 4-10).
export function formatUncertaintyHint(ensemble: EnsembleData | null, trendDays: any[]): string | null {
  if (!ensemble || !trendDays?.length) return null;
  const sigmas: number[] = [];
  const bimodalDates: string[] = [];
  const spreads: { date: string; p10: number; p90: number; sigma: number; precipProb: number | null }[] = [];

  for (const d of trendDays) {
    const e = ensemble.byDate.get(d.date);
    if (!e?.tmax) continue;
    sigmas.push(e.tmax.sigma);
    if (e.precip_bimodal) bimodalDates.push(d.date);
    spreads.push({
      date: d.date,
      p10: e.tmax.p10,
      p90: e.tmax.p90,
      sigma: e.tmax.sigma,
      precipProb: e.precip_prob_ensemble,
    });
  }
  if (sigmas.length === 0) return null;

  const avgSigma = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
  const maxSigma = Math.max(...sigmas);
  const maxSpread = Math.max(...spreads.map((s) => s.p90 - s.p10));

  let level: string;
  if (avgSigma < 1.5 && maxSigma < 2.5) {
    level = "verlässlicher Trend";
  } else if (avgSigma < 3 && maxSigma < 4) {
    level = "moderate Unsicherheit";
  } else {
    level = "hohe Unsicherheit, mehrere Wetterszenarien möglich";
  }

  const parts = [`Unsicherheits-Stufe: ${level}`];
  parts.push(`Tmax-Spannweite (P10–P90) bis zu ${maxSpread.toFixed(1)} °C, mittlere Streuung σ=${avgSigma.toFixed(1)} °C`);
  if (bimodalDates.length > 0) {
    parts.push(`an ${bimodalDates.length} Tag(en) bimodale Niederschlagsverteilung — Member spalten sich in trockenes und nasses Szenario`);
  }
  return parts.join("; ") + ".";
}
