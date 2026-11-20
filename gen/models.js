// Reusable model parts: temples, walls, people, beasts and ships. Each function
// draws into a Geo in local space (x east, z south towards the viewer, y up).
//
// A model unit is 56 map pixels, and the picture is drawn up to sixteen times finer than
// that, so a figure two fifths of a unit tall can stand 350 pixels high. The parts are
// shaped for that: limbs and heads are round, columns are fluted and carry capitals, a
// temple has its steps, its door, its frieze and the figures in its pediment.

import * as THREE from './three.js';
import { rgb, shade } from './kit.js';

export const C = {
  marble: rgb('#f7f2e6'), marbleD: rgb('#ddd5c2'), step: rgb('#cfc7b4'),
  terracotta: rgb('#dc6b3e'), terracottaD: rgb('#b9532f'),
  gold: rgb('#f6c945'), goldD: rgb('#cf9a2c'), bronze: rgb('#c1803d'), bronzeD: rgb('#93602f'),
  wood: rgb('#9a6638'), woodD: rgb('#6a4326'), sail: rgb('#f7f1df'),
  stone: rgb('#bdb5a6'), stoneD: rgb('#8e8679'), rock: rgb('#9891ad'), rockD: rgb('#756e8c'),
  sand: rgb('#ead9a0'), earth: rgb('#b99a6c'),
  dark: rgb('#2b2436'), night: rgb('#1b1730'), white: rgb('#ffffff'), cream: rgb('#f6efdf'),
  red: rgb('#cf3f33'), crimson: rgb('#a92f2f'), blue: rgb('#3f82d6'), teal: rgb('#3fb7a8'),
  purple: rgb('#8a4fc0'), pink: rgb('#f29ac0'), green: rgb('#4f9c3b'), greenD: rgb('#2f6f2d'),
  leaf: rgb('#84a845'), skin: rgb('#eebf96'), skinD: rgb('#c98f66'), hair: rgb('#4a3324'),
  lava: rgb('#ff6a1f'), flame: rgb('#ffb22e'), flameHot: rgb('#fff3a8'), ghost: rgb('#bfe9ff'),
  water: rgb('#4fb0d8'), fleece: rgb('#f3f0e6'),
};
const FRIEZE = rgb('#4f6fa3'), TYMPANUM = rgb('#7f9cc4');

// A column: a fluted shaft that swells and narrows, an echinus and a square abacus.
export function column(g, x, y, z, r, h, col = C.marble, o = {}) {
  const cap = Math.min(h * 0.1, r * 1.6);
  g.lathe(x, y, z, [[r * 1.03, 0], [r, h * 0.32], [r * 0.84, h - cap]], o.sides || 12, col, { flute: 0.13, phase: o.phase || 0.26 });
  g.lathe(x, y, z, [[r * 0.86, h - cap], [r * 1.34, h - cap * 0.42]], o.sides || 12, o.capital || col, { phase: o.phase || 0.26 });
  g.box(x, y + h - cap * 0.42, z, r * 2.9, cap * 0.42, r * 2.9, o.capital || col);
}

// A flat arch standing in the plane z, facing south: a dark doorway, the mouth of a cave.
export function archFace(g, x, y, z, hw, hh, color, n = 10) {
  const o = [x, y, z - 1];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI;
    g.triOut([x, y, z], [x + Math.cos(a0) * hw, y + Math.sin(a0) * hh, z], [x + Math.cos(a1) * hw, y + Math.sin(a1) * hh, z], color, o);
  }
}

