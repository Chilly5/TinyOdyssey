// Small models for the minor places: the ones whose names only appear once you
// have zoomed in. Each is a few solids, built like the landmarks in landmarks.js
// (x east, z south towards the viewer, y up; one unit is MODEL_PX pixels).

import { rgb } from './kit.js';
import { C, temple, person, beast, cave, crag, house, sheep, cow, horse } from './models.js';

const TAU = Math.PI * 2;
const boar = (g, x, y, z, rot, s = 0.34) =>
  beast(g, x, y, z, s, { rot, body: rgb('#5a4638'), snout: rgb('#3a2c24'), mane: rgb('#3a2c24'), legH: 0.2, bodyH: 0.36, bodyW: 0.36, tail: rgb('#3a2c24') });
const wolf = (g, x, y, z, rot, s = 0.3) =>
  beast(g, x, y, z, s, { rot, body: rgb('#8a8794'), snout: rgb('#5c5966'), ears: true, tailUp: rgb('#6f6c78'), legH: 0.3, bodyH: 0.26, bodyW: 0.26 });
const altar = (g, x, z, s = 1) => {
  g.box(x, 0, z, 0.3 * s, 0.05, 0.22 * s, C.step);
  g.box(x, 0.05, z, 0.22 * s, 0.12 * s, 0.15 * s, C.marble);
};
const pool = (g, x, z, r, col = C.water) => {
  g.cyl(x, 0, z, r + 0.05, r + 0.05, 0.04, 9, C.stone, { top: C.stoneD });
  g.cyl(x, 0.02, z, r, r, 0.03, 9, col, { top: col });
};
const tent = (g, x, z, col, s = 1) => {
  g.pyramid(x, 0, z, 0.3 * s, 0.26 * s, 0.28 * s, col);
  g.box(x, 0, z + 0.141 * s, 0.07 * s, 0.13 * s, 0.01, C.dark);
};
const column = (g, x, z, h, broken = false) => {
  g.box(x, 0, z, 0.11, 0.04, 0.11, C.step);
  g.cyl(x, 0.04, z, 0.04, 0.034, h, 6, C.marble);
  if (!broken) g.box(x, 0.04 + h, z, 0.1, 0.03, 0.1, C.marble);
};

