import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOrSetCache } from "./weather-cache.server";
import { fetchMosmixShortTerm } from "./mosmix.server";
import { fetchRadarSnapshot, buildRadarCorrection, type RadarSnapshot } from "./radar.server";
import { computeBiasCorrection, applyBiasToDay, type BiasResult } from "./bias-correction.server";

// Wendet die Radar-Korrektur an Tag 0 an. Mutiert `out` (precip.avg) und hängt
// einen `radar_correction`-Block sowie den aktuellen Nowcast an.
function applyRadarToDay(out: any, dayIndex: number, radar: RadarSnapshot | null, settings: any) {
  if (dayIndex !== 0 || !radar) return;
  const enabled = settings?.radar_enabled !== false;
  if (!enabled) return;
  const strength = typeof settings?.radar_correction_strength === "number" ? settings.radar_correction_strength : 70;
  const correction = buildRadarCorrection(out, radar, strength);
  if (!correction) return;
  out.radar_now = {
    observed_last_3h_mm: radar.observed.last_3h_mm,
    nowcast_next_2h_mm: radar.forecast_next_2h.next_2h_mm,
    fetched_at: radar.fetched_at,
    source: radar.source,
  };
  out.radar_correction = correction;
  if (correction.applied && correction.after_precip_mm != null) {
    if (!out.precip) out.precip = { avg: correction.after_precip_mm, min: correction.after_precip_mm, max: correction.after_precip_mm, spread: 0, by_model: {} };
    else {
      out.precip = { ...out.precip, avg: correction.after_precip_mm };
    }
    // precip_prob nur erhöhen, nie senken
    if (correction.ratio > 1 && out.precip_prob?.avg != null) {
      const boosted = Math.min(100, Math.round(out.precip_prob.avg * Math.min(1.5, correction.ratio)));
      if (boosted > out.precip_prob.avg) {
        out.precip_prob = { ...out.precip_prob, avg: boosted };
      }
    }
  }
}

// ===== Helpers =====
async function ensureStaff(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("admin") && !roles.includes("editor")) {
    throw new Error("Forbidden: staff role required");
  }
  return { isAdmin: roles.includes("admin"), roles };
}

async function ensureAdmin(supabase: any, userId: string) {
  const { isAdmin } = await ensureStaff(supabase, userId);
  if (!isAdmin) throw new Error("Forbidden: admin required");
}

async function getSettings(supabase: any) {
  const { data, error } = await supabase.from("app_settings").select("*").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ===== Weather data (Open-Meteo, multi-model) =====
const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "windspeed_10m_max",
  "winddirection_10m_dominant",
  "sunshine_duration",
  "weathercode",
  "cloudcover_mean",
];
const HOURLY_VARS = ["temperature_2m", "precipitation", "cloudcover", "windspeed_10m", "winddirection_10m", "weathercode", "sunshine_duration"];

// ===== Wind helpers =====
// Circular mean over compass degrees (0-360). Returns null for empty input.
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

// Maps a degree (0-360) to a Swiss German wind name (8-Punkt-Kompass).
// In der Region Oberthurgau ist NO-Wind klassisch "Bise" (engeres Fenster ~ 30-70°).
// Bereiche orientieren sich am Standard-Kompass mit ±22.5° pro Sektor.
function compassToName(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  // Bise = klassischer NO-Wind über dem Bodensee (ca. 30-70°)
  if (d >= 30 && d < 70) return "Bise";
  if (d >= 70 && d < 112.5) return "Ostwind";          // E
  if (d >= 112.5 && d < 157.5) return "Südostwind";    // SE  -> 142° gehört hier rein
  if (d >= 157.5 && d < 202.5) return "Südwind";       // S
  if (d >= 202.5 && d < 247.5) return "Südwestwind";   // SW
  if (d >= 247.5 && d < 292.5) return "Westwind";      // W
  if (d >= 292.5 && d < 337.5) return "Nordwestwind";  // NW
  return "Nordwind";                                    // N (337.5-30°)
}

// Build a ready-to-use German wind phrase from direction (deg) + max speed (km/h).
// The AI must use this verbatim to ensure consistency.
function buildWindLabel(dirDeg: number | null, maxKmh: number | null): string | null {
  if (dirDeg == null && (maxKmh == null || maxKmh < 5)) return "Windstill bis sehr schwacher Wind";
  if (dirDeg == null) return null;
  const name = compassToName(dirDeg);
  const v = maxKmh ?? 0;
  let strength: string;
  if (v < 8) strength = "Schwacher";
  else if (v < 15) strength = "Schwacher bis mässiger";
  else if (v < 25) strength = "Mässiger";
  else if (v < 40) strength = "Mässiger bis kräftiger";
  else strength = "Kräftiger";
  // "Bise" is feminine in Swiss German -> "Schwache Bise" not "Schwacher Bise"
  if (name === "Bise") {
    const fem = strength.replace(/r$/, "");
    return `${fem} Bise`;
  }
  return `${strength} ${name}`;
}

function isClearSkyDay(data: any): boolean {
  const cloudAvg = data?.cloudcover?.avg;
  const sunshineAvg = data?.sunshine_h?.avg;
  return typeof cloudAvg === "number" && typeof sunshineAvg === "number" && cloudAvg <= 5 && sunshineAvg >= 10;
}

function enforceSkyConsistency(text: string, weatherData: any): string {
  if (!isClearSkyDay(weatherData)) return text;
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return "Sonnig und wolkenlos.";
  paragraphs[0] = "Sonnig und wolkenlos.";
  return paragraphs.join("\n\n");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ===== Topography (elevation grid around Amriswil) =====
// We sample a grid in a square around the location to derive realistic
// min/max temperatures for sinks (Senken) and ridges (Höhenrücken).
// Source: Open-Meteo Elevation API (Copernicus DEM, 90m). Cached in app_settings.
async function fetchElevationGrid(lat: number, lon: number, radiusKm: number): Promise<{ min: number; max: number; median: number } | null> {
  // ~10x10 grid covering a square of side 2*radiusKm
  const N = 10;
  const dLat = radiusKm / 111; // 1 deg lat ~ 111 km
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const fx = (i / (N - 1)) * 2 - 1; // -1..1
      const fy = (j / (N - 1)) * 2 - 1;
      // Constrain to a circle of radius radiusKm
      if (fx * fx + fy * fy > 1) continue;
      lats.push(+(lat + fy * dLat).toFixed(5));
      lons.push(+(lon + fx * dLon).toFixed(5));
    }
  }
  if (!lats.length) return null;
  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`Elevation API ${res.status}`);
      return null;
    }
    const data = await res.json();
    const elevs: number[] = (data?.elevation ?? []).filter((v: any) => Number.isFinite(v));
    if (!elevs.length) return null;
    const sorted = [...elevs].sort((a, b) => a - b);
    return {
      min: Math.round(sorted[0]),
      max: Math.round(sorted[sorted.length - 1]),
      median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    };
  } catch (e) {
    console.warn("Elevation fetch failed", e);
    return null;
  }
}

// Returns cached topography from settings, or fetches & persists if missing.
async function ensureTopography(supabase: any, settings: any): Promise<{ elev_min: number; elev_max: number; elev_median: number; elev_ref: number } | null> {
  const lat = settings?.location_lat ?? 47.5469;
  const lon = settings?.location_lon ?? 9.2986;
  const radius = settings?.radius_km ?? 15;
  const elev_ref = 434; // Amriswil approx
  if (settings?.topo_elev_min != null && settings?.topo_elev_max != null && settings?.topo_elev_median != null) {
    return {
      elev_min: settings.topo_elev_min,
      elev_max: settings.topo_elev_max,
      elev_median: settings.topo_elev_median,
      elev_ref,
    };
  }
  const grid = await fetchElevationGrid(lat, lon, radius);
  if (!grid) return null;
  if (settings?.id) {
    await supabase.from("app_settings").update({
      topo_elev_min: grid.min,
      topo_elev_max: grid.max,
      topo_elev_median: grid.median,
    }).eq("id", settings.id);
  }
  return { elev_min: grid.min, elev_max: grid.max, elev_median: grid.median, elev_ref };
}

