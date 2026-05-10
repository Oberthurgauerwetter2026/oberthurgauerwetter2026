// Generates a daily Europe surface-pressure map (isobars + H/L) from
// DWD ICON-EU data (via Open-Meteo) and uploads it as SVG to Lovable Cloud.
//
// Output is a stable public URL: <bucket>/europe-pressure-latest.svg
// SVG is the simplest deployable format on Cloudflare Workers — no WASM needed.

import { contours as d3contours } from "d3-contour";
import europeCountries from "@/data/europe-countries.json";
import europeOcean from "@/data/europe-ocean.json";
import europeLakes from "@/data/europe-lakes.json";
import { supabaseAdmin } from "./stub-supabase";
import { fetchOpenMeteo } from "./stub-quota";

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
type Grids = { pressure: Grid; t850: Grid; precip: Grid };

// Custom error to signal Open-Meteo daily limit exhaustion (HTTP 429).
export class OpenMeteoRateLimitError extends Error {
  constructor(message = "Open-Meteo Tageslimit erreicht") {
    super(message);
    this.name = "OpenMeteoRateLimitError";
  }
}

const RATELIMIT_CACHE_KEY = "om:ratelimit:pressure-map";

function nextUtcMidnightIso(now = new Date()): string {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  return d.toISOString();
}

async function isRateLimited(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("weather_cache")
      .select("expires_at")
      .eq("cache_key", RATELIMIT_CACHE_KEY)
      .maybeSingle();
    if (!data?.expires_at) return false;
    return new Date(data.expires_at).getTime() > Date.now();
  } catch {
    return false;
  }
}

async function setRateLimited(): Promise<void> {
  try {
    await supabaseAdmin
      .from("weather_cache")
      .upsert({
        cache_key: RATELIMIT_CACHE_KEY,
        payload: { reason: "Open-Meteo daily limit exceeded" },
        expires_at: nextUtcMidnightIso(),
        fetched_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
  } catch (e) {
    console.warn("Could not set ratelimit marker:", e);
  }
}

async function fetchGrids(targetUtcIso: string): Promise<Grids> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(N - r * STEP);
      lons.push(W + c * STEP);
    }
  }

  const BATCH = 100;
  const pressure: number[] = new Array(lats.length).fill(NaN);
  const t850: number[] = new Array(lats.length).fill(NaN);
  const precip: number[] = new Array(lats.length).fill(NaN);

  let consecutive429 = 0;
  let total429 = 0;
  let attempted = 0;

  for (let i = 0; i < lats.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    attempted++;
    const la = lats.slice(i, i + BATCH).join(",");
    const lo = lons.slice(i, i + BATCH).join(",");
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", la);
    url.searchParams.set("longitude", lo);
    url.searchParams.set("hourly", "pressure_msl,temperature_850hPa,precipitation");
    url.searchParams.set("models", "icon_seamless");
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "UTC");
    let json: any;
    try {
      const res = await fetchOpenMeteo(url, "pressure_map");
      if (!res.ok) {
        if (res.status === 429) {
          consecutive429++;
          total429++;
          // Early abort: 3 consecutive 429s → daily limit is exhausted.
          if (consecutive429 >= 3) {
            console.warn(`Open-Meteo: aborting after ${consecutive429} consecutive 429s (batch ${i})`);
            await setRateLimited();
            throw new OpenMeteoRateLimitError();
          }
        } else {
          consecutive429 = 0;
        }
        console.warn(`Open-Meteo batch ${i} failed: ${res.status} ${await res.text()}`);
        continue;
      }
      consecutive429 = 0;
      json = await res.json();
    } catch (err) {
      if (err instanceof OpenMeteoRateLimitError) throw err;
      console.warn(`Open-Meteo batch ${i} threw:`, err);
      continue;
    }
    const list = Array.isArray(json) ? json : [json];
    for (let k = 0; k < list.length; k++) {
      const loc = list[k];
      const times: string[] = loc?.hourly?.time ?? [];
      const pArr: number[] = loc?.hourly?.pressure_msl ?? [];
      const tArr: number[] = loc?.hourly?.temperature_850hPa ?? [];
      const rArr: number[] = loc?.hourly?.precipitation ?? [];
      const idx = times.indexOf(targetUtcIso);
      if (idx >= 0) {
        if (Number.isFinite(pArr[idx])) pressure[i + k] = pArr[idx];
        if (Number.isFinite(tArr[idx])) t850[i + k] = tArr[idx];
        // 6h precipitation sum centered on target (target-2 .. target+3)
        let sum = 0, count = 0;
        for (let off = -2; off <= 3; off++) {
          const j = idx + off;
          if (j >= 0 && j < rArr.length && Number.isFinite(rArr[j])) {
            sum += rArr[j];
            count++;
          }
        }
        if (count > 0) precip[i + k] = sum;
      }
    }
  }

  // If majority of batches were 429 (but not 3 in a row), still treat as ratelimit.
  if (total429 > 0 && total429 >= attempted / 2) {
    await setRateLimited();
    throw new OpenMeteoRateLimitError();
  }

  return {
    pressure: { values: pressure, cols: COLS, rows: ROWS },
    t850: { values: t850, cols: COLS, rows: ROWS },
    precip: { values: precip, cols: COLS, rows: ROWS },
  };
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

