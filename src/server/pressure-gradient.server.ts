// Druckgradient für Föhn-/Bise-Erkennung.
// Nutzt Open-Meteo `pressure_msl` an vier Referenzpunkten (Lugano/Zürich für
// Föhn-Süd-Nord-Gradient, Genf/St. Gallen für Bisen-West-Ost-Gradient).
import { getOrSetCache } from "./weather-cache.server";

type Point = { name: string; lat: number; lon: number };

const POINTS = {
  lugano: { name: "Lugano", lat: 46.00, lon: 8.95 },
  zurich: { name: "Zürich-Kloten", lat: 47.48, lon: 8.54 },
  geneva: { name: "Genf", lat: 46.25, lon: 6.13 },
  stgallen: { name: "St. Gallen", lat: 47.43, lon: 9.40 },
} as const satisfies Record<string, Point>;

export type WindRegimeClass =
  | "none"
  | "foehn_weak"
  | "foehn_strong"
  | "bise_weak"
  | "bise_strong";

export type DayPressure = {
  date: string;       // YYYY-MM-DD (Europe/Zurich)
  dp_foehn: number;   // hPa, p(Lugano) − p(Zürich)
  dp_bise: number;    // hPa, p(Genf) − p(St. Gallen)
  class: WindRegimeClass;
  label: string;
};

import { fetchOpenMeteo } from "./openmeteo-quota.server";

async function fetchPressureSeries(p: Point) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(p.lat));
  url.searchParams.set("longitude", String(p.lon));
  url.searchParams.set("hourly", "pressure_msl");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "Europe/Zurich");
  const res = await fetchOpenMeteo(url, "pressure_gradient");
  if (!res.ok) throw new Error(`Pressure fetch ${p.name} ${res.status}`);
  const j = (await res.json()) as { hourly?: { time?: string[]; pressure_msl?: number[] } };
  return j.hourly ?? { time: [], pressure_msl: [] };
}

function classify(dp_foehn: number, dp_bise: number): { class: WindRegimeClass; label: string } {
  if (dp_foehn >= 8) return { class: "foehn_strong", label: "Föhnlage" };
  if (dp_bise <= -6) return { class: "bise_strong", label: "Kräftige Bise" };
  if (dp_foehn >= 4) return { class: "foehn_weak", label: "Föhntendenz" };
  if (dp_bise <= -3) return { class: "bise_weak", label: "Bisentendenz" };
  return { class: "none", label: "neutral" };
}

export async function fetchPressureGradient(): Promise<DayPressure[]> {
  return getOrSetCache("pressure:gradient:v1", async () => {
    const [lug, zh, gen, sg] = await Promise.all([
      fetchPressureSeries(POINTS.lugano),
      fetchPressureSeries(POINTS.zurich),
      fetchPressureSeries(POINTS.geneva),
      fetchPressureSeries(POINTS.stgallen),
    ]);
    const times = lug.time ?? [];
    if (!times.length) return [];

    // Bucket nach Datum, dann Tagesmittel der Differenzen.
    const buckets = new Map<string, { f: number[]; b: number[] }>();
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const date = t.slice(0, 10);
      const pL = lug.pressure_msl?.[i];
      const pZ = zh.pressure_msl?.[i];
      const pG = gen.pressure_msl?.[i];
      const pS = sg.pressure_msl?.[i];
      if (
        typeof pL !== "number" || typeof pZ !== "number" ||
        typeof pG !== "number" || typeof pS !== "number"
      ) continue;
      const entry = buckets.get(date) ?? { f: [], b: [] };
      entry.f.push(pL - pZ);
      entry.b.push(pG - pS);
      buckets.set(date, entry);
    }

    const out: DayPressure[] = [];
    const dates = Array.from(buckets.keys()).sort();
    for (const date of dates) {
      const e = buckets.get(date)!;
      const dp_foehn = Math.round((e.f.reduce((a, b) => a + b, 0) / e.f.length) * 10) / 10;
      const dp_bise = Math.round((e.b.reduce((a, b) => a + b, 0) / e.b.length) * 10) / 10;
      const c = classify(dp_foehn, dp_bise);
      out.push({ date, dp_foehn, dp_bise, ...c });
    }
    return out;
  }, 60 * 60 * 1000); // 1 h
}
