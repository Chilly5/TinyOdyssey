// Renders the world.
//
//   node gen/build.mjs [--out DIR]             full render into world/ (or another folder)
//   node gen/build.mjs --refresh [--out DIR]   redo everything but the picture in a world already built and painted
//   node gen/build.mjs --overlays [--out DIR]  redo only what is drawn over the picture (sprites, animation, units)
//   node gen/build.mjs --anims                 the landmarks' moving parts, for Blender (units/anims.py), into units/anims/src
//   node gen/build.mjs --cond [--out DIR]      what the painter is shown, into paint/work/cond
//   node gen/build.mjs --spots                 the places to paint in finer detail, into paint/work/spots.json
//   node gen/build.mjs --preview LON,LAT,W,H --out FILE.png    a W x H pixel window centred on a place
//
// Options: --s N (pixels per world unit, default from gen/settings.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToWorld } from '../src/config.js';
import { SITES } from '../src/sites.js';
import { loadDem } from './dem.mjs';
import { buildFields } from './fields.mjs';
import { buildStamps } from './stamps.mjs';
import { createRenderer, KZ } from './region.mjs';
import { encodePNG } from './png.mjs';
import { bakeLandmarks } from './bake.mjs';
import { PX_PER_UNIT, MODEL_PX } from './settings.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const S = Number(arg('s', PX_PER_UNIT));
const t0 = Date.now();
const lap = (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);

const dem = await loadDem();
const sites = SITES.map((s) => ({ ...s }));
const fields = buildFields(dem, sites, { modelUnit: MODEL_PX / S, px: S });
lap(`fields, ${fields.rivers.length} river runs`);
const stamps = buildStamps();
lap('stamps');
const landmarks = [];
const renderer = createRenderer({ fields, sites, stamps, S, landmarks, rivers: fields.rivers, lap });
const baked = bakeLandmarks({ sites, fields, renderer, stamps, modelPx: MODEL_PX });
landmarks.push(...baked.landmarks);
lap(`landmarks: ${landmarks.length} models, ${baked.effects.length} effects`);

