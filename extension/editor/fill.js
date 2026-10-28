import { W, H, STROKE_SCALE, CANVAS_TOKEN, pathD } from './sdj.js';

const SCALE = 0.5;
const GAP_CLOSE = 3;
const INK_ALPHA = 20;
const SEED_REACH = 3;
const SAMPLE_STEP = 1;
const MIN_RUN = 2;
const COARSEN = 1.25;

/** @typedef {{ mask: Uint8Array, w: number, h: number }} Raster */
/** @typedef {{ y: number, segs: { a: number, b: number }[] }} Row */
/** @typedef {{ style: string, angle: number, density: number, weight: number }} FillOptions */

/**
 * Rows of hatch runs (in the frame rotated by angle) joined into zig-zag chains where the next run starts near the end of the last one.
 * @param {Row[]} rows @param {number} spacing @param {number} angle @returns {number[][][]}
 */
export function chainRows(rows, spacing, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const used = new Set();
  const chains = [];
  for (let r = 0; r < rows.length; r++)
    for (const seg of rows[r].segs) {
      if (used.has(seg)) continue;
      used.add(seg);
      const pts = [[seg.a, rows[r].y], [seg.b, rows[r].y]];
      let endX = seg.b, forward = false;
      for (let n = r + 1; n < rows.length; n++) {
        const next = rows[n].segs.find(s => !used.has(s) && Math.abs((forward ? s.a : s.b) - endX) < spacing * 2);
        if (!next) break;
        used.add(next);
        if (forward) { pts.push([next.a, rows[n].y], [next.b, rows[n].y]); endX = next.b; }
        else { pts.push([next.b, rows[n].y], [next.a, rows[n].y]); endX = next.a; }
        forward = !forward;
      }
      chains.push(pts.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]));
    }
  return chains;
}

/**
 * The ink as the viewer sees it, grown by GAP_CLOSE on each side so small gaps in a hand-drawn outline do not leak.
 * canvas-coloured strokes white out what is under them.
 * @param {{ color: string, weight: number, points: number[][] }[]} strokes @returns {Raster}
 */
export function rasterInk(strokes) {
  const w = Math.round(W * SCALE), h = Math.round(H * SCALE);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }));
  ctx.scale(SCALE, SCALE);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.color === CANVAS_TOKEN ? 'destination-out' : 'source-over';
    ctx.lineWidth = STROKE_SCALE * s.weight + 2 * GAP_CLOSE;
    ctx.stroke(new Path2D(pathD(s.points)));
  }
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > INK_ALPHA ? 1 : 0;
  return { mask, w, h };
}

/** @param {Raster} ink @returns {[number, number] | null} the pixel nearest to (x, y) that is not ink */
function nearestFree({ mask, w, h }, x, y) {
  for (let d = 0; d <= SEED_REACH; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++) {
        const px = x + dx, py = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === d && px >= 0 && px < w && py >= 0 && py < h && !mask[py * w + px]) return [px, py];
      }
  return null;
}

/**
 * 4-connected scanline fill of the non-ink pixels around (sx, sy). touchesEdge: the area is open to the page edge.
 * @param {Raster} ink @param {number} sx @param {number} sy
 */
export function floodRegion({ mask, w, h }, sx, sy) {
  const region = new Uint8Array(w * h);
  const free = (/** @type {number} */ x, /** @type {number} */ y) => !mask[y * w + x] && !region[y * w + x];
  const stack = [sx, sy];
  let touchesEdge = false;
  while (stack.length) {
    const y = /** @type {number} */ (stack.pop()), x = /** @type {number} */ (stack.pop());
    if (!free(x, y)) continue;
    let l = x, r = x;
    while (l > 0 && free(l - 1, y)) l--;
    while (r < w - 1 && free(r + 1, y)) r++;
    for (let i = l; i <= r; i++) region[y * w + i] = 1;
    if (l === 0 || r === w - 1 || y === 0 || y === h - 1) touchesEdge = true;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        const f = free(i, ny);
        if (f && !inRun) stack.push(i, ny);
        inRun = f;
      }
    }
  }
  return { region, touchesEdge };
}

