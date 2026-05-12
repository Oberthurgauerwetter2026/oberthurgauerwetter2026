// Synoptik-Auswertung für den Trend Tag 6–10:
// Holt MSLP-Felder über Europa und identifiziert dominante Hoch-/Tiefdruckzentren
// + resultierende Strömung über der Alpennordseite.
import { fetchOpenMeteo } from "./openmeteo-quota.server";
import { getOrSetCache } from "./weather-cache.server";

// 6x6 Europa-Gitter, Schritt 5°
const N = 60, S = 35, W = -5, E = 30, STEP = 5;
const ROWS = Math.round((N - S) / STEP) + 1; // 6
const COLS = Math.round((E - W) / STEP) + 1; // 8

const ALPS_LAT = 47.5;
const ALPS_LON = 9.3;

type Center = { lat: number; lon: number; hPa: number; region: string };
type DaySynoptic = { date: string; lows: Center[]; highs: Center[]; flow: string };

export type SynopticTrend = {
  period: string;
  synoptic: {
    dominant_low: { region: string; avg_hPa: number } | null;
    dominant_high: { region: string; avg_hPa: number } | null;
    flow_alps: string;
    regime_change: boolean;
  };
  local_trend: {
    tmax_range_c: [number, number] | null;
    wet_days: number;
    character: string;
  };
  per_day: DaySynoptic[];
};

function regionForPoint(lat: number, lon: number): string {
  // Grobe Bounding-Box-Klassifikation Europa.
  if (lat >= 55 && lon >= -10 && lon <= 2) return "Britische Inseln";
  if (lat >= 55 && lon > 2 && lon <= 10) return "Nordsee";
  if (lat >= 55 && lon > 10) return "Skandinavien";
  if (lat >= 45 && lat < 55 && lon >= -5 && lon < 5) return "Westeuropa";
  if (lat >= 45 && lat < 55 && lon >= 5 && lon < 17) return "Mitteleuropa";
  if (lat >= 42 && lat < 50 && lon >= 17 && lon <= 30) return "Balkan";
  if (lat >= 35 && lat < 45 && lon >= -10 && lon < 5) return "Iberische Halbinsel";
  if (lat >= 35 && lat < 45 && lon >= 5 && lon <= 30) return "Mittelmeer";
  if (lat >= 50 && lon < -5) return "Nordatlantik";
  return "Europa";
}

function findExtrema(grid: number[], minima: boolean): Center[] {
  const out: Center[] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const v = grid[r * COLS + c];
      if (!Number.isFinite(v)) continue;
      const neighbours = [
        grid[(r - 1) * COLS + c],
        grid[(r + 1) * COLS + c],
        grid[r * COLS + (c - 1)],
        grid[r * COLS + (c + 1)],
      ];
      if (neighbours.some((n) => !Number.isFinite(n))) continue;
      const isExtreme = minima
        ? neighbours.every((n) => v < n) && v < 1012
        : neighbours.every((n) => v > n) && v > 1018;
      if (!isExtreme) continue;
      const lat = N - r * STEP;
      const lon = W + c * STEP;
      out.push({ lat, lon, hPa: Math.round(v), region: regionForPoint(lat, lon) });
    }
  }
  // Top 2 sortiert nach Stärke
  out.sort((a, b) => (minima ? a.hPa - b.hPa : b.hPa - a.hPa));
  return out.slice(0, 2);
}

