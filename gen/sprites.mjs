// Things that move across the finished image (ships, clouds, Pegasus) are
// rendered here as small pixel-splat sprites, with the same camera and the same
// shading as the world, and packed into one atlas for the viewer.

import * as THREE from './three.js';
import { Geo, rgb } from './kit.js';
import { C, galley, beast, person } from './models.js';
import { Splats } from './bake.mjs';
import { Vox } from './stamps.mjs';
import { mulberry32 } from '../src/util.js';
import { pack, rim } from './palette.mjs';
import { KZ, KY } from './region.mjs';

// Flatten packed splats to a sprite. The anchor (ax, ay) is where the model's origin lands.
function flatten(sp, { minY = -1e9, outline = false, close = false } = {}) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const py = new Int32Array(sp.n);
  for (let i = 0; i < sp.n; i++) {
    if (sp.y[i] < minY) { py[i] = 1e9; continue; }
    py[i] = Math.round(KZ * sp.z[i] - KY * sp.y[i]);
    if (sp.x[i] < x0) x0 = sp.x[i];
    if (sp.x[i] > x1) x1 = sp.x[i];
    if (py[i] < y0) y0 = py[i];
    if (py[i] > y1) y1 = py[i];
  }
  x0--; y0--; x1++; y1++; // a pixel of room all round, for the outline
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint32Array(w * h), zb = new Int16Array(w * h).fill(-32768);
  for (let i = 0; i < sp.n; i++) {
    if (py[i] === 1e9) continue;
    const p = (py[i] - y0) * w + sp.x[i] - x0;
    if (zb[p] > sp.z[i]) continue;
    zb[p] = sp.z[i];
    data[p] = sp.ramp[i][sp.level[i] & 7];
  }
  if (close) { // fill the pinholes sampling leaves: an empty pixel with something on both sides of it
    for (let pass = 0; pass < 2; pass++) {
      const src = data.slice();
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (src[p]) continue;
          const l = src[p - 1], r = src[p + 1], u = src[p - w], d = src[p + w];
          if ((l && r) || (u && d)) data[p] = l || u;
        }
      }
    }
  }
  if (outline) {
    const solid = data.map((c) => (c ? 1 : 0));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (solid[p]) continue;
        const from = x > 0 && solid[p - 1] ? p - 1 : x < w - 1 && solid[p + 1] ? p + 1 : y > 0 && solid[p - w] ? p - w : y < h - 1 && solid[p + w] ? p + w : -1;
        if (from >= 0) data[p] = rim(data[from]);
      }
    }
  }
  return { w, h, ax: -x0, ay: -y0, data };
}

function fromGeo(build, scale, opts) {
  const g = new Geo();
  build(g);
  const sp = new Splats();
  sp.mesh(g.pos, g.col, g.n, scale, null, false);
  return flatten(sp.pack(), { outline: true, ...opts });
}

function fromVox(st, ramps) {
  const sp = { n: st.n, x: st.dx, y: st.dy, z: st.dz, level: st.lv, ramp: Array.from(st.part, (p) => ramps[p]) };
  return flatten(sp, { close: true });
}

const hexRamp = (...cols) => Uint32Array.from(cols.map((s) => {
  const v = parseInt(s.slice(1), 16);
  return pack((v >> 16) & 255, (v >> 8) & 255, v & 255);
}));

function cloudStamp(rnd, big, size, q = 1) {
  const R = (size || (big ? 38 : 25)) * q;
  const v = new Vox(R * 3 + 6, 64 * q, R + 14);
  const n = size ? 3 : 4 + ((rnd() * 4) | 0);
  const seed = (rnd() * 1e6) | 0;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * R * 0.72 + (rnd() - 0.5) * R * 0.4;
    const r = R * (0.55 + rnd() * 0.45) * (1 - Math.abs(i - (n - 1) / 2) / n * 0.7);
    v.blob(x, 6 * q + r * 0.62, (rnd() - 0.5) * R * 0.5, r, r * 0.86, r * 0.66, 0, 0.04, seed + i);
  }
  // Slice the bottom off so the cloud has a flat base.
  for (let y = 0; y <= 5 * q; y++) for (let z = -v.rz; z <= v.rz; z++) for (let x = -v.rx; x <= v.rx; x++) v.g[v.i(x, y, z)] = 0;
  return v.finish({ jitter: 0, seed });
}

