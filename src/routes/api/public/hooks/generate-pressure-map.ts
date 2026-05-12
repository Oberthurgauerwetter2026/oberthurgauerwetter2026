import { createFileRoute } from "@tanstack/react-router";
import { generatePressureMap, OpenMeteoRateLimitError } from "@/server/pressure-map.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
          const status = result.skipped
            ? `Skip (cron) · bereits aktuell für ${result.targetUtc}`
            : `OK (cron) · gültig ${result.targetUtc} UTC · ${(result.bytes / 1024).toFixed(1)} KB`;
          await supabaseAdmin
            .from("app_settings")
            .update({
              pressure_map_last_run: new Date().toISOString(),
              pressure_map_last_status: status,
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          return Response.json(result);
        } catch (e: any) {
          const isRateLimit = e instanceof OpenMeteoRateLimitError || /Tageslimit|rate.?limit|429/i.test(e?.message ?? "");
          const isInsufficient = /Zu wenige gültige Druckwerte/.test(e?.message ?? "");
          const status = isRateLimit
            ? "Pausiert: Open-Meteo Tageslimit erreicht (auto-retry 00:00 UTC)"
            : isInsufficient
              ? `Transient: ${e?.message} — auto-retry beim nächsten Cron-Slot`
              : `Fehler (cron): ${e?.message ?? String(e)}`;
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
