// Pixel-splat objects. Each one is a small cloud of coloured points in 3D: a
// tree, a boulder, a house. They are modelled here as voxels, shaded once from
// their own shape, and later dropped onto the terrain thousands of times.
//
// Axes: x east, y up, z south (towards the viewer). One voxel is one image pixel wide.

import { mulberry32, hash2 } from '../src/util.js';
import { levelOf } from './palette.mjs';

export class Vox {
  constructor(rx = 14, h = 40, rz = 14) {
    this.rx = rx;
    this.rz = rz;
    this.h = h;
    this.sx = rx * 2 + 1;
    this.sz = rz * 2 + 1;
    this.g = new Uint8Array(this.sx * h * this.sz); // 0 empty, else slot + 1
    this.fix = new Int8Array(this.sx * h * this.sz).fill(-1); // forced shade level, if any
  }

  i(x, y, z) {
    return ((y * this.sz + (z + this.rz)) * this.sx) + x + this.rx;
  }

  ok(x, y, z) {
    return x >= -this.rx && x <= this.rx && z >= -this.rz && z <= this.rz && y >= 0 && y < this.h;
  }

  set(x, y, z, slot, level = -1) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!this.ok(x, y, z)) return;
    const k = this.i(x, y, z);
    this.g[k] = slot + 1;
    this.fix[k] = level;
  }

  get(x, y, z) {
    return this.ok(x, y, z) ? this.g[this.i(x, y, z)] : 0;
  }

  // Ellipsoid, optionally ragged at the edge (for foliage).
  blob(cx, cy, cz, rx, ry, rz, slot, rag = 0, seed = 0) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const k = 1 + (rag ? (hash2(x * 7 + y * 13, z * 11 + y * 5, seed) - 0.5) * rag : 0);
          const d = ((x - cx) / (rx * k)) ** 2 + ((y - cy) / (ry * k)) ** 2 + ((z - cz) / (rz * k)) ** 2;
          if (d <= 1) this.set(x, y, z, slot);
        }
      }
    }
    return this;
  }

  box(x0, y0, z0, x1, y1, z1, slot, level = -1) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, slot, level);
    return this;
  }

  disc(cx, y, cz, r, slot) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r + 0.3) this.set(x, y, z, slot);
      }
    }
    return this;
  }

  line(x0, y0, z0, x1, y1, z1, slot, level = -1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, slot, level);
    }
    return this;
  }

  // Keep the voxels the camera can see (a top or a south face is open), shade them, pack them.
  finish(o = {}) {
    const jit = o.jitter ?? 0.1;
    const seed = o.seed || 0;
    const dx = [], dy = [], dz = [], lv = [], part = [];
    const colTop = new Map();
    for (let y = 0; y < this.h; y++) {
      for (let z = -this.rz; z <= this.rz; z++) {
        for (let x = -this.rx; x <= this.rx; x++) {
          const v = this.g[this.i(x, y, z)];
          if (!v) continue;
          const ck = (z + 512) * 1024 + x + 512;
          if ((colTop.get(ck) ?? -1) < y) colTop.set(ck, y);
          if (this.get(x, y + 1, z) && this.get(x, y, z + 1)) continue;
          // Normal: away from the filled neighbourhood.
          let nx = 0, ny = 0, nz = 0;
          for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (let a = -2; a <= 2; a++) {
            if ((a || b || c) && !this.get(x + a, y + b, z + c)) { nx += a; ny += b; nz += c; }
          }
          const l = Math.hypot(nx, ny, nz);
          let level = this.fix[this.i(x, y, z)];
          if (level < 0) {
            const j = (hash2(x * 3 + z * 17, y * 7 + z * 5, seed) - 0.5) * 2 * jit;
            level = l > 0 ? levelOf(nx / l, ny / l, nz / l, j) : 2;
          }
          dx.push(x); dy.push(y + 1); dz.push(z); lv.push(level); part.push(v - 1);
        }
      }
    }
    const cols = [...colTop.entries()];
    return {
      n: dx.length,
      dx: Int16Array.from(dx), dy: Int16Array.from(dy), dz: Int16Array.from(dz),
      lv: Uint8Array.from(lv), part: Uint8Array.from(part),
      cn: cols.length,
      cx: Int16Array.from(cols.map(([k]) => (k % 1024) - 512)),
      cz: Int16Array.from(cols.map(([k]) => Math.floor(k / 1024) - 512)),
      ct: Int16Array.from(cols.map(([, t]) => t + 1)),
    };
  }
}

