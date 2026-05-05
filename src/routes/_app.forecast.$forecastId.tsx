import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WeatherDataView } from "@/components/WeatherDataView";
import { regenerateEntry, regenerateForecast, deleteForecast, publishToWordPress } from "@/server/forecast.functions";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Upload, ArrowLeft, ExternalLink, RefreshCw, Trash2, BarChart3, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_app/forecast/$forecastId")({
  component: ForecastEditor,
});

interface Entry {
  id: string;
  position: number;
  entry_date: string | null;
  title: string;
  body: string;
  weather_data: any;
}

interface Forecast {
  id: string;
  forecast_date: string;
  status: string;
  wp_post_url: string | null;
  notes: string | null;
}

function ForecastEditor() {
  const { forecastId } = Route.useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [regenAll, setRegenAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openWeather, setOpenWeather] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    const [{ data: f, error: fe }, { data: es, error: ee }] = await Promise.all([
      supabase.from("forecasts").select("*").eq("id", forecastId).single(),
      supabase.from("forecast_entries").select("*").eq("forecast_id", forecastId).order("position"),
    ]);
    if (fe) toast.error(fe.message);
    if (ee) toast.error(ee.message);
    setForecast(f);
    setEntries(es ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [forecastId]);

  function updateEntry(id: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function saveEntry(entry: Entry) {
    setSavingId(entry.id);
    const { error } = await supabase
      .from("forecast_entries")
      .update({ title: entry.title, body: entry.body })
      .eq("id", entry.id);
    setSavingId(null);
    if (error) toast.error(error.message);
    else toast.success("Gespeichert");
  }

  async function regen(entry: Entry) {
    if (!session) return;
    setRegenId(entry.id);
    try {
      const { body } = await regenerateEntry({
        data: { entryId: entry.id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      updateEntry(entry.id, { body });
      toast.success("Text neu generiert");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRegenId(null);
    }
  }

  async function publish() {
    if (!session) return;
    if (!confirm("Prognose jetzt auf die Webseite veröffentlichen? Der bestehende Inhalt von /wetterbericht/ wird überschrieben.")) return;
    setPublishing(true);
    try {
      const result = await publishToWordPress({
        data: { forecastId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Auf Webseite veröffentlicht");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function regenerateAll() {
    if (!session) return;
    if (!confirm("Alle Texte dieser Prognose mit aktuellen Wetterdaten neu generieren? Bestehende Bearbeitungen gehen verloren.")) return;
    setRegenAll(true);
    try {
      await regenerateForecast({
        data: { forecastId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Prognose komplett neu generiert");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRegenAll(false);
    }
  }

  async function removeForecast() {
    if (!session) return;
    if (!confirm("Diese Prognose unwiderruflich löschen?")) return;
    setDeleting(true);
    try {
      await deleteForecast({
        data: { forecastId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Prognose gelöscht");
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  if (loading) return <div className="py-12 text-center text-muted-foreground">Lädt…</div>;
  if (!forecast) return <div className="py-12 text-center">Prognose nicht gefunden.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/dashboard"><ArrowLeft className="mr-1 h-4 w-4" /> Zurück</Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            Prognose {new Date(forecast.forecast_date).toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" })}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            {forecast.status === "published" ? (
              <Badge variant="default">Veröffentlicht</Badge>
            ) : (
              <Badge variant="secondary">Entwurf</Badge>
            )}
            {forecast.wp_post_url && (
              <a href={forecast.wp_post_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Live ansehen
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={regenerateAll} disabled={regenAll}>
            {regenAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Komplett neu generieren
          </Button>
          <Button variant="outline" onClick={removeForecast} disabled={deleting} className="text-destructive hover:text-destructive">
            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Löschen
          </Button>
          <Button onClick={publish} disabled={publishing}>
            {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Auf Webseite veröffentlichen
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {entries.map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={entry.title}
                  onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
                  className="text-base font-semibold"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={entry.body}
                onChange={(e) => updateEntry(entry.id, { body: e.target.value })}
                rows={6}
                className="resize-y"
              />
              <Collapsible
                open={!!openWeather[entry.id]}
                onOpenChange={(o) => setOpenWeather((p) => ({ ...p, [entry.id]: o }))}
              >
                <div className="flex flex-wrap justify-end gap-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">
                      <BarChart3 className="mr-1 h-3 w-3" />
                      Wetterdaten
                      <ChevronDown
                        className={`ml-1 h-3 w-3 transition-transform ${openWeather[entry.id] ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <Button variant="outline" size="sm" onClick={() => regen(entry)} disabled={regenId === entry.id}>
                    {regenId === entry.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    Text neu generieren
                  </Button>
                  <Button size="sm" onClick={() => saveEntry(entry)} disabled={savingId === entry.id}>
                    {savingId === entry.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                    Speichern
                  </Button>
                </div>
                <CollapsibleContent className="mt-3">
                  <div className="rounded-md border bg-muted/20 p-3">
                    <WeatherDataView data={entry.weather_data} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
