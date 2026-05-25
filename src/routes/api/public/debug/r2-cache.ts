import { createFileRoute } from "@tanstack/react-router";

function mask(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.slice(0, 24) + "…";
  }
}

export const Route = createFileRoute("/api/public/debug/r2-cache")({
  server: {
    handlers: {
      GET: async () => {
        const base = process.env.R2_PUBLIC_URL;
        const out: Record<string, unknown> = {
          r2_public_url: mask(base),
          r2_public_url_set: Boolean(base),
        };

        if (!base) {
          return Response.json({ ok: false, ...out, error: "R2_PUBLIC_URL not set" }, { status: 500 });
        }

        const target = `${base.replace(/\/$/, "")}/openmeteo/forecast.json`;
        out.target = target;

        const started = Date.now();
        try {
          const res = await fetch(target, { method: "GET" });
          out.status = res.status;
          out.content_type = res.headers.get("content-type");
          out.content_length = res.headers.get("content-length");
          out.fetch_ms = Date.now() - started;

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            out.body_preview = body.slice(0, 400);
            return Response.json({ ok: false, ...out }, { status: 200 });
          }

          const json = (await res.json()) as Record<string, unknown>;
          const generatedAt = json.generatedAt as string | undefined;
          const ageMin = generatedAt
            ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000)
            : null;

          return Response.json({
            ok: true,
            ...out,
            version: json.version,
            generatedAt,
            age_minutes: ageMin,
            phaseA_locations: Array.isArray(json.phaseA) ? (json.phaseA as unknown[]).length : null,
            phaseB_locations: Array.isArray(json.phaseB) ? (json.phaseB as unknown[]).length : null,
            phaseC_locations: Array.isArray(json.phaseC) ? (json.phaseC as unknown[]).length : null,
          });
        } catch (e) {
          out.fetch_ms = Date.now() - started;
          return Response.json(
            { ok: false, ...out, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
