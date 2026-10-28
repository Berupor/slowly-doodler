import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chainRows, floodRegion, hatchRegion } from '../extension/editor/fill.js';

const w = 360, h = 480, C = [180, 240], R_OUT = 52, R_IN = 48;
const CENTER = [C[0] * 2, C[1] * 2];
const INNER_UNITS = R_IN * 2;
const PIXEL = 3;
const room = { strokes: 1000, points: 249998 };
const opts = { style: 'hatch', angle: Math.PI / 4, density: 2, weight: 3 };

const ring = ({ gap = false } = {}) => {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - C[0], y - C[1]);
      if (d >= R_IN && d <= R_OUT && !(gap && x > C[0] && Math.abs(y - C[1]) < 6)) mask[y * w + x] = 1;
    }
  return { mask, w, h };
};
const fromCenter = ([x, y]) => Math.hypot(x - CENTER[0], y - CENTER[1]);
const ok = r => { assert.ok(!('error' in r), 'error' in r ? r.error : ''); return r; };

describe('floodRegion', () => {
  it('fills the inside of a closed outline and nothing else', () => {
    const { region, touchesEdge } = floodRegion(ring(), ...C);
    assert.equal(touchesEdge, false);
    assert.equal(region[C[1] * w + C[0]], 1);
    assert.equal(region[C[1] * w + 5], 0);
    const count = region.reduce((a, v) => a + v, 0);
    assert.ok(Math.abs(count - Math.PI * R_IN ** 2) < 0.03 * Math.PI * R_IN ** 2, `area ${count}`);
  });

  it('reports a region that is open to the page edge, from inside a gap too', () => {
    assert.equal(floodRegion(ring(), 5, 5).touchesEdge, true);
    assert.equal(floodRegion(ring({ gap: true }), ...C).touchesEdge, true);
  });
});

describe('hatchRegion', () => {
  it('keeps every hatch point inside the outline', () => {
    const { lines } = ok(hatchRegion(ring(), CENTER, opts, room));
    assert.ok(lines.length > 10);
    for (const pt of lines.flat()) assert.ok(fromCenter(pt) < INNER_UNITS + PIXEL, `${pt} is ${fromCenter(pt)} from the centre`);
  });

  it('covers the region: the line through the middle spans nearly the whole inside', () => {
    const { lines } = ok(hatchRegion(ring(), CENTER, { ...opts, angle: 0, density: 3 }, room));
    const longest = Math.max(...lines.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])));
    assert.ok(longest > 0.9 * 2 * INNER_UNITS - 12, `longest ${longest}`);
  });

  it('draws parallel lines at the asked angle, one stroke width times density apart', () => {
    const { lines } = ok(hatchRegion(ring(), CENTER, { ...opts, angle: Math.PI / 6, density: 2 }, room));
    const [dx, dy] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    for (const [a, b] of lines) assert.ok(Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) < 1e-6);
    const offsets = lines.map(([a]) => a[1] * dx - a[0] * dy).sort((p, q) => p - q);
    for (let i = 1; i < offsets.length; i++) assert.ok(Math.abs(offsets[i] - offsets[i - 1] - 12) < 1e-6, `gap ${offsets[i] - offsets[i - 1]}`);
  });

  it('cross-hatch adds a second set at a right angle', () => {
    const single = ok(hatchRegion(ring(), CENTER, opts, room)).lines;
    const cross = ok(hatchRegion(ring(), CENTER, { ...opts, style: 'cross' }, room)).lines;
    assert.equal(cross.length, 2 * single.length);
    const along = ([a, b]) => Math.abs((b[0] - a[0]) * Math.SQRT1_2 + (b[1] - a[1]) * Math.SQRT1_2) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.equal(cross.filter(l => along(l) > 0.999).length, single.length);
    assert.equal(cross.filter(l => along(l) < 0.001).length, single.length);
  });

  it('scribble is a few connected zig-zags instead of one stroke per line', () => {
    const hatch = ok(hatchRegion(ring(), CENTER, opts, room)).lines;
    const scribble = ok(hatchRegion(ring(), CENTER, { ...opts, style: 'scribble' }, room)).lines;
    assert.ok(scribble.length < hatch.length / 4, `${scribble.length} vs ${hatch.length}`);
    assert.ok(Math.max(...scribble.map(l => l.length)) > 10);
    for (const pt of scribble.flat()) assert.ok(fromCenter(pt) < INNER_UNITS + PIXEL);
  });

  it('stops the lines short of the outline by the stroke half width that the closed gap does not already cover', () => {
    const thin = ok(hatchRegion(ring(), CENTER, { ...opts, weight: 1 }, room)).lines.flat();
    const thick = ok(hatchRegion(ring(), CENTER, { ...opts, weight: 8, density: 1.2 }, room)).lines.flat();
    assert.ok(Math.max(...thick.map(fromCenter)) < Math.max(...thin.map(fromCenter)) - 2);
  });

  it('moves a click that landed on the outline to the area next to it, and refuses one deep inside a line', () => {
    const edge = [Math.round(C[0] + R_IN + 1) * 2, C[1] * 2];
    assert.ok(!('error' in hatchRegion(ring(), [edge[0] - 6, edge[1]], opts, room)));
    const wall = ring();
    for (let i = 0; i < wall.mask.length; i++) wall.mask[i] = 1;
    assert.match(ok0(hatchRegion(wall, CENTER, opts, room)).error, /not on a line/);
  });

  it('coarsens the spacing until the fill fits the stroke room', () => {
    const roomy = ok(hatchRegion(ring(), CENTER, opts, room));
    const tight = ok(hatchRegion(ring(), CENTER, opts, { strokes: 6, points: 249998 }));
    assert.ok(tight.lines.length <= 6);
    assert.ok(tight.density > roomy.density);
    const fewPoints = ok(hatchRegion(ring(), CENTER, { ...opts, style: 'scribble' }, { strokes: 1000, points: 40 }));
    assert.ok(fewPoints.lines.flat().length <= 40);
  });

  it('reports instead of filling when there is no room at all', () => {
    assert.match(ok0(hatchRegion(ring(), CENTER, opts, { strokes: 0, points: 1000 })).error, /no room/);
  });

  it('flags a region that touches the page edge', () => {
    assert.equal(ok(hatchRegion(ring(), [20, 20], opts, room)).touchesEdge, true);
    assert.equal(ok(hatchRegion(ring(), CENTER, opts, room)).touchesEdge, false);
  });
});

describe('chainRows', () => {
  it('joins runs of neighbouring rows into one zig-zag and starts a new stroke where the run is far away', () => {
    const rows = [
      { y: 0, segs: [{ a: 0, b: 50 }] },
      { y: 10, segs: [{ a: 0, b: 52 }] },
      { y: 20, segs: [{ a: 1, b: 49 }] },
      { y: 30, segs: [{ a: 300, b: 340 }] },
    ];
    const chains = chainRows(rows, 10, 0);
    assert.equal(chains.length, 2);
    assert.deepEqual(chains[0], [[0, 0], [50, 0], [52, 10], [0, 10], [1, 20], [49, 20]]);
    assert.deepEqual(chains[1], [[300, 30], [340, 30]]);
  });
});

/** @param {{ error?: string }} r */
function ok0(r) { assert.ok('error' in r, 'expected an error'); return /** @type {{ error: string }} */ (r); }
