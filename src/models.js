// Reusable model parts: temples, walls, people, beasts and ships. Each function
// draws into a Geo in local space (x east, z south towards the viewer, y up).

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

// Greek temple with a colonnade all round. w is the front (along x), d the depth.
export function temple(g, x, y, z, w, d, h, o = {}) {
  const roof = o.roof || C.terracotta;
  const col = o.col || C.marble;
  g.box(x, y, z, w + 0.34, 0.07, d + 0.34, C.step);
  g.box(x, y + 0.07, z, w + 0.18, 0.07, d + 0.18, C.marbleD);
  const y0 = y + 0.14;
  const nx = o.nx || Math.max(3, Math.round(w / 0.24));
  const nz = o.nz || Math.max(3, Math.round(d / 0.26));
  const r = o.r || 0.045 + h * 0.03;
  const hx = w / 2 - r, hz = d / 2 - r;
  for (let i = 0; i <= nx; i++) {
    const cx = x - hx + (2 * hx * i) / nx;
    g.cyl(cx, y0, z + hz, r, r * 0.82, h, 5, col);
    g.cyl(cx, y0, z - hz, r, r * 0.82, h, 5, col);
  }
  for (let j = 1; j < nz; j++) {
    const cz = z - hz + (2 * hz * j) / nz;
    g.cyl(x + hx, y0, cz, r, r * 0.82, h, 5, col);
    g.cyl(x - hx, y0, cz, r, r * 0.82, h, 5, col);
  }
  g.box(x, y0, z, w * 0.62, h, d * 0.72, o.cella || C.marbleD);
  g.box(x, y0 + h, z, w + 0.05, 0.08, d + 0.05, col);
  g.gable(x, y0 + h + 0.08, z, w + 0.12, o.roofH || w * 0.24, d + 0.12, roof, true, o.pediment || col);
  return y0 + h + 0.08 + (o.roofH || w * 0.24);
}

// Round temple (tholos).
export function tholos(g, x, y, z, r, h, o = {}) {
  g.cyl(x, y, z, r + 0.14, r + 0.14, 0.07, 10, C.step);
  g.cyl(x, y + 0.07, z, r + 0.05, r + 0.05, 0.06, 10, C.marbleD);
  const n = o.n || 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    g.cyl(x + Math.cos(a) * r * 0.86, y + 0.13, z + Math.sin(a) * r * 0.86, 0.045, 0.038, h, 5, C.marble);
  }
  g.cyl(x, y + 0.13, z, r * 0.5, r * 0.5, h, 7, C.marbleD);
  g.cyl(x, y + 0.13 + h, z, r + 0.02, r + 0.02, 0.07, 10, C.marble);
  g.cyl(x, y + 0.2 + h, z, r + 0.07, 0, r * 0.75, 10, o.roof || C.terracotta);
}

