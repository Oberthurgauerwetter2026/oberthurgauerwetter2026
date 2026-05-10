import { writeFileSync } from "fs";
import { buildSvg } from "./src/server/_pmap_test";

// Match map extent from pmap.ts
const W = -25, E = 45, S = 30, N = 70;
const STEP = 1.5;
const COLS = Math.round((E - W) / STEP) + 1; // 47
const ROWS = Math.round((N - S) / STEP) + 1; // 28

type Grid = { values: number[]; cols: number; rows: number };

function gauss(lon: number, lat: number, cLon: number, cLat: number, sigma: number): number {
  const dx = (lon - cLon) * Math.cos((lat * Math.PI) / 180);
  const dy = lat - cLat;
  return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
}

const pressure: number[] = [];
const t850: number[] = [];
const precip: number[] = [];

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const lat = N - r * STEP;
    const lon = W + c * STEP;

    // ── PRESSURE ──
    // Azores high (south-west), Iceland low (north-west), Scandinavian low (north-east),
    // mid-Europe ridge.
    let p = 1013;
    p += 22 * gauss(lon, lat, -25, 38, 12); // Azores high
    p -= 28 * gauss(lon, lat, -22, 62, 10); // Iceland low
    p -= 18 * gauss(lon, lat, 22, 62, 9);   // Scandinavian low
    p += 8 * gauss(lon, lat, 15, 47, 8);    // Alpine ridge
    p -= 10 * gauss(lon, lat, 35, 40, 9);   // Eastern-Med low
    pressure.push(p);

    // ── T850 ──
    // Strong N→S gradient with two wave-shaped frontal zones.
    let t = 18 - ((lat - 30) / (70 - 30)) * 33; // 18°C at 30°N → -15°C at 70°N
    // Cold tongue: pushes warm/cold contrast eastward across central Europe (cold front).
    const f1 = Math.sin(((lon + 25) / 70) * Math.PI * 1.5);
    t += -8 * Math.exp(-Math.pow((lat - (52 + 6 * f1)) / 3.5, 2));
    // Warm tongue from south: warm bulge over France/Germany (warm front).
    const f2 = Math.cos(((lon + 5) / 30) * Math.PI);
    t += 6 * Math.exp(-Math.pow((lat - (45 + 4 * f2)) / 3.0, 2)) * (lon > -10 && lon < 30 ? 1 : 0.3);
    t850.push(t);

    // ── PRECIP ──
    // Bands along the frontal zones: where |dT/dy| is large.
    let pr = 0;
    pr += 8 * Math.exp(-Math.pow((lat - (52 + 6 * f1)) / 1.8, 2));
    pr += 5 * Math.exp(-Math.pow((lat - (45 + 4 * f2)) / 1.6, 2)) * (lon > -10 && lon < 30 ? 1 : 0);
    // Add some convective spots over the Mediterranean
    pr += 12 * gauss(lon, lat, 12, 42, 2);
    pr += 6 * gauss(lon, lat, 28, 38, 2.5);
    precip.push(Math.max(0, pr));
  }
}

const grids = {
  pressure: { values: pressure, cols: COLS, rows: ROWS } as Grid,
  t850: { values: t850, cols: COLS, rows: ROWS } as Grid,
  precip: { values: precip, cols: COLS, rows: ROWS } as Grid,
};

// Tomorrow 12:00 UTC
const now = new Date();
const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0)).toISOString().slice(0, 16);

const svg = buildSvg(grids, target);
writeFileSync("/mnt/documents/pressure-map-test.svg", svg);
console.log("Written:", svg.length, "bytes");
