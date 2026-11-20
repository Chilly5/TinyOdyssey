// Map-wide fields worked out once from the elevation raster: the edited
// elevation (straits reopened, landmark sites levelled), distance to the shore,
// the climate, and the rivers.

import { WORLD_W, WORLD_D, lonLatToWorld, worldToLonLat } from '../src/config.js';
import { fbm, noise2, smoothstep, clamp } from '../src/util.js';

// Narrow straits to keep open for ships: lon/lat polylines and a half-width in world units.
const STRAITS = [
  { w: 0.36, pts: [[26.1, 39.98], [26.2, 40.03], [26.33, 40.1], [26.4, 40.17], [26.55, 40.28], [26.72, 40.41], [26.9, 40.48]] }, // Hellespont
  { w: 0.3, pts: [[28.97, 40.98], [29.02, 41.05], [29.06, 41.12], [29.09, 41.18], [29.13, 41.26]] }, // Bosporus
  { w: 0.3, pts: [[15.55, 37.98], [15.6, 38.1], [15.63, 38.2], [15.66, 38.3]] }, // Strait of Messina
  { w: 0.28, pts: [[21.7, 38.3], [21.86, 38.34]] }, // Rion narrows, mouth of the Gulf of Corinth
];

// Islets too small for the data but too storied to lose: [lon, lat, metres, radius in units].
const ISLETS = [
  [14.43, 40.58, 46, 0.34], // Li Galli, the Sirens' rocks
];

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// Squared Euclidean distance to the nearest cell where mask is set (Felzenszwalb & Huttenlocher).
function distanceField(mask, w, h) {
  const INF = 1e12;
  const d = new Float32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n), out = new Float64Array(n), zq = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len) => {
    let k = 0;
    v[0] = 0;
    zq[0] = -INF;
    zq[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s > zq[k]) break;
        k--;
      }
      k++;
      v[k] = q;
      zq[k] = s;
      zq[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (zq[k + 1] < q) k++;
      const p = v[k];
      out[q] = (q - p) * (q - p) + f[p];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF;
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

export function buildFields(dem, sites, opts) {
  const { w, h, res } = dem;
  const N = w * h;
  const el = Float32Array.from(dem.data);
  const cellX = (i) => (i + 0.5) / res, cellZ = (j) => (j + 0.5) / res;
  const forDisc = (x, z, r, fn) => {
    const i0 = Math.max(0, Math.floor((x - r) * res)), i1 = Math.min(w - 1, Math.ceil((x + r) * res));
    const j0 = Math.max(0, Math.floor((z - r) * res)), j1 = Math.min(h - 1, Math.ceil((z + r) * res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) fn(j * w + i, Math.hypot(cellX(i) - x, cellZ(j) - z), i, j);
    }
  };

  // --- Landmark sites: find their spot and level the ground under them -----------
  const sampleRaw = (x, z) => {
    const i = clamp(Math.floor(x * res), 0, w - 1), j = clamp(Math.floor(z * res), 0, h - 1);
    return el[j * w + i];
  };
  for (const s of sites) {
    let [x, z] = lonLatToWorld(s.lon, s.lat);
    if (s.peak) {
      let best = -Infinity, bx = x, bz = z;
      forDisc(x, z, 2.4, (k, d, i, j) => {
        if (el[k] > best) { best = el[k]; bx = cellX(i); bz = cellZ(j); }
      });
      x = bx;
      z = bz;
    }
    s.x = x;
    s.z = z;
    s.R = (s.flat || 0) * opts.modelUnit; // footprint radius in world units
    s.RT = s.town && s.R ? s.R + (8 + 3.2 * Math.sqrt(s.town)) / opts.px : s.R; // and of the town round it
    s.elev = 0;
    if (s.sea || !s.R) {
      if (!s.sea) s.elev = Math.max(0, sampleRaw(x, z));
      continue;
    }
    let base = sampleRaw(x, z);
    if (s.peak) base *= 0.96;
    else {
      // Typical height of the land already there, so a town does not sit in a pit or on a spike.
      let sum = 0, cnt = 0;
      forDisc(x, z, s.R * 0.7, (k) => { if (el[k] > 0) { sum += el[k]; cnt++; } });
      base = cnt ? sum / cnt : 0;
    }
    base = Math.max(base, 16);
    s.elev = base;
    const ring = 0.9;
    const core = s.raise === false ? 0 : s.R * 0.6;
    forDisc(x, z, s.RT + ring, (k, d) => {
      if (d <= core) el[k] = base; // the model always has ground to stand on
      else if (el[k] <= 0) return; // further out, the sea stays sea
      else if (d <= s.RT) el[k] = base;
      else {
        const t = smoothstep(0, 1, (d - s.RT) / ring);
        el[k] = base * (1 - t) + el[k] * t;
      }
    });
  }

  // --- Straits and islets (after the sites, so no footprint can dam a strait) ---------------------------------------------------
  for (const s of STRAITS) {
    const pts = s.pts.map(([lon, lat]) => lonLatToWorld(lon, lat));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = s.w + 0.3;
    for (let j = Math.max(0, Math.floor((z0 - pad) * res)); j <= Math.min(h - 1, Math.ceil((z1 + pad) * res)); j++) {
      for (let i = Math.max(0, Math.floor((x0 - pad) * res)); i <= Math.min(w - 1, Math.ceil((x1 + pad) * res)); i++) {
        const d = distToPolyline(cellX(i), cellZ(j), pts);
        if (d < s.w) el[j * w + i] = Math.min(el[j * w + i], -45);
        else if (d < s.w + 0.25) el[j * w + i] = Math.min(el[j * w + i], 25 + (d - s.w) * 600); // gentle banks
      }
    }
  }
  for (const [lon, lat, m, r] of ISLETS) {
    const [x, z] = lonLatToWorld(lon, lat);
    forDisc(x, z, r, (k, d) => { el[k] = Math.max(el[k], m * (1 - (d / r) ** 2) + 2); });
  }

  // --- Distance to the shore, in world units: positive out at sea, negative inland ----
  const landMask = new Uint8Array(N), seaMask = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (el[k] > 0) landMask[k] = 1;
    else seaMask[k] = 1;
  }
  const toLand = distanceField(landMask, w, h);
  const toSea = distanceField(seaMask, w, h);
  const sd = new Float32Array(N);
  for (let k = 0; k < N; k++) sd[k] = landMask[k] ? -Math.sqrt(toSea[k]) / res : Math.sqrt(toLand[k]) / res;

  // The source has a block of the Adriatic with no sea-floor data (depth 0). Wherever open
  // water claims to be at sea level, give it a plausible depth from its distance to land.
  let patched = 0;
  for (let k = 0; k < N; k++) {
    if (!landMask[k] && el[k] > -3) {
      el[k] = -Math.min(1600, 6 + sd[k] * 170);
      patched++;
    }
  }

  // --- Bilinear sampling -------------------------------------------------------
  const bil = (arr, aw, ah, fx, fy) => {
    fx = fx < 0 ? 0 : fx > aw - 1.001 ? aw - 1.001 : fx;
    fy = fy < 0 ? 0 : fy > ah - 1.001 ? ah - 1.001 : fy;
    const x0 = fx | 0, y0 = fy | 0;
    const u = fx - x0, v = fy - y0;
    const k = y0 * aw + x0;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + aw] * (1 - u) + arr[k + aw + 1] * u) * v;
  };
  const elevAt = (x, z) => bil(el, w, h, x * res - 0.5, z * res - 0.5);

  // The shape the mountains are drawn with. Heights are stretched about sevenfold, and real
  // relief stretched that much is a forest of needles; smoothing the high ground first leaves
  // broad massifs. Low ground and the coast are left exactly as they are.
  const soft = Float32Array.from(el, (v) => Math.max(0, v));
  {
    const tmp = new Float32Array(N);
    const RAD = 5;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < h; j++) { // rows
        let sum = 0;
        for (let i = -RAD; i <= RAD; i++) sum += soft[j * w + Math.min(w - 1, Math.max(0, i))];
        for (let i = 0; i < w; i++) {
          tmp[j * w + i] = sum / (2 * RAD + 1);
          sum += soft[j * w + Math.min(w - 1, i + RAD + 1)] - soft[j * w + Math.max(0, i - RAD)];
        }
      }
      for (let i = 0; i < w; i++) { // columns
        let sum = 0;
        for (let j = -RAD; j <= RAD; j++) sum += tmp[Math.min(h - 1, Math.max(0, j)) * w + i];
        for (let j = 0; j < h; j++) {
          soft[j * w + i] = sum / (2 * RAD + 1);
          sum += tmp[Math.min(h - 1, j + RAD + 1) * w + i] - tmp[Math.max(0, j - RAD) * w + i];
        }
      }
    }
    for (let k = 0; k < N; k++) {
      if (el[k] <= 0) { soft[k] = el[k]; continue; }
      const t = smoothstep(140, 520, Math.max(soft[k], el[k] * 0.6));
      soft[k] = Math.max(1, el[k] * (1 - t) + soft[k] * 1.12 * t);
    }
    // Landmark sites stand at the height of the smoothed ground, level across their footprint.
    // (Kept at the raw height, a summit shrine would stand on a pillar above its own mountain.)
    for (const s of sites) {
      if (!s.R || s.sea) continue;
      let sum = 0, cnt = 0, top = 0;
      forDisc(s.x, s.z, s.R * 0.7, (k) => { if (el[k] > 0) { sum += soft[k]; cnt++; top = Math.max(top, soft[k]); } });
      const base = Math.max(16, s.peak ? top * 0.98 : cnt ? sum / cnt : 0);
      s.elev = base;
      // A summit site gets a mountain to stand on: the ground falls away from its edge in a
      // long slope rather than a cliff.
      const fall = s.peak ? Math.min(5, Math.max(2.2, base / 650)) : 0.9;
      forDisc(s.x, s.z, s.RT + fall, (k, d) => {
        if (el[k] <= 0) return;
        if (d <= s.RT) soft[k] = base;
        else if (s.peak) { if (d < s.RT + fall) soft[k] = Math.max(soft[k], base * (1 - (d - s.RT) / fall) ** 1.25); }
        else {
          const t = smoothstep(0, 1, (d - s.RT) / fall);
          soft[k] = base * (1 - t) + soft[k] * t;
        }
      });
    }
  }
  const softAt = (x, z) => bil(soft, w, h, x * res - 0.5, z * res - 0.5);
  const sdAt = (x, z) => bil(sd, w, h, x * res - 0.5, z * res - 0.5);

  // --- Climate: a wetness figure per place, on a coarse grid ---------------------------
  const MR = 2; // samples per unit
  const mw = Math.ceil(WORLD_W * MR) + 1, mh = Math.ceil(WORLD_D * MR) + 1;
  const moist = new Float32Array(mw * mh);
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const x = i / MR, z = j / MR;
      const [lon, lat] = worldToLonLat(x, z);
      const m = Math.max(0, elevAt(x, z));
      const inland = Math.max(0, -sdAt(x, z));
      const n = fbm(x * 0.07, z * 0.07, 4, 11);
      const n2 = noise2(x * 0.45, z * 0.45, 5);
      let M = 0.47;
      M -= 0.13 * smoothstep(22.6, 23.6, lon) * smoothstep(26.5, 25, lon) * smoothstep(36.3, 37.2, lat) * smoothstep(40, 39, lat); // rain shadow: Attica, Euboea
      M += 0.24 * smoothstep(37.6, 41.6, lat); // the north is greener
      M += 0.12 * smoothstep(22.3, 20.4, lon) * smoothstep(36.4, 38, lat); // rainy Ionian side
      M += 0.2 * smoothstep(250, 1100, m); // mountains catch rain
      M -= 0.8 * smoothstep(35.0, 33.5, lat); // Africa
      if (lon > 20 && lon < 23.4 && lat < 33.3) M += 0.42 * smoothstep(120, 520, m); // Jebel Akhdar
      const cyc = smoothstep(23.8, 24.6, lon) * smoothstep(27.6, 26.6, lon) * smoothstep(35.9, 36.4, lat) * smoothstep(38.3, 37.6, lat);
      M -= 0.2 * cyc; // the dry Cyclades
      M -= 0.24 * smoothstep(27.6, 30.6, lon) * smoothstep(5, 20, inland); // Anatolian plateau
      M += (n - 0.5) * 0.62 + (n2 - 0.5) * 0.1;
      moist[j * mw + i] = M;
    }
  }
  const moistAt = (x, z) => bil(moist, mw, mh, x * MR, z * MR);

  // --- Rivers: let rain run downhill and keep the channels that gather enough of it ------
  // Priority-flood from the sea inwards gives every land cell a downhill neighbour,
  // even across pits in the data; counting what drains through each cell gives the rivers.
  const RR = res / 2, rw = Math.floor(w / 2), rh = Math.floor(h / 2), RN = rw * rh;
  const re = new Float32Array(RN);
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      const k = j * 2 * w + i * 2;
      re[j * rw + i] = (el[k] + el[k + 1] + el[k + w] + el[k + w + 1]) / 4;
    }
  }
  const parent = new Int32Array(RN).fill(-1);
  const closed = new Uint8Array(RN);
  const order = new Int32Array(RN);
  let filled = 0;
  const LEVELS = 3600;
  const head = new Int32Array(LEVELS).fill(-1), tail = new Int32Array(LEVELS).fill(-1), next = new Int32Array(RN).fill(-1);
  const level = new Float32Array(RN);
  const push = (k, lv) => {
    const b = Math.max(0, Math.min(LEVELS - 1, Math.round(lv)));
    next[k] = -1;
    if (tail[b] < 0) head[b] = k;
    else next[tail[b]] = k;
    tail[b] = k;
  };
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      const k = j * rw + i;
      if (re[k] > 0 && !(i === 0 || j === 0 || i === rw - 1 || j === rh - 1)) continue;
      closed[k] = 1; // the sea, and the map edge, are where water leaves
      level[k] = Math.max(0, re[k]);
      let coast = re[k] > 0;
      if (!coast) {
        for (let b = -1; b <= 1 && !coast; b++) for (let a = -1; a <= 1; a++) {
          const ni = i + a, nj = j + b;
          if (ni >= 0 && nj >= 0 && ni < rw && nj < rh && re[nj * rw + ni] > 0) { coast = true; break; }
        }
      }
      if (coast) push(k, level[k]);
    }
  }
  for (let b = 0; b < LEVELS; b++) {
    while (head[b] >= 0) {
      const k = head[b];
      head[b] = next[k];
      if (head[b] < 0) tail[b] = -1;
      const i = k % rw, j = (k / rw) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= rw || nj >= rh) continue;
          const nk = nj * rw + ni;
          if (closed[nk]) continue;
          closed[nk] = 1;
          parent[nk] = k;
          level[nk] = Math.max(re[nk], level[k]);
          order[filled++] = nk;
          push(nk, Math.max(level[nk], b)); // never below the bucket being emptied
        }
      }
    }
  }
  const acc = new Float32Array(RN);
  for (let n = 0; n < filled; n++) {
    const k = order[n];
    acc[k] = Math.max(0.08, (moistAt(((k % rw) + 0.5) / RR, (((k / rw) | 0) + 0.5) / RR) - 0.12) * 2.3);
  }
  for (let n = filled - 1; n >= 0; n--) {
    const k = order[n];
    if (parent[k] >= 0) acc[parent[k]] += acc[k];
  }
  const THR = 900; // weighted cells: roughly a 350 km2 catchment in average country
  const isRiver = (k) => re[k] > 0 && acc[k] >= THR;
  const fed = new Uint8Array(RN); // has a river cell upstream
  for (let n = 0; n < filled; n++) {
    const k = order[n];
    if (isRiver(k) && parent[k] >= 0) fed[parent[k]] = 1;
  }
  const seen = new Uint8Array(RN);
  const rivers = [];
  const emit = (pts) => {
    // Round the staircase of grid steps off, then cut into short runs so each has a tight bounding box.
    for (let it = 0; it < 2; it++) {
      const sm = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
      }
      sm.push(pts[pts.length - 1]);
      pts = sm;
    }
    for (let i = 0; i < pts.length - 1; i += 16) {
      const part = pts.slice(i, i + 17);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of part) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      rivers.push({ pts: part, x0: x0 - 0.4, x1: x1 + 0.4, z0: z0 - 0.4, z1: z1 + 0.4 });
    }
  };
  for (let n = 0; n < filled; n++) {
    let k = order[n];
    if (!isRiver(k) || fed[k] || seen[k]) continue; // start only at river heads
    const pts = [];
    for (;;) {
      const wide = Math.min(7.5, 2.6 + 1.15 * Math.log2(Math.max(1, acc[k] / THR)));
      pts.push([((k % rw) + 0.5) / RR, (((k / rw) | 0) + 0.5) / RR, wide]);
      if (seen[k] || re[k] <= 0) break; // joined a river already drawn, or reached the sea
      seen[k] = 1;
      if (parent[k] < 0) break;
      k = parent[k];
    }
    if (pts.length > 3) emit(pts);
  }

  return { w, h, res, el, sd, elevAt, softAt, sdAt, moistAt, landMask, rivers, patched };
}