const preview = arg('preview');
const sheet = arg('sheet');
if (sheet) {
  // node gen/build.mjs --sheet FILE.png [--from N --count N]: every landmark in a grid.
  const CW = 340, CH = 250, COLS = 4;
  const list = landmarks.slice(Number(arg('from', 0)), Number(arg('from', 0)) + Number(arg('count', 16)));
  const rows = Math.ceil(list.length / COLS);
  const out = new Uint32Array(CW * COLS * CH * rows).fill(0xff2e1215);
  list.forEach((lm, n) => {
    const gx0 = lm.bx - CW / 2, gz0 = lm.bz - Math.round((CH * 0.62) / KZ), gz1 = lm.bz + Math.round((CH * 0.38) / KZ);
    const r = renderer.renderRegion(gx0, gz0, gx0 + CW, gz1);
    const want = renderer.OY + Math.round(KZ * lm.bz - 0.8 * lm.by) - Math.round(CH * 0.62); // image row at the top of the cell
    const ox = (n % COLS) * CW, oy = Math.floor(n / COLS) * CH;
    for (let y = 0; y < CH; y++) {
      const sy = want + y - r.iy0;
      if (sy < 0 || sy >= r.ih) continue;
      for (let x = 0; x < CW; x++) {
        const c = r.img[sy * r.iw + x];
        if (c) out[(oy + y) * CW * COLS + ox + x] = c | 0xff000000;
      }
    }
    console.log(n + Number(arg('from', 0)), lm.site.id);
  });
  fs.writeFileSync(path.resolve(sheet), encodePNG(CW * COLS, CH * rows, new Uint8Array(out.buffer)));
  lap('sheet');
} else if (preview) {
  const [lon, lat, w = 1200, h = 800] = preview.split(',').map(Number);
  const [x, z] = lonLatToWorld(lon, lat);
  const gx0 = Math.round(x * S - w / 2), gx1 = gx0 + w;
  const gzc = z * S;
  const gz0 = Math.round(gzc - h / 2 / KZ), gz1 = Math.round(gzc + h / 2 / KZ);
  const r = renderer.renderRegion(gx0, gz0, gx1, gz1);
  lap(`region ${r.iw} x ${r.ih}`);
  // Crop to the rows the ground rectangle itself covers and fill gaps with night.
  const top = Math.round(KZ * gz0) - (r.iy0 - renderer.OY);
  const rows = Math.min(r.ih - top, h);
  const out = new Uint32Array(r.iw * rows);
  for (let i = 0; i < out.length; i++) out[i] = r.img[top * r.iw + i] || 0xff2e1215;
  const file = path.resolve(arg('out', 'preview.png'));
  const k = Number(arg('scale', 1));
  let px = out, pw = r.iw, ph = rows;
  if (k > 1) { // enlarge with hard pixels, for inspecting detail
    pw = r.iw * k; ph = rows * k;
    px = new Uint32Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) px[y * pw + x] = out[Math.floor(y / k) * r.iw + Math.floor(x / k)];
  }
  fs.writeFileSync(file, encodePNG(pw, ph, new Uint8Array(px.buffer)));
  lap(`wrote ${file}`);
} else if (process.argv.includes('--overlays')) {
  // node gen/build.mjs --overlays [--out WORLD] [--units DIR] [--look pixel|smooth]: redo what is drawn over the
  // picture (sprites, the landmarks' animation, the units) in a world that is already built, leaving its tiles alone.
  const { buildOverlays } = await import('./tiles.mjs');
  const out = path.join(ROOT, arg('out', 'world'));
  const mf = path.join(out, 'manifest.json');
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const pg of [man.sprites, ...(man.animPages || []), ...((man.units && man.units.pages) || [])]) fs.rmSync(path.join(out, pg.file), { force: true });
  for (const ext of ['png', 'webp']) for (const pg of [man.sprites, ...(man.animPages || []), ...((man.units && man.units.pages) || [])]) fs.rmSync(path.join(out, pg.file.replace(/\.\w+$/, '.' + ext)), { force: true });
  const over = buildOverlays({ renderer, fields, sites, stamps, landmarks, S, root: ROOT, out, lap, unitDir: arg('units') ? path.resolve(arg('units')) : undefined });
  Object.assign(man, over, { version: Date.now().toString(36) });
  if (arg('look')) man.look = arg('look') === 'smooth' ? undefined : arg('look');
  fs.writeFileSync(mf, JSON.stringify(man));
  lap(`overlays redone in ${out}`);
} else if (process.argv.includes('--anims')) {
  // node gen/build.mjs --anims: the landmarks' moving parts, frame by frame, for Blender to render (units/anims.py).
  const { exportAnims } = await import('./anims.mjs');
  const { finer, FINE } = await import('./tiles.mjs');
  exportAnims({ renderer, landmarks, rebake: finer({ renderer, fields, stamps, S }), q: FINE, dir: path.join(ROOT, 'units', 'anims', 'src'), lap });
} else if (process.argv.includes('--spots')) {
  // node gen/build.mjs --spots: where the places worth a closer look are, for paint/detail.py.
  const spots = sites.filter((s) => s.x != null).map((s) => {
    const lm = landmarks.find((l) => l.site.id === s.id);
    const hv = s.sea ? 0 : renderer.quant(renderer.heightOf(Math.max(1, s.elev)));
    return {
      id: s.id, minor: !!s.minor, town: s.town || 0, tier: s.tier,
      x: Math.round(s.x * S), y: Math.round(renderer.OY + KZ * s.z * S - 0.8 * hv),
      r: Math.round((s.R || 0) * S), rt: Math.round((s.RT || s.R || 0) * S),
      top: lm ? lm.height : 0, bot: lm ? lm.below : 0,
      wide: lm && lm.gx1 >= lm.gx0 ? Math.max(lm.bx - lm.gx0, lm.gx1 - lm.bx) : 0,
    };
  });
  fs.mkdirSync(path.join(ROOT, 'paint', 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'paint', 'work', 'spots.json'), JSON.stringify({ w: renderer.IW, h: renderer.IH, spots }));
  lap(`spots: ${spots.length}`);
} else if (process.argv.includes('--cond')) {
  // node gen/build.mjs --cond: what the painter needs, into paint/work/cond (see gen/cond.mjs).
  const { exportCond } = await import('./cond.mjs');
  await exportCond({ fields, sites, stamps, landmarks, S, root: ROOT, lap, dir: arg('out', 'paint/work/cond') });
} else {
  const { buildWorld } = await import('./tiles.mjs');
  // --refresh: everything except the picture (paths, what hides the walkers, sprites, labels) in a world already built.
  await buildWorld({ renderer, fields, sites, stamps, landmarks, effects: baked.effects, S, root: ROOT, lap, dir: arg('out', 'world'), keepPicture: process.argv.includes('--refresh') });
}
