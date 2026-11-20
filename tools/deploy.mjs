// Publishes the site: `npm run deploy`.
//
// The site is static: index.html, src/, world/ and a preview picture. This copies those into dist/,
// makes them the one and only commit of a `gh-pages` branch, and pushes that to the same remote as
// this repository, where GitHub Pages serves it. The branch is replaced each time rather than added
// to, because world/ is hundreds of megabytes of images and a history of those would soon outgrow
// what a repository may hold.
//
//   node tools/deploy.mjs [--world world.next] [--remote origin] [--dry]
//
// --world publishes another build of the world (it is still served as world/). --dry stops before the push.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const world = path.join(root, arg('world', 'world'));
if (!fs.existsSync(path.join(world, 'manifest.json'))) throw new Error(`${world} has no manifest.json: build the world first`);
const remote = git(root, 'remote', 'get-url', arg('remote', 'origin'));
// https://github.com/owner/name(.git) or git@github.com:owner/name(.git) -> https://owner.github.io/name/
const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
const site = m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : null;

const dist = path.join(root, 'dist');
// The folder is emptied but its .git is kept: that holds the site as it was last pushed, and with it git
// sends only the files that have changed since (a few megabytes, not all seven hundred).
fs.mkdirSync(dist, { recursive: true });
for (const e of fs.readdirSync(dist)) if (e !== '.git') fs.rmSync(path.join(dist, e), { recursive: true, force: true });
for (const f of ['index.html', 'preview.jpg', '.nojekyll']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dist, f));
fs.cpSync(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
fs.cpSync(world, path.join(dist, 'world'), { recursive: true });
if (site) { // link previews want whole addresses
  const page = path.join(dist, 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8')
    .replace('<meta property="og:image" content="preview.jpg">', `<meta property="og:image" content="${site}preview.jpg">\n<meta property="og:url" content="${site}">`));
}
let files = 0, bytes = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue; // not part of the site
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
};
walk(dist);
console.log(`dist: ${files} files, ${(bytes / 1e6).toFixed(0)} MB`);

if (!fs.existsSync(path.join(dist, '.git'))) git(dist, 'init', '-q', '-b', 'gh-pages');
git(dist, '-c', 'core.autocrlf=false', 'add', '-A'); // the files go up exactly as they are
const who = (key, dflt) => { try { return git(root, 'config', key) || dflt; } catch { return dflt; } };
// One commit with no parent, each time: the branch never has a history.
const commit = git(dist, '-c', 'user.name=' + who('user.name', 'TinyOdyssey'), '-c', 'user.email=' + who('user.email', 'noreply@example.com'),
  'commit-tree', git(dist, 'write-tree'), '-m', `Site, built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from ${git(root, 'rev-parse', '--short', 'HEAD')}`);
git(dist, 'update-ref', 'refs/heads/gh-pages', commit);
if (process.argv.includes('--dry')) {
  console.log(`dry run: not pushed. Would publish to ${site || remote}`);
} else {
  execFileSync('git', ['push', '--force', remote, 'gh-pages'], { cwd: dist, stdio: 'inherit' });
  // What the last site had and this one has not is no longer wanted here either.
  try { git(dist, 'reflog', 'expire', '--expire=now', '--all'); git(dist, 'gc', '-q', '--prune=now'); } catch { /* it will be tidied next time */ }
  console.log(site ? `Published. It will be at ${site} in a minute or two.` : 'Published.');
}
