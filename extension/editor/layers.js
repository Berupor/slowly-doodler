import { endTime } from './sdj.js';

/** @typedef {{ id: string, name: string, hidden: boolean, locked: boolean }} Layer */
/** @typedef {{ list: Layer[], active: string, of: number[] }} Packed */
/** @typedef {import('./sdj.js').Stroke} Stroke */

export const MAX_LAYERS = 10;
export const NAME_MAX = 40;
export const BACKGROUND = 'Background';

/** @param {string} name @param {string} [id] @returns {Layer} */
const layer = (name, id = 'l1') => ({ id, name: name.slice(0, NAME_MAX), hidden: false, locked: false });

/** @param {string} [name] @returns {{ layers: Layer[], active: string }} */
export const initial = (name = 'Layer 1') => ({ layers: [layer(name)], active: 'l1' });

/** @param {Layer[]} layers */
export const nextId = layers => 'l' + (Math.max(0, ...layers.map(l => Number(l.id.slice(1)) || 0)) + 1);

/** @param {Layer[]} layers */
export function nextName(layers) {
  const used = layers.map(l => /^Layer (\d+)$/.exec(l.name)).map(m => (m ? Number(m[1]) : 0));
  return `Layer ${Math.max(layers.length, ...used) + 1}`;
}

/** @param {Layer[]} layers @param {string} id @returns {string | null} why new strokes cannot go to this layer */
export function blocked(layers, id) {
  const l = layers.find(x => x.id === id);
  if (!l) return 'no layer is selected';
  if (l.hidden) return `"${l.name}" is hidden, show it or pick another layer to draw`;
  if (l.locked) return `"${l.name}" is locked, unlock it or pick another layer to draw`;
  return null;
}

/** @param {Layer[]} layers */
export const shownIds = layers => new Set(layers.filter(l => !l.hidden).map(l => l.id));
/** @param {Layer[]} layers the eraser and lasso only see these */
export const editableIds = layers => new Set(layers.filter(l => !l.hidden && !l.locked).map(l => l.id));

/** @param {Stroke[]} strokes @param {Layer[]} layers */
export function editable(strokes, layers) {
  const ok = editableIds(layers);
  return strokes.filter(s => ok.has(String(s.layer)));
}

/** @param {Stroke[]} strokes @param {Layer[]} layers */
export function visible(strokes, layers) {
  const ok = shownIds(layers);
  return strokes.filter(s => ok.has(String(s.layer)));
}

/** @param {Stroke[]} strokes @param {Layer[]} layers grouped bottom layer first, order within a layer kept; the same array when already so */
export function order(strokes, layers) {
  const rank = new Map(layers.map((l, i) => [l.id, i]));
  const at = (/** @type {Stroke} */ s) => rank.get(String(s.layer)) ?? layers.length;
  if (strokes.every((s, i) => i === 0 || at(strokes[i - 1]) <= at(s))) return strokes;
  return strokes.map((s, i) => ({ s, i })).sort((a, b) => at(a.s) - at(b.s) || a.i - b.i).map(x => x.s);
}

/** @param {Stroke[]} all @param {Layer[]} layers @param {Stroke[]} edited new contents of the editable layers */
export function replaceEditable(all, layers, edited) {
  const ok = editableIds(layers);
  return order([...all.filter(s => !ok.has(String(s.layer))), ...edited], layers);
}

/**
 * Visible strokes bottom layer first, as one SDJ timeline: a layer that starts before the layers under it end
 * is shifted to start gapMs after them; each stroke keeps its own point timing.
 * @param {Stroke[]} strokes @param {Layer[]} layers @param {number} gapMs @returns {Stroke[]}
 */
export function flatten(strokes, layers, gapMs) {
  /** @type {Stroke[]} */
  const out = [];
  let end = -Infinity;
  for (const l of layers) {
    if (l.hidden) continue;
    const own = strokes.filter(s => s.layer === l.id);
    if (!own.length) continue;
    const first = Math.min(...own.map(s => s.startOffset));
    const shift = Math.max(0, end + gapMs - first);
    out.push(...own.map(s => (shift ? { ...s, startOffset: s.startOffset + shift } : s)));
    end = endTime(own) + shift;
  }
  return out;
}

/** @param {Layer[]} layers @param {string | null} active @param {string} name @returns {{ layers: Layer[], active: string }} new layer just above the active one, at the bottom for null */
export function add(layers, active, name) {
  const made = layer(name, nextId(layers));
  const at = active === null ? 0 : layers.findIndex(l => l.id === active) + 1 || layers.length;
  return { layers: [...layers.slice(0, at), made, ...layers.slice(at)], active: made.id };
}

