// Draws the picture, sharing the work out between the processor's cores: `npm run pyramid`.
//
//   node tools/pyramid.mjs [--out world] [--look pixel,voxel] [--jobs 12]
//
// Every zoom level of the picture is rendered natively (gen/pyramid.mjs), and the levels do not
// depend on one another; nor do the rows of a whole-map level, or the places of a finer one. So each
// look is cut into a couple of dozen jobs, each `node gen/build.mjs --pyramid` on its own share, run
// a dozen at a time. When a look is done its notes are gathered into the world's manifest.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const out = arg('out', 'world');
const looks = arg('look', 'pixel,voxel').split(',');
const jobs = Number(arg('jobs', Math.max(2, Math.min(14, os.cpus().length - 4))));
const t0 = Date.now();
const lap = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s  ${s}`);

// The shares. Scale 4 is 37 rows of tiles tall and scale 2 is 19: cut them into slabs.
const shares = [['--scales', '1']];
for (let a = 0; a < 19; a += 7) shares.push(['--scales', '2', '--rows', `${a},${a + 7}`]);
for (let a = 0; a < 37; a += 4) shares.push(['--scales', '4', '--rows', `${a},${a + 4}`]);
for (let i = 0; i < 3; i++) shares.push(['--scales', '8', '--part', `${i}/3`]);
for (let i = 0; i < 8; i++) shares.push(['--scales', '16', '--part', `${i}/8`]);

const run = (args, log) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['gen/build.mjs', '--pyramid', '--out', out, ...args], { cwd: root, stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log + '.err', 'w')] });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed (${code}); see ${log}.err`))));
});

for (const look of looks) {
  const dir = path.join(root, out, look);
  fs.rmSync(dir, { recursive: true, force: true }); // the shares do not clear what they write into
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true });
  const queue = shares.map((s, n) => ({ args: ['--look', look, ...s], log: path.join(dir, 'log', `${n}.txt`) }));
  // The heaviest first, so the long ones are not left for the end.
  queue.sort((a, b) => Number(b.args[3]) - Number(a.args[3]));
  let left = queue.length;
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      await run(job.args, job.log);
      lap(`${look}: ${job.args.slice(2).join(' ')} done, ${--left} to go`);
    }
  }));
  fs.rmSync(path.join(dir, 'log'), { recursive: true, force: true });
}
await run(['--styles'], path.join(root, out, 'styles.log'));
console.log(fs.readFileSync(path.join(root, out, 'styles.log'), 'utf8').trim().split('\n').pop());
fs.rmSync(path.join(root, out, 'styles.log'), { force: true });
fs.rmSync(path.join(root, out, 'styles.log.err'), { force: true });
lap('pyramid finished');