// Greek temple with a colonnade all round. w is the front (along x), d the depth.
export function temple(g, x, y, z, w, d, h, o = {}) {
  const roof = o.roof || C.terracotta;
  const col = o.col || C.marble;
  const dim = o.cella || C.marbleD;
  g.box(x, y, z, w + 0.42, 0.047, d + 0.42, C.step);
  g.box(x, y + 0.047, z, w + 0.3, 0.047, d + 0.3, shade(C.step, 1.05));
  g.box(x, y + 0.094, z, w + 0.18, 0.046, d + 0.18, C.marbleD, { top: col });
  const y0 = y + 0.14;
  const nx = o.nx || Math.max(3, Math.round(w / 0.24));
  const nz = o.nz || Math.max(3, Math.round(d / 0.26));
  const r = o.r || 0.045 + h * 0.03;
  const hx = w / 2 - r, hz = d / 2 - r;
  for (let i = 0; i <= nx; i++) {
    const cx = x - hx + (2 * hx * i) / nx;
    column(g, cx, y0, z + hz, r, h, col);
    column(g, cx, y0, z - hz, r, h, col);
  }
  for (let j = 1; j < nz; j++) {
    const cz = z - hz + (2 * hz * j) / nz;
    column(g, x + hx, y0, cz, r, h, col);
    column(g, x - hx, y0, cz, r, h, col);
  }
  // The cella, its door open to the south.
  const cw = w * 0.62, cd = d * 0.72, zs = z + cd / 2;
  g.box(x, y0, z, cw, h, cd, dim);
  const dw = cw * 0.36, dh = h * 0.7;
  g.box(x, y0, zs + 0.006, dw + 0.05, dh + 0.03, 0.012, col);
  g.box(x, y0, zs + 0.013, dw, dh, 0.006, C.night);
  g.box(x - dw / 2 - 0.004, y0, zs + 0.012 + dw * 0.2, 0.012, dh, dw * 0.4, o.door || C.bronzeD);
  g.box(x + dw / 2 + 0.004, y0, zs + 0.012 + dw * 0.2, 0.012, dh, dw * 0.4, o.door || C.bronzeD);
  // Entablature: architrave, a frieze with its triglyphs, a cornice.
  const e0 = y0 + h;
  g.box(x, e0, z, w + 0.05, 0.034, d + 0.05, col);
  g.box(x, e0 + 0.034, z, w + 0.03, 0.03, d + 0.03, dim);
  const tx = nx * 2, tz = nz * 2;
  for (let i = 0; i <= tx; i++) {
    const px = x - (w / 2 - 0.02) + ((w - 0.04) * i) / tx;
    g.box(px, e0 + 0.034, z + d / 2 + 0.019, 0.024, 0.03, 0.008, o.frieze || FRIEZE);
  }
  for (let j = 0; j <= tz; j++) {
    const pz = z - (d / 2 - 0.02) + ((d - 0.04) * j) / tz;
    g.box(x - w / 2 - 0.019, e0 + 0.034, pz, 0.008, 0.03, 0.024, o.frieze || FRIEZE);
    g.box(x + w / 2 + 0.019, e0 + 0.034, pz, 0.008, 0.03, 0.024, o.frieze || FRIEZE);
  }
  g.box(x, e0 + 0.064, z, w + 0.14, 0.016, d + 0.14, col);
  // The roof, its ridge running north and south, with ribs of tile down both slopes.
  const yr = e0 + 0.08, rh = o.roofH || w * 0.24, rw = w + 0.12, rd = d + 0.12, ze = z + rd / 2;
  g.gable(x, yr, z, rw, rh, rd, roof, true, o.pediment || col);
  const rib = shade(roof, 0.86), lift = 0.007, sl = Math.hypot(rw / 2, rh), ux = (rh / sl) * lift, uy = (rw / 2 / sl) * lift;
  for (let k = 0, n = Math.max(3, Math.round(rd / 0.085)); k <= n; k++) {
    const pz = z - rd / 2 + 0.012 + ((rd - 0.024) * k) / n;
    for (const sx of [-1, 1]) {
      const a = [x + sx * ux, yr + rh + uy, pz - 0.009], b = [x + sx * (rw / 2 + ux), yr + uy, pz - 0.009];
      const c = [x + sx * (rw / 2 + ux), yr + uy, pz + 0.009], e = [x + sx * ux, yr + rh + uy, pz + 0.009];
      g.triOut(a, b, c, rib, [x, yr, z]);
      g.triOut(a, c, e, rib, [x, yr, z]);
    }
    g.box(x - rw / 2 - 0.004, yr - 0.004, pz, 0.02, 0.024, 0.026, shade(roof, 1.1)); // antefixes along the eaves
    g.box(x + rw / 2 + 0.004, yr - 0.004, pz, 0.02, 0.024, 0.026, shade(roof, 1.1));
  }
  g.box(x, yr + rh - 0.006, z, 0.034, 0.02, rd, rib);
  // The pediment: a painted field, and on a temple of any size the figures that stand in it.
  if (!o.pediment) {
    g.triOut([x, yr + rh * 0.8, ze + 0.003], [x - rw * 0.39, yr + rh * 0.1, ze + 0.003], [x + rw * 0.39, yr + rh * 0.1, ze + 0.003], TYMPANUM, [x, yr, ze - 1]);
    if (w >= 0.5 && !o.plain) {
      const st = { tunic: C.cream, skin: C.cream, hair: C.marbleD, face: false };
      g.box(x, yr + rh * 0.06, ze + 0.03, rw * 0.74, 0.012, 0.06, col);
      person(g, x, yr + rh * 0.06 + 0.012, ze + 0.034, rh * 0.62, { ...st, rightUp: true });
      person(g, x - rw * 0.14, yr + rh * 0.06 + 0.012, ze + 0.034, rh * 0.44, st);
      person(g, x + rw * 0.14, yr + rh * 0.06 + 0.012, ze + 0.034, rh * 0.44, st);
      g.ball(x - rw * 0.26, yr + rh * 0.06 + 0.03, ze + 0.034, rh * 0.2, rh * 0.09, 0.022, C.cream, { seg: 8 });
      g.ball(x + rw * 0.26, yr + rh * 0.06 + 0.03, ze + 0.034, rh * 0.2, rh * 0.09, 0.022, C.cream, { seg: 8 });
    }
  }
  // Acroteria: a palmette on the ridge at each end, a small one at each corner.
  const acro = o.acro || C.gold;
  for (const sz of [-1, 1]) {
    g.lathe(x, yr + rh - 0.004, z + sz * (rd / 2 - 0.012), [[0.016, 0], [0.012, 0.03], [0.034, 0.055], [0.022, 0.085], [0, 0.1]], 8, acro, { sx: 1, sz: 0.5 });
    for (const sx of [-1, 1]) g.ball(x + sx * (rw / 2 - 0.01), yr + 0.03, z + sz * (rd / 2 - 0.012), 0.022, 0.03, 0.016, acro, { seg: 7 });
  }
  return yr + rh;
}

