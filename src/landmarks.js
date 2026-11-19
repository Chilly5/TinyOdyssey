// The landmarks. Each entry in MODELS draws one site in local space: static
// parts go into the shared Geo `g`, moving parts are added to `L.group` through
// the effects system `L.fx`. Local axes: x east, z south (towards the viewer), y up.

import * as THREE from './three.js';
import { Geo, rgb, shade } from './kit.js';
import { makeTemplates } from './terrain.js';
import { LANDMARK_SCALE as S } from './config.js';
import {
  C, temple, tholos, wallRing, house, person, beast, disc, crag, cave, cloud,
  sheep, pig, cow, lion,
} from './models.js';

const TAU = Math.PI * 2;
const SOUTH = -Math.PI / 2; // rotation that turns a beast (built facing +x) towards the viewer

function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

// Birds circling a point.
function flock(L, o) {
  const g = new Geo();
  const c = o.color || C.white;
  g.box(0, 0, 0, 0.07, 0.05, 0.2, c);
  g.sheet([0.03, 0.03, -0.06], [0.3, 0.12, -0.02], [0.3, 0.12, 0.06], [0.03, 0.03, 0.08], c);
  g.sheet([-0.03, 0.03, 0.08], [-0.3, 0.12, 0.06], [-0.3, 0.12, -0.02], [-0.03, 0.03, -0.06], c);
  const geo = g.build();
  const birds = [];
  for (let i = 0; i < o.n; i++) {
    const m = L.fx.mesh(L.group, geo, { shadow: true });
    birds.push({ m, r: o.r * (0.7 + 0.5 * ((i * 0.37) % 1)), y: o.y + ((i * 0.61) % 1) * (o.spread ?? 0.6), ph: (i / o.n) * TAU + i });
  }
  L.fx.tick((t) => {
    for (const b of birds) {
      const a = t * (o.speed || 0.5) + b.ph;
      b.m.position.set((o.x || 0) + Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + b.ph) * 0.1, (o.z || 0) + Math.sin(a) * b.r * 0.8);
      b.m.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a) * 0.8);
      b.m.scale.set(o.size || 1, (o.size || 1) * (0.2 + 1.5 * Math.sin(t * 9 + b.ph)), o.size || 1);
    }
  });
}

// A set of swaying necks with heads (Hydra, Scylla).
function necks(L, o) {
  for (let i = 0; i < o.n; i++) {
    const g = new Geo();
    const segs = o.segs || 4;
    for (let k = 0; k < segs; k++) g.box(0, k * o.seg, 0, o.thick, o.seg + 0.02, o.thick, k % 2 ? o.col : o.col2);
    const hy = segs * o.seg;
    g.box(0, hy, 0.05, o.thick * 1.7, o.thick * 1.15, o.thick * 2.1, o.col);
    g.box(0, hy - o.thick * 0.2, 0.09, o.thick * 1.3, o.thick * 0.3, o.thick * 1.9, o.jaw || C.crimson);
    g.box(-o.thick * 0.5, hy + o.thick * 0.6, o.thick * 0.9, o.thick * 0.35, o.thick * 0.35, 0.03, o.eye || C.flame);
    g.box(o.thick * 0.5, hy + o.thick * 0.6, o.thick * 0.9, o.thick * 0.35, o.thick * 0.35, 0.03, o.eye || C.flame);
    const m = L.fx.mesh(L.group, g, { shadow: true });
    const f = o.n === 1 ? 0 : i / (o.n - 1) - 0.5;
    m.position.set(o.x + f * (o.fanX ?? 0.4), o.y, o.z + Math.abs(f) * (o.fanZ ?? -0.1));
    const bz = (o.leanZ ?? 0) - f * (o.splay ?? 1.1), bx = o.leanX ?? 0.15;
    L.fx.tick((t) => {
      m.rotation.z = bz + Math.sin(t * 1.3 + i * 1.7) * (o.sway ?? 0.22);
      m.rotation.x = bx + Math.sin(t * 0.9 + i * 2.3) * (o.sway ?? 0.22) * 0.8;
    });
  }
}

// Something that ambles round a small circle.
function wander(L, geo, o) {
  const m = L.fx.mesh(L.group, geo, { shadow: true });
  const ph = o.ph || 0;
  L.fx.tick((t) => {
    const a = t * (o.speed || 0.3) + ph;
    m.position.set(o.x + Math.cos(a) * o.r, (o.y || 0) + Math.abs(Math.sin(t * (o.step || 5) + ph)) * (o.hop ?? 0.02), o.z + Math.sin(a) * o.r);
    m.rotation.y = -a - Math.PI / 2;
  });
  return m;
}

