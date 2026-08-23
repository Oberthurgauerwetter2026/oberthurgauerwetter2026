/**
 * Client-seitige Helfer für den Modellvergleich (Karten-Panels).
 * Daten stammen aus R2 (`/api/public/model-grid/...`), befüllt von der
 * GitHub Action `model-grid-ingest.yml`.
 */

export type GridIndex = {
  version: string;
  generatedAt: string;
  times: string[];
  grid: {
    nlat: number;
    nlon: number;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    lats: number[];
    lons: number[];
  };
  models: Array<{ model: string; variables: string[] }>;
};

export type VariableGrid = {
  model: string;
  variable: string;
  scale: number;
  missing: number;
  nt: number;
  nlat: number;
  nlon: number;
  generatedAt: string;
  values: Int16Array; // layout: [t][lat][lon]
};

export const MODEL_LABELS: Record<string, string> = {
  meteoswiss_icon_ch1: "ICON-CH1",
  meteoswiss_icon_ch2: "ICON-CH2",
  icon_d2: "ICON-D2",
  meteofrance_arome_france_hd: "AROME HD",
  meteofrance_arome_france: "AROME France",
  meteofrance_arpege_europe: "ARPEGE Europe",
  icon_eu: "ICON-EU",
  ecmwf_ifs025: "ECMWF IFS",
  gfs_global: "GFS Global",
};

export const MODEL_RANGE_HOURS: Record<string, number> = {
  meteoswiss_icon_ch1: 33,
  meteoswiss_icon_ch2: 120,
  icon_d2: 48,
  meteofrance_arome_france_hd: 48,
  meteofrance_arome_france: 96,
  meteofrance_arpege_europe: 96,
  icon_eu: 120,
  ecmwf_ifs025: 240,
  gfs_global: 240,
};

export type ColorStop = { v: number; c: [number, number, number] };

export type VariableDef = {
  key: string;
  label: string;
  group: string;
  unit: string;
  /** Werte unterhalb werden transparent gezeichnet. */
  transparentBelow?: number;
  stops: ColorStop[];
  /** Windpfeile zusätzlich zeichnen. */
  arrows?: boolean;
  /** Tagesaggregation aus stündlichen Werten. */
  aggregate?: "min24" | "max24" | "sum24";
  sourceVariable?: string;
};

const rgb = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

const PRECIP_STOPS: ColorStop[] = [
  { v: 0.1, c: rgb(198, 233, 255) },
  { v: 0.5, c: rgb(140, 208, 255) },
  { v: 1, c: rgb(78, 168, 245) },
  { v: 2, c: rgb(40, 120, 220) },
  { v: 5, c: rgb(30, 180, 110) },
  { v: 10, c: rgb(230, 200, 60) },
  { v: 20, c: rgb(240, 130, 40) },
  { v: 40, c: rgb(210, 40, 40) },
  { v: 80, c: rgb(150, 30, 120) },
];

const TEMP_STOPS: ColorStop[] = [
  { v: -25, c: rgb(80, 20, 120) },
  { v: -15, c: rgb(50, 60, 180) },
  { v: -8, c: rgb(60, 130, 220) },
  { v: -2, c: rgb(140, 200, 240) },
  { v: 0, c: rgb(210, 235, 250) },
  { v: 5, c: rgb(180, 230, 180) },
  { v: 10, c: rgb(120, 205, 110) },
  { v: 15, c: rgb(240, 230, 120) },
  { v: 20, c: rgb(245, 185, 70) },
  { v: 25, c: rgb(235, 110, 50) },
  { v: 30, c: rgb(210, 45, 45) },
  { v: 36, c: rgb(140, 20, 60) },
];

const CLOUD_STOPS: ColorStop[] = [
  { v: 5, c: rgb(255, 255, 255) },
  { v: 25, c: rgb(225, 231, 238) },
  { v: 50, c: rgb(190, 200, 212) },
  { v: 75, c: rgb(150, 162, 178) },
  { v: 100, c: rgb(105, 118, 136) },
];

const PROB_STOPS: ColorStop[] = [
  { v: 10, c: rgb(226, 240, 226) },
  { v: 25, c: rgb(180, 224, 190) },
  { v: 40, c: rgb(120, 200, 170) },
  { v: 60, c: rgb(70, 160, 210) },
  { v: 80, c: rgb(50, 100, 200) },
  { v: 100, c: rgb(90, 50, 170) },
];

