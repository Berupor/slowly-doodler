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

export const listDrawings = () => get(LIBRARY_KEY, []);

export async function saveDrawing(name, sdj) {
  const items = await listDrawings();
  items.unshift({ id: crypto.randomUUID(), name, savedAt: Date.now(), sdj });
  await set(LIBRARY_KEY, items);
  return items;
}

export async function removeDrawing(id) {
  const items = (await listDrawings()).filter(i => i.id !== id);
  await set(LIBRARY_KEY, items);
  return items;
}

export const loadWorking = () => get(WORKING_KEY, null);
export const saveWorking = data => set(WORKING_KEY, data);
