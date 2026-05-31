// Standalone pressure-map generator. Runs on GitHub Actions runners (own IP
// pool, no shared Cloudflare Worker egress) and uploads the rendered SVG to
// the existing Supabase Storage bucket.
//
// Required env:
//   SUPABASE_URL                  e.g. https://kdolnotjbhgjieznmpgf.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     service role key (server-only)
//
// Mirrors the logic from src/server/pressure-map.server.ts but without the
// Worker-side rate-limit bookkeeping — the runner has its own IP so we just
// fetch, render, upload.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contours as d3contours } from "d3-contour";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { attachFuBerlinNames } from "./fu-berlin-names.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Geo data location:
//  - in the Lovable repo: ../src/data (next to the app source)
//  - in a standalone generator repo: ../data
// We try both so the same script works in either layout.
import { existsSync } from "node:fs";
const DATA_DIR = existsSync(resolve(__dirname, "../src/data/europe-countries.json"))
  ? resolve(__dirname, "../src/data")
  : resolve(__dirname, "../data");
const europeCountries = JSON.parse(readFileSync(resolve(DATA_DIR, "europe-countries.json"), "utf8"));
const europeOcean = JSON.parse(readFileSync(resolve(DATA_DIR, "europe-ocean.json"), "utf8"));
const europeLakes = JSON.parse(readFileSync(resolve(DATA_DIR, "europe-lakes.json"), "utf8"));

// ── Map extent ─────────────────────────────────────────────────────────────
const W = -25, E = 45, S = 30, N = 70;
const STEP = 2.0;
const COLS = Math.round((E - W) / STEP) + 1;
const ROWS = Math.round((N - S) / STEP) + 1;

const IMG_W = 1200;
const IMG_H = 840;
const PAD = { top: 60, right: 20, bottom: 80, left: 20 };
const PLOT_W = IMG_W - PAD.left - PAD.right;
const PLOT_H = IMG_H - PAD.top - PAD.bottom;

function project(lon, lat) {
  const x = PAD.left + ((lon - W) / (E - W)) * PLOT_W;
  const y = PAD.top + ((N - lat) / (N - S)) * PLOT_H;
  return [x, y];
}
function gridToPixel(gx, gy) {
  return project(W + gx * STEP, N - gy * STEP);
}

// ── Open-Meteo fetch ───────────────────────────────────────────────────────
async function fetchGrids(targetUtcIso, model = "icon_seamless") {
  const lats = [], lons = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(N - r * STEP);
      lons.push(W + c * STEP);
    }
  }
  const BATCH = 200;
  const THROTTLE_MS = 250;
  const pressure = new Array(lats.length).fill(NaN);
  const t850 = new Array(lats.length).fill(NaN);
  const precip = new Array(lats.length).fill(NaN);

  for (let i = 0; i < lats.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));
    const la = lats.slice(i, i + BATCH).join(",");
    const lo = lons.slice(i, i + BATCH).join(",");
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", la);
    url.searchParams.set("longitude", lo);
    url.searchParams.set("hourly", "pressure_msl,temperature_850hPa,precipitation");
    url.searchParams.set("models", model);
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "UTC");

    let json = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 429) {
            const waitMs = 65_000;
            console.warn(`[OM] batch ${i} 429 (attempt ${attempt + 1}) — wait ${waitMs}ms`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          if (res.status >= 500 && attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt)));
            continue;
          }
          console.warn(`[OM] batch ${i} failed: ${res.status} ${body.slice(0, 200)}`);
          break;
        }
        json = await res.json();
      } catch (err) {
        console.warn(`[OM] batch ${i} attempt ${attempt + 1} threw:`, err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt)));
      }
    }
    if (!json) continue;
    const list = Array.isArray(json) ? json : [json];
    for (let k = 0; k < list.length; k++) {
      const loc = list[k];
      const times = loc?.hourly?.time ?? [];
      const pArr = loc?.hourly?.pressure_msl ?? [];
      const tArr = loc?.hourly?.temperature_850hPa ?? [];
      const rArr = loc?.hourly?.precipitation ?? [];
      const idx = times.indexOf(targetUtcIso);
      if (idx >= 0) {
        if (Number.isFinite(pArr[idx])) pressure[i + k] = pArr[idx];
        if (Number.isFinite(tArr[idx])) t850[i + k] = tArr[idx];
        let sum = 0, count = 0;
        for (let off = -2; off <= 3; off++) {
          const j = idx + off;
          if (j >= 0 && j < rArr.length && Number.isFinite(rArr[j])) { sum += rArr[j]; count++; }
        }
        if (count > 0) precip[i + k] = sum;
      }
    }
  }
  return {
    pressure: { values: pressure, cols: COLS, rows: ROWS },
    t850: { values: t850, cols: COLS, rows: ROWS },
    precip: { values: precip, cols: COLS, rows: ROWS },
  };
}