// Round temple (tholos).
export function tholos(g, x, y, z, r, h, o = {}) {
  g.cyl(x, y, z, r + 0.2, r + 0.2, 0.045, 16, C.step);
  g.cyl(x, y + 0.045, z, r + 0.12, r + 0.12, 0.045, 16, shade(C.step, 1.05));
  g.cyl(x, y + 0.09, z, r + 0.05, r + 0.05, 0.04, 16, C.marbleD, { top: C.marble });
  const n = o.n || 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    column(g, x + Math.cos(a) * r * 0.86, y + 0.13, z + Math.sin(a) * r * 0.86, 0.045, h, C.marble, { sides: 10 });
  }
  g.cyl(x, y + 0.13, z, r * 0.5, r * 0.5, h, 12, C.marbleD);
  archFace(g, x, y + 0.13, z + r * 0.5 + 0.004, r * 0.16, h * 0.62, C.night);
  g.cyl(x, y + 0.13 + h, z, r + 0.02, r + 0.02, 0.04, 16, C.marble);
  g.cyl(x, y + 0.17 + h, z, r + 0.01, r + 0.01, 0.024, 16, o.frieze || FRIEZE);
  g.cyl(x, y + 0.194 + h, z, r + 0.08, r + 0.08, 0.014, 16, C.marble);
  const roof = o.roof || C.terracotta;
  g.lathe(x, y + 0.208 + h, z, [[r + 0.075, 0], [r * 0.74, r * 0.3], [r * 0.34, r * 0.58], [0.03, r * 0.76]], 16, roof, { cols: [roof, shade(roof, 0.94), shade(roof, 0.9)] });
  g.ball(x, y + 0.208 + h + r * 0.76 + 0.03, z, 0.036, 0.046, 0.036, o.acro || C.gold, { seg: 8 });
}

// A ring of wall segments with square towers. gate is an angle to leave an opening at.
export function wallRing(g, x, y, z, r, h, n, o = {}) {
  const col = o.col || C.stone;
  const top = o.top || shade(col, 1.08);
  const thick = o.thick || 0.12;
  const merlons = (q, len, y1, depth) => { // battlements along the outer edge of a stretch of wall
    const m = Math.max(2, Math.round(len / (thick * 0.9)));
    for (let k = 0; k < m; k++) q.box(-len / 2 + (len * (k + 0.5)) / m, y1, depth / 2 - thick * 0.14, (len / m) * 0.56, h * 0.16, thick * 0.28, col, { top });
  };
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const len = 2 * r * Math.sin(Math.PI / n) + thick * 0.6;
    const isGate = o.gate != null && Math.abs(((am - o.gate + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < Math.PI / n;
    g.at(x + Math.cos(am) * r * Math.cos(Math.PI / n), y, z + Math.sin(am) * r * Math.cos(Math.PI / n), -am + Math.PI / 2, 1, (q) => {
      if (isGate) {
        for (const sx of [-1, 1]) {
          q.box(sx * len * 0.36, 0, 0, len * 0.28, h * 1.25, thick * 1.5, col, { top });
          q.at(sx * len * 0.36, 0, 0, 0, 1, (t) => merlons(t, len * 0.28, h * 1.25, thick * 1.5));
        }
        q.box(0, h * 0.8, 0, len * 0.5, h * 0.3, thick * 1.2, col, { top });
        q.box(0, h * 0.74, thick * 0.1, len * 0.52, h * 0.07, thick * 1.3, shade(col, 0.86)); // the lintel
        q.box(0, 0, 0, len * 0.44, h * 0.8, thick * 0.5, C.night);
        q.box(-len * 0.2, 0, thick * 0.55, len * 0.03, h * 0.74, thick * 0.6, C.woodD); // the doors, standing open
        q.box(len * 0.2, 0, thick * 0.55, len * 0.03, h * 0.74, thick * 0.6, C.woodD);
      } else {
        q.box(0, 0, 0, len, h, thick, col, { top });
        q.box(0, h * 0.5, thick / 2 + 0.002, len, h * 0.05, 0.006, shade(col, 0.9)); // a string course
        merlons(q, len, h, thick);
      }
    });
    if (o.towers && i % o.towers === 0) {
      const tw = thick * 2.1, tx = x + Math.cos(a0) * r, tz = z + Math.sin(a0) * r;
      g.box(tx, y, tz, tw, h * 1.45, tw, col, { top });
      g.box(tx, y + h * 1.45, tz, tw * 1.14, h * 0.07, tw * 1.14, shade(col, 0.92), { top });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(tx + sx * tw * 0.42, y + h * 1.52, tz + sz * tw * 0.42, tw * 0.3, h * 0.16, tw * 0.3, col, { top });
      g.box(tx, y + h * 0.9, tz + tw / 2 + 0.003, tw * 0.16, h * 0.26, 0.006, C.night); // an arrow slit
    }
  }
}

export function house(g, x, y, z, s = 1, rot = 0, o = {}) {
  const wall = o.wall || C.cream, side = shade(wall, 0.94), roof = o.roof || (o.flat ? C.white : C.terracotta);
  g.at(x, y, z, rot, s, (q) => {
    q.box(0, 0, 0, 0.325, 0.022, 0.265, C.stone);
    q.box(0, 0, 0, 0.3, 0.2, 0.24, wall, { side });
    // Door and window on the south wall, a window on the west.
    q.box(-0.065, 0, 0.123, 0.088, 0.135, 0.008, C.wood);
    q.box(-0.065, 0, 0.127, 0.066, 0.12, 0.006, C.woodD);
    q.box(0.075, 0.085, 0.123, 0.06, 0.062, 0.006, C.night);
    q.box(0.075, 0.075, 0.126, 0.078, 0.012, 0.012, C.stone);
    q.box(0.038, 0.085, 0.127, 0.014, 0.062, 0.006, o.shutter || C.blue);
    q.box(0.112, 0.085, 0.127, 0.014, 0.062, 0.006, o.shutter || C.blue);
    q.box(-0.153, 0.085, 0.02, 0.006, 0.062, 0.06, C.night);
    if (o.flat) {
      q.box(0, 0.2, 0, 0.32, 0.03, 0.26, roof);
      for (const sz of [-1, 1]) q.box(0, 0.23, sz * 0.122, 0.32, 0.022, 0.016, roof);
      for (const sx of [-1, 1]) q.box(sx * 0.152, 0.23, 0, 0.016, 0.022, 0.26, roof);
    } else {
      q.gable(0, 0.2, 0, 0.37, 0.14, 0.31, roof, false, wall);
      q.box(0, 0.33, 0, 0.37, 0.018, 0.03, shade(roof, 0.84)); // the ridge
      q.box(0, 0.196, 0.152, 0.37, 0.012, 0.012, shade(roof, 0.84)); // the eaves
      q.box(0.085, 0.2, -0.06, 0.04, 0.16, 0.04, side, { top: C.stoneD }); // a chimney
    }
  });
}

// A round shield (or a sun disc) held upright, its face to +z: domed, rimmed, with a boss.
function roundel(g, x, y, z, r, color, n = 14) {
  const o = [x, y, z - 1], rim = shade(color, 0.78), c = [x, y, z + r * 0.22];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r * 0.84, y + Math.sin(a0) * r * 0.84, z + r * 0.06], p1 = [x + Math.cos(a1) * r * 0.84, y + Math.sin(a1) * r * 0.84, z + r * 0.06];
    const q0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z], q1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z];
    g.triOut(c, p0, p1, color, o);
    g.triOut(p0, q0, q1, rim, o);
    g.triOut(p0, q1, p1, rim, o);
    g.tri([x, y, z - 0.02], q1, q0, rim);
  }
  g.ball(x, y, z + r * 0.22, r * 0.18, r * 0.18, r * 0.12, rim, { seg: 7 });
}

