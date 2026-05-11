import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePressureMap } from "@/server/pressure-map.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function ensureAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin required");
}

export const triggerPressureMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    try {
      const result = await generatePressureMap();
      await supabaseAdmin
        .from("app_settings")
        .update({
          pressure_map_last_run: new Date().toISOString(),
          pressure_map_last_status: `OK · gültig ${result.targetUtc} UTC · ${(result.bytes / 1024).toFixed(1)} KB`,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
      return { ok: true as const, ...result };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const isRateLimit = e?.name === "OpenMeteoRateLimitError" || /Tageslimit|rate.?limit|429/i.test(msg);
      const status = isRateLimit
        ? "Pausiert: Open-Meteo Rate-Limit (auto-retry sobald frei)"
        : `Fehler: ${msg}`;
      await supabaseAdmin
        .from("app_settings")
        .update({
          pressure_map_last_run: new Date().toISOString(),
          pressure_map_last_status: status,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
      // Return structured error instead of throwing — avoids blank-screen on the client.
      return { ok: false as const, error: isRateLimit ? "RATE_LIMITED" : "FAILED", message: status };
    }
  });

export const getPressureMapStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("app_settings")
      .select("pressure_map_enabled, pressure_map_last_run, pressure_map_last_status")
      .limit(1)
      .maybeSingle();
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/weather-maps/europe-pressure-latest.svg`;
    return {
      enabled: data?.pressure_map_enabled ?? true,
      lastRun: data?.pressure_map_last_run ?? null,
      lastStatus: data?.pressure_map_last_status ?? null,
      embedUrl: url,
    };
  });
