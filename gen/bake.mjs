// Turns the landmark models into pixel splats.
//
// Each model is built as flat-shaded triangles (see landmarks.js). Here every
// triangle is sampled into points on the voxel grid, each point is given a
// colour from a five-step ramp according to which way its surface faces, and
// the points are handed to the renderer to be flattened with everything else.
//
// Models also declare moving parts and effects. Moving parts are kept apart so
// they can be rendered again at other moments to make animation frames;
// effects (smoke, flames, sparks, lightning) are recorded for the viewer.

import * as THREE from './three.js';
import { Geo, rgb } from './kit.js';
import { C } from './models.js';
import { MODELS } from './landmarks.js';
import { rampFrom, levelOf, pack, R } from './palette.mjs';
import { mulberry32 } from '../src/util.js';
import { KZ, KY } from './region.mjs';

const toSRGB = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const NO_SHADOW = 8, GLOW = 16;

// Landmarks whose moving parts are rendered as looping animation frames: [seconds per loop, frames per second].
const TAU = Math.PI * 2;
const ANIMATED = {
  sisyphus: [12, 8], cyclops: [9, 8], symplegades: [7, 10], labyrinth: [28 / 0.9, 6], olympia: [2 / 0.22, 8],
  sparta: [TAU / 0.35, 6], lion: [TAU / 0.5, 6], circe: [TAU / 0.5, 6], aphrodite: [TAU / 1.4, 6], aeolia: [TAU / 0.8, 6],
  underworld: [TAU / 0.25, 5], hydra: [14.5, 5], scylla: [14.5, 5], birds: [TAU / 0.9, 8], dodona: [TAU / 0.7, 8],
  athens: [TAU / 0.6, 8], etna: [TAU / 2.3, 6],
};

// A growable list of splats: integer voxel offsets from the site, a colour ramp and a level.
export class Splats {
  constructor() {
    this.map = new Map();
  }

  // rgb: the surface's own colour (0xRRGGBB), for whoever wants to light it themselves (gen/anims.mjs).
  put(x, y, z, ramp, level, bits, rgb = 0) {
    this.map.set(((y + 4096) * 8192 + z + 4096) * 8192 + x + 4096, { x, y, z, ramp, level, bits, rgb });
  }

  // Sample one triangle (points already in voxel units).
  tri(a, b, c, r8, g8, b8, glow) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (ny * KZ + nz * KY <= 0.02) return; // faces away from the camera
    const ramp = rampFrom(r8, g8, b8);
    const level = glow ? 3 : levelOf(nx, ny, nz);
    const bits = glow ? GLOW | NO_SHADOW : ny > 0.6 ? 0 : NO_SHADOW; // only upward faces take cast shadows
    const rgb = (r8 << 16) | (g8 << 8) | b8;
    const n1 = Math.max(1, Math.ceil(Math.hypot(e1x, e1y, e1z) / 0.45));
    const n2 = Math.max(1, Math.ceil(Math.hypot(e2x, e2y, e2z) / 0.45));
    for (let i = 0; i <= n1; i++) {
      const u = i / n1;
      const jm = Math.round(n2 * (1 - u));
      for (let j = 0; j <= jm; j++) {
        const v = j / n2;
        // Nudge inwards a hair so faces that meet at an edge do not fight over the same voxel.
        this.put(
          Math.round(a[0] + e1x * u + e2x * v - nx * 0.2),
          Math.round(a[1] + e1y * u + e2y * v - ny * 0.2),
          Math.round(a[2] + e1z * u + e2z * v - nz * 0.2),
          ramp, level, bits, rgb,
        );
      }
    }
  }

  // All triangles of a position/colour array pair, through an optional matrix.
  mesh(pos, col, n, scale, matrix, glow) {
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    const el = matrix ? matrix.elements : null;
    const P = (out, i) => {
      let x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (el) {
        const tx = el[0] * x + el[4] * y + el[8] * z + el[12];
        const ty = el[1] * x + el[5] * y + el[9] * z + el[13];
        z = el[2] * x + el[6] * y + el[10] * z + el[14];
        x = tx; y = ty;
      }
      out[0] = x * scale; out[1] = y * scale; out[2] = z * scale;
    };
    for (let i = 0; i < n * 3; i += 9) {
      P(a, i); P(b, i + 3); P(c, i + 6);
      this.tri(a, b, c, toSRGB(col[i]), toSRGB(col[i + 1]), toSRGB(col[i + 2]), glow);
    }
  }

  // k > 1 enlarges the stamp: each of its voxels becomes a k-sized cube.
  stamp(st, ramps, ox, oy, oz, k = 1) {
    for (let v = 0; v < st.n; v++) {
      const x = ox + st.dx[v] * k, y = oy + (st.dy[v] - 1) * k + 1, z = oz + st.dz[v] * k;
      for (let c = 0; c < k; c++) for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) this.put(x + a, y + b, z + c, ramps[st.part[v]], st.lv[v], 0);
    }
  }

  pack() {
    const list = [...this.map.values()];
    const n = list.length;
    const out = { n, x: new Int16Array(n), y: new Int16Array(n), z: new Int16Array(n), level: new Uint8Array(n), ramp: new Array(n), rgb: new Uint32Array(n) };
    list.forEach((s, i) => {
      out.x[i] = s.x; out.y[i] = s.y; out.z[i] = s.z;
      out.rgb[i] = s.rgb;
      out.level[i] = s.level | s.bits;
      out.ramp[i] = s.ramp;
    });
    return out;
  }
}

