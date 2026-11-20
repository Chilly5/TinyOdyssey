// The splat renderer. Given a rectangle of ground, it works out the terrain
// there, lays down the towns and roads (plan.mjs), scatters trees and villages
// over the rest, and flattens everything into pixels: one coloured point per
// visible voxel, nearest the viewer wins.
//
// The camera looks north and down. A point (x, y, z) in voxels lands on pixel
//   px = x,  py = 0.6 z - 0.8 y
// so of any two points on one pixel, the one further south is always in front.
// That makes depth a single integer (the z row), and makes regions rendered
// separately fit together exactly.

import { WORLD_W, WORLD_D, LAT_N, DEG_PER_UNIT, worldToLonLat } from '../src/config.js';
import { hash2, noise2, clamp, smoothstep } from '../src/util.js';
import { R, SEA, RIVER, pack } from './palette.mjs';
import { buildPlan, PF } from './plan.mjs';

export const KZ = 0.6, KY = 0.8;

export const B = { SEA: 0, BEACH: 1, DESERT: 2, STEPPE: 3, SCRUB: 4, MEADOW: 5, FOREST: 6, HIGHLAND: 7, ROCK: 8, SNOW: 9, WHEAT: 10, CROP: 11, SOIL: 12, VINE: 13, YARD: 14, RIVER: 15, ROAD: 16, PAVED: 17, MASON: 18, PLANK: 19 };
export const YARD = Uint32Array.from(['#77664f', '#a28c66', '#c8b486', '#e1d1a4', '#f2e8c6'].map((s) => {
  const v = parseInt(s.slice(1), 16);
  return pack((v >> 16) & 255, (v >> 8) & 255, v & 255);
}));
export const TOP = [null, R.beach, R.desert, R.steppe, R.scrub, R.grass, R.forest, R.highland, R.rock, R.snow, R.wheat, R.crop, R.soil, R.vine, YARD, null, R.road, R.paved, R.stone, R.plank];
export const WALL = [null, R.clay, R.clay, R.clay, R.dirt, R.dirt, R.dirt, R.rock, R.rock, R.rock, R.dirt, R.dirt, R.dirt, R.dirt, R.clay, R.rock, R.dirt, R.stone, R.stone, R.plank];
export const F_CLEAR = 1, F_KEEP = 2, F_BANK = 4, F_FARM = 8;

// Blend of a packed colour towards (r, g, b), cached: the hex grid lines and shadowed sea use it.
const TINTS = { shade: [24, 40, 110, 0.3], seaLine: [255, 255, 255, 0.13], landLine: [30, 26, 70, 0.2] };
const tintCache = { shade: new Map(), seaLine: new Map(), landLine: new Map() };
function tint(c, kind) {
  const [r, g, b, t] = TINTS[kind];
  const tints = tintCache[kind];
  const key = c;
  let out = tints.get(key);
  if (out === undefined) {
    const cr = c & 255, cg = (c >>> 8) & 255, cb = (c >>> 16) & 255;
    out = pack(Math.round(cr + (r - cr) * t), Math.round(cg + (g - cg) * t), Math.round(cb + (b - cb) * t), c >>> 24);
    tints.set(key, out);
  }
  return out;
}

