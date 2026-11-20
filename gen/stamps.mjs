// Pixel-splat objects. Each one is a small cloud of coloured points in 3D: a
// tree, a boulder, a house. They are modelled here as voxels, shaded once from
// their own shape, and later dropped onto the terrain thousands of times.
//
// Every object can be built at any scale. At scale 1 it is the handful of
// voxels the whole-map picture uses. At scale F it is the same object, the same
// size on the ground, made of voxels F times smaller, with the detail that only
// shows at that size: lumps of foliage, bark, roof tiles, door planks, shutters.
// That is how zooming in finds more to see rather than bigger pixels.
//
// Axes: x east, y up, z south (towards the viewer). One voxel is one image pixel wide.

import { mulberry32, hash2, noise2 } from '../src/util.js';
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

  // The same ellipsoid for a model built large: its surface swells and dips in lumps `lump` voxels
  // across (clusters of leaves, the faces of a rock) instead of being ragged voxel by voxel.
  puff(cx, cy, cz, rx, ry, rz, slot, rag, seed, lump) {
    const m = 1 + rag * 0.6;
    for (let y = Math.max(0, Math.floor(cy - ry * m)); y <= Math.ceil(cy + ry * m); y++) {
      for (let z = Math.floor(cz - rz * m); z <= Math.ceil(cz + rz * m); z++) {
        const n1z = z / lump + y * 0.61 / lump;
        for (let x = Math.floor(cx - rx * m); x <= Math.ceil(cx + rx * m); x++) {
          const d0 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d0 > m * m) continue;
          if (d0 > (1 - rag * 0.6) ** 2) {
            const n = noise2(x / lump + y * 0.43 / lump, n1z, seed) * 0.7 + noise2(x * 2.3 / lump - y / lump, z * 2.3 / lump + y * 1.7 / lump, seed + 7) * 0.3;
            const k = 1 + (n - 0.5) * rag * 1.9;
            if (d0 > k * k) continue;
          }
          this.set(x, y, z, slot);
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

  // A line `r` voxels thick (a trunk, a mast, an oar).
  rod(x0, y0, z0, x1, y1, z1, r, slot, level = -1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))) || 1;
    const q = Math.ceil(r);
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, cz = z0 + (z1 - z0) * t;
      for (let b = -q; b <= q; b++) for (let c = -q; c <= q; c++) for (let a = -q; a <= q; a++) {
        if (a * a + b * b + c * c <= r * r + 0.3) this.set(cx + a, cy + b, cz + c, slot, level);
      }
    }
    return this;
  }

  // Force the shade of the voxels already set in a box (a row of roof tiles, a joint in a wall).
  shade(x0, y0, z0, x1, y1, z1, level, slot = -1) {
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) for (let z = Math.max(-this.rz, z0); z <= Math.min(this.rz, z1); z++) for (let x = Math.max(-this.rx, x0); x <= Math.min(this.rx, x1); x++) {
      const k = this.i(x, y, z);
      if (this.g[k] && (slot < 0 || this.g[k] === slot + 1)) this.fix[k] = level;
    }
    return this;
  }

  // Keep the voxels the camera can see (a top or a south face is open), shade them, pack them.
  // o.F: the scale it was built at. Large models take their shading from a wider neighbourhood,
  // and their surface is mottled in patches (o.mottle voxels across) as well as voxel by voxel.
  finish(o = {}) {
    const jit = o.jitter ?? 0.1;
    const seed = o.seed || 0;
    const F = o.F || 1;
    // The coarse models look two voxels each way. A fine one must look further, or the little steps a
    // curved surface is built from each get a shade of their own and it comes out in stripes; it looks
    // at every other voxel (or every third) so that further does not mean slower.
    const reach = F >= 16 ? 6 : F >= 8 ? 4 : 2, stride = F >= 16 ? 3 : F >= 8 ? 2 : 1;
    const mottle = o.mottle || 0;
    const dx = [], dy = [], dz = [], lv = [], lp = [], part = [];
    const colTop = new Map();
    for (let y = 0; y < this.h; y++) {
      for (let z = -this.rz; z <= this.rz; z++) {
        for (let x = -this.rx; x <= this.rx; x++) {
          const v = this.g[this.i(x, y, z)];
          if (!v) continue;
          if (F === 1) {
            const ck = (z + 512) * 1024 + x + 512;
            if ((colTop.get(ck) ?? -1) < y) colTop.set(ck, y);
          }
          if (this.get(x, y + 1, z) && this.get(x, y, z + 1)) continue;
          // Normal: away from the filled neighbourhood.
          let nx = 0, ny = 0, nz = 0;
          for (let b = -reach; b <= reach; b += stride) for (let c = -reach; c <= reach; c += stride) for (let a = -reach; a <= reach; a += stride) {
            if ((a || b || c) && !this.get(x + a, y + b, z + c)) { nx += a; ny += b; nz += c; }
          }
          const l = Math.hypot(nx, ny, nz);
          let level = this.fix[this.i(x, y, z)], plain = level;
          if (level < 0) {
            let j = (hash2(x * 3 + z * 17, y * 7 + z * 5, seed) - 0.5) * 2 * jit;
            if (mottle) j = j * 0.45 + (noise2(x / mottle + y * 0.5 / mottle, z / mottle + y * 0.8 / mottle, seed + 3) - 0.5) * 2.6 * jit;
            level = l > 0 ? levelOf(nx / l, ny / l, nz / l, j) : 2;
            plain = l > 0 ? levelOf(nx / l, ny / l, nz / l, 0) : 2;
          }
          dx.push(x); dy.push(y + 1); dz.push(z); lv.push(level); lp.push(plain); part.push(v - 1);
        }
      }
    }
    const cols = [...colTop.entries()];
    return {
      n: dx.length,
      dx: Int16Array.from(dx), dy: Int16Array.from(dy), dz: Int16Array.from(dz),
      lv: Uint8Array.from(lv), part: Uint8Array.from(part),
      lp: Uint8Array.from(lp), // the shade by the lie of the surface alone, for a look with no texture
      cn: cols.length,
      cx: Int16Array.from(cols.map(([k]) => (k % 1024) - 512)),
      cz: Int16Array.from(cols.map(([k]) => Math.floor(k / 1024) - 512)),
      ct: Int16Array.from(cols.map(([, t]) => t + 1)),
    };
  }
}