/** Square erosion; the page edge counts as outside. @param {Uint8Array} mask @param {number} w @param {number} h @param {number} r */
function erode(mask, w, h, r) {
  if (r < 1) return mask;
  const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const all = (/** @type {Uint8Array} */ src, /** @type {number} */ i, /** @type {number} */ step, /** @type {number} */ at, /** @type {number} */ size) => {
    if (at - r < 0 || at + r >= size) return 0;
    for (let k = -r; k <= r; k++) if (!src[i + k * step]) return 0;
    return 1;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y * w + x] = all(mask, y * w + x, 1, x, w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = all(rows, y * w + x, w, y, h);
  return out;
}

/**
 * Runs of set pixels along lines spacing apart at the given angle, on a grid fixed to the page so neighbouring fills line up.
 * @param {Raster} area @param {number} spacing @param {number} angle @returns {Row[]}
 */
function runRows({ mask, w, h }, spacing, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return [];
  const corners = [[x0, y0], [x1 + 1, y0], [x0, y1 + 1], [x1 + 1, y1 + 1]].map(([x, y]) => [x / SCALE * cos + y / SCALE * sin, -x / SCALE * sin + y / SCALE * cos]);
  const minX = Math.min(...corners.map(c => c[0])), maxX = Math.max(...corners.map(c => c[0]));
  const minY = Math.min(...corners.map(c => c[1])), maxY = Math.max(...corners.map(c => c[1]));
  /** @type {Row[]} */
  const rows = [];
  for (let k = Math.ceil(minY / spacing - 0.5); (k + 0.5) * spacing < maxY; k++) {
    const y = (k + 0.5) * spacing;
    /** @type {Row['segs']} */
    const segs = [];
    /** @type {number | null} */
    let a = null, last = 0;
    const close = () => { if (a !== null && last - a >= MIN_RUN) segs.push({ a, b: last }); a = null; };
    for (let x = minX; x <= maxX; x += SAMPLE_STEP) {
      const px = Math.floor((x * cos - y * sin) * SCALE), py = Math.floor((x * sin + y * cos) * SCALE);
      if (px >= 0 && px < w && py >= 0 && py < h && mask[py * w + px]) { a ??= x; last = x; }
      else close();
    }
    close();
    rows.push({ y, segs });
  }
  return rows;
}

/** @param {Raster} area @param {number} spacing @param {number} angle @param {string} style @returns {number[][][]} */
function hatchLines(area, spacing, angle, style) {
  const rows = runRows(area, spacing, angle);
  if (style === 'scribble') return chainRows(rows, spacing, angle);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const back = (/** @type {number} */ x, /** @type {number} */ y) => [x * cos - y * sin, x * sin + y * cos];
  return rows.flatMap(({ y, segs }) => segs.map(s => [back(s.a, y), back(s.b, y)]));
}

/**
 * Hatch lines for the area around a click, clipped to the area and inset so the line caps stop at the outline.
 * When the lines do not fit room, spacing grows until they do. density is the gap between lines in stroke widths; style is hatch, cross or scribble.
 * @param {Raster} ink @param {number[]} at canvas point @param {FillOptions} opts @param {{ strokes: number, points: number }} room
 * @returns {{ lines: number[][][], density: number, touchesEdge: boolean } | { error: string }}
 */
export function hatchRegion(ink, [x, y], { style, angle, density, weight }, room) {
  const seed = nearestFree(ink, Math.floor(x * SCALE), Math.floor(y * SCALE));
  if (!seed) return { error: 'click inside an area, not on a line' };
  const { region, touchesEdge } = floodRegion(ink, ...seed);
  const width = STROKE_SCALE * weight;
  const area = { mask: erode(region, ink.w, ink.h, Math.round(Math.max(0, width / 2 - GAP_CLOSE) * SCALE)), w: ink.w, h: ink.h };
  const angles = style === 'cross' ? [angle, angle + Math.PI / 2] : [angle];
  const reach = Math.hypot(W, H);
  for (let d = density; d * width < reach; d *= COARSEN) {
    const lines = angles.flatMap(a => hatchLines(area, d * width, a, style));
    if (!lines.length) return { error: d === density ? 'the area is too small to fill' : 'no room left for the fill' };
    if (lines.length <= room.strokes && lines.reduce((n, l) => n + l.length, 0) <= room.points) return { lines, density: d, touchesEdge };
  }
  return { error: 'no room left for the fill' };
}
