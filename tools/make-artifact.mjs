// Writes dist/artifact/index.html: the page without its <html>/<head>/<body>
// wrapper, for hosts that supply their own (a claude.ai artifact, for one).
// The parts to keep are fenced in index.html with <!--page--> ... <!--/page-->.
// The scripts in src/ and data/ are published alongside it unchanged.
//
//   node tools/make-artifact.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const parts = [...html.matchAll(/<!--page-->\n?([\s\S]*?)<!--\/page-->/g)].map((m) => m[1].trim());
if (parts.length !== 2) throw new Error(`expected 2 <!--page--> blocks in index.html, found ${parts.length}`);

const out = path.join(root, 'dist', 'artifact');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), `${parts.join('\n\n')}\n`);
console.log(`Wrote ${path.join(out, 'index.html')}`);
