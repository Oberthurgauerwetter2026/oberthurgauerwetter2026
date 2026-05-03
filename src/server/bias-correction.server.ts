// Bias-Korrektur: Vergleicht reale SMN-Messungen der letzten Tage mit dem
// Modell-Hindcast (Open-Meteo, gleiche Modelle wie im Forecast) und berechnet
// einen mittleren Bias pro Parameter. Wird auf zukünftige Forecast-Tage
// angewandt, die nicht bereits durch DWD-MOSMIX statistisch korrigiert wurden.
import { fetchSmnRecent, type SmnHourly } from "./swissmetnet.server";
import { getOrSetCache } from "./weather-cache.server";

export type BiasResult = {
  applied: boolean;
  stations: string[];
  delta_temp: number;       // °C, additiv (model + delta -> realistisch)
  factor_wind: number;      // multiplikativ (clamped)
  factor_precip: number;    // multiplikativ (clamped)
  delta_cloud: number;      // %, additiv (clamped ±30)
  lookback_days: number;
  samples: number;
  reason?: string;
};

// Open-Meteo Hindcast: Modell-Vergangenheitswerte für eine Station.
// Wir verwenden das hochauflösende meteoswiss_icon_ch1 (alternativ icon_d2) als
// Referenz. past_days bis 14, hourly statt daily für saubere Mittelung.
async function fetchModelHistory(
  lat: number,
  lon: number,
  pastDays: number,
): Promise<Array<{ time: string; t: number | null; w: number | null; p: number | null; c: number | null }>> {
  const cacheKey = `om:hist:v2:${lat.toFixed(3)},${lon.toFixed(3)}:d${pastDays}`;
  return getOrSetCache(cacheKey, async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("hourly", "temperature_2m,precipitation,wind_speed_10m,cloudcover");
    url.searchParams.set("past_days", String(Math.min(14, Math.max(2, pastDays))));
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("models", "meteoswiss_icon_ch1");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("wind_speed_unit", "kmh");
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn("Bias hindcast HTTP", res.status);
      return [];
    }
    const j = await res.json() as {
      hourly?: { time?: string[]; temperature_2m?: number[]; precipitation?: number[]; wind_speed_10m?: number[]; cloudcover?: number[] };
    };
    const h = j.hourly;
    if (!h?.time) return [];
    return h.time.map((t, i) => ({
      time: t.endsWith("Z") ? t : `${t}:00Z`.replace(/(:00)?:00Z$/, ":00Z"),
      t: h.temperature_2m?.[i] ?? null,
      w: h.wind_speed_10m?.[i] ?? null,
      p: h.precipitation?.[i] ?? null,
      c: h.cloudcover?.[i] ?? null,
    }));
  }, 60 * 60 * 1000);
}

// Stündliches Pairing nach exakter ISO-Zeit (UTC).
function pairHourly(
  smn: SmnHourly["rows"],
  model: Awaited<ReturnType<typeof fetchModelHistory>>,
) {
  const m = new Map(model.map((r) => [r.time.slice(0, 13), r])); // bis Stunde
  const pairs: Array<{ obs_t: number | null; mod_t: number | null; obs_w: number | null; mod_w: number | null; obs_p: number | null; mod_p: number | null; ageH: number }> = [];
  const now = Date.now();
  for (const o of smn) {
    const key = o.time.slice(0, 13);
    const mr = m.get(key);
    if (!mr) continue;
    pairs.push({
      obs_t: o.temp_c, mod_t: mr.t,
      obs_w: o.wind_kmh, mod_w: mr.w,
      obs_p: o.precip_mm, mod_p: mr.p,
      ageH: (now - new Date(o.time).getTime()) / 3600_000,
    });
  }
  return pairs;
}

// Exponentiell gewichteter Mittelwert (jüngere Werte zählen mehr).
function weighted(pairs: Array<{ ageH: number }>, getter: (p: any) => [number | null, number | null]) {
  let sumW = 0, sumD = 0, n = 0;
  for (const p of pairs) {
    const [a, b] = getter(p);
    if (a == null || b == null) continue;
    const w = Math.exp(-p.ageH / (24 * 3)); // Halbwertszeit ~2 Tage
    sumW += w;
    sumD += w * (a - b);
    n++;
  }
  return { delta: sumW > 0 ? sumD / sumW : 0, n };
}