// --- Plants ---------------------------------------------------------------------
// Slots: 0 foliage, 1 trunk, 2 accent.

function oak(rnd, s) {
  const v = new Vox();
  const th = Math.round(2 + 2 * s);
  const R = 3.6 * s + rnd() * 0.8;
  for (let y = 0; y <= th + 1; y++) v.set(0, y, 0, 1);
  if (s > 1.15) for (let y = 0; y <= th; y++) v.set(1, y, 0, 1);
  const seed = (rnd() * 1e6) | 0;
  v.blob(0, th + R * 0.8, 0, R, R * 0.82, R * 0.9, 0, 0.3, seed);
  const k = 2 + ((rnd() * 2) | 0);
  for (let i = 0; i < k; i++) {
    const a = rnd() * 6.283, d = R * (0.45 + rnd() * 0.3);
    v.blob(Math.cos(a) * d, th + R * (0.5 + rnd() * 0.5), Math.sin(a) * d * 0.8, R * 0.62, R * 0.55, R * 0.6, 0, 0.3, seed + i);
  }
  return v.finish({ jitter: 0.13, seed });
}

function umbrellaPine(rnd, s) {
  const v = new Vox();
  const th = Math.round(5 + 3 * s);
  const lean = rnd() < 0.5 ? -1 : 1;
  for (let y = 0; y <= th; y++) v.set(y > th * 0.6 ? lean : 0, y, 0, 1);
  const seed = (rnd() * 1e6) | 0;
  const R = 4.2 * s + rnd();
  v.blob(lean, th + 1.6, 0, R, 1.9 * s + 0.4, R * 0.8, 0, 0.25, seed);
  v.blob(lean + (rnd() - 0.5) * 3, th + 2.8, (rnd() - 0.5) * 2, R * 0.55, 1.5 * s, R * 0.5, 0, 0.25, seed + 1);
  return v.finish({ jitter: 0.12, seed });
}

function fir(rnd, s) {
  const v = new Vox();
  const H = Math.round(9 + 5 * s);
  const R = 2.6 + 1.2 * s;
  v.set(0, 0, 0, 1);
  v.set(0, 1, 0, 1);
  for (let y = 2; y <= H; y++) {
    const t = (y - 2) / (H - 2);
    const tier = 0.72 + 0.28 * (1 - ((y - 2) % 3) / 2);
    v.disc(0, y, 0, Math.max(0.4, R * (1 - t) * tier), 0);
  }
  return v.finish({ jitter: 0.1, seed: (rnd() * 1e6) | 0 });
}

function cypress(rnd, s) {
  const v = new Vox();
  const H = Math.round(10 + 5 * s);
  v.set(0, 0, 0, 1);
  const seed = (rnd() * 1e6) | 0;
  v.blob(0, H / 2 + 1, 0, 1.5 + 0.5 * s, H / 2, 1.4 + 0.4 * s, 0, 0.18, seed);
  return v.finish({ jitter: 0.1, seed });
}

function olive(rnd, s) {
  const v = new Vox();
  v.set(0, 0, 0, 1);
  v.set(0, 1, 0, 1);
  v.set(rnd() < 0.5 ? 1 : -1, 2, 0, 1);
  const seed = (rnd() * 1e6) | 0;
  const R = 2.5 * s + 0.4;
  v.blob(-1.4 * s, 3 + R * 0.6, 0, R, R * 0.8, R * 0.9, 0, 0.35, seed);
  v.blob(1.5 * s, 3.4 + R * 0.6, 0.4, R * 0.9, R * 0.75, R * 0.85, 0, 0.35, seed + 1);
  if (s > 0.9) v.blob(0, 4.4 + R * 0.6, -0.6, R * 0.8, R * 0.7, R * 0.8, 0, 0.35, seed + 2);
  return v.finish({ jitter: 0.15, seed });
}