// Apply topographic correction to a day's tmin/tmax.
// Returns a topography object that augments the day's weather_data.
function applyTopography(
  day: { tmin?: { avg: number } | null; tmax?: { avg: number } | null; cloudcover?: { avg?: number } | null; wind_max?: { avg?: number } | null } | null,
  topo: { elev_min: number; elev_max: number; elev_median: number; elev_ref: number } | null
) {
  if (!topo || !day) return null;
  const tminRef = day.tmin?.avg;
  const tmaxRef = day.tmax?.avg;
  const cloud = day.cloudcover?.avg ?? null;
  const wind = day.wind_max?.avg ?? null;

  // Classify night for radiative cooling potential
  let classification: "strahlungsnacht" | "teilweise_klar" | "bedeckt" = "bedeckt";
  if (cloud != null && wind != null) {
    if (cloud <= 30 && wind <= 10) classification = "strahlungsnacht";
    else if (cloud <= 70 && wind <= 15) classification = "teilweise_klar";
  } else if (cloud != null) {
    if (cloud <= 30) classification = "strahlungsnacht";
    else if (cloud <= 70) classification = "teilweise_klar";
  }

  const lapse = classification === "bedeckt" ? -0.5 : -0.65;

  // Tmax: warmest point — typically the lowest, sun-exposed location (near Bodensee)
  let tmax_warm: number | null = null;
  if (tmaxRef != null) {
    const dh = topo.elev_ref - topo.elev_min; // positive (we are higher)
    tmax_warm = Math.round((tmaxRef + (dh * lapse) / 100) * 10) / 10;
    // Note: lapse is negative, dh positive → going down means warmer (lapse * -1)
    // Above formula: tmax_warm = tmax_ref + dh * (-0.65)/100 → would cool. Wrong sign.
    // Correct: lower elevation → warmer, so add |lapse| * dh / 100
    tmax_warm = Math.round((tmaxRef + Math.abs(lapse) * dh / 100) * 10) / 10;
  }

  // Tmin cold (sinks): radiative cooling bonus, largely independent of elevation
  let tmin_cold: number | null = null;
  let tmin_ridge: number | null = null;
  if (tminRef != null) {
    if (classification === "strahlungsnacht") {
      tmin_cold = Math.round((tminRef - 4) * 10) / 10;
      // Ridges stay warmer in radiative nights (inversion)
      const dhUp = topo.elev_max - topo.elev_ref;
      // ridges are warmer than valley floor by ~2°C in inversions (not standard lapse)
      tmin_ridge = Math.round((tminRef + Math.min(3, 1 + dhUp / 200)) * 10) / 10;
    } else if (classification === "teilweise_klar") {
      tmin_cold = Math.round((tminRef - 2) * 10) / 10;
      tmin_ridge = Math.round((tminRef + 1) * 10) / 10;
    } else {
      // Bedeckt: nur Lapse Rate (Senke wärmer als Höhe? nein — bei Wind/Bewölkung gleicht sich an)
      const dh = topo.elev_ref - topo.elev_min;
      tmin_cold = Math.round((tminRef + Math.abs(lapse) * dh / 100) * 10) / 10;
      const dhUp = topo.elev_max - topo.elev_ref;
      tmin_ridge = Math.round((tminRef - Math.abs(lapse) * dhUp / 100) * 10) / 10;
    }
  }

  return {
    elev_ref: topo.elev_ref,
    elev_min: topo.elev_min,
    elev_max: topo.elev_max,
    elev_median: topo.elev_median,
    classification,
    lapse_rate: lapse,
    tmin_cold,
    tmin_ridge,
    tmin_cold_label: classification === "strahlungsnacht" ? "Senken (Hudelmoos, Riedflächen)" : "Tiefste Lagen (Bodensee-Ufer)",
    tmin_ridge_label: "Höhenlagen (Hügelzüge)",
    tmax_warm,
    tmax_warm_label: "Sonnige Lagen am Bodensee-Ufer",
  };
}

function normalizeModels(models: string) {
  return Array.from(new Set(models.split(",").map((s) => s.trim()).filter(Boolean))).join(",");
}

// ===== MeteoSchweiz Stations-Bias (data.tg.ch) =====
// Wir gleichen die Modellprognose mit gemessenen Tageswerten der MeteoSchweiz-
// Stationen Güttingen (GUT, ~440m, Bodenseeufer) und Bischofszell (BIZ, ~506m,
// Thurtal-Senke) ab und ziehen den mittleren 7-Tage-Bias von Tmin/Tmax ab.
// Beide Stationen liegen im 15-km-Radius um Amriswil.
const STATIONS = [
  { abbr: "GUT", name: "Güttingen", lat: 47.602, lon: 9.279, dataset: "meteoschweiz-ogd-13", role: "warm" as const },
  { abbr: "BIZ", name: "Bischofszell", lat: 47.498, lon: 9.236, dataset: "meteoschweiz-ogd-12", role: "cold" as const },
];

type StationDailyMeasurement = { date: string; tmin: number | null; tmax: number | null };

async function fetchStationMeasurements(dataset: string): Promise<StationDailyMeasurement[]> {
  const url = new URL(`https://data.tg.ch/api/explore/v2.1/catalog/datasets/${dataset}/records`);
  url.searchParams.set("limit", "12");
  url.searchParams.set("order_by", "reference_timestamp desc");
  url.searchParams.set("select", "reference_timestamp,tre200dx,tre200dn");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`data.tg.ch ${dataset} ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data?.results ?? []).map((r: any) => ({
      date: (r.reference_timestamp ?? "").slice(0, 10),
      tmin: typeof r.tre200dn === "number" ? r.tre200dn : null,
      tmax: typeof r.tre200dx === "number" ? r.tre200dx : null,
    })).filter((r: StationDailyMeasurement) => r.date);
  } catch (e) {
    console.warn(`Station fetch failed (${dataset})`, e);
    return [];
  }
}

// Holt die historische Modellprognose (past_days) von Open-Meteo für die exakte
// Stations-Position. Wird benötigt, um den modellierten Tmin/Tmax mit dem
// gemessenen Wert zu vergleichen.
async function fetchStationModelHistory(lat: number, lon: number): Promise<Record<string, { tmin: number | null; tmax: number | null }>> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("past_days", "10");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max");
  // Verwende Best-Match (Default), reicht für Bias-Berechnung
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return {};
    const data = await res.json();
    const out: Record<string, { tmin: number | null; tmax: number | null }> = {};
    const times: string[] = data?.daily?.time ?? [];
    const tmins: number[] = data?.daily?.temperature_2m_min ?? [];
    const tmaxs: number[] = data?.daily?.temperature_2m_max ?? [];
    for (let i = 0; i < times.length; i++) {
      out[times[i]] = {
        tmin: typeof tmins[i] === "number" ? tmins[i] : null,
        tmax: typeof tmaxs[i] === "number" ? tmaxs[i] : null,
      };
    }
    return out;
  } catch (e) {
    console.warn("Station model history failed", e);
    return {};
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

type StationBias = {
  abbr: string;
  name: string;
  role: "warm" | "cold";
  lat: number;
  lon: number;
  bias_tmin: number; // model - measured (positive = Modell zu warm)
  bias_tmax: number;
  samples: number;
  measured_yesterday: { date: string; tmin: number | null; tmax: number | null } | null;
  forecast: Record<string, { tmin: number | null; tmax: number | null }>; // by date (ISO yyyy-mm-dd)
};

async function buildStationBiases(): Promise<StationBias[]> {
  const results = await Promise.all(
    STATIONS.map(async (st) => {
      const [measured, modeled] = await Promise.all([
        fetchStationMeasurements(st.dataset),
        fetchStationModelHistory(st.lat, st.lon),
      ]);
      // Bias über die letzten 7 Tage
      const today = new Date().toISOString().slice(0, 10);
      const usable = measured
        .filter((m) => m.date < today && (m.tmin != null || m.tmax != null))
        .slice(0, 7);
      const diffsMin: number[] = [];
      const diffsMax: number[] = [];
      for (const m of usable) {
        const fc = modeled[m.date];
        if (!fc) continue;
        if (fc.tmin != null && m.tmin != null) diffsMin.push(fc.tmin - m.tmin);
        if (fc.tmax != null && m.tmax != null) diffsMax.push(fc.tmax - m.tmax);
      }
      const samples = Math.min(diffsMin.length, diffsMax.length);
      const meanOrZero = (arr: number[]) =>
        arr.length >= 3 ? clamp(arr.reduce((a, b) => a + b, 0) / arr.length, -6, 6) : 0;
      const bias_tmin = Math.round(meanOrZero(diffsMin) * 10) / 10;
      const bias_tmax = Math.round(meanOrZero(diffsMax) * 10) / 10;
      // Frische-Check: ältester verwertbarer Wert nicht mehr als 3 Tage alt
      const fresh = usable.length && (Date.parse(today) - Date.parse(usable[0].date)) / 86400000 <= 3;
      const measured_yesterday = fresh ? usable[0] : null;
      return {
        abbr: st.abbr,
        name: st.name,
        role: st.role,
        lat: st.lat,
        lon: st.lon,
        bias_tmin: fresh ? bias_tmin : 0,
        bias_tmax: fresh ? bias_tmax : 0,
        samples,
        measured_yesterday,
        forecast: modeled,
      };
    })
  );
  return results;
}

// Hängt einem Tag den Stations-Block an: pro Station die korrigierten
// Tmin/Tmax für genau dieses Datum (falls Modell-Forecast vorhanden) +
// die Anker für KI-Prompt.
function applyStationBias(day: { date?: string; tmin?: { avg?: number } | null; tmax?: { avg?: number } | null } | null, biases: StationBias[]) {
  if (!day || !day.date || !biases.length) return null;
  const date = day.date;
  const stations: Record<string, any> = {};
  let coldest: number | null = null;
  let warmest: number | null = null;
  for (const b of biases) {
    const fc = b.forecast[date];
    if (!fc) continue;
    const corrTmin = fc.tmin != null ? Math.round((fc.tmin - b.bias_tmin) * 10) / 10 : null;
    const corrTmax = fc.tmax != null ? Math.round((fc.tmax - b.bias_tmax) * 10) / 10 : null;
    stations[b.abbr] = {
      name: b.name,
      role: b.role,
      bias_tmin: b.bias_tmin,
      bias_tmax: b.bias_tmax,
      samples: b.samples,
      measured_yesterday: b.measured_yesterday,
      model_tmin: fc.tmin,
      model_tmax: fc.tmax,
      corrected_tmin: corrTmin,
      corrected_tmax: corrTmax,
    };
    if (corrTmin != null) coldest = coldest == null ? corrTmin : Math.min(coldest, corrTmin);
    if (corrTmax != null) warmest = warmest == null ? corrTmax : Math.max(warmest, corrTmax);
  }
  if (Object.keys(stations).length === 0) return null;
  return {
    stations,
    radius_tmin_corrected: coldest,
    radius_tmax_corrected: warmest,
  };
}

async function fetchOpenMeteo(lat: number, lon: number, models: string, includeHourly: boolean) {
  const normalizedModels = normalizeModels(models);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("forecast_days", "10");
  url.searchParams.set("daily", DAILY_VARS.join(","));
  if (includeHourly) url.searchParams.set("hourly", HOURLY_VARS.join(","));
  url.searchParams.set("models", normalizedModels);
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString());
    if (res.ok) return await res.json();
    lastError = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) throw new Error(`Open-Meteo Fehler ${res.status} (models=${normalizedModels})${lastError ? `: ${lastError}` : ""}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1));
  }
  throw new Error(`Open-Meteo Fehler (models=${normalizedModels})${lastError ? `: ${lastError}` : ""}`);
}

