import { W, H, LIMITS, nearestBase, rdp } from './sdj.js';

const PAD = 24;
const TEXT_RENDER_SCALE = 1.5;
const NEIGHBOURS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

const LEVEL_CLIP = 0.01;
const MIN_LEVEL_RANGE = 96;
const CANNY_SIGMAS = [2.2, 1];
const CANNY_THRESHOLDS = [20, 5];
const DOG_SIGMAS = [1.8, 0.9];
const DOG_RATIO = 1.6;
const DOG_THRESHOLDS = [20, 4];
const LOCAL_SIGMA = 6;
const LOCAL_THRESHOLDS = [70, 20];
const WEAK_RATIO = 0.45;
const WEAK_STROKE_FACTOR = 1.5;
const SPUR_LENGTH = 8;
const JOIN_MAX_BEND_COS = -0.6;
const DIRECTION_SPAN = 5;
const GAP_MAX = 10;
const GAP_MIN_ALIGN = 0.6;
const SMOOTH_RADIUS = 4;
const SIMPLIFY_EPS = 0.45;

function thin(img, w, h) {
  const del = [];
  let changed = true;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const b = p.reduce((a, v) => a + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          if (pass === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
          del.push(y * w + x);
        }
      for (const i of del) img[i] = 0;
      if (del.length) changed = true;
    }
  }
}

function trace(img, w, h) {
  const visited = new Uint8Array(w * h);
  const next = i => {
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (img[j] && !visited[j]) return j;
    }
    return -1;
  };
  const degree = i => {
    const x = i % w, y = (i / w) | 0;
    let n = 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && img[ny * w + nx]) n++;
    }
    return n;
  };
  const walk = start => {
    const out = [];
    for (let cur = next(start); cur >= 0; cur = next(cur)) { visited[cur] = 1; out.push(cur); }
    return out;
  };
  const paths = [];
  const from = start => {
    visited[start] = 1;
    const a = walk(start), b = walk(start);
    paths.push([...b.reverse(), start, ...a].map(i => [i % w, (i / w) | 0]));
  };
  for (let i = 0; i < img.length; i++) if (img[i] && !visited[i] && degree(i) === 1) from(i);
  for (let i = 0; i < img.length; i++) if (img[i] && !visited[i]) from(i);
  return paths;
}

function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function grayscale(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    g[i] = 255 - a * (255 - (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]));
  }
  return g;
}

function stretchLevels(g) {
  const hist = new Uint32Array(256);
  for (const v of g) hist[Math.round(v)]++;
  const cut = g.length * LEVEL_CLIP;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < cut) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < cut) hi--;
  const scale = 255 / Math.max(hi - lo, MIN_LEVEL_RANGE);
  for (let i = 0; i < g.length; i++) g[i] = (g[i] - lo) * scale;
}

function gaussian(g, w, h, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-i * i / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * g[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s;
    }
  return out;
}

/** @param {number[]} range @param {number} detail */
const byDetail = ([hi, lo], detail) => hi * (lo / hi) ** (detail / 100);

function hysteresis(strength, w, h, [low, high]) {
  const mask = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < mask.length; i++) if (strength[i] >= high) { mask[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] && strength[j] >= low) { mask[j] = 1; stack.push(j); }
    }
  }
  return mask;
}

const detected = (strength, w, h, high) =>
  ({ mask: hysteresis(strength, w, h, [high * WEAK_RATIO, high]), strength, high });

// Canny edge detector (J. Canny 1986): Gaussian, Sobel gradient, non-maximum suppression, hysteresis
function cannyEdges(g, w, h, detail) {
  const s = gaussian(g, w, h, byDetail(CANNY_SIGMAS, detail));
  const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (s[i - w + 1] + 2 * s[i + 1] + s[i + w + 1] - s[i - w - 1] - 2 * s[i - 1] - s[i + w - 1]) / 8;
      const gy = (s[i + w - 1] + 2 * s[i + w] + s[i + w + 1] - s[i - w - 1] - 2 * s[i - w] - s[i - w + 1]) / 8;
      mag[i] = Math.hypot(gx, gy);
      const ax = Math.abs(gx), ay = Math.abs(gy);
      dir[i] = ay <= 0.4142 * ax ? 0 : ay >= 2.4142 * ax ? 2 : gx * gy > 0 ? 1 : 3;
    }
  const across = [1, w + 1, w, w - 1], step = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  const strength = new Float32Array(w * h), shift = new Float32Array(2 * w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, o = across[dir[i]];
      if (mag[i] < mag[i - o] || mag[i] <= mag[i + o]) continue;
      strength[i] = mag[i];
      const curve = mag[i - o] - 2 * mag[i] + mag[i + o];
      const t = curve < 0 ? 0.5 * (mag[i - o] - mag[i + o]) / curve : 0;
      shift[2 * i] = t * step[dir[i]][0];
      shift[2 * i + 1] = t * step[dir[i]][1];
    }
  return { ...detected(strength, w, h, byDetail(CANNY_THRESHOLDS, detail)), shift };
}

