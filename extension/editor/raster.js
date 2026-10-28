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
const BILATERAL_PASSES = 2;
const BILATERAL_RADIUS = 3;
const BILATERAL_SIGMA_S = 2;
const BILATERAL_SIGMA_R = 18;
const CROP_MARGIN = 12;
const CHROMA_SPREAD = 1.5;
const SALIENCY_STEP = 4;
const SALIENCY_SPREAD = 0.03;
const SALIENCY_TOP = 0.98;
const SALIENCY_GAMMA = 1.5;
const CENTRE_SIGMA = 0.32;

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

// Bilateral filter (Tomasi and Manduchi 1998): flattens texture such as fur, grass and sand while keeping outlines sharp
function bilateral(g, w, h, radius, sigmaS, sigmaR) {
  const out = new Float32Array(w * h);
  const side = 2 * radius + 1;
  const space = new Float32Array(side * side);
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) space[(dy + radius) * side + dx + radius] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS));
  const range = new Float32Array(256);
  for (let d = 0; d < 256; d++) range[d] = Math.exp(-d * d / (2 * sigmaR * sigmaR));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = g[y * w + x];
      let s = 0, t = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = Math.min(h - 1, Math.max(0, y + dy)) * w, base = (dy + radius) * side + radius;
        for (let dx = -radius; dx <= radius; dx++) {
          const v = g[row + Math.min(w - 1, Math.max(0, x + dx))];
          const k = space[base + dx] * range[Math.min(255, Math.abs(v - c) | 0)];
          s += v * k; t += k;
        }
      }
      out[y * w + x] = s / t;
    }
  return out;
}

function flattenTexture(g, w, h) {
  let out = g;
  for (let i = 0; i < BILATERAL_PASSES; i++) out = bilateral(out, w, h, BILATERAL_RADIUS, BILATERAL_SIGMA_S, BILATERAL_SIGMA_R);
  return out;
}

/**
 * Where the subject probably is, 0 to 1 per pixel: frequency-tuned saliency (Achanta et al. 2009, how far the blurred
 * colour is from the mean colour of the image) spread over the region and multiplied by a centre prior. Computed on a
 * grid SALIENCY_STEP times coarser and read back bilinearly.
 * @param {Uint8ClampedArray} data @param {number} w @param {number} h
 */
function importance(data, w, h) {
  const f = SALIENCY_STEP, sw = Math.ceil(w / f), sh = Math.ceil(h / f), n = sw * sh;
  const rgb = [0, 1, 2].map(() => new Float32Array(n)), count = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = Math.floor(y / f) * sw + Math.floor(x / f), i = (y * w + x) * 4, a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[c][j] += 255 - a * (255 - data[i + c]);
      count[j]++;
    }
  for (const ch of rgb) for (let j = 0; j < n; j++) ch[j] /= count[j];
  const mean = rgb.map(ch => ch.reduce((a, v) => a + v, 0) / n);
  const far = new Float32Array(n);
  for (let j = 0; j < n; j++) far[j] = Math.hypot(rgb[0][j] - mean[0], rgb[1][j] - mean[1], rgb[2][j] - mean[2]);
  const sal = gaussian(far, sw, sh, Math.hypot(sw, sh) * SALIENCY_SPREAD);
  const top = [...sal].sort((a, b) => a - b)[Math.floor(n * SALIENCY_TOP)] || 1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const dx = (x + 0.5) / sw - 0.5, dy = (y + 0.5) / sh - 0.5;
      sal[y * sw + x] = Math.min(1, sal[y * sw + x] / top) ** SALIENCY_GAMMA * Math.exp(-(dx * dx + dy * dy) / (2 * CENTRE_SIGMA * CENTRE_SIGMA));
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      out[y * w + x] = (sal[y0 * sw + x0] * (1 - tx) + sal[y0 * sw + x1] * tx) * (1 - ty) + (sal[y1 * sw + x0] * (1 - tx) + sal[y1 * sw + x1] * tx) * ty;
    }
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

/** Opponent colour channels red-green and yellow-blue, alpha over white. @param {Uint8ClampedArray} data @param {number} n */
function opponents(data, n) {
  const rg = new Float32Array(n), yb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = 255 - a * (255 - data[i * 4]), g = 255 - a * (255 - data[i * 4 + 1]), b = 255 - a * (255 - data[i * 4 + 2]);
    rg[i] = r - g;
    yb[i] = (r + g) / 2 - b;
  }
  return [rg, yb];
}

