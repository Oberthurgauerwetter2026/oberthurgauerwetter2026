// DWD MOSMIX_L (Model Output Statistics) - statistisch korrigierte Punkt-Prognose
// auf Basis von ICON & ECMWF/IFS. Aktualisiert alle 6 h (03/09/15/21 UTC).
// Wir nutzen die Werte für Tag 0 und Tag 1, um eine eigene Datenassimilation
// (Stations-Bias-Korrektur) im Kurzfristbereich überflüssig zu machen.
//
// Endpoint: opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/<id>/kml/
// KMZ = ZIP mit einer KML-Datei. Wir entpacken mit fflate (Worker-tauglich).
import { unzipSync, strFromU8 } from "fflate";
import { getOrSetCache } from "./weather-cache.server";

// Bekannte Stationen rund um Amriswil (mit Koordinaten + Höhe)
const KNOWN_STATIONS: Record<string, { name: string; lat: number; lon: number; elev: number }> = {
  "10935": { name: "Friedrichshafen", lat: 47.667, lon: 9.483, elev: 394 },
  "10929": { name: "Konstanz", lat: 47.677, lon: 9.190, elev: 443 },
  "06660": { name: "Sigmaringen", lat: 48.087, lon: 9.232, elev: 580 },
};

// Kelvin → Celsius
const k2c = (k: number) => k - 273.15;
// m/s → km/h
const ms2kmh = (v: number) => v * 3.6;

function circularMeanDeg(degs: number[]): number | null {
  const valid = degs.filter((v) => v != null && Number.isFinite(v));
  if (!valid.length) return null;
  let sx = 0, sy = 0;
  for (const d of valid) {
    const r = (d * Math.PI) / 180;
    sx += Math.cos(r); sy += Math.sin(r);
  }
  let deg = (Math.atan2(sy / valid.length, sx / valid.length) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round(deg);
}

// Datum (yyyy-mm-dd) eines ISO-Timestamps in Europe/Zurich
function zurichDate(iso: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date(iso));
}

export type MosmixHourly = {
  times: string[]; // ISO timestamps (UTC)
  TTT: (number | null)[]; // K
  Td: (number | null)[];  // K
  FF: (number | null)[];  // m/s
  FX1: (number | null)[]; // m/s
  DD: (number | null)[];  // °
  Neff: (number | null)[]; // %
  RR1c: (number | null)[]; // mm
  SunD1: (number | null)[]; // s
};

export type MosmixStationData = {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  elev: number;
  issueTime: string;
  hourly: MosmixHourly;
};

const ELEMENTS = ["TTT", "Td", "FF", "FX1", "DD", "Neff", "RR1c", "SunD1"] as const;
type Elem = typeof ELEMENTS[number];

function parseValueList(raw: string): (number | null)[] {
  return raw.trim().split(/\s+/).map((s) => {
    if (s === "-" || s === "---") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  });
}

function parseMosmixKml(kml: string): { issueTime: string; times: string[]; values: Record<Elem, (number | null)[]>; coords: [number, number, number] | null; description: string | null } {
  const issueMatch = kml.match(/<dwd:IssueTime>([^<]+)<\/dwd:IssueTime>/);
  const issueTime = issueMatch?.[1] ?? "";

  // Time steps
  const times: string[] = [];
  const tsRegex = /<dwd:TimeStep>([^<]+)<\/dwd:TimeStep>/g;
  let m: RegExpExecArray | null;
  while ((m = tsRegex.exec(kml)) !== null) times.push(m[1]);

  // Values per element
  const values: Record<Elem, (number | null)[]> = {} as any;
  for (const el of ELEMENTS) {
    const re = new RegExp(`<dwd:Forecast\\s+dwd:elementName="${el}">\\s*<dwd:value>([^<]+)<\\/dwd:value>`, "s");
    const mv = kml.match(re);
    values[el] = mv ? parseValueList(mv[1]) : [];
  }

  // Coords + description (station name)
  const coordMatch = kml.match(/<kml:coordinates>([^<]+)<\/kml:coordinates>/);
  let coords: [number, number, number] | null = null;
  if (coordMatch) {
    const parts = coordMatch[1].trim().split(",").map((s) => Number(s));
    if (parts.length >= 2 && parts.every(Number.isFinite)) coords = [parts[0], parts[1], parts[2] ?? 0];
  }
  const descMatch = kml.match(/<kml:description>([^<]+)<\/kml:description>/);
  const description = descMatch?.[1]?.trim() ?? null;

  return { issueTime, times, values, coords, description };
}

