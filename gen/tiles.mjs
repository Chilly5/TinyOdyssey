// The full build: render the whole world in bands, cut it into a pyramid of
// tiles, and write everything the viewer needs into world/.

import fs from 'node:fs';
import path from 'node:path';
import { WORLD_W, WORLD_D } from '../src/config.js';
import { VOYAGE } from '../src/sites.js';
import { encodePNG, decodePNG } from './png.mjs';
import { buildLife } from './life.mjs';
import { buildRoutes } from './routes.mjs';
import { buildSprites } from './sprites.mjs';
import { KZ, KY } from './region.mjs';
import { rim } from './palette.mjs';
import { TILE, MODEL_PX } from './settings.mjs';
import { bakeLandmarks } from './bake.mjs';

// Ships, clouds and the landmarks' moving parts are drawn this many times finer than the map,
// so they do not look coarse against the painted picture.
export const FINE = 2;

// The same landmark sampled FINE times more densely, standing on the same spot.
export function finer({ renderer, fields, stamps, S }) {
  const fine = { S: S * FINE, OY: renderer.OY * FINE, quant: (h) => renderer.quant(h / FINE) * FINE, heightOf: (m) => renderer.heightOf(m) * FINE };
  return (site) => bakeLandmarks({ sites: [site], fields, renderer: fine, stamps, modelPx: MODEL_PX * FINE, snap: FINE }).landmarks[0];
}

// Halve an image, keeping pixel-art crispness: each 2x2 block becomes its commonest colour.
function halve(src, w, h) {
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2);
  const out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x1 = Math.min(w - 1, x * 2 + 1), y1 = Math.min(h - 1, y * 2 + 1);
      const a = src[y * 2 * w + x * 2], b = src[y * 2 * w + x1], c = src[y1 * w + x * 2], d = src[y1 * w + x1];
      // Two of a kind wins; otherwise take a different corner on alternate pixels so detail survives as texture.
      out[y * W + x] = a === b || a === c || a === d ? a : b === c || b === d ? b : c === d ? c : (x + y) & 1 ? a : d;
    }
  }
  return { data: out, w: W, h: H };
}

