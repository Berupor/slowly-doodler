import { W, H, CANVAS_TOKEN, BASE_COLORS, LIMITS, STROKE_SCALE, customToken, rgbToHex, nearestBase, rdp } from './sdj.js';
import { chainRows } from './fill.js';
import { centerlines } from './raster.js';

const SHAPES = 'path,line,polyline,polygon,rect,circle,ellipse';
const NOT_RENDERED = 'defs,symbol,clipPath,mask,pattern,marker';
const PAD = 24;
const HATCH_SPACING = 5;
const HATCH_GAP = 2.5;
const HATCH_ANGLE = Math.PI / 4;
const SAMPLE_STEP = 1.5;
const POINT_BUDGET = 200000;
const MIN_STROKE_LENGTH = 2;
const MIN_ALPHA = 0.1;
const USE_DEPTH = 8;
const CENTERLINE_MAX = 10;
const CENTERLINE_PX = 2;
const EPS_FINE = 0.15, EPS_COARSE = 1.4;
const YIELD_EVERY_MS = 25;
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
const PATH_ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const XLINK = 'http://www.w3.org/1999/xlink';
const USE_OWN = ['href', 'xlink:href', 'x', 'y', 'width', 'height', 'transform', 'id'];

/** @param {string} css @returns {number[] | null} rgb with the alpha blended over white */
function parseColor(css) {
  const m = css && css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a < MIN_ALPHA) return null;
  return m.slice(1, 4).map(v => Number(v) * a + 255 * (1 - a));
}

/** @param {Element} host @param {string} id @returns {number[] | null} mean stop colour, stops inherited through href */
function gradientColor(host, id) {
  for (let el = host.querySelector(`#${CSS.escape(id)}`), n = 0; el && n < USE_DEPTH; n++) {
    const stops = [...el.querySelectorAll('stop')].map(s => parseColor(getComputedStyle(s).stopColor)).filter(c => !!c);
    if (stops.length) return [0, 1, 2].map(i => stops.reduce((a, c) => a + c[i], 0) / stops.length);
    const ref = el.getAttribute('href') || el.getAttributeNS(XLINK, 'href');
    el = ref?.startsWith('#') ? host.querySelector(`#${CSS.escape(ref.slice(1))}`) : null;
  }
  return null;
}

/** @param {Element} host @param {string} css computed fill or stroke */
function paint(host, css) {
  if (!css || css === 'none') return null;
  const url = css.match(/url\("?[^#"]*#([^")]+)"?\)/);
  return (url && gradientColor(host, url[1])) || parseColor(css.replace(/url\([^)]*\)/, ''));
}

/** @param {Element} el @param {number} own fill-opacity or stroke-opacity */
function opacity(el, own) {
  let a = own;
  for (let n = /** @type {Element | null} */ (el); n && n.namespaceURI === el.namespaceURI; n = n.parentElement) a *= Number(getComputedStyle(n).opacity);
  return a;
}

/** @param {number[] | null} rgb @param {number} a */
const faded = (rgb, a) => rgb && a >= MIN_ALPHA ? rgb.map(v => v * a + 255 * (1 - a)) : null;

