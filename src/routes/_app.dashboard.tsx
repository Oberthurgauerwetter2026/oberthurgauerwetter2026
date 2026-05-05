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
  const [settings, setSettings] = useState<{ location_lat: number; location_lon: number; location_name: string | null; radius_km: number | null; bias_stations: string | null; mosmix_stations: string | null } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    supabase.from("app_settings").select("location_lat,location_lon,location_name,radius_km,bias_stations,mosmix_stations").maybeSingle().then(({ data }) => {
      if (data) setSettings(data as any);
    });
  }, []);

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

      {settings && (
        <Card>
          <Collapsible open={mapOpen} onOpenChange={setMapOpen}>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapIcon className="h-4 w-4" />
                  Region & Stationen
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    {settings.location_name ?? "Standort"} · Radius {settings.radius_km ?? 15} km
                  </span>
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <RegionMap
                  lat={settings.location_lat}
                  lon={settings.location_lon}
                  locationName={settings.location_name ?? "Standort"}
                  radiusKm={settings.radius_km ?? 15}
                  stations={[
                    { name: "Güttingen (GUT)", lat: 47.602, lon: 9.279, color: "#16a34a", role: "SMN-Bias" },
                    { name: "St. Gallen (STG)", lat: 47.426, lon: 9.398, color: "#16a34a", role: "SMN-Bias" },
                    { name: "Tänikon (TAE)", lat: 47.479, lon: 8.905, color: "#16a34a", role: "SMN-Bias" },
                    { name: "Bischofszell (BIZ)", lat: 47.498, lon: 9.236, color: "#0891b2", role: "Stations-Anker" },
                    { name: "Konstanz (10929)", lat: 47.677, lon: 9.190, color: "#7c3aed", role: "MOSMIX" },
                    { name: "Friedrichshafen (10935)", lat: 47.671, lon: 9.511, color: "#7c3aed", role: "MOSMIX" },
                  ]}
                />
                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-3">
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#dc2626] mr-1" />Standort</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#16a34a] mr-1" />SMN-Bias-Stationen</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#0891b2] mr-1" />Stations-Anker (warm/kalt)</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#7c3aed] mr-1" />DWD MOSMIX</span>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

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
