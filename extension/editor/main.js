import * as S from './sdj.js';
import { importSvg } from './import-svg.js';
import { photoToPolylines, textToPolylines } from './raster.js';
import * as lib from './library.js';
import * as P from './precision.js';
import { createSelector } from './select.js';
import * as F from './fill.js';

const { W, H } = S;
const NS = 'http://www.w3.org/2000/svg';
const SLOWLY_ORIGIN = 'https://web.slowly.app';
const RAINBOW = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const RAINBOW_CHUNK = 6;
const ELLIPSE_POINTS = 72;
const MIN_SHAPE_MS = 250;
const GAP_CAP_MS = 600;
const STROKE_GAP_MS = 400;
const HISTORY_DEPTH = 100;
const ERASER_PROBE = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]];
const CUT_RADIUS_PER_WEIGHT = 4;
const CUT_RADIUS_MIN = 2;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.01;
const WHEEL_CAP = 30;
const LINE_PX = 33;
/** @type {Record<string, number>} */
const ZOOM_KEYS = { '=': ZOOM_STEP, '+': ZOOM_STEP, '-': 1 / ZOOM_STEP, '_': 1 / ZOOM_STEP };

const SLOWLY_FONT_CSS = 'https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap';
const SLOWLY_FONTS = ['400 14px "Open Sans"', '600 14px "Open Sans"', '20px slowly-icomoon'];
const STYLE_WAIT_MS = 2500;

/** @param {string} id */
const $ = id => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {string} id */
const $g = id => /** @type {SVGGElement} */ (document.querySelector(`#${id}`));
const board = /** @type {SVGSVGElement} */ (document.querySelector('#board'));
const ink = $g('ink'), live = $g('live'), ref = $g('ref'), guides = $g('guides');
const progressBar = /** @type {HTMLProgressElement} */ (document.getElementById('progress'));
const friendSelect = /** @type {HTMLSelectElement} */ (document.getElementById('friend'));
/** @type {WeakMap<Element, S.Stroke>} */
const strokeOf = new WeakMap();
const embedded = window.parent !== window;
const params = new URLSearchParams(location.search);
const isDark = () => document.documentElement.classList.contains('theme-dark');

async function loadSlowlyStyles() {
  const sheets = params.getAll('css').filter(href => new URL(href, location.href).origin === SLOWLY_ORIGIN);
  if (!sheets.length) return;
  const link = href => Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
  const slowly = sheets.map(href => link(href));
  const loaded = slowly.map(l => new Promise(done => { l.onload = l.onerror = done; }));
  document.head.prepend(link(SLOWLY_FONT_CSS), ...slowly);
  await Promise.all(loaded);
  document.documentElement.classList.add('slowly-css');
  await Promise.all(SLOWLY_FONTS.map(f => document.fonts.load(f).catch(() => {})));
}
document.documentElement.classList.toggle('theme-dark', params.get('theme') === 'dark');
Promise.race([loadSlowlyStyles(), new Promise(r => setTimeout(r, STYLE_WAIT_MS))])
  .then(() => document.documentElement.classList.add('styled'));
$('dark').checked = isDark();

/**
 * @typedef {{ strokes: S.Stroke[], palette: S.Palette }} Snapshot
 * @typedef {{ tool: string, color: string, weight: number, startOffset: number, t0: number,
 *   a: [number, number], b: [number, number], dur: number, points: S.Point[], brush: [number, number], anchor: number | null }} Gesture
 */

/** @type {S.Stroke[]} */
let strokes = [];
/** @type {S.Palette} */
let palette = {};
/** @type {string[]} */
let customColors = [];
let tool = 'pen', color = 'black', weight = 3, rainbow = false;
const prec = P.loadSettings();
let picking = false;
let symmetry = 'off';
/** @type {Snapshot[]} */
let undoStack = [];
/** @type {Snapshot[]} */
let redoStack = [];
/** @type {Gesture | null} */
let gesture = null;
/** @type {Set<S.Stroke> | null} */
let erasing = null;
/** @type {{ strokes: S.Stroke[], last: number[], blocked: boolean } | null} */
let cutting = null;
let filling = false;
let refPose = { x: 0, y: 0, rot: 0, flip: 1, scale: 1 }, refMove = false;
/** @type {{ px: number, py: number, x: number, y: number } | null} */
let refDrag = null;
let view = { x: 0, y: 0, w: W }, spaceDown = false;
/** @type {{ x: number, y: number } | null} */
let panDrag = null;
/** @type {{ x: number, y: number, d: number } | null} */
let pinch = null;
/** @type {Map<number, [number, number]>} */
const touches = new Map();
/** @type {number | null} */
let sessionStart = null;
/** @type {number | null} */
let replay = null;
/** @type {{ key: string, before: S.Stroke[] } | null} */
let lastImport = null;