// Animation frames for the landmarks' moving parts. Each frame holds only the
// pixels of the parts that move, already hidden where fixed scenery stands in
// front of them, so the viewer can simply lay the current frame over the image.
//
// q > 1 draws the frames q times finer than the map (rebake gives the same landmark
// sampled that much more densely); the scenery that hides them is still the map's own.
function buildAnims({ renderer, landmarks, out, rebake, q = 1 }) {
  const PW = 2048, PH = 2048;
  const pages = [];
  let page = null, px = 1, py = 1, shelf = 0;
  const newPage = () => {
    page = new Uint32Array(PW * PH);
    pages.push(page);
    px = 1; py = 1; shelf = 0;
  };
  newPage();
  const anims = [];
  for (const lm of landmarks) {
    if (!lm.anim) continue;
    const big = q > 1 ? rebake(lm.site) : lm;
    const n = Math.max(1, Math.round(lm.anim.period * lm.anim.fps));
    const poses = [];
    for (let f = 0; f < n; f++) poses.push(big.pose(big.t0 + f / lm.anim.fps));
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const sp of poses) {
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
    const top = r.iy0 - renderer.OY;
    const W = r.iw * q, H = r.ih * q;
    const fc = new Uint32Array(W * H), fz = new Int32Array(W * H);
    const seen = new Map();
    const frames = [];
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const sp of poses) {
      const touched = [];
      for (let i = 0; i < sp.n; i++) {
        const gx = big.bx + sp.x[i], gz = big.bz + sp.z[i];
        const col = gx - gx0 * q, row = Math.round(KZ * gz - KY * (big.by + sp.y[i])) - top * q;
        if (col < 0 || col >= W || row < 0 || row >= H) continue;
        const zr1 = Math.floor(gz / q) - r.gz0 + 1; // its row, in the scenery's depth
        if (zr1 < 1 || r.zb[Math.floor(row / q) * r.iw + Math.floor(col / q)] > zr1) continue;
        const p = row * W + col, zr = gz - r.gz0 * q + 1;
        if (fz[p] > zr) continue;
        if (!fz[p]) touched.push(p);
        fz[p] = zr;
        fc[p] = sp.ramp[i][sp.level[i] & 7];
      }
      // An outline round the figure, in a darker shade of its own colours, wherever no scenery stands in front of it.
      const edge = [], edgeCol = [];
      for (const p of touched) {
        const c = p % W, rw = (p / W) | 0, zr1 = Math.floor((fz[p] - 1) / q) + 1;
        for (let d = 0; d < 4; d++) {
          const cc = c + (d === 0) - (d === 1), rr = rw + (d === 2) - (d === 3);
          if (cc < 0 || cc >= W || rr < 0 || rr >= H) continue;
          const n = rr * W + cc;
          if (fz[n] || r.zb[Math.floor(rr / q) * r.iw + Math.floor(cc / q)] > zr1) continue;
          fz[n] = -1;
          edge.push(n);
          edgeCol.push(rim(fc[p]));
        }
      }
      edge.forEach((n, i) => { fc[n] = edgeCol[i]; touched.push(n); });
      let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
      for (const p of touched) {
        const c = p % W, rw = (p / W) | 0;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
        if (rw < r0) r0 = rw;
        if (rw > r1) r1 = rw;
      }
      if (c1 < 0) { frames.push(0, 0, 0, 0, 0, 0, 0); continue; }
      const w = c1 - c0 + 1, h = r1 - r0 + 1;
      const data = new Uint32Array(w * h);
      for (const p of touched) data[(((p / W) | 0) - r0) * w + (p % W) - c0] = fc[p];
      for (const p of touched) { fz[p] = 0; fc[p] = 0; }
      const ix = gx0 + c0 / q, iy = r.iy0 + r0 / q; // in map pixels
      // Identical frames (a pause in the motion) share one picture.
      const key = [ix, iy, w, h, Buffer.from(data.buffer).toString('latin1')].join(',');
      let at = seen.get(key);
      if (!at) {
        if (px + w + 1 > PW) { px = 1; py += shelf + 1; shelf = 0; }
        if (py + h + 1 > PH) newPage();
        for (let y = 0; y < h; y++) page.set(data.subarray(y * w, (y + 1) * w), (py + y) * PW + px);
        at = [pages.length - 1, px, py];
        seen.set(key, at);
        px += w + 1;
        shelf = Math.max(shelf, h);
      }
      frames.push(at[0], at[1], at[2], w, h, ix, iy);
      bx0 = Math.min(bx0, ix); by0 = Math.min(by0, iy); bx1 = Math.max(bx1, ix + w / q); by1 = Math.max(by1, iy + h / q);
    }
    anims.push({ id: lm.site.id, fps: lm.anim.fps, n, q, box: [bx0, by0, bx1, by1], frames });
  }
  const files = pages.map((data, i) => {
    // Trim unused rows off the last sheet.
    const h = i === pages.length - 1 ? Math.min(PH, py + shelf + 2) : PH;
    const file = 'anim' + i + '.png';
    fs.writeFileSync(path.join(out, file), encodePNG(PW, h, new Uint8Array(data.buffer, 0, PW * h * 4)));
    return { file, w: PW, h };
  });
  return { anims, pages: files };
}