// Difference of Gaussians line drawing, the thresholded core of XDoG (Winnemoeller et al. 2012, https://doi.org/10.1016/j.cag.2012.03.004)
function dogLines(g, w, h, detail) {
  const sigma = byDetail(DOG_SIGMAS, detail);
  const fine = gaussian(g, w, h, sigma), coarse = gaussian(g, w, h, sigma * DOG_RATIO);
  const strength = new Float32Array(w * h);
  for (let i = 0; i < strength.length; i++) strength[i] = Math.max(0, coarse[i] - fine[i]);
  return detected(strength, w, h, byDetail(DOG_THRESHOLDS, detail));
}

// Adaptive thresholding against the local Gaussian mean (as in OpenCV adaptiveThreshold): dark strokes on lighter ground
function darkStrokes(g, w, h, detail) {
  const fine = gaussian(g, w, h, 1), local = gaussian(g, w, h, LOCAL_SIGMA);
  const strength = new Float32Array(w * h);
  for (let i = 0; i < strength.length; i++) strength[i] = Math.max(0, local[i] - fine[i]);
  return detected(strength, w, h, byDetail(LOCAL_THRESHOLDS, detail));
}

const DETECTORS = { edges: cannyEdges, sketch: dogLines, dark: darkStrokes };

// Thinning leaves 4-connected staircases whose corners look like junctions; a pixel whose neighbours are all one 8-connected piece is redundant
function dropCornerPixels(mask, w, h) {
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      const ring = NEIGHBOURS.filter(([dx, dy]) => mask[(y + dy) * w + x + dx]);
      if (ring.length < 2) continue;
      const piece = ring.map((_, i) => i);
      const root = i => piece[i] === i ? i : (piece[i] = root(piece[i]));
      for (let i = 0; i < ring.length; i++)
        for (let j = i + 1; j < ring.length; j++)
          if (Math.max(Math.abs(ring[i][0] - ring[j][0]), Math.abs(ring[i][1] - ring[j][1])) <= 1) piece[root(i)] = root(j);
      if (new Set(ring.map((_, i) => root(i))).size === 1) mask[y * w + x] = 0;
    }
}

// Splits a 1-pixel skeleton at junction clusters and endpoints into segments that run node to node.
// A segment end is a token: 2 * index at the start, 2 * index + 1 at the finish.
function skeletonGraph({ mask, strength, shift }, w, h) {
  const neighbours = i => {
    const x = i % w, y = (i / w) | 0, out = [];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) out.push(ny * w + nx);
    }
    return out;
  };
  const at = i => shift ? [i % w + shift[2 * i], (i / w | 0) + shift[2 * i + 1]] : [i % w, (i / w) | 0];
  const deg = new Uint8Array(w * h);
  for (let i = 0; i < deg.length; i++) if (mask[i]) deg[i] = neighbours(i).length;
  const nodeAt = new Int32Array(w * h).fill(-1);
  const nodes = [];
  for (let i = 0; i < deg.length; i++) {
    if (!mask[i] || deg[i] === 2 || nodeAt[i] >= 0) continue;
    const px = [i];
    nodeAt[i] = nodes.length;
    for (let k = 0; k < px.length; k++)
      for (const j of neighbours(px[k])) if (deg[j] !== 2 && nodeAt[j] < 0) { nodeAt[j] = nodes.length; px.push(j); }
    const pts = px.map(at);
    nodes.push({
      px, ends: [],
      x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length,
    });
  }
  const seen = new Uint8Array(w * h);
  const segs = [];
  const addSeg = (chain, a, b, closed = false) => {
    const pts = chain.map(at);
    if (a >= 0) pts.unshift([nodes[a].x, nodes[a].y]);
    if (b >= 0) pts.push([nodes[b].x, nodes[b].y]);
    segs.push({ pts, len: pathLength(pts), sum: chain.reduce((acc, i) => acc + strength[i], 0), a, b, closed });
    if (a >= 0) nodes[a].ends.push(2 * segs.length - 2);
    if (b >= 0) nodes[b].ends.push(2 * segs.length - 1);
  };
  nodes.forEach((node, id) => {
    for (const p of node.px)
      for (const q of neighbours(p)) {
        if (nodeAt[q] >= 0 || seen[q]) continue;
        const chain = [];
        let prev = p, cur = q, end = -1;
        for (;;) {
          seen[cur] = 1;
          chain.push(cur);
          const nxt = neighbours(cur).find(r => r !== prev && (nodeAt[r] >= 0 || !seen[r]));
          if (nxt === undefined) break;
          if (nodeAt[nxt] >= 0) { end = nodeAt[nxt]; break; }
          prev = cur;
          cur = nxt;
        }
        addSeg(chain, id, end);
      }
  });
  for (let i = 0; i < seen.length; i++) {
    if (!mask[i] || seen[i] || nodeAt[i] >= 0) continue;
    const chain = [];
    for (let cur = i; cur !== undefined; cur = neighbours(cur).find(r => !seen[r] && nodeAt[r] < 0)) { seen[cur] = 1; chain.push(cur); }
    addSeg(chain, -1, -1, true);
  }
  return { segs, nodes };
}

