import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, STROKE_SCALE, W, H, validate, buildSdj } from '../extension/editor/sdj.js';
import {
  pointInPolygon, insideShare, lassoPick, hitStroke, bounds, translate, scaleAbout, rotateAbout, applyMatrix, compose, transformStroke,
  fitShift, duplicateShift, scaleFactors, snapAngle, appendTimeline, pasteError, parseClip,
} from '../extension/editor/select.js';

const stroke = (points, overrides = {}) => ({ color: 'black', weight: 3, startOffset: 0, points, ...overrides });
const line = (x0, y0, x1, y1, overrides = {}) => stroke([[x0, y0, 0], [x1, y1, 100]], overrides);
const SQUARE = [[100, 100], [200, 100], [200, 200], [100, 200]];
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

describe('compose', () => {
  it('applies the right matrix first, so a placement can be replayed on a fresh trace', () => {
    const moves = [scaleAbout(2, 2, 100, 100), translate(30, -10), rotateAbout(0.3, 50, 60)];
    const total = moves.reduce((m, step) => compose(step, m), translate(0, 0));
    const stepwise = moves.reduce((p, m) => applyMatrix(m, p[0], p[1]), [7, 11]);
    const [x, y] = applyMatrix(total, 7, 11);
    near(x, stepwise[0], 1e-9);
    near(y, stepwise[1], 1e-9);
  });
});

describe('pointInPolygon', () => {
  it('tells inside from outside of a square', () => {
    assert.equal(pointInPolygon([150, 150], SQUARE), true);
    assert.equal(pointInPolygon([50, 150], SQUARE), false);
    assert.equal(pointInPolygon([150, 250], SQUARE), false);
  });

  it('handles a concave lasso', () => {
    const c = [[0, 0], [100, 0], [100, 100], [60, 100], [60, 40], [40, 40], [40, 100], [0, 100]];
    assert.equal(pointInPolygon([50, 80], c), false);
    assert.equal(pointInPolygon([20, 80], c), true);
    assert.equal(pointInPolygon([50, 20], c), true);
  });
});

describe('lassoPick', () => {
  it('selects strokes with most of their points inside', () => {
    const mostly = stroke([[110, 110, 0], [120, 120, 1], [130, 130, 2], [300, 300, 3]]);
    const barely = stroke([[110, 110, 0], [300, 300, 1], [310, 310, 2], [320, 320, 3]]);
    assert.deepEqual(lassoPick([mostly, barely], SQUARE), [mostly]);
  });

  it('does not select a stroke with exactly half of its points inside', () => {
    assert.equal(insideShare(stroke([[150, 150, 0], [300, 300, 1]]), SQUARE), 0.5);
    assert.deepEqual(lassoPick([stroke([[150, 150, 0], [300, 300, 1]])], SQUARE), []);
  });

  it('selects a one-point stroke inside and leaves strokes outside alone', () => {
    const dot = stroke([[150, 150, 0]]);
    const far = line(400, 400, 500, 500);
    assert.deepEqual(lassoPick([dot, far], SQUARE), [dot]);
  });

  it('needs at least a triangle', () => {
    assert.deepEqual(lassoPick([stroke([[150, 150, 0]])], [[0, 0], [500, 500]]), []);
  });

  it('samples long strokes without losing the majority', () => {
    const inside = Array.from({ length: 5000 }, (_, i) => [120 + (i % 50), 120 + (i % 50), i]);
    const outside = Array.from({ length: 1000 }, (_, i) => [400, 400, 5000 + i]);
    assert.ok(insideShare(stroke([...inside, ...outside]), SQUARE) > 0.5);
  });
});

describe('hitStroke', () => {
  it('hits a stroke within its half width plus the tolerance and prefers the topmost', () => {
    const under = line(0, 100, 200, 100, { weight: 3 });
    const over = line(100, 0, 100, 200, { weight: 3 });
    assert.equal(hitStroke([under, over], [100, 100], 0), over);
    assert.equal(hitStroke([under, over], [50, 103], 0), under);
    assert.equal(hitStroke([under, over], [50, 104], 0), null);
    assert.equal(hitStroke([under, over], [50, 104], 2), under);
  });

  it('hits a one-point stroke', () => {
    const dot = stroke([[10, 10, 0]]);
    assert.equal(hitStroke([dot], [12, 10], 0), dot);
  });

  it('skips a stroke whose box is out of reach and one the filter rejects, falling through to the one below', () => {
    const far = line(500, 500, 600, 500);
    const under = line(0, 100, 200, 100);
    const over = line(0, 100, 200, 100);
    assert.equal(hitStroke([under, far], [50, 100], 0), under);
    assert.equal(hitStroke([far], [50, 100], 0), null);
    assert.equal(hitStroke([under, over], [50, 100], 0, s => s !== over), under);
    assert.equal(hitStroke([over], [50, 100], 0, () => false), null);
  });

  it('reaches past the end of a stroke by half its width plus the tolerance, and keeps working after the first lookup', () => {
    const thick = line(0, 100, 100, 100, { weight: 10 });
    const reach = STROKE_SCALE * 10 / 2;
    for (let i = 0; i < 2; i++) {
      assert.equal(hitStroke([thick], [100 + reach - 0.01, 100], 0), thick);
      assert.equal(hitStroke([thick], [100 + reach + 0.01, 100], 0), null);
      assert.equal(hitStroke([thick], [100 + reach + 0.01, 100], 1), thick);
      assert.equal(hitStroke([thick], [50, 100 - reach - 0.01], 0), null);
    }
  });

  it('finds a stroke among thousands', () => {
    const many = Array.from({ length: 5000 }, (_, i) => line(i * 10, 0, i * 10 + 5, 0));
    assert.equal(hitStroke(many, [2502, 0], 0), many[250]);
    assert.equal(hitStroke(many, [2507, 40], 0), null);
  });

  it('never hits a stroke without points', () => {
    assert.equal(hitStroke([stroke([])], [0, 0], 100), null);
  });
});

