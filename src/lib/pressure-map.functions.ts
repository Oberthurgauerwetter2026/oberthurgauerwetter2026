import { createServerFn } from "@tanstack/react-start";
import { getRequestHost, getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPressureMapStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("app_settings")
      .select("pressure_map_enabled, pressure_map_last_run, pressure_map_last_status")
      .limit(1)
      .maybeSingle();

    let base = "";
    try {
      const host = getRequestHost();
      const proto = getRequestHeader("x-forwarded-proto") ?? "https";
      base = `${proto}://${host}`;
    } catch {
      base = "";
    }
    const url = `${base}/api/public/maps/europe-pressure-latest.svg`;

    return {
      enabled: data?.pressure_map_enabled ?? true,
      lastRun: data?.pressure_map_last_run ?? null,
      lastStatus: data?.pressure_map_last_status ?? null,
      embedUrl: url,
    };
  });