// A little person, s tall, facing +z. Options colour the parts and add gear.
// Without `legs` the tunic falls to the feet as a robe; with it the legs are bare (or greaved) under a short one.
export function person(g, x, y, z, s = 0.4, o = {}) {
  const tunic = o.tunic || C.white;
  const skin = o.skin || C.skin;
  const robe = o.legs === undefined;
  const legs = o.legs || shade(tunic, 0.86);
  const hem = shade(tunic, 0.76);
  const face = o.face ?? (skin === C.skin || skin === C.skinD);
  g.at(x, y, z, o.rot || 0, s, (q) => {
    for (const sx of [-1, 1]) q.ball(sx * 0.078, 0.032, 0.04, 0.05, 0.032, 0.078, robe ? skin : shade(legs, 0.82), { seg: 7 }); // feet
    if (robe) {
      q.lathe(0, 0, 0, [[0.19, 0.03], [0.168, 0.25], [0.152, 0.45]], 12, legs, { sz: 0.68, bottom: true });
      q.lathe(0, 0, 0, [[0.198, 0.03], [0.194, 0.062]], 12, hem, { sz: 0.68 });
    } else {
      for (const sx of [-1, 1]) q.limb([sx * 0.08, 0.05, 0], [sx * 0.086, 0.44, 0], 0.052, 0.074, legs, { sides: 8 });
      q.lathe(0, 0, 0, [[0.19, 0.33], [0.158, 0.47]], 12, tunic, { sz: 0.7, bottom: true });
      q.lathe(0, 0, 0, [[0.196, 0.325], [0.192, 0.35]], 12, hem, { sz: 0.7 });
    }
    q.lathe(0, 0, 0, [[0.155, 0.43], [0.176, 0.56], [0.186, 0.66], [0.118, 0.735], [0.06, 0.75]], 12, tunic, { sz: 0.66 });
    q.lathe(0, 0, 0, [[0.163, 0.44], [0.166, 0.474]], 12, o.belt || hem, { sz: 0.7 });
    q.lathe(0, 0, 0, [[0.056, 0.73], [0.056, 0.775]], 8, skin);
    q.ball(0, 0.852, 0.005, 0.125, 0.127, 0.125, skin, { seg: 12 });
    if (o.hair !== null) q.ball(0, 0.878, -0.024, 0.136, 0.118, 0.136, o.hair || C.hair, { seg: 12 });
    if (face && !o.eye) for (const sx of [-1, 1]) q.box(sx * 0.048, 0.84, 0.117, 0.026, 0.032, 0.012, C.dark);
    if (o.beard) q.ball(0, 0.775, 0.082, 0.088, 0.075, 0.058, o.beard, { seg: 8 });
    if (!o.noArms) {
      const arm = (sx, up) => {
        const sh = [sx * 0.2, 0.672, 0];
        const el = up ? [sx * 0.275, 0.81, 0.02] : [sx * 0.25, 0.52, 0.012];
        const ha = up ? [sx * 0.25, 0.99, 0.035] : [sx * 0.238, 0.385, 0.045];
        q.ball(sh[0], sh[1], sh[2], 0.064, 0.064, 0.064, tunic, { seg: 8 });
        q.limb(sh, el, 0.05, 0.043, skin, { sides: 8 });
        q.limb(el, ha, 0.043, 0.036, skin, { sides: 8 });
        q.ball(ha[0], ha[1], ha[2], 0.047, 0.047, 0.047, skin, { seg: 7 });
      };
      arm(-1, !!o.armsUp);
      arm(1, !!(o.armsUp || o.rightUp));
    }
    if (o.crest) { // a helmet's plume, arching from brow to nape
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        q.box(0, 0.97 + Math.sin(t * Math.PI) * 0.035, 0.13 - t * 0.3, 0.05, 0.075 + Math.sin(t * Math.PI) * 0.06, 0.066, o.crest);
      }
    }
    if (o.shield) roundel(q, -0.3, 0.5, 0.15, 0.2, o.shield);
    if (o.spear) {
      const own = o.spear === true;
      q.limb([0.3, 0.01, 0.07], [0.3, 1.2, 0.07], 0.017, 0.014, own ? C.woodD : o.spear, { sides: 6 });
      q.lathe(0.3, 1.2, 0.07, [[0.006, 0], [0.032, 0.03], [0, 0.13]], 6, own ? C.stone : o.spear, { sz: 0.45 });
    }
    if (o.wings) {
      q.sheet([-0.16, 0.7, -0.1], [-0.7, 0.95, -0.2], [-0.62, 0.35, -0.2], [-0.16, 0.4, -0.1], o.wings);
      q.sheet([0.16, 0.4, -0.1], [0.62, 0.35, -0.2], [0.7, 0.95, -0.2], [0.16, 0.7, -0.1], o.wings);
      const inner = shade(o.wings, 0.84);
      q.sheet([-0.18, 0.66, -0.085], [-0.5, 0.8, -0.15], [-0.45, 0.45, -0.15], [-0.18, 0.44, -0.085], inner);
      q.sheet([0.18, 0.44, -0.085], [0.45, 0.45, -0.15], [0.5, 0.8, -0.15], [0.18, 0.66, -0.085], inner);
    }
    if (o.eye) { // a single great eye
      q.ball(0, 0.87, 0.105, 0.066, 0.056, 0.03, C.white, { seg: 9 });
      q.ball(0, 0.868, 0.128, 0.03, 0.03, 0.014, C.dark, { seg: 7 });
    }
    if (o.horns) {
      for (const sx of [-1, 1]) {
        q.limb([sx * 0.1, 0.94, 0.02], [sx * 0.175, 1.03, 0], 0.03, 0.022, o.horns, { sides: 6 });
        q.limb([sx * 0.175, 1.03, 0], [sx * 0.165, 1.13, 0.03], 0.022, 0.005, o.horns, { sides: 6 });
      }
    }
    if (o.crown) {
      q.lathe(0, 0, -0.01, [[0.132, 0.94], [0.132, 0.97]], 12, o.crown);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6 - 0.5) * Math.PI * 1.15;
        q.lathe(Math.sin(a) * 0.125, 0.965, Math.cos(a) * 0.125 - 0.01, [[0.022, 0], [0, 0.1 + 0.03 * Math.cos(a)]], 5, o.crown);
      }
    }
    if (o.lyre) {
      q.ball(0.2, 0.375, 0.14, 0.075, 0.05, 0.04, o.lyre, { seg: 8 });
      q.limb([0.145, 0.4, 0.14], [0.118, 0.6, 0.14], 0.016, 0.012, o.lyre, { sides: 6 });
      q.limb([0.255, 0.4, 0.14], [0.282, 0.6, 0.14], 0.016, 0.012, o.lyre, { sides: 6 });
      q.limb([0.105, 0.6, 0.14], [0.295, 0.6, 0.14], 0.012, 0.012, o.lyre, { sides: 6 });
    }
  });
}

