// Nowcast-Layer 0–12 h: blendet Stationen + Radar + Modell.
// MOSMIX und Open-Meteo werden als FEATURES verwendet, nicht als Endwerte.
//
// Aufbau:
//   1. fetchNowcastInputs(): SMN aktuell, Radar, Open-Meteo current (Dewpoint).
//   2. computeHourlyBias(): Modell vs. Beobachtung der letzten Stunden.
//   3. blendDay(): wendet Beobachtungen + Bias auf den Tag-0-Datensatz an.
//   4. computeNightAdjustment(): zusätzliche Nachtauskühlung bei Klarnacht.
//
// Gewichte sind als Konstanten oben dokumentiert.

import { fetchSmnRecent, type SmnHourly } from "./swissmetnet.server";
import { fetchRadarSnapshot, type RadarSnapshot } from "./radar.server";
import { getOrSetCache } from "./weather-cache.server";

// ===== Konfiguration =====
const OBS_FULL_WEIGHT_HOURS = 2;   // 0–2 h: Beobachtung dominiert vollständig
const OBS_FADE_HOURS = 6;          // ab hier nur noch Modell

// Faustregel: zusätzliche Bewölkung tagsüber = leichte Abkühlung
const TEMP_DROP_PER_10PCT_CLOUD = 0.4;   // °C pro +10 % Bewölkung tagsüber

export type NowcastInputs = {
  smn: SmnHourly[];
  radar: RadarSnapshot | null;
  current: { temp_c: number | null; dewpoint_c: number | null; cloud_pct: number | null; wind_kmh: number | null };
};