// Draw packed splats, positioned at voxel (bx, by, bz), into a region's buffers.
function splatInto(sp, bx, by, bz, ctx) {
  const { img, zb, iw, gx0, gz0, gx1, gz1, iy0, ceilAt, ex0, ez0 } = ctx;
  for (let i = 0; i < sp.n; i++) {
    const gz = bz + sp.z[i];
    if (gz < gz0 || gz >= gz1) continue;
    const gx = bx + sp.x[i];
    if (gx < gx0 || gx >= gx1) continue;
    const y = by + sp.y[i];
    const p = (Math.round(KZ * gz - KY * y) - iy0) * iw + gx - gx0;
    const zr = gz - gz0 + 1;
    if (zb[p] > zr) continue;
    let level = sp.level[i] & 7;
    if (!(sp.level[i] & NO_SHADOW) && ceilAt && ceilAt(gx - ex0, gz - ez0) > y * 8 + 6) level = level > 2 ? level - 2 : 0;
    img[p] = sp.ramp[i][level];
    zb[p] = zr;
  }
}

// snap > 1 keeps every anchor on a multiple of snap voxels and enlarges tree stamps to match:
// that is how the same landmarks are baked at a finer scale for the painter.
export function bakeLandmarks({ sites, fields, renderer, stamps, modelPx, snap = 1 }) {
  const S = renderer.S;
  const T0 = 3.0; // the moment the still image shows
  const T = { olive: new Geo().box(0, 0, 0, 0.06, 0.2, 0.06, C.woodD).blob(0, 0.36, 0, 0.26, 0.2, 0.24, rgb('#93b17e'), { dark: rgb('#4c6f51') }) };
  const TREES = {
    oak: [stamps.oak, [R.oak, R.trunk, R.blossom]], olive: [stamps.olive, [R.olive, R.trunk, R.blossom]],
    cypress: [stamps.cypress, [R.cypress, R.trunk, R.blossom]], palm: [stamps.palm, [R.palm, R.trunk, R.blossom]],
  };
  const realRandom = Math.random;
  const out = [];
  const effects = [];

  for (const s of sites) {
    const fn = MODELS[s.model];
    if (!fn) continue;
    const sid = s.seedAs || s.id;
    Math.random = mulberry32(sid.length * 7919 + sid.charCodeAt(0) * 131 + sid.charCodeAt(sid.length - 1));
    const bx = Math.round((s.x * S) / snap) * snap, bz = Math.round((s.z * S) / snap) * snap;
    const by = s.sea || !s.R ? (s.sea ? 0 : renderer.quant(renderer.heightOf(Math.max(1, s.elev)))) : renderer.quant(renderer.heightOf(s.elev));
    const group = new THREE.Group();
    const ticks = [];
    const dynamic = []; // { mesh, glow }
    const fxList = [];
    const fx = {
      time: T0,
      rgb,
      tick: (f) => { ticks.push(f); return f; },
      mesh(parent, geo, o = {}) {
        const m = new THREE.Mesh(geo.build ? geo.build() : geo);
        parent.add(m);
        dynamic.push({ mesh: m, glow: !!o.glow });
        return m;
      },
      puffs: (parent, o) => { fxList.push({ t: 'smoke', parent, o }); return { on: true }; },
      flame(parent, x, y, z, size = 0.3, o = {}) {
        fxList.push({ t: 'flame', parent, o: { x, y, z, size, ghost: !!o.outer } });
        return new THREE.Object3D();
      },
      glyphs: (parent, o) => { fxList.push({ t: 'glyph', parent, o }); return { on: true }; },
      lightning: (parent, o = {}) => { fxList.push({ t: 'bolt', parent, o: { ...o, y: 3.4 } }); return () => {}; },
      splash: () => {},
      ring: (parent, o) => { fxList.push({ t: 'ring', parent, o }); },
    };
    const treeList = [];
    const unit = modelPx / S; // world units per model unit
    const L = {
      fx, group, scene: group, grid: null, T,
      findSea: (x, z, r0, r1, prefer = 0) => {
        for (let r = r0 / 1.75; r <= r1 / 1.75; r += 0.3) {
          for (let i = 0; i < 16; i++) {
            const a = prefer + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
            const px = Math.sin(a) * r, pz = Math.cos(a) * r;
            if (fields.sdAt(s.x + px * unit, s.z + pz * unit) > 0.35) return [px, pz];
          }
        }
        return [r1 / 1.75, 0];
      },
      tree: (name, x, z, scale = 1, y = 0) => treeList.push({ name, x, z, scale, y }),
    };
    const g = new Geo(4096);
    fn(g, { ...s, x: 0, z: 0, y: 0 }, L);
    for (const f of ticks) f(T0, 0.016);
    group.updateMatrixWorld(true);

    const fixed = new Splats();
    fixed.mesh(g.pos, g.col, g.n, modelPx, null, false);
    for (const t of treeList) {
      const [list, ramps] = TREES[t.name] || TREES.oak;
      const idx = Math.min(list.length - 1, Math.max(0, Math.round((t.scale - 0.7) / 0.14)));
      fixed.stamp(list[idx % list.length], ramps, Math.round(t.x * modelPx), Math.round(t.y * modelPx), Math.round(t.z * modelPx), snap);
    }
    const visible = (m) => {
      for (let o = m; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    const poseSplats = () => {
      const sp = new Splats();
      for (const d of dynamic) {
        if (!visible(d.mesh)) continue;
        const geo = d.mesh.geometry;
        sp.mesh(geo.attributes.position.array, geo.attributes.color.array, geo.attributes.position.count, modelPx, d.mesh.matrixWorld, d.glow);
      }
      return sp.pack();
    };
    const still = poseSplats();
    const anim = dynamic.length && ticks.length && ANIMATED[s.model] ? { period: ANIMATED[s.model][0], fps: ANIMATED[s.model][1] } : null;
    const fixedPacked = fixed.pack();

    // Effects, placed in image pixels.
    const v = new THREE.Vector3();
    const place = (parent, o) => {
      v.set(o.x || 0, o.y || 0, o.z || 0);
      parent.localToWorld(v);
      return [bx + v.x * modelPx, renderer.OY + KZ * (bz + v.z * modelPx) - KY * (by + v.y * modelPx)];
    };
    for (const e of s.hidden ? [] : fxList) { // a hidden site makes no smoke and no music
      const [x, y] = place(e.parent, e.o);
      const o = e.o;
      if (e.t === 'smoke') effects.push({ t: 'smoke', x, y, c: o.color || '#ffffff', n: o.n || 6, life: o.life || 5, rise: (o.rise ?? 2) * modelPx * KY, size: (o.size || 0.3) * modelPx, dx: (o.drift?.[0] ?? 0.6) * modelPx, glow: o.glow ? 1 : 0 });
      else if (e.t === 'flame') effects.push({ t: 'flame', x, y, size: o.size * modelPx, ghost: o.ghost ? 1 : 0 });
      else if (e.t === 'glyph') effects.push({ t: 'glyph', x, y, g: o.glyph || 'note', c: o.color || '#ffffff', n: o.n || 4, life: o.life || 4, rise: (o.rise ?? 1.6) * modelPx * KY, spread: (o.spread ?? 0.5) * modelPx, dx: (o.drift?.[0] || 0) * modelPx });
      else if (e.t === 'ring') effects.push({ t: 'ring', x, y, r: Math.round(o.r * modelPx) });
      else if (e.t === 'bolt') effects.push({ t: 'bolt', x, y, drop: Math.round(3.4 * modelPx * KY), storm: s.model === 'storm' ? 1 : 0, c: o.color || '#fff7b0' });
    }

    if (s.model === 'scylla') { // Charybdis turns in the channel
      const [x, y] = place(group, { x: -0.2, y: 0.035, z: 0.55 });
      effects.push({ t: 'whirl', x, y, r: Math.round(0.5 * modelPx) });
    }
    if (s.model === 'storm') {
      const [x, y] = place(group, { y: 3.2 });
      effects.push({ t: 'rain', x, y, w: Math.round(2.8 * modelPx), h: Math.round(3.2 * modelPx * KY) });
    }

    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, height = 0, below = 0;
    for (const sp of [fixedPacked, still]) {
      for (let i = 0; i < sp.n; i++) {
        height = Math.max(height, KY * sp.y[i] - KZ * sp.z[i]);
        below = Math.max(below, KZ * sp.z[i] - KY * sp.y[i]);
        if (sp.x[i] < x0) x0 = sp.x[i];
        if (sp.x[i] > x1) x1 = sp.x[i];
        if (sp.z[i] < z0) z0 = sp.z[i];
        if (sp.z[i] > z1) z1 = sp.z[i];
      }
    }
    out.push({
      site: s, bx, by, bz,
      height: Math.round(height), // pixels the model rises above its anchor in the image
      below: Math.round(below), // and how far it reaches below it
      gx0: bx + x0, gx1: bx + x1, gz0: bz + z0, gz1: bz + z1,
      // Raise the shadow map to the model's silhouette.
      stampTops(sh, ex0, ez0, ew, ed) {
        if (this.gx1 < ex0 || this.gx0 >= ex0 + ew || this.gz1 < ez0 || this.gz0 >= ez0 + ed) return;
        for (const sp of anim ? [fixedPacked] : [fixedPacked, still]) { // parts that move cast no fixed shadow
          for (let i = 0; i < sp.n; i++) {
            if (sp.level[i] & GLOW) continue;
            const ci = bx + sp.x[i] - ex0, cj = bz + sp.z[i] - ez0;
            if (ci < 0 || cj < 0 || ci >= ew || cj >= ed) continue;
            const t = (by + sp.y[i]) * 8;
            if (t > sh[cj * ew + ci]) sh[cj * ew + ci] = t;
          }
        }
      },
      splat(ctx) {
        if (this.gx1 < ctx.gx0 || this.gx0 >= ctx.gx1 || this.gz1 < ctx.gz0 || this.gz0 >= ctx.gz1) return;
        splatInto(fixedPacked, bx, by, bz, ctx);
        if (!anim) splatInto(still, bx, by, bz, ctx); // animated parts are drawn live, frame by frame
      },
      // The moving parts at another moment, for animation frames.
      pose(t) {
        fx.time = t;
        for (const f of ticks) f(t, 0.1);
        group.updateMatrixWorld(true);
        return poseSplats();
      },
      anim, t0: T0,
      splatInto,
    });
  }
  Math.random = realRandom;
  return { landmarks: out, effects };
}