function flowAtAlps(grid: number[]): string {
  // Bilineare Druckwerte um den Punkt 47.5/9.3 → vereinfacht: nimm das nächstgelegene 5°-Gitter
  // und werte den Druck-Gradient zwischen Nord/Süd und West/Ost aus.
  const rowAlps = Math.round((N - ALPS_LAT) / STEP); // 60-47.5 = 12.5 → row 2.5 → 2
  const colAlps = Math.round((ALPS_LON - W) / STEP); // 9.3-(-5)=14.3 → col 2.86 → 3
  if (rowAlps < 1 || rowAlps >= ROWS - 1 || colAlps < 1 || colAlps >= COLS - 1) {
    return "unbestimmt";
  }
  const pN = grid[(rowAlps - 1) * COLS + colAlps];
  const pS = grid[(rowAlps + 1) * COLS + colAlps];
  const pW = grid[rowAlps * COLS + (colAlps - 1)];
  const pE = grid[rowAlps * COLS + (colAlps + 1)];
  if (![pN, pS, pW, pE].every(Number.isFinite)) return "unbestimmt";

  // Geostrophischer Wind: parallel zu Isobaren, tiefer Druck links auf Nordhemisphäre.
  // Druckgradient-Vektor zeigt vom hohen zum tiefen Druck:
  //   gx = (pE - pW) (positiv = Druck steigt nach Osten → Wind weht aus Süden)
  //   gy = (pN - pS) (positiv = Druck steigt nach Norden → Wind weht aus Westen)
  const gx = pE - pW;
  const gy = pN - pS;
  // Wind-Vektor (Richtung WOHIN er weht): (-gy, gx) auf Nordhalbkugel (90° gegen Gradient gedreht)
  // Wir wollen die Richtung WOHER → invertieren.
  const fromX = gy;
  const fromY = -gx;
  const angle = (Math.atan2(fromX, fromY) * 180) / Math.PI; // 0=Nord, 90=Ost
  const compass = ((angle + 360) % 360);
  const dirs = [
    { name: "Nord", at: 0 },
    { name: "Nord-Ost", at: 45 },
    { name: "Ost", at: 90 },
    { name: "Süd-Ost", at: 135 },
    { name: "Süd", at: 180 },
    { name: "Süd-West", at: 225 },
    { name: "West", at: 270 },
    { name: "Nord-West", at: 315 },
    { name: "Nord", at: 360 },
  ];
  let best = dirs[0];
  let bestDelta = 999;
  for (const d of dirs) {
    const delta = Math.abs(d.at - compass);
    if (delta < bestDelta) { bestDelta = delta; best = d; }
  }
  // Stärke aus Gradient-Magnitude (hPa pro 5°-Schritt ≈ 555 km auf ~47°N)
  const mag = Math.sqrt(gx * gx + gy * gy);
  const strength = mag >= 6 ? "kräftig" : mag >= 3 ? "mässig" : "schwach";
  return `${best.name}, ${strength}`;
}

async function fetchEuropeMslp(forecastDays: number): Promise<{ times: string[]; perPoint: { lat: number; lon: number; pressure: number[] }[] } | null> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(N - r * STEP);
      lons.push(W + c * STEP);
    }
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  url.searchParams.set("hourly", "pressure_msl");
  url.searchParams.set("models", "ecmwf_ifs025,gfs_global");
  url.searchParams.set("forecast_days", String(forecastDays));
  url.searchParams.set("timezone", "UTC");

  const res = await fetchOpenMeteo(url, "synoptic_trend");
  if (!res.ok) {
    console.warn(`[synoptic-trend] OM fetch failed: ${res.status}`);
    return null;
  }
  const json = (await res.json()) as any;
  const list = Array.isArray(json) ? json : [json];
  if (!list.length) return null;

  // Open-Meteo liefert pro Location entweder ein Objekt (bei genau 1 Modell)
  // oder bei mehreren Modellen pro Variable Arrays mit Suffixen wie
  // pressure_msl_ecmwf_ifs025 und pressure_msl_gfs_global.
  const MODEL_KEYS = ["pressure_msl_ecmwf_ifs025", "pressure_msl_gfs_global"];
  const times: string[] = list[0]?.hourly?.time ?? [];

  let ecmwfOk = 0;
  let gfsOk = 0;

  const perPoint = list.map((loc: any, i: number) => {
    const hourly = loc?.hourly ?? {};
    const series: number[][] = MODEL_KEYS
      .map((k) => (Array.isArray(hourly[k]) ? (hourly[k] as number[]) : null))
      .filter((s): s is number[] => Array.isArray(s));

    if (Array.isArray(hourly[MODEL_KEYS[0]])) ecmwfOk++;
    if (Array.isArray(hourly[MODEL_KEYS[1]])) gfsOk++;

    // Fallback: falls (warum auch immer) nur das generische Feld kam.
    if (series.length === 0 && Array.isArray(hourly.pressure_msl)) {
      series.push(hourly.pressure_msl as number[]);
    }

    const len = times.length;
    const merged = new Array<number>(len);
    for (let h = 0; h < len; h++) {
      let sum = 0;
      let n = 0;
      for (const s of series) {
        const v = s[h];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      merged[h] = n > 0 ? sum / n : NaN;
    }
    return { lat: lats[i], lon: lons[i], pressure: merged };
  });

  if (ecmwfOk !== gfsOk) {
    console.warn(`[synoptic-trend] model coverage mismatch: ecmwf=${ecmwfOk} gfs=${gfsOk} of ${list.length}`);
  }

  return { times, perPoint };
}