const WIND_STOPS: ColorStop[] = [
  { v: 5, c: rgb(232, 244, 236) },
  { v: 15, c: rgb(180, 225, 200) },
  { v: 25, c: rgb(120, 200, 160) },
  { v: 40, c: rgb(240, 220, 100) },
  { v: 60, c: rgb(240, 150, 60) },
  { v: 80, c: rgb(225, 70, 60) },
  { v: 120, c: rgb(150, 30, 110) },
];

const SNOW_STOPS: ColorStop[] = [
  { v: 0.2, c: rgb(230, 240, 255) },
  { v: 1, c: rgb(180, 210, 250) },
  { v: 3, c: rgb(120, 160, 240) },
  { v: 7, c: rgb(80, 90, 210) },
  { v: 15, c: rgb(120, 50, 170) },
  { v: 30, c: rgb(180, 40, 120) },
];

const PTYPE_STOPS: ColorStop[] = [
  { v: 0.15, c: rgb(120, 200, 250) }, // Schneeanteil gering -> Regen
  { v: 0.45, c: rgb(90, 170, 120) },
  { v: 0.7, c: rgb(210, 190, 90) }, // Mischung
  { v: 1, c: rgb(150, 90, 200) }, // Schnee
];

export const VARIABLES: VariableDef[] = [
  {
    key: "precipitation",
    label: "Niederschlag (1 h)",
    group: "Niederschlag",
    unit: "mm",
    transparentBelow: 0.1,
    stops: PRECIP_STOPS,
  },
  {
    key: "precipitation_sum24",
    label: "Niederschlagsmenge (24 h)",
    group: "Niederschlag",
    unit: "mm",
    transparentBelow: 0.2,
    stops: PRECIP_STOPS,
    aggregate: "sum24",
    sourceVariable: "precipitation",
  },
  {
    key: "precipitation_probability",
    label: "Niederschlagswahrscheinlichkeit",
    group: "Niederschlag",
    unit: "%",
    transparentBelow: 5,
    stops: PROB_STOPS,
  },
  {
    key: "snowfall",
    label: "Schneefall (1 h)",
    group: "Niederschlag",
    unit: "cm",
    transparentBelow: 0.1,
    stops: SNOW_STOPS,
  },
  {
    key: "precipitation_type",
    label: "Niederschlagsart (Schneeanteil)",
    group: "Niederschlag",
    unit: "",
    transparentBelow: 0.01,
    stops: PTYPE_STOPS,
  },
  { key: "cloudcover", label: "Bewölkung gesamt", group: "Bewölkung", unit: "%", transparentBelow: 3, stops: CLOUD_STOPS },
  { key: "cloudcover_low", label: "Bewölkung tief", group: "Bewölkung", unit: "%", transparentBelow: 3, stops: CLOUD_STOPS },
  { key: "cloudcover_mid", label: "Bewölkung mittel", group: "Bewölkung", unit: "%", transparentBelow: 3, stops: CLOUD_STOPS },
  { key: "cloudcover_high", label: "Bewölkung hoch", group: "Bewölkung", unit: "%", transparentBelow: 3, stops: CLOUD_STOPS },
  { key: "temperature_2m", label: "Temperatur 2 m", group: "Temperatur", unit: "°C", stops: TEMP_STOPS },
  {
    key: "temperature_2m_min24",
    label: "Tagesminimum 2 m",
    group: "Temperatur",
    unit: "°C",
    stops: TEMP_STOPS,
    aggregate: "min24",
    sourceVariable: "temperature_2m",
  },
  {
    key: "temperature_2m_max24",
    label: "Tagesmaximum 2 m",
    group: "Temperatur",
    unit: "°C",
    stops: TEMP_STOPS,
    aggregate: "max24",
    sourceVariable: "temperature_2m",
  },
  { key: "wind_speed_10m", label: "Wind Mittel 10 m", group: "Wind", unit: "km/h", transparentBelow: 1, stops: WIND_STOPS, arrows: true },
  { key: "wind_gusts_10m", label: "Windböen", group: "Wind", unit: "km/h", transparentBelow: 1, stops: WIND_STOPS, arrows: true },
  { key: "wind_direction_10m", label: "Windrichtung", group: "Wind", unit: "°", stops: WIND_STOPS, arrows: true },
];

