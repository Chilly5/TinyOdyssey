// The landmarks' moving parts, handed to Blender.
//
// Sisyphus and his boulder, the Cyclops and his rocks, the Clashing Rocks, the
// Minotaur in his maze: each landmark model declares the parts of itself that
// move (gen/landmarks.js). They used to be flattened into splats here, frame by
// frame, two pixels to the map pixel and one flat colour to the face, which
// looked coarse beside the painted map and the Blender-made units. Now each
// frame's splats are written out as what they stand for, small cubes in space,
// and units/anims.py builds them and renders them the way the units are
// rendered: lit, outlined, and several times finer.
//
// What Blender cannot know is the scenery. So the cubes that are behind
// something fixed (a wall of the maze, a temple column, a tree) are found here,
// exactly as before, and left out.
//
//   node gen/build.mjs --anims     ->  units/anims/src/<site>.json, one per animated landmark
//                                      units/anims/src/events.json, what happens at which frame
//
// events.json is not for Blender. It lists, for each landmark, the splashes its model asks for (the
// Cyclops's rock hitting the sea, the Clashing Rocks meeting) as [frame, x, y, size] in map pixels;
// gen/tiles.mjs puts them in the manifest and the viewer makes the splash when the frame comes round.
//
// A file holds: id, fps, n (frames), q (cubes to the map pixel, each way), box (the
// rectangle of the picture the animation ever touches, map pixels), pal (the colours
// used, 0xRRGGBB, with 0x1000000 added to those that glow) and frames. A frame is
// { vox } or { same: k } when it repeats frame k:
//   vox   four numbers a cube: cubes east of the box's left edge, cubes south of the
//         ground row that is drawn at the box's top edge, cubes of height, and its
//         colour's place in pal

import fs from 'node:fs';
import path from 'node:path';
import { KZ, KY } from './region.mjs';

// Played by the walking units instead (src/actors.js).
export const UNIT_PLAYED = ['sparta', 'olympia', 'nemea'];
const GLOW = 16;

export function exportAnims({ renderer, landmarks, rebake, q, dir, lap = () => {} }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const OY = renderer.OY;
  let files = 0, bytes = 0;
  const events = {};
  for (const lm of landmarks) {
    if (!lm.anim || UNIT_PLAYED.includes(lm.site.id)) continue;
    const big = rebake(lm.site);
    const n = Math.max(1, Math.round(lm.anim.period * lm.anim.fps));
    const poses = [];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    big.takeSplashes();
    for (let f = 0; f < n; f++) {
      const sp = big.pose(big.t0 + f / lm.anim.fps);
      poses.push(sp);
      for (const [x, y, size] of big.takeSplashes()) (events[lm.site.id] ||= []).push([f, Math.round(x / q), Math.round(y / q), Math.round(size * 8)]);
      for (let i = 0; i < sp.n; i++) {
        if (sp.x[i] < x0) x0 = sp.x[i];
        if (sp.x[i] > x1) x1 = sp.x[i];
        if (sp.z[i] < z0) z0 = sp.z[i];
        if (sp.z[i] > z1) z1 = sp.z[i];
      }
    }
    if (x0 > x1) continue;
    // Fixed scenery around it, with its depth. South of the model matters: that is what can stand in front.
    const gx0 = Math.floor((big.bx + x0) / q) - 2, gx1 = Math.ceil((big.bx + x1) / q) + 3;
    const r = renderer.renderRegion(gx0, Math.floor((big.bz + z0) / q) - 2, gx1, Math.ceil((big.bz + z1) / q) + 160);
    const top = r.iy0 - OY;
    const W = r.iw * q, H = r.ih * q;
    // Which cubes of each frame are in the open, and the rectangle of the picture they ever touch.
    let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
    const shown = poses.map((sp) => {
      const keep = [];
      for (let i = 0; i < sp.n; i++) {
        const gx = big.bx + sp.x[i], gz = big.bz + sp.z[i];
        const col = gx - gx0 * q, row = Math.round(KZ * gz - KY * (big.by + sp.y[i])) - top * q;
        if (col < 0 || col >= W || row < 0 || row >= H) continue;
        const zr1 = Math.floor(gz / q) - r.gz0 + 1; // its row, in the scenery's depth
        if (zr1 < 1 || r.zb[Math.floor(row / q) * r.iw + Math.floor(col / q)] > zr1) continue; // behind something
        keep.push(i);
        if (col < c0) c0 = col;
        if (col > c1) c1 = col;
        if (row < r0) r0 = row;
        if (row > r1) r1 = row;
      }
      return keep;
    });
    if (c1 < 0) continue;
    // In whole map pixels, with room for a cube's own size and an outline.
    const ix0 = gx0 + Math.floor(c0 / q) - 3, iy0 = r.iy0 + Math.floor(r0 / q) - 3;
    const ix1 = gx0 + Math.ceil((c1 + 1) / q) + 3, iy1 = r.iy0 + Math.ceil((r1 + 1) / q) + 3;
    const zref = Math.round(((iy0 - OY) / KZ) * q); // the ground row drawn at the box's top edge, in cubes
    const pal = [], palAt = new Map();
    const seen = new Map();
    const frames = poses.map((sp, f) => {
      const vox = [];
      for (const i of shown[f]) {
        const colour = sp.rgb[i] + (sp.level[i] & GLOW ? 0x1000000 : 0);
        let k = palAt.get(colour);
        if (k === undefined) { k = pal.length; pal.push(colour); palAt.set(colour, k); }
        vox.push(big.bx + sp.x[i] - ix0 * q, big.bz + sp.z[i] - zref, big.by + sp.y[i], k);
      }
      const key = vox.join(',');
      if (seen.has(key)) return { same: seen.get(key) };
      seen.set(key, f);
      return { vox };
    });
    const file = path.join(dir, `${lm.site.id}.json`);
    // The camera's row for the box's top edge is not a whole number of cubes: say how far off, in map pixels.
    fs.writeFileSync(file, JSON.stringify({ id: lm.site.id, fps: lm.anim.fps, n, q, box: [ix0, iy0, ix1, iy1], lift: (iy0 - OY) - (KZ * zref) / q, pal, frames }));
    files++;
    bytes += fs.statSync(file).size;
    lap(`  ${lm.site.id}: ${n} frames (${seen.size} distinct), about ${Math.round(shown.reduce((a, k) => a + k.length, 0) / n)} cubes each, box ${ix1 - ix0} x ${iy1 - iy0}`);
  }
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events));
  lap(`animation: ${files} landmarks written to ${dir}, ${(bytes / 1e6).toFixed(1)} MB; splashes at ${Object.keys(events).join(', ') || 'none'}`);
}