const cx = W / 2, cy = H / 2;
/** @typedef {(p: number[]) => [number, number]} Transform */
/** @type {(a: number) => Transform} */
const rot = a => ([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
/** @type {Transform} */
const flipX = ([x, y]) => [2 * cx - x, y];
/** @type {Transform} */
const flipY = ([x, y]) => [x, 2 * cy - y];
/** @type {Transform} */
const same = ([x, y]) => [x, y];
/** @param {number} n */
const turns = n => Array.from({ length: n }, (_, i) => rot(i * 2 * Math.PI / n));
/** @type {Record<string, { label: string, t: Transform[] }>} */
const SYMMETRY = {
  off: { label: 'Off', t: [same] },
  mirror: { label: 'Mirror', t: [same, flipX] },
  quad: { label: '4-way', t: [same, flipX, flipY, p => flipX(flipY(p))] },
  radial6: { label: 'Radial 6', t: turns(6) },
  kaleido: { label: 'Kaleido 12', t: turns(6).flatMap(r => [r, p => r(flipX(p))]) },
};
const TOOLS = {
  pen: () => icon('pencil', '✎'),
  line: () => span('tool-line'),
  ellipse: () => icon('circle-o', '◯'),
  eraser: () => icon('eraser', '⌫'),
  fill: () => icon('droplet', '◍'),
};
/** @type {Record<string, string>} */
const TOOL_OPTIONS = { pen: 'popBrush', line: 'popBrush', ellipse: 'popBrush', eraser: 'popEraser', fill: 'popFill' };
const TOAST_MS = 2500, TOAST_ERROR_MS = 6000;
/** @type {Record<string, string>} */
const TOOL_KEYS = { b: 'pen', l: 'line', o: 'ellipse', e: 'eraser', f: 'fill', s: 'select' };
const TYPING_TARGET = 'textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file])';

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** @param {string} text */
function say(text, error = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', error);
  $('toast').classList.add('shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('shown'), error ? TOAST_ERROR_MS : TOAST_MS);
}

/** @param {S.Stroke[]} next */
function commit(next, { keepClock = false, keepImport = false } = {}) {
  undoStack.push({ strokes, palette });
  if (undoStack.length > HISTORY_DEPTH) undoStack.shift();
  redoStack = [];
  strokes = next;
  if (!keepClock) sessionStart = null;
  if (!keepImport) lastImport = null;
  changed();
}

/** @param {Snapshot[]} from @param {Snapshot[]} to */
function restore(from, to) {
  const snap = from.pop();
  if (!snap) return;
  to.push({ strokes, palette });
  ({ strokes, palette } = snap);
  sessionStart = null;
  lastImport = null;
  changed();
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let workingTimer;
let autosaveFailed = false;
function changed() {
  renderInk();
  updateStats();
  writeJson();
  clearTimeout(workingTimer);
  workingTimer = setTimeout(() => lib.saveWorking({ sdj: S.buildSdj(strokes, palette), customColors }).then(() => { autosaveFailed = false; }, err => {
    if (!autosaveFailed) say(`autosave failed, the drawing is not stored: ${err.message}`, true);
    autosaveFailed = true;
  }), 400);
}

/** @param {number[][]} points @param {string} token @param {number} w */
function pathEl(points, token, w) {
  const el = document.createElementNS(NS, 'path');
  const entry = S.entryFor(token, palette);
  el.setAttribute('d', points.length ? S.pathD(points) : '');
  el.setAttribute('stroke', isDark() ? entry.dark : entry.light);
  el.setAttribute('stroke-width', String(S.STROKE_SCALE * w));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  return el;
}

function renderInk(list = strokes) {
  ink.replaceChildren(...list.map(s => {
    const el = pathEl(s.points, s.color, s.weight);
    strokeOf.set(el, s);
    return el;
  }));
  selector.refresh();
}

/** @param {Gesture} g @returns {S.Point[]} */
function gesturePoints(g) {
  if (g.tool === 'pen') return g.points;
  if (g.tool === 'line') return [[...g.a, 0], [...g.b, g.dur]];
  const rx = (g.b[0] - g.a[0]) / 2, ry = (g.b[1] - g.a[1]) / 2;
  const ex = g.a[0] + rx, ey = g.a[1] + ry;
  return Array.from({ length: ELLIPSE_POINTS + 1 }, (_, i) => {
    const a = -Math.PI / 2 + i / ELLIPSE_POINTS * 2 * Math.PI;
    return [ex + rx * Math.cos(a), ey + ry * Math.sin(a), g.dur * i / ELLIPSE_POINTS];
  });
}

/** @type {(p: S.Point) => S.Point} */
const clampPoint = ([x, y, t]) => [S.r2(Math.min(W, Math.max(0, x))), S.r2(Math.min(H, Math.max(0, y))), Math.round(t)];

/** @param {Gesture} g */
function renderLive(g) {
  const pts = gesturePoints(g);
  const shown = rainbow ? RAINBOW[0] : g.color;
  live.replaceChildren(...SYMMETRY[symmetry].t.map(tf =>
    pathEl(pts.map(p => [...tf(p), p[2]]), shown, g.weight)));
}

/** @param {S.Stroke} stroke @param {number} phase */
function splitRainbow(stroke, phase) {
  /** @type {S.Stroke[]} */
  const out = [];
  for (let i = 0, n = phase; ; i += RAINBOW_CHUNK - 1, n++) {
    const chunk = stroke.points.slice(i, i + RAINBOW_CHUNK);
    const t0 = chunk[0][2];
    out.push({ color: RAINBOW[n % RAINBOW.length], weight: stroke.weight, startOffset: stroke.startOffset + t0,
      points: chunk.map(([x, y, t]) => [x, y, t - t0]) });
    if (i + RAINBOW_CHUNK >= stroke.points.length) break;
  }
  return out;
}

/** @param {Gesture} g */
function finishGesture(g) {
  gesture = null;
  live.replaceChildren();
  const base = gesturePoints(g);
  const made = SYMMETRY[symmetry].t.map(tf => ({
    color: g.color, weight: g.weight, startOffset: g.startOffset,
    points: base.map(p => clampPoint([...tf(p), p[2]])),
  }));
  const added = rainbow ? made.flatMap(s => splitRainbow(s, strokes.length)) : made;
  commit([...strokes, ...added], { keepClock: true });
}

/** @param {{ clientX: number, clientY: number }} e */
function boardPoint(e) {
  const pt = board.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(board.getScreenCTM()?.inverse());
}

/** @param {PointerEvent} e @returns {[number, number]} */
function toCanvas(e) {
  const p = boardPoint(e);
  return [S.r2(Math.min(W, Math.max(0, p.x))), S.r2(Math.min(H, Math.max(0, p.y)))];
}

/** @param {PointerEvent} e @param {Set<S.Stroke>} erased */
function eraseAt(e, erased) {
  for (const [dx, dy] of ERASER_PROBE) {
    const el = document.elementFromPoint(e.clientX + dx, e.clientY + dy);
    const stroke = el && strokeOf.get(el);
    if (stroke && el instanceof SVGElement && !erased.has(stroke)) {
      erased.add(stroke);
      el.style.display = 'none';
    }
  }
}

const cutMode = () => tool === 'eraser' && $('eraserMode').value === 'cut';
const cutRadius = () => Math.max(CUT_RADIUS_MIN, CUT_RADIUS_PER_WEIGHT * weight);

/** @param {{ clientX: number, clientY: number }} e */
function cutAt(e) {
  if (!cutting) return;
  const p = boardPoint(e);
  const { strokes: next, blocked } = S.cutStrokes(cutting.strokes, cutting.last, [p.x, p.y], cutRadius());
  cutting.last = [p.x, p.y];
  if (blocked && !cutting.blocked) say(`some strokes were not cut: splitting them would exceed ${S.LIMITS.strokes} strokes`, true);
  cutting.blocked ||= blocked;
  if (next === cutting.strokes) return;
  cutting.strokes = next;
  renderInk(next);
}

/** @param {PointerEvent} e */
function fillAt(e) {
  const points = strokes.reduce((a, s) => a + s.points.length, 0);
  const density = Number($('fillSpacing').value);
  const result = F.hatchRegion(F.rasterInk(strokes), toCanvas(e), {
    style: $('fillStyle').value, angle: Number($('fillAngle').value) * Math.PI / 180, density, weight,
  }, { strokes: S.LIMITS.strokes - strokes.length, points: S.LIMITS.points - points });
  if ('error' in result) return say(result.error, true);
  const start = strokes.length ? S.endTime(strokes) + STROKE_GAP_MS : 0;
  const added = S.timed(result.lines.map(pts => ({ color, weight, pts })), start);
  commit([...strokes, ...added]);
  const notes = [
    result.density > density && 'spacing widened to stay within the limits',
    result.touchesEdge && 'the area is open to the page edge, undo if the outline has a gap',
  ].filter(Boolean);
  say([`filled with ${added.length} strokes`, ...notes].join(', '), notes.length > 0);
}

const ring = /** @type {SVGCircleElement} */ (document.querySelector('#eraserRing'));
/** @param {{ clientX: number, clientY: number }} e */
function placeRing(e) {
  ring.style.display = cutMode() ? '' : 'none';
  if (!cutMode()) return;
  const p = boardPoint(e);
  ring.setAttribute('cx', String(p.x));
  ring.setAttribute('cy', String(p.y));
  ring.setAttribute('r', String(cutRadius()));
}

const pxPerUnit = () => board.getScreenCTM()?.a ?? 1;

/** @param {[number, number]} p @returns {[number, number]} */
const gridPoint = p => prec.snap ? P.snapToGrid(p, prec.spacing) : p;

/** @param {boolean} on */
function setPicking(on) {
  picking = on;
  board.classList.toggle('picking', on);
  $('pick').setAttribute('aria-pressed', String(on));
}

/** @param {PointerEvent} e */
function pickAt(e) {
  setPicking(false);
  const hits = ERASER_PROBE.map(([dx, dy]) => document.elementFromPoint(e.clientX + dx, e.clientY + dy))
    .map(el => el && strokeOf.get(el)).filter(s => !!s);
  const stroke = hits.sort((a, b) => strokes.indexOf(b) - strokes.indexOf(a))[0];
  if (!stroke) return say('no stroke under the pointer');
  if (!(stroke.color in S.BASE_COLORS) && stroke.color !== S.CANVAS_TOKEN && !customColors.includes(stroke.color)) customColors.push(stroke.color);
  color = stroke.color;
  setWeight(stroke.weight);
  say(`picked ${stroke.color}, weight ${stroke.weight}`);
}
const selector = createSelector({
  board, typing: TYPING_TARGET, gapMs: STROKE_GAP_MS, say, pathEl, boardPoint, pxPerUnit,
  strokes: () => strokes, palette: () => palette, commit: next => commit(next),
  amend: next => { strokes = next; sessionStart = null; changed(); },
  setTool: t => { tool = t; buildBars(); },
  addPalette: extra => {
    palette = { ...palette, ...extra };
    for (const t of Object.keys(extra)) if (!customColors.includes(t)) customColors.push(t);
    buildBars();
  },
});

/** @param {number} x @param {number} y @param {number} w */
function setView(x, y, w) {
  w = Math.min(W, Math.max(W / ZOOM_MAX, w));
  const h = w * H / W;
  view = { x: Math.min(W - w, Math.max(0, x)), y: Math.min(H - h, Math.max(0, y)), w };
  board.setAttribute('viewBox', `${view.x} ${view.y} ${w} ${h}`);
  $('zoom').hidden = w === W;
  $('zoom').textContent = `${Math.round(W / w * 100)}%`;
  selector.zoomed();
}

/** @param {{ x: number, y: number }} p canvas point to keep under the client point @param {number} clientX @param {number} clientY @param {number} w */
function viewAt(p, clientX, clientY, w) {
  setView(p.x - (p.x - view.x) / view.w * w, p.y - (p.y - view.y) / view.w * w, w);
  const q = boardPoint({ clientX, clientY });
  setView(view.x + p.x - q.x, view.y + p.y - q.y, view.w);
}

/** @param {number} clientX @param {number} clientY @param {number} factor */
function zoomAt(clientX, clientY, factor) {
  viewAt(boardPoint({ clientX, clientY }), clientX, clientY, view.w / factor);
}

/** @param {number} factor */
function zoomCentered(factor) {
  const r = board.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

/** @param {boolean} on */
function setSpace(on) {
  spaceDown = on;
  board.classList.toggle('pan', on);
}

function pinchState() {
  const [a, b] = [...touches.values()];
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
}

function cancelStroke() {
  if (gesture) { gesture = null; live.replaceChildren(); }
  if (erasing) { erasing = null; renderInk(); }
  if (cutting) { cutting = null; renderInk(); }
  filling = false;
  refDrag = null;
  selector.cancel();
}

board.addEventListener('wheel', e => {
  e.preventDefault();
  const px = e.deltaMode === 1 ? LINE_PX : 1;
  if (e.ctrlKey || e.metaKey) {
    const dy = Math.min(WHEEL_CAP, Math.max(-WHEEL_CAP, e.deltaY * px));
    zoomAt(e.clientX, e.clientY, Math.exp(-dy * WHEEL_ZOOM));
  } else {
    const s = pxPerUnit();
    setView(view.x + e.deltaX * px / s, view.y + e.deltaY * px / s, view.w);
  }
}, { passive: false });

board.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.button !== 1) return;
  const menu = document.querySelector(':popover-open');
  if (menu instanceof HTMLElement) return menu.hidePopover();
  board.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size > 1) {
      cancelStroke();
      pinch = pinchState();
      return;
    }
  }
  if (e.button === 1 || spaceDown) {
    panDrag = { x: e.clientX, y: e.clientY };
    board.classList.add('panning');
    return;
  }
  stopReplay();
  if (e.altKey || picking) return pickAt(e);
  if (refMove) {
    const p = boardPoint(e);
    refDrag = { px: p.x, py: p.y, x: refPose.x, y: refPose.y };
    return;
  }
  if (tool === 'select') {
    selector.down(e);
    return;
  }
  if (tool === 'fill') {
    filling = true;
    return;
  }
  if (cutMode()) {
    const p = boardPoint(e);
    cutting = { strokes, last: [p.x, p.y], blocked: false };
    cutAt(e);
    return;
  }
  if (tool === 'eraser') {
    erasing = new Set();
    eraseAt(e, erasing);
    return;
  }
  const now = Date.now();
  sessionStart ??= now - S.endTime(strokes) - (strokes.length ? STROKE_GAP_MS : 0);
  const p = gridPoint(toCanvas(e));
  gesture = { tool, color, weight, startOffset: now - sessionStart, t0: e.timeStamp, a: p, b: p, dur: 0, points: [[...p, 0]], brush: p, anchor: null };
  renderLive(gesture);
});

