// Shared map constants. Used by the browser app and by tools/build-terrain.mjs.
//
// The world is a pointy-top hex grid in "odd-r" offset layout. One world unit is
// one hex width (flat to flat), which is about 5 km on the ground.

export const LON_W = 10.0;
export const LON_E = 30.9;
export const LAT_S = 32.3;
export const LAT_N = 42.3;

const LAT0 = 37.3; // latitude where the east-west scale is true
export const DEG_PER_UNIT = 0.045; // degrees of latitude per world unit
export const COS0 = Math.cos((LAT0 * Math.PI) / 180);

// Landmarks are built at toy scale, then enlarged so they read from far away.
export const LANDMARK_SCALE = 1.75;

export const HEX_R = 1 / Math.sqrt(3); // circumradius of a hex of width 1
export const ROW_STEP = 1.5 * HEX_R;

export const COLS = Math.ceil(((LON_E - LON_W) * COS0) / DEG_PER_UNIT);
export const ROWS = Math.ceil((LAT_N - LAT_S) / DEG_PER_UNIT / ROW_STEP);

export const WORLD_W = COLS + 0.5;
export const WORLD_D = (ROWS - 1) * ROW_STEP + 2 * HEX_R;

// Encoding of the baked terrain bytes (3 per hex: land fraction, elevation, depth).
export const ELEV_STEP_M = 14; // metres per elevation count
export const DEPTH_SCALE = 3.5; // depth byte = sqrt(depth in m) * DEPTH_SCALE

export function lonLatToWorld(lon, lat) {
  return [((lon - LON_W) * COS0) / DEG_PER_UNIT, (LAT_N - lat) / DEG_PER_UNIT];
}

export function worldToLonLat(x, z) {
  return [LON_W + (x * DEG_PER_UNIT) / COS0, LAT_N - z * DEG_PER_UNIT];
}

export function hexCenterX(col, row) {
  return col + 0.5 + 0.5 * (row & 1);
}

export function hexCenterZ(row) {
  return row * ROW_STEP + HEX_R;
}

// Nearest hex to a world position. Returns [col, row], which may lie outside the grid.
export function worldToHex(x, z) {
  const r0 = Math.round((z - HEX_R) / ROW_STEP);
  let best = Infinity;
  let bc = 0;
  let br = 0;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const c0 = Math.round(x - 0.5 - 0.5 * (r & 1));
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const dx = hexCenterX(c, r) - x;
      const dz = hexCenterZ(r) - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bc = c;
        br = r;
      }
    }
  }
  return [bc, br];
}

// The six neighbours of a hex in odd-r layout, in order E, NE, NW, W, SW, SE.
const NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const NB_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
export function neighborOffsets(row) {
  return row & 1 ? NB_ODD : NB_EVEN;
}