export const MINOR = {
  // A small temple with an altar before it.
  m_shrine(g, s, L) {
    const big = s.big ? 1.3 : 1;
    g.at(0, 0, -0.1, s.turn ?? 0.3, big, (q) => temple(q, 0, 0, 0, 0.3, 0.44, 0.22, s.roof ? { roof: rgb(s.roof) } : {}));
    altar(g, 0.3 * big, 0.36 * big);
    if (s.fire) L.fx.flame(L.group, 0.3 * big, 0.17, 0.36 * big, 0.1);
    if (s.tree) L.tree(s.tree, -0.42, 0.3, 0.9);
  },

  // A beehive tomb or a burial mound.
  m_tomb(g, s) {
    if (s.mound) {
      g.blob(0, 0.02, 0, 0.42, 0.24, 0.36, rgb('#9aa85a'), { dark: rgb('#75843f') });
      g.box(0, 0, 0.36, 0.1, 0.34, 0.04, C.marble); // the grave marker
      g.box(0, 0.34, 0.36, 0.14, 0.04, 0.05, C.marbleD);
    } else {
      g.cyl(0, 0, 0, 0.36, 0.3, 0.14, 9, C.stoneD, { top: C.stone });
      g.blob(0, 0.14, 0, 0.3, 0.26, 0.3, C.stone, { dark: C.stoneD });
      g.box(0, 0, 0.3, 0.14, 0.2, 0.1, C.stoneD);
      g.box(0, 0, 0.36, 0.07, 0.15, 0.02, C.night);
    }
  },

  // Water rising from the ground: a spring with its basin.
  m_spring(g, s, L) {
    crag(g, 0, 0, -0.16, 0.2, 0.3, 3);
    pool(g, 0.02, 0.2, 0.2, s.hot ? rgb('#8fd8d0') : C.water);
    g.box(0, 0.1, 0.02, 0.04, 0.12, 0.05, rgb('#c8f0ff'));
    if (s.hot) L.fx.puffs(L.group, { x: 0.02, y: 0.06, z: 0.2, color: '#f2fbff', n: 4, life: 3.4, rise: 0.9, size: 0.14, drift: [0.15, 0] });
    if (s.who === 'nymphs') {
      person(g, -0.3, 0, 0.3, 0.22, { tunic: rgb('#bfe3ff'), hair: C.gold });
      person(g, 0.32, 0, 0.34, 0.22, { tunic: rgb('#c8f0c0'), hair: C.wood, rightUp: true });
    } else if (s.who === 'frogs') {
      for (let i = 0; i < 4; i++) g.blob(Math.cos(i * 1.7) * 0.27, 0.05, 0.2 + Math.sin(i * 1.7) * 0.2, 0.035, 0.03, 0.04, rgb('#5aa843'));
      person(g, 0.34, 0, -0.02, 0.24, { tunic: C.white, hair: C.gold, crown: C.gold });
    } else if (s.who === 'healer') {
      column(g, -0.3, 0.02, 0.24);
      column(g, 0.3, 0.02, 0.24);
      person(g, 0.3, 0, 0.36, 0.22, { tunic: C.white, beard: C.hair, spear: C.wood });
    } else if (s.who === 'horse') {
      horse(g, -0.36, 0, 0.3, 0.5, 0.34, { body: C.white, wings: C.cream });
    }
    if (s.tree) L.tree(s.tree, 0.36, -0.2, 0.8);
  },

  // A sacred grove: trees round a clearing.
  m_grove(g, s, L) {
    const kind = s.tree || 'oak';
    for (let i = 0; i < 6; i++) {
      const a = 0.4 + (i / 6) * TAU;
      L.tree(kind, Math.cos(a) * 0.4, Math.sin(a) * 0.3 - 0.06, 0.8 + (i % 3) * 0.14);
    }
    altar(g, 0, 0.12, 0.8);
    if (s.who === 'muses') {
      for (let i = 0; i < 3; i++) person(g, -0.2 + i * 0.2, 0, 0.36 + (i % 2) * 0.06, 0.2, { tunic: [C.white, C.pink, rgb('#bfe3ff')][i], hair: [C.gold, C.dark, C.wood][i], rightUp: i === 1, lyre: i === 1 ? C.gold : null });
      L.fx.glyphs(L.group, { glyph: 'note', color: '#fff2b0', n: 3, y: 0.3, z: 0.4, rise: 0.8, spread: 0.2, life: 3 });
    } else if (s.who === 'bull') {
      cow(g, -0.14, 0, 0.42, 0.2, 0.34, C.white);
      person(g, 0.22, 0, 0.4, 0.2, { tunic: C.purple, hair: C.gold });
    } else if (s.who === 'laurel') {
      person(g, 0.2, 0, 0.36, 0.22, { tunic: C.gold, hair: C.gold, lyre: C.goldD });
    }
  },

  // A cave mouth in a rock.
  m_cave(g, s, L) {
    cave(g, 0, 0, -0.06, 0.34, 0.5, s.seed || 4, s.dark ? { col: rgb('#6b6478'), dark: rgb('#4c4660'), mouth: rgb('#0e0a18') } : {});
    if (s.who === 'sleeper') {
      g.box(0.02, 0, 0.32, 0.3, 0.06, 0.13, C.cream);
      g.box(0.14, 0.06, 0.32, 0.08, 0.07, 0.1, C.skin);
      L.fx.glyphs(L.group, { glyph: 'zed', color: '#dfe6ff', n: 2, x: 0.16, y: 0.16, z: 0.32, rise: 0.6, spread: 0.05, life: 3.4 });
    } else if (s.who === 'ghosts') {
      L.fx.flame(L.group, -0.26, 0, 0.26, 0.09, { outer: rgb('#2fbf71') });
      L.fx.puffs(L.group, { x: 0, y: 0.1, z: 0.2, color: '#9fe8c0', n: 3, life: 4, rise: 0.8, size: 0.12, drift: [0.1, 0] });
    } else if (s.who === 'goat') {
      beast(g, 0.3, 0, 0.34, 0.22, { rot: 2.6, body: C.white, horns: C.stoneD });
      g.box(-0.06, 0, 0.3, 0.1, 0.06, 0.08, C.gold);
    }
  },

  // A watch-fire on a height.
  m_beacon(g, s, L) {
    crag(g, 0, 0, 0, 0.24, 0.34, s.seed || 2);
    g.cyl(0, 0.2, 0, 0.12, 0.1, 0.06, 7, C.stoneD, { top: C.dark });
    for (let i = 0; i < 3; i++) g.box(Math.cos(i * 2.1) * 0.05, 0.26, Math.sin(i * 2.1) * 0.05, 0.03, 0.1, 0.03, C.woodD);
    L.fx.flame(L.group, 0, 0.28, 0, 0.2);
    L.fx.puffs(L.group, { x: 0, y: 0.5, z: 0, color: '#6d6878', n: 4, life: 4, rise: 1.4, size: 0.14, drift: [0.4, 0] });
    if (s.who === 'wreck') { // a hull broken on the rocks below
      g.box(0.34, 0, 0.3, 0.3, 0.06, 0.1, C.woodD);
      g.box(0.26, 0.06, 0.3, 0.03, 0.2, 0.03, C.woodD);
      g.box(0.44, 0.02, 0.36, 0.1, 0.03, 0.05, C.wood);
    }
  },

  // An army's camp: tents, shields, a fire.
  m_camp(g, s, L) {
    const cols = [C.cream, rgb('#e9d7a8'), C.cream, rgb('#d8c79a')];
    for (let i = 0; i < 4; i++) tent(g, -0.36 + i * 0.24, -0.16 + (i % 2) * 0.1, cols[i], 0.9);
    tent(g, 0.02, 0.2, s.chief ? rgb(s.chief) : C.crimson, 1.15);
    L.fx.flame(L.group, -0.3, 0, 0.3, 0.09);
    person(g, 0.32, 0, 0.32, 0.22, { tunic: C.bronze, crest: C.red, hair: C.bronzeD, shield: C.bronze, spear: true });
    person(g, -0.14, 0, 0.42, 0.2, { tunic: C.cream });
    for (let i = 0; i < 3; i++) g.box(0.46, 0, -0.1 + i * 0.09, 0.03, 0.26, 0.03, C.woodD); // stacked spears
  },

  // An animal out of a story, and whoever came after it.
  m_beast(g, s, L) {
    if (s.who === 'boar') {
      crag(g, -0.26, 0, -0.14, 0.18, 0.26, 6);
      boar(g, 0, 0, 0.06, 0.2, 0.4);
      person(g, 0.4, 0, 0.2, 0.22, { tunic: rgb('#8fae5a'), hair: C.gold, spear: true, rot: -1.2 });
      if (s.many) person(g, 0.3, 0, 0.44, 0.22, { tunic: C.crimson, hair: C.dark, spear: true, rot: -1.6 });
    } else if (s.who === 'mares') {
      for (let i = 0; i < 4; i++) horse(g, -0.3 + (i % 2) * 0.42, 0, -0.12 + (i >> 1) * 0.36, 0.3 + i, 0.36, { body: [C.dark, C.woodD, rgb('#3a3040'), C.wood][i] });
      g.box(0.05, 0, -0.32, 0.9, 0.1, 0.04, C.woodD); // the manger
    } else if (s.who === 'cattle') {
      g.box(0, 0, -0.26, 0.92, 0.2, 0.2, C.cream, { top: C.terracotta }); // the stables
      for (let i = 0; i < 4; i++) g.box(-0.33 + i * 0.22, 0, -0.155, 0.1, 0.14, 0.01, C.night);
      for (let i = 0; i < 4; i++) cow(g, -0.32 + i * 0.22, 0, 0.1 + (i % 2) * 0.16, 0.6 + i * 1.3, 0.26, [C.white, C.gold, rgb('#8a5a3a'), C.cream][i]);
      g.box(0, 0, 0.42, 0.95, 0.03, 0.1, C.water); // the river let in
    } else if (s.who === 'wolf') {
      altar(g, -0.1, -0.05, 1.1);
      L.fx.flame(L.group, -0.1, 0.19, -0.05, 0.12);
      wolf(g, 0.28, 0, 0.26, 2.7, 0.32);
      person(g, -0.36, 0, 0.26, 0.22, { tunic: C.purple, crown: C.gold, beard: C.hair });
    } else if (s.who === 'harpies') {
      g.box(0, 0, 0.1, 0.4, 0.12, 0.2, C.wood); // the spoiled table
      for (let i = 0; i < 3; i++) g.blob(-0.12 + i * 0.12, 0.14, 0.1, 0.04, 0.03, 0.04, [C.red, C.gold, C.leaf][i]);
      person(g, 0, 0, -0.12, 0.22, { tunic: C.cream, beard: C.white, hair: C.white });
      person(g, -0.36, 0.42, 0.0, 0.2, { tunic: rgb('#7a6a8a'), wings: rgb('#4c4660'), hair: C.dark });
      person(g, 0.36, 0.5, 0.16, 0.2, { tunic: rgb('#7a6a8a'), wings: rgb('#4c4660'), hair: C.dark });
    }
  },

  // A statue on a tall base.
  m_statue(g, s) {
    g.box(0, 0, 0, 0.34, 0.06, 0.34, C.step);
    g.box(0, 0.06, 0, 0.24, 0.2, 0.24, C.marble);
    if (s.who === 'victory') {
      person(g, 0, 0.26, 0, 0.44, { tunic: C.marble, skin: C.marble, hair: null, wings: C.marbleD, noArms: true });
      g.box(0.3, 0, 0.3, 0.2, 0.1, 0.1, C.stoneD); // the ship's prow she stands over
    } else if (s.who === 'dolphin') {
      g.blob(0, 0.36, 0, 0.2, 0.09, 0.09, rgb('#5a8ab8'), { dark: rgb('#3d5a80') });
      g.box(-0.2, 0.4, 0, 0.06, 0.12, 0.04, rgb('#3d5a80'));
      person(g, 0.02, 0.42, 0, 0.26, { tunic: C.bronze, skin: C.bronze, hair: C.bronzeD, rightUp: true });
    } else {
      person(g, 0, 0.26, 0, 0.44, { tunic: C.bronze, skin: C.bronze, hair: C.bronzeD, spear: C.bronzeD });
    }
  },

  // What is left: fallen columns and a broken wall.
  m_ruin(g, s, L) {
    g.box(0, 0, 0, 0.7, 0.04, 0.46, C.step);
    if (s.who === 'one') column(g, 0.2, -0.1, 0.56);
    else {
      column(g, -0.26, -0.14, 0.4);
      column(g, 0.0, -0.14, 0.22, true);
      column(g, 0.26, -0.14, 0.34);
    }
    g.at(-0.1, 0.04, 0.14, 0.4, 1, (q) => q.box(0, 0, 0, 0.3, 0.06, 0.07, C.marbleD)); // a fallen drum
    g.box(0.24, 0.04, 0.16, 0.1, 0.08, 0.08, C.marble);
    if (s.who === 'walls') {
      g.box(-0.3, 0, 0.3, 0.2, 0.24, 0.1, C.stone);
      g.box(0.1, 0, 0.32, 0.5, 0.14, 0.1, C.stone);
      house(g, 0.34, 0, -0.3, 0.8, 0.2);
    } else if (s.who === 'sunk') {
      g.box(0, 0.001, 0.3, 0.9, 0.03, 0.2, C.water);
      L.fx.puffs(L.group, { x: -0.3, y: 0.05, z: -0.3, color: '#8f8a98', n: 3, life: 5, rise: 1.2, size: 0.14, drift: [0.3, 0] });
    }
  },

  // A theatre cut into a hillside, open to the south.
  m_theatre(g) {
    for (let k = 0; k < 5; k++) {
      const r = 0.2 + k * 0.075;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + 0.12 + (i / 9) * (Math.PI - 0.24);
        g.box(Math.cos(a) * r, 0, 0.1 + Math.sin(a) * r * 0.9, 0.11 + k * 0.03, 0.05 + k * 0.05, 0.08, k % 2 ? C.marble : C.marbleD);
      }
    }
    g.cyl(0, 0, 0.1, 0.15, 0.15, 0.02, 10, C.sand);
    g.box(0, 0, 0.36, 0.5, 0.12, 0.08, C.marble); // the stage building
    person(g, 0, 0.02, 0.12, 0.16, { tunic: C.purple, armsUp: true });
  },

  // Tall rocks with a story.
  m_rock(g, s, L) {
    if (s.who === 'sword') {
      g.blob(0, 0.1, 0, 0.26, 0.16, 0.2, C.rock, { dark: C.rockD });
      g.box(0.22, 0, 0.2, 0.03, 0.2, 0.02, C.bronze);
      g.box(0.22, 0.14, 0.2, 0.09, 0.02, 0.02, C.goldD);
      g.box(0.3, 0, 0.22, 0.1, 0.02, 0.06, C.woodD); // the sandals
      person(g, -0.28, 0, 0.3, 0.2, { tunic: C.cream, hair: C.wood, armsUp: true });
    } else if (s.who === 'weeper') {
      crag(g, 0, 0, 0, 0.26, 0.62, 9, rgb('#a59fb3'), rgb('#77738f'));
      g.box(0, 0.5, 0.12, 0.14, 0.14, 0.1, rgb('#bdb7c8')); // a face in the stone
      g.box(-0.03, 0.2, 0.2, 0.02, 0.3, 0.02, rgb('#c8f0ff'));
      g.box(0.04, 0.24, 0.2, 0.02, 0.26, 0.02, rgb('#c8f0ff'));
      pool(g, 0, 0.36, 0.1);
    } else if (s.who === 'giant') {
      crag(g, -0.3, 0, -0.1, 0.16, 0.3, 4);
      person(g, 0.05, 0, 0.05, 0.56, { tunic: rgb('#b98a5a'), skin: C.skinD, hair: C.dark, beard: C.dark, armsUp: true });
      person(g, 0.34, 0, 0.3, 0.24, { tunic: rgb('#e2b24f'), hair: C.wood, rightUp: true }); // Heracles
      for (let i = 0; i < 4; i++) g.blob(-0.3 + i * 0.07, 0.03, 0.36, 0.035, 0.03, 0.035, C.cream); // skulls
    } else if (s.who === 'stone') {
      g.box(0, 0, -0.1, 0.5, 0.05, 0.3, C.step);
      for (let i = 0; i < 5; i++) person(g, -0.24 + i * 0.12, 0.05, -0.12 + (i % 2) * 0.1, 0.2, { tunic: C.stone, skin: C.stone, hair: C.stoneD, legs: C.stoneD, armsUp: i === 2 });
      g.box(0.3, 0, 0.3, 0.2, 0.12, 0.13, C.woodD); // the chest that came ashore
      g.box(0.3, 0.12, 0.3, 0.22, 0.03, 0.15, C.wood);
    }
  },

  // A row of temples on a ridge.
  m_temples(g) {
    g.at(-0.3, 0, -0.06, 0.25, 1, (q) => temple(q, 0, 0, 0, 0.26, 0.4, 0.2, { roof: rgb('#d8a05a') }));
    g.at(0.26, 0, 0.04, 0.25, 1, (q) => temple(q, 0, 0, 0, 0.26, 0.4, 0.2, { roof: rgb('#d8a05a') }));
    column(g, 0.0, 0.36, 0.2, true);
  },

  // Three goddesses, one shepherd and an apple.
  m_judgement(g, s, L) {
    g.blob(-0.3, 0.06, -0.1, 0.16, 0.1, 0.14, C.rock, { dark: C.rockD });
    person(g, -0.3, 0.14, -0.08, 0.24, { tunic: rgb('#8fae5a'), hair: C.wood }); // Paris
    g.blob(-0.16, 0.26, 0.0, 0.03, 0.03, 0.03, C.gold);
    person(g, 0.06, 0, 0.16, 0.26, { tunic: C.white, hair: C.dark, crown: C.gold });
    person(g, 0.24, 0, 0.26, 0.26, { tunic: C.bronze, hair: C.gold, crest: C.red, spear: true });
    person(g, 0.42, 0, 0.14, 0.26, { tunic: C.pink, hair: C.gold });
    sheep(g, -0.36, 0, 0.32, -0.6, 0.2);
    sheep(g, -0.1, 0, 0.42, 2.2, 0.2);
    L.fx.glyphs(L.group, { glyph: 'spark', color: '#ffe680', n: 2, x: -0.16, y: 0.3, rise: 0.4, spread: 0.05, life: 2.4 });
    L.tree('pine', -0.44, -0.3, 0.9);
  },

  // A king's house with a tower.
  m_palace(g, s, L) {
    g.box(-0.1, 0, -0.08, 0.5, 0.24, 0.36, C.cream, { top: rgb('#d8b98a') });
    g.box(0.26, 0, -0.14, 0.2, 0.46, 0.2, C.cream, { top: C.terracotta });
    for (const x of [-0.24, -0.06, 0.1]) g.cyl(x, 0, 0.13, 0.03, 0.04, 0.24, 5, C.red);
    g.box(-0.08, 0.24, 0.12, 0.44, 0.04, 0.1, C.terracotta);
    if (s.who === 'girls') {
      for (let i = 0; i < 4; i++) person(g, -0.3 + i * 0.16, 0, 0.34 + (i % 2) * 0.06, 0.18, { tunic: [C.pink, rgb('#bfe3ff'), C.cream, C.pink][i], hair: [C.dark, C.gold, C.wood, C.red][i] });
    } else if (s.who === 'lovers') {
      person(g, -0.2, 0, 0.36, 0.2, { tunic: C.purple, hair: C.gold });
      person(g, -0.04, 0, 0.36, 0.2, { tunic: C.white, hair: C.gold });
      L.fx.glyphs(L.group, { glyph: 'heart', color: '#ff9ac2', n: 2, x: -0.12, y: 0.3, z: 0.36, rise: 0.6, spread: 0.08, life: 3 });
    }
  },
};
