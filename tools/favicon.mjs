// Draws the site's icon: `node tools/favicon.mjs`.
//
// A ship under a striped sail on a night sea, sixteen pixels square, drawn here as a grid of letters.
// It is written out as favicon.svg (sharp at any size), favicon.ico (16, 32 and 48 pixels, for browsers
// that ask for that name), apple-touch-icon.png (180, corners filled: a phone rounds them itself) and
// icon-512.png. Needs only Node.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INK = {
  k: '#15122e', // night sky
  '*': '#fff3cf', // a star
  s: '#fff3cf', // sail
  r: '#e0603f', // its stripes
  m: '#c9973e', // mast
  h: '#f6c945', // hull
  u: '#c0872a', // its underside
  e: '#15122e', // the eye on the prow
  t: '#3fb6d3', // sea
  w: '#e8fbff', // wave tops
  d: '#2a8fb0', // deeper water
};
// '.' is nothing (the rounded corners). The corner letters in CORNERS fill them where corners must be square.
const ART = [
  '..kkkkkkkkkkkk..',
  '.kkkkkkkmkkkkkk.',
  'kk*kssssmsssskkk',
  'kkkksssssssssk*k',
  'kkkkrrrrrrrrrkkk',
  'kkkkssssssssskkk',
  'kkkkrrrrrrrrrkkk',
  'kkkkkssssssskkkk',
  'kkkkkkkkmkkkkkkk',
  'khkkkkkkmkkkkkhk',
  'khhhhhhhhhhhhhhk',
  'kkuhhhhhhhhehukk',
  'tttuuuuuuuuuuttt',
  'twwtttwwtttwwttt',
  '.dddddddddddddd.',
  '..dddddddddddd..',
];
const N = 16;
if (ART.length !== N || ART.some((row) => row.length !== N)) throw new Error('the icon is 16 by 16');
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// --- SVG: one rectangle for each run of a colour along a row ---
let rects = '';
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N;) {
    const c = ART[y][x];
    let w = 1;
    while (x + w < N && ART[y][x + w] === c) w++;
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${INK[c]}"/>`;
    x += w;
  }
}
fs.writeFileSync(path.join(root, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>\n`);

// --- PNG: each pixel takes the cell it falls in (the sizes used are whole multiples, but for 180) ---
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function png(size, square = false) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      let c = ART[Math.floor((y * N) / size)][Math.floor((x * N) / size)];
      if (c === '.' && square) c = y < size / 2 ? 'k' : 'd';
      const p = row + 1 + x * 4;
      if (c === '.') continue; // left clear
      const [r, g, b] = rgb(INK[c]);
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), png(180, true));
fs.writeFileSync(path.join(root, 'icon-512.png'), png(512));

// --- ICO: a directory, then the PNGs as they are ---
const sizes = [16, 32, 48], imgs = sizes.map((s) => png(s));
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
let at = dir.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  dir[e] = s; dir[e + 1] = s;
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(imgs[i].length, e + 8); dir.writeUInt32LE(at, e + 12);
  at += imgs[i].length;
});
fs.writeFileSync(path.join(root, 'favicon.ico'), Buffer.concat([dir, ...imgs]));
for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-512.png']) console.log(f, fs.statSync(path.join(root, f)).size, 'bytes');