function inward(pts, atStart) {
  const n = pts.length, [x0, y0] = pts[atStart ? 0 : n - 1];
  for (let k = 1; k < n; k++) {
    const [x, y] = pts[atStart ? k : n - 1 - k];
    const d = Math.hypot(x - x0, y - y0);
    if (d >= DIRECTION_SPAN || k === n - 1) return d ? [(x - x0) / d, (y - y0) / d] : [0, 0];
  }
  return [0, 0];
}

function dropSpurs(segs, nodes) {
  const degree = id => id < 0 ? 1 : nodes[id].ends.length;
  const dead = new Uint8Array(segs.length);
  for (let pass = 0; pass < 2; pass++)
    segs.forEach((s, i) => {
      if (dead[i] || s.closed || s.len >= SPUR_LENGTH) return;
      const da = degree(s.a), db = degree(s.b);
      if (Math.min(da, db) !== 1 || Math.max(da, db) < 3) return;
      dead[i] = 1;
      if (s.a >= 0) nodes[s.a].ends = nodes[s.a].ends.filter(t => t !== 2 * i);
      if (s.b >= 0) nodes[s.b].ends = nodes[s.b].ends.filter(t => t !== 2 * i + 1);
    });
  return dead;
}

// At each junction pairs the segment ends that continue each other most smoothly, so strokes run through crossings
function pairAtJunctions(segs, nodes) {
  const partner = new Int32Array(2 * segs.length).fill(-1);
  for (const { ends } of nodes) {
    if (ends.length < 2) continue;
    const dirs = ends.map(t => inward(segs[t >> 1].pts, (t & 1) === 0));
    const pairs = [];
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const dot = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1];
        if (ends.length === 2 || dot <= JOIN_MAX_BEND_COS) pairs.push([dot, ends[i], ends[j]]);
      }
    for (const [, a, b] of pairs.sort((p, q) => p[0] - q[0]))
      if (partner[a] < 0 && partner[b] < 0) { partner[a] = b; partner[b] = a; }
  }
  return partner;
}

function assemble(segs, partner, dead = new Uint8Array(segs.length)) {
  const done = new Uint8Array(segs.length);
  const out = [];
  const chainFrom = entry => {
    const pts = [];
    let sum = 0, closed = false;
    for (let tok = entry; ;) {
      const seg = segs[tok >> 1];
      done[tok >> 1] = 1;
      sum += seg.sum;
      const run = (tok & 1) === 0 ? seg.pts : [...seg.pts].reverse();
      const last = pts[pts.length - 1];
      pts.push(...(last && last[0] === run[0][0] && last[1] === run[0][1] ? run.slice(1) : run));
      closed ||= seg.closed;
      const next = partner[tok ^ 1];
      if (next < 0) break;
      if (done[next >> 1]) { closed = true; break; }
      tok = next;
    }
    if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    out.push({ pts, sum, closed, len: pathLength(pts) + (closed ? Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) : 0) });
  };
  segs.forEach((s, i) => {
    if (dead[i] || done[i]) return;
    if (partner[2 * i] < 0) chainFrom(2 * i);
    else if (partner[2 * i + 1] < 0) chainFrom(2 * i + 1);
  });
  segs.forEach((s, i) => { if (!dead[i] && !done[i]) chainFrom(2 * i); });
  return out;
}

