import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centerlines, placementCrop, traceCrop, clipToCanvas } from '../extension/editor/raster.js';
import { W as CW, H as CH, LIMITS } from '../extension/editor/sdj.js';

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

/** @param {(x: number, y: number) => boolean} dark @param {NonNullable<ReturnType<typeof placementCrop>>} crop */
function render(dark, { sx, sy, sw, sh, w, h }) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++)
      if (dark(sx + (u + 0.5) * sw / w, sy + (v + 0.5) * sh / h)) data.fill(20, (v * w + u) * 4, (v * w + u) * 4 + 3);
  return data;
}

const onBorder = (/** @type {number[]} */ [x, y]) => [x, y, x - CW, y - CH].some(d => Math.abs(d) < 1e-6);

describe('retrace of an enlarged photo', () => {
  const rings = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(Math.hypot(x - 300, y - 225) % 40 - 20) < 4;
  const enlarged = [3, 0, 0, 3, -2 * CW / 2, -2 * CH / 2];

  it('traces only the source pixels on the canvas and cuts lines at the canvas edge', () => {
    const crop = placementCrop(600, 450, enlarged);
    assert.ok(crop && crop.sw < 300 && crop.sh < 450, JSON.stringify(crop));
    const lines = traceCrop(render(rings, crop), crop, { color: 'black', weight: 1, detail: 30, minLength: 16 });
    assert.ok(lines.length > 10, `${lines.length} strokes`);
    for (const { pts } of lines) for (const [x, y] of pts) assert.ok(x >= 0 && x <= CW && y >= 0 && y <= CH, `${x} ${y} is off the canvas`);
    const cut = lines.filter(({ pts }) => onBorder(pts[0]) || onBorder(pts[pts.length - 1]));
    assert.ok(cut.length > 0, 'rings run past the edge, so some lines end on it');
    for (const { pts } of lines)
      for (let i = 1; i < pts.length; i++)
        assert.ok(!(onBorder(pts[i - 1]) && onBorder(pts[i]) && (pts[i - 1][0] === pts[i][0] || pts[i - 1][1] === pts[i][1])), 'a line runs along the edge: clamped, not cut');
  });

  it('stays within the limits on a busy pattern', () => {
    const checks = (/** @type {number} */ x, /** @type {number} */ y) => (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
    const crop = placementCrop(1200, 900, [1.5, 0, 0, 1.5, -CW / 4, -CH / 4]);
    assert.ok(crop);
    const lines = traceCrop(render(checks, crop), crop, { color: 'black', weight: 1, detail: 120, minLength: 1 });
    assert.ok(lines.length <= LIMITS.strokes, `${lines.length} strokes`);
    assert.ok(lines.reduce((n, l) => n + l.pts.length, 0) <= LIMITS.points);
    for (const { pts } of lines) assert.ok(pts.length <= LIMITS.pointsPerStroke);
  });

  it('traces nothing when the placement is pushed off the canvas', () => {
    assert.equal(placementCrop(600, 450, [1, 0, 0, 1, CW * 2, 0]), null);
  });
});

describe('clipToCanvas', () => {
  it('splits a line that leaves and re-enters the canvas at the crossings', () => {
    const pieces = clipToCanvas([[100, 100], [-100, 100], [-100, 200], [100, 200]]);
    assert.deepEqual(pieces, [[[100, 100], [0, 100]], [[0, 200], [100, 200]]]);
  });
});