// How high the scenery stands at every pixel of the picture, as tiles of grey: 0 for sea and level
// ground at sea level, 1 a pixel of height, up to 255. The viewer compares it with where a figure
// stands to hide the parts of the figure that are behind a house, a wall, a tree or a hill.
// (What is kept from the render is how far south the thing at each pixel stands; with the pixel's
// own row that is the same as its height, and height is small and smooth, so it packs well.)
function writeOcclusion({ depth, IW, IH, OY, out }) {
  const T = 1024;
  const dir = path.join(out, 'occ');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cols = Math.ceil(IW / T), rows = Math.ceil(IH / T);
  const tiles = [];
  let bytes = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const tw = Math.min(T, IW - tx * T), th = Math.min(T, IH - ty * T);
      const px = new Uint8Array(tw * th * 4);
      let any = false;
      for (let y = 0; y < th; y++) {
        const fy = ty * T + y;
        for (let x = 0; x < tw; x++) {
          const d = depth[fy * IW + tx * T + x];
          const h = d ? Math.max(0, Math.min(255, Math.round((KZ * (d - 1) - (fy - OY)) / KY))) : 0;
          const o = (y * tw + x) * 4;
          px[o] = px[o + 1] = px[o + 2] = h;
          px[o + 3] = 255;
          if (h > 1) any = true;
        }
      }
      if (!any) continue; // open sea: nothing there to stand behind
      const png = encodePNG(tw, th, px);
      fs.writeFileSync(path.join(dir, `${tx}_${ty}.png`), png);
      bytes += png.length;
      tiles.push(`${tx}_${ty}`);
    }
  }
  return { info: { dir: 'occ', tile: T, cols, rows, ext: 'png', tiles }, bytes };
}

// Everything drawn over the picture: the sprite sheet (clouds, Icarus, the sea monster), the landmarks'
// animation frames, and the units rendered in Blender (units/build.py). Written into `out`; returns what
// the manifest says about them. Can be run again on a finished world without touching its tiles.
export function buildOverlays({ renderer, fields, sites, stamps, landmarks, S, root, out, lap, unitDir = path.join(root, 'units', 'out'), animDir = path.join(root, 'units', 'anims', 'out') }) {
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const k = byId.knossos, fall = byId.icaria;
  const sprites = buildSprites({ icarusHeading: Math.atan2(fall.z - (k.z - 1), fall.x - k.x), q: FINE });
  fs.writeFileSync(path.join(out, 'sprites.png'), encodePNG(sprites.w, sprites.h, new Uint8Array(sprites.atlas.buffer)));
  lap(`sprites ${sprites.w} x ${sprites.h}`);

  // The landmarks' moving parts: rendered in Blender if that has been done (gen/anims.mjs, units/anims.py),
  // otherwise flattened here as they used to be.
  let flip;
  const made = path.join(animDir, 'anims.json');
  if (fs.existsSync(made)) {
    const a = JSON.parse(fs.readFileSync(made, 'utf8'));
    let bytes = 0;
    for (const pg of a.pages) {
      const img = decodePNG(fs.readFileSync(path.join(animDir, pg.file)));
      const png = encodePNG(img.w, img.h, img.data);
      fs.writeFileSync(path.join(out, pg.file), png);
      bytes += png.length;
    }
    // What happens at which frame (splashes) comes straight from the exporter, not through Blender.
    const evFile = path.join(animDir, '..', 'src', 'events.json');
    const ev = fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : {};
    for (const an of a.anims) if (ev[an.id]) an.events = ev[an.id];
    flip = { anims: a.anims, pages: a.pages };
    lap(`animation: ${a.anims.length} landmarks from Blender on ${a.pages.length} sheets, ${(bytes / 1e6).toFixed(1)} MB`);
  } else {
    flip = buildAnims({ renderer, landmarks, out, rebake: finer({ renderer, fields, stamps, S }), q: FINE });
    lap(`animation: ${flip.anims.length} landmarks, ${flip.anims.reduce((a, b) => a + b.n, 0)} frames, ${flip.pages.length} sheet(s)`);
  }

  let units = null;
  if (fs.existsSync(path.join(unitDir, 'units.json'))) {
    units = JSON.parse(fs.readFileSync(path.join(unitDir, 'units.json'), 'utf8'));
    let bytes = 0;
    for (const pg of units.pages) {
      const img = decodePNG(fs.readFileSync(path.join(unitDir, pg.file)));
      const png = encodePNG(img.w, img.h, img.data); // Blender writes them barely compressed
      fs.writeFileSync(path.join(out, pg.file), png);
      bytes += png.length;
    }
    lap(`units: ${Object.keys(units.units).length} kinds on ${units.pages.length} sheets, ${(bytes / 1e6).toFixed(1)} MB`);
  } else lap('units: none (run units/build.py in Blender to make them)');
  return { sprites: { file: 'sprites.png', w: sprites.w, h: sprites.h, frames: sprites.meta }, anims: flip.anims, animPages: flip.pages, units };
}

