// Sprite stacks (units/stack.py) put into a world: their sheets of slices copied in, and what the
// manifest says about them. A stack is a model kept as flat slices, which the viewer piles up and turns
// (src/viewer.js, draw.stack and draw.pose), so that it can face any way: the ships are, and the hoplites.
//
//   node gen/stacks.mjs [--out world]     into a world that is already built, leaving the rest of it alone
//
// The full build and `node gen/build.mjs --overlays` do the same as part of their work.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Returns { name: { kind, frames, sets: [{ r, n, reach, half, file, v, w, h, notes, frames, rects }] } }, or null
// if none have been made. kind is what it is (ship, human), which decides how the map keeps its pictures. A set
// is one size of the model, with a sheet of its own; v changes whenever the sheet does, so that a browser never
// pairs an old sheet with new slices.
export function addStacks(out, unitDir) {
  const file = path.join(unitDir, 'stacks.json');
  if (!fs.existsSync(file)) return null;
  const stacks = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const f of fs.readdirSync(out)) if (/^stack_.*\.png$/.test(f)) fs.rmSync(path.join(out, f)); // none left over from another cut
  for (const st of Object.values(stacks)) {
    for (const set of st.sets) {
      const png = fs.readFileSync(path.join(unitDir, set.file));
      fs.writeFileSync(path.join(out, set.file), png); // as written: half of it is notes kept as colours, which must stay exact
      set.v = crypto.createHash('sha1').update(png).digest('hex').slice(0, 10);
    }
  }
  return stacks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const at = process.argv.indexOf('--out');
  const out = path.resolve(root, at > 0 ? process.argv[at + 1] : 'world');
  const mf = path.join(out, 'manifest.json');
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const stacks = addStacks(out, path.join(root, 'units', 'out'));
  if (!stacks) throw new Error('no stacks: run units/stack.py in Blender first');
  man.stacks = stacks;
  fs.writeFileSync(mf, JSON.stringify(man));
  for (const [name, st] of Object.entries(stacks)) console.log(`${name}: ${st.frames} frame(s); ${st.sets.map((s) => `${s.n} levels, ${s.rects.length} slices on ${s.w} x ${s.h}`).join('; ')}`);
}
