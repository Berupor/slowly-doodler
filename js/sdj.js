// Mirrors the web.slowly.app drawing editor (main.*.js: wz, Ez, Tz, Wz); keep in sync when their bundle changes
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

export const r2 = v => Math.round(v * 100) / 100;

export function baseEntry(token) {
  if (token === CANVAS_TOKEN) return CANVAS_ENTRY;
  const hex = BASE_COLORS[token];
  return hex && { light: hex, dark: token === 'black' ? '#F5F5F5' : hex };
}

export function customToken(hex) { return 'c' + hex.slice(1).toLowerCase(); }

export function entryFor(token, palette) {
  return palette[token] || baseEntry(token) || { light: '#000000', dark: '#ffffff' };
}

export function isStandard(stroke) {
  return (stroke.color in BASE_COLORS || stroke.color === CANVAS_TOKEN) && SIZES.includes(stroke.weight);
}

export function pathD(points) {
  const p = points.length === 1 ? [points[0], [points[0][0] + 0.01, points[0][1]]] : points;
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++)
    d += ` Q ${p[i][0]} ${p[i][1]} ${(p[i][0] + p[i + 1][0]) / 2} ${(p[i][1] + p[i + 1][1]) / 2}`;
  const l = p[p.length - 1];
  return d + ` L ${l[0]} ${l[1]}`;
}

export function endTime(strokes) {
  return strokes.reduce((m, s) => Math.max(m, s.startOffset + (s.points[s.points.length - 1][2] || 0)), 0);
}

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
export function timed(polylines, startAt, { unitsPerMs = 0.6, gapMs = 350, minStep = 1 } = {}) {
  const out = [];
  let offset = startAt;
  for (const pl of polylines) {
    const points = [];
    let ms = 0, last = null;
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
