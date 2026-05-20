import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OPEN_METEO_DAILY_LIMIT } from "@/server/openmeteo-quota.server";

const RATELIMIT_KEY_PREFIX = "om:ratelimit:";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}
function nextUtcMidnightIso(): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0,
  )).toISOString();
}

async function ensureAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin required");
}

export const getOpenMeteoUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const day = utcDay();
    const { data: row } = await supabaseAdmin
      .from("openmeteo_usage")
      .select("day,total,by_source,last_429_at,last_429_source,updated_at")
      .eq("day", day)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const { data: rlAll } = await supabaseAdmin
      .from("weather_cache")
      .select("cache_key,expires_at")
      .like("cache_key", `${RATELIMIT_KEY_PREFIX}%`)
      .gt("expires_at", nowIso);
    const activeMarkers = rlAll ?? [];
    const isRateLimited = activeMarkers.length > 0;

    // Aktive Open-Meteo-Cache-Einträge (ohne Rate-Limit-Marker)
    const { data: cacheRows } = await supabaseAdmin
      .from("weather_cache")
      .select("cache_key")
      .like("cache_key", "om:%")
      .gt("expires_at", nowIso);
    const cacheByPrefix: Record<string, number> = {};
    let cacheEntries = 0;
    for (const r of cacheRows ?? []) {
      const key = r.cache_key as string;
      if (key.startsWith(RATELIMIT_KEY_PREFIX)) continue;
      cacheEntries++;
      // om:short:..., om:mid:..., om:long:..., om:current:...
      const bucket = key.split(":")[1] ?? "other";
      cacheByPrefix[bucket] = (cacheByPrefix[bucket] ?? 0) + 1;
    }

    return {
      day,
      total: row?.total ?? 0,
      limit: OPEN_METEO_DAILY_LIMIT,
      bySource: (row?.by_source as Record<string, number>) ?? {},
      last429At: row?.last_429_at ?? null,
      last429Source: row?.last_429_source ?? null,
      updatedAt: row?.updated_at ?? null,
      isRateLimited,
      activeMarkerCount: activeMarkers.length,
      resetAtIso: nextUtcMidnightIso(),
      cacheEntries,
      cacheByPrefix,
    };
  });

export const clearOpenMeteoRateLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const { data, error } = await supabaseAdmin
      .from("weather_cache")
      .delete()
      .like("cache_key", `${RATELIMIT_KEY_PREFIX}%`)
      .select("cache_key");
    if (error) throw new Error(error.message);
    return { cleared: data?.length ?? 0 };
  });