export const VARIABLE_BY_KEY: Record<string, VariableDef> = Object.fromEntries(
  VARIABLES.map((v) => [v.key, v]),
);

export function colorFor(def: VariableDef, value: number): [number, number, number, number] {
  if (def.transparentBelow !== undefined && value < def.transparentBelow) return [0, 0, 0, 0];
  const stops = def.stops;
  if (value <= stops[0].v) return [...stops[0].c, 235] as [number, number, number, number];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (value <= b.v) {
      const t = (value - a.v) / (b.v - a.v || 1);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
        235,
      ];
    }
  }
  return [...stops[stops.length - 1].c, 235] as [number, number, number, number];
}

function b64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

const gridCache = new Map<string, Promise<VariableGrid | null>>();
let indexCache: Promise<GridIndex | null> | null = null;

export function loadIndex(force = false): Promise<GridIndex | null> {
  if (force) indexCache = null;
  if (!indexCache) {
    indexCache = fetch("/api/public/model-grid/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<GridIndex>) : null))
      .catch(() => null);
  }
  return indexCache;
}

export function loadGrid(model: string, variable: string): Promise<VariableGrid | null> {
  const key = `${model}/${variable}`;
  let p = gridCache.get(key);
  if (!p) {
    p = fetch(`/api/public/model-grid/${key}.json`)
      .then(async (r) => {
        if (!r.ok) return null;
        const raw = await r.json();
        return {
          model: raw.model,
          variable: raw.variable,
          scale: raw.scale,
          missing: raw.missing,
          nt: raw.nt,
          nlat: raw.nlat,
          nlon: raw.nlon,
          generatedAt: raw.generatedAt,
          values: b64ToInt16(raw.data),
        } satisfies VariableGrid;
      })
      .catch(() => null);
    gridCache.set(key, p);
  }
  return p;
}

/** Physikalischer Wert an Zeit-/Gitterindex, `null` wenn fehlend. */
export function gridValue(g: VariableGrid, t: number, iLat: number, iLon: number): number | null {
  if (t < 0 || t >= g.nt) return null;
  const raw = g.values[t * g.nlat * g.nlon + iLat * g.nlon + iLon];
  if (raw === undefined || raw === g.missing) return null;
  return raw / g.scale;
}

/** Baut das darzustellende Feld für einen Zeitschritt (inkl. Aggregate). */
export function buildField(
  def: VariableDef,
  primary: VariableGrid,
  t: number,
  extra?: { snowfall?: VariableGrid | null; precipitation?: VariableGrid | null },
): Array<number | null> {
  const n = primary.nlat * primary.nlon;
  const out: Array<number | null> = new Array(n).fill(null);

  if (def.key === "precipitation_type") {
    const snow = extra?.snowfall;
    const prec = extra?.precipitation;
    if (!snow || !prec) return out;
    for (let i = 0; i < n; i++) {
      const iLat = Math.floor(i / primary.nlon);
      const iLon = i % primary.nlon;
      const p = gridValue(prec, t, iLat, iLon);
      const s = gridValue(snow, t, iLat, iLon);
      if (p === null || p < 0.1) continue;
      // Schneefall wird in cm geliefert -> ca. 1 cm Schnee ≈ 0.7 mm Wasser
      const snowWater = (s ?? 0) * 0.7;
      out[i] = Math.max(0, Math.min(1, snowWater / p));
    }
    return out;
  }

  if (def.aggregate) {
    const dayStart = Math.floor(t / 24) * 24;
    for (let i = 0; i < n; i++) {
      const iLat = Math.floor(i / primary.nlon);
      const iLon = i % primary.nlon;
      let acc: number | null = null;
      for (let k = dayStart; k < Math.min(dayStart + 24, primary.nt); k++) {
        const v = gridValue(primary, k, iLat, iLon);
        if (v === null) continue;
        if (acc === null) acc = v;
        else if (def.aggregate === "min24") acc = Math.min(acc, v);
        else if (def.aggregate === "max24") acc = Math.max(acc, v);
        else acc += v;
      }
      out[i] = acc;
    }
    return out;
  }

  for (let i = 0; i < n; i++) {
    out[i] = gridValue(primary, t, Math.floor(i / primary.nlon), i % primary.nlon);
  }
  return out;
}

export function formatHour(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
