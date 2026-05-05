import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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

function translateAuthError(message: string): string {
  const m = (message || "").toLowerCase();
  if (
    m.includes("auth session missing") ||
    m.includes("invalid") ||
    m.includes("expired") ||
    m.includes("otp_expired") ||
    m.includes("access_denied")
  ) {
    return "Der Reset-Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen Link an.";
  }
  if (m.includes("same") && m.includes("password")) {
    return "Das neue Passwort darf nicht mit dem alten identisch sein.";
  }
  if (m.includes("weak") || m.includes("at least") || m.includes("characters")) {
    return "Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen wählen.";
  }
  return message || "Unbekannter Fehler.";
}

function cleanUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  window.history.replaceState({}, "", url.toString());
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>("checking");
  const handledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Listener für PASSWORD_RECOVERY/SIGNED_IN — Supabase setzt die Session
    // beim Laden der Seite mit dem Recovery-Hash automatisch.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      console.info("[reset-password] auth event:", event, !!session);
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        setStatus("ready");
      }
    });

    async function init() {
      if (handledRef.current) return;
      handledRef.current = true;

      try {
        if (typeof window !== "undefined") {
          const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
          const hashParams = new URLSearchParams(hash);
          const queryParams = new URLSearchParams(window.location.search);

          console.info("[reset-password] params:", {
            hasCode: !!queryParams.get("code"),
            hasAccessToken: !!hashParams.get("access_token"),
            hasTokenHash: !!(queryParams.get("token_hash") || hashParams.get("token_hash")),
            type: queryParams.get("type") || hashParams.get("type"),
            error: hashParams.get("error_code") || queryParams.get("error_code"),
          });

          // Fehler aus URL erkennen
          const errCode = hashParams.get("error_code") || queryParams.get("error_code");
          const errDesc = hashParams.get("error_description") || queryParams.get("error_description");
          if (errCode || errDesc) {
            if (!cancelled) {
              setStatus("no_session");
              toast.error(translateAuthError(errDesc || errCode || ""));
            }
            cleanUrl();
            return;
          }

          // 1) PKCE-Flow: ?code=...
          const code = queryParams.get("code");
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              if (!cancelled) {
                setStatus("no_session");
                toast.error(translateAuthError(error.message));
              }
              cleanUrl();
              return;
            }
            if (!cancelled) setStatus("ready");
            cleanUrl();
            return;
          }

          // 2) Token-Hash-Flow: ?token_hash=...&type=recovery
          const tokenHash = queryParams.get("token_hash") || hashParams.get("token_hash");
          const type = (queryParams.get("type") || hashParams.get("type")) as
            | "recovery" | "signup" | "magiclink" | "email" | null;
          if (tokenHash && type) {
            const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
            if (error) {
              if (!cancelled) {
                setStatus("no_session");
                toast.error(translateAuthError(error.message));
              }
              cleanUrl();
              return;
            }
            if (!cancelled) setStatus("ready");
            cleanUrl();
            return;
          }

          // 3) Implicit-Flow: #access_token=...&refresh_token=...
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) {
              if (!cancelled) {
                setStatus("no_session");
                toast.error(translateAuthError(error.message));
              }
              cleanUrl();
              return;
            }
            if (!cancelled) setStatus("ready");
            cleanUrl();
            return;
          }
        }

        // 4) Kein Token in URL: schon eine Session vorhanden?
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          if (!cancelled) setStatus("ready");
          return;
        }

        // 5) Aktiv warten (max. 4s) bis Supabase die Session aus dem URL-Hash
        //    automatisch wiederhergestellt hat.
        const start = Date.now();
        while (!cancelled && Date.now() - start < 4000) {
          await new Promise((r) => setTimeout(r, 250));
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            if (!cancelled) setStatus("ready");
            return;
          }
        }
        if (!cancelled) setStatus("no_session");
      } catch (e) {
        console.error("[reset-password] init error:", e);
        if (!cancelled) setStatus("no_session");
      }
    }

    init();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
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
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSubmitting(false);
      setStatus("no_session");
      toast.error("Der Reset-Link ist abgelaufen. Bitte fordere einen neuen Link an.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      toast.error(translateAuthError(error.message));
      if (error.message.toLowerCase().includes("auth session missing")) {
        setStatus("no_session");
      }
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
              ? "Wähle ein neues, sicheres Passwort (mind. 8 Zeichen)."
              : status === "checking"
              ? "Recovery-Link wird geprüft…"
              : "Kein gültiger Recovery-Link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "no_session" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen
                Reset-Link an. Wichtig: Immer nur die <strong>neueste</strong> Mail öffnen und den
                Link nur <strong>einmal</strong> anklicken (nicht in mehreren Tabs öffnen, keine
                Vorschau-/Virenscanner-Klicks).
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