describe('bounds', () => {
  it('spans every point of every stroke', () => {
    assert.deepEqual(bounds([line(10, 50, 30, 20), line(5, 60, 25, 70)]), { x0: 5, y0: 20, x1: 30, y1: 70 });
  });

  it('is null without strokes', () => {
    assert.equal(bounds([]), null);
  });
});

describe('transforms', () => {
  it('translates, scales about an anchor and rotates about a centre', () => {
    assert.deepEqual(applyMatrix(translate(5, -3), 10, 10), [15, 7]);
    assert.deepEqual(applyMatrix(scaleAbout(2, 3, 10, 10), 20, 20), [30, 40]);
    assert.deepEqual(applyMatrix(scaleAbout(2, 3, 10, 10), 10, 10), [10, 10]);
    const [x, y] = applyMatrix(rotateAbout(Math.PI / 2, 100, 100), 150, 100);
    near(x, 100);
    near(y, 150);
  });

  it('flips a point across the axis through the given centre', () => {
    assert.deepEqual(applyMatrix(scaleAbout(-1, 1, 100, 0), 130, 40), [70, 40]);
    assert.deepEqual(applyMatrix(scaleAbout(1, -1, 0, 50), 130, 40), [130, 60]);
  });

  it('keeps colour, weight and the timing of every point', () => {
    const s = stroke([[10, 10, 0], [20, 10, 37], [30, 10, 90]], { startOffset: 1234, color: 'red', weight: 6 });
    const moved = transformStroke(s, translate(5, 5));
    assert.deepEqual(moved.points, [[15, 15, 0], [25, 15, 37], [35, 15, 90]]);
    assert.equal(moved.startOffset, 1234);
    assert.equal(moved.color, 'red');
    assert.equal(moved.weight, 6);
    assert.equal(s.points[0][0], 10);
  });

  it('clamps points to the canvas and rounds to two decimals', () => {
    const moved = transformStroke(line(10, 10, 700, 940), scaleAbout(1.5, 1.5, 0, 0));
    assert.deepEqual(moved.points.map(p => p.slice(0, 2)), [[15, 15], [W, H]]);
    assert.deepEqual(transformStroke(line(0, 0, 1, 1), scaleAbout(1 / 3, 1 / 3, 0, 0)).points[1].slice(0, 2), [0.33, 0.33]);
  });
});

describe('fitShift', () => {
  const box = { x0: 100, y0: 100, x1: 200, y1: 300 };

  it('lets a move through when the box stays on the canvas', () => {
    assert.deepEqual(fitShift(box, 30, -20), [30, -20]);
  });

  it('stops the box at the canvas edges so the shape is not squashed', () => {
    assert.deepEqual(fitShift(box, -500, 5000), [-100, H - 300]);
    assert.deepEqual(fitShift(box, 5000, -500), [W - 200, -100]);
  });
});

describe('duplicateShift', () => {
  it('offsets towards the bottom right', () => {
    assert.deepEqual(duplicateShift({ x0: 0, y0: 0, x1: 100, y1: 100 }, 16), [16, 16]);
  });

  it('offsets the other way on an axis that has no room left', () => {
    assert.deepEqual(duplicateShift({ x0: 600, y0: 0, x1: W, y1: 100 }, 16), [-16, 16]);
    assert.deepEqual(duplicateShift({ x0: 0, y0: 900, x1: 100, y1: H }, 16), [16, -16]);
  });

  it('never moves a box off the canvas', () => {
    const [dx, dy] = duplicateShift({ x0: 0, y0: 0, x1: W, y1: H }, 16);
    assert.ok(dx === 0 && dy === 0);
  });
});

