// Mirrors the web.slowly.app drawing editor (main.*.js: wz, Ez, Tz, Wz); keep in sync when their bundle changes

/** @typedef {[x: number, y: number, ms: number]} Point */
/** @typedef {{ light: string, dark: string }} ColorEntry */
/** @typedef {Record<string, ColorEntry>} Palette */
/** @typedef {{ color: string, weight: number, startOffset: number, points: Point[], layer?: string }} Stroke layer is editor-only, buildSdj drops it */
/** @typedef {{ version: number, canvas: { width: number, height: number }, palette: Palette, strokes: Stroke[] }} Sdj */
/** @typedef {{ color: string, weight: number, pts: number[][] }} Polyline */

export const W = 720, H = 960;
export const BASE_COLORS = {
  black: '#222222', grey: '#9e9e9e', red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047',
  blue: '#1e88e5', purple: '#8e24aa', lightBrown: '#dbc09b', chocolate: '#6d4c41', tiffanyBlue: '#0abab5', pink: '#f06292',
};
export const CANVAS_TOKEN = 'canvas';
export const CANVAS_ENTRY = { light: '#ffffff', dark: '#2a2f39' };
export const SIZES = [1, 3, 6];
export const LIMITS = { strokes: 1000, pointsPerStroke: 19999, points: 249998, palette: 32, minWeight: 0.5, maxWeight: 8 };
export const STROKE_SCALE = 2;
export const SEND_SIMPLIFY_EPS = 0.25;

export const r2 = v => Math.round(v * 100) / 100;

/** @returns {ColorEntry | undefined} */
export function baseEntry(token) {
  if (token === CANVAS_TOKEN) return CANVAS_ENTRY;
  const hex = BASE_COLORS[token];
  return hex && { light: hex, dark: token === 'black' ? '#F5F5F5' : hex };
}

export function customToken(hex) { return 'c' + hex.slice(1).toLowerCase(); }

/** @param {string} token @param {Palette} palette @returns {ColorEntry} */
export function entryFor(token, palette) {
  return palette[token] || baseEntry(token) || { light: '#000000', dark: '#ffffff' };
}

export function isStandard(stroke) {
  return (stroke.color in BASE_COLORS || stroke.color === CANVAS_TOKEN) && SIZES.includes(stroke.weight);
}

/** @param {number[][]} points */
export function pathD(points) {
  const p = points.length === 1 ? [points[0], [points[0][0] + 0.01, points[0][1]]] : points;
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++)
    d += ` Q ${p[i][0]} ${p[i][1]} ${(p[i][0] + p[i + 1][0]) / 2} ${(p[i][1] + p[i + 1][1]) / 2}`;
  const l = p[p.length - 1];
  return d + ` L ${l[0]} ${l[1]}`;
}

/** @param {Stroke[]} strokes */
export function endTime(strokes) {
  return strokes.reduce((m, s) => Math.max(m, s.startOffset + (s.points[s.points.length - 1][2] || 0)), 0);
}

/** @param {Stroke[]} strokes @param {Palette} palette @returns {Sdj} */
export function buildSdj(strokes, palette) {
  const used = {};
  for (const s of strokes) used[s.color] = entryFor(s.color, palette);
  return {
    version: 1,
    canvas: { width: W, height: H },
    palette: used,
    strokes: strokes.map(({ color, weight, startOffset, points }) => ({
      color, weight, startOffset: Math.round(startOffset),
      // the app widens a single-point stroke the same way (Sz)
      points: points.length === 1 ? [points[0], [r2(points[0][0] + 0.01), points[0][1], points[0][2]]] : points,
    })),
  };
}

/** @param {Sdj} sdj @returns {string | null} */
export function validate(sdj) {
  const { strokes, palette } = sdj;
  if (!strokes.length) return 'nothing drawn';
  if (strokes.length > LIMITS.strokes) return `too many strokes: ${strokes.length} of ${LIMITS.strokes}`;
  if (Object.keys(palette).length > LIMITS.palette) return `too many colours: ${Object.keys(palette).length} of ${LIMITS.palette}`;
  const total = strokes.reduce((a, s) => a + s.points.length, 0);
  if (total > LIMITS.points) return `too many points: ${total} of ${LIMITS.points}`;
  for (const s of strokes) {
    if (s.points.length > LIMITS.pointsPerStroke) return 'a stroke has too many points';
    if (!(s.weight >= LIMITS.minWeight && s.weight <= LIMITS.maxWeight)) return `weight ${s.weight} is out of range`;
  }
  return null;
}

