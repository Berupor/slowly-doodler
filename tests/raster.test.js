import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centerlines } from '../extension/editor/raster.js';

const W = 120, H = 120;

/** @param {(x: number, y: number) => boolean} inside */
function mask(inside) {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x + 0.5, y + 0.5)) m[y * W + x] = 1;
  return m;
}

/** @param {number} px @param {number} py @param {number[]} a @param {number[]} b */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const length = (/** @type {number[][]} */ p) => p.slice(1).reduce((l, q, i) => l + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

describe('centerlines', () => {
  it('traces a thick bar as one stroke along its middle', () => {
    const lines = centerlines(mask((x, y) => x > 20 && x < 100 && Math.abs(y - 60) < 4), W, H);
    assert.equal(lines.length, 1);
    for (const [, y] of lines[0]) assert.ok(Math.abs(y - 60) < 1.5, `y ${y} is off the middle`);
    assert.ok(length(lines[0]) > 70, `length ${length(lines[0])}`);
  });

  it('traces a drawn X as 2 to 4 strokes that run through the crossing', () => {
    const a = [[15, 15], [105, 105]], b = [[105, 15], [15, 105]];
    const lines = centerlines(mask((x, y) => distToSegment(x, y, a[0], a[1]) < 3.5 || distToSegment(x, y, b[0], b[1]) < 3.5), W, H);
    assert.ok(lines.length >= 2 && lines.length <= 4, `${lines.length} strokes`);
    const total = lines.reduce((s, p) => s + length(p), 0);
    assert.ok(total > 2 * 127 * 0.85, `total length ${total}`);
    assert.ok(Math.max(...lines.map(length)) > 100, 'the longest stroke should cross the middle');
  });

  it('traces a ring as one closed stroke', () => {
    const lines = centerlines(mask((x, y) => Math.abs(Math.hypot(x - 60, y - 60) - 35) < 4), W, H);
    assert.equal(lines.length, 1);
    const p = lines[0];
    assert.ok(Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1.5, 'the ring should close');
    for (const [x, y] of p) assert.ok(Math.abs(Math.hypot(x - 60, y - 60) - 35) < 1.5);
  });

  it('keeps few points on a straight run', () => {
    const lines = centerlines(mask((x, y) => x > 10 && x < 110 && Math.abs(y - 30) < 3), W, H);
    assert.ok(lines[0].length <= 6, `${lines[0].length} points`);
  });
});
