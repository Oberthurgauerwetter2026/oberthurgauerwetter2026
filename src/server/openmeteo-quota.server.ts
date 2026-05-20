// Zentraler Wrapper für alle Open-Meteo Aufrufe.
// - Zählt jeden Aufruf in `openmeteo_usage` (UTC-Tag, atomar via RPC).
// - Markiert 429 (Tageslimit) separat.
// - Tagesreset implizit durch UTC-Datum (passt zum OM-Limit).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
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

/**
 * fetch() Wrapper für Open-Meteo. Zählt automatisch hoch.
 * Identisches Verhalten wie fetch(), nur mit Telemetrie.
 */
export async function fetchOpenMeteo(
  url: URL | string,
  source: OmSource,
  init?: RequestInit,
): Promise<Response> {
  const target = typeof url === "string" ? url : url.toString();
  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (e) {
    // Netzwerkfehler: trotzdem zählen (Aufruf wurde gemacht), aber nicht als 429.
    void recordUsage(source, 1, false);
    throw e;
  }
  void recordUsage(source, 1, res.status === 429);
  return res;
}