// Chaikin corner-cutting: each iteration replaces every edge with two new
// points at 25% and 75%, halving every corner angle. Two iterations give
// noticeably rounder rings without losing shape.
function chaikin(pts: [number, number][], iterations = 2, closed = true): [number, number][] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out: [number, number][] = [];
    const n = cur.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i];
      const b = cur[closed ? (i + 1) % n : i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.unshift(cur[0]), out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}

function contourToPath(coords: number[][][][], smooth = true): string {
  let d = "";
  for (const poly of coords) {
    for (const ring of poly) {
      let pts: [number, number][] = ring.map(([gx, gy]) => gridToPixel(gx, gy));
      if (pts.length < 2) continue;
      if (!smooth || pts.length < 4) {
        for (let i = 0; i < pts.length; i++) {
          d += (i === 0 ? "M" : "L") + pts[i][0].toFixed(1) + "," + pts[i][1].toFixed(1);
        }
        continue;
      }
      const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      // Round corners first via Chaikin, then connect with Catmull-Rom Bezier
      const ringPts = closed ? pts.slice(0, -1) : pts;
      const smoothed = chaikin(ringPts, 2, closed);
      pts = closed ? [...smoothed, smoothed[0]] : smoothed;
      // Catmull-Rom -> Bezier

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

// Interpolate within a stops table [value, [r,g,b]]
function interpColor(v: number, stops: [number, [number, number, number]][]): string {
  if (v <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  if (v >= stops[stops.length - 1][0]) return `rgb(${stops[stops.length - 1][1].join(",")})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "#fff";
}

// T850 °C → color (cold blue → white at 0 → warm red)
const T850_STOPS: [number, [number, number, number]][] = [
  [-30, [49, 54, 149]],
  [-20, [69, 117, 180]],
  [-10, [116, 173, 209]],
  [-5, [171, 217, 233]],
  [0, [255, 255, 255]],
  [5, [254, 224, 144]],
  [10, [253, 174, 97]],
  [15, [244, 109, 67]],
  [20, [215, 48, 39]],
  [25, [165, 0, 38]],
];
function t850Color(v: number): string { return interpColor(v, T850_STOPS); }

// Precipitation 6h sum (mm) → color + opacity
function precipStyle(mm: number): { fill: string; opacity: number } | null {
  if (!Number.isFinite(mm) || mm < 0.5) return null;
  if (mm < 1) return { fill: "#bfdbfe", opacity: 0.45 };
  if (mm < 2) return { fill: "#93c5fd", opacity: 0.55 };
  if (mm < 5) return { fill: "#60a5fa", opacity: 0.65 };
  if (mm < 10) return { fill: "#3b82f6", opacity: 0.7 };
  if (mm < 20) return { fill: "#1d4ed8", opacity: 0.78 };
  return { fill: "#4c1d95", opacity: 0.85 };
}

// ── Front detection from T850 gradient ──
type GradField = { dx: number[]; dy: number[]; mag: number[]; cols: number; rows: number };

function computeGradient(g: Grid): GradField {
  const dx = new Array(g.values.length).fill(0);
  const dy = new Array(g.values.length).fill(0);
  const mag = new Array(g.values.length).fill(0);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      const cE = Math.min(c + 1, g.cols - 1);
      const cW = Math.max(c - 1, 0);
      const rN = Math.max(r - 1, 0);
      const rS = Math.min(r + 1, g.rows - 1);
      // Gradient pointing toward warmer air (east/north positive)
      const gx = (g.values[r * g.cols + cE] - g.values[r * g.cols + cW]) / 2;
      const gy = (g.values[rN * g.cols + c] - g.values[rS * g.cols + c]) / 2;
      dx[i] = gx;
      dy[i] = gy;
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return { dx, dy, mag, cols: g.cols, rows: g.rows };
}

// Sample gradient at a fractional grid coordinate (gx in [0..cols], gy in [0..rows])
function sampleGrad(field: GradField, gx: number, gy: number): { dx: number; dy: number } {
  const c = Math.max(0, Math.min(field.cols - 1, Math.round(gx)));
  const r = Math.max(0, Math.min(field.rows - 1, Math.round(gy)));
  const i = r * field.cols + c;
  return { dx: field.dx[i], dy: field.dy[i] };
}

// Build smoothed pixel polyline from a contour ring (grid coords)
function ringToSmoothedPixels(ring: number[][]): [number, number][] {
  let pts: [number, number][] = ring.map(([gx, gy]) => gridToPixel(gx, gy));
  if (pts.length < 4) return pts;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const ringPts = closed ? pts.slice(0, -1) : pts;
  const smoothed = chaikin(ringPts, 2, closed);
  return closed ? [...smoothed, smoothed[0]] : smoothed;
}

function pixelsToPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const n = closed ? pts.length - 1 : pts.length;
  const get = (i: number): [number, number] => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[Math.max(0, Math.min(pts.length - 1, i))];
  };
  let d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
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
  return d;
}

// Place markers (triangles or semicircles) along a polyline at fixed pixel spacing.
// `side` = +1 places markers to the LEFT of travel direction, -1 to the RIGHT.
function markersAlongPath(
  pts: [number, number][],
  spacing: number,
  size: number,
  type: "cold" | "warm",
  color: string,
  side: number
): string {
  if (pts.length < 2) return "";
  // Compute cumulative length
  const seg: { len: number; ax: number; ay: number; bx: number; by: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    seg.push({ len, ax, ay, bx, by });
    total += len;
  }
  if (total < spacing) return "";
  const out: string[] = [];
  let nextAt = spacing / 2;
  let acc = 0;
  for (const s of seg) {
    while (acc + s.len >= nextAt) {
      const t = (nextAt - acc) / s.len;
      const x = s.ax + (s.bx - s.ax) * t;
      const y = s.ay + (s.by - s.ay) * t;
      // Tangent
      const tx = (s.bx - s.ax) / s.len;
      const ty = (s.by - s.ay) / s.len;
      // Normal pointing to chosen side (left = (-ty, tx); right = (ty, -tx))
      const nx = side > 0 ? -ty : ty;
      const ny = side > 0 ? tx : -tx;
      if (type === "cold") {
        // Triangle: base on the line, apex on the side
        const bx1 = x - tx * size * 0.5;
        const by1 = y - ty * size * 0.5;
        const bx2 = x + tx * size * 0.5;
        const by2 = y + ty * size * 0.5;
        const apx = x + nx * size * 0.9;
        const apy = y + ny * size * 0.9;
        out.push(`<polygon points="${bx1.toFixed(1)},${by1.toFixed(1)} ${bx2.toFixed(1)},${by2.toFixed(1)} ${apx.toFixed(1)},${apy.toFixed(1)}" fill="${color}" stroke="${color}" stroke-width="0.5" stroke-linejoin="round" />`);
      } else {
        // Semicircle bump on the side
        const r = size * 0.55;
        // Endpoints of the diameter on the line
        const sxA = x - tx * r;
        const syA = y - ty * r;
        const sxB = x + tx * r;
        const syB = y + ty * r;
        const sweep = side > 0 ? 0 : 1;
        out.push(`<path d="M${sxA.toFixed(1)},${syA.toFixed(1)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 ${sweep} ${sxB.toFixed(1)},${syB.toFixed(1)}" fill="${color}" stroke="${color}" stroke-width="0.5" stroke-linejoin="round" />`);
      }
      nextAt += spacing;
    }
    acc += s.len;
  }
  return out.join("");
}

// Build front overlays (returns SVG snippets array)
function buildFronts(t850: Grid): string[] {
  const grad = computeGradient(t850);
  // Threshold on |∇T| in °C per grid cell. ~1.5°C per 1.5° (~165km) is a moderate baroclinic zone.
  const THRESH = 1.6;
  const cont = d3contours().size([t850.cols, t850.rows]).thresholds([THRESH]);
  const polys = cont(grad.mag);
  const out: string[] = [];
  for (const poly of polys) {
    for (const ringGroup of poly.coordinates) {
      for (const ring of ringGroup) {
        if (ring.length < 8) continue;
        // Compute average gradient direction at sampled points on the ring.
        let sgx = 0, sgy = 0;
        const sampleN = Math.min(ring.length, 24);
        for (let i = 0; i < sampleN; i++) {
          const [gx, gy] = ring[Math.floor((i / sampleN) * ring.length)];
          const g = sampleGrad(grad, gx, gy);
          sgx += g.dx;
          sgy += g.dy;
        }
        // Gradient points from cold → warm (in grid coords: +dx east, +dy in temperature-grid sense).
        // In computeGradient we used +y = north. Heuristic:
        // - If average warm direction is roughly to the south (sgy < 0): cold air mass to the north pushing south → COLD FRONT.
        // - Else: warm air pushing north → WARM FRONT.
        const isCold = sgy < 0;
        const color = isCold ? "#1d4ed8" : "#dc2626";
        const pixels = ringToSmoothedPixels(ring);
        const path = pixelsToPath(pixels);
        if (!path) continue;
        // Line itself
        out.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`);
        // Markers — place on the side of the warm air (i.e., direction of gradient).
        // Ring orientation in d3-contour: outer rings are CCW, so "left of travel" = inside.
        // We approximate: pick side that, on average, points along the gradient.
        // Compute first segment normal (left side) and dot with gradient at start:
        let side = 1;
        if (pixels.length > 2) {
          const [ax, ay] = pixels[0];
          const [bx, by] = pixels[1];
          const tx = bx - ax, ty = by - ay;
          const len = Math.hypot(tx, ty) || 1;
          const ntx = tx / len, nty = ty / len;
          const leftNx = -nty, leftNy = ntx; // pixel-space (y down)
          // gradient in pixel space: +dx east (right), but +dy north (UP), so pixel-y = -dy
          const gxAvg = sgx / sampleN;
          const gyAvgPx = -(sgy / sampleN);
          const dot = leftNx * gxAvg + leftNy * gyAvgPx;
          side = dot >= 0 ? 1 : -1;
        }
        out.push(markersAlongPath(pixels, 32, 9, isCold ? "cold" : "warm", color, side));
      }
    }
  }
  return out;
}

