// Exports what the painter needs (see paint/README.md).
//
// The painter is an image model that redraws a render of the world as detailed
// pixel art, K times larger than the splat image. It is shown:
//
//   base.png     the splat image of the scenery alone: no landmarks, no hex grid.
//                Alpha says what each pixel is: 0 nothing, 254 sea, 253 river, 255 land.
//   lm/<id>.png  each landmark sampled K times finer, so its columns, statues and
//                monsters have real shapes for the model to follow. Pixels hidden
//                behind scenery standing in front are already removed.
//   meta.json    sizes, and where each cut-out and each site sits.

import fs from 'node:fs';
import path from 'node:path';
import { createRenderer } from './region.mjs';
import { bakeLandmarks } from './bake.mjs';
import { encodePNG } from './png.mjs';
import { MODEL_PX } from './settings.mjs';

export async function exportCond({ fields, sites, stamps, landmarks, S, root, lap, K = 4, dir = 'paint/work/cond' }) {
  const out = path.join(root, dir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'lm'), { recursive: true });

  // Landmarks still flatten their ground and cast their shadows; they are just not drawn.
  const shadowsOnly = landmarks.map((lm) => ({ site: lm.site, stampTops: (...a) => lm.stampTops(...a) }));
  const plain = createRenderer({ fields, sites, stamps, S, rivers: fields.rivers, landmarks: shadowsOnly, grid: false, lap });
  const { GW, GD, IW, IH, OY } = plain;

  const full = new Uint32Array(IW * IH);
  const BAND = 640;
  for (let z0 = 0; z0 < GD; z0 += BAND) {
    const r = plain.renderRegion(0, z0, GW, Math.min(GD, z0 + BAND));
    for (let y = 0; y < r.ih; y++) {
      const fy = r.iy0 + y;
      if (fy < 0 || fy >= IH) continue;
      const so = y * r.iw, fo = fy * IW;
      for (let x = 0; x < r.iw; x++) {
        const c = r.img[so + x];
        if (c) full[fo + x] = c;
      }
    }
  }
  fs.writeFileSync(path.join(out, 'base.png'), encodePNG(IW, IH, new Uint8Array(full.buffer)));
  lap(`painter: scenery ${IW} x ${IH}`);

  // The same landmarks, K times finer. The stand-in renderer keeps their anchors and
  // heights at exactly K times the coarse ones, so they sit on the enlarged ground.
  const fine = { S: S * K, OY: OY * K, quant: (h) => plain.quant(h / K) * K, heightOf: (m) => plain.heightOf(m) * K };
  const cuts = [];
  for (const lm of landmarks) {
    if (lm.gx0 > lm.gx1) continue; // nothing solid: an effect only
    const { landmarks: [big] } = bakeLandmarks({ sites: [lm.site], fields, renderer: fine, stamps, modelPx: MODEL_PX * K, snap: K });
    const r = plain.renderRegion(lm.gx0 - 3, lm.gz0 - 3, lm.gx1 + 4, lm.gz1 + 160);
    const w = r.iw * K, h = r.ih * K;
    const img = new Uint32Array(w * h);
    const zb = new Uint16Array(w * h);
    // Scenery depth, enlarged: a scenery pixel hides whatever stands in a row north of its own.
    for (let y = 0; y < r.ih; y++) {
      for (let x = 0; x < r.iw; x++) {
        const z = r.zb[y * r.iw + x];
        if (!z) continue;
        const v = Math.min(65535, (z - 1) * K + 1);
        for (let b = 0; b < K; b++) zb.fill(v, (y * K + b) * w + x * K, (y * K + b) * w + x * K + K);
      }
    }
    const gx0 = (lm.gx0 - 3) * K, gz0 = (lm.gz0 - 3) * K;
    big.splat({ img, zb, iw: w, ih: h, gx0, gz0, gx1: gx0 + w, gz1: (lm.gz1 + 160) * K, iy0: (r.iy0 - OY) * K });
    let c0 = w, c1 = -1, r0 = h, r1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!img[y * w + x]) continue;
        if (x < c0) c0 = x;
        if (x > c1) c1 = x;
        if (y < r0) r0 = y;
        if (y > r1) r1 = y;
      }
    }
    if (c1 < 0) continue;
    const cw = c1 - c0 + 1, ch = r1 - r0 + 1;
    const cut = new Uint32Array(cw * ch);
    for (let y = 0; y < ch; y++) cut.set(img.subarray((r0 + y) * w + c0, (r0 + y) * w + c0 + cw), y * cw);
    fs.writeFileSync(path.join(out, 'lm', `${lm.site.id}.png`), encodePNG(cw, ch, new Uint8Array(cut.buffer)));
    cuts.push({ id: lm.site.id, x: r.ix0 * K + c0, y: r.iy0 * K + r0, w: cw, h: ch });
  }
  lap(`painter: ${cuts.length} landmark cut-outs at ${K}x`);

  const meta = {
    k: K, w: IW, h: IH, oy: OY, px: S,
    cuts,
    sites: sites.map((s) => {
      const hv = s.sea ? 0 : plain.quant(plain.heightOf(Math.max(1, s.elev)));
      return { id: s.id, name: s.name, model: s.model || null, paint: s.paint || null, x: Math.round(s.x * S), y: Math.round(OY + 0.6 * s.z * S - 0.8 * hv) };
    }),
  };
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta));
}
