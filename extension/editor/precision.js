import { W, H, LIMITS, r2 } from './sdj.js';

const NS = 'http://www.w3.org/2000/svg';
const SETTINGS_KEY = 'doodler:precision';
export const GRID_SPACINGS = [24, 48, 120];
export const DEFAULTS = { grid: false, snap: false, smoothing: 20, spacing: 48 };
export const ANGLE_STEP = Math.PI / 12;
const ROPE_PX_AT_MAX = 64;
const MIN_STEP_PX = [1.5, 6];
const CATCH_UP_MS = 80;

/** @typedef {typeof DEFAULTS} Settings */
/** @typedef {[number, number]} Vec */
/** @typedef {{ points: import('./sdj.js').Point[], brush: Vec, anchor: number | null }} Pen */
/** @param {Vec | import('./sdj.js').Point} a @param {Vec | import('./sdj.js').Point} b */
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** @param {unknown} raw @returns {Settings} */
export function sanitize(raw) {
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const smoothing = typeof o.smoothing === 'number' ? o.smoothing : NaN;
  return {
    grid: o.grid === true,
    snap: o.snap === true,
    smoothing: Number.isFinite(smoothing) ?Math.min(100, Math.max(0, Math.round(smoothing))) : DEFAULTS.smoothing,
    spacing: GRID_SPACINGS.includes(/** @type {number} */ (o.spacing)) ? /** @type {number} */ (o.spacing) : DEFAULTS.spacing,
  };
}

export function loadSettings() {
  try { return sanitize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')); }
  catch { return sanitize(null); }
}

/** @param {Settings} s */
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: settings stay in memory */ }
}

/** Keeps the b end of the ray a->b inside the canvas by shortening it @param {Vec} a @param {Vec} end @returns {Vec} */
function insideCanvas(a, end) {
  let k = 1;
  for (const [i, max] of /** @type {const} */ ([[0, W], [1, H]])) {
    const d = end[i] - a[i];
    if (d > 0 && a[i] + d > max) k = Math.min(k, (max - a[i]) / d);
    if (d < 0 && a[i] + d < 0) k = Math.min(k, -a[i] / d);
  }
  return [r2(a[0] + (end[0] - a[0]) * k), r2(a[1] + (end[1] - a[1]) * k)];
}

/** Same length, angle rounded to the nearest step @param {Vec} a @param {Vec} b @returns {Vec} */
export function snapAngle(a, b, step = ANGLE_STEP) {
  const len = dist(a, b);
  if (!len) return b;
  const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / step) * step;
  return insideCanvas(a, [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]);
}

/** The corner opposite a that makes a square box, in the drag direction, as large as the canvas allows @param {Vec} a @param {Vec} b @returns {Vec} */
export function squareCorner(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const room = Math.min(sx > 0 ? W - a[0] : a[0], sy > 0 ? H - a[1] : a[1]);
  const size = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), room);
  return [r2(a[0] + sx * size), r2(a[1] + sy * size)];
}

/** @param {string} tool @param {Vec} a @param {Vec} b @param {boolean} shift @returns {Vec} */
export function constrainShape(tool, a, b, shift) {
  if (!shift) return b;
  if (tool === 'line') return snapAngle(a, b);
  if (tool === 'ellipse') return squareCorner(a, b);
  return b;
}

/** @param {Vec} p @param {number} spacing @returns {Vec} */
export function snapToGrid([x, y], spacing) {
  const snap = (/** @type {number} */ v, /** @type {number} */ max) => r2(Math.min(max, Math.max(0, Math.round(v / spacing) * spacing)));
  return [snap(x, W), snap(y, H)];
}

/** Smoothing 0-100 to the rope length in canvas units; the length is fixed in screen pixels so zooming in gives finer control */
export const ropeRadius = (/** @type {number} */ smoothing, /** @type {number} */ pxPerUnit) => smoothing / 100 * ROPE_PX_AT_MAX / pxPerUnit;

export const minStepFor = (/** @type {number} */ smoothing, /** @type {number} */ pxPerUnit) =>
  smoothing > 0 ? (MIN_STEP_PX[0] + (MIN_STEP_PX[1] - MIN_STEP_PX[0]) * smoothing / 100) / pxPerUnit : 0;

/** Lazy brush: the brush stays put until the pointer is farther than radius away, then trails behind it on a rope of that length @param {Vec} brush @param {Vec} target @returns {Vec} */
export function follow(brush, target, radius) {
  const d = dist(brush, target);
  if (d <= radius) return brush;
  const k = radius / d;
  return [target[0] + (brush[0] - target[0]) * k, target[1] + (brush[1] - target[1]) * k];
}

/**
 * Adds a pointer sample to a pen stroke. Shift draws a straight line from where it was pressed; otherwise the lazy brush
 * moves and a point is kept once it is minStep away from the previous one. Timestamps are the samples' real ms.
 * @param {Pen} pen @param {Vec} raw @param {number} t
 */
export function penMove(pen, raw, t, { radius = 0, minStep = 0, shift = false } = {}) {
  const { points } = pen;
  if (shift) {
    pen.anchor ??= points.length - 1;
    points.length = pen.anchor + 1;
    pen.brush = raw;
    if (dist(points[pen.anchor], raw) > 0 && points.length < LIMITS.pointsPerStroke) points.push([...raw, t]);
    return;
  }
  if (pen.anchor !== null) {
    pen.anchor = null;
    const last = points[points.length - 1];
    pen.brush = [last[0], last[1]];
  }
  pen.brush = radius > 0 ? follow(pen.brush, raw, radius) : raw;
  const last = points[points.length - 1];
  if (dist(last, pen.brush) <= minStep || points.length >= LIMITS.pointsPerStroke) return;
  points.push([r2(pen.brush[0]), r2(pen.brush[1]), t]);
}

/** The brush trails the pointer, so the lift position is appended: the stroke ends where the pointer did @param {Pen} pen @param {Vec} raw @param {number} t */
export function penEnd(pen, raw, t) {
  const last = pen.points[pen.points.length - 1];
  if (dist(last, raw) === 0 || pen.points.length >= LIMITS.pointsPerStroke) return;
  pen.points.push([...raw, Math.max(last[2], Math.min(t, last[2] + CATCH_UP_MS))]);
}

/** @param {number} spacing @returns {{ grid: string, thirds: string, centre: string }} */
export function guideLines(spacing) {
  /** @param {number[]} xs @param {number[]} ys */
  const d = (xs, ys) => [...xs.map(x => `M${x} 0V${H}`), ...ys.map(y => `M0 ${y}H${W}`)].join('');
  const ticks = (/** @type {number} */ max) => Array.from({ length: Math.ceil(max / spacing) - 1 }, (_, i) => (i + 1) * spacing);
  return {
    grid: d(ticks(W), ticks(H)),
    thirds: d([W / 3, 2 * W / 3].map(r2), [H / 3, 2 * H / 3].map(r2)),
    centre: d([W / 2], [H / 2]),
  };
}

/** @param {SVGGElement} g @param {number} spacing 0 hides the guides */
export function renderGuides(g, spacing) {
  const lines = spacing ? guideLines(spacing) : {};
  g.replaceChildren(...Object.entries(lines).map(([cls, d]) => {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('class', cls);
    el.setAttribute('d', d);
    return el;
  }));
}