// Upright disc facing +z (shields, sun discs).
function g_disc(g, x, y, z, r, color, sides = 14) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z];
    const p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z];
    g.tri([x, y, z + 0.02], p0, p1, color);
    g.tri([x, y, z - 0.02], p1, p0, shade(color, 0.8));
  }
}
export const disc = g_disc;

// A four-legged animal, len long, facing +x. Options: horns, mane, tail, heads, wings, wool.
export function beast(g, x, y, z, len = 0.5, o = {}) {
  const body = o.body || C.fleece;
  const head = o.head || body;
  const legs = o.legs || shade(body, 0.8);
  const under = shade(body, 0.84);
  g.at(x, y, z, o.rot || 0, len, (q) => {
    const lh = o.legH || 0.3, bh = o.bodyH || 0.34, bw = o.bodyW || 0.36;
    const cy = lh + bh * 0.5;
    for (const sx of [-0.32, 0.32]) for (const sz of [-1, 1]) { // a thigh, a knee, a hoof
      const lz = sz * (bw / 2 - 0.07), kx = sx + (sx > 0 ? 0.018 : -0.03);
      q.limb([sx, lh + bh * 0.32, lz], [kx, lh * 0.52, lz], 0.078, 0.05, legs, { sides: 7 });
      q.limb([kx, lh * 0.52, lz], [sx + 0.01, 0.04, lz], 0.05, 0.04, legs, { sides: 7 });
      q.ball(sx + 0.022, 0.03, lz, 0.052, 0.03, 0.046, shade(legs, 0.68), { seg: 6 });
    }
    q.ball(0, cy, 0, 0.44, bh * 0.52, bw * 0.5, body, { seg: 12, dark: under }); // barrel, chest, rump
    q.ball(0.24, cy + bh * 0.03, 0, 0.25, bh * 0.56, bw * 0.52, body, { seg: 10, dark: under });
    q.ball(-0.25, cy + bh * 0.02, 0, 0.24, bh * 0.54, bw * 0.5, body, { seg: 10, dark: under });
    if (o.wool) {
      for (let k = 0; k < 7; k++) {
        const a = k * 2.4;
        q.ball(-0.3 + k * 0.1, cy + bh * 0.3 + Math.sin(a) * 0.02, Math.cos(a) * bw * 0.22, 0.13, bh * 0.3, bw * 0.3, k % 2 ? body : shade(body, 0.95), { seg: 8 });
      }
    }
    const hy = lh + bh * (o.headUp ?? 0.55);
    const n = o.noHead ? 0 : o.heads || 1;
    for (let i = 0; i < n; i++) {
      const hz = n === 1 ? 0 : (i - (n - 1) / 2) * 0.2;
      const ny = hy + (o.neck || 0), hw = n === 1 ? 0.14 : 0.09;
      q.limb([0.34, lh + bh * 0.62, hz * 0.5], [0.52, ny + 0.1, hz], bh * 0.3, 0.09, body, { sides: 8 });
      q.ball(0.58, ny + 0.13, hz, 0.16, 0.135, hw, head, { seg: 10 });
      q.ball(0.71, ny + 0.095, hz, 0.1, 0.085, hw * 0.72, o.snout || head, { seg: 8 });
      for (const sz of [-1, 1]) q.box(0.63, ny + 0.15, hz + sz * hw * 0.9, 0.03, 0.03, 0.014, C.dark);
      if (o.horns) {
        for (const sz of [-1, 1]) {
          q.limb([0.55, ny + 0.23, hz + sz * hw * 0.6], [0.5, ny + 0.35, hz + sz * (hw * 0.6 + 0.07)], 0.028, 0.02, o.horns, { sides: 6 });
          q.limb([0.5, ny + 0.35, hz + sz * (hw * 0.6 + 0.07)], [0.56, ny + 0.44, hz + sz * (hw * 0.6 + 0.05)], 0.02, 0.004, o.horns, { sides: 6 });
        }
      }
      if (o.ears) for (const sz of [-1, 1]) q.lathe(0.5, ny + 0.22, hz + sz * hw * 0.7, [[0.036, 0], [0.024, 0.05], [0, 0.1]], 5, head, { sz: 0.6 });
      if (o.mane && o.neck) { // a crest of mane down the back of a long neck
        for (let k = 0; k < 5; k++) {
          const t = k / 4;
          q.ball(0.33 + t * 0.15, lh + bh * 0.8 + t * (ny + 0.14 - lh - bh * 0.8), hz, 0.05, 0.07, 0.03, o.mane, { seg: 6 });
        }
      }
    }
    if (o.mane && !o.neck) q.ball(0.38, lh + bh * 0.72, 0, 0.21, bh * 0.64, bw * 0.7, o.mane, { seg: 10 });
    if (o.tail) {
      q.limb([-0.45, cy + bh * 0.25, 0], [-0.58, cy - bh * 0.25, 0], 0.034, 0.024, o.tail, { sides: 6 });
      q.ball(-0.59, cy - bh * 0.32, 0, 0.04, 0.06, 0.04, o.tail, { seg: 6 });
    }
    if (o.tailUp) {
      q.limb([-0.45, cy + bh * 0.2, 0], [-0.56, cy + bh * 0.5 + 0.22, 0], 0.032, 0.024, o.tailUp, { sides: 6 });
      q.ball(-0.57, cy + bh * 0.5 + 0.26, 0, 0.05, 0.06, 0.05, o.tailUp, { seg: 6 });
    }
    if (o.wings) {
      q.sheet([0.2, lh + bh, -0.1], [-0.15, lh + bh + 0.55, -0.7], [-0.5, lh + bh + 0.1, -0.5], [-0.25, lh + bh, -0.1], o.wings);
      q.sheet([-0.25, lh + bh, 0.1], [-0.5, lh + bh + 0.1, 0.5], [-0.15, lh + bh + 0.55, 0.7], [0.2, lh + bh, 0.1], o.wings);
      const inner = shade(o.wings, 0.84);
      q.sheet([0.14, lh + bh + 0.01, -0.1], [-0.1, lh + bh + 0.38, -0.5], [-0.34, lh + bh + 0.08, -0.36], [-0.18, lh + bh + 0.01, -0.1], inner);
      q.sheet([-0.18, lh + bh + 0.01, 0.1], [-0.34, lh + bh + 0.08, 0.36], [-0.1, lh + bh + 0.38, 0.5], [0.14, lh + bh + 0.01, 0.1], inner);
    }
  });
}

