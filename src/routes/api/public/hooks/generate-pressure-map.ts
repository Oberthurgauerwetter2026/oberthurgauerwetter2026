import { createFileRoute } from "@tanstack/react-router";
import { generatePressureMap, OpenMeteoRateLimitError } from "@/server/pressure-map.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function omUsageToday(): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabaseAdmin
      .from("openmeteo_usage")
      .select("total")
      .eq("day", today)
      .maybeSingle();
    return data?.total ?? 0;
  } catch {
    return 0;
  }
}

// Public cron endpoint — auth via Supabase anon apikey header (provided by pg_cron).
export const Route = createFileRoute("/api/public/hooks/generate-pressure-map")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await generatePressureMap();
          const usage = await omUsageToday();

          // DWD-Bodenanalyse zusätzlich aktualisieren (best-effort, schlägt nicht den ganzen Run fehl)
          let dwdNote = "";
          try {
            const { refreshDwdBodenanalyse } = await import("@/server/dwd-bodenanalyse.server");
            const dwd = await refreshDwdBodenanalyse();
            dwdNote = ` · DWD ${(dwd.bytes / 1024).toFixed(0)} KB`;
          } catch (e: any) {
            dwdNote = ` · DWD-Fehler: ${e?.message ?? String(e)}`;
          }

          const status = result.skipped
            ? `Skip (cron) · bereits aktuell für ${result.targetUtc} · OM heute: ${usage}${dwdNote}`
            : `OK (cron) · gültig ${result.targetUtc} UTC · ${(result.bytes / 1024).toFixed(1)} KB${result.source ? ` · ${result.source}` : ""} · OM heute: ${usage}${dwdNote}`;
          await supabaseAdmin
            .from("app_settings")
            .update({
              pressure_map_last_run: new Date().toISOString(),
              pressure_map_last_status: status,
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          return Response.json(result);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const usage = await omUsageToday();
          const isRateLimit = e instanceof OpenMeteoRateLimitError || /Tageslimit|rate.?limit|429/i.test(msg);
          const isTransientBurst = /transient|minutely/i.test(msg);
          const isInsufficient = /Zu wenige gültige Druckwerte/.test(msg);
          let status: string;
          if (isRateLimit && isTransientBurst) {
            status = `Transient: OM-Burst (${msg}) — auto-retry beim nächsten Cron-Slot · OM heute: ${usage}`;
          } else if (isRateLimit) {
            status = `Pausiert: Open-Meteo Limit (${msg}) — auto-retry beim nächsten Slot · OM heute: ${usage}`;
          } else if (isInsufficient) {
            status = `Transient: ${msg} — auto-retry beim nächsten Cron-Slot · OM heute: ${usage}`;
          } else {
            status = `Fehler (cron): ${msg} · OM heute: ${usage}`;
          }
          await supabaseAdmin
            .from("app_settings")
            .update({
              pressure_map_last_run: new Date().toISOString(),
              pressure_map_last_status: status,
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          return new Response(status, { status: isRateLimit ? 429 : 500 });
        }
      },
    },
  },
});
