// Zentraler Wrapper für alle Open-Meteo Aufrufe.
// - Zählt jeden Aufruf in `openmeteo_usage` (UTC-Tag, atomar via RPC).
// - Markiert 429 zentral (daily/hourly/minutely) und unterscheidet echtes Tageslimit
//   vs. Shared-IP-Throttle der geteilten Cloudflare-Worker-Egress-IP.
// - Setzt einen GLOBALEN Throttle-Marker (`om:global-throttle`), den alle anderen
//   Open-Meteo-Aufrufer respektieren — kein Hammering während Sperrfenster.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tryR2ForUrl } from "./openmeteo-cache.server";

// Quellen, für die der R2-Cache strukturell passt (Phase A/B/C im Ingest).
const R2_FALLBACK_SOURCES: ReadonlySet<OmSource> = new Set([
  "forecast",
  "nowcast",
  "historical_bias",
]);

export type OmSource =
  | "forecast"
  | "pressure_map"
  | "radar"
  | "snow_line"
  | "pressure_gradient"
  | "nowcast"
  | "elevation"
  | "historical_bias"
  | "synoptic_trend"
  | "ensemble";

export const OPEN_METEO_DAILY_LIMIT = 10000;
const GLOBAL_THROTTLE_KEY = "om:global-throttle";
// Unterhalb dieser Eigen-Nutzung gilt ein "daily"-429 als Shared-IP-Throttle, nicht als echtes Limit.
const SHARED_IP_USAGE_THRESHOLD = 500;

export type ThrottleKind =
  | "shared_ip_daily"   // anderes Tenant hat geteilte IP zugespammt → 45 min
  | "real_daily"        // wir haben unser Tageslimit erreicht → bis 00:00 UTC
  | "hourly"            // hourly bucket voll → 30 min
  | "minutely";         // minutely bucket voll → 2 min

export type GlobalThrottleInfo = {
  active: boolean;
  kind?: ThrottleKind;
  source?: OmSource;
  setAt?: string;
  until?: string;
};

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

async function recordUsage(source: OmSource, amount: number, is429: boolean) {
  if (amount <= 0) return;
  try {
    await supabaseAdmin.rpc("increment_om_usage", {
      _day: utcDay(),
      _source: source,
      _amount: amount,
      _is_429: is429,
    });
  } catch (e) {
    console.warn("[openmeteo-quota] recordUsage failed", e);
  }
}

export async function getGlobalThrottle(): Promise<GlobalThrottleInfo> {
  try {
    const { data } = await supabaseAdmin
      .from("weather_cache")
      .select("payload, expires_at")
      .eq("cache_key", GLOBAL_THROTTLE_KEY)
      .maybeSingle();
    if (data?.expires_at && data.expires_at > new Date().toISOString()) {
      const p = (data.payload ?? {}) as Record<string, unknown>;
      return {
        active: true,
        kind: p.kind as ThrottleKind | undefined,
        source: p.source as OmSource | undefined,
        setAt: p.set_at as string | undefined,
        until: data.expires_at as string,
      };
    }
  } catch {
    // ignore
  }
  return { active: false };
}

async function setGlobalThrottle(kind: ThrottleKind, source: OmSource, ttlMs: number) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  try {
    await supabaseAdmin.from("weather_cache").upsert({
      cache_key: GLOBAL_THROTTLE_KEY,
      payload: { kind, source, set_at: new Date().toISOString() },
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    console.warn(`[openmeteo-quota] global throttle ${kind} (${source}) bis ${expiresAt}`);
  } catch (e) {
    console.warn("[openmeteo-quota] setGlobalThrottle failed", e);
  }
}

async function isLikelySharedIpThrottle(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("openmeteo_usage")
      .select("total")
      .eq("day", utcDay())
      .maybeSingle();
    return (data?.total ?? 0) < SHARED_IP_USAGE_THRESHOLD;
  } catch {
    return false;
  }
}

function classify429Body(body: string): "daily" | "hourly" | "minutely" {
  if (/daily/i.test(body)) return "daily";
  if (/hourly/i.test(body)) return "hourly";
  if (/minutely/i.test(body)) return "minutely";
  return "minutely";
}

function syntheticThrottleResponse(info: GlobalThrottleInfo): Response {
  return new Response(
    JSON.stringify({
      reason: "global_throttle",
      kind: info.kind,
      until: info.until,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "x-om-throttle": info.kind ?? "unknown",
        "x-om-throttle-until": info.until ?? "",
      },
    },
  );
}

/**
 * fetch() Wrapper für Open-Meteo. Zählt automatisch hoch und respektiert/setzt
 * einen globalen Throttle-Marker. Identisches Verhalten wie fetch() (gibt eine
 * Response zurück, ggf. eine synthetische 429), aber mit zentraler Telemetrie
 * und Sperrlogik.
 */
export async function fetchOpenMeteo(
  url: URL | string,
  source: OmSource,
  init?: RequestInit,
): Promise<Response> {
  // Globalen Throttle respektieren — keinen Call absetzen, sondern synthetisches 429.
  const throttle = await getGlobalThrottle();
  if (throttle.active) {
    console.warn(
      `[openmeteo-quota] skip ${source}: global throttle ${throttle.kind} bis ${throttle.until}`,
    );
    return syntheticThrottleResponse(throttle);
  }

  const target = typeof url === "string" ? url : url.toString();
  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (e) {
    void recordUsage(source, 1, false);
    throw e;
  }
  void recordUsage(source, 1, res.status === 429);

  if (res.status === 429) {
    let body = "";
    try {
      body = await res.clone().text();
    } catch {
      // ignore
    }
    const tier = classify429Body(body);
    if (tier === "daily") {
      if (await isLikelySharedIpThrottle()) {
        await setGlobalThrottle("shared_ip_daily", source, 45 * 60 * 1000);
      } else {
        const ttl = new Date(nextUtcMidnightIso()).getTime() - Date.now();
        await setGlobalThrottle("real_daily", source, Math.max(60_000, ttl));
      }
    } else if (tier === "hourly") {
      await setGlobalThrottle("hourly", source, 30 * 60 * 1000);
    } else {
      await setGlobalThrottle("minutely", source, 2 * 60 * 1000);
    }
  }
  return res;
}