board.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch) {
      const next = pinchState();
      viewAt(boardPoint({ clientX: pinch.x, clientY: pinch.y }), next.x, next.y, view.w * pinch.d / next.d);
      pinch = next;
      return;
    }
  }
  if (panDrag) {
    const s = pxPerUnit();
    setView(view.x - (e.clientX - panDrag.x) / s, view.y - (e.clientY - panDrag.y) / s, view.w);
    panDrag.x = e.clientX;
    panDrag.y = e.clientY;
    return;
  }
  if (refDrag) {
    const p = boardPoint(e);
    refPose.x = S.r2(refDrag.x + p.x - refDrag.px);
    refPose.y = S.r2(refDrag.y + p.y - refDrag.py);
    applyRef();
    return;
  }
  if (selector.busy) {
    selector.move(e);
    return;
  }
  if (cutting) {
    for (const ev of e.getCoalescedEvents?.() ?? [e]) cutAt(ev);
    return;
  }
  if (erasing) {
    for (const ev of e.getCoalescedEvents?.() ?? [e]) eraseAt(ev, erasing);
    return;
  }
  if (!gesture) return;
  for (const ev of e.getCoalescedEvents?.() ?? [e]) {
    const p = toCanvas(ev);
    const t = Math.max(0, Math.round(ev.timeStamp - gesture.t0));
    if (gesture.tool === 'pen') {
      const s = pxPerUnit();
      P.penMove(gesture, p, t, { radius: P.ropeRadius(prec.smoothing, s), minStep: P.minStepFor(prec.smoothing, s), shift: e.shiftKey });
    } else {
      gesture.b = P.constrainShape(gesture.tool, gesture.a, gridPoint(p), e.shiftKey);
      gesture.dur = Math.max(MIN_SHAPE_MS, t);
    }
  }
  renderLive(gesture);
});