type TrendDay = {
  date: string;
  tmax?: { avg: number } | null;
  tmin?: { avg: number } | null;
  precipitation?: { avg?: number; sum?: number } | null;
};

export async function fetchSynopticTrend(trendDays: TrendDay[]): Promise<SynopticTrend | null> {
  if (!trendDays.length) return null;
  const cacheKey = `synoptic-trend-${trendDays[0].date}`;
  return getOrSetCache(cacheKey, async () => {
    return computeSynopticTrend(trendDays);
  });
}

async function computeSynopticTrend(trendDays: TrendDay[]): Promise<SynopticTrend | null> {
  // Tag 1 = morgen, Trend reicht bis Tag 10 → forecast_days=11 deckt Tag 6..10 sicher ab
  const lastDate = trendDays[trendDays.length - 1].date;
  const today = new Date().toISOString().slice(0, 10);
  const forecastDays = Math.min(16, Math.max(7, Math.ceil((Date.parse(lastDate) - Date.parse(today)) / 86400000) + 2));

  let mslp: Awaited<ReturnType<typeof fetchEuropeMslp>> = null;
  try {
    mslp = await fetchEuropeMslp(forecastDays);
  } catch (e) {
    console.warn("[synoptic-trend] fetch threw, falling back", e);
  }

  const perDay: DaySynoptic[] = [];
  if (mslp) {
    for (const d of trendDays) {
      const targetIso = `${d.date}T12:00`;
      const idx = mslp.times.findIndex((t) => t.startsWith(targetIso));
      if (idx < 0) continue;
      const grid = mslp.perPoint.map((p) => p.pressure[idx]);
      const lows = findExtrema(grid, true);
      const highs = findExtrema(grid, false);
      const flow = flowAtAlps(grid);
      perDay.push({ date: d.date, lows, highs, flow });
    }
  }

  // Aggregation
  const lowRegions = new Map<string, { count: number; sum: number }>();
  const highRegions = new Map<string, { count: number; sum: number }>();
  const flowCounts = new Map<string, number>();
  for (const day of perDay) {
    for (const lo of day.lows) {
      const cur = lowRegions.get(lo.region) ?? { count: 0, sum: 0 };
      cur.count++; cur.sum += lo.hPa;
      lowRegions.set(lo.region, cur);
    }
    for (const hi of day.highs) {
      const cur = highRegions.get(hi.region) ?? { count: 0, sum: 0 };
      cur.count++; cur.sum += hi.hPa;
      highRegions.set(hi.region, cur);
    }
    flowCounts.set(day.flow, (flowCounts.get(day.flow) ?? 0) + 1);
  }
  const dominantLow = [...lowRegions.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const dominantHigh = [...highRegions.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const dominantFlow = [...flowCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  // Regime change: dominante Tief-/Hoch-Region zwischen ersten und letzten Tagen unterschiedlich
  let regimeChange = false;
  if (perDay.length >= 4) {
    const firstHalf = perDay.slice(0, Math.floor(perDay.length / 2));
    const secondHalf = perDay.slice(Math.floor(perDay.length / 2));
    const firstLow = firstHalf[0]?.lows[0]?.region;
    const lastLow = secondHalf[secondHalf.length - 1]?.lows[0]?.region;
    const firstHigh = firstHalf[0]?.highs[0]?.region;
    const lastHigh = secondHalf[secondHalf.length - 1]?.highs[0]?.region;
    if ((firstLow && lastLow && firstLow !== lastLow) || (firstHigh && lastHigh && firstHigh !== lastHigh)) {
      regimeChange = true;
    }
  }

  // Lokaler Trend
  const tmaxValues = trendDays.map((d) => d.tmax?.avg).filter((v): v is number => typeof v === "number");
  const tmaxRange: [number, number] | null = tmaxValues.length
    ? [Math.round(Math.min(...tmaxValues)), Math.round(Math.max(...tmaxValues))]
    : null;
  const wetDays = trendDays.filter((d) => (d.precipitation?.sum ?? d.precipitation?.avg ?? 0) >= 1).length;
  const character = wetDays >= 3 ? "wechselhaft" : wetDays >= 1 ? "zeitweise unbeständig" : "ruhig";

  return {
    period: "Tag 6–10",
    synoptic: {
      dominant_low: dominantLow ? { region: dominantLow[0], avg_hPa: Math.round(dominantLow[1].sum / dominantLow[1].count) } : null,
      dominant_high: dominantHigh ? { region: dominantHigh[0], avg_hPa: Math.round(dominantHigh[1].sum / dominantHigh[1].count) } : null,
      flow_alps: dominantFlow?.[0] ?? "unbestimmt",
      regime_change: regimeChange,
    },
    local_trend: {
      tmax_range_c: tmaxRange,
      wet_days: wetDays,
      character,
    },
    per_day: perDay,
  };
}

export function buildTrendUserPrompt(locationName: string, trendDays: any[], synoptic: SynopticTrend | null): string {
  if (!synoptic || !synoptic.synoptic.dominant_low && !synoptic?.synoptic.dominant_high) {
    // Fallback ohne Synoptik
    return `Standort: ${locationName}. Schreibe einen 3–4-sätzigen Trend für die Tage 6–10 (Großwetterlage, Charakter, Temperaturbereich als Spanne). Keine Wochentage, keine tagesgenauen Werte, Nominalstil. Datenbasis:\n${JSON.stringify(trendDays, null, 2)}`;
  }
  return [
    `Standort: ${locationName}. Schreibe einen 3–4-sätzigen Trend für die Tage 6–10 im Nominalstil.`,
    ``,
    `STRUKTUR (zwingend):`,
    `- Satz 1: Großwetterlage benennen — Position der dominanten Tief- und Hochdruckgebiete plus resultierende Strömung über der Alpennordseite. Beispielton: "Tiefdruckgebiet zwischen Mitteleuropa und dem Balkan, Hochdruckkeil über dem Nordatlantik, südwestliche Höhenströmung."`,
    `- Satz 2: Wettercharakter, der sich daraus ergibt (Sonne/Bewölkung, Schauer/Gewitter, Frontendurchgang). Tageszeitangabe wenn passend ("vor allem in der zweiten Tageshälfte").`,
    `- Satz 3: Temperaturbereich als Spanne in der Form "Höchsttemperaturen zwischen X und Y Grad" — Werte aus local_trend.tmax_range_c.`,
    synoptic.synoptic.regime_change
      ? `- Satz 4: Tendenzwechsel innerhalb des Zeitraums kurz andeuten.`
      : ``,
    `Keine Wochentagsnennung, keine tagesgenauen Werte, keine konkreten Einzeltermine.`,
    ``,
    `Synoptische Lage (für Satz 1 + 2):`,
    JSON.stringify(synoptic.synoptic, null, 2),
    ``,
    `Lokaler Trend (für Satz 3):`,
    JSON.stringify(synoptic.local_trend, null, 2),
    ``,
    `Tägliche Roh-Daten (Hintergrund, nicht zitieren):`,
    JSON.stringify(trendDays, null, 2),
  ].filter(Boolean).join("\n");
}