async function fetchMosmixStation(stationId: string): Promise<MosmixStationData | null> {
  const url = `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/${stationId}/kml/MOSMIX_L_LATEST_${stationId}.kmz`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn(`MOSMIX fetch failed for ${stationId}:`, e);
    return null;
  }
  if (!res.ok) {
    console.warn(`MOSMIX ${stationId}: HTTP ${res.status}`);
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  let kml: string;
  try {
    const files = unzipSync(buf);
    const kmlEntry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith(".kml"));
    if (!kmlEntry) {
      console.warn(`MOSMIX ${stationId}: kein KML in KMZ gefunden`);
      return null;
    }
    kml = strFromU8(kmlEntry[1]);
  } catch (e) {
    console.warn(`MOSMIX ${stationId}: Entpacken fehlgeschlagen`, e);
    return null;
  }
  const parsed = parseMosmixKml(kml);
  if (!parsed.times.length || !parsed.values.TTT.length) {
    console.warn(`MOSMIX ${stationId}: keine Werte`);
    return null;
  }

  const known = KNOWN_STATIONS[stationId];
  return {
    stationId,
    name: known?.name ?? parsed.description ?? stationId,
    lat: known?.lat ?? parsed.coords?.[1] ?? 0,
    lon: known?.lon ?? parsed.coords?.[0] ?? 0,
    elev: known?.elev ?? parsed.coords?.[2] ?? 0,
    issueTime: parsed.issueTime,
    hourly: {
      times: parsed.times,
      TTT: parsed.values.TTT,
      Td: parsed.values.Td,
      FF: parsed.values.FF,
      FX1: parsed.values.FX1,
      DD: parsed.values.DD,
      Neff: parsed.values.Neff,
      RR1c: parsed.values.RR1c,
      SunD1: parsed.values.SunD1,
    },
  };
}

