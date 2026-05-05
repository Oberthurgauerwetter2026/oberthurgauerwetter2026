import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "no_session";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let recovered = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        recovered = true;
        setStatus("ready");
      }
    });

    // Fallback: prüfe nach kurzer Zeit, ob bereits eine Session existiert
    // (Supabase konsumiert den Hash-Token automatisch beim Mount)
    const t = setTimeout(async () => {
      if (recovered) return;
      const { data } = await supabase.auth.getSession();
      setStatus(data.session ? "ready" : "no_session");
    }, 800);

    return () => {
      subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== "ready") return;
    if (password.length < 8) {
      toast.error("Passwort muss mindestens 8 Zeichen haben");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwörter stimmen nicht überein");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    toast.success("Passwort aktualisiert – bitte neu anmelden");
    await supabase.auth.signOut();
    setSubmitting(false);
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Neues Passwort setzen</CardTitle>
          <CardDescription>
            {status === "ready"
              ? "Wähle ein neues, sicheres Passwort."
              : status === "checking"
              ? "Recovery-Link wird geprüft…"
              : "Kein gültiger Recovery-Link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "no_session" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen Reset-Link an.
                Wichtig: Den Link in der E-Mail nur <strong>einmal</strong> anklicken.
              </p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Neuen Link anfordern</Link>
              </Button>
              <div className="text-center text-sm">
                <Link to="/login" className="text-primary hover:underline">Zurück zum Login</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Neues Passwort</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={status !== "ready"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Passwort bestätigen</Label>
                <Input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={status !== "ready"} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || status !== "ready"}>
                {submitting ? "Speichern…" : status === "checking" ? "Bitte warten…" : "Passwort speichern"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