function buildSvg(grids: Grids, targetUtcIso: string): string {
  const { pressure: grid, t850, precip } = grids;

  // ── T850 filled bands every 2.5 °C (warm/cold air masses) ──
  const t850Thresholds: number[] = [];
  for (let t = -32; t <= 28; t += 2.5) t850Thresholds.push(t);
  const t850Cont = d3contours().size([t850.cols, t850.rows]).thresholds(t850Thresholds);
  const t850Polys = t850Cont(t850.values);

  // ── Precipitation bands ──
  const precipThresholds = [0.5, 1, 2, 5, 10, 20];
  const precipCont = d3contours().size([precip.cols, precip.rows]).thresholds(precipThresholds);
  const precipPolys = precipCont(precip.values);

  // ── Line contours every 5 hPa (synoptic standard) ──
  const lineThresholds: number[] = [];
  for (let p = 960; p <= 1050; p += 5) lineThresholds.push(p);
  const lineCont = d3contours().size([grid.cols, grid.rows]).thresholds(lineThresholds);
  const linePolys = lineCont(grid.values);

  // ── Fronts (from T850 gradient) ──
  const frontSvg = buildFronts(t850);

  const date = new Date(targetUtcIso);
  const title = `Bodendruck Europa — ${date.toLocaleString("de-CH", {
    timeZone: "UTC",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })} UTC`;
  const subtitle = "DWD ICON-EU · T 850 hPa (°C) · Niederschlag 6 h · Isobaren je 5 hPa";

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

  // T850 filled bands
  const t850Svg: string[] = [];
  for (const poly of t850Polys) {
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    t850Svg.push(`<path d="${d}" fill="${t850Color(poly.value)}" fill-rule="evenodd" stroke="none" />`);
  }

  // Precipitation overlay
  const precipSvg: string[] = [];
  for (const poly of precipPolys) {
    const style = precipStyle(poly.value);
    if (!style) continue;
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    precipSvg.push(`<path d="${d}" fill="${style.fill}" fill-opacity="${style.opacity}" fill-rule="evenodd" stroke="none" />`);
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

  // ── Legend: T850 (left) + Precipitation (right) ──
  const lgY = IMG_H - 30, lgH = 10;
  // T850 bar
  const t850LgX = PAD.left + 12, t850LgW = 320;
  const t850Segs = 40;
  const t850Items: string[] = [];
  for (let i = 0; i < t850Segs; i++) {
    const t = -30 + (25 - -30) * (i / (t850Segs - 1));
    t850Items.push(`<rect x="${(t850LgX + (t850LgW / t850Segs) * i).toFixed(1)}" y="${lgY}" width="${(t850LgW / t850Segs + 0.5).toFixed(1)}" height="${lgH}" fill="${t850Color(t)}" />`);
  }
  const t850Labels = [-30, -15, 0, 10, 25].map((t) => {
    const x = t850LgX + ((t - -30) / (25 - -30)) * t850LgW;
    return `<text x="${x.toFixed(1)}" y="${lgY + lgH + 11}" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#ffffff" text-anchor="middle">${t > 0 ? "+" : ""}${t}</text>`;
  }).join("");

  // Precipitation bar (discrete swatches)
  const pLgX = IMG_W - PAD.right - 12 - 280, pLgW = 280;
  const pSwatches = [
    { v: 0.5, label: "0.5" },
    { v: 1, label: "1" },
    { v: 2, label: "2" },
    { v: 5, label: "5" },
    { v: 10, label: "10" },
    { v: 20, label: "20+" },
  ];
  const pStep = pLgW / pSwatches.length;
  const pItems: string[] = [];
  const pLabels: string[] = [];
  for (let i = 0; i < pSwatches.length; i++) {
    const s = precipStyle(pSwatches[i].v + 0.01)!;
    const x = pLgX + i * pStep;
    pItems.push(`<rect x="${x.toFixed(1)}" y="${lgY}" width="${(pStep - 1).toFixed(1)}" height="${lgH}" fill="${s.fill}" fill-opacity="${s.opacity}" />`);
    pLabels.push(`<text x="${(x + pStep / 2).toFixed(1)}" y="${lgY + lgH + 11}" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#ffffff" text-anchor="middle">${pSwatches[i].label}</text>`);
  }

  const [fx1, fy1] = [PAD.left, PAD.top];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IMG_W} ${IMG_H}" width="${IMG_W}" height="${IMG_H}">
  <defs>
    <clipPath id="plot"><rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" /></clipPath>
  </defs>
  <rect width="${IMG_W}" height="${IMG_H}" fill="#2561a1" />
  <text x="${IMG_W / 2}" y="30" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
  <text x="${IMG_W / 2}" y="50" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#cbd5e1" text-anchor="middle">${escapeXml(subtitle)}</text>

  <g clip-path="url(#plot)">
    <!-- Ozean -->
    <rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" fill="#a8c8e0" />
    <path d="${oceanPath}" fill="#7fb0d4" stroke="none" />
    <!-- Land -->
    <path d="${landPath}" fill="#D3EAC2" stroke="none" />
    <!-- T850 Farbflächen (Warm-/Kaltluftmassen) -->
    <g opacity="0.62">
      ${t850Svg.join("\n      ")}
    </g>
    <!-- Niederschlag 6h -->
    <g>
      ${precipSvg.join("\n      ")}
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
    <!-- Fronten -->
    ${frontSvg.join("\n    ")}
    ${extremaSvg.join("\n    ")}
  </g>

  <rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" fill="none" stroke="#2561a1" stroke-width="1.5" />

  <!-- Legend: T850 -->
  ${t850Items.join("\n  ")}
  ${t850Labels}
  <text x="${t850LgX}" y="${lgY - 4}" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="600" fill="#ffffff">Temperatur 850 hPa (°C)</text>

  <!-- Legend: Precipitation -->
  ${pItems.join("\n  ")}
  ${pLabels.join("\n  ")}
  <text x="${pLgX}" y="${lgY - 4}" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="600" fill="#ffffff">Niederschlag 6 h (mm)</text>

  <!-- Legend: Fronts -->
  <g transform="translate(${(t850LgX + 340).toFixed(1)}, ${lgY - 2})">
    <line x1="0" y1="6" x2="40" y2="6" stroke="#1d4ed8" stroke-width="2.2" />
    <polygon points="8,6 16,6 12,-1" fill="#1d4ed8" />
    <polygon points="22,6 30,6 26,-1" fill="#1d4ed8" />
    <text x="46" y="9" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#ffffff">Kaltfront</text>
    <line x1="100" y1="6" x2="140" y2="6" stroke="#dc2626" stroke-width="2.2" />
    <path d="M108,6 A4,4 0 0 1 116,6" fill="#dc2626" stroke="#dc2626" stroke-width="0.5" />
    <path d="M122,6 A4,4 0 0 1 130,6" fill="#dc2626" stroke="#dc2626" stroke-width="0.5" />
    <text x="146" y="9" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#ffffff">Warmfront</text>
  </g>

  <text x="${IMG_W - 10}" y="${IMG_H - 10}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#94a3b8" text-anchor="end">Quelle: DWD ICON-EU via Open-Meteo · oberthurgauerwetter.ch</text>
</svg>`;
}

// Always picks tomorrow's 12:00 UTC (forecast for the next day)
function pickTargetTime(now = new Date()): string {
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0
  ));
  return tomorrow.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

// Iteratively fill NaN cells from neighbours, then fill any remaining with fallback.
function fillAndSmooth(g: Grid, fallback: number, smoothPasses = 3): Grid {
  let cur: Grid = g;
  for (let pass = 0; pass < 8; pass++) {
    let filled = 0;
    const next = cur.values.slice();
    for (let r = 0; r < cur.rows; r++) {
      for (let c = 0; c < cur.cols; c++) {
        const i = r * cur.cols + c;
        if (Number.isFinite(cur.values[i])) continue;
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= cur.rows || cc < 0 || cc >= cur.cols) continue;
          const v = cur.values[rr * cur.cols + cc];
          if (Number.isFinite(v)) { s += v; n++; }
        }
        if (n > 0) { next[i] = s / n; filled++; }
      }
    }
    cur = { values: next, cols: cur.cols, rows: cur.rows };
    if (filled === 0) break;
  }
  cur = { ...cur, values: cur.values.map((v: number) => Number.isFinite(v) ? v : fallback) };
  for (let i = 0; i < smoothPasses; i++) cur = smooth(cur);
  return cur;
}

export async function generatePressureMap(): Promise<{ url: string; targetUtc: string; bytes: number }> {
  const targetUtc = pickTargetTime();
  const targetUtcIso = `${targetUtc}`; // matches Open-Meteo "YYYY-MM-DDTHH:MM"
  if (await isRateLimited()) {
    throw new OpenMeteoRateLimitError();
  }
  const raw = await fetchGrids(targetUtcIso);
  const validCount = raw.pressure.values.filter((v: number) => Number.isFinite(v)).length;
  console.log(`Pressure grid: ${validCount}/${raw.pressure.values.length} valid points`);
  if (validCount < 100) {
    throw new Error(`Zu wenige gültige Druckwerte (${validCount}/${raw.pressure.values.length})`);
  }
  const grids: Grids = {
    pressure: fillAndSmooth(raw.pressure, 1013, 3),
    t850: fillAndSmooth(raw.t850, 0, 2),
    // Precipitation: don't over-smooth; fill missing with 0
    precip: fillAndSmooth(raw.precip, 0, 1),
  };
  const svg = buildSvg(grids, targetUtcIso);
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
export { buildSvg };