async function fetchOpenMeteoOptional(lat: number, lon: number, models: string, includeHourly: boolean) {
  try {
    return await fetchOpenMeteo(lat, lon, models, includeHourly);
  } catch (e) {
    console.warn(e instanceof Error ? e.message : e);
    return null;
  }
}

// Returns a unified weather object with `daily` (timeline) and `byModel` (per-model values)
async function fetchWeather(
  lat: number,
  lon: number,
  shortModels = "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2",
  midModels = "meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025",
  longModels = "ecmwf_ifs025,gfs_global"
) {
  shortModels = normalizeModels(shortModels);
  midModels = normalizeModels(midModels);
  longModels = normalizeModels(longModels);
  // Avoid rate-limit bursts: query the model tiers sequentially and tolerate one tier failing.
  // Short-tier (Tag 0-1) ist immer live; mid/long werden bis Mitternacht gecacht.
  const shortData = await fetchOpenMeteoOptional(lat, lon, shortModels, true);
  await wait(500);
  const midData = await getOrSetCache(
    `om:mid:${lat.toFixed(4)},${lon.toFixed(4)}:${midModels}`,
    () => fetchOpenMeteoOptional(lat, lon, midModels, false),
  );
  await wait(500);
  const longData = await getOrSetCache(
    `om:long:${lat.toFixed(4)},${lon.toFixed(4)}:${longModels}`,
    () => fetchOpenMeteoOptional(lat, lon, longModels, false),
  );
  const daily = midData?.daily ?? longData?.daily ?? shortData?.daily;
  if (!daily) throw new Error("Open-Meteo liefert aktuell keine Wetterdaten. Bitte später erneut versuchen.");
  return {
    daily,
    hourly: shortData?.hourly, // hourly only from short-term (CH-models, finest grid)
    byModel: { short: shortData, mid: midData, long: longData },
    modelLists: { short: shortModels, mid: midModels, long: longModels },
  };
}

// Collect per-model values for a given variable + dayIndex from one fetch result
function collectModelValues(fetchResult: any, varName: string, models: string, dayIndex: number) {
  const out: Record<string, number> = {};
  const d = fetchResult?.daily;
  if (!d) return out;
  for (const m of models.split(",").map((s) => s.trim()).filter(Boolean)) {
    const key = `${varName}_${m}`;
    const v = d[key]?.[dayIndex];
    if (v != null && Number.isFinite(v)) out[m] = v;
  }
  // If only one model was requested, Open-Meteo may return the unsuffixed array
  if (Object.keys(out).length === 0) {
    const v = d[varName]?.[dayIndex];
    if (v != null && Number.isFinite(v)) out["default"] = v;
  }
  return out;
}

function spread(values: number[]) {
  if (values.length < 2) return 0;
  return Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
}

function aggregate(perModel: Record<string, number>) {
  const vals = Object.values(perModel);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    avg: Math.round(avg * 10) / 10,
    min: Math.min(...vals),
    max: Math.max(...vals),
    spread: spread(vals),
    by_model: perModel,
  };
}

function pickBestSource(weather: any, dayIndex: number) {
  // Use the most detailed model set available for this dayIndex.
  // ICON-CH1 ~33h, ICON-CH2 ~5d, ECMWF/GFS ~10d.
  if (dayIndex <= 1) return { res: weather.byModel.short, models: weather.modelLists.short, tier: "short" as const };
  if (dayIndex <= 4) return { res: weather.byModel.mid, models: weather.modelLists.mid, tier: "mid" as const };
  return { res: weather.byModel.long, models: weather.modelLists.long, tier: "long" as const };
}

// Tier-aware collector: starts with the primary tier for the dayIndex; if fewer than 2 models
// contributed (e.g. ICON-CH1 expired, AROME doesn't support sunshine_duration), it automatically
// falls back to the next tier(s) so we always get a meaningful average from multiple models.
// Same model id appearing in multiple tiers is naturally deduped (last write wins, identical value).
function collectModelValuesTiered(weather: any, varName: string, dayIndex: number) {
  const tiersByPriority: Array<{ tier: "short" | "mid" | "long"; res: any; models: string }> = [];
  if (dayIndex <= 1) {
    tiersByPriority.push({ tier: "short", res: weather.byModel.short, models: weather.modelLists.short });
    tiersByPriority.push({ tier: "mid", res: weather.byModel.mid, models: weather.modelLists.mid });
  } else if (dayIndex <= 4) {
    tiersByPriority.push({ tier: "mid", res: weather.byModel.mid, models: weather.modelLists.mid });
    tiersByPriority.push({ tier: "short", res: weather.byModel.short, models: weather.modelLists.short });
    tiersByPriority.push({ tier: "long", res: weather.byModel.long, models: weather.modelLists.long });
  } else {
    tiersByPriority.push({ tier: "long", res: weather.byModel.long, models: weather.modelLists.long });
    tiersByPriority.push({ tier: "mid", res: weather.byModel.mid, models: weather.modelLists.mid });
  }

  const merged: Record<string, number> = {};
  // Always pull primary tier
  Object.assign(merged, collectModelValues(tiersByPriority[0].res, varName, tiersByPriority[0].models, dayIndex));
  // Mix in additional tiers if we have <2 contributing models so far
  for (let i = 1; i < tiersByPriority.length; i++) {
    if (Object.keys(merged).length >= 2) break;
    const extra = collectModelValues(tiersByPriority[i].res, varName, tiersByPriority[i].models, dayIndex);
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in merged) && k !== "default") merged[k] = v;
    }
  }
  return merged;
}

