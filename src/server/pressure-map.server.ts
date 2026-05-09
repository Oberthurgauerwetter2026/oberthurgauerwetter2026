// Generates a daily Europe surface-pressure map (isobars + H/L) from
// DWD ICON-EU data (via Open-Meteo) and uploads it as SVG to Lovable Cloud.
//
// Output is a stable public URL: <bucket>/europe-pressure-latest.svg
// SVG is the simplest deployable format on Cloudflare Workers — no WASM needed.

import { contours as d3contours } from "d3-contour";
import europeCountries from "@/data/europe-countries.json";
import europeOcean from "@/data/europe-ocean.json";
import europeLakes from "@/data/europe-lakes.json";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Map extent
const W = -25, E = 45, S = 30, N = 70;
const STEP = 1.5; // degrees per grid cell
const COLS = Math.round((E - W) / STEP) + 1; // 47
const ROWS = Math.round((N - S) / STEP) + 1; // 28

// Image dimensions
const IMG_W = 1200;
const IMG_H = 800;
const PAD = { top: 60, right: 20, bottom: 40, left: 20 };
const PLOT_W = IMG_W - PAD.left - PAD.right;
const PLOT_H = IMG_H - PAD.top - PAD.bottom;

// Equirectangular projection (good enough for a static synoptic chart at this scale).
function project(lon: number, lat: number): [number, number] {
  const x = PAD.left + ((lon - W) / (E - W)) * PLOT_W;
  // SVG y grows downwards; lat=N is top
  const y = PAD.top + ((N - lat) / (N - S)) * PLOT_H;
  return [x, y];
}

// Inverse for grid-to-pixel rendering of contour shapes (which are in grid units 0..COLS,0..ROWS)
function gridToPixel(gx: number, gy: number): [number, number] {
  const lon = W + gx * STEP;
  const lat = N - gy * STEP; // contour rows: 0 at top => N
  return project(lon, lat);
}

type Grid = { values: number[]; cols: number; rows: number };

