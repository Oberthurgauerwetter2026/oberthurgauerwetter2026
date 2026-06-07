import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

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
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { DWD_STORAGE_BUCKET, DWD_STORAGE_PATH } = await import(
            "@/server/dwd-bodenanalyse.server"
          );
          const { data, error } = await supabaseAdmin.storage
            .from(DWD_STORAGE_BUCKET)
            .download(DWD_STORAGE_PATH);
          if (error || !data) {
            return new Response(
              `DWD-Karte nicht verfügbar: ${error?.message ?? "no data"}`,
              {
                status: 404,
                headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
              },
            );
          }
          const body = await data.arrayBuffer();
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Content-Disposition": "inline",
              "Cache-Control": "public, max-age=900, s-maxage=900",
              "X-Source": "Deutscher Wetterdienst (GeoNutzV)",
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