/** @param {Layer[]} layers @param {string} id @param {Partial<Layer>} patch */
export const update = (layers, id, patch) => layers.map(l => (l.id === id ? { ...l, ...patch, id } : l));

/** @param {Layer[]} layers @param {string} id @param {number} delta +1 moves the layer up, towards the top */
export function move(layers, id, delta) {
  const i = layers.findIndex(l => l.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= layers.length) return layers;
  const next = [...layers];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * @param {Stroke[]} strokes @param {Layer[]} layers @param {string} id
 * @returns {{ strokes: Stroke[], layers: Layer[], active: string } | null} null for the only layer
 */
export function remove(strokes, layers, id) {
  const i = layers.findIndex(l => l.id === id);
  if (i < 0 || layers.length < 2) return null;
  const rest = layers.filter(l => l.id !== id);
  return { strokes: strokes.filter(s => s.layer !== id), layers: rest, active: rest[Math.max(0, i - 1)].id };
}

/**
 * Moves the strokes of the layer into the one below, on top of what is there; the lower layer keeps its name and flags.
 * @param {Stroke[]} strokes @param {Layer[]} layers @param {string} id
 * @returns {{ strokes: Stroke[], layers: Layer[], active: string } | null} null for the bottom layer
 */
export function mergeDown(strokes, layers, id) {
  const i = layers.findIndex(l => l.id === id);
  if (i < 1) return null;
  const below = layers[i - 1].id;
  const rest = layers.filter(l => l.id !== id);
  return { strokes: order(strokes.map(s => (s.layer === id ? { ...s, layer: below } : s)), rest), layers: rest, active: below };
}

/**
 * @param {Stroke[]} strokes @param {Layer[]} layers @param {string} id
 * @returns {{ strokes: Stroke[], layers: Layer[], active: string }} a copy just above, with copies of its strokes
 */
export function duplicate(strokes, layers, id) {
  const src = /** @type {Layer} */ (layers.find(l => l.id === id));
  const made = add(layers, id, `${src.name} copy`);
  const copy = { ...src, id: made.active, name: `${src.name} copy`.slice(0, NAME_MAX) };
  const list = made.layers.map(l => (l.id === made.active ? copy : l));
  const copies = strokes.filter(s => s.layer === id).map(s => ({ ...s, layer: made.active, points: s.points.map(p => /** @type {import('./sdj.js').Point} */ ([...p])) }));
  return { strokes: order([...strokes, ...copies], list), layers: list, active: made.active };
}

/** @param {Stroke[]} strokes @param {Layer[]} layers @param {string} active @returns {Packed} editor-only field stored next to an SDJ of the same strokes */
export const pack = (strokes, layers, active) => {
  const index = new Map(layers.map((l, i) => [l.id, i]));
  return { list: layers, active, of: strokes.map(s => index.get(String(s.layer)) ?? 0) };
};

/** @param {unknown} v @returns {v is Layer} */
const isLayer = v => {
  const l = /** @type {any} */ (v);
  return typeof l?.id === 'string' && /^l\d+$/.test(l.id) && typeof l.name === 'string' && typeof l.hidden === 'boolean' && typeof l.locked === 'boolean';
};

/**
 * @param {Stroke[]} sdjStrokes @param {unknown} packed anything; a missing or broken one gives a single layer
 * @returns {{ strokes: Stroke[], layers: Layer[], active: string }}
 */
export function unpack(sdjStrokes, packed) {
  const p = /** @type {any} */ (packed);
  const list = Array.isArray(p?.list) && p.list.length && p.list.length <= MAX_LAYERS && p.list.every(isLayer)
    && new Set(p.list.map((/** @type {Layer} */ l) => l.id)).size === p.list.length ? /** @type {Layer[]} */ (p.list) : null;
  const of = list && Array.isArray(p.of) && p.of.length === sdjStrokes.length && p.of.every((/** @type {unknown} */ i) => Number.isInteger(i) && Number(i) >= 0 && Number(i) < list.length) ? /** @type {number[]} */ (p.of) : null;
  if (!list || !of) {
    const one = initial();
    return { ...one, strokes: sdjStrokes.map(s => ({ ...s, layer: one.active })) };
  }
  const layers = list.map(l => ({ id: l.id, name: l.name.slice(0, NAME_MAX), hidden: l.hidden, locked: l.locked }));
  const active = layers.some(l => l.id === p.active) ? p.active : layers[layers.length - 1].id;
  return { strokes: order(sdjStrokes.map((s, i) => ({ ...s, layer: layers[of[i]].id })), layers), layers, active };
}