// A ring of wall segments with square towers. gate is an angle to leave an opening at.
export function wallRing(g, x, y, z, r, h, n, o = {}) {
  const col = o.col || C.stone;
  const top = o.top || shade(col, 1.08);
  const thick = o.thick || 0.12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const len = 2 * r * Math.sin(Math.PI / n) + thick * 0.6;
    const isGate = o.gate != null && Math.abs(((am - o.gate + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < Math.PI / n;
    g.at(x + Math.cos(am) * r * Math.cos(Math.PI / n), y, z + Math.sin(am) * r * Math.cos(Math.PI / n), -am + Math.PI / 2, 1, (q) => {
      if (isGate) {
        q.box(-len * 0.36, 0, 0, len * 0.28, h * 1.25, thick * 1.5, col, { top });
        q.box(len * 0.36, 0, 0, len * 0.28, h * 1.25, thick * 1.5, col, { top });
        q.box(0, h * 0.8, 0, len * 0.5, h * 0.3, thick * 1.2, col, { top });
        q.box(0, 0, 0, len * 0.44, h * 0.8, thick * 0.5, C.dark);
      } else {
        q.box(0, 0, 0, len, h, thick, col, { top });
      }
    });
    if (o.towers && i % o.towers === 0) {
      g.box(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, thick * 2.1, h * 1.45, thick * 2.1, col, { top });
    }
  }
}

export function house(g, x, y, z, s = 1, rot = 0, o = {}) {
  g.at(x, y, z, rot, s, (q) => {
    q.box(0, 0, 0, 0.3, 0.2, 0.24, o.wall || C.cream, { side: shade(o.wall || C.cream, 0.94) });
    if (o.flat) q.box(0, 0.2, 0, 0.32, 0.03, 0.26, o.roof || C.white);
    else q.gable(0, 0.2, 0, 0.36, 0.14, 0.3, o.roof || C.terracotta, false, o.wall || C.cream);
    q.box(0, 0, 0.121, 0.07, 0.12, 0.01, C.woodD);
  });
}

// A little person, s tall, facing +z. Options colour the parts and add gear.
export function person(g, x, y, z, s = 0.4, o = {}) {
  const tunic = o.tunic || C.white;
  const skin = o.skin || C.skin;
  g.at(x, y, z, o.rot || 0, s, (q) => {
    q.box(0, 0, 0, 0.3, 0.42, 0.2, o.legs || shade(tunic, 0.86));
    q.box(0, 0.42, 0, 0.36, 0.3, 0.22, tunic);
    q.box(0, 0.72, 0, 0.26, 0.24, 0.24, skin);
    if (o.hair !== null) q.box(0, 0.93, -0.02, 0.28, 0.08, 0.26, o.hair || C.hair);
    if (o.beard) q.box(0, 0.68, 0.11, 0.2, 0.12, 0.05, o.beard);
    if (!o.noArms) {
      const up = o.armsUp ? 0.3 : 0;
      q.box(-0.24, 0.36 + up, 0, 0.1, 0.34, 0.12, skin);
      q.box(0.24, 0.36 + (o.armsUp || o.rightUp ? 0.3 : 0), 0, 0.1, 0.34, 0.12, skin);
    }
    if (o.crest) q.box(0, 0.96, 0, 0.07, 0.14, 0.3, o.crest); // helmet crest
    if (o.shield) g_disc(q, -0.28, 0.48, 0.14, 0.2, o.shield);
    if (o.spear) q.box(0.3, 0, 0.06, 0.035, 1.25, 0.035, o.spear === true ? C.woodD : o.spear);
    if (o.wings) {
      q.sheet([-0.16, 0.7, -0.1], [-0.7, 0.95, -0.2], [-0.62, 0.35, -0.2], [-0.16, 0.4, -0.1], o.wings);
      q.sheet([0.16, 0.4, -0.1], [0.62, 0.35, -0.2], [0.7, 0.95, -0.2], [0.16, 0.7, -0.1], o.wings);
    }
    if (o.eye) { // a single great eye
      q.box(0, 0.8, 0.12, 0.14, 0.1, 0.02, C.white);
      q.box(0, 0.82, 0.13, 0.06, 0.06, 0.02, C.dark);
    }
    if (o.horns) {
      q.box(-0.13, 0.96, 0, 0.05, 0.14, 0.05, o.horns);
      q.box(0.13, 0.96, 0, 0.05, 0.14, 0.05, o.horns);
    }
    if (o.crown) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 4 - 0.5) * 2.2;
        q.box(Math.sin(a) * 0.17, 0.96, -0.02, 0.04, 0.16 + 0.05 * Math.cos(a), 0.04, o.crown);
      }
    }
    if (o.lyre) {
      q.box(0.2, 0.36, 0.14, 0.16, 0.05, 0.05, o.lyre);
      q.box(0.13, 0.36, 0.14, 0.035, 0.26, 0.04, o.lyre);
      q.box(0.27, 0.36, 0.14, 0.035, 0.26, 0.04, o.lyre);
    }
  });
}

// Upright disc facing +z (shields, sun discs).
function g_disc(g, x, y, z, r, color, sides = 8) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z];
    const p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z];
    g.tri([x, y, z + 0.02], p0, p1, color);
    g.tri([x, y, z - 0.02], p1, p0, shade(color, 0.8));
  }
}
export const disc = g_disc;