export function createRenderer({ fields, sites, stamps, S, rivers = [], landmarks = [], grid = true, lap = () => {} }) {
  const GW = Math.round(WORLD_W * S), GD = Math.round(WORLD_D * S);
  const { elevAt, softAt, sdAt, moistAt } = fields;

  // Metres above the sea to height in voxels. Relief is exaggerated roughly sevenfold.
  const heightOf = (m) => S * (0.045 + (Math.min(m, 3400) / 3000) ** 1.25 * 5.2);
  const quant = (h) => (h < 3.5 ? Math.max(1, Math.round(h)) : 3 * Math.round((h - 1) / 3) + 1);
  const MAXTOP = Math.ceil(heightOf(3400)) + 240; // tallest thing that can stand on the tallest ground
  const OY = Math.ceil((KY * MAXTOP) / 8) * 8; // image rows above the northern edge of the ground
  const BASE = 30; // rows of cut earth and water along the southern edge, like the side of a model
  const IW = GW, IH = OY + Math.ceil(KZ * GD) + 2 + BASE;
  const SHADOW_REACH = 150; // cells; no shadow is longer than this
  const inWorld = (gx, gz) => gx >= 0 && gz >= 0 && gx < GW && gz < GD;

  // Sites by 128-cell square, so the ground under a landmark can be found from any cell.
  const siteAt = new Map();
  for (const s of sites) {
    if (!s.R || s.sea) continue;
    s.hv = quant(heightOf(s.elev));
    const cx = s.x * S, cz = s.z * S, rr = (s.RT + 0.5) * S;
    for (let bj = Math.floor((cz - rr) / 128); bj <= Math.floor((cz + rr) / 128); bj++) {
      for (let bi = Math.floor((cx - rr) / 128); bi <= Math.floor((cx + rr) / 128); bi++) {
        const key = bj * 4096 + bi;
        if (!siteAt.has(key)) siteAt.set(key, []);
        siteAt.get(key).push(s);
      }
    }
  }

  // The smooth height of the ground at a cell, in voxels, before it is cut into terraces.
  // 0 is sea. A negative value means "exactly this height": the levelled ground of a landmark.
  // Also leaves the elevation in metres in gE and the footprint flags in gF.
  let gE = 0, gF = 0;
  function ground(gx, gz) {
    gF = 0;
    if (!inWorld(gx, gz)) { gE = -500; return 0; }
    const x = (gx + 0.5) / S, z = (gz + 0.5) / S;
    let e = softAt(x, z);
    if (e > -40 && e < 40) e += (noise2(gx / 5.3, gz / 5.3, 61) - 0.5) * 9 + (noise2(gx / 17, gz / 17, 62) - 0.5) * 8;
    gE = e;
    if (e <= 0) return 0;
    const list = siteAt.get((Math.floor(gz) >> 7) * 4096 + (Math.floor(gx) >> 7));
    if (list) {
      for (const s of list) {
        const d = Math.hypot(gx + 0.5 - s.x * S, gz + 0.5 - s.z * S) / S;
        if (d <= s.RT + 0.12) {
          gF = F_CLEAR | (d <= s.R * 0.72 + (noise2(gx / 9, gz / 9, 71) - 0.5) * 0.9 ? F_KEEP : 0);
          return -s.hv;
        }
        if (d <= s.RT + 0.4) gF |= F_CLEAR;
      }
    }
    let hf = heightOf(e);
    // Mountains: a few long ridges and hollows on the high ground, so a massif has a crest
    // and shoulders rather than being a smooth dome.
    const mt = smoothstep(420, 1250, e);
    if (mt > 0) {
      const wx = gx + (noise2(gx / 61, gz / 61, 201) - 0.5) * 50, wz = gz + (noise2(gx / 61, gz / 61, 202) - 0.5) * 50;
      const a = 1 - Math.abs(2 * noise2(wx / 74, wz / 74, 203) - 1);
      hf *= 1 + mt * (a * a - 0.35) * 0.2;
    }
    return hf;
  }

  // Towns, harbours and roads, worked out on first use (the landmarks must exist by then).
  let plan = null;
  const getPlan = () => plan || (plan = buildPlan({ fields, sites, landmarks, S, GW, GD, ground, lap }));
  const DROP8 = 10; // shadow ceiling falls 1.25 voxels per diagonal step (heights are kept x8)

  // The faint hex grid drawn over land and sea: big pointy-top hexes.
  const HEXW = 4;
  const hexEdge = (x, z) => {
    const px = x / HEXW, pz = z / HEXW;
    const r = pz / 0.8660254, q = px - r / 2;
    let rq = Math.round(q), rr = Math.round(r);
    const rs = Math.round(-q - r);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    const dx = Math.abs(px - (rq + rr / 2)), dz = Math.abs(pz - rr * 0.8660254);
    return (0.5 - Math.max(dx, dx * 0.5 + dz * 0.8660254)) * HEXW;
  };

  // opts.layout: stop once the ground and everything standing on it is worked out, and hand that back
  // (as .lay) without drawing it: the finer scales (gen/fine.mjs) draw the same layout their own way.
  function renderRegion(gx0, gz0, gx1, gz1, opts = {}) {
    const MWEST = SHADOW_REACH, MNORTH = SHADOW_REACH, MEAST = 36, MSOUTH = 36;
    const ex0 = gx0 - MWEST, ez0 = gz0 - MNORTH, ex1 = gx1 + MEAST, ez1 = gz1 + MSOUTH;
    const ew = ex1 - ex0, ed = ez1 - ez0, EN = ew * ed;
    const HF = new Float32Array(EN); // smooth height, voxels (0 at sea)
    const EL = new Float32Array(EN); // metres
    const H = new Int16Array(EN); // terraced height, voxels
    const mat = new Uint8Array(EN), lvl = new Uint8Array(EN), flag = new Uint8Array(EN);
    const lean = new Int8Array(EN); // -1 slope turned from the light, +1 towards it
    const wlean = new Int8Array(EN); // the same for the south face below the cell
    const P = getPlan();

    // --- 1. Height of the ground --------------------------------------------------
    for (let j = 0; j < ed; j++) {
      for (let i = 0; i < ew; i++) {
        const k = j * ew + i, gx = ex0 + i, gz = ez0 + j;
        HF[k] = ground(gx, gz);
        EL[k] = gE;
        flag[k] = gF;
        if (gE <= 0 && inWorld(gx, gz) && P.flag[gz * GW + gx] & PF.PIER) { EL[k] = 1; HF[k] = -1; flag[k] = F_CLEAR; } // a pier stands in the sea
      }
    }

    // --- 3. Terraces, climate, ground cover -------------------------------------------
    const latOf = (gz) => LAT_N - ((gz + 0.5) / S) * DEG_PER_UNIT;
    for (let j = 0; j < ed; j++) {
      const gz = ez0 + j, z = (gz + 0.5) / S, lat = latOf(gz);
      for (let i = 0; i < ew; i++) {
        const k = j * ew + i;
        const e = EL[k];
        if (e <= 0) continue; // sea
        const gx = ex0 + i, x = (gx + 0.5) / S;
        const fixed = HF[k] < 0;
        const hf = fixed ? -HF[k] : HF[k];
        const i0 = Math.max(0, i - 2), i1 = Math.min(ew - 1, i + 2), j0 = Math.max(0, j - 2), j1 = Math.min(ed - 1, j + 2);
        const gxh = (Math.abs(HF[j * ew + i1]) - Math.abs(HF[j * ew + i0])) / (i1 - i0);
        const gzh = (Math.abs(HF[j1 * ew + i]) - Math.abs(HF[j0 * ew + i])) / (j1 - j0);
        const slope = Math.hypot(gxh, gzh);
        const inland = -sdAt(x, z);
        const n = noise2(x * 0.11, z * 0.11, 11);
        const n2 = noise2(x * 0.45, z * 0.45, 5);
        const M = moistAt(x, z) + (noise2(gx / 19, gz / 19, 12) - 0.5) * 0.09;
        const snowline = 1720 + (n - 0.5) * 380 - smoothstep(37, 42, lat) * 220;
        let b;
        if (e > snowline) b = B.SNOW;
        else if (e > 1180 + (n2 - 0.5) * 260 || (slope > 2.2 && e > 300)) b = B.ROCK;
        else if (e > 820 + (n - 0.5) * 260) b = B.HIGHLAND;
        else if (inland < 0.07 + 0.16 * noise2(gx / 31, gz / 31, 13) && e < 34 && slope < 0.5) b = B.BEACH;
        else if (M < 0.18) b = B.DESERT;
        else if (M < 0.42) b = B.STEPPE;
        else if (M < 0.61) b = B.SCRUB;
        else if (M < 0.76) b = B.MEADOW;
        else b = B.FOREST;
        if (b === B.FOREST && e < 300 && slope < 0.4 && n2 > 0.25) b = B.MEADOW; // the plains are open country
        const pf = inWorld(gx, gz) ? P.flag[gz * GW + gx] : 0;

        // Farmland: brick-laid plots in the low, level, settled country.
        let level = 3;
        const farmable = (b === B.STEPPE || b === B.SCRUB || b === B.MEADOW || b === B.FOREST) && e < 300 && slope < 0.3 && inland > 0.12 && !fixed;
        let farmed = false;
        const paved = pf & (PF.ROAD | PF.PAVED | PF.WALL | PF.PIER);
        if (!paved && farmable && noise2(x * 0.3, z * 0.3, 41) + (noise2(x * 1.3, z * 1.3, 42) - 0.5) * 0.4 > (pf & PF.FARM ? 0.2 : e < 160 ? 0.44 : 0.58)) {
          const pz = Math.floor(gz / 11), px = Math.floor((gx + (pz & 1) * 8) / 17);
          const ph = hash2(px, pz, 43);
          if (ph < 0.78) {
            farmed = true;
            flag[k] |= F_FARM;
            const ex = (gx + (pz & 1) * 8) % 17, ezz = ((gz % 11) + 11) % 11;
            if (ex === 0 || ezz === 0) { b = B.SCRUB; level = 2; } // hedge
            else if (ph < 0.3) { b = B.WHEAT; level = ezz % 3 === 0 ? 2 : (hash2(gx, gz, 44) < 0.25 ? 4 : 3); }
            else if (ph < 0.5) { b = B.CROP; level = ex % 2 ? 3 : 2; }
            else if (ph < 0.64) { b = B.SOIL; level = (ex + ezz) % 3 === 0 ? 2 : 3; }
            else { b = B.VINE; level = ex % 3 === 1 && ezz % 2 === 1 ? 1 : 3; }
          }
        }
        if (!farmed) {
          const nb = noise2(gx / 6.5, gz / 5, 7) + (noise2(gx / 2.3, gz / 2.3, 8) - 0.5) * 0.4;
          level = nb > 0.66 ? 4 : nb < 0.33 ? 2 : 3;
          // Light comes from the north-west: ground tilted towards it is brighter, away from it darker.
          const hs = gxh * 0.5 + gzh * 0.3;
          const tilt = hs > 1.05 ? 2 : hs > 0.3 ? 1 : hs < -1.05 ? -2 : hs < -0.3 ? -1 : 0;
          level = clamp(level + tilt, tilt < -1 ? 0 : 1, 4);
          lean[k] = tilt > 1 ? 1 : tilt < -1 ? -1 : hs > 0.42 ? 1 : hs < -0.42 ? -1 : 0;
          wlean[k] = gxh > 1.3 ? 2 : gxh > 0.4 ? 1 : gxh < -1.3 ? -2 : gxh < -0.4 ? -1 : 0;
        }

        let h;
        if (fixed) {
          h = hf;
          if (flag[k] & F_KEEP && b !== B.ROCK && b !== B.SNOW) { b = B.YARD; level = 3 + (hash2(gx, gz, 72) < 0.12 ? 1 : 0) - (hash2(gx, gz, 73) < 0.1 ? 1 : 0); }
        } else {
          let wob = (noise2(gx / 11, gz / 11, 3) - 0.5) * 2.4 + (noise2(gx / 4.3, gz / 4.3, 4) - 0.5) * 1.0;
          if (b === B.ROCK || b === B.SNOW) { // broad ledges, not needles
            wob += (noise2(gx / 9, gz / 7, 21) - 0.5) * 5;
            h = 5 * Math.round((hf + wob - 1) / 5) + 1;
          } else {
            if (b === B.HIGHLAND) wob += (noise2(gx / 5, gz / 5, 21) - 0.5) * 2.5;
            h = quant(hf + wob);
          }
          if (b === B.BEACH) h = 1;
          else if (inland < 0.06) h = Math.min(h, 2);
          if (farmed || paved) h = quant(hf); // fields and roads stay level
        }
        if (pf & PF.WALL) { // a town wall, with taller towers
          b = B.MASON;
          h += pf & PF.TOWER ? 9 : 6;
          level = (gx + gz) & 1 ? 3 : 4;
          flag[k] |= F_CLEAR;
        } else if (pf & PF.PIER) {
          b = B.PLANK;
          level = gx & 1 ? 3 : 2;
          flag[k] |= F_CLEAR;
        } else if (pf & (PF.ROAD | PF.PAVED)) {
          b = pf & PF.PAVED ? B.PAVED : B.ROAD;
          // A worn middle and a darker verge, so the way stands out from the ground it crosses.
          const way = PF.ROAD | PF.PAVED;
          const verge = !(P.flag[gz * GW + gx - 1] & way) || !(P.flag[gz * GW + gx + 1] & way) || !(P.flag[(gz - 1) * GW + gx] & way) || !(P.flag[(gz + 1) * GW + gx] & way);
          level = verge ? 1 : 3 + (hash2(gx, gz, 162) < 0.3 ? 1 : 0);
          flag[k] |= F_CLEAR;
        } else if (pf & PF.TOWN && fixed && b !== B.YARD && b !== B.ROCK && b !== B.SNOW) {
          b = B.YARD; // the edge of town is trodden earth too
          level = 3 - (hash2(gx, gz, 73) < 0.25 ? 1 : 0);
        }
        H[k] = h;
        mat[k] = b;
        lvl[k] = level;
      }
    }

    // --- 4. Rivers --------------------------------------------------------------------
    for (const rv of rivers) {
      if (rv.x1 * S < ex0 || rv.x0 * S > ex1 || rv.z1 * S < ez0 || rv.z0 * S > ez1) continue;
      const P = rv.pts;
      for (let p = 0; p < P.length - 1; p++) {
        const ax = P[p][0] * S, az = P[p][1] * S, bx = P[p + 1][0] * S, bz = P[p + 1][1] * S;
        const wd = (P[p][2] + P[p + 1][2]) / 2;
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len * 2));
        for (let t = 0; t <= steps; t++) {
          const u = t / steps;
          const mx = ax + (bx - ax) * u, mz = az + (bz - az) * u;
          // Meanders: a slow wander with a quicker wriggle on top.
          const cx = mx + (noise2(mx / 34, mz / 34, 81) - 0.5) * 16 + (noise2(mx / 9, mz / 9, 83) - 0.5) * 5;
          const cz = mz + (noise2(mz / 34, mx / 34, 82) - 0.5) * 12 + (noise2(mz / 9, mx / 9, 84) - 0.5) * 4;
          const r = wd / 2, rb = r + 3.5;
          for (let j = Math.floor(cz - rb - ez0); j <= Math.ceil(cz + rb - ez0); j++) {
            if (j < 0 || j >= ed) continue;
            for (let i = Math.floor(cx - rb - ex0); i <= Math.ceil(cx + rb - ex0); i++) {
              if (i < 0 || i >= ew) continue;
              const k = j * ew + i;
              if (EL[k] <= 0 || flag[k] & F_KEEP) continue;
              const d = Math.hypot(ex0 + i + 0.5 - cx, (ez0 + j + 0.5 - cz) * 1.25);
              if (d <= r && (mat[k] === B.ROAD || mat[k] === B.PAVED || mat[k] === B.PLANK)) { mat[k] = B.PLANK; lvl[k] = (ex0 + i + ez0 + j) & 1 ? 3 : 2; continue; } // a bridge
              if (mat[k] === B.MASON) continue;
              if (d <= r) { mat[k] = B.RIVER; lvl[k] = d > r - 0.9 ? 0 : hash2(ex0 + i, ez0 + j, 83) < 0.08 ? 2 : 1; }
              flag[k] |= F_BANK;
            }
          }
        }
      }
    }
    // Water finds the low ground: a river cell takes the lowest bank next to it.
    for (let j = 1; j < ed - 1; j++) {
      for (let i = 1; i < ew - 1; i++) {
        const k = j * ew + i;
        if (mat[k] !== B.RIVER) continue;
        let lo = H[k];
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
          const kk = k + b * ew + a;
          if (kk >= 0 && kk < EN && EL[kk] > 0 && H[kk] < lo) lo = H[kk];
        }
        H[k] = Math.max(1, lo - 1);
      }
    }

    // --- 5. Objects: villages first, then trees and stones around them -------------------
    const inst = []; // { st, ramps, x, z, hb }
    const put = (st, ramps, gx, gz) => {
      const i = gx - ex0, j = gz - ez0;
      if (i < 0 || j < 0 || i >= ew || j >= ed) return false;
      inst.push({ st, ramps, x: gx, z: gz, hb: H[j * ew + i], lean: lean[j * ew + i] });
      return true;
    };
    const cellOk = (gx, gz) => {
      const i = gx - ex0, j = gz - ez0;
      if (i < 0 || j < 0 || i >= ew || j >= ed) return -1;
      const k = j * ew + i;
      return EL[k] > 0 && !(flag[k] & (F_CLEAR | F_BANK)) && mat[k] !== B.RIVER ? k : -1;
    };
    const occupied = new Uint8Array(EN);
    const TREE_KINDS = {
      oak: [stamps.oak, [R.oak, R.trunk, R.blossom]], oak2: [stamps.oak, [R.oak2, R.trunk, R.blossom]],
      autumn: [stamps.oak, [R.autumn, R.trunk, R.blossom]], pine: [stamps.pine, [R.pine, R.trunk, R.blossom]],
      fir: [stamps.fir, [R.pine, R.trunk, R.snow]], cypress: [stamps.cypress, [R.cypress, R.trunk, R.blossom]],
      olive: [stamps.olive, [R.olive, R.trunk, R.blossom]], palm: [stamps.palm, [R.palm, R.trunk, R.blossom]],
      bush: [stamps.bush, [R.bush, R.trunk, R.blossom]], bush2: [stamps.bush, [R.olive, R.trunk, R.blossom]],
    };
    const houseRamps = [
      [R.plaster, R.roof, R.wood], [R.plaster, R.roof, R.wood], [YARD, R.roof, R.wood], [R.stone, R.roof, R.wood],
    ];
    const VSTEP = Math.round(2.4 * S);
    for (let lj = Math.floor(ez0 / VSTEP) - 1; lj <= Math.floor(ez1 / VSTEP) + 1; lj++) {
      for (let li = Math.floor(ex0 / VSTEP) - 1; li <= Math.floor(ex1 / VSTEP) + 1; li++) {
        const vx = Math.round((li + hash2(li, lj, 91)) * VSTEP), vz = Math.round((lj + hash2(li, lj, 92)) * VSTEP);
        if (!inWorld(vx, vz)) continue;
        const wx = (vx + 0.5) / S, wz = (vz + 0.5) / S;
        const e = elevAt(wx, wz);
        if (e <= 4 || e > 620) continue;
        const inland = -sdAt(wx, wz);
        const lat = latOf(vz);
        const p = (inland < 1.6 ? 0.6 : 0.34) * (lat < 34.2 ? 0.35 : 1);
        if (hash2(li, lj, 93) > p) continue;
        const [lon] = worldToLonLat(wx, wz);
        const island = lon > 23.4 && lon < 28.6 && lat > 34.8 && lat < 39 && inland < 1.2;
        const count = 4 + Math.floor(hash2(li, lj, 94) * 10);
        const spread = 9 + count * 1.3;
        for (let hI = 0; hI < count; hI++) {
          const a = hash2(li * 31 + hI, lj, 95) * 6.283, d = Math.sqrt(hash2(li, lj * 31 + hI, 96)) * spread;
          const hx = Math.round(vx + Math.cos(a) * d), hz = Math.round(vz + Math.sin(a) * d * 0.8);
          const k = cellOk(hx, hz);
          if (k < 0 || occupied[k] || mat[k] === B.ROCK || mat[k] === B.SNOW || mat[k] === B.BEACH) continue;
          // Needs level ground under the whole house.
          let flat = true;
          for (let b = -4; b <= 4 && flat; b += 2) for (let a2 = -5; a2 <= 5; a2 += 5) {
            const kk = cellOk(hx + a2, hz + b);
            if (kk < 0 || H[kk] !== H[k]) { flat = false; break; }
          }
          if (!flat) continue;
          const flatRoof = island ? hash2(hx, hz, 97) < 0.75 : hash2(hx, hz, 97) < 0.08;
          const list = flatRoof ? stamps.houseFlat : stamps.house;
          const st = list[Math.floor(hash2(hx, hz, 98) * list.length)];
          const ramps = flatRoof ? [R.plaster, R.blue, R.blue] : houseRamps[Math.floor(hash2(hx, hz, 99) * houseRamps.length)];
          put(st, ramps, hx, hz);
          for (let b = -7; b <= 7; b++) for (let a2 = -8; a2 <= 8; a2++) {
            const i = hx + a2 - ex0, j = hz + b - ez0;
            if (i < 0 || j < 0 || i >= ew || j >= ed) continue;
            const kk = j * ew + i;
            occupied[kk] = 1;
            if (EL[kk] > 0 && mat[kk] >= B.DESERT && mat[kk] <= B.FOREST && Math.abs(a2) + Math.abs(b) < 8 + hash2(hx + a2, hz + b, 100) * 4 && H[kk] === H[k]) {
              mat[kk] = B.YARD;
              lvl[kk] = 3 - (hash2(hx + a2, hz + b, 101) < 0.2 ? 1 : 0);
            }
          }
        }
      }
    }

    // Town buildings, market stalls and moored boats, where the plan put them.
    const awnings = [R.blossom, R.blue, R.autumn, R.wheat, R.snow];
    for (const o of P.objectsIn(ex0, ez0, ex1, ez1)) {
      const k = (o.z - ez0) * ew + o.x - ex0;
      const any = (list, v = o.v) => list[Math.floor(v * list.length) % list.length];
      let st, ramps, hb = H[k], room = 6;
      if (o.kind === 'boat') { st = any(stamps.boat); ramps = [R.wood, R.plaster, any([R.roof, R.blue, R.wheat], o.v * 7 % 1)]; hb = 0; room = 0; }
      else if (H[k] <= 0) continue;
      else if (o.kind === 'house' || o.kind === 'big') {
        const [lon] = worldToLonLat((o.x + 0.5) / S, (o.z + 0.5) / S);
        const lat = LAT_N - ((o.z + 0.5) / S) * DEG_PER_UNIT;
        const island = lon > 23.4 && lon < 28.6 && lat > 34.8 && lat < 39 && -sdAt((o.x + 0.5) / S, (o.z + 0.5) / S) < 1.2;
        if (o.kind === 'big') { st = any(stamps.townhouse); ramps = any([[R.plaster, R.roof, R.wood], [YARD, R.roof, R.blue], [R.plaster, R.roof, R.blue], [R.stone, R.roof, R.wood]], (o.v * 13) % 1); }
        else if (island && (o.v * 5) % 1 < 0.6) { st = any(stamps.houseFlat); ramps = [R.plaster, R.blue, R.blue]; }
        else { st = any(stamps.house); ramps = any(houseRamps, (o.v * 11) % 1); }
      } else if (o.kind === 'stoa') { st = any(stamps.stoa); ramps = [R.plaster, R.roof, R.paved]; room = 9; }
      else if (o.kind === 'stall') { st = any(stamps.stall); ramps = [R.wood, any(awnings, (o.v * 3) % 1), R.wheat]; room = 3; }
      else if (o.kind === 'statue') { st = any(stamps.statue); ramps = [R.paved, R.wheat, R.stone]; room = 2; }
      else if (o.kind === 'tree') { const t = TREE_KINDS[o.v < 0.55 ? 'cypress' : 'olive']; st = any(t[0], (o.v * 9) % 1); ramps = t[1]; room = 2; }
      else continue;
      inst.push({ st, ramps, x: o.x, z: o.z, hb, lean: 0 });
      for (let b = -room; b <= room; b++) for (let a = -room - 1; a <= room + 1; a++) {
        const i = o.x + a - ex0, j = o.z + b - ez0;
        if (i >= 0 && j >= 0 && i < ew && j < ed) occupied[j * ew + i] = 1;
      }
    }

    const TREES = TREE_KINDS;
    const tree = (name, gx, gz, hsh) => {
      const [list, ramps] = TREES[name];
      return put(list[Math.floor(hsh * list.length)], ramps, gx, gz);
    };
    const pick = (h, table) => { // table: [name, weight, name, weight, ...]
      let total = 0;
      for (let i = 1; i < table.length; i += 2) total += table[i];
      let v = h * total;
      for (let i = 0; i < table.length; i += 2) {
        v -= table[i + 1];
        if (v <= 0) return table[i];
      }
      return table[0];
    };
    const TSTEP = 4;
    for (let lj = Math.floor(ez0 / TSTEP); lj <= Math.floor(ez1 / TSTEP); lj++) {
      for (let li = Math.floor(ex0 / TSTEP); li <= Math.floor(ex1 / TSTEP); li++) {
        const gx = li * TSTEP + Math.floor(hash2(li, lj, 111) * TSTEP), gz = lj * TSTEP + Math.floor(hash2(li, lj, 112) * TSTEP);
        const k = cellOk(gx, gz);
        if (k < 0 || occupied[k]) continue;
        const b = mat[k];
        if (b === B.BEACH || b >= B.WHEAT || b === B.SNOW) continue;
        const x = (gx + 0.5) / S, z = (gz + 0.5) / S;
        const clump = noise2(x * 1.15, z * 1.15, 31) + (noise2(x * 4.1, z * 4.1, 32) - 0.5) * 0.35;
        const e = EL[k], lat = latOf(gz);
        const r = hash2(li, lj, 113), r2 = hash2(li, lj, 114), r3 = hash2(li, lj, 115);
        let dens = 0, name = 'oak';
        if (b === B.FOREST) {
          dens = 0.14 + 0.6 * smoothstep(0.36, 0.62, clump);
          name = lat > 39.6 || e > 750
            ? pick(r2, ['fir', 44, 'oak', 38, 'oak2', 12, 'autumn', noise2(x * 0.6, z * 0.6, 33) > 0.66 ? 14 : 1, 'pine', 4])
            : pick(r2, ['oak', 44, 'oak2', 14, 'pine', 24, 'olive', 8, 'cypress', 8, 'autumn', 1]);
        } else if (b === B.MEADOW) {
          dens = 0.3 * smoothstep(0.48, 0.68, clump) + 0.025;
          name = pick(r2, ['oak', 30, 'oak2', 14, 'olive', 26, 'cypress', 14, 'pine', 16]);
        } else if (b === B.SCRUB) {
          dens = 0.2 * smoothstep(0.52, 0.72, clump) + 0.03;
          name = pick(r2, ['olive', 44, 'pine', 16, 'cypress', 12, 'bush', 18, 'bush2', 10]);
        } else if (b === B.STEPPE) {
          dens = 0.1 * smoothstep(0.56, 0.74, clump) + 0.014;
          name = pick(r2, ['olive', 40, 'bush2', 34, 'bush', 16, 'cypress', 10]);
        } else if (b === B.DESERT) {
          dens = 0.08 * smoothstep(0.62, 0.8, clump) + 0.004;
          name = pick(r2, ['palm', 70, 'bush2', 30]);
        } else if (b === B.HIGHLAND) {
          dens = 0.2 * smoothstep(0.42, 0.66, clump) + 0.015;
          name = pick(r2, ['fir', 70, 'oak2', 12, 'bush', 18]);
        } else if (b === B.ROCK) {
          dens = e < 1300 ? 0.03 : 0.005;
          name = 'fir';
        }
        if (r < dens) tree(name, gx, gz, r3);
      }
    }
    // Crags on the high ground.
    const CSTEP = 5;
    for (let lj = Math.floor(ez0 / CSTEP); lj <= Math.floor(ez1 / CSTEP); lj++) {
      for (let li = Math.floor(ex0 / CSTEP); li <= Math.floor(ex1 / CSTEP); li++) {
        const gx = li * CSTEP + Math.floor(hash2(li, lj, 121) * CSTEP), gz = lj * CSTEP + Math.floor(hash2(li, lj, 122) * CSTEP);
        const k = cellOk(gx, gz);
        if (k < 0 || occupied[k]) continue;
        const b = mat[k], r = hash2(li, lj, 123);
        if (b === B.ROCK) { if (r < 0.07) put(stamps.boulder[Math.floor(hash2(li, lj, 124) * stamps.boulder.length)], [R.rock, R.rock, R.snow], gx, gz); }
        else if (b === B.HIGHLAND) { if (r < 0.06) put(stamps.boulder[Math.floor(hash2(li, lj, 124) * stamps.boulder.length)], [R.rock, R.rock, R.snow], gx, gz); }
      }
    }
    // Small things: flowers, tufts, stones, haystacks.
    const blooms = [R.blossom, R.snow, R.wheat, R.autumn, R.blue];
    const DSTEP = 3;
    for (let lj = Math.floor(ez0 / DSTEP); lj <= Math.floor(ez1 / DSTEP); lj++) {
      for (let li = Math.floor(ex0 / DSTEP); li <= Math.floor(ex1 / DSTEP); li++) {
        const r = hash2(li, lj, 133);
        if (r > 0.16) continue;
        const gx = li * DSTEP + Math.floor(hash2(li, lj, 131) * DSTEP), gz = lj * DSTEP + Math.floor(hash2(li, lj, 132) * DSTEP);
        const k = cellOk(gx, gz);
        if (k < 0) continue;
        const b = mat[k], v = hash2(li, lj, 134);
        const any = (list) => list[Math.floor(v * list.length)];
        if (b === B.MEADOW || b === B.FOREST) {
          if (r < 0.05) put(any(stamps.flowers), [R.grass, R.trunk, blooms[Math.floor(hash2(li >> 3, lj >> 3, 135) * blooms.length)]], gx, gz);
          else if (r < 0.09) put(any(stamps.tuft), [R.grass, R.trunk, R.grass], gx, gz);
        } else if (b === B.SCRUB || b === B.STEPPE) {
          if (r < 0.035) put(any(stamps.flowers), [R.scrub, R.trunk, blooms[Math.floor(hash2(li >> 3, lj >> 3, 135) * blooms.length)]], gx, gz);
          else if (r < 0.08) put(any(stamps.tuft), [b === B.SCRUB ? R.scrub : R.steppe, R.trunk, R.grass], gx, gz);
          else if (r < 0.1) put(any(stamps.boulder), [R.stone, R.rock, R.snow], gx, gz);
        } else if (b === B.DESERT || b === B.BEACH) {
          if (r < 0.012) put(any(stamps.boulder), [b === B.DESERT ? R.clay : R.stone, R.rock, R.snow], gx, gz);
        } else if (b === B.WHEAT) {
          if (r < 0.006) put(any(stamps.hay), [R.wheat, R.wheat, R.wheat], gx, gz);
        }
      }
    }

    // --- 6. Shadows: one sweep from the north-west -------------------------------------
    const sh = new Int16Array(EN);
    for (let k = 0; k < EN; k++) sh[k] = H[k] * 8;
    for (const o of inst) {
      const st = o.st, bi = o.x - ex0, bj = o.z - ez0;
      for (let c = 0; c < st.cn; c++) {
        const i = bi + st.cx[c], j = bj + st.cz[c];
        if (i < 0 || j < 0 || i >= ew || j >= ed) continue;
        const t = (o.hb + st.ct[c]) * 8;
        if (t > sh[j * ew + i]) sh[j * ew + i] = t;
      }
    }
    // A finer render gives each landmark a sharp shadow of its own (gen/bake.mjs), so it wants the shade
    // of everything else kept apart.
    const sh0 = opts.layout ? Int16Array.from(sh) : null;
    for (const lm of landmarks) lm.stampTops?.(sh, ex0, ez0, ew, ed);
    for (const m of sh0 ? [sh, sh0] : [sh]) {
      for (let j = 1; j < ed; j++) {
        for (let i = 1; i < ew; i++) {
          const k = j * ew + i, v = m[k - ew - 1] - DROP8;
          if (v > m[k]) m[k] = v;
        }
      }
    }
    // Shadow ceiling arriving at cell (i, j), x8. Anything below it is in shade.
    const ceilAt = (i, j) => (i > 0 && j > 0 ? sh[(j - 1) * ew + i - 1] - DROP8 : -30000);

    if (opts.layout) return { lay: { ex0, ez0, ew, ed, HF, EL, H, mat, lvl, flag, lean, wlean, inst, sh, sh0 } };

    // --- 7. Flatten to pixels -------------------------------------------------------------
    const iw = gx1 - gx0;
    const iy0 = Math.floor(KZ * gz0) - Math.ceil(KY * MAXTOP);
    const ih = Math.ceil(KZ * gz1) + 2 - iy0 + (gz1 >= GD ? BASE : 0);
    const img = new Uint32Array(iw * ih);
    const zb = new Uint16Array(iw * ih);
    const row = (gz, y) => Math.round(KZ * gz - KY * y) - iy0;

    for (let gz = gz0; gz < gz1; gz++) {
      const j = gz - ez0, zr = gz - gz0 + 1, z = (gz + 0.5) / S;
      for (let gx = gx0; gx < gx1; gx++) {
        const i = gx - ex0, k = j * ew + i, px = gx - gx0;
        const h = H[k], x = (gx + 0.5) / S;
        const shade = ceilAt(i, j) > h * 8 + 3;
        const onLine = grid && inWorld(gx, gz) && hexEdge(x, z) * S < 0.55;
        let c;
        if (h === 0) { // sea
          const d = sdAt(x, z), dep = -elevAt(x, z);
          const w1 = noise2(gx / 27, gz / 21, 51) - 0.5, w2 = noise2(gx / 7.5, gz / 6.5, 52) - 0.5;
          const di = ((gx + gz) & 1 ? 0.022 : -0.022);
          const dd = Math.max(0, d + w1 * 0.3 * Math.min(1, d * 2.2) + w2 * 0.07 + di * (0.5 + d));
          const kS = 0.62 + 0.95 * smoothstep(220, 12, dep);
          if (dd < 0.05) c = SEA.foam;
          else if (dd < 0.12) c = SEA.wet;
          else if (dd < 0.34 * kS) c = SEA.s1;
          else if (dd < 0.74 * kS) c = SEA.s2;
          else if (dd < 1.3 * kS) c = SEA.s3;
          else {
            const dn = dep * (1 + w1 * 0.55 + di * 2) + w2 * 60;
            c = dn < 330 ? SEA.mid : dn < 1350 ? SEA.sea : dn < 2700 ? SEA.deep : SEA.abyss;
          }
          if (shade) c = tint(c, 'shade');
          if (onLine) c = tint(c, 'seaLine');
          const p = row(gz, 0) * iw + px;
          img[p] = c;
          zb[p] = zr;
          continue;
        }
        const b = mat[k];
        const hs = H[k + ew], hw = H[k - 1], he = H[k + 1];
        const yTop = row(gz, h);
        let level = lvl[k];
        if (b === B.RIVER) {
          c = RIVER[shade ? 0 : level];
        } else {
          if (hs < h || hw < h) level = Math.min(4, level + 1); // lit rim of a ledge
          if (shade) level = Math.max(0, level - 2);
          c = TOP[b][level];
          if (onLine) c = tint(c, 'landLine');
        }
        let p = yTop * iw + px;
        img[p] = c;
        zb[p] = zr;
        if (hs < h) { // the south face of a ledge
          const yB = Math.round(KZ * (gz + 1) - KY * hs) - iy0;
          const mason = b === B.MASON;
          const wr = b === B.RIVER ? null : mason ? R.stone : h - hs >= 7 ? R.rock : WALL[b]; // tall drops are bare cliff
          const wallShade = ceilAt(i, j + 1) > (hs + h) * 4;
          const streak = hash2(gx, h, 141) < 0.22 ? 1 : 0;
          const wl0 = 2 + wlean[k] - (wallShade ? 1 : 0);
          const bed = wr === R.rock ? 5 + ((hash2(gx >> 4, gz >> 5, 143) * 3) | 0) : 0; // rows between bedding lines
          for (let y = yTop + 1; y < yB; y++) {
            const ay = y + iy0;
            let wl = wl0 + streak - (y === yB - 1 ? 1 : 0) - (hash2(gx >> 1, ay, 142) < 0.18 ? 1 : 0);
            if (bed && (ay + (gx >> 3)) % bed === 0) wl--;
            if (mason) wl = 3 - (wallShade ? 1 : 0) - (ay % 3 === 0 || (gx + ((ay / 3) | 0) * 2) % 4 === 0 ? 1 : 0);
            p = y * iw + px;
            img[p] = wr ? wr[clamp(wl, 0, 4)] : (y & 1 ? RIVER[2] : SEA.foam); // rivers fall as white water
            zb[p] = zr;
          }
        }
      }
    }

    if (gz1 >= GD) { // the cut face of the diorama
      const j = GD - 1 - ez0, y0 = row(GD, 0);
      const navy = pack(30, 52, 110), navy2 = pack(22, 36, 84);
      for (let gx = gx0; gx < gx1; gx++) {
        const land = H[j * ew + gx - ex0] > 0;
        for (let r = 0; r < BASE; r++) {
          const n = hash2(gx >> 1, r >> 1, 151);
          let c;
          if (land) c = r < 2 ? R.dirt[3] : r < 9 ? R.dirt[n < 0.2 ? 3 : 2] : r < 20 ? R.dirt[n < 0.25 ? 2 : 1] : R.rock[n < 0.3 ? 1 : 0];
          else c = r < 1 ? SEA.s3 : r < 10 ? (n < 0.12 ? SEA.sea : SEA.deep) : r < 21 ? SEA.abyss : n < 0.5 ? navy : navy2;
          img[(y0 + r) * iw + gx - gx0] = (c | 0xff000000) >>> 0;
          zb[(y0 + r) * iw + gx - gx0] = 65535;
        }
      }
    }

    // Objects.
    for (const o of inst) {
      const st = o.st, ramps = o.ramps;
      if (o.z + 18 < gz0 || o.z - 18 >= gz1 || o.x + 18 < gx0 || o.x - 18 >= gx1) continue;
      for (let v = 0; v < st.n; v++) {
        const gz = o.z + st.dz[v];
        if (gz < gz0 || gz >= gz1) continue;
        const gx = o.x + st.dx[v];
        if (gx < gx0 || gx >= gx1) continue;
        const y = o.hb + st.dy[v];
        const p = row(gz, y) * iw + gx - gx0;
        const zr = gz - gz0 + 1;
        if (zb[p] > zr) continue;
        let level = st.lv[v] + o.lean;
        level = level < 0 ? 0 : level > 4 ? 4 : level;
        if (ceilAt(gx - ex0, gz - ez0) > y * 8 + 6) level = level > 2 ? level - 2 : 0;
        img[p] = ramps[st.part[v]][level];
        zb[p] = zr;
      }
    }
    // Landmarks.
    for (const lm of landmarks) lm.splat?.({ img, zb, iw, ih, gx0, gz0, gx1, gz1, iy0, ceilAt, ex0, ez0, ew, ed });

    return { img, zb, iw, ih, ix0: gx0, iy0: iy0 + OY, gz0 };
  }

  // Where a world point lands in the finished image.
  const project = (x, y, z) => [x * S, OY + KZ * z * S - KY * y];
  const groundHeight = (x, z) => {
    const e = elevAt(x, z);
    return e > 0 ? quant(heightOf(e)) : 0;
  };

  return { renderRegion, project, groundHeight, ground, groundE: () => gE, groundF: () => gF, plan: getPlan, heightOf, quant, GW, GD, IW, IH, OY, S, MAXTOP, BASE, DROP8 };
}