const MODELS = {
  // ------------------------------------------------------------------ gods --
  olympus(g, s, L) {
    g.cyl(0, 0, 0, 1.0, 0.92, 0.16, 8, C.marbleD, { top: C.marble });
    g.at(0, 0.16, -0.05, -0.35, 1, (q) => temple(q, 0, 0, 0, 0.8, 1.1, 0.5, { roof: C.gold, pediment: C.gold }));
    for (const sx of [-0.66, 0.66]) {
      g.box(sx, 0.16, 0.5, 0.14, 0.34, 0.14, C.marble);
      g.blob(sx, 0.6, 0.5, 0.1, 0.1, 0.1, C.gold);
    }
    // A slow ring of cloud below the summit.
    const ring = new THREE.Group();
    ring.position.y = -1.0;
    L.group.add(ring);
    for (let i = 0; i < 6; i++) {
      const cg = new Geo();
      cloud(cg, i + 3);
      const m = L.fx.mesh(ring, cg, { shadow: true });
      const a = (i / 6) * TAU;
      m.position.set(Math.cos(a) * 2.5, (i % 2) * 0.35, Math.sin(a) * 2.2);
      m.scale.setScalar(0.3 + (i % 3) * 0.05);
    }
    const bolt = L.fx.lightning(L.group);
    let next = 3;
    L.fx.tick((t) => {
      ring.rotation.y = t * 0.1;
      if (t > next) {
        const a = Math.random() * TAU, r = 1.4 + Math.random() * 1.8;
        bolt([Math.cos(a) * 0.3, 3.6, Math.sin(a) * 0.3], [Math.cos(a) * r, -1.2 - Math.random(), Math.sin(a) * r * 0.8 + 0.6], 0.08);
        next = t + 2.5 + Math.random() * 5;
      }
    });
  },

  delphi(g, s, L) {
    tholos(g, 0.5, 0, 0.4, 0.4, 0.4);
    g.at(-0.4, 0, -0.35, 0.4, 1, (q) => temple(q, 0, 0, 0, 0.58, 0.95, 0.4));
    g.box(-0.3, 0, 0.6, 0.2, 0.05, 0.2, C.step);
    g.blob(-0.3, 0.14, 0.6, 0.09, 0.13, 0.09, C.marble); // the omphalos, navel of the world
    g.box(0.05, 0, -0.05, 0.22, 0.02, 0.18, C.night); // the chasm
    person(g, 0.2, 0, 0.1, 0.36, { tunic: C.white, hair: C.dark, rightUp: true });
    L.fx.puffs(L.group, { x: 0.05, y: 0.05, z: -0.05, color: '#dff5d2', n: 5, life: 4.5, rise: 1.7, size: 0.2, drift: [0.2, 0] });
    L.tree('cypress', -1.0, 0.5, 1.2);
    L.tree('cypress', 1.05, -0.45, 1.1);
    L.tree('cypress', 0.95, 0.9, 1.0);
  },

  delos(g, s, L) {
    g.at(-0.05, 0, -0.08, 0.3, 1, (q) => temple(q, 0, 0, 0, 0.4, 0.56, 0.28));
    L.tree('palm', 0.36, 0.2, 1.2);
    for (let i = 0; i < 3; i++) g.box(-0.3 + i * 0.15, 0, 0.36, 0.1, 0.1, 0.06, C.marble); // the lions
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#ffe9a0', n: 3, y: 0.5, rise: 0.9, spread: 0.3, life: 5 });
  },

  forge(g, s, L) {
    g.box(0, 0, -0.2, 0.9, 0.5, 0.5, C.stoneD, { top: C.stone });
    g.box(0, 0, 0.06, 0.5, 0.34, 0.03, C.night);
    g.box(0.3, 0.5, -0.3, 0.2, 0.5, 0.2, C.stoneD);
    g.box(0.15, 0, 0.5, 0.16, 0.14, 0.12, C.woodD);
    g.box(0.15, 0.14, 0.5, 0.3, 0.08, 0.12, C.dark); // anvil
    person(g, -0.2, 0, 0.5, 0.46, { tunic: C.bronzeD, rot: 1.2, rightUp: true, beard: C.hair });
    L.fx.puffs(L.group, { x: 0.3, y: 1.0, z: -0.3, color: '#6d6878', n: 6, life: 5, rise: 2.2, size: 0.26, drift: [0.5, 0.1] });
    L.fx.flame(L.group, 0, 0.03, 0.1, 0.16);
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#ffd26a', n: 3, x: 0.15, y: 0.25, z: 0.5, rise: 0.5, spread: 0.1, life: 1.2 });
  },

  aphrodite(g, s, L) {
    const sh = new Geo();
    const hinge = [0, 0.04, 0.3];
    for (let i = 0; i < 7; i++) { // scallop shell, ribs fanned to the north
      const a0 = -1.25 + i * 0.357, a1 = a0 + 0.357;
      const p = (a) => [Math.sin(a) * 0.75, 0.2 + 0.12 * Math.cos(a * 1.2), 0.3 - Math.cos(a) * 0.8];
      const col = i % 2 ? C.pink : rgb('#ffd0e2');
      sh.tri(hinge, p(a1), p(a0), col);
      sh.tri(hinge, p(a0), p(a1), shade(col, 0.8));
    }
    person(sh, 0, 0.1, -0.05, 0.5, { tunic: C.skin, legs: C.skin, hair: C.gold });
    for (let i = 0; i < 6; i++) sh.blob(Math.cos(i * 1.05) * 0.6, 0, 0.1 + Math.sin(i * 1.05) * 0.5, 0.12, 0.06, 0.12, C.white);
    const m = L.fx.mesh(L.group, sh, { shadow: true });
    L.fx.tick((t) => {
      m.position.y = 0.05 + Math.sin(t * 1.4) * 0.04;
      m.rotation.z = Math.sin(t * 0.9) * 0.04;
    });
    L.fx.glyphs(L.group, { glyph: 'heart', color: '#ff9ac2', n: 3, y: 0.75, rise: 1.0, spread: 0.3, life: 4 });
  },

  dodona(g, s, L) {
    g.box(0, 0, 0, 0.2, 0.6, 0.2, C.woodD);
    g.blob(0, 0.98, 0, 0.7, 0.5, 0.7, C.green, { dark: C.greenD });
    g.blob(-0.42, 0.75, 0.2, 0.4, 0.3, 0.4, C.green, { dark: C.greenD });
    g.blob(0.44, 0.8, -0.1, 0.42, 0.32, 0.42, rgb('#5aa843'), { dark: C.greenD });
    for (let i = 0; i < 5; i++) { // bronze cauldrons on tripods
      const a = 0.5 + i * 1.25, x = Math.cos(a) * 0.85, z = Math.sin(a) * 0.62 + 0.1;
      g.box(x, 0, z, 0.04, 0.12, 0.04, C.bronzeD);
      g.cyl(x, 0.12, z, 0.09, 0.13, 0.12, 6, C.bronze, { top: C.dark });
    }
    person(g, 0.45, 0, 0.62, 0.36, { tunic: C.cream });
    flock(L, { n: 3, r: 0.8, y: 1.5, spread: 0.3, speed: 0.7, size: 0.7 });
  },

  sounion(g) {
    g.at(0, 0, 0, 0.5, 1, (q) => temple(q, 0, 0, 0, 0.5, 0.85, 0.36));
  },

  cave(g, s, L) {
    cave(g, 0, 0, -0.1, 0.6, 0.9, 3);
    beast(g, 0.5, 0, 0.5, 0.32, { rot: 2.6, body: C.white, horns: C.stoneD }); // Amalthea
    g.box(0, 0, 0.44, 0.16, 0.08, 0.12, C.gold); // the cradle
    person(g, -0.55, 0, 0.45, 0.36, { tunic: C.bronze, shield: C.bronze, crest: C.red, hair: C.bronzeD, spear: true });
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#ffe9a0', n: 2, x: 0, y: 0.2, z: 0.45, rise: 0.5, spread: 0.1, life: 3 });
  },

  etna(g, s, L) {
    const basalt = rgb('#5c5566');
    g.cyl(0, -0.4, 0, 1.2, 0.5, 0.95, 8, basalt, { top: C.dark });
    const lg = new Geo();
    lg.cyl(0, 0, 0, 0.42, 0.42, 0.02, 8, C.lava, { top: C.lava });
    lg.cyl(0, 0.01, 0, 0.22, 0.22, 0.02, 6, C.flame, { top: C.flame });
    const lava = L.fx.mesh(L.group, lg, { glow: true });
    lava.position.y = 0.56;
    L.fx.tick((t) => lava.scale.setScalar(0.92 + 0.08 * Math.sin(t * 2.3)));
    L.fx.puffs(L.group, { x: 0, y: 0.6, z: 0, color: '#57525f', n: 8, life: 7, rise: 4.4, size: 0.5, drift: [1.2, 0.2], wobble: 0.2 });
    L.fx.puffs(L.group, { x: 0, y: 0.55, z: 0, color: '#ff8a3a', glow: true, n: 4, life: 1.7, rise: 0.9, size: 0.1, drift: [0.1, 0], wobble: 0.25 });
  },

  othrys(g) {
    const D = rgb('#4a4459'), D2 = rgb('#383247');
    g.box(-0.3, 0, 0, 0.4, 1.0, 0.4, D, { top: D2 });
    g.box(0.25, 0, -0.15, 0.34, 0.7, 0.34, D, { top: D2 });
    g.box(0.05, 0, 0.35, 0.3, 0.45, 0.3, D2);
    g.box(-0.42, 1.0, -0.1, 0.12, 0.2, 0.12, D);
    g.box(-0.2, 1.0, 0.1, 0.12, 0.12, 0.12, D);
    g.box(0.25, 0.7, -0.15, 0.12, 0.18, 0.12, D2);
    g.box(0.6, 0, 0.4, 0.2, 0.12, 0.16, D);
  },

  artemision(g) {
    g.at(0, 0, -0.15, -0.3, 1, (q) => temple(q, 0, 0, 0, 1.15, 1.9, 0.62, { roofH: 0.3 }));
    g.box(0.95, 0, 0.95, 0.3, 0.14, 0.3, C.marble);
    person(g, 0.95, 0.14, 0.95, 0.5, { tunic: C.gold, skin: C.gold, hair: C.goldD, rightUp: true });
    beast(g, 0.4, 0, 1.25, 0.36, { rot: 0.3, body: rgb('#c98f55'), horns: C.woodD, neck: 0.2, legH: 0.4, bodyH: 0.28, bodyW: 0.26 });
  },

  meadow(g, s, L) {
    const rnd = seeded(5);
    const petals = [C.red, C.gold, C.purple, C.white, C.pink];
    for (let i = 0; i < 30; i++) {
      const a = rnd() * TAU, r = 0.25 + rnd() * 0.95;
      g.blob(Math.cos(a) * r, 0.06, Math.sin(a) * r * 0.9, 0.07, 0.06, 0.07, petals[i % 5]);
    }
    g.cyl(0.35, 0, -0.2, 0.42, 0.36, 0.03, 7, C.night, { top: rgb('#0e0a18') });
    L.fx.puffs(L.group, { x: 0.35, y: 0.05, z: -0.2, color: '#6b4aa8', n: 3, life: 5, rise: 0.9, size: 0.16 });
    person(g, -0.3, 0, 0.25, 0.4, { tunic: rgb('#f4d35e'), hair: C.wood });
    L.tree('oak', -0.8, -0.4, 1.1);
    for (let i = 0; i < 4; i++) g.blob(-0.8 + Math.cos(i * 1.6) * 0.3, 0.5 + (i % 2) * 0.12, -0.4 + Math.sin(i * 1.6) * 0.3, 0.06, 0.06, 0.06, C.red);
  },

  naxos(g) {
    g.box(0, 0, 0, 0.7, 0.08, 0.3, C.step); // the Portara
    g.box(-0.24, 0.08, 0, 0.12, 0.8, 0.14, C.marble);
    g.box(0.24, 0.08, 0, 0.12, 0.8, 0.14, C.marble);
    g.box(0, 0.88, 0, 0.72, 0.12, 0.16, C.marble);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 4; i++) {
        const x = 0.58 + r * 0.2, z = -0.45 + i * 0.22;
        g.blob(x, 0.1, z, 0.09, 0.1, 0.09, C.leaf);
        if ((r + i) % 2) g.blob(x + 0.04, 0.1, z + 0.06, 0.04, 0.04, 0.04, C.purple);
      }
    }
    person(g, -0.5, 0, 0.42, 0.38, { tunic: C.pink, hair: C.dark });
    person(g, -0.76, 0, 0.5, 0.4, { tunic: C.purple, hair: C.green, spear: C.green });
  },

  hadesgate(g, s, L) {
    cave(g, 0, 0, -0.1, 0.62, 0.85, 7, { col: rgb('#6b6478'), dark: rgb('#4c4660'), mouth: rgb('#0e0a18') });
    const ghostFire = { outer: rgb('#2fbf71'), mid: rgb('#8df0a8'), core: rgb('#e6ffe6') };
    L.fx.flame(L.group, -0.46, 0, 0.44, 0.14, ghostFire);
    L.fx.flame(L.group, 0.46, 0, 0.44, 0.14, ghostFire);
    beast(g, 0.05, 0, 0.66, 0.42, { rot: SOUTH, body: C.dark, heads: 3, snout: rgb('#4a3f5c'), tailUp: C.dark, ears: true }); // Cerberus
  },

  hesperides(g, s, L) {
    g.box(0, 0, 0, 0.18, 0.5, 0.18, C.woodD);
    g.blob(0, 0.9, 0, 0.62, 0.46, 0.62, C.green, { dark: C.greenD });
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7, b = (i % 3) * 0.16;
      g.blob(Math.cos(a) * 0.52, 0.72 + b, Math.sin(a) * 0.52, 0.07, 0.07, 0.07, C.gold);
    }
    for (let i = 0; i < 14; i++) { // Ladon coiled round the trunk
      const a = i * 0.75, r = 0.2 + i * 0.012;
      g.box(Math.cos(a) * r, 0.02 + i * 0.035, Math.sin(a) * r, 0.13, 0.09, 0.13, i % 2 ? rgb('#3fae6a') : rgb('#2e8b57'));
    }
    g.box(0.3, 0.52, 0.22, 0.18, 0.12, 0.16, rgb('#3fae6a'));
    g.box(0.3, 0.6, 0.31, 0.12, 0.03, 0.02, C.flame);
    person(g, -0.8, 0, 0.5, 0.36, { tunic: rgb('#ffd59a'), hair: C.dark });
    person(g, 0.85, 0, 0.35, 0.36, { tunic: rgb('#ffb0c8'), hair: C.wood, rightUp: true });
    person(g, 0.2, 0, 0.9, 0.36, { tunic: rgb('#bfe3ff'), hair: C.gold });
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#fff0a0', n: 3, y: 0.8, rise: 0.6, spread: 0.5, life: 3.5 });
  },

  pan(g, s, L) {
    g.blob(0, 0.1, 0, 0.3, 0.18, 0.26, C.rock, { dark: C.rockD });
    person(g, 0, 0.2, 0.02, 0.4, { tunic: C.skinD, legs: C.woodD, horns: C.woodD, hair: C.woodD, beard: C.woodD });
    sheep(g, 0.6, 0, 0.3, -2.2);
    sheep(g, -0.55, 0, 0.45, -0.8);
    sheep(g, 0.3, 0, 0.75, -1.6);
    beast(g, -0.7, 0, -0.2, 0.3, { rot: -0.4, body: C.stone, horns: C.woodD });
    L.fx.glyphs(L.group, { glyph: 'note', color: '#d8f5a2', n: 3, x: 0.1, y: 0.6, rise: 1.1, spread: 0.2, life: 3.2 });
  },

  midas(g, s, L) {
    const gt = new Geo().box(0, 0, 0, 0.07, 0.22, 0.07, C.goldD).blob(0, 0.4, 0, 0.3, 0.24, 0.3, C.gold, { dark: C.goldD });
    for (const [x, z, sc] of [[-0.6, -0.3, 1.2], [0.5, -0.5, 1.4], [0.8, 0.25, 1.1], [-0.2, -0.75, 1.0], [-0.9, 0.3, 0.9]]) g.add(gt, x, 0, z, x * 3, sc);
    person(g, 0, 0, 0.2, 0.42, { tunic: C.purple, crown: C.gold, armsUp: true, beard: C.hair });
    g.box(-0.1, 0, 0.78, 1.7, 0.03, 0.22, C.water);
    for (let i = 0; i < 6; i++) g.box(-0.8 + i * 0.3, 0.03, 0.74 + (i % 2) * 0.08, 0.06, 0.02, 0.05, C.gold);
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#ffe680', n: 4, y: 0.4, rise: 0.7, spread: 0.7, life: 2.6 });
  },

  // ---------------------------------------------------------------- heroes --
  athens(g, s, L) {
    const rockC = rgb('#d2bd93'), rockD = rgb('#b39d76');
    g.cyl(0, 0, -0.25, 1.25, 1.05, 0.5, 9, rockD, { top: rockC }); // the Acropolis
    g.at(0.12, 0.5, -0.3, -0.42, 1, (q) => temple(q, 0, 0, 0, 0.72, 1.25, 0.46)); // the Parthenon
    g.box(-0.72, 0.5, -0.5, 0.3, 0.22, 0.26, C.marble);
    g.box(-0.72, 0.72, -0.5, 0.34, 0.04, 0.3, C.marbleD);
    g.box(-0.6, 0.5, 0.08, 0.16, 0.1, 0.16, C.marble);
    person(g, -0.6, 0.6, 0.08, 0.62, { tunic: C.gold, skin: C.gold, hair: C.goldD, crest: C.goldD, spear: C.goldD, shield: C.goldD });
    L.tree('olive', 0.78, 0.2, 0.8, 0.5);
    house(g, -1.0, 0, 0.95, 1, 0.2);
    house(g, -0.5, 0, 1.15, 1, -0.1);
    house(g, 0.05, 0, 1.05, 1.05, 0.3, { roof: C.terracottaD });
    house(g, 0.6, 0, 1.2, 1, 0);
    house(g, 1.1, 0, 0.8, 0.95, 0.5);
    house(g, 1.4, 0, 0.2, 1, -0.3);
    L.tree('cypress', -1.4, 0.3, 1.1);
    L.tree('cypress', 1.5, -0.4, 1.0);
    flock(L, { n: 1, r: 0.7, y: 1.7, spread: 0, speed: 0.6, size: 0.8, color: rgb('#c9b08a'), z: -0.2 }); // Athena's owl
  },

  mycenae(g) {
    g.cyl(0, 0, 0, 1.0, 0.85, 0.34, 8, C.stoneD, { top: C.earth });
    wallRing(g, 0, 0.34, 0, 0.74, 0.26, 10, { col: C.stone, thick: 0.14, gate: Math.PI / 2 });
    g.box(0, 0.34, -0.15, 0.5, 0.26, 0.4, C.cream, { top: rgb('#c98f55') });
    g.cyl(-0.12, 0.34, 0.09, 0.035, 0.045, 0.24, 5, C.red);
    g.cyl(0.12, 0.34, 0.09, 0.035, 0.045, 0.24, 5, C.red);
    g.tri([-0.13, 0.7, 0.8], [0.13, 0.7, 0.8], [0, 0.92, 0.8], C.gold); // the lion relief over the gate
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      g.box(0.4 + Math.cos(a) * 0.15, 0.34, 0.3 + Math.sin(a) * 0.15, 0.05, 0.1, 0.05, C.stoneD);
    }
    g.blob(0.4, 0.38, 0.3, 0.05, 0.03, 0.05, C.gold); // a gold mask in the grave circle
  },

  sparta(g, s, L) {
    g.at(-0.55, 0, -0.45, 0.3, 1, (q) => temple(q, 0, 0, 0, 0.5, 0.7, 0.34, { roof: C.bronze, pediment: C.bronzeD }));
    house(g, 0.4, 0, -0.6, 1.1, 0.1, { roof: C.crimson });
    house(g, 0.85, 0, -0.2, 1.0, -0.3, { roof: C.crimson });
    house(g, 0.2, 0, -0.15, 0.9, 0.5, { roof: C.crimson });
    g.box(1.05, 0, 0.55, 0.2, 0.12, 0.2, C.stone); // shield monument with the lambda
    disc(g, 1.05, 0.48, 0.55, 0.36, C.bronze, 10);
    g.quad([1.03, 0.7, 0.58], [0.88, 0.3, 0.58], [0.94, 0.3, 0.58], [1.07, 0.64, 0.58], C.crimson);
    g.quad([1.03, 0.64, 0.58], [1.16, 0.3, 0.58], [1.22, 0.3, 0.58], [1.07, 0.7, 0.58], C.crimson);
    const ph = new Geo();
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 4; i++) {
        person(ph, -0.33 + i * 0.22, 0, r * 0.24, 0.34, { tunic: C.crimson, crest: C.crimson, hair: C.bronze, shield: C.bronze, spear: true });
      }
    }
    const m = L.fx.mesh(L.group, ph, { shadow: true });
    L.fx.tick((t) => m.position.set(-0.3 + Math.sin(t * 0.35) * 0.5, Math.abs(Math.sin(t * 5)) * 0.015, 0.7));
  },

  sisyphus(g, s, L) {
    const A = [-0.95, 0], B = [0.55, 1.2], z0 = -0.4, z1 = 0.3;
    const slope = rgb('#b8b06a'), side = C.rock;
    g.quad([A[0], 0, z0], [A[0], 0, z1], [B[0], B[1], z1], [B[0], B[1], z0], slope);
    g.tri([A[0], 0, z1], [B[0], 0, z1], [B[0], B[1], z1], side);
    g.tri([A[0], 0, z0], [B[0], B[1], z0], [B[0], 0, z0], C.rockD);
    g.quad([B[0], B[1], z1], [B[0], 0, z1], [B[0], 0, z0], [B[0], B[1], z0], C.rockD);
    g.cyl(-0.5, 0, 0.8, 0.2, 0.2, 0.02, 7, C.water); // the spring of Peirene
    house(g, 0.95, 0, 0.5, 1, 0.3);
    house(g, 0.3, 0, 0.85, 0.9, -0.2);
    const bg = new Geo().blob(0, 0, 0, 0.2, 0.2, 0.2, C.stone, { dark: C.stoneD });
    const boulder = L.fx.mesh(L.group, bg, { shadow: true });
    const fg = new Geo();
    person(fg, 0, 0, 0, 0.34, { tunic: C.cream, rot: Math.PI / 2, armsUp: true });
    const man = L.fx.mesh(L.group, fg, { shadow: true });
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len; // slope normal
    L.fx.tick((t) => {
      const c = t % 12;
      let u, mu;
      if (c < 8.5) { u = 0.1 + 0.8 * (c / 8.5) ** 0.8; mu = u - 0.14; } // heave
      else if (c < 9.1) { u = 0.9 + Math.sin((c - 8.5) * 20) * 0.01; mu = 0.76; } // almost
      else if (c < 10.3) { const k = (c - 9.1) / 1.2; u = 0.9 - 0.8 * k * k; mu = 0.76; } // and down it goes
      else { u = 0.1; mu = 0.76 - 0.8 * ((c - 10.3) / 1.7); } // the walk back
      boulder.position.set(A[0] + (B[0] - A[0]) * u + nx * 0.2, (B[1] - A[1]) * u + ny * 0.2, -0.05);
      boulder.rotation.z = -u * len / 0.2;
      man.position.set(A[0] + (B[0] - A[0]) * mu, Math.max(0, (B[1] - A[1]) * mu), -0.05);
      man.rotation.y = c >= 10.3 ? Math.PI : 0;
    });
  },

  thebes(g) {
    wallRing(g, 0, 0, 0, 0.85, 0.3, 14, { col: C.stone, towers: 2, gate: Math.PI / 2 });
    house(g, -0.3, 0, -0.2);
    house(g, 0.25, 0, -0.3, 1, 0.4);
    house(g, 0, 0, 0.25, 1.1, -0.2);
    g.box(0.38, 0, 0.2, 0.3, 0.3, 0.3, C.cream, { top: C.terracotta });
    g.cyl(1.15, 0, 0.8, 0.26, 0.2, 0.4, 6, C.rock);
    beast(g, 1.15, 0.4, 0.8, 0.42, { rot: -0.9, body: rgb('#e2b24f'), head: C.skin, wings: C.cream, tailUp: rgb('#a8692c'), legH: 0.14, bodyH: 0.3 }); // the Sphinx
  },

  olympia(g, s, L) {
    g.box(0.1, 0, 0.55, 1.9, 0.03, 0.46, rgb('#e3cf9a'));
    g.gable(0.1, 0, 0.97, 1.9, 0.14, 0.3, C.leaf);
    g.gable(0.1, 0, 0.16, 1.9, 0.12, 0.26, C.leaf);
    g.at(-0.5, 0, -0.6, 0.25, 1, (q) => temple(q, 0, 0, 0, 0.55, 0.9, 0.4));
    g.cyl(0.6, 0, -0.45, 0.12, 0.16, 0.26, 6, C.bronze, { top: C.dark });
    L.fx.flame(L.group, 0.6, 0.26, -0.45, 0.2);
    const rg = new Geo();
    const kit = [C.white, C.red, C.blue];
    for (let i = 0; i < 3; i++) person(rg, 0, 0, -0.12 + i * 0.12, 0.26, { tunic: kit[i], rot: Math.PI / 2 });
    const runners = L.fx.mesh(L.group, rg, { shadow: true });
    L.fx.tick((t) => {
      const k = (t * 0.22) % 2;
      runners.position.set(-0.7 + (k < 1 ? k : 2 - k) * 1.6, Math.abs(Math.sin(t * 12)) * 0.03, 0.55);
      runners.rotation.y = k < 1 ? 0 : Math.PI;
    });
  },

  lion(g, s, L) {
    crag(g, 0, 0, 0, 0.26, 0.5, 5);
    const lg = new Geo();
    lion(lg, 0, 0, 0, 0, 0.46);
    wander(L, lg, { x: 0, z: 0, r: 0.55, speed: 0.5 });
  },

  hydra(g, s, L) {
    g.cyl(0, 0, 0, 0.62, 0.55, 0.04, 8, rgb('#3d6b4a'), { top: rgb('#35604a') });
    for (let i = 0; i < 6; i++) g.box(Math.cos(i * 1.1) * 0.5, 0, Math.sin(i * 1.1) * 0.42, 0.03, 0.22, 0.03, C.leaf);
    g.blob(0, 0.16, 0, 0.3, 0.2, 0.26, rgb('#3fae6a'), { dark: rgb('#2a7a4c') });
    necks(L, { n: 5, x: 0, y: 0.22, z: 0.02, seg: 0.15, thick: 0.1, col: rgb('#3fae6a'), col2: rgb('#2e8b57') });
  },

  birds(g, s, L) {
    g.cyl(0, 0, 0, 0.5, 0.5, 0.03, 8, C.water);
    for (let i = 0; i < 6; i++) g.box(Math.cos(i * 1.1) * 0.55, 0, Math.sin(i * 1.1) * 0.5, 0.03, 0.2, 0.03, C.leaf);
    flock(L, { n: 7, r: 0.95, y: 1.1, speed: 0.9, color: C.bronzeD });
  },

  megaron(g) {
    g.box(0, 0, -0.1, 0.9, 0.3, 0.6, C.cream, { top: rgb('#d8b98a') });
    g.box(0, 0, 0.3, 0.6, 0.03, 0.3, C.sand);
    g.cyl(-0.2, 0, 0.26, 0.035, 0.045, 0.3, 5, C.red);
    g.cyl(0.2, 0, 0.26, 0.035, 0.045, 0.3, 5, C.red);
    g.box(0, 0.3, 0.26, 0.66, 0.05, 0.2, C.terracotta);
    for (let i = 0; i < 4; i++) g.cyl(-0.72 + i * 0.14, 0, 0.5, 0.05, 0.07, 0.14, 5, C.terracotta, { top: C.dark });
    person(g, 0.5, 0, 0.5, 0.38, { tunic: C.blue, beard: C.white, hair: C.white });
  },

  harbor(g) {
    house(g, -0.4, 0, -0.3);
    house(g, 0.2, 0, -0.45, 1, 0.3);
    house(g, 0.65, 0, 0, 1, -0.2);
    for (const [x, z] of [[-0.5, 0.25], [-0.5, 0.6], [0, 0.25], [0, 0.6]]) g.box(x, 0, z, 0.05, 0.36, 0.05, C.woodD);
    g.box(-0.25, 0.36, 0.42, 0.62, 0.04, 0.46, C.wood); // the ship shed
    g.box(0.1, 0, 0.82, 1.3, 0.05, 0.16, C.stone);
  },

  chiron(g) {
    cave(g, -0.25, 0, -0.25, 0.5, 0.7, 11);
    const rot = -0.5;
    beast(g, 0.35, 0, 0.4, 0.5, { rot, body: C.wood, legH: 0.42, bodyH: 0.3, bodyW: 0.3, tail: C.dark, noHead: true });
    person(g, 0.35 + Math.cos(rot) * 0.2, 0.2, 0.4 - Math.sin(rot) * 0.2, 0.4, { tunic: C.skinD, hair: C.hair, beard: C.hair, rot: 0.9 });
    person(g, -0.15, 0, 0.62, 0.28, { tunic: C.cream, hair: C.gold, lyre: C.gold }); // a young Achilles at his lesson
  },

  troy(g, s, L) {
    const wall = rgb('#e2cf9f');
    g.cyl(0, 0, 0, 1.25, 1.1, 0.16, 10, C.earth, { top: rgb('#d9c79a') });
    wallRing(g, 0, 0.16, 0, 0.98, 0.42, 12, { col: wall, towers: 3, gate: Math.PI / 2, thick: 0.15 });
    g.box(0, 0.16, -0.2, 0.56, 0.2, 0.56, rgb('#d9c79a'));
    g.at(0, 0.36, -0.2, 0.2, 1, (q) => {
      q.box(0, 0, 0, 0.4, 0.28, 0.34, C.cream);
      q.gable(0, 0.28, 0, 0.46, 0.16, 0.4, C.terracotta, false, C.cream);
    });
    house(g, -0.52, 0.16, 0.2, 0.9, 0.3);
    house(g, 0.52, 0.16, 0.25, 0.9, -0.2);
    house(g, -0.48, 0.16, -0.5, 0.85, 0);
    house(g, 0.5, 0.16, -0.52, 0.85, 0.6);
    house(g, 0, 0.16, 0.52, 0.8, 0.1);
    g.at(-0.8, 0, 1.62, -0.45, 1, (q) => { // the horse, left on the plain
      q.box(0, 0.1, 0, 0.92, 0.06, 0.44, C.woodD);
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.2, 0.2]) q.box(sx, 0, sz, 0.18, 0.18, 0.06, C.dark);
      beast(q, 0, 0.16, 0, 0.8, { body: C.wood, legs: C.woodD, neck: 0.34, headUp: 0.75, snout: C.woodD, mane: C.woodD, tail: C.woodD, legH: 0.44, bodyH: 0.36, bodyW: 0.34 });
    });
    L.fx.puffs(L.group, { x: 0.2, y: 0.7, z: -0.1, color: '#5f5a66', n: 6, life: 6, rise: 2.6, size: 0.34, drift: [0.7, 0.1] });
    L.fx.flame(L.group, -0.5, 0.5, 0.2, 0.16);
    L.fx.flame(L.group, 0.5, 0.5, -0.5, 0.14);
  },

  symplegades(g, s, L) {
    const rocks = [-1, 1].map((side) => {
      const rg = new Geo();
      crag(rg, 0, -0.3, 0, 0.6, 2.2, side + 4);
      rg.blob(side * -0.1, 0.1, 0.25, 0.5, 0.35, 0.4, C.rock, { dark: C.rockD });
      return L.fx.mesh(L.group, rg, { shadow: true });
    });
    let struck = false;
    L.fx.tick((t) => {
      const c = t % 7;
      let gap; // 1 = fully open, 0 = shut
      if (c < 4.6) gap = 1;
      else if (c < 5.0) gap = 1 - ((c - 4.6) / 0.4) ** 2;
      else if (c < 5.4) gap = 0;
      else gap = Math.min(1, (c - 5.4) / 1.4);
      rocks[0].position.x = -(0.5 + gap * 0.85);
      rocks[1].position.x = 0.5 + gap * 0.85;
      if (c >= 5.0 && c < 5.4 && !struck) {
        struck = true;
        L.fx.splash(s.x, s.z + 0.3, 2.4);
        L.fx.splash(s.x, s.z + 0.3, 1.3);
      }
      if (c < 1) struck = false;
    });
  },

  colossus(g, s, L) {
    g.box(0, 0, 0, 0.6, 0.3, 0.6, C.marble, { top: C.marbleD });
    person(g, 0, 0.3, 0, 2.0, { tunic: C.bronze, skin: C.bronze, hair: C.bronzeD, legs: C.bronzeD, crown: C.gold, rightUp: true });
    g.box(0.48, 2.3, 0, 0.1, 0.22, 0.1, C.goldD);
    L.fx.flame(L.group, 0.48, 2.5, 0, 0.22);
    house(g, -0.7, 0, 0.5);
    house(g, 0.75, 0, 0.45, 1, 0.4);
    house(g, -0.6, 0, -0.6, 0.9, -0.3);
  },

  labyrinth(g, s, L) {
    const MAZE = [
      '#############', '#.....#.....#', '#.###.#.###.#', '#.#...#...#.#', '#.#.#####.#.#', '#.#.#...#.#.#',
      '#.#.#.#.#.#.#', '#...#.#...#.#', '###.#.#####.#', '#...#.......#', '#.#########.#', '#...........#', '######.######',
    ];
    const cell = 0.2, half = (MAZE.length * cell) / 2;
    const at = (r, c) => [c * cell - half + cell / 2, r * cell - half + cell / 2 + 0.25];
    g.box(0, 0, 0.25, MAZE.length * cell + 0.1, 0.04, MAZE.length * cell + 0.1, rgb('#e6d7b0'));
    for (let r = 0; r < MAZE.length; r++) {
      for (let c = 0; c < MAZE[r].length; c++) {
        if (MAZE[r][c] !== '#') continue;
        const [x, z] = at(r, c);
        g.box(x, 0.04, z, cell, 0.24, cell, (r + c) % 2 ? C.cream : rgb('#eadfc4'), { top: rgb('#d9c9a0') });
      }
    }
    // Ariadne's thread, from the gate towards the middle.
    const thread = [[12, 6], [11, 6], [11, 11], [9, 11], [9, 5], [8, 5]];
    for (let i = 0; i < thread.length - 1; i++) {
      const [x0, z0] = at(...thread[i]), [x1, z1] = at(...thread[i + 1]);
      g.box((x0 + x1) / 2, 0.04, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.04, 0.02, Math.abs(z1 - z0) + 0.04, C.red);
    }
    // Palace front with its red columns and horns of consecration.
    g.box(0, 0, -1.28, 2.1, 0.42, 0.34, C.cream, { top: rgb('#d9c9a0') });
    for (let i = 0; i < 6; i++) {
      g.cyl(-0.85 + i * 0.34, 0, -1.07, 0.04, 0.055, 0.36, 5, C.red);
      g.box(-0.92 + i * 0.34, 0.42, -1.28, 0.05, 0.12, 0.05, C.cream);
      g.box(-0.78 + i * 0.34, 0.42, -1.28, 0.05, 0.12, 0.05, C.cream);
    }
    g.box(0, 0.36, -1.07, 2.1, 0.06, 0.1, C.blue);
    const mg = new Geo();
    person(mg, 0, 0, 0, 0.34, { tunic: C.wood, skin: C.woodD, legs: C.woodD, hair: C.dark, horns: C.white });
    const mino = L.fx.mesh(L.group, mg, { shadow: true });
    const path = [[9, 5], [8, 5], [7, 5], [6, 5], [5, 5], [5, 6], [5, 7], [6, 7], [7, 7], [7, 8], [7, 9], [6, 9], [5, 9], [4, 9], [3, 9]];
    L.fx.tick((t) => {
      const n = path.length - 1;
      let u = (t * 0.9) % (2 * n);
      if (u > n) u = 2 * n - u;
      const i = Math.min(n - 1, Math.floor(u)), f = u - i;
      const [x0, z0] = at(...path[i]), [x1, z1] = at(...path[i + 1]);
      mino.position.set(x0 + (x1 - x0) * f, 0.04 + Math.abs(Math.sin(t * 7)) * 0.02, z0 + (z1 - z0) * f);
    });
  },

  chimera(g, s, L) {
    crag(g, -0.45, 0, -0.3, 0.4, 0.8, 9);
    L.fx.flame(L.group, -0.1, 0, -0.05, 0.2);
    const snake = rgb('#3fae6a');
    g.at(0.3, 0, 0.35, -0.9, 1, (q) => {
      lion(q, 0, 0, 0, 0, 0.6);
      q.box(-0.02, 0.36, 0, 0.12, 0.2, 0.12, C.stone); // the goat
      q.box(0.02, 0.56, 0, 0.16, 0.12, 0.14, C.stone);
      q.box(0.02, 0.68, -0.05, 0.03, 0.1, 0.03, C.woodD);
      q.box(0.02, 0.68, 0.05, 0.03, 0.1, 0.03, C.woodD);
      q.box(-0.34, 0.24, 0, 0.07, 0.34, 0.07, snake); // the snake
      q.box(-0.4, 0.56, 0, 0.16, 0.08, 0.1, snake);
    });
    L.fx.flame(L.group, 0.6, 0.26, 0.72, 0.13);
  },

  medusa(g) {
    cave(g, 0, 0, -0.3, 0.55, 0.75, 13, { col: rgb('#b9a98a'), dark: rgb('#93846a') });
    person(g, 0, 0, 0.35, 0.44, { tunic: rgb('#5d7f5a'), skin: rgb('#9fd08a'), hair: rgb('#2e8b57') });
    for (let i = 0; i < 5; i++) g.box(-0.12 + i * 0.06, 0.43, 0.33 + (i % 2) * 0.05, 0.03, 0.09 + (i % 2) * 0.04, 0.03, rgb('#3fae6a'));
    const st = { tunic: C.stone, skin: C.stone, hair: C.stoneD, legs: C.stoneD };
    person(g, -0.7, 0, 0.5, 0.4, { ...st, rot: 0.6, armsUp: true });
    person(g, 0.65, 0, 0.6, 0.4, { ...st, rot: -0.5, shield: C.stoneD });
    person(g, 0.85, 0, -0.1, 0.4, { ...st, rot: -1, rightUp: true });
    person(g, -0.9, 0, -0.1, 0.38, { ...st, rot: 1 });
    g.cyl(-0.35, 0, 0.82, 0.06, 0.06, 0.2, 5, C.marble);
  },

  orpheus(g, s, L) {
    g.blob(0, 0.1, 0, 0.26, 0.16, 0.22, C.rock, { dark: C.rockD });
    person(g, 0, 0.2, 0, 0.4, { tunic: C.white, lyre: C.gold, hair: C.wood });
    beast(g, -0.62, 0, 0.3, 0.34, { rot: -0.3, body: rgb('#c98f55'), horns: C.woodD, neck: 0.2, legH: 0.4, bodyH: 0.28, bodyW: 0.26 });
    beast(g, 0.62, 0, 0.35, 0.32, { rot: Math.PI + 0.3, body: C.stoneD, ears: true, tail: C.stoneD });
    sheep(g, 0.1, 0, 0.7, SOUTH + Math.PI, 0.24);
    L.tree('oak', -0.8, -0.45, 1.1);
    L.tree('oak', 0.8, -0.5, 1.2);
    L.fx.glyphs(L.group, { glyph: 'note', color: '#ffe9a0', n: 4, x: 0.1, y: 0.6, rise: 1.3, spread: 0.3, life: 3.4 });
  },

  homer(g, s, L) {
    L.tree('olive', -0.3, -0.2, 1.3);
    g.blob(0.1, 0.08, 0.1, 0.2, 0.13, 0.18, C.rock, { dark: C.rockD });
    person(g, 0.1, 0.16, 0.1, 0.38, { tunic: rgb('#7d8fb5'), hair: C.white, beard: C.white, lyre: C.wood });
    L.fx.glyphs(L.group, { glyph: 'note', color: '#ffffff', n: 2, x: 0.2, y: 0.55, rise: 1.0, spread: 0.15, life: 4 });
  },

  // --------------------------------------------------------------- odyssey --
  ismarus(g) {
    wallRing(g, 0, 0, 0, 0.62, 0.26, 9, { col: C.stone, gate: Math.PI / 2 });
    house(g, -0.2, 0, -0.15);
    house(g, 0.22, 0, -0.05, 0.9, 0.4);
    house(g, 0, 0, 0.25, 0.85, -0.2);
    for (let i = 0; i < 5; i++) g.cyl(-0.5 + i * 0.2, 0, 0.92, 0.05, 0.08, 0.18, 5, C.terracotta, { top: C.dark });
  },

  storm(g, s, L) {
    const cg = new Geo();
    cloud(cg, 5, { top: rgb('#77728a'), under: rgb('#4a465c') });
    cloud(cg, 8, { top: rgb('#676279'), under: rgb('#423e54') });
    const m = L.fx.mesh(L.group, cg, { shadow: true });
    m.position.y = 3.4;
    const bolt = L.fx.lightning(L.group, { color: '#fffbd0' });
    let next = 2;
    L.fx.tick((t) => {
      m.position.x = Math.sin(t * 0.2) * 0.5;
      if (t > next) {
        const x = (Math.random() - 0.5) * 2.4, z = (Math.random() - 0.3) * 1.6;
        bolt([x * 0.5, 3.3, z * 0.3], [x, 0, z], 0.06);
        L.fx.splash(s.x + x * S, s.z + z * S, 0.5);
        next = t + 1.8 + Math.random() * 3.5;
      }
    });
    L.fx.glyphs(L.group, { glyph: 'gust', color: '#e8f4ff', n: 4, y: 0.6, rise: 0.3, spread: 1.2, life: 2.2, drift: [-1.6, 0.8] });
  },

  lotus(g, s, L) {
    const bloom = (x, z, k) => {
      g.box(x, 0, z, 0.05 * k, 0.3 * k, 0.05 * k, C.greenD);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.blob(x + Math.cos(a) * 0.14 * k, 0.36 * k, z + Math.sin(a) * 0.14 * k, 0.11 * k, 0.07 * k, 0.11 * k, i % 2 ? C.pink : rgb('#ffc7dd'));
      }
      g.blob(x, 0.4 * k, z, 0.08 * k, 0.07 * k, 0.08 * k, C.gold);
    };
    bloom(-0.5, 0.2, 1.5);
    bloom(0.1, -0.45, 1.3);
    bloom(0.65, 0.3, 1.6);
    bloom(-0.1, 0.65, 1.1);
    bloom(0.85, -0.4, 1.0);
    L.tree('palm', -0.95, -0.4, 1.5);
    L.tree('palm', 0.4, 0.9, 1.3);
    L.tree('palm', 1.05, 0.05, 1.4);
    const sleeper = (x, z, rot, col) => g.at(x, 0, z, rot, 1, (q) => {
      q.box(0, 0, 0, 0.34, 0.1, 0.14, col);
      q.box(0.22, 0, 0, 0.1, 0.1, 0.1, C.skin);
    });
    sleeper(-0.2, 0.15, 0.3, C.cream);
    sleeper(0.38, -0.05, -0.4, C.red);
    sleeper(0.25, 0.52, 1.2, C.blue);
    L.fx.glyphs(L.group, { glyph: 'zed', color: '#ffffff', n: 3, y: 0.3, rise: 1.0, spread: 0.35, life: 3.6 });
  },

  cyclops(g, s, L) {
    cave(g, -0.55, 0, -0.5, 0.8, 1.25, 17);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      g.box(0.8 + Math.cos(a) * 0.45, 0, 0.6 + Math.sin(a) * 0.38, 0.12, 0.1, 0.08, C.stoneD);
    }
    sheep(g, 0.65, 0, 0.55, 0.4);
    sheep(g, 0.95, 0, 0.7, 2.2);
    sheep(g, 0.85, 0, 0.42, -1);
    sheep(g, 1.05, 0, 0.5, 1.2);
    const skin = rgb('#d9a273'), k = 1.5;
    const pg = new Geo();
    person(pg, 0, 0, 0, k, { tunic: rgb('#8a6a48'), legs: rgb('#c98f66'), skin, hair: C.dark, eye: true, noArms: true });
    pg.box(-0.24 * k, 0.36 * k, 0, 0.1 * k, 0.34 * k, 0.12 * k, skin);
    const body = L.fx.mesh(L.group, pg, { shadow: true });
    body.position.set(0.15, 0, 0.1);
    const arm = new THREE.Group();
    arm.position.set(0.24 * k, 0.7 * k, 0);
    body.add(arm);
    const ag = new Geo().box(0, -0.34 * k, 0, 0.1 * k, 0.34 * k, 0.12 * k, skin);
    L.fx.mesh(arm, ag, { shadow: true });
    const rockGeo = new Geo().blob(0, 0, 0, 0.26, 0.22, 0.24, C.rockD, { dark: rgb('#5a546e') }).build();
    const held = L.fx.mesh(arm, rockGeo, { shadow: true });
    held.position.y = -0.4 * k;
    const flying = L.fx.mesh(L.scene, rockGeo, { shadow: true });
    flying.visible = false;
    flying.scale.setScalar(S);
    // Throw towards the nearest open water.
    const sea = L.findSea(s.x, s.z, 5, 9, 1.2);
    const dir = Math.atan2(sea[0] - s.x, sea[1] - s.z);
    body.rotation.y = dir;
    const from = new THREE.Vector3();
    let thrown = false;
    L.fx.tick((t) => {
      const c = t % 9;
      if (c < 4.5) { arm.rotation.x = 0; held.visible = c > 2.5; thrown = false; }
      else if (c < 5.8) { arm.rotation.x = -3.0 * ((c - 4.5) / 1.3); held.visible = true; } // wind up overhead
      else if (c < 6.1) { arm.rotation.x = -3.0 + 2.2 * ((c - 5.8) / 0.3); held.visible = true; } // hurl
      else {
        arm.rotation.x = -0.8 * Math.max(0, 1 - (c - 6.1) / 1.5);
        if (!thrown) {
          thrown = true;
          held.getWorldPosition(from);
        }
        held.visible = false;
      }
      const u = (c - 6.1) / 1.5;
      flying.visible = u >= 0 && u < 1;
      if (flying.visible) {
        flying.position.set(from.x + (sea[0] - from.x) * u, from.y * (1 - u) + 5 * u * (1 - u), from.z + (sea[1] - from.z) * u);
        flying.rotation.set(u * 9, u * 5, 0);
      } else if (thrown && u >= 1 && u < 1.1 && !flying.userData.done) {
        flying.userData.done = true;
        L.fx.splash(sea[0], sea[1], 1.6);
        L.fx.splash(sea[0], sea[1], 0.9);
      }
      if (c < 1) flying.userData.done = false;
    });
  },

  aeolia(g, s, L) {
    const ig = new Geo();
    ig.cyl(0, -0.5, 0, 0.75, 0.95, 0.75, 9, C.rock, { top: C.leaf });
    for (let i = 0; i < 12; i++) { // the wall of bronze
      const a = (i / 12) * TAU;
      ig.at(Math.cos(a) * 0.86, 0.25, Math.sin(a) * 0.86, -a, 1, (q) => q.box(0, 0, 0, 0.1, 0.22, 0.48, C.bronze, { top: C.gold }));
    }
    temple(ig, 0, 0.25, -0.05, 0.4, 0.55, 0.3, { roof: C.bronze });
    ig.add(L.T.olive, -0.45, 0.25, 0.35, 0, 0.8);
    ig.add(L.T.olive, 0.5, 0.25, 0.3, 1, 0.7);
    const m = L.fx.mesh(L.group, ig, { shadow: true });
    L.fx.tick((t) => {
      m.position.y = 0.14 + Math.sin(t * 0.8) * 0.07;
      m.rotation.y = Math.sin(t * 0.15) * 0.2;
    });
    L.fx.glyphs(L.group, { glyph: 'gust', color: '#ffffff', n: 5, y: 0.9, rise: 0.5, spread: 1.3, life: 2.6, drift: [1.4, -0.3] });
  },

  giants(g) {
    crag(g, -0.7, 0, -0.2, 0.5, 1.1, 21);
    crag(g, 0.75, 0, -0.1, 0.48, 1.0, 22);
    const gi = { tunic: rgb('#7a6248'), skin: rgb('#c9a27a'), hair: C.dark, armsUp: true };
    person(g, -0.7, 0.72, -0.2, 1.0, { ...gi, rot: 0.5 });
    g.blob(-0.7, 2.0, -0.2, 0.26, 0.2, 0.24, C.rockD);
    person(g, 0.75, 0.66, -0.1, 0.95, { ...gi, rot: -0.4 });
    g.blob(0.75, 1.88, -0.1, 0.24, 0.2, 0.24, C.rockD);
    g.box(0.05, 0, 0.7, 0.5, 0.08, 0.16, C.woodD); // what is left of a ship
    g.box(-0.1, 0, 0.75, 0.04, 0.4, 0.04, C.woodD);
    g.box(0.3, 0.02, 0.55, 0.3, 0.04, 0.1, C.wood);
  },

  circe(g, s, L) {
    g.box(0, 0, -0.2, 0.8, 0.36, 0.6, C.stone, { top: C.stoneD });
    g.gable(0, 0.36, -0.2, 0.9, 0.3, 0.7, C.purple, false, C.stone);
    g.box(0.3, 0.36, -0.4, 0.14, 0.42, 0.14, C.stoneD);
    L.fx.mesh(L.group, new Geo().box(0, 0, 0.11, 0.2, 0.26, 0.02, rgb('#ff9cf0')), { glow: true }); // a lit doorway
    L.fx.puffs(L.group, { x: 0.3, y: 0.85, z: -0.4, color: '#b06be0', n: 5, life: 4.5, rise: 1.8, size: 0.22, drift: [0.4, 0] });
    person(g, -0.38, 0, 0.42, 0.42, { tunic: C.purple, hair: C.dark, rightUp: true });
    g.box(-0.28, 0.42, 0.42, 0.03, 0.16, 0.03, C.gold); // her wand
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.95 + i * 0.5;
      L.tree('cypress', Math.cos(a) * 1.1, Math.sin(a) * 0.95 - 0.15, 1.2);
    }
    for (let i = 0; i < 4; i++) {
      const pg = new Geo();
      pig(pg, 0, 0, 0, 0, 0.26);
      wander(L, pg, { x: 0.4 + (i % 2) * 0.42, z: 0.55 + (i >> 1) * 0.32, r: 0.14, speed: 0.5 + i * 0.13, ph: i * 1.7, step: 9 });
    }
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#e9b0ff', n: 3, x: -0.28, y: 0.6, z: 0.42, rise: 0.6, spread: 0.15, life: 2.2 });
  },

  underworld(g, s, L) {
    g.cyl(0, 0, 0, 0.6, 0.55, 0.03, 9, rgb('#1c1530'), { top: rgb('#120d22') });
    const dead = (x, z, h) => {
      g.box(x, 0, z, 0.06, h, 0.06, C.dark);
      g.box(x + 0.08, h * 0.6, z, 0.16, 0.04, 0.04, C.dark);
      g.box(x - 0.07, h * 0.8, z, 0.14, 0.04, 0.04, C.dark);
    };
    dead(-0.8, -0.3, 0.6);
    dead(0.8, -0.4, 0.7);
    dead(0.9, 0.4, 0.5);
    dead(-0.9, 0.45, 0.55);
    g.box(-0.1, 0, 0.8, 0.34, 0.02, 0.12, rgb('#7a1420')); // the trench of blood
    person(g, -0.45, 0, 0.88, 0.36, { tunic: C.red, crest: C.red, hair: C.bronze, spear: true });
    for (let i = 0; i < 5; i++) {
      const gg = new Geo().cyl(0, 0, 0, 0.13, 0.1, 0.3, 5, C.ghost).blob(0, 0.38, 0, 0.11, 0.11, 0.11, C.white);
      const m = L.fx.mesh(L.group, gg, { glow: true });
      L.fx.tick((t) => {
        const a = t * 0.25 + i * 1.26, r = 0.42 + 0.12 * Math.sin(t * 0.5 + i);
        m.position.set(Math.cos(a) * r, 0.22 + Math.sin(t * 1.2 + i) * 0.08, Math.sin(a) * r * 0.8);
      });
    }
    L.fx.puffs(L.group, { x: 0, y: 0.05, z: 0, color: '#7fe0b0', n: 4, life: 6, rise: 1.2, size: 0.3, drift: [0.2, 0.1], wobble: 0.3 });
  },

  sirens(g, s, L) {
    crag(g, -0.25, 0, 0, 0.3, 0.7, 31);
    crag(g, 0.3, 0, 0.1, 0.26, 0.5, 32);
    g.blob(0, 0.06, 0.32, 0.3, 0.1, 0.2, C.rock, { dark: C.rockD });
    const sw = { tunic: rgb('#c9b08a'), wings: rgb('#a8763f'), hair: C.gold, noArms: true };
    person(g, -0.25, 0.44, 0, 0.34, sw);
    person(g, 0.3, 0.32, 0.1, 0.32, { ...sw, hair: C.crimson });
    person(g, 0.02, 0.14, 0.34, 0.3, { ...sw, hair: C.dark });
    g.box(0.3, 0, 0.44, 0.14, 0.03, 0.03, C.white);
    g.box(-0.36, 0, 0.42, 0.03, 0.03, 0.12, C.white);
    L.fx.glyphs(L.group, { glyph: 'note', color: '#ffd86b', n: 6, y: 0.7, rise: 1.8, spread: 0.6, life: 3.6 });
  },

  scylla(g, s, L) {
    // Scylla's cliff on the mainland side, Charybdis in the channel below it.
    const sx = 1.0, sz = -0.25;
    crag(g, sx, -0.3, sz, 0.6, 2.0, 41, rgb('#857e9b'), rgb('#635c7c'));
    g.box(sx - 0.25, 0.5, sz + 0.34, 0.34, 0.34, 0.2, C.night);
    necks(L, {
      n: 6, x: sx - 0.25, y: 0.62, z: sz + 0.36, segs: 5, seg: 0.16, thick: 0.1, fanX: 0.1, fanZ: 0.3,
      col: rgb('#7fa08a'), col2: rgb('#5f8470'), jaw: C.white, eye: C.red, leanZ: 0.75, splay: 0.9, leanX: 0.35, sway: 0.2,
    });
    const wg = new Geo();
    const foam = rgb('#f6fcf7'), deep = rgb('#2d5fa8'), mid = rgb('#56b0d8');
    const rings = [0.12, 0.3, 0.48, 0.66, 0.84];
    for (let k = 0; k < rings.length - 1; k++) {
      for (let j = 0; j < 14; j++) {
        const a0 = (j / 14) * TAU, a1 = ((j + 1) / 14) * TAU;
        const p = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
        const band = (j + k * 3) % 7;
        wg.quad(p(a0, rings[k + 1]), p(a0, rings[k]), p(a1, rings[k]), p(a1, rings[k + 1]), band < 2 ? foam : band < 4 ? mid : deep);
      }
    }
    wg.cyl(0, -0.01, 0, 0.12, 0.12, 0.01, 7, rgb('#1b3a78'));
    const whirl = L.fx.mesh(L.group, wg, { glow: true });
    whirl.position.set(-0.25, 0.035, 0.55);
    L.fx.tick((t) => {
      whirl.rotation.y = -t * 1.7;
      whirl.scale.setScalar(1 + 0.08 * Math.sin(t * 0.7));
    });
  },

  cattle(g, s, L) {
    g.box(-0.7, 0, -0.55, 0.2, 0.5, 0.2, C.marble);
    disc(g, -0.7, 0.78, -0.55, 0.27, C.gold, 10);
    person(g, 0.75, 0, -0.55, 0.38, { tunic: C.gold, hair: C.gold });
    const spots = [[-0.3, 0.1], [0.3, -0.1], [0.75, 0.35], [-0.65, 0.6], [0.1, 0.7], [-0.15, -0.45]];
    spots.forEach(([x, z], i) => {
      const cg = new Geo();
      cow(cg, 0, 0, 0, 0, 0.42, i % 3 === 2 ? C.cream : C.gold);
      const m = L.fx.mesh(L.group, cg, { shadow: true });
      L.fx.tick((t) => {
        m.position.set(x + Math.sin(t * 0.13 + i * 2) * 0.1, 0, z + Math.cos(t * 0.11 + i) * 0.08);
        m.rotation.y = i * 1.3 + Math.sin(t * 0.2 + i) * 0.5;
      });
    });
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#fff0a0', n: 3, x: -0.7, y: 0.95, z: -0.55, rise: 0.5, spread: 0.2, life: 2.8 });
  },

  calypso(g) {
    cave(g, -0.1, 0, -0.25, 0.5, 0.7, 51, { col: rgb('#a59fb3') });
    g.blob(-0.42, 0.5, 0.05, 0.2, 0.12, 0.16, C.green, { dark: C.greenD });
    g.blob(0.26, 0.55, 0, 0.18, 0.12, 0.16, C.green, { dark: C.greenD });
    for (let i = 0; i < 6; i++) g.blob(Math.cos(i * 1.05) * 0.62, 0.05, 0.2 + Math.sin(i * 1.05) * 0.4, 0.05, 0.05, 0.05, i % 2 ? C.pink : C.white);
    person(g, 0.32, 0, 0.42, 0.4, { tunic: C.teal, hair: C.gold });
    g.at(-0.5, 0, 0.72, 0.4, 1, (q) => { // the raft
      for (let i = 0; i < 4; i++) q.box(-0.15 + i * 0.1, 0, 0, 0.09, 0.05, 0.4, i % 2 ? C.wood : C.woodD);
      q.box(0, 0.05, 0, 0.03, 0.34, 0.03, C.woodD);
      q.sheet([0.02, 0.36, -0.12], [0.02, 0.36, 0.12], [0.02, 0.14, 0.12], [0.02, 0.14, -0.12], C.sail);
    });
  },

  scheria(g, s, L) {
    const wall = rgb('#f0d98a');
    g.box(0, 0, -0.2, 0.9, 0.4, 0.6, wall, { top: C.gold });
    g.box(0, 0.4, -0.2, 0.6, 0.14, 0.4, wall, { top: C.gold });
    g.box(0, 0, 0.11, 0.22, 0.28, 0.02, C.blue);
    g.box(0, 0.33, 0.105, 0.9, 0.05, 0.02, C.blue);
    beast(g, -0.28, 0, 0.3, 0.22, { rot: SOUTH, body: C.gold, ears: true }); // the golden dogs at the door
    beast(g, 0.28, 0, 0.3, 0.22, { rot: SOUTH, body: C.gold, ears: true });
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) L.tree('olive', 0.75 + r * 0.28, -0.5 + i * 0.28, 0.7);
    person(g, -0.6, 0, 0.5, 0.36, { tunic: C.white, hair: C.wood, rightUp: true });
    g.blob(-0.52, 0.44, 0.5, 0.05, 0.05, 0.05, C.red); // Nausicaa's ball
  },

  ithaca(g, s, L) {
    g.box(0, 0, -0.2, 0.6, 0.28, 0.44, C.cream);
    g.gable(0, 0.28, -0.2, 0.68, 0.2, 0.5, C.terracotta, false, C.cream);
    g.box(0, 0, 0.03, 0.12, 0.18, 0.02, C.woodD);
    L.tree('olive', 0.5, -0.1, 1.5); // the olive tree the marriage bed is carved from
    g.box(-0.5, 0, 0.3, 0.04, 0.36, 0.04, C.woodD); // Penelope's loom
    g.box(-0.24, 0, 0.3, 0.04, 0.36, 0.04, C.woodD);
    g.box(-0.37, 0.34, 0.3, 0.3, 0.04, 0.04, C.woodD);
    g.sheet([-0.48, 0.32, 0.3], [-0.26, 0.32, 0.3], [-0.26, 0.12, 0.3], [-0.48, 0.12, 0.3], rgb('#b9a0d9'));
    person(g, -0.37, 0, 0.45, 0.34, { tunic: C.blue, hair: C.dark });
    beast(g, 0.2, 0, 0.42, 0.2, { rot: -1.2, body: C.wood, ears: true, tail: C.woodD }); // Argos, the old dog
    for (let i = 0; i < 6; i++) { // the axes he will shoot through
      g.box(0.05 + i * 0.07, 0, 0.64, 0.02, 0.14, 0.02, C.woodD);
      g.box(0.05 + i * 0.07, 0.14, 0.64, 0.05, 0.05, 0.02, C.bronze);
    }
  },
};