describe('scaleFactors', () => {
  const anchor = [100, 100], grab = [200, 300];

  it('is 1 while the pointer has not moved', () => {
    assert.deepEqual(scaleFactors(anchor, grab, grab, true), [1, 1]);
    assert.deepEqual(scaleFactors(anchor, grab, grab, false), [1, 1]);
  });

  it('keeps the proportions by default', () => {
    const [sx, sy] = scaleFactors(anchor, grab, [300, 300], true);
    assert.equal(sx, sy);
    assert.ok(sx > 1);
  });

  it('scales each axis on its own when free', () => {
    assert.deepEqual(scaleFactors(anchor, grab, [300, 200], false), [2, 0.5]);
  });

  it('flips through the anchor when the pointer crosses it', () => {
    assert.deepEqual(scaleFactors(anchor, grab, [0, 100], false), [-1, 0.02]);
  });

  it('survives a flat selection', () => {
    assert.deepEqual(scaleFactors([100, 100], [200, 100], [300, 150], false), [2, 1]);
  });
});

describe('snapAngle', () => {
  it('snaps to multiples of 15 degrees', () => {
    near(snapAngle(7 * Math.PI / 180), 0);
    near(snapAngle(8 * Math.PI / 180), 15 * Math.PI / 180);
    near(snapAngle(-44 * Math.PI / 180), -45 * Math.PI / 180);
  });
});

describe('appendTimeline', () => {
  const existing = [line(0, 0, 10, 10, { startOffset: 0 }), line(0, 0, 10, 10, { startOffset: 500 })];

  it('starts the clip one gap after the drawing ends', () => {
    const [a] = appendTimeline(existing, [line(1, 1, 2, 2, { startOffset: 40 })], 400);
    assert.equal(a.startOffset, 500 + 100 + 400);
  });

  it('keeps the relative timing of the clip, whatever order it comes in', () => {
    const clip = [line(1, 1, 2, 2, { startOffset: 900 }), line(1, 1, 2, 2, { startOffset: 300 }), line(1, 1, 2, 2, { startOffset: 350 })];
    const out = appendTimeline(existing, clip, 400);
    assert.deepEqual(out.map(s => s.startOffset - out[1].startOffset), [600, 0, 50]);
    assert.equal(Math.min(...out.map(s => s.startOffset)), 1000);
  });

  it('starts at zero in an empty drawing and leaves point timing alone', () => {
    const [a] = appendTimeline([], [stroke([[1, 1, 0], [2, 2, 33]], { startOffset: 777 })], 400);
    assert.equal(a.startOffset, 0);
    assert.deepEqual(a.points, [[1, 1, 0], [2, 2, 33]]);
  });

  it('does not touch the clip it copies', () => {
    const clip = [line(1, 1, 2, 2, { startOffset: 40 })];
    appendTimeline(existing, clip, 400);
    assert.equal(clip[0].startOffset, 40);
  });
});

describe('pasteError', () => {
  const many = n => Array.from({ length: n }, () => line(0, 0, 1, 1));

  it('accepts a paste that fits', () => {
    assert.equal(pasteError(many(10), many(5), {}), null);
  });

  it('refuses more strokes than the limit', () => {
    assert.match(pasteError(many(LIMITS.strokes - 1), many(2), {}) ?? '', /too many strokes/);
  });

  it('refuses more points than the limit', () => {
    const big = stroke(Array.from({ length: LIMITS.pointsPerStroke }, (_, i) => [i % W, 0, i]));
    assert.match(pasteError(Array.from({ length: 12 }, () => big), [big], {}) ?? '', /too many points/);
  });

  it('produces a drawing that validates when it passes', () => {
    const all = [...many(3), ...many(2)];
    assert.equal(validate(buildSdj(all, {})), null);
  });
});

describe('parseClip', () => {
  const sdj = JSON.stringify(buildSdj([line(10, 10, 20, 20, { color: 'red' })], {}));

  it('reads an SDJ document', () => {
    const clip = parseClip(sdj);
    assert.equal(clip?.strokes.length, 1);
    assert.deepEqual(clip?.strokes[0].points, [[10, 10, 0], [20, 20, 100]]);
    assert.deepEqual(Object.keys(clip?.palette ?? {}), ['red']);
  });

  it('reads the JSON tab payload', () => {
    assert.equal(parseClip(JSON.stringify({ target_user: 1, sdj: JSON.parse(sdj), render: true }))?.strokes.length, 1);
  });

  it('ignores ordinary text and malformed drawings', () => {
    assert.equal(parseClip('hello'), null);
    assert.equal(parseClip('{"strokes": []}'), null);
    assert.equal(parseClip('{"strokes": [{"color": "red", "weight": "3", "points": [[1, 2]]}]}'), null);
    assert.equal(parseClip('{"strokes": [{"color": "red", "weight": 3, "points": [[1, "x"]]}]}'), null);
    assert.equal(parseClip('{not json'), null);
  });

  it('clamps points into the canvas and fills in missing times', () => {
    const clip = parseClip('{"strokes": [{"color": "red", "weight": 3, "points": [[-5, 2000], [10, 10]]}]}');
    assert.deepEqual(clip?.strokes[0].points, [[0, H, 0], [10, 10, 0]]);
    assert.equal(clip?.strokes[0].startOffset, 0);
  });
});
