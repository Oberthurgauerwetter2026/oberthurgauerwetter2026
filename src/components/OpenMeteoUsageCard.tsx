import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { getOpenMeteoUsage, clearOpenMeteoRateLimits } from "@/lib/admin-stats.functions";
import { useAuth } from "@/hooks/use-auth";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  forecast: "Forecast",
  pressure_map: "Druckkarte",
  radar: "Radar",
  snow_line: "Schneefallgrenze",
  pressure_gradient: "Druckgradient",
  nowcast: "Nowcast",
  elevation: "Höhe",
  historical_bias: "Bias-Historie",
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

export function OpenMeteoUsageCard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [clearing, setClearing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["openmeteo-usage"],
    queryFn: () =>
      getOpenMeteoUsage({
        headers: { Authorization: `Bearer ${session!.access_token}` },
      } as any),
    refetchInterval: 30_000,
    enabled: !!session,
  });

  async function handleClearRateLimit() {
    if (!session) return;
    setClearing(true);
    try {
      const res: any = await clearOpenMeteoRateLimits({
        headers: { Authorization: `Bearer ${session.access_token}` },
      } as any);
      toast.success(`${res.cleared} Marker gelöscht`);
      await qc.invalidateQueries({ queryKey: ["openmeteo-usage"] });
    } catch (e: any) {
      toast.error(e.message ?? "Fehler beim Zurücksetzen");
    } finally {
      setClearing(false);
    }
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open-Meteo Tagesnutzung</CardTitle>
          <CardDescription>Lädt …</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pct = Math.min(100, Math.round((data.total / data.limit) * 100));
  let statusBadge: { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2 };
  if (data.isRateLimited) {
    statusBadge = { label: "Pausiert bis 00:00 UTC", variant: "destructive", icon: AlertTriangle };
  } else if (pct >= 90) {
    statusBadge = { label: "Limit fast erreicht", variant: "destructive", icon: AlertTriangle };
  } else if (pct >= 70) {
    statusBadge = { label: "Erhöhte Auslastung", variant: "secondary", icon: Clock };
  } else {
    statusBadge = { label: "OK", variant: "default", icon: CheckCircle2 };
  }
  const StatusIcon = statusBadge.icon;
  const sourceEntries = Object.entries(data.bySource).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Open-Meteo Tagesnutzung</CardTitle>
            <CardDescription>UTC-Tag {data.day} · Reset um 00:00 UTC</CardDescription>
          </div>
          <Badge variant={statusBadge.variant} className="gap-1">
            <StatusIcon className="h-3 w-3" />
            {statusBadge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium">
              {data.total.toLocaleString("de-CH")} / {data.limit.toLocaleString("de-CH")} Calls
            </span>
            <span className="text-muted-foreground">{pct} %</span>
          </div>
          <Progress value={pct} />
        </div>

        {sourceEntries.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">Aufschlüsselung nach Quelle</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {sourceEntries.map(([src, count]) => (
                <div key={src} className="flex justify-between">
                  <span className="text-muted-foreground">{SOURCE_LABELS[src] ?? src}</span>
                  <span className="tabular-nums">{count.toLocaleString("de-CH")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.last429At && (
          <div className="text-xs text-destructive">
            Letzter 429-Fehler: {formatTime(data.last429At)} ({SOURCE_LABELS[data.last429Source ?? ""] ?? data.last429Source})
          </div>
        )}

        {(data.isRateLimited || (data.activeMarkerCount ?? 0) > 0) && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {data.activeMarkerCount ?? 0} aktive Rate-Limit-Marker
            </span>
            <Button size="sm" variant="outline" onClick={handleClearRateLimit} disabled={clearing}>
              {clearing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-2 h-3 w-3" />}
              Rate-Limit zurücksetzen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
