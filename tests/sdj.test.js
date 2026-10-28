import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, W, H, buildSdj, validate, timed, pathD, nearestBase, hexToRgb, simplifyStrokes } from '../extension/editor/sdj.js';

const stroke = (overrides = {}) => ({ color: 'black', weight: 3, startOffset: 0, points: [[0, 0, 0], [10, 10, 50]], ...overrides });
const sdjOf = (strokes, palette = {}) => buildSdj(strokes, palette);
const pointsOf = n => Array.from({ length: n }, (_, i) => [i % W, i % H, i]);

describe('buildSdj', () => {
  it('widens a single-point stroke the way the app does', () => {
    const { strokes } = sdjOf([stroke({ points: [[10, 20, 7]] })]);
    assert.deepEqual(strokes[0].points, [[10, 20, 7], [10.01, 20, 7]]);
  });

  it('leaves strokes with two or more points untouched', () => {
    const points = [[1, 2, 0], [3, 4, 10], [5, 6, 20]];
    assert.deepEqual(sdjOf([stroke({ points })]).strokes[0].points, points);
  });

  it('puts only the used colours into the palette', () => {
    const palette = { c123456: { light: '#123456', dark: '#abcdef' }, c000001: { light: '#000001', dark: '#000002' } };
    const sdj = sdjOf([stroke({ color: 'red' }), stroke({ color: 'c123456' }), stroke({ color: 'red' })], palette);
    assert.deepEqual(Object.keys(sdj.palette).sort(), ['c123456', 'red']);
    assert.deepEqual(sdj.palette.red, { light: '#e53935', dark: '#e53935' });
    assert.deepEqual(sdj.palette.c123456, palette.c123456);
  });

  it('gives black a light dark-mode variant and canvas its own pair', () => {
    const { palette } = sdjOf([stroke({ color: 'black' }), stroke({ color: 'canvas' })]);
    assert.deepEqual(palette.black, { light: '#222222', dark: '#F5F5F5' });
    assert.deepEqual(palette.canvas, { light: '#ffffff', dark: '#2a2f39' });
  });

  it('rounds startOffset to whole milliseconds', () => {
    const { strokes } = sdjOf([stroke({ startOffset: 12.4 }), stroke({ startOffset: 12.6 }), stroke({ startOffset: 0.5 })]);
    assert.deepEqual(strokes.map(s => s.startOffset), [12, 13, 1]);
  });

  it('declares version 1 and the 720x960 canvas', () => {
    const sdj = sdjOf([stroke()]);
    assert.equal(sdj.version, 1);
    assert.deepEqual(sdj.canvas, { width: 720, height: 960 });
  });
});

describe('validate', () => {
  it('accepts a normal drawing', () => {
    assert.equal(validate(sdjOf([stroke(), stroke({ color: 'red', weight: 6 })])), null);
  });

  it('rejects an empty drawing', () => {
    assert.equal(validate(sdjOf([])), 'nothing drawn');
  });

  it('limits the stroke count', () => {
    const strokeWith = n => Array.from({ length: n }, () => stroke({ points: [[0, 0, 0]] }));
    assert.equal(validate(sdjOf(strokeWith(LIMITS.strokes))), null);
    assert.match(validate(sdjOf(strokeWith(LIMITS.strokes + 1))), /^too many strokes/);
  });

  it('limits the palette size', () => {
    const colours = n => Array.from({ length: n }, (_, i) => stroke({ color: 'c' + String(i).padStart(6, '0') }));
    assert.equal(validate(sdjOf(colours(LIMITS.palette))), null);
    assert.match(validate(sdjOf(colours(LIMITS.palette + 1))), /^too many colours/);
  });

  it('limits the total point count', () => {
    const full = LIMITS.pointsPerStroke;
    const fullStrokes = Math.floor(LIMITS.points / full);
    const rest = LIMITS.points - fullStrokes * full;
    const build = extra => [
      ...Array.from({ length: fullStrokes }, () => stroke({ points: pointsOf(full) })),
      stroke({ points: pointsOf(rest + extra) }),
    ];
    assert.equal(validate(sdjOf(build(0))), null);
    assert.match(validate(sdjOf(build(1))), /^too many points/);
  });

  it('limits the points in one stroke', () => {
    assert.equal(validate(sdjOf([stroke({ points: pointsOf(LIMITS.pointsPerStroke) })])), null);
    assert.equal(validate(sdjOf([stroke({ points: pointsOf(LIMITS.pointsPerStroke + 1) })])), 'a stroke has too many points');
  });

  it('limits the minimum stroke weight', () => {
    assert.equal(validate(sdjOf([stroke({ weight: LIMITS.minWeight })])), null);
    assert.match(validate(sdjOf([stroke({ weight: LIMITS.minWeight - 0.1 })])), /out of range/);
  });

  it('limits the maximum stroke weight', () => {
    assert.equal(validate(sdjOf([stroke({ weight: LIMITS.maxWeight })])), null);
    assert.match(validate(sdjOf([stroke({ weight: LIMITS.maxWeight + 0.1 })])), /out of range/);
  });

  it('rejects a weight that is not a number', () => {
    assert.match(validate(sdjOf([stroke({ weight: NaN })])), /out of range/);
  });
});