// ── Grid helpers ───────────────────────────────────────────────────────────
function smooth(g) {
  const out = new Array(g.values.length).fill(0);
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols) continue;
      const v = g.values[rr * g.cols + cc];
      if (Number.isFinite(v)) { s += v; n++; }
    }
    out[r * g.cols + c] = n ? s / n : NaN;
  }
  return { values: out, cols: g.cols, rows: g.rows };
}
function fillAndSmooth(g, fallback, smoothPasses = 3) {
  let cur = g;
  for (let pass = 0; pass < 8; pass++) {
    let filled = 0;
    const next = cur.values.slice();
    for (let r = 0; r < cur.rows; r++) for (let c = 0; c < cur.cols; c++) {
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
    cur = { values: next, cols: cur.cols, rows: cur.rows };
    if (filled === 0) break;
  }
  cur = { ...cur, values: cur.values.map((v) => Number.isFinite(v) ? v : fallback) };
  for (let i = 0; i < smoothPasses; i++) cur = smooth(cur);
  return cur;
}
function findExtrema(g) {
  const all = [];
  for (let r = 1; r < g.rows - 1; r++) for (let c = 1; c < g.cols - 1; c++) {
    const v = g.values[r * g.cols + c];
    if (!Number.isFinite(v)) continue;
    let isMax = true, isMin = true;
    for (let dr = -1; dr <= 1 && (isMax || isMin); dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nv = g.values[(r + dr) * g.cols + (c + dc)];
      if (!Number.isFinite(nv)) continue;
      if (nv >= v) isMax = false;
      if (nv <= v) isMin = false;
    }
    if (isMax || isMin) all.push({ type: isMax ? "H" : "T", lon: W + c * STEP, lat: N - r * STEP, value: v, gx: c, gy: r });
  }
  const kept = [];
  for (const e of all.sort((a, b) => (a.type === "H" ? -a.value : a.value) - (b.type === "H" ? -b.value : b.value))) {
    if (kept.some((k) => Math.hypot(k.gx - e.gx, k.gy - e.gy) < 5)) continue;
    kept.push(e);
  }
  return kept.map(({ type, lon, lat, value }) => ({ type, lon, lat, value }));
}

// ── SVG rendering ──────────────────────────────────────────────────────────
function escapeXml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function geojsonToPath(geo) {
  const parts = [];
  const drawRing = (ring) => {
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
    if (geom.type === "Polygon") for (const ring of geom.coordinates) drawRing(ring);
    else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) for (const ring of poly) drawRing(ring);
  }
  return parts.join(" ");
}
function chaikin(pts, iterations = 2, closed = true) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = cur.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i];
      const b = cur[closed ? (i + 1) % n : i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) { out.unshift(cur[0]); out.push(cur[n - 1]); }
    cur = out;
  }
  return cur;
}
function contourToPath(coords, doSmooth = true) {
  let d = "";
  for (const poly of coords) for (const ring of poly) {
    let pts = ring.map(([gx, gy]) => gridToPixel(gx, gy));
    if (pts.length < 2) continue;
    if (!doSmooth || pts.length < 4) {
      for (let i = 0; i < pts.length; i++) d += (i === 0 ? "M" : "L") + pts[i][0].toFixed(1) + "," + pts[i][1].toFixed(1);
      continue;
    }
    const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const ringPts = closed ? pts.slice(0, -1) : pts;
    const smoothed = chaikin(ringPts, 2, closed);
    pts = closed ? [...smoothed, smoothed[0]] : smoothed;
    const n = closed ? pts.length - 1 : pts.length;
    const get = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(pts.length - 1, i))];
    d += "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    const limit = closed ? n : pts.length - 1;
    for (let i = 0; i < limit; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += "C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    if (closed) d += "Z";
  }
  return d;
}
function interpColor(v, stops) {
  if (v <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  if (v >= stops[stops.length - 1][0]) return `rgb(${stops[stops.length - 1][1].join(",")})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
    }
  }
  return "#fff";
}
const T850_STOPS = [
  [-30, [49, 54, 149]], [-20, [69, 117, 180]], [-10, [116, 173, 209]],
  [-5, [171, 217, 233]], [0, [255, 255, 255]], [5, [254, 224, 144]],
  [10, [253, 174, 97]], [15, [244, 109, 67]], [20, [215, 48, 39]], [25, [165, 0, 38]],
];
const t850Color = (v) => interpColor(v, T850_STOPS);
function precipStyle(mm) {
  if (!Number.isFinite(mm) || mm < 0.5) return null;
  if (mm < 1) return { fill: "#a7f3a0", opacity: 0.5 };
  if (mm < 2) return { fill: "#4ade80", opacity: 0.6 };
  if (mm < 5) return { fill: "#facc15", opacity: 0.7 };
  if (mm < 10) return { fill: "#fb923c", opacity: 0.78 };
  if (mm < 20) return { fill: "#ef4444", opacity: 0.82 };
  return { fill: "#a21caf", opacity: 0.88 };
}

function buildSvg(grids, targetUtcIso, extremaOverride) {
  const { pressure: grid, t850, precip } = grids;

  const t850Thresholds = [];
  for (let t = -32; t <= 28; t += 2.5) t850Thresholds.push(t);
  const t850Polys = d3contours().size([t850.cols, t850.rows]).thresholds(t850Thresholds)(t850.values);

  const precipThresholds = [0.5, 1, 2, 5, 10, 20];
  const precipPolys = d3contours().size([precip.cols, precip.rows]).thresholds(precipThresholds)(precip.values);

  const lineThresholds = [];
  for (let p = 960; p <= 1050; p += 5) lineThresholds.push(p);
  const linePolys = d3contours().size([grid.cols, grid.rows]).thresholds(lineThresholds)(grid.values);

  const date = new Date(targetUtcIso);
  const title = `Bodendruck Europa — ${date.toLocaleString("de-CH", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} UTC`;
  const subtitle = "DWD ICON-EU · T 850 hPa (°C) · Niederschlag 6 h · Isobaren je 5 hPa";

  const oceanPath = geojsonToPath(europeOcean);
  const landPath = geojsonToPath(europeCountries);
  const lakesPath = geojsonToPath(europeLakes);

  const gridLines = [];
  for (let lon = -20; lon <= 40; lon += 10) {
    const [x1, y1] = project(lon, S), [x2, y2] = project(lon, N);
    gridLines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.5" />`);
  }
  for (let lat = 35; lat <= 65; lat += 5) {
    const [x1, y1] = project(W, lat), [x2, y2] = project(E, lat);
    gridLines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.5" />`);
  }

  const t850Svg = [];
  for (const poly of t850Polys) {
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    t850Svg.push(`<path d="${d}" fill="${t850Color(poly.value)}" fill-rule="evenodd" stroke="none" />`);
  }
  const precipSvg = [];
  for (const poly of precipPolys) {
    const style = precipStyle(poly.value);
    if (!style) continue;
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    precipSvg.push(`<path d="${d}" fill="${style.fill}" fill-opacity="${style.opacity}" fill-rule="evenodd" stroke="none" />`);
  }

  const contourSvg = [], labelSvg = [];
  for (const poly of linePolys) {
    const value = poly.value;
    const isThousand = value === 1000;
    const isBold = value % 20 === 0;
    const stroke = "#000000";
    const sw = isBold ? 1.6 : 0.9;
    const d = contourToPath(poly.coordinates, true);
    if (!d) continue;
    contourSvg.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" />`);
    let bestRing = null, bestLen = 0;
    for (const p of poly.coordinates) for (const r of p) if (r.length > bestLen) { bestLen = r.length; bestRing = r; }
    if (bestRing && bestRing.length > 10) {
      const mid = bestRing[Math.floor(bestRing.length / 2)];
      const [lx, ly] = gridToPixel(mid[0], mid[1]);
      labelSvg.push(`<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="11" font-weight="${isThousand ? "700" : "600"}" fill="${stroke}" text-anchor="middle" stroke="white" stroke-width="3" stroke-opacity="0.85" paint-order="stroke fill">${Math.round(value)}</text>`);
    }
  }

  const extrema = extremaOverride ?? findExtrema(grid);
  const extremaSvg = [];
  for (const e of extrema) {
    const [x, y] = project(e.lon, e.lat);
    const isH = e.type === "H";
    const color = isH ? "#7f0000" : "#0d47a1";
    const nameSvg = e.name
      ? `<text x="${x.toFixed(1)}" y="${(y - 28).toFixed(1)}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="13" font-style="italic" font-weight="700" fill="${color}" text-anchor="middle" stroke="white" stroke-width="3" stroke-opacity="0.9" paint-order="stroke fill">${escapeXml(e.name)}</text>`
      : "";
    extremaSvg.push(`<g>${nameSvg}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="white" fill-opacity="0.85" stroke="${color}" stroke-width="1.5" /><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="${color}" text-anchor="middle" dominant-baseline="central">${e.type}</text><text x="${x.toFixed(1)}" y="${(y + 34).toFixed(1)}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" fill="${color}" text-anchor="middle" stroke="white" stroke-width="3" stroke-opacity="0.9" paint-order="stroke fill">${Math.round(e.value)}</text></g>`);
  }

  const lgY = IMG_H - 55, lgH = 10;
  const t850LgX = PAD.left + 12, t850LgW = 320, t850Segs = 40;
  const t850Items = [];
  for (let i = 0; i < t850Segs; i++) {
    const t = -30 + (25 - -30) * (i / (t850Segs - 1));
    t850Items.push(`<rect x="${(t850LgX + (t850LgW / t850Segs) * i).toFixed(1)}" y="${lgY}" width="${(t850LgW / t850Segs + 0.5).toFixed(1)}" height="${lgH}" fill="${t850Color(t)}" />`);
  }
  const t850Labels = [-30, -15, 0, 10, 25].map((t) => {
    const x = t850LgX + ((t - -30) / (25 - -30)) * t850LgW;
    return `<text x="${x.toFixed(1)}" y="${lgY + lgH + 11}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="9" fill="#334155" text-anchor="middle">${t > 0 ? "+" : ""}${t}</text>`;
  }).join("");

  const pLgX = IMG_W - PAD.right - 12 - 280, pLgW = 280;
  const pSwatches = [{ v: 0.5, label: "0.5" }, { v: 1, label: "1" }, { v: 2, label: "2" }, { v: 5, label: "5" }, { v: 10, label: "10" }, { v: 20, label: "20+" }];
  const pStep = pLgW / pSwatches.length;
  const pItems = [], pLabels = [];
  for (let i = 0; i < pSwatches.length; i++) {
    const s = precipStyle(pSwatches[i].v + 0.01);
    const x = pLgX + i * pStep;
    pItems.push(`<rect x="${x.toFixed(1)}" y="${lgY}" width="${(pStep - 1).toFixed(1)}" height="${lgH}" fill="${s.fill}" fill-opacity="${s.opacity}" />`);
    pLabels.push(`<text x="${(x + pStep / 2).toFixed(1)}" y="${lgY + lgH + 11}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="9" fill="#334155" text-anchor="middle">${pSwatches[i].label}</text>`);
  }

  const [fx1, fy1] = [PAD.left, PAD.top];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IMG_W} ${IMG_H}" width="${IMG_W}" height="${IMG_H}">
  <defs><clipPath id="plot"><rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" /></clipPath></defs>
  <rect width="${IMG_W}" height="${IMG_H}" fill="#ffffff" />
  <text x="${IMG_W / 2}" y="30" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#0f172a" text-anchor="middle">${escapeXml(title)}</text>
  <text x="${IMG_W / 2}" y="50" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="12" fill="#475569" text-anchor="middle">${escapeXml(subtitle)}</text>
  <g clip-path="url(#plot)">
    <rect x="${fx1}" y="${fy1}" width="${PLOT_W}" height="${PLOT_H}" fill="#a8c8e0" />
    <path d="${oceanPath}" fill="#7fb0d4" stroke="none" />
    <path d="${landPath}" fill="#D3EAC2" stroke="none" />
    <g opacity="0.62">${t850Svg.join("\n      ")}</g>
    <g>${precipSvg.join("\n      ")}</g>
    <path d="${lakesPath}" fill="#a8c8e0" stroke="#6b8caa" stroke-width="0.4" />
    <path d="${landPath}" fill="none" stroke="#3a4a5a" stroke-width="0.7" stroke-linejoin="round" />
    ${gridLines.join("\n    ")}
    ${contourSvg.join("\n    ")}
    ${labelSvg.join("\n    ")}
    ${extremaSvg.join("\n    ")}
  </g>
  
  ${t850Items.join("\n  ")}
  ${t850Labels}
  <text x="${t850LgX}" y="${lgY - 4}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="10" font-weight="600" fill="#0f172a">Temperatur 850 hPa (°C)</text>
  ${pItems.join("\n  ")}
  ${pLabels.join("\n  ")}
  <text x="${pLgX}" y="${lgY - 4}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="10" font-weight="600" fill="#0f172a">Niederschlag 6 h (mm)</text>
  <text x="${IMG_W - 10}" y="${IMG_H - 10}" font-family="-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;SF Pro Text&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" font-size="10" fill="#94a3b8" text-anchor="end">Quelle: DWD ICON-EU via Open-Meteo · Namen: Aktion Wetterpate, FU Berlin · oberthurgauerwetter.ch</text>