// Gives generated polylines a hand-drawn timeline: speed wobbles, short pauses between strokes
/** @param {Polyline[]} polylines @param {number} startAt @returns {Stroke[]} */
export function timed(polylines, startAt, { unitsPerMs = 0.6, gapMs = 350, minStep = 1 } = {}) {
  const out = [];
  let offset = startAt;
  for (const pl of polylines) {
    /** @type {Point[]} */
    const points = [];
    /** @type {number[] | null} */
    let last = null;
    let ms = 0;
    for (const [x0, y0] of pl.pts) {
      const x = r2(Math.min(W, Math.max(0, x0))), y = r2(Math.min(H, Math.max(0, y0)));
      if (last) {
        const d = Math.hypot(x - last[0], y - last[1]);
        if (d < minStep) continue;
        ms += d / (unitsPerMs * (0.8 + 0.4 * Math.sin(points.length / 7)));
      }
      points.push([x, y, Math.round(ms)]);
      last = [x, y];
      if (points.length >= LIMITS.pointsPerStroke) break;
    }
    if (!points.length) continue;
    out.push({ color: pl.color, weight: pl.weight, startOffset: Math.round(offset), points });
    offset += ms + gapMs * (0.6 + Math.random() * 0.8);
  }
  return out;
}

/** Ramer-Douglas-Peucker; keeps the original point objects, so a third coordinate (time) survives
 * @template {number[]} P @param {P[]} pts @param {number} eps @returns {P[]} */
export function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const spans = [[0, pts.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [from, to] = span;
    const [ax, ay] = pts[from], [bx, by] = pts[to];
    const len = Math.hypot(bx - ax, by - ay);
    let max = 0, idx = from;
    for (let i = from + 1; i < to; i++) {
      const [x, y] = pts[i];
      const d = len ? Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / len : Math.hypot(x - ax, y - ay);
      if (d > max) { max = d; idx = i; }
    }
    if (max <= eps) continue;
    keep[idx] = 1;
    spans.push([from, idx], [idx, to]);
  }
  return pts.filter((_, i) => keep[i]);
}

/** @param {Stroke[]} strokes @returns {Stroke[]} */
export function simplifyStrokes(strokes, eps = SEND_SIMPLIFY_EPS) {
  return strokes.map(s => ({ ...s, points: rdp(s.points, eps) }));
}

export function nearestWeight(w) {
  return SIZES.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a);
}

