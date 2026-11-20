// The picture, as a pyramid of tiles in which every level is drawn, not shrunk or enlarged.
//
//   scale 1, 2, 4      the whole map, with 1, 2 and 4 pixels to the map pixel
//   scale 8, 16        round every town, landmark and minor place (and wherever else asked)
//   below scale 1      the scale-1 picture halved, and halved again, down to one tile
//
// Each scale is rendered by gen/fine.mjs from the same world, so zooming in swaps a picture of
// the scene for a finer picture of the same scene: a house gains its door, then its shutters.
//
// The whole-map scales are far too large to hold (scale 4 is 47,424 x 18,652). They are rendered
// in bands from north to south. Whatever a later band draws is nearer the camera, so it simply
// goes over what is there; a band's tall things reach up into the rows of the bands before it,
// so rows are kept until nothing further south can reach them, then cut into tiles and dropped.
//
// The finer scales are rendered place by place: the tiles a place needs are grouped into
// rectangles, and for each rectangle the ground that can show in it (its own, and whatever
// stands to the south and reaches up into it) is rendered and laid down in the same way.

import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './png.mjs';
import { KZ, KY } from './region.mjs';

const TILE = 512;

// Halve an image, keeping pixel-art crispness: each 2x2 block becomes its commonest colour.
function halve(src, w, h) {
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2);
  const out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x1 = Math.min(w - 1, x * 2 + 1), y1 = Math.min(h - 1, y * 2 + 1);
      const a = src[y * 2 * w + x * 2], b = src[y * 2 * w + x1], c = src[y1 * w + x * 2], d = src[y1 * w + x1];
      out[y * W + x] = a === b || a === c || a === d ? a : b === c || b === d ? b : c === d ? c : (x + y) & 1 ? a : d;
    }
  }
  return { data: out, w: W, h: H };
}

function writeTile(dir, tx, ty, px, w, h) {
  const png = encodePNG(w, h, new Uint8Array(px.buffer, px.byteOffset, w * h * 4));
  fs.writeFileSync(path.join(dir, `${tx}_${ty}.png`), png);
  return png.length;
}

export const FULL = [1, 2, 4], SPARSE = [8, 16];

// places: [{ x0, y0, x1, y1 }] in map pixels, the rectangles to draw at the finer scales.
// only: just these scales (they are independent, so several can be made at once, each by its own process).
// rows: [a, b), just these rows of tiles of a whole-map scale. part: [i, n], just every nth place, from the ith.
// Those let one scale be shared out between processes too (tools/pyramid.mjs does the sharing).
// What was made is noted in out/scale-<F>*.json; pyramidOf() reads the notes back as one pyramid.
const REACH = 330; // coarse rows: nothing stands so tall that it shows further north of its foot than this

