import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export const Route = createFileRoute("/api/public/maps/europe-pressure-latest.svg")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from("weather-maps")
            .download("europe-pressure-latest.svg");
          if (error || !data) {
            return new Response(`Upstream error: ${error?.message ?? "no data"}`, {
              status: 502,
              headers: { ...CORS },
            });
          }
          const body = await data.arrayBuffer();
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Content-Disposition": "inline",
              "Cache-Control": "public, max-age=300",
              ...CORS,
            },
          });
        } catch (e: any) {
          return new Response(`Proxy error: ${e?.message ?? String(e)}`, {
            status: 502,
            headers: { ...CORS },
          });
        }
      },
    },
  },
});
