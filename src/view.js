// Camera and pixel pipeline.
//
// The scene is drawn small into an off-screen target, then blown up with hard
// pixel edges, which is what gives the diorama its pixel-art look. The camera is
// orthographic and always snapped to that coarse pixel grid; the leftover
// fraction of a pixel is applied when the picture is blown up, so panning is
// smooth and the terrain never shimmers. The last pass also adds the tilt-shift
// blur that makes the world look like a miniature.

import * as THREE from './three.js';
import { WORLD_W, WORLD_D } from './config.js';
import { clamp } from './util.js';

export const PITCH = (47 * Math.PI) / 180; // camera angle below the horizon
const SIN_P = Math.sin(PITCH);
const COS_P = Math.cos(PITCH);
const TARGET_ROWS = 380; // art pixels down the screen, roughly
const PAD = 2; // spare art pixels around the edge for sub-pixel scrolling
const LIGHT_DIR = new THREE.Vector3(0.62, 0.7, 0.36).normalize(); // towards the sun
const SUN_DIST = 400;

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tLow;
uniform vec2 uLowSize;   // size of the low-res target in art pixels
uniform vec2 uScreen;    // visible area in art pixels (may be fractional)
uniform vec2 uOffset;    // sub-pixel scroll, in art pixels
uniform float uBlur;     // strongest tilt-shift blur radius, in art pixels
uniform float uFocus;    // half-height of the sharp band, 0..1
varying vec2 vUv;

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 t = vUv * uScreen + vec2(${PAD.toFixed(1)}) + uOffset;
  vec3 crisp = texture2D(tLow, (floor(t) + 0.5) / uLowSize).rgb;
  float edge = abs(vUv.y - 0.54) * 2.0;
  float blur = smoothstep(uFocus, 1.08, edge) * uBlur;
  vec3 col = crisp;
  if (blur > 0.02) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996;
      float r = sqrt((float(i) + 0.5) / 12.0) * blur;
      sum += texture2D(tLow, (t + vec2(cos(a), sin(a)) * r) / uLowSize).rgb;
    }
    col = mix(crisp, sum / 12.0, smoothstep(0.0, 0.9, blur));
  }
  // Gentle grade: a touch more saturation, a soft vignette.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.08);
  vec2 v = vUv - 0.5;
  col *= 1.0 - 0.28 * smoothstep(0.35, 0.95, dot(v, v) * 2.0);
  gl_FragColor = vec4(toSRGB(col), 1.0);
}`;

export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color('#15122e'), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = -PITCH;

  const hemi = new THREE.HemisphereLight(new THREE.Color('#e4efff'), new THREE.Color('#a58f74'), 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff1d0'), 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  const postUniforms = {
    tLow: { value: target.texture },
    uLowSize: { value: new THREE.Vector2(4, 4) },
    uScreen: { value: new THREE.Vector2(4, 4) },
    uOffset: { value: new THREE.Vector2() },
    uBlur: { value: 2.6 },
    uFocus: { value: 0.42 },
  };
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: POST_VERT, fragmentShader: POST_FRAG, uniforms: postUniforms, depthTest: false, depthWrite: false }),
  );
  quad.frustumCulled = false;
  postScene.add(quad);

  const view = {
    renderer, scene, camera, sun, hemi,
    x: WORLD_W * 0.6, z: WORLD_D * 0.5, // ground point at the screen centre
    ppu: 6, // art pixels per world unit
    cssW: 1, cssH: 1, lowW: 4, lowH: 4,
    artPx: 3, // CSS pixels per art pixel
    minPpu: 1.5, maxPpu: 20,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 / 6 }, uRim: { value: 0.1 } },
  };

  view.resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
    const backW = Math.round(cssW * dpr), backH = Math.round(cssH * dpr);
    const devPx = Math.max(1, Math.round(Math.max(backH, backW * 0.62) / TARGET_ROWS));
    renderer.setPixelRatio(1);
    renderer.setSize(backW, backH, false);
    view.cssW = cssW;
    view.cssH = cssH;
    view.artPx = devPx / dpr;
    view.visW = backW / devPx;
    view.visH = backH / devPx;
    view.lowW = Math.ceil(view.visW) + PAD * 2;
    view.lowH = Math.ceil(view.visH) + PAD * 2;
    target.setSize(view.lowW, view.lowH);
    postUniforms.uLowSize.value.set(view.lowW, view.lowH);
    postUniforms.uScreen.value.set(view.visW, view.visH);
    // Zoomed all the way out, the whole diorama fits with a little air around it.
    view.minPpu = Math.max(view.visW / (WORLD_W * 1.08), view.visH / ((WORLD_D * SIN_P + 6) * 1.1));
    view.maxPpu = Math.max(18, view.minPpu * 4);
    view.ppu = clamp(view.ppu, view.minPpu, view.maxPpu);
  };

  // World position to CSS pixel position on screen.
  view.project = (wx, wy, wz, out = {}) => {
    const s = view.ppu * view.artPx;
    out.x = view.cssW / 2 + (wx - view.x) * s;
    out.y = view.cssH / 2 - (wy * COS_P - (wz - view.z) * SIN_P) * s;
    return out;
  };

  // CSS pixel position to the point on the sea-level plane beneath it.
  view.unproject = (sx, sy, out = {}) => {
    const s = view.ppu * view.artPx;
    out.x = view.x + (sx - view.cssW / 2) / s;
    out.z = view.z + (sy - view.cssH / 2) / (s * SIN_P);
    return out;
  };

  view.clampTarget = () => {
    view.x = clamp(view.x, 0, WORLD_W);
    view.z = clamp(view.z, 0, WORLD_D);
  };

  const fwd = new THREE.Vector3(0, -SIN_P, -COS_P);
  const up = new THREE.Vector3(0, COS_P, -SIN_P);
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  view.render = () => {
    const { ppu, lowW, lowH } = view;
    view.uniforms.uPx.value = 1 / ppu;
    view.uniforms.uRim.value = 0.13 * clamp((ppu - 5) / 6, 0, 1);

    // Snap the camera to the art-pixel grid along its own right and up axes.
    const tr = view.x; // target . right
    const tu = -view.z * SIN_P; // target . up
    const sr = Math.round(tr * ppu) / ppu;
    const su = Math.round(tu * ppu) / ppu;
    // The screen centre must land on the true target, not the snapped one.
    postUniforms.uOffset.value.set(
      (tr - sr) * ppu + (Math.ceil(view.visW) - view.visW) * 0.5,
      (tu - su) * ppu + (Math.ceil(view.visH) - view.visH) * 0.5,
    );
    camera.position.set(sr, 0, 0).addScaledVector(up, su).addScaledVector(fwd, -300);
    camera.left = -lowW / (2 * ppu);
    camera.right = lowW / (2 * ppu);
    camera.top = lowH / (2 * ppu);
    camera.bottom = -lowH / (2 * ppu);
    camera.updateProjectionMatrix();

    // Fit the shadow map to the visible ground, snapped to its own texel grid.
    const spanX = lowW / ppu, spanZ = lowH / ppu / SIN_P;
    const ext = Math.max(spanX, spanZ) * 0.62 + 10;
    const sc = sun.shadow.camera;
    if (sc.right !== ext) {
      const reach = ext * 1.25 + 24; // depth range that holds everything in the footprint
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.near = SUN_DIST - reach;
      sc.far = SUN_DIST + reach;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.045 / (2 * reach); // a fixed 0.045 world units
    }
    lightRight.crossVectors(new THREE.Vector3(0, 1, 0), LIGHT_DIR).normalize();
    lightUp.crossVectors(LIGHT_DIR, lightRight).normalize();
    const texel = (2 * ext) / sun.shadow.mapSize.x;
    tmp.set(view.x, 0, view.z - spanZ * 0.08);
    const a = Math.round(tmp.dot(lightRight) / texel) * texel;
    const b = Math.round(tmp.dot(lightUp) / texel) * texel;
    const c = tmp.dot(LIGHT_DIR);
    sun.target.position.set(0, 0, 0).addScaledVector(lightRight, a).addScaledVector(lightUp, b).addScaledVector(LIGHT_DIR, c);
    sun.position.copy(sun.target.position).addScaledVector(LIGHT_DIR, SUN_DIST);
    sun.target.updateMatrixWorld();

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  };

  view.lightDir = LIGHT_DIR;
  return view;
}
