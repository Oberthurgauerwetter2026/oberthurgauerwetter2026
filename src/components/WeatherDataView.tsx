import { Badge } from "@/components/ui/badge";

const MODEL_LABELS: Record<string, string> = {
  meteoswiss_icon_ch1: "ICON-CH1",
  meteoswiss_icon_ch2: "ICON-CH2",
  meteofrance_arome_france_hd: "AROME HD",
  meteofrance_arome_france: "AROME France",
  icon_eu: "ICON-EU",
  icon_d2: "ICON-D2",
  icon_global: "ICON-Global",
  ecmwf_ifs025: "ECMWF IFS",
  ecmwf_ifs04: "ECMWF IFS04",
  gfs_global: "GFS Global",
  gfs025: "GFS 0.25°",
  knmi_harmonie_arome_europe: "KNMI Harmonie",
  dmi_harmonie_arome_europe: "DMI Harmonie",
  ukmo_global_deterministic_10km: "UKMO Global",
  default: "Default",
};

const labelModel = (id: string) => MODEL_LABELS[id] ?? id;

const VAR_LABELS: Record<string, { label: string; unit: string; spreadHigh: number }> = {
  tmax: { label: "Tmax", unit: "°C", spreadHigh: 3 },
  tmin: { label: "Tmin", unit: "°C", spreadHigh: 3 },
  temperature: { label: "Temperatur", unit: "°C", spreadHigh: 3 },
  precip: { label: "Niederschlag", unit: "mm", spreadHigh: 2 },
  precip_total: { label: "Niederschlag", unit: "mm", spreadHigh: 2 },
  precipitation: { label: "Niederschlag", unit: "mm", spreadHigh: 2 },
  wind_max: { label: "Wind max", unit: "km/h", spreadHigh: 10 },
  wind: { label: "Wind", unit: "km/h", spreadHigh: 10 },
  windgusts: { label: "Böen", unit: "km/h", spreadHigh: 15 },
  cloudcover: { label: "Bewölkung", unit: "%", spreadHigh: 30 },
  cloudcover_avg: { label: "Bewölkung", unit: "%", spreadHigh: 30 },
  weathercode: { label: "Wettercode", unit: "", spreadHigh: 999 },
  sunshine: { label: "Sonnenschein", unit: "h", spreadHigh: 3 },
  snowfall: { label: "Schnee", unit: "cm", spreadHigh: 2 },
};

const fmt = (v: unknown, digits = 1): string => {
  if (v === null || v === undefined) return "–";
  if (typeof v !== "number" || !isFinite(v)) return "–";
  return v.toFixed(digits);
};

type Agg = {
  avg?: number; min?: number; max?: number; spread?: number;
  by_model?: Record<string, number | null>;
};

function isAgg(v: any): v is Agg {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  // by_model values must be scalar (number/null) — otherwise it's a nested section, not an aggregate
  if (v.by_model && typeof v.by_model === "object") {
    for (const k of Object.keys(v.by_model)) {
      const mv = v.by_model[k];
      if (mv !== null && typeof mv !== "number") return false;
    }
    return true;
  }
  return typeof v.avg === "number" || typeof v.min === "number" || typeof v.max === "number";
}

function collectModels(obj: Record<string, any>): string[] {
  const set = new Set<string>();
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isAgg(v) && v.by_model) {
      for (const m of Object.keys(v.by_model)) set.add(m);
    }
  }
  return Array.from(set);
}

// Detects "flat" format: scalar fields + central by_model { model: { field: value } } + optional spread
function flatToAggs(data: Record<string, any>): Record<string, Agg> | null {
  const by = data.by_model;
  if (!by || typeof by !== "object") return null;
  const modelKeys = Object.keys(by).filter((m) => by[m] && typeof by[m] === "object");
  if (modelKeys.length === 0) return null;
  // Make sure entries inside by_model are scalars-by-field, not single numbers
  const firstVal = by[modelKeys[0]];
  if (typeof firstVal !== "object" || Array.isArray(firstVal)) return null;

  const fields = new Set<string>();
  for (const m of modelKeys) for (const f of Object.keys(by[m])) fields.add(f);

  const spread = (data.spread && typeof data.spread === "object") ? data.spread : {};
  const out: Record<string, Agg> = {};
  for (const f of fields) {
    const perModel: Record<string, number | null> = {};
    const vals: number[] = [];
    for (const m of modelKeys) {
      const v = by[m]?.[f];
      perModel[m] = typeof v === "number" ? v : null;
      if (typeof v === "number" && isFinite(v)) vals.push(v);
    }
    const avg = typeof data[f] === "number"
      ? data[f]
      : (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined);
    const min = spread[`${f}_min`] ?? (vals.length ? Math.min(...vals) : undefined);
    const max = spread[`${f}_max`] ?? (vals.length ? Math.max(...vals) : undefined);
    const sp = spread[`${f}_spread`] ?? (typeof min === "number" && typeof max === "number" ? max - min : undefined);
    out[f] = { avg, min, max, spread: sp, by_model: perModel };
  }
  return out;
}

