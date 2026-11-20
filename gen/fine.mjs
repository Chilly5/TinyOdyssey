// The same world, drawn finer.
//
// region.mjs draws the whole map with one voxel to the pixel. This draws any part
// of it with F voxels to that one, each way: the same hills, the same roads, the
// same trees and houses in the same places, but worked out again at the finer
// grain, so that what was a five-pixel tree is an eighty-pixel tree with a trunk
// and boughs and lumps of leaves, a terrace edge is a smooth line instead of a
// staircase, and a field has its furrows. Nothing is enlarged; everything is
// redrawn. That is what lets the picture be zoomed a long way and stay sharp.
//
// How each thing is found again at the finer grain:
//   the ground      the height and elevation functions are continuous, so they are
//                   simply asked at the finer points, and cut into the same terraces
//   what grows      taken from the coarse layout, the borders between kinds of ground
//                   wandering a little so they are not square
//   roads, walls    drawn again from the plan's shapes (plan.mjs keeps them)
//   rivers          the same meanders, filled in at the finer grain
//   fields          the same plots, with rows the coarse picture has no room for
//   trees, houses   the coarse layout says where and which; each one rebuilds
//                   itself at the scale wanted (stamps.mjs)
//   landmarks       their models are sampled again as finely as needed (bake.mjs)
//   shadows         the coarse shadow map, read smoothly between its cells
//
// A `look` decides the colours and the finish (see gen/looks.mjs): pixel art, or
// clean stacked terraces.

import { hash2, noise2, clamp, smoothstep } from '../src/util.js';
import { PF } from './plan.mjs';
import { KZ, KY, B, F_CLEAR, F_KEEP, F_FARM } from './region.mjs';

const NATURAL = (b) => (b >= B.BEACH && b <= B.SNOW) || b === B.YARD;
const FARMED = (b) => b >= B.WHEAT && b <= B.VINE;

