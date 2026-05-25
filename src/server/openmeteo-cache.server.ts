/**
 * Reader für den R2-Open-Meteo-Cache.
 * Wird von der GitHub Action `openmeteo-ingest.yml` alle 5 min befüllt.
 *
 * Worker-ENV: R2_PUBLIC_URL  (z.B. https://pub-xxx.r2.dev)
 *
 * Drop-in für Hot-Path-Forecasts. Wenn R2_PUBLIC_URL fehlt oder der Fetch
 * scheitert, gibt `loadOpenMeteoCache()` `null` zurück — Aufrufer müssen
 * dann auf den bisherigen Direkt-Call-Pfad zurückfallen.
 */

export type OpenMeteoGridPoint = { lat: number; lon: number };

export type OpenMeteoCachePayload = {
  version: string;
  generatedAt: string; // ISO UTC
  grid: { points: OpenMeteoGridPoint[] };
  phaseA: any[]; // Multi-Modell hourly+daily, Tag 0-7
  phaseB: any[]; // ICON-CH1 minutely_15, ±6h
  phaseC: any[]; // Bias-Lookback, past 7d
};

let memo: { at: number; data: OpenMeteoCachePayload } | null = null;
const MEMO_TTL_MS = 30_000; // pro Worker-Instanz höchstens alle 30 s neu ziehen

export async function loadOpenMeteoCache(): Promise<OpenMeteoCachePayload | null> {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) return null;

  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.data;

  const url = `${base.replace(/\/$/, "")}/openmeteo/forecast.json`;
  try {
    const res = await fetch(url, {
      cf: { cacheTtl: 30, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) {
      console.warn(`[openmeteo-cache] HTTP ${res.status} für ${url}`);
      return null;
    }
    const data = (await res.json()) as OpenMeteoCachePayload;
    memo = { at: Date.now(), data };
    return data;
  } catch (e) {
    console.warn("[openmeteo-cache] fetch failed", e);
    return null;
  }
}

/** Alter des Cache in Minuten, oder `null` wenn unbekannt. */
export function cacheAgeMinutes(payload: OpenMeteoCachePayload): number | null {
  const t = Date.parse(payload.generatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60_000);
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Index des nächstgelegenen Grid-Punkts, oder -1 wenn weiter als `maxKm` weg. */
export function pickNearestIndex(
  payload: OpenMeteoCachePayload,
  lat: number,
  lon: number,
  maxKm = 25,
): number {
  const pts = payload?.grid?.points ?? [];
  if (!pts.length) return -1;
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestD <= maxKm ? bestI : -1;
}

type Phase = "A" | "B" | "C";

function classifyPhase(url: URL): Phase {
  if (url.searchParams.has("minutely_15")) return "B";
  const past = Number(url.searchParams.get("past_days") ?? "0");
  if (past >= 5) return "C";
  return "A";
}

function parseLatLon(url: URL): { lat: number; lon: number } | null {
  const la = url.searchParams.get("latitude");
  const lo = url.searchParams.get("longitude");
  if (!la || !lo) return null;
  // Bei Multi-Punkt-URL den ersten Wert nehmen.
  const lat = Number(la.split(",")[0]);
  const lon = Number(lo.split(",")[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Versucht, eine Open-Meteo-Anfrage aus dem R2-Cache zu bedienen.
 * Liefert eine synthetische 200-Response (JSON), falls möglich, sonst `null`.
 *
 * Header der Response:
 *   x-om-source: r2-cache
 *   x-om-cache-age-min: <n>
 *   x-om-cache-phase: A|B|C
 */
export async function tryR2ForUrl(
  url: URL | string,
  source: string,
): Promise<Response | null> {
  const u = typeof url === "string" ? new URL(url) : url;
  const ll = parseLatLon(u);
  if (!ll) return null;

  const payload = await loadOpenMeteoCache();
  if (!payload) return null;

  const idx = pickNearestIndex(payload, ll.lat, ll.lon);
  if (idx < 0) return null;

  const phase = classifyPhase(u);
  const bucket =
    phase === "B" ? payload.phaseB : phase === "C" ? payload.phaseC : payload.phaseA;
  const loc = bucket?.[idx];
  if (!loc) return null;

  const ageMin = cacheAgeMinutes(payload) ?? -1;
  console.warn(
    `[openmeteo-cache] served ${source} from R2 phase=${phase} age=${ageMin}min`,
  );

  return new Response(JSON.stringify(loc), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-om-source": "r2-cache",
      "x-om-cache-age-min": String(ageMin),
      "x-om-cache-phase": phase,
    },
  });
}
