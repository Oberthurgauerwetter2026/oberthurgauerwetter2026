import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

const COOLDOWN_SECONDS = 60;

function translateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes") || m.includes("only request this after")) {
    return "Bitte warte kurz, bevor du erneut einen Reset-Link anforderst (Sicherheits-Limit ca. 1× pro Minute).";
  }
  if (m.includes("invalid email")) return "Diese E-Mail-Adresse ist ungültig.";
  return message;
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(translateError(error.message));
      return;
    }
    setSent(true);
    setCooldown(COOLDOWN_SECONDS);
    toast.success("E-Mail gesendet");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Passwort vergessen</CardTitle>
          <CardDescription>Wir senden dir einen Link zum Zurücksetzen.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Falls ein Konto mit dieser E-Mail existiert, hast du eine Nachricht erhalten.
                Schau auch im <strong>Spam-/Junk-Ordner</strong> nach. Die Zustellung kann
                bis zu 30 Minuten dauern.
              </p>
              <p className="text-sm text-muted-foreground">
                Wichtig: Den Link in der E-Mail nur <strong>einmal</strong> anklicken –
                Mehrfachklicks machen ihn ungültig.
              </p>
              <Button
                variant="outline"
                className="w-full"
                disabled={cooldown > 0 || submitting}
                onClick={(e) => handleSubmit(e as any)}
              >
                {cooldown > 0 ? `Erneut senden in ${cooldown}s` : "Erneut senden"}
              </Button>
              <div className="text-center text-sm">
                <Link to="/login" className="text-primary hover:underline">Zurück zum Login</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || cooldown > 0}>
                {submitting ? "Senden…" : cooldown > 0 ? `Bitte warten… (${cooldown}s)` : "Reset-Link senden"}
              </Button>
              <div className="text-center text-sm">
                <Link to="/login" className="text-primary hover:underline">Zurück zum Login</Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