function palm(rnd, s) {
  const v = new Vox(16, 40, 16);
  const H = Math.round(7 + 4 * s);
  const bend = (rnd() - 0.5) * 5;
  let tx = 0;
  for (let y = 0; y <= H; y++) {
    tx = Math.round(Math.sin((y / H) * 1.3) * bend);
    v.set(tx, y, 0, 1);
  }
  const L = 4.5 + 2 * s;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd() * 0.5;
    for (let t = 0; t <= L; t += 0.5) {
      const u = t / L;
      const x = tx + Math.cos(a) * t, z = Math.sin(a) * t * 0.9;
      const y = H + 1 + Math.sin(u * 2.4) * 2.2 - u * u * 3.2;
      v.set(x, y, z, 0);
      if (u > 0.25 && u < 0.85) v.set(x, y - 1, z, 0);
    }
  }
  v.blob(tx, H + 0.5, 0, 1.3, 1, 1.3, 0);
  return v.finish({ jitter: 0.1, seed: (rnd() * 1e6) | 0 });
}

function bush(rnd, s) {
  const v = new Vox(8, 12, 8);
  const seed = (rnd() * 1e6) | 0;
  v.blob(0, 1.2 * s, 0, 2.1 * s + rnd() * 0.6, 1.5 * s, 1.8 * s, 0, 0.4, seed);
  if (rnd() < 0.5) v.blob(1.6 * s, 0.9 * s, 0.5, 1.4 * s, 1.1 * s, 1.3 * s, 0, 0.4, seed + 1);
  return v.finish({ jitter: 0.15, seed });
}

// A few flowers or a tuft: tiny bright accents on the ground.
function flowers(rnd) {
  const v = new Vox(6, 6, 6);
  const n = 2 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const x = Math.round((rnd() - 0.5) * 7), z = Math.round((rnd() - 0.5) * 6);
    v.set(x, 0, z, 0, 2);
    v.set(x, 1, z, 2, 3 + ((rnd() * 2) | 0));
  }
  return v.finish();
}

function tuft(rnd) {
  const v = new Vox(6, 6, 6);
  const n = 2 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const x = Math.round((rnd() - 0.5) * 5), z = Math.round((rnd() - 0.5) * 3);
    v.set(x, 0, z, 0, 4);
    if (rnd() < 0.5) v.set(x, 1, z, 0, 3);
  }
  return v.finish();
}

// --- Stone -----------------------------------------------------------------------

function boulder(rnd, s) {
  const v = new Vox(10, 14, 10);
  const seed = (rnd() * 1e6) | 0;
  const rx = 1.6 * s + rnd() * 1.4, ry = 1.2 * s + rnd(), rz = 1.4 * s + rnd();
  v.blob(0, ry * 0.7, 0, rx, ry, rz, 0, 0.3, seed);
  if (rnd() < 0.6) v.blob(rx * 0.8, ry * 0.4, 0.6, rx * 0.6, ry * 0.6, rz * 0.6, 0, 0.3, seed + 1);
  return v.finish({ jitter: 0.08, seed });
}

// A mountain crag: a ragged spire, sometimes capped with snow (slot 2). No longer placed (mountains
// are shaped by the terrain itself now), but still built: every stamp after it draws on the same
// run of random numbers, and removing it would change them all.
function crag(rnd, s, snow) {
  const v = new Vox(12, 46, 12);
  const H = Math.round(7 + 11 * s * (0.6 + rnd() * 0.6));
  const R = 2.2 + 2.4 * s * (0.6 + rnd() * 0.5);
  const seed = (rnd() * 1e6) | 0;
  let ox = 0, oz = 0;
  for (let y = 0; y <= H; y++) {
    const t = y / H;
    if (y % 3 === 0) {
      ox += Math.round((rnd() - 0.5) * 1.6);
      oz += Math.round((rnd() - 0.5) * 1.2);
    }
    const r = R * (1 - t) ** 0.75 * (0.8 + 0.4 * hash2(y, seed, 3)) + 0.35;
    const slot = snow && t > 0.55 + 0.2 * hash2(y, seed, 4) ? 2 : 0;
    for (let z = Math.floor(oz - r); z <= Math.ceil(oz + r); z++) {
      for (let x = Math.floor(ox - r); x <= Math.ceil(ox + r); x++) {
        const rr = r * (0.75 + 0.5 * hash2(x * 5 + y, z * 9 + y * 3, seed));
        if ((x - ox) ** 2 + ((z - oz) / 0.85) ** 2 <= rr * rr) v.set(x, y, z, slot);
      }
    }
  }
  // A shoulder spike or two.
  const k = (rnd() * 3) | 0;
  for (let i = 0; i < k; i++) {
    const a = rnd() * 6.283, d = R * 0.9;
    const h2 = Math.round(H * (0.3 + rnd() * 0.35));
    for (let y = 0; y <= h2; y++) v.disc(Math.cos(a) * d, y, Math.sin(a) * d * 0.8, (R * 0.5) * (1 - y / h2) + 0.4, 0);
  }
  return v.finish({ jitter: 0.09, seed });
}