export function buildLandmarks(grid, sites, fx, scene) {
  const T = makeTemplates();
  const geo = new Geo(65536);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // Nearest open water around a point, searched outwards starting near `prefer` (radians, 0 = south).
  const findSea = (x, z, r0, r1, prefer = 0) => {
    for (let r = r0; r <= r1; r += 0.5) {
      for (let i = 0; i < 16; i++) {
        const a = prefer + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (!grid.landAt(px, pz) && !grid.landAt(px + 0.6, pz) && !grid.landAt(px - 0.6, pz) && !grid.landAt(px, pz + 0.6)) return [px, pz];
      }
    }
    return [x + r1, z];
  };

  for (const s of sites) {
    const fn = MODELS[s.model];
    if (!fn) continue;
    const group = new THREE.Group();
    group.position.set(s.x, s.y, s.z);
    group.scale.setScalar(S);
    scene.add(group);
    geo.at(s.x, s.y, s.z, 0, S, (g) => {
      const L = {
        fx, group, scene, grid, T, findSea,
        tree: (name, x, z, scale = 1, y = 0) => g.add(T[name], x, y, z, (x * 7 + z * 13) % 6.28, scale),
      };
      fn(g, s, L);
    });
  }
  const mesh = new THREE.Mesh(geo.build(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, material };
}
