// The two ways the world is drawn. Both are the same scene from the same camera;
// a look only chooses the colours and the finish.
//
//   pixel   Pixel art. The hand-built ramps of palette.mjs, dithered sea, mottled
//           ground, streaked and bedded cliffs, and a dark line wherever something
//           stands in front of something else.
//   voxel   Clean stacked terraces, like a model cut from sheets of coloured card:
//           flat pastel tops, one tone to a face, a pale lip along every ledge and
//           a soft shade at its foot. No dither, no texture, no outlines.

import { R, SEA, RIVER, pack } from './palette.mjs';
import { TOP, WALL } from './region.mjs';

const un = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
const cache = (fn) => {
  const m = new Map();
  return (k) => {
    let v = m.get(k);
    if (v === undefined) m.set(k, v = fn(k));
    return v;
  };
};

// Towards the blue of shade, keeping what kind of pixel it is (the alpha).
const shadeOf = (t) => cache((c) => {
  const [r, g, b, a] = un(c);
  return pack(Math.round(r + (24 - r) * t), Math.round(g + (40 - g) * t), Math.round(b + (110 - b) * t), a);
});

// A dark line along the nearer side of every edge where one thing stands well in front of another.
function outline({ img, zb, iw, ih, F }) {
  if (F < 2) return;
  const gap = Math.max(4, Math.round(F * 2.2));
  const dark = cache((c) => {
    const [r, g, b, a] = un(c);
    return pack(Math.round(r * 0.56), Math.round(g * 0.54), Math.round(b * 0.66), a);
  });
  const edge = new Uint8Array(iw * ih);
  for (let y = 1; y < ih - 1; y++) {
    for (let x = 1; x < iw - 1; x++) {
      const p = y * iw + x, z = zb[p];
      if (!z || img[p] >>> 24 !== 255) continue; // water is not outlined
      const n = Math.min(zb[p - 1] || 65535, zb[p + 1] || 65535, zb[p - iw] || 65535);
      if (z - n >= gap) edge[p] = 1;
    }
  }
  for (let p = 0; p < edge.length; p++) if (edge[p]) img[p] = dark(img[p]);
}

const pixel = {
  name: 'pixel',
  TOP, WALL, SEA, RIVER, rock: R.rock, stone: R.stone,
  ramp: (r) => r,
  ramps: (list) => list,
  shade: shadeOf(0.3),
  dither: true,
  texture: true,
  rim: 0,
  finish: outline,
};

// --- The terraced look ---
// Two ways of taking a colour (level 3 of its ramp) to five flat tones.
const tones = (steps) => cache((ramp) => {
  const [r, g, b] = un(ramp[3]);
  return Uint32Array.from(steps, ([t, tr, tg, tb, k = 1]) => pack(Math.round(Math.min(255, (r + (tr - r) * t) * k)), Math.round(Math.min(255, (g + (tg - g) * t) * k)), Math.round(Math.min(255, (b + (tb - b) * t) * k))));
});
// The ground, sheets of card: 3 the top of a sheet, 4 the lip of its ledge in the sun, 2 down to 0 its cut
// edge, deeper as it turns from the light.
const sheet = tones([[0.5, 56, 62, 126, 0.82], [0.34, 76, 84, 140, 0.9], [0.18, 100, 104, 150, 0.96], [0.02, 255, 252, 235], [0.3, 255, 253, 238]]);
// What stands on it, lit by which way each face looks: 4 in full sun (a top, a west face) and no paler
// than its own colour, 2 a face out of the sun, 0 turned right away or in something's shadow.
const solid = tones([[0.6, 44, 46, 112, 0.74], [0.42, 62, 66, 130, 0.84], [0.24, 90, 94, 146, 0.93], [0.1, 118, 120, 158], [0.07, 255, 250, 226]]);
const softSea = {};
for (const [k, c] of Object.entries(SEA)) {
  const [r, g, b, a] = un(c);
  softSea[k] = pack(Math.round(r + (255 - r) * 0.04), Math.round(g + (255 - g) * 0.04), Math.round(b + (250 - b) * 0.02), a);
}
const lists = new Map();
// Every other terrace a shade paler, so the layers can be counted like sheets of card.
const paler = cache((ramp) => Uint32Array.from(ramp, (c) => {
  const [r, g, b] = un(c);
  return pack(Math.round(r + (255 - r) * 0.08), Math.round(g + (255 - g) * 0.08), Math.round(b + (250 - b) * 0.06));
}));
const voxel = {
  name: 'voxel',
  TOP: TOP.map((r) => r && sheet(r)),
  TOPALT: TOP.map((r) => r && paler(sheet(r))),
  // The edge of a sheet is the colour of the sheet, a tone deeper: not the brown earth of the pixel look.
  WALL: TOP.map((r) => r && sheet(r)),
  SEA: softSea, RIVER,
  rock: sheet(R.rock), stone: solid(R.stone),
  ramp: solid,
  ramps: (list) => {
    let out = lists.get(list);
    if (!out) lists.set(list, out = list.map(solid));
    return out;
  },
  shade: shadeOf(0.36),
  dither: false,
  texture: false,
  rim: 0.3,
  finish: null,
  view: { bloom: 0.5 }, // for the viewer: pale flat colour glows more than it should
};

export const LOOKS = { voxel, pixel }; // the first is the one a visitor sees first