describe('timed', () => {
  const line = (pts, color = 'red', weight = 3) => ({ color, weight, pts });

  it('clamps points to the canvas', () => {
    const [s] = timed([line([[-50, -50], [2000, 500], [300, 5000]])], 0);
    assert.deepEqual(s.points.map(p => [p[0], p[1]]), [[0, 0], [W, 500], [300, H]]);
  });

  it('starts the first stroke at startAt and the first point at 0 ms', () => {
    const [s] = timed([line([[0, 0], [100, 0]])], 1234.6);
    assert.equal(s.startOffset, 1235);
    assert.equal(s.points[0][2], 0);
  });

  it('never lets timestamps go backwards', () => {
    const pts = Array.from({ length: 500 }, (_, i) => [(i * 37) % W, (i * 91) % H]);
    const [s] = timed([line(pts)], 0);
    const ts = s.points.map(p => p[2]);
    assert.ok(ts.length > 100);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1], `timestamp ${i} went backwards`);
  });

  it('keeps stroke offsets increasing and after the previous stroke ends', () => {
    const out = timed([line([[0, 0], [200, 0]]), line([[0, 10], [200, 10]]), line([[0, 20], [200, 20]])], 0);
    assert.equal(out.length, 3);
    for (let i = 1; i < out.length; i++) {
      const prevEnd = out[i - 1].startOffset + out[i - 1].points.at(-1)[2];
      assert.ok(out[i].startOffset > prevEnd, `stroke ${i} starts before stroke ${i - 1} ends`);
    }
  });

  it('caps a stroke at LIMITS.pointsPerStroke points', () => {
    const pts = Array.from({ length: LIMITS.pointsPerStroke + 500 }, (_, i) => [i % 2 ? 700 : 10, 100]);
    const [s] = timed([line(pts)], 0);
    assert.equal(s.points.length, LIMITS.pointsPerStroke);
  });

  it('skips points closer than minStep to the last kept point', () => {
    const [s] = timed([line([[0, 0], [0.5, 0], [1, 0], [1.2, 0], [3, 0]])], 0);
    assert.deepEqual(s.points.map(p => p[0]), [0, 1, 3]);
  });

  it('honours a custom minStep', () => {
    const [s] = timed([line([[0, 0], [3, 0], [4, 0], [7, 0]])], 0, { minStep: 5 });
    assert.deepEqual(s.points.map(p => p[0]), [0, 7]);
  });

  it('keeps a polyline made of one point as a one-point stroke', () => {
    const [s] = timed([line([[5, 5], [5, 5], [5.2, 5]])], 0);
    assert.equal(s.points.length, 1);
  });

  it('drops empty polylines and carries colour and weight over', () => {
    const out = timed([line([]), line([[0, 0], [50, 50]], 'blue', 6)], 0);
    assert.equal(out.length, 1);
    assert.equal(out[0].color, 'blue');
    assert.equal(out[0].weight, 6);
  });

  it('produces strokes that pass validate', () => {
    const pts = Array.from({ length: 300 }, (_, i) => [(i * 13) % W, (i * 7) % H]);
    assert.equal(validate(buildSdj(timed([line(pts)], 0), {})), null);
  });
});

