// The colour ramps everything is painted from. Each ramp runs from deep shadow
// (level 0) to highlight (level 4). Shadows drift towards blue-violet and
// highlights towards warm yellow, the way pixel artists build ramps by hand.

const hex = (s) => {
  const v = parseInt(s.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
// Colours are stored packed as 0xAABBGGRR so they can be written straight into a Uint32 view.
export const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
// The line drawn round sprites and moving figures: a darker, slightly bluer shade of whatever it runs
// along. (One near-black line all round made them look cut out of a different picture from the map.)
export const rim = (c) => pack(Math.round((c & 255) * 0.5), Math.round(((c >>> 8) & 255) * 0.48), Math.round(((c >>> 16) & 255) * 0.58));
const ramp = (...cols) => Uint32Array.from(cols.map((c) => pack(...hex(c))));

export const R = {
  // ground
  grass: ramp('#4a6f3f', '#6d9a48', '#9bbd58', '#c2d874', '#e0ec98'),
  forest: ramp('#35603c', '#4f8742', '#74a84c', '#9cc55e', '#c2de80'),
  scrub: ramp('#6a7040', '#96994c', '#bdb862', '#dbd380', '#efe6a4'),
  steppe: ramp('#86703f', '#b59a4c', '#d8bf66', '#eddb88', '#f9eeb0'),
  desert: ramp('#86563c', '#b67f48', '#dba762', '#f0c983', '#fce5aa'),
  beach: ramp('#978464', '#c8b17a', '#e7d298', '#f6e8b8', '#fff8dc'),
  highland: ramp('#586a50', '#7d9064', '#a3b27e', '#c4cf9c', '#dfe5bc'),
  rock: ramp('#565068', '#7b7488', '#a39ca6', '#c9c2c0', '#e9e4d8'),
  snow: ramp('#6979ad', '#9aacd5', '#ccdaf0', '#edf4fc', '#ffffff'),
  wheat: ramp('#78602f', '#a88838', '#d4b045', '#eed25e', '#fbea8c'),
  crop: ramp('#33603c', '#4c8b3f', '#76b148', '#a2d258', '#c9ea78'),
  soil: ramp('#4b3429', '#6e4b33', '#936943', '#b4895a', '#d0aa7a'),
  vine: ramp('#2c4a35', '#3f6c39', '#5d8c3f', '#86ab4b', '#b1c964'),
  road: ramp('#7a6448', '#a0855a', '#cdb88a', '#efe2bc', '#fbf3d8'),
  paved: ramp('#827c7c', '#a8a198', '#cbc4b2', '#e4decb', '#f6f2e4'),
  plank: ramp('#4f3526', '#74502f', '#9a703c', '#bb9250', '#d8b470'),
  // walls
  dirt: ramp('#4a3743', '#6f5250', '#967360', '#bb9a78', '#d9bf9a'),
  clay: ramp('#57302a', '#834730', '#ad693f', '#d09258', '#eaba7e'),
  // plants
  oak: ramp('#28502f', '#3d7738', '#5b9c40', '#86bd50', '#b6da6e'),
  oak2: ramp('#3a5a2a', '#598232', '#7ea63c', '#a8c650', '#d0e274'),
  pine: ramp('#1c4032', '#2b613e', '#408248', '#5fa256', '#8ac06c'),
  olive: ramp('#4a6450', '#688664', '#8ba67c', '#afc49a', '#d2dfbc'),
  cypress: ramp('#173a2e', '#225638', '#317442', '#49914c', '#6cae5e'),
  autumn: ramp('#57281b', '#893d1e', '#bc5c22', '#e2862d', '#f7b749'),
  palm: ramp('#1d482c', '#2d6e31', '#49983a', '#74be47', '#a8de62'),
  bush: ramp('#3a5236', '#557240', '#75914c', '#99ae60', '#bfc97e'),
  trunk: ramp('#281a1d', '#432820', '#603a26', '#80532f', '#9e6e40'),
  blossom: ramp('#8a3a6a', '#c0528a', '#e87aa8', '#f9a8c6', '#ffd6e4'),
  // buildings
  plaster: ramp('#77738f', '#a59fb3', '#d5ced1', '#f2ece1', '#ffffff'),
  roof: ramp('#682824', '#95372a', '#c6522e', '#e5753f', '#f59c5d'),
  stone: ramp('#4a4558', '#6e6878', '#958e96', '#bdb5ae', '#ddd6c6'),
  wood: ramp('#2a1b1c', '#48291f', '#6a4026', '#8e5c32', '#b07c44'),
  blue: ramp('#1c2a66', '#28458f', '#3a68bd', '#5a90e0', '#8fbbf5'),
};

// Sea, from the foam line out to the abyss.
export const SEA = {
  foam: pack(...hex('#f6fcf3'), 254),
  wet: pack(...hex('#d5f3e2'), 254),
  s1: pack(...hex('#aee8da'), 254),
  s2: pack(...hex('#7cd5d8'), 254),
  s3: pack(...hex('#55b8dc'), 254),
  mid: pack(...hex('#3f9bd3'), 254),
  sea: pack(...hex('#3585c8'), 254),
  deep: pack(...hex('#2e71ba'), 254),
  abyss: pack(...hex('#2960a8'), 254),
};
// Rivers carry alpha 253 and the sea 254, so later stages can tell fresh water from salt.
export const RIVER = [pack(...hex('#2f6fbd'), 253), pack(...hex('#55aee6'), 253), pack(...hex('#a5e2f6'), 253)];

// A five-level ramp grown from one base colour, for model parts that only say "this is gold".
const grown = new Map();
export function rampFrom(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let out = grown.get(key);
  if (out) return out;
  const mixTo = (t, k, tr, tg, tb) => pack(
    Math.round(Math.min(255, (r * (1 - t) + tr * t) * k)),
    Math.round(Math.min(255, (g * (1 - t) + tg * t) * k)),
    Math.round(Math.min(255, (b * (1 - t) + tb * t) * k)),
  );
  out = Uint32Array.of(
    mixTo(0.42, 0.52, 40, 30, 110),
    mixTo(0.26, 0.7, 50, 40, 120),
    mixTo(0.1, 0.86, 70, 60, 130),
    pack(r, g, b),
    mixTo(0.22, 1.08, 255, 250, 215),
  );
  grown.set(key, out);
  return out;
}

// Brightness of a surface with normal (nx, ny, nz): light from the upper left,
// tops brightest, fronts mid, east faces and undersides dark. Returns a level 0..4.
export function levelOf(nx, ny, nz, jitter = 0) {
  const b = 0.56 + 0.3 * ny - 0.26 * nx + 0.02 * nz + jitter;
  return b < 0.34 ? 0 : b < 0.5 ? 1 : b < 0.66 ? 2 : b < 0.8 ? 3 : 4;
}
