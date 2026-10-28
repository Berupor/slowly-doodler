import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, W, H, buildSdj, validate, timed, pathD, nearestBase, hexToRgb, simplifyStrokes, cutStrokes } from '../extension/editor/sdj.js';

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

describe('cutStrokes', () => {
  const across = (overrides = {}) => stroke({ weight: 1, startOffset: 500, points: [[0, 0, 0], [100, 0, 1000]], ...overrides });
  const absTime = (s, i) => s.startOffset + s.points[i][2];

  it('cuts a long segment in two exactly where the eraser reaches, not only at existing points', () => {
    const { strokes, blocked } = cutStrokes([across()], [50, 0], [50, 0], 10);
    assert.equal(blocked, false);
    assert.equal(strokes.length, 2);
    assert.deepEqual(strokes[0].points, [[0, 0, 0], [39, 0, 390]]);
    assert.deepEqual(strokes[1].points, [[61, 0, 0], [100, 0, 390]]);
  });

  it('keeps the replay timeline: every surviving point is drawn at its original time, ms re-based to 0 per piece', () => {
    const { strokes } = cutStrokes([across()], [50, 0], [50, 0], 10);
    assert.equal(strokes[0].startOffset, 500);
    assert.equal(strokes[1].startOffset, 500 + 610);
    for (const s of strokes) {
      assert.equal(s.points[0][2], 0);
      s.points.forEach(([x], i) => assert.equal(absTime(s, i), 500 + x * 10));
    }
  });

  it('gives one piece when the cut reaches the start or the end', () => {
    const atEnd = cutStrokes([across()], [100, 0], [100, 0], 10).strokes;
    assert.equal(atEnd.length, 1);
    assert.deepEqual(atEnd[0].points, [[0, 0, 0], [89, 0, 890]]);
    const atStart = cutStrokes([across()], [0, 0], [0, 0], 10).strokes;
    assert.equal(atStart.length, 1);
    assert.equal(atStart[0].startOffset, 500 + 110);
    assert.deepEqual(atStart[0].points, [[11, 0, 0], [100, 0, 890]]);
  });

  it('removes a stroke the eraser covers completely', () => {
    assert.deepEqual(cutStrokes([across({ points: [[48, 0, 0], [52, 0, 40]] })], [50, 0], [50, 0], 10).strokes, []);
  });

  it('returns the very same array when the eraser touches nothing', () => {
    const list = [across()];
    assert.equal(cutStrokes(list, [50, 40], [60, 40], 10).strokes, list);
  });

  it('counts half the stroke width, so thick strokes end at the eraser edge', () => {
    const thick = cutStrokes([across({ weight: 6 })], [50, 0], [50, 0], 10).strokes;
    assert.deepEqual(thick[0].points.at(-1), [34, 0, 340]);
    assert.deepEqual(thick[1].points[0], [66, 0, 0]);
  });

  it('cuts along a dragged path, a perpendicular sweep included', () => {
    const swept = cutStrokes([across()], [30, 0], [60, 0], 5).strokes;
    assert.deepEqual([swept[0].points.at(-1)[0], swept[1].points[0][0]], [24, 66]);
    const crossed = cutStrokes([across()], [50, -30], [50, 30], 5).strokes;
    assert.deepEqual([crossed[0].points.at(-1)[0], crossed[1].points[0][0]], [44, 56]);
  });

  it('keeps vertices, colour, weight and timing of a multi-point stroke on either side of the cut', () => {
    const s = stroke({ color: 'red', weight: 1, startOffset: 100, points: [[0, 0, 0], [40, 0, 40], [80, 0, 90], [80, 40, 130], [40, 40, 170]] });
    const out = cutStrokes([s], [80, 20], [80, 20], 6).strokes;
    assert.equal(out.length, 2);
    assert.ok(out.every(p => p.color === 'red' && p.weight === 1));
    assert.equal(out[0].startOffset, 100);
    assert.deepEqual(out[0].points, [[0, 0, 0], [40, 0, 40], [80, 0, 90], [80, 13, 103]]);
    assert.equal(out[1].startOffset, 217);
    assert.deepEqual(out[1].points, [[80, 27, 0], [80, 40, 13], [40, 40, 53]]);
  });

  it('removes a dot inside the eraser and keeps one outside', () => {
    const dot = stroke({ points: [[50, 50, 0]] });
    assert.deepEqual(cutStrokes([dot], [52, 50], [52, 50], 5).strokes, []);
    const list = [dot];
    assert.equal(cutStrokes(list, [90, 50], [90, 50], 5).strokes, list);
  });

  it('does not split past the stroke limit: the stroke stays whole and blocked is set', () => {
    const list = [across()];
    const middle = cutStrokes(list, [50, 0], [50, 0], 10, 1);
    assert.equal(middle.blocked, true);
    assert.equal(middle.strokes, list);
    const end = cutStrokes(list, [100, 0], [100, 0], 10, 1);
    assert.equal(end.blocked, false);
    assert.equal(end.strokes.length, 1);
  });

  it('counts the strokes after the current one against the limit', () => {
    const list = [across(), across({ points: [[0, 50, 0], [100, 50, 1000]] })];
    assert.equal(cutStrokes(list, [50, 0], [50, 0], 10, 2).blocked, true);
    assert.equal(cutStrokes(list, [50, 0], [50, 0], 10, 3).strokes.length, 3);
  });
});
