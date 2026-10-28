import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centerlines, placementCrop, traceCrop, clipToCanvas, edgeFlow, inhibitTexture, isDrawnArt, isScan } from '../extension/editor/raster.js';
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

describe('photo flat colour', () => {
  const PAPER = [242, 239, 230];
  const disc = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 150, y - 160) < 80;
  const box = (/** @type {number} */ x, /** @type {number} */ y) => x > 330 && x < 520 && y > 90 && y < 230;
  const scene = (/** @type {number} */ x, /** @type {number} */ y) => disc(x, y) ? [43, 43, 43] : box(x, y) ? [47, 109, 181] : PAPER;

  for (const [name, preset] of Object.entries(PRESETS))
    it(`outlines a solid disc and a solid box once with nothing inside, ${name}`, () => {
      const crop = placementCrop(600, 320);
      assert.ok(crop);
      const lines = traceCrop(paint(crop, scene), crop, { ...preset, color: 'black', weight: 1 }).map(l => l.pts.map(p => toSource(crop, p)));
      const near = (/** @type {(x: number, y: number) => boolean} */ inside) => lines.filter(pts => pts.some(([x, y]) => inside(x, y) || [[-4, 0], [4, 0], [0, -4], [0, 4]].some(([dx, dy]) => inside(x + dx, y + dy))));
      for (const [shape, inside, rim] of /** @type {const} */ ([['disc', disc, 2 * Math.PI * 80], ['box', box, 2 * (190 + 140)]])) {
        const on = near(inside);
        assert.equal(on.length, 1, `${on.length} strokes on the ${shape}`);
        assert.ok(length(on[0]) > 0.9 * rim, `${shape}: ${Math.round(length(on[0]))} of ${Math.round(rim)}`);
        const deep = (/** @type {number} */ x, /** @type {number} */ y) => [[-8, 0], [8, 0], [0, -8], [0, 8]].every(([dx, dy]) => inside(x + dx, y + dy));
        assert.ok(!on[0].some(([x, y]) => deep(x, y)), `a stroke runs inside the ${shape}`);
      }
    });
});

describe('Ink scan on a photo and on a scan', () => {
  const RADIUS = 70, circumference = 2 * Math.PI * RADIUS;
  const patch = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 150, y - 160) < RADIUS;
  const darkPhoto = () => {
    const rnd = noise(4);
    return (/** @type {number} */ x, /** @type {number} */ y) => {
      const v = patch(x, y) ? 18 : 120 + 40 * Math.sin(x / 37) * Math.sin(y / 29);
      return [v + 50 * rnd(), v + 30 * Math.sin(y / 31) + 50 * rnd(), v + 50 * rnd()];
    };
  };
  const paperScan = () => {
    const rnd = noise(9);
    return (/** @type {number} */ x, /** @type {number} */ y) => {
      if (patch(x, y)) { const v = 15 + 10 * rnd(); return [v, v, v]; }
      return [232 + 30 * Math.sin(x / 43) + 24 * rnd(), 232 + 30 * Math.sin(y / 37 + 1) + 24 * rnd(), 232 + 30 * Math.sin((x + y) / 61) + 24 * rnd()];
    };
  };
  const run = (/** @type {(x: number, y: number) => number[]} */ colourAt) => {
    const crop = placementCrop(480, 320);
    assert.ok(crop);
    const data = paint(crop, colourAt);
    assert.equal(isDrawnArt(data, crop.w, crop.h), false);
    const lines = traceCrop(data, crop, { ...PRESETS.scan, color: 'black', weight: 1 }).map(l => l.pts.map(p => toSource(crop, p)));
    const onRim = lines.flatMap(pts => pts.slice(1).filter(([x, y]) => Math.abs(Math.hypot(x - 150, y - 160) - RADIUS) < 2.5).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])));
    return { data, crop, lines, rim: onRim.reduce((a, d) => a + d, 0) / circumference };
  };

  it('does not outline the dark patches of a photo', () => {
    const { data, crop, rim } = run(darkPhoto());
    assert.equal(isScan(data, crop.w, crop.h), false);
    assert.ok(rim < 0.2, `${Math.round(rim * 100)}% of the patch edge is traced`);
  });

  it('outlines a solid black mass on white paper once, along its edge', () => {
    const { data, crop, lines, rim } = run(paperScan());
    assert.equal(isScan(data, crop.w, crop.h), true);
    assert.ok(rim > 0.9, `${Math.round(rim * 100)}% of the mass edge is traced`);
    assert.equal(lines.filter(pts => pts.some(([x, y]) => Math.abs(Math.hypot(x - 150, y - 160) - RADIUS) < 6)).length, 1);
    assert.ok(!lines.some(pts => pts.some(([x, y]) => Math.hypot(x - 150, y - 160) < RADIUS - 12)), 'a stroke runs inside the mass');
  });
});

