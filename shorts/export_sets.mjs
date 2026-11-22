// Reuse Tiny Odyssey's actual landmark meshes as the shorts' sets.
import fs from 'node:fs';
import { Geo, rgb } from '../gen/kit.js';
import * as THREE from '../gen/three.js';
import { MODELS } from '../gen/landmarks.js';
const out = new URL('./work/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
for (const name of ['cyclops', 'sisyphus', 'labyrinth']) {
  const group = new THREE.Group();
  const fx = {
    time: 0, rgb, tick() {}, splash() {}, glyphs() {}, puffs() { return {on:true}; },
    flame() { return new THREE.Object3D(); },
    mesh(parent, geo) { const m = new THREE.Mesh(geo.build ? geo.build() : geo); parent.add(m); return m; },
  };
  const g = new Geo();
  MODELS[name](g, {x:0,y:0,z:0}, {group, scene:group, fx, tree(){}, findSea(){return [2,2];}});
  fs.writeFileSync(new URL(name + '.json', out), JSON.stringify({positions:Array.from(g.pos.slice(0,g.n*3)), colors:Array.from(g.col.slice(0,g.n*3))}));
  console.log(name, g.n / 3, 'triangles');
}
