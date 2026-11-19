// Meshes the hex grid: one column per land hex, plus the trees, crags and
// cottages that stand on it. Everything static is merged per chunk so the
// renderer can cull whole regions that are off screen.

import * as THREE from './three.js';
import { Geo, rgb, mix, shade } from './kit.js';
import { BIOME } from './grid.js';
import { HEX_R, hexCenterX, hexCenterZ, neighborOffsets, worldToLonLat } from './config.js';
import { hash2, mulberry32, clamp } from './util.js';

const CHUNK = 40;
const BASE_Y = -1.5; // underside of the diorama slab
const SHORE_Y = -0.35; // how far coastal walls reach below the waterline

// Hex corners clockwise from north, and the neighbour (see neighborOffsets) across each edge.
const CORNERS = [
  [0, -HEX_R], [0.5, -HEX_R / 2], [0.5, HEX_R / 2], [0, HEX_R], [-0.5, HEX_R / 2], [-0.5, -HEX_R / 2],
];
const EDGE_NEIGHBOR = [1, 0, 5, 4, 3, 2];

const TOP = {
  [BIOME.BEACH]: [rgb('#f4e4a8'), rgb('#ecd894')],
  [BIOME.DESERT]: [rgb('#ecd28c'), rgb('#e0c078')],
  [BIOME.STEPPE]: [rgb('#d6cb78'), rgb('#c2c069')],
  [BIOME.SCRUB]: [rgb('#b4c95e'), rgb('#9cc054')],
  [BIOME.MEADOW]: [rgb('#93c452'), rgb('#7fba4a')],
  [BIOME.FOREST]: [rgb('#6fae45'), rgb('#5a9f3e')],
  [BIOME.HIGHLAND]: [rgb('#9db06c'), rgb('#8aa565')],
  [BIOME.ROCK]: [rgb('#a39db6'), rgb('#8f88a6')],
  [BIOME.SNOW]: [rgb('#f6f8fc'), rgb('#e4eaf5')],
};
const WALL_SAND = rgb('#dcc388');
const WALL_EARTH = rgb('#c2a577');
const WALL_ROCK = rgb('#7d7696');
const WALL_SNOW = rgb('#c5cbdd');
const WALL_BASE = rgb('#6b5a52');

export function makeTemplates() {
  const trunk = rgb('#6f4d31');
  const T = {};
  T.olive = new Geo()
    .box(0, 0, 0, 0.07, 0.22, 0.07, trunk)
    .blob(0, 0.4, 0, 0.3, 0.24, 0.3, rgb('#84a845'), { dark: rgb('#587a31') });
  T.oak = new Geo()
    .box(0, 0, 0, 0.08, 0.24, 0.08, trunk)
    .blob(0, 0.46, 0, 0.35, 0.3, 0.35, rgb('#4f9c3b'), { dark: rgb('#2f6f2d') });
  T.cypress = new Geo()
    .box(0, 0, 0, 0.05, 0.1, 0.05, trunk)
    .cyl(0, 0.08, 0, 0.13, 0, 0.92, 6, rgb('#2f6d3b'));
  T.pine = new Geo()
    .box(0, 0, 0, 0.06, 0.16, 0.06, trunk)
    .cyl(0, 0.13, 0, 0.27, 0, 0.42, 6, rgb('#2e7744'))
    .cyl(0, 0.38, 0, 0.19, 0, 0.42, 6, rgb('#3a8a4f'));
  T.palm = new Geo()
    .cyl(0, 0, 0, 0.04, 0.03, 0.5, 4, rgb('#94734a'))
    .blob(0, 0.54, 0, 0.27, 0.08, 0.27, rgb('#5aa640'), { dark: rgb('#3b7d32') })
    .blob(0, 0.6, 0, 0.12, 0.08, 0.12, rgb('#6cb84b'));
  T.bush = new Geo().blob(0, 0.09, 0, 0.17, 0.12, 0.17, rgb('#8fae4c'), { dark: rgb('#66863a') });
  T.rock = new Geo().blob(0, 0.07, 0, 0.17, 0.13, 0.14, rgb('#aaa4ba'), { dark: rgb('#837c98') });
  T.spire = new Geo().cyl(0, 0, 0, 0.36, 0, 1, 5, rgb('#9891ad'));
  T.spireSnow = new Geo()
    .cyl(0, 0, 0, 0.36, 0.15, 0.58, 5, rgb('#9891ad'))
    .cyl(0, 0.58, 0, 0.15, 0, 0.42, 5, rgb('#f7f9fd'));
  T.house = new Geo()
    .box(0, 0, 0, 0.3, 0.2, 0.24, rgb('#f6efdf'), { side: rgb('#efe5cf') })
    .gable(0, 0.2, 0, 0.36, 0.14, 0.3, rgb('#dc6b3e'), false, rgb('#f6efdf'));
  T.houseFlat = new Geo() // whitewashed island cube
    .box(0, 0, 0, 0.26, 0.2, 0.24, rgb('#ffffff'), { side: rgb('#f1f1f4') })
    .box(0.08, 0.2, 0.04, 0.1, 0.1, 0.1, rgb('#ffffff'), { top: rgb('#4b8fd6') });
  return T;
}