async function fetchPressureGrid(targetUtcIso: string): Promise<Grid> {
  // Build coordinates list. Open-Meteo accepts comma-separated lat/lon and
  // returns one location object per pair.
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(N - r * STEP);
      lons.push(W + c * STEP);
    }
  }

  // Limit per request: Open-Meteo allows up to ~100 locations. Batch.
  const BATCH = 100;
  const values: number[] = new Array(lats.length).fill(NaN);
  for (let i = 0; i < lats.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250)); // throttle to avoid 429
    const la = lats.slice(i, i + BATCH).join(",");
    const lo = lons.slice(i, i + BATCH).join(",");
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", la);
    url.searchParams.set("longitude", lo);
    url.searchParams.set("hourly", "pressure_msl");
    // icon_seamless falls back to ICON global for points outside ICON-EU coverage
    // (e.g. far Atlantic / Arctic corners of our extent), so the request never 400s.
    url.searchParams.set("models", "icon_seamless");
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "UTC");
    let json: any;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Open-Meteo batch ${i} failed: ${res.status} ${await res.text()}`);
        continue; // leave NaN for this batch; smoothing fills gaps
      }
      json = await res.json();
    } catch (err) {
      console.warn(`Open-Meteo batch ${i} threw:`, err);
      continue;
    }
    const list = Array.isArray(json) ? json : [json];
    for (let k = 0; k < list.length; k++) {
      const loc = list[k];
      const times: string[] = loc?.hourly?.time ?? [];
      const arr: number[] = loc?.hourly?.pressure_msl ?? [];
      const idx = times.indexOf(targetUtcIso);
      values[i + k] = idx >= 0 && Number.isFinite(arr[idx]) ? arr[idx] : NaN;
    }
  }
  return { values, cols: COLS, rows: ROWS };
}

// Simple 3x3 box blur (1 pass) to soften noisy isobars
function smooth(g: Grid): Grid {
  const out = new Array(g.values.length).fill(0);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      let s = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols) continue;
          const v = g.values[rr * g.cols + cc];
          if (Number.isFinite(v)) { s += v; n++; }
        }
      }
      out[r * g.cols + c] = n ? s / n : NaN;
    }
  }
  return { values: out, cols: g.cols, rows: g.rows };
}

// Detect local highs/lows on the grid (3x3 strict extremum + minimum spacing)
function findExtrema(g: Grid): { type: "H" | "T"; lon: number; lat: number; value: number }[] {
  const all: { type: "H" | "T"; lon: number; lat: number; value: number; gx: number; gy: number }[] = [];
  for (let r = 1; r < g.rows - 1; r++) {
    for (let c = 1; c < g.cols - 1; c++) {
      const v = g.values[r * g.cols + c];
      if (!Number.isFinite(v)) continue;
      let isMax = true, isMin = true;
      for (let dr = -1; dr <= 1 && (isMax || isMin); dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nv = g.values[(r + dr) * g.cols + (c + dc)];
          if (!Number.isFinite(nv)) continue;
          if (nv >= v) isMax = false;
          if (nv <= v) isMin = false;
        }
      }
      if (isMax || isMin) {
        all.push({
          type: isMax ? "H" : "T",
          lon: W + c * STEP,
          lat: N - r * STEP,
          value: v,
          gx: c, gy: r,
        });
      }
    }
  }
  // Enforce minimum spacing (~5 grid cells)
  const kept: typeof all = [];
  for (const e of all.sort((a, b) => (a.type === "H" ? -a.value : a.value) - (b.type === "H" ? -b.value : b.value))) {
    if (kept.some((k) => Math.hypot(k.gx - e.gx, k.gy - e.gy) < 5)) continue;
    kept.push(e);
  }
  return kept.map(({ type, lon, lat, value }) => ({ type, lon, lat, value }));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Convert a GeoJSON feature collection to an SVG path using our projection
function geojsonToPath(geo: any): string {
  const parts: string[] = [];
  const drawRing = (ring: number[][]) => {
    if (!ring.length) return;
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const [x, y] = project(lon, lat);
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
    d += "Z";
    parts.push(d);
  };
  for (const f of geo.features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) drawRing(ring);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) for (const ring of poly) drawRing(ring);
    }
  }
  return parts.join(" ");
}

// Convert d3-contour multipolygon (in grid coords) to a smoothed SVG path
// using Catmull-Rom -> cubic Bezier conversion for clean, organic isobars.
function contourToPath(coords: number[][][][], smooth = true): string {
  let d = "";
  for (const poly of coords) {
    for (const ring of poly) {
      const pts = ring.map(([gx, gy]) => gridToPixel(gx, gy));
      if (pts.length < 2) continue;
      if (!smooth || pts.length < 4) {
        for (let i = 0; i < pts.length; i++) {
          d += (i === 0 ? "M" : "L") + pts[i][0].toFixed(1) + "," + pts[i][1].toFixed(1);
        }
        continue;
      }
      // Catmull-Rom -> Bezier (closed ring assumed when first==last)
      const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      const n = closed ? pts.length - 1 : pts.length;
      const get = (i: number): [number, number] => {
        if (closed) return pts[((i % n) + n) % n];
        return pts[Math.max(0, Math.min(pts.length - 1, i))];
      };
      d += "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
      const limit = closed ? n : pts.length - 1;
      for (let i = 0; i < limit; i++) {
        const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += "C" + c1x.toFixed(1) + "," + c1y.toFixed(1)
          + " " + c2x.toFixed(1) + "," + c2y.toFixed(1)
          + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
      }
      if (closed) d += "Z";
    }
  }
  return d;
}

// Map a pressure value to a fill color (blue=low, white=normal, red=high)
function pressureColor(p: number): string {
  // Stops: 970, 990, 1005, 1013, 1020, 1030, 1045
  const stops: [number, [number, number, number]][] = [
    [970, [40, 53, 147]],     // deep indigo
    [985, [33, 150, 243]],    // blue
    [1000, [144, 202, 249]],  // light blue
    [1013, [245, 245, 240]],  // off-white
    [1020, [255, 224, 178]],  // pale orange
    [1030, [255, 138, 101]],  // orange
    [1045, [183, 28, 28]],    // deep red
  ];
  if (p <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  if (p >= stops[stops.length - 1][0]) return `rgb(${stops[stops.length - 1][1].join(",")})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (p >= a && p <= b) {
      const t = (p - a) / (b - a);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "#fff";
}

