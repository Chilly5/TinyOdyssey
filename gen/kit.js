// A tiny modelling kit. Everything in the diorama (terrain, trees, temples,
// monsters) is built from flat-shaded, vertex-coloured triangles pushed into a Geo.

import * as THREE from './three.js';

const _c = new THREE.Color();

// Colour from a hex string, as linear RGB floats ready for a vertex attribute.
export function rgb(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// Unit icosahedron, used for tree canopies, boulders and clouds.
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  });
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
    [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
    [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { v, f };
})();

export class Geo {
  constructor(capacity = 1024) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.edge = new Float32Array(capacity);
    this.n = 0; // vertex count
    this.hasEdge = false;
    this.m = null; // optional transform (THREE.Matrix4) applied to emitted vertices
    this._stack = [];
  }

  _reserve(extra) {
    const need = this.n + extra;
    if (need * 3 <= this.pos.length) return;
    let cap = this.pos.length / 3;
    while (cap < need) cap *= 2;
    const pos = new Float32Array(cap * 3);
    pos.set(this.pos.subarray(0, this.n * 3));
    const col = new Float32Array(cap * 3);
    col.set(this.col.subarray(0, this.n * 3));
    const edge = new Float32Array(cap);
    edge.set(this.edge.subarray(0, this.n));
    this.pos = pos;
    this.col = col;
    this.edge = edge;
  }

  // Run fn with an extra transform: translate, rotate about Y, then scale.
  at(x, y, z, rotY, scale, fn) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY || 0),
      typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...(scale || [1, 1, 1])),
    );
    return this.withMatrix(m, fn);
  }

  withMatrix(m, fn) {
    this._stack.push(this.m);
    this.m = this.m ? this.m.clone().multiply(m) : m;
    fn(this);
    this.m = this._stack.pop();
    return this;
  }

  _v(x, y, z, c, e) {
    const i = this.n * 3;
    if (this.m) {
      const el = this.m.elements;
      const tx = el[0] * x + el[4] * y + el[8] * z + el[12];
      const ty = el[1] * x + el[5] * y + el[9] * z + el[13];
      const tz = el[2] * x + el[6] * y + el[10] * z + el[14];
      x = tx; y = ty; z = tz;
    }
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.col[i] = c[0]; this.col[i + 1] = c[1]; this.col[i + 2] = c[2];
    this.edge[this.n] = e;
    this.n++;
  }

  // Triangle a, b, c (arrays of 3). Counter-clockwise when seen from its front.
  tri(a, b, c, color, ea = 0, eb = 0, ec = 0) {
    this._reserve(3);
    if (ea || eb || ec) this.hasEdge = true;
    this._v(a[0], a[1], a[2], color, ea);
    this._v(b[0], b[1], b[2], color, eb);
    this._v(c[0], c[1], c[2], color, ec);
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  // Both faces of a thin sheet (sails, wings, banners).
  sheet(a, b, c, d, color, back = color) {
    this.quad(a, b, c, d, color);
    this.quad(d, c, b, a, back);
  }

  // Axis-aligned box. (x, z) is the centre of its footprint and y its underside.
  box(x, y, z, w, h, d, color, opts = {}) {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y, y1 = y + h, z0 = z - d / 2, z1 = z + d / 2;
    const top = opts.top || color;
    const side = opts.side || color;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    this.quad([x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], side); // south
    this.quad([x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], side); // east
    this.quad([x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], side); // north
    this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], side); // west
    if (opts.bottom) this.quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], side);
    return this;
  }

  // Cylinder, frustum or cone standing on y. r1 is the top radius (0 makes a cone).
  cyl(x, y, z, r0, r1, h, sides, color, opts = {}) {
    const top = opts.top || color;
    const phase = opts.phase || 0;
    // Round things are asked for with a handful of sides, from when a model was a few pixels across.
    // Three and four sides mean a prism or a pyramid and stay; anything more is meant to be round.
    if (sides >= 5 && sides <= 10 && !opts.exact) sides *= 2;
    for (let i = 0; i < sides; i++) {
      const a0 = phase + (i / sides) * Math.PI * 2;
      const a1 = phase + ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const b0 = [x + c0 * r0, y, z + s0 * r0];
      const b1 = [x + c1 * r0, y, z + s1 * r0];
      if (r1 > 0) {
        const t0 = [x + c0 * r1, y + h, z + s0 * r1];
        const t1 = [x + c1 * r1, y + h, z + s1 * r1];
        this.quad(t0, t1, b1, b0, color);
        this.tri([x, y + h, z], t1, t0, top);
      } else {
        this.tri([x, y + h, z], b1, b0, color);
      }
    }
    return this;
  }

  // Faceted blob: an icosahedron stretched to radii (rx, ry, rz) around its centre.
  blob(x, y, z, rx, ry, rz, color, opts = {}) {
    const dark = opts.dark; // optional colour for downward faces
    const rot = opts.rot || 0;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (p) => {
      const px = p[0] * cr - p[2] * sr;
      const pz = p[0] * sr + p[2] * cr;
      return [x + px * rx, y + p[1] * ry, z + pz * rz];
    };
    const N = (p, q) => {
      const v = [p[0] + q[0], p[1] + q[1], p[2] + q[2]], l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    for (const f of ICO.f) { // each of the twenty faces as four, pushed out to the round
      const a = ICO.v[f[0]], b = ICO.v[f[1]], c = ICO.v[f[2]];
      const ab = N(a, b), bc = N(b, c), ca = N(c, a);
      for (const [p, q, r] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) {
        const down = p[1] + q[1] + r[1] < -1.2;
        this.tri(P(p), P(q), P(r), dark && down ? dark : color);
      }
    }
    return this;
  }

  // Triangle a, b, c, turned whichever way makes it face away from the point o (somewhere inside the
  // shape it belongs to). Lets a rounded shape be built without minding the order of its corners.
  triOut(a, b, c, color, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return this;
    const d = nx * (a[0] + b[0] + c[0] - 3 * o[0]) + ny * (a[1] + b[1] + c[1] - 3 * o[1]) + nz * (a[2] + b[2] + c[2] - 3 * o[2]);
    if (d >= 0) this.tri(a, b, c, color);
    else this.tri(a, c, b, color);
    return this;
  }

  // A smooth ball, or an egg when the radii differ: seg faces round it. opts.from / opts.to keep only a
  // part of it, measured from its underside (0) to its crown (1); opts.dark colours what faces down.
  ball(x, y, z, rx, ry, rz, color, opts = {}) {
    const seg = opts.seg || 10, rings = opts.rings || Math.max(4, Math.round(seg * 0.6));
    const lo = opts.from ?? 0, hi = opts.to ?? 1;
    const rot = opts.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const o = [x, y, z];
    const P = (i, j) => {
      const t = Math.PI * (lo + ((hi - lo) * j) / rings), ph = (i / seg) * Math.PI * 2;
      const px = Math.sin(t) * Math.cos(ph) * rx, pz = Math.sin(t) * Math.sin(ph) * rz;
      return [x + px * cr - pz * sr, y - Math.cos(t) * ry, z + px * sr + pz * cr];
    };
    for (let j = 0; j < rings; j++) {
      const col = opts.dark && (lo + ((hi - lo) * (j + 0.5)) / rings) < 0.3 ? opts.dark : color;
      for (let i = 0; i < seg; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        this.triOut(a, b, c, col, o);
        this.triOut(a, c, d, col, o);
      }
    }
    return this;
  }

  // A limb: a round bar from point a to point b, r0 thick at a and r1 at b, its ends rounded off.
  limb(a, b, r0, r1, color, opts = {}) {
    const sides = opts.sides || 8;
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    dx /= len; dy /= len; dz /= len;
    // Two directions square to the bar and to each other.
    let ux = Math.abs(dy) < 0.9 ? 0 : 1, uy = Math.abs(dy) < 0.9 ? 1 : 0, uz = 0;
    let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const vl = Math.hypot(vx, vy, vz);
    vx /= vl; vy /= vl; vz /= vl;
    ux = vy * dz - vz * dy; uy = vz * dx - vx * dz; uz = vx * dy - vy * dx;
    const ring = (p, r, i) => {
      const t = (i / sides) * Math.PI * 2, c = Math.cos(t) * r, s = Math.sin(t) * r;
      return [p[0] + ux * c + vx * s, p[1] + uy * c + vy * s, p[2] + uz * c + vz * s];
    };
    for (let i = 0; i < sides; i++) {
      const a0 = ring(a, r0, i), a1 = ring(a, r0, i + 1), b0 = ring(b, r1, i), b1 = ring(b, r1, i + 1);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      // Each face is turned away from the bar's own axis beside it, so a strong taper cannot turn it inside out.
      const ref = (p, q) => {
        const cx = (p[0] + q[0]) / 2 - a[0], cy = (p[1] + q[1]) / 2 - a[1], cz = (p[2] + q[2]) / 2 - a[2];
        const t = cx * dx + cy * dy + cz * dz;
        return [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
      };
      this.triOut(a0, a1, b1, color, ref(a0, b1));
      this.triOut(a0, b1, b0, color, ref(a0, b1));
      void mid;
    }
    if (!opts.open) {
      if (r0 > 0) this.ball(a[0], a[1], a[2], r0, r0, r0, color, { seg: sides, rings: 4 });
      if (r1 > 0) this.ball(b[0], b[1], b[2], r1, r1, r1, color, { seg: sides, rings: 4 });
    }
    return this;
  }

  // A shape turned on a lathe about the upright through (x, z). profile: [[radius, height], ...] from the
  // bottom up. opts.flute pulls every other corner in by that fraction (the flutes of a column);
  // opts.sx / opts.sz stretch it into an oval; opts.top colours the cap, opts.bottom closes the underside.
  lathe(x, y, z, profile, sides, color, opts = {}) {
    const phase = opts.phase || 0, flute = opts.flute || 0, sx = opts.sx || 1, sz = opts.sz || 1;
    const P = (k, i) => {
      const t = phase + (i / sides) * Math.PI * 2;
      const r = profile[k][0] * (flute && i % 2 ? 1 - flute : 1);
      return [x + Math.cos(t) * r * sx, y + profile[k][1], z + Math.sin(t) * r * sz];
    };
    for (let k = 0; k < profile.length - 1; k++) {
      const o = [x, y + (profile[k][1] + profile[k + 1][1]) / 2, z];
      const col = opts.cols ? opts.cols[k] || color : color;
      for (let i = 0; i < sides; i++) {
        const a = P(k, i), b = P(k, i + 1), c = P(k + 1, i + 1), d = P(k + 1, i);
        this.triOut(a, b, c, col, o);
        this.triOut(a, c, d, col, o);
      }
    }
    const last = profile.length - 1;
    if (profile[last][0] > 0) {
      const c = [x, y + profile[last][1], z], o = [x, y + profile[last][1] - 1, z];
      for (let i = 0; i < sides; i++) this.triOut(c, P(last, i), P(last, i + 1), opts.top || color, o);
    }
    if (opts.bottom && profile[0][0] > 0) {
      const c = [x, y + profile[0][1], z], o = [x, y + profile[0][1] + 1, z];
      for (let i = 0; i < sides; i++) this.triOut(c, P(0, i), P(0, i + 1), color, o);
    }
    return this;
  }

  // A boulder: a ball of eighty flat faces, knocked about so that no two are alike. The faces that look
  // down take the dark colour, the steep ones a tone between.
  rock(x, y, z, rx, ry, rz, seed, color, dark = color) {
    let s = (seed * 2654435761) >>> 0;
    const jit = new Map();
    const J = (p) => { // the same knock for a corner whichever face asks
      const key = Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000) + ',' + Math.round(p[2] * 1000);
      let v = jit.get(key);
      if (v === undefined) {
        s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
        v = 0.78 + ((s >>> 8) / 16777216) * 0.44;
        jit.set(key, v);
      }
      return v;
    };
    const N = (p) => {
      const l = Math.hypot(p[0], p[1], p[2]);
      return [p[0] / l, p[1] / l, p[2] / l];
    };
    const V = (p) => {
      const k = J(p);
      return [x + p[0] * rx * k, y + Math.max(-0.35, p[1]) * ry * k, z + p[2] * rz * k]; // flat underneath, to sit on the ground
    };
    const o = [x, y, z];
    const mid = [(color[0] + dark[0]) / 2, (color[1] + dark[1]) / 2, (color[2] + dark[2]) / 2];
    for (const f of ICO.f) {
      const a = ICO.v[f[0]], b = ICO.v[f[1]], c = ICO.v[f[2]];
      const ab = N([a[0] + b[0], a[1] + b[1], a[2] + b[2]]), bc = N([b[0] + c[0], b[1] + c[1], b[2] + c[2]]), ca = N([c[0] + a[0], c[1] + a[1], c[2] + a[2]]);
      for (const [p, q, r] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) {
        const up = (p[1] + q[1] + r[1]) / 3;
        this.triOut(V(p), V(q), V(r), up < -0.2 ? dark : up < 0.25 ? mid : color, o);
      }
    }
    return this;
  }

  // Gable roof: a triangular prism with its ridge along X (or Z when alongZ).
  gable(x, y, z, w, h, d, color, alongZ = false, end = color) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
    if (alongZ) {
      this.quad([x, y1, z0], [x0, y, z0], [x0, y, z1], [x, y1, z1], color);
      this.quad([x, y1, z1], [x1, y, z1], [x1, y, z0], [x, y1, z0], color);
      this.tri([x, y1, z1], [x0, y, z1], [x1, y, z1], end);
      this.tri([x, y1, z0], [x1, y, z0], [x0, y, z0], end);
    } else {
      this.quad([x0, y1, z], [x0, y, z1], [x1, y, z1], [x1, y1, z], color);
      this.quad([x1, y1, z], [x1, y, z0], [x0, y, z0], [x0, y1, z], color);
      this.tri([x1, y1, z], [x1, y, z1], [x1, y, z0], end);
      this.tri([x0, y1, z], [x0, y, z0], [x0, y, z1], end);
    }
    return this;
  }

  // Four-sided pyramid.
  pyramid(x, y, z, w, h, d, color) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    const apex = [x, y + h, z];
    this.tri(apex, [x0, y, z1], [x1, y, z1], color);
    this.tri(apex, [x1, y, z1], [x1, y, z0], color);
    this.tri(apex, [x1, y, z0], [x0, y, z0], color);
    this.tri(apex, [x0, y, z0], [x0, y, z1], color);
    return this;
  }

  // Copy another Geo in, moved, turned about Y, scaled and tinted.
  add(src, x = 0, y = 0, z = 0, rotY = 0, sx = 1, sy = sx, sz = sx, tint = null) {
    this._reserve(src.n);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const sp = src.pos, sc = src.col;
    let o = this.n * 3;
    const el = this.m ? this.m.elements : null;
    for (let i = 0, k = 0; i < src.n; i++, k += 3) {
      const px = sp[k] * sx, py = sp[k + 1] * sy, pz = sp[k + 2] * sz;
      let wx = x + px * c + pz * s, wy = y + py, wz = z - px * s + pz * c;
      if (el) {
        const tx = el[0] * wx + el[4] * wy + el[8] * wz + el[12];
        const ty = el[1] * wx + el[5] * wy + el[9] * wz + el[13];
        wz = el[2] * wx + el[6] * wy + el[10] * wz + el[14];
        wx = tx;
        wy = ty;
      }
      this.pos[o] = wx;
      this.pos[o + 1] = wy;
      this.pos[o + 2] = wz;
      if (tint) {
        this.col[o] = sc[k] * tint[0];
        this.col[o + 1] = sc[k + 1] * tint[1];
        this.col[o + 2] = sc[k + 2] * tint[2];
      } else {
        this.col[o] = sc[k];
        this.col[o + 1] = sc[k + 1];
        this.col[o + 2] = sc[k + 2];
      }
      this.edge[this.n + i] = src.edge[i];
      o += 3;
    }
    if (src.hasEdge) this.hasEdge = true;
    this.n += src.n;
    return this;
  }

  build() {
    const n = this.n;
    const pos = this.pos.slice(0, n * 3);
    const nor = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 9; k += 3) {
        nor[i + k] = nx; nor[i + k + 1] = ny; nor[i + k + 2] = nz;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    if (this.hasEdge) g.setAttribute('aEdge', new THREE.BufferAttribute(this.edge.slice(0, n), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
