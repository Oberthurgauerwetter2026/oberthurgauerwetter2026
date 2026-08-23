import { createFileRoute } from "@tanstack/react-router";

/**
 * Auslieferung der Modellgitter aus R2 (befüllt von der GitHub Action
 * `model-grid-ingest.yml`). Der Worker streamt keine grossen Bodies, sondern
 * leitet auf die öffentliche R2-URL weiter.
 */
export const Route = createFileRoute("/api/public/model-grid/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const base = process.env["R2_PUBLIC_URL"];
        if (!base) {
          return Response.json({ error: "R2_PUBLIC_URL not configured" }, { status: 503 });
        }
        const splat = (params as { _splat?: string })._splat ?? "";
        if (!/^[a-z0-9_\-/]+\.json$/i.test(splat)) {
          return Response.json({ error: "invalid path" }, { status: 400 });
        }
        const target = `${base.replace(/\/$/, "")}/model-grid/${splat}`;
        // Same-Origin-Proxy: R2 liefert keine CORS-Header, deshalb reicht ein
        // Redirect nicht. Die Dateien sind klein (~200 KB), Streaming ist ok.
        const upstream = await fetch(target, { cf: { cacheTtl: 120, cacheEverything: true } } as RequestInit);
        if (!upstream.ok) {
          return Response.json({ error: `upstream ${upstream.status}` }, { status: upstream.status === 404 ? 404 : 502 });
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=120, s-maxage=300",
          },
        });
      },
    },
  },
});