// --- Houses ------------------------------------------------------------------------
// Slots: 0 wall, 1 roof, 2 door and shutters.

function house(rnd, kind) {
  const v = new Vox(10, 16, 10);
  const w = 3 + ((rnd() * 2) | 0), d = 2 + ((rnd() * 2) | 0), h = 3 + ((rnd() * 2) | 0);
  if (kind === 'flat') { // whitewashed cube, island style
    v.box(-w, 0, -d, w, h, d, 0);
    v.box(-w, h + 1, -d, w, h + 1, d, 0, 4);
    if (rnd() < 0.45) v.blob(0, h + 1.5, 0, 2, 1.8, 2, 1); // a dome
    v.set(rnd() < 0.5 ? -1 : 1, 0, d, 2, 2);
    v.set(rnd() < 0.5 ? -1 : 1, 1, d, 2, 2);
    return v.finish({ jitter: 0.04 });
  }
  v.box(-w, 0, -d, w, h, d, 0);
  if (kind === 'ridgeZ') {
    for (let k = 0; k <= w + 1; k++) v.box(-w - 1 + k, h + 1 + k, -d - 1, w + 1 - k, h + 1 + k, d + 1, 1);
  } else {
    for (let k = 0; k <= d + 1; k++) v.box(-w - 1, h + 1 + k, -d - 1 + k, w + 1, h + 1 + k, d + 1 - k, 1);
  }
  const door = Math.round((rnd() - 0.5) * (w - 1));
  v.set(door, 0, d, 2, 1);
  v.set(door, 1, d, 2, 1);
  if (w >= 4) v.set(door + (door > 0 ? -2 : 2), 2, d, 2, 0);
  return v.finish({ jitter: 0.04 });
}

// A town house: two storeys under a hipped roof, with a door and windows on the street side.
function townhouse(rnd) {
  const v = new Vox(10, 20, 10);
  const w = 4 + ((rnd() * 2) | 0), d = 3, h = 6 + ((rnd() * 2) | 0);
  v.box(-w, 0, -d, w, h, d, 0);
  if (rnd() < 0.3) { // a flat roof with a parapet and an awning
    v.box(-w, h + 1, -d, w, h + 1, d, 0, 4);
    v.box(-w, h + 2, -d, w, h + 2, -d, 0);
    v.box(-w + 1, h + 2, 0, w - 2, h + 3, 1, 1);
  } else {
    for (let k = 0; k <= d + 1; k++) v.box(-w - 1 + k, h + 1 + k, -d - 1 + k, w + 1 - k, h + 1 + k, d + 1 - k, 1);
  }
  const door = Math.round((rnd() - 0.5) * (w - 1));
  v.set(door, 0, d, 2, 1);
  v.set(door, 1, d, 2, 1);
  for (let x = -w + 1; x <= w - 1; x += 2) {
    v.set(x, 4, d, 2, 0);
    if (Math.abs(x - door) > 1) v.set(x, 1, d, 2, 0);
  }
  return v.finish({ jitter: 0.04 });
}

// A stoa: a long open colonnade with a back wall, the side of a market place.
function stoa() {
  const v = new Vox(12, 14, 8);
  const w = 8, d = 2, h = 4;
  v.box(-w - 1, 0, -d, w + 1, 0, d + 1, 2, 3);
  v.box(-w, 1, -d, w, h, -d + 1, 0);
  for (let x = -w; x <= w; x += 2) v.box(x, 1, d, x, h, d, 0, 4);
  for (let k = 0; k <= d + 1; k++) v.box(-w - 1, h + 1 + k, -d - 1 + k, w + 1, h + 1 + k, d + 2 - k, 1);
  return v.finish({ jitter: 0.03 });
}

