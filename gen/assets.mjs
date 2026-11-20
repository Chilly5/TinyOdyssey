// Models made in Blender (units/assets.py), laid into a landmark's geometry.
//
// Each is a file of plain triangles in gen/assets/: pal (colours), tris (nine numbers a
// triangle, in the scene's axes) and ci (each triangle's colour). asset() pushes them into
// a Geo, moved, turned about the upright and scaled like any other part.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rgb } from './kit.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
const loaded = new Map();

function load(name) {
  let a = loaded.get(name);
  if (!a) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
    a = { tris: Float32Array.from(d.tris), ci: d.ci, cols: d.pal.map(rgb), pal: d.pal };
    loaded.set(name, a);
  }
  return a;
}

// paint: an optional function taking a colour ([r, g, b], linear) and giving the one to use instead.
export function asset(g, name, x = 0, y = 0, z = 0, rot = 0, scale = 1, paint = null) {
  const a = load(name);
  const cols = paint ? a.cols.map(paint) : a.cols;
  const t = a.tris;
  g.at(x, y, z, rot, scale, (q) => {
    for (let i = 0, k = 0; i < t.length; i += 9, k++) {
      q.tri([t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]], cols[a.ci[k]]);
    }
  });
  return g;
}
