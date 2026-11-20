// Real elevation and sea depth for the map, as a raster in world space.
//
// Source: Mapzen "terrarium" terrain tiles on the AWS Open Data registry (land
// from SRTM/GMTED, sea floor from ETOPO1). Tiles are cached in tools/.cache, and
// so is the finished raster, so only the first run needs the network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';
import { WORLD_W, WORLD_D, worldToLonLat } from '../src/config.js';

const ZOOM = 9;
const TILE = 256;
export const DEM_RES = 16; // samples per world unit (one unit is about 5 km)

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'tools', '.cache');

const n = 2 ** ZOOM;
const lonToPx = (lon) => ((lon + 180) / 360) * n * TILE;
const latToPx = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n * TILE;
};

async function getTile(x, y) {
  const file = path.join(CACHE, `${ZOOM}_${x}_${y}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'terrain-bake/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// Returns { w, h, res, data: Int16Array of metres } with row 0 at the north edge.
export async function loadDem() {
  const w = Math.ceil(WORLD_W * DEM_RES);
  const h = Math.ceil(WORLD_D * DEM_RES);
  const file = path.join(CACHE, `dem-z${ZOOM}-${DEM_RES}-${w}x${h}.bin`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    return { w, h, res: DEM_RES, data: new Int16Array(buf.buffer, buf.byteOffset, w * h) };
  }

  fs.mkdirSync(CACHE, { recursive: true });
  const [lonW, latN] = worldToLonLat(0, 0);
  const [lonE, latS] = worldToLonLat(WORLD_W, WORLD_D);
  const tx0 = Math.floor(lonToPx(lonW) / TILE), tx1 = Math.floor(lonToPx(lonE) / TILE);
  const ty0 = Math.floor(latToPx(latN) / TILE), ty1 = Math.floor(latToPx(latS) / TILE);
  const MW = (tx1 - tx0 + 1) * TILE, MH = (ty1 - ty0 + 1) * TILE;
  const mosaic = new Float32Array(MW * MH);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  const total = jobs.length;
  console.log(`Elevation: ${total} tiles at zoom ${ZOOM}…`);
  let done = 0;
  async function worker() {
    while (jobs.length) {
      const [tx, ty] = jobs.pop();
      const png = decodePNG(await getTile(tx, ty));
      const ox = (tx - tx0) * TILE, oy = (ty - ty0) * TILE;
      const d = png.data;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const i = (y * TILE + x) * png.bpp;
          mosaic[(oy + y) * MW + ox + x] = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
        }
      }
      if (++done % 100 === 0) console.log(`  ${done} / ${total}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  const data = new Int16Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [lon, lat] = worldToLonLat((i + 0.5) / DEM_RES, (j + 0.5) / DEM_RES);
      const fx = Math.min(MW - 1.001, Math.max(0, lonToPx(lon) - tx0 * TILE - 0.5));
      const fy = Math.min(MH - 1.001, Math.max(0, latToPx(lat) - ty0 * TILE - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const u = fx - x0, v = fy - y0;
      const k = y0 * MW + x0;
      const e = (mosaic[k] * (1 - u) + mosaic[k + 1] * u) * (1 - v) + (mosaic[k + MW] * (1 - u) + mosaic[k + MW + 1] * u) * v;
      data[j * w + i] = Math.max(-32000, Math.min(32000, Math.round(e)));
    }
  }
  fs.writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  console.log(`Elevation raster ${w} x ${h} cached.`);
  return { w, h, res: DEM_RES, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dem = await loadDem();
  let land = 0, max = -1e9, min = 1e9;
  for (const e of dem.data) {
    if (e > 0) land++;
    if (e > max) max = e;
    if (e < min) min = e;
  }
  console.log(`${dem.w} x ${dem.h}, ${((land / dem.data.length) * 100).toFixed(1)}% land, ${min} m to ${max} m`);
}
