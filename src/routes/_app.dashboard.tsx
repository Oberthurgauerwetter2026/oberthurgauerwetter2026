import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generateForecast, deleteForecast } from "@/server/forecast.functions";
import { toast } from "sonner";
import { Loader2, Plus, ExternalLink, FileEdit, Trash2, Map as MapIcon } from "lucide-react";
import { RegionMap } from "@/components/RegionMap";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

interface Forecast {
  id: string;
  forecast_date: string;
  status: string;
  published_at: string | null;
  wp_post_url: string | null;
  created_at: string;
}

function Dashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("forecasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    else setForecasts(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleGenerate() {
    if (!session) return;
    setGenerating(true);
    try {
      const { forecastId } = await generateForecast({
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Prognose generiert");
      navigate({ to: "/forecast/$forecastId", params: { forecastId } });
    } catch (e: any) {
      toast.error(e.message ?? "Fehler beim Generieren");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!session) return;
    if (!confirm("Diese Prognose unwiderruflich löschen?")) return;
    setDeletingId(id);
    try {
      await deleteForecast({
        data: { forecastId: id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Prognose gelöscht");
      setForecasts((prev) => prev.filter((f) => f.id !== id));
    } catch (e: any) {
      toast.error(e.message ?? "Fehler beim Löschen");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Prognosen</h1>
          <p className="text-sm text-muted-foreground">Übersicht aller Wetterprognosen</p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Neue Prognose generieren
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verlauf</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Lädt…</div>
          ) : forecasts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Prognosen. Klick oben auf „Neue Prognose generieren".
            </div>
          ) : (
            <div className="divide-y">
              {forecasts.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {new Date(f.forecast_date).toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                      </span>
                      {f.status === "published" ? (
                        <Badge variant="default">Veröffentlicht</Badge>
                      ) : (
                        <Badge variant="secondary">Entwurf</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Erstellt: {new Date(f.created_at).toLocaleString("de-CH")}
                      {f.published_at && ` · Publiziert: ${new Date(f.published_at).toLocaleString("de-CH")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.wp_post_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={f.wp_post_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" /> Live
                        </a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/forecast/$forecastId" params={{ forecastId: f.id }}>
                        <FileEdit className="mr-1 h-3 w-3" /> Öffnen
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(f.id)}
                      disabled={deletingId === f.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {deletingId === f.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                      Löschen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