// keep: add to what is there instead of clearing the level first (a few places drawn again); tag: what to call the note.
// spots: draw every scale the way the finer ones are drawn, tile by tile round the places only (with keep,
// that puts a reworked place back into a finished pyramid in a minute).
export function buildPyramid({ base, fine, look, out, places, lap = () => {}, only = null, rows = null, part = null, keep = false, tag: noteTag = null, spots = false }) {
  const { GW, GD, IW, IH, OY, MAXTOP } = base;
  const full = FULL, sparse = SPARSE;
  fs.mkdirSync(out, { recursive: true });
  const finest = Math.max(...full, ...sparse);
  const levelOf = (scale) => Math.log2(finest / scale);
  const levelDir = (scale) => {
    const d = path.join(out, String(levelOf(scale)));
    if (!rows && !part && !keep) fs.rmSync(d, { recursive: true, force: true }); // a shared-out scale is cleared by whoever shares it out
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const info = {}; // scale -> { w, h, cols, rows, tiles? }
  let bytes = 0, count = 0;
  let one = null; // the scale-1 picture, kept whole to be halved

  // --- The whole map at each of its scales ---
  for (const F of full) {
    if (spots || (only && !only.includes(F))) continue;
    const W = IW * F, H = IH * F;
    const dir = levelDir(F);
    const BANDC = Math.max(32, Math.floor(1024 / F)), BLOCKC = Math.max(256, Math.floor(8192 / F)); // coarse cells to a band, and to a block
    const over = Math.ceil(KY * MAXTOP * F);
    const SH = over + Math.ceil(KZ * BANDC * F) + TILE + 8;
    const strip = new Uint32Array(W * SH);
    const tyA = rows ? rows[0] : 0, tyB = rows ? Math.min(rows[1], Math.ceil(H / TILE)) : Math.ceil(H / TILE);
    const yEnd = Math.min(H, tyB * TILE);
    let sy0 = tyA * TILE; // the image row the strip starts at
    if (F === 1 && !rows) one = new Uint32Array(W * H);
    const flush = (upto) => { // cut every whole row of tiles above image row `upto`
      while (sy0 < yEnd && (sy0 + TILE <= upto || upto >= yEnd)) {
        const ty = sy0 / TILE, th = Math.min(TILE, H - sy0);
        for (let tx = 0; tx * TILE < W; tx++) {
          const tw = Math.min(TILE, W - tx * TILE);
          const px = new Uint32Array(tw * th);
          for (let y = 0; y < th; y++) px.set(strip.subarray(y * W + tx * TILE, y * W + tx * TILE + tw), y * tw);
          bytes += writeTile(dir, tx, ty, px, tw, th);
          count++;
        }
        if (one) one.set(strip.subarray(0, W * th), sy0 * W);
        strip.copyWithin(0, W * TILE);
        strip.fill(0, W * (SH - TILE));
        sy0 += TILE;
      }
    };
    // The ground that can show in these rows of tiles: from what lands on their top edge when flat and at
    // sea level, to as far south of their bottom edge as anything is tall.
    const gzA = rows ? Math.max(0, Math.floor(((tyA * TILE) / F - OY) / KZ / BANDC) * BANDC) : 0;
    const gzB = rows ? Math.min(GD, Math.ceil((yEnd / F - OY) / KZ) + REACH) : GD;
    for (let gz0 = gzA; gz0 < gzB; gz0 += BANDC) {
      const gz1 = Math.min(gzB, gz0 + BANDC);
      flush(Math.max(0, Math.floor(KZ * gz0 * F) - over + OY * F)); // nothing from here on reaches above this row
      for (let gx0 = 0; gx0 < GW; gx0 += BLOCKC) {
        const r = fine.render(gx0, gz0, Math.min(GW, gx0 + BLOCKC), gz1, F, look);
        for (let y = 0; y < r.ih; y++) {
          const Y = r.iy0 + y - sy0;
          if (Y < 0 || Y >= SH) continue;
          const so = y * r.iw, fo = Y * W + r.ix0;
          for (let x = 0; x < r.iw; x++) {
            const c = r.img[so + x];
            if (c) strip[fo + x] = c;
          }
        }
      }
      if ((gz0 / BANDC) % 8 === 7 || gz1 >= gzB) lap(`  scale ${F}: rows ${gz1} of ${gzB}`);
    }
    flush(H);
    info[F] = { w: W, h: H, cols: Math.ceil(W / TILE), rows: Math.ceil(H / TILE) };
    lap(`scale ${F}: ${info[F].cols * info[F].rows} tiles`);
  }

  // --- Round the places, finer ---
  for (const F of spots ? [...full, ...sparse] : sparse) {
    if (only && !only.includes(F)) continue;
    const W = IW * F, H = IH * F;
    const dir = levelDir(F);
    const span = TILE / F; // map pixels to a tile
    const want = new Set();
    for (const p of places) {
      for (let ty = Math.max(0, Math.floor(p.y0 / span)); ty <= Math.min(Math.ceil(H / TILE) - 1, Math.floor(p.y1 / span)); ty++) {
        for (let tx = Math.max(0, Math.floor(p.x0 / span)); tx <= Math.min(Math.ceil(W / TILE) - 1, Math.floor(p.x1 / span)); tx++) want.add(ty * 65536 + tx);
      }
    }
    // Group touching tiles, and take each group's rectangle (a town and its neighbour may share one).
    const seen = new Set();
    const rects = [];
    for (const k of want) {
      if (seen.has(k)) continue;
      let tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1;
      const todo = [k];
      seen.add(k);
      while (todo.length) {
        const q = todo.pop(), tx = q % 65536, ty = Math.floor(q / 65536);
        tx0 = Math.min(tx0, tx); tx1 = Math.max(tx1, tx); ty0 = Math.min(ty0, ty); ty1 = Math.max(ty1, ty);
        for (const n of [q - 1, q + 1, q - 65536, q + 65536]) if (want.has(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
      }
      rects.push([tx0, ty0, tx1, ty1]);
    }
    const done = new Set();
    const BLOCKC = Math.max(32, Math.floor(2048 / F));
    rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    rects.forEach(([tx0, ty0, tx1, ty1], n) => {
      if (part && n % part[1] !== part[0]) return;
      // Big rectangles are done a few rows of tiles at a time.
      for (let ta = ty0; ta <= ty1; ta += 4) {
        const tb = Math.min(ty1, ta + 3);
        const X0 = tx0 * TILE, Y0 = ta * TILE, RW = (tx1 - tx0 + 1) * TILE, RH = (tb - ta + 1) * TILE;
        const buf = new Uint32Array(RW * RH);
        const gxa = Math.max(0, Math.floor(X0 / F)), gxb = Math.min(GW, Math.ceil((X0 + RW) / F));
        // The ground that can show in these rows: from the row that lands on its top edge when flat and at sea
        // level, to well south of its bottom edge, for whatever stands there and reaches up into it.
        const gza = Math.max(0, Math.floor((Y0 / F - OY) / KZ) - 1), gzb = Math.min(GD, Math.ceil(((Y0 + RH) / F - OY) / KZ) + REACH);
        for (let gz0 = gza; gz0 < gzb; gz0 += BLOCKC) {
          for (let gx0 = gxa; gx0 < gxb; gx0 += BLOCKC) {
            const r = fine.render(gx0, gz0, Math.min(gxb, gx0 + BLOCKC), Math.min(gzb, gz0 + BLOCKC), F, look, { yMax: Y0 + RH });
            const xa = Math.max(0, X0 - r.ix0), xb = Math.min(r.iw, X0 + RW - r.ix0);
            for (let y = Math.max(0, Y0 - r.iy0); y < Math.min(r.ih, Y0 + RH - r.iy0); y++) {
              const so = y * r.iw, fo = (r.iy0 + y - Y0) * RW + r.ix0 - X0;
              for (let x = xa; x < xb; x++) {
                const c = r.img[so + x];
                if (c) buf[fo + x] = c;
              }
            }
          }
        }
        for (let ty = ta; ty <= tb; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          if (!want.has(ty * 65536 + tx) || done.has(ty * 65536 + tx)) continue;
          const tw = Math.min(TILE, W - tx * TILE), th = Math.min(TILE, H - ty * TILE);
          const px = new Uint32Array(tw * th);
          for (let y = 0; y < th; y++) px.set(buf.subarray(((ty - ta) * TILE + y) * RW + (tx - tx0) * TILE, ((ty - ta) * TILE + y) * RW + (tx - tx0) * TILE + tw), y * tw);
          bytes += writeTile(dir, tx, ty, px, tw, th);
          count++;
          done.add(ty * 65536 + tx);
        }
      }
      if (n % 10 === 9 || n === rects.length - 1) lap(`  scale ${F}: ${n + 1} of ${rects.length} places, ${done.size} tiles`);
    });
    // (A whole-map scale drawn in spots keeps the note it has: it is still whole.)
    if (sparse.includes(F)) info[F] = { w: W, h: H, cols: Math.ceil(W / TILE), rows: Math.ceil(H / TILE), tiles: [...done].map((k) => `${k % 65536}_${Math.floor(k / 65536)}`).sort() };
  }

  // --- Below scale 1: halvings ---
  const levels = [];
  if (one) {
    let cur = { data: one, w: IW, h: IH };
    for (let L = levelOf(1) + 1; ; L++) {
      cur = halve(cur.data, cur.w, cur.h);
      const dir = path.join(out, String(L));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const cols = Math.ceil(cur.w / TILE), rows = Math.ceil(cur.h / TILE);
      for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
        const tw = Math.min(TILE, cur.w - tx * TILE), th = Math.min(TILE, cur.h - ty * TILE);
        const px = new Uint32Array(tw * th);
        for (let y = 0; y < th; y++) px.set(cur.data.subarray((ty * TILE + y) * cur.w + tx * TILE, (ty * TILE + y) * cur.w + tx * TILE + tw), y * tw);
        bytes += writeTile(dir, tx, ty, px, tw, th);
        count++;
      }
      levels.push({ w: cur.w, h: cur.h, cols, rows });
      if (cols === 1 && rows === 1) break;
    }
  }
  const tag = noteTag ? `.${noteTag}` : rows ? `.r${rows[0]}` : part ? `.p${part[0]}` : '';
  for (const F of Object.keys(info)) fs.writeFileSync(path.join(out, `scale-${F}${tag}.json`), JSON.stringify({ level: info[F], below: Number(F) === 1 && !rows ? levels : undefined }));
  lap(`${look.name}: ${count} tiles, ${(bytes / 1e6).toFixed(0)} MB`);
}

// The pyramid in a folder, from the notes its scales left: what the viewer needs to know about it.
export function pyramidOf(out) {
  // A scale that was shared out left several notes: the same level, and for a finer scale each its own tiles.
  const note = (F) => {
    const all = fs.readdirSync(out).filter((f) => f === `scale-${F}.json` || f.startsWith(`scale-${F}.`)).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')));
    if (!all.length) throw new Error(`${out}: scale ${F} has not been made`);
    const level = { ...all[0].level };
    if (level.tiles) level.tiles = [...new Set(all.flatMap((a) => a.level.tiles))].sort();
    return { level, below: (all.find((a) => a.below) || {}).below };
  };
  const levels = [];
  for (const F of [...SPARSE, ...FULL].sort((a, b) => b - a)) levels.push(note(F).level);
  levels.push(...note(1).below);
  return { detail: Math.max(...SPARSE), base: Math.max(...FULL), ext: 'png', tile: TILE, levels };
}
