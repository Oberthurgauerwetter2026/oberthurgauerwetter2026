import { createFileRoute } from "@tanstack/react-router";

const DWD_URL =
  "https://www.dwd.de/DWD/wetter/wv_allg/europa/bilder/bwk_bodendruck_na_ana.png";

export const Route = createFileRoute("/api/public/maps/dwd-bodenanalyse.png")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const upstream = await fetch(DWD_URL, {
            headers: {
              "User-Agent":
                "oberthurgauerwetter2026/1.0 (+https://oberthurgauerwetter2026.lovable.app)",
              Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
            },
          });
          if (!upstream.ok) {
            return new Response(`Upstream DWD ${upstream.status}`, {
              status: 502,
              headers: { "Access-Control-Allow-Origin": "*" },
            });
          }
          const body = await upstream.arrayBuffer();
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Content-Disposition": "inline",
              "Cache-Control": "public, max-age=900, s-maxage=900",
              "Access-Control-Allow-Origin": "*",
              "X-Source": "Deutscher Wetterdienst (GeoNutzV)",
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