export function buildTerrain(grid, uniforms) {
  const { cols, rows, land, y, biome, moist, clear, coast, elev, hill } = grid;
  const T = makeTemplates();
  const group = new THREE.Group();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = uniforms.uRim;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdge;\nuniform float uRim;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uRim * step(0.88, vEdge);');
  };

  const topColor = (i, c, r) => {
    const pal = TOP[biome[i]];
    const t = clamp(hash2(c, r, 7) * 0.7 + (moist[i] % 0.15) * 2, 0, 1);
    const k = (0.95 + 0.1 * hash2(c, r, 9)) * hill[i];
    return shade(mix(pal[0], pal[1], t), k);
  };
  const wallColor = (i, c, r) => {
    const b = biome[i];
    const k = 0.93 + 0.12 * hash2(c, r, 13);
    if (b === BIOME.BEACH || b === BIOME.DESERT) return shade(WALL_SAND, k);
    if (b === BIOME.SNOW) return shade(WALL_SNOW, k);
    if (b === BIOME.ROCK || b === BIOME.HIGHLAND) return shade(WALL_ROCK, k);
    return shade(mix(WALL_EARTH, WALL_ROCK, clamp((y[i] - 0.5) / 1.6, 0, 1)), k);
  };

  for (let cr = 0; cr < rows; cr += CHUNK) {
    for (let cc = 0; cc < cols; cc += CHUNK) {
      const geo = new Geo(8192);
      for (let r = cr; r < Math.min(rows, cr + CHUNK); r++) {
        for (let c = cc; c < Math.min(cols, cc + CHUNK); c++) {
          const i = r * cols + c;
          if (!land[i]) continue;
          const x = hexCenterX(c, r), z = hexCenterZ(r), h = y[i];
          const top = topColor(i, c, r);
          const centre = [x, h, z];
          const nb = neighborOffsets(r);
          let wall = null;
          for (let j = 0; j < 6; j++) {
            const p = CORNERS[j], q = CORNERS[(j + 1) % 6];
            const P = [x + p[0], h, z + p[1]], Q = [x + q[0], h, z + q[1]];
            geo.tri(centre, Q, P, top, 0, 1, 1);
            const o = nb[EDGE_NEIGHBOR[j]];
            const nc = c + o[0], nr = r + o[1];
            let floor;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) floor = BASE_Y;
            else {
              const ni = nr * cols + nc;
              floor = land[ni] ? y[ni] : SHORE_Y;
            }
            if (floor < h - 1e-4) {
              if (!wall) wall = wallColor(i, c, r);
              const col = floor === BASE_Y ? mix(wall, WALL_BASE, 0.55) : wall;
              geo.quad(P, Q, [Q[0], floor, Q[2]], [P[0], floor, P[2]], col);
            }
          }
          if (!clear[i]) scatter(geo, T, grid, i, c, r, x, h, z);
        }
      }
      if (!geo.n) continue;
      const mesh = new THREE.Mesh(geo.build(), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return { group, material };

  function scatter(geo, T, grid, i, c, r, x, h, z) {
    const b = biome[i];
    const rnd = mulberry32(c * 7919 + r * 104729 + 17);
    const m = elev[i];
    const put = (tpl, spread, s0, s1, tintAmt = 0.14) => {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
      const s = s0 + rnd() * (s1 - s0);
      const g = 1 - tintAmt / 2 + rnd() * tintAmt;
      const warm = (rnd() - 0.5) * tintAmt;
      geo.add(tpl, x + Math.cos(a) * d, h, z + Math.sin(a) * d * 0.9, rnd() * 6.28, s, s * (0.9 + rnd() * 0.25), s,
        [g + warm, g, g - warm * 0.6]);
    };
    const u = rnd();
    switch (b) {
      case BIOME.FOREST: {
        const conifer = m > 650 || (worldToLonLat(x, z)[1] > 40.3 && rnd() < 0.45);
        const n = u < 0.55 ? 2 : u < 0.9 ? 3 : 1;
        for (let k = 0; k < n; k++) put(conifer && rnd() < 0.8 ? T.pine : rnd() < 0.75 ? T.oak : T.olive, 0.36, 0.8, 1.25);
        break;
      }
      case BIOME.MEADOW:
        if (u < 0.42) put(rnd() < 0.6 ? T.oak : T.olive, 0.3, 0.75, 1.15);
        else if (u < 0.52) put(T.bush, 0.3, 0.8, 1.2);
        if (rnd() < 0.12) put(T.cypress, 0.3, 0.8, 1.1);
        break;
      case BIOME.SCRUB:
        if (u < 0.34) put(T.olive, 0.3, 0.75, 1.1);
        else if (u < 0.44) put(T.cypress, 0.3, 0.75, 1.15);
        else if (u < 0.6) put(T.bush, 0.32, 0.8, 1.3);
        if (rnd() < 0.1) put(T.bush, 0.34, 0.7, 1.1);
        break;
      case BIOME.STEPPE:
        if (u < 0.1) put(T.olive, 0.3, 0.7, 1);
        else if (u < 0.24) put(T.bush, 0.3, 0.7, 1.2, 0.3);
        else if (u < 0.28) put(T.rock, 0.3, 0.7, 1.2);
        break;
      case BIOME.DESERT:
        if (u < 0.035 && coast[i] < 5) put(T.palm, 0.25, 0.9, 1.3);
        else if (u < 0.07) put(T.rock, 0.3, 0.7, 1.3);
        break;
      case BIOME.BEACH:
        if (u < 0.05 && worldToLonLat(x, z)[1] < 36) put(T.palm, 0.2, 0.9, 1.2);
        break;
      case BIOME.HIGHLAND:
        if (u < 0.5) put(T.pine, 0.32, 0.75, 1.1);
        else if (u < 0.62) put(T.rock, 0.3, 0.9, 1.5);
        if (rnd() < 0.2) put(T.pine, 0.34, 0.7, 1);
        break;
      case BIOME.ROCK:
        if (u < 0.7) put(T.spire, 0.12, 0.8, 1.7, 0.1);
        else if (u < 0.85) put(T.rock, 0.3, 1, 1.8, 0.1);
        if (rnd() < 0.3) put(T.spire, 0.3, 0.5, 0.9, 0.1);
        break;
      case BIOME.SNOW:
        if (u < 0.75) put(T.spireSnow, 0.1, 0.9, 1.8, 0.05);
        if (rnd() < 0.3) put(T.spireSnow, 0.3, 0.5, 0.9, 0.05);
        break;
      default:
    }
    // A scattering of hamlets on gentle ground near the sea.
    if (b >= BIOME.STEPPE && b <= BIOME.MEADOW && coast[i] <= 3 && m < 300 && hash2(c, r, 31) < 0.022) {
      const island = hash2(c, r, 33) < 0.5 && coast[i] <= 2;
      const n = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) put(island ? T.houseFlat : T.house, 0.28, 0.85, 1.1, 0.04);
    }
  }
}
