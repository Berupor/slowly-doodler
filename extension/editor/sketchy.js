import { W, H, LIMITS, r2 } from './sdj.js';

const STEP = 3;
const WAVELENGTH = 40;
const MIN_LENGTH = 8;
const WOBBLE = 1.3;
const WOBBLE_PER_UNIT = 0.02;
const BOW = 2.5;
const BOW_PER_UNIT = 0.01;
const END_JITTER = 1;
const END_JITTER_PER_UNIT = 0.03;
const OVERSHOOT = 2.5;
const OVERSHOOT_PER_UNIT = 0.012;
const CLOSE_GAP = 2.5;
const CLOSE_GAP_PER_UNIT = 0.012;
const TANGENT_SPAN = 5;
const CORNER_COS = Math.cos(Math.PI / 4);
const SPLIT_LENGTHS = [160, 360];
const CUT_SPREAD = 0.1;
const JOIN = 3;
const POINT_RESERVE = 10;

/** @typedef {import('./sdj.js').Polyline} Polyline */
/** @typedef {number[]} Pt */

/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @template T @param {T[]} list */
const last = list => list[list.length - 1];

/** @param {() => number} rand @param {number} lo @param {number} hi */
const between = (rand, lo, hi) => lo + (hi - lo) * rand();

/** @param {Pt[]} pts */
function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** @param {Pt[]} pts @param {number} step */
const extraPoints = (pts, step) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.max(0, Math.ceil(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / step) - 1);
  return n;
};

/** @param {Pt} a @param {Pt} b */
function unit(a, b) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

/** @param {Pt[]} pts @param {number} i @param {number[]} chord direction of the segment being filled; a vertex that bends sharply keeps it instead of rounding off */
function heading(pts, i, chord) {
  if (i === 0 || i === pts.length - 1) return chord;
  const before = unit(pts[i - 1], pts[i]), after = unit(pts[i], pts[i + 1]);
  if (before[0] * after[0] + before[1] * after[1] < CORNER_COS) return chord;
  const sum = [before[0] + after[0], before[1] + after[1]], d = Math.hypot(sum[0], sum[1]) || 1;
  return [sum[0] / d, sum[1] / d];
}

/** @param {Pt[]} pts @param {number} step smooth bends are filled with a curve through the vertices, so a coarse circle does not come out as a polygon */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(len / step);
    const chord = unit(pts[i - 1], pts[i]);
    const [ux, uy] = heading(pts, i - 1, chord), [vx, vy] = heading(pts, i, chord);
    for (let k = 1; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push([h00 * x0 + h10 * len * ux + h01 * x1 + h11 * len * vx, h00 * y0 + h10 * len * uy + h01 * y1 + h11 * len * vy]);
    }
    out.push(pts[i]);
  }
  return out;
}

/** @param {() => number} rand @param {number} length @param {boolean} closed a closed stroke gets a noise that repeats, so the wobble cannot open the shape */
function noise(rand, length, closed) {
  const cells = Math.max(1, Math.round(length / WAVELENGTH));
  const lattice = Array.from({ length: cells + 1 }, () => rand() * 2 - 1);
  if (closed) lattice[cells] = lattice[0];
  return (/** @type {number} */ s) => {
    const u = Math.min(cells, Math.max(0, s / length * cells));
    const i = Math.min(cells - 1, Math.floor(u)), f = u - i, k = f * f * (3 - 2 * f);
    return lattice[i] * (1 - k) + lattice[i + 1] * k;
  };
}

/** @param {Pt[]} pts @param {number[]} cum @param {boolean} atEnd unit direction the stroke leaves its end (or start) in */
function tangent(pts, cum, atEnd) {
  const last = pts.length - 1;
  let j = atEnd ? last - 1 : 1;
  while (j > 0 && j < last && Math.abs(cum[atEnd ? last : 0] - cum[j]) < TANGENT_SPAN) j += atEnd ? -1 : 1;
  const [px, py] = pts[atEnd ? last : 0], [qx, qy] = pts[j];
  const d = Math.hypot(px - qx, py - qy) || 1;
  return [(px - qx) / d, (py - qy) / d];
}

/** @param {Pt[]} pts @param {number[]} cum @param {number} from @param {number} to */
function slice(pts, cum, from, to) {
  const at = (/** @type {number} */ s) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const span = cum[i] - cum[i - 1] || 1, k = Math.min(1, Math.max(0, (s - cum[i - 1]) / span));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
  };
  return [at(from), ...pts.filter((_, i) => cum[i] > from && cum[i] < to), at(to)];
}

/** @param {Pt[]} pts */
const isClosed = pts => pts.length > 3 && Math.hypot(pts[0][0] - last(pts)[0], pts[0][1] - last(pts)[1]) < 0.5;

/** @param {number} length */
const partsFor = length => 1 + SPLIT_LENGTHS.filter(l => length >= l).length;

/**
 * One pen path in place of a machine-traced one: a slow wobble, a slight bow, ends that miss and overshoot, closed shapes that do not quite close.
 * @param {Pt[]} source @param {() => number} rand @param {number} roughness @param {number} step
 * @returns {{ path: Pt[], cum: number[] }}
 */