function DayTable({ data, title }: { data: Record<string, any>; title?: string }) {
  let working = data;
  let aggKeys = Object.keys(working).filter((k) => isAgg(working[k]));
  if (aggKeys.length === 0) {
    const flat = flatToAggs(data);
    if (flat) {
      working = flat;
      aggKeys = Object.keys(flat);
    }
  }
  if (aggKeys.length === 0) return null;
  const models = collectModels(working);
  const configured = typeof (data as any).models_configured === "string"
    ? (data as any).models_configured.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];
  const tierLabel = (data as any).tier === "short" ? "Kurzfrist" : (data as any).tier === "mid" ? "Mittelfrist" : (data as any).tier === "long" ? "Langfrist" : null;
  const fallbackUsed = configured.length > 0 && models.some((m) => m !== "default" && m !== "derived" && !configured.includes(m));

  return (
    <div className="space-y-2">
      {title && <div className="text-sm font-medium text-foreground">{title}</div>}
      {(models.length > 0 || tierLabel) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {tierLabel && <div>Tier: <span className="font-medium text-foreground">{tierLabel}</span></div>}
          {models.length > 0 && (
            <div>
              Modelle mit Daten: <span className="font-medium text-foreground">{models.map(labelModel).join(", ")}</span>
              {fallbackUsed && <Badge variant="secondary" className="ml-2 text-[10px]">Fallback aktiv</Badge>}
            </div>
          )}
          {configured.length > 0 && (
            <div>Konfiguriert für diesen Tag: {configured.map(labelModel).join(", ")}</div>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Variable</th>
              <th className="px-2 py-1.5 text-right font-medium">Ø</th>
              <th className="px-2 py-1.5 text-right font-medium">Min</th>
              <th className="px-2 py-1.5 text-right font-medium">Max</th>
              <th className="px-2 py-1.5 text-right font-medium">Spread</th>
              {models.map((m) => (
                <th key={m} className="px-2 py-1.5 text-right font-medium">{labelModel(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {aggKeys.map((key) => {
              const v = working[key] as Agg;
              const meta = VAR_LABELS[key] ?? { label: key, unit: "", spreadHigh: Infinity };
              const isInt = meta.unit === "%" || meta.unit === "km/h" || key === "weathercode";
              const digits = isInt ? 0 : 1;
              const highSpread = typeof v.spread === "number" && v.spread >= meta.spreadHigh;
              return (
                <tr key={key} className="border-t">
                  <td className="px-2 py-1.5">
                    {meta.label}{meta.unit && ` (${meta.unit})`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(v.avg, digits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(v.min, digits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(v.max, digits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {highSpread ? (
                      <Badge variant="destructive" className="font-mono">{fmt(v.spread, digits)}</Badge>
                    ) : (
                      fmt(v.spread, digits)
                    )}
                  </td>
                  {models.map((m) => (
                    <td key={m} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmt(v.by_model?.[m], digits)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {((data as any).wind_regime || (data as any).snow_line) && (
        <RegimeBadges wind_regime={(data as any).wind_regime} snow_line={(data as any).snow_line} />
      )}
      {(data as any).topography && <TopographyBlock topo={(data as any).topography} />}
      {(data as any).stations && <StationsBlock stations={(data as any).stations} />}
      {(data as any).precip_distribution && <PrecipDistributionBlock dist={(data as any).precip_distribution} />}
      {(data as any).mix_weights && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
          <span className="font-medium text-foreground">Tag-0-Mix:</span>{" "}
          <span className="tabular-nums">{(data as any).mix_weights.mosmix_pct}% MOSMIX · {(data as any).mix_weights.om_pct}% Open-Meteo</span>{" "}
          <span className="text-muted-foreground">+ Stations-Bias + Bias-Korrektur + Nowcast/Radar</span>
        </div>
      )}
      {(data as any).mosmix_reference && <MosmixReferenceBlock data={(data as any).mosmix_reference} isMixed={Boolean((data as any).mix_weights)} />}
    </div>
  );
}

function PrecipDistributionBlock({ dist }: { dist: any }) {
  const order = ["night", "morning", "afternoon", "evening"] as const;
  const peak = dist.peak_block;
  return (
    <div className="rounded-md border p-2 space-y-1">
      <div className="text-xs font-medium text-foreground">Niederschlags-Tagesgang (Open-Meteo stündlich)</div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        {order.map((k) => {
          const b = dist.blocks?.[k];
          if (!b) return <div key={k} className="text-muted-foreground">–</div>;
          const isPeak = peak === k;
          return (
            <div key={k} className={`rounded p-1.5 ${isPeak ? "bg-primary/15 border border-primary/40" : "bg-muted/30"}`}>
              <div className="font-medium">{b.label}</div>
              <div className="tabular-nums">{fmt(b.precip_mm, 1)} mm</div>
              <div className="text-muted-foreground tabular-nums">max {b.max_prob != null ? `${b.max_prob}%` : "–"}</div>
              <div className="text-muted-foreground">{b.wet_hours}h ≥0.2mm</div>
            </div>
          );
        })}
      </div>
      {peak && (
        <div className="text-xs text-muted-foreground">
          Spitze: <span className="font-medium text-foreground">{dist.blocks[peak].label}</span> ·
          {" "}{fmt(dist.peak_block_precip_mm, 1)} mm · max {dist.peak_block_prob ?? "–"}%
        </div>
      )}
    </div>
  );
}

function MosmixReferenceBlock({ data: ref }: { data: any }) {
  return (
    <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
      <div className="font-medium text-foreground mb-0.5">MOSMIX (Referenz, nicht verwendet)</div>
      <div className="tabular-nums">
        Tmin {fmt(ref.tmin, 1)}°C · Tmax {fmt(ref.tmax, 1)}°C · Niederschlag {fmt(ref.precip, 1)} mm · Wind max {fmt(ref.wind_max, 1)} km/h
        {ref.cloudcover_avg != null && <> · Bewölkung {ref.cloudcover_avg}%</>}
      </div>
      {Array.isArray(ref.stations) && ref.stations.length > 0 && (
        <div>Stationen: {ref.stations.join(", ")}</div>
      )}
    </div>
  );
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  strahlungsnacht: "Strahlungsnacht (klar, windschwach)",
  teilweise_klar: "Teilweise klar",
  bedeckt: "Bedeckt / windig",
};

const REGIME_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  foehn_strong: "destructive",
  foehn_weak: "secondary",
  bise_strong: "destructive",
  bise_weak: "secondary",
};

function RegimeBadges({ wind_regime, snow_line }: { wind_regime?: any; snow_line?: any }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {wind_regime && wind_regime.class && wind_regime.class !== "none" && (
        <Badge variant={REGIME_VARIANTS[wind_regime.class] ?? "outline"} title={`Δp Föhn: ${wind_regime.dp_foehn} hPa · Δp Bise: ${wind_regime.dp_bise} hPa`}>
          {wind_regime.label}
        </Badge>
      )}
      {snow_line && snow_line.class && snow_line.class !== "none" && (
        <Badge variant={snow_line.class === "low" ? "destructive" : "secondary"} title={`Nullgradgrenze ${snow_line.freezing_min}–${snow_line.freezing_max} m`}>
          ❄ {snow_line.label}
        </Badge>
      )}
    </div>
  );
}

function TopographyBlock({ topo }: { topo: any }) {
  if (!topo) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">Topographie-Korrektur (15 km um Amriswil)</div>
        <Badge variant="outline" className="text-[10px]">{CLASSIFICATION_LABELS[topo.classification] ?? topo.classification}</Badge>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Höhenbereich: <span className="text-foreground font-medium">{topo.elev_min} m – {topo.elev_max} m</span>
        {" "}(Median {topo.elev_median} m, Referenz Amriswil {topo.elev_ref} m, Lapse {topo.lapse_rate} °C/100 m)
      </div>
      <div className="overflow-x-auto rounded border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Lage</th>
              <th className="px-2 py-1.5 text-right font-medium">Tmin</th>
              <th className="px-2 py-1.5 text-right font-medium">Tmax</th>
              <th className="px-2 py-1.5 text-left font-medium">Beschreibung</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-2 py-1.5">Senken / Tiefste Lagen</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(topo.tmin_cold, 1)} °C</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">–</td>
              <td className="px-2 py-1.5 text-muted-foreground">{topo.tmin_cold_label}</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1.5">Amriswil (Referenz)</td>
              <td className="px-2 py-1.5 text-right tabular-nums">–</td>
              <td className="px-2 py-1.5 text-right tabular-nums">–</td>
              <td className="px-2 py-1.5 text-muted-foreground">Modellwert (Punkt)</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1.5">Höhenlagen / Sonnenhänge</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(topo.tmin_ridge, 1)} °C</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(topo.tmax_warm, 1)} °C</td>
              <td className="px-2 py-1.5 text-muted-foreground">{topo.tmax_warm_label}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StationsBlock({ stations }: { stations: any }) {
  if (!stations || !stations.stations) return null;
  const entries = Object.entries(stations.stations) as Array<[string, any]>;
  if (!entries.length) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">Stationen-Bias-Korrektur (MeteoSchweiz, data.tg.ch)</div>
        <Badge variant="outline" className="text-[10px]">7-Tage-Bias</Badge>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Korrigiertes Spektrum im Radius:{" "}
        <span className="text-foreground font-medium">
          {fmt(stations.radius_tmin_corrected, 1)} °C – {fmt(stations.radius_tmax_corrected, 1)} °C
        </span>
      </div>
      <div className="overflow-x-auto rounded border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Station</th>
              <th className="px-2 py-1.5 text-right font-medium">Vortag gemessen<br/>Tmin / Tmax</th>
              <th className="px-2 py-1.5 text-right font-medium">Bias<br/>Tmin / Tmax</th>
              <th className="px-2 py-1.5 text-right font-medium">Modell<br/>Tmin / Tmax</th>
              <th className="px-2 py-1.5 text-right font-medium">Korrigiert<br/>Tmin / Tmax</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([abbr, s]) => {
              const my = s.measured_yesterday;
              return (
                <tr key={abbr} className="border-t">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground">{abbr} · {s.role === "warm" ? "Bodenseeufer" : "Thurtal-Senke"} · n={s.samples}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {my ? `${fmt(my.tmin, 1)} / ${fmt(my.tmax, 1)}` : "–"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <span className={Math.abs(s.bias_tmin) >= 2 ? "text-destructive font-medium" : ""}>{fmt(s.bias_tmin, 1)}</span>
                    {" / "}
                    <span className={Math.abs(s.bias_tmax) >= 2 ? "text-destructive font-medium" : ""}>{fmt(s.bias_tmax, 1)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {fmt(s.model_tmin, 1)} / {fmt(s.model_tmax, 1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                    {fmt(s.corrected_tmin, 1)} / {fmt(s.corrected_tmax, 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Bias = Modell − Messung (positiv: Modell überschätzt). Korrigiert = Modellprognose − Bias. Bei n &lt; 3 oder Daten &gt; 3 Tage alt: Bias = 0 (kein Eingriff).
      </div>
    </div>
  );
}

export function WeatherDataView({ data }: { data: any }) {
  if (!data) {
    return <div className="text-xs text-muted-foreground">Keine Wetterdaten gespeichert.</div>;
  }

  // Trend array (Tag 6-10): array of day objects
  if (Array.isArray(data)) {
    return (
      <div className="space-y-4">
        {data.map((day: any, i: number) => {
          const dateStr = day?.date
            ? new Date(day.date).toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" })
            : `Tag ${i + 1}`;
          return <DayTable key={i} data={day} title={dateStr} />;
        })}
      </div>
    );
  }

  // Object — could be daily entry, evening/night, or wrapper with nested sections
  if (typeof data === "object") {
    // Wrapper containing { days: [...] }
    if (Array.isArray((data as any).days)) {
      return <WeatherDataView data={(data as any).days} />;
    }

    const directAggKeys = Object.keys(data).filter((k) => isAgg((data as any)[k]));
    // Day-0 flat format: scalar fields + central by_model { model: { field: value } }.
    // Render as a single DayTable so flatToAggs() inside DayTable converts it.
    if (directAggKeys.length === 0 && flatToAggs(data as any)) {
      return <DayTable data={data} />;
    }
    const nestedSectionKeys = Object.keys(data).filter(
      (k) => k !== "topography" && (data as any)[k] && typeof (data as any)[k] === "object" && !isAgg((data as any)[k]) && !Array.isArray((data as any)[k]),
    );

    // If top-level has no aggregates but has nested sections (e.g. { today, evening_night }), render each.
    if (directAggKeys.length === 0 && nestedSectionKeys.length > 0) {
      const SECTION_LABELS: Record<string, string> = {
        today: "Heute",
        evening_night: "Abend & Nacht",
        tomorrow: "Morgen",
        day: "Tag",
        night: "Nacht",
      };
      return (
        <div className="space-y-4">
          {nestedSectionKeys.map((k) => (
            <DayTable key={k} data={(data as any)[k]} title={SECTION_LABELS[k] ?? k} />
          ))}
        </div>
      );
    }

    return <DayTable data={data} />;
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
