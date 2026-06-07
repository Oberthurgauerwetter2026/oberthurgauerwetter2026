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
      GET: async () => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { DWD_STORAGE_BUCKET, DWD_STORAGE_PATH, refreshDwdBodenanalyse } = await import(
            "@/server/dwd-bodenanalyse.server"
          );
          let { data, error } = await supabaseAdmin.storage
            .from(DWD_STORAGE_BUCKET)
            .download(DWD_STORAGE_PATH);
          if (error || !data) {
            // Lazy-Refresh, falls noch nie gespeichert (z. B. direkt nach Deploy).
            try {
              await refreshDwdBodenanalyse();
              const retry = await supabaseAdmin.storage
                .from(DWD_STORAGE_BUCKET)
                .download(DWD_STORAGE_PATH);
              data = retry.data;
              error = retry.error;
            } catch (e: any) {
              return new Response(
                `DWD-Karte nicht verfügbar: ${e?.message ?? String(e)}`,
                { status: 502, headers: { ...CORS } },
              );
            }
          }
          if (error || !data) {
            return new Response(
              `DWD-Karte nicht verfügbar: ${error?.message ?? "no data"}`,
              { status: 502, headers: { ...CORS } },
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