// Joins stroke ends that are close and point at each other, greedy by distance weighted with misalignment
function closeGaps(strokes) {
  const ends = [];
  strokes.forEach((s, i) => {
    if (s.closed) return;
    for (const atStart of [true, false]) {
      const [x, y] = s.pts[atStart ? 0 : s.pts.length - 1], [dx, dy] = inward(s.pts, atStart);
      ends.push({ tok: 2 * i + (atStart ? 0 : 1), x, y, dx: -dx, dy: -dy });
    }
  });
  const cellOf = v => Math.floor(v / GAP_MAX);
  const grid = new Map();
  ends.forEach((e, i) => {
    const key = cellOf(e.x) * 65536 + cellOf(e.y);
    grid.set(key, [...(grid.get(key) || []), i]);
  });
  const cands = [];
  ends.forEach((e, i) => {
    for (let cx = cellOf(e.x) - 1; cx <= cellOf(e.x) + 1; cx++)
      for (let cy = cellOf(e.y) - 1; cy <= cellOf(e.y) + 1; cy++)
        for (const j of grid.get(cx * 65536 + cy) || []) {
          const f = ends[j];
          if (j <= i || ((f.tok >> 1) === (e.tok >> 1) && strokes[e.tok >> 1].len < 5 * GAP_MAX)) continue;
          const vx = f.x - e.x, vy = f.y - e.y, d = Math.hypot(vx, vy);
          if (d > GAP_MAX) continue;
          if (d === 0) { cands.push([0, e.tok, f.tok]); continue; }
          const ca = (e.dx * vx + e.dy * vy) / d, cb = -(f.dx * vx + f.dy * vy) / d;
          if (ca >= GAP_MIN_ALIGN && cb >= GAP_MIN_ALIGN) cands.push([d * (3 - ca - cb), e.tok, f.tok]);
        }
  });
  const partner = new Int32Array(2 * strokes.length).fill(-1);
  for (const [, a, b] of cands.sort((p, q) => p[0] - q[0]))
    if (partner[a] < 0 && partner[b] < 0) { partner[a] = b; partner[b] = a; }
  return assemble(strokes, partner);
}

function smoothPath(pts, closed) {
  const n = pts.length;
  if (n < 3) return pts;
  const sigma = SMOOTH_RADIUS / 2;
  const weight = Array.from({ length: SMOOTH_RADIUS + 1 }, (_, d) => Math.exp(-d * d / (2 * sigma * sigma)));
  return pts.map((p, i) => {
    const r = closed ? SMOOTH_RADIUS : Math.min(SMOOTH_RADIUS, i, n - 1 - i);
    let x = 0, y = 0, t = 0;
    for (let d = -r; d <= r; d++) {
      const q = pts[((i + d) % n + n) % n], k = weight[Math.abs(d)];
      x += q[0] * k; y += q[1] * k; t += k;
    }
    return [x / t, y / t];
  });
}

function simplifyPath(pts, closed) {
  if (!closed) return rdp(pts, SIMPLIFY_EPS);
  let far = 0, best = 0;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > best) { best = d; far = i; } });
  return [...rdp(pts.slice(0, far + 1), SIMPLIFY_EPS).slice(0, -1), ...rdp([...pts.slice(far), pts[0]], SIMPLIFY_EPS)];
}

// Greedy pen travel: next stroke is the one with an end nearest to where the pen is, starting at the top-left corner
function drawingOrder(strokes) {
  const rest = [...strokes], out = [];
  let x = 0, y = 0;
  while (rest.length) {
    let best = 0, bestD = Infinity, flip = false;
    rest.forEach((s, i) => {
      const a = s.pts[0], b = s.pts[s.pts.length - 1];
      const da = (a[0] - x) ** 2 + (a[1] - y) ** 2, db = (b[0] - x) ** 2 + (b[1] - y) ** 2;
      if (Math.min(da, db) < bestD) { bestD = Math.min(da, db); best = i; flip = db < da; }
    });
    const [s] = rest.splice(best, 1);
    const pts = flip ? [...s.pts].reverse() : s.pts;
    out.push({ ...s, pts });
    [x, y] = pts[pts.length - 1];
  }
  return out;
}

function readingOrder(paths, band) {
  const key = p => {
    const ys = p.map(q => q[1]), xs = p.map(q => q[0]);
    return [Math.floor(Math.min(...ys) / band), Math.min(...xs)];
  };
  return paths.map(p => [key(p), p]).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]).map(x => x[1]);
}

const INK_RADIUS = 3;