// Canny edge detector (J. Canny 1986) on colour: the gradient is the largest eigenvalue of the Di Zenzo structure tensor
// (Di Zenzo 1986) summed over the filtered luminance and blurred opponent channels, so a gold dog on green leaves of the
// same brightness still has an edge. Then non-maximum suppression; hysteresis is left to the caller.
function cannyEdges(g, w, h, detail, data) {
  const sigma = byDetail(CANNY_SIGMAS, detail);
  const s = gaussian(g, w, h, sigma);
  const colour = opponents(data, w * h).map(c => gaussian(c, w, h, sigma * CHROMA_SPREAD));
  const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
  const sobel = (/** @type {Float32Array} */ a, /** @type {number} */ i) => [
    (a[i - w + 1] + 2 * a[i + 1] + a[i + w + 1] - a[i - w - 1] - 2 * a[i - 1] - a[i + w - 1]) / 8,
    (a[i + w - 1] + 2 * a[i + w] + a[i + w + 1] - a[i - w - 1] - 2 * a[i - w] - a[i - w + 1]) / 8];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const [lx, ly] = sobel(s, i);
      let xx = lx * lx, xy = lx * ly, yy = ly * ly;
      for (const c of colour) {
        const [cx, cy] = sobel(c, i);
        xx += cx * cx; xy += cx * cy; yy += cy * cy;
      }
      mag[i] = Math.sqrt((xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2);
      const angle = Math.atan2(2 * xy, xx - yy) / 2, gx = Math.cos(angle), gy = Math.sin(angle);
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
  return { strength, high: byDetail(CANNY_THRESHOLDS, detail), shift };
}

// Difference of Gaussians line drawing, the thresholded core of XDoG (Winnemoeller et al. 2012, https://doi.org/10.1016/j.cag.2012.03.004)
function dogLines(g, w, h, detail) {
  const sigma = byDetail(DOG_SIGMAS, detail);
  const fine = gaussian(g, w, h, sigma), coarse = gaussian(g, w, h, sigma * DOG_RATIO);
  const strength = new Float32Array(w * h);
  for (let i = 0; i < strength.length; i++) strength[i] = Math.max(0, coarse[i] - fine[i]);
  return { strength, high: byDetail(DOG_THRESHOLDS, detail) };
}

// Adaptive thresholding against the local Gaussian mean (as in OpenCV adaptiveThreshold): dark strokes on lighter ground
function darkStrokes(g, w, h, detail) {
  const fine = gaussian(g, w, h, 1), local = gaussian(g, w, h, LOCAL_SIGMA);
  const strength = new Float32Array(w * h);
  for (let i = 0; i < strength.length; i++) strength[i] = Math.max(0, local[i] - fine[i]);
  return { strength, high: byDetail(LOCAL_THRESHOLDS, detail) };
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

function withinBudget(strokes, minLength, high, maxStrokes) {
  const kept = strokes.filter(s => s.len >= minLength && s.sum >= high * minLength * WEAK_STROKE_FACTOR).sort((a, b) => b.sum - a.sum);
  let points = 0;
  const out = [];
  for (const s of kept) {
    if (out.length >= Math.min(maxStrokes, LIMITS.strokes) || points + s.pts.length > LIMITS.points) break;
    out.push(s);
    points += s.pts.length;
  }
  return out;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];
const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** @param {number[]} a @param {number[]} b Liang-Barsky clip of a segment to the canvas @returns {[number[], number[], boolean] | null} */
function clipSegment([ax, ay], [bx, by]) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax], [dx, W - ax], [-dy, ay], [dy, H - ay]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [[ax + t0 * dx, ay + t0 * dy], [ax + t1 * dx, ay + t1 * dy], t1 < 1];
}

/** Pieces of a polyline that lie on the canvas, cut where it crosses the edge. @param {number[][]} pts @returns {number[][][]} */
export function clipToCanvas(pts) {
  if (pts.length === 1) return pts[0][0] >= 0 && pts[0][0] <= W && pts[0][1] >= 0 && pts[0][1] <= H ? [pts] : [];
  const out = [];
  let run = [];
  const flush = () => { if (run.length > 1) out.push(run); run = []; };
  for (let i = 1; i < pts.length; i++) {
    const seg = clipSegment(pts[i - 1], pts[i]);
    if (!seg) { flush(); continue; }
    if (!run.length) run.push(seg[0]);
    run.push(seg[1]);
    if (seg[2]) flush();
  }
  flush();
  return out;
}

/**
 * The part of an image that a placement shows: the image is fitted inside PAD and centred, then moved by place.
 * Returns the source rectangle that lands on the canvas, the trace size (at most the source resolution, at most
 * the canvas resolution) and toCanvas, the map from trace pixels to the canvas. Null when nothing is on the canvas.
 * @param {number} width @param {number} height @param {number[]} [place]
 */