export const sheep = (g, x, y, z, rot = 0, s = 0.3) =>
  beast(g, x, y, z, s, { rot, body: C.fleece, head: C.dark, legs: C.dark, bodyH: 0.4, bodyW: 0.44, legH: 0.2, wool: true, ears: true });
export const pig = (g, x, y, z, rot = 0, s = 0.3) =>
  beast(g, x, y, z, s, { rot, body: C.pink, snout: rgb('#e0789f'), legH: 0.16, bodyH: 0.36, bodyW: 0.4, ears: true, tail: rgb('#e0789f') });
export const cow = (g, x, y, z, rot = 0, s = 0.42, body = C.gold) =>
  beast(g, x, y, z, s, { rot, body, horns: C.white, snout: shade(body, 0.8), tail: shade(body, 0.7), legH: 0.3, ears: true });
export const lion = (g, x, y, z, rot = 0, s = 0.5) =>
  beast(g, x, y, z, s, { rot, body: rgb('#e2b24f'), mane: rgb('#a8692c'), snout: rgb('#f0cf86'), tailUp: rgb('#a8692c'), legH: 0.26, ears: true });
export const horse = (g, x, y, z, rot = 0, s = 0.6, o = {}) =>
  beast(g, x, y, z, s, { rot, body: C.wood, neck: 0.3, headUp: 0.7, snout: shade(o.body || C.wood, 0.8), tail: C.dark, mane: C.dark, ears: true, legH: 0.42, bodyH: 0.3, bodyW: 0.3, ...o });

