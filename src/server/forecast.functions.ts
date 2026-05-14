import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOrSetCache } from "./weather-cache.server";
import { fetchMosmixShortTerm } from "./mosmix.server";
import { fetchRadarSnapshot, buildRadarCorrection, type RadarSnapshot } from "./radar.server";
import { computeBiasCorrection, applyBiasToDay, type BiasResult } from "./bias-correction.server";
import { fetchNowcastInputs, computeNowcastResult, applyNowcastToDay, type NowcastResult } from "./nowcast.server";
import { fetchPressureGradient, type DayPressure } from "./pressure-gradient.server";
import { fetchSnowLine, type DaySnowLine } from "./snow-line.server";
import { fetchOpenMeteo as fetchOMTracked } from "./openmeteo-quota.server";
import { generateTextNominal as runNominal } from "./nominal-style.server";
import { fetchSynopticTrend, buildTrendUserPrompt } from "./synoptic-trend.server";

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

// Hängt Druckgradient + Schneefallgrenze ans Tagesobjekt, wenn vorhanden.
function applyRegimeToDay(
  out: any,
  pressureByDate: Map<string, DayPressure>,
  snowByDate: Map<string, DaySnowLine>,
) {
  if (!out?.date) return;
  const wr = pressureByDate.get(out.date);
  if (wr) {
    out.wind_regime = {
      class: wr.class,
      label: wr.label,
      dp_foehn: wr.dp_foehn,
      dp_bise: wr.dp_bise,
    };
  }
  const sn = snowByDate.get(out.date);
  if (sn && sn.class !== "none") {
    out.snow_line = {
      class: sn.class,
      label: sn.label,
      freezing_min: sn.freezing_min,
      freezing_avg: sn.freezing_avg,
      freezing_max: sn.freezing_max,
      snow_line_min: sn.snow_line_min,
    };
  }
}
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
  "wind_gusts_10m_max",
  "winddirection_10m_dominant",
  "sunshine_duration",
  "weathercode",
  "cloudcover_mean",
];
const HOURLY_VARS = ["temperature_2m", "precipitation", "precipitation_probability", "cloudcover", "cloudcover_low", "cloudcover_mid", "cloudcover_high", "windspeed_10m", "winddirection_10m", "wind_gusts_10m", "weathercode", "sunshine_duration", "dewpoint_2m", "relativehumidity_2m", "cape", "lifted_index"];

// ===== Wind helpers =====
// Region Oberthurgau: hochauflösende MeteoSwiss-/Météo-France-Modelle bilden den
// Wind hier zuverlässiger ab. Statt eines ungewichteten Mittels gewichten wir.
const WIND_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.40,
  meteoswiss_icon_ch2: 0.30,
  meteofrance_arome_france_hd: 0.20,
  arpege_europe: 0.10,
};
function weightedWindAvg(perModel: Record<string, number>): { avg: number; weights_used: Record<string, number> } | null {
  const entries = Object.entries(perModel).filter(([k, v]) => k in WIND_WEIGHTS && Number.isFinite(v));
  if (!entries.length) return null;
  const totalW = entries.reduce((s, [k]) => s + WIND_WEIGHTS[k], 0);
  if (totalW <= 0) return null;
  const avg = entries.reduce((s, [k, v]) => s + v * (WIND_WEIGHTS[k] / totalW), 0);
  const weights_used: Record<string, number> = {};
  for (const [k] of entries) weights_used[k] = Math.round((WIND_WEIGHTS[k] / totalW) * 100) / 100;
  return { avg: Math.round(avg * 10) / 10, weights_used };
}
function weightedCircularMeanDeg(perModel: Record<string, number>): number | null {
  const entries = Object.entries(perModel).filter(([k, v]) => k in WIND_WEIGHTS && Number.isFinite(v));
  if (!entries.length) return null;
  const totalW = entries.reduce((s, [k]) => s + WIND_WEIGHTS[k], 0);
  if (totalW <= 0) return null;
  let x = 0, y = 0;
  for (const [k, deg] of entries) {
    const w = WIND_WEIGHTS[k] / totalW;
    const r = (deg * Math.PI) / 180;
    x += w * Math.cos(r); y += w * Math.sin(r);
  }
  if (x === 0 && y === 0) return null;
  let d = (Math.atan2(y, x) * 180) / Math.PI;
  if (d < 0) d += 360;
  return Math.round(d);
}
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

/**
 * Deterministische Himmels-Klassifikation basierend auf Modelldaten.
 * Liefert IMMER ein sky_label + sky_pattern, damit die KI keine widersprüchlichen
 * "sonnig"-Aussagen erfinden kann, wenn Niederschlag/Bewölkung dagegen sprechen.
 */
function classifySky(data: any): { sky_label: string; sky_pattern: string } {
  const cloud = typeof data?.cloudcover?.avg === "number" ? data.cloudcover.avg : null;
  const sun = typeof data?.sunshine_h?.avg === "number" ? data.sunshine_h.avg : null;
  const wc = typeof data?.weathercode?.avg === "number" ? data.weathercode.avg : null;
  const pp = typeof data?.precip_prob?.avg === "number" ? data.precip_prob.avg : null;
  const thunder = data?.thunderstorm?.class;
  const thunderActive = thunder && thunder !== "none";
  const dist = data?.precip_distribution;
  const blocks = dist?.blocks ?? null;
  const layers = data?.cloud_layers ?? null;
  const layersOk = layers?.has_data === true;
  const cLow = layersOk ? layers.day?.low ?? null : null;
  const cMid = layersOk ? layers.day?.mid ?? null : null;
  const cHigh = layersOk ? layers.day?.high ?? null : null;
  const cLowMorn = layersOk ? layers.morning?.low ?? null : null;

  // 0. Hohe Schleierwolken bei sonst klarem Himmel — Sonne scheint milchig durch.
  // Trigger: viel hohe Bewölkung, aber kaum tiefe/mittlere Wolken und nennenswert Sonne.
  if (
    layersOk
    && cHigh != null && cHigh >= 60
    && (cLow ?? 0) <= 30
    && (cMid ?? 0) <= 40
    && (sun == null || sun >= 5)
    && (pp == null || pp < 40)
  ) {
    return { sky_label: "Sonne durch hohe Schleierwolken, oft milchig", sky_pattern: "schleierwolken_sonnig" };
  }

  // 1. Sonnig & wolkenlos
  if (cloud != null && sun != null && cloud <= 5 && sun >= 10) {
    return { sky_label: "Sonnig und wolkenlos", sky_pattern: "sonnig_klar" };
  }

  // 1b. Tagesgang aus Niederschlagsverteilung — VOR der pauschalen Schauer-Regel.
  // Nur sinnvoll, wenn nennenswerter Tagesniederschlag (≥ 1.5 mm) vorhanden ist.
  if (blocks) {
    const mm = (k: string) => blocks[k]?.precip_mm ?? 0;
    const total = mm("night") + mm("morning") + mm("afternoon") + mm("evening");
    if (total >= 1.5) {
      const morn = mm("morning"), aft = mm("afternoon"), eve = mm("evening"), night = mm("night");
      const mornFrac = morn / total;
      const aftFrac = aft / total;
      const eveFrac = eve / total;
      // Frühabbruch: Niederschlag vor allem nachts/morgens, danach trocken
      if ((mornFrac + (night / total)) >= 0.6 && aft < 1 && eve < 1 && (sun == null || sun >= 4)) {
        return {
          sky_label: thunderActive
            ? "Anfangs Regen oder Schauer, später Auflockerung mit lokaler Gewitterneigung"
            : "Anfangs Regen oder Schauer, später trocken und freundlicher",
          sky_pattern: "frueh_regen_dann_sonne",
        };
      }
      // Niederschlag erst am Abend
      if (eveFrac >= 0.6 && morn < 1 && aft < 1) {
        return {
          sky_label: thunderActive
            ? "Tagsüber meist trocken, gegen Abend Schauer oder Gewitter"
            : "Tagsüber meist trocken, gegen Abend Regen oder Schauer",
          sky_pattern: "spaet_regen",
        };
      }
      // Konvektive Nachmittags-Schauer
      if (aftFrac >= 0.55 && morn < 1 && (sun == null || sun >= 5)) {
        return {
          sky_label: thunderActive
            ? "Vormittags freundlich, am Nachmittag einzelne Schauer oder Gewitter"
            : "Vormittags freundlich, am Nachmittag einzelne Schauer",
          sky_pattern: "nachmittag_konvektiv",
        };
      }
    }
  }

  // 2. Schauer-dominant (kräftiger Niederschlag)
  if ((wc != null && wc >= 80) || (pp != null && wc != null && pp >= 70 && wc >= 60)) {
    return {
      sky_label: thunderActive
        ? "Stark bewölkt mit Schauern und Gewitterneigung"
        : "Stark bewölkt mit Schauern",
      sky_pattern: "schauer_dominant",
    };
  }

  // 3. Regnerisch / bewölkt mit Niederschlagssignal
  if (pp != null && wc != null && pp >= 60 && wc >= 51) {
    return {
      sky_label: thunderActive
        ? "Stark bewölkt mit zeitweisem Regen und lokaler Gewitterneigung"
        : "Stark bewölkt mit zeitweisem Regen",
      sky_pattern: "regnerisch_bewoelkt",
    };
  }

  // 4. Bedeckt — mit Hochnebel-Hinweis, wenn tiefe Bewölkung dominiert.
  if (cloud != null && sun != null && cloud >= 80 && sun <= 4) {
    if (layersOk && cLow != null && cLow >= 80 && (cMid ?? 0) < 70 && (cHigh ?? 0) < 70) {
      return { sky_label: "Trüb durch Hochnebel oder Stratusdecke", sky_pattern: "hochnebel_truebe" };
    }
    return { sky_label: "Stark bewölkt bis bedeckt", sky_pattern: "bedeckt" };
  }

  // 4b. Hochnebel-Lage ohne Niederschlag, aber mit deutlicher tiefer Bewölkung morgens
  // (Auflösung wird separat über detectFogDissipation/sky_label überschrieben).
  if (
    layersOk
    && cLowMorn != null && cLowMorn >= 80
    && (sun == null || sun < 5)
    && (pp == null || pp < 40)
  ) {
    return { sky_label: "Tiefe Wolkendecke, vielfach trüb", sky_pattern: "hochnebel_lage" };
  }

  // 5. Überwiegend sonnig
  if (sun != null && cloud != null && sun >= 8 && cloud <= 30) {
    return { sky_label: "Ziemlich sonnig", sky_pattern: "ueberwiegend_sonnig" };
  }

  // 6. Wechselnd bewölkt
  if ((cloud != null && cloud >= 60) || (sun != null && sun < 4)) {
    return { sky_label: "Wechselnd bewölkt", sky_pattern: "wechselnd_bewoelkt" };
  }

  // 7. Default
  return { sky_label: "Heiter bis wolkig", sky_pattern: "heiter_bis_wolkig" };
}

function replaceFirstParagraph(text: string, firstParagraph: string): string {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return firstParagraph;
  paragraphs[0] = firstParagraph;
  return paragraphs.join("\n\n");
}

function isFogMajority(weatherData: any): boolean {
  const byModel = weatherData?.weathercode?.by_model;
  if (!byModel) return false;
  const vals = Object.values(byModel).filter((v) => v != null);
  if (!vals.length) return false;
  const fogCount = vals.filter((v) => v === 45 || v === 48).length;
  return fogCount / vals.length > 0.5;
}

function buildDeterministicSkyParagraph(weatherData: any): string | null {
  const profile = (weatherData?.hourly_profile ?? []) as Array<{ h: number; c?: number | null; s?: number | null; p?: number | null; pp?: number | null }>;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sunshineAvg = weatherData?.sunshine_h?.avg;
  const ppAvg = weatherData?.precip_prob?.avg;
  const wcAvg = weatherData?.weathercode?.avg;
  const precipAvg = weatherData?.precip?.avg;
  const thunderClass = weatherData?.thunderstorm?.class;
  const thunderActive = thunderClass && thunderClass !== "none";
  const skyPattern = weatherData?.sky_pattern;
  const skyLabel = weatherData?.sky_label;
  const fogMajority = isFogMajority(weatherData);

  // SCHUTZ: Wenn die Daten klar Niederschlag/Gewitter zeigen, dürfen wir den
  // KI-Text NICHT mit einer pauschalen "sonnig"-Variante überschreiben. Die
  // KI hat dann bereits das sky_label übernommen — wir lassen sie in Ruhe.
  const wetSignal =
    (typeof ppAvg === "number" && ppAvg >= 50) ||
    (typeof wcAvg === "number" && wcAvg >= 51) ||
    (typeof precipAvg === "number" && precipAvg >= 1) ||
    thunderActive ||
    skyPattern === "schauer_dominant" ||
    skyPattern === "regnerisch_bewoelkt" ||
    skyPattern === "bedeckt" ||
    (typeof skyLabel === "string" && /Regen|Schauer|Gewitter|bedeckt/i.test(skyLabel));

  if (wetSignal) {
    // Reiner Nebeltag bleibt als Spezialfall erlaubt (kein Niederschlag).
    if (fogMajority && !((typeof ppAvg === "number" && ppAvg >= 50) || thunderActive)) {
      return "Verbreitet Nebel- oder Hochnebelfelder, nur zögerliche Aufhellungen.";
    }
    return null;
  }

  if (!profile.length) {
    if (fogMajority) return "Verbreitet Nebel- oder Hochnebelfelder, nur zögerliche Aufhellungen.";
    return null;
  }

  const early = profile.filter((r) => r.h >= 6 && r.h <= 7);
  const day = profile.filter((r) => r.h >= 8 && r.h <= 18);
  const afternoon = profile.filter((r) => r.h >= 15 && r.h <= 20);
  const earlyCloud = avg(early.map((r) => r.c).filter((v): v is number => v != null));
  const earlySun = avg(early.map((r) => r.s ?? 0));
  const sunnyHours = day.filter((r) => (r.s ?? 0) >= 30).length;
  const afternoonCloud = avg(afternoon.map((r) => r.c).filter((v): v is number => v != null));
  const fogByModel = weatherData?.weathercode?.by_model
    ? Object.values(weatherData.weathercode.by_model).some((v) => v === 45 || v === 48)
    : false;
  const fogMorning = skyPattern === "nebel_aufloesung"
    || weatherData?.fog_dissipation != null
    || (fogByModel && (earlyCloud ?? 0) >= 85 && (earlySun ?? 99) <= 10 && (sunnyHours >= 3 || (sunshineAvg ?? 0) >= 5));
  const verySunny = (sunshineAvg ?? 0) >= 9 || sunnyHours >= 7;
  if (!fogMorning && !verySunny && !fogMajority) return null;

  if (fogMajority && !verySunny && !fogMorning) {
    return "Verbreitet Nebel- oder Hochnebelfelder, nur zögerliche Aufhellungen.";
  }

  const start = (fogMorning || fogMajority)
    ? "Am Morgen verbreitet Nebel- oder Hochnebelfelder."
    : "Am Morgen zunächst stark bewölkt.";
  const middle = verySunny
    ? "Im weiteren Verlauf des Vormittags rasche Auflösung, danach recht sonnig."
    : "Im Tagesverlauf Auflockerungen und zeitweise sonnige Abschnitte.";
  const end = (afternoonCloud ?? 0) >= 70
    ? "Am Nachmittag und Abend zeitweise dichtere Wolkenfelder, daneben weiterhin sonnige Abschnitte."
    : "Am Nachmittag und Abend weiterhin recht sonnig mit einzelnen Wolkenfeldern.";
  return [start, middle, end].join(" ");
}

function enforceFogWording(text: string, weatherData: any): string {
  if (!isFogMajority(weatherData)) return text;
  if (/Nebel|Hochnebel/i.test(text)) return text;
  // Ersten Treffer von "stark bewölkt" / "bedeckt" / "trübe" / "grau in grau" ersetzen
  return text.replace(
    /\b(stark bewölkt|bedeckt|trübe|grau in grau)\b/i,
    "Nebel- oder Hochnebelfelder",
  );
}

function enforceSkyConsistency(text: string, weatherData: any): string {
  const deterministicSky = buildDeterministicSkyParagraph(weatherData);
  let out = text;
  if (deterministicSky) out = replaceFirstParagraph(text, deterministicSky);
  else if (isClearSkyDay(weatherData)) out = replaceFirstParagraph(text, "Sonnig und wolkenlos.");
  return enforceFogWording(out, weatherData);
}

// Tag-0-Nachmittagseintrag darf KEINE Tiefstwerte enthalten. Entfernt
// entsprechende Sätze/Absätze nach der KI-Generierung als Sicherheitsnetz.
export function stripTiefstwerteForAfternoon(text: string, title: string): string {
  if (title !== "Heute Nachmittag & Abend") return text;
  const tiefRe = /(Tiefstwerte?|Tiefste Werte|Bodenfrost(?:gefahr)?|In den Senken[^.]*|Frostgefahr in den Senken)[^.]*\.\s*/gi;
  const paragraphs = text.split(/\n\n+/).map((p) => {
    // Satz-für-Satz: Tiefstwerte-Sätze raus, andere bleiben.
    const cleaned = p.replace(tiefRe, "").replace(/\s{2,}/g, " ").trim();
    return cleaned;
  }).filter((p) => p.length > 0);
  return paragraphs.join("\n\n");
}

// Nominalstil-Enforcement: Helper aus shared module (siehe nominal-style.server.ts).
async function generateTextNominal(systemPrompt: string, userPrompt: string): Promise<string> {
  return runNominal(systemPrompt, userPrompt, generateText);
}

// Frostwarnung deterministisch erzwingen.
// Bei tmin ≤ 0 °C → " - Frostgefahr in den Senken." anhängen.
// Bei tmin ≤ 4 °C → " - Bodenfrostgefahr." anhängen.
// Quelle (Priorität): stations.BIZ.corrected_tmin → topography.tmin_cold → tmin.avg
export function enforceFrostWarning(text: string, weatherData: any): string {
  if (!text || !weatherData) return text;
  const candidates: Array<number | null | undefined> = [
    weatherData?.stations?.stations?.BIZ?.corrected_tmin,
    weatherData?.stations?.BIZ?.corrected_tmin,
    weatherData?.topography?.tmin_cold,
    weatherData?.tmin?.avg,
  ];
  let tmin: number | null = null;
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) { tmin = c; break; }
  }
  if (tmin == null) return text;
  let suffix: string | null = null;
  if (tmin <= 0) suffix = " - Frostgefahr in den Senken.";
  else if (tmin <= 4) suffix = " - Bodenfrostgefahr.";
  if (!suffix) return text;
  // Schon vorhanden?
  if (/Bodenfrostgefahr\.|Frostgefahr in den Senken\./i.test(text)) return text;
  // Ersten Tiefstwerte-Satz finden und anhängen.
  const re = /((?:Tiefstwerte?|Tiefste Werte)[^.!?]*?)(\.)(\s|$)/;
  const m = text.match(re);
  if (!m) return text;
  const replaced = text.replace(re, `$1${suffix}$3`);
  console.log(`frost-enforce: appended "${suffix.trim()}" for tmin=${tmin}`);
  return replaced;
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
    const res = await fetchOMTracked(url, "elevation");
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
    const res = await fetchOMTracked(url, "historical_bias");
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