// Aggregiert MOSMIX-Stundenwerte zu Tagesblöcken im gleichen Schema wie unsere
// bestehenden weather_data-Tagesobjekte (tmin/tmax/precip/wind_max/...).
// Multi-Station-Aggregation: pro Stunde wird der Durchschnitt über die gewählten
// Stationen gebildet (MOSMIX ist bereits stations-spezifisch korrigiert).
function aggregateDailyFromStations(
  stations: MosmixStationData[],
  dayDates: string[],
): Map<string, any> {
  const result = new Map<string, any>();
  if (!stations.length) return result;

  // Index: pro Datum sammeln wir Stundenwerte über alle Stationen
  for (const date of dayDates) {
    const tempsAll: number[] = [];
    const windsMax: number[] = [];
    const windsAvg: number[] = [];
    const dirs: number[] = [];
    const clouds: number[] = [];
    const precs: number[] = [];
    const sunsSec: number[] = [];

    let sampleCount = 0;
    const stationNames: string[] = [];
    const perStation: Record<string, { tmin: number; tmax: number; precip_total: number; wind_max: number | null; cloudcover_avg: number | null; sunshine_h: number | null }> = {};

    for (const st of stations) {
      const idxs: number[] = [];
      st.hourly.times.forEach((t, i) => {
        if (zurichDate(t) === date) idxs.push(i);
      });
      if (!idxs.length) continue;
      stationNames.push(st.name);
      sampleCount += idxs.length;

      const stTemps: number[] = [];
      const stPrecs: number[] = [];
      const stWinds: number[] = [];
      const stClouds: number[] = [];
      const stSuns: number[] = [];

      for (const i of idxs) {
        const ttt = st.hourly.TTT[i];
        if (ttt != null) { tempsAll.push(k2c(ttt)); stTemps.push(k2c(ttt)); }
        const ff = st.hourly.FF[i];
        if (ff != null) { windsAvg.push(ms2kmh(ff)); stWinds.push(ms2kmh(ff)); }
        const fx = st.hourly.FX1[i];
        if (fx != null) windsMax.push(ms2kmh(fx));
        const dd = st.hourly.DD[i];
        if (dd != null) dirs.push(dd);
        const ne = st.hourly.Neff[i];
        if (ne != null) { clouds.push(ne); stClouds.push(ne); }
        const rr = st.hourly.RR1c[i];
        if (rr != null) { precs.push(rr); stPrecs.push(rr); }
        const sd = st.hourly.SunD1[i];
        if (sd != null) { sunsSec.push(sd); stSuns.push(sd); }
      }

      if (stTemps.length) {
        perStation[st.name] = {
          tmin: Math.round(Math.min(...stTemps) * 10) / 10,
          tmax: Math.round(Math.max(...stTemps) * 10) / 10,
          precip_total: Math.round(stPrecs.reduce((a, b) => a + b, 0) * 10) / 10,
          wind_max: stWinds.length ? Math.round(Math.max(...stWinds) * 10) / 10 : null,
          cloudcover_avg: stClouds.length ? Math.round(stClouds.reduce((a, b) => a + b, 0) / stClouds.length) : null,
          sunshine_h: stSuns.length ? Math.round((stSuns.reduce((a, b) => a + b, 0) / 3600) * 10) / 10 : null,
        };
      }
    }

    if (!tempsAll.length) continue;

    const r1 = (n: number) => Math.round(n * 10) / 10;
    const tminVal = r1(Math.min(...tempsAll));
    const tmaxVal = r1(Math.max(...tempsAll));
    const windMaxVal = windsMax.length ? r1(Math.max(...windsMax)) : (windsAvg.length ? r1(Math.max(...windsAvg)) : null);
    const dirAvg = circularMeanDeg(dirs);
    const cloudAvg = clouds.length ? Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length) : null;
    const precSum = precs.length ? r1(precs.reduce((a, b) => a + b, 0)) : 0;
    const sunshineHours = sunsSec.length ? r1(sunsSec.reduce((a, b) => a + b, 0) / 3600 / Math.max(1, stations.length)) : null;

    // Schema kompatibel zu formatDayData() (avg/min/max/spread/by_model)
    const mkAgg = (val: number | null) => val == null ? null : { avg: val, min: val, max: val, spread: 0, by_model: { mosmix: val } };

    result.set(date, {
      date,
      source: "mosmix",
      mosmix_stations: stationNames,
      mosmix_samples: sampleCount,
      models_configured: `dwd_mosmix_l(${stationNames.join("+")})`,
      models_used: "dwd_mosmix_l",
      tier: "short",
      tmax: mkAgg(tmaxVal),
      tmin: mkAgg(tminVal),
      precip: mkAgg(precSum),
      precip_prob: null,
      wind_max: mkAgg(windMaxVal),
      wind_dir: dirAvg != null ? { avg: dirAvg, min: dirAvg, max: dirAvg, spread: 0, by_model: { mosmix: dirAvg } } : null,
      wind_dir_avg: dirAvg,
      wind_dir_compass: null, // wird in forecast.functions.ts via compassToName + buildWindLabel ergänzt
      wind_label: null,
      sky_label: null,
      cloudcover: mkAgg(cloudAvg),
      cloudcover_source: cloudAvg != null ? "model" : "none",
      weathercode: null,
      sunshine_h: mkAgg(sunshineHours),
      mosmix_per_station: perStation,
    });
  }
  return result;
}

// Hauptfunktion: Liefert MOSMIX-basierte Tagesdaten für Tag 0 bis Tag 7
// als Map<dateString, dayData>. Gibt leere Map zurück wenn MOSMIX deaktiviert
// oder keine Station Daten liefert (Fallback auf Open-Meteo greift dann).
export async function fetchMosmixShortTerm(
  stationIds: string[],
): Promise<Map<string, any>> {
  if (!stationIds.length) return new Map();
  const cacheKey = `mosmix:short:${stationIds.slice().sort().join(",")}`;
  // TTL 2h: MOSMIX_L kommt alle 6h, dazwischen unverändert
  const ttlMs = 2 * 60 * 60 * 1000;

  const stations = await getOrSetCache(cacheKey, async () => {
    const results: MosmixStationData[] = [];
    for (const id of stationIds) {
      const data = await fetchMosmixStation(id);
      if (data) results.push(data);
    }
    return results;
  }, ttlMs);

  if (!stations || !stations.length) return new Map();

  // Tag 0 .. Tag 7 in Europe/Zurich bestimmen
  const dates: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(zurichDate(d.toISOString()));
  }

  return aggregateDailyFromStations(stations, dates);
}
