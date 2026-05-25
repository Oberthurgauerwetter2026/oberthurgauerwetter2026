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
  phaseA: unknown[]; // Multi-Modell hourly+daily, Tag 0-7
  phaseB: unknown[]; // ICON-CH1 minutely_15, ±6h
  phaseC: unknown[]; // Bias-Lookback, past 7d
};

let memo: { at: number; data: OpenMeteoCachePayload } | null = null;
const MEMO_TTL_MS = 30_000; // pro Worker-Instanz höchstens alle 30 s neu ziehen

export async function loadOpenMeteoCache(): Promise<OpenMeteoCachePayload | null> {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) {
    console.warn("[openmeteo-cache] R2_PUBLIC_URL nicht gesetzt — Cache deaktiviert");
    return null;
  }

  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.data;

  const url = `${base.replace(/\/$/, "")}/openmeteo/forecast.json`;
  try {
    const res = await fetch(url, {
      // Edge-Cache: erlaubt Cloudflare, denselben Wert weiterzureichen.
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