// Typed Open-Meteo error: distinguishes daily/hourly/minutely quota from
// transient errors. Callers react with different negative-cache TTLs.
export type OpenMeteoErrorCode =
  | "RATE_LIMIT_DAILY"
  | "RATE_LIMIT_HOURLY"
  | "RATE_LIMIT_MINUTELY"
  | "OTHER";
class OpenMeteoError extends Error {
  code: OpenMeteoErrorCode;
  constructor(message: string, code: OpenMeteoErrorCode) {
    super(message);
    this.code = code;
  }
}

// Classify an Open-Meteo 429 response body into the correct rate-limit tier.
// Open-Meteo returns "Minutely|Hourly|Daily API request limit exceeded".
function classify429(body: string): OpenMeteoErrorCode {
  if (/daily/i.test(body)) return "RATE_LIMIT_DAILY";
  if (/hourly/i.test(body)) return "RATE_LIMIT_HOURLY";
  // Treat unknown 429 ("limit exceeded" without scope, or generic) as minutely burst.
  return "RATE_LIMIT_MINUTELY";
}

function ttlForRateLimit(code: OpenMeteoErrorCode): number {
  // milliseconds
  switch (code) {
    case "RATE_LIMIT_DAILY":   return -1; // sentinel → use UTC midnight
    case "RATE_LIMIT_HOURLY":  return 30 * 60 * 1000;
    case "RATE_LIMIT_MINUTELY": return 2 * 60 * 1000;
    default: return 2 * 60 * 1000;
  }
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
    const res = await fetchOMTracked(url, "forecast");
    if (res.ok) return await res.json();
    lastError = await res.text().catch(() => "");
    // 429 → classify as daily/hourly/minutely; don't retry, mark with appropriate TTL
    if (res.status === 429) {
      const code = classify429(lastError);
      console.warn(`[open-meteo] 429 ${code} (models=${normalizedModels}) — body: ${lastError.slice(0, 200)}`);
      throw new OpenMeteoError(
        `Open-Meteo Rate-Limit (${code}, models=${normalizedModels}): ${lastError}`,
        code,
      );
    }
    const retryable = res.status >= 500;
    if (!retryable || attempt === 2) {
      throw new OpenMeteoError(
        `Open-Meteo Fehler ${res.status} (models=${normalizedModels})${lastError ? `: ${lastError}` : ""}`,
        "OTHER",
      );
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1));
  }
  throw new OpenMeteoError(
    `Open-Meteo Fehler (models=${normalizedModels})${lastError ? `: ${lastError}` : ""}`,
    "OTHER",
  );
}

// Negative-cache marker for rate-limited model sets. Stored in weather_cache until next UTC midnight
// (= Open-Meteo daily quota reset). Avoids hammering Open-Meteo when the daily quota is exhausted.
function rateLimitCacheKey(models: string) {
  return `om:ratelimit:${normalizeModels(models)}`;
}

// Open-Meteo zählt Calls pro UTC-Tag. Reset = 00:00 UTC.
function nextUtcMidnightIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  // Sanity-Cap: nie mehr als 24h voraus (Schutz gegen Clock-Drift).
  const capped = Math.min(d.getTime(), Date.now() + 24 * 60 * 60 * 1000);
  return new Date(capped).toISOString();
}

async function fetchOpenMeteoOptional(lat: number, lon: number, models: string, includeHourly: boolean) {
  // Check negative cache first — skip the HTTP call entirely if recently rate-limited.
  const negKey = rateLimitCacheKey(models);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("weather_cache")
      .select("expires_at")
      .eq("cache_key", negKey)
      .maybeSingle();
    if (data?.expires_at && data.expires_at > new Date().toISOString()) {
      console.warn(`[open-meteo] skipping ${models} — rate-limit cache active until ${data.expires_at}`);
      return null;
    }
  } catch (e) {
    // Cache lookup failed — proceed with the call.
  }

  try {
    return await fetchOpenMeteo(lat, lon, models, includeHourly);
  } catch (e) {
    console.warn(e instanceof Error ? e.message : e);
    // On rate-limit errors, set a negative-cache marker with TTL based on tier:
    //  daily → bis 00:00 UTC, hourly → 30 min, minutely → 2 min.
    if (
      e instanceof OpenMeteoError &&
      (e.code === "RATE_LIMIT_DAILY" ||
        e.code === "RATE_LIMIT_HOURLY" ||
        e.code === "RATE_LIMIT_MINUTELY")
    ) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ttlMs = ttlForRateLimit(e.code);
        const expiresAt =
          ttlMs < 0 ? nextUtcMidnightIso() : new Date(Date.now() + ttlMs).toISOString();
        console.warn(`[open-meteo] negative-cache ${e.code} for ${models} → expires ${expiresAt}`);
        await supabaseAdmin.from("weather_cache").upsert({
          cache_key: rateLimitCacheKey(models),
          payload: { rate_limited: true, models, code: e.code },
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
      } catch (cacheErr) {
        console.warn("[open-meteo] failed to write rate-limit marker", cacheErr);
      }
    }
    return null;
  }
}

// Returns a unified weather object with `daily` (timeline) and `byModel` (per-model values)
async function fetchWeather(
  lat: number,
  lon: number,
  shortModels = "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2",
  midModels = "meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global",
  longModels = "ecmwf_ifs025,gfs_global,icon_eu"
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
  if (!daily) {
    // All Open-Meteo tiers failed. Throw a typed error so the generation path
    // can decide whether to fall back to MOSMIX-only mode.
    const err = new Error(
      "Open-Meteo liefert aktuell keine Wetterdaten (vermutlich Tageslimit erreicht).",
    ) as Error & { code?: string };
    err.code = "WEATHER_UNAVAILABLE";
    throw err;
  }
  return {
    daily,
    hourly: shortData?.hourly, // hourly only from short-term (CH-models, finest grid)
    byModel: { short: shortData, mid: midData, long: longData },
    modelLists: { short: shortModels, mid: midModels, long: longModels },
  };
}

// Builds a minimal weather-shaped object from MOSMIX-only data when Open-Meteo is unavailable.
// Returns null when MOSMIX has nothing for today/tomorrow either.
// The returned object is compatible enough with formatDayData/buildFirstEntryContext that
// the generation path keeps working — but only Tag 0 + Tag 1 are populated.
function buildMosmixOnlyWeather(
  mosmixByDate: Map<string, any>,
): { daily: any; hourly: any; byModel: any; modelLists: any; degraded_mode: "mosmix_only" } | null {
  const dates = Array.from(mosmixByDate.keys()).sort();
  if (!dates.length) return null;
  // Build a daily object with the variables formatDayData looks for.
  const daily: any = { time: dates };
  const allVars = [...DAILY_VARS];
  for (const v of allVars) daily[v] = dates.map(() => null);
  for (let i = 0; i < dates.length; i++) {
    const m = mosmixByDate.get(dates[i]);
    if (!m) continue;
    daily.temperature_2m_max[i] = m.tmax?.avg ?? null;
    daily.temperature_2m_min[i] = m.tmin?.avg ?? null;
    daily.precipitation_sum[i] = m.precip?.avg ?? null;
    daily.precipitation_probability_max[i] = m.precip_prob?.avg ?? null;
    daily.windspeed_10m_max[i] = m.wind_max?.avg ?? null;
    daily.winddirection_10m_dominant[i] = m.wind_dir_avg ?? null;
    daily.sunshine_duration[i] = m.sunshine_h?.avg != null ? m.sunshine_h.avg * 3600 : null;
    daily.cloudcover_mean[i] = m.cloudcover?.avg ?? null;
    daily.weathercode[i] = null;
  }
  return {
    daily,
    hourly: undefined, // no hourly data in MOSMIX-only mode → "rest of day" entry uses day aggregate
    byModel: { short: { daily }, mid: null, long: null },
    modelLists: { short: "mosmix", mid: "", long: "" },
    degraded_mode: "mosmix_only",
  };
}