/** @param {PointerEvent} e */
const endPointer = e => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (panDrag) {
    panDrag = null;
    board.classList.remove('panning');
  } else if (refDrag) refDrag = null;
  else if (selector.busy) selector.up();
  else if (filling) {
    filling = false;
    if (e.type === 'pointerup') fillAt(e);
  } else if (cutting) {
    const done = cutting;
    cutting = null;
    if (done.strokes !== strokes) commit(done.strokes);
  } else if (erasing) {
    const gone = erasing;
    erasing = null;
    if (gone.size) commit(strokes.filter(s => !gone.has(s)));
  } else if (gesture) {
    if (gesture.tool === 'pen' && e.type === 'pointerup') P.penEnd(gesture, toCanvas(e), Math.max(0, Math.round(e.timeStamp - gesture.t0)));
    finishGesture(gesture);
  }
};
board.addEventListener('pointermove', placeRing);
board.addEventListener('pointerleave', () => { ring.style.display = 'none'; });
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);

function pillButtons(id, cls, items) {
  $(id).replaceChildren(...items.map(({ content, on, pick, title }) => {
    const b = document.createElement('button');
    b.append(content);
    b.title = title || '';
    b.className = cls;
    b.setAttribute('aria-pressed', String(!!on));
    b.onclick = () => { pick(); buildBars(); };
    return b;
  }));
}

function span(cls, style = {}, text = '') {
  const s = document.createElement('span');
  s.className = cls;
  Object.assign(s.style, style);
  s.textContent = text;
  return s;
}

function icon(name, glyph) {
  const i = document.createElement('i');
  i.className = `icon-${name} drawing-font-icon`;
  i.dataset.glyph = glyph;
  return i;
}

const toolButtons = Object.entries(TOOLS).map(([t, content]) => {
  const b = document.createElement('button');
  b.className = 'drawing-tool-circle';
  b.dataset.tool = t;
  if (TOOL_OPTIONS[t]) b.dataset.opts = '';
  const key = Object.keys(TOOL_KEYS).find(k => TOOL_KEYS[k] === t)?.toUpperCase();
  b.title = `${t[0].toUpperCase()}${t.slice(1)} (${key})${TOOL_OPTIONS[t] ? ', tap again for options' : ''}`;
  b.append(content());
  b.onclick = e => {
    if (tool === t) return;
    e.preventDefault();
    tool = t;
    buildBars();
  };
  return b;
});
$('tools').append(...toolButtons);
$('selectTool').onclick = () => { tool = 'select'; buildBars(); };

function buildBars() {
  for (const b of toolButtons) {
    const t = String(b.dataset.tool);
    b.setAttribute('aria-pressed', String(tool === t));
    b.popoverTargetElement = tool === t && TOOL_OPTIONS[t] ? $(TOOL_OPTIONS[t]) : null;
  }
  $('selectTool').setAttribute('aria-pressed', String(tool === 'select'));
  const tokens = [...Object.keys(S.BASE_COLORS), ...customColors];
  pillButtons('colors', 'drawing-color-ring', tokens.map(t => ({
    content: span('drawing-color-swatch', { background: S.entryFor(t, palette)[isDark() ? 'dark' : 'light'] }),
    title: t, on: color === t && tool !== 'eraser', pick: () => { color = t; if (tool === 'eraser') tool = 'pen'; selector.paint(t); },
  })));
  board.classList.toggle('erasing', tool === 'eraser');
  setPicking(false);
  selector.sync(tool);
  board.classList.toggle('cutter', cutMode());
  board.classList.toggle('filling', tool === 'fill');
  $('colorDot').style.background = S.entryFor(color, palette)[isDark() ? 'dark' : 'light'];
  showWeight();
}