export function placementCrop(width, height, place = IDENTITY) {
  const k = Math.min((W - 2 * PAD) / width, (H - 2 * PAD) / height);
  const tx = (W - width * k) / 2, ty = (H - height * k) / 2;
  const [a, b, c, d, e, f] = place;
  const m = [a * k, b * k, c * k, d * k, a * tx + c * ty + e, b * tx + d * ty + f];
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  const scale = Math.sqrt(Math.abs(det)), s = Math.min(1, scale);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => applyMatrix(inv, x, y));
  const margin = CROP_MARGIN / s;
  const sx = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])) - margin)), ex = Math.min(width, Math.ceil(Math.max(...corners.map(p => p[0])) + margin));
  const sy = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1])) - margin)), ey = Math.min(height, Math.ceil(Math.max(...corners.map(p => p[1])) + margin));
  if (ex <= sx || ey <= sy) return null;
  const w = Math.max(1, Math.round((ex - sx) * s)), h = Math.max(1, Math.round((ey - sy) * s));
  const kx = (ex - sx) / w, ky = (ey - sy) / h;
  return {
    sx, sy, sw: ex - sx, sh: ey - sy, w, h,
    toCanvas: [m[0] * kx, m[1] * kx, m[2] * ky, m[3] * ky, m[0] * sx + m[2] * sy + m[4], m[1] * sx + m[3] * sy + m[5]],
    enlarged: (scale / s) / (k / Math.min(1, k)),
  };
}

/**
 * Centre lines of a binary mask, the thinning approach of autotrace's centerline mode: Zhang-Suen skeleton, split at
 * junctions, rejoined through crossings, smoothed and simplified. Returns polylines in mask pixels.
 * @param {Uint8Array} mask modified in place @param {number} w @param {number} h
 */
export function centerlines(mask, w, h) {
  thin(mask, w, h);
  dropCornerPixels(mask, w, h);
  return linkStrokes({ mask, strength: mask }, w, h)
    .map(st => simplifyPath(smoothPath(st.pts, st.closed), st.closed))
    .filter(p => p.length > 1);
}

/**
 * @typedef {{ mode?: string, detail?: number, minLength?: number, maxStrokes?: number, color: string, weight: number, photoColors?: boolean,
 *   place?: number[], focus?: number[] | null, seeds?: number[] }} PhotoOptions
 * minLength is in trace pixels of the fitted placement; place is the matrix the user moved and scaled the import by.
 * focus [background, subject] scales edge strength by the importance map, from the first factor where nothing stands
 * out to the second on the subject. seeds [factor, weak] scales the hysteresis threshold that starts a line and sets
 * the fraction of it that continues one.
 */

/**
 * Line art for the crop of a photo, in canvas units; lines that leave the canvas are cut at its edge.
 * @param {Uint8ClampedArray} data RGBA of the crop at the trace size @param {NonNullable<ReturnType<typeof placementCrop>>} crop @param {PhotoOptions} opts
 */
export function traceCrop(data, { w, h, toCanvas, enlarged }, {
  mode = 'edges', detail = 50, minLength = 8, maxStrokes = LIMITS.strokes, color, weight, photoColors = false, focus = null, seeds = [1, WEAK_RATIO],
}) {
  const g = grayscale(data, w, h);
  stretchLevels(g);
  const found = (DETECTORS[mode] || DETECTORS.edges)(mode === 'dark' ? g : flattenTexture(g, w, h), w, h, detail, data);
  if (focus) {
    const weightOf = importance(data, w, h);
    for (let i = 0; i < found.strength.length; i++) found.strength[i] *= focus[0] + (focus[1] - focus[0]) * weightOf[i];
  }
  const high = found.high * seeds[0];
  const lines = { ...found, high, mask: hysteresis(found.strength, w, h, [high * seeds[1], high]) };
  thin(lines.mask, w, h);
  dropCornerPixels(lines.mask, w, h);
  const strokes = drawingOrder(withinBudget(linkStrokes(lines, w, h), minLength / enlarged, lines.high, maxStrokes)
    .map(st => ({ ...st, pts: simplifyPath(smoothPath(st.pts, st.closed), st.closed) })));
  return strokes.flatMap(({ pts }) => {
    const ink = photoColors ? nearestBase(inkColour(data, w, h, pts)) : color;
    return clipToCanvas(pts.map(([x, y]) => applyMatrix(toCanvas, x, y))).map(piece => ({ color: ink, weight, pts: piece }));
  }).slice(0, LIMITS.strokes);
}

/** @param {ImageBitmap} image @param {PhotoOptions} opts */
export function photoToPolylines(image, opts) {
  const crop = placementCrop(image.width, image.height, opts.place);
  if (!crop) return [];
  const ctx = canvas2d(crop.w, crop.h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.w, crop.h);
  return traceCrop(ctx.getImageData(0, 0, crop.w, crop.h).data, crop, opts);
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