// Jagged rock stack: a broad boulder with a few spires leaning out of it.
export function crag(g, x, y, z, r, h, seed = 1, col = C.rock, dark = C.rockD) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.rock(x, y + h * 0.16, z, r, h * 0.5, r * 0.94, seed * 13 + 1, col, dark);
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.28, d = r * 0.5 * rnd();
    const sh = h * (0.5 + rnd() * 0.5);
    g.rock(x + Math.cos(a) * d, y + h * 0.3 + sh * 0.3, z + Math.sin(a) * d, r * (0.3 + rnd() * 0.22), sh, r * (0.28 + rnd() * 0.2), seed * 29 + i * 7 + 3, i % 2 ? col : shade(col, 0.92), dark);
  }
}

// Cave mouth: a rock mound with a dark opening facing +z.
export function cave(g, x, y, z, r, h, seed = 1, o = {}) {
  const col = o.col || C.rock, dark = o.dark || C.rockD;
  crag(g, x, y, z - r * 0.25, r, h, seed, o.col, o.dark);
  g.rock(x - r * 0.56, y + h * 0.14, z + r * 0.3, r * 0.44, h * 0.4, r * 0.42, seed * 5 + 11, col, dark);
  g.rock(x + r * 0.56, y + h * 0.14, z + r * 0.3, r * 0.44, h * 0.4, r * 0.42, seed * 5 + 12, col, dark);
  g.rock(x, y + h * 0.5, z + r * 0.3, r * 0.72, h * 0.2, r * 0.36, seed * 5 + 13, col, dark);
  g.box(x, y, z + r * 0.34, r * 0.6, h * 0.36, r * 0.24, o.mouth || C.night);
  archFace(g, x, y + h * 0.02, z + r * 0.465, r * 0.33, h * 0.46, o.mouth || C.night);
  g.rock(x - r * 0.34, y + h * 0.03, z + r * 0.6, r * 0.12, h * 0.08, r * 0.1, seed * 5 + 14, shade(col, 0.95), dark);
  g.rock(x + r * 0.42, y + h * 0.03, z + r * 0.56, r * 0.09, h * 0.06, r * 0.09, seed * 5 + 15, col, dark);
}