// A trunk for a tree built large: a tapering column with streaks of bark and a flare at the root.
function trunk(v, x0, x1, H, r, F, seed, slot = 1) {
  for (let y = 0; y <= H; y++) {
    const t = y / H, cx = x0 + (x1 - x0) * t, rr = r * (1 - 0.35 * t) + (y < F * 0.8 ? (1 - y / (F * 0.8)) * r * 0.6 : 0);
    const q = Math.ceil(rr);
    for (let c = -q; c <= q; c++) for (let a = -q; a <= q; a++) {
      if (a * a + c * c > rr * rr + 0.3) continue;
      const streak = hash2(Math.round(cx + a) * 5 + ((y / (F * 0.9)) | 0), c, seed);
      v.set(cx + a, y, c, slot, streak < 0.22 ? 1 : streak > 0.86 ? 3 : -1);
    }
  }
}

// --- Plants ---------------------------------------------------------------------
// Slots: 0 foliage, 1 trunk, 2 accent.

function oak(rnd, s, F = 1) {
  const th = Math.round(2 + 2 * s);
  const R = 3.6 * s + rnd() * 0.8;
  const seed = (rnd() * 1e6) | 0;
  const k = 2 + ((rnd() * 2) | 0);
  const extra = [];
  for (let i = 0; i < k; i++) {
    const a = rnd() * 6.283, d = R * (0.45 + rnd() * 0.3);
    extra.push([Math.cos(a) * d, th + R * (0.5 + rnd() * 0.5), Math.sin(a) * d * 0.8]);
  }
  if (F === 1) {
    const v = new Vox();
    for (let y = 0; y <= th + 1; y++) v.set(0, y, 0, 1);
    if (s > 1.15) for (let y = 0; y <= th; y++) v.set(1, y, 0, 1);
    v.blob(0, th + R * 0.8, 0, R, R * 0.82, R * 0.9, 0, 0.3, seed);
    extra.forEach(([x, y, z], i) => v.blob(x, y, z, R * 0.62, R * 0.55, R * 0.6, 0, 0.3, seed + i));
    return v.finish({ jitter: 0.13, seed });
  }
  const v = new Vox(Math.ceil(R * 1.7 * F) + 2, Math.ceil((th + R * 2.2) * F) + 2, Math.ceil(R * 1.5 * F) + 2);
  trunk(v, 0, 0.3 * F, (th + R * 0.5) * F, (s > 1.15 ? 0.95 : 0.7) * F, F, seed);
  for (const [bx, by, bz] of extra.slice(0, 2)) v.rod(0.2 * F, (th - 0.3) * F, 0, bx * 0.55 * F, by * 0.8 * F, bz * 0.55 * F, 0.22 * F, 1); // boughs
  const lump = Math.max(2, 1.25 * F);
  v.puff(0, (th + R * 0.8) * F, 0, R * F, R * 0.82 * F, R * 0.9 * F, 0, 0.3, seed, lump);
  extra.forEach(([x, y, z], i) => v.puff(x * F, y * F, z * F, R * 0.62 * F, R * 0.55 * F, R * 0.6 * F, 0, 0.32, seed + i, lump));
  return v.finish({ jitter: 0.13, seed, F, mottle: Math.max(2, 0.8 * F) });
}

function umbrellaPine(rnd, s, F = 1) {
  const th = Math.round(5 + 3 * s);
  const lean = rnd() < 0.5 ? -1 : 1;
  const seed = (rnd() * 1e6) | 0;
  const R = 4.2 * s + rnd();
  const ox = (rnd() - 0.5) * 3, oz = (rnd() - 0.5) * 2;
  if (F === 1) {
    const v = new Vox();
    for (let y = 0; y <= th; y++) v.set(y > th * 0.6 ? lean : 0, y, 0, 1);
    v.blob(lean, th + 1.6, 0, R, 1.9 * s + 0.4, R * 0.8, 0, 0.25, seed);
    v.blob(lean + ox, th + 2.8, oz, R * 0.55, 1.5 * s, R * 0.5, 0, 0.25, seed + 1);
    return v.finish({ jitter: 0.12, seed });
  }
  const v = new Vox(Math.ceil((R + 2.5) * F) + 2, Math.ceil((th + 6) * F) + 2, Math.ceil((R + 1.5) * F) + 2);
  trunk(v, 0, lean * F, (th + 1) * F, 0.6 * F, F, seed);
  for (const a of [0.6, 2.4, 4.3]) v.rod(lean * F, (th - 0.5) * F, 0, (lean + Math.cos(a) * R * 0.6) * F, (th + 1.2) * F, Math.sin(a) * R * 0.45 * F, 0.2 * F, 1);
  const lump = Math.max(2, 1.1 * F);
  v.puff(lean * F, (th + 1.6) * F, 0, R * F, (1.9 * s + 0.4) * F, R * 0.8 * F, 0, 0.26, seed, lump);
  v.puff((lean + ox) * F, (th + 2.8) * F, oz * F, R * 0.55 * F, 1.5 * s * F, R * 0.5 * F, 0, 0.26, seed + 1, lump);
  return v.finish({ jitter: 0.12, seed, F, mottle: Math.max(2, 0.7 * F) });
}

function fir(rnd, s, F = 1) {
  const H = Math.round(9 + 5 * s);
  const R = 2.6 + 1.2 * s;
  if (F === 1) {
    const v = new Vox();
    v.set(0, 0, 0, 1);
    v.set(0, 1, 0, 1);
    for (let y = 2; y <= H; y++) {
      const t = (y - 2) / (H - 2);
      const tier = 0.72 + 0.28 * (1 - ((y - 2) % 3) / 2);
      v.disc(0, y, 0, Math.max(0.4, R * (1 - t) * tier), 0);
    }
    return v.finish({ jitter: 0.1, seed: (rnd() * 1e6) | 0 });
  }
  const seed = (rnd() * 1e6) | 0;
  const v = new Vox(Math.ceil((R + 0.6) * F) + 2, (H + 2) * F, Math.ceil((R + 0.6) * F) + 2);
  trunk(v, 0, 0, 2.4 * F, 0.45 * F, F, seed);
  // Tiers of drooping boughs: each a cone, ragged at the hem.
  for (let y = 2 * F; y <= (H + 0.6) * F; y++) {
    const yy = y / F, t = (yy - 2) / (H - 2);
    const tier = 0.72 + 0.28 * (1 - ((yy - 2) % 3) / 3);
    const r = Math.max(0.3, R * (1 - t) * tier) * F;
    const q = Math.ceil(r + 1);
    for (let c = -q; c <= q; c++) for (let a = -q; a <= q; a++) {
      const rr = r * (0.82 + 0.36 * noise2(Math.atan2(c, a) * 2.2 + seed % 7, yy * 0.9, seed));
      if (a * a + c * c <= rr * rr) v.set(a, y, c, 0);
    }
  }
  return v.finish({ jitter: 0.1, seed, F, mottle: Math.max(2, 0.5 * F) });
}

