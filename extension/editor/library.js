/** @typedef {{ id: string, name: string, savedAt: number, sdj: import('./sdj.js').Sdj }} LibItem */

const LIBRARY_KEY = 'doodler:library';
const WORKING_KEY = 'doodler:working';
const extStorage = typeof chrome !== 'undefined' && chrome.storage?.local;

async function get(key, fallback) {
  if (extStorage) return (await extStorage.get(key))[key] ?? fallback;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}

async function set(key, value) {
  if (extStorage) return extStorage.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

/** @type {Promise<unknown>} */
let queue = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const exclusive = fn => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

const isPoint = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite);
const isStroke = s => typeof s?.color === 'string' && Number.isFinite(s.weight) && Array.isArray(s.points) && s.points.length > 0 && s.points.every(isPoint);
const isEntry = e => typeof e?.light === 'string' && typeof e.dark === 'string';
const isSdj = sdj => Number.isFinite(sdj?.canvas?.width) && Number.isFinite(sdj.canvas.height)
  && typeof sdj.palette === 'object' && sdj.palette !== null && Object.values(sdj.palette).every(isEntry)
  && Array.isArray(sdj.strokes) && sdj.strokes.every(isStroke);
const isItem = i => typeof i?.id === 'string' && i.id !== '' && typeof i.name === 'string' && Number.isFinite(i.savedAt) && isSdj(i.sdj);

export const listDrawings = () => get(LIBRARY_KEY, []);

export const saveDrawing = (name, sdj) => exclusive(async () => {
  const items = await listDrawings();
  items.unshift({ id: crypto.randomUUID(), name, savedAt: Date.now(), sdj });
  await set(LIBRARY_KEY, items);
  return items;
});

export const updateDrawing = (id, patch) => exclusive(async () => {
  const items = await listDrawings();
  const item = items.find(i => i.id === id);
  if (!item) throw new Error('the drawing is no longer in the library');
  Object.assign(item, patch);
  await set(LIBRARY_KEY, items);
  return items;
});

export const removeDrawing = id => exclusive(async () => {
  const items = (await listDrawings()).filter(i => i.id !== id);
  await set(LIBRARY_KEY, items);
  return items;
});

export const importDrawings = text => exclusive(async () => {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('not a JSON file'); }
  const incoming = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(incoming)) throw new Error('no drawings in this file');
  const valid = incoming.filter(isItem);
  if (!valid.length) throw new Error('no valid drawings in this file');
  const items = await listDrawings();
  const seen = new Set(items.map(i => i.id));
  const fresh = valid.filter(i => !seen.has(i.id) && seen.add(i.id))
    .map(({ id, name, savedAt, sdj }) => ({ id, name, savedAt, sdj }));
  if (!fresh.length) return { items, added: 0, skipped: incoming.length };
  const merged = [...items, ...fresh].sort((a, b) => b.savedAt - a.savedAt);
  await set(LIBRARY_KEY, merged);
  return { items: merged, added: fresh.length, skipped: incoming.length - fresh.length };
});

export function exportFile(filename, items) {
  const blob = new Blob([JSON.stringify({ app: 'doodler', version: 1, items })], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const loadWorking = () => get(WORKING_KEY, null);
export const saveWorking = data => set(WORKING_KEY, data);
