// Ensemble-Layer (ICON-CH1-EPS / ICON-CH2-EPS via Open-Meteo Ensemble API).
//
// Liefert pro Tag und Parameter (Tmax, Tmin, Niederschlag, Wind) Streuung und
// Wahrscheinlichkeiten aus den EPS-Membern. Diese Information wird zusätzlich
// zum bestehenden deterministischen Forecast verwendet:
//   1) intern als sanfter Outlier-Dämpfer (über applyEnsembleConfidenceToDay
//      werden deterministische Modelle, die stark vom EPS-Median abweichen,
//      mit halbem Gewicht in `weights_used` markiert),
//   2) in der UI als Vertrauens-Badge ("hohe/mittlere/tiefe Sicherheit") und
//      als zusätzliche Niederschlags-Wahrscheinlichkeiten.
//
// Die deterministischen Modelle bleiben Rückgrat des Forecasts — EPS ergänzt nur.
import { getOrSetCache } from "./weather-cache.server";
import { fetchOpenMeteo as fetchOMTracked } from "./openmeteo-quota.server";

export type EnsembleDay = {
  date: string;                  // YYYY-MM-DD
  members_count: number;
  tmax: { mean: number; p10: number; p50: number; p90: number; spread: number } | null;
  tmin: { mean: number; p10: number; p50: number; p90: number; spread: number } | null;
  precip: {
    mean: number;
    p50: number;
    p90: number;
    prob_gt_1mm: number;   // 0–100
    prob_gt_5mm: number;
    prob_gt_10mm: number;
  } | null;
  wind: { mean: number; p50: number; p90: number; prob_gt_50kmh: number } | null;
};

// Open-Meteo Ensemble Modell-Keys für MeteoSchweiz. Falls EPS einzeln nicht
// verfügbar ist, fällt `icon_d2` (DWD-EPS-Komponente) als Backup ein — Open-Meteo
// bündelt die EPS-Member dort über den /v1/ensemble-Endpoint.
const ENSEMBLE_MODELS = "icon_d2,icon_eu";

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values: number[]): { mean: number; p10: number; p50: number; p90: number; spread: number } | null {
  const clean = values.filter((v) => v != null && Number.isFinite(v));
  if (clean.length < 3) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  return {
    mean: Math.round(mean * 10) / 10,
    p10: Math.round(quantile(sorted, 0.1) * 10) / 10,
    p50: Math.round(quantile(sorted, 0.5) * 10) / 10,
    p90: Math.round(quantile(sorted, 0.9) * 10) / 10,
    spread: Math.round((sorted[sorted.length - 1] - sorted[0]) * 10) / 10,
  };
}

function probGt(values: number[], threshold: number): number {
  const clean = values.filter((v) => v != null && Number.isFinite(v));
  if (!clean.length) return 0;
  const hits = clean.filter((v) => v > threshold).length;
  return Math.round((hits / clean.length) * 100);
}

// Open-Meteo /v1/ensemble liefert pro Variable ein Array `<var>_member01`,
// `<var>_member02`, ... Wir sammeln pro Stunde alle Member-Werte.
type EnsembleHourly = {
  time: string[];
  // dynamische Member-Felder
  [key: string]: any;
};

