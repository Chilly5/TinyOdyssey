// Turns the baked terrain bytes into the playable hex grid: which hexes are land,
// how tall each one stands, how far it is from the coast and what grows on it.

import { TERRAIN_B64 } from '../data/terrain.js';
import {
  COLS, ROWS, ELEV_STEP_M, DEPTH_SCALE, LANDMARK_SCALE, lonLatToWorld, worldToLonLat, worldToHex,
  hexCenterX, hexCenterZ, neighborOffsets,
} from './config.js';
import { fbm, noise2, smoothstep, clamp } from './util.js';

export const Y_STEP = 0.14; // terrain heights are terraced in steps of this size
export const BIOME = {
  SEA: 0, BEACH: 1, DESERT: 2, STEPPE: 3, SCRUB: 4, MEADOW: 5, FOREST: 6, HIGHLAND: 7, ROCK: 8, SNOW: 9,
};

// Narrow straits the 5 km hexes would otherwise close. Each is a lon/lat polyline.
const STRAITS = [
  [[26.15, 40.02], [26.3, 40.08], [26.4, 40.17], [26.55, 40.28], [26.75, 40.43]], // Hellespont
  [[28.98, 41.01], [29.04, 41.08], [29.07, 41.15], [29.12, 41.23]], // Bosporus
  [[15.57, 38.02], [15.6, 38.13], [15.64, 38.24], [15.68, 38.3]], // Strait of Messina
  [[21.72, 38.31], [21.82, 38.33]], // Rion narrows, mouth of the Gulf of Corinth
  [[23.59, 38.46], [23.6, 38.47]], // Euripus, between Euboea and the mainland
];

// Islets too small to survive the sampling but too storied to lose: [lon, lat, metres].
const ISLETS = [
  [25.27, 37.4, 90], // Delos
  [14.43, 40.58, 50], // Li Galli, the Sirens' rocks
];

