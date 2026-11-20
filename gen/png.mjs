// Minimal PNG reading and writing with nothing but zlib.
// Reads 8-bit RGB / RGBA. Writes RGB, RGBA or palette (indexed) images.

import zlib from 'node:zlib';

export function decodePNG(buf) {
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

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pack(w, h, colorType, bytesPerPixel, pixels, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const stride = w * bytesPerPixel;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), src = y * stride;
    if (colorType === 3) { // palette indices do not benefit from filtering
      raw[o] = 0;
      raw.set(pixels.subarray(src, src + stride), o + 1);
      continue;
    }
    // Pick the cheaper of "none", "sub" and "up" for this row.
    let s0 = 0, s1 = 0, s2 = 0;
    for (let x = 0; x < stride; x++) {
      const v = pixels[src + x];
      const a = x >= bytesPerPixel ? pixels[src + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[src + x - stride] : 0;
      s0 += v < 128 ? v : 256 - v;
      const d1 = (v - a) & 255, d2 = (v - b) & 255;
      s1 += d1 < 128 ? d1 : 256 - d1;
      s2 += d2 < 128 ? d2 : 256 - d2;
    }
    const f = s1 <= s0 && s1 <= s2 ? 1 : s2 <= s0 ? 2 : 0;
    raw[o] = f;
    for (let x = 0; x < stride; x++) {
      const v = pixels[src + x];
      const a = x >= bytesPerPixel ? pixels[src + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[src + x - stride] : 0;
      raw[o + 1 + x] = f === 1 ? (v - a) & 255 : f === 2 ? (v - b) & 255 : v;
    }
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// rgba: Uint8Array of w*h*4. Writes a palette image when there are at most 256
// distinct colours (pixel art nearly always qualifies), otherwise true colour.
export function encodePNG(w, h, rgba) {
  const n = w * h;
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
  const index = new Map();
  const idx = new Uint8Array(n);
  let opaque = true;
  let ok = true;
  for (let i = 0; i < n; i++) {
    const c = u32[i];
    let k = index.get(c);
    if (k === undefined) {
      if (index.size === 256) { ok = false; break; }
      k = index.size;
      index.set(c, k);
      if (c >>> 24 !== 255) opaque = false;
    }
    idx[i] = k;
  }
  if (ok) {
    const plte = Buffer.alloc(index.size * 3);
    const trns = Buffer.alloc(index.size);
    for (const [c, k] of index) {
      plte[k * 3] = c & 255;
      plte[k * 3 + 1] = (c >>> 8) & 255;
      plte[k * 3 + 2] = (c >>> 16) & 255;
      trns[k] = c >>> 24;
    }
    const extra = [chunk('PLTE', plte)];
    if (!opaque) extra.push(chunk('tRNS', trns));
    return pack(w, h, 3, 1, idx, extra);
  }
  for (let i = 0; i < n && opaque; i++) if (rgba[i * 4 + 3] !== 255) opaque = false;
  if (!opaque) return pack(w, h, 6, 4, rgba);
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return pack(w, h, 2, 3, rgb);
}