/** Replaces each <use> with a group holding a copy of what it references, so shapes in symbols and defs get drawn. @param {Element} root */
function expandUses(root) {
  for (let depth = 0; depth < USE_DEPTH; depth++) {
    const uses = [...root.querySelectorAll('use')].filter(u => !u.closest(NOT_RENDERED));
    if (!uses.length) return;
    for (const use of uses) {
      const ref = use.getAttribute('href') || use.getAttributeNS(XLINK, 'href') || '';
      const target = ref.startsWith('#') ? root.querySelector(`#${CSS.escape(ref.slice(1))}`) : null;
      const doc = /** @type {Document} */ (use.ownerDocument);
      const group = doc.createElementNS(use.namespaceURI, 'g');
      for (const a of [...use.attributes]) if (!USE_OWN.includes(a.name)) group.setAttribute(a.name, a.value);
      const x = use.getAttribute('x') || 0, y = use.getAttribute('y') || 0;
      group.setAttribute('transform', `${use.getAttribute('transform') || ''} translate(${x} ${y})`);
      if (target?.localName === 'symbol') {
        const box = doc.createElementNS(use.namespaceURI, 'svg');
        for (const a of ['viewBox', 'preserveAspectRatio']) if (target.hasAttribute(a)) box.setAttribute(a, /** @type {string} */ (target.getAttribute(a)));
        box.setAttribute('width', use.getAttribute('width') || '100%');
        box.setAttribute('height', use.getAttribute('height') || '100%');
        box.append(...[...target.childNodes].map(n => n.cloneNode(true)));
        group.append(box);
      } else if (target && !target.contains(use)) group.append(target.cloneNode(true));
      for (const el of group.querySelectorAll('[id]')) el.removeAttribute('id');
      use.replaceWith(group);
    }
  }
}

function sanitize(root) {
  root.querySelectorAll('script,foreignObject,iframe').forEach(n => n.remove());
  for (const el of [root, ...root.querySelectorAll('*')])
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
}

