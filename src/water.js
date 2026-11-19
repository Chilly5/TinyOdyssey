// The sea: one plane whose colour is computed per pixel from a baked field
// (distance to shore and real depth), so shallows glow, foam laps the coast and
// wave strokes drift along the depth contours.

import * as THREE from './three.js';
import { WORLD_W, WORLD_D, worldToHex } from './config.js';

const FIELD_SCALE = 4; // field texels per world unit
const MAX_DIST = 12; // shore distance stored in the field saturates here

// Exact squared Euclidean distance transform, one dimension (Felzenszwalb & Huttenlocher).
function edt1d(f, n, d, v, zz) {
  let k = 0;
  v[0] = 0;
  zz[0] = -Infinity;
  zz[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= zz[k] && --k >= 0);
    k++;
    v[k] = q;
    zz[k] = s;
    zz[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

function buildField(grid) {
  const W = Math.ceil(WORLD_W * FIELD_SCALE);
  const H = Math.ceil(WORLD_D * FIELD_SCALE);
  const INF = 1e12;
  const dist = new Float64Array(W * H);
  const depth = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const [c, r] = worldToHex((i + 0.5) / FIELD_SCALE, (j + 0.5) / FIELD_SCALE);
      const cc = Math.min(grid.cols - 1, Math.max(0, c));
      const rr = Math.min(grid.rows - 1, Math.max(0, r));
      const k = rr * grid.cols + cc;
      dist[j * W + i] = grid.land[k] ? 0 : INF;
      depth[j * W + i] = grid.land[k] ? 0 : Math.sqrt(grid.depth[k]) / 72;
    }
  }
  // Two-pass distance transform: columns, then rows.
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = dist[j * W + i];
    edt1d(f, H, d, v, zz);
    for (let j = 0; j < H; j++) dist[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = dist[j * W + i];
    edt1d(f, W, d, v, zz);
    for (let i = 0; i < W; i++) dist[j * W + i] = d[i];
  }
  // Soften the depth raster so its contours are smooth curves, not hex steps.
  const tmp = new Float32Array(W * H);
  const blur = (src, dst, radius, dx, dy) => {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let sum = 0, cnt = 0;
        for (let t = -radius; t <= radius; t += 2) {
          const x = i + t * dx, y = j + t * dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          sum += src[y * W + x];
          cnt++;
        }
        dst[j * W + i] = sum / cnt;
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    blur(depth, tmp, 9, 1, 0);
    blur(tmp, depth, 9, 0, 1);
  }
  const data = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const dd = Math.sqrt(dist[k]) / FIELD_SCALE;
    data[k * 4] = Math.min(255, Math.round((dd / MAX_DIST) * 255));
    data[k * 4 + 1] = Math.min(255, Math.round(depth[k] * 255));
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const WATER_FRAG = /* glsl */ `
uniform sampler2D uField;
uniform float uTime;
uniform float uPx;
uniform vec2 uWorld;
uniform vec3 cFoam, cShal1, cShal2, cMid, cSea, cDeep, cAbyss;
varying vec3 vWPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
// Distance to the nearest edge of a pointy-top hex grid of the given width.
float hexEdge(vec2 p, float s) {
  p /= s;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
  return (0.5 - max(g.x, dot(g, vec2(0.5, 0.8660254)))) * s;
}

vec3 waterColor(vec2 p) {
  vec4 fld = texture2D(uField, p / uWorld);
  float d = fld.r * ${MAX_DIST.toFixed(1)};
  float n = vnoise(p * 0.2 + vec2(uTime * 0.025, 0.0));
  float n2 = vnoise(p * 0.85 - vec2(0.0, uTime * 0.05));
  // Shallows reach further out over a real shelf and hug the coast where it drops away.
  float reach = mix(0.62, 1.45, smoothstep(0.06, 0.34, fld.g));
  float dd = d * reach + (n - 0.5) * 0.7 * smoothstep(0.3, 2.0, d) + (n2 - 0.5) * 0.28 * smoothstep(0.2, 1.0, d);

  // Open water, banded by real depth.
  float dz = fld.g + (n - 0.5) * 0.07;
  vec3 c = cAbyss;
  c = mix(c, cDeep, step(dz, 0.70));
  c = mix(c, cSea, step(dz, 0.47));
  c = mix(c, cMid, step(dz, 0.2));
  // Slow lighter patches, like cloud-light on the water.
  c = mix(c, c * 1.07 + 0.012, step(0.6, vnoise(p * 0.07 + vec2(-uTime * 0.012, uTime * 0.006))));

  // Shallows hugging the coast.
  c = mix(c, cMid, step(dd, 2.3));
  c = mix(c, cShal2, step(dd, 1.35));
  c = mix(c, cShal1, step(dd, 0.62));

  // Wave strokes: broken rings that follow the shore contours and drift in.
  float px = max(uPx, 0.06);
  float far = smoothstep(0.42, 0.24, uPx); // strokes thin out when zoomed far away
  float ring = step(abs(fract(d * 0.42 + uTime * 0.06) - 0.5), 0.42 * px * 0.55);
  float broken = step(0.6, vnoise(p * 0.45 + vec2(uTime * 0.03, 7.7)));
  float zone = step(0.9, d) * step(d, 4.6);
  c = mix(c, cFoam, ring * broken * zone * mix(0.45, 0.9, far));

  // Whitecaps out at sea: a few short curved dashes that fade in and out.
  vec2 g = p / 3.4 + vec2(vnoise(p * 0.11) * 1.7, vnoise(p * 0.13 + 4.0) * 1.7);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id);
  float life = fract(uTime * 0.05 + h * 7.0);
  vec2 q = f - (vec2(hash21(id + 3.1), hash21(id + 9.7)) - 0.5) * 0.6;
  q.x += (life - 0.5) * 0.2;
  float bend = (h - 0.5) * 3.0;
  float dash = step(abs(q.y + bend * q.x * q.x), px * 0.16) * step(abs(q.x), 0.08 + 0.2 * hash21(id + 5.5));
  float alive = step(0.2, life) * step(life, 0.8) * step(0.7, hash21(id + 1.7)) * step(4.2, d);
  c = mix(c, cFoam, dash * alive * 0.85 * far);

  // A faint grid of big hexes, the map-maker's graticule.
  c *= 1.0 - 0.085 * step(hexEdge(p, 9.0), px * 0.5) * step(1.0, d);

  // Surf line.
  float surf = 0.2 + 0.11 * sin(uTime * 1.3 + n2 * 9.0 + p.x * 0.9 + p.y * 0.6);
  c = mix(c, cFoam, step(d, surf));
  return c;
}
`;

export function buildWater(grid, uniforms) {
  const field = buildField(grid);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const u = {
    uField: { value: field },
    uTime: uniforms.uTime,
    uPx: uniforms.uPx,
    uWorld: { value: new THREE.Vector2(WORLD_W, WORLD_D) },
    cFoam: { value: new THREE.Color('#f6fcf7') },
    cShal1: { value: new THREE.Color('#b9eee0') },
    cShal2: { value: new THREE.Color('#84d8dc') },
    cMid: { value: new THREE.Color('#5cb8dc') },
    cSea: { value: new THREE.Color('#4596d2') },
    cDeep: { value: new THREE.Color('#3b80c4') },
    cAbyss: { value: new THREE.Color('#346eb4') },
  };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_FRAG}`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = waterColor(vWPos.xz);');
  };

  const group = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_D), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(WORLD_W / 2, 0, WORLD_D / 2);
  plane.receiveShadow = true;
  group.add(plane);

  // The cut edge of the diorama: a slab of deep water under the surface.
  const slabH = 1.5;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_W, slabH, WORLD_D),
    new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a5a9c') }),
  );
  slab.position.set(WORLD_W / 2, -slabH / 2 - 0.02, WORLD_D / 2);
  group.add(slab);
  return { group, material, field };
}
