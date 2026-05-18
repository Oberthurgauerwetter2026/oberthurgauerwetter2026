import { createFileRoute } from "@tanstack/react-router";

const STORAGE_URL =
  "https://kdolnotjbhgjieznmpgf.supabase.co/storage/v1/object/public/weather-maps/europe-pressure-latest.svg";

export const Route = createFileRoute("/api/public/maps/europe-pressure-latest/svg")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const upstream = await fetch(STORAGE_URL, { cf: { cacheTtl: 300 } as any });
          if (!upstream.ok) {
            return new Response(`Upstream ${upstream.status}`, {
              status: 502,
              headers: { "Access-Control-Allow-Origin": "*" },
            });
          }
          const body = await upstream.arrayBuffer();
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
