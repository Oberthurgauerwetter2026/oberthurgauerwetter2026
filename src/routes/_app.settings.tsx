import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { updateSettings, listUsers, inviteUser, setUserRole, deleteUser, getPromptDefaults } from "@/server/forecast.functions";
import { toast } from "sonner";
import { Loader2, Trash2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

interface AppUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: string[];
}

function SettingsPage() {
  const { session, isAdmin, user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    location_name: "Amriswil",
    location_lat: 47.5469,
    location_lon: 9.2986,
    radius_km: 15,
    wp_target_slug: "wetterbericht",
    wp_target_page_id: null as number | null,
    ai_prompt_template: "",
    models_shortterm: "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2",
    models_midterm: "meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global",
    models_longterm: "ecmwf_ifs025,gfs_global",
    prompt_sky: "",
    prompt_temp: "",
    prompt_wind: "",
    mosmix_enabled: true,
    mosmix_stations: "10935,10929",
    radar_enabled: true,
    radar_radius_km: 15,
    radar_correction_strength: 70,
    bias_enabled: true,
    bias_stations: "BIZ,GUT",
    bias_lookback_days: 7,
    bias_strength: 70,
    tag0_weight_mosmix: 0,
    tag0_weight_om: 100,
    tag1_weight_mosmix: 0,
    tag1_weight_om: 100,
    tag2_weight_mosmix: 25,
    tag2_weight_om: 75,
    tag3plus_weight_mosmix: 45,
    tag3plus_weight_om: 55,
  });
  const [defaults, setDefaults] = useState<{ general: string; sky: string; temp: string; wind: string } | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", display_name: "", role: "editor" as "admin" | "editor" });
  const [inviting, setInviting] = useState(false);
  const [tempPwd, setTempPwd] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: settings } = await supabase.from("app_settings").select("*").limit(1).maybeSingle();
    if (settings) {
      setForm({
        location_name: settings.location_name ?? "Amriswil",
        location_lat: settings.location_lat ?? 47.5469,
        location_lon: settings.location_lon ?? 9.2986,
        radius_km: settings.radius_km ?? 15,
        wp_target_slug: settings.wp_target_slug ?? "wetterbericht",
        wp_target_page_id: settings.wp_target_page_id,
        ai_prompt_template: settings.ai_prompt_template ?? "",
        models_shortterm: (settings as any).models_shortterm ?? "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2",
        models_midterm: (settings as any).models_midterm ?? "meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global",
        models_longterm: (settings as any).models_longterm ?? "ecmwf_ifs025,gfs_global",
        prompt_sky: (settings as any).prompt_sky ?? "",
        prompt_temp: (settings as any).prompt_temp ?? "",
        prompt_wind: (settings as any).prompt_wind ?? "",
        mosmix_enabled: (settings as any).mosmix_enabled ?? true,
        mosmix_stations: (settings as any).mosmix_stations ?? "10935,10929",
        radar_enabled: (settings as any).radar_enabled ?? true,
        radar_radius_km: (settings as any).radar_radius_km ?? 15,
        radar_correction_strength: (settings as any).radar_correction_strength ?? 70,
        bias_enabled: (settings as any).bias_enabled ?? true,
        bias_stations: (settings as any).bias_stations ?? "BIZ,GUT",
        bias_lookback_days: (settings as any).bias_lookback_days ?? 7,
        bias_strength: (settings as any).bias_strength ?? 70,
        tag0_weight_mosmix: (settings as any).tag0_weight_mosmix ?? 40,
        tag0_weight_om: (settings as any).tag0_weight_om ?? 60,
        tag1_weight_mosmix: (settings as any).tag1_weight_mosmix ?? 50,
        tag1_weight_om: (settings as any).tag1_weight_om ?? 50,
      });
    }
    if (session && !defaults) {
      try {
        const d = await getPromptDefaults({ headers: { Authorization: `Bearer ${session.access_token}` } } as any);
        setDefaults(d);
      } catch { /* ignore - user may lack staff role */ }
    }
    if (session && isAdmin) {
      try {
        const u = await listUsers({ headers: { Authorization: `Bearer ${session.access_token}` } } as any);
        setUsers(u);
      } catch (e: any) {
        toast.error(e.message);
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [session, isAdmin]);

  if (!isAdmin) {
    return <div className="py-12 text-center text-muted-foreground">Nur Administratoren haben Zugriff.</div>;
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    try {
      await updateSettings({
        data: form,
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Einstellungen gespeichert");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite() {
    if (!session) return;
    setInviting(true);
    try {
      const res = await inviteUser({
        data: inviteForm,
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      setTempPwd(res.tempPassword);
      toast.success("Benutzer angelegt");
      setInviteForm({ email: "", display_name: "", role: "editor" });
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setInviting(false);
    }
  }

  async function toggleRole(u: AppUser, role: "admin" | "editor", enabled: boolean) {
    if (!session) return;
    try {
      await setUserRole({
        data: { user_id: u.user_id, role, enabled },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function removeUser(u: AppUser) {
    if (!session) return;
    if (!confirm(`Benutzer ${u.email} wirklich löschen?`)) return;
    try {
      await deleteUser({
        data: { user_id: u.user_id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success("Benutzer gelöscht");
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <div className="py-12 text-center text-muted-foreground">Lädt…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standort & Prognose</CardTitle>
          <CardDescription>Region für die Wetterdaten</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Ortsname</Label>
            <Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Breitengrad</Label>
            <Input type="number" step="0.0001" value={form.location_lat} onChange={(e) => setForm({ ...form, location_lat: parseFloat(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Längengrad</Label>
            <Input type="number" step="0.0001" value={form.location_lon} onChange={(e) => setForm({ ...form, location_lon: parseFloat(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Radius (km)</Label>
            <Input type="number" value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: parseInt(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">WordPress-Veröffentlichung</CardTitle>
          <CardDescription>Ziel-Seite, die bei jedem Sync überschrieben wird. Zugangsdaten sind sicher gespeichert.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Slug der Zielseite</Label>
            <Input value={form.wp_target_slug} onChange={(e) => setForm({ ...form, wp_target_slug: e.target.value })} />
            <p className="text-xs text-muted-foreground">z. B. „wetterbericht" für /wetterbericht/</p>
          </div>
          <div className="space-y-2">
            <Label>Page-ID (optional)</Label>
            <Input
              type="number"
              value={form.wp_target_page_id ?? ""}
              onChange={(e) => setForm({ ...form, wp_target_page_id: e.target.value ? parseInt(e.target.value) : null })}
              placeholder="leer = via Slug suchen"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wettermodelle (Open-Meteo)</CardTitle>
          <CardDescription>
            Komma-getrennte Liste. Kurzfrist (heute & morgen): MeteoSchweiz ICON-CH1/CH2.
            Mittelfrist (Tag 3-5): ICON-EU + ECMWF. Langfrist (Tag 6-10): ECMWF + GFS.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label>Kurzfrist-Modelle (Tag 1-2)</Label>
            <Input value={form.models_shortterm} onChange={(e) => setForm({ ...form, models_shortterm: e.target.value })} placeholder="meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2" />
          </div>
          <div className="space-y-2">
            <Label>Mittelfrist-Modelle (Tag 3-5)</Label>
            <Input value={form.models_midterm} onChange={(e) => setForm({ ...form, models_midterm: e.target.value })} placeholder="meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global" />
          </div>
          <div className="space-y-2">
            <Label>Langfrist-Modelle (Tag 6-10)</Label>
            <Input value={form.models_longterm} onChange={(e) => setForm({ ...form, models_longterm: e.target.value })} placeholder="ecmwf_ifs025,gfs_global" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ICON-MOS (DWD MOSMIX)</CardTitle>
          <CardDescription>
            Statistisch korrigierte Punktvorhersagen vom Deutschen Wetterdienst.
            Standard-Stationen: 10935 (Friedrichshafen), 10929 (Konstanz).
            MOSMIX wird ab Tag 2 als statistische Stützung beigemischt; Tag 0 & 1 laufen
            rein über Open-Meteo + Radar + SMN-Bias (Mini-SuperHD).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>MOSMIX-Beimischung aktivieren</Label>
              <p className="text-xs text-muted-foreground">Ab Tag 2 fliesst DWD MOSMIX in die Tageswerte ein.</p>
            </div>
            <Switch
              checked={form.mosmix_enabled}
              onCheckedChange={(v) => setForm({ ...form, mosmix_enabled: v })}
            />
          </div>
          <div className="space-y-2">
            <Label>MOSMIX-Stationen (DWD-IDs, komma-getrennt)</Label>
            <Input
              value={form.mosmix_stations}
              onChange={(e) => setForm({ ...form, mosmix_stations: e.target.value })}
              placeholder="10935,10929"
            />
          </div>
          <div className="space-y-2 pt-2 border-t">
            <Label>Tag 2 (24–48 h) — Gewicht MOSMIX ({form.tag2_weight_mosmix} %)</Label>
            <input
              type="range" min={0} max={100}
              value={form.tag2_weight_mosmix}
              onChange={(e) => setForm({ ...form, tag2_weight_mosmix: parseInt(e.target.value || "0", 10) })}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Tag 2 — Gewicht Open-Meteo Modelle ({form.tag2_weight_om} %)</Label>
            <input
              type="range" min={0} max={100}
              value={form.tag2_weight_om}
              onChange={(e) => setForm({ ...form, tag2_weight_om: parseInt(e.target.value || "0", 10) })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Default 25 / 75. Moderate MOSMIX-Stützung für den Mittelfristbereich.
              Aktuell:{" "}{Math.round((form.tag2_weight_mosmix / Math.max(1, form.tag2_weight_mosmix + form.tag2_weight_om)) * 100)} % MOSMIX
              {" "}/ {Math.round((form.tag2_weight_om / Math.max(1, form.tag2_weight_mosmix + form.tag2_weight_om)) * 100)} % Open-Meteo.
            </p>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <Label>Tag 3+ (&gt;48 h) — Gewicht MOSMIX ({form.tag3plus_weight_mosmix} %)</Label>
            <input
              type="range" min={0} max={100}
              value={form.tag3plus_weight_mosmix}
              onChange={(e) => setForm({ ...form, tag3plus_weight_mosmix: parseInt(e.target.value || "0", 10) })}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Tag 3+ — Gewicht Open-Meteo Modelle ({form.tag3plus_weight_om} %)</Label>
            <input
              type="range" min={0} max={100}
              value={form.tag3plus_weight_om}
              onChange={(e) => setForm({ ...form, tag3plus_weight_om: parseInt(e.target.value || "0", 10) })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Default 45 / 55. Deutlichere MOSMIX-Stützung ab Tag 3, wo MOS seine statistische
              Stationskorrektur gegen die Globalmodelle (ECMWF/GFS) ausspielt. Aktuell:
              {" "}{Math.round((form.tag3plus_weight_mosmix / Math.max(1, form.tag3plus_weight_mosmix + form.tag3plus_weight_om)) * 100)} % MOSMIX
              {" "}/ {Math.round((form.tag3plus_weight_om / Math.max(1, form.tag3plus_weight_mosmix + form.tag3plus_weight_om)) * 100)} % Open-Meteo.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Radar-Abgleich (MeteoSchweiz / Open-Meteo)</CardTitle>
          <CardDescription>
            Vergleicht die aktuell beobachteten Niederschläge (Radar-assimiliertes ICON-CH1, gleiche
            Datenquelle wie openrad.ch) mit den modellierten Werten und korrigiert die Tagessumme
            für <strong>Tag 0</strong>, falls die Realität deutlich vom Modell abweicht.
            Cache: 5 Minuten. Kein Eingriff in Tag 1+.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Radar-Korrektur aktivieren</Label>
              <p className="text-xs text-muted-foreground">
                Beobachtete Niederschläge der letzten 3 h überschreiben modellierte Werte für heute,
                wenn der Unterschied signifikant ist.
              </p>
            </div>
            <Switch
              checked={form.radar_enabled}
              onCheckedChange={(v) => setForm({ ...form, radar_enabled: v })}
            />
          </div>
          <div className="space-y-2">
            <Label>Auswertungs-Radius (km)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={form.radar_radius_km}
              onChange={(e) => setForm({ ...form, radar_radius_km: parseInt(e.target.value || "15", 10) })}
            />
            <p className="text-xs text-muted-foreground">
              Aktuell wird ein Punkt-Sample am Standort verwendet; der Radius ist als Vorbereitung für
              eine flächige Auswertung hinterlegt.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Stärke der Radar-Korrektur ({form.radar_correction_strength}%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.radar_correction_strength}
              onChange={(e) => setForm({ ...form, radar_correction_strength: parseInt(e.target.value || "70", 10) })}
            />
            <p className="text-xs text-muted-foreground">
              0% = nur Anzeige der Beobachtung, kein Eingriff. 100% = volle Anpassung der Tagessumme
              an das Verhältnis Radar/Modell. Standard: 70%.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bias-Korrektur (SwissMetNet)</CardTitle>
          <CardDescription>
            Vergleicht reale Messungen Schweizer MeteoSchweiz-Stationen der letzten Tage mit
            den Modell-Vorhersagen für denselben Zeitraum und berechnet einen mittleren Bias
            (Temperatur additiv, Wind/Niederschlag multiplikativ). Wird auf Tag 2+ angewandt;
            für Tag 0/1 bleibt MOSMIX die Primärquelle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Bias-Korrektur aktivieren</Label>
              <p className="text-xs text-muted-foreground">Eigene „SuperHD-light"-Korrektur per Stationsabgleich.</p>
            </div>
            <Switch
              checked={form.bias_enabled}
              onCheckedChange={(v) => setForm({ ...form, bias_enabled: v })}
            />
          </div>
          <div className="space-y-2">
            <Label>SMN-Stationen (Kürzel, komma-getrennt)</Label>
            <Input
              value={form.bias_stations}
              onChange={(e) => setForm({ ...form, bias_stations: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Verfügbar u.a.: BIZ (Bischofszell), GUT (Güttingen), STG (St. Gallen),
              TAE (Aadorf/Tänikon), SMA (Zürich-Fluntern), KLO (Kloten).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Vergleichszeitraum ({form.bias_lookback_days} Tage)</Label>
            <Input
              type="number"
              min={2}
              max={14}
              value={form.bias_lookback_days}
              onChange={(e) => setForm({ ...form, bias_lookback_days: parseInt(e.target.value || "7", 10) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Stärke der Korrektur ({form.bias_strength}%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.bias_strength}
              onChange={(e) => setForm({ ...form, bias_strength: parseInt(e.target.value || "70", 10) })}
            />
            <p className="text-xs text-muted-foreground">
              0% = keine Korrektur. 100% = voller berechneter Bias. Standard: 70%.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allgemeiner Stil & Tonalität</CardTitle>
          <CardDescription>
            Grundregeln für Sprache, Satzbau und Vokabular. Leer lassen für die Standard-Vorlage.
            Spezifische Regeln zu Bewölkung, Temperatur und Wind unten separat anpassen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={8}
            value={form.ai_prompt_template}
            onChange={(e) => setForm({ ...form, ai_prompt_template: e.target.value })}
            placeholder="z. B.: Du bist ein erfahrener Schweizer Meteorologe..."
          />
          {defaults && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, ai_prompt_template: defaults.general })}
            >
              Standard einfügen
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt-Bausteine</CardTitle>
          <CardDescription>
            Drei spezialisierte Regelblöcke, die zusammen mit dem allgemeinen Stil an die KI übergeben werden.
            Leer lassen = der hinterlegte Standard wird verwendet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Besonnung / Bewölkung / Niederschlag</Label>
            <p className="text-xs text-muted-foreground">
              Wie aus sunshine_h, weathercode, cloudcover und sky_label die Himmelsbeschreibung formuliert wird,
              und wann zurückhaltende Formulierungen bei hoher Modell-Unsicherheit nötig sind.
            </p>
            <Textarea
              rows={6}
              value={form.prompt_sky}
              onChange={(e) => setForm({ ...form, prompt_sky: e.target.value })}
              placeholder="Leer = Standard-Regeln werden verwendet."
            />
            {defaults && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, prompt_sky: defaults.sky })}
              >
                Standard einfügen
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Temperatur</Label>
            <p className="text-xs text-muted-foreground">
              Formate für Tiefst- und Höchstwerte, Bodenfrost-Hinweis, zulässige Formulierungen.
            </p>
            <Textarea
              rows={6}
              value={form.prompt_temp}
              onChange={(e) => setForm({ ...form, prompt_temp: e.target.value })}
              placeholder="Leer = Standard-Regeln werden verwendet."
            />
            {defaults && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, prompt_temp: defaults.temp })}
              >
                Standard einfügen
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Wind</Label>
            <p className="text-xs text-muted-foreground">
              wind_label wörtlich übernehmen, keine Gradzahlen, Böen-Hinweis bei Schauer / Gewitter.
            </p>
            <Textarea
              rows={6}
              value={form.prompt_wind}
              onChange={(e) => setForm({ ...form, prompt_wind: e.target.value })}
              placeholder="Leer = Standard-Regeln werden verwendet."
            />
            {defaults && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, prompt_wind: defaults.wind })}
              >
                Standard einfügen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Einstellungen speichern
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Benutzer</CardTitle>
              <CardDescription>Verwalte Redakteure und Admins</CardDescription>
            </div>
            <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) setTempPwd(null); }}>
              <DialogTrigger asChild>
                <Button size="sm"><UserPlus className="mr-1 h-4 w-4" /> Neuer Benutzer</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Benutzer hinzufügen</DialogTitle>
                  <DialogDescription>Der Benutzer erhält ein temporäres Passwort, das er beim ersten Login ändern kann.</DialogDescription>
                </DialogHeader>
                {tempPwd ? (
                  <div className="space-y-3">
                    <p className="text-sm">Benutzer angelegt. Temporäres Passwort (jetzt kopieren, wird nicht erneut angezeigt):</p>
                    <code className="block rounded bg-muted p-2 text-xs break-all">{tempPwd}</code>
                    <Button onClick={() => { setTempPwd(null); setInviteOpen(false); }}>OK</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input value={inviteForm.display_name} onChange={(e) => setInviteForm({ ...inviteForm, display_name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>E-Mail</Label>
                      <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Rolle</Label>
                      <select
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={inviteForm.role}
                        onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as "admin" | "editor" })}
                      >
                        <option value="editor">Redakteur</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleInvite} disabled={inviting || !inviteForm.email || !inviteForm.display_name}>
                        {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Anlegen
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {users.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{u.display_name || u.email}</span>
                    {u.user_id === currentUser?.id && <Badge variant="outline" className="text-xs">du</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={u.roles.includes("editor")} onCheckedChange={(c) => toggleRole(u, "editor", c)} />
                    Redakteur
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={u.roles.includes("admin")} onCheckedChange={(c) => toggleRole(u, "admin", c)} />
                    Admin
                  </label>
                  <Button variant="ghost" size="icon" onClick={() => removeUser(u)} disabled={u.user_id === currentUser?.id}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