// q: sprite pixels per map pixel. The painted map is finer than the splat render, so sprites are too.
export function buildSprites({ headings = 16, icarusHeading = 0, q = 1 }) {
  const frames = {}; // name -> { w, h, ax, ay, data }
  const SHIPS = {
    odysseus: [34, { sail: C.sail, device: C.red, trim: C.red, crew: true }],
    argo: [30, { sail: rgb('#f3e3a8'), device: C.gold, trim: C.gold, hull: rgb('#4f3a2a'), crew: true }],
    theseus: [27, { sail: rgb('#2b2436'), trim: C.blue, hull: rgb('#3a2c22') }],
    trader0: [22, { sail: C.sail, trim: C.blue }],
    trader1: [22, { sail: rgb('#e9c9a0'), trim: C.teal }],
    trader2: [22, { sail: rgb('#d7e6f2'), trim: C.red }],
  };
  for (const [name, [scale, o]] of Object.entries(SHIPS)) {
    for (let k = 0; k < headings; k++) {
      const phi = (k / headings) * Math.PI * 2; // direction of travel: atan2(dz, dx)
      frames[`${name}_${k}`] = fromGeo((g) => g.at(0, 0, 0, -phi, 1, (h) => galley(h, o)), scale * q, { minY: -q });
    }
  }

  // Pegasus: eight headings, wings up and wings down.
  const wing = (q, side, span, chord, lift, at, color) => {
    const m = new THREE.Matrix4().makeTranslation(at[0], at[1], side * at[2]).multiply(new THREE.Matrix4().makeRotationX(-side * lift));
    q.withMatrix(m, (w) => w.sheet([chord * 0.5, 0, 0], [chord * 0.1, 0.05, side * span], [-chord * 0.7, 0, side * span * 0.8], [-chord * 0.5, 0, 0], color, rgb('#dcd6e8')));
  };
  for (let k = 0; k < 8; k++) {
    const phi = (k / 8) * Math.PI * 2;
    [0.85, -0.45].forEach((lift, f) => {
      frames[`pegasus_${k}_${f}`] = fromGeo((g) => g.at(0, 0, 0, -phi, 1, (q) => {
        beast(q, 0, 0, 0, 0.95, { body: C.white, legs: rgb('#e6e2f0'), neck: 0.3, headUp: 0.7, snout: rgb('#e6e2f0'), mane: rgb('#f6c945'), tail: rgb('#f6c945'), legH: 0.34, bodyH: 0.3, bodyW: 0.3 });
        wing(q, 1, 1.0, 0.6, lift, [0.05, 0.62, 0.12], C.white);
        wing(q, -1, 1.0, 0.6, lift, [0.05, 0.62, 0.12], C.white);
      }), 30 * q);
    });
  }
  // Daedalus and Icarus, flying prone along the line from Crete to the Icarian Sea.
  for (const [name, tunic] of [['daedalus', rgb('#b9a0d9')], ['icarus', C.red]]) {
    [0.75, -0.4].forEach((lift, f) => {
      frames[`${name}_${f}`] = fromGeo((g) => g.at(0, 0, 0, -icarusHeading, 1, (q) => {
        q.withMatrix(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.25), (p) => person(p, 0, -0.2, 0, 0.5, { tunic, rot: Math.PI / 2, noArms: true }));
        wing(q, 1, 0.55, 0.3, lift, [0.12, 0.02, 0.06], C.white);
        wing(q, -1, 0.55, 0.3, lift, [0.12, 0.02, 0.06], C.white);
      }), 34 * q);
    });
  }
  // Ketos, the sea monster: humps that rise and sink in turn.
  const scale = rgb('#3f8f8a'), belly = rgb('#bfe3c8'), dark = rgb('#2a6470');
  for (let f = 0; f < 4; f++) {
    frames[`ketos_${f}`] = fromGeo((g) => {
      for (let i = 0; i < 5; i++) {
        const up = Math.sin((f / 4) * Math.PI * 2 + i * 1.3);
        g.blob(-1.0 + i * 0.5, -0.12 + up * 0.14, 0, 0.3, 0.3, 0.2, i % 2 ? scale : dark);
        if (up > 0.2) g.box(-1.0 + i * 0.5, 0.12 + up * 0.14, 0, 0.1, 0.12, 0.06, C.crimson); // back fin
      }
      const hy = 0.1 + Math.sin((f / 4) * Math.PI * 2) * 0.08;
      g.box(1.5, hy, 0, 0.5, 0.34, 0.34, scale);
      g.box(1.8, hy, 0, 0.3, 0.14, 0.3, belly);
      g.box(1.62, hy + 0.2, 0.18, 0.1, 0.1, 0.03, C.flame);
      g.box(1.45, hy + 0.34, 0, 0.08, 0.2, 0.06, C.crimson);
    }, 22 * q, { minY: 0 });
  }
  // Clouds.
  const rnd = mulberry32(77);
  const white = [hexRamp('#8d9ac6', '#b6c4e5', '#e6edfa', '#ffffff', '#ffffff')];
  for (let i = 0; i < 6; i++) frames[`cloud_${i}`] = fromVox(cloudStamp(rnd, i % 2 === 0, 0, q), white);
  for (let i = 0; i < 3; i++) frames[`puff_${i}`] = fromVox(cloudStamp(rnd, false, 11 + i * 2, q), white);
  const grey = [hexRamp('#2c2a44', '#454362', '#62607f', '#84829d', '#a9a7bd')];
  for (let i = 0; i < 2; i++) frames[`storm_${i}`] = fromVox(cloudStamp(rnd, true, 0, q), grey);

  // Pack on shelves.
  const names = Object.keys(frames).sort((a, b) => frames[b].h - frames[a].h);
  const AW = 2048 * q;
  let x = 1, y = 1, shelf = 0;
  const meta = {};
  for (const name of names) {
    const f = frames[name];
    if (x + f.w + 1 > AW) { x = 1; y += shelf + 1; shelf = 0; }
    meta[name] = [x, y, f.w, f.h, f.ax, f.ay, q];
    x += f.w + 1;
    shelf = Math.max(shelf, f.h);
  }
  const AH = y + shelf + 1;
  const atlas = new Uint32Array(AW * AH);
  for (const name of names) {
    const f = frames[name], [fx, fy] = meta[name];
    for (let r = 0; r < f.h; r++) atlas.set(f.data.subarray(r * f.w, (r + 1) * f.w), (fy + r) * AW + fx);
  }
  return { atlas, w: AW, h: AH, meta };
}