function buildSvg(grid: Grid, targetUtcIso: string): string {
  // ── Filled color contours every 2 hPa (soft pressure heat-map) ──
  const fillThresholds: number[] = [];
  for (let p = 960; p <= 1050; p += 2) fillThresholds.push(p);
  const fillCont = d3contours().size([grid.cols, grid.rows]).thresholds(fillThresholds);
  const fillPolys = fillCont(grid.values);

  // ── Line contours every 5 hPa (synoptic standard) ──
  const lineThresholds: number[] = [];
  for (let p = 960; p <= 1050; p += 5) lineThresholds.push(p);
  const lineCont = d3contours().size([grid.cols, grid.rows]).thresholds(lineThresholds);
  const linePolys = lineCont(grid.values);

  const date = new Date(targetUtcIso);
  const title = `Bodendruck Europa — ${date.toLocaleString("de-CH", {
    timeZone: "UTC",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })} UTC`;
  const subtitle = "Modell DWD ICON-EU · Isobaren je 5 hPa · Farbskala 970–1045 hPa";

  // Basemap paths
  const oceanPath = geojsonToPath(europeOcean as any);
  const landPath = geojsonToPath(europeCountries as any);
  const lakesPath = geojsonToPath(europeLakes as any);

  // Lat/lon graticule
  const gridLines: string[] = [];
  for (let lon = -20; lon <= 40; lon += 10) {
    const [x1, y1] = project(lon, S);
    const [x2, y2] = project(lon, N);
    gridLines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.5" />`);
  }
  for (let lat = 35; lat <= 65; lat += 5) {
    const [x1, y1] = project(W, lat);
    const [x2, y2] = project(E, lat);
    gridLines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.5" />`);
  }

  // Filled contour bands
  const fillSvg: string[] = [];
  for (const poly of fillPolys) {
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    const color = pressureColor(poly.value);
    fillSvg.push(`<path d="${d}" fill="${color}" fill-rule="evenodd" stroke="none" />`);
  }

  // Line contours + labels
  const contourSvg: string[] = [];
  const labelSvg: string[] = [];
  for (const poly of linePolys) {
    const value = poly.value;
    const isThousand = value === 1000;
    const isBold = value % 20 === 0;
    const stroke = "#000000";
    const sw = isBold ? 1.6 : 0.9;
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    contourSvg.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" />`);

    let bestRing: number[][] | null = null;
    let bestLen = 0;
    for (const p of poly.coordinates) {
      for (const r of p) {
        if (r.length > bestLen) { bestLen = r.length; bestRing = r; }
      }
    }
    if (bestRing && bestRing.length > 10) {
      const mid = bestRing[Math.floor(bestRing.length / 2)];
      const [lx, ly] = gridToPixel(mid[0], mid[1]);
      const txt = String(Math.round(value));
      labelSvg.push(`<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="11" font-weight="${isThousand ? "700" : "600"}" fill="${stroke}" text-anchor="middle" stroke="white" stroke-width="3" stroke-opacity="0.85" paint-order="stroke fill">${txt}</text>`);
    }
  }

  // Highs / Lows
  const extrema = findExtrema(grid);
  const extremaSvg: string[] = [];
  for (const e of extrema) {
    const [x, y] = project(e.lon, e.lat);
    const isH = e.type === "H";
    const color = isH ? "#7f0000" : "#0d47a1";
    extremaSvg.push(
      `<g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18" fill="white" fill-opacity="0.85" stroke="${color}" stroke-width="1.5" />
        <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Georgia,serif" font-size="26" font-weight="700" fill="${color}" text-anchor="middle" dominant-baseline="central">${e.type}</text>
        <text x="${x.toFixed(1)}" y="${(y + 28).toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="11" font-weight="600" fill="${color}" text-anchor="middle" stroke="white" stroke-width="3" stroke-opacity="0.9" paint-order="stroke fill">${Math.round(e.value)}</text>
      </g>`
    );
  }

  // Legend (color bar)
  const legendItems: string[] = [];
  const lgX = PAD.left + 12, lgY = IMG_H - 30, lgW = 320, lgH = 10;
  const segs = 32;
  for (let i = 0; i < segs; i++) {
    const p = 970 + (1045 - 970) * (i / (segs - 1));
    legendItems.push(`<rect x="${(lgX + (lgW / segs) * i).toFixed(1)}" y="${lgY}" width="${(lgW / segs + 0.5).toFixed(1)}" height="${lgH}" fill="${pressureColor(p)}" />`);
  }
  const legendLabels = [970, 990, 1013, 1030, 1045].map((p) => {
    const x = lgX + ((p - 970) / (1045 - 970)) * lgW;
    return `<text x="${x.toFixed(1)}" y="${lgY + lgH + 11}" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#1f2937" text-anchor="middle">${p}</text>`;
  }).join("");

  const [fx1, fy1] = [PAD.left, PAD.top];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IMG_W} ${IMG_H}" width="${IMG_W}" height="${IMG_H}">
  <defs>
    <clipPath id="plot"><rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" /></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a2332" />
      <stop offset="1" stop-color="#0f1620" />
    </linearGradient>
  </defs>
  <rect width="${IMG_W}" height="${IMG_H}" fill="url(#bg)" />
  <text x="${IMG_W / 2}" y="30" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
  <text x="${IMG_W / 2}" y="50" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#cbd5e1" text-anchor="middle">${escapeXml(subtitle)}</text>

  <g clip-path="url(#plot)">
    <!-- Ozean -->
    <rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" fill="#a8c8e0" />
    <path d="${oceanPath}" fill="#7fb0d4" stroke="none" />
    <!-- Land -->
    <path d="${landPath}" fill="#e8e0c8" stroke="none" />
    <!-- Druck-Farbflächen über alles, halbtransparent -->
    <g opacity="0.55">
      ${fillSvg.join("\n      ")}
    </g>
    <!-- Seen -->
    <path d="${lakesPath}" fill="#a8c8e0" stroke="#6b8caa" stroke-width="0.4" />
    <!-- Ländergrenzen oben drauf -->
    <path d="${landPath}" fill="none" stroke="#3a4a5a" stroke-width="0.7" stroke-linejoin="round" />
    <!-- Graticule -->
    ${gridLines.join("\n    ")}
    <!-- Isobaren -->
    ${contourSvg.join("\n    ")}
    ${labelSvg.join("\n    ")}
    ${extremaSvg.join("\n    ")}
  </g>

  <rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" fill="none" stroke="#ffffff" stroke-width="1.5" />

  <!-- Legend -->
  ${legendItems.join("\n  ")}
  ${legendLabels}
  <text x="${lgX}" y="${lgY - 4}" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="600" fill="#ffffff">Luftdruck (hPa)</text>

  <text x="${IMG_W - 10}" y="${IMG_H - 10}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#94a3b8" text-anchor="end">Quelle: DWD ICON-EU via Open-Meteo · oberthurgauerwetter.ch</text>
