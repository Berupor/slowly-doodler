import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handDrawn } from '../extension/editor/sketchy.js';
import { W, H, LIMITS } from '../extension/editor/sdj.js';

/** @param {number[][]} pts */
const length = pts => pts.slice(1).reduce((l, q, i) => l + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);

/** @param {number[]} a @param {number[]} b @param {number[][]} pts */
const maxOffset = (a, b, pts) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.max(...pts.map(([x, y]) => Math.abs((x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])) / len));
};

/** @param {number[]} a @param {number[]} b */
const line = (a, b) => [{ color: 'black', weight: 3, pts: [a, b] }];

const circle = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) => [{
  color: 'blue', weight: 2, pts: Array.from({ length: 49 }, (_, i) => [cx + r * Math.cos(i / 48 * 2 * Math.PI), cy + r * Math.sin(i / 48 * 2 * Math.PI)]),
}];

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe('handDrawn', () => {
  it('returns the input unchanged at roughness 0', () => {
    const input = [...line([10, 10], [600, 700]), ...circle(300, 400, 100)];
    assert.equal(handDrawn(input, { roughness: 0, seed: 5 }), input);
  });

  it('gives the same output for the same seed and another for a different one', () => {
    const input = [...line([10, 10], [600, 700]), ...circle(300, 400, 100)];
    assert.deepEqual(handDrawn(input, { roughness: 1, seed: 7 }), handDrawn(input, { roughness: 1, seed: 7 }));
    assert.notDeepEqual(handDrawn(input, { roughness: 1, seed: 7 }), handDrawn(input, { roughness: 1, seed: 8 }));
  });

  it('keeps colour and weight of every stroke', () => {
    const out = handDrawn([{ color: 'red', weight: 4.5, pts: [[10, 10], [300, 10]] }], { roughness: 1, seed: 3 });
    assert.ok(out.length >= 1 && out.every(p => p.color === 'red' && p.weight === 4.5));
  });

  it('bends a straight line visibly but by a bounded amount', () => {
    for (const len of [60, 150, 400]) {
      const a = [100, 100], b = [100 + len, 100];
      const peaks = SEEDS.map(seed => Math.max(...handDrawn(line(a, b), { roughness: 1, seed }).map(p => maxOffset(a, b, p.pts))));
      assert.ok(Math.min(...peaks) > 0.1, `len ${len}: smallest peak ${Math.min(...peaks)}`);
      assert.ok(Math.max(...peaks) < len * 0.04, `len ${len}: largest peak ${Math.max(...peaks)}`);
    }
  });

  it('deviates more at higher roughness', () => {
    const a = [100, 100], b = [500, 100];
    const mean = (/** @type {number} */ roughness) => SEEDS.reduce((s, seed) => s + Math.max(...handDrawn(line(a, b), { roughness, seed }).map(p => maxOffset(a, b, p.pts))), 0) / SEEDS.length;
    assert.ok(mean(2) > mean(0.5) * 1.5, `${mean(0.5)} vs ${mean(2)}`);
  });

  it('does not close a circle exactly, but leaves a small gap', () => {
    for (const seed of SEEDS) {
      const out = handDrawn(circle(300, 400, 100), { roughness: 1, seed });
      const first = out[0].pts[0], last = out.at(-1).pts.at(-1);
      const gap = Math.hypot(first[0] - last[0], first[1] - last[1]);
      assert.ok(gap > 0.01 && gap < 8, `seed ${seed}: gap ${gap}`);
    }
  });

  it('keeps a circle round', () => {
    const out = handDrawn(circle(300, 400, 100), { roughness: 1, seed: 4 });
    for (const [x, y] of out.flatMap(p => p.pts)) assert.ok(Math.abs(Math.hypot(x - 300, y - 400) - 100) < 6, `${x},${y}`);
  });

  it('splits a long line into 2 or 3 strokes that cover its length', () => {
    for (const len of [200, 340, 600]) {
      for (const seed of SEEDS) {
        const out = handDrawn(line([50, 300], [50 + len, 300]), { roughness: 1, seed });
        assert.ok(out.length >= 2 && out.length <= 3, `len ${len} seed ${seed}: ${out.length} strokes`);
        const xs = out.flatMap(p => p.pts.map(q => q[0]));
        assert.ok(Math.min(...xs) < 50 + 4 && Math.max(...xs) > 50 + len - 4, `len ${len}: spans ${Math.min(...xs)}-${Math.max(...xs)}`);
        const total = out.reduce((s, p) => s + length(p.pts), 0);
        assert.ok(total > len * 0.97 && total < len * 1.06, `len ${len}: drawn ${total}`);
      }
    }
  });

  it('leaves a short line as one stroke', () => {
    assert.equal(handDrawn(line([100, 100], [150, 110]), { roughness: 1, seed: 2 }).length, 1);
  });

  it('stays on the canvas, also for strokes on its edge', () => {
    const edge = [
      { color: 'black', weight: 3, pts: [[0, 0], [W, 0], [W, H], [0, H], [0, 0]] },
      { color: 'black', weight: 3, pts: [[0, 500], [W, 500]] },
    ];
    for (const seed of SEEDS) for (const p of handDrawn(edge, { roughness: 2, seed }))
      for (const [x, y] of p.pts) assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `${x},${y}`);
  });

  it('stays within the stroke limit by splitting only into what is left', () => {
    const many = Array.from({ length: LIMITS.strokes - 5 }, (_, i) => ({ color: 'black', weight: 2, pts: [[10, 5 + i * 0.9], [700, 5 + i * 0.9]] }));
    const out = handDrawn(many, { roughness: 1, seed: 9 });
    assert.ok(out.length <= LIMITS.strokes && out.length >= many.length, `${out.length} strokes`);
  });

  it('keeps every stroke whole when there is no stroke budget left', () => {
    const full = Array.from({ length: LIMITS.strokes }, (_, i) => ({ color: 'black', weight: 2, pts: [[10, 5 + i * 0.9], [700, 5 + i * 0.9]] }));
    assert.equal(handDrawn(full, { roughness: 1, seed: 9 }).length, LIMITS.strokes);
  });

  it('stays within the point limits for a heavy import', () => {
    const heavy = Array.from({ length: 900 }, (_, i) => ({ color: 'black', weight: 1, pts: Array.from({ length: 270 }, (_, k) => [10 + k * 2.5, 5 + i + Math.sin(k / 9) * 3]) }));
    const have = heavy.reduce((n, p) => n + p.pts.length, 0);
    const out = handDrawn(heavy, { roughness: 1, seed: 11 });
    assert.ok(out.length <= LIMITS.strokes, `${out.length} strokes`);
    assert.ok(out.reduce((n, p) => n + p.pts.length, 0) <= LIMITS.points, `${have} points in`);
    assert.ok(out.every(p => p.pts.length <= LIMITS.pointsPerStroke));
  });

  it('keeps a stroke that is already at the per-stroke point limit within it', () => {
    const long = [{ color: 'black', weight: 1, pts: Array.from({ length: LIMITS.pointsPerStroke }, (_, k) => [k % 700, 100 + Math.floor(k / 700) * 3]) }];
    for (const p of handDrawn(long, { roughness: 1, seed: 1 })) assert.ok(p.pts.length <= LIMITS.pointsPerStroke);
  });

  it('passes a single point and an empty list through', () => {
    const dot = [{ color: 'black', weight: 2, pts: [[10, 10]] }];
    assert.deepEqual(handDrawn(dot, { roughness: 1, seed: 1 }), dot);
    assert.deepEqual(handDrawn([], { roughness: 1, seed: 1 }), []);
  });

  it('keeps sharp corners sharp', () => {
    const box = [{ color: 'black', weight: 2, pts: [[100, 100], [300, 100], [300, 250], [100, 250], [100, 100]] }];
    const out = handDrawn(box, { roughness: 1, seed: 6 }).flatMap(p => p.pts);
    const nearest = (/** @type {number[]} */ c) => Math.min(...out.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])));
    for (const corner of [[300, 100], [300, 250], [100, 250]]) assert.ok(nearest(corner) < 5, `corner ${corner}: ${nearest(corner)}`);
  });
});
