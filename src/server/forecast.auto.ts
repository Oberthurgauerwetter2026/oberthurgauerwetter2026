// Server-only auto-forecast logic (re-uses helpers from forecast.functions but
// avoids the auth middleware so it can be triggered by cron).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSystemPrompt } from "./forecast.functions";

const DAILY_VARS = [
  "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
  "precipitation_probability_max", "windspeed_10m_max", "winddirection_10m_dominant",
  "sunshine_duration", "weathercode", "cloudcover_mean",
];
const HOURLY_VARS = ["temperature_2m", "precipitation", "cloudcover", "windspeed_10m", "winddirection_10m", "weathercode", "sunshine_duration"];

// ===== Wind helpers (kept in sync with forecast.functions.ts) =====
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
function compassToName(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 30 && d < 70) return "Bise";
  if (d >= 70 && d < 112.5) return "Ostwind";
  if (d >= 112.5 && d < 157.5) return "Südostwind";
  if (d >= 157.5 && d < 202.5) return "Südwind";
  if (d >= 202.5 && d < 247.5) return "Südwestwind";
  if (d >= 247.5 && d < 292.5) return "Westwind";
  if (d >= 292.5 && d < 337.5) return "Nordwestwind";
  return "Nordwind";
}
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

function normalizeModels(models: string) {
  return Array.from(new Set(models.split(",").map((s) => s.trim()).filter(Boolean))).join(",");
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

async function fetchWeather(
  lat: number, lon: number,
  shortModels = "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2",
  midModels = "meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025",
  longModels = "ecmwf_ifs025,gfs_global"
) {
  shortModels = normalizeModels(shortModels);
  midModels = normalizeModels(midModels);
  longModels = normalizeModels(longModels);
  const s = await fetchOpenMeteoOptional(lat, lon, shortModels, true);
  await wait(500);
  const m = await fetchOpenMeteoOptional(lat, lon, midModels, false);
  await wait(500);
  const l = await fetchOpenMeteoOptional(lat, lon, longModels, false);
  const daily = m?.daily ?? l?.daily ?? s?.daily;
  if (!daily) throw new Error("Open-Meteo liefert aktuell keine Wetterdaten. Bitte später erneut versuchen.");
  return {
    daily, hourly: s?.hourly,
    byModel: { short: s, mid: m, long: l },
    modelLists: { short: shortModels, mid: midModels, long: longModels },
  };
}

function collectModelValues(res: any, varName: string, models: string, dayIndex: number) {
  const out: Record<string, number> = {};
  const d = res?.daily;
  if (!d) return out;
  for (const mdl of models.split(",").map((s) => s.trim()).filter(Boolean)) {
    const v = d[`${varName}_${mdl}`]?.[dayIndex];
    if (v != null && Number.isFinite(v)) out[mdl] = v;
  }
  if (Object.keys(out).length === 0) {
    const v = d[varName]?.[dayIndex];
    if (v != null && Number.isFinite(v)) out["default"] = v;
  }
  return out;
}

function aggregate(perModel: Record<string, number>) {
  const vals = Object.values(perModel);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sp = vals.length < 2 ? 0 : Math.round((Math.max(...vals) - Math.min(...vals)) * 10) / 10;
  return { avg: Math.round(avg * 10) / 10, min: Math.min(...vals), max: Math.max(...vals), spread: sp, by_model: perModel };
}

function pickBestSource(weather: any, dayIndex: number) {
  if (dayIndex <= 1) return { res: weather.byModel.short, models: weather.modelLists.short, tier: "short" as const };
  if (dayIndex <= 4) return { res: weather.byModel.mid, models: weather.modelLists.mid, tier: "mid" as const };
  return { res: weather.byModel.long, models: weather.modelLists.long, tier: "long" as const };
}

// Tier-aware collector with fallback mix-in (same logic as forecast.functions.ts)
function collectModelValuesTiered(weather: any, varName: string, dayIndex: number) {
  const tiers: Array<{ res: any; models: string }> = [];
  if (dayIndex <= 1) {
    tiers.push({ res: weather.byModel.short, models: weather.modelLists.short });
    tiers.push({ res: weather.byModel.mid, models: weather.modelLists.mid });
  } else if (dayIndex <= 4) {
    tiers.push({ res: weather.byModel.mid, models: weather.modelLists.mid });
    tiers.push({ res: weather.byModel.short, models: weather.modelLists.short });
    tiers.push({ res: weather.byModel.long, models: weather.modelLists.long });
  } else {
    tiers.push({ res: weather.byModel.long, models: weather.modelLists.long });
    tiers.push({ res: weather.byModel.mid, models: weather.modelLists.mid });
  }
  const merged: Record<string, number> = {};
  Object.assign(merged, collectModelValues(tiers[0].res, varName, tiers[0].models, dayIndex));
  for (let i = 1; i < tiers.length; i++) {
    if (Object.keys(merged).length >= 2) break;
    const extra = collectModelValues(tiers[i].res, varName, tiers[i].models, dayIndex);
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
  const wind_dir_avg = circularMeanDeg(Object.values(windDirPerModel));
  const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
  const wind_label = buildWindLabel(wind_dir_avg, wind_max?.avg ?? null);

  const sky_label = isClearSkyDay({ cloudcover: cloudcoverFinal, sunshine_h }) ? "Sonnig und wolkenlos" : null;

  const tmax = aggregate(collectModelValuesTiered(weather, "temperature_2m_max", dayIndex));
  const tmin = aggregate(collectModelValuesTiered(weather, "temperature_2m_min", dayIndex));
  const precip = aggregate(collectModelValuesTiered(weather, "precipitation_sum", dayIndex));
  const precip_prob = aggregate(collectModelValuesTiered(weather, "precipitation_probability_max", dayIndex));
  const weathercode = aggregate(collectModelValuesTiered(weather, "weathercode", dayIndex));

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

function currentZurichHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

function restOfDayTitle(startHour: number, todayDateStr: string): string {
  const date = new Date(todayDateStr + "T12:00:00");
  const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
  const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
  if (startHour < 12) return `Heute, ${weekday} ${formatted}`;
  if (startHour < 17) return `Heute Nachmittag & Nacht`;
  return `Heute Abend & Nacht`;
}

function formatEveningNight(weather: any, startHourOverride?: number) {
  const h = weather.hourly;
  if (!h?.time) return null;
  const today = weather.daily.time[0];
  const tomorrow = weather.daily.time[1];
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

  const hourAvg = (arrs: Record<string, number[]>, i: number): number | null => {
    const vals = Object.values(arrs).map((arr) => arr[i]).filter((v) => v != null && Number.isFinite(v));
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

  const sunshine_h = hourlySuns.length ? r1(hourlySuns.reduce((a, b) => a + b, 0) / 3600) : null;
  const daylightHours = slice.filter(({ t }) => {
    const hr = new Date(t).getHours();
    return hr >= 6 && hr < 21;
  }).length || 1;
  let cloudcover_avg: number | null = hourlyClouds.length ? Math.round(avg(hourlyClouds)) : null;
  let cloudcover_source: "model" | "derived_from_sunshine" | "none" = cloudcover_avg != null ? "model" : "none";
  if (cloudcover_avg == null && sunshine_h != null) {
    const ratio = Math.max(0, Math.min(1, sunshine_h / daylightHours));
    cloudcover_avg = Math.round((1 - ratio) * 100);
    cloudcover_source = "derived_from_sunshine";
  }

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

async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY fehlt");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`KI-Fehler ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ===== Topography =====
async function fetchElevationGrid(lat: number, lon: number, radiusKm: number) {
  const N = 10;
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const lats: number[] = [], lons: number[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const fx = (i / (N - 1)) * 2 - 1, fy = (j / (N - 1)) * 2 - 1;
    if (fx * fx + fy * fy > 1) continue;
    lats.push(+(lat + fy * dLat).toFixed(5));
    lons.push(+(lon + fx * dLon).toFixed(5));
  }
  if (!lats.length) return null;
  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const elevs: number[] = (data?.elevation ?? []).filter((v: any) => Number.isFinite(v));
    if (!elevs.length) return null;
    const sorted = [...elevs].sort((a, b) => a - b);
    return { min: Math.round(sorted[0]), max: Math.round(sorted[sorted.length - 1]), median: Math.round(sorted[Math.floor(sorted.length / 2)]) };
  } catch { return null; }
}

async function ensureTopography(settings: any) {
  const elev_ref = 434;
  if (settings?.topo_elev_min != null && settings?.topo_elev_max != null && settings?.topo_elev_median != null) {
    return { elev_min: settings.topo_elev_min, elev_max: settings.topo_elev_max, elev_median: settings.topo_elev_median, elev_ref };
  }
  const lat = settings?.location_lat ?? 47.5469;
  const lon = settings?.location_lon ?? 9.2986;
  const radius = settings?.radius_km ?? 15;
  const grid = await fetchElevationGrid(lat, lon, radius);
  if (!grid) return null;
  if (settings?.id) {
    await supabaseAdmin.from("app_settings").update({
      topo_elev_min: grid.min, topo_elev_max: grid.max, topo_elev_median: grid.median,
    }).eq("id", settings.id);
  }
  return { elev_min: grid.min, elev_max: grid.max, elev_median: grid.median, elev_ref };
}

function applyTopography(day: any, topo: any) {
  if (!topo || !day) return null;
  const tminRef = day.tmin?.avg, tmaxRef = day.tmax?.avg;
  const cloud = day.cloudcover?.avg ?? null, wind = day.wind_max?.avg ?? null;
  let classification: "strahlungsnacht" | "teilweise_klar" | "bedeckt" = "bedeckt";
  if (cloud != null && wind != null) {
    if (cloud <= 30 && wind <= 10) classification = "strahlungsnacht";
    else if (cloud <= 70 && wind <= 15) classification = "teilweise_klar";
  } else if (cloud != null) {
    if (cloud <= 30) classification = "strahlungsnacht";
    else if (cloud <= 70) classification = "teilweise_klar";
  }
  const lapse = classification === "bedeckt" ? -0.5 : -0.65;
  let tmax_warm: number | null = null;
  if (tmaxRef != null) {
    const dh = topo.elev_ref - topo.elev_min;
    tmax_warm = Math.round((tmaxRef + Math.abs(lapse) * dh / 100) * 10) / 10;
  }
  let tmin_cold: number | null = null, tmin_ridge: number | null = null;
  if (tminRef != null) {
    if (classification === "strahlungsnacht") {
      tmin_cold = Math.round((tminRef - 4) * 10) / 10;
      const dhUp = topo.elev_max - topo.elev_ref;
      tmin_ridge = Math.round((tminRef + Math.min(3, 1 + dhUp / 200)) * 10) / 10;
    } else if (classification === "teilweise_klar") {
      tmin_cold = Math.round((tminRef - 2) * 10) / 10;
      tmin_ridge = Math.round((tminRef + 1) * 10) / 10;
    } else {
      const dh = topo.elev_ref - topo.elev_min;
      tmin_cold = Math.round((tminRef + Math.abs(lapse) * dh / 100) * 10) / 10;
      const dhUp = topo.elev_max - topo.elev_ref;
      tmin_ridge = Math.round((tminRef - Math.abs(lapse) * dhUp / 100) * 10) / 10;
    }
  }
  return {
    elev_ref: topo.elev_ref, elev_min: topo.elev_min, elev_max: topo.elev_max, elev_median: topo.elev_median,
    classification, lapse_rate: lapse,
    tmin_cold, tmin_ridge,
    tmin_cold_label: classification === "strahlungsnacht" ? "Senken (Hudelmoos, Riedflächen)" : "Tiefste Lagen (Bodensee-Ufer)",
    tmin_ridge_label: "Höhenlagen (Hügelzüge)",
    tmax_warm, tmax_warm_label: "Sonnige Lagen am Bodensee-Ufer",
  };
}

// ===== MeteoSchweiz Stations-Bias (data.tg.ch) =====
const STATIONS = [
  { abbr: "GUT", name: "Güttingen", lat: 47.602, lon: 9.279, dataset: "meteoschweiz-ogd-13", role: "warm" as const },
  { abbr: "BIZ", name: "Bischofszell", lat: 47.498, lon: 9.236, dataset: "meteoschweiz-ogd-12", role: "cold" as const },
];

async function fetchStationMeasurements(dataset: string) {
  const url = new URL(`https://data.tg.ch/api/explore/v2.1/catalog/datasets/${dataset}/records`);
  url.searchParams.set("limit", "12");
  url.searchParams.set("order_by", "reference_timestamp desc");
  url.searchParams.set("select", "reference_timestamp,tre200dx,tre200dn");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.results ?? []).map((r: any) => ({
      date: (r.reference_timestamp ?? "").slice(0, 10),
      tmin: typeof r.tre200dn === "number" ? r.tre200dn : null,
      tmax: typeof r.tre200dx === "number" ? r.tre200dx : null,
    })).filter((r: any) => r.date);
  } catch { return []; }
}

async function fetchStationModelHistory(lat: number, lon: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Europe/Zurich");
  url.searchParams.set("past_days", "10");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return {} as Record<string, { tmin: number | null; tmax: number | null }>;
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
  } catch { return {} as Record<string, { tmin: number | null; tmax: number | null }>; }
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

async function buildStationBiases() {
  return Promise.all(STATIONS.map(async (st) => {
    const [measured, modeled] = await Promise.all([
      fetchStationMeasurements(st.dataset),
      fetchStationModelHistory(st.lat, st.lon),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const usable = measured.filter((m: any) => m.date < today && (m.tmin != null || m.tmax != null)).slice(0, 7);
    const diffsMin: number[] = [], diffsMax: number[] = [];
    for (const m of usable) {
      const fc = (modeled as any)[m.date];
      if (!fc) continue;
      if (fc.tmin != null && m.tmin != null) diffsMin.push(fc.tmin - m.tmin);
      if (fc.tmax != null && m.tmax != null) diffsMax.push(fc.tmax - m.tmax);
    }
    const meanOrZero = (arr: number[]) => arr.length >= 3 ? clampN(arr.reduce((a, b) => a + b, 0) / arr.length, -6, 6) : 0;
    const fresh = !!usable.length && (Date.parse(today) - Date.parse(usable[0].date)) / 86400000 <= 3;
    return {
      abbr: st.abbr, name: st.name, role: st.role, lat: st.lat, lon: st.lon,
      bias_tmin: fresh ? Math.round(meanOrZero(diffsMin) * 10) / 10 : 0,
      bias_tmax: fresh ? Math.round(meanOrZero(diffsMax) * 10) / 10 : 0,
      samples: Math.min(diffsMin.length, diffsMax.length),
      measured_yesterday: fresh ? usable[0] : null,
      forecast: modeled,
    };
  }));
}

function applyStationBias(day: any, biases: Awaited<ReturnType<typeof buildStationBiases>>) {
  if (!day || !day.date || !biases.length) return null;
  const stations: Record<string, any> = {};
  let coldest: number | null = null, warmest: number | null = null;
  for (const b of biases) {
    const fc = (b.forecast as any)[day.date];
    if (!fc) continue;
    const corrTmin = fc.tmin != null ? Math.round((fc.tmin - b.bias_tmin) * 10) / 10 : null;
    const corrTmax = fc.tmax != null ? Math.round((fc.tmax - b.bias_tmax) * 10) / 10 : null;
    stations[b.abbr] = {
      name: b.name, role: b.role, bias_tmin: b.bias_tmin, bias_tmax: b.bias_tmax,
      samples: b.samples, measured_yesterday: b.measured_yesterday,
      model_tmin: fc.tmin, model_tmax: fc.tmax,
      corrected_tmin: corrTmin, corrected_tmax: corrTmax,
    };
    if (corrTmin != null) coldest = coldest == null ? corrTmin : Math.min(coldest, corrTmin);
    if (corrTmax != null) warmest = warmest == null ? corrTmax : Math.max(warmest, corrTmax);
  }
  if (!Object.keys(stations).length) return null;
  return { stations, radius_tmin_corrected: coldest, radius_tmax_corrected: warmest };
}

export async function runAutoForecast(creatorId: string | null) {
  const { data: settings } = await supabaseAdmin.from("app_settings").select("*").limit(1).maybeSingle();
  const lat = settings?.location_lat ?? 47.5469;
  const lon = settings?.location_lon ?? 9.2986;
  const locationName = settings?.location_name ?? "Amriswil";
  const promptTemplate = buildSystemPrompt(settings);

  const weather = await fetchWeather(
    lat, lon,
    (settings as any)?.models_shortterm ?? undefined,
    (settings as any)?.models_midterm ?? undefined,
    (settings as any)?.models_longterm ?? undefined,
  );
  const topo = await ensureTopography(settings);
  const stationBiases = await buildStationBiases();
  const withTopo = (d: any) => {
    if (!d) return d;
    const out: any = { ...d, topography: applyTopography(d, topo) };
    const st = applyStationBias(d, stationBiases);
    if (st) out.stations = st;
    return out;
  };
  const today = weather.daily.time[0];

  const { data: forecast, error: fErr } = await supabaseAdmin
    .from("forecasts").insert({ forecast_date: today, status: "draft", created_by: creatorId, notes: "Auto-generiert (18:00)" })
    .select().single();
  if (fErr) throw new Error(fErr.message);

  const entries: Array<{ position: number; entry_date: string | null; title: string; body: string; weather_data: any; forecast_id: string }> = [];

  {
    const todayData = withTopo(formatDayData(weather, 0));
    const date = new Date(today);
    const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
    const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
    const firstTitle = `Heute, ${weekday} ${formatted}`;
    const body = enforceSkyConsistency(
      await generateText(promptTemplate, `Standort: ${locationName} (Radius 15 km). Schreibe einen Fliesstext für "${firstTitle}" auf Basis dieser Daten:\n${JSON.stringify(todayData, null, 2)}`),
      todayData,
    );
    entries.push({ position: 1, entry_date: today, title: firstTitle, body, weather_data: todayData, forecast_id: forecast.id });
  }
  for (let i = 1; i <= 5; i++) {
    const day = withTopo(formatDayData(weather, i));
    if (!day) continue;
    const date = new Date(day.date);
    const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
    const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
    const title = i === 1 ? `Morgen, ${weekday} ${formatted}` : `${weekday}, ${formatted}`;
    const body = enforceSkyConsistency(await generateText(promptTemplate, `Standort: ${locationName}. Schreibe einen Fliesstext für ${weekday}, ${formatted}:\n${JSON.stringify(day, null, 2)}`), day);
    entries.push({ position: i + 1, entry_date: day.date, title, body, weather_data: day, forecast_id: forecast.id });
  }
  {
    const trendDays = [5, 6, 7, 8, 9].map((i) => withTopo(formatDayData(weather, i))).filter(Boolean) as any[];
    if (trendDays.length) {
      const body = await generateText(promptTemplate, `Standort: ${locationName}. Schreibe einen kurzen Trend-Ausblick (3-4 Sätze) für Tage 6-10:\n${JSON.stringify(trendDays, null, 2)}`);
      entries.push({ position: 7, entry_date: trendDays[0].date, title: "Trend Tag 6 – 10", body, weather_data: trendDays, forecast_id: forecast.id });
    }
  }

  await supabaseAdmin.from("forecast_entries").insert(entries);
  return { forecastId: forecast.id, entries: entries.length };
}