function formatDayData(weather: any, dayIndex: number) {
  const d = weather.daily;
  if (!d || !d.time?.[dayIndex]) return null;
  const { models, tier } = pickBestSource(weather, dayIndex);
  const cloudcover = aggregate(collectModelValuesTiered(weather, "cloudcover_mean", dayIndex));
  const sunshineRaw = collectModelValuesTiered(weather, "sunshine_duration", dayIndex);
  const sunshineHours: Record<string, number> = {};
  for (const [k, v] of Object.entries(sunshineRaw)) sunshineHours[k] = Math.round((v / 3600) * 10) / 10;
  const sunshine_h = aggregate(sunshineHours);

  // Derive cloudcover from sunshine when models don't return it (assume ~12h daylight average)
  let cloudcover_source: "model" | "derived_from_sunshine" | "none" = cloudcover ? "model" : "none";
  let cloudcoverFinal = cloudcover;
  if (!cloudcover && sunshine_h && typeof sunshine_h.avg === "number") {
    const ratio = Math.max(0, Math.min(1, sunshine_h.avg / 12));
    const derived = Math.round((1 - ratio) * 100);
    cloudcoverFinal = { avg: derived, min: derived, max: derived, spread: 0, by_model: { derived } };
    cloudcover_source = "derived_from_sunshine";
  }

  const wind_max = aggregate(collectModelValuesTiered(weather, "windspeed_10m_max", dayIndex));
  const windDirPerModel = collectModelValuesTiered(weather, "winddirection_10m_dominant", dayIndex);
  const wind_dir = aggregate(windDirPerModel);
  // Use circular mean for the dominant direction (avg of degrees is wrong across 360°)
  const wind_dir_avg = circularMeanDeg(Object.values(windDirPerModel));
  const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
  const wind_label = buildWindLabel(wind_dir_avg, wind_max?.avg ?? null);

  const sky_label = isClearSkyDay({ cloudcover: cloudcoverFinal, sunshine_h }) ? "Sonnig und wolkenlos" : null;

  const tmax = aggregate(collectModelValuesTiered(weather, "temperature_2m_max", dayIndex));
  const tmin = aggregate(collectModelValuesTiered(weather, "temperature_2m_min", dayIndex));
  const precip = aggregate(collectModelValuesTiered(weather, "precipitation_sum", dayIndex));
  const precip_prob = aggregate(collectModelValuesTiered(weather, "precipitation_probability_max", dayIndex));
  const weathercode = aggregate(collectModelValuesTiered(weather, "weathercode", dayIndex));

  // models actually contributing across all variables (transparency for the UI)
  const contributing = new Set<string>();
  for (const agg of [tmax, tmin, precip, precip_prob, wind_max, wind_dir, weathercode, cloudcover, sunshine_h]) {
    if (agg?.by_model) for (const k of Object.keys(agg.by_model)) contributing.add(k);
  }

  return {
    date: d.time[dayIndex],
    models_configured: models,
    models_used: Array.from(contributing).join(","),
    tier,
    tmax,
    tmin,
    precip,
    precip_prob,
    wind_max,
    wind_dir,
    wind_dir_avg,
    wind_dir_compass,
    wind_label,
    sky_label,
    cloudcover: cloudcoverFinal,
    cloudcover_source,
    weathercode,
    sunshine_h,
  };
}

// Returns the current hour (0-23) in the Europe/Zurich timezone, regardless of host TZ.
function currentZurichHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

// Builds the dynamic title for the first ("rest of today + night") entry based on creation hour.
function restOfDayTitle(startHour: number, todayDateStr: string): string {
  const date = new Date(todayDateStr + "T12:00:00");
  const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
  const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
  if (startHour < 12) return `Heute, ${weekday} ${formatted}`;
  if (startHour < 17) return `Heute Nachmittag & Abend`;
  return `Heute Abend & Nacht`;
}

function formatEveningNight(weather: any, startHourOverride?: number) {
  const h = weather.hourly;
  if (!h?.time) return null;
  const today = weather.daily.time[0];
  const tomorrow = weather.daily.time[1];
  // Dynamic start: from "now" (current Zurich hour) until 06:00 next day.
  // Cap minimum at 0 (full day) and maximum at 23 (latest sensible evening start).
  const rawStart = startHourOverride ?? currentZurichHour();
  const startHour = Math.max(0, Math.min(23, rawStart));
  const slice: Array<{ t: string; i: number }> = (h.time as string[])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const dt = new Date(t);
      const dateStr = t.slice(0, 10);
      return (dateStr === today && dt.getHours() >= startHour) || (dateStr === tomorrow && dt.getHours() < 6);
    });
  if (!slice.length) return null;

  // Collect arrays for ALL models (not just the first one)
  const collectArrs = (base: string): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    if (Array.isArray(h[base])) out["default"] = h[base];
    for (const k of Object.keys(h)) {
      if (k.startsWith(base + "_") && Array.isArray(h[k])) out[k.slice(base.length + 1)] = h[k];
    }
    return out;
  };

  const tArrs = collectArrs("temperature_2m");
  const pArrs = collectArrs("precipitation");
  const wArrs = collectArrs("windspeed_10m");
  const wdArrs = collectArrs("winddirection_10m");
  const cArrs = collectArrs("cloudcover");
  const sArrs = collectArrs("sunshine_duration");

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // Per-model summary over the evening/night window
  const summarizeModel = (model: string) => {
    const t = tArrs[model] ?? [];
    const p = pArrs[model] ?? [];
    const w = wArrs[model] ?? [];
    const c = cArrs[model] ?? [];
    const s = sArrs[model] ?? [];
    const temps = slice.map(({ i }) => t[i]).filter((v: number) => v != null && Number.isFinite(v));
    const precs = slice.map(({ i }) => p[i] ?? 0).filter((v: number) => Number.isFinite(v));
    const winds = slice.map(({ i }) => w[i]).filter((v: number) => v != null && Number.isFinite(v));
    const clouds = slice.map(({ i }) => c[i]).filter((v: number) => v != null && Number.isFinite(v));
    const suns = slice.map(({ i }) => s[i]).filter((v: number) => v != null && Number.isFinite(v));
    if (!temps.length) return null;
    return {
      tmin: r1(Math.min(...temps)),
      tmax: r1(Math.max(...temps)),
      precip_total: r1(precs.reduce((a, b) => a + b, 0)),
      wind_max: winds.length ? r1(Math.max(...winds)) : null,
      cloudcover_avg: clouds.length ? Math.round(avg(clouds)) : null,
      sunshine_h: suns.length ? r1(suns.reduce((a, b) => a + b, 0) / 3600) : null,
    };
  };

  const allModels = Array.from(new Set([
    ...Object.keys(tArrs), ...Object.keys(pArrs), ...Object.keys(wArrs), ...Object.keys(cArrs), ...Object.keys(sArrs),
  ]));
  const by_model: Record<string, any> = {};
  for (const m of allModels) {
    const s = summarizeModel(m);
    if (s) by_model[m] = s;
  }

  // Hour-by-hour averages across models
  const hourAvg = (arrs: Record<string, number[]>, i: number): number | null => {
    const vals = Object.values(arrs)
      .map((arr) => arr[i])
      .filter((v) => v != null && Number.isFinite(v));
    return vals.length ? avg(vals) : null;
  };

  const hourlyTemps = slice.map(({ i }) => hourAvg(tArrs, i)).filter((v): v is number => v != null);
  const hourlyPrecs = slice.map(({ i }) => hourAvg(pArrs, i) ?? 0);
  const hourlyWinds = slice.map(({ i }) => hourAvg(wArrs, i)).filter((v): v is number => v != null);
  const hourlyClouds = slice.map(({ i }) => hourAvg(cArrs, i)).filter((v): v is number => v != null);
  const hourlySuns = slice.map(({ i }) => hourAvg(sArrs, i)).filter((v): v is number => v != null);

  if (!hourlyTemps.length) return null;

  const modelSummaries = Object.values(by_model) as Array<{ tmin: number; tmax: number; precip_total: number }>;
  const tmins = modelSummaries.map((s) => s.tmin);
  const tmaxs = modelSummaries.map((s) => s.tmax);
  const precs = modelSummaries.map((s) => s.precip_total);
  const spread = modelSummaries.length >= 2 ? {
    tmin_min: Math.min(...tmins), tmin_max: Math.max(...tmins),
    tmax_min: Math.min(...tmaxs), tmax_max: Math.max(...tmaxs),
    precip_min: r1(Math.min(...precs)), precip_max: r1(Math.max(...precs)),
    tmin_spread: r1(Math.max(...tmins) - Math.min(...tmins)),
    tmax_spread: r1(Math.max(...tmaxs) - Math.min(...tmaxs)),
  } : null;

  // Sunshine totals over window (seconds → hours)
  const sunshine_h = hourlySuns.length ? r1(hourlySuns.reduce((a, b) => a + b, 0) / 3600) : null;
  // Daylight portion of the window (rough: 6-21 Uhr counts as daylight)
  const daylightHours = slice.filter(({ t }) => {
    const hr = new Date(t).getHours();
    return hr >= 6 && hr < 21;
  }).length || 1;
  // Derive cloudcover from sunshine when missing
  let cloudcover_avg: number | null = hourlyClouds.length ? Math.round(avg(hourlyClouds)) : null;
  let cloudcover_source: "model" | "derived_from_sunshine" | "none" = cloudcover_avg != null ? "model" : "none";
  if (cloudcover_avg == null && sunshine_h != null) {
    const ratio = Math.max(0, Math.min(1, sunshine_h / daylightHours));
    cloudcover_avg = Math.round((1 - ratio) * 100);
    cloudcover_source = "derived_from_sunshine";
  }

  // Wind direction over the window (circular mean across all models & hours)
  const windDirSamples: number[] = [];
  for (const arr of Object.values(wdArrs)) {
    for (const { i } of slice) {
      const v = arr[i];
      if (v != null && Number.isFinite(v)) windDirSamples.push(v);
    }
  }
  const wind_dir_avg = circularMeanDeg(windDirSamples);
  const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
  const wind_max = hourlyWinds.length ? r1(Math.max(...hourlyWinds)) : null;
  const wind_label = buildWindLabel(wind_dir_avg, wind_max);

  // Human-readable window description for the prompt
  const endHour = 6;
  const window_label =
    startHour < 12 ? `${String(startHour).padStart(2, "0")}:00 (heute) bis ${String(endHour).padStart(2, "0")}:00 (morgen früh) - umfasst Tag, Abend und Nacht`
    : startHour < 17 ? `${String(startHour).padStart(2, "0")}:00 bis ${String(endHour).padStart(2, "0")}:00 - Nachmittag, Abend und Nacht`
    : `${String(startHour).padStart(2, "0")}:00 bis ${String(endHour).padStart(2, "0")}:00 - Abend und Nacht`;

  return {
    window_start_hour: startHour,
    window_end_hour: endHour,
    window_label,
    tmin: r1(Math.min(...hourlyTemps)),
    tmax: r1(Math.max(...hourlyTemps)),
    precip_total: r1(hourlyPrecs.reduce((a, b) => a + b, 0)),
    wind_max,
    wind_dir_avg,
    wind_dir_compass,
    wind_label,
    cloudcover_avg,
    cloudcover_source,
    sunshine_h,
    models_used: Object.keys(by_model),
    spread,
    by_model,
  };
}

