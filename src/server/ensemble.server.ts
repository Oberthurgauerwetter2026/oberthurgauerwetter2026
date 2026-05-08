// Open-Meteo Ensemble Forecast: holt 50+ ECMWF + 31 GFS Member, aggregiert sie
// pro Tag zu Perzentilen (p10/p50/p90) für Tmax, Tmin, Niederschlagssumme und
// Wind-Maximum. Wird ab Tag 2 in den Forecast eingefügt, um die Bandbreite der
// möglichen Entwicklung sichtbar zu machen.

import { getOrSetCache } from "./weather-cache.server";

export type EnsembleStat = {
  p10: number;
  p50: number;
  p90: number;
  spread: number;
};

export type EnsembleDay = {
  date: string; // YYYY-MM-DD
  t_max: EnsembleStat | null;
  t_min: EnsembleStat | null;
  precip_sum: EnsembleStat | null;
  wind_max: EnsembleStat | null;
  spread_class: "low" | "moderate" | "high";
  member_count: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function buildStat(values: number[]): EnsembleStat | null {
  const valid = values.filter((v) => v != null && Number.isFinite(v));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const p10 = r1(percentile(sorted, 0.1));
  const p50 = r1(percentile(sorted, 0.5));
  const p90 = r1(percentile(sorted, 0.9));
  return { p10, p50, p90, spread: r1(p90 - p10) };
}

// Sammelt alle Member-Arrays einer Variable: das Basis-Array sowie alle
// numerischen Suffix-Varianten (z. B. temperature_2m_member01).
function collectMembers(hourly: any, base: string): number[][] {
  const arrs: number[][] = [];
  if (Array.isArray(hourly[base])) arrs.push(hourly[base]);
  for (const key of Object.keys(hourly)) {
    if (key.startsWith(base + "_member") && Array.isArray(hourly[key])) {
      arrs.push(hourly[key]);
    }
  }
  return arrs;
}

function aggregateMember(
  arr: number[],
  indices: number[],
  op: "max" | "min" | "sum",
): number | null {
  const vals = indices
    .map((i) => arr[i])
    .filter((v) => v != null && Number.isFinite(v)) as number[];
  if (!vals.length) return null;
  if (op === "max") return Math.max(...vals);
  if (op === "min") return Math.min(...vals);
  return vals.reduce((a, b) => a + b, 0);
}

function classifySpread(
  t_max: EnsembleStat | null,
  precip: EnsembleStat | null,
): "low" | "moderate" | "high" {
  const tSpread = t_max?.spread ?? 0;
  const pSpread = precip?.spread ?? 0;
  if (tSpread >= 6 || pSpread >= 10) return "high";
  if (tSpread >= 3 || pSpread >= 4) return "moderate";
  return "low";
}

async function fetchEnsembleRaw(lat: number, lon: number) {
  // ECMWF IFS Ensemble (50 members + control) und GFS GEFS (31 members)
  // werden kombiniert über models=ecmwf_ifs025,gfs_seamless. Open-Meteo
  // expandiert pro Modell automatisch alle Member.
  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation,wind_speed_10m",
  );
  url.searchParams.set("models", "icon_seamless,gfs_seamless");
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("forecast_days", "10");
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo Ensemble HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchEnsemble(
  lat: number,
  lon: number,
): Promise<EnsembleDay[]> {
  const cacheKey = `ensemble:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  // 2h Cache — Ensemble-Updates kommen alle 6h, 2h ist reichlich Puffer.
  const ttlMs = 2 * 60 * 60 * 1000;
  try {
    return await getOrSetCache<EnsembleDay[]>(
      cacheKey,
      async () => {
        const raw = await fetchEnsembleRaw(lat, lon);
        return aggregateEnsemble(raw);
      },
      ttlMs,
    );
  } catch (e) {
    console.warn("[ensemble] fetch failed", e);
    return [];
  }
}

function aggregateEnsemble(raw: any): EnsembleDay[] {
  const hourly = raw?.hourly;
  if (!hourly?.time) return [];
  const tMembers = collectMembers(hourly, "temperature_2m");
  const pMembers = collectMembers(hourly, "precipitation");
  const wMembers = collectMembers(hourly, "wind_speed_10m");
  if (!tMembers.length) return [];

  // Indizes pro Datum sammeln
  const byDate = new Map<string, number[]>();
  const times = hourly.time as string[];
  for (let i = 0; i < times.length; i++) {
    const date = times[i].slice(0, 10);
    const arr = byDate.get(date);
    if (arr) arr.push(i);
    else byDate.set(date, [i]);
  }

  const out: EnsembleDay[] = [];
  for (const [date, indices] of byDate.entries()) {
    const tMaxPerMember = tMembers
      .map((arr) => aggregateMember(arr, indices, "max"))
      .filter((v): v is number => v != null);
    const tMinPerMember = tMembers
      .map((arr) => aggregateMember(arr, indices, "min"))
      .filter((v): v is number => v != null);
    const pSumPerMember = pMembers
      .map((arr) => aggregateMember(arr, indices, "sum"))
      .filter((v): v is number => v != null);
    const wMaxPerMember = wMembers
      .map((arr) => aggregateMember(arr, indices, "max"))
      .filter((v): v is number => v != null);

    const t_max = buildStat(tMaxPerMember);
    const t_min = buildStat(tMinPerMember);
    const precip_sum = buildStat(pSumPerMember);
    const wind_max = buildStat(wMaxPerMember);

    out.push({
      date,
      t_max,
      t_min,
      precip_sum,
      wind_max,
      spread_class: classifySpread(t_max, precip_sum),
      member_count: tMembers.length,
    });
  }
  return out;
}
