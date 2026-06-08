import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const BUCKET = "weather-maps";
const PATH = "dwd-bodenanalyse-latest.png";
const SIGNED_TTL_SECONDS = 60 * 60;

export const Route = createFileRoute("/api/public/maps/dwd-bodenanalyse.png")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=900, s-maxage=900",
            ...CORS,
          },
        }),
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(PATH, SIGNED_TTL_SECONDS);
          if (error || !data?.signedUrl) {
            return new Response(
              `DWD-Karte nicht verfügbar: ${error?.message ?? "no signed url"}`,
              { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } },
            );
          }
          return new Response(null, {
            status: 302,
            headers: {
              Location: data.signedUrl,
              "Cache-Control": "public, max-age=900, s-maxage=900",
              "X-Source": "Deutscher Wetterdienst (GeoNutzV)",
              ...CORS,
            },
          });
        } catch (e: any) {
          return new Response(`Proxy error: ${e?.message ?? String(e)}`, {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
          });
        }
      },
    },
  },
});