function collectMembers(hourly: EnsembleHourly, varPrefix: string): number[][] {
  // returns array indexed by hour, each entry an array of member values
  const memberKeys = Object.keys(hourly).filter((k) => k.startsWith(`${varPrefix}_member`));
  if (!memberKeys.length) return [];
  const len = hourly.time?.length ?? 0;
  const out: number[][] = [];
  for (let i = 0; i < len; i++) {
    const vals: number[] = [];
    for (const mk of memberKeys) {
      const v = hourly[mk]?.[i];
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    out.push(vals);
  }
  return out;
}

// Aggregiert stündliche Member-Daten zu Tagesstatistiken (UTC-Datum).
function aggregateByDay(
  hourly: EnsembleHourly,
  varPrefix: string,
  op: "min" | "max" | "sum",
): Map<string, number[]> {
  // Pro Tag pro Member: erst stündliche Werte je Member auf Tageskennzahl reduzieren,
  // dann Map<date, number[]> wo number[] alle Member-Tageswerte sind.
  const memberKeys = Object.keys(hourly).filter((k) => k.startsWith(`${varPrefix}_member`));
  const dayMap = new Map<string, Map<string, number[]>>(); // date -> member -> hourlyVals
  for (let i = 0; i < (hourly.time?.length ?? 0); i++) {
    const t = hourly.time[i];
    if (typeof t !== "string") continue;
    const date = t.slice(0, 10);
    if (!dayMap.has(date)) dayMap.set(date, new Map());
    const inner = dayMap.get(date)!;
    for (const mk of memberKeys) {
      const v = hourly[mk]?.[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (!inner.has(mk)) inner.set(mk, []);
      inner.get(mk)!.push(v);
    }
  }
  // Reduzieren pro (date, member) zu einem Tageswert.
  const out = new Map<string, number[]>();
  for (const [date, inner] of dayMap.entries()) {
    const dayVals: number[] = [];
    for (const vals of inner.values()) {
      if (!vals.length) continue;
      let v: number;
      if (op === "min") v = Math.min(...vals);
      else if (op === "max") v = Math.max(...vals);
      else v = vals.reduce((a, b) => a + b, 0);
      dayVals.push(v);
    }
    out.set(date, dayVals);
  }
  return out;
}

export async function fetchEnsembleSummary(
  lat: number,
  lon: number,
  forecastDays = 7,
): Promise<Map<string, EnsembleDay>> {
  const cacheKey = `om:ensemble:v1:${lat.toFixed(3)},${lon.toFixed(3)}:d${forecastDays}:${ENSEMBLE_MODELS}`;
  const data = await getOrSetCache<{
    hourly?: EnsembleHourly;
    daily?: { time?: string[] };
  } | null>(cacheKey, async () => {
    const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("models", ENSEMBLE_MODELS);
    url.searchParams.set(
      "hourly",
      "temperature_2m,precipitation,wind_speed_10m",
    );
    url.searchParams.set("forecast_days", String(Math.min(7, Math.max(1, forecastDays))));
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("wind_speed_unit", "kmh");
    const res = await fetchOMTracked(url, "ensemble");
    if (!res.ok) {
      console.warn(`[ensemble] HTTP ${res.status} for ${ENSEMBLE_MODELS}`);
      return null;
    }
    return (await res.json()) as any;
  }, 6 * 60 * 60 * 1000);

  const out = new Map<string, EnsembleDay>();
  if (!data?.hourly?.time) return out;

  const tmaxPerDay = aggregateByDay(data.hourly, "temperature_2m", "max");
  const tminPerDay = aggregateByDay(data.hourly, "temperature_2m", "min");
  const precPerDay = aggregateByDay(data.hourly, "precipitation", "sum");
  const windPerDay = aggregateByDay(data.hourly, "wind_speed_10m", "max");

  const allDates = new Set<string>([
    ...tmaxPerDay.keys(), ...tminPerDay.keys(), ...precPerDay.keys(), ...windPerDay.keys(),
  ]);
  for (const date of allDates) {
    const tmaxVals = tmaxPerDay.get(date) ?? [];
    const tminVals = tminPerDay.get(date) ?? [];
    const precVals = precPerDay.get(date) ?? [];
    const windVals = windPerDay.get(date) ?? [];
    const tmaxSum = summarize(tmaxVals);
    const tminSum = summarize(tminVals);
    const windSum = summarize(windVals);
    const precSum = summarize(precVals);
    const members_count = Math.max(tmaxVals.length, tminVals.length, precVals.length, windVals.length);
    out.set(date, {
      date,
      members_count,
      tmax: tmaxSum,
      tmin: tminSum,
      precip: precSum
        ? {
            mean: precSum.mean,
            p50: precSum.p50,
            p90: precSum.p90,
            prob_gt_1mm: probGt(precVals, 1),
            prob_gt_5mm: probGt(precVals, 5),
            prob_gt_10mm: probGt(precVals, 10),
          }
        : null,
      wind: windSum
        ? {
            mean: windSum.mean,
            p50: windSum.p50,
            p90: windSum.p90,
            prob_gt_50kmh: probGt(windVals, 50),
          }
        : null,
    });
  }
  return out;
}

// Vertrauens-Level aus Tmax-Spread + Niederschlags-Streuung ableiten.
function confidenceLevel(eps: EnsembleDay): "high" | "medium" | "low" {
  const tSpread = eps.tmax?.spread ?? eps.tmin?.spread ?? null;
  if (tSpread == null) return "medium";
  if (tSpread < 2) return "high";
  if (tSpread < 4) return "medium";
  return "low";
}

// Hängt Confidence-Block + sanfte Outlier-Dämpfung an ein Tagesobjekt.
// Wenn ein deterministisches Modell mehr als 2 × (EPS-Spread/2) vom EPS-Median
// abweicht, wird sein Gewicht in `weights_used` halbiert (nicht 0 — sanft).
export function applyEnsembleConfidenceToDay(day: any, epsByDate: Map<string, EnsembleDay>): any {
  if (!day?.date) return day;
  const eps = epsByDate.get(day.date);
  if (!eps) return day;

  const level = confidenceLevel(eps);
  const out = { ...day };

  out.ensemble_confidence = {
    level,
    members_count: eps.members_count,
    tmax_spread: eps.tmax?.spread ?? null,
    tmax_p10_p90: eps.tmax ? [eps.tmax.p10, eps.tmax.p90] : null,
    tmin_spread: eps.tmin?.spread ?? null,
    precip_p90_mm: eps.precip?.p90 ?? null,
    prob_precip_gt_1mm: eps.precip?.prob_gt_1mm ?? null,
    prob_precip_gt_5mm: eps.precip?.prob_gt_5mm ?? null,
    prob_precip_gt_10mm: eps.precip?.prob_gt_10mm ?? null,
    prob_wind_gt_50kmh: eps.wind?.prob_gt_50kmh ?? null,
  };

  // Outlier-Dämpfung: tmax pro Modell vs. EPS-Median prüfen
  const dampen = (agg: any, epsMedian: number | null, sigmaProxy: number) => {
    if (!agg?.by_model || epsMedian == null) return agg;
    const threshold = Math.max(2, sigmaProxy);
    const outliers: string[] = [];
    const newWeights = { ...(agg.weights_used ?? {}) };
    for (const [m, v] of Object.entries(agg.by_model)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (Math.abs(v - epsMedian) > threshold) {
        outliers.push(m);
        if (typeof newWeights[m] === "number") newWeights[m] = Math.round(newWeights[m] * 0.5 * 100) / 100;
      }
    }
    if (!outliers.length) return agg;
    return { ...agg, weights_used: newWeights, eps_outliers: outliers };
  };

  if (eps.tmax) out.tmax = dampen(out.tmax, eps.tmax.p50, eps.tmax.spread);
  if (eps.tmin) out.tmin = dampen(out.tmin, eps.tmin.p50, eps.tmin.spread);

  return out;
}
