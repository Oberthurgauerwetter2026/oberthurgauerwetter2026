import { createFileRoute } from "@tanstack/react-router";
import { generatePressureMap } from "@/server/pressure-map.server";
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
          await supabaseAdmin
            .from("app_settings")
            .update({
              pressure_map_last_run: new Date().toISOString(),
              pressure_map_last_status: `OK (cron) · gültig ${result.targetUtc} UTC · ${(result.bytes / 1024).toFixed(1)} KB`,
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          return Response.json(result);
        } catch (e: any) {
          await supabaseAdmin
            .from("app_settings")
            .update({
              pressure_map_last_run: new Date().toISOString(),
              pressure_map_last_status: `Fehler (cron): ${e?.message ?? String(e)}`,
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500 });
        }
      },
    },
  },
});