export function createFine({ base, fields, rivers = [], landmarksAt = () => [] }) {
  const { S, GW, GD, OY, MAXTOP, quant, heightOf, ground, groundE, DROP8 } = base;
  const { elevAt, sdAt } = fields;
  const P = base.plan();
  const inWorld = (gx, gz) => gx >= 0 && gz >= 0 && gx < GW && gz < GD;

  // look: see gen/looks.mjs. Returns the picture of base cells [gx0, gx1) x [gz0, gz1) at F pixels to the cell.
  // opts.yMax: the caller wants nothing below this row of the whole picture (in pixels of this scale), so
  // ground that cannot reach as high as that is left out, which saves most of the work when a region is
  // only being rendered for what stands on it and reaches up into the rows wanted.
  function render(gx0, gz0, gx1, gz1, F, look, opts = {}) {
    const clip = opts.yMax === undefined ? null : opts.yMax - OY * F;
    const lay = base.renderRegion(gx0, gz0, gx1, gz1, { layout: true }).lay;
    const { ex0, ez0, ew, ed, H: bH, mat: bM, EL: bE, flag: bF } = lay;
    const sh = lay.sh0 || lay.sh; // the landmarks' own shadows are laid on separately, sharp (lmShade below)
    const bi = (x) => clamp(Math.round(x) - ex0, 0, ew - 1), bj = (z) => clamp(Math.round(z) - ez0, 0, ed - 1);

    // --- The fine grid: the region and a margin, so that slopes and neighbours can be read at its edge ---
    const M = 2 * F + 2;
    const fx0 = gx0 * F - M, fz0 = gz0 * F - M, fw = (gx1 - gx0) * F + 2 * M, fd = (gz1 - gz0) * F + 2 * M + 1;
    const FN = fw * fd;
    const fHF = new Float32Array(FN); // smooth height in coarse voxels (negative: exactly this, levelled)
    const fE = new Float32Array(FN); // metres
    const fH = new Int32Array(FN); // height, fine voxels
    const fM = new Uint8Array(FN), fL = new Uint8Array(FN);
    const fT = new Int8Array(FN); // how the slope leans to the light, for the face below (-2..2)
    const toB = (f) => (f + 0.5) / F - 0.5; // a fine cell's centre, in coarse cells

    // --- Roads, streets, walls, piers: the plan's shapes, drawn at this grain ---
    const way = new Uint8Array(FN); // PF bits
    const verge = new Uint8Array(FN); // 1 along the edge of a way
    {
      const vw = Math.max(1, F * 0.3);
      const allowed = (i, j, bit) => { // only where the coarse plan put it, or right beside
        const cx = Math.round(toB(fx0 + i)), cz = Math.round(toB(fz0 + j));
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (inWorld(cx + a, cz + b) && P.flag[(cz + b) * GW + cx + a] & bit) return true;
        return false;
      };
      const mark = (i, j, bit, edge) => {
        if (i < 0 || j < 0 || i >= fw || j >= fd || !allowed(i, j, bit & ~PF.TOWER)) return;
        const k = j * fw + i;
        if (edge && !(way[k] & bit)) verge[k] = 1;
        else if (!edge) verge[k] = 0;
        way[k] |= bit;
      };
      for (const shp of P.shapesIn((fx0 - 4) / F, (fz0 - 4) / F, (fx0 + fw + 4) / F, (fz0 + fd + 4) / F)) {
        if (shp.box) {
          const [x0, z0, x1, z1] = shp.box;
          for (let j = Math.max(0, Math.ceil(z0 * F - fz0 - 0.5)); j < Math.min(fd, z1 * F - fz0); j++) {
            for (let i = Math.max(0, Math.ceil(x0 * F - fx0 - 0.5)); i < Math.min(fw, x1 * F - fx0); i++) mark(i, j, shp.bit, false);
          }
        } else if (shp.oval) {
          const [cx, cz, rx, rz] = shp.oval;
          for (let j = Math.max(0, Math.floor((cz - rz) * F - fz0)); j <= Math.min(fd - 1, Math.ceil((cz + rz) * F - fz0)); j++) {
            for (let i = Math.max(0, Math.floor((cx - rx) * F - fx0)); i <= Math.min(fw - 1, Math.ceil((cx + rx) * F - fx0)); i++) {
              const d = (((fx0 + i + 0.5) / F - cx) / rx) ** 2 + (((fz0 + j + 0.5) / F - cz) / rz) ** 2;
              if (d <= 1) mark(i, j, shp.bit, d > (1 - vw / (rz * F)) ** 2);
            }
          }
        } else {
          const r = (shp.wide / 2) * F + 0.5;
          for (let s = 0; s < shp.pts.length - 1; s++) {
            const ax = shp.pts[s][0] * F - fx0, az = shp.pts[s][1] * F - fz0, bx = shp.pts[s + 1][0] * F - fx0, bz = shp.pts[s + 1][1] * F - fz0;
            const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(fw - 1, Math.ceil(Math.max(ax, bx) + r));
            const j0 = Math.max(0, Math.floor(Math.min(az, bz) - r)), j1 = Math.min(fd - 1, Math.ceil(Math.max(az, bz) + r));
            const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
              const t = clamp(((i + 0.5 - ax) * dx + (j + 0.5 - az) * dz) / l2, 0, 1);
              const d = Math.hypot(i + 0.5 - ax - dx * t, j + 0.5 - az - dz * t);
              if (d <= r) mark(i, j, shp.bit, d > r - vw);
            }
          }
        }
      }
    }

    // --- Rivers: the same meanders as the coarse picture, filled in at this grain. 1 bank, 2 water, 3 its edge ---
    const riv = new Uint8Array(FN);
    for (const rv of rivers) {
      if (rv.x1 * S < gx0 - 8 || rv.x0 * S > gx1 + 8 || rv.z1 * S < gz0 - 8 || rv.z0 * S > gz1 + 8) continue;
      const Q = rv.pts;
      for (let p = 0; p < Q.length - 1; p++) {
        const ax = Q[p][0] * S, az = Q[p][1] * S, bx = Q[p + 1][0] * S, bz = Q[p + 1][1] * S;
        const wd = (Q[p][2] + Q[p + 1][2]) / 2;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 2));
        for (let t = 0; t <= steps; t++) {
          const u = t / steps;
          const mx = ax + (bx - ax) * u, mz = az + (bz - az) * u;
          const cx = (mx + (noise2(mx / 34, mz / 34, 81) - 0.5) * 16 + (noise2(mx / 9, mz / 9, 83) - 0.5) * 5) * F - fx0;
          const cz = (mz + (noise2(mz / 34, mx / 34, 82) - 0.5) * 12 + (noise2(mz / 9, mx / 9, 84) - 0.5) * 4) * F - fz0;
          const r = (wd / 2) * F, rb = r + 3.5 * F;
          if (cx + rb < 0 || cz + rb < 0 || cx - rb >= fw || cz - rb >= fd) continue;
          for (let j = Math.max(0, Math.floor(cz - rb)); j <= Math.min(fd - 1, Math.ceil(cz + rb)); j++) {
            for (let i = Math.max(0, Math.floor(cx - rb)); i <= Math.min(fw - 1, Math.ceil(cx + rb)); i++) {
              const d = Math.hypot(i + 0.5 - cx, (j + 0.5 - cz) * 1.25);
              const k = j * fw + i;
              if (d <= r) riv[k] = d > r - Math.max(0.9, F * 0.3) && riv[k] !== 2 ? 3 : 2;
              else if (d <= rb && !riv[k]) riv[k] = 1;
            }
          }
        }
      }
    }

    // --- The ground: its smooth height at every fine point ---
    for (let j = 0; j < fd; j++) {
      const bz = toB(fz0 + j), cj = bj(bz), far = clip === null ? -1e9 : (KZ * (fz0 + j) - clip) / (KY * F) - 10; // ground lower than this cannot be seen
      for (let i = 0; i < fw; i++) {
        const k = j * fw + i;
        if (bH[cj * ew + bi(toB(fx0 + i))] < far) { fM[k] = 255; continue; }
        fHF[k] = ground(toB(fx0 + i), bz);
        fE[k] = groundE();
      }
    }

    // Something that grows, for a fine cell whose coarse cell is a road or the sea: look round about.
    const natural = (ci, cj) => {
      for (let r = 1; r <= 3; r++) {
        for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          const i = ci + a, j = cj + b;
          if (i >= 0 && j >= 0 && i < ew && j < ed && NATURAL(bM[j * ew + i]) && bE[j * ew + i] > 0) return bM[j * ew + i];
        }
      }
      return B.STEPPE;
    };
    const lowestBank = (ci, cj) => {
      let lo = 1e9;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
        const i = ci + a, j = cj + b;
        if (i >= 0 && j >= 0 && i < ew && j < ed && bE[j * ew + i] > 0 && bH[j * ew + i] < lo) lo = bH[j * ew + i];
      }
      return lo > 1e8 ? 2 : lo;
    };

    // --- What covers it, how high it stands, how it is lit ---
    const G = 2 * F; // slopes are read over the same distance on the ground as in the coarse picture
    const WARP = 1 / (F * 0.85);
    const fine2 = F >= 2 ? 1 / Math.max(1.5, F * 0.21) : 1;
    for (let j = 0; j < fd; j++) {
      const fz = fz0 + j, bz = toB(fz), z = (bz + 0.5) / S;
      for (let i = 0; i < fw; i++) {
        const k = j * fw + i;
        const fx = fx0 + i, bx = toB(fx), x = (bx + 0.5) / S;
        if (fM[k] === 255) continue; // out of sight
        const e = fE[k];
        let pf = way[k];
        if (e <= 0) { // sea, unless a pier stands in it
          if (pf & PF.PIER) { fH[k] = F; fM[k] = B.PLANK; fL[k] = ((fx / Math.max(1, F >> 1)) | 0) & 1 ? 3 : 2; if (verge[k]) fL[k] = 1; }
          continue;
        }
        const ci0 = bi(bx), cj0 = bj(bz), kb0 = cj0 * ew + ci0;
        const fixed = fHF[k] < 0;
        const hf = fixed ? -fHF[k] : fHF[k];
        const il = Math.max(0, i - G), ir = Math.min(fw - 1, i + G), jl = Math.max(0, j - G), jr = Math.min(fd - 1, j + G);
        const gxh = ((Math.abs(fHF[j * fw + ir]) - Math.abs(fHF[j * fw + il])) / (ir - il)) * F;
        const gzh = ((Math.abs(fHF[jr * fw + i]) - Math.abs(fHF[jl * fw + i])) / (jr - jl)) * F;

        // Which kind of ground: the coarse layout's, read a little off to one side so that borders wander.
        let b;
        let level = 3;
        let farmed = false;
        if (bF[kb0] & F_FARM && !(pf & (PF.ROAD | PF.PAVED | PF.WALL | PF.PIER))) {
          // A field: the same plot as the coarse picture, with its rows.
          const pz = Math.floor((bz + 0.5) / 11), pxs = bx + 0.5 + (pz & 1) * 8, px = Math.floor(pxs / 17);
          const ph = hash2(px, pz, 43);
          const ex = pxs - px * 17, ezz = bz + 0.5 - pz * 11;
          farmed = true;
          if (ex < 1 || ezz < 1) { b = B.SCRUB; level = hash2(fx >> 1, fz >> 1, 45) < 0.3 ? 3 : 2; } // hedge
          else if (ph < 0.3) { b = B.WHEAT; const row = ezz % 3; level = row < 0.4 ? 2 : (noise2(fx * fine2, fz * fine2 * 3, 44) > 0.62 ? 4 : 3); }
          else if (ph < 0.5) { b = B.CROP; const row = (ex * (F >= 4 ? 2 : 1)) % 2; level = row < 1 ? 3 : 2; if (F >= 8 && row < 1 && hash2(fx, fz >> 2, 46) < 0.2) level = 4; }
          else if (ph < 0.64) { b = B.SOIL; const fur = (ex + ezz) % 3; level = fur < (F >= 4 ? 0.5 : 1) ? 2 : (F >= 4 && (ex * 2 + ezz * 2) % 1 < 0.3 ? 2 : 3); }
          else { b = B.VINE; const vx = ex % 3, vz = ezz % 2; level = vx >= 1 && vx < 2 && vz >= 1 ? 1 : (vx >= 0.7 && vx < 2.3 && F >= 4 ? 2 : 3); }
          if (ph >= 0.78) { farmed = false; b = undefined; }
        }
        if (b === undefined) {
          const wi = bi(bx + (noise2(fx * WARP, fz * WARP, 901) - 0.5) * 1.3), wj = bj(bz + (noise2(fx * WARP, fz * WARP, 902) - 0.5) * 1.3);
          b = bM[wj * ew + wi];
          if (bE[wj * ew + wi] <= 0 || !NATURAL(b)) b = NATURAL(bM[kb0]) && bE[kb0] > 0 ? bM[kb0] : natural(ci0, cj0);
          if (b === B.YARD && !(bF[kb0] & F_CLEAR) && bM[kb0] !== B.YARD) b = natural(ci0, cj0);
          const nb = noise2(bx / 6.5, bz / 5, 7) + (noise2(bx / 2.3, bz / 2.3, 8) - 0.5) * 0.4 + (F > 1 ? (noise2(fx * fine2, fz * fine2, 911) - 0.5) * 0.36 : 0);
          level = nb > 0.66 ? 4 : nb < 0.33 ? 2 : 3;
          const hs = gxh * 0.5 + gzh * 0.3;
          const tilt = hs > 1.05 ? 2 : hs > 0.3 ? 1 : hs < -1.05 ? -2 : hs < -0.3 ? -1 : 0;
          level = clamp(level + tilt, tilt < -1 ? 0 : 1, 4);
          fT[k] = gxh > 1.3 ? 2 : gxh > 0.4 ? 1 : gxh < -1.3 ? -2 : gxh < -0.4 ? -1 : 0;
          if (b === B.YARD) level = 3 + (hash2(fx, fz, 72) < 0.06 ? 1 : 0) - (noise2(fx * fine2, fz * fine2, 73) < 0.3 ? 1 : 0);
        }

        // How high: the same terraces as the coarse picture, their edges following the smooth ground.
        let h;
        const paved = pf & (PF.ROAD | PF.PAVED | PF.WALL | PF.PIER);
        if (fixed) h = hf;
        else if (farmed || paved) h = quant(hf);
        else {
          let wob = (noise2(bx / 11, bz / 11, 3) - 0.5) * 2.4 + (noise2(bx / 4.3, bz / 4.3, 4) - 0.5) * 1.0;
          if (b === B.ROCK || b === B.SNOW) {
            wob += (noise2(bx / 9, bz / 7, 21) - 0.5) * 5;
            h = 5 * Math.round((hf + wob - 1) / 5) + 1;
          } else {
            if (b === B.HIGHLAND) wob += (noise2(bx / 5, bz / 5, 21) - 0.5) * 2.5;
            h = quant(hf + wob);
          }
          if (b === B.BEACH) h = 1;
          else if (-sdAt(x, z) < 0.06) h = Math.min(h, 2);
        }
        let hv = h * F;
        if (pf & PF.WALL) {
          b = B.MASON;
          const tower = pf & PF.TOWER;
          hv += (tower ? 9 : 6) * F;
          // Battlements: merlons along the outer edge of the walk, taller ones on the towers.
          if (F >= 4 && verge[k] && ((fx + fz) / Math.max(2, F * 0.5) | 0) % 2 === 0) hv += Math.round(F * (tower ? 0.8 : 0.6));
          level = verge[k] ? 4 : 3 - (hash2(fx / Math.max(1, F >> 1) | 0, fz / Math.max(1, F >> 1) | 0, 161) < 0.25 ? 1 : 0);
        } else if (pf & PF.PIER) {
          b = B.PLANK;
          level = ((fx / Math.max(1, F >> 1)) | 0) & 1 ? 3 : 2;
          if (verge[k]) level = 1;
        } else if (pf & (PF.ROAD | PF.PAVED)) {
          b = pf & PF.PAVED ? B.PAVED : B.ROAD;
          if (verge[k]) level = 1;
          else if (b === B.PAVED && F >= 4) { // flagstones
            const q = Math.max(2, Math.round(F * 0.6)), row = (fz / q) | 0, col = ((fx + (row & 1) * (q >> 1)) / q) | 0;
            level = fz % q === 0 || (fx + (row & 1) * (q >> 1)) % q === 0 ? 2 : 3 + (hash2(col, row, 163) < 0.3 ? 1 : 0);
          } else level = 3 + (noise2(fx * fine2, fz * fine2, 162) > 0.62 ? 1 : 0) - (F >= 4 && hash2(fx >> 1, fz >> 1, 164) < 0.05 ? 1 : 0);
        } else if (P.flag[clamp(Math.round(bz), 0, GD - 1) * GW + clamp(Math.round(bx), 0, GW - 1)] & PF.TOWN && fixed && b !== B.YARD && b !== B.ROCK && b !== B.SNOW) {
          b = B.YARD;
          level = 3 - (noise2(fx * fine2, fz * fine2, 73) < 0.35 ? 1 : 0);
        } else if (fixed && bF[kb0] & F_KEEP && b !== B.ROCK && b !== B.SNOW) {
          b = B.YARD;
          level = 3 + (hash2(fx, fz, 72) < 0.06 ? 1 : 0) - (noise2(fx * fine2, fz * fine2, 73) < 0.3 ? 1 : 0);
        }
        // Rivers lie in the lowest ground beside them, and a road crosses on planks.
        if (riv[k] >= 2 && !(bF[kb0] & F_KEEP) && b !== B.MASON) {
          if (b === B.ROAD || b === B.PAVED || b === B.PLANK) { b = B.PLANK; level = ((fx + fz) / Math.max(1, F >> 1) | 0) & 1 ? 3 : 2; }
          else {
            b = B.RIVER;
            hv = Math.max(1, lowestBank(ci0, cj0) - 1) * F;
            level = riv[k] === 3 ? 0 : noise2(fx * fine2 * 0.5, fz * fine2 * 1.6, 83) > 0.7 ? 2 : 1;
          }
        }
        if (!look.texture && b !== B.RIVER) {
          // Clean card: a top is one tone, a field keeps only its broad rows, a way its edge.
          if (b === B.MASON) level = verge[k] ? 4 : 3;
          else if (pf & (PF.ROAD | PF.PAVED | PF.PIER)) level = verge[k] ? 2 : 3;
          else if (!farmed) level = 3;
          else if (level > 3) level = 3;
        }
        fH[k] = hv;
        fM[k] = b;
        fL[k] = level;
      }
    }

    // --- Shadows: the coarse map of how high the shade reaches, read smoothly between its cells ---
    const ceilB = (i, j) => (i > 0 && j > 0 && i < ew && j < ed ? sh[(j - 1) * ew + i - 1] - DROP8 : -30000);
    const shaded = (bx, bz, y8) => { // y8: height in coarse voxels, times 8
      const u = bx - ex0, v = bz - ez0, i = Math.floor(u), j = Math.floor(v), a = u - i, c = v - j;
      const top = ceilB(i, j) * (1 - a) + ceilB(i + 1, j) * a, bot = ceilB(i, j + 1) * (1 - a) + ceilB(i + 1, j + 1) * a;
      return top * (1 - c) + bot * c > y8;
    };

    // --- Flatten to pixels ---
    const X0 = gx0 * F, Z0 = gz0 * F, X1 = gx1 * F, Z1 = gz1 * F;
    const iw = X1 - X0;
    const iy0 = Math.floor(KZ * Z0) - Math.ceil(KY * MAXTOP * F);
    const ih = Math.ceil(KZ * Z1) + 2 - iy0;
    const img = new Uint32Array(iw * ih);
    const zb = new Uint16Array(iw * ih);
    const row = (fz, y) => Math.round(KZ * fz - KY * y) - iy0;
    // The landmarks that can throw a shadow into this piece, each answering for a point in fine voxels.
    const marks = landmarksAt(F);
    const casters = [];
    for (const lm of marks) {
      const f = lm.shadow ? lm.shadow(X0, Z0, X1, Z1) : null;
      if (f) casters.push(f);
    }
    const lmShade = casters.length === 0 ? null : (fx, y, fz) => {
      for (let n = 0; n < casters.length; n++) if (casters[n](fx, y, fz)) return true;
      return false;
    };
    const { TOP, WALL, SEA, RIVER, rock, stone } = look;
    const TOPALT = look.TOPALT || TOP;
    const rimW = look.rim ? Math.max(1, Math.round(F * look.rim)) : 1;
    const footW = Math.max(1, Math.round(F * 0.3));
    for (let fz = Z0; fz < Z1; fz++) {
      const j = fz - fz0, zr = fz - Z0 + 1, bz = toB(fz), z = (bz + 0.5) / S;
      for (let fx = X0; fx < X1; fx++) {
        const i = fx - fx0, k = j * fw + i, px = fx - X0;
        if (fM[k] === 255) continue;
        const h = fH[k], bx = toB(fx), x = (bx + 0.5) / S;
        let c;
        if (h === 0) { // sea
          const d = sdAt(x, z), dep = -elevAt(x, z);
          const w1 = noise2(bx / 27, bz / 21, 51) - 0.5, w2 = noise2(bx / 7.5, bz / 6.5, 52) - 0.5;
          const di = look.dither ? ((fx + fz) & 1 ? 0.022 : -0.022) : 0;
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
          if (shaded(bx, bz, 3) || (lmShade !== null && lmShade(fx, 0, fz))) c = look.shade(c);
          const p = row(fz, 0) * iw + px;
          img[p] = c;
          zb[p] = zr;
          continue;
        }
        const b = fM[k];
        const hs = fH[k + fw], hw = fH[k - 1], hn = fH[k - fw];
        const yTop = row(fz, h);
        let level = fL[k];
        const shade = shaded(bx, bz, (h / F) * 8 + 3) || (lmShade !== null && lmShade(fx, h, fz));
        if (b === B.RIVER) c = RIVER[shade ? 0 : level];
        else {
          // The lit rim of a ledge, and the dim strip at the foot of the one behind.
          if (hs < h || hw < h || (rimW > 1 && (fH[k + fw * rimW] < h || fH[k - rimW] < h || fH[k + rimW] < h))) level = Math.min(4, level + 1);
          else if (hn > h + F || (footW > 1 && (fH[k - fw * footW] > h + F || fH[k + footW] > h + F))) level = Math.max(0, level - 1);
          if (shade) level = Math.max(0, level - 2);
          c = (Math.round((h / F - 1) / 3) & 1 ? TOPALT : TOP)[b][level];
        }
        let p = yTop * iw + px;
        img[p] = c;
        zb[p] = zr;
        if (hs < h) { // the south face of a ledge
          const yB = Math.round(KZ * (fz + 1) - KY * hs) - iy0;
          const mason = b === B.MASON;
          const wr = b === B.RIVER ? null : mason ? stone : h - hs >= 7 * F ? rock : WALL[b]; // tall drops are bare cliff
          const wallShade = shaded(bx, bz + 1 / F, ((hs + h) / F) * 4) || (lmShade !== null && lmShade(fx, (hs + h) >> 1, fz + 1));
          const wl0 = 2 + fT[k] - (wallShade ? 1 : 0);
          const isRock = wr === rock;
          const bed = isRock ? Math.round((5 + ((hash2(Math.round(bx) >> 4, Math.round(bz) >> 5, 143) * 3) | 0)) * Math.max(1, F * 0.55)) : 0; // rows between bedding lines
          const crack = isRock && F >= 4 ? noise2(fx / (F * 1.7), bz / 3, 144) : 0;
          const course = Math.max(3, Math.round(F * 0.7));
          for (let y = yTop + 1; y < yB; y++) {
            const ay = y + iy0;
            let wl;
            if (mason) { // courses of dressed stone, the joints staggered
              const r = Math.floor(ay / course);
              wl = 3 - (wallShade ? 1 : 0) - (ay % course === 0 || (fx + (r & 1) * course) % (course * 2) === 0 ? 1 : 0) + (F >= 8 && hash2((fx + (r & 1) * course) / (course * 2) | 0, r, 145) < 0.2 ? 1 : 0);
            } else {
              wl = wl0 - (y === yB - 1 ? 1 : 0);
              if (look.texture) {
                wl += (hash2(fx / Math.max(1, F >> 2) | 0, h, 141) < 0.22 ? 1 : 0) - (hash2(fx >> 1, ay / Math.max(1, F >> 2) | 0, 142) < 0.18 ? 1 : 0);
                if (bed && (ay + ((fx / Math.max(1, F)) | 0) * 2) % bed < Math.max(1, F >> 2)) wl--;
                if (crack > 0.78) wl--;
                else if (y - yTop <= Math.max(1, F >> 2)) wl++; // the lit lip
              } else if (y - yTop <= rimW) wl++;
            }
            p = y * iw + px;
            img[p] = wr ? wr[clamp(wl, 0, 4)] : ((ay / Math.max(1, F >> 2)) & 1 ? RIVER[2] : SEA.foam); // rivers fall as white water
            zb[p] = zr;
          }
        }
      }
    }

    // --- Objects: each one rebuilt at this scale, standing where the coarse layout put it ---
    for (const o of lay.inst) {
      const m = o.st.at ? o.st.at(F) : null;
      if (!m) continue;
      const ox = o.x * F + (F >> 1), oz = o.z * F + (F >> 1);
      if (oz + 24 * F < Z0 || oz - 24 * F >= Z1 || ox + 24 * F < X0 || ox - 24 * F >= X1) continue;
      const gi = ox - fx0, gj = oz - fz0;
      const hb = o.hb === 0 ? 0 : gi >= 0 && gj >= 0 && gi < fw && gj < fd && fH[gj * fw + gi] > 0 ? fH[gj * fw + gi] : o.hb * F;
      const ramps = look.ramps(o.ramps);
      const lean = o.lean;
      const lvs = look.texture ? m.lv : m.lp;
      for (let v = 0; v < m.n; v++) {
        const fz = oz + m.dz[v];
        if (fz < Z0 || fz >= Z1) continue;
        const fx = ox + m.dx[v];
        if (fx < X0 || fx >= X1) continue;
        const y = hb + m.dy[v];
        const p = row(fz, y) * iw + fx - X0;
        const zr = fz - Z0 + 1;
        if (zb[p] > zr) continue;
        let level = lvs[v] + lean;
        level = level < 0 ? 0 : level > 4 ? 4 : level;
        if (shaded(toB(fx), toB(fz), (y / F) * 8 + 6) || (lmShade !== null && lmShade(fx, y, fz))) level = level > 2 ? level - 2 : 0;
        const c = ramps[m.part[v]][level];
        img[p] = c;
        zb[p] = zr;
        // A cube is a pixel wide but 1.4 tall on the picture (its top, then its front), and on a slope of
        // them (a roof, the shoulder of a dome) a pixel each leaves every third row open to whatever is
        // behind. So a cube also takes the pixel below, its front, unless something nearer has it.
        if (F > 1 && p + iw < img.length && zb[p + iw] < zr) { img[p + iw] = c; zb[p + iw] = zr; }
      }
    }

    // --- Landmarks ---
    const ctx = { img, zb, iw, ih, X0, Z0, X1, Z1, iy0, F, shaded, toB, look };
    for (const lm of marks) lm.draw(ctx);

    if (look.finish) look.finish({ img, zb, iw, ih, F });
    return { img, zb, iw, ih, ix0: X0, iy0: iy0 + OY * F, gz0: Z0 };
  }

  return { render };
}
