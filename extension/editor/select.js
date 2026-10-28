import * as S from './sdj.js';

/** @typedef {[a: number, b: number, c: number, d: number, e: number, f: number]} Matrix x' = a*x + c*y + e, y' = b*x + d*y + f */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */
/** @typedef {{ strokes: S.Stroke[], palette: S.Palette }} Clip */

const LASSO_SAMPLES = 64;
const MIN_SCALE = 0.02;
const SNAP_STEP = Math.PI / 12;
const DUPLICATE_OFFSET = 16;
const NUDGE = 1, NUDGE_BIG = 10;
const DRAG_PX = 4, CLICK_PX = 6, LASSO_STEP_PX = 3;
const PAD_PX = 6, HANDLE_PX = 10, ROTATE_PX = 26, HALO_PX = 6;
const COALESCE_MS = 700;
const NS = 'http://www.w3.org/2000/svg';
const FLIP_X_ICON = 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4';
const FLIP_Y_ICON = 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4';
const DUPLICATE_ICON = 'M9 9h11v11H9zM5 15V4h11M14.5 12v5M12 14.5h5';
const COPY_ICON = 'M9 9h11v11H9zM5 15V4h11';
const DELETE_ICON = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';
/** @type {Matrix} */
export const IDENTITY = [1, 0, 0, 1, 0, 0];
/** @type {Record<string, [number, number]>} */
const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
/** @type {Record<string, string>} */
const OPPOSITE = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @param {number[]} p @param {number[][]} poly even-odd rule */
export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** @param {S.Stroke} stroke @param {number[][]} poly share of the stroke's points inside, estimated on at most LASSO_SAMPLES of them */
export function insideShare(stroke, poly) {
  const { points } = stroke;
  const n = Math.min(points.length, LASSO_SAMPLES);
  let inside = 0;
  for (let k = 0; k < n; k++) if (pointInPolygon(points[Math.floor(k * points.length / n)], poly)) inside++;
  return inside / n;
}

/** @param {S.Stroke[]} strokes @param {number[][]} poly strokes with more than half of their points inside */
export function lassoPick(strokes, poly) {
  return poly.length < 3 ? [] : strokes.filter(s => insideShare(s, poly) > 0.5);
}

/** @param {number[]} p @param {number[]} a @param {number[]} b */
export function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** @param {S.Stroke[]} strokes @param {number[]} pt @param {number} tol extra reach beyond the stroke's own half width; topmost hit wins */
export function hitStroke(strokes, pt, tol) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const { points, weight } = strokes[i];
    const reach = S.STROKE_SCALE * weight / 2 + tol;
    for (let k = 0; k < points.length; k++)
      if (distToSegment(pt, points[k], points[Math.min(k + 1, points.length - 1)]) <= reach) return strokes[i];
  }
  return null;
}

/** @param {S.Stroke[]} strokes @returns {Box | null} */
export function bounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** @param {number} dx @param {number} dy @returns {Matrix} */
export const translate = (dx, dy) => [1, 0, 0, 1, dx, dy];
/** @param {number} sx @param {number} sy @param {number} ax @param {number} ay @returns {Matrix} */
export const scaleAbout = (sx, sy, ax, ay) => [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay];
/** @param {number} angle radians, clockwise on screen @param {number} cx @param {number} cy @returns {Matrix} */
export function rotateAbout(angle, cx, cy) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
/** @param {Matrix} m @param {number} x @param {number} y @returns {[number, number]} */
export const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** @param {S.Stroke} stroke @param {Matrix} m keeps weight, color and timing; points are clamped to the canvas */
export function transformStroke(stroke, m) {
  return {
    ...stroke,
    points: stroke.points.map(([x, y, t]) => {
      const [nx, ny] = applyMatrix(m, x, y);
      return /** @type {S.Point} */ ([S.r2(clamp(nx, 0, S.W)), S.r2(clamp(ny, 0, S.H)), t]);
    }),
  };
}

