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
    models_midterm: "meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025",
    models_longterm: "ecmwf_ifs025,gfs_global",
    prompt_sky: "",
    prompt_temp: "",
    prompt_wind: "",
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
        models_midterm: (settings as any).models_midterm ?? "meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025",
        models_longterm: (settings as any).models_longterm ?? "ecmwf_ifs025,gfs_global",
        prompt_sky: (settings as any).prompt_sky ?? "",
        prompt_temp: (settings as any).prompt_temp ?? "",
        prompt_wind: (settings as any).prompt_wind ?? "",
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
            <Input value={form.models_midterm} onChange={(e) => setForm({ ...form, models_midterm: e.target.value })} placeholder="meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025" />
          </div>
          <div className="space-y-2">
            <Label>Langfrist-Modelle (Tag 6-10)</Label>
            <Input value={form.models_longterm} onChange={(e) => setForm({ ...form, models_longterm: e.target.value })} placeholder="ecmwf_ifs025,gfs_global" />
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