function cypress(rnd, s, F = 1) {
  const H = Math.round(10 + 5 * s);
  const seed = (rnd() * 1e6) | 0;
  if (F === 1) {
    const v = new Vox();
    v.set(0, 0, 0, 1);
    v.blob(0, H / 2 + 1, 0, 1.5 + 0.5 * s, H / 2, 1.4 + 0.4 * s, 0, 0.18, seed);
    return v.finish({ jitter: 0.1, seed });
  }
  const v = new Vox(Math.ceil((2.4 + 0.5 * s) * F) + 2, (H + 3) * F, Math.ceil((2.2 + 0.4 * s) * F) + 2);
  trunk(v, 0, 0, 1.6 * F, 0.4 * F, F, seed);
  v.puff(0, (H / 2 + 1) * F, 0, (1.5 + 0.5 * s) * F, (H / 2) * F, (1.4 + 0.4 * s) * F, 0, 0.2, seed, Math.max(2, 0.8 * F));
  return v.finish({ jitter: 0.1, seed, F, mottle: Math.max(2, 0.45 * F) });
}

function olive(rnd, s, F = 1) {
  const side = rnd() < 0.5 ? 1 : -1;
  const seed = (rnd() * 1e6) | 0;
  const R = 2.5 * s + 0.4;
  if (F === 1) {
    const v = new Vox();
    v.set(0, 0, 0, 1);
    v.set(0, 1, 0, 1);
    v.set(side, 2, 0, 1);
    v.blob(-1.4 * s, 3 + R * 0.6, 0, R, R * 0.8, R * 0.9, 0, 0.35, seed);
    v.blob(1.5 * s, 3.4 + R * 0.6, 0.4, R * 0.9, R * 0.75, R * 0.85, 0, 0.35, seed + 1);
    if (s > 0.9) v.blob(0, 4.4 + R * 0.6, -0.6, R * 0.8, R * 0.7, R * 0.8, 0, 0.35, seed + 2);
    return v.finish({ jitter: 0.15, seed });
  }
  const v = new Vox(Math.ceil((1.5 * s + R * 1.3) * F) + 2, Math.ceil((5 + R * 1.6) * F) + 2, Math.ceil((R * 1.3 + 0.6) * F) + 2);
  // A short, twisted trunk that forks.
  trunk(v, 0, side * 0.4 * F, 2.2 * F, 0.65 * F, F, seed);
  v.rod(side * 0.4 * F, 2 * F, 0, -1.2 * s * F, (3 + R * 0.4) * F, 0, 0.32 * F, 1);
  v.rod(side * 0.4 * F, 2 * F, 0, 1.3 * s * F, (3.3 + R * 0.4) * F, 0.3 * F, 0.3 * F, 1);
  const lump = Math.max(2, 0.95 * F);
  v.puff(-1.4 * s * F, (3 + R * 0.6) * F, 0, R * F, R * 0.8 * F, R * 0.9 * F, 0, 0.36, seed, lump);
  v.puff(1.5 * s * F, (3.4 + R * 0.6) * F, 0.4 * F, R * 0.9 * F, R * 0.75 * F, R * 0.85 * F, 0, 0.36, seed + 1, lump);
  if (s > 0.9) v.puff(0, (4.4 + R * 0.6) * F, -0.6 * F, R * 0.8 * F, R * 0.7 * F, R * 0.8 * F, 0, 0.36, seed + 2, lump);
  return v.finish({ jitter: 0.15, seed, F, mottle: Math.max(2, 0.55 * F) });
}