// Builds the first ("today") entry data + title + prompt-hint based on Zurich hour.
// < 12: full day. >= 12: rest-of-day window via formatEveningNight().
function buildFirstEntryContext(weather: any, withTopo: (i: number) => any, today: string) {
  const hour = currentZurichHour();
  const useEvening = hour >= 12;
  const evening = useEvening ? formatEveningNight(weather) : null;
  let firstData: any;
  let windowHint = "";
  if (useEvening && evening) {
    const base = withTopo(0) ?? {};
    firstData = { ...evening, date: today, topography: base.topography ?? null };
    windowHint = `\n\nWICHTIG: Dieser Eintrag beschreibt AUSSCHLIESSLICH den Zeitraum ${evening.window_label}. Beziehe dich nur auf diese Stunden, NICHT auf den schon vergangenen Tagesabschnitt. Beschreibe den Verlauf chronologisch innerhalb dieses Fensters.`;
  } else {
    firstData = withTopo(0);
  }
  const firstTitle = useEvening
    ? restOfDayTitle(hour, today)
    : (() => {
        const date = new Date(today);
        const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
        const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
        return `Heute, ${weekday} ${formatted}`;
      })();
  return { firstData, firstTitle, windowHint, hour };
}

// ===== AI text generation =====
async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY fehlt");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 429) throw new Error("KI-Limit erreicht. Bitte später erneut versuchen.");
  if (res.status === 402) throw new Error("KI-Guthaben aufgebraucht. Bitte Workspace aufladen.");
  if (!res.ok) throw new Error(`KI-Fehler ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ===== Prompt-Bausteine =====
// Der heutige System-Prompt ist in vier Bausteine aufgeteilt. Jeder Baustein
// kann in app_settings überschrieben werden; leer = Default greift.

export const DEFAULT_GENERAL_STYLE = `Du bist Meteorologe und schreibst Wetterprognosen im EXAKTEN Stil von oberthurgauerwetter.ch (Region Oberthurgau, Amriswil, Radius 15 km).

ABSOLUT VERBINDLICHE REGELN:
- Schweizer Hochdeutsch: IMMER "ss" statt "ß".
- KEINE Überschriften, KEINE Titel, KEINE Anrede, KEINE Aufzählungszeichen, KEINE Emojis, KEINE Markdown-Formatierung.
- KEINE Floskeln wie "insgesamt", "alles in allem", "zusammenfassend".
- Sachlich, nüchtern, präzise. Kurze, prägnante Sätze. Häufig Halbsätze mit Gedankenstrich " - " (Leerzeichen-Bindestrich-Leerzeichen).
- Absätze sind durch eine Leerzeile getrennt (\\n\\n). Jeder Absatz ist sehr kurz (1-3 Sätze).
- Alle Einträge (auch der erste „Heute"-Eintrag) basieren auf TAGES-Werten. Für „Heute" beschreibe den Tagesverlauf chronologisch (Morgen → Mittag → Nachmittag → Abend) mit Tageszeit-Bezug.
- AUSNAHME: Wenn der Eintragstitel "Heute Nachmittag & Abend" oder "Heute Abend & Nacht" lautet, beziehen sich die mitgelieferten Werte (window_label, tmin, tmax, precip_total, wind_max, sunshine_h) AUSSCHLIESSLICH auf dieses Fenster (jetzt bis 06:00 Folgetag). Beschreibe nur diesen Zeitraum chronologisch — der bereits vergangene Tagesabschnitt darf NICHT erwähnt werden.

PFLICHT-VOKABULAR (verwenden wo passend): "Quellwolken", "Hochnebel", "hochnebelartige Wolkenfelder", "Restbewölkung", "Bisenströmung", "veränderlich bewölkt", "ziemlich sonnig", "Schaueraktivität", "mittelhohe und hohe Wolkenfelder", "Bewölkungsverdichtung", "trockene Phasen", "sonnige Lücken", "mit Blick nach Baden-Württemberg", "Alpstein", "Vorarlberg", "umliegende Berg- und Hügelzüge", "südlichere Regionen".

VERBOTEN: "Es wird", "Wir erwarten", "Insgesamt", "Bitte beachten", Wettercodes, Prozentangaben, exakte Uhrzeiten, Aufzählungen mit "-" am Zeilenanfang. KEINE poetischen, dramatischen oder erfundenen Begriffe wie "grössenwahnsinnige Wolken", "unsichtbare Wolken", "schützende Wolkenschicht", "die Sonnenstrahlen erreichen die Erde", "der Himmel öffnet sich", o.ä. NUR sachliche meteorologische Standardbegriffe aus dem Pflicht-Vokabular. Wenn unsicher: knapp und nüchtern bleiben.`;

export const DEFAULT_SKY_RULES = `Leite die Bewölkung primär aus "sunshine_h" ab: ≥ 10h = "sonnig"/"klar"/"meist sonnig", 6-10h = "ziemlich sonnig"/"heiter", 3-6h = "wechselnd bewölkt"/"zeitweise sonnig", < 3h = "stark bewölkt"/"bedeckt".
Beachte zusätzlich "weathercode" (0-1 = klar/heiter, 2 = teils bewölkt, 3 = bedeckt).
Wenn "cloudcover_source" = "model", darf "cloudcover.avg" genutzt werden. Bei "derived_from_sunshine" oder fehlend: NUR "sunshine_h"/"weathercode" verwenden.
WENN "sky_label" gesetzt ist, MUSS diese Himmelsbeschreibung WÖRTLICH übernommen werden.
Bei "Sonnig und wolkenlos" sind Formulierungen wie "einige Wolken", "Schönwetterwolken", "vorüberziehende Wolkenfelder", "leichte Bewölkung" usw. ABSOLUT VERBOTEN.
MODELL-UNSICHERHEIT: Wenn die Daten einen "spread"-Wert > 3 (Grad oder mm) zeigen oder die Modelle unterschiedliche Niederschlagssignale liefern, formuliere zurückhaltend ("veränderlich", "unsicher", "teils", "verbreitet zeitweise", "lokal unterschiedlich"). Bei kleinem spread konkrete Werte nennen.`;

export const DEFAULT_TEMP_RULES = `Tiefstwerte-Format: "Tiefstwerte zwischen X und Y Grad." ODER "Tiefstwerte um X Grad." ODER "Tiefstwerte X bis Y Grad."
Bei Tiefstwert ≤ 4 Grad zwingend anhängen: " - Bodenfrostgefahr".
Höchstwerte-Format: "Höchstwerte um X Grad."
Bei kurzen Tageseinträgen darf "Höchstwerte um Z Grad." direkt im selben Absatz wie die Tiefstwerte folgen.

STATIONEN (MeteoSchweiz Realdaten-Anker, höchste Priorität wenn vorhanden):
Wenn das Feld "stations" vorhanden ist, ziehe die korrigierten Stationswerte den reinen Modellwerten vor — sie wurden mit gemessenen Tageswerten der letzten 7 Tage bias-korrigiert.
- "stations.GUT" (Güttingen, Bodenseeufer): Anker für den WÄRMSTEN Punkt im Radius. Nutze "corrected_tmax" als oberen Tagesmax-Wert in seenahen Lagen, "corrected_tmin" als frostärmsten Tmin am See.
- "stations.BIZ" (Bischofszell, Thurtal-Senke): Anker für den KÄLTESTEN Punkt im Radius. Nutze "corrected_tmin" als realistischen Senken-Tmin (überschreibt "topography.tmin_cold").
Bilde den Hauptsatz "Tiefstwerte zwischen X und Y Grad." aus dem Bereich [stations.BIZ.corrected_tmin, stations.GUT.corrected_tmin] (auf ganze Grad gerundet, X = unterer, Y = oberer Wert).
Bilde den Hauptsatz "Höchstwerte um Z Grad." aus dem Mittel oder oberen Wert von stations.GUT.corrected_tmax und dem Modell-tmax.avg.

TOPOGRAPHIE (Senken / Tiefste Lagen im 15-km-Radius um Amriswil):
Wenn "stations.BIZ.corrected_tmin" vorhanden ist, nutze diesen Wert als Senken-Tmin (statt "topography.tmin_cold"). Sonst gilt:
Wenn im Tag das Feld "topography.tmin_cold" vorhanden ist UND "classification" entweder "strahlungsnacht" oder "teilweise_klar" ist, MUSS der modellierte Tiefstwert für die Senken zusätzlich genannt werden — als eigener Satz direkt nach dem Tiefstwerte-Satz.
Format: "In den Senken (z. B. Hudelmoos, Riedflächen, Bodensee-nahe Mulden, Thurtal bei Bischofszell) lokal bis X Grad." (X = Wert auf ganze Grad gerundet).
Bei X ≤ 4 Grad MUSS der Satz mit " - Bodenfrostgefahr." enden (statt nur Punkt).
Bei X ≤ 0 Grad lautet der Anhang " - Frostgefahr in den Senken.".
Bei "classification" = "bedeckt" UND fehlenden Stationsdaten: KEINEN Senken-Hinweis erzeugen.
Den Senken-Wert NIEMALS in den Haupt-Tiefstwert-Satz mischen — der Hauptsatz nennt den Bereich GUT/BIZ.`;

export const DEFAULT_WIND_RULES = `STRIKT: Übernimm den Wert aus dem Feld "wind_label" WORTWÖRTLICH und EXAKT als ersten Satz des Wind-Absatzes (mit Punkt am Ende).
Beispiel: wind_label = "Schwacher Südostwind" → Satz: "Schwacher Südostwind."
ABSOLUT VERBOTEN: eine andere Windrichtung als die in "wind_label" zu nennen. Wenn "wind_label" "Südostwind" sagt, dann NIEMALS "Bise", "Ostwind", "Westwind" o.ä. schreiben. Wenn "wind_label" "Bise" sagt, NIE "Ostwind" oder "Nordostwind" schreiben.
Du darfst nur sachlich ergänzen: Tageszeit-Bezug ("am Morgen", "im Tagesverlauf"), oder Böen-Hinweis bei Schauer/Gewitter ("kräftige Böen").
Verwende NIE rohe Gradzahlen aus "wind_dir" oder "wind_dir_avg".
Eine abweichende Windbezeichnung gilt als Verstoss gegen die Vorgaben.`;

const STRUCTURE_AND_EXAMPLES = `PFLICHT-STRUKTUR JEDES TAGES (genau in dieser Reihenfolge, jeweils eigener Absatz):
Absatz 1: Wetterverlauf - Bewölkung, Niederschlag, Gewitter, Sonne mit Tageszeit-Bezug ("am Morgen", "im Tagesverlauf", "am Abend", "gegen Mittag").
Absatz 2: Tiefstwerte gemäss Temperatur-Regeln. Bei kurzen Tageseinträgen darf in DEMSELBEN Absatz folgen: " Höchstwerte um Z Grad."
Absatz 3 (falls nicht in Absatz 2 enthalten): Höchstwerte gemäss Temperatur-Regeln.
Absatz 4 (Wind): gemäss Wind-Regeln.

REFERENZ-BEISPIEL (Stil exakt so übernehmen):

Am Abend teils sonnig, aus Westen vermehrt mittelhohe und hohe Wolkenfelder. Im Laufe der zweiten Nachthälfte weitere Bewölkungsverdichtung - gegen den Morgen erste Schauer, vereinzelt mit Blitz und Donner.

Tiefstwerte zwischen 9 und 11 Grad.

Am Sonntag veränderlich bewölkt und gelegentlich Schauer - teils auch kräftig und in Begleitung von Gewitter. Dazwischen längere trockene Phasen und sonnige Lücken. Am Abend abnehmende Schaueraktivität.

Höchstwerte um 18 Grad.

Im Tagesverlauf teils mässiger Westwind, in Verbindung mit Schauer und Gewitter kräftige Böen.

REFERENZ-BEISPIEL für einen einzelnen Tag (kurze Form):

Ziemlich sonnig - am Morgen in den südlicheren Regionen noch Restbewölkung und gegen Mittag besonders mit Blick nach Baden-Württemberg zunehmend grössere Quellwolken.

Tiefstwerte zwischen 3 und 6 Grad. Höchstwerte um 15 Grad.

Schwache, spürbare Bise.

Gib NUR den Fliesstext aus - keinen Titel, keine Einleitung, keine Erklärung.`;

export function buildSystemPrompt(settings: any): string {
  const general = settings?.ai_prompt_template?.trim() || DEFAULT_GENERAL_STYLE;
  const sky = settings?.prompt_sky?.trim() || DEFAULT_SKY_RULES;
  const temp = settings?.prompt_temp?.trim() || DEFAULT_TEMP_RULES;
  const wind = settings?.prompt_wind?.trim() || DEFAULT_WIND_RULES;
  return [
    general,
    "",
    "=== REGELN BEWÖLKUNG / SONNE / NIEDERSCHLAG ===",
    sky,
    "",
    "=== REGELN TEMPERATUR ===",
    temp,
    "",
    "=== REGELN WIND ===",
    wind,
    "",
    "=== PFLICHT-STRUKTUR & BEISPIELE ===",
    STRUCTURE_AND_EXAMPLES,
  ].join("\n");
}

// Veredelt einen MOSMIX-Tag mit den abgeleiteten Wind-Labels (Kompass + Stärke)
function enrichMosmixDay(day: any): any {
  if (!day) return day;
  const dirAvg = day.wind_dir_avg;
  const windMax = day.wind_max?.avg ?? null;
  return {
    ...day,
    wind_dir_compass: dirAvg != null ? compassToName(dirAvg) : null,
    wind_label: buildWindLabel(dirAvg, windMax),
    sky_label: isClearSkyDay(day) ? "Sonnig und wolkenlos" : null,
  };
}

// ===== Public server functions =====

export const generateForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    await ensureStaff(supabase, userId);
    const settings = await getSettings(supabase);
    const lat = settings?.location_lat ?? 47.5469;
    const lon = settings?.location_lon ?? 9.2986;
    const locationName = settings?.location_name ?? "Amriswil";
    const promptTemplate = buildSystemPrompt(settings);

    const weather = await fetchWeather(
      lat, lon,
      settings?.models_shortterm ?? undefined,
      settings?.models_midterm ?? undefined,
      settings?.models_longterm ?? undefined,
    );
    const topo = await ensureTopography(supabase, settings);
    const stationBiases = await getOrSetCache("stations:bias", buildStationBiases);

    // ICON-MOS (DWD MOSMIX) für Tag 0 + 1 holen, sofern aktiviert.
    // MOSMIX ist bereits statistisch gegen Stationsmessungen kalibriert,
    // daher entfällt für diese Tage die eigene Stations-Bias-Korrektur.
    const mosmixEnabled = settings?.mosmix_enabled !== false;
    const mosmixStations = (settings?.mosmix_stations ?? "10935,10929")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    const mosmixByDate = mosmixEnabled
      ? await fetchMosmixShortTerm(mosmixStations).catch((e) => {
          console.warn("MOSMIX failed, falling back to Open-Meteo only:", e);
          return new Map<string, any>();
        })
      : new Map<string, any>();

    const buildDay = (dayIndex: number) => {
      const omDay = formatDayData(weather, dayIndex);
      if (!omDay) return null;
      // Tag 0/1: MOSMIX bevorzugt — überschreibt Roh-Werte, kein Stations-Bias.
      const mosmix = dayIndex <= 1 ? mosmixByDate.get(omDay.date) : null;
      let base: any;
      if (mosmix) {
        // MOSMIX ist Primärquelle. Open-Meteo bleibt als Referenz im Feld om_reference.
        base = enrichMosmixDay({
          ...mosmix,
          // weathercode/precip_prob aus Open-Meteo übernehmen (MOSMIX hat das nicht)
          weathercode: omDay.weathercode,
          precip_prob: omDay.precip_prob,
          om_reference: { tmin: omDay.tmin, tmax: omDay.tmax, precip: omDay.precip, wind_max: omDay.wind_max },
        });
      } else {
        base = omDay;
      }
      const out: any = { ...base, topography: applyTopography(base, topo) };
      // Stations-Bias nur dann anhängen, wenn nicht schon MOSMIX-korrigiert.
      if (!mosmix) {
        const st = applyStationBias(base, stationBiases);
        if (st) out.stations = st;
      }
      return out;
    };
    const radarSnapshot = (settings?.radar_enabled !== false)
      ? await fetchRadarSnapshot(lat, lon).catch((e) => { console.warn("radar fetch failed", e); return null; })
      : null;
    const biasEnabled = settings?.bias_enabled !== false;
    const biasStations = (settings?.bias_stations ?? "GUT,STG,TAE")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    const biasLookback = Math.max(2, Math.min(14, settings?.bias_lookback_days ?? 7));
    const biasStrength = Math.max(0, Math.min(100, settings?.bias_strength ?? 70));
    const bias: BiasResult | null = biasEnabled && biasStations.length
      ? await computeBiasCorrection(biasStations, biasLookback, biasStrength).catch((e) => { console.warn("bias compute failed", e); return null; })
      : null;
    const withTopo = (dayIndex: number) => {
      let out = buildDay(dayIndex);
      if (!out) return null;
      // Bias nur anwenden wenn MOSMIX nicht schon korrigiert hat (also bei Tag >=2 oder fehlendem MOSMIX)
      const mosmixApplied = out?.source === "mosmix";
      if (bias && bias.applied && !mosmixApplied) {
        out = applyBiasToDay(out, bias);
      }
      applyRadarToDay(out, dayIndex, radarSnapshot, settings);
      return out;
    };
    const today = weather.daily.time[0];
    const { data: forecast, error: fErr } = await supabase
      .from("forecasts")
      .insert({ forecast_date: today, status: "draft", created_by: userId })
      .select()
      .single();
    if (fErr) throw new Error(fErr.message);

    const tasks: Array<Promise<{ position: number; entry_date: string | null; title: string; body: string; weather_data: any }>> = [];

    {
      const { firstData, firstTitle, windowHint } = buildFirstEntryContext(weather, withTopo, today);
      const userPrompt = `Standort: ${locationName} (Radius 15 km). Schreibe einen Fliesstext für "${firstTitle}" auf Basis dieser Daten:\n${JSON.stringify(firstData, null, 2)}${windowHint}`;
      tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
        position: 1, entry_date: today, title: firstTitle, body: enforceSkyConsistency(body, firstData), weather_data: firstData,
      })));
    }

    for (let i = 1; i <= 5; i++) {
      const day = withTopo(i);
      if (!day) continue;
      const date = new Date(day.date);
      const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
      const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
      const title = i === 1 ? `Morgen, ${weekday} ${formatted}` : `${weekday}, ${formatted}`;
      const userPrompt = `Standort: ${locationName}. Schreibe einen Fliesstext für ${weekday}, ${formatted} auf Basis dieser Daten:\n${JSON.stringify(day, null, 2)}`;
      const pos = i + 1;
      tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
        position: pos, entry_date: day.date, title, body: enforceSkyConsistency(body, day), weather_data: day,
      })));
    }

    {
      const trendDays = [5, 6, 7, 8, 9].map((i) => withTopo(i)).filter(Boolean);
      if (trendDays.length) {
        const userPrompt = `Standort: ${locationName}. Schreibe einen kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10 auf Basis dieser Daten:\n${JSON.stringify(trendDays, null, 2)}`;
        tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
          position: 7, entry_date: trendDays[0]!.date, title: "Trend Tag 6 – 10", body, weather_data: trendDays,
        })));
      }
    }

    const entries = (await Promise.all(tasks)).sort((a, b) => a.position - b.position);

    const { error: eErr } = await supabase
      .from("forecast_entries")
      .insert(entries.map((entry) => ({ ...entry, forecast_id: forecast.id })));
    if (eErr) throw new Error(eErr.message);

    return { forecastId: forecast.id };
  });

export const regenerateForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forecastId: string }) => z.object({ forecastId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureStaff(supabase, userId);
    const settings = await getSettings(supabase);
    const lat = settings?.location_lat ?? 47.5469;
    const lon = settings?.location_lon ?? 9.2986;
    const locationName = settings?.location_name ?? "Amriswil";
    const promptTemplate = buildSystemPrompt(settings);

    const weather = await fetchWeather(
      lat, lon,
      settings?.models_shortterm ?? undefined,
      settings?.models_midterm ?? undefined,
      settings?.models_longterm ?? undefined,
    );
    const topo = await ensureTopography(supabase, settings);
    const stationBiases = await getOrSetCache("stations:bias", buildStationBiases);

    const mosmixEnabled = settings?.mosmix_enabled !== false;
    const mosmixStations = (settings?.mosmix_stations ?? "10935,10929")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    const mosmixByDate = mosmixEnabled
      ? await fetchMosmixShortTerm(mosmixStations).catch((e) => {
          console.warn("MOSMIX failed, falling back to Open-Meteo only:", e);
          return new Map<string, any>();
        })
      : new Map<string, any>();

    const radarSnapshot = (settings?.radar_enabled !== false)
      ? await fetchRadarSnapshot(lat, lon).catch((e) => { console.warn("radar fetch failed", e); return null; })
      : null;

    const biasEnabled = settings?.bias_enabled !== false;
    const biasStations = (settings?.bias_stations ?? "GUT,STG,TAE")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    const biasLookback = Math.max(2, Math.min(14, settings?.bias_lookback_days ?? 7));
    const biasStrength = Math.max(0, Math.min(100, settings?.bias_strength ?? 70));
    const bias: BiasResult | null = biasEnabled && biasStations.length
      ? await computeBiasCorrection(biasStations, biasLookback, biasStrength).catch((e) => { console.warn("bias compute failed", e); return null; })
      : null;

    const withTopo = (dayIndex: number) => {
      const omDay = formatDayData(weather, dayIndex);
      if (!omDay) return null;
      const mosmix = dayIndex <= 1 ? mosmixByDate.get(omDay.date) : null;
      let base: any;
      if (mosmix) {
        base = enrichMosmixDay({
          ...mosmix,
          weathercode: omDay.weathercode,
          precip_prob: omDay.precip_prob,
          om_reference: { tmin: omDay.tmin, tmax: omDay.tmax, precip: omDay.precip, wind_max: omDay.wind_max },
        });
      } else {
        base = omDay;
      }
      let out: any = { ...base, topography: applyTopography(base, topo) };
      if (!mosmix) {
        const st = applyStationBias(base, stationBiases);
        if (st) out.stations = st;
      }
      if (bias && bias.applied && !mosmix) {
        out = applyBiasToDay(out, bias);
      }
      applyRadarToDay(out, dayIndex, radarSnapshot, settings);
      return out;
    };
    const today = weather.daily.time[0];

    // Replace existing entries
    const { error: delErr } = await supabase
      .from("forecast_entries")
      .delete()
      .eq("forecast_id", data.forecastId);
    if (delErr) throw new Error(delErr.message);

    const tasks: Array<Promise<{ position: number; entry_date: string | null; title: string; body: string; weather_data: any; forecast_id: string }>> = [];

    {
      const { firstData, firstTitle, windowHint } = buildFirstEntryContext(weather, withTopo, today);
      const userPrompt = `Standort: ${locationName} (Radius 15 km). Schreibe einen Fliesstext für "${firstTitle}" auf Basis dieser Daten:\n${JSON.stringify(firstData, null, 2)}${windowHint}`;
      tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
        position: 1, entry_date: today, title: firstTitle, body: enforceSkyConsistency(body, firstData), weather_data: firstData, forecast_id: data.forecastId,
      })));
    }

    for (let i = 1; i <= 5; i++) {
      const day = withTopo(i);
      if (!day) continue;
      const date = new Date(day.date);
      const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
      const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
      const title = i === 1 ? `Morgen, ${weekday} ${formatted}` : `${weekday}, ${formatted}`;
      const userPrompt = `Standort: ${locationName}. Schreibe einen Fliesstext für ${weekday}, ${formatted} auf Basis dieser Daten:\n${JSON.stringify(day, null, 2)}`;
      const pos = i + 1;
      tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
        position: pos, entry_date: day.date, title, body: enforceSkyConsistency(body, day), weather_data: day, forecast_id: data.forecastId,
      })));
    }

    {
      const trendDays = [5, 6, 7, 8, 9].map((i) => withTopo(i)).filter(Boolean);
      if (trendDays.length) {
        const userPrompt = `Standort: ${locationName}. Schreibe einen kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10 auf Basis dieser Daten:\n${JSON.stringify(trendDays, null, 2)}`;
        tasks.push(generateText(promptTemplate, userPrompt).then((body) => ({
          position: 7, entry_date: trendDays[0]!.date, title: "Trend Tag 6 – 10", body, weather_data: trendDays, forecast_id: data.forecastId,
        })));
      }
    }

    const entries = (await Promise.all(tasks)).sort((a, b) => a.position - b.position);

    const { error: insErr } = await supabase.from("forecast_entries").insert(entries);
    if (insErr) throw new Error(insErr.message);

    const { error: updErr } = await supabase
      .from("forecasts")
      .update({ forecast_date: today, status: "draft", notes: "Komplett neu generiert" })
      .eq("id", data.forecastId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, entries: entries.length };
  });

export const deleteForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forecastId: string }) => z.object({ forecastId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { error: eErr } = await supabase.from("forecast_entries").delete().eq("forecast_id", data.forecastId);
    if (eErr) throw new Error(eErr.message);
    const { error: fErr } = await supabase.from("forecasts").delete().eq("id", data.forecastId);
    if (fErr) throw new Error(fErr.message);
    return { ok: true };
  });

export const regenerateEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { entryId: string }) => z.object({ entryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureStaff(supabase, userId);
    const settings = await getSettings(supabase);
    const promptTemplate = buildSystemPrompt(settings);
    const locationName = settings?.location_name ?? "Amriswil";

    const { data: entry, error } = await supabase
      .from("forecast_entries")
      .select("*")
      .eq("id", data.entryId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!entry) throw new Error("Eintrag nicht gefunden (ID ungültig oder keine Berechtigung).");

    const userPrompt = `Standort: ${locationName}. Schreibe einen Fliesstext für "${entry.title}" auf Basis dieser Daten:\n${JSON.stringify(entry.weather_data, null, 2)}`;
    const body = enforceSkyConsistency(await generateText(promptTemplate, userPrompt), entry.weather_data);
    const { error: uErr } = await supabase
      .from("forecast_entries")
      .update({ body })
      .eq("id", data.entryId);
    if (uErr) throw new Error(uErr.message);
    return { body };
  });

// ===== WordPress Sync =====
export const publishToWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forecastId: string }) => z.object({ forecastId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureStaff(supabase, userId);

    const wpUrl = process.env.WP_SITE_URL?.replace(/\/$/, "");
    const wpUser = process.env.WP_USERNAME;
    const wpPass = process.env.WP_APP_PASSWORD?.replace(/\s+/g, "");
    if (!wpUrl || !wpUser || !wpPass) throw new Error("WordPress-Zugangsdaten fehlen.");

    const settings = await getSettings(supabase);
    const targetSlug = settings?.wp_target_slug ?? "wetterbericht";
    const explicitId = settings?.wp_target_page_id ?? null;

    const { data: forecast, error: fErr } = await supabase
      .from("forecasts")
      .select("*")
      .eq("id", data.forecastId)
      .single();
    if (fErr) throw new Error(fErr.message);

    const { data: entries, error: eErr } = await supabase
      .from("forecast_entries")
      .select("*")
      .eq("forecast_id", data.forecastId)
      .order("position");
    if (eErr) throw new Error(eErr.message);

    const updated = new Date().toLocaleString("de-CH", { timeZone: "Europe/Zurich" });
    const html = [
      `<p><em>Aktualisiert: ${updated}</em></p>`,
      ...((entries ?? []).map((entry) => `<h2>${escapeHtml(entry.title)}</h2>\n${paragraphs(entry.body)}`)),
    ].join("\n\n");

    const auth = "Basic " + btoa(`${wpUser}:${wpPass}`);

    let pageId: number | null = explicitId;
    if (!pageId) {
      const findRes = await fetch(`${wpUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(targetSlug)}&status=any`, {
        headers: { Authorization: auth },
      });
      if (!findRes.ok) throw new Error(`WordPress Suche fehlgeschlagen: ${findRes.status} ${await findRes.text()}`);
      const found = await findRes.json();
      if (Array.isArray(found) && found.length) pageId = found[0].id;
    }

    let endpoint: string;
    let method: "POST";
    let payload: any;
    if (pageId) {
      endpoint = `${wpUrl}/wp-json/wp/v2/pages/${pageId}`;
      method = "POST";
      payload = { content: html, status: "publish" };
    } else {
      endpoint = `${wpUrl}/wp-json/wp/v2/pages`;
      method = "POST";
      payload = { title: "Wetterbericht", slug: targetSlug, content: html, status: "publish" };
    }

    const res = await fetch(endpoint, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WordPress Update fehlgeschlagen: ${res.status} ${await res.text()}`);
    const result = await res.json();

    const { error: updateError } = await supabase
      .from("forecasts")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        published_by: userId,
        wp_post_id: result.id,
        wp_post_url: result.link ?? null,
      })
      .eq("id", data.forecastId);
    if (updateError) throw new Error(updateError.message);

    return { url: result.link, id: result.id, forecastDate: forecast.forecast_date };
  });

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphs(body: string) {
  return body
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

// ===== Settings & users (admin) =====
export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) =>
    z
      .object({
        location_name: z.string().min(1).max(100),
        location_lat: z.number().min(-90).max(90),
        location_lon: z.number().min(-180).max(180),
        radius_km: z.number().int().min(1).max(100),
        wp_target_slug: z.string().min(1).max(200),
        wp_target_page_id: z.number().int().nullable(),
        ai_prompt_template: z.string().max(50000),
        models_shortterm: z.string().max(500).optional(),
        models_midterm: z.string().max(500).optional(),
        models_longterm: z.string().max(500).optional(),
        prompt_sky: z.string().max(50000).optional().nullable(),
        prompt_temp: z.string().max(50000).optional().nullable(),
        prompt_wind: z.string().max(50000).optional().nullable(),
        mosmix_enabled: z.boolean().optional(),
        mosmix_stations: z.string().max(500).optional(),
        radar_enabled: z.boolean().optional(),
        radar_radius_km: z.number().int().min(1).max(100).optional(),
        radar_correction_strength: z.number().int().min(0).max(100).optional(),
        bias_enabled: z.boolean().optional(),
        bias_stations: z.string().max(500).optional(),
        bias_lookback_days: z.number().int().min(2).max(14).optional(),
        bias_strength: z.number().int().min(0).max(100).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const existing = await getSettings(supabase);

    if (existing) {
      const { error } = await supabase
        .from("app_settings")
        .update({ ...data, updated_by: userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("app_settings")
        .insert({ ...data, updated_by: userId });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const getPromptDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureStaff(supabase, userId);
    return {
      general: DEFAULT_GENERAL_STYLE,
      sky: DEFAULT_SKY_RULES,
      temp: DEFAULT_TEMP_RULES,
      wind: DEFAULT_WIND_RULES,
    };
  });

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("user_id, email, display_name, created_at");
    if (error) throw new Error(error.message);

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role");
    if (rolesError) throw new Error(rolesError.message);

    return (profiles ?? []).map((profile) => ({
      ...profile,
      roles: (roles ?? []).filter((role) => role.user_id === profile.user_id).map((role) => role.role),
    }));
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) =>
    z
      .object({
        email: z.string().email(),
        role: z.enum(["admin", "editor"]),
        display_name: z.string().min(1).max(100),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name: data.display_name },
    });
    if (error) throw new Error(error.message);

    const createdUserId = created.user!.id;
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: createdUserId, role: data.role });
    if (roleError) throw new Error(roleError.message);

    await supabaseAdmin.auth.admin
      .generateLink({
        type: "recovery",
        email: data.email,
      })
      .catch(() => {});

    return { ok: true, userId: createdUserId, tempPassword };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "editor"]),
        enabled: z.boolean(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    if (data.enabled) {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    if (data.user_id === userId) throw new Error("Du kannst dich nicht selbst löschen.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
