import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { revealServiceRoleKey } from "@/lib/reveal-key.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_app/admin/reveal-key")({
  component: RevealKeyPage,
});

function RevealKeyPage() {
  const fn = useServerFn(revealServiceRoleKey);
  const [data, setData] = useState<{ supabaseUrl: string; serviceRoleKey: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>GitHub Secrets (einmalige Anzeige)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data && (
            <Button
              onClick={async () => {
                setLoading(true);
                setErr(null);
                try {
                  const r = await fn();
                  setData(r);
                } catch (e: any) {
                  setErr(e?.message ?? String(e));
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              {loading ? "Lade…" : "Schlüssel anzeigen"}
            </Button>
          )}
          {err && <p className="text-destructive text-sm">{err}</p>}
          {data && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">SUPABASE_URL</p>
                <textarea
                  readOnly
                  className="w-full font-mono text-xs p-2 border rounded bg-muted"
                  rows={1}
                  value={data.supabaseUrl}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-1">SUPABASE_SERVICE_ROLE_KEY</p>
                <textarea
                  readOnly
                  className="w-full font-mono text-xs p-2 border rounded bg-muted"
                  rows={4}
                  value={data.serviceRoleKey}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Beide Werte in GitHub als Repository Secrets einfügen
                (Settings → Secrets and variables → Actions). Danach sag Bescheid,
                dann entferne ich diese Seite wieder.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