// an edge sits between two regions; take the more saturated or darker side, not the blend with the background
function inkColour(data, w, h, path) {
  const sum = [0, 0, 0];
  for (const [px, py] of path) {
    const x = Math.round(px), y = Math.round(py);
    let best = [0, 0, 0], score = -1;
    for (let dy = -INK_RADIUS; dy <= INK_RADIUS; dy++)
      for (let dx = -INK_RADIUS; dx <= INK_RADIUS; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = (ny * w + nx) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const s = (Math.max(r, g, b) - Math.min(r, g, b)) + (255 - (r + g + b) / 3);
        if (s > score) { score = s; best = [r, g, b]; }
      }
    for (let c = 0; c < 3; c++) sum[c] += best[c];
  }
  return sum.map(v => v / path.length);
}

function linkStrokes(lines, w, h) {
  const { segs, nodes } = skeletonGraph(lines, w, h);
  const dead = dropSpurs(segs, nodes);
  return closeGaps(assemble(segs, pairAtJunctions(segs, nodes), dead));
}

function withinBudget(strokes, minLength, high) {
  const kept = strokes.filter(s => s.len >= minLength && s.sum >= high * minLength * WEAK_STROKE_FACTOR).sort((a, b) => b.sum - a.sum);
  let points = 0;
  const out = [];
  for (const s of kept) {
    if (out.length >= LIMITS.strokes || points + s.pts.length > LIMITS.points) break;
    out.push(s);
    points += s.pts.length;
  }
  return out;
}

function visibleSpan(view, size, pan) {
  const centred = (view - size) / 2;
  const start = centred + pan * Math.max(Math.abs(centred), view / 2);
  return { start, from: Math.max(0, start), to: Math.min(view, start + size) };
}

export function photoToPolylines(image, { mode = 'edges', detail = 50, minLength = 8, color, weight, photoColors = false, zoom = 1, panX = 0, panY = 0 }) {
  const scale = Math.min((W - 2 * PAD) / image.width, (H - 2 * PAD) / image.height) * zoom;
  const xs = visibleSpan(W, image.width * scale, panX), ys = visibleSpan(H, image.height * scale, panY);
  const sx = (xs.from - xs.start) / scale, sy = (ys.from - ys.start) / scale;
  const sw = (xs.to - xs.from) / scale, sh = (ys.to - ys.from) / scale;
  const s = Math.min(1, scale);
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const ctx = canvas2d(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = grayscale(data, w, h);
  stretchLevels(g);
  const lines = (DETECTORS[mode] || DETECTORS.edges)(g, w, h, detail);
  thin(lines.mask, w, h);
  dropCornerPixels(lines.mask, w, h);
  const strokes = drawingOrder(withinBudget(linkStrokes(lines, w, h), minLength, lines.high)
    .map(st => ({ ...st, pts: simplifyPath(smoothPath(st.pts, st.closed), st.closed) })));
  const kx = (xs.to - xs.from) / w, ky = (ys.to - ys.from) / h;
  const ox = xs.from, oy = ys.from;
  return strokes.map(({ pts }) => ({
    color: photoColors ? nearestBase(inkColour(data, w, h, pts)) : color,
    weight,
    pts: pts.map(([x, y]) => [x * kx + ox, y * ky + oy]),
  }));
}

function canvas2d(w, h) {
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas context unavailable');
  return ctx;
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function textToPolylines(text, { font = 'cursive', size = 56, align = 'top', color, weight }) {
  const S = TEXT_RENDER_SCALE;
  const px = Math.round(size * S);
  const fontCss = `${px}px ${font}`;
  const probe = canvas2d(1, 1);
  probe.font = fontCss;
  const lines = wrap(probe, text, (W - 2 * PAD) * S);
  const lineH = Math.round(px * 1.35);
  const w = Math.ceil((W - 2 * PAD) * S), h = lineH * lines.length + px;
  const ctx = canvas2d(w, h);
  ctx.font = fontCss;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lineH + px * 0.15));
  const { data } = ctx.getImageData(0, 0, w, h);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  thin(bin, w, h);
  const paths = readingOrder(trace(bin, w, h).filter(p => p.length >= 3).map(p => rdp(p, 0.6)), lineH);
  const blockH = h / S;
  const top = align === 'middle' ? (H - blockH) / 2 : align === 'bottom' ? H - PAD - blockH : PAD;
  return paths.map(p => ({ color, weight, pts: p.map(([x, y]) => [PAD + x / S, top + y / S]) }));
}