// Metres above the sea to world height. Vertical scale is exaggerated about eight times.
export function elevToY(m) {
  const t = Math.min(1.15, m / 3000);
  return Y_STEP + t ** 1.2 * 6.4 + Math.min(m, 400) * 0.0012;
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function buildGrid(sites) {
  const bin = atob(TERRAIN_B64);
  const N = COLS * ROWS;
  const frac = new Float32Array(N);
  const elev = new Float32Array(N); // metres
  const depth = new Float32Array(N); // metres, positive down
  for (let i = 0; i < N; i++) {
    frac[i] = bin.charCodeAt(i * 3) / 255;
    elev[i] = bin.charCodeAt(i * 3 + 1) * ELEV_STEP_M;
    depth[i] = (bin.charCodeAt(i * 3 + 2) / DEPTH_SCALE) ** 2;
  }

  const idx = (c, r) => r * COLS + c;
  const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const forNeighbors = (c, r, fn) => {
    const nb = neighborOffsets(r);
    for (let k = 0; k < 6; k++) {
      const nc = c + nb[k][0], nr = r + nb[k][1];
      if (inside(nc, nr)) fn(idx(nc, nr), nc, nr, k);
    }
  };

  // --- Land or sea -------------------------------------------------------
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = frac[i] >= 0.45 ? 1 : 0;
  // Keep small islands as a single hex: the local peak of a patch of partial land.
  const islet = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      if (land[i] || frac[i] < 0.13) continue;
      let ok = true;
      forNeighbors(c, r, (j) => {
        if (land[j] || frac[j] > frac[i] || (frac[j] === frac[i] && j < i)) ok = false;
      });
      if (ok) islet.push(i);
    }
  }
  for (const i of islet) land[i] = 1;

  for (const line of STRAITS) {
    const pts = line.map(([lon, lat]) => lonLatToWorld(lon, lat));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (distToPolyline(hexCenterX(c, r), hexCenterZ(r), pts) < 0.56) {
          const i = idx(c, r);
          land[i] = 0;
          depth[i] = Math.max(depth[i], 60);
        }
      }
    }
  }
  for (const [lon, lat, m] of ISLETS) {
    const [c, r] = worldToHex(...lonLatToWorld(lon, lat));
    if (inside(c, r)) {
      land[idx(c, r)] = 1;
      elev[idx(c, r)] = Math.max(elev[idx(c, r)], m);
    }
  }

  // --- Distance to the coast, in hex steps (positive on land, on sea too) ---
  const coast = new Int16Array(N).fill(-1);
  let frontier = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      let edge = false;
      forNeighbors(c, r, (j) => {
        if (land[j] !== land[i]) edge = true;
      });
      if (edge) {
        coast[i] = 1;
        frontier.push(i);
      }
    }
  }
  for (let d = 2; frontier.length && d < 60; d++) {
    const next = [];
    for (const i of frontier) {
      const c = i % COLS, r = (i / COLS) | 0;
      forNeighbors(c, r, (j) => {
        if (coast[j] < 0) {
          coast[j] = d;
          next.push(j);
        }
      });
    }
    frontier = next;
  }
  for (let i = 0; i < N; i++) if (coast[i] < 0) coast[i] = 60;

  // --- Heights -------------------------------------------------------------
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    // Shores sit low so beaches read as beaches; inland keeps its real relief.
    const m = coast[i] === 1 ? Math.min(elev[i], 260) : elev[i];
    y[i] = Math.max(Y_STEP, Math.round(elevToY(m) / Y_STEP) * Y_STEP);
  }

  // Level the ground under landmarks and keep trees off it.
  const clear = new Uint8Array(N);
  for (const s of sites) {
    let [sx, sz] = lonLatToWorld(s.lon, s.lat);
    let [c0, r0] = worldToHex(sx, sz);
    if (s.peak) {
      // Move to the highest hex within two steps, so summit landmarks sit on the summit.
      let best = -1;
      for (let r = r0 - 2; r <= r0 + 2; r++) {
        for (let c = c0 - 2; c <= c0 + 2; c++) {
          if (inside(c, r) && land[idx(c, r)] && y[idx(c, r)] > best) {
            best = y[idx(c, r)];
            sx = hexCenterX(c, r);
            sz = hexCenterZ(r);
          }
        }
      }
      [c0, r0] = worldToHex(sx, sz);
    }
    s.x = sx;
    s.z = sz;
    const flat = (s.flat || 0) * LANDMARK_SCALE;
    const raise = s.raise ?? flat > 0; // make ground under the whole footprint, even over water
    const reach = Math.ceil(flat + 2);
    let base = null;
    if (inside(c0, r0) && land[idx(c0, r0)]) base = y[idx(c0, r0)];
    if (s.sea) base = null;
    if (s.baseY != null) base = s.baseY;
    if (base != null && s.maxY != null) base = Math.min(base, s.maxY);
    if (base != null && s.minY != null) base = Math.max(base, s.minY);
    if (base == null && raise) base = Y_STEP * 2;
    if (base != null) base = Math.round(base / Y_STEP) * Y_STEP;
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (!inside(c, r)) continue;
        const i = idx(c, r);
        const d = Math.hypot(hexCenterX(c, r) - sx, hexCenterZ(r) - sz);
        if (raise && d <= flat && !land[i]) {
          land[i] = 1; // a landmark that needs ground where the data has sea
          y[i] = base ?? Y_STEP * 2;
        }
        if (!land[i]) continue;
        if (flat > 0 && base != null) {
          if (d <= flat) y[i] = base;
          else if (d <= flat + 1.2) y[i] = Math.round((y[i] * 0.5 + base * 0.5) / Y_STEP) * Y_STEP;
        }
        if (d <= flat + 0.55) clear[i] = 1;
      }
    }
    s.y = base ?? 0;
  }

  // --- Biomes ----------------------------------------------------------------
  const biome = new Uint8Array(N);
  const moist = new Float32Array(N);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      if (!land[i]) continue;
      const x = hexCenterX(c, r), z = hexCenterZ(r);
      const [lon, lat] = worldToLonLat(x, z);
      const m = elev[i];
      const n = fbm(x * 0.07, z * 0.07, 4, 11);
      const n2 = noise2(x * 0.45, z * 0.45, 5);
      let M = 0.47;
      M -= 0.13 * smoothstep(22.6, 23.6, lon) * smoothstep(26.5, 25, lon) * smoothstep(36.3, 37.2, lat) * smoothstep(40, 39, lat); // rain shadow: Attica, Euboea
      M += 0.24 * smoothstep(37.6, 41.6, lat); // the north is greener
      M += 0.12 * smoothstep(22.3, 20.4, lon) * smoothstep(36.4, 38, lat); // rainy Ionian side
      M += 0.2 * smoothstep(250, 1100, m); // mountains catch rain
      M -= 0.8 * smoothstep(35.0, 33.5, lat); // Africa
      if (lon > 20 && lon < 23.4 && lat < 33.3) M += 0.42 * smoothstep(120, 520, m); // Jebel Akhdar
      const cyc = smoothstep(23.8, 24.6, lon) * smoothstep(27.6, 26.6, lon) * smoothstep(35.9, 36.4, lat) * smoothstep(38.3, 37.6, lat);
      M -= 0.2 * cyc; // the dry Cyclades
      M -= 0.24 * smoothstep(27.6, 30.6, lon) * smoothstep(5, 20, coast[i]); // Anatolian plateau
      M += (n - 0.5) * 0.62 + (n2 - 0.5) * 0.1;
      moist[i] = M;

      let slope = 0;
      forNeighbors(c, r, (j) => {
        slope = Math.max(slope, Math.abs(y[i] - y[j]));
      });
      const snowline = 2050 + (n - 0.5) * 500 - smoothstep(37, 42, lat) * 250;
      let b;
      if (m > snowline) b = BIOME.SNOW;
      else if (m > 1500 + (n2 - 0.5) * 300 || (slope > 1.25 && m > 500)) b = BIOME.ROCK;
      else if (m > 1050 + (n - 0.5) * 300) b = BIOME.HIGHLAND;
      else if (coast[i] === 1 && m < 90 && n2 > 0.3) b = BIOME.BEACH;
      else if (M < 0.18) b = BIOME.DESERT;
      else if (M < 0.37) b = BIOME.STEPPE;
      else if (M < 0.53) b = BIOME.SCRUB;
      else if (M < 0.66) b = BIOME.MEADOW;
      else b = BIOME.FOREST;
      biome[i] = b;
    }
  }

  // Break mountain tops into jagged columns so ranges read as crags, not plateaus.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      if (!land[i] || clear[i]) continue;
      const b = biome[i];
      const amp = b === BIOME.SNOW ? 0.95 : b === BIOME.ROCK ? 0.8 : b === BIOME.HIGHLAND ? 0.3 : 0;
      if (amp) y[i] = Math.max(Y_STEP, Math.round((y[i] + (noise2(c * 0.9, r * 0.9, 21) - 0.35) * amp * 1.6) / Y_STEP) * Y_STEP);
    }
  }

  // Hillshade: slopes facing the sun (east and south) are lighter, the far sides darker.
  const hill = new Float32Array(N).fill(1);
  const DX = [1, 0.5, -0.5, -1, -0.5, 0.5];
  const DZ = [0, -0.866, -0.866, 0, 0.866, 0.866];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      if (!land[i]) continue;
      let gx = 0, gz = 0;
      forNeighbors(c, r, (j, nc, nr, k) => {
        const dy = (land[j] ? y[j] : 0) - y[i];
        gx += dy * DX[k];
        gz += dy * DZ[k];
      });
      gx /= 3 * 2.2;
      gz /= 3 * 2.2;
      const l = Math.hypot(gx, 1, gz);
      const lit = (-gx * 0.62 + 0.7 - gz * 0.36) / l / 0.7;
      hill[i] = clamp(1 + (lit - 1) * 0.75, 0.7, 1.2);
    }
  }

  const grid = {
    cols: COLS, rows: ROWS, land, y, elev, depth, coast, biome, moist, clear, hill,
    idx, inside, forNeighbors,
    isLand: (c, r) => inside(c, r) && land[idx(c, r)] === 1,
    // Terrain height under a world position (0 over the sea).
    heightAt(x, z) {
      const [c, r] = worldToHex(x, z);
      return inside(c, r) ? y[idx(c, r)] : 0;
    },
    landAt(x, z) {
      const [c, r] = worldToHex(x, z);
      return inside(c, r) && land[idx(c, r)] === 1;
    },
  };
  return grid;
}