// A four-legged animal, len long, facing +x. Options: horns, mane, tail, heads, wings.
export function beast(g, x, y, z, len = 0.5, o = {}) {
  const body = o.body || C.fleece;
  const head = o.head || body;
  const legs = o.legs || shade(body, 0.8);
  g.at(x, y, z, o.rot || 0, len, (q) => {
    const lh = o.legH || 0.3, bh = o.bodyH || 0.34, bw = o.bodyW || 0.36;
    for (const sx of [-0.32, 0.32]) for (const sz of [-1, 1]) q.box(sx, 0, sz * (bw / 2 - 0.06), 0.11, lh, 0.11, legs);
    q.box(0, lh, 0, 0.9, bh, bw, body);
    const hy = lh + bh * (o.headUp ?? 0.55);
    const n = o.noHead ? 0 : o.heads || 1;
    for (let i = 0; i < n; i++) {
      const hz = n === 1 ? 0 : (i - (n - 1) / 2) * 0.2;
      if (o.neck) q.box(0.42, lh + bh * 0.5, hz, 0.16, o.neck, 0.18, body);
      const ny = hy + (o.neck || 0);
      q.box(0.56, ny, hz, 0.3, 0.26, n === 1 ? 0.28 : 0.18, head);
      if (o.snout) q.box(0.74, ny, hz, 0.12, 0.13, 0.16, o.snout);
      if (o.horns) {
        q.box(0.55, ny + 0.26, hz - 0.1, 0.05, 0.14, 0.05, o.horns);
        q.box(0.55, ny + 0.26, hz + 0.1, 0.05, 0.14, 0.05, o.horns);
      }
      if (o.ears) {
        q.box(0.5, ny + 0.26, hz - 0.1, 0.07, 0.08, 0.06, head);
        q.box(0.5, ny + 0.26, hz + 0.1, 0.07, 0.08, 0.06, head);
      }
    }
    if (o.mane) q.box(0.4, lh + bh * 0.35, 0, 0.26, bh * 1.05, bw * 1.25, o.mane);
    if (o.tail) q.box(-0.52, lh + bh * 0.4, 0, 0.14, 0.08, 0.08, o.tail);
    if (o.tailUp) q.box(-0.5, lh + bh * 0.6, 0, 0.08, 0.4, 0.08, o.tailUp);
    if (o.wings) {
      q.sheet([0.2, lh + bh, -0.1], [-0.15, lh + bh + 0.55, -0.7], [-0.5, lh + bh + 0.1, -0.5], [-0.25, lh + bh, -0.1], o.wings);
      q.sheet([-0.25, lh + bh, 0.1], [-0.5, lh + bh + 0.1, 0.5], [-0.15, lh + bh + 0.55, 0.7], [0.2, lh + bh, 0.1], o.wings);
    }
  });
}

export const sheep = (g, x, y, z, rot = 0, s = 0.3) =>
  beast(g, x, y, z, s, { rot, body: C.fleece, head: C.dark, legs: C.dark, bodyH: 0.4, bodyW: 0.44, legH: 0.2 });
export const pig = (g, x, y, z, rot = 0, s = 0.3) =>
  beast(g, x, y, z, s, { rot, body: C.pink, snout: rgb('#e0789f'), legH: 0.16, bodyH: 0.36, bodyW: 0.4, ears: true });
export const cow = (g, x, y, z, rot = 0, s = 0.42, body = C.gold) =>
  beast(g, x, y, z, s, { rot, body, horns: C.white, snout: shade(body, 0.8), tail: shade(body, 0.7), legH: 0.3 });
export const lion = (g, x, y, z, rot = 0, s = 0.5) =>
  beast(g, x, y, z, s, { rot, body: rgb('#e2b24f'), mane: rgb('#a8692c'), snout: rgb('#f0cf86'), tailUp: rgb('#a8692c'), legH: 0.26 });
export const horse = (g, x, y, z, rot = 0, s = 0.6, o = {}) =>
  beast(g, x, y, z, s, { rot, body: C.wood, neck: 0.3, headUp: 0.7, snout: shade(o.body || C.wood, 0.8), tail: C.dark, legH: 0.42, bodyH: 0.3, bodyW: 0.3, ...o });

// Jagged rock stack: a few overlapping blobs and spikes.
export function crag(g, x, y, z, r, h, seed = 1, col = C.rock, dark = C.rockD) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.cyl(x, y, z, r, r * 0.55, h * 0.6, 6, col, { top: shade(col, 1.08), phase: rnd() * 3 });
  for (let i = 0; i < 3; i++) {
    const a = rnd() * 6.28, d = r * 0.45 * rnd();
    g.cyl(x + Math.cos(a) * d, y + h * 0.3, z + Math.sin(a) * d, r * (0.3 + rnd() * 0.25), 0, h * (0.5 + rnd() * 0.5), 5, i % 2 ? col : dark, { phase: rnd() * 3 });
  }
}

// Cave mouth: a rock mound with a dark opening facing +z.
export function cave(g, x, y, z, r, h, seed = 1, o = {}) {
  crag(g, x, y, z - r * 0.25, r, h, seed, o.col, o.dark);
  g.blob(x - r * 0.55, y + h * 0.18, z + r * 0.3, r * 0.42, h * 0.36, r * 0.4, o.col || C.rock, { dark: C.rockD });
  g.blob(x + r * 0.55, y + h * 0.18, z + r * 0.3, r * 0.42, h * 0.36, r * 0.4, o.col || C.rock, { dark: C.rockD });
  g.box(x, y + h * 0.42, z + r * 0.34, r * 1.3, h * 0.2, r * 0.5, o.col || C.rock);
  g.box(x, y, z + r * 0.46, r * 0.62, h * 0.44, r * 0.3, o.mouth || C.night);
}