const sizeRail = $('weightRail');
const railFraction = w => String((w - S.LIMITS.minWeight) / (S.LIMITS.maxWeight - S.LIMITS.minWeight));
sizeRail.prepend(...S.SIZES.map(w => {
  const stop = span('rail-stop');
  stop.style.setProperty('--f', railFraction(w));
  return stop;
}));
sizeRail.onpointerenter = showWeight;
let railFlash = 0;

function showWeight() {
  $('weight').value = String(weight);
  $('weightOut').textContent = String(weight);
  sizeRail.style.setProperty('--f', railFraction(weight));
  const d = Math.max(2, S.STROKE_SCALE * weight * board.clientWidth / W) + 'px';
  Object.assign($('weightDot').style, { width: d, height: d, background: S.entryFor(color, palette)[isDark() ? 'dark' : 'light'] });
}

function setWeight(w) {
  weight = Math.min(S.LIMITS.maxWeight, Math.max(S.LIMITS.minWeight, w));
  if (tool === 'eraser' && !cutMode()) tool = 'pen';
  selector.reweight(weight);
  buildBars();
  sizeRail.classList.add('showing');
  clearTimeout(railFlash);
  railFlash = setTimeout(() => sizeRail.classList.remove('showing'), 800);
}

function updateStats() {
  const points = strokes.reduce((a, s) => a + s.points.length, 0);
  const colours = new Set(strokes.map(s => s.color)).size;
  const parts = [[strokes.length, S.LIMITS.strokes, 'strokes'], [points, S.LIMITS.points, 'points'], [colours, S.LIMITS.palette, 'colours']]
    .map(([n, max, label]) => ({ over: n > max, text: `${n.toLocaleString()} / ${max.toLocaleString()} ${label}` }));
  const over = parts.find(p => p.over);
  const stats = $('stats');
  stats.replaceChildren(icon('drawing', '✎'), over ? over.text : `${strokes.length}/${S.LIMITS.strokes}`);
  stats.title = parts.map(p => p.text).join(' · ');
  stats.classList.toggle('drawing-count-limit', !!over);
  $('badge').hidden = strokes.every(S.isStandard);
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
}

function payload() {
  return { target_user: Number($('target').value), sdj: S.buildSdj(strokes, palette), render: $('render').checked };
}

function writeJson() { $('out').value = JSON.stringify(payload()); }

function useSdj(sdj, { append = false } = {}) {
  const custom = Object.fromEntries(Object.entries(sdj.palette || {}).filter(([k, v]) => {
    const base = S.baseEntry(k);
    return !base || base.light.toLowerCase() !== v.light.toLowerCase() || base.dark.toLowerCase() !== v.dark.toLowerCase();
  }));
  palette = { ...palette, ...custom };
  for (const t of Object.keys(custom)) if (!customColors.includes(t) && t !== S.CANVAS_TOKEN) customColors.push(t);
  const shift = append && strokes.length ? S.endTime(strokes) + STROKE_GAP_MS : 0;
  const incoming = sdj.strokes.map(s => ({ ...s, startOffset: (s.startOffset || 0) + shift, points: s.points.map(p => [p[0], p[1], p[2] || 0]) }));
  commit(append ? [...strokes, ...incoming] : incoming);
  buildBars();
}

/** @param {string} key @param {S.Polyline[]} polylines @param {S.Palette} [extraPalette] */
function applyImport(key, polylines, extraPalette = {}) {
  const base = lastImport && lastImport.key === key ? lastImport.before : strokes;
  const start = base.length ? S.endTime(base) + STROKE_GAP_MS : 0;
  const added = S.timed(polylines, start);
  palette = { ...palette, ...extraPalette };
  for (const t of Object.keys(extraPalette)) if (!customColors.includes(t)) customColors.push(t);
  if (lastImport?.key === key) {
    strokes = [...base, ...added];
    changed();
  } else {
    commit([...base, ...added], { keepImport: true });
    lastImport = { key, before: base };
  }
  buildBars();
  const err = S.validate(S.buildSdj(strokes, palette));
  say(err && err !== 'nothing drawn' ? `imported ${added.length} strokes, but ${err}` : `imported ${added.length} strokes`, !!err && err !== 'nothing drawn');
}

const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r)));

let busyRun = 0;
/**
 * @param {string} label
 * @param {(onProgress: (fraction: number) => void, current: () => boolean) => Promise<void>} work
 */
async function busy(label, work) {
  const run = ++busyRun;
  document.body.classList.add('busy');
  progressBar.hidden = false;
  progressBar.removeAttribute('value');
  say(label + '...');
  await nextPaint();
  try {
    await work(fraction => { progressBar.value = fraction; }, () => run === busyRun);
  } finally {
    if (run === busyRun) {
      document.body.classList.remove('busy');
      progressBar.hidden = true;
    }
  }
}

/** @type {{ text: string, remix: boolean } | null} */
let svgSource = null;
function runSvg(key = 'svg') {
  if (!svgSource) return;
  const source = svgSource;
  return busy('importing svg', async (onProgress, current) => {
    try {
      const { polylines, palette: extra, dropped } = await importSvg(source.text,
        { fills: $('svgFills').value, colors: $('svgColors').value, remix: source.remix, onProgress });
      if (!current()) return;
      applyImport(key, polylines, extra);
      if (dropped) say(`${$('status').textContent}, ${dropped} smallest pieces dropped to stay within ${S.LIMITS.strokes} strokes`);
    } catch (err) { say('svg import failed: ' + errorText(err), true); }
  });
}

/** @param {unknown} err */
const errorText = err => err instanceof Error ? err.message : String(err);

/** @type {{ bitmap: ImageBitmap, key: string } | null} */
let photoSource = null;
function runPhoto() {
  if (!photoSource) return;
  const source = photoSource;
  return busy('tracing', async () => {
    applyImport(source.key, photoToPolylines(source.bitmap, {
      mode: $('photoMode').value, detail: Number($('photoDetail').value), minLength: Number($('photoMin').value),
      color, weight, photoColors: $('photoColors').checked,
      zoom: Number($('photoZoom').value), panX: Number($('photoPanX').value), panY: Number($('photoPanY').value),
    }));
  });
}

/** @type {string | null} */
let textKey = null;
function runText() {
  const text = $('text').value.trim();
  if (!text) return say('type some text first', true);
  const key = textKey ??= 'text:' + Date.now();
  return busy('writing', async () => {
    applyImport(key, textToPolylines(text, {
      font: $('font').value, size: Number($('textSize').value), align: $('textAlign').value, color, weight,
    }));
  });
}

