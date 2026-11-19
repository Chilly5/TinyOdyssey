// Small animated effects shared by the landmarks: smoke, flames, floating
// pixel glyphs (music notes, hearts, sparks), lightning and splashes.

import * as THREE from './three.js';
import { Geo, rgb } from './kit.js';
import { C } from './models.js';
import { PITCH } from './view.js';

const GLYPHS = {
  note: ['..XX..', '..XXX.', '..X.XX', '..X..X', '..X...', '.XX...', 'XXX...', '.X....'],
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  zed: ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  spark: ['.X.', 'XXX', '.X.'],
  gust: ['....XX..', '......X.', 'XXXXXX..', '........', 'XXXX....'],
  feather: ['...XX', '..XX.', '.XX..', 'XX...', 'X....'],
};

function glyphTexture(rows) {
  const h = rows.length + 2, w = rows[0].length + 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const on = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[0].length && rows[y][x] === 'X';
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= rows[0].length; x++) {
      if (on(x, y)) ctx.fillStyle = '#ffffff';
      else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) ctx.fillStyle = '#2a2140';
      else continue;
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData = { w, h };
  return tex;
}

export function createFX(view) {
  const ticks = [];
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const puffGeo = new Geo().blob(0, 0, 0, 1, 0.8, 1, [1, 1, 1], { dark: [0.78, 0.78, 0.82] }).build();
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const glyphTex = {};
  const glyphMats = new Map();
  const puffMats = new Map();

  const fx = {
    lit, glow,
    time: 0,
    tick(fn) {
      ticks.push(fn);
      return fn;
    },
    update(t, dt) {
      fx.time = t;
      for (let i = 0; i < ticks.length; i++) ticks[i](t, dt);
    },

    // Mesh from a Geo, lit by the sun or self-lit. Not a shadow caster unless asked.
    mesh(parent, geo, o = {}) {
      const m = new THREE.Mesh(geo.build ? geo.build() : geo, o.glow ? glow : lit);
      m.castShadow = !!o.shadow;
      m.receiveShadow = false;
      parent.add(m);
      return m;
    },

    // Rising, swelling, fading puffs: smoke, steam, mist.
    puffs(parent, o) {
      const n = o.n || 6;
      const key = `${o.color}|${o.glow ? 1 : 0}`;
      if (!puffMats.has(key)) {
        const Mat = o.glow ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
        puffMats.set(key, new Mat({ vertexColors: true, color: new THREE.Color(o.color || '#ffffff') }));
      }
      const mat = puffMats.get(key);
      const items = [];
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(puffGeo, mat);
        m.castShadow = false;
        parent.add(m);
        items.push({ m, seed: Math.random() * 10 });
      }
      const life = o.life || 5, rise = o.rise ?? 2, size = o.size || 0.3, drift = o.drift || [0.6, 0];
      const state = { on: true };
      fx.tick((t) => {
        for (let i = 0; i < n; i++) {
          const it = items[i];
          const u = (t / life + i / n) % 1;
          const grow = 0.45 + u * 1.1;
          const fade = Math.min(1, u * 8) * Math.min(1, (1 - u) * 3.2);
          const s = state.on ? size * grow * fade : 0;
          it.m.scale.setScalar(Math.max(s, 0.0001));
          it.m.position.set(
            (o.x || 0) + drift[0] * u * u * 2 + Math.sin(u * 5 + it.seed) * (o.wobble ?? 0.12),
            (o.y || 0) + rise * u,
            (o.z || 0) + drift[1] * u * u * 2 + Math.cos(u * 4 + it.seed) * (o.wobble ?? 0.12) * 0.6,
          );
        }
      });
      return state;
    },

    // A flickering flame of size s.
    flame(parent, x, y, z, s = 0.3, o = {}) {
      const g = new Geo();
      g.cyl(0, 0, 0, 0.5, 0, 1.3, 5, o.outer || C.lava);
      g.cyl(0, 0, 0.02, 0.3, 0, 0.85, 5, o.mid || C.flame);
      g.cyl(0, 0, 0.04, 0.15, 0, 0.45, 4, o.core || C.flameHot);
      const m = fx.mesh(parent, g, { glow: true });
      m.position.set(x, y, z);
      const ph = Math.random() * 10;
      fx.tick((t) => {
        const k = 1 + 0.22 * Math.sin(t * 13 + ph) + 0.14 * Math.sin(t * 7.3 + ph * 2);
        m.scale.set(s * (1.05 - (k - 1) * 0.4), s * k, s * (1.05 - (k - 1) * 0.4));
        m.rotation.y = t * 2 + ph;
      });
      return m;
    },

    // Floating pixel glyphs that rise and sway. Always drawn one texel per art pixel.
    glyphs(parent, o) {
      const name = o.glyph || 'note';
      if (!glyphTex[name]) glyphTex[name] = glyphTexture(GLYPHS[name]);
      const tex = glyphTex[name];
      const key = `${name}|${o.color}`;
      if (!glyphMats.has(key)) {
        glyphMats.set(key, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, color: new THREE.Color(o.color || '#ffffff') }));
      }
      const n = o.n || 4;
      const items = [];
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(planeGeo, glyphMats.get(key));
        m.rotation.x = -PITCH;
        m.castShadow = false;
        m.renderOrder = 5;
        parent.add(m);
        items.push({ m, seed: i * 2.4 + Math.random() });
      }
      const life = o.life || 4, rise = o.rise ?? 1.6, spread = o.spread ?? 0.5;
      const state = { on: true };
      const inv = new THREE.Vector3();
      fx.tick((t) => {
        const px = view.uniforms.uPx.value;
        const k = (view.ppu >= 15 ? 2 : 1) * px;
        parent.getWorldScale(inv);
        for (let i = 0; i < n; i++) {
          const it = items[i];
          const u = (t / life + i / n + it.seed * 0.13) % 1;
          const show = state.on && u > 0.04 && u < 0.92 && view.ppu > 4.3; // too big for the far view
          it.m.visible = show;
          if (!show) continue;
          it.m.scale.set((tex.userData.w * k) / inv.x, (tex.userData.h * k) / inv.y, 1);
          it.m.position.set(
            (o.x || 0) + Math.sin(it.seed * 5) * spread + Math.sin(u * 6 + it.seed) * 0.18 + (o.drift ? o.drift[0] * u : 0),
            (o.y || 0) + rise * u,
            (o.z || 0) + Math.cos(it.seed * 3) * spread * 0.5 + (o.drift ? o.drift[1] * u : 0),
          );
        }
      });
      return state;
    },

    // A jagged bolt between two local points. Returns a function that fires it.
    lightning(parent, o = {}) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color || '#fff7b0') });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      let until = 0;
      fx.tick((t) => {
        if (mesh.visible && t > until) mesh.visible = false;
        else if (mesh.visible) mesh.visible = Math.sin(t * 90) > -0.4; // flicker
      });
      return (from, to, width = 0.07) => {
        const g = new Geo();
        const segs = 6;
        let p = from;
        for (let i = 1; i <= segs; i++) {
          const u = i / segs;
          const j = i === segs ? 0 : 0.35;
          const q = [
            from[0] + (to[0] - from[0]) * u + (Math.random() - 0.5) * j,
            from[1] + (to[1] - from[1]) * u,
            from[2] + (to[2] - from[2]) * u + (Math.random() - 0.5) * j * 0.5,
          ];
          const w = width * (1.3 - u * 0.6);
          g.quad([p[0] - w, p[1], p[2]], [q[0] - w, q[1], q[2]], [q[0] + w, q[1], q[2]], [p[0] + w, p[1], p[2]], [1, 1, 1]);
          g.quad([p[0] + w, p[1], p[2]], [q[0] + w, q[1], q[2]], [q[0] - w, q[1], q[2]], [p[0] - w, p[1], p[2]], [1, 1, 1]);
          p = q;
        }
        mesh.geometry.dispose();
        mesh.geometry = g.build();
        mesh.visible = true;
        until = fx.time + (o.hold || 0.28);
      };
    },
  };

  // Splash rings on the water, drawn from a small pool.
  const ringGeo = (() => {
    const g = new Geo();
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
      g.quad(p(a0, 1), p(a0, 0.72), p(a1, 0.72), p(a1, 1), [1, 1, 1]);
    }
    return g.build();
  })();
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f6fcf7') });
  const rings = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, ringMat);
    m.visible = false;
    view.scene.add(m);
    rings.push({ m, t0: -10, size: 1 });
  }
  let nextRing = 0;
  fx.splash = (x, z, size = 0.6) => {
    const r = rings[nextRing++ % rings.length];
    r.t0 = fx.time;
    r.size = size;
    r.m.position.set(x, 0.04, z);
  };
  fx.tick((t) => {
    for (const r of rings) {
      const u = (t - r.t0) / 0.9;
      r.m.visible = u >= 0 && u < 1;
      if (r.m.visible) r.m.scale.setScalar(r.size * (0.25 + u * 0.9));
    }
  });

  fx.rgb = rgb;
  return fx;
}