describe('simplifyStrokes', () => {
  it('drops points on a straight run and keeps the times of the rest', () => {
    const points = [[0, 0, 0], [10, 0.1, 10], [20, 0, 20], [30, 0.05, 30], [30, 20, 50]];
    assert.deepEqual(simplifyStrokes([stroke({ points })])[0].points, [[0, 0, 0], [30, 0.05, 30], [30, 20, 50]]);
  });

  it('keeps a corner and both ends', () => {
    const points = [[0, 0, 0], [50, 0, 50], [50, 50, 100]];
    assert.deepEqual(simplifyStrokes([stroke({ points })])[0].points, points);
  });

  it('does not collapse a stroke that ends where it began', () => {
    const points = [[0, 0, 0], [40, 0, 40], [40, 40, 80], [0, 40, 120], [0, 0, 160]];
    assert.deepEqual(simplifyStrokes([stroke({ points })])[0].points, points);
  });

  it('handles the longest allowed stroke', () => {
    const points = Array.from({ length: LIMITS.pointsPerStroke }, (_, i) => [i % W, 100 + (i % 2) * 0.01, i]);
    const out = simplifyStrokes([stroke({ points })])[0].points;
    assert.deepEqual([out[0], out[out.length - 1]], [points[0], points[points.length - 1]]);
  });

  it('leaves the other stroke fields alone', () => {
    const s = stroke({ color: 'red', weight: 6, startOffset: 120 });
    assert.deepEqual(simplifyStrokes([s])[0], s);
  });
});

describe('pathD', () => {
  it('draws a single point as a tiny line', () => {
    assert.equal(pathD([[5, 5]]), 'M 5 5 L 5.01 5');
  });

  it('draws two points as a straight line', () => {
    assert.equal(pathD([[0, 0], [10, 10]]), 'M 0 0 L 10 10');
  });

  it('smooths inner points with quadratic curves through midpoints', () => {
    assert.equal(pathD([[0, 0], [10, 10], [20, 10]]), 'M 0 0 Q 10 10 15 10 L 20 10');
    assert.equal(pathD([[0, 0], [10, 0], [10, 10], [20, 10]]), 'M 0 0 Q 10 0 10 5 Q 10 10 15 10 L 20 10');
  });
});

describe('nearestBase', () => {
  it('maps every base colour to itself', () => {
    const base = {
      black: '#222222', grey: '#9e9e9e', red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047',
      blue: '#1e88e5', purple: '#8e24aa', lightBrown: '#dbc09b', chocolate: '#6d4c41', tiffanyBlue: '#0abab5', pink: '#f06292',
    };
    for (const [name, hex] of Object.entries(base)) assert.equal(nearestBase(hexToRgb(hex)), name, name);
  });

  it('picks the closest colour for an off-palette value', () => {
    assert.equal(nearestBase([230, 60, 60]), 'red');
    assert.equal(nearestBase([10, 10, 10]), 'black');
    assert.equal(nearestBase([30, 130, 230]), 'blue');
  });

  it('only returns canvas when allowed', () => {
    assert.notEqual(nearestBase([255, 255, 255]), 'canvas');
    assert.equal(nearestBase([255, 255, 255], { allowCanvas: true }), 'canvas');
    assert.equal(nearestBase(hexToRgb('#2a2f39'), { allowCanvas: true }), 'canvas');
  });

  it('treats the light dark-mode black as black even when canvas is allowed', () => {
    assert.equal(nearestBase(hexToRgb('#F5F5F5'), { allowCanvas: true }), 'black');
  });
});