describe('drawn art', () => {
  const PAPER = [250, 249, 245];
  const trace = (/** @type {(x: number, y: number) => number[]} */ colourAt, /** @type {object} */ preset, size = 400) => {
    const crop = placementCrop(size, size);
    assert.ok(crop);
    const data = paint(crop, colourAt);
    return { data, crop, lines: traceCrop(data, crop, { ...preset, color: 'black', weight: 1 }).map(l => l.pts.map(p => toSource(crop, p))) };
  };
  const near = (/** @type {number[][][]} */ lines, /** @type {number[]} */ [x, y], /** @type {number} */ d) =>
    lines.filter(pts => pts.some((p, i) => i > 0 && distToSegment(x, y, pts[i - 1], p) < d));

  it('tells flat art from a photo', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    const flat = paint(crop, (x, y) => Math.hypot(x - 200, y - 200) < 90 ? [43, 43, 43] : x > 300 && y < 100 ? [47, 109, 181] : PAPER);
    const rnd = noise(3);
    const photo = paint(crop, (x, y) => [255 * x / 400 + 80 * rnd(), 255 * y / 400 + 80 * rnd(), 140 + 60 * Math.sin(x / 40) + 80 * rnd()]);
    assert.equal(isDrawnArt(flat, crop.w, crop.h), true);
    assert.equal(isDrawnArt(photo, crop.w, crop.h), false);
  });

  for (const [name, preset] of Object.entries(PRESETS))
    it(`draws the border of two touching shapes once, ${name}`, () => {
      const { lines } = trace((x, y) => y > 120 && y < 280 ? x > 80 && x < 200 ? [229, 57, 53] : x >= 200 && x < 320 ? [30, 136, 229] : PAPER : PAPER, preset);
      for (let y = 140; y <= 260; y += 10) assert.equal(near(lines, [200, y], 3).length, 1, `${near(lines, [200, y], 3).length} strokes on the shared border at y ${y}`);
    });

  it('outlines a speckled black mass once and draws nothing inside, detailed', () => {
    const rnd = noise(11), streaks = Array.from({ length: 500 }, () => [200 + 250 * rnd(), 200 + 250 * rnd(), 8 + 20 * (rnd() + 0.5), 40 + 50 * (rnd() + 0.5)]);
    const body = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 200, y - 200) < 120;
    const { lines } = trace((x, y) => {
      if (!body(x, y)) return PAPER;
      const lit = streaks.find(([sx, sy, len]) => Math.abs(x - sx) < 0.6 && y > sy && y < sy + len);
      const v = lit ? lit[3] : 4 + 16 * (rnd() + 0.5);
      return [v, v, v];
    }, DETAILED);
    const on = lines.filter(pts => pts.some(([x, y]) => Math.abs(Math.hypot(x - 200, y - 200) - 120) < 4));
    assert.equal(on.length, 1, `${on.length} strokes on the rim ${JSON.stringify(on.map(p => [p.length, Math.round(length(p)), p[0].map(Math.round)]))}`);
    assert.ok(length(on[0]) > 0.9 * 2 * Math.PI * 120, `${Math.round(length(on[0]))} of the rim traced`);
    const inside = lines.filter(pts => pts.some(([x, y]) => Math.hypot(x - 200, y - 200) < 110));
    assert.equal(inside.length, 0, `${inside.length} marks inside the mass ${JSON.stringify(inside.map(p => p.map(q => q.map(Math.round))))}`);
  });

  for (const [name, preset] of Object.entries(PRESETS))
    it(`draws a 3px line as one centre stroke, ${name}`, () => {
      const a = [80, 90], b = [320, 300];
      const { lines } = trace((x, y) => distToSegment(x, y, a, b) < 1.5 ? [30, 30, 30] : PAPER, preset);
      assert.equal(lines.length, 1, `${lines.length} strokes`);
      for (const [x, y] of lines[0]) assert.ok(distToSegment(x, y, a, b) < 1.5, `${x} ${y} is off the centre`);
      assert.ok(length(lines[0]) > 0.9 * Math.hypot(b[0] - a[0], b[1] - a[1]), `${Math.round(length(lines[0]))} traced`);
    });

  it('draws the dark strands of mid-brown hair, detailed', () => {
    const hair = (/** @type {number} */ x, /** @type {number} */ y) => x > 100 && x < 300 && y > 60 && y < 340;
    const { lines } = trace((x, y) => !hair(x, y) ? PAPER : x % 6 < 2 ? [70, 40, 20] : x % 6 < 4 ? [150, 100, 55] : [190, 135, 80], DETAILED);
    const strands = lines.filter(pts => pts.every(([x, y]) => x > 106 && x < 294 && y > 50 && y < 350) && length(pts) > 150);
    assert.ok(strands.length >= 16, `${strands.length} of 33 strands`);
  });

  for (const [name, preset] of Object.entries(PRESETS))
    it(`keeps a small white triangle on a black mass, ${name}`, () => {
      const nose = (/** @type {number} */ x, /** @type {number} */ y) => y > 190 && y < 204 && Math.abs(x - 200) < (y - 190) * 0.55;
      const { lines } = trace((x, y) => nose(x, y) ? PAPER : Math.hypot(x - 200, y - 200) < 150 ? [8, 8, 8] : PAPER, preset);
      assert.equal(near(lines, [200, 198], 8).length, 1, `${lines.length} strokes`);
    });

  it('draws a border in the darker of its two colours and a thin dash in its own colour', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    const YELLOW = [230, 195, 70], ROAD = [102, 72, 150], DASH = [50, 50, 60];
    const panel = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(x - 200) < 50 && y > 220;
    const body = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(x - 200) < 100 && y > 180;
    const dash = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(y - 90) < 1.5 && x % 60 < 30 && x > 40 && x < 360;
    const lines = traceCrop(paint(crop, (x, y) => panel(x, y) ? YELLOW : body(x, y) ? [30, 30, 30] : y > 60 && y < 120 ? dash(x, y) ? DASH : ROAD : PAPER), crop,
      { ...DETAILED, color: 'black', weight: 1, photoColors: true }).map(l => ({ ...l, pts: l.pts.map(p => toSource(crop, p)) }));
    const through = (/** @type {number[]} */ p) => lines.filter(l => near([l.pts], p, 3).length);
    for (const p of [[150, 300], [250, 300], [75, 90], [135, 90], [195, 90], [255, 90], [315, 90]]) {
      assert.equal(through(p).length, 1, `${through(p).length} strokes at ${p}`);
      assert.equal(through(p)[0].color, 'black', `at ${p}`);
    }
  });
});