function shapeToPathData(el) {
  const n = name => el[name]?.baseVal?.value ?? 0;
  const ellipse = (cx, cy, rx, ry) =>
    `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  switch (el.localName) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': return `M ${n('x')} ${n('y')} h ${n('width')} v ${n('height')} h ${-n('width')} Z`;
    case 'circle': return ellipse(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse': return ellipse(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'line': return `M ${n('x1')} ${n('y1')} L ${n('x2')} ${n('y2')}`;
    default: {
      const pts = Array.from({ length: el.points.numberOfItems }, (_, i) => el.points.getItem(i));
      return pts.length ? 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ') + (el.localName === 'polygon' ? ' Z' : '') : '';
    }
  }
}

// Own flattening instead of getPointAtLength: Chrome rescans the whole path on every call, which made a
// 250 KB single-path SVG take minutes. Arcs follow SVG 1.1 appendix F.6.5 (endpoint to center parameterization).
function flattenPath(d, tol) {
  const subpaths = [];
  /** @type {number[][]} */
  let cur = [];
  let x = 0, y = 0, sx = 0, sy = 0, cpx = 0, cpy = 0, prev = '';
  const steps = len => Math.min(256, Math.max(1, Math.ceil(len / tol)));
  const begin = (px, py) => { if (cur.length > 1) subpaths.push(cur); cur = [[px, py]]; sx = px; sy = py; };
  const ensure = () => { if (!cur.length) begin(x, y); };
  const line = (x2, y2) => {
    const n = steps(Math.hypot(x2 - x, y2 - y));
    for (let i = 1; i <= n; i++) cur.push([x + (x2 - x) * i / n, y + (y2 - y) * i / n]);
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2));
    for (let i = 1; i <= n; i++) {
      const t = i / n, m = 1 - t;
      cur.push([m * m * m * x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3,
        m * m * m * y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3]);
    }
  };
  const quad = (x1, y1, x2, y2) => {
    const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1));
    for (let i = 1; i <= n; i++) {
      const t = i / n, m = 1 - t;
      cur.push([m * m * x + 2 * m * t * x1 + t * t * x2, m * m * y + 2 * m * t * y1 + t * t * y2]);
    }
  };
  const arc = (rx, ry, angle, large, sweep, x2, y2) => {
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) { cur.push([x2, y2]); return; }
    const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x - x2) / 2, dy = (y - y2) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    if (Boolean(large) === Boolean(sweep)) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cos * cxp - sin * cyp + (x + x2) / 2, cy = sin * cxp + cos * cyp + (y + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const t1 = ang(1, 0, ux, uy);
    let dt = ang(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = steps(Math.abs(dt) * Math.max(rx, ry));
    for (let i = 1; i <= n; i++) {
      const t = t1 + dt * i / n;
      cur.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
    }
  };
  const apply = (cmd, g, first) => {
    const lower = cmd.toLowerCase(), rel = cmd === lower;
    const ax = v => rel ? x + v : v, ay = v => rel ? y + v : v;
    const smooth = (kinds) => kinds.includes(prev) ? [2 * x - cpx, 2 * y - cpy] : [x, y];
    if (lower === 'm' && first) { x = ax(g[0]); y = ay(g[1]); begin(x, y); prev = 'm'; return; }
    ensure();
    switch (lower) {
      case 'm': case 'l': { const x2 = ax(g[0]), y2 = ay(g[1]); line(x2, y2); x = x2; y = y2; break; }
      case 'h': { const x2 = ax(g[0]); line(x2, y); x = x2; break; }
      case 'v': { const y2 = ay(g[0]); line(x, y2); y = y2; break; }
      case 'c': cubic(ax(g[0]), ay(g[1]), cpx = ax(g[2]), cpy = ay(g[3]), ax(g[4]), ay(g[5])); x = ax(g[4]); y = ay(g[5]); break;
      case 's': {
        const [x1, y1] = smooth('cs');
        const x3 = ax(g[2]), y3 = ay(g[3]);
        cubic(x1, y1, cpx = ax(g[0]), cpy = ay(g[1]), x3, y3); x = x3; y = y3; break;
      }
      case 'q': {
        const x2 = ax(g[2]), y2 = ay(g[3]);
        quad(cpx = ax(g[0]), cpy = ay(g[1]), x2, y2); x = x2; y = y2; break;
      }
      case 't': {
        [cpx, cpy] = smooth('qt');
        const x2 = ax(g[0]), y2 = ay(g[1]);
        quad(cpx, cpy, x2, y2); x = x2; y = y2; break;
      }
      case 'a': { const x2 = ax(g[5]), y2 = ay(g[6]); arc(g[0], g[1], g[2], g[3], g[4], x2, y2); x = x2; y = y2; break; }
    }
    prev = lower;
  };
  /** @type {string | null} */
  let cmd = null;
  /** @type {number[]} */
  let args = [];
  const run = () => {
    if (!cmd) return;
    const lower = cmd.toLowerCase();
    if (lower === 'z') {
      if (cur.length) { line(sx, sy); subpaths.push(cur); cur = []; }
      x = sx; y = sy; prev = 'z';
      return;
    }
    const n = PATH_ARGS[lower];
    for (let i = 0; i + n <= args.length; i += n) apply(cmd, args.slice(i, i + n), i === 0);
  };
  for (const [, letter, num] of d.matchAll(PATH_TOKEN)) {
    if (letter) { run(); cmd = letter; args = []; }
    else args.push(Number(num));
  }
  run();
  if (cur.length > 1) subpaths.push(cur);
  return subpaths;
}

function hatch(polys, spacing, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rot = polys.map(pl => pl.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]));
  let minY = Infinity, maxY = -Infinity;
  for (const pl of rot) for (const p of pl) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const rows = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs = [];
    for (const pl of rot)
      for (let i = 0; i < pl.length; i++) {
        const a = pl[i], b = pl[(i + 1) % pl.length];
        if ((a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1])) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    xs.sort((p, q) => p - q);
    const segs = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.5) segs.push({ a: xs[i], b: xs[i + 1] });
    rows.push({ y, segs });
  }
  return chainRows(rows, spacing, angle);
}

function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * A filled shape no thicker than CENTERLINE_MAX traced as its centre line, the way Illustrator's Image Trace turns
 * regions thinner than "stroke max width" into strokes. Null for thicker shapes.
 * @param {number[][][]} subpaths canvas units @param {CanvasFillRule} rule
 */
function centreOf(subpaths, rule) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, perimeter = 0;
  for (const sp of subpaths) {
    perimeter += pathLength(sp) + Math.hypot(sp[0][0] - sp[sp.length - 1][0], sp[0][1] - sp[sp.length - 1][1]);
    for (const [x, y] of sp) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (!perimeter || Math.min(x1 - x0, y1 - y0) <= 0) return null;
  const k = CENTERLINE_PX, pad = 2;
  const w = Math.ceil((x1 - x0) * k) + 2 * pad, h = Math.ceil((y1 - y0) * k) + 2 * pad;
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }));
  const path = new Path2D();
  for (const sp of subpaths) {
    sp.forEach(([x, y], i) => path[i ? 'lineTo' : 'moveTo']((x - x0) * k + pad, (y - y0) * k + pad));
    path.closePath();
  }
  ctx.fill(path, rule);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < mask.length; i++) if (rgba[i * 4 + 3] > 127) { mask[i] = 1; area++; }
  if (2 * area / (k * k) / perimeter > CENTERLINE_MAX) return null;
  return centerlines(mask, w, h).map(p => p.map(([x, y]) => [(x - pad) / k + x0, (y - pad) / k + y0]));
}

function fitBudget(polylines) {
  if (polylines.length <= LIMITS.strokes) return polylines;
  const ranked = polylines.map((p, i) => ({ i, len: pathLength(p.pts) })).filter(r => r.len >= MIN_STROKE_LENGTH);
  const keep = new Set(ranked.sort((a, b) => b.len - a.len).slice(0, LIMITS.strokes).map(r => r.i));
  return polylines.filter((_, i) => keep.has(i));
}

/** @param {SVGGraphicsElement} el */
function screenMatrix(el) {
  const matrix = el.getScreenCTM();
  if (!matrix) throw new Error('svg is not rendered');
  return matrix;
}

function yielder(onProgress) {
  let last = performance.now();
  return async fraction => {
    if (performance.now() - last < YIELD_EVERY_MS) return;
    onProgress?.(fraction);
    await new Promise(r => setTimeout(r));
    last = performance.now();
  };
}

/**
 * fills: outline draws filled shapes by their edge, hatch adds hatching inside, none skips them; thin filled shapes become centre lines either way.
 * colors: one paints everything with color, snap picks the nearest palette colour, exact adds custom colours.
 * weight: the weight of every stroke; remix keeps the weights from stroke-width. detail 0-100 sets how closely lines follow the curves.
 * @param {string} text
 * @param {{ fills?: string, colors?: string, color?: string, weight?: number, detail?: number, remix?: boolean, onProgress?: (fraction: number) => void }} [options]
 */
export async function importSvg(text, { fills = 'outline', colors = 'snap', color = 'black', weight = 1, detail = 50, remix = false, onProgress } = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = /** @type {Element} */ (doc.documentElement);
  if (src.nodeName !== 'svg') throw new Error('not an svg file');
  sanitize(src);
  expandUses(src);
  const host = /** @type {SVGSVGElement} */ (document.importNode(src, true));
  host.style.cssText = 'position:absolute;left:-99999px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const tick = yielder(onProgress);
  try {
    // Slowly renders letters cropped to the ink: viewBox height shrinks and a <g transform="translate(0,-top)">
    // shifts the strokes; measuring in that group's space gives back the original canvas coordinates
    const cropGroup = remix && host.querySelector(':scope > g[transform^="translate"]');
    const rootInv = screenMatrix(/** @type {SVGGraphicsElement} */ (cropGroup || host)).inverse();
    const vb = host.viewBox.baseVal;
    const keep = remix && vb && Math.abs(vb.width - W) < 1;
    const bbox = host.getBBox();
    const kGuess = keep ? 1 : Math.min((W - 2 * PAD) / (bbox.width || 1), (H - 2 * PAD) / (bbox.height || 1));

    const shapes = [];
    for (const el of /** @type {NodeListOf<SVGGeometryElement>} */ (host.querySelectorAll(SHAPES))) {
      if (el.closest(NOT_RENDERED)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const stroke = faded(paint(host, cs.stroke), opacity(el, Number(cs.strokeOpacity)));
      const fill = faded(paint(host, cs.fill), opacity(el, Number(cs.fillOpacity)));
      if (!stroke && !fill) continue;
      const matrix = rootInv.multiply(screenMatrix(el));
      const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1;
      shapes.push({ stroke, fill, rule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', sw: (parseFloat(cs.strokeWidth) || 1) * scale, matrix, scale,
        d: shapeToPathData(el), length: el.getTotalLength() });
    }
    if (!shapes.length) throw new Error('no drawable shapes');

    const estimate = shapes.reduce((a, s) => a + s.length * s.scale * kGuess, 0) / SAMPLE_STEP;
    const stretch = Math.max(1, estimate / POINT_BUDGET);
    for (let n = 0; n < shapes.length; n++) {
      const s = shapes[n], m = s.matrix;
      s.subpaths = flattenPath(s.d, SAMPLE_STEP * stretch / (kGuess * s.scale)).map(sp => {
        const every = Math.ceil(sp.length / LIMITS.pointsPerStroke);
        return sp.filter((_, i) => i % every === 0 || i === sp.length - 1)
          .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      });
      await tick(0.8 * (n + 1) / shapes.length);
    }

    let k = 1, ox = 0, oy = 0, minX = 0, minY = 0;
    if (!keep) {
      let maxX = -Infinity, maxY = -Infinity;
      minX = minY = Infinity;
      for (const s of shapes) for (const sp of s.subpaths) for (const [x, y] of sp) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      k = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
      ox = (W - (maxX - minX) * k) / 2;
      oy = (H - (maxY - minY) * k) / 2;
    }
    const map = sp => sp.map(([x, y]) => [(x - minX) * k + ox, (y - minY) * k + oy]);
    const eps = remix ? 0 : EPS_COARSE + (EPS_FINE - EPS_COARSE) * Math.min(100, Math.max(0, detail)) / 100;
    const simplify = pts => eps ? rdp(pts, eps) : pts;

    const palette = {};
    const token = rgb => {
      if (colors === 'one') return color;
      const snapped = nearestBase(rgb, { allowCanvas: remix });
      if (colors !== 'exact' || snapped === CANVAS_TOKEN) return snapped;
      const hex = rgbToHex(rgb);
      if (Object.values(BASE_COLORS).includes(hex)) return snapped;
      const t = customToken(hex);
      if (!palette[t] && Object.keys(palette).length >= LIMITS.palette - Object.keys(BASE_COLORS).length - 1) return snapped;
      palette[t] = { light: hex, dark: hex };
      return t;
    };
    const weightOf = w => remix ? Math.round(Math.min(LIMITS.maxWeight, Math.max(LIMITS.minWeight, w)) * 2) / 2 : weight;
    const spacing = Math.max(HATCH_SPACING, HATCH_GAP * STROKE_SCALE * weight);

    const polylines = [];
    for (let n = 0; n < shapes.length; n++) {
      const s = shapes[n];
      const subpaths = s.subpaths.map(map);
      const strokeToken = s.stroke && token(s.stroke);
      const fillToken = s.fill && token(s.fill);
      if (remix && !s.stroke && fillToken === CANVAS_TOKEN) continue;
      if (s.stroke) {
        const w = weightOf(s.sw * k / STROKE_SCALE);
        for (const pts of subpaths) polylines.push({ color: strokeToken, weight: w, pts: simplify(pts) });
      }
      const centre = s.fill && !s.stroke && !remix ? centreOf(subpaths, s.rule) : null;
      if (centre?.length) for (const pts of centre) polylines.push({ color: fillToken, weight, pts: simplify(pts) });
      else if (s.fill && fills !== 'none') {
        if (!s.stroke) for (const pts of subpaths) polylines.push({ color: fillToken, weight: weightOf(1), pts: simplify(pts) });
        if (fills === 'hatch')
          for (const pts of hatch(subpaths, spacing, HATCH_ANGLE)) polylines.push({ color: fillToken, weight: weightOf(1), pts });
      }
      await tick(0.8 + 0.2 * (n + 1) / shapes.length);
    }
    const kept = fitBudget(polylines);
    return { polylines: kept, palette, dropped: polylines.length - kept.length };
  } finally {
    host.remove();
  }
}