/** @param {Box} box @param {number} dx @param {number} dy translation limited so the box stays on the canvas, which keeps the shape intact */
export function fitShift(box, dx, dy) {
  return /** @type {[number, number]} */ ([clamp(dx, -box.x0, S.W - box.x1), clamp(dy, -box.y0, S.H - box.y1)]);
}

/** @param {Box} box @param {number} step offset towards the bottom right, towards the top left when that would leave the canvas */
export function duplicateShift(box, step) {
  return fitShift(box, box.x1 + step <= S.W ? step : -step, box.y1 + step <= S.H ? step : -step);
}

/** @param {number} s */
const keepScale = s => Math.abs(s) < MIN_SCALE ? (s < 0 ? -MIN_SCALE : MIN_SCALE) : s;

/**
 * Scale factors for a corner drag: the opposite corner stays put, `grab` is where the pointer went down.
 * @param {number[]} anchor @param {number[]} grab @param {number[]} pointer @param {boolean} uniform
 * @returns {[number, number]}
 */
export function scaleFactors([ax, ay], [gx, gy], [px, py], uniform) {
  const dx = gx - ax, dy = gy - ay;
  if (!uniform) return [keepScale(dx ? (px - ax) / dx : 1), keepScale(dy ? (py - ay) / dy : 1)];
  const d2 = dx * dx + dy * dy;
  const s = keepScale(d2 ? ((px - ax) * dx + (py - ay) * dy) / d2 : 1);
  return [s, s];
}

/** @param {number} angle radians */
export const snapAngle = angle => Math.round(angle / SNAP_STEP) * SNAP_STEP;

/**
 * Copies `clip` with startOffsets moved so the first one starts `gap` ms after the existing drawing ends, relative timing kept.
 * @param {S.Stroke[]} existing @param {S.Stroke[]} clip @param {number} gap
 */
export function appendTimeline(existing, clip, gap) {
  if (!clip.length) return [];
  const first = Math.min(...clip.map(s => s.startOffset));
  const at = existing.length ? S.endTime(existing) + gap : 0;
  return clip.map(({ color, weight, startOffset, points }) => ({
    color, weight, startOffset: Math.round(startOffset - first + at), points: points.map(([x, y, t]) => /** @type {S.Point} */ ([x, y, t])),
  }));
}

/** @param {S.Stroke[]} existing @param {S.Stroke[]} added @param {S.Palette} palette */
export function pasteError(existing, added, palette) {
  const err = S.validate(S.buildSdj([...existing, ...added], palette));
  return err === 'nothing drawn' ? null : err;
}

