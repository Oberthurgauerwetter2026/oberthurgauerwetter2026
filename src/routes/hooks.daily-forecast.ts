import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Cron hook called daily at 18:00 by pg_cron
export const Route = createFileRoute("/hooks/daily-forecast")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace("Bearer ", "");
        const expectedAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || token !== expectedAnon) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        try {
          // Find an admin user to attribute the auto-generated forecast to
          const { data: admins } = await supabaseAdmin
            .from("user_roles").select("user_id").eq("role", "admin").limit(1);
          const creatorId = admins?.[0]?.user_id ?? null;

          // Inline forecast generation to avoid auth middleware
          const { runAutoForecast } = await import("@/server/forecast.auto");
          const result = await runAutoForecast(creatorId);
          return new Response(JSON.stringify({ ok: true, ...result }), { headers: { "Content-Type": "application/json" } });
        } catch (e: any) {
          console.error("daily-forecast error:", e);
          return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },
});
