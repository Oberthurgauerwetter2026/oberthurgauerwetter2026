// SwissMetNet (SMN) - reale Messungen von MeteoSchweiz Open Data
// CSV-Endpoint pro Station, "recent" = letzte ~30 Tage stündlich.
// Quelle: https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/
import { getOrSetCache } from "./weather-cache.server";

// Bekannte Stationen rund um den Oberthurgau (Abkürzung -> Metadaten)
const KNOWN_SMN: Record<string, { name: string; lat: number; lon: number; elev: number }> = {
  GUT: { name: "Güttingen",        lat: 47.602, lon: 9.279, elev: 440 },
  STG: { name: "St. Gallen",       lat: 47.425, lon: 9.398, elev: 776 },
  TAE: { name: "Aadorf/Tänikon",   lat: 47.479, lon: 8.905, elev: 539 },
  SMA: { name: "Zürich/Fluntern",  lat: 47.378, lon: 8.566, elev: 556 },
  KLO: { name: "Zürich/Kloten",    lat: 47.480, lon: 8.536, elev: 426 },
};

export type SmnHourly = {
  station: string;
  name: string;
  lat: number;
  lon: number;
  elev: number;
  rows: Array<{
    time: string;       // ISO UTC
    temp_c: number | null;
    precip_mm: number | null;
    wind_kmh: number | null;
  }>;
};

// Parsed CSV line -> stündliche Reihe
function parseCsv(csv: string, abbr: string): SmnHourly["rows"] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(";").map((h) => h.trim().toLowerCase());
  const idxTime = header.indexOf("reference_timestamp");
  const idxTemp = header.indexOf("tre200h0");   // °C, Lufttemperatur 2 m, Stundenmittel
  const idxPrec = header.indexOf("rre150h0");   // mm, Niederschlag 1 h
  const idxWind = header.indexOf("fkl010h0");   // m/s, Wind Stundenmittel
  if (idxTime < 0) return [];

  const out: SmnHourly["rows"] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const ts = cols[idxTime]?.trim();
    if (!ts) continue;
    // SMN-Format: "DD.MM.YYYY HH:mm" in UTC
    const m = ts.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00Z`;
    const num = (v: string | undefined) => {
      if (v == null) return null;
      const t = v.trim();
      if (!t || t === "-" || t === "NA") return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };
    const tempC = idxTemp >= 0 ? num(cols[idxTemp]) : null;
    const precMm = idxPrec >= 0 ? num(cols[idxPrec]) : null;
    const windMs = idxWind >= 0 ? num(cols[idxWind]) : null;
    out.push({
      time: iso,
      temp_c: tempC,
      precip_mm: precMm,
      wind_kmh: windMs == null ? null : Math.round(windMs * 3.6 * 10) / 10,
    });
  }
  return out;
}

async function fetchOneStation(abbr: string): Promise<SmnHourly | null> {
  const lower = abbr.toLowerCase();
  const url = `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${lower}/ogd-smn_${lower}_h_recent.csv`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn(`SMN fetch failed ${abbr}:`, e);
    return null;
  }
  if (!res.ok) {
    console.warn(`SMN ${abbr}: HTTP ${res.status}`);
    return null;
  }
  const csv = await res.text();
  const rows = parseCsv(csv, abbr);
  if (!rows.length) {
    console.warn(`SMN ${abbr}: keine Zeilen geparst`);
    return null;
  }
  const meta = KNOWN_SMN[abbr.toUpperCase()] ?? { name: abbr, lat: 0, lon: 0, elev: 0 };
  return { station: abbr.toUpperCase(), ...meta, rows };
}

// Liefert die letzten N Stunden je Station; Cache 1 h.
export async function fetchSmnRecent(
  stationAbbrs: string[],
  hours = 24 * 8,
): Promise<SmnHourly[]> {
  if (!stationAbbrs.length) return [];
  const ids = stationAbbrs.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const cacheKey = `smn:recent:${ids.slice().sort().join(",")}`;
  const all = await getOrSetCache(cacheKey, async () => {
    const out: SmnHourly[] = [];
    for (const id of ids) {
      const d = await fetchOneStation(id);
      if (d) out.push(d);
    }
    return out;
  }, 60 * 60 * 1000);

  // Auf gewünschtes Zeitfenster trimmen
  const cutoff = Date.now() - hours * 3600 * 1000;
  return (all ?? []).map((s) => ({
    ...s,
    rows: s.rows.filter((r) => new Date(r.time).getTime() >= cutoff),
  }));
}

export function getKnownSmnStation(abbr: string) {
  return KNOWN_SMN[abbr.toUpperCase()] ?? null;
}
