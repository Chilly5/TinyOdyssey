// Bakes real elevation and sea-depth data into data/terrain.js.
//
// Source: Mapzen "terrarium" terrain tiles on the AWS Open Data registry
// (land from SRTM/GMTED, sea floor from ETOPO1). Each hex gets three bytes:
// the fraction of it that is land, its land elevation and its sea depth.
//
//   node tools/build-terrain.mjs
//
// Tiles are cached in tools/.cache so reruns are offline.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  LON_W, LON_E, LAT_S, LAT_N, COLS, ROWS, HEX_R, ELEV_STEP_M, DEPTH_SCALE,
  worldToLonLat, hexCenterX, hexCenterZ,
} from '../src/config.js';

const ZOOM = 8;
const TILE = 256;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'data', 'terrain.js');

const n = 2 ** ZOOM;
const lonToPx = (lon) => ((lon + 180) / 360) * n * TILE;
const latToPx = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n * TILE;
};

const tx0 = Math.floor(lonToPx(LON_W) / TILE);
const tx1 = Math.floor(lonToPx(LON_E) / TILE);
const ty0 = Math.floor(latToPx(LAT_N) / TILE);
const ty1 = Math.floor(latToPx(LAT_S) / TILE);
const tilesX = tx1 - tx0 + 1;
const tilesY = ty1 - ty0 + 1;

function decodePNG(buf) {
  let p = 8;
  let w = 0, h = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colour type ${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst + x - stride] : 0;
      const c = x >= bpp && y > 0 ? out[dst + x - stride - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

async function getTile(x, y) {
  const file = path.join(CACHE, `${ZOOM}_${x}_${y}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'terrain-bake/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

fs.mkdirSync(CACHE, { recursive: true });
const W = tilesX * TILE;
const H = tilesY * TILE;
const elev = new Float32Array(W * H);

const jobs = [];
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
console.log(`Fetching ${jobs.length} tiles (${tilesX} x ${tilesY}) at zoom ${ZOOM}…`);
let done = 0;
async function worker() {
  while (jobs.length) {
    const [tx, ty] = jobs.pop();
    const png = decodePNG(await getTile(tx, ty));
    const ox = (tx - tx0) * TILE;
    const oy = (ty - ty0) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * TILE + x) * png.bpp;
        const d = png.data;
        elev[(oy + y) * W + ox + x] = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
      }
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done} tiles`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const sample = (lon, lat) => {
  const px = Math.min(W - 1, Math.max(0, Math.floor(lonToPx(lon) - tx0 * TILE)));
  const py = Math.min(H - 1, Math.max(0, Math.floor(latToPx(lat) - ty0 * TILE)));
  return elev[py * W + px];
};

const S = 9; // sample lattice per hex
const bytes = new Uint8Array(COLS * ROWS * 3);
let landHexes = 0;
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const cx = hexCenterX(col, row);
    const cz = hexCenterZ(row);
    let count = 0, land = 0, landSum = 0, landMax = 0, seaSum = 0;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const dx = (i + 0.5) / S - 0.5;
        const dz = ((j + 0.5) / S - 0.5) * 2 * HEX_R;
        if (Math.abs(dz) > HEX_R * (1 - Math.abs(dx))) continue;
        const [lon, lat] = worldToLonLat(cx + dx, cz + dz);
        const e = sample(lon, lat);
        count++;
        if (e > 0.5) {
          land++;
          landSum += e;
          if (e > landMax) landMax = e;
        } else seaSum += -e;
      }
    }
    const k = (row * COLS + col) * 3;
    const frac = land / count;
    const landElev = land ? 0.6 * (landSum / land) + 0.4 * landMax : 0;
    const depth = count - land ? seaSum / (count - land) : 0;
    bytes[k] = Math.round(frac * 255);
    bytes[k + 1] = Math.min(255, Math.round(landElev / ELEV_STEP_M));
    bytes[k + 2] = Math.min(255, Math.round(Math.sqrt(Math.max(0, depth)) * DEPTH_SCALE));
    if (frac >= 0.5) landHexes++;
  }
}

const b64 = Buffer.from(bytes).toString('base64');
const header = [
  '// Generated by tools/build-terrain.mjs. Do not edit by hand.',
  `// ${COLS} x ${ROWS} hexes covering ${LON_W}E to ${LON_E}E, ${LAT_S}N to ${LAT_N}N.`,
  '// Three bytes per hex: land fraction, land elevation, sea depth (see src/config.js).',
  '// Elevation data: Mapzen terrain tiles (SRTM, GMTED, ETOPO1) via AWS Open Data.',
].join('\n');
fs.writeFileSync(OUT, `${header}\nexport const TERRAIN_B64 =\n  '${b64}';\n`);
console.log(`Wrote ${OUT}: ${COLS} x ${ROWS} hexes, ${landHexes} land, ${(b64.length / 1024).toFixed(0)} KB`);
