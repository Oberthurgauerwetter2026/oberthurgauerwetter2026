import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/maps/europe-pressure-latest.svg")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from("weather-maps")
            .download("europe-pressure-latest.svg");
          if (error || !data) {
            return new Response(`Upstream error: ${error?.message ?? "no data"}`, {
              status: 502,
              headers: { "Access-Control-Allow-Origin": "*" },
            });
          }
          const body = await data.arrayBuffer();
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Content-Disposition": "inline",
              "Cache-Control": "public, max-age=300",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (e: any) {
          return new Response(`Proxy error: ${e?.message ?? String(e)}`, {
            status: 502,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }
      },
    },
  },
});