// keepPicture: the folder already holds a finished world; redo everything in it except the picture
// itself (the painted tiles and what the manifest says about them).
export async function buildWorld({ renderer, fields, sites, stamps, landmarks, effects, S, root, lap, dir = 'world', keepPicture = false }) {
  const { GW, GD, IW, IH, OY } = renderer;
  const out = path.join(root, dir);
  let old = null;
  if (keepPicture) {
    old = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    for (const pg of [old.sprites, ...(old.animPages || []), ...((old.units && old.units.pages) || [])]) if (pg) fs.rmSync(path.join(out, pg.file), { force: true });
  } else fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // --- The image -----------------------------------------------------------------
  const full = new Uint32Array(keepPicture ? 1 : IW * IH);
  // How far south the thing shown at each pixel stands (its ground row + 1). The people use it
  // to know when they are behind a building or a tree.
  const depth = new Uint16Array(IW * IH);
  const BAND = 640;
  for (let z0 = 0; z0 < GD; z0 += BAND) {
    const z1 = Math.min(GD, z0 + BAND);
    const r = renderer.renderRegion(0, z0, GW, z1);
    for (let y = 0; y < r.ih; y++) {
      const fy = r.iy0 + y;
      if (fy < 0 || fy >= IH) continue;
      const so = y * r.iw, fo = fy * IW;
      for (let x = 0; x < r.iw; x++) {
        const c = r.img[so + x];
        if (c) {
          if (!keepPicture) full[fo + x] = c;
          depth[fo + x] = Math.min(65535, r.gz0 + r.zb[so + x]);
        }
      }
    }
    lap(`rendered rows ${z0}..${z1} of ${GD}`);
  }

  // --- Tiles ---------------------------------------------------------------------
  const levels = keepPicture ? old.levels : [];
  let cur = { data: full, w: IW, h: IH };
  let bytes = 0, count = 0;
  for (let L = 0; !keepPicture; L++) {
    const dir = path.join(out, 'tiles', String(L));
    fs.mkdirSync(dir, { recursive: true });
    const cols = Math.ceil(cur.w / TILE), rows = Math.ceil(cur.h / TILE);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const tw = Math.min(TILE, cur.w - tx * TILE), th = Math.min(TILE, cur.h - ty * TILE);
        const px = new Uint32Array(tw * th);
        for (let y = 0; y < th; y++) px.set(cur.data.subarray((ty * TILE + y) * cur.w + tx * TILE, (ty * TILE + y) * cur.w + tx * TILE + tw), y * tw);
        const png = encodePNG(tw, th, new Uint8Array(px.buffer));
        fs.writeFileSync(path.join(dir, `${tx}_${ty}.png`), png);
        bytes += png.length;
        count++;
      }
    }
    levels.push({ w: cur.w, h: cur.h, cols, rows });
    if (cols === 1 && rows === 1) break;
    cur = halve(cur.data, cur.w, cur.h);
  }
  if (!keepPicture) lap(`${count} tiles, ${(bytes / 1e6).toFixed(1)} MB, ${levels.length} levels`);
  const occ = writeOcclusion({ depth, IW, IH, OY, out });
  lap(`occlusion: ${occ.info.tiles.length} tiles, ${(occ.bytes / 1e6).toFixed(1)} MB`);

  // --- Sea field for the animated water: distance to shore and depth ------------------
  const FR = 4;
  const fw = Math.ceil(WORLD_W * FR), fh = Math.ceil(WORLD_D * FR);
  const field = new Uint8Array(fw * fh * 4);
  for (let j = 0; j < fh; j++) {
    for (let i = 0; i < fw; i++) {
      const x = (i + 0.5) / FR, z = (j + 0.5) / FR;
      const d = fields.sdAt(x, z), dep = Math.max(0, -fields.elevAt(x, z));
      const k = (j * fw + i) * 4;
      field[k] = Math.round(Math.max(0, Math.min(1, d / 3 + 0.25)) * 255); // -0.75 .. 2.25 units
      field[k + 1] = Math.round(Math.min(1, Math.sqrt(dep) / 70) * 255);
      field[k + 2] = 0;
      field[k + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(out, 'sea.png'), encodePNG(fw, fh, field));

  // --- Everything drawn over the picture, and where it all goes -------------------------
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const k = byId.knossos, fall = byId.icaria;
  const over = buildOverlays({ renderer, fields, sites, stamps, landmarks, S, root, out, lap });
  const { units } = over;
  const life = buildLife({ renderer, fields, sites });
  fs.writeFileSync(path.join(out, 'life.json'), JSON.stringify(life));
  lap(`life: ${life.roads.length} roads, ${life.towns.length} towns, ${life.herds.length} herds, ${life.myths.length} creatures, ${life.fishers.length} fishing boats, ${life.lights.length / 3} lamps, ${(fs.statSync(path.join(out, 'life.json')).size / 1024).toFixed(0)} KB`);

  const routes = buildRoutes({ fields, sites });
  const sea = ([x, z]) => [Math.round(x * S * 10) / 10, Math.round((OY + KZ * z * S) * 10) / 10];
  const line = (pts) => pts.map(sea).flat();
  lap('routes');

  // --- Manifest ----------------------------------------------------------------------
  const manifest = {
    version: Date.now().toString(36),
    w: IW, h: IH, tile: TILE, levels,
    px: S, oy: OY, kz: KZ, ky: KY, kmPerPx: 5 / S,
    sea: { file: 'sea.png', w: fw, h: fh, res: FR },
    sprites: over.sprites,
    sites: sites.map((s) => {
      const hv = s.sea ? 0 : renderer.quant(renderer.heightOf(Math.max(1, s.elev)));
      const lm = landmarks.find((l) => l.site.id === s.id);
      return {
        id: s.id,
        x: Math.round(s.x * S),
        y: Math.round(OY + KZ * s.z * S - KY * hv),
        top: lm ? lm.height : 6,
        bot: lm ? lm.below : 8,
        r: Math.round((s.R || 0.6) * S),
      };
    }),
    anims: over.anims, animPages: over.animPages,
    units, life: 'life.json', occ: occ.info,
    effects: effects.map((e) => ({ ...e, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10 })),
    voyage: {
      stops: routes.stops.map(sea),
      legs: routes.legs.map(line),
    },
    routes: { argo: line(routes.argo), theseus: line(routes.theseus), lanes: routes.lanes.map(line) },
    flights: {
      pegasus: sea(byIdCenter(byId, 'thebes')),
      icarus: [...sea([k.x, k.z - 1]), ...sea([fall.x, fall.z])],
    },
  };
  if (old) { // the picture is not ours to describe
    if (old.paint) manifest.paint = old.paint;
    if (old.look) manifest.look = old.look;
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  lap(`manifest ${(fs.statSync(path.join(out, 'manifest.json')).size / 1024).toFixed(0)} KB`);
  console.log(`World: ${IW} x ${IH} px (${((IW * IH) / 1e6).toFixed(0)} MP), ${VOYAGE.length} voyage stops, ${landmarks.length} landmarks.`);
}

function byIdCenter(byId, id) {
  return [byId[id].x - 1.2, byId[id].z - 0.5];
}