// Tries Open-Meteo first; on total failure falls back to MOSMIX-only mode (Tag 0+1).
// Throws a user-facing error only when both sources are empty. Returns the MOSMIX
// map alongside `weather` so callers don't fetch it twice.
async function fetchWeatherWithFallback(
  lat: number, lon: number,
  shortModels: string | undefined,
  midModels: string | undefined,
  longModels: string | undefined,
  mosmixEnabled: boolean,
  mosmixStations: string[],
): Promise<{ weather: any; mosmixByDate: Map<string, any>; degraded: boolean }> {
  // Fetch MOSMIX in parallel with Open-Meteo so we have it ready for fallback.
  const mosmixPromise: Promise<Map<string, any>> = mosmixEnabled && mosmixStations.length
    ? fetchMosmixShortTerm(mosmixStations).catch((e) => {
        console.warn("MOSMIX failed:", e);
        return new Map<string, any>();
      })
    : Promise.resolve(new Map<string, any>());

  try {
    const [weather, mosmixByDate] = await Promise.all([
      fetchWeather(lat, lon, shortModels, midModels, longModels),
      mosmixPromise,
    ]);
    return { weather, mosmixByDate, degraded: false };
  } catch (e: any) {
    if (e?.code !== "WEATHER_UNAVAILABLE") throw e;
    // Open-Meteo komplett ausgefallen — MOSMIX-only Modus versuchen.
    const mosmixByDate = await mosmixPromise;
    const fallback = buildMosmixOnlyWeather(mosmixByDate);
    if (!fallback) {
      throw new Error(
        "Open-Meteo Tageslimit erreicht und DWD-MOSMIX liefert ebenfalls keine Daten. Bitte morgen erneut versuchen.",
      );
    }
    console.warn("[forecast] degraded mode: MOSMIX-only (Open-Meteo unavailable)");
    return { weather: fallback, mosmixByDate, degraded: true };
  }
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

// Modell-Gewichte für Ensemble-Mittelung. Globale Modelle (GFS) sind im
// Voralpenraum deutlich gröber als die hochauflösenden europäischen Modelle
// und bekommen daher weniger Gewicht. Default für unbekannte Modelle = 1.0.
// =====================================================================
// Wetterlagen-abhängige Modell-Gewichtung
// =====================================================================
type ModelKey = "icon_ch1" | "icon_ch2" | "arome" | "arpege" | "ecmwf" | "gfs" | "other";
type Regime = "convective" | "frontal_west" | "bise_ne" | "stable_high" | "default";
type VarGroup = "precip" | "temp" | "wind" | "other";
type Horizon = "h0_12" | "h12_24" | "h24_48" | "h48_plus";

function modelKey(name: string): ModelKey {
  const n = name.toLowerCase();
  if (n.includes("icon_ch1")) return "icon_ch1";
  if (n.includes("icon_ch2")) return "icon_ch2";
  if (n.includes("arome")) return "arome";
  if (n.includes("arpege")) return "arpege";
  if (n.includes("ecmwf")) return "ecmwf";
  if (n.includes("gfs")) return "gfs";
  return "other";
}

function varGroup(varName?: string): VarGroup {
  if (!varName) return "other";
  if (varName.includes("precipitation") || varName === "weathercode") return "precip";
  if (varName.includes("temperature") || varName.includes("dewpoint")) return "temp";
  if (varName.includes("wind") || varName.includes("gust")) return "wind";
  return "other";
}

const REGIME_WEIGHTS: Record<Regime, Record<ModelKey, number>> = {
  convective:   { icon_ch1: 1.6, icon_ch2: 1.1, arome: 1.4, arpege: 0.7, ecmwf: 0.7, gfs: 0.5, other: 1.0 },
  frontal_west: { icon_ch1: 1.0, icon_ch2: 1.1, arome: 1.5, arpege: 1.3, ecmwf: 0.9, gfs: 0.6, other: 1.0 },
  bise_ne:      { icon_ch1: 1.3, icon_ch2: 1.4, arome: 0.8, arpege: 1.1, ecmwf: 0.9, gfs: 0.6, other: 1.0 },
  stable_high:  { icon_ch1: 1.0, icon_ch2: 1.1, arome: 0.9, arpege: 1.2, ecmwf: 1.4, gfs: 0.7, other: 1.0 },
  default:      { icon_ch1: 1.0, icon_ch2: 1.0, arome: 1.0, arpege: 1.0, ecmwf: 1.0, gfs: 0.5, other: 1.0 },
};

const VAR_MODIFIERS: Record<VarGroup, Partial<Record<ModelKey, number>>> = {
  precip: { arome: 1.1, icon_ch1: 1.1 },
  temp:   { ecmwf: 1.1 },
  wind:   { arpege: 1.1, icon_ch2: 1.1 },
  other:  {},
};

// Horizont-basierte Gewichte: kurzfristig dominieren regionale, hochaufgelöste Modelle;
// globale Modelle (ECMWF, GFS) tragen erst ab Tag +1/+2 bei. Gewicht 0 = Modell wird
// vollständig aus dem Aggregat (inkl. min/max/spread/percentile) ausgeschlossen.
const HORIZON_WEIGHTS: Record<Horizon, Record<ModelKey, number>> = {
  h0_12:    { icon_ch1: 1.6, icon_ch2: 1.4, arome: 1.0, arpege: 1.2, ecmwf: 0.0, gfs: 0.0, other: 1.0 },
  h12_24:   { icon_ch1: 1.5, icon_ch2: 1.3, arome: 0.9, arpege: 1.2, ecmwf: 0.0, gfs: 0.0, other: 1.0 },
  h24_48:   { icon_ch1: 1.3, icon_ch2: 1.2, arome: 0.8, arpege: 1.2, ecmwf: 0.6, gfs: 0.4, other: 1.0 },
  h48_plus: { icon_ch1: 1.0, icon_ch2: 1.0, arome: 0.6, arpege: 1.1, ecmwf: 1.0, gfs: 0.7, other: 1.0 },
};

function combinedWeight(name: string, opts?: { variable?: string; regime?: Regime; horizon?: Horizon }): number {
  const k = modelKey(name);
  const r = opts?.regime ?? "default";
  const h = opts?.horizon;
  const base = REGIME_WEIGHTS[r][k] ?? 1.0;
  const mod = VAR_MODIFIERS[varGroup(opts?.variable)][k] ?? 1.0;
  const horiz = h ? (HORIZON_WEIGHTS[h][k] ?? 1.0) : 1.0;
  return base * mod * horiz;
}

// Backwards-compatible alias used by older call sites.
function regimeWeight(name: string, variable?: string, regime?: Regime): number {
  return combinedWeight(name, { variable, regime });
}

// Bestimmt den Vorhersage-Horizont eines Tages relativ zu jetzt (Tagesmitte 12:00 UTC als Anker).
function horizonForDay(weather: any, dayIndex: number): Horizon {
  const dateStr = weather?.daily?.time?.[dayIndex];
  if (!dateStr) return "h48_plus";
  const dayMid = new Date(`${dateStr}T12:00:00Z`).getTime();
  const diffH = (dayMid - Date.now()) / 3_600_000;
  if (diffH < 6) return "h0_12";       // heute, Tagesmitte schon nahe/vorbei
  if (diffH < 18) return "h12_24";     // heute später Tag
  if (diffH < 42) return "h24_48";     // morgen
  return "h48_plus";
}

// Bestimmt den Horizont für eine konkrete Stunde (ISO-String).
function horizonForHour(hourIso: string): Horizon {
  const t = new Date(hourIso).getTime();
  if (!Number.isFinite(t)) return "h48_plus";
  const diffH = (t - Date.now()) / 3_600_000;
  if (diffH < 12) return "h0_12";
  if (diffH < 24) return "h12_24";
  if (diffH < 48) return "h24_48";
  return "h48_plus";
}

// Klassifiziert die Tages-Wetterlage aus bereits vorhandenen Daten.
// Verwendet ungewichtete Mittelwerte, damit keine Henne-Ei-Situation entsteht.
function classifyRegime(weather: any, dayIndex: number): Regime {
  const meanOf = (rec: Record<string, number>): number | null => {
    const vals = Object.values(rec).filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const cape = aggregateHourlyForDay(weather, dayIndex, "cape", "max", 8, 22)?.value ?? 0;
  const li = aggregateHourlyForDay(weather, dayIndex, "lifted_index", "min", 8, 22)?.value;
  if (cape > 800 || (li != null && li < -2)) return "convective";

  const wind = meanOf(collectModelValuesTiered(weather, "windspeed_10m_max", dayIndex)) ?? 0;
  const dirVals = Object.values(collectModelValuesTiered(weather, "winddirection_10m_dominant", dayIndex));
  const dir = circularMeanDeg(dirVals as number[]) ?? 0;
  const precip = meanOf(collectModelValuesTiered(weather, "precipitation_sum", dayIndex)) ?? 0;
  const cloud = meanOf(collectModelValuesTiered(weather, "cloudcover_mean", dayIndex)) ?? 50;

  if (precip > 5 && dir >= 200 && dir <= 290) return "frontal_west";
  if (wind > 25 && dir >= 30 && dir <= 80) return "bise_ne";
  if (cloud < 30 && precip < 0.5 && wind < 15) return "stable_high";
  return "default";
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function classifyUncertainty(spreadVal: number, scale: "temp" | "precip" | "wind"): "low" | "moderate" | "high" {
  if (scale === "temp") {
    if (spreadVal >= 5) return "high";
    if (spreadVal >= 2.5) return "moderate";
    return "low";
  }
  if (scale === "precip") {
    if (spreadVal >= 8) return "high";
    if (spreadVal >= 3) return "moderate";
    return "low";
  }
  // wind
  if (spreadVal >= 25) return "high";
  if (spreadVal >= 12) return "moderate";
  return "low";
}

function aggregate(
  perModel: Record<string, number>,
  opts?: { variable?: string; regime?: Regime; horizon?: Horizon },
) {
  const allEntries = Object.entries(perModel);
  if (!allEntries.length) return null;
  // Modelle mit horizont-Gewicht 0 vollständig ausschliessen (auch aus min/max/spread).
  const entries = allEntries.filter(([name]) => combinedWeight(name, opts) > 0);
  const effEntries = entries.length ? entries : allEntries;
  const vals = effEntries.map(([, v]) => v);
  let wSum = 0;
  let wTot = 0;
  for (const [name, v] of effEntries) {
    const w = combinedWeight(name, opts);
    wSum += v * w;
    wTot += w;
  }
  const avg = wTot > 0 ? wSum / wTot : vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    avg: Math.round(avg * 10) / 10,
    min: Math.min(...vals),
    max: Math.max(...vals),
    spread: spread(vals),
    p10: r1(percentile(sorted, 0.1)),
    p50: r1(percentile(sorted, 0.5)),
    p90: r1(percentile(sorted, 0.9)),
    by_model: perModel,
    n_effective: effEntries.length,
  };
}

// ===== Hourly variable helpers (CAPE, gusts, dewpoint, RH) =====
// Iteriert die stündlichen Arrays für einen Tag, mittelt über alle Modelle pro Stunde
// und liefert einen Aggregator (max | avg | sum) über das gesamte Tagesfenster
// optional begrenzt auf Stunden [hourStart, hourEnd).
function aggregateHourlyForDay(
  weather: any,
  dayIndex: number,
  base: string,
  op: "max" | "avg" | "min" | "sum",
  hourStart: number = 0,
  hourEnd: number = 24,
): { value: number | null; peakHour: number | null; hourly: Array<{ h: number; v: number }> } {
  const h = weather?.hourly;
  const dateStr = weather?.daily?.time?.[dayIndex];
  if (!h?.time || !dateStr) return { value: null, peakHour: null, hourly: [] };
  const arrs: number[][] = [];
  if (Array.isArray(h[base])) arrs.push(h[base]);
  for (const k of Object.keys(h)) {
    if (k.startsWith(base + "_") && Array.isArray(h[k])) arrs.push(h[k]);
  }
  if (!arrs.length) return { value: null, peakHour: null, hourly: [] };
  const hourly: Array<{ h: number; v: number }> = [];
  for (let i = 0; i < (h.time as string[]).length; i++) {
    const t = h.time[i] as string;
    if (!t.startsWith(dateStr)) continue;
    const hr = parseInt(t.slice(11, 13), 10);
    if (!Number.isFinite(hr) || hr < hourStart || hr >= hourEnd) continue;
    const vals = arrs.map((a) => a[i]).filter((v) => v != null && Number.isFinite(v)) as number[];
    if (!vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    hourly.push({ h: hr, v: mean });
  }
  if (!hourly.length) return { value: null, peakHour: null, hourly: [] };
  let value: number;
  let peakHour: number | null = null;
  if (op === "max") {
    value = -Infinity;
    for (const r of hourly) {
      if (r.v > value) { value = r.v; peakHour = r.h; }
    }
  } else if (op === "min") {
    value = Infinity;
    for (const r of hourly) if (r.v < value) value = r.v;
  } else if (op === "sum") {
    value = hourly.reduce((a, b) => a + b.v, 0);
  } else {
    value = hourly.reduce((a, b) => a + b.v, 0) / hourly.length;
  }
  return { value: Math.round(value * 10) / 10, peakHour, hourly };
}

// ===== Wind-Böen Klassifizierung =====
function classifyGusts(maxKmh: number): { class: "calm" | "moderate" | "strong" | "stormy" | "severe"; label: string } {
  if (maxKmh < 40) return { class: "calm", label: "" };
  if (maxKmh < 60) return { class: "moderate", label: "kräftige Böen" };
  if (maxKmh < 80) return { class: "strong", label: "stürmische Böen" };
  if (maxKmh < 100) return { class: "stormy", label: "Sturmböen" };
  return { class: "severe", label: "schwere Sturmböen" };
}

function assessGusts(weather: any, dayIndex: number) {
  // Bevorzugt das stündliche Maximum aus wind_gusts_10m; ergänzend daily wind_gusts_10m_max.
  const fromHourly = aggregateHourlyForDay(weather, dayIndex, "wind_gusts_10m", "max");
  let maxKmh = fromHourly.value;
  let peakHour = fromHourly.peakHour;
  if (maxKmh == null) {
    const dailyAgg = aggregate(collectModelValuesTiered(weather, "wind_gusts_10m_max", dayIndex));
    maxKmh = dailyAgg?.max ?? null;
  }
  if (maxKmh == null) return null;
  const cls = classifyGusts(maxKmh);
  if (cls.class === "calm") return { max_kmh: Math.round(maxKmh), class: cls.class, label: null, peak_hour: peakHour };
  return { max_kmh: Math.round(maxKmh), class: cls.class, label: cls.label, peak_hour: peakHour };
}

// ===== Gewitter / Konvektion =====
function assessThunderstormRisk(weather: any, dayIndex: number, weathercodeByModel: Record<string, number> | null | undefined) {
  const cape = aggregateHourlyForDay(weather, dayIndex, "cape", "max", 8, 22);
  const li = aggregateHourlyForDay(weather, dayIndex, "lifted_index", "min", 8, 22);
  const codes = weathercodeByModel ? Object.values(weathercodeByModel) : [];
  const tsCount = codes.filter((v) => v === 95 || v === 96 || v === 99).length;
  const tsMajority = codes.length > 0 && tsCount / codes.length > 0.4;
  const capeMax = cape.value ?? 0;
  const liMin = li.value ?? 0;
  let cls: "none" | "isolated" | "scattered" | "widespread" | "severe" = "none";
  if (capeMax >= 2500 && liMin <= -6) cls = "severe";
  else if (capeMax >= 1500 && liMin <= -4) cls = "widespread";
  else if (capeMax >= 500 && liMin <= -2) cls = "scattered";
  else if (tsMajority || (capeMax >= 200 && liMin <= 0)) cls = "isolated";
  if (cls === "none") return null;
  const labels: Record<string, string> = {
    isolated: "lokal Gewitterneigung",
    scattered: "verbreitet Gewitterneigung",
    widespread: "kräftige Gewitter mit Hagel- und Sturmböenrisiko",
    severe: "schwere Gewitter mit Hagel und Sturmböen",
  };
  return {
    class: cls,
    label: labels[cls],
    cape_max: Math.round(capeMax),
    lifted_index_min: Math.round(liMin * 10) / 10,
    peak_hour: cape.peakHour,
    weathercode_majority: tsMajority,
  };
}

// ===== Taupunkt / rel. Feuchte =====
function assessHumidity(weather: any, dayIndex: number, hourlyProfile: HourlyProfileRow[] | null | undefined) {
  const tdMax = aggregateHourlyForDay(weather, dayIndex, "dewpoint_2m", "max", 11, 20);
  const rhNight = aggregateHourlyForDay(weather, dayIndex, "relativehumidity_2m", "max", 22, 24);
  const rhEarly = aggregateHourlyForDay(weather, dayIndex, "relativehumidity_2m", "max", 0, 6);
  const td = tdMax.value;
  let schwüle: "none" | "schwül" | "drückend" = "none";
  if (td != null) {
    if (td >= 18) schwüle = "drückend";
    else if (td >= 16) schwüle = "schwül";
  }
  // Nebelpotenzial: hohe RH + windstill + klar laut Profil
  const rhPeak = Math.max(rhNight.value ?? 0, rhEarly.value ?? 0);
  const calmClear = (hourlyProfile ?? []).filter((r) => r.h <= 6 || r.h >= 22)
    .some((r) => (r.w ?? 99) <= 5 && (r.c ?? 100) <= 30);
  const fogLikely = rhPeak >= 95 && calmClear;
  if (schwüle === "none" && !fogLikely && td == null) return null;
  return {
    dewpoint_max_c: td,
    schwüle,
    rh_max_pct: Math.round(rhPeak),
    night_fog_likely: fogLikely,
  };
}

// ===== Niederschlagsphase (Regen / Schneeregen / Schnee / gefrierender Regen) =====
function derivePhaseForBlock(t: number | null, td: number | null, snowLineMin: number | null, elevM: number): "rain" | "sleet" | "snow" | "freezing_rain" | null {
  if (t == null) return null;
  if (t < 0) return "freezing_rain";
  if (t <= 1.5 && (td == null || td <= 0)) return "snow";
  if (t <= 3) return "sleet";
  // Wenn Standorthöhe nahe Schneefallgrenze
  if (snowLineMin != null && elevM >= snowLineMin - 50) return "snow";
  return "rain";
}

function assessPrecipPhase(weather: any, dayIndex: number, snowLine: any, elevM: number, precipDistribution: any) {
  if (!precipDistribution) return null;
  // Nur sinnvoll wenn überhaupt nennenswert Niederschlag im Tag
  const total = Object.values(precipDistribution.blocks ?? {}).reduce((a: number, b: any) => a + (b?.precip_mm ?? 0), 0) as number;
  if (total < 0.5) return null;
  const tHourly = aggregateHourlyForDay(weather, dayIndex, "temperature_2m", "avg");
  const tdHourly = aggregateHourlyForDay(weather, dayIndex, "dewpoint_2m", "avg");
  const blocks = [
    { name: "morning", from: 6, to: 12 },
    { name: "afternoon", from: 12, to: 18 },
    { name: "evening", from: 18, to: 24 },
  ];
  const snowMin = snowLine?.snow_line_min ?? null;
  const out: Record<string, { phase: string; t_avg: number | null; td_avg: number | null }> = {};
  let anyNonRain = false;
  for (const blk of blocks) {
    const tBlock = tHourly.hourly.filter((r) => r.h >= blk.from && r.h < blk.to);
    const tdBlock = tdHourly.hourly.filter((r) => r.h >= blk.from && r.h < blk.to);
    if (!tBlock.length) continue;
    const tAvg = tBlock.reduce((a, b) => a + b.v, 0) / tBlock.length;
    const tdAvg = tdBlock.length ? tdBlock.reduce((a, b) => a + b.v, 0) / tdBlock.length : null;
    const phase = derivePhaseForBlock(Math.round(tAvg * 10) / 10, tdAvg, snowMin, elevM);
    if (!phase) continue;
    if (phase !== "rain") anyNonRain = true;
    out[blk.name] = { phase, t_avg: Math.round(tAvg * 10) / 10, td_avg: tdAvg != null ? Math.round(tdAvg * 10) / 10 : null };
  }
  if (!Object.keys(out).length || !anyNonRain) return null;
  return { blocks: out, snow_line_m: snowMin };
}

// ===== Modell-Spread / Unsicherheit =====
function buildUncertainty(tmax: any, tmin: any, precip: any, wind_max: any) {
  const items: Array<{ key: string; class: "low" | "moderate" | "high"; spread: number; p10: number; p90: number }> = [];
  if (tmax) items.push({ key: "tmax", class: classifyUncertainty(tmax.spread, "temp"), spread: tmax.spread, p10: tmax.p10, p90: tmax.p90 });
  if (tmin) items.push({ key: "tmin", class: classifyUncertainty(tmin.spread, "temp"), spread: tmin.spread, p10: tmin.p10, p90: tmin.p90 });
  if (precip) items.push({ key: "precip", class: classifyUncertainty(precip.spread, "precip"), spread: precip.spread, p10: precip.p10, p90: precip.p90 });
  if (wind_max) items.push({ key: "wind_max", class: classifyUncertainty(wind_max.spread, "wind"), spread: wind_max.spread, p10: wind_max.p10, p90: wind_max.p90 });
  if (!items.length) return null;
  const overall: "low" | "moderate" | "high" = items.some((i) => i.class === "high")
    ? "high"
    : items.some((i) => i.class === "moderate") ? "moderate" : "low";
  return { overall, by_field: items };
}

function pickBestSource(weather: any, dayIndex: number) {
  // Use the most detailed model set available for this dayIndex.
  // ICON-CH1 ~33h, ICON-CH2 ~5d, ECMWF/GFS ~10d.
  if (dayIndex <= 1) return { res: weather.byModel.short, models: weather.modelLists.short, tier: "short" as const };
  if (dayIndex <= 5) return { res: weather.byModel.mid, models: weather.modelLists.mid, tier: "mid" as const };
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
  } else if (dayIndex <= 5) {
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

// Bekannte Modell-IDs aus den drei Tier-Listen (short/mid/long) + "default".
// Wird genutzt, um beim Präfix-Matching von Hourly-Keys (`base_<modelId>`) ausschliesslich
// echte Modellnamen zu akzeptieren — sonst werden z. B. `precipitation_probability_<model>`
// als Modell `probability_<model>` interpretiert und korrumpieren die Aggregation.
function getKnownModels(weather: any): Set<string> {
  const out = new Set<string>(["default"]);
  const lists = weather?.modelLists;
  if (lists) {
    for (const s of [lists.short, lists.mid, lists.long]) {
      if (typeof s === "string") {
        for (const m of s.split(",").map((x: string) => x.trim()).filter(Boolean)) out.add(m);
      }
    }
  }
  return out;
}

// Gemeinsamer Hourly-Key-Collector mit Whitelist auf bekannte Modell-IDs.
// Returns Record<modelId, number[]> — "default" für den unsuffixed Basis-Key.
// Vier Aufrufstellen (computePrecipDistribution, buildHourlyProfile, refineDayFromHour,
// formatEveningNight) ziehen am selben Helper, damit das Whitelist-Pattern eine
// einzige Quelle der Wahrheit hat.
function makeCollectArrs(weather: any): (base: string) => Record<string, number[]> {
  const h = weather?.hourly ?? {};
  const known = getKnownModels(weather);
  return (base: string) => {
    const out: Record<string, number[]> = {};
    if (Array.isArray(h[base])) out["default"] = h[base];
    const prefix = base + "_";
    for (const k of Object.keys(h)) {
      if (!k.startsWith(prefix) || !Array.isArray(h[k])) continue;
      const model = k.slice(prefix.length);
      if (known.has(model)) out[model] = h[k];
    }
    return out;
  };
}

// Stündlicher Niederschlags-Tagesgang aus Open-Meteo (Tag 0/1).
// Liefert 4 Blöcke (night/morning/afternoon/evening) mit mm-Summe + max % Wahrscheinlichkeit.
function computePrecipDistribution(weather: any, dayIndex: number, fromHour: number = 0): any | null {
  const h = weather?.hourly;
  const dateStr = weather?.daily?.time?.[dayIndex];
  if (!h?.time || !dateStr) return null;

  const collect = makeCollectArrs(weather);
  const precArrs = Object.values(collect("precipitation"));
  const probArrs = Object.values(collect("precipitation_probability"));
  if (!precArrs.length) return null;

  const blocks = {
    night: { range: [0, 6], label: "Nacht" },
    morning: { range: [6, 12], label: "Vormittag" },
    afternoon: { range: [12, 18], label: "Nachmittag" },
    evening: { range: [18, 24], label: "Abend" },
  } as const;

  const result: Record<string, { label: string; precip_mm: number; max_prob: number | null; wet_hours: number }> = {};
  let peakBlock: string | null = null;
  let peakSum = 0;
  let peakProb: number | null = null;

  for (const [key, { range, label }] of Object.entries(blocks)) {
    let sum = 0;
    let wet = 0;
    let maxProb: number | null = null;
    let hourCount = 0;
    for (let i = 0; i < (h.time as string[]).length; i++) {
      const t = h.time[i] as string;
      if (!t.startsWith(dateStr)) continue;
      const hour = parseInt(t.slice(11, 13), 10);
      if (!Number.isFinite(hour) || hour < range[0] || hour >= range[1] || hour < fromHour) continue;
      // Mittel über Modelle pro Stunde
      const precVals = precArrs.map((a) => a[i]).filter((v) => v != null && Number.isFinite(v)) as number[];
      if (!precVals.length) continue;
      const meanPrec = precVals.reduce((a, b) => a + b, 0) / precVals.length;
      sum += meanPrec;
      if (meanPrec >= 0.2) wet += 1;
      hourCount += 1;
      const probVals = probArrs.map((a) => a[i]).filter((v) => v != null && Number.isFinite(v)) as number[];
      if (probVals.length) {
        const m = Math.max(...probVals);
        if (maxProb == null || m > maxProb) maxProb = m;
      }
    }
    if (!hourCount) continue;
    const rounded = Math.round(sum * 10) / 10;
    result[key] = { label, precip_mm: rounded, max_prob: maxProb, wet_hours: wet };
    if (rounded > peakSum) { peakSum = rounded; peakBlock = key; peakProb = maxProb; }
  }

  if (!Object.keys(result).length) return null;
  const allMaxProb = Object.values(result).map((b) => b.max_prob).filter((v): v is number => v != null);
  const overallMaxProb = allMaxProb.length ? Math.max(...allMaxProb) : null;

  // Stundenscharfe Hilfsdaten: peak_hour (Stunde mit höchstem mm-Wert) und dry_windows
  // (zusammenhängende Phasen mit < 0.2 mm/h, mind. 3h lang).
  const hoursOfDay: Array<{ hour: number; mm: number }> = [];
  for (let i = 0; i < (h.time as string[]).length; i++) {
    const t = h.time[i] as string;
    if (!t.startsWith(dateStr)) continue;
    const hour = parseInt(t.slice(11, 13), 10);
    if (!Number.isFinite(hour) || hour < fromHour) continue;
    const precVals = precArrs.map((a) => a[i]).filter((v) => v != null && Number.isFinite(v)) as number[];
    if (!precVals.length) continue;
    hoursOfDay.push({ hour, mm: precVals.reduce((a, b) => a + b, 0) / precVals.length });
  }
  let peakHour: number | null = null;
  let peakHourMm = 0;
  for (const { hour, mm } of hoursOfDay) {
    if (mm > peakHourMm) { peakHourMm = mm; peakHour = hour; }
  }
  // dry_windows aus aufeinander folgenden trockenen Stunden
  const dryWindows: Array<{ from: number; to: number; hours: number }> = [];
  let runStart: number | null = null;
  for (let k = 0; k <= hoursOfDay.length; k++) {
    const cur = hoursOfDay[k];
    const isDry = cur && cur.mm < 0.2;
    if (isDry && runStart == null) runStart = cur.hour;
    if ((!isDry || k === hoursOfDay.length) && runStart != null) {
      const endHour = cur ? cur.hour : (hoursOfDay[k - 1].hour + 1);
      const len = endHour - runStart;
      if (len >= 3) dryWindows.push({ from: runStart, to: endHour, hours: len });
      runStart = null;
    }
  }

  return {
    blocks: result,
    peak_block: peakSum >= 1 ? peakBlock : null,
    peak_block_precip_mm: peakSum >= 1 ? Math.round(peakSum * 10) / 10 : 0,
    peak_block_prob: peakSum >= 1 ? peakProb : null,
    overall_max_prob: overallMaxProb,
    peak_hour: peakHour != null && peakHourMm >= 0.5 ? peakHour : null,
    peak_hour_mm: peakHour != null ? Math.round(peakHourMm * 10) / 10 : null,
    dry_windows: dryWindows,
  };
}

// Kompaktes Stundenprofil pro Tag: Median + Spread aus allen verfügbaren Modellen
// für temperature, precipitation, wind, cloudcover, sunshine. Liefert eine Tabelle
// mit 24 Zeilen (oder weniger ab fromHour). Wird der KI als Tagesgang-Anker mitgegeben.
type HourlyProfileRow = {
  h: number;
  t: number | null;
  t_spread: number;
  p: number;
  p_spread: number;
  w: number | null;
  c: number | null;
  c_low: number | null;
  c_mid: number | null;
  c_high: number | null;
  s: number | null;
  n_models: number;
  src?: "obs" | "mix" | "mod"; // obs = SMN/Radar, mix = Übergang, mod = Modell-Median (default)
};

function buildHourlyProfile(
  weather: any,
  dayIndex: number,
  fromHour: number = 0,
): HourlyProfileRow[] | null {
  const h = weather?.hourly;
  const dateStr = weather?.daily?.time?.[dayIndex];
  if (!h?.time || !dateStr) return null;

  const collect = makeCollectArrs(weather);
  const toArr = (rec: Record<string, number[]>): Array<{ model: string; arr: number[] }> =>
    Object.entries(rec).map(([model, arr]) => ({ model, arr }));
  const isUsable = (m: string) => m === "default" || !HOURLY_LONGRANGE_BLOCKLIST.some((b) => m.includes(b));
  const filt = (arrs: Array<{ model: string; arr: number[] }>) => arrs.filter(({ model }) => isUsable(model));

  const tArrs = filt(toArr(collect("temperature_2m")));
  const pArrs = filt(toArr(collect("precipitation")));
  const wArrs = filt(toArr(collect("windspeed_10m")));
  const cArrs = filt(toArr(collect("cloudcover")));
  const cLowArrs = filt(toArr(collect("cloudcover_low")));
  const cMidArrs = filt(toArr(collect("cloudcover_mid")));
  const cHighArrs = filt(toArr(collect("cloudcover_high")));
  const sArrs = filt(toArr(collect("sunshine_duration")));

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const median = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const spread = (vals: number[]) => (vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0);
  const sample = (arrs: Array<{ model: string; arr: number[] }>, i: number): number[] =>
    arrs.map(({ arr }) => arr[i]).filter((v) => v != null && Number.isFinite(v)) as number[];

  const out: HourlyProfileRow[] = [];
  for (let i = 0; i < (h.time as string[]).length; i++) {
    const ts = h.time[i] as string;
    if (!ts.startsWith(dateStr)) continue;
    const hr = parseInt(ts.slice(11, 13), 10);
    if (!Number.isFinite(hr) || hr < fromHour) continue;
    const tv = sample(tArrs, i);
    const pv = sample(pArrs, i);
    const wv = sample(wArrs, i);
    const cv = sample(cArrs, i);
    const cLowV = sample(cLowArrs, i);
    const cMidV = sample(cMidArrs, i);
    const cHighV = sample(cHighArrs, i);
    const sv = sample(sArrs, i);
    const tMed = median(tv);
    const pMed = median(pv) ?? 0;
    const cLowMed = median(cLowV);
    const cMidMed = median(cMidV);
    const cHighMed = median(cHighV);
    out.push({
      h: hr,
      t: tMed != null ? r1(tMed) : null,
      t_spread: r1(spread(tv)),
      p: r1(pMed),
      p_spread: r1(spread(pv)),
      w: median(wv) != null ? r1(median(wv)!) : null,
      c: median(cv) != null ? Math.round(median(cv)!) : null,
      c_low: cLowMed != null ? Math.round(cLowMed) : null,
      c_mid: cMidMed != null ? Math.round(cMidMed) : null,
      c_high: cHighMed != null ? Math.round(cHighMed) : null,
      s: median(sv) != null ? r1(median(sv)! / 60) : null, // Sekunden → Minuten
      n_models: tv.length,
      src: "mod",
    });
  }
  return out.length ? out : null;
}

// Erkennt Nebel-/Hochnebel-Auflösungsmuster aus dem Stundenprofil:
// morgens (06–10) hohe Bewölkung + kaum Sonne, später (12–17) geringere
// Bewölkung oder deutlich Sonne. Wenn beides zutrifft, wird die voraussichtliche
// Auflösungsstunde zurückgegeben.
function detectFogDissipation(
  profile: HourlyProfileRow[] | null | undefined,
  weathercodeByModel: Record<string, number> | null | undefined,
): { dissipation_hour: number; morning_cloud_pct: number; afternoon_sunshine_min: number } | null {
  if (!profile?.length) return null;
  // Engere Frühnnebel-Stunden (06–07): zählt nur die echte Nebelphase, nicht
  // schon eine beginnende Auflösung um 08 Uhr.
  const earlyFog = profile.filter((r) => r.h >= 6 && r.h <= 7);
  // Restlicher Tagesverlauf 08–17, um Auflösung + Sonne zu erkennen.
  const dayWindow = profile.filter((r) => r.h >= 8 && r.h <= 17);
  if (earlyFog.length < 1 || dayWindow.length < 4) return null;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const fogCloud = avg(earlyFog.map((r) => r.c).filter((v): v is number => v != null));
  const fogCloudLow = avg(earlyFog.map((r) => r.c_low).filter((v): v is number => v != null));
  const fogCloudHigh = avg(earlyFog.map((r) => r.c_high).filter((v): v is number => v != null));
  const fogSun = avg(earlyFog.map((r) => r.s ?? 0));
  const daySun = avg(dayWindow.map((r) => r.s ?? 0));
  const dayCloud = avg(dayWindow.map((r) => r.c).filter((v): v is number => v != null));
  const dayCloudLow = avg(dayWindow.map((r) => r.c_low).filter((v): v is number => v != null));
  const sunnyHours = dayWindow.filter((r) => (r.s ?? 0) >= 30).length;
  const hasLowData = earlyFog.some((r) => r.c_low != null);

  const hasFogCode = weathercodeByModel
    ? Object.values(weathercodeByModel).some((v) => v === 45 || v === 48)
    : false;

  // Nebelphase: 06–07 Uhr sehr bewölkt UND kaum Sonne.
  // Wenn Schichtdaten vorhanden: tiefe Bewölkung muss dominieren — sonst sind
  // es nur hohe Schleierwolken (kein Hochnebel-Pattern).
  const morningOvercast = fogCloud >= 85 && fogSun <= 10;
  const lowDominant = hasLowData
    ? fogCloudLow >= 75 && fogCloudHigh < fogCloudLow + 10
    : true; // ohne Schichtdaten Verhalten wie bisher
  if (!morningOvercast || !lowDominant) return null;

  // Auflösung: ENTWEDER Nebel-Code vorhanden (dann reicht morgens dichte
  // Bewölkung), ODER über den Tag verteilt klar deutliche Sonne, ODER
  // tiefe Bewölkung nimmt deutlich ab.
  const clearingByCode = hasFogCode && (sunnyHours >= 3 || daySun >= 25);
  const clearingBySun = sunnyHours >= 5 || daySun >= 35 || dayCloud <= 60;
  const clearingByLow = hasLowData && dayCloudLow <= 50 && fogCloudLow - dayCloudLow >= 25;
  if (!clearingByCode && !clearingBySun && !clearingByLow) return null;

  // Auflösungsstunde: erste Stunde ab 08:00, in der Sonne ≥ 20 min ODER
  // tiefe Bewölkung < 60 % (bzw. Gesamtbewölkung < 75 % wenn keine Schichtdaten).
  let dissipation = 10;
  for (const r of profile) {
    if (r.h < 8 || r.h > 14) continue;
    const sunOk = r.s != null && r.s >= 20;
    const lowOk = hasLowData ? (r.c_low != null && r.c_low < 60) : (r.c != null && r.c < 75);
    if (sunOk || lowOk) { dissipation = r.h; break; }
  }

  return {
    dissipation_hour: dissipation,
    morning_cloud_pct: Math.round(hasLowData ? fogCloudLow : fogCloud),
    afternoon_sunshine_min: Math.round(daySun),
  };
}

function normalizeSkyDiagnostics(day: any): any {
  if (!day) return day;
  const fog = detectFogDissipation(day.hourly_profile, day.weathercode?.by_model);
  if (fog) {
    day.sky_pattern = "nebel_aufloesung";
    day.fog_dissipation = fog;
    day.sky_summary = "Morgens Nebel-/Hochnebelfelder oder stark bewölkt, danach rasche Auflockerungen und recht sonnig; später zeitweise dichtere Wolkenfelder, daneben sonnige Abschnitte.";
  }
  return day;
}

// Beobachtungs-Overlay für Tag 0: ersetzt die vergangenen Stunden im Profil
// durch reale SMN-/Radar-Messwerte. Aktuelle + nächste Stunde werden als
// Übergang markiert (Werte bleiben Modell, src="mix").
function applyObservedOverlay(
  profile: HourlyProfileRow[] | null,
  dateStr: string, // lokales Tagesdatum YYYY-MM-DD (Europe/Zurich)
  smn: Array<{ rows: Array<{ time: string; temp_c: number | null; precip_mm: number | null; wind_kmh: number | null; cloud_pct: number | null }> }> | null | undefined,
  radar: { observed?: { hours?: Array<{ time: string; mm: number }> } } | null | undefined,
  nowAt: Date = new Date(),
): HourlyProfileRow[] | null {
  if (!profile?.length) return profile;

  // Index SMN-Zeilen nach lokalem ISO-Stundenstempel "YYYY-MM-DDTHH"
  const localKey = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false,
    }).formatToParts(d);
    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;
    const hh = p.hour === "24" ? "00" : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hh}`;
  };

  type Acc = { temp: number[]; wind: number[]; cloud: number[]; precip: number[] };
  const smnByHour = new Map<string, Acc>();
  for (const st of smn ?? []) {
    for (const r of st.rows ?? []) {
      const t = new Date(r.time);
      if (!Number.isFinite(t.getTime())) continue;
      const k = localKey(t);
      let acc = smnByHour.get(k);
      if (!acc) { acc = { temp: [], wind: [], cloud: [], precip: [] }; smnByHour.set(k, acc); }
      if (r.temp_c != null) acc.temp.push(r.temp_c);
      if (r.wind_kmh != null) acc.wind.push(r.wind_kmh);
      if (r.cloud_pct != null) acc.cloud.push(r.cloud_pct);
      if (r.precip_mm != null) acc.precip.push(r.precip_mm);
    }
  }

  const radarByHour = new Map<string, number>();
  for (const rh of radar?.observed?.hours ?? []) {
    const t = new Date(rh.time);
    if (!Number.isFinite(t.getTime())) continue;
    radarByHour.set(localKey(t), rh.mm);
  }

  const nowHour = parseInt(localKey(nowAt).slice(11, 13), 10);
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const sprd = (xs: number[]) => xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : 0;

  return profile.map((row) => {
    const key = `${dateStr}T${String(row.h).padStart(2, "0")}`;
    const isPast = row.h < nowHour;          // vollständig vergangen
    const isCurrent = row.h === nowHour;     // aktuelle Stunde
    const isNext = row.h === nowHour + 1;    // direkt darauf
    const smnAcc = smnByHour.get(key);
    const radarMm = radarByHour.get(key);

    if (isPast && (smnAcc || radarMm != null)) {
      const t = smnAcc ? mean(smnAcc.temp) : null;
      const w = smnAcc ? mean(smnAcc.wind) : null;
      const c = smnAcc ? mean(smnAcc.cloud) : null;
      const p = radarMm != null ? radarMm : (smnAcc ? mean(smnAcc.precip) ?? row.p : row.p);
      return {
        ...row,
        t: t != null ? Math.round(t * 10) / 10 : row.t,
        t_spread: smnAcc && smnAcc.temp.length >= 2 ? Math.round(sprd(smnAcc.temp) * 10) / 10 : 0,
        w: w != null ? Math.round(w * 10) / 10 : row.w,
        c: c != null ? Math.round(c) : row.c,
        p: Math.round(p * 10) / 10,
        p_spread: 0,
        src: "obs",
      };
    }

    if (isCurrent || isNext) {
      // Wenn Beobachtung für die aktuelle Stunde verfügbar ist, sanft Richtung Beobachtung ziehen
      if (isCurrent && smnAcc) {
        const tObs = mean(smnAcc.temp);
        const wObs = mean(smnAcc.wind);
        const cObs = mean(smnAcc.cloud);
        const blend = (a: number | null, b: number | null) =>
          a == null ? b : b == null ? a : Math.round(((a + b) / 2) * 10) / 10;
        return {
          ...row,
          t: blend(row.t, tObs),
          w: blend(row.w, wObs),
          c: cObs != null && row.c != null ? Math.round((row.c + cObs) / 2) : row.c,
          p: radarMm != null ? Math.round(((row.p + radarMm) / 2) * 10) / 10 : row.p,
          src: "mix",
        };
      }
      return { ...row, src: "mix" };
    }

    return row;
  });
}

// Formatiert das Stundenprofil als kompakte Tabelle für den KI-Prompt.
// Jede Zeile: "HH | T °C (±s) | P mm (±s) | W km/h | Wolken % | Sonne min | Quelle".
function formatHourlyProfileTable(profile: HourlyProfileRow[] | null | undefined): string | null {
  if (!profile?.length) return null;
  const hasSrc = profile.some((r) => r.src && r.src !== "mod");
  const header = hasSrc
    ? "Stunde | Temp | Niederschlag | Wind | Wolken | Sonne | Quelle"
    : "Stunde | Temp | Niederschlag | Wind | Wolken | Sonne";
  const sep = hasSrc
    ? "------ | ---- | ------------ | ---- | ------ | ----- | ------"
    : "------ | ---- | ------------ | ---- | ------ | -----";
  const lines = [header, sep];
  for (const r of profile) {
    const hh = String(r.h).padStart(2, "0") + ":00";
    const t = r.t != null ? `${r.t.toFixed(1)}°` + (r.t_spread > 1 ? ` (±${r.t_spread.toFixed(1)})` : "") : "—";
    const p = r.p > 0 ? `${r.p.toFixed(1)} mm` + (r.p_spread > 0.5 ? ` (±${r.p_spread.toFixed(1)})` : "") : "trocken";
    const w = r.w != null ? `${Math.round(r.w)} km/h` : "—";
    const c = r.c != null ? `${r.c}%` : "—";
    const s = r.s != null && r.s > 0 ? `${Math.round(r.s)} min` : "0";
    const row = `${hh} | ${t} | ${p} | ${w} | ${c} | ${s}`;
    lines.push(hasSrc ? `${row} | ${r.src ?? "mod"}` : row);
  }
  return lines.join("\n");
}

// Baut den userPrompt für einen Tag und hängt — falls vorhanden — das
// Stundenprofil als separate Tabelle an (statt es als JSON-Array im Datensatz
// zu vergraben). `hourly_profile` wird aus dem JSON-Dump entfernt, um Tokens zu sparen.
function buildDayUserPrompt(intro: string, day: any, extraHint: string = ""): string {
  const profile = day?.hourly_profile;
  const dump = { ...day };
  delete dump.hourly_profile;
  const json = JSON.stringify(dump, null, 2);
  let prompt = `${intro}\n${json}`;
  const table = formatHourlyProfileTable(profile);
  if (table) {
    prompt += `\n\nSTUNDENPROFIL (Median über Modelle, ± = Modell-Streuung):\n${table}`;
  }
  if (extraHint) prompt += extraHint;
  return prompt;
}

// Aggregiert die Wolkenschicht-Information (low/mid/high) aus dem Stundenprofil
// auf Tages-, Vormittags- und Nachmittagsebene. Wird für die Sky-Klassifikation
// und Hochnebel-/Schleierwolken-Erkennung genutzt.
function computeCloudLayers(profile: HourlyProfileRow[] | null | undefined): {
  day: { low: number | null; mid: number | null; high: number | null };
  morning: { low: number | null; mid: number | null; high: number | null };
  afternoon: { low: number | null; mid: number | null; high: number | null };
  has_data: boolean;
} | null {
  if (!profile?.length) return null;
  const meanRound = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const block = (rows: HourlyProfileRow[]) => ({
    low: meanRound(rows.map((r) => r.c_low).filter((v): v is number => v != null)),
    mid: meanRound(rows.map((r) => r.c_mid).filter((v): v is number => v != null)),
    high: meanRound(rows.map((r) => r.c_high).filter((v): v is number => v != null)),
  });
  const dayRows = profile.filter((r) => r.h >= 6 && r.h <= 20);
  const mornRows = profile.filter((r) => r.h >= 6 && r.h < 12);
  const aftRows = profile.filter((r) => r.h >= 12 && r.h < 18);
  const hasData = profile.some((r) => r.c_low != null || r.c_mid != null || r.c_high != null);
  return {
    day: block(dayRows),
    morning: block(mornRows),
    afternoon: block(aftRows),
    has_data: hasData,
  };
}

// Tagesgang-Aggregat für Bewölkung & Sonne (Pendant zu computePrecipDistribution),
// gespeist aus dem bereits gemittelten Stundenprofil.
function computeCloudSunDistribution(profile: HourlyProfileRow[] | null | undefined): {
  blocks: Record<string, {
    label: string;
    cloud_avg: number | null;
    cloud_low_avg: number | null;
    sun_min: number;
    sunny_hours: number;
  }>;
  dominant_sun_block: string | null;
  dominant_cloud_block: string | null;
} | null {
  if (!profile?.length) return null;
  const ranges: Record<string, { label: string; from: number; to: number }> = {
    night: { label: "Nacht", from: 0, to: 6 },
    morning: { label: "Vormittag", from: 6, to: 12 },
    afternoon: { label: "Nachmittag", from: 12, to: 18 },
    evening: { label: "Abend", from: 18, to: 24 },
  };
  const meanRound = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const blocks: Record<string, any> = {};
  let bestSun = -1, bestSunKey: string | null = null;
  let bestCloud = -1, bestCloudKey: string | null = null;
  for (const [key, { label, from, to }] of Object.entries(ranges)) {
    const rows = profile.filter((r) => r.h >= from && r.h < to);
    if (!rows.length) continue;
    const cloudAvg = meanRound(rows.map((r) => r.c).filter((v): v is number => v != null));
    const cloudLowAvg = meanRound(rows.map((r) => r.c_low).filter((v): v is number => v != null));
    const sunMin = Math.round(rows.reduce((a, r) => a + (r.s ?? 0), 0));
    const sunnyHours = rows.filter((r) => (r.s ?? 0) >= 30).length;
    blocks[key] = { label, cloud_avg: cloudAvg, cloud_low_avg: cloudLowAvg, sun_min: sunMin, sunny_hours: sunnyHours };
    if (sunMin > bestSun) { bestSun = sunMin; bestSunKey = key; }
    if (cloudAvg != null && cloudAvg > bestCloud) { bestCloud = cloudAvg; bestCloudKey = key; }
  }
  if (!Object.keys(blocks).length) return null;
  return { blocks, dominant_sun_block: bestSunKey, dominant_cloud_block: bestCloudKey };
}

// Modell-Gewichte für Bewölkung & Sonne (analog zu Wind, aber andere Mischung).
// Hochauflösende Modelle (ICON-CH1/2, AROME HD) erhalten höheres Gewicht.
const CLOUD_SUN_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.30,
  meteoswiss_icon_ch2: 0.25,
  icon_d2: 0.15,
  meteofrance_arome_france_hd: 0.15,
  icon_eu: 0.10,
  arpege_europe: 0.10,
  ecmwf_ifs025: 0.05,
};
function weightedCloudSunAvg(perModel: Record<string, number>): { avg: number; weights_used: Record<string, number> } | null {
  const entries = Object.entries(perModel).filter(([k, v]) => k in CLOUD_SUN_WEIGHTS && Number.isFinite(v));
  if (!entries.length) return null;
  const totalW = entries.reduce((s, [k]) => s + CLOUD_SUN_WEIGHTS[k], 0);
  if (totalW <= 0) return null;
  const avg = entries.reduce((s, [k, v]) => s + v * (CLOUD_SUN_WEIGHTS[k] / totalW), 0);
  const weights_used: Record<string, number> = {};
  for (const [k] of entries) weights_used[k] = Math.round((CLOUD_SUN_WEIGHTS[k] / totalW) * 100) / 100;
  return { avg: Math.round(avg * 10) / 10, weights_used };
}

// Modell-Gewichte fürs Stundenfenster (Restfenster 12–24 h).
// Temperatur: hochauflösende CH-Modelle dominieren, ARPEGE als globaler Anker.
const TEMP_HOURLY_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.30,
  meteoswiss_icon_ch2: 0.25,
  meteofrance_arome_france_hd: 0.20,
  icon_d2: 0.15,
  arpege_europe: 0.10,
};
// Niederschlag: AROME bekommt mehr Gewicht (konvektionsstark), CH-Modelle danach.
const PRECIP_HOURLY_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.30,
  meteofrance_arome_france_hd: 0.25,
  meteoswiss_icon_ch2: 0.20,
  icon_d2: 0.15,
  arpege_europe: 0.10,
};

// Pro-Stunden-Gewichtung. `weights` = Basistabelle; horizon-Modifier (HORIZON_WEIGHTS)
// wird, wenn `hourIso` gegeben, multiplikativ angewandt — Modelle mit Horizont-Gewicht 0
// (z. B. ECMWF/GFS in h0_12/h12_24) fallen so automatisch raus.
// Fallback: wenn kein gewichtetes Modell vorhanden ist, ungewichtetes Mittel über
// `arrs` (heutiges Verhalten von hourAvg) — keine Regression.
function weightedHourValue(
  arrs: Record<string, number[]>,
  i: number,
  weights: Record<string, number>,
  hourIso?: string,
): number | null {
  const horiz = hourIso ? HORIZON_WEIGHTS[horizonForHour(hourIso)] : null;
  let sumW = 0;
  let sum = 0;
  for (const [m, arr] of Object.entries(arrs)) {
    const v = arr?.[i];
    if (v == null || !Number.isFinite(v)) continue;
    const base = weights[m];
    if (base == null) continue;
    const hMod = horiz ? (horiz[modelKey(m)] ?? 1.0) : 1.0;
    const w = base * hMod;
    if (w <= 0) continue;
    sumW += w;
    sum += v * w;
  }
  if (sumW > 0) return sum / sumW;
  // Fallback: ungewichtetes Mittel über alle verfügbaren (nicht-blocklisteten) Modelle.
  const vals: number[] = [];
  for (const [m, arr] of Object.entries(arrs)) {
    if (m !== "default" && HOURLY_LONGRANGE_BLOCKLIST.some((b) => m.includes(b))) continue;
    const v = arr?.[i];
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function formatDayData(weather: any, dayIndex: number) {
  const d = weather.daily;
  if (!d || !d.time?.[dayIndex]) return null;
  const { models, tier } = pickBestSource(weather, dayIndex);
  const regime = classifyRegime(weather, dayIndex);
  const horizon = horizonForDay(weather, dayIndex);
  const agg = (varName: string, perModel: Record<string, number>) =>
    aggregate(perModel, { variable: varName, regime, horizon });

  const cloudPerModel = collectModelValuesTiered(weather, "cloudcover_mean", dayIndex);
  const cloudcoverRaw = agg("cloudcover_mean", cloudPerModel);
  const cloudWeighted = weightedCloudSunAvg(cloudPerModel);
  const cloudcover = cloudcoverRaw && cloudWeighted
    ? { ...cloudcoverRaw, avg: Math.round(cloudWeighted.avg), weights_used: cloudWeighted.weights_used }
    : cloudcoverRaw;
  const sunshineRaw = collectModelValuesTiered(weather, "sunshine_duration", dayIndex);
  const sunshineHours: Record<string, number> = {};
  for (const [k, v] of Object.entries(sunshineRaw)) sunshineHours[k] = Math.round((v / 3600) * 10) / 10;
  const sunshineRawAgg = agg("sunshine_duration", sunshineHours);
  const sunWeighted = weightedCloudSunAvg(sunshineHours);
  const sunshine_h = sunshineRawAgg && sunWeighted
    ? { ...sunshineRawAgg, avg: sunWeighted.avg, weights_used: sunWeighted.weights_used }
    : sunshineRawAgg;

  // Derive cloudcover from sunshine when models don't return it (assume ~12h daylight average)
  let cloudcover_source: "model" | "derived_from_sunshine" | "none" = cloudcover ? "model" : "none";
  let cloudcoverFinal = cloudcover;
  if (!cloudcover && sunshine_h && typeof sunshine_h.avg === "number") {
    const ratio = Math.max(0, Math.min(1, sunshine_h.avg / 12));
    const derived = Math.round((1 - ratio) * 100);
    cloudcoverFinal = { avg: derived, min: derived, max: derived, spread: 0, p10: derived, p50: derived, p90: derived, by_model: { derived }, n_effective: 1 };
    cloudcover_source = "derived_from_sunshine";
  }

  const windPerModel = collectModelValuesTiered(weather, "windspeed_10m_max", dayIndex);
  const wind_max_raw = agg("windspeed_10m_max", windPerModel);
  const weightedW = weightedWindAvg(windPerModel);
  const wind_max = wind_max_raw && weightedW
    ? { ...wind_max_raw, avg: weightedW.avg, weights_used: weightedW.weights_used }
    : wind_max_raw;
  const windDirPerModel = collectModelValuesTiered(weather, "winddirection_10m_dominant", dayIndex);
  const wind_dir = agg("winddirection_10m_dominant", windDirPerModel);
  // Use weighted circular mean for the dominant direction; fall back to unweighted.
  const wind_dir_avg = weightedCircularMeanDeg(windDirPerModel) ?? circularMeanDeg(Object.values(windDirPerModel));
  const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
  const wind_label = buildWindLabel(wind_dir_avg, wind_max?.avg ?? null);

  const tmax = agg("temperature_2m_max", collectModelValuesTiered(weather, "temperature_2m_max", dayIndex));
  const tmin = agg("temperature_2m_min", collectModelValuesTiered(weather, "temperature_2m_min", dayIndex));
  const precip = agg("precipitation_sum", collectModelValuesTiered(weather, "precipitation_sum", dayIndex));
  const precip_prob = agg("precipitation_probability_max", collectModelValuesTiered(weather, "precipitation_probability_max", dayIndex));
  const weathercode = agg("weathercode", collectModelValuesTiered(weather, "weathercode", dayIndex));
  const thunderstorm = assessThunderstormRisk(weather, dayIndex, weathercode?.by_model);

  // Tagesgang (Niederschlagsverteilung) für Tag 0–5 vorab berechnen, damit
  // die Sky-Klassifikation den intraday-Verlauf berücksichtigen kann.
  const precipDist = dayIndex <= 5 ? computePrecipDistribution(weather, dayIndex) : null;
  // Stundenprofil + Wolkenschichten (low/mid/high) für Tag 0–5
  const hourlyProfile = dayIndex <= 5 ? buildHourlyProfile(weather, dayIndex) : null;
  const cloud_layers = computeCloudLayers(hourlyProfile);
  const cloud_sun_distribution = computeCloudSunDistribution(hourlyProfile);
  // Deterministische Sky-Klassifikation IMMER (auch Tag 2+) — verhindert
  // widersprüchliche "sonnig"-Aussagen, wenn Niederschlag/Bewölkung dagegen sprechen.
  const skyClass = classifySky({
    cloudcover: cloudcoverFinal,
    sunshine_h,
    weathercode,
    precip_prob,
    thunderstorm,
    precip_distribution: precipDist,
    cloud_layers,
  });
  // Nebel-Auflösung als Sonderfall für Tag 0/1 — überschreibt Klassifikation
  const fogDiss = dayIndex <= 1
    ? detectFogDissipation(hourlyProfile, weathercode?.by_model)
    : false;
  const sky_label = fogDiss
    ? "Morgens Nebel-/Hochnebelfelder, im Tagesverlauf Auflösung, am Nachmittag sonnig"
    : skyClass.sky_label;
  const sky_pattern = fogDiss ? "nebel_aufloesung" : skyClass.sky_pattern;

  // models actually contributing across all variables (transparency for the UI)
  const contributing = new Set<string>();
  for (const aggOut of [tmax, tmin, precip, precip_prob, wind_max, wind_dir, weathercode, cloudcover, sunshine_h]) {
    if (aggOut?.by_model) for (const k of Object.keys(aggOut.by_model)) contributing.add(k);
  }

  return {
    date: d.time[dayIndex],
    models_configured: models,
    models_used: Array.from(contributing).join(","),
    tier,
    regime,
    horizon,
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
    cloud_layers,
    weathercode,
    sunshine_h,
    precip_distribution: precipDist,
    cloud_sun_distribution,
    hourly_profile: hourlyProfile,
    sky_pattern,
    fog_dissipation: fogDiss,
    wind_gusts: assessGusts(weather, dayIndex),
    thunderstorm,
    humidity: assessHumidity(weather, dayIndex, hourlyProfile),
    uncertainty: buildUncertainty(tmax, tmin, precip, wind_max),
  };
}

// Überschreibt für einen Tag die stündlich abgeleiteten Felder (tmin, tmax, precip,
// precip_prob, wind_max, cloudcover, sunshine_h) so, dass nur Stunden ab `fromHour`
// einfliessen. Für Tag 1 mit fromHour=6 nutzbar, um Doppelung mit dem
// "Heute Abend & Nacht"-Eintrag (der die Vornacht abdeckt) zu vermeiden.
function refineDayFromHour(day: any, weather: any, dayIndex: number, fromHour: number): any {
  if (!day) return day;
  const h = weather?.hourly;
  const dateStr = weather?.daily?.time?.[dayIndex];
  if (!h?.time || !dateStr) return day;

  const collectArrs = makeCollectArrs(weather);
  const isUsableModel = (m: string) => !HOURLY_LONGRANGE_BLOCKLIST.some((b) => m.includes(b));

  const idx: number[] = [];
  for (let i = 0; i < (h.time as string[]).length; i++) {
    const t = h.time[i] as string;
    if (!t.startsWith(dateStr)) continue;
    const hr = parseInt(t.slice(11, 13), 10);
    if (Number.isFinite(hr) && hr >= fromHour) idx.push(i);
  }
  if (!idx.length) return day;

  const tArrs = collectArrs("temperature_2m");
  const pArrs = collectArrs("precipitation");
  const probArrs = collectArrs("precipitation_probability");
  const wArrs = collectArrs("windspeed_10m");
  const cArrs = collectArrs("cloudcover");
  const sArrs = collectArrs("sunshine_duration");

  const r1 = (n: number) => Math.round(n * 10) / 10;

  // Per-Modell-Aggregat über das Fenster
  const perModel = (arrs: Record<string, number[]>, op: "min" | "max" | "sum" | "avg"): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [m, arr] of Object.entries(arrs)) {
      if (m !== "default" && !isUsableModel(m)) continue;
      const vals = idx.map((i) => arr[i]).filter((v) => v != null && Number.isFinite(v)) as number[];
      if (!vals.length) continue;
      let v: number;
      if (op === "min") v = Math.min(...vals);
      else if (op === "max") v = Math.max(...vals);
      else if (op === "sum") v = vals.reduce((a, b) => a + b, 0);
      else v = vals.reduce((a, b) => a + b, 0) / vals.length;
      out[m] = r1(v);
    }
    return out;
  };

  const tminPerModel = perModel(tArrs, "min");
  const tmaxPerModel = perModel(tArrs, "max");
  const precPerModel = perModel(pArrs, "sum");
  const probPerModel = perModel(probArrs, "max");
  const windPerModel = perModel(wArrs, "max");
  const cloudPerModel = perModel(cArrs, "avg");
  // sunshine: Sekunden → Stunden
  const sunSecPerModel = perModel(sArrs, "sum");
  const sunHPerModel: Record<string, number> = {};
  for (const [m, v] of Object.entries(sunSecPerModel)) sunHPerModel[m] = r1(v / 3600);

  // Baustein 2 — Tier-Fallback: wenn das Stundenfenster für eine Variable <2 Modelle
  // liefert (z. B. ICON-CH1 ist ab h+33 raus), die fehlenden Modelle aus der bereits
  // aggregierten Tagesbasis (`day.<var>.by_model`, kommt aus formatDayData mit
  // collectModelValuesTiered) auffüllen. Werte sind dann Tagesmittel statt
  // Fenstermittel — Spread und Konsens bleiben aber erhalten, was für die KI
  // belastbarer ist als ein Single-Model-Mix.
  const fillFromDay = (perModel: Record<string, number>, dayField: any): Record<string, number> => {
    if (Object.keys(perModel).length >= 2) return perModel;
    const byModel = dayField?.by_model;
    if (!byModel || typeof byModel !== "object") return perModel;
    const out = { ...perModel };
    for (const [m, v] of Object.entries(byModel)) {
      if (m === "default" || m === "derived") continue;
      if (m in out) continue;
      if (typeof v === "number" && Number.isFinite(v)) out[m] = v;
    }
    return out;
  };
  const precPerModelF = fillFromDay(precPerModel, day?.precip);
  const probPerModelF = fillFromDay(probPerModel, day?.precip_prob);
  const cloudPerModelF = fillFromDay(cloudPerModel, day?.cloudcover);
  const sunHPerModelF = fillFromDay(sunHPerModel, day?.sunshine_h);
  const windPerModelF = fillFromDay(windPerModel, day?.wind_max);
  const tminPerModelF = fillFromDay(tminPerModel, day?.tmin);
  const tmaxPerModelF = fillFromDay(tmaxPerModel, day?.tmax);

  // Diagnose: Coverage von ICON-Modellen (CH1/CH2/D2) im Restfenster prüfen.
  // Sichtbar machen, wenn entweder <2 Modelle insgesamt beitragen oder kein
  // ICON-Modell mehr drin ist — verhindert stille Single-Model-Fallbacks.
  const ICON_KEYS = ["meteoswiss_icon_ch1", "meteoswiss_icon_ch2", "icon_d2"];
  const coverage = (label: string, perModel: Record<string, number>) => {
    const keys = Object.keys(perModel);
    const iconCount = keys.filter((k) => ICON_KEYS.includes(k)).length;
    if (keys.length < 2 || iconCount === 0) {
      console.warn(
        `[forecast] refineDayFromHour day${dayIndex} ${label}: ${keys.length} Modell(e) ` +
        `(${keys.join(",") || "—"}), ICON-Modelle: ${iconCount}/3`,
      );
    }
  };
  coverage("precip", precPerModelF);
  coverage("cloud", cloudPerModelF);
  coverage("sunshine", sunHPerModelF);

  const out = { ...day };
  // Mittlere Stunde des Fensters für Horizont-Bestimmung
  const midHour = Math.min(23, Math.floor((fromHour + 24) / 2));
  const horizon = dateStr
    ? horizonForHour(`${dateStr}T${String(midHour).padStart(2, "0")}:00:00Z`)
    : (day?.horizon as Horizon | undefined);
  const regime = day?.regime as Regime | undefined;
  const aggH = (variable: string, perModel: Record<string, number>) =>
    aggregate(perModel, { variable, regime, horizon });
  if (Object.keys(tminPerModelF).length) out.tmin = aggH("temperature_2m_min", tminPerModelF);
  if (Object.keys(tmaxPerModelF).length) out.tmax = aggH("temperature_2m_max", tmaxPerModelF);
  if (Object.keys(precPerModelF).length) out.precip = aggH("precipitation_sum", precPerModelF);
  if (Object.keys(probPerModelF).length) out.precip_prob = aggH("precipitation_probability_max", probPerModelF);
  if (Object.keys(windPerModelF).length) {
    const wRaw = aggH("windspeed_10m_max", windPerModelF);
    const wW = weightedWindAvg(windPerModelF);
    out.wind_max = wRaw && wW ? { ...wRaw, avg: wW.avg, weights_used: wW.weights_used } : wRaw;
  }
  if (Object.keys(cloudPerModelF).length) {
    const cRaw = aggH("cloudcover_mean", cloudPerModelF);
    const cW = weightedCloudSunAvg(cloudPerModelF);
    out.cloudcover = cRaw && cW ? { ...cRaw, avg: Math.round(cW.avg), weights_used: cW.weights_used } : cRaw;
  }
  if (Object.keys(sunHPerModelF).length) {
    const sRaw = aggH("sunshine_duration", sunHPerModelF);
    const sW = weightedCloudSunAvg(sunHPerModelF);
    out.sunshine_h = sRaw && sW ? { ...sRaw, avg: sW.avg, weights_used: sW.weights_used } : sRaw;
  }
  if (horizon) out.horizon = horizon;

  out.precip_distribution = computePrecipDistribution(weather, dayIndex, fromHour);
  out.hourly_profile = buildHourlyProfile(weather, dayIndex, fromHour);
  out.cloud_sun_distribution = computeCloudSunDistribution(out.hourly_profile);
  out.cloud_layers = computeCloudLayers(out.hourly_profile);
  out.window_from_hour = fromHour;
  out.window_label = fromHour > 0
    ? `${String(fromHour).padStart(2, "0")}:00–24:00 (Vornacht 00–${String(fromHour).padStart(2, "0")} im vorherigen Eintrag abgedeckt)`
    : `00:00–24:00 (ganzer Tag)`;

  // Baustein 5 — Diagnose-Felder ehrlich halten: models_used spiegelt nach dem
  // Refine die tatsächlich beitragenden Modelle, refined_window dokumentiert
  // das Zeitfenster.
  const contributing = new Set<string>();
  for (const aggOut of [out.tmin, out.tmax, out.precip, out.precip_prob, out.wind_max, out.cloudcover, out.sunshine_h]) {
    if (aggOut?.by_model) for (const k of Object.keys(aggOut.by_model)) contributing.add(k);
  }
  if (contributing.size) out.models_used = Array.from(contributing).join(",");
  out.refined_window = { from_hour: fromHour, to_hour: 24 };

  return normalizeSkyDiagnostics(out);
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

// Modelle, die im Restfenster heute praktisch wertlos sind und daher
// im stündlichen Mittel ausgeschlossen werden (Tier-Filter analog zu Tag 0).
const HOURLY_LONGRANGE_BLOCKLIST = ["gfs_global", "gfs_seamless", "ecmwf_ifs025"];

type RadarForRefine = {
  forecast_next_2h?: { hours?: { time: string; mm: number }[] };
  forecast_hours?: { time: string; mm: number }[];
} | null;

function formatEveningNight(weather: any, startHourOverride?: number, radar?: RadarForRefine) {
  const h = weather.hourly;
  if (!h?.time) return null;
  const today = weather.daily.time[0];
  const tomorrow = weather.daily.time[1];
  // Dynamic start: from "now" (current Zurich hour) until 05:00 next day.
  // Cap minimum at 0 (full day) and maximum at 23 (latest sensible evening start).
  const rawStart = startHourOverride ?? currentZurichHour();
  const startHour = Math.max(0, Math.min(23, rawStart));
  const slice: Array<{ t: string; i: number }> = (h.time as string[])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const dt = new Date(t);
      const dateStr = t.slice(0, 10);
      return (dateStr === today && dt.getHours() >= startHour) || (dateStr === tomorrow && dt.getHours() < 5);
    });
  if (!slice.length) return null;

  // Collect arrays for ALL models — Whitelist via gemeinsamem Helper, damit z. B.
  // precipitation_probability_<model> nicht als eigenes „Modell" durchrutscht.
  const collectArrs = makeCollectArrs(weather);

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

  // Hour-by-hour averages across models — long-range Modelle ausschliessen,
  // da sie für die nächsten Stunden zu grob sind und den Mittelwert verzerren.
  const isUsableModel = (m: string) => !HOURLY_LONGRANGE_BLOCKLIST.some((b) => m.includes(b));
  const hourAvg = (arrs: Record<string, number[]>, i: number): number | null => {
    const entries = Object.entries(arrs).filter(([m]) => m === "default" || isUsableModel(m));
    const useArrs = entries.length ? entries : Object.entries(arrs);
    const vals = useArrs
      .map(([, arr]) => arr[i])
      .filter((v) => v != null && Number.isFinite(v));
    return vals.length ? avg(vals) : null;
  };

  // Modell-Coverage pro Stunde (anhand Temperatur, da fast jedes Modell sie liefert).
  const usableTempArrs: Record<string, number[]> = Object.fromEntries(
    Object.entries(tArrs).filter(([m]) => m === "default" || isUsableModel(m)),
  );
  const coveragePerHour = slice.map(({ i }) => {
    let n = 0;
    for (const arr of Object.values(usableTempArrs)) {
      const v = arr?.[i];
      if (v != null && Number.isFinite(v)) n++;
    }
    return n;
  });
  const thinHours = coveragePerHour.filter((n) => n < 2).length;
  const thinRatio = coveragePerHour.length ? thinHours / coveragePerHour.length : 0;
  const degraded_hourly: { reason: "short_tier_thin" | "short_tier_unavailable"; thin_ratio: number; total_hours: number; thin_hours: number } | null =
    thinRatio >= 0.3
      ? { reason: thinRatio >= 0.8 ? "short_tier_unavailable" : "short_tier_thin", thin_ratio: Math.round(thinRatio * 100) / 100, total_hours: coveragePerHour.length, thin_hours: thinHours }
      : null;
  if (degraded_hourly) {
    console.warn(`[forecast] ${degraded_hourly.reason}: ${thinHours}/${coveragePerHour.length} h mit <2 Modellen — heutige Tier-Liste reicht für das Restfenster nicht aus.`);
  }

  const hourlyTemps = slice.map(({ i, t }) => weightedHourValue(tArrs, i, TEMP_HOURLY_WEIGHTS, t)).filter((v): v is number => v != null);
  const hourlyPrecs = slice.map(({ i, t }) => weightedHourValue(pArrs, i, PRECIP_HOURLY_WEIGHTS, t) ?? 0);
  const hourWeightedWind = (i: number): number | null => {
    const per: Record<string, number> = {};
    for (const [m, arr] of Object.entries(wArrs)) {
      const v = arr?.[i];
      if (v != null && Number.isFinite(v) && m in WIND_WEIGHTS) per[m] = v;
    }
    const w = weightedWindAvg(per);
    return w ? w.avg : hourAvg(wArrs, i);
  };
  const hourlyWinds = slice.map(({ i }) => hourWeightedWind(i)).filter((v): v is number => v != null);
  const hourlyClouds = slice.map(({ i, t }) => weightedHourValue(cArrs, i, CLOUD_SUN_WEIGHTS, t)).filter((v): v is number => v != null);
  const hourlySuns = slice.map(({ i, t }) => weightedHourValue(sArrs, i, CLOUD_SUN_WEIGHTS, t)).filter((v): v is number => v != null);

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
  // Per-Stunde gewichtetes Richtungsmittel (nur priorisierte Modelle), dann zirkuläres Mittel über die Stunden.
  const hourlyDirs: number[] = [];
  for (const { i } of slice) {
    const per: Record<string, number> = {};
    for (const [m, arr] of Object.entries(wdArrs)) {
      const v = arr?.[i];
      if (v != null && Number.isFinite(v) && m in WIND_WEIGHTS) per[m] = v;
    }
    const d = weightedCircularMeanDeg(per);
    if (d != null) hourlyDirs.push(d);
  }
  let wind_dir_avg = circularMeanDeg(hourlyDirs);
  if (wind_dir_avg == null) {
    const samples: number[] = [];
    for (const arr of Object.values(wdArrs)) {
      for (const { i } of slice) {
        const v = arr[i];
        if (v != null && Number.isFinite(v)) samples.push(v);
      }
    }
    wind_dir_avg = circularMeanDeg(samples);
  }
  const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
  const wind_max = hourlyWinds.length ? r1(Math.max(...hourlyWinds)) : null;
  const wind_label = buildWindLabel(wind_dir_avg, wind_max);

  // Human-readable window description for the prompt
  const endHour = 5;
  const window_label =
    startHour < 12 ? `${String(startHour).padStart(2, "0")}:00 (heute) bis ${String(endHour).padStart(2, "0")}:00 (morgen früh) - umfasst Tag, Abend und Nacht`
    : startHour < 17 ? `${String(startHour).padStart(2, "0")}:00 bis ${String(endHour).padStart(2, "0")}:00 - Nachmittag, Abend und Nacht`
    : `${String(startHour).padStart(2, "0")}:00 bis ${String(endHour).padStart(2, "0")}:00 - Abend und Nacht`;

  const precip_total_raw = r1(hourlyPrecs.reduce((a, b) => a + b, 0));

  // Stundenscharfe Veredelung: pro Stunde die beste verfügbare Quelle wählen.
  // Reihenfolge: Radar-Nowcast (0–2h) > ICON-CH1 radar-assimiliert (2–6h) > Modellmittel.
  const radarMap = new Map<string, number>();
  for (const r of radar?.forecast_hours ?? []) radarMap.set(r.time, r.mm);
  const nowcastMap = new Map<string, number>();
  for (const r of radar?.forecast_next_2h?.hours ?? []) nowcastMap.set(r.time, r.mm);

  const precip_by_hour: Array<{ time: string; mm: number; source: string }> = [];
  for (let k = 0; k < slice.length; k++) {
    const { t } = slice[k];
    const fallbackMm = hourlyPrecs[k] ?? 0;
    let mm = fallbackMm;
    let source = "om_hourly_short_tier";
    if (nowcastMap.has(t)) {
      mm = nowcastMap.get(t)!;
      source = "radar_nowcast";
    } else if (radarMap.has(t)) {
      mm = radarMap.get(t)!;
      source = "icon_ch1_radar";
    }
    precip_by_hour.push({ time: t, mm: r1(mm), source });
  }
  const precip_total_refined = r1(precip_by_hour.reduce((a, b) => a + b.mm, 0));
  const sourceCounts: Record<string, number> = {};
  for (const h of precip_by_hour) sourceCounts[h.source] = (sourceCounts[h.source] ?? 0) + 1;
  const sourcesSummary = Object.entries(sourceCounts)
    .map(([s, c]) => `${c}h ${s}`)
    .join(" · ");

  return {
    window_start_hour: startHour,
    window_end_hour: endHour,
    window_label,
    tmin: r1(Math.min(...hourlyTemps)),
    tmax: r1(Math.max(...hourlyTemps)),
    precip_total: precip_total_refined,
    precip_total_raw_om: precip_total_raw,
    precip_by_hour,
    precip_sources: sourcesSummary,
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
    degraded_hourly,
  };
}

// Tageszeit-Begriffe abhängig von der aktuellen Zürcher Stunde.
function timeOfDayConstraints(hour: number): { allowed: string[]; forbidden: string[] } {
  const segments: Array<{ name: string; endsAt: number }> = [
    { name: "frühe Morgenstunden", endsAt: 5 },
    { name: "Morgen", endsAt: 10 },
    { name: "Vormittag", endsAt: 12 },
    { name: "Mittag", endsAt: 14 },
    { name: "Nachmittag", endsAt: 17 },
    { name: "Abend", endsAt: 22 },
  ];
  const allowed: string[] = [];
  const forbidden: string[] = [];
  for (const s of segments) {
    if (s.endsAt > hour) allowed.push(s.name);
    else forbidden.push(s.name);
  }
  // "Nacht" immer erlauben (Fenster reicht bis 05 Folgetag).
  allowed.push("Nacht");
  return { allowed, forbidden };
}

function buildTimeOfDayHint(hour: number): string {
  const { allowed, forbidden } = timeOfDayConstraints(hour);
  const hh = String(hour).padStart(2, "0");
  let s = `\n\nAKTUELLE UHRZEIT: ${hh}:00 (Europe/Zurich). Erwähne AUSSCHLIESSLICH noch kommende Tageszeiten: ${allowed.join(", ")}.`;
  if (forbidden.length) {
    s += ` Folgende Tageszeiten sind bereits vergangen und dürfen NICHT erwähnt werden: ${forbidden.join(", ")}.`;
  }
  return s;
}

// Builds the first ("today") entry data + title + prompt-hint based on Zurich hour.
// < 12: full day. >= 12: rest-of-day window via formatEveningNight().
function buildFirstEntryContext(
  weather: any,
  withTopo: (i: number) => any,
  today: string,
  radarSnapshot?: RadarForRefine,
) {
  const hour = currentZurichHour();
  const useEvening = hour >= 12;
  const evening = useEvening ? formatEveningNight(weather, undefined, radarSnapshot) : null;
  let firstData: any;
  let windowHint = "";
  if (useEvening && evening) {
    const base = withTopo(0) ?? {};
    firstData = {
      ...evening,
      date: today,
      topography: base.topography ?? null,
    };
    windowHint = `\n\nWICHTIG: Dieser Eintrag beschreibt AUSSCHLIESSLICH den Zeitraum ${evening.window_label}. Beziehe dich nur auf diese Stunden, NICHT auf den schon vergangenen Tagesabschnitt. Beschreibe den Verlauf chronologisch innerhalb dieses Fensters.`;
  } else {
    firstData = withTopo(0);
  }
  windowHint += buildTimeOfDayHint(hour);
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
  const timeout = setTimeout(() => controller.abort(), 30000);
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
        // gemini-2.5-flash: schneller als pro und kein Free-Tier-Bottleneck
        // (vermeidet ~3-5s pro Call durch Gemini-Free 429 + Gateway-Fallback)
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        top_p: 0.9,
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

═══════════════════════════════════════════════════════════
OBERSTE STIL-REGEL: NOMINAL- / TELEGRAMMSTIL (NICHT VERHANDELBAR)
═══════════════════════════════════════════════════════════
Schreibe konsequent im Nominalstil (Telegrammstil). Substantiv-Phrasen statt Vollverben.
Finite Vollverben sind grundsätzlich zu vermeiden. Hilfsverben ("sein", "werden", "bleiben") nur, wenn unumgänglich.
Jeder Satz, der mit einem konjugierten Vollverb arbeitet, ist ein Verstoss gegen diese Regel.

VORHER → NACHHER (genau so umsetzen):
- "die Sonne scheint" → "Sonnenschein"
- "Wolken ziehen auf" → "Aufzug von Wolkenfeldern"
- "es regnet zeitweise" → "zeitweise Regen"
- "es schneit am Morgen" → "am Morgen Schneefall"
- "der Wind weht mässig aus Westen" → "mässiger Westwind"
- "die Bewölkung nimmt zu" → "zunehmende Bewölkung"
- "es bilden sich Quellwolken" → "Bildung von Quellwolken"
- "der Himmel klart auf" → "Auflockerung der Bewölkung"
- "die Temperaturen steigen" → "steigende Temperaturen"
- "Gewitter sind möglich" → "lokal Gewitterneigung"

KONTRAST-BEISPIEL (Pflichtlektüre):
FALSCH (Verbalstil): "Am Morgen scheint die Sonne, später ziehen Wolken auf und es regnet zeitweise. Der Wind weht mässig aus Westen."
RICHTIG (Nominalstil): "Am Morgen sonnig, im Tagesverlauf Aufzug von Wolkenfeldern - zeitweise Regen. Mässiger Westwind."
═══════════════════════════════════════════════════════════

WEITERE VERBINDLICHE REGELN:
- Schweizer Hochdeutsch: IMMER "ss" statt "ß".
- KEINE Überschriften, KEINE Titel, KEINE Anrede, KEINE Aufzählungszeichen, KEINE Emojis, KEINE Markdown-Formatierung.
- KEINE Floskeln wie "insgesamt", "alles in allem", "zusammenfassend".
- Sachlich, nüchtern, präzise. Kurze, prägnante Sätze. Häufig Halbsätze mit Gedankenstrich " - " (Leerzeichen-Bindestrich-Leerzeichen).
- Absätze sind durch eine Leerzeile getrennt (\\n\\n). Jeder Absatz ist sehr kurz (1-3 Sätze).
- Alle Einträge (auch der erste „Heute"-Eintrag) basieren auf TAGES-Werten. Für „Heute" beschreibe den VERBLEIBENDEN Tagesverlauf chronologisch — verwende nur die im userPrompt unter „AKTUELLE UHRZEIT" aufgeführten erlaubten Tageszeiten und erwähne keine bereits vergangenen Tagesabschnitte.
- AUSNAHME: Wenn der Eintragstitel "Heute Nachmittag & Abend" oder "Heute Abend & Nacht" lautet, beziehen sich die mitgelieferten Werte (window_label, tmin, tmax, precip_total, wind_max, sunshine_h) AUSSCHLIESSLICH auf dieses Fenster (jetzt bis 05:00 Folgetag). Beschreibe nur diesen Zeitraum chronologisch — der bereits vergangene Tagesabschnitt darf NICHT erwähnt werden.

PFLICHT-VOKABULAR (verwenden wo passend): "Quellwolken", "Hochnebel", "hochnebelartige Wolkenfelder", "Restbewölkung", "Bisenströmung", "veränderlich bewölkt", "ziemlich sonnig", "Schaueraktivität", "mittelhohe und hohe Wolkenfelder", "Bewölkungsverdichtung", "trockene Phasen", "sonnige Lücken", "mit Blick nach Baden-Württemberg", "Alpstein", "Vorarlberg", "umliegende Berg- und Hügelzüge", "südlichere Regionen".

VERBOTEN: "Es wird", "Wir erwarten", "Insgesamt", "Bitte beachten", "zeigt sich", "präsentiert sich", "gestaltet sich", "der Himmel ist …", "das Wetter wird …", Wettercodes, Prozentangaben, exakte Uhrzeiten, Aufzählungen mit "-" am Zeilenanfang. Vollverb-Konstruktionen wie "die Sonne scheint", "Wolken ziehen auf", "es regnet", "der Wind weht" sind STRIKT zugunsten von Nominalphrasen zu vermeiden. KEINE poetischen, dramatischen oder erfundenen Begriffe wie "grössenwahnsinnige Wolken", "unsichtbare Wolken", "schützende Wolkenschicht", "die Sonnenstrahlen erreichen die Erde", "der Himmel öffnet sich", o.ä. NUR sachliche meteorologische Standardbegriffe aus dem Pflicht-Vokabular. Wenn unsicher: knapp und nüchtern bleiben.`;

export const DEFAULT_SKY_RULES = `HIERARCHIE DER DATENFELDER (strikt absteigend): "sky_label" > "sky_pattern" > "weathercode.avg" + "precip_prob.avg" > "cloudcover.avg" > "sunshine_h.avg". "sunshine_h" allein darf NIE eine sonnige Beschreibung rechtfertigen, wenn "precip_prob.avg" ≥ 50.

ABSOLUTE PRIORITÄT — "sky_label": Wenn "sky_label" gesetzt ist, MUSS diese Himmelsbeschreibung WÖRTLICH (oder leicht stilistisch angepasst, aber inhaltlich identisch) als erster Satz des Wetterverlauf-Absatzes übernommen werden. Es ist ABSOLUT VERBOTEN, ein "sky_label" zu ignorieren oder mit eigenen Beobachtungen aus "sunshine_h" zu überschreiben.

VERBOTS-KLAUSEL "kein sonnig": Wenn EINE der folgenden Bedingungen gilt:
- "precip_prob.avg" ≥ 60
- "weathercode.avg" ≥ 51
- "sky_pattern" ist eines von "schauer_dominant", "regnerisch_bewoelkt", "bedeckt"
DANN sind die Wörter "sonnig", "recht sonnig", "meist sonnig", "ziemlich sonnig", "heiter", "freundlich", "rasche Auflösung", "Auflockerung danach sonnig" ABSOLUT VERBOTEN. Erlaubte Alternativen für vereinzelte Aufhellungen: "sonnige Lücken", "Aufhellungen", "kurze trockene Phasen", "Wolkenlücken".

TAGESZEIT-KONSISTENZ (Sonne nur tagsüber): In Sätzen oder Satzteilen, die einen Nacht-Kontext beschreiben (Trigger: "in der Nacht", "nachts", "in der ersten/zweiten Nachthälfte", "gegen Mitternacht", "nach Sonnenuntergang", "vor Sonnenaufgang", "in den frühen Morgenstunden vor Sonnenaufgang"), sind die Wörter "sonnig", "teils sonnig", "recht/meist/ziemlich sonnig", "heiter", "freundlich", "Sonnenschein", "Aufhellungen", "sonnige Lücken", "Wolkenlücken" ABSOLUT VERBOTEN — die Sonne steht unter dem Horizont. Erlaubt sind stattdessen: "klar", "meist klar", "sternenklar", "gering bewölkt", "wolkenlos", "aufgelockerte Bewölkung", "stark bewölkt", "bedeckt", "Nebel-/Hochnebelfelder". Beispiel falsch: "In der Nacht meist klar, teils sonnig." → richtig: "In der Nacht meist klar, nur vereinzelt dünne Wolkenfelder."

KONSISTENZ-REGEL: Wenn der Wind-Absatz "in Schauernähe" oder "stürmische Böen in Schauernähe" enthält ODER "wind_gusts.class" = "strong"/"severe" ist, MUSS der Sky-Absatz Schauer/Regen/Niederschlag erwähnen. Widersprüche wie "recht sonnig … in Schauernähe" sind absolut verboten.

GEWITTER-PFLICHT: Wenn "thunderstorm.class" eines von "isolated", "scattered", "widespread" ist, MUSS der Sky-Absatz "Gewitterneigung", "lokale Gewitter" oder "Gewitter" enthalten.

WENN "sky_pattern" = "nebel_aufloesung" gesetzt ist, MUSS die Beschreibung den Verlauf abbilden: morgens Nebel-/Hochnebelfelder im Flachland (gerne mit "mit Blick nach Baden-Württemberg/Alpstein bereits sonnig"), ab spätem Vormittag Auflösung, am Nachmittag verbreitet sonnig. Tagesmittel von "sunshine_h"/"cloudcover" dürfen in diesem Fall NICHT für eine pauschale "stark bewölkt"-Aussage genutzt werden — der Tagesgang aus dem Stundenprofil hat Vorrang.

TAGESGANG (Pflicht): Wenn "precip_distribution" gesetzt ist, MUSST du die zeitliche Verteilung der Niederschläge im Wetterverlauf-Absatz abbilden. Pauschale 24-h-Aussagen wie "ganztags Schauer" sind verboten, wenn die Blöcke "blocks.morning/afternoon/evening" deutlich unterschiedliche mm-Summen zeigen (Faktor ≥ 2). Pflicht-Patterns:
- "frueh_regen_dann_sonne" → "Anfangs noch Regen oder Schauer, danach Auflockerung und am Nachmittag zunehmend freundlich/sonnige Phasen."
- "spaet_regen" → "Tagsüber meist trocken mit Aufhellungen, gegen Abend Regen oder Schauer."
- "nachmittag_konvektiv" → "Vormittags freundlich, im Tagesverlauf zunehmende Quellbewölkung und am Nachmittag einzelne Schauer."
Nutze die Blocknamen "Vormittag", "Nachmittag", "Abend" — KEINE exakten Uhrzeiten.

Bei weathercode 45 oder 48 bei der MEHRHEIT der Modelle (in "weathercode.by_model"): Du MUSST "Nebel" oder "Hochnebel" verwenden. Die Begriffe "stark bewölkt", "bedeckt", "trübe" oder "grau in grau" sind in diesem Fall ABSOLUT VERBOTEN — auch wenn sunshine_h niedrig ist.

Bei "Sonnig und wolkenlos" sind Formulierungen wie "einige Wolken", "Schönwetterwolken", "vorüberziehende Wolkenfelder", "leichte Bewölkung" usw. ABSOLUT VERBOTEN.

FALLBACK (nur wenn KEIN sky_label vorgegeben): Leite die Bewölkung primär aus "sunshine_h" ab: ≥ 10h = "sonnig"/"klar"/"meist sonnig", 6-10h = "ziemlich sonnig"/"heiter", 3-6h = "wechselnd bewölkt"/"zeitweise sonnig", < 3h = "stark bewölkt"/"bedeckt". Beachte zusätzlich "weathercode" (0-1 = klar/heiter, 2 = teils bewölkt, 3 = bedeckt). Wenn "cloudcover_source" = "model", darf "cloudcover.avg" genutzt werden. Bei "derived_from_sunshine" oder fehlend: NUR "sunshine_h"/"weathercode" verwenden.

MODELL-UNSICHERHEIT: Wenn die Daten einen "spread"-Wert > 3 (Grad oder mm) zeigen oder die Modelle unterschiedliche Niederschlagssignale liefern, formuliere zurückhaltend ("veränderlich", "unsicher", "teils", "verbreitet zeitweise", "lokal unterschiedlich"). Bei kleinem spread konkrete Werte nennen. Wenn "cloudcover.spread" ≥ 30 % oder "sunshine_h.spread" ≥ 4 h, sind definitive Aussagen ("durchgehend sonnig", "ganztags bedeckt") verboten — stattdessen "veränderlich bewölkt" / "wechselnd bewölkt".

WOLKENSCHICHTEN ("cloud_layers", optional — nur wenn "cloud_layers.has_data" = true):
- "cloud_layers.day": Tagesmittel der tiefen / mittleren / hohen Bewölkung (in %).
- "cloud_layers.morning" / "cloud_layers.afternoon": gleiche Werte für Vormittag (06–12) und Nachmittag (12–18).
Verwende die Schichten zur präziseren Beschreibung:
- viel "high" (≥ 60 %) bei wenig "low"+"mid" (≤ 30 %): "hohe Schleierwolken", "milchige Sonne", "Sonne durch hohe Wolkenfelder".
- viel "low" (≥ 75 %) morgens: "Hochnebel", "tiefe Wolkendecke", "stratusartige Bewölkung". Niemals "von Beginn an sonnig" formulieren, wenn "cloud_layers.morning.low" ≥ 75 %.
- viel "mid" bei wenig "low": "mittelhohe Wolkenfelder", "Altostratus-artige Bewölkung".
Wenn "sky_pattern" = "schleierwolken_sonnig", "hochnebel_lage" oder "hochnebel_truebe", MUSS die Schichtinformation in der Beschreibung anklingen.

TAGESGANG WOLKEN/SONNE ("cloud_sun_distribution", optional): Enthält pro Block (Vormittag, Nachmittag, Abend) "cloud_avg" %, "cloud_low_avg" %, "sun_min" Minuten und "sunny_hours" (Anzahl Stunden mit ≥ 30 min Sonne). Wenn ein Block deutlich sonniger ist als ein anderer (Differenz "sun_min" ≥ 90), MUSS dieser Tagesgang im Wetterverlauf-Absatz abgebildet werden — z. B. "am Vormittag tiefe Wolkendecke, am Nachmittag zunehmend sonnige Phasen". Pauschale Tagesaussagen sind verboten, wenn die Blöcke deutlich differieren.`;

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
Eine abweichende Windbezeichnung gilt als Verstoss gegen die Vorgaben.

WIND-REGIME (Druckgradient):
Wenn "wind_regime.class" = "foehn_strong" oder "foehn_weak", erwähne kurz föhnige Aufhellungen / mildere Temperaturen im Wind-Absatz (nur wenn nicht im Widerspruch zur "wind_label").
Wenn "wind_regime.class" = "bise_strong" oder "bise_weak" und "wind_label" eine Ostkomponente hat (Bise/Nordost/Ost), darf der Wind-Absatz "trockenkalt" o. ä. ergänzen.
Bei "wind_regime.class" = "none": KEINE Erwähnung des Druckgradienten.

SCHNEEFALLGRENZE:
Wenn "snow_line.class" = "low" UND im Tag Niederschlag fällt (precip.avg ≥ 1 mm), MUSS ein kurzer Hinweis im Wetterverlauf-Absatz stehen, z. B. "Schneefallgrenze um {snow_line.snow_line_min} m" oder "in höheren Lagen Schneefall ab ca. {snow_line.snow_line_min} m".
Bei "snow_line.class" = "high_terrain_only": optional "auf den höchsten Hügelzügen evtl. Schneeflocken".
Bei "snow_line.class" = "none" oder fehlend: KEINE Erwähnung der Schneefallgrenze.`;

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
    "=== PFLICHTREGELN HIMMEL (NICHT ÜBERSCHREIBBAR) ===",
    `WENN das Datenfeld "sky_pattern" = "nebel_aufloesung" gesetzt ist, MUSS der Wetterverlauf-Absatz die Nebel-/Hochnebel-Auflösung explizit nennen. Pflichtbausteine: (1) am frühen Morgen "Nebel- oder Hochnebelfelder" (gerne mit Zusatz "im Flachland", "mit Blick nach Baden-Württemberg/Alpstein bereits sonnig"), (2) ab spätem Vormittag "rasche Auflösung" oder "im Tagesverlauf Auflösung", (3) danach passend zur Sonnendauer formulieren. "Stark bewölkt am Morgen" allein ist NICHT zulässig — der Begriff Nebel oder Hochnebel MUSS fallen.
WENN "sunshine_h.avg" ≥ 9, formuliere den Tag insgesamt als "ziemlich sonnig", "recht sonnig" oder "meist sonnig" — NICHT als "teilweise sonnig" mit "zunehmend bewölkt". Zusätzliche Wolkenfelder am Nachmittag dürfen genannt werden, dürfen aber den sonnigen Grundcharakter nicht überdecken.
Tagesmittel "cloudcover.avg" darf den Tagesgang aus dem STUNDENPROFIL NIEMALS überstimmen — das Stundenprofil hat Vorrang.`,
    "",
    "=== REGELN TEMPERATUR ===",
    temp,
    "",
    "=== REGELN WIND ===",
    wind,
    "",
    "=== NOWCAST / KONFIDENZ ===",
    "Wenn der Datensatz ein Feld `nowcast` enthält: nutze `observed_now` (aktuelle Stationswerte) und `next_2h.trend` als verlässliche Anker für die ersten Stunden. Wenn `nowcast.confidence` 'niedrig' ist, formuliere vorsichtiger ('zeichnet sich ab', 'deutet sich an', 'unsichere Lage'). Bei `next_2h.trend === 'zunehmend'` Niederschlag explizit erwähnen, bei 'trocken' keine Schauer ankündigen. Bei `night_fog_likely === true` auf mögliches Aufkommen von Nebel hinweisen statt auf besonders kalte Nacht.",
    "",
    "=== NIEDERSCHLAGS-TAGESGANG ===",
    "Wenn der Datensatz ein Feld `precip_distribution` enthält, beschreibe den Tagesverlauf des Niederschlags entsprechend den vier Blöcken (night = 'in der Nacht', morning = 'am Vormittag', afternoon = 'am Nachmittag', evening = 'am Abend').\n- `peak_block` nennt den Block mit dem Hauptniederschlag (nur wenn ≥ 1 mm). Diesen Block explizit hervorheben.\n- Wenn `peak_hour` gesetzt ist, die Stunde im Text grob nennen ('um den Mittag', 'gegen 17 Uhr', 'in den späten Nachmittagsstunden') — nie als exakte Uhrzeit ('um 14:00').\n- `dry_windows` (≥ 3h trocken) explizit als 'längere trockene Phase am Vormittag' o. ä. erwähnen, wenn es zwischen Niederschlagsphasen liegt.\n- Andere Blöcke nur erwähnen wenn `precip_mm` ≥ 1 mm; Blöcke mit 0 mm dürfen als trocken/niederschlagsfrei beschrieben werden.\n- Intensität nach `peak_block_prob`: ≥ 70 → bestimmt formulieren ('Regen', 'Schauer'); 40-69 → 'zeitweise Schauer'; < 40 → 'vereinzelt Schauer möglich'.\n- Wenn `peak_block` null ist (Tagessumme < 1 mm), den Tag als überwiegend trocken beschreiben.\n- Wenn `precip_distribution` fehlt: wie bisher, Tagesverlauf frei nach Standardregeln formulieren.\nWenn `mix_weights` vorhanden ist (Tag 0): die Werte sind ein gewichteter Mix aus Open-Meteo Multi-Modell und MOSMIX, zusätzlich mit Stations-Bias, Bias-Korrektur und Nowcast/Radar veredelt. Mix-Verhältnis nicht im Text erwähnen.\nWenn `mosmix_reference` vorhanden ist: NUR als interne Plausibilitätskontrolle nutzen, NICHT im Text erwähnen oder Werte daraus zitieren.",
    "",
    "=== STUNDENPROFIL (TAG 0 + 1) ===",
    "Wenn im userPrompt ein Block 'STUNDENPROFIL' folgt, ist das die HÖCHSTE Auflösung des Tagesgangs (eine Zeile pro Stunde, Median über alle verfügbaren Modelle, in Klammern die Modell-Streuung). Nutze ihn primär zur Bestimmung wann genau Bewölkung, Niederschlag, Sonne oder Wind wechseln. Übersetze Stundenangaben in Tageszeit-Bezüge ('am Vormittag', 'gegen Mittag', 'am späten Nachmittag', 'in der ersten Nachthälfte') — nie exakte Uhrzeiten nennen. Bei grosser Streuung (±) vorsichtig formulieren ('zeichnet sich ab', 'lokal unterschiedlich'). Wenn das Profil widersprüchlich zu den Tagesaggregaten ist, hat das Profil Vorrang für die Tagesgang-Beschreibung; die Aggregate (tmin/tmax) bleiben für die Temperaturangaben verbindlich. Spalte 'Quelle' (nur Tag 0) ist ein internes Qualitätssignal: 'obs'-Werte sind verbindlich und haben Vorrang vor Modellwerten, 'mix' = Übergang für die laufende Stunde, 'mod' = Modellprognose. WICHTIG: Die Datenquelle darf im Text NICHT erwähnt werden — Begriffe wie 'gemessen', 'beobachtet', 'laut Messung', 'Stationsdaten', 'im Rückblick' o. Ä. sind verboten. Die Prognose bleibt durchgehend eine einheitliche Wetterbeschreibung, unabhängig davon ob ein Wert aus Messung oder Modell stammt.",
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

// Variante C: Tag 0 als gewichteter Mix von Open-Meteo (omDay) und MOSMIX (mosmixDay).
// Mischt nur die avg-Werte ausgewählter Felder; die Open-Meteo-Struktur (min/max/spread/by_model)
// bleibt erhalten, damit die Modell-Tabelle in der UI weiterhin funktioniert.
function mixOmWithMosmix(omDay: any, mosmixDay: any, wMosmixPct: number, wOmPct: number): any {
  if (!omDay) return omDay;
  if (!mosmixDay) return omDay;
  const total = Math.max(1, wMosmixPct + wOmPct);
  const wM = wMosmixPct / total;
  const wO = wOmPct / total;
  const mixField = (omAgg: any, mosVal: number | null | undefined): any => {
    if (!omAgg || omAgg.avg == null) {
      if (mosVal == null) return omAgg;
      return { avg: mosVal, min: mosVal, max: mosVal, spread: 0, by_model: {} };
    }
    if (mosVal == null) return omAgg;
    const mixed = wM * mosVal + wO * omAgg.avg;
    return { ...omAgg, avg: Math.round(mixed * 10) / 10 };
  };
  const out: any = {
    ...omDay,
    tmin: mixField(omDay.tmin, mosmixDay.tmin?.avg ?? null),
    tmax: mixField(omDay.tmax, mosmixDay.tmax?.avg ?? null),
    precip: mixField(omDay.precip, mosmixDay.precip?.avg ?? null),
    wind_max: mixField(omDay.wind_max, mosmixDay.wind_max?.avg ?? null),
    cloudcover: mixField(omDay.cloudcover, mosmixDay.cloudcover?.avg ?? null),
    source: "mix_om_mosmix",
    mix_weights: { mosmix_pct: Math.round(wM * 100), om_pct: Math.round(wO * 100) },
    mosmix_reference: {
      tmin: mosmixDay.tmin?.avg ?? null,
      tmax: mosmixDay.tmax?.avg ?? null,
      precip: mosmixDay.precip?.avg ?? null,
      wind_max: mosmixDay.wind_max?.avg ?? null,
      cloudcover_avg: mosmixDay.cloudcover?.avg ?? null,
      stations: mosmixDay.mosmix_stations ?? [],
      per_station: mosmixDay.mosmix_per_station ?? {},
    },
  };
  return out;
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

    // ICON-MOS (DWD MOSMIX) für Tag 0 + 1 holen, sofern aktiviert.
    // MOSMIX ist bereits statistisch gegen Stationsmessungen kalibriert,
    // daher entfällt für diese Tage die eigene Stations-Bias-Korrektur.
    const mosmixEnabled = settings?.mosmix_enabled !== false;
    const mosmixStations = (settings?.mosmix_stations ?? "10935,10929")
      .split(",").map((s: string) => s.trim()).filter(Boolean);

    const { weather, mosmixByDate, degraded } = await fetchWeatherWithFallback(
      lat, lon,
      settings?.models_shortterm ?? undefined,
      settings?.models_midterm ?? undefined,
      settings?.models_longterm ?? undefined,
      mosmixEnabled, mosmixStations,
    );
    const topo = await ensureTopography(supabase, settings);
    const stationBiases = degraded
      ? []
      : await getOrSetCache("stations:bias", buildStationBiases);

    const tag2WM = Math.max(0, Math.min(100, settings?.tag2_weight_mosmix ?? 25));
    const tag2WO = Math.max(0, Math.min(100, settings?.tag2_weight_om ?? 75));
    const tag3WM = Math.max(0, Math.min(100, settings?.tag3plus_weight_mosmix ?? 45));
    const tag3WO = Math.max(0, Math.min(100, settings?.tag3plus_weight_om ?? 55));
    // Baustein 1: refine Tag 1 nur, wenn der Erst-Eintrag tatsächlich die Vornacht
    // abdeckt (formatEveningNight läuft bei Stunde >= 12 und reicht bis 05:00 nächster Tag).
    // Sonst entsteht eine künstliche 00–06-Lücke für Tag 1.
    const tag1RefineFrom = currentZurichHour() >= 12 ? 6 : 0;
    const buildDay = (dayIndex: number) => {
      const omDayBase = formatDayData(weather, dayIndex);
      const omDay = dayIndex === 1 ? refineDayFromHour(omDayBase, weather, 1, tag1RefineFrom) : omDayBase;
      if (!omDay) return null;
      // MOSMIX-Beimischung: Tag 0/1 ohne MOSMIX (Radar/Nowcast/SMN-Bias dominieren),
      // Tag 2 moderat, ab Tag 3 stärker als statistische Stützung der Mittelfrist.
      const mosmixDay = mosmixByDate.get(omDay.date) ?? null;
      let base: any = omDay;
      if (dayIndex === 2 && mosmixDay) {
        base = mixOmWithMosmix(omDay, mosmixDay, tag2WM, tag2WO);
      } else if (dayIndex >= 3 && mosmixDay) {
        base = mixOmWithMosmix(omDay, mosmixDay, tag3WM, tag3WO);
      }
      const out: any = { ...base, topography: applyTopography(base, topo) };
      const st = applyStationBias(base, stationBiases);
      if (st) out.stations = st;
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
    const [pressureSeries, snowSeries, nowcastInputs] = await Promise.all([
      fetchPressureGradient().catch((e) => { console.warn("pressure-gradient failed", e); return [] as DayPressure[]; }),
      fetchSnowLine(lat, lon).catch((e) => { console.warn("snow-line failed", e); return [] as DaySnowLine[]; }),
      (settings?.nowcast_enabled !== false)
        ? fetchNowcastInputs(lat, lon, biasStations).catch((e) => { console.warn("nowcast inputs failed", e); return null; })
        : Promise.resolve(null),
    ]);
    const pressureByDate = new Map(pressureSeries.map((p) => [p.date, p]));
    const snowByDate = new Map(snowSeries.map((s) => [s.date, s]));
    const withTopo = (dayIndex: number) => {
      let out = buildDay(dayIndex);
      if (!out) return null;
      // Bias-Korrektur greift jetzt auf allen Tagen (Tag 0 enthält 60 % Open-Meteo).
      if (bias && bias.applied) {
        out = applyBiasToDay(out, bias);
      }
      // Nowcast nur für Tag 0 (erste 12h)
      if (dayIndex === 0 && nowcastInputs) {
        const nc = computeNowcastResult(out, nowcastInputs, {
          night_clear_cooling_c: settings?.night_clear_cooling_c,
          nowcast_obs_horizon_h: settings?.nowcast_obs_horizon_h,
        });
        out = applyNowcastToDay(out, nc);
        if (out.hourly_profile) {
          out.hourly_profile = applyObservedOverlay(
            out.hourly_profile, out.date, nowcastInputs.smn, nowcastInputs.radar,
          );
        }
      }
      applyRadarToDay(out, dayIndex, radarSnapshot, settings);
      applyRegimeToDay(out, pressureByDate, snowByDate);
      if (out.precip_distribution && dayIndex <= 1) {
        const elev = out?.topography?.elev_median ?? 450;
        const phase = assessPrecipPhase(weather, dayIndex, out.snow_line ?? null, elev, out.precip_distribution);
        if (phase) out.precip_phase = phase;
      }
      return normalizeSkyDiagnostics(out);
    };
    const today = weather.daily.time[0];
    const { data: forecast, error: fErr } = await supabase
      .from("forecasts")
      .insert({ forecast_date: today, status: "draft", created_by: userId })
      .select()
      .single();
    if (fErr) throw new Error(fErr.message);

    const tasks: Array<Promise<{ position: number; entry_date: string | null; title: string; body: string; weather_data: any }>> = [];

    const degradedNote = degraded
      ? "**Eingeschränkter Modus:** Open-Meteo Tageslimit erreicht — nur DWD-MOSMIX (Tag 1 + 2) verfügbar. Mittel- und Langfristprognose sowie Trend Tag 6 – 10 entfallen heute.\n\n"
      : "";
    const maxDayLoop = degraded ? 1 : 5;

    const { firstData, firstTitle, windowHint } = buildFirstEntryContext(weather, withTopo, today, radarSnapshot);
    {
      const tempHint = firstTitle === "Heute Nachmittag & Abend"
        ? `\n\nTEMPERATUR-AUSNAHME (Tag 0, Nachmittag/Abend): Dieser Eintrag darf KEINEN Tiefstwerte-Satz enthalten — kein "Tiefstwerte ...", keine Nacht-Temperaturen, keine Bodenfrost-/Senken-Notiz. Tiefstwerte werden ausschliesslich in den späteren Abend-/Nachtprognosen genannt. Absatz 2 enthält nur "Höchstwerte um Z Grad." (sofern noch nicht erreicht) oder entfällt. Diese Ausnahme überschreibt die Standard-Temperatur-Regeln.`
        : "";
      const userPrompt = buildDayUserPrompt(`Standort: ${locationName} (Radius 15 km). Schreibe einen Fliesstext für "${firstTitle}" auf Basis dieser Daten:`, firstData, windowHint + tempHint);
      tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
        position: 1, entry_date: today, title: firstTitle,
        body: degradedNote + enforceFrostWarning(stripTiefstwerteForAfternoon(enforceSkyConsistency(body, firstData), firstTitle), firstData),
        weather_data: firstData,
      })));
    }

    for (let i = 1; i <= maxDayLoop; i++) {
      const day = withTopo(i);
      if (!day) continue;
      const date = new Date(day.date);
      const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
      const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
      const title = i === 1 ? `Morgen, ${weekday} ${formatted}` : `${weekday}, ${formatted}`;
      const tag1Hint = i === 1 && firstTitle === "Heute Abend & Nacht"
        ? `\n\nWICHTIG: Dieser Eintrag beschreibt AUSSCHLIESSLICH den Zeitraum ab 06:00 Uhr. Die Vornacht (00:00–06:00) wurde bereits im vorherigen Eintrag ("Heute Abend & Nacht") beschrieben und darf hier NICHT erwähnt werden — kein "in der Nacht", keine Beschreibung früher Morgenstunden vor 06:00.\n\nZUSÄTZLICH: Da die Tiefstwerte der kommenden Nacht bereits im vorherigen Eintrag ("Heute Abend & Nacht") genannt wurden, darf dieser Tag-1-Eintrag KEINEN Tiefstwerte-Satz enthalten (kein "Tiefstwerte ...", keine Bodenfrost-Notiz, kein Senken-Wert). Beginne Absatz 2 direkt mit "Höchstwerte um Z Grad." — oder lasse Absatz 2 weg, wenn keine Höchstwerte-Aussage nötig ist. Diese Ausnahme überschreibt die Standard-Temperatur-Regeln für diesen einen Eintrag.`
        : "";
      const userPrompt = buildDayUserPrompt(`Standort: ${locationName}. Schreibe einen Fliesstext für ${weekday}, ${formatted} auf Basis dieser Daten:`, day, tag1Hint);
      const pos = i + 1;
      tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
        position: pos, entry_date: day.date, title, body: enforceFrostWarning(enforceSkyConsistency(body, day), day), weather_data: day,
      })));
    }

    if (!degraded) {
      const trendDays = [6, 7, 8, 9, 10].map((i) => withTopo(i)).filter(Boolean);
      if (trendDays.length) {
        const synoptic = await fetchSynopticTrend(trendDays as any).catch((e: unknown) => {
          console.warn("[trend] synoptic fetch failed", e);
          return null;
        });
        const userPrompt = buildTrendUserPrompt(locationName, trendDays, synoptic);
        tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
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

    const mosmixEnabled = settings?.mosmix_enabled !== false;
    const mosmixStations = (settings?.mosmix_stations ?? "10935,10929")
      .split(",").map((s: string) => s.trim()).filter(Boolean);

    const { weather, mosmixByDate, degraded } = await fetchWeatherWithFallback(
      lat, lon,
      settings?.models_shortterm ?? undefined,
      settings?.models_midterm ?? undefined,
      settings?.models_longterm ?? undefined,
      mosmixEnabled, mosmixStations,
    );
    const topo = await ensureTopography(supabase, settings);
    const stationBiases = degraded
      ? []
      : await getOrSetCache("stations:bias", buildStationBiases);

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

    const [pressureSeries, snowSeries, nowcastInputs] = await Promise.all([
      fetchPressureGradient().catch((e) => { console.warn("pressure-gradient failed", e); return [] as DayPressure[]; }),
      fetchSnowLine(lat, lon).catch((e) => { console.warn("snow-line failed", e); return [] as DaySnowLine[]; }),
      (settings?.nowcast_enabled !== false)
        ? fetchNowcastInputs(lat, lon, biasStations).catch((e) => { console.warn("nowcast inputs failed", e); return null; })
        : Promise.resolve(null),
    ]);
    const pressureByDate = new Map(pressureSeries.map((p) => [p.date, p]));
    const snowByDate = new Map(snowSeries.map((s) => [s.date, s]));

    const tag2WM2 = Math.max(0, Math.min(100, settings?.tag2_weight_mosmix ?? 25));
    const tag2WO2 = Math.max(0, Math.min(100, settings?.tag2_weight_om ?? 75));
    const tag3WM2 = Math.max(0, Math.min(100, settings?.tag3plus_weight_mosmix ?? 45));
    const tag3WO2 = Math.max(0, Math.min(100, settings?.tag3plus_weight_om ?? 55));
    const withTopo = (dayIndex: number) => {
      const omDayBase = formatDayData(weather, dayIndex);
      const omDay = dayIndex === 1 ? refineDayFromHour(omDayBase, weather, 1, 6) : omDayBase;
      if (!omDay) return null;
      const mosmixDay = mosmixByDate.get(omDay.date) ?? null;
      let base: any = omDay;
      // MOSMIX nur ab Tag 2: Tag 0/1 laufen rein über Open-Meteo + Radar + SMN-Bias
      if (dayIndex === 2 && mosmixDay) {
        base = mixOmWithMosmix(omDay, mosmixDay, tag2WM2, tag2WO2);
      } else if (dayIndex >= 3 && mosmixDay) {
        base = mixOmWithMosmix(omDay, mosmixDay, tag3WM2, tag3WO2);
      }
      let out: any = { ...base, topography: applyTopography(base, topo) };
      const st = applyStationBias(base, stationBiases);
      if (st) out.stations = st;
      if (bias && bias.applied) {
        out = applyBiasToDay(out, bias);
      }
      if (dayIndex === 0 && nowcastInputs) {
        const nc = computeNowcastResult(out, nowcastInputs, {
          night_clear_cooling_c: settings?.night_clear_cooling_c,
          nowcast_obs_horizon_h: settings?.nowcast_obs_horizon_h,
        });
        out = applyNowcastToDay(out, nc);
        if (out.hourly_profile) {
          out.hourly_profile = applyObservedOverlay(
            out.hourly_profile, out.date, nowcastInputs.smn, nowcastInputs.radar,
          );
        }
      }
      applyRadarToDay(out, dayIndex, radarSnapshot, settings);
      applyRegimeToDay(out, pressureByDate, snowByDate);
      if (out.precip_distribution && dayIndex <= 1) {
        const elev = out?.topography?.elev_median ?? 450;
        const phase = assessPrecipPhase(weather, dayIndex, out.snow_line ?? null, elev, out.precip_distribution);
        if (phase) out.precip_phase = phase;
      }
      return normalizeSkyDiagnostics(out);
    };
    const today = weather.daily.time[0];

    // Replace existing entries
    const { error: delErr } = await supabase
      .from("forecast_entries")
      .delete()
      .eq("forecast_id", data.forecastId);
    if (delErr) throw new Error(delErr.message);

    const tasks: Array<Promise<{ position: number; entry_date: string | null; title: string; body: string; weather_data: any; forecast_id: string }>> = [];

    const degradedNote = degraded
      ? "**Eingeschränkter Modus:** Open-Meteo Tageslimit erreicht — nur DWD-MOSMIX (Tag 1 + 2) verfügbar. Mittel- und Langfristprognose sowie Trend Tag 6 – 10 entfallen heute.\n\n"
      : "";
    const maxDayLoop = degraded ? 1 : 5;

    const { firstData, firstTitle, windowHint } = buildFirstEntryContext(weather, withTopo, today, radarSnapshot);
    {
      const tempHint = firstTitle === "Heute Nachmittag & Abend"
        ? `\n\nTEMPERATUR-AUSNAHME (Tag 0, Nachmittag/Abend): Dieser Eintrag darf KEINEN Tiefstwerte-Satz enthalten — kein "Tiefstwerte ...", keine Nacht-Temperaturen, keine Bodenfrost-/Senken-Notiz. Tiefstwerte werden ausschliesslich in den späteren Abend-/Nachtprognosen genannt. Absatz 2 enthält nur "Höchstwerte um Z Grad." (sofern noch nicht erreicht) oder entfällt. Diese Ausnahme überschreibt die Standard-Temperatur-Regeln.`
        : "";
      const userPrompt = buildDayUserPrompt(`Standort: ${locationName} (Radius 15 km). Schreibe einen Fliesstext für "${firstTitle}" auf Basis dieser Daten:`, firstData, windowHint + tempHint);
      tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
        position: 1, entry_date: today, title: firstTitle,
        body: degradedNote + enforceFrostWarning(stripTiefstwerteForAfternoon(enforceSkyConsistency(body, firstData), firstTitle), firstData),
        weather_data: firstData, forecast_id: data.forecastId,
      })));
    }

    for (let i = 1; i <= maxDayLoop; i++) {
      const day = withTopo(i);
      if (!day) continue;
      const date = new Date(day.date);
      const weekday = date.toLocaleDateString("de-CH", { weekday: "long" });
      const formatted = date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
      const title = i === 1 ? `Morgen, ${weekday} ${formatted}` : `${weekday}, ${formatted}`;
      const tag1Hint = i === 1 && firstTitle === "Heute Abend & Nacht"
        ? `\n\nWICHTIG: Dieser Eintrag beschreibt AUSSCHLIESSLICH den Zeitraum ab 06:00 Uhr. Die Vornacht (00:00–06:00) wurde bereits im vorherigen Eintrag ("Heute Abend & Nacht") beschrieben und darf hier NICHT erwähnt werden — kein "in der Nacht", keine Beschreibung früher Morgenstunden vor 06:00.\n\nZUSÄTZLICH: Da die Tiefstwerte der kommenden Nacht bereits im vorherigen Eintrag ("Heute Abend & Nacht") genannt wurden, darf dieser Tag-1-Eintrag KEINEN Tiefstwerte-Satz enthalten (kein "Tiefstwerte ...", keine Bodenfrost-Notiz, kein Senken-Wert). Beginne Absatz 2 direkt mit "Höchstwerte um Z Grad." — oder lasse Absatz 2 weg, wenn keine Höchstwerte-Aussage nötig ist. Diese Ausnahme überschreibt die Standard-Temperatur-Regeln für diesen einen Eintrag.`
        : "";
      const userPrompt = buildDayUserPrompt(`Standort: ${locationName}. Schreibe einen Fliesstext für ${weekday}, ${formatted} auf Basis dieser Daten:`, day, tag1Hint);
      const pos = i + 1;
      tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
        position: pos, entry_date: day.date, title, body: enforceFrostWarning(enforceSkyConsistency(body, day), day), weather_data: day, forecast_id: data.forecastId,
      })));
    }

    if (!degraded) {
      const trendDays = [6, 7, 8, 9, 10].map((i) => withTopo(i)).filter(Boolean);
      if (trendDays.length) {
        const synoptic = await fetchSynopticTrend(trendDays as any).catch((e: unknown) => {
          console.warn("[trend] synoptic fetch failed", e);
          return null;
        });
        const userPrompt = buildTrendUserPrompt(locationName, trendDays, synoptic);
        tasks.push(generateTextNominal(promptTemplate, userPrompt).then((body) => ({
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

    const tempHint = entry.title === "Heute Nachmittag & Abend"
      ? `\n\nTEMPERATUR-AUSNAHME (Tag 0, Nachmittag/Abend): Dieser Eintrag darf KEINEN Tiefstwerte-Satz enthalten — kein "Tiefstwerte ...", keine Nacht-Temperaturen, keine Bodenfrost-/Senken-Notiz. Tiefstwerte werden ausschliesslich in den späteren Abend-/Nachtprognosen genannt. Absatz 2 enthält nur "Höchstwerte um Z Grad." (sofern noch nicht erreicht) oder entfällt. Diese Ausnahme überschreibt die Standard-Temperatur-Regeln.`
      : "";
    const userPrompt = buildDayUserPrompt(`Standort: ${locationName}. Schreibe einen Fliesstext für "${entry.title}" auf Basis dieser Daten:`, entry.weather_data, tempHint);
    const body = enforceFrostWarning(
      stripTiefstwerteForAfternoon(
        enforceSkyConsistency(await generateTextNominal(promptTemplate, userPrompt), entry.weather_data),
        entry.title,
      ),
      entry.weather_data,
    );
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
        tag0_weight_mosmix: z.number().int().min(0).max(100).optional(),
        tag0_weight_om: z.number().int().min(0).max(100).optional(),
        tag1_weight_mosmix: z.number().int().min(0).max(100).optional(),
        tag1_weight_om: z.number().int().min(0).max(100).optional(),
        tag2_weight_mosmix: z.number().int().min(0).max(100).optional(),
        tag2_weight_om: z.number().int().min(0).max(100).optional(),
        tag3plus_weight_mosmix: z.number().int().min(0).max(100).optional(),
        tag3plus_weight_om: z.number().int().min(0).max(100).optional(),
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