// A Greek galley about 1.5 long, bow towards +x. Returns nothing; sails are part of the mesh.
export function galley(g, o = {}) {
  const hull = o.hull || C.woodD;
  const trim = o.trim || C.red;
  const sail = o.sail || C.sail;
  // Hull: a faceted boat shape from three cross-sections.
  const sec = [[-0.72, 0.0, 0.34], [-0.45, 0.17, 0.2], [0.35, 0.17, 0.2], [0.78, 0.0, 0.3]]; // x, half-width, deck height
  for (let i = 0; i < sec.length - 1; i++) {
    const [x0, w0, h0] = sec[i], [x1, w1, h1] = sec[i + 1];
    const k0 = [x0, -0.08, 0], k1 = [x1, -0.08, 0];
    const a0 = [x0, h0, w0], a1 = [x1, h1, w1], b0 = [x0, h0, -w0], b1 = [x1, h1, -w1];
    g.quad(a0, k0, k1, a1, hull); // south side
    g.quad(b1, k1, k0, b0, shade(hull, 0.9)); // north side
    g.quad(b0, a0, a1, b1, o.deck || C.wood); // deck
    g.quad(a0, a1, [x1, h1 + 0.04, w1], [x0, h0 + 0.04, w0], trim); // gunwale stripe
  }
  g.box(-0.74, 0.3, 0, 0.07, 0.3, 0.07, hull); // curled stern post
  g.box(-0.66, 0.56, 0, 0.16, 0.07, 0.07, hull);
  g.box(0.8, 0.26, 0, 0.07, 0.2, 0.07, hull); // bow post
  g.box(0.62, 0.12, 0.185, 0.1, 0.07, 0.02, C.white); // the painted eye
  g.box(0.63, 0.13, 0.19, 0.04, 0.04, 0.02, C.dark);
  g.box(0.05, 0.17, 0, 0.05, 0.86, 0.05, C.woodD); // mast
  g.box(0.05, 0.95, 0, 0.04, 0.04, 0.9, C.woodD); // yard
  // Square sail, bellied forward.
  const sx = 0.09, bx = 0.24, t = 0.94, b = 0.38, hw = 0.42;
  g.sheet([sx, t, -hw], [sx, t, hw], [bx, (t + b) / 2, hw * 0.92], [bx, (t + b) / 2, -hw * 0.92], sail, shade(sail, 0.85));
  g.sheet([bx, (t + b) / 2, -hw * 0.92], [bx, (t + b) / 2, hw * 0.92], [sx, b, hw], [sx, b, -hw], shade(sail, 0.93), shade(sail, 0.8));
  if (o.device) { // a stripe across the sail
    g.sheet([bx + 0.012, (t + b) / 2 + 0.07, -hw * 0.9], [bx + 0.012, (t + b) / 2 + 0.07, hw * 0.9], [bx + 0.012, (t + b) / 2 - 0.07, hw * 0.9], [bx + 0.012, (t + b) / 2 - 0.07, -hw * 0.9], o.device);
  }
  for (let i = 0; i < 5; i++) { // oars
    const ox = -0.34 + i * 0.16;
    g.box(ox, 0.02, 0.3, 0.03, 0.03, 0.26, C.wood);
    g.box(ox, 0.02, -0.3, 0.03, 0.03, 0.26, C.wood);
  }
  if (o.crew) {
    for (let i = 0; i < 3; i++) person(g, -0.3 + i * 0.26, 0.17, 0, 0.2, { tunic: i === 1 ? C.red : C.cream, noArms: true });
  }
}

// Puffy cloud made of a few blobs with a flat grey underside.
export function cloud(g, seed = 1, o = {}) {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const top = o.top || rgb('#ffffff'), under = o.under || rgb('#cfd8ea');
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 1.05 + (rnd() - 0.5) * 0.4;
    const r = 0.9 + rnd() * 0.7;
    g.blob(x, r * 0.32, (rnd() - 0.5) * 0.8, r, r * 0.55, r * 0.8, top, { dark: under, rot: rnd() * 3 });
  }
}

export function meshOf(geo, material, shadows = true) {
  const m = new THREE.Mesh(geo.build ? geo.build() : geo, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}
