import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { W, H } from '../extension/editor/sdj.js';
import {
  DEFAULTS, GRID_SPACINGS, sanitize, snapAngle, squareCorner, constrainShape, snapToGrid, follow, penMove, penEnd, ropeRadius, minStepFor, guideLines,
} from '../extension/editor/precision.js';

const deg = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const near = (actual, expected, eps = 0.02) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not within ${eps} of ${expected}`);
const newPen = (start = [100, 100]) => ({ points: [[...start, 0]], brush: start, anchor: null });
const spread = ys => Math.max(...ys) - Math.min(...ys);

describe('snapAngle', () => {
  it('rounds the angle to 15 degrees and keeps the length', () => {
    const a = [300, 300];
    for (const [target, raw] of [[0, 4], [15, 20], [45, 40], [90, 86], [-45, -50], [180, 178], [-165, -170]]) {
      const len = 120, r = raw * Math.PI / 180;
      const b = snapAngle(a, [a[0] + len * Math.cos(r), a[1] + len * Math.sin(r)]);
      near(Math.hypot(b[0] - a[0], b[1] - a[1]), len);
      near((deg(a, b) - target + 540) % 360 - 180, 0, 0.1);
    }
  });

  it('keeps a degenerate line as it is', () => {
    assert.deepEqual(snapAngle([5, 5], [5, 5]), [5, 5]);
  });

  it('shortens the line instead of leaving the canvas', () => {
    const b = snapAngle([700, 100], [790, 130]);
    assert.ok(b[0] <= W && b[0] >= 0 && b[1] >= 0 && b[1] <= H);
    near(deg([700, 100], b), 15, 0.1);
  });
});

describe('squareCorner', () => {
  it('makes the box square along the longer side, in the drag direction', () => {
    assert.deepEqual(squareCorner([100, 100], [250, 160]), [250, 250]);
    assert.deepEqual(squareCorner([100, 100], [130, 20]), [180, 20]);
    assert.deepEqual(squareCorner([300, 300], [200, 280]), [200, 200]);
  });

  it('stays inside the canvas', () => {
    const [x, y] = squareCorner([650, 900], [800, 950]);
    assert.ok(x <= W && y <= H);
    near(x - 650, y - 900);
  });
});

describe('constrainShape', () => {
  it('does nothing without Shift', () => {
    assert.deepEqual(constrainShape('line', [0, 0], [100, 7], false), [100, 7]);
    assert.deepEqual(constrainShape('ellipse', [0, 0], [100, 7], false), [100, 7]);
  });

  it('applies the angle snap to lines and the square to ellipses', () => {
    near(constrainShape('line', [0, 0], [100, 7], true)[1], 0);
    assert.deepEqual(constrainShape('ellipse', [0, 0], [100, 7], true), [100, 100]);
    assert.deepEqual(constrainShape('eraser', [0, 0], [100, 7], true), [100, 7]);
  });
});

describe('snapToGrid', () => {
  it('lands on the nearest crossing', () => {
    assert.deepEqual(snapToGrid([37, 61], 48), [48, 48]);
    assert.deepEqual(snapToGrid([23, 25], 48), [0, 48]);
    assert.deepEqual(snapToGrid([100, 700], 24), [96, 696]);
  });

  it('stays inside the canvas', () => {
    assert.deepEqual(snapToGrid([719, 959], 120), [720, 960]);
    assert.deepEqual(snapToGrid([-5, 2000], 48), [0, 960]);
  });

  it('every spacing divides the page evenly', () => {
    for (const s of GRID_SPACINGS) assert.ok(W % s === 0 && H % s === 0, String(s));
  });
});

describe('follow', () => {
  it('does not move the brush while the pointer is within the rope', () => {
    assert.deepEqual(follow([10, 10], [14, 13], 5), [10, 10]);
  });

  it('pulls the brush to exactly the rope length from the pointer', () => {
    const b = follow([0, 0], [30, 40], 10);
    near(Math.hypot(30 - b[0], 40 - b[1]), 10, 1e-9);
    near(b[0], 24);
    near(b[1], 32);
  });
});

describe('pen smoothing', () => {
  const zigzag = n => Array.from({ length: n }, (_, i) => [100 + i, 100 + (i % 2 ? 3 : -3), i * 4]);

  /** @param {number} radius */
  function run(radius, minStep = 0) {
    const input = zigzag(400);
    const pen = newPen(input[0].slice(0, 2));
    for (const [x, y, t] of input.slice(1)) penMove(pen, [x, y], t, { radius, minStep });
    const [x, y, t] = input[input.length - 1];
    penEnd(pen, [x, y], t);
    return { pen, last: [x, y, t] };
  }

  it('is a pass-through at radius 0 and keeps the raw samples and their times', () => {
    const { pen } = run(0);
    assert.equal(pen.points.length, 400);
    assert.deepEqual(pen.points[5], [105, 103, 20]);
  });

  it('damps a zig-zag to a fraction of the raw jitter', () => {
    const raw = spread(run(0).pen.points.slice(10, -1).map(p => p[1]));
    const smooth = spread(run(20, 4).pen.points.slice(10, -1).map(p => p[1]));
    assert.ok(smooth < raw / 3, `${smooth} vs ${raw}`);
  });

  it('ends exactly where the pointer lifted, with the real time', () => {
    const { pen, last } = run(30);
    assert.deepEqual(pen.points[pen.points.length - 1], last);
  });

  it('keeps the timestamps non-decreasing', () => {
    const { pen } = run(30, 1.5);
    for (let i = 1; i < pen.points.length; i++) assert.ok(pen.points[i][2] >= pen.points[i - 1][2]);
  });

  it('keeps fewer points when smoothing and thinning are on', () => {
    assert.ok(run(20, 4).pen.points.length < run(0).pen.points.length / 3);
  });

  it('caps the catch-up time so a pause before lifting is not replayed as slow drawing', () => {
    const pen = newPen([0, 0]);
    penMove(pen, [50, 0], 100);
    penEnd(pen, [60, 0], 5000);
    assert.ok(pen.points[pen.points.length - 1][2] <= 200);
  });

  it('does nothing at the end when the stroke already ends at the pointer', () => {
    const pen = newPen([0, 0]);
    penEnd(pen, [0, 0], 30);
    assert.equal(pen.points.length, 1);
  });
});

describe('pen with Shift', () => {
  it('draws a straight line from where the stroke was when Shift went down', () => {
    const pen = newPen([10, 10]);
    penMove(pen, [20, 15], 10);
    penMove(pen, [30, 40], 20, { shift: true });
    penMove(pen, [60, 20], 30, { shift: true });
    penMove(pen, [90, 25], 40, { shift: true });
    assert.deepEqual(pen.points, [[10, 10, 0], [20, 15, 10], [90, 25, 40]]);
  });

  it('continues freehand from the end of the line when Shift is released', () => {
    const pen = newPen([0, 0]);
    penMove(pen, [100, 0], 10, { shift: true });
    penMove(pen, [100, 30], 20, { radius: 10 });
    const last = pen.points[pen.points.length - 1];
    assert.deepEqual(pen.points.slice(0, 2), [[0, 0, 0], [100, 0, 10]]);
    near(Math.hypot(last[0] - 100, last[1] - 30), 10, 0.02);
  });

  it('is not slowed by the stabiliser', () => {
    const pen = newPen([0, 0]);
    penMove(pen, [200, 0], 10, { shift: true, radius: 50, minStep: 5 });
    assert.deepEqual(pen.points[1], [200, 0, 10]);
  });
});

describe('radius scale', () => {
  it('is zero when off and fixed in screen pixels', () => {
    assert.equal(ropeRadius(0, 1), 0);
    near(ropeRadius(100, 2) * 2, ropeRadius(100, 1));
    assert.equal(minStepFor(0, 1), 0);
    assert.ok(minStepFor(10, 1) > 0);
  });
});

describe('guideLines', () => {
  it('draws the interior grid lines only', () => {
    const { grid } = guideLines(240);
    assert.equal((grid.match(/V/g) || []).length, 2);
    assert.equal((grid.match(/H/g) || []).length, 3);
  });

  it('puts the centre and thirds lines at the page proportions', () => {
    const g = guideLines(48);
    assert.equal(g.centre, `M360 0V${H}M0 480H${W}`);
    assert.equal(g.thirds, `M240 0V${H}M480 0V${H}M0 320H${W}M0 640H${W}`);
  });
});

describe('sanitize', () => {
  it('falls back to defaults for missing or broken settings', () => {
    assert.deepEqual(sanitize(null), DEFAULTS);
    assert.deepEqual(sanitize('x'), DEFAULTS);
    assert.deepEqual(sanitize({ spacing: 50, smoothing: 'a', grid: 1, compatible: 'yes' }), DEFAULTS);
  });

  it('keeps valid values and clamps smoothing', () => {
    assert.deepEqual(sanitize({ grid: true, snap: true, spacing: 24, smoothing: 0, compatible: true }), { grid: true, snap: true, spacing: 24, smoothing: 0, compatible: true });
    assert.equal(sanitize({ smoothing: 400 }).smoothing, 100);
    assert.equal(sanitize({ smoothing: -4 }).smoothing, 0);
  });
});