/** @param {string} text SDJ or the editor's JSON payload; null when it is anything else @returns {Clip | null} */
export function parseClip(text) {
  if (!/^\s*\{/.test(text)) return null;
  let json;
  try { json = JSON.parse(text); } catch { return null; }
  const sdj = json?.sdj ?? json;
  if (!Array.isArray(sdj?.strokes) || !sdj.strokes.length) return null;
  const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
  const valid = sdj.strokes.every((/** @type {any} */ s) => typeof s?.color === 'string' && num(s.weight) && (s.startOffset === undefined || num(s.startOffset))
    && Array.isArray(s.points) && s.points.length && s.points.every((/** @type {any} */ p) => Array.isArray(p) && num(p[0]) && num(p[1]) && (p[2] === undefined || num(p[2]))));
  if (!valid) return null;
  /** @type {S.Palette} */
  const palette = {};
  for (const [token, e] of Object.entries(sdj.palette ?? {}))
    if (typeof e?.light === 'string' && typeof e?.dark === 'string') palette[token] = { light: e.light, dark: e.dark };
  return {
    palette,
    strokes: sdj.strokes.map((/** @type {any} */ s) => ({
      color: s.color, weight: s.weight, startOffset: s.startOffset ?? 0,
      points: s.points.map((/** @type {number[]} */ p) => [S.r2(clamp(p[0], 0, S.W)), S.r2(clamp(p[1], 0, S.H)), p[2] ?? 0]),
    })),
  };
}

/** @param {string} tag @param {Record<string, string | number>} [attrs] */
function svg(tag, attrs = {}) {
  const el = /** @type {SVGElement} */ (document.createElementNS(NS, tag));
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * @typedef {object} Drag
 * @property {'pending' | 'lasso' | 'move' | 'scale' | 'rotate'} kind
 * @property {number} cx
 * @property {number} cy
 * @property {{ x: number, y: number }} p
 * @property {boolean} add
 * @property {boolean} inBox
 * @property {string} [handle]
 * @property {number[][]} [poly]
 * @property {S.Stroke[]} [items]
 * @property {Box} [box]
 * @property {SVGElement[]} [hidden]
 * @property {Matrix} [m]
 */

/**
 * @typedef {object} Env
 * @property {SVGSVGElement} board
 * @property {() => S.Stroke[]} strokes
 * @property {(s: S.Stroke) => boolean} pickable strokes on hidden or locked layers are not
 * @property {() => string | null} addBlocked why new strokes cannot be added now
 * @property {() => S.Stroke[]} sent the strokes as Send would send them, hidden layers left out
 * @property {() => S.Palette} palette
 * @property {(next: S.Stroke[]) => void} commit
 * @property {(next: S.Stroke[]) => void} amend replaces the current state without a new undo step
 * @property {(text: string, error?: boolean) => void} say
 * @property {(tool: string) => void} setTool
 * @property {(extra: S.Palette) => void} addPalette
 * @property {(points: number[][], token: string, weight: number) => SVGElement} pathEl
 * @property {(e: { clientX: number, clientY: number }) => { x: number, y: number }} boardPoint
 * @property {() => number} pxPerUnit
 * @property {string} typing selector of elements where keys belong to the text field
 * @property {number} gapMs
 */

/** @param {Env} env */
export function createSelector(env) {
  const ink = /** @type {Element} */ (document.getElementById('ink'));
  const layer = svg('g', { id: 'sel' });
  const ghosts = svg('g'), haloLayer = svg('g'), chrome = svg('g'), lassoEl = svg('path', { class: 'lasso' });
  layer.append(ghosts, haloLayer, chrome, lassoEl);
  env.board.append(layer);

  const bar = Object.assign(document.createElement('div'), { className: 'drawing-tool-group', hidden: true });
  const actions = /** @type {[string, string, () => void][]} */ ([
    ['Flip horizontally', FLIP_X_ICON, () => flip('x')],
    ['Flip vertically', FLIP_Y_ICON, () => flip('y')],
    ['Duplicate (Ctrl+D)', DUPLICATE_ICON, duplicate],
    ['Copy (Ctrl+C)', COPY_ICON, () => document.execCommand('copy')],
    ['Delete (Del)', DELETE_ICON, remove],
  ]);
  for (const [title, path, run] of actions) {
    const b = Object.assign(document.createElement('button'), { className: 'drawing-tool-circle', title, onclick: run });
    b.setAttribute('aria-label', title);
    const icon = svg('svg', { class: 'svg-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    icon.append(svg('path', { d: path }));
    b.append(icon);
    bar.append(b);
  }
  document.querySelector('.dock')?.append(bar);

  /** @type {Set<S.Stroke>} */
  let sel = new Set();
  /** @type {Clip | null} */
  let clip = null;
  let pastes = 0;
  /** @type {Drag | null} */
  let drag = null;
  /** @type {{ tag: string, time: number, result: S.Stroke[] } | null} */
  let last = null;
  /** @type {{ el: SVGElement, weight: number }[]} */
  let halos = [];
  /** @type {Box | null} */
  let box = null;

  /** @param {Event} e */
  const typing = e => e.target instanceof Element && !!e.target.closest(env.typing);
  const items = () => env.strokes().filter(s => sel.has(s));
  const pickable = () => env.strokes().filter(env.pickable);

  function haloWidths() {
    for (const h of halos) h.el.setAttribute('stroke-width', String(S.STROKE_SCALE * h.weight + HALO_PX / env.pxPerUnit()));
  }

  /** @param {Box} b @param {boolean} handles */
  function drawChrome(b, handles) {
    const u = 1 / env.pxPerUnit(), pad = PAD_PX * u, hs = HANDLE_PX * u;
    const vb = env.board.viewBox.baseVal;
    const x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
    const inView = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ size, /** @type {number} */ margin) => clamp(v, lo + margin, lo + size - margin);
    const els = [svg('rect', { class: 'box', x: x0, y: y0, width: x1 - x0, height: y1 - y0, ...(handles && { 'data-h': 'move' }) })];
    if (handles) {
      const mid = (x0 + x1) / 2;
      const rx = inView(mid, vb.x, vb.width, hs), ry = Math.max(vb.y + hs, y0 - ROTATE_PX * u);
      els.push(svg('line', { class: 'stem', x1: mid, y1: y0, x2: rx, y2: ry }));
      for (const [name, x, y] of [['nw', x0, y0], ['ne', x1, y0], ['se', x1, y1], ['sw', x0, y1]])
        els.push(svg('rect', { class: 'handle', 'data-h': String(name), width: hs, height: hs,
          x: inView(/** @type {number} */ (x), vb.x, vb.width, hs / 2) - hs / 2, y: inView(/** @type {number} */ (y), vb.y, vb.height, hs / 2) - hs / 2 }));
      els.push(svg('circle', { class: 'handle', 'data-h': 'rot', cx: rx, cy: ry, r: hs * 0.6 }));
    }
    chrome.replaceChildren(...els);
  }

  function render() {
    const present = new Set(env.strokes());
    for (const s of sel) if (!present.has(s) || !env.pickable(s)) sel.delete(s);
    bar.hidden = !sel.size;
    ghosts.replaceChildren();
    lassoEl.removeAttribute('d');
    halos = items().map(s => ({ el: svg('path', { class: 'halo', d: S.pathD(s.points) }), weight: s.weight }));
    haloLayer.replaceChildren(...halos.map(h => h.el));
    haloWidths();
    box = bounds(items());
    if (box) drawChrome(box, true); else chrome.replaceChildren();
  }

  function zoomed() {
    haloWidths();
    if (box && !drag) drawChrome(box, true);
  }

  /** @param {(s: S.Stroke) => S.Stroke} fn @param {string} [tag] consecutive edits with the same tag share one undo step */
  function edit(fn, tag = '') {
    const strokes = env.strokes();
    const made = new Map(items().map(s => [s, fn(s)]));
    const next = strokes.map(s => made.get(s) ?? s);
    const merge = tag && last?.tag === tag && last.result === strokes && Date.now() - last.time < COALESCE_MS;
    sel = new Set(made.values());
    if (merge) env.amend(next); else env.commit(next);
    last = { tag, time: Date.now(), result: next };
  }

  /** @param {Matrix} m @param {string} [tag] */
  function applyMatrixToSelection(m, tag) {
    edit(s => transformStroke(s, m), tag);
  }

  /** @param {string} axis */
  function flip(axis) {
    if (!box) return;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    applyMatrixToSelection(axis === 'x' ? scaleAbout(-1, 1, cx, 0) : scaleAbout(1, -1, 0, cy));
  }

  /** @param {number} dx @param {number} dy */
  function nudge(dx, dy) {
    if (!box) return;
    const [mx, my] = fitShift(box, dx, dy);
    if (mx || my) applyMatrixToSelection(translate(mx, my), 'nudge');
  }

  function remove() {
    const gone = sel;
    sel = new Set();
    env.commit(env.strokes().filter(s => !gone.has(s)));
  }

  /** @param {S.Stroke[]} source @param {S.Palette} extra @param {number} steps @param {boolean} [inPlace] copies stay on the layers of the source, otherwise all go to the active layer */
  function place(source, extra, steps, inPlace = false) {
    const why = !inPlace && env.addBlocked();
    if (why) return env.say(why, true);
    const strokes = env.strokes();
    const appended = appendTimeline(strokes, source, env.gapMs);
    const src = /** @type {Box} */ (bounds(appended));
    const [dx, dy] = steps ? duplicateShift(src, DUPLICATE_OFFSET * steps) : [0, 0];
    const m = translate(dx, dy);
    const added = appended.map((s, i) => inPlace ? { ...transformStroke(s, m), layer: source[i].layer } : transformStroke(s, m));
    const palette = env.palette();
    const unknown = Object.fromEntries(Object.entries(extra).filter(([token]) => !palette[token] && !S.baseEntry(token)));
    const err = pasteError(env.sent(), added, { ...palette, ...unknown });
    if (err) return env.say(`cannot paste: ${err}`, true);
    if (Object.keys(unknown).length) env.addPalette(unknown);
    sel = new Set(added);
    env.setTool('select');
    env.commit([...strokes, ...added]);
    last = null;
    env.say(`${added.length} strokes added at the end of the timeline`);
  }

  /** @param {Clip} source */
  const paste = source => place(source.strokes, source.palette, pastes++);

  function duplicate() {
    if (sel.size) place(items(), {}, 1, true);
  }

  function copyJson() {
    const picked = items();
    const sdj = S.buildSdj(picked, env.palette());
    clip = { strokes: picked, palette: sdj.palette };
    pastes = 1;
    return JSON.stringify(sdj);
  }

  /** @param {string} kind @param {string} [handle] */
  function begin(kind, handle) {
    const d = /** @type {Drag} */ (drag);
    const picked = items();
    const index = new Map(env.strokes().map((s, i) => [s, i]));
    const hidden = /** @type {SVGElement[]} */ (picked.map(s => ink.children[/** @type {number} */ (index.get(s))]).filter(Boolean));
    for (const el of hidden) el.style.display = 'none';
    ghosts.replaceChildren(...picked.map(s => env.pathEl(s.points, s.color, s.weight)));
    Object.assign(d, { kind, handle, items: picked, box: bounds(picked), hidden, m: IDENTITY });
  }

  /** @param {Drag} d @param {{ x: number, y: number }} p @param {PointerEvent} e @returns {Matrix} */
  function matrixFor(d, p, e) {
    const b = /** @type {Box} */ (d.box);
    if (d.kind === 'move') {
      let dx = p.x - d.p.x, dy = p.y - d.p.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      return translate(...fitShift(b, dx, dy));
    }
    if (d.kind === 'rotate') {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(d.p.y - cy, d.p.x - cx);
      return rotateAbout(e.shiftKey ? snapAngle(a) : a, cx, cy);
    }
    const far = OPPOSITE[/** @type {string} */ (d.handle)];
    const ax = far.includes('w') ? b.x0 : b.x1, ay = far.includes('n') ? b.y0 : b.y1;
    const [sx, sy] = scaleFactors([ax, ay], [d.p.x, d.p.y], [p.x, p.y], !e.shiftKey);
    return scaleAbout(sx, sy, ax, ay);
  }

  /** @param {Drag} d @param {Matrix} m */
  function preview(d, m) {
    d.m = m;
    const moved = /** @type {S.Stroke[]} */ (d.items).map(s => transformStroke(s, m));
    moved.forEach((s, i) => {
      const path = S.pathD(s.points);
      ghosts.children[i].setAttribute('d', path);
      halos[i].el.setAttribute('d', path);
    });
    drawChrome(/** @type {Box} */ (bounds(moved)), false);
  }

  function endDrag() {
    for (const el of drag?.hidden ?? []) el.style.display = '';
    drag = null;
  }

  /** @param {Drag} d */
  function click(d) {
    const hit = hitStroke(pickable(), [d.p.x, d.p.y], CLICK_PX / env.pxPerUnit());
    if (!d.add) sel = new Set(hit ? [hit] : []);
    else if (hit) { if (sel.has(hit)) sel.delete(hit); else sel.add(hit); }
    render();
  }

  /** @param {Drag} d */
  function finishLasso(d) {
    const picked = lassoPick(pickable(), /** @type {number[][]} */ (d.poly));
    sel = new Set(d.add ? [...sel, ...picked] : picked);
    render();
  }

  document.addEventListener('keydown', e => {
    if (typing(e) || drag) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && k === 'a') {
      e.preventDefault();
      if (!pickable().length) return;
      sel = new Set(pickable());
      env.setTool('select');
      render();
    } else if (mod && !e.altKey && k === 'd' && sel.size) {
      e.preventDefault();
      duplicate();
    } else if (!sel.size || mod || e.altKey) return;
    else if (k === 'escape') { if (!document.querySelector('.pop:popover-open')) clear(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(); }
    else if (ARROWS[k]) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      nudge(ARROWS[k][0] * step, ARROWS[k][1] * step);
    }
  });

  document.addEventListener('copy', e => {
    if (typing(e) || !sel.size || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copyJson());
    env.say(`copied ${sel.size} strokes`);
  });
  document.addEventListener('cut', e => {
    if (typing(e) || !sel.size || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copyJson());
    pastes = 0;
    env.say(`cut ${sel.size} strokes`);
    remove();
  });
  document.addEventListener('paste', e => {
    if (typing(e)) return;
    const source = parseClip(e.clipboardData?.getData('text/plain') ?? '') ?? clip;
    if (!source) return;
    e.preventDefault();
    paste(source);
  });

  function clear() {
    if (drag) { for (const el of drag.hidden ?? []) el.style.display = ''; drag = null; }
    sel = new Set();
    render();
  }

  return {
    get busy() { return !!drag; },
    get size() { return sel.size; },
    refresh() {
      if (drag) endDrag();
      render();
    },
    zoomed,
    clear,
    cancel() {
      if (!drag) return;
      endDrag();
      render();
    },
    /** @param {string} tool */
    sync(tool) {
      if (tool !== 'select') clear();
    },
    /** @param {string} token */
    paint(token) {
      if (sel.size && items().some(s => s.color !== token)) edit(s => ({ ...s, color: token }));
    },
    /** @param {number} weight */
    reweight(weight) {
      if (sel.size && items().some(s => s.weight !== weight)) edit(s => ({ ...s, weight }), 'weight');
    },
    /** @param {PointerEvent} e */
    down(e) {
      const handle = e.target instanceof Element ? e.target.closest('[data-h]')?.getAttribute('data-h') : null;
      drag = { kind: 'pending', cx: e.clientX, cy: e.clientY, p: env.boardPoint(e), add: e.shiftKey, inBox: handle === 'move' };
      if (handle && handle !== 'move') begin(handle === 'rot' ? 'rotate' : 'scale', handle);
    },
    /** @param {PointerEvent} e */
    move(e) {
      const d = drag;
      if (!d) return;
      const p = env.boardPoint(e);
      if (d.kind === 'pending') {
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < DRAG_PX) return;
        if (d.inBox) begin('move');
        else Object.assign(d, { kind: 'lasso', poly: [[d.p.x, d.p.y]] });
      }
      if (d.kind === 'lasso') {
        const poly = /** @type {number[][]} */ (d.poly), tip = poly[poly.length - 1];
        if (Math.hypot(p.x - tip[0], p.y - tip[1]) * env.pxPerUnit() >= LASSO_STEP_PX) poly.push([p.x, p.y]);
        lassoEl.setAttribute('d', `M${poly.map(q => q.join(' ')).join('L')}Z`);
      } else preview(d, matrixFor(d, p, e));
    },
    up() {
      const d = drag;
      if (!d) return;
      endDrag();
      if (d.kind === 'pending') click(d);
      else if (d.kind === 'lasso') finishLasso(d);
      else if (d.m && d.m.some((v, i) => v !== IDENTITY[i])) applyMatrixToSelection(d.m);
      else render();
    },
  };
}