// A market stall: a counter with goods on it under a cloth awning.
function stall(rnd) {
  const v = new Vox(6, 8, 6);
  v.box(-2, 0, -1, 2, 0, 0, 0);
  for (const x of [-2, 2]) { v.set(x, 1, 1, 0); v.set(x, 2, 1, 0); v.set(x, 1, -1, 0); v.set(x, 2, -1, 0); }
  v.box(-3, 3, -1, 3, 3, 1, 1);
  v.box(-3, 2, 2, 3, 2, 2, 1, 2);
  v.set(-1 + ((rnd() * 3) | 0), 1, 0, 2, 4);
  v.set(1, 1, -1, 2, 3);
  return v.finish({ jitter: 0.03 });
}

// A statue on its base.
function statue(rnd) {
  const v = new Vox(6, 12, 6);
  v.box(-2, 0, -2, 2, 0, 2, 0, 2);
  v.box(-1, 1, -1, 1, 2, 1, 0);
  v.box(0, 3, 0, 0, 6, 0, 1);
  v.set(0, 7, 0, 1, 4);
  v.set(rnd() < 0.5 ? -1 : 1, 5, 0, 1);
  v.set(1, 6, 0, 1);
  return v.finish({ jitter: 0.03 });
}

// A boat tied up: hull, mast and a furled sail. Slots: 0 hull, 1 sail, 2 trim.
function boat(rnd, len) {
  const v = new Vox(12, 14, 6);
  for (let x = -len; x <= len; x++) {
    const hw = Math.round(1.7 * Math.sqrt(Math.max(0, 1 - (x / (len + 0.5)) ** 2)));
    v.box(x, 0, -hw, x, 0, hw, 0);
    v.set(x, 1, -hw, 2);
    v.set(x, 1, hw, 2);
  }
  v.set(-len, 1, 0, 0); v.set(-len, 2, 0, 0); v.set(len, 1, 0, 0); v.set(len, 2, 0, 0); v.set(len, 3, 0, 0);
  const m = rnd() < 0.5 ? 0 : 1;
  for (let y = 1; y <= 7; y++) v.set(m, y, 0, 0, 1);
  v.box(m - 3, 7, 0, m + 3, 7, 0, 0, 1);
  v.box(m - 3, 6, 0, m + 3, 6, 0, 1);
  return v.finish({ jitter: 0.04 });
}

// A haystack, a well, a fence post: small things that make a farm.
function hay(rnd) {
  const v = new Vox(6, 8, 6);
  v.blob(0, 1.4, 0, 2, 2, 1.8, 0);
  return v.finish({ jitter: 0.06 });
}

// Build the whole library: several variants of each kind.
export function buildStamps() {
  const rnd = mulberry32(20240);
  const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const sizes = [0.75, 0.9, 1.0, 1.1, 1.25, 1.4];
  return {
    oak: many(12, (i) => oak(rnd, sizes[i % 6])),
    pine: many(8, (i) => umbrellaPine(rnd, sizes[i % 6])),
    fir: many(8, (i) => fir(rnd, sizes[i % 6] * 0.9)),
    cypress: many(6, (i) => cypress(rnd, sizes[i % 6] * 0.85)),
    olive: many(10, (i) => olive(rnd, sizes[i % 6] * 0.9)),
    palm: many(6, (i) => palm(rnd, sizes[i % 6] * 0.9)),
    bush: many(10, (i) => bush(rnd, 0.7 + (i % 5) * 0.14)),
    flowers: many(12, () => flowers(rnd)),
    tuft: many(8, () => tuft(rnd)),
    boulder: many(10, (i) => boulder(rnd, 0.7 + (i % 5) * 0.2)),
    crag: many(14, (i) => crag(rnd, 0.5 + (i % 7) * 0.12, false)),
    cragSnow: many(10, (i) => crag(rnd, 0.6 + (i % 5) * 0.14, true)),
    house: many(10, (i) => house(rnd, i % 2 ? 'ridgeZ' : 'ridgeX')),
    houseFlat: many(8, () => house(rnd, 'flat')),
    hay: many(3, () => hay(rnd)),
    townhouse: many(8, () => townhouse(rnd)),
    stoa: [stoa()],
    stall: many(4, () => stall(rnd)),
    statue: many(3, () => statue(rnd)),
    boat: many(4, (i) => boat(rnd, 4 + (i % 2))),
  };
}
