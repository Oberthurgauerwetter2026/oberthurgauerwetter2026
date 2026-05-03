import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, roles } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Mindestens 8 Zeichen"); return; }
    if (password !== confirm) { toast.error("Passwörter stimmen nicht überein"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Passwort geändert"); setPassword(""); setConfirm(""); }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Mein Profil</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Konto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">E-Mail:</span> {user?.email}</div>
          <div><span className="text-muted-foreground">Rollen:</span> {roles.join(", ") || "keine"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passwort ändern</CardTitle>
          <CardDescription>Mindestens 8 Zeichen.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-3">
            <div className="space-y-2">
              <Label>Neues Passwort</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label>Bestätigen</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            <Button type="submit" disabled={saving}>{saving ? "Speichern…" : "Passwort speichern"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