/** @param {{ friends: DoodlerFriend[], current: number | null }} data */
function setFriends({ friends, current }) {
  friendSelect.append(...friends.map(f => {
    const o = document.createElement('option');
    o.value = String(f.userId);
    o.textContent = f.country ? `${f.name} (${f.country.toUpperCase()})` : f.name;
    return o;
  }));
  if (current) $('target').value = String(current);
  syncFriend();
  writeJson();
}

function syncFriend() {
  const match = [...friendSelect.options].find(o => o.value && o.value === $('target').value);
  friendSelect.value = match ? match.value : '';
}

/** @param {() => void} fn */
function debounce(fn, ms = 160) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

/** @param {string} prefix @param {() => void} fn */
function rerunIf(prefix, fn) {
  return debounce(() => { if (lastImport?.key?.startsWith(prefix)) fn(); });
}

/** @param {S.Stroke[]} list */
function compressedStarts(list) {
  const order = list.map((s, i) => i).sort((a, b) => list[a].startOffset - list[b].startOffset);
  const starts = new Array(list.length);
  let shift = 0, end = -Infinity;
  for (const i of order) {
    const s = list[i];
    const gap = s.startOffset - end;
    if ($('compress').checked && end > -Infinity && gap > GAP_CAP_MS) shift += gap - GAP_CAP_MS;
    starts[i] = s.startOffset - shift;
    end = Math.max(end, s.startOffset + s.points[s.points.length - 1][2]);
  }
  return starts;
}

function startReplay() {
  if (!strokes.length) return;
  selector.clear();
  const starts = compressedStarts(strokes);
  const els = strokes.map(s => pathEl([], s.color, s.weight));
  const shown = new Array(strokes.length).fill(0);
  ink.replaceChildren(...els);
  const t0 = performance.now(), speed = Number($('replaySpeed').value);
  const frame = () => {
    const t = (performance.now() - t0) * speed;
    let done = true;
    strokes.forEach((s, i) => {
      const local = t - starts[i];
      let n = 0;
      if (local >= 0) while (n < s.points.length && s.points[n][2] <= local) n++;
      if (n < s.points.length) done = false;
      if (n !== shown[i]) { shown[i] = n; els[i].setAttribute('d', n ? S.pathD(s.points.slice(0, n)) : ''); }
    });
    if (done) stopReplay();
    else replay = requestAnimationFrame(frame);
  };
  replay = requestAnimationFrame(frame);
  $('replay').replaceChildren(icon('pause', '■'));
}

function stopReplay() {
  if (replay === null) return;
  cancelAnimationFrame(replay);
  replay = null;
  $('replay').replaceChildren(icon('play_arrow', '▶'));
  renderInk();
}