function wobble(source, rand, roughness, step) {
  const pts = densify(source, step), cum = cumulative(pts), length = last(cum);
  const closed = isClosed(source);
  const amp = roughness * Math.min(WOBBLE, WOBBLE_PER_UNIT * length);
  const nx = noise(rand, length, closed), ny = noise(rand, length, closed);
  const [cx, cy] = [last(pts)[0] - pts[0][0], last(pts)[1] - pts[0][1]];
  const chord = Math.hypot(cx, cy);
  const bowSize = closed || chord < length * 0.5 ? 0 : roughness * Math.min(BOW, BOW_PER_UNIT * length) * between(rand, 0.4, 1) * (rand() < 0.5 ? -1 : 1);
  const [bx, by] = [-cy / (chord || 1) * bowSize, cx / (chord || 1) * bowSize];
  const jitter = roughness * Math.min(END_JITTER, END_JITTER_PER_UNIT * length);
  const kick = (/** @type {number} */ size) => { const a = rand() * 2 * Math.PI; return [Math.cos(a) * size, Math.sin(a) * size]; };
  const e0 = kick(jitter * between(rand, 0.3, 1));
  const gap = roughness * Math.min(CLOSE_GAP, CLOSE_GAP_PER_UNIT * length);
  const miss = closed ? kick(gap * between(rand, 0.4, 1)) : kick(jitter * between(rand, 0.3, 1));
  const e1 = closed ? [e0[0] + miss[0], e0[1] + miss[1]] : miss;
  const taper = Math.min(length * 0.25, 30);
  const fade = (/** @type {number} */ d) => { const t = Math.max(0, 1 - d / taper); return t * t; };
  /** @type {Pt[]} */
  const path = pts.map(([x, y], i) => {
    const s = cum[i], bow = Math.sin(Math.PI * s / length), a = fade(s), b = fade(length - s);
    return [x + nx(s) * amp + bx * bow + e0[0] * a + e1[0] * b, y + ny(s) * amp + by * bow + e0[1] * a + e1[1] * b];
  });
  const tail = tangent(path, cumulative(path), true);
  const over = closed ? (rand() < 0.5 ? 0 : gap * between(rand, 0.5, 1.5)) : roughness * Math.min(OVERSHOOT, OVERSHOOT_PER_UNIT * length) * rand();
  if (over > 0.05) path.push([last(path)[0] + tail[0] * over, last(path)[1] + tail[1] * over]);
  if (!closed) {
    const head = tangent(path, cumulative(path), false);
    const lead = roughness * Math.min(OVERSHOOT, OVERSHOOT_PER_UNIT * length) * rand() * 0.5;
    if (lead > 0.05) path.unshift([path[0][0] + head[0] * lead, path[0][1] + head[1] * lead]);
  }
  return { path, cum: cumulative(path) };
}

/** @param {Pt[]} path @param {number[]} cum @param {number} parts @param {() => number} rand @param {number} roughness */
function cutInto(path, cum, parts, rand, roughness) {
  if (parts < 2) return [path];
  const length = last(cum);
  const cuts = Array.from({ length: parts - 1 }, (_, k) => length * ((k + 1) / parts + between(rand, -CUT_SPREAD, CUT_SPREAD) / parts));
  const lap = cuts.map(() => roughness * between(rand, -JOIN, JOIN));
  return cuts.concat(length).map((end, k) => slice(path, cum, k ? cuts[k - 1] - lap[k - 1] / 2 : 0, k < cuts.length ? end + lap[k] / 2 : end));
}

/** @param {Pt} p @returns {Pt} */
const inside = ([x, y]) => [r2(Math.min(W, Math.max(0, x))), r2(Math.min(H, Math.max(0, y)))];

/**
 * Redraws machine-traced polylines as if by a careful hand. roughness 0 returns them as they are; the look depends on the seed and the stroke index only.
 * Stays within LIMITS: long strokes split into 2-3 while the stroke budget lasts, and points are added only while the point budget lasts.
 * @param {Polyline[]} polylines @param {{ roughness?: number, seed?: number }} [options]
 * @returns {Polyline[]}
 */
export function handDrawn(polylines, { roughness = 1, seed = 1 } = {}) {
  if (!(roughness > 0)) return polylines;
  const have = polylines.reduce((n, p) => n + p.pts.length, 0);
  const room = LIMITS.points - POINT_RESERVE * LIMITS.strokes - have;
  if (room < 0) return polylines;
  const sketchable = polylines.map(p => p.pts.length > 1 && last(cumulative(p.pts)) >= MIN_LENGTH);
  let step = STEP;
  while (step < W && polylines.reduce((n, p, i) => n + (sketchable[i] ? extraPoints(p.pts, step) : 0), 0) > room) step *= 1.5;
  let spare = LIMITS.strokes - polylines.length;
  const lengths = polylines.map((p, i) => sketchable[i] ? last(cumulative(p.pts)) : 0);
  const parts = lengths.map(() => 1);
  for (const i of lengths.map((_, k) => k).sort((a, b) => lengths[b] - lengths[a])) {
    const take = Math.min(partsFor(lengths[i]) - 1, spare);
    parts[i] += take;
    spare -= take;
  }
  return polylines.flatMap((pl, i) => {
    if (!sketchable[i]) return [pl];
    const rand = rng(Math.imul(seed + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35));
    let own = step;
    while (own < W && pl.pts.length + extraPoints(pl.pts, own) > LIMITS.pointsPerStroke - POINT_RESERVE) own *= 1.5;
    const { path, cum } = wobble(pl.pts, rand, roughness, own);
    return cutInto(path, cum, parts[i], rand, roughness).map(pts => ({ ...pl, pts: pts.map(inside) }));
  });
}