export function hexToRgb(hex) {
  const h = parseInt(hex.slice(1), 16);
  return [h >> 16, (h >> 8) & 255, h & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function nearestBase(rgb, { allowCanvas = false } = {}) {
  const entries = Object.entries(BASE_COLORS);
  if (allowCanvas) entries.push([CANVAS_TOKEN, CANVAS_ENTRY.light], [CANVAS_TOKEN, CANVAS_ENTRY.dark], ['black', '#F5F5F5']);
  let best = 'black', bd = Infinity;
  for (const [name, hex] of entries) {
    const c = hexToRgb(hex);
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

const CUT_EPS = 1e-6;
const MIN_PIECE = 0.5;

/** Part [t0, t1] of the segment p-q within r of the segment a-b, or null. The capsule is convex, so the hit is one interval: the hull of the hits with its two end discs and its body. */
function capsuleSpan(p, q, a, b, r) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  /** @type {[number, number][]} */
  const spans = [];
  for (const c of [a, b]) {
    const fx = p[0] - c[0], fy = p[1] - c[1];
    const A = dx * dx + dy * dy, B = fx * dx + fy * dy, C = fx * fx + fy * fy - r * r;
    if (A === 0) { if (C <= 0) spans.push([0, 1]); continue; }
    const disc = B * B - A * C;
    if (disc >= 0) spans.push([(-B - Math.sqrt(disc)) / A, (-B + Math.sqrt(disc)) / A]);
  }
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len > 0) {
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const rx = p[0] - a[0], ry = p[1] - a[1];
    let lo = 0, hi = 1;
    for (const [v, dv, min, max] of [[rx * ux + ry * uy, dx * ux + dy * uy, 0, len], [ry * ux - rx * uy, dy * ux - dx * uy, -r, r]]) {
      if (dv === 0) { if (v < min || v > max) hi = -1; continue; }
      const t0 = (min - v) / dv, t1 = (max - v) / dv;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    if (lo <= hi) spans.push([lo, hi]);
  }
  const hits = spans.filter(([t0, t1]) => t1 >= 0 && t0 <= 1);
  if (!hits.length) return null;
  return [Math.max(0, Math.min(...hits.map(h => h[0]))), Math.min(1, Math.max(...hits.map(h => h[1])))];
}

/** @param {number[]} p @param {number[]} q @param {number} t @returns {Point} */
const lerpPoint = (p, q, t) => [r2(p[0] + (q[0] - p[0]) * t), r2(p[1] + (q[1] - p[1]) * t), Math.round(p[2] + (q[2] - p[2]) * t)];

/** @param {Point[]} c */
const pathLength = c => c.reduce((m, p, i) => m + (i ? Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0), 0);

/** @param {Stroke} s @param {number[]} a @param {number[]} b @param {number} r @returns {Stroke[] | null} null when the eraser path misses the stroke */
function cutOne(s, a, b, r) {
  const R = r + STROKE_SCALE * s.weight / 2, pts = s.points;
  const x0 = Math.min(a[0], b[0]) - R, x1 = Math.max(a[0], b[0]) + R, y0 = Math.min(a[1], b[1]) - R, y1 = Math.max(a[1], b[1]) + R;
  /** @type {Point[][]} */
  const pieces = [];
  /** @type {Point[] | null} */
  let cur = null;
  let touched = false;
  for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)];
    const near = Math.max(p[0], q[0]) >= x0 && Math.min(p[0], q[0]) <= x1 && Math.max(p[1], q[1]) >= y0 && Math.min(p[1], q[1]) <= y1;
    const span = near ? capsuleSpan(p, q, a, b, R) : null;
    if (!span) { (cur ??= [p]).push(q); continue; }
    touched = true;
    if (span[0] > CUT_EPS) (cur ??= [p]).push(lerpPoint(p, q, span[0]));
    if (cur) { pieces.push(cur); cur = null; }
    if (span[1] < 1 - CUT_EPS) cur = [lerpPoint(p, q, span[1]), q];
  }
  if (!touched) return null;
  if (cur) pieces.push(cur);
  return pieces.filter(c => c.length > 1 && pathLength(c) >= MIN_PIECE).map(c => ({
    ...s, startOffset: s.startOffset + c[0][2], points: c.map(([x, y, t]) => [x, y, t - c[0][2]]),
  }));
}

/**
 * Removes the parts of strokes within r of the eraser path a-b (plus half the stroke width, so what is left ends at the eraser edge)
 * and splits the strokes there. Pieces keep their original timing. Returns the same array when nothing was cut;
 * a stroke whose split would exceed maxStrokes stays whole and sets blocked.
 * @param {Stroke[]} strokes @param {number[]} a @param {number[]} b @param {number} r
 */
export function cutStrokes(strokes, a, b, r, maxStrokes = LIMITS.strokes) {
  /** @type {Stroke[]} */
  const out = [];
  let blocked = false, changed = false;
  strokes.forEach((s, i) => {
    const pieces = cutOne(s, a, b, r);
    if (!pieces) { out.push(s); return; }
    if (pieces.length > 1 && out.length + pieces.length + strokes.length - 1 - i > maxStrokes) { blocked = true; out.push(s); return; }
    changed = true;
    out.push(...pieces);
  });
  return { strokes: changed ? out : strokes, blocked };
}