// A Greek galley about 1.5 long, bow towards +x. Returns nothing; sails are part of the mesh.
export function galley(g, o = {}) {
  const hull = o.hull || C.woodD;
  const trim = o.trim || C.red;
  const sail = o.sail || C.sail;
  // Hull: a round-bellied shape from seven cross-sections. x, half-width at the rail, height of the rail.
  const sec = [[-0.76, 0.02, 0.4], [-0.62, 0.13, 0.26], [-0.4, 0.19, 0.18], [0, 0.21, 0.16], [0.36, 0.19, 0.17], [0.62, 0.12, 0.22], [0.8, 0.02, 0.32]];
  const mid = [0, 0.08, 0];
  for (let i = 0; i < sec.length - 1; i++) {
    const [x0, w0, h0] = sec[i], [x1, w1, h1] = sec[i + 1];
    for (const sz of [-1, 1]) {
      const k0 = [x0, -0.08, 0], k1 = [x1, -0.08, 0];
      const b0 = [x0, h0 * 0.3, sz * w0 * 0.82], b1 = [x1, h1 * 0.3, sz * w1 * 0.82];
      const r0 = [x0, h0, sz * w0], r1 = [x1, h1, sz * w1];
      const c = sz > 0 ? hull : shade(hull, 0.9);
      g.triOut(k0, k1, b1, shade(c, 0.86), mid); g.triOut(k0, b1, b0, shade(c, 0.86), mid);
      g.triOut(b0, b1, r1, c, mid); g.triOut(b0, r1, r0, c, mid);
      g.triOut(r0, r1, [x1, h1 + 0.04, sz * w1], trim, mid); g.triOut(r0, [x1, h1 + 0.04, sz * w1], [x0, h0 + 0.04, sz * w0], trim, mid);
    }
    g.quad([x0, h0 - 0.02, -w0 * 0.96], [x0, h0 - 0.02, w0 * 0.96], [x1, h1 - 0.02, w1 * 0.96], [x1, h1 - 0.02, -w1 * 0.96], o.deck || C.wood);
  }
  g.limb([-0.76, 0.3, 0], [-0.84, 0.56, 0], 0.035, 0.03, hull, { sides: 6 }); // the stern post, curling forward
  g.limb([-0.84, 0.56, 0], [-0.7, 0.68, 0], 0.03, 0.02, hull, { sides: 6 });
  g.limb([0.8, 0.24, 0], [0.86, 0.5, 0], 0.035, 0.025, hull, { sides: 6 }); // the bow post
  g.lathe(0.8, -0.03, 0, [[0.05, 0], [0.03, 0.03]], 6, C.bronze); // the ram's root
  g.limb([0.78, -0.02, 0], [0.98, -0.03, 0], 0.04, 0.01, C.bronze, { sides: 6 });
  g.box(0.62, 0.12, 0.125, 0.1, 0.07, 0.012, C.white); // the painted eye
  g.box(0.63, 0.135, 0.132, 0.04, 0.04, 0.01, C.dark);
  g.limb([0.05, 0.14, 0], [0.05, 1.02, 0], 0.026, 0.02, C.woodD, { sides: 6 }); // mast
  g.limb([0.05, 0.96, -0.46], [0.05, 0.96, 0.46], 0.017, 0.017, C.woodD, { sides: 6 }); // yard
  // Square sail, bellied forward, in three cloths.
  const sx = 0.085, bx = 0.25, t = 0.95, b = 0.38, hw = 0.42;
  for (let k = 0; k < 3; k++) {
    const t0 = t - ((t - b) * k) / 3, t1 = t - ((t - b) * (k + 1)) / 3;
    const f0 = sx + (bx - sx) * Math.sin((k / 3) * Math.PI), f1 = sx + (bx - sx) * Math.sin(((k + 1) / 3) * Math.PI);
    g.sheet([f0, t0, -hw], [f0, t0, hw], [f1, t1, hw * 0.96], [f1, t1, -hw * 0.96], k % 2 ? shade(sail, 0.93) : sail, shade(sail, 0.82));
  }
  if (o.device) { // a stripe across the sail
    g.sheet([bx + 0.012, (t + b) / 2 + 0.07, -hw * 0.9], [bx + 0.012, (t + b) / 2 + 0.07, hw * 0.9], [bx + 0.012, (t + b) / 2 - 0.07, hw * 0.9], [bx + 0.012, (t + b) / 2 - 0.07, -hw * 0.9], o.device);
  }
  for (let i = 0; i < 6; i++) { // oars
    const ox = -0.4 + i * 0.15;
    for (const sz of [-1, 1]) {
      g.limb([ox, 0.14, sz * 0.19], [ox - 0.04, -0.04, sz * 0.46], 0.012, 0.012, C.wood, { sides: 5 });
      g.ball(ox - 0.045, -0.05, sz * 0.48, 0.02, 0.012, 0.04, C.wood, { seg: 5 });
    }
  }
  g.limb([-0.6, 0.26, 0.13], [-0.72, -0.05, 0.2], 0.014, 0.022, C.wood, { sides: 5 }); // the steering oar
  if (o.crew) {
    for (let i = 0; i < 3; i++) person(g, -0.3 + i * 0.26, 0.15, 0, 0.2, { tunic: i === 1 ? C.red : C.cream, noArms: true });
  }
}

// Puffy cloud made of a few rounded heaps with a flat grey underside.
export function cloud(g, seed = 1, o = {}) {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const top = o.top || rgb('#ffffff'), under = o.under || rgb('#cfd8ea');
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 1.05 + (rnd() - 0.5) * 0.4;
    const r = 0.9 + rnd() * 0.7;
    g.ball(x, r * 0.32, (rnd() - 0.5) * 0.8, r, r * 0.55, r * 0.8, top, { dark: under, seg: 10, rot: rnd() * 3 });
  }
}

export function meshOf(geo, material, shadows = true) {
  const m = new THREE.Mesh(geo.build ? geo.build() : geo, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}
