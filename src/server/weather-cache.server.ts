import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Compute next midnight in Europe/Zurich as ISO timestamp.
function nextMidnightZurich(): string {
  const now = new Date();
  // Zurich offset varies (CET/CEST). Use Intl to get current Zurich Y-M-D.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  // Build "tomorrow 00:00 Zurich". Use offset by trying both CET (+01:00) and CEST (+02:00):
  // Easiest: take next day's date string and try +02:00 first; if the resulting instant is in the past,
  // fall back to +01:00.
  const nextDay = new Date(`${y}-${m}-${d}T00:00:00+00:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);
  const candidateCEST = new Date(`${nextDayStr}T00:00:00+02:00`);
  if (candidateCEST.getTime() > now.getTime()) return candidateCEST.toISOString();
  const candidateCET = new Date(`${nextDayStr}T00:00:00+01:00`);
  return candidateCET.toISOString();
}

export async function getOrSetCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const nowIso = new Date().toISOString();
  const expiresAt = ttlMs != null
    ? new Date(Date.now() + ttlMs).toISOString()
    : nextMidnightZurich();
  try {
    const { data } = await supabaseAdmin
      .from("weather_cache")
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (data && data.expires_at && data.expires_at > nowIso) {
      console.log(`[weather-cache] HIT ${cacheKey}`);
      return data.payload as T;
    }
  } catch (e) {
    console.warn(`[weather-cache] read failed for ${cacheKey}`, e);
  }

  console.log(`[weather-cache] MISS ${cacheKey} — fetching fresh`);
  const payload = await fetcher();
  if (payload == null) return payload;
  try {
    await supabaseAdmin.from("weather_cache").upsert({
      cache_key: cacheKey,
      payload: payload as any,
      fetched_at: nowIso,
      expires_at: expiresAt,
    });
    // Best-effort cleanup of expired rows.
    await supabaseAdmin.from("weather_cache").delete().lt("expires_at", nowIso);
  } catch (e) {
    console.warn(`[weather-cache] write failed for ${cacheKey}`, e);
  }
  return payload;
}

/**
 * Wie getOrSetCache, aber wenn der Fetcher null/undefined liefert ODER wirft,
 * darf als Fallback ein abgelaufener Eintrag bis max. `maxStaleMs` Alter
 * zurückgegeben werden. Nützlich für temporäre Open-Meteo-Drosselungen.
 */
export async function getOrSetCacheWithStale<T>(
  cacheKey: string,
  fetcher: () => Promise<T | null>,
  ttlMs: number | undefined,
  maxStaleMs: number,
): Promise<{ value: T | null; stale: boolean; staleAgeMs?: number }> {
  const nowIso = new Date().toISOString();
  let existing: { payload: any; expires_at: string | null; fetched_at: string | null } | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("weather_cache")
      .select("payload, expires_at, fetched_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    existing = (data as any) ?? null;
    if (existing?.expires_at && existing.expires_at > nowIso) {
      console.log(`[weather-cache] HIT ${cacheKey}`);
      return { value: existing.payload as T, stale: false };
    }
  } catch (e) {
    console.warn(`[weather-cache] read failed for ${cacheKey}`, e);
  }

  let fresh: T | null = null;
  let fetcherError: unknown = null;
  try {
    fresh = await fetcher();
  } catch (e) {
    fetcherError = e;
    console.warn(`[weather-cache] fetcher failed for ${cacheKey}`, e);
  }

  if (fresh != null) {
    const expiresAt = ttlMs != null
      ? new Date(Date.now() + ttlMs).toISOString()
      : nextMidnightZurich();
    try {
      await supabaseAdmin.from("weather_cache").upsert({
        cache_key: cacheKey,
        payload: fresh as any,
        fetched_at: nowIso,
        expires_at: expiresAt,
      });
    } catch (e) {
      console.warn(`[weather-cache] write failed for ${cacheKey}`, e);
    }
    return { value: fresh, stale: false };
  }

  // Stale-Fallback
  if (existing?.fetched_at) {
    const age = Date.now() - new Date(existing.fetched_at).getTime();
    if (age <= maxStaleMs && existing.payload != null) {
      console.warn(
        `[weather-cache] STALE ${cacheKey} (age=${Math.round(age / 60000)}min, maxStale=${Math.round(maxStaleMs / 60000)}min)`,
      );
      return { value: existing.payload as T, stale: true, staleAgeMs: age };
    }
  }

  if (fetcherError) {
    // Fetcher hat geworfen UND kein Stale-Fallback verfügbar → Fehler weitergeben.
    throw fetcherError;
  }
  return { value: null, stale: false };
}