</svg>`;
}

// Picks today's 12:00 UTC; if it's already past today's 12 UTC + 90 min, use today, else use yesterday's 12 UTC
function pickTargetTime(now = new Date()): string {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  if (now.getTime() < today.getTime() - 30 * 60 * 1000) {
    today.setUTCDate(today.getUTCDate() - 1);
  }
  return today.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

export async function generatePressureMap(): Promise<{ url: string; targetUtc: string; bytes: number }> {
  const targetUtc = pickTargetTime();
  const targetUtcIso = `${targetUtc}`; // matches Open-Meteo "YYYY-MM-DDTHH:MM"
  let grid = await fetchPressureGrid(targetUtcIso);
  const validCount = grid.values.filter((v) => Number.isFinite(v)).length;
  console.log(`Pressure grid: ${validCount}/${grid.values.length} valid points`);
  if (validCount < 100) {
    throw new Error(`Zu wenige gültige Druckwerte (${validCount}/${grid.values.length})`);
  }
  // Iteratively fill NaN cells from neighbours so contours stay continuous.
  for (let pass = 0; pass < 8; pass++) {
    let filled = 0;
    const next = grid.values.slice();
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const i = r * grid.cols + c;
        if (Number.isFinite(grid.values[i])) continue;
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= grid.rows || cc < 0 || cc >= grid.cols) continue;
          const v = grid.values[rr * grid.cols + cc];
          if (Number.isFinite(v)) { s += v; n++; }
        }
        if (n > 0) { next[i] = s / n; filled++; }
      }
    }
    grid = { values: next, cols: grid.cols, rows: grid.rows };
    if (filled === 0) break;
  }
  grid = { ...grid, values: grid.values.map((v) => Number.isFinite(v) ? v : 1013) };
  grid = smooth(grid);
  const svg = buildSvg(grid, targetUtcIso);
  const bytes = new TextEncoder().encode(svg);

  const latestPath = "europe-pressure-latest.svg";
  const archivePath = `archive/europe-pressure-${targetUtc.slice(0, 10)}.svg`;

  for (const path of [latestPath, archivePath]) {
    const { error } = await supabaseAdmin.storage.from("weather-maps").upload(path, bytes, {
      contentType: "image/svg+xml",
      cacheControl: "3600",
      upsert: true,
    });
    if (error) throw new Error(`Upload ${path} fehlgeschlagen: ${error.message}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/weather-maps/${latestPath}`;
  return { url, targetUtc: targetUtcIso, bytes: bytes.length };
}