function weightedRatio(pairs: Array<{ ageH: number }>, getter: (p: any) => [number | null, number | null]) {
  let sumO = 0, sumM = 0, n = 0;
  for (const p of pairs) {
    const [obs, mod] = getter(p);
    if (obs == null || mod == null) continue;
    const w = Math.exp(-p.ageH / (24 * 3));
    sumO += w * obs;
    sumM += w * mod;
    n++;
  }
  if (n < 5 || sumM <= 0.5) return { ratio: 1, n };
  return { ratio: sumO / sumM, n };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export async function computeBiasCorrection(
  stationAbbrs: string[],
  lookbackDays: number,
  strengthPct: number,
): Promise<BiasResult> {
  const stations = await fetchSmnRecent(stationAbbrs, lookbackDays * 24);
  if (!stations.length) {
    return { applied: false, stations: [], delta_temp: 0, factor_wind: 1, factor_precip: 1, lookback_days: lookbackDays, samples: 0, reason: "no SMN data" };
  }

  // Pairs über alle Stationen sammeln
  const allPairs: any[] = [];
  for (const st of stations) {
    const hist = await fetchModelHistory(st.lat, st.lon, lookbackDays);
    if (!hist.length) continue;
    allPairs.push(...pairHourly(st.rows, hist));
  }

  if (allPairs.length < 12) {
    return { applied: false, stations: stations.map((s) => s.station), delta_temp: 0, factor_wind: 1, factor_precip: 1, lookback_days: lookbackDays, samples: allPairs.length, reason: "too few pairs" };
  }

  const t = weighted(allPairs, (p) => [p.obs_t, p.mod_t]);
  const w = weightedRatio(allPairs, (p) => [p.obs_w, p.mod_w]);
  const r = weightedRatio(allPairs, (p) => [p.obs_p, p.mod_p]);

  const s = clamp(strengthPct, 0, 100) / 100;
  // Stärke skaliert die Korrektur (0% = keine, 100% = volle)
  const dT  = clamp(t.delta * s, -5, 5);
  const fW  = clamp(1 + (w.ratio - 1) * s, 0.5, 1.8);
  const fP  = clamp(1 + (r.ratio - 1) * s, 0.4, 2.5);

  return {
    applied: true,
    stations: stations.map((st) => st.station),
    delta_temp: Math.round(dT * 10) / 10,
    factor_wind: Math.round(fW * 100) / 100,
    factor_precip: Math.round(fP * 100) / 100,
    lookback_days: lookbackDays,
    samples: allPairs.length,
  };
}

// Wendet die Korrektur auf ein bestehendes Tagesobjekt (formatDayData-Schema) an.
export function applyBiasToDay(day: any, bias: BiasResult): any {
  if (!bias.applied) return day;
  const out = { ...day };
  const adjAgg = (agg: any, fn: (v: number) => number) => {
    if (!agg || typeof agg.avg !== "number") return agg;
    return {
      ...agg,
      avg: Math.round(fn(agg.avg) * 10) / 10,
      min: typeof agg.min === "number" ? Math.round(fn(agg.min) * 10) / 10 : agg.min,
      max: typeof agg.max === "number" ? Math.round(fn(agg.max) * 10) / 10 : agg.max,
    };
  };
  out.tmax = adjAgg(out.tmax, (v) => v + bias.delta_temp);
  out.tmin = adjAgg(out.tmin, (v) => v + bias.delta_temp);
  out.wind_max = adjAgg(out.wind_max, (v) => v * bias.factor_wind);
  out.precip = adjAgg(out.precip, (v) => v * bias.factor_precip);
  out.bias_correction = {
    applied: true,
    stations: bias.stations,
    delta_temp: bias.delta_temp,
    factor_wind: bias.factor_wind,
    factor_precip: bias.factor_precip,
    lookback_days: bias.lookback_days,
    samples: bias.samples,
  };
  return out;
}
