// Schneefallgrenze aus Open-Meteo `freezing_level_height` (Hourly).
// Tagesweise min/avg/max; Schneefallgrenze ≈ Nullgradgrenze − 200 m.
import { getOrSetCache } from "./weather-cache.server";
import { fetchOpenMeteo } from "./openmeteo-quota.server";

export type SnowLineClass = "none" | "high_terrain_only" | "low";

export type DaySnowLine = {
  date: string;
  freezing_min: number;
  freezing_avg: number;
  freezing_max: number;
  snow_line_min: number;
  class: SnowLineClass;
  label: string;
};

function classify(snow_line_min: number): { class: SnowLineClass; label: string } {
  if (snow_line_min < 900) return { class: "low", label: `Schneefallgrenze sinkt bis ~${Math.round(snow_line_min / 50) * 50} m` };
  if (snow_line_min < 1500) return { class: "high_terrain_only", label: "Schnee nur in höchsten Lagen" };
  return { class: "none", label: "" };
}

export async function fetchSnowLine(lat: number, lon: number): Promise<DaySnowLine[]> {
  const key = `snowline:v1:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return getOrSetCache(key, async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("hourly", "freezing_level_height");
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("timezone", "Europe/Zurich");
    const res = await fetchOpenMeteo(url, "snow_line");
    if (!res.ok) {
      console.warn("snow-line fetch failed", res.status);
      return [];
    }
    const j = (await res.json()) as { hourly?: { time?: string[]; freezing_level_height?: number[] } };
    const times = j.hourly?.time ?? [];
    const fl = j.hourly?.freezing_level_height ?? [];
    if (!times.length) return [];

    const buckets = new Map<string, number[]>();
    for (let i = 0; i < times.length; i++) {
      const date = times[i].slice(0, 10);
      const v = fl[i];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      (buckets.get(date) ?? buckets.set(date, []).get(date)!).push(v);
    }

    const out: DaySnowLine[] = [];
    for (const date of Array.from(buckets.keys()).sort()) {
      const vals = buckets.get(date)!;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const snow_line_min = Math.max(0, min - 200);
      const c = classify(snow_line_min);
      out.push({
        date,
        freezing_min: Math.round(min),
        freezing_avg: Math.round(avg),
        freezing_max: Math.round(max),
        snow_line_min: Math.round(snow_line_min),
        ...c,
      });
    }
    return out;
  }, 60 * 60 * 1000);
}
