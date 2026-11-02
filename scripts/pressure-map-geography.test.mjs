import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url)));
const edgeKey = (a, b) => [JSON.stringify(a), JSON.stringify(b)].sort().join('|');

test('inland borders contain only shared country edges, not coastlines', () => {
  const edges = new Map();
  for (const { geometry: g } of read('europe-countries').features) {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const key = edgeKey(ring[i - 1], ring[i]);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }
  const borders = read('europe-country-borders').features[0].geometry.coordinates;
  assert.ok(borders.length > 0);
  for (const [a, b] of borders) assert.ok(edges.get(edgeKey(a, b)) > 1);
  assert.equal(borders.length, [...edges.values()].filter(n => n > 1).length);
});

test('coastlines omit artificial edges of the Europe map extent', () => {
  const lines = read('europe-coastlines').features[0].geometry.coordinates;
  assert.ok(lines.length > 0);
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    for (const [axis, boundary] of [[0, -25], [0, 45], [1, 30], [1, 70]]) {
      assert.equal(Math.abs(line[i - 1][axis] - boundary) < 1e-5 && Math.abs(line[i][axis] - boundary) < 1e-5, false);
    }
  }
});