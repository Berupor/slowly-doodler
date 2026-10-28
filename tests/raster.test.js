import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centerlines, placementCrop, traceCrop, clipToCanvas, edgeFlow, inhibitTexture } from '../extension/editor/raster.js';
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

describe('photo edges', () => {
  it('outlines a red square on a green ground of the same brightness', () => {
    const crop = placementCrop(300, 300);
    assert.ok(crop);
    const data = new Uint8ClampedArray(crop.w * crop.h * 4);
    for (let y = 0; y < crop.h; y++)
      for (let x = 0; x < crop.w; x++) {
        const inside = Math.abs(x * 300 / crop.w - 150) < 70 && Math.abs(y * 300 / crop.h - 150) < 70;
        data.set(inside ? [200, 60, 60, 255] : [40, 145, 40, 255], (y * crop.w + x) * 4);
      }
    const lines = traceCrop(data, crop, { color: 'black', weight: 1, detail: 30, minLength: 16 });
    const total = lines.reduce((a, l) => a + length(l.pts), 0);
    const side = 140 * crop.toCanvas[0] * crop.w / 300;
    assert.ok(total > 3 * side, `${total} of ${4 * side} traced`);
  });
});

/** @param {NonNullable<ReturnType<typeof placementCrop>>} crop @param {(x: number, y: number) => number[]} colourAt */
function paint(crop, colourAt) {
  const data = new Uint8ClampedArray(crop.w * crop.h * 4);
  for (let v = 0; v < crop.h; v++)
    for (let u = 0; u < crop.w; u++) data.set([...colourAt(crop.sx + (u + 0.5) * crop.sw / crop.w, crop.sy + (v + 0.5) * crop.sh / crop.h), 255], (v * crop.w + u) * 4);
  return data;
}

/** @param {NonNullable<ReturnType<typeof placementCrop>>} crop @param {number[]} p canvas point to source pixels */
const toSource = ({ toCanvas: m, sx, sy, sw, w }, [x, y]) => [sx + (x - m[4]) / m[0] * sw / w, sy + (y - m[5]) / m[3] * sw / w];

const DETAILED = { mode: 'edges', detail: 120, minLength: 5, maxStrokes: 640, focus: [0.25, 1.3], seeds: [2, 0.3] };

describe('photo flat illustration', () => {
  const NAVY = [29, 36, 64], YELLOW = [255, 217, 102];
  const roofs = [[0, 520], [70, 410], [150, 470], [230, 360], [320, 430], [400, 500], [480, 390], [600, 0]];
  const roofAt = (/** @type {number} */ x) => roofs.findLast(([from]) => from <= x)?.[1] ?? 0;
  const skyline = roofs.slice(0, -1).flatMap(([from, y], i) => [[from, y], [roofs[i + 1][0], y]]);
  const windowAt = (/** @type {number} */ x, /** @type {number} */ y) => y > roofAt(x) + 20 && y < 700 && (x % 40) > 14 && (x % 40) < 30 && (y % 44) < 20 && Math.abs(x - Math.round(x / 80) * 80) > 12;
  const sky = (/** @type {number} */ y) => [15 + 91 * y / 800, 27 + 49 * y / 800, 77 + 70 * y / 800];
  const city = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 460, y - 130) < 55 ? [255, 243, 196]
    : y > 720 || y < roofAt(x) ? sky(y) : windowAt(x, y) ? YELLOW : NAVY;

  it('keeps a dark skyline on a gradient sky as a few long strokes', () => {
    const crop = placementCrop(600, 800);
    assert.ok(crop);
    const lines = traceCrop(paint(crop, city), crop, { ...DETAILED, color: 'black', weight: 1 });
    const along = lines.map(l => l.pts.map(p => toSource(crop, p)))
      .filter(pts => pts.filter(([x, y]) => skyline.slice(1).some((q, i) => distToSegment(x, y, skyline[i], q) < 3)).length > 0.8 * pts.length);
    const total = length(skyline), traced = along.reduce((a, p) => a + length(p), 0);
    assert.ok(along.length >= 1 && along.length <= 3, `${along.length} strokes on the skyline`);
    assert.ok(traced > 0.85 * total, `${Math.round(traced)} of ${Math.round(total)} traced`);
  });

  it('draws a coloured shape on a dark ground in the colour of the shape', () => {
    const crop = placementCrop(300, 300);
    assert.ok(crop);
    const square = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(x - 90) < 40 && Math.abs(y - 150) < 40;
    const disc = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 220, y - 150) < 40;
    const lines = traceCrop(paint(crop, (x, y) => square(x, y) ? YELLOW : disc(x, y) ? [229, 57, 53] : NAVY), crop,
      { color: 'black', weight: 1, detail: 60, minLength: 16, photoColors: true });
    const at = (/** @type {number} */ cx) => lines.filter(l => Math.abs(toSource(crop, l.pts[0])[0] - cx) < 60);
    assert.ok(at(90).length && at(220).length, `${lines.length} strokes`);
    for (const l of at(90)) assert.equal(l.color, 'yellow');
    for (const l of at(220)) assert.equal(l.color, 'red');
  });
});

const PRESETS = {
  outline: { mode: 'edges', detail: 30, minLength: 16, maxStrokes: 190, focus: [0.6, 1.6] },
  sketch: { mode: 'sketch', detail: 70, minLength: 11, maxStrokes: 390 },
  detailed: DETAILED,
  scan: { mode: 'dark', detail: 100, minLength: 8, maxStrokes: 540 },
};

/** @param {number} seed */
const noise = seed => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);

describe('edgeFlow', () => {
  it('runs along the rim of a disc', () => {
    const n = 100, g = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[y * n + x] = Math.hypot(x - 50, y - 50) < 30 ? 40 : 220;
    const { tx, ty } = edgeFlow(g, n, n);
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 12) {
      const x = Math.round(50 + 30 * Math.cos(a)), y = Math.round(50 + 30 * Math.sin(a)), i = y * n + x;
      const radial = Math.abs(tx[i] * Math.cos(a) + ty[i] * Math.sin(a));
      assert.ok(radial < 0.15, `flow at ${Math.round(a * 180 / Math.PI)} deg crosses the rim: ${radial}`);
    }
  });
});

describe('photo sketch', () => {
  it('draws a hand-drawn circle on a noisy page as one closed stroke', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    const rnd = noise(7);
    const data = paint(crop, (x, y) => {
      const ink = Math.abs(Math.hypot(x - 200, y - 200) - 120) < 2.5, v = (ink ? 60 : 225) + 70 * rnd();
      return [v, v, v];
    });
    const lines = traceCrop(data, crop, { ...PRESETS.sketch, color: 'black', weight: 1 });
    const ring = lines.map(l => l.pts.map(p => toSource(crop, p))).filter(pts => pts.every(([x, y]) => Math.abs(Math.hypot(x - 200, y - 200) - 120) < 6));
    assert.equal(ring.length, 1, `${ring.length} pieces on the circle, ${lines.length} strokes in all`);
    assert.ok(length(ring[0]) > 0.9 * 2 * Math.PI * 120, `${Math.round(length(ring[0]))} traced`);
  });
});

describe('texture inhibition', () => {
  it('keeps a lone edge and fades a crowd of them', () => {
    const n = 120, s = new Float32Array(n * n);
    for (let y = 0; y < n; y++) s[y * n + 20] = 10;
    for (let y = 0; y < n; y++) for (let x = 60; x < 120; x += 3) s[y * n + x] = 10;
    const out = inhibitTexture(s, n, n, 3);
    assert.ok(out[60 * n + 20] > 6, `lone edge ${out[60 * n + 20]}`);
    assert.ok(out[60 * n + 90] < 2, `crowded edge ${out[60 * n + 90]}`);
  });
});

describe('clipToCanvas', () => {
  it('splits a line that leaves and re-enters the canvas at the crossings', () => {
    const pieces = clipToCanvas([[100, 100], [-100, 100], [-100, 200], [100, 200]]);
    assert.deepEqual(pieces, [[[100, 100], [0, 100]], [[0, 200], [100, 200]]]);
  });
});