/** @param {S.Sdj} sdj */
function thumbnail(sdj) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sdj.canvas.width} ${sdj.canvas.height}`);
  const dark = isDark();
  for (const s of sdj.strokes) {
    const el = document.createElementNS(NS, 'path');
    const entry = sdj.palette[s.color] || S.entryFor(s.color, {});
    el.setAttribute('d', S.pathD(s.points));
    el.setAttribute('stroke', dark ? entry.dark : entry.light);
    el.setAttribute('stroke-width', String(S.STROKE_SCALE * s.weight));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(el);
  }
  return svg;
}

/**
 * @param {string} label
 * @param {(...args: any[]) => unknown} fn
 */
const libOp = (label, fn) => (/** @type {any[]} */ ...a) => new Promise(r => r(fn(...a))).catch(err => say(`${label} failed: ${err.message}`, true));
const showLibrary = libOp('library', async () => renderLibrary(await lib.listDrawings()));

/** @type {import('./library.js').LibItem[]} */
let libItems = [];
/** @type {string | null} */
let openedId = null;

function syncSaveBar() {
  const item = libItems.find(i => i.id === openedId);
  openedId = item?.id ?? null;
  $('libUpdate').hidden = !item;
  $('libOpened').hidden = !item;
  $('libOpened').textContent = item ? `Editing "${item.name}". Update replaces it, Save as new keeps both.` : '';
  $('libSave').textContent = item ? 'Save as new' : 'Save';
  $('libSave').className = `btn ${item ? 'btn-outline-light' : 'btn-primary'}`;
}

const fileName = (/** @type {string} */ name) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'drawing';

/** @param {import('./library.js').LibItem[]} items */
function renderLibrary(items) {
  libItems = items;
  syncSaveBar();
  if (!items.length) {
    $('libList').replaceChildren(span('hint', {}, 'Nothing saved yet.'));
    return;
  }
  $('libList').replaceChildren(...items.map(item => {
    const card = document.createElement('div');
    card.className = item.id === openedId ? 'card shadow-sm current' : 'card shadow-sm';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = span('name', {}, item.name);
    title.tabIndex = 0;
    title.title = 'Click to rename';
    const editName = () => {
      const input = Object.assign(document.createElement('input'), { className: 'form-control form-control-sm', value: item.name });
      let done = false;
      const finish = (/** @type {boolean} */ save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        renderLibrary(libItems);
        if (save && name && name !== item.name) libOp('rename', async () => renderLibrary(await lib.updateDrawing(item.id, { name })))();
      };
      input.onkeydown = e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
      input.onblur = () => finish(true);
      title.replaceWith(input);
      input.focus();
      input.select();
    };
    title.onclick = editName;
    title.onkeydown = e => { if (e.key === 'Enter') editName(); };
    meta.append(title,
      span('hint', {}, `${new Date(item.savedAt).toLocaleDateString()} · ${item.sdj.strokes.length} strokes`));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const act = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'btn btn-outline-light btn-sm';
      b.textContent = label;
      b.onclick = libOp(label.toLowerCase(), fn);
      actions.append(b);
    };
    act('Open', () => { useSdj(item.sdj); openedId = item.id; renderLibrary(libItems); say(`opened "${item.name}"`); });
    act('Add', () => { useSdj(item.sdj, { append: true }); say(`added "${item.name}"`); });
    act('Download', () => lib.exportFile(`${fileName(item.name)}.doodler.json`, [item]));
    act('Delete', async e => {
      if (e.currentTarget.dataset.armed !== '1') { e.currentTarget.dataset.armed = '1'; e.currentTarget.textContent = 'Sure?'; return; }
      renderLibrary(await lib.removeDrawing(item.id));
    });
    card.append(thumbnail(item.sdj), meta, actions);
    return card;
  }));
}

$('undo').onclick = () => restore(undoStack, redoStack);
$('redo').onclick = () => restore(redoStack, undoStack);
$('clear').onclick = () => {
  if (strokes.length) commit([]);
  openedId = null;
  renderLibrary(libItems);
};
$('replay').onclick = () => replay === null ? startReplay() : stopReplay();
$('dark').onchange = () => {
  document.documentElement.classList.toggle('theme-dark', $('dark').checked);
  buildBars();
  renderInk();
  renderLibrary(libItems);
};
const SYMMETRY_SELECTS = ['symmetry', 'symmetryBrush'];
for (const id of SYMMETRY_SELECTS) {
  $(id).replaceChildren(...Object.entries(SYMMETRY).map(([k, v]) => new Option(v.label, k)));
  $(id).onchange = () => {
    symmetry = $(id).value;
    for (const other of SYMMETRY_SELECTS) $(other).value = symmetry;
  };
}
$('eraserMode').onchange = buildBars;
for (const [id, unit] of [['fillAngle', '°'], ['fillSpacing', '×']]) $(id).addEventListener('input', () => { $(`${id}Out`).textContent = $(id).value + unit; });
$('rainbow').onchange = () => { rainbow = $('rainbow').checked; };
$('gridSpacing').replaceChildren(...P.GRID_SPACINGS.map(n => new Option(`${n} units`, String(n))));
function applyPrecision() {
  $('smoothing').value = String(prec.smoothing);
  $('smoothingOut').textContent = String(prec.smoothing);
  $('smoothingRail').style.setProperty('--f', String(prec.smoothing / 100));
  $('gridOn').checked = prec.grid;
  $('snapOn').checked = prec.snap;
  $('gridSpacing').value = String(prec.spacing);
  P.renderGuides(guides, prec.grid ? prec.spacing : 0);
  P.saveSettings(prec);
}
$('smoothing').oninput = () => { prec.smoothing = Number($('smoothing').value); applyPrecision(); };
$('gridOn').onchange = () => { prec.grid = $('gridOn').checked; applyPrecision(); };
$('snapOn').onchange = () => { prec.snap = $('snapOn').checked; applyPrecision(); };
$('gridSpacing').onchange = () => { prec.spacing = Number($('gridSpacing').value); applyPrecision(); };
applyPrecision();
$('weight').oninput = () => setWeight(Number($('weight').value));
$('addColor').onclick = () => {
  const hex = $('customColor').value.toLowerCase();
  const t = S.customToken(hex);
  palette = { ...palette, [t]: { light: hex, dark: hex } };
  if (!customColors.includes(t)) customColors.push(t);
  color = t;
  if (tool === 'eraser') tool = 'pen';
  selector.paint(t);
  buildBars();
};

$('refFile').onchange = () => {
  const f = $('refFile').files?.[0];
  if (!f) return;
  const img = document.createElementNS(NS, 'image');
  img.setAttribute('href', URL.createObjectURL(f));
  img.setAttribute('width', String(W));
  img.setAttribute('height', String(H));
  img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  img.setAttribute('opacity', $('refOpacity').value);
  img.style.pointerEvents = 'none';
  ref.replaceChildren(img);
  resetRef();
  $('refFile').value = '';
};
$('refOpacity').oninput = () => {
  ref.firstElementChild?.setAttribute('opacity', $('refOpacity').value);
  $('refOpacityOut').textContent = Math.round(Number($('refOpacity').value) * 100) + '%';
};
$('refClear').onclick = () => { ref.replaceChildren(); setRefMove(false); };

function applyRef() {
  const { x, y, rot, flip, scale } = refPose;
  ref.setAttribute('transform', `translate(${x} ${y}) translate(${W / 2} ${H / 2}) rotate(${rot}) scale(${flip * scale} ${scale}) translate(${-W / 2} ${-H / 2})`);
  $('refScaleOut').textContent = scale + '×';
}
function resetRef() {
  refPose = { x: 0, y: 0, rot: 0, flip: 1, scale: 1 };
  $('refScale').value = '1';
  applyRef();
}
/** @param {boolean} on */
function setRefMove(on) {
  refMove = on && !!ref.firstChild;
  $('refMove').setAttribute('aria-pressed', String(refMove));
  board.classList.toggle('moving', refMove);
}
$('refMove').onclick = () => setRefMove(!refMove);
$('refRotate').onclick = () => { refPose.rot = (refPose.rot + 90) % 360; applyRef(); };
$('refFlip').onclick = () => { refPose.flip = -refPose.flip; applyRef(); };
$('refScale').oninput = () => { refPose.scale = Number($('refScale').value); applyRef(); };
$('refReset').onclick = resetRef;

$('svgFile').onchange = async () => {
  const f = $('svgFile').files?.[0];
  if (!f) return;
  svgSource = { text: await f.text(), remix: false };
  lastImport = null;
  runSvg('svg:' + Date.now());
  $('svgFile').value = '';
};
const rerunSvg = rerunIf('svg', () => lastImport && runSvg(lastImport.key));
$('svgFills').onchange = rerunSvg;
$('svgColors').onchange = rerunSvg;

$('photoFile').onchange = async () => {
  const f = $('photoFile').files?.[0];
  if (!f) return;
  photoSource = { bitmap: await createImageBitmap(f), key: 'photo:' + Date.now() };
  $('photoFile').value = '';
  for (const id of ['photoZoom', 'photoPanX', 'photoPanY']) {
    $(id).value = $(id).defaultValue;
    $(id + 'Out').textContent = $(id).value + (id === 'photoZoom' ? '×' : '');
  }
  runPhoto();
};
const rerunPhoto = rerunIf('photo', runPhoto);
for (const id of ['photoMode', 'photoDetail', 'photoMin', 'photoZoom', 'photoPanX', 'photoPanY', 'photoColors']) $(id).addEventListener('input', rerunPhoto);
for (const [id, out, unit] of [['photoDetail', 'photoDetailOut', ''], ['photoMin', 'photoMinOut', ''], ['textSize', 'textSizeOut', ''],
  ['photoZoom', 'photoZoomOut', '×'], ['photoPanX', 'photoPanXOut', ''], ['photoPanY', 'photoPanYOut', '']])
  $(id).addEventListener('input', () => { $(out).textContent = $(id).value + unit; });

$('writeText').onclick = () => { textKey = null; lastImport = null; runText(); };
const rerunText = rerunIf('text', runText);
for (const id of ['font', 'textSize', 'textAlign']) $(id).addEventListener('input', rerunText);

$('libSave').onclick = libOp('save', async () => {
  if (!strokes.length) return say('nothing to save', true);
  const name = $('libName').value.trim() || new Date().toLocaleString();
  const items = await lib.saveDrawing(name, S.buildSdj(strokes, palette));
  openedId = items[0].id;
  renderLibrary(items);
  $('libName').value = '';
  say(`saved "${name}"`);
});
$('libUpdate').onclick = libOp('update', async () => {
  if (!strokes.length) return say('nothing to save', true);
  const name = $('libName').value.trim();
  const id = String(openedId);
  const items = await lib.updateDrawing(id, { sdj: S.buildSdj(strokes, palette), savedAt: Date.now(), ...(name && { name }) });
  renderLibrary(items);
  $('libName').value = '';
  say(`updated "${items.find(i => i.id === id)?.name}"`);
});
$('libExport').onclick = libOp('export', async () => {
  const items = await lib.listDrawings();
  if (!items.length) return say('nothing to export', true);
  lib.exportFile(`doodler-library-${new Date().toISOString().slice(0, 10)}.json`, items);
  say(`exported ${items.length}`);
});
$('libImport').onchange = libOp('import', async (/** @type {Event} */ e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const { items, added, skipped } = await lib.importDrawings(await f.text());
  renderLibrary(items);
  say(`imported ${added}` + (skipped ? `, skipped ${skipped} (already in the library or invalid)` : ''));
});

$('copy').onclick = async () => {
  writeJson();
  try { await navigator.clipboard.writeText($('out').value); say('copied'); }
  catch { $('out').select(); say('select and press Ctrl+C'); }
};
$('load').onclick = () => {
  try {
    const j = JSON.parse($('out').value);
    if (j.target_user !== undefined) { $('target').value = j.target_user; syncFriend(); }
    if (j.render !== undefined) $('render').checked = j.render;
    useSdj(j.sdj || j);
    say(`loaded ${strokes.length} strokes`);
  } catch (err) { say('bad json: ' + errorText(err), true); }
};
$('target').oninput = () => { syncFriend(); writeJson(); };
$('friend').onchange = () => { if ($('friend').value) $('target').value = $('friend').value; writeJson(); };
$('render').onchange = writeJson;

$('tabs').onclick = e => {
  if (!(e.target instanceof Element)) return;
  const tab = /** @type {HTMLElement | null} */ (e.target.closest('[data-tab]'))?.dataset.tab;
  if (!tab) return;
  e.preventDefault();
  for (const a of $('tabs').querySelectorAll('[data-tab]')) {
    const on = a.getAttribute('data-tab') === tab;
    a.classList.toggle('active', on);
    a.setAttribute('aria-selected', String(on));
  }
  for (const p of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.panel'))) p.hidden = p.dataset.panel !== tab;
};
$('popGallery').addEventListener('toggle', e => { if (/** @type {ToggleEvent} */ (e).newState === 'open') showLibrary(); });
for (const pop of document.querySelectorAll('[popover]')) pop.addEventListener('toggle', e => {
  document.querySelector(`[popovertarget=${pop.id}]`)?.classList.toggle('open', /** @type {ToggleEvent} */ (e).newState === 'open');
});
$('pick').onclick = () => setPicking(!picking);
for (const label of /** @type {NodeListOf<HTMLLabelElement>} */ (document.querySelectorAll('label.btn'))) label.onkeydown = e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  label.click();
};

document.addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.closest(TYPING_TARGET)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
    e.preventDefault();
    if (k === 'y' || e.shiftKey) restore(redoStack, undoStack); else restore(undoStack, redoStack);
  } else if (k === ' ') { e.preventDefault(); setSpace(true); }
  else if (ZOOM_KEYS[k]) { e.preventDefault(); zoomCentered(ZOOM_KEYS[k]); }
  else if (k === '0') { e.preventDefault(); setView(0, 0, W); }
  else if (!e.ctrlKey && !e.metaKey && k === 'i') setPicking(!picking);
  else if (!e.ctrlKey && !e.metaKey && k === 'g') { prec.grid = !prec.grid; applyPrecision(); }
  else if (!e.ctrlKey && !e.metaKey && TOOL_KEYS[k]) { tool = TOOL_KEYS[k]; buildBars(); }
  else if (k === '[') setWeight(weight - 0.5);
  else if (k === ']') setWeight(weight + 0.5);
});
document.addEventListener('keyup', e => {
  if (e.key !== ' ') return;
  setSpace(false);
  if (!(e.target instanceof Element && e.target.closest(TYPING_TARGET))) e.preventDefault();
});
document.addEventListener('change', e => { if (e.target instanceof HTMLSelectElement) e.target.blur(); });
window.addEventListener('blur', () => setSpace(false));
$('zoom').onclick = () => setView(0, 0, W);

$('prefsTab').hidden = embedded;
$('close').hidden = !embedded;
$('close').onclick = () => window.parent.postMessage({ type: 'doodler:close' }, SLOWLY_ORIGIN);
const send = $('send');
send.hidden = !embedded;
send.onclick = () => {
  const sdj = S.buildSdj(S.simplifyStrokes(strokes), palette);
  const err = S.validate(sdj);
  if (err) return say(err, true);
  window.parent.postMessage({ type: 'doodler:sdj', sdj }, SLOWLY_ORIGIN);
};

window.addEventListener('message', e => {
  if (e.source !== window.parent || e.origin !== SLOWLY_ORIGIN) return;
  if (e.data?.type === 'doodler:import-svg') {
    if (e.data.replace) commit([]);
    svgSource = { text: e.data.svg, remix: true };
    lastImport = null;
    runSvg('svg:remix:' + Date.now())?.then(() => say(e.data.replace
      ? 'attached drawing loaded, sending replaces it' : 'drawing loaded, draw on top of it'));
  } else if (e.data?.type === 'doodler:friends') setFriends(e.data);
});

const working = await lib.loadWorking();
if (working?.sdj?.strokes?.length) {
  customColors = working.customColors || [];
  useSdj(working.sdj);
  undoStack = [];
}
buildBars();
changed();
if (embedded) window.parent.postMessage({ type: 'doodler:ready' }, SLOWLY_ORIGIN);