function palm(rnd, s, F = 1) {
  const H = Math.round(7 + 4 * s);
  const bend = (rnd() - 0.5) * 5;
  const L = 4.5 + 2 * s;
  const n = 7;
  const angles = [];
  for (let i = 0; i < n; i++) angles.push((i / n) * 6.283 + rnd() * 0.5);
  if (F === 1) {
    const v = new Vox(16, 40, 16);
    let tx = 0;
    for (let y = 0; y <= H; y++) {
      tx = Math.round(Math.sin((y / H) * 1.3) * bend);
      v.set(tx, y, 0, 1);
    }
    for (const a of angles) {
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
  const seed = (rnd() * 1e6) | 0;
  const v = new Vox(Math.ceil((L + 3.5) * F) + 2, (H + 5) * F, Math.ceil((L + 1) * F) + 2);
  const txAt = (y) => Math.sin((y / (H * F)) * 1.3) * bend * F;
  for (let y = 0; y <= H * F; y++) { // a ringed trunk
    const r = (0.5 + 0.12 * ((y / (F * 0.55)) % 1 < 0.4 ? 1 : 0)) * F;
    const q = Math.ceil(r);
    for (let c = -q; c <= q; c++) for (let a = -q; a <= q; a++) if (a * a + c * c <= r * r + 0.3) v.set(txAt(y) + a, y, c, 1, (y / (F * 0.55)) % 1 < 0.4 ? 3 : -1);
  }
  const tx = txAt(H * F);
  for (const a of angles) { // fronds: a rib with leaflets hanging from it
    const px = -Math.sin(a), pz = Math.cos(a) * 0.9;
    for (let t = 0; t <= L * F; t += 0.5) {
      const u = t / (L * F);
      const x = tx + Math.cos(a) * t, z = Math.sin(a) * t * 0.9;
      const y = (H + 1) * F + (Math.sin(u * 2.4) * 2.2 - u * u * 3.2) * F;
      const wide = Math.sin(Math.min(1, u * 1.15) * 3.1416) * 0.75 * F + 0.5;
      for (let w = -wide; w <= wide; w += 0.5) {
        if (Math.abs(w) > 0.6 && ((t / (F * 0.3)) | 0) % 2) continue; // gaps between leaflets
        v.set(x + px * w, y - Math.abs(w) * 0.55, z + pz * w, 0);
        v.set(x + px * w, y - Math.abs(w) * 0.55 - 1, z + pz * w, 0);
      }
    }
  }
  v.puff(tx, (H + 0.5) * F, 0, 1.3 * F, F, 1.3 * F, 0, 0.2, seed, Math.max(2, 0.6 * F));
  return v.finish({ jitter: 0.1, seed, F });
}

function bush(rnd, s, F = 1) {
  const seed = (rnd() * 1e6) | 0;
  const r0 = 2.1 * s + rnd() * 0.6;
  const two = rnd() < 0.5;
  if (F === 1) {
    const v = new Vox(8, 12, 8);
    v.blob(0, 1.2 * s, 0, r0, 1.5 * s, 1.8 * s, 0, 0.4, seed);
    if (two) v.blob(1.6 * s, 0.9 * s, 0.5, 1.4 * s, 1.1 * s, 1.3 * s, 0, 0.4, seed + 1);
    return v.finish({ jitter: 0.15, seed });
  }
  const v = new Vox(Math.ceil((r0 * 1.3 + 3.2 * s) * F) + 2, Math.ceil(3.6 * s * F) + 3, Math.ceil(2.6 * s * F) + 2);
  const lump = Math.max(2, 0.8 * F);
  v.puff(0, 1.2 * s * F, 0, r0 * F, 1.5 * s * F, 1.8 * s * F, 0, 0.4, seed, lump);
  if (two) v.puff(1.6 * s * F, 0.9 * s * F, 0.5 * F, 1.4 * s * F, 1.1 * s * F, 1.3 * s * F, 0, 0.4, seed + 1, lump);
  return v.finish({ jitter: 0.15, seed, F, mottle: Math.max(2, 0.5 * F) });
}

// A few flowers or a tuft: tiny bright accents on the ground.
function flowers(rnd, s, F = 1) {
  const n = 2 + ((rnd() * 4) | 0);
  const at = [];
  for (let i = 0; i < n; i++) at.push([Math.round((rnd() - 0.5) * 7), Math.round((rnd() - 0.5) * 6), 3 + ((rnd() * 2) | 0)]);
  if (F === 1) {
    const v = new Vox(6, 6, 6);
    for (const [x, z, lv] of at) {
      v.set(x, 0, z, 0, 2);
      v.set(x, 1, z, 2, lv);
    }
    return v.finish();
  }
  // Each flower of the small picture is a clump of them here: stems, leaves, and heads with a pale eye.
  const v = new Vox(5 * F, 3 * F + 2, 4 * F);
  at.forEach(([x, z, lv], i) => {
    const k = Math.max(2, Math.round(F * 0.9));
    for (let j = 0; j < k; j++) {
      const fx = x * F + (hash2(i, j, 501) - 0.5) * F * 1.6, fz = z * F + (hash2(i, j, 502) - 0.5) * F * 1.4;
      const h = Math.round((0.7 + hash2(i, j, 503) * 0.9) * F);
      for (let y = 0; y < h; y++) v.set(fx, y, fz, 0, y % 2 ? 2 : 3);
      const r = Math.max(0.6, F * 0.16);
      v.blob(fx, h + r * 0.5, fz, r, r * 0.8, r, 2);
      v.shade(Math.round(fx - r), Math.round(h), Math.round(fz - r), Math.round(fx + r), Math.round(h + r + 1), Math.round(fz + r), lv, 2);
      if (F >= 8) v.set(fx, h + r, fz + r, 2, 4);
    }
  });
  return v.finish({ F });
}

function tuft(rnd, s, F = 1) {
  const n = 2 + ((rnd() * 3) | 0);
  const at = [];
  for (let i = 0; i < n; i++) at.push([Math.round((rnd() - 0.5) * 5), Math.round((rnd() - 0.5) * 3), rnd() < 0.5]);
  if (F === 1) {
    const v = new Vox(6, 6, 6);
    for (const [x, z, tall] of at) {
      v.set(x, 0, z, 0, 4);
      if (tall) v.set(x, 1, z, 0, 3);
    }
    return v.finish();
  }
  const v = new Vox(4 * F, 3 * F, 3 * F); // blades of grass, leaning every way
  at.forEach(([x, z, tall], i) => {
    const k = Math.round(F * 1.6);
    for (let j = 0; j < k; j++) {
      const bx = x * F + (hash2(i, j, 511) - 0.5) * F * 1.5, bz = z * F + (hash2(i, j, 512) - 0.5) * F;
      const h = (tall ? 1.5 : 0.9) * F * (0.5 + hash2(i, j, 513) * 0.7), lx = (hash2(i, j, 514) - 0.5) * F * 0.7;
      for (let y = 0; y <= h; y++) v.set(bx + lx * (y / h) ** 2, y, bz, 0, y > h * 0.6 ? 4 : 3);
    }
  });
  return v.finish({ F });
}

// --- Stone -----------------------------------------------------------------------

function boulder(rnd, s, F = 1) {
  const seed = (rnd() * 1e6) | 0;
  const rx = 1.6 * s + rnd() * 1.4, ry = 1.2 * s + rnd(), rz = 1.4 * s + rnd();
  const two = rnd() < 0.6;
  if (F === 1) {
    const v = new Vox(10, 14, 10);
    v.blob(0, ry * 0.7, 0, rx, ry, rz, 0, 0.3, seed);
    if (two) v.blob(rx * 0.8, ry * 0.4, 0.6, rx * 0.6, ry * 0.6, rz * 0.6, 0, 0.3, seed + 1);
    return v.finish({ jitter: 0.08, seed });
  }
  const v = new Vox(Math.ceil(rx * 2 * F) + 3, Math.ceil(ry * 2.2 * F) + 3, Math.ceil(rz * 1.4 * F) + 3);
  const lump = Math.max(3, 1.6 * F); // broad faces, like a rock, not leaves
  v.puff(0, ry * 0.7 * F, 0, rx * F, ry * F, rz * F, 0, 0.3, seed, lump);
  if (two) v.puff(rx * 0.8 * F, ry * 0.4 * F, 0.6 * F, rx * 0.6 * F, ry * 0.6 * F, rz * 0.6 * F, 0, 0.3, seed + 1, lump);
  return v.finish({ jitter: 0.08, seed, F, mottle: Math.max(3, 1.2 * F) });
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

// A wall of a building built large, from (x0, z0) to (x1, z1) on the ground and y0 to y1 high: plaster
// with a stone footing and, here and there, a patch where it has come away.
function wallsOf(v, x0, y0, z0, x1, y1, z1, F, seed) {
  v.box(x0, y0, z0, x1, y1, z1, 0);
  if (F < 4) return;
  const foot = Math.round(0.45 * F);
  for (let x = x0; x <= x1; x++) { // the footing, in courses, on the faces the camera sees
    for (let y = y0; y < y0 + foot; y++) v.set(x, y, z1, 0, ((y / Math.max(2, F / 4)) | 0) % 2 === ((x / Math.max(3, F / 2)) | 0) % 2 ? 2 : 1);
  }
  for (let x = x0; x <= x1; x++) for (let y = y0 + foot; y <= y1; y++) {
    if (noise2(x / (F * 0.9), y / (F * 0.7), seed) > 0.8) v.set(x, y, z1, 0, 2);
  }
}
// A door in the south wall at x (its middle), on the ground at y0: frame, planks, a handle.
function doorOf(v, x, y0, z, F, tall = 2) {
  const w = Math.max(1, Math.round(0.42 * F)), h = Math.round(tall * F * 0.82);
  v.box(x - w, y0, z, x + w, y0 + h, z, 2, 1);
  if (F < 4) return;
  for (let a = -w; a <= w; a++) for (let y = y0; y <= y0 + h; y++) {
    const edge = a === -w || a === w || y === y0 + h;
    v.set(x + a, y, z, 2, edge ? 0 : (a + w) % Math.max(2, Math.round(F / 4)) === 0 ? 1 : 2);
  }
  if (F >= 8) v.box(x + w - 2, y0 + (h >> 1), z, x + w - 2, y0 + (h >> 1) + 1, z, 2, 4);
}
// A window in the south wall: a dark opening with shutters folded back either side.
function windowOf(v, x, y, z, F) {
  const w = Math.max(1, Math.round(0.3 * F)), h = Math.max(1, Math.round(0.38 * F));
  v.box(x - w, y - h, z, x + w, y + h, z, 2, 0);
  if (F < 4) return;
  const sw = Math.max(1, Math.round(w * 0.7));
  v.box(x - w - sw, y - h, z, x - w - 1, y + h, z, 2, 2);
  v.box(x + w + 1, y - h, z, x + w + sw, y + h, z, 2, 2);
  if (F >= 8) {
    for (let yy = y - h; yy <= y + h; yy += 2) { v.box(x - w - sw, yy, z, x - w - 1, yy, z, 2, 1); v.box(x + w + 1, yy, z, x + w + sw, yy, z, 2, 1); }
    v.box(x - w - 1, y - h - 1, z, x + w + 1, y - h - 1, z, 0, 3); // the sill
  }
}
// A pitched roof over a box, its ridge along x (ridgeX) or along z. Tiles in rows, a paler ridge.
function roofOf(v, w, d, y0, F, ridgeX, hip = false) {
  const row = Math.max(2, Math.round(F * 0.42));
  if (ridgeX) {
    for (let k = 0; k <= d + F; k++) {
      const z0 = -d - F + k, z1 = d + F - k;
      const xi = hip ? k : 0;
      v.box(-w - F + xi, y0 + k, z0, w + F - xi, y0 + k, z1, 1);
      if (F >= 4) {
        const lv = k % row === 0 ? 1 : (k % row) === 1 ? 4 : -1; // the shadow under each row, the lit lip above it
        if (lv >= 0) v.shade(-w - F + xi, y0 + k, z1 - 1, w + F - xi, y0 + k, z1, lv, 1);
        if (F >= 8 && lv < 0) for (let x = -w - F + xi + ((k / row) | 0) % 2 * row; x <= w + F - xi; x += row * 2) v.set(x, y0 + k, z1, 1, 2); // joints
      }
      if (z1 - z0 <= 1) { v.shade(-w - F + xi, y0 + k, z0, w + F - xi, y0 + k, z1, 4, 1); break; }
    }
  } else {
    for (let k = 0; k <= w + F; k++) {
      const x0 = -w - F + k, x1 = w + F - k;
      v.box(x0, y0 + k, -d - F, x1, y0 + k, d + F, 1);
      if (F >= 4) {
        const lv = k % row === 0 ? 1 : (k % row) === 1 ? 3 : -1;
        if (lv >= 0) { v.shade(x0, y0 + k, -d - F, x0, y0 + k, d + F, lv, 1); v.shade(x1, y0 + k, -d - F, x1, y0 + k, d + F, lv, 1); }
      }
      if (x1 - x0 <= 1) { v.shade(x0, y0 + k, -d - F, x1, y0 + k, d + F, 4, 1); break; }
    }
    if (F >= 4) for (let y = y0; y <= y0 + w + F; y++) { // the gable end shows its courses of tile edge-on
      if ((y - y0) % row === 0) v.shade(-w - F, y, d + F, w + F, y, d + F, 1, 1);
    }
  }
}

function house(rnd, kind, F = 1) {
  const w = 3 + ((rnd() * 2) | 0), d = 2 + ((rnd() * 2) | 0), h = 3 + ((rnd() * 2) | 0);
  if (kind === 'flat') { // whitewashed cube, island style
    const dome = rnd() < 0.45;
    const dx1 = rnd() < 0.5 ? -1 : 1, dx2 = rnd() < 0.5 ? -1 : 1;
    if (F === 1) {
      const v = new Vox(10, 16, 10);
      v.box(-w, 0, -d, w, h, d, 0);
      v.box(-w, h + 1, -d, w, h + 1, d, 0, 4);
      if (dome) v.blob(0, h + 1.5, 0, 2, 1.8, 2, 1);
      v.set(dx1, 0, d, 2, 2);
      v.set(dx2, 1, d, 2, 2);
      return v.finish({ jitter: 0.04 });
    }
    const W = w * F + (F >> 1), D = d * F + (F >> 1), H = (h + 1) * F;
    const v = new Vox(W + F + 2, H + 5 * F, D + F + 2);
    wallsOf(v, -W, 0, -D, W, H, D, F, w * 31 + d);
    v.box(-W, H + 1, -D, W, H + 1, D, 0, 4); // the flat roof, bright in the sun
    const lip = Math.max(1, Math.round(F * 0.3));
    for (let y = H + 1; y <= H + lip; y++) { v.box(-W, y, -D, W, y, -D, 0); v.box(-W, y, D, W, y, D, 0); v.box(-W, y, -D, -W, y, D, 0); v.box(W, y, -D, W, y, D, 0); }
    if (dome) v.puff(0, H + 1.5 * F, 0, 2 * F, 1.8 * F, 2 * F, 1, 0.04, 1, 4 * F);
    doorOf(v, dx1 * F, 0, D, F);
    windowOf(v, -dx1 * 2 * F, Math.round(H * 0.62), D, F);
    return v.finish({ jitter: 0.04, F });
  }
  const door = Math.round((rnd() - 0.5) * (w - 1));
  if (F === 1) {
    const v = new Vox(10, 16, 10);
    v.box(-w, 0, -d, w, h, d, 0);
    if (kind === 'ridgeZ') {
      for (let k = 0; k <= w + 1; k++) v.box(-w - 1 + k, h + 1 + k, -d - 1, w + 1 - k, h + 1 + k, d + 1, 1);
    } else {
      for (let k = 0; k <= d + 1; k++) v.box(-w - 1, h + 1 + k, -d - 1 + k, w + 1, h + 1 + k, d + 1 - k, 1);
    }
    v.set(door, 0, d, 2, 1);
    v.set(door, 1, d, 2, 1);
    if (w >= 4) v.set(door + (door > 0 ? -2 : 2), 2, d, 2, 0);
    return v.finish({ jitter: 0.04 });
  }
  const W = w * F + (F >> 1), D = d * F + (F >> 1), H = (h + 1) * F - 1;
  const v = new Vox(W + 2 * F + 2, H + (Math.max(w, d) + 3) * F, D + 2 * F + 2);
  wallsOf(v, -W, 0, -D, W, H, D, F, w * 31 + d * 7 + h);
  if (kind === 'ridgeZ') { // the gable faces the camera: fill it in under the roof
    for (let k = 0; k <= W; k++) v.box(-W + k, H + 1 + k, D, W - k, H + 1 + k, D, 0);
    roofOf(v, W, D, H + 1, F, false);
  } else roofOf(v, W, D, H + 1, F, true);
  doorOf(v, door * F, 0, D, F);
  if (w >= 4) windowOf(v, (door + (door > 0 ? -2 : 2)) * F, Math.round(2.4 * F), D, F);
  else if (F >= 8) windowOf(v, (door > 0 ? -1.6 : 1.6) * F, Math.round(2.4 * F), D, F);
  return v.finish({ jitter: 0.04, F });
}

// A town house: two storeys under a hipped roof, with a door and windows on the street side.
function townhouse(rnd, s, F = 1) {
  const w = 4 + ((rnd() * 2) | 0), d = 3, h = 6 + ((rnd() * 2) | 0);
  const flat = rnd() < 0.3;
  const door = Math.round((rnd() - 0.5) * (w - 1));
  if (F === 1) {
    const v = new Vox(10, 20, 10);
    v.box(-w, 0, -d, w, h, d, 0);
    if (flat) { // a flat roof with a parapet and an awning
      v.box(-w, h + 1, -d, w, h + 1, d, 0, 4);
      v.box(-w, h + 2, -d, w, h + 2, -d, 0);
      v.box(-w + 1, h + 2, 0, w - 2, h + 3, 1, 1);
    } else {
      for (let k = 0; k <= d + 1; k++) v.box(-w - 1 + k, h + 1 + k, -d - 1 + k, w + 1 - k, h + 1 + k, d + 1 - k, 1);
    }
    v.set(door, 0, d, 2, 1);
    v.set(door, 1, d, 2, 1);
    for (let x = -w + 1; x <= w - 1; x += 2) {
      v.set(x, 4, d, 2, 0);
      if (Math.abs(x - door) > 1) v.set(x, 1, d, 2, 0);
    }
    return v.finish({ jitter: 0.04 });
  }
  const W = w * F + (F >> 1), D = d * F + (F >> 1), H = (h + 1) * F - 1;
  const v = new Vox(W + 2 * F + 2, H + 7 * F, D + 2 * F + 2);
  wallsOf(v, -W, 0, -D, W, H, D, F, w * 17 + h);
  if (F >= 4) v.shade(-W, Math.round(H * 0.5), D, W, Math.round(H * 0.5) + Math.max(0, (F >> 3)), D, 3, 0); // a string course between the storeys
  if (flat) {
    v.box(-W, H + 1, -D, W, H + 1, D, 0, 4);
    const lip = Math.max(1, Math.round(F * 0.4));
    for (let y = H + 1; y <= H + lip; y++) { v.box(-W, y, -D, W, y, -D, 0); v.box(-W, y, D, W, y, D, 0); v.box(-W, y, -D, -W, y, D, 0); v.box(W, y, -D, W, y, D, 0); }
    for (let x = -W + F; x <= W - 2 * F; x++) for (let z = 0; z <= F; z++) v.set(x, H + 2 * F + ((x / Math.max(2, F >> 1)) | 0) % 2, z, 1, ((x / Math.max(2, F >> 1)) | 0) % 2 ? 3 : 2); // a striped awning
    for (const px of [-W + F, W - 2 * F]) for (const pz of [0, F]) v.rod(px, H + 1, pz, px, H + 2 * F, pz, F >= 8 ? 0.6 : 0.3, 2, 1);
  } else roofOf(v, W, D, H + 1, F, true, true);
  doorOf(v, door * F, 0, D, F, 2.3);
  for (let x = -w + 1; x <= w - 1; x += 2) {
    windowOf(v, x * F, Math.round(4.6 * F), D, F);
    if (Math.abs(x - door) > 1) windowOf(v, x * F, Math.round(1.7 * F), D, F);
  }
  return v.finish({ jitter: 0.04, F });
}

// A stoa: a long open colonnade with a back wall, the side of a market place.
function stoa(rnd, s, F = 1) {
  const w = 8, d = 2, h = 4;
  if (F === 1) {
    const v = new Vox(12, 14, 8);
    v.box(-w - 1, 0, -d, w + 1, 0, d + 1, 2, 3);
    v.box(-w, 1, -d, w, h, -d + 1, 0);
    for (let x = -w; x <= w; x += 2) v.box(x, 1, d, x, h, d, 0, 4);
    for (let k = 0; k <= d + 1; k++) v.box(-w - 1, h + 1 + k, -d - 1 + k, w + 1, h + 1 + k, d + 2 - k, 1);
    return v.finish({ jitter: 0.03 });
  }
  const W = w * F + (F >> 1), D = d * F, H = (h + 1) * F - 1;
  const v = new Vox(W + 2 * F + 2, H + 6 * F, D + 3 * F + 2);
  v.box(-W - F, 0, -D, W + F, Math.max(0, (F >> 2) - 1), D + F, 2, 3); // the step it stands on
  if (F >= 4) for (let x = -W - F; x <= W + F; x += F) v.shade(x, 0, -D, x, F, D + F, 2, 2);
  const y0 = Math.max(1, F >> 2);
  wallsOf(v, -W, y0, -D, W, H, -D + F, F, 77);
  const r = Math.max(0.5, F * 0.32);
  for (let x = -w; x <= w; x += 2) { // columns, with a base and a capital
    v.rod(x * F, y0, D, x * F, H - 1, D, r, 0, 4);
    if (F >= 4) { v.box(Math.round(x * F - r - 1), y0, Math.round(D - r - 1), Math.round(x * F + r + 1), y0 + Math.max(0, (F >> 3)), Math.round(D + r + 1), 0, 3); v.box(Math.round(x * F - r - 1), H - 1 - Math.max(0, (F >> 3)), Math.round(D - r - 1), Math.round(x * F + r + 1), H - 1, Math.round(D + r + 1), 0, 3); }
    if (F >= 8) for (let a = -Math.floor(r); a <= Math.floor(r); a += 2) v.shade(x * F + a, y0 + 2, Math.round(D + r) - 1, x * F + a, H - 3, Math.round(D + r) + 1, 3, 0); // fluting
  }
  v.box(-W, H, -D, W, H, D + Math.round(r), 0, 3); // the beam the roof rests on
  const row = Math.max(2, Math.round(F * 0.42));
  for (let k = 0; k <= D + F; k++) {
    const z0 = -D - F + k, z1 = D + 2 * F - k;
    if (z1 < z0) break;
    v.box(-W - F, H + 1 + k, z0, W + F, H + 1 + k, z1, 1);
    if (F >= 4 && k % row < 2) v.shade(-W - F, H + 1 + k, z1 - 1, W + F, H + 1 + k, z1, k % row === 0 ? 1 : 4, 1);
  }
  return v.finish({ jitter: 0.03, F });
}

// A market stall: a counter with goods on it under a cloth awning.
function stall(rnd, s, F = 1) {
  const gx = -1 + ((rnd() * 3) | 0);
  if (F === 1) {
    const v = new Vox(6, 8, 6);
    v.box(-2, 0, -1, 2, 0, 0, 0);
    for (const x of [-2, 2]) { v.set(x, 1, 1, 0); v.set(x, 2, 1, 0); v.set(x, 1, -1, 0); v.set(x, 2, -1, 0); }
    v.box(-3, 3, -1, 3, 3, 1, 1);
    v.box(-3, 2, 2, 3, 2, 2, 1, 2);
    v.set(gx, 1, 0, 2, 4);
    v.set(1, 1, -1, 2, 3);
    return v.finish({ jitter: 0.03 });
  }
  const v = new Vox(4 * F + 2, 5 * F, 3 * F + 2);
  const top = Math.round(1.1 * F);
  v.box(-2 * F, 0, -F, 2 * F, top, Math.round(0.3 * F), 0); // the counter
  if (F >= 4) for (let x = -2 * F; x <= 2 * F; x += Math.max(2, F >> 1)) v.shade(x, 0, Math.round(0.3 * F), x, top - 1, Math.round(0.3 * F), 1, 0); // its planks
  for (const x of [-2 * F, 2 * F]) for (const z of [-F, F]) v.rod(x, 0, z, x, 3 * F, z, F >= 8 ? 0.7 : 0.4, 0);
  const st = Math.max(2, Math.round(F * 0.6)); // the awning: striped cloth, sagging a little, with a scalloped front
  for (let x = -3 * F; x <= 3 * F; x++) {
    const stripe = ((x + 3 * F) / st | 0) % 2;
    const sag = Math.round(Math.sin(((x + 3 * F) / (6 * F)) * Math.PI) * F * 0.18);
    for (let z = -F; z <= Math.round(1.6 * F); z++) v.set(x, 3 * F - sag + Math.round((F - z) * 0.18), z, 1, stripe ? 4 : 2);
    for (let y = 0; y < Math.round(F * 0.4) - (((x + 3 * F) / st) % 1 < 0.5 ? 0 : Math.round(F * 0.15)); y++) v.set(x, 3 * F - sag - y - Math.round(0.6 * F * 0.18), Math.round(1.6 * F), 1, stripe ? 3 : 1);
  }
  // Goods: heaps of fruit, a jar or two.
  const heaps = [[gx, 0, 4], [1, -0.7, 3], [-1.2, -0.5, 2], [0.2, -0.6, 4]];
  heaps.forEach(([hx, hz, lv], i) => {
    if (i > 1 && F < 4) return;
    const r = F * (0.34 + 0.08 * (i % 2));
    v.blob(hx * F, top + r * 0.6, hz * F, r, r * 0.8, r * 0.8, 2);
    v.shade(Math.round(hx * F - r), top, Math.round(hz * F - r), Math.round(hx * F + r), top + Math.round(r * 2), Math.round(hz * F + r), lv, 2);
    if (F >= 8) for (let j = 0; j < 5; j++) v.set(hx * F + (hash2(i, j, 521) - 0.5) * r * 1.4, top + r * (0.7 + hash2(i, j, 522) * 0.5), hz * F + (hash2(i, j, 523) - 0.2) * r, 2, lv > 2 ? lv - 2 : lv + 1);
  });
  return v.finish({ jitter: 0.03, F });
}

// A statue on its base.
function statue(rnd, s, F = 1) {
  const arm = rnd() < 0.5 ? -1 : 1;
  if (F === 1) {
    const v = new Vox(6, 12, 6);
    v.box(-2, 0, -2, 2, 0, 2, 0, 2);
    v.box(-1, 1, -1, 1, 2, 1, 0);
    v.box(0, 3, 0, 0, 6, 0, 1);
    v.set(0, 7, 0, 1, 4);
    v.set(arm, 5, 0, 1);
    v.set(1, 6, 0, 1);
    return v.finish({ jitter: 0.03 });
  }
  const v = new Vox(3 * F + 2, 9 * F + 2, 3 * F + 2);
  v.box(-2 * F, 0, -2 * F, 2 * F, F - 1, 2 * F, 0, 2); // steps
  v.box(-Math.round(1.4 * F), F, -Math.round(1.4 * F), Math.round(1.4 * F), 3 * F - 1, Math.round(1.4 * F), 0);
  if (F >= 4) { v.shade(-Math.round(1.4 * F), 3 * F - 1 - (F >> 3), -2 * F, Math.round(1.4 * F), 3 * F - 1, 2 * F, 4, 0); v.shade(-Math.round(1.4 * F), F, -2 * F, Math.round(1.4 * F), F + (F >> 3), 2 * F, 1, 0); }
  // The figure: legs under a long robe, a body, shoulders, a head, one arm raised.
  const y0 = 3 * F;
  v.puff(0, y0 + 1.5 * F, 0, 0.62 * F, 1.6 * F, 0.5 * F, 1, 0.08, 5, 2 * F); // robe
  v.puff(0, y0 + 3.3 * F, 0, 0.7 * F, 0.9 * F, 0.5 * F, 1, 0.06, 6, 2 * F); // chest
  v.blob(0, y0 + 4.6 * F, 0, 0.42 * F, 0.5 * F, 0.42 * F, 1); // head
  v.shade(-F, Math.round(y0 + 4.9 * F), -F, F, Math.round(y0 + 5.2 * F), F, 4, 1);
  v.rod(arm * 0.6 * F, y0 + 3.7 * F, 0, arm * 1.3 * F, y0 + 5 * F, 0.2 * F, 0.2 * F, 1); // raised arm
  v.rod(-arm * 0.6 * F, y0 + 3.6 * F, 0, -arm * 0.8 * F, y0 + 2.3 * F, 0.3 * F, 0.2 * F, 1);
  if (F >= 8) v.rod(arm * 1.3 * F, y0 + 3 * F, 0.2 * F, arm * 1.3 * F, y0 + 6.2 * F, 0.2 * F, 0.5, 1, 4); // a spear or staff
  return v.finish({ jitter: 0.03, F });
}

// A boat tied up: hull, mast and a furled sail. Slots: 0 hull, 1 sail, 2 trim.
function boat(rnd, len, F = 1) {
  const m = rnd() < 0.5 ? 0 : 1;
  if (F === 1) {
    const v = new Vox(12, 14, 6);
    for (let x = -len; x <= len; x++) {
      const hw = Math.round(1.7 * Math.sqrt(Math.max(0, 1 - (x / (len + 0.5)) ** 2)));
      v.box(x, 0, -hw, x, 0, hw, 0);
      v.set(x, 1, -hw, 2);
      v.set(x, 1, hw, 2);
    }
    v.set(-len, 1, 0, 0); v.set(-len, 2, 0, 0); v.set(len, 1, 0, 0); v.set(len, 2, 0, 0); v.set(len, 3, 0, 0);
    for (let y = 1; y <= 7; y++) v.set(m, y, 0, 0, 1);
    v.box(m - 3, 7, 0, m + 3, 7, 0, 0, 1);
    v.box(m - 3, 6, 0, m + 3, 6, 0, 1);
    return v.finish({ jitter: 0.04 });
  }
  const L = len * F + (F >> 1);
  const v = new Vox(L + F + 2, 9 * F, 2 * F + 3);
  const side = Math.round(1.3 * F);
  for (let x = -L; x <= L; x++) {
    const u = x / (L + 0.5), hw = Math.round(1.7 * F * Math.sqrt(Math.max(0, 1 - u * u)));
    const sheer = Math.round(u * u * u * u * F * 1.2); // the ends sweep up
    v.box(x, 0, -hw, x, Math.max(0, (F >> 2)), hw, 0); // bottom boards
    for (let y = 0; y <= side + sheer; y++) { // the sides, in strakes, with a painted rail
      const lv = y >= side + sheer - Math.max(0, (F >> 3)) ? -2 : (y % Math.max(2, Math.round(F * 0.4)) === 0 ? 1 : -1);
      v.set(x, y, -hw, lv === -2 ? 2 : 0, lv === -2 ? -1 : lv);
      v.set(x, y, hw, lv === -2 ? 2 : 0, lv === -2 ? -1 : lv);
    }
  }
  for (const e of [-1, 1]) v.rod(e * L, side, 0, e * (L + 0.2 * F), side + (e > 0 ? 2.2 : 1.4) * F, 0, 0.25 * F, 0, 1); // stem and stern posts
  if (F >= 4) for (let x = -L + 2 * F; x <= L - 2 * F; x += 2 * F) v.box(x, Math.round(side * 0.7), -Math.round(1.5 * F), x + Math.max(0, (F >> 2)), Math.round(side * 0.7), Math.round(1.5 * F), 0, 3); // thwarts
  v.rod(m * F, 0, 0, m * F, 7.4 * F, 0, Math.max(0.5, F * 0.16), 0, 1); // mast
  v.rod((m - 3) * F, 7 * F, 0, (m + 3) * F, 7 * F, 0, Math.max(0.5, F * 0.12), 0, 1); // yard
  for (let x = (m - 3) * F; x <= (m + 3) * F; x++) { // the sail, furled along the yard in folds
    const r = F * (0.34 + 0.1 * Math.sin(x / (F * 0.5)));
    for (let a = -Math.ceil(r); a <= Math.ceil(r); a++) for (let b = -Math.ceil(r); b <= Math.ceil(r); b++) if (a * a + b * b <= r * r) v.set(x, 6.4 * F + a, b, 1, ((x / Math.max(2, F * 0.7)) | 0) % 3 === 0 ? 1 : -1);
  }
  return v.finish({ jitter: 0.04, F });
}

// A haystack, a well, a fence post: small things that make a farm.
function hay(rnd, s, F = 1) {
  if (F === 1) {
    const v = new Vox(6, 8, 6);
    v.blob(0, 1.4, 0, 2, 2, 1.8, 0);
    return v.finish({ jitter: 0.06 });
  }
  const v = new Vox(3 * F, 4 * F + 2, 3 * F);
  v.puff(0, 1.4 * F, 0, 2 * F, 2 * F, 1.8 * F, 0, 0.12, 9, Math.max(2, 0.7 * F));
  v.rod(0, 3 * F, 0, 0, 3.8 * F, 0, 0.5, 0, 1); // the pole it is built round
  return v.finish({ jitter: 0.16, F, mottle: Math.max(2, F * 0.3) });
}

// Build the whole library: several variants of each kind. Each stamp can make itself again at
// another scale (st.at(F)): the builder is run once more on the same random numbers it drew the
// first time, so it is the same tree, only finer.
export function buildStamps() {
  const rnd = mulberry32(20240);
  const made = (fn, arg) => {
    const tape = [];
    const st = fn(() => { const v = rnd(); tape.push(v); return v; }, arg, 1);
    const fine = new Map();
    st.at = (F) => {
      if (F === 1) return st;
      if (!fine.has(F)) {
        let i = 0;
        fine.set(F, fn(() => tape[i++] ?? 0.5, arg, F));
      }
      return fine.get(F);
    };
    return st;
  };
  const many = (n, fn, arg) => Array.from({ length: n }, (_, i) => made(fn, arg(i)));
  const sizes = [0.75, 0.9, 1.0, 1.1, 1.25, 1.4];
  const none = () => 1;
  return {
    oak: many(12, oak, (i) => sizes[i % 6]),
    pine: many(8, umbrellaPine, (i) => sizes[i % 6]),
    fir: many(8, fir, (i) => sizes[i % 6] * 0.9),
    cypress: many(6, cypress, (i) => sizes[i % 6] * 0.85),
    olive: many(10, olive, (i) => sizes[i % 6] * 0.9),
    palm: many(6, palm, (i) => sizes[i % 6] * 0.9),
    bush: many(10, bush, (i) => 0.7 + (i % 5) * 0.14),
    flowers: many(12, flowers, none),
    tuft: many(8, tuft, none),
    boulder: many(10, boulder, (i) => 0.7 + (i % 5) * 0.2),
    crag: Array.from({ length: 14 }, (_, i) => crag(rnd, 0.5 + (i % 7) * 0.12, false)),
    cragSnow: Array.from({ length: 10 }, (_, i) => crag(rnd, 0.6 + (i % 5) * 0.14, true)),
    house: many(10, house, (i) => (i % 2 ? 'ridgeZ' : 'ridgeX')),
    houseFlat: many(8, house, () => 'flat'),
    hay: many(3, hay, none),
    townhouse: many(8, townhouse, none),
    stoa: [made(stoa, 1)],
    stall: many(4, stall, none),
    statue: many(3, statue, none),
    boat: many(4, boat, (i) => 4 + (i % 2)),
  };
}