</svg>`;
}

// ── Target picker + main ───────────────────────────────────────────────────
function pickTargetTime(now = new Date()) {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0));
  return tomorrow.toISOString().slice(0, 16);
}
function shiftHour(iso, deltaH) {
  const d = new Date(`${iso}:00Z`);
  d.setUTCHours(d.getUTCHours() + deltaH);
  return d.toISOString().slice(0, 16);
}

// Exit codes:
//   1 = missing / invalid secrets
//   2 = no usable weather data
//   3 = upload failed
//   4 = SVG build failed
//  99 = unexpected/unknown error
class PhaseError extends Error {
  constructor(phase, code, cause) {
    super(`[${phase}] ${cause?.message ?? cause}`);
    this.phase = phase;
    this.code = code;
    this.cause = cause;
  }
}

async function main() {
  console.log("[gen] phase=env-check");
  const rawUrl = process.env.SUPABASE_URL ?? "";
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const SUPABASE_URL = rawUrl.replace(/[\r\n\t ]+/g, "").trim();
  const SERVICE_KEY = rawKey.replace(/[\r\n\t]/g, "").trim();
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new PhaseError("env-check", 1, new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env"));
  }
  if (rawKey.length !== SERVICE_KEY.length) {
    console.warn(`[gen] SERVICE key contained whitespace/newlines — stripped ${rawKey.length - SERVICE_KEY.length} chars`);
  }
  if (/[^\x20-\x7E]/.test(SERVICE_KEY)) {
    throw new PhaseError("env-check", 1, new Error("SUPABASE_SERVICE_ROLE_KEY contains non-ASCII characters"));
  }
  try {
    const u = new URL(SUPABASE_URL);
    if (!/^https?:$/.test(u.protocol)) throw new Error("SUPABASE_URL must be http(s)");
    console.log(`[gen] SUPABASE_URL host=${u.host}, service key length=${SERVICE_KEY.length} (raw=${rawKey.length})`);
  } catch (e) {
    throw new PhaseError("env-check", 1, e);
  }

  console.log("[gen] phase=client-init");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const targetUtc = pickTargetTime();
  const targetDay = targetUtc.slice(0, 10);

  // Skip-Check: spart Open-Meteo-Calls, wenn die Karte für diesen Zieltag bereits
  // erfolgreich erzeugt wurde. Manueller Trigger umgeht via FORCE_REGENERATE.
  if (!process.env.FORCE_REGENERATE) {
    try {
      const { data: cur } = await supabase
        .from("app_settings")
        .select("id, pressure_map_last_status")
        .limit(1)
        .maybeSingle();
      const status = cur?.pressure_map_last_status ?? "";
      const match = status.match(/target (\d{4}-\d{2}-\d{2})/);
      if (status.startsWith("OK ·") && match?.[1] === targetDay) {
        console.log(`[gen] skip: Karte für ${targetDay} bereits aktuell (status: ${status})`);
        if (cur?.id) {
          await supabase.from("app_settings").update({
            pressure_map_last_run: new Date().toISOString(),
            pressure_map_last_status: `Skip · external-gen · bereits aktuell für ${targetDay}`,
          }).eq("id", cur.id);
        }
        return;
      }
    } catch (e) {
      console.warn("[gen] skip-check failed, fahre mit Generierung fort:", e?.message ?? e);
    }
  }

  console.log("[gen] phase=fetch");
  const attempts = [
    { model: "icon_seamless", target: targetUtc, label: "icon_seamless" },
    { model: "ecmwf_ifs025", target: targetUtc, label: "ecmwf_ifs025" },
    { model: "gfs_global", target: targetUtc, label: "gfs_global" },
    { model: "icon_seamless", target: shiftHour(targetUtc, -6), label: "icon_seamless@-6h" },
    { model: "icon_seamless", target: shiftHour(targetUtc, +6), label: "icon_seamless@+6h" },
  ];

  let raw = null, usedLabel = "", usedTarget = targetUtc, lastValid = 0, lastLabel = "";
  for (const a of attempts) {
    try {
      const candidate = await fetchGrids(a.target, a.model);
      const valid = candidate.pressure.values.filter((v) => Number.isFinite(v)).length;
      console.log(`[gen] ${a.label} target=${a.target}: ${valid}/${candidate.pressure.values.length} valid`);
      lastValid = valid;
      lastLabel = a.label;
      if (valid >= 100) { raw = candidate; usedLabel = a.label; usedTarget = a.target; break; }
    } catch (e) {
      console.warn(`[gen] attempt ${a.label} threw:`, e?.stack ?? e);
    }
  }
  if (!raw) {
    throw new PhaseError("fetch", 2, new Error(
      `Zu wenige gültige Druckwerte (last=${lastValid}/${COLS * ROWS}, lastModel=${lastLabel}, target=${targetUtc})`
    ));
  }

  console.log("[gen] phase=svg-build");
  let svg, bytes;
  try {
    const grids = {
      pressure: fillAndSmooth(raw.pressure, 1013, 3),
      t850: fillAndSmooth(raw.t850, 0, 2),
      precip: fillAndSmooth(raw.precip, 0, 1),
    };
    const baseExtrema = findExtrema(grids.pressure);
    const namedExtrema = await attachFuBerlinNames(baseExtrema);
    svg = buildSvg(grids, usedTarget, namedExtrema);
    bytes = new TextEncoder().encode(svg);
  } catch (e) {
    throw new PhaseError("svg-build", 4, e);
  }

  console.log(`[gen] phase=upload (${bytes.length} bytes)`);
  const latestPath = "europe-pressure-latest.svg";
  const archivePath = `archive/europe-pressure-${usedTarget.slice(0, 10)}.svg`;
  for (const path of [latestPath, archivePath]) {
    const { error } = await supabase.storage.from("weather-maps").upload(path, bytes, {
      contentType: "image/svg+xml", cacheControl: "3600", upsert: true,
    });
    if (error) {
      throw new PhaseError("upload", 3, new Error(`Upload ${path} failed: ${error.message}`));
    }
    console.log(`[gen] uploaded ${path}`);
  }

  console.log("[gen] phase=status-update");
  try {
    const { data: row } = await supabase.from("app_settings").select("id").limit(1).maybeSingle();
    if (row?.id) {
      await supabase.from("app_settings").update({
        pressure_map_last_run: new Date().toISOString(),
        pressure_map_last_status: `OK · external-gen · ${usedLabel} · target ${usedTarget.slice(0, 10)} · ${bytes.length} B`,
      }).eq("id", row.id);
    }
  } catch (e) {
    console.warn("[gen] could not update app_settings:", e?.stack ?? e);
  }

  console.log(`[gen] done: ${usedLabel}, target ${usedTarget}, ${bytes.length} bytes`);
}

main().catch((e) => {
  if (e instanceof PhaseError) {
    console.error(`[gen] FAILED in phase=${e.phase} code=${e.code}: ${e.message}`);
    if (e.cause?.stack) console.error(e.cause.stack);
    process.exit(e.code);
  }
  console.error("[gen] FAILED with unexpected error:", e?.stack ?? e);
  process.exit(99);
});