async function fetchOMCurrent(lat: number, lon: number) {
  const cacheKey = `om:current:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return getOrSetCache(cacheKey, async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,dewpoint_2m,cloudcover,windspeed_10m");
    url.searchParams.set("timezone", "UTC");
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const j = await res.json() as any;
    const c = j?.current;
    if (!c) return null;
    return {
      temp_c: typeof c.temperature_2m === "number" ? c.temperature_2m : null,
      dewpoint_c: typeof c.dewpoint_2m === "number" ? c.dewpoint_2m : null,
      cloud_pct: typeof c.cloudcover === "number" ? c.cloudcover : null,
      wind_kmh: typeof c.windspeed_10m === "number" ? c.windspeed_10m : null,
    };
  }, 10 * 60 * 1000); // 10 min
}

// Mittelt SMN-Stationen über die jüngste verfügbare Stunde (innerhalb der letzten 3h).
function aggregateSmnLatest(smn: SmnHourly[]) {
  const cutoff = Date.now() - 3 * 3600_000;
  const collect: { temp: number[]; precip: number[]; wind: number[]; cloud: number[]; precip24: number } = {
    temp: [], precip: [], wind: [], cloud: [], precip24: 0,
  };
  for (const st of smn) {
    // letzte Stunde
    const recent = st.rows.filter((r) => new Date(r.time).getTime() >= cutoff).slice(-1)[0];
    if (recent) {
      if (recent.temp_c != null) collect.temp.push(recent.temp_c);
      if (recent.precip_mm != null) collect.precip.push(recent.precip_mm);
      if (recent.wind_kmh != null) collect.wind.push(recent.wind_kmh);
      if (recent.cloud_pct != null) collect.cloud.push(recent.cloud_pct);
    }
    // letzte 24h Niederschlag (Bodenfeuchte-Proxy)
    const cutoff24 = Date.now() - 24 * 3600_000;
    let s = 0;
    for (const r of st.rows) {
      if (new Date(r.time).getTime() >= cutoff24 && r.precip_mm != null) s += r.precip_mm;
    }
    collect.precip24 += s;
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return {
    temp_c: avg(collect.temp),
    precip_last_h_mm: avg(collect.precip),
    wind_kmh: avg(collect.wind),
    cloud_pct: avg(collect.cloud),
    precip_24h_mm: smn.length ? collect.precip24 / smn.length : 0,
  };
}

export async function fetchNowcastInputs(
  lat: number, lon: number, smnStations: string[],
): Promise<NowcastInputs> {
  const [smn, radar, current] = await Promise.all([
    fetchSmnRecent(smnStations, 24).catch((e) => { console.warn("nowcast smn failed", e); return [] as SmnHourly[]; }),
    fetchRadarSnapshot(lat, lon).catch((e) => { console.warn("nowcast radar failed", e); return null; }),
    fetchOMCurrent(lat, lon).catch((e) => { console.warn("nowcast om-current failed", e); return null; }),
  ]);
  return {
    smn,
    radar,
    current: current ?? { temp_c: null, dewpoint_c: null, cloud_pct: null, wind_kmh: null },
  };
}

// ===== Tag-0 Blend =====
// Wendet Beobachtungen auf einen bereits aufgebauten Tagesdatensatz (formatDayData-Schema) an.
// MOSMIX bleibt im Output als `mosmix_reference` erhalten, falls vorhanden.
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function adjAgg(agg: any, fn: (v: number) => number) {
  if (!agg || typeof agg.avg !== "number") return agg;
  return {
    ...agg,
    avg: r1(fn(agg.avg)),
    min: typeof agg.min === "number" ? r1(fn(agg.min)) : agg.min,
    max: typeof agg.max === "number" ? r1(fn(agg.max)) : agg.max,
  };
}

export type NowcastResult = {
  applied: boolean;
  observed_now: ReturnType<typeof aggregateSmnLatest> | null;
  next_2h: { precip_mm: number; trend: "trocken" | "abnehmend" | "konstant" | "zunehmend" } | null;
  next_6h: { precip_mm: number } | null;
  cloud_correction_pct: number;     // additiv auf Tag-Bewölkung
  temp_correction_c: number;        // additiv auf tmax (Bewölkungs-Realitätscheck)
  wind_factor: number;
  precip_factor_today: number;      // skaliert Tagesniederschlag basierend auf Radar
  night_extra_cooling_c: number;    // Δ auf tmin (negativ = kälter)
  night_fog_likely: boolean;
  confidence: "hoch" | "mittel" | "niedrig";
  reasons: string[];
};

export function computeNowcastResult(
  day: any,
  inputs: NowcastInputs,
  settings: { night_clear_cooling_c?: number; nowcast_obs_horizon_h?: number },
): NowcastResult {
  const reasons: string[] = [];
  const obs = inputs.smn.length ? aggregateSmnLatest(inputs.smn) : null;
  const radar = inputs.radar;
  const cur = inputs.current;

  // === Bewölkungs-Realitätscheck ===
  let cloudCorr = 0;
  let tempCorr = 0;
  const modelCloud = day?.cloudcover?.avg ?? null;
  const obsCloud = obs?.cloud_pct ?? cur.cloud_pct ?? null;
  if (modelCloud != null && obsCloud != null) {
    const diff = obsCloud - modelCloud;
    if (Math.abs(diff) >= 25) {
      // signifikante Abweichung — auf Stundenwert ist nur Tendenz aussagekräftig,
      // daher gedämpft (50 %) auf Tageswert
      cloudCorr = clamp(diff * 0.5, -40, 40);
      // Tagesmaximum entsprechend anpassen (nur wenn Tag noch nicht weit fortgeschritten)
      tempCorr = clamp(-(cloudCorr / 10) * TEMP_DROP_PER_10PCT_CLOUD, -3, 3);
      reasons.push(`Bewölkungs-Check: SMN ${Math.round(obsCloud)} % vs Modell ${Math.round(modelCloud)} % → ${cloudCorr > 0 ? "+" : ""}${Math.round(cloudCorr)} % Bedeckung, T ${tempCorr > 0 ? "+" : ""}${tempCorr.toFixed(1)} °C`);
    }
  }

  // === Wind-Faktor aus jüngsten 3 h ===
  let windFactor = 1;
  if (obs?.wind_kmh != null && day?.wind_max?.avg != null && day.wind_max.avg > 1) {
    const ratio = obs.wind_kmh / day.wind_max.avg;
    // gedämpft, da Tagesmax meist > aktueller Wind
    windFactor = clamp(0.6 + ratio * 0.5, 0.6, 1.6);
  }

  // === Niederschlag: Radar-basiert ===
  let precipFactor = 1;
  let next2: NowcastResult["next_2h"] = null;
  let next6: NowcastResult["next_6h"] = null;
  if (radar) {
    const r2 = radar.forecast_next_2h.next_2h_mm;
    const r6 = radar.forecast_hours.reduce((a, b) => a + b.mm, 0);
    const obs3 = radar.observed.last_3h_mm;
    let trend: NonNullable<NowcastResult["next_2h"]>["trend"] = "trocken";
    if (r2 < 0.1 && obs3 < 0.1) trend = "trocken";
    else if (r2 > obs3 * 1.5 + 0.2) trend = "zunehmend";
    else if (r2 < obs3 * 0.5 - 0.2) trend = "abnehmend";
    else trend = "konstant";
    next2 = { precip_mm: r2, trend };
    next6 = { precip_mm: r1(r6) };

    // Tagesniederschlags-Faktor: wenn Modell deutlich vom beobachteten Trend abweicht
    const modelToday = day?.precip?.avg ?? 0;
    if (obs3 + r6 > 0.5 && modelToday > 0) {
      const projected = obs3 + r6 + Math.max(0, modelToday - obs3 - r6) * 0.5;
      precipFactor = clamp(projected / Math.max(modelToday, 0.1), 0.4, 2.5);
      if (Math.abs(precipFactor - 1) > 0.2) {
        reasons.push(`Radar-Korrektur Niederschlag: Faktor ${precipFactor.toFixed(2)} (3h obs ${obs3} mm, 6h fcst ${r1(r6)} mm)`);
      } else {
        precipFactor = 1;
      }
    } else if (obs3 + r6 < 0.1 && modelToday > 1) {
      precipFactor = 0.5;
      reasons.push(`Radar trocken (0 mm in 9h Fenster), Modell sieht ${modelToday} mm → halbiert`);
    } else if (modelToday < 0.2 && obs3 > 0.5) {
      precipFactor = Math.max(2, (obs3 + 0.5) / 0.2);
      reasons.push(`Modell sieht 0 mm, Radar zeigt ${obs3} mm → Tagessumme angehoben`);
    }
  }

  // === Nacht-Modul ===
  const maxCool = Math.max(0, settings.night_clear_cooling_c ?? 1.5);
  let nightCool = 0;
  let nightFog = false;
  const isClearWind = (obsCloud != null && obsCloud < 30) && (obs?.wind_kmh != null && obs.wind_kmh < 8);
  if (isClearWind) {
    // trockener Boden → mehr Auskühlung
    const dryFactor = obs && obs.precip_24h_mm < 1 ? 1.0 : 0.5;
    nightCool = -clamp(maxCool * dryFactor, 0.5, 3);
    reasons.push(`Klarnacht (Bewölkung ${Math.round(obsCloud!)} %, Wind ${obs?.wind_kmh?.toFixed(1)} km/h) → tmin ${nightCool.toFixed(1)} °C`);
  }
  if (cur.dewpoint_c != null && cur.temp_c != null) {
    const spread = cur.temp_c - cur.dewpoint_c;
    if (spread < 1.5 && (obsCloud ?? 100) >= 70) {
      nightFog = true;
      nightCool = 0; // bei Nebel keine zusätzliche Auskühlung
      reasons.push(`Nebel-Risiko: T-Td-Spread ${spread.toFixed(1)} °C, Bedeckung hoch`);
    }
  }

  // === Konfidenz ===
  const corrMagnitude = Math.abs(cloudCorr) / 40 + Math.abs(precipFactor - 1) + Math.abs(tempCorr) / 3;
  const confidence: NowcastResult["confidence"] =
    corrMagnitude < 0.3 ? "hoch" : corrMagnitude < 0.8 ? "mittel" : "niedrig";

  const applied = cloudCorr !== 0 || tempCorr !== 0 || windFactor !== 1 || precipFactor !== 1 || nightCool !== 0 || nightFog;

  return {
    applied,
    observed_now: obs,
    next_2h: next2,
    next_6h: next6,
    cloud_correction_pct: Math.round(cloudCorr),
    temp_correction_c: r1(tempCorr),
    wind_factor: Math.round(windFactor * 100) / 100,
    precip_factor_today: Math.round(precipFactor * 100) / 100,
    night_extra_cooling_c: r1(nightCool),
    night_fog_likely: nightFog,
    confidence,
    reasons,
  };
}

// Wendet das Nowcast-Result auf einen Tag-0 Datensatz an.
export function applyNowcastToDay(day: any, nc: NowcastResult): any {
  if (!day) return day;
  const out = { ...day };
  if (nc.cloud_correction_pct !== 0 && out.cloudcover_source !== "none") {
    out.cloudcover = adjAgg(out.cloudcover, (v) => clamp(v + nc.cloud_correction_pct, 0, 100));
  }
  if (nc.temp_correction_c !== 0) {
    out.tmax = adjAgg(out.tmax, (v) => v + nc.temp_correction_c);
  }
  if (nc.night_extra_cooling_c !== 0) {
    out.tmin = adjAgg(out.tmin, (v) => v + nc.night_extra_cooling_c);
  }
  if (nc.wind_factor !== 1) {
    out.wind_max = adjAgg(out.wind_max, (v) => v * nc.wind_factor);
  }
  if (nc.precip_factor_today !== 1) {
    out.precip = adjAgg(out.precip, (v) => v * nc.precip_factor_today);
  }
  out.nowcast = {
    applied: nc.applied,
    confidence: nc.confidence,
    observed_now: nc.observed_now,
    next_2h: nc.next_2h,
    next_6h: nc.next_6h,
    cloud_correction_pct: nc.cloud_correction_pct,
    temp_correction_c: nc.temp_correction_c,
    wind_factor: nc.wind_factor,
    precip_factor_today: nc.precip_factor_today,
    night_extra_cooling_c: nc.night_extra_cooling_c,
    night_fog_likely: nc.night_fog_likely,
    reasons: nc.reasons,
  };
  return out;
}
