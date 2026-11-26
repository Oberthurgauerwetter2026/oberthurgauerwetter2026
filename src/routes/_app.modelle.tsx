import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelPanel, type PanelView } from "@/components/model-compare/ModelPanel";
import { TimelineBar } from "@/components/model-compare/TimelineBar";
import { ColorLegend } from "@/components/model-compare/ColorLegend";
import {
  MODEL_LABELS,
  VARIABLES,
  VARIABLE_BY_KEY,
  loadIndex,
  type GridIndex,
} from "@/lib/model-grid";

export const Route = createFileRoute("/_app/modelle")({
  head: () => ({
    meta: [
      { title: "Modellvergleich Schweiz – Wetterkarten im Zeitverlauf" },
      {
        name: "description",
        content:
          "Mehrere Wettermodelle als synchrone Karten-Panels vergleichen: Niederschlag, Bewölkung, Temperatur und Wind über der Schweiz im Stundenverlauf.",
      },
      { property: "og:title", content: "Modellvergleich Schweiz – Wetterkarten im Zeitverlauf" },
      {
        property: "og:description",
        content: "Synchroner Kartenvergleich von ICON-CH1/CH2, ICON-D2, AROME, ARPEGE und mehr.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModelComparePage,
});

const DEFAULT_MODELS = ["meteoswiss_icon_ch1", "meteoswiss_icon_ch2", "icon_d2", "meteofrance_arome_france"];
const LAYOUTS: Record<string, { cols: string; count: number; label: string }> = {
  "2": { cols: "sm:grid-cols-2", count: 2, label: "2 Panels" },
  "4": { cols: "sm:grid-cols-2", count: 4, label: "4 Panels" },
  "6": { cols: "sm:grid-cols-2 xl:grid-cols-3", count: 6, label: "6 Panels" },
};

function ModelComparePage() {
  const [index, setIndex] = useState<GridIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variableKey, setVariableKey] = useState("precipitation");
  const [layout, setLayout] = useState<"2" | "4" | "6">("4");
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<PanelView>({ lng: 8.23, lat: 46.85, zoom: 6.4 });
  const [viewOwner, setViewOwner] = useState<string | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    loadIndex().then((data) => {
      if (!data) {
        setError("Modellgitter noch nicht verfügbar. Der Ingest-Workflow muss einmal gelaufen sein.");
        return;
      }
      setIndex(data);
      const available = data.models.map((m) => m.model);
      setModels((prev) => {
        const kept = prev.filter((m) => available.includes(m));
        const rest = available.filter((m) => !kept.includes(m));
        return [...kept, ...rest].slice(0, 6);
      });
    });
  }, []);

  const nowIndex = useMemo(() => {
    if (!index?.times?.length) return 0;
    const now = Date.now();
    let best = 0;
    let bestDiff = Infinity;
    index.times.forEach((iso, i) => {
      const diff = Math.abs(new Date(`${iso}Z`).getTime() - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }, [index]);

  useEffect(() => {
    setT(nowIndex);
  }, [nowIndex]);

  const onView = useCallback((v: PanelView, from: string) => {
    setViewOwner(from);
    setView(v);
  }, []);

  const def = VARIABLE_BY_KEY[variableKey] ?? VARIABLES[0];
  const shown = models.slice(0, LAYOUTS[layout].count);
  const available = index?.models.map((m) => m.model) ?? [];

  const groups = useMemo(() => {
    const g: Record<string, typeof VARIABLES> = {};
    for (const v of VARIABLES) (g[v.group] ??= []).push(v);
    return g;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Modellvergleich Schweiz</h1>
          <p className="text-sm text-muted-foreground">
            Mehrere Modelle synchron auf der Karte vergleichen – gemeinsame Zeitachse, identische Farbskala.
          </p>
        </div>
        {index && (
          <Badge variant="outline">
            Daten aktualisiert:{" "}
            {new Date(index.generatedAt).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </Badge>
        )}
      </div>

      {error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Noch keine Modelldaten</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Starte die GitHub-Action „Model Grid Ingest (Schweiz)“ einmal manuell; danach läuft sie 4× täglich automatisch.
          </CardContent>
        </Card>
      )}

      {index && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <div className="min-w-[240px]">
                <Select value={variableKey} onValueChange={setVariableKey}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(groups).map(([group, vars]) => (
                      <SelectGroup key={group}>
                        <SelectLabel>{group}</SelectLabel>
                        {vars.map((v) => (
                          <SelectItem key={v.key} value={v.key}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-[140px]">
                <Select value={layout} onValueChange={(v) => setLayout(v as "2" | "4" | "6")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LAYOUTS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-1">
                {available.map((m) => {
                  const active = shown.includes(m);
                  return (
                    <Button
                      key={m}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() =>
                        setModels((prev) => {
                          if (prev.slice(0, LAYOUTS[layout].count).includes(m)) {
                            return prev.filter((x) => x !== m).concat(m);
                          }
                          const next = prev.filter((x) => x !== m);
                          next.splice(Math.min(LAYOUTS[layout].count - 1, next.length), 0, m);
                          return next;
                        })
                      }
                    >
                      {MODEL_LABELS[m] ?? m}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <TimelineBar
            times={index.times}
            index={t}
            playing={playing}
            onIndex={setT}
            onPlaying={setPlaying}
            nowIndex={nowIndex}
          />

          <ClientOnly fallback={<div className="h-[300px] rounded-lg border bg-muted/40" />}>
            <div className={`grid grid-cols-1 gap-3 ${LAYOUTS[layout].cols}`}>
              {shown.map((m) => (
                <ModelPanel
                  key={m}
                  model={m}
                  def={def}
                  index={index}
                  timeIndex={t}
                  view={view}
                  viewOwner={viewOwner}
                  hover={hover}
                  onView={onView}
                  onHover={setHover}
                />
              ))}
            </div>
          </ClientOnly>

          <Card>
            <CardContent className="pt-6">
              <ColorLegend def={def} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Quelle: Open-Meteo (MeteoSchweiz ICON-CH1/CH2, DWD ICON-D2/EU, Météo-France AROME/ARPEGE, ECMWF, NOAA GFS).
                Gitter {index.grid.nlat}×{index.grid.nlon} Punkte über der Schweiz. Modelle mit kürzerer Reichweite zeigen ab
                Laufende keine Fläche.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