describe('sketch hatching', () => {
  const HATCH = { ...PRESETS.sketch, hatch: true, color: 'black', weight: 1 };
  const PAPER = [250, 249, 245];
  const photo = (/** @type {number} */ size, /** @type {(x: number, y: number) => number} */ grey, grain = 80) => {
    const crop = placementCrop(size, size);
    assert.ok(crop);
    const rnd = noise(5);
    const data = paint(crop, (x, y) => [grey(x, y) + 30 * Math.sin(x / 40) + grain * rnd(), grey(x, y) + 30 * Math.sin(y / 35) + grain * rnd(), grey(x, y) + grain * rnd()]);
    assert.equal(isDrawnArt(data, crop.w, crop.h), false);
    return { crop, data };
  };
  const strokeKey = (/** @type {{ pts: number[][], color: string }} */ l) => JSON.stringify(l);
  const hatchOnly = (/** @type {Uint8ClampedArray} */ data, /** @type {NonNullable<ReturnType<typeof placementCrop>>} */ crop, extra = {}) => {
    const lines = new Set(traceCrop(data, crop, { ...HATCH, ...extra, hatch: false }).map(strokeKey));
    const all = traceCrop(data, crop, { ...HATCH, ...extra });
    return { all, lines, hatch: all.filter(l => !lines.has(strokeKey(l))).map(l => l.pts.map(p => toSource(crop, p))) };
  };
  const segments = (/** @type {number[][][]} */ paths) => paths.flatMap(p => p.slice(1).map((q, i) => [p[i], q]));

  it('hatches darker bands of a photo more densely and leaves the light band bare', () => {
    const bands = [235, 150, 95, 40];
    const { crop, data } = photo(400, x => bands[Math.min(3, Math.floor(x / 100))]);
    const ink = [0, 0, 0, 0];
    for (const [a, b] of segments(hatchOnly(data, crop).hatch)) {
      const x = (a[0] + b[0]) / 2, band = Math.floor(x / 100);
      if (Math.abs(x - (band + 0.5) * 100) < 40) ink[band] += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    assert.ok(ink[0] < 0.05 * ink[3], `ink per band ${ink.map(Math.round)}`);
    assert.ok(ink[1] > 0 && ink[1] < ink[2] && ink[2] < ink[3], `ink per band ${ink.map(Math.round)}`);
  });

  it('keeps the hatching of a dark shape in drawn art inside its outline, in the colour of the shape', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    const disc = (/** @type {number} */ x, /** @type {number} */ y) => Math.hypot(x - 200, y - 200) < 120;
    const data = paint(crop, (x, y) => disc(x, y) ? [20, 20, 20] : PAPER);
    const { all, hatch } = hatchOnly(data, crop);
    assert.ok(hatch.length >= 10, `${hatch.length} hatch strokes`);
    for (const pts of hatch) for (const [x, y] of pts) assert.ok(Math.hypot(x - 200, y - 200) < 119, `${x} ${y} is off the shape`);
    assert.ok(all.every(l => l.color === 'black'), JSON.stringify([...new Set(all.map(l => l.color))]));
  });

  it('leaves light shapes in drawn art unhatched', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    const data = paint(crop, (x, y) => Math.hypot(x - 200, y - 200) < 120 ? [235, 225, 150] : PAPER);
    assert.equal(hatchOnly(data, crop).hatch.length, 0);
  });

  it('keeps every line and stays within the budget', () => {
    const { crop, data } = photo(600, (x, y) => 40 + 30 * Math.sin(x / 9) * Math.sin(y / 13));
    const maxStrokes = 300, { all, lines, hatch } = hatchOnly(data, crop, { maxStrokes });
    const kept = new Set(all.map(strokeKey));
    assert.ok([...lines].every(l => kept.has(l)), 'a line went missing');
    assert.ok(hatch.length > 0 && hatch.length <= 0.4 * maxStrokes, `${hatch.length} hatch strokes`);
    assert.ok(all.length <= LIMITS.strokes && all.reduce((n, l) => n + l.pts.length, 0) <= LIMITS.points);
  });

  it('follows the run of an oriented texture', () => {
    const angle = 20 * Math.PI / 180, [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const { crop, data } = photo(400, (x, y) => 70 + 40 * Math.sin((-x * dy + y * dx) / 2.5), 30);
    let error = 0, total = 0;
    for (const [a, b] of segments(hatchOnly(data, crop).hatch)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), cos = Math.abs((b[0] - a[0]) * dx + (b[1] - a[1]) * dy) / (len || 1);
      error += Math.acos(Math.min(1, cos)) * len;
      total += len;
    }
    assert.ok(total > 1000, `${Math.round(total)} hatched`);
    assert.ok(error / total < 15 * Math.PI / 180, `mean error ${Math.round(error / total * 180 / Math.PI)} degrees`);
  });

  it('draws nothing on a white image', () => {
    const crop = placementCrop(400, 400);
    assert.ok(crop);
    assert.equal(traceCrop(paint(crop, () => [255, 255, 255]), crop, HATCH).length, 0);
  });
});

describe('clipToCanvas', () => {
  it('splits a line that leaves and re-enters the canvas at the crossings', () => {
    const pieces = clipToCanvas([[100, 100], [-100, 100], [-100, 200], [100, 200]]);
    assert.deepEqual(pieces, [[[100, 100], [0, 100]], [[0, 200], [100, 200]]]);
  });
});
