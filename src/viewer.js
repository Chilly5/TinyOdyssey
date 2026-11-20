// The map is one very large pre-rendered image, cut into tiles. This module
// draws the part of it you are looking at: it streams tiles for the current
// zoom, keeps their pixels hard-edged when magnified and smooth when shrunk,
// animates the sea, lets other modules draw sprites on top, and finishes with
// bloom, a contrast curve and a tilt-shift blur. At night it darkens and cools the
// whole picture and lets lamps (viewer.setLights) light what is round them.
//
// Positions everywhere are in "map pixels", the grid of the splat render. The
// painted picture is several times finer than that, and finer still round the
// towns and landmarks, where extra levels of tiles exist (manifest.paint);
// only the tile code here needs to know.

const VS_QUAD = `#version 300 es
in vec2 a;
out vec2 uv;
void main() { uv = a; gl_Position = vec4(a * 2.0 - 1.0, 0.0, 1.0); }`;

const VS_TILE = `#version 300 es
in vec2 a;
uniform vec4 uRect;   // tile rectangle in image pixels
uniform vec4 uUV;     // part of the texture to use (for stand-in tiles)
uniform vec4 uView;   // centre x, centre y, device pixels per image pixel, unused
uniform vec2 uRes;
out vec2 vUV;
out vec2 vImg;
void main() {
  vImg = uRect.xy + a * uRect.zw;
  vUV = uUV.xy + a * uUV.zw;
  vec2 p = (vImg - uView.xy) * uView.z / (uRes * 0.5);
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`;

// Hard-edged texels with one device pixel of smoothing, so pixel art does not shimmer.
const GLSL_SHARP = `
vec4 sharp(sampler2D t, vec2 uv, vec2 size) {
  vec2 px = uv * size;
  vec2 fw = max(fwidth(px), vec2(1e-5));
  // Inside a texel, sample its centre; only within a device pixel of the line between two texels, blend them.
  vec2 seam = floor(px + 0.5);
  vec2 q = seam + clamp((px - seam) / fw, -0.5, 0.5);
  return textureGrad(t, q / size, dFdx(uv), dFdy(uv)); // the snapped lookup must not choose the mip level
}`;

const FS_TILE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uSea;
uniform vec2 uTexSize;
uniform vec4 uGeo;     // pixels per world unit, top offset, depth factor, sea samples per unit
uniform vec2 uSeaSize;
uniform float uTime;
uniform float uFx;     // 0..1: how much fine sea animation to draw at this zoom
uniform float uDetail; // picture pixels per map pixel
in vec2 vUV;
in vec2 vImg;
out vec4 o;
${GLSL_SHARP}
float hash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec4 c = sharp(uTex, vUV, uTexSize);
  if (c.a < 0.5) discard;
  vec3 col = c.rgb;
  if (c.a < 0.9985 && uFx > 0.0) {
    // Water. Everything below is worked out per picture pixel, so it stays pixel art.
    vec2 q = (floor(vImg * uDetail) + 0.5) / uDetail;
    float thin = 0.6 / sqrt(uDetail);
    vec2 w = vec2(q.x / uGeo.x, (q.y - uGeo.y) / (uGeo.z * uGeo.x));
    vec4 f = texture(uSea, w * uGeo.w / uSeaSize);
    float d = f.r * 3.0 - 0.75;      // distance to shore, world units
    vec3 foam = vec3(0.965, 0.988, 0.953);
    vec3 light = mix(col, foam, 0.62);
    float t = uTime;
    // Rivers and falls: a moving sparkle.
    if (d < -0.04 && hash(q + floor(t * 2.5 + hash(q) * 3.0)) < 0.06) col = mix(col, foam, 0.55 * uFx);
    // Surf: a line of foam that runs up the shore and slides back.
    float ph = t * 0.9 + 6.283 * vnoise(w * 0.8);
    float front = 0.085 + 0.06 * sin(ph);
    if (d < 0.3) {
      if (abs(d - front) < 0.018) col = foam;
      else if (d < front && hash(q + floor(t * 3.0)) < 0.42 * (1.0 - (front - d) / 0.12)) col = foam;
    }
    // Swell: broken lines that follow the coast and drift in.
    if (d > 0.22 && d < 2.1) {
      float k = d * 2.7 + t * 0.07 + 0.4 * vnoise(w * 0.55);
      float seg = vnoise(vec2(w.x * 1.9 + floor(k) * 7.3, w.y * 1.9 - floor(k) * 3.1));
      float thick = 0.045 + 0.03 * smoothstep(1.2, 0.3, d);
      if (fract(k) < thick && seg > 0.56) col = mix(col, light, uFx);
    }
    // Open water: short glints that come and go.
    if (d > 0.5) {
      vec2 cell = vec2(44.0, 24.0);
      vec2 g = floor(q / cell);
      float r = hash(g);
      float life = fract(t * (0.16 + 0.1 * r) + r * 9.0);
      if (life < 0.42) {
        vec2 c0 = (g + vec2(0.18 + 0.64 * hash(g + 3.7), 0.2 + 0.6 * hash(g + 9.1))) * cell;
        float len = (2.0 + 5.0 * r) * sin(life / 0.42 * 3.1416);
        vec2 dq = q - floor(c0) - 0.5 - vec2(life * 9.0, 0.0);
        if (abs(dq.y) < thin && abs(dq.x) < len) col = mix(col, light, uFx);
        else if (abs(dq.y - 1.0) < thin && abs(dq.x + 2.0) < len * 0.5 && r > 0.5) col = mix(col, light, uFx * 0.7);
      }
    }
  }
  o = vec4(col, 1.0);
}`;

const VS_SPRITE = `#version 300 es
in vec2 aPos;
in vec2 aUV;
in vec4 aCol;
in float aZ;
uniform vec4 uView;
uniform vec2 uRes;
out vec2 vUV;
out vec4 vCol;
out vec2 vImg;
out float vZ;
void main() {
  vUV = aUV;
  vCol = aCol;
  vImg = aPos;
  vZ = aZ;
  vec2 p = (aPos - uView.xy) * uView.z / (uRes * 0.5);
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`;

// A sprite that stands on the ground says how far south it stands (aZ, in map pixels; negative for
// things that are never hidden). uOcc holds the height of the scenery at every pixel of the view;
// with the pixel's own row that gives how far south the scenery there stands, and whatever of the
// sprite is behind something nearer the camera is not drawn.
const FS_SPRITE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uOcc;
uniform vec2 uTexSize;
uniform vec2 uRes;
uniform vec4 uCam;   // top offset, depth factor, height factor, 1 when uOcc is drawn
in vec2 vUV;
in vec4 vCol;
in vec2 vImg;
in float vZ;
out vec4 o;
${GLSL_SHARP}
void main() {
  if (vZ >= 0.0 && uCam.w > 0.5) {
    float h = texture(uOcc, gl_FragCoord.xy / uRes).r * 255.0;
    if ((vImg.y - uCam.x + uCam.z * h) / uCam.y > vZ + 4.0) discard;
  }
  vec4 c = sharp(uTex, vUV / uTexSize, uTexSize);
  // aCol.a < 0 marks a silhouette: the sprite's shape in a flat colour (shadows).
  o = vCol.a < 0.0 ? vec4(vCol.rgb, 1.0) * (c.a * -vCol.a) : c * vCol;
}`;

const FS_OCC = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 o;
void main() { o = vec4(texture(uTex, vUV).r, 0.0, 0.0, 1.0); }`;

// Lamps at night: each a soft round glow, added together into a picture of the light on the scene.
const VS_LIGHT = `#version 300 es
in vec2 aPos;
in vec2 aUV;
in vec4 aCol;
uniform vec4 uView;
uniform vec2 uRes;
out vec2 vUV;
out vec4 vCol;
void main() {
  vUV = aUV;
  vCol = aCol;
  vec2 p = (aPos - uView.xy) * uView.z / (uRes * 0.5);
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`;
const FS_LIGHT = `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vCol;
out vec4 o;
void main() {
  float a = max(0.0, 1.0 - length(vUV));
  o = vec4(vCol.rgb * a * a, 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uThreshold;
in vec2 uv;
out vec4 o;
void main() {
  vec3 c = texture(uTex, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float hi = max(c.r, max(c.g, c.b));
  float warm = max(0.0, c.r - c.b - 0.35) * hi;
  // Only what is nearly white glows (foam, marble, snow, cloud), plus hot colours (fire, gold, lava).
  float wgt = smoothstep(uThreshold, uThreshold + 0.14, l + warm * 0.4);
  o = vec4(c * wgt, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 uv;
out vec4 o;
void main() {
  vec3 c = texture(uTex, uv).rgb * 0.227027;
  c += (texture(uTex, uv + uStep * 1.3846).rgb + texture(uTex, uv - uStep * 1.3846).rgb) * 0.316216;
  c += (texture(uTex, uv + uStep * 3.2308).rgb + texture(uTex, uv - uStep * 3.2308).rgb) * 0.070270;
  o = vec4(c, 1.0);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform vec2 uPx;        // one device pixel in uv
uniform float uBlur;     // tilt-shift radius at the top and bottom edges, device pixels
uniform float uBloom;
uniform float uContrast;
uniform float uPoster;   // colour steps per channel in the pixel look (0: leave colours alone)
uniform sampler2D uLight; // lamplight over the view (only looked at when uNight > 0)
uniform float uNight;    // 0 day .. 1 night
uniform vec3 uTint;      // the colour of the daylight: white at noon, warm at dusk and dawn
in vec2 uv;
out vec4 o;
void main() {
  // Tilt-shift: sharp across the middle, out of focus towards the top and bottom.
  float e = abs(uv.y - 0.52) * 2.0;
  float r = uBlur * smoothstep(0.5, 1.0, e);
  vec3 c = texture(uScene, uv).rgb;
  if (r > 0.35) {
    vec3 s = c * 2.0;
    s += texture(uScene, uv + uPx * r * vec2(0.92, 0.38)).rgb;
    s += texture(uScene, uv + uPx * r * vec2(-0.38, 0.92)).rgb;
    s += texture(uScene, uv + uPx * r * vec2(-0.92, -0.38)).rgb;
    s += texture(uScene, uv + uPx * r * vec2(0.38, -0.92)).rgb;
    s += texture(uScene, uv + uPx * r * vec2(0.5, -0.5)).rgb * 0.75;
    s += texture(uScene, uv + uPx * r * vec2(-0.5, 0.5)).rgb * 0.75;
    s += texture(uScene, uv + uPx * r * vec2(0.5, 0.5)).rgb * 0.75;
    s += texture(uScene, uv + uPx * r * vec2(-0.5, -0.5)).rgb * 0.75;
    c = s / 9.0;
  }
  c *= uTint;
  if (uNight > 0.001) {
    // Moonlight: darker, bluer, less colour. Lamplight brings the true colours back, warmed, round each lamp.
    vec3 L = texture(uLight, uv).rgb;
    float grey = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 moon = mix(vec3(grey), c, 0.6) * vec3(0.27, 0.35, 0.62) + vec3(0.0, 0.004, 0.018);
    vec3 lamp = c * (0.3 + L * 1.05) + L * 0.2;
    float lit = clamp(max(L.r, max(L.g, L.b)) * 1.6, 0.0, 1.0);
    c = mix(c, mix(moon, max(moon, lamp), lit), uNight);
  }
  // The pixel look: a limited range of colours, the same for the map and for everything drawn over it.
  if (uPoster > 0.0) c = floor(c * uPoster + 0.5) / uPoster;
  vec3 bloom = texture(uBloomA, uv).rgb * 0.55 + texture(uBloomB, uv).rgb * 0.75;
  // Contrast first, so the glow is laid over deepened shadows rather than washed into them.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + 0.06 * uContrast);
  vec3 curve = c * c * (3.0 - 2.0 * c);
  c = mix(c, curve, 0.5 * uContrast);
  c = c + bloom * uBloom * (1.0 - c * 0.3);
  // Vignette.
  vec2 v = uv - 0.5;
  c *= 1.0 - dot(v, v) * 0.42;
  o = vec4(c, 1.0);
}`;

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, vs.includes('in vec2 aPos') ? 'aPos' : 'a');
  // Everything drawn from the sprite batch finds its attributes in the same places.
  gl.bindAttribLocation(p, 1, 'aUV');
  gl.bindAttribLocation(p, 2, 'aCol');
  gl.bindAttribLocation(p, 3, 'aZ');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

export function createViewer(canvas, manifest, base) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');
  const M = manifest;
  // The painted pyramid if there is one, else the splat render's own tiles.
  const P = M.paint || { detail: 1, ext: 'png', tile: M.tile, levels: M.levels };
  const D = P.detail, LV = P.levels, TS = P.tile;
  const BASE_D = P.base || D; // the detail of the level that covers the whole map
  const maxLevel = LV.length - 1;
  // The finest levels only have tiles where something was painted in more detail.
  const sparse = LV.map((l) => (l.tiles ? new Set(l.tiles) : null));
  const exists = (L, x, y) => !sparse[L] || sparse[L].has(x + '_' + y);
  // The finest level that has a tile at a point of the map.
  const finestAt = (x, y) => {
    for (let L = 0; L < maxLevel; L++) {
      if (!sparse[L]) return L;
      const span = (TS * 2 ** L) / D;
      if (sparse[L].has(Math.floor(x / span) + '_' + Math.floor(y / span))) return L;
    }
    return maxLevel;
  };

  const progTile = program(gl, VS_TILE, FS_TILE);
  const progSprite = program(gl, VS_SPRITE, FS_SPRITE);
  const progOcc = program(gl, VS_TILE, FS_OCC);
  const progLight = program(gl, VS_LIGHT, FS_LIGHT);
  const progBright = program(gl, VS_QUAD, FS_BRIGHT);
  const progBlur = program(gl, VS_QUAD, FS_BLUR);
  const progFinal = program(gl, VS_QUAD, FS_FINAL);

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (filter = gl.LINEAR) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const loadBitmap = async (url, premultiply) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return createImageBitmap(await res.blob(), { premultiplyAlpha: premultiply ? 'premultiply' : 'none', colorSpaceConversion: 'none' });
  };
  const upload = (tex, bmp, premultiplied) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    void premultiplied;
  };

  // --- Render targets ------------------------------------------------------------
  const target = () => ({ fb: gl.createFramebuffer(), tex: texture(), w: 0, h: 0 });
  const sizeTarget = (t, w, h) => {
    if (t.w === w && t.h === h) return;
    t.w = w;
    t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };
  const scene = target(), halfA = target(), halfB = target(), quartA = target(), quartB = target();
  const occT = target(); // the scenery's height over the view, for hiding figures behind it
  const lightT = target(); // lamplight over the view, at night
  let lamps = null; // x, y, reach (map pixels), red, green, blue, flicker: seven numbers a lamp

  // --- What hides the figures: tiles of the scenery's height, one map pixel to the pixel ------
  const OCC = M.occ || null;
  const occHas = OCC ? new Set(OCC.tiles) : null;
  const occTiles = new Map(); // "x_y" -> { tex, state, used }
  let occLoading = 0;
  const occWant = (k) => {
    let t = occTiles.get(k);
    if (!t) {
      t = { tex: null, state: 0, used: tick };
      occTiles.set(k, t);
    }
    t.used = tick;
    if (t.state === 0 && occLoading < 3) {
      t.state = 1;
      occLoading++;
      loadBitmap(`${base}${OCC.dir}/${k}.${OCC.ext}?v=${M.version}`, false).then((bmp) => {
        t.tex = texture();
        upload(t.tex, bmp);
        t.w = bmp.width;
        t.h = bmp.height;
        t.state = 2;
        bmp.close?.();
      }).catch(() => { t.state = 3; }).finally(() => { occLoading--; });
    }
    return t;
  };
  const occEvict = () => {
    if (occTiles.size < 28) return;
    for (const [k, t] of occTiles) {
      if (t.state === 2 && t.used < tick - 240) {
        gl.deleteTexture(t.tex);
        occTiles.delete(k);
      }
    }
  };

  // --- Tiles ---------------------------------------------------------------------
  const tiles = new Map(); // key -> { tex, w, h, state, used }
  const queue = [];
  let loading = 0;
  let tick = 0;
  const key = (L, x, y) => `${L}/${x}_${y}`;
  const pump = () => {
    while (loading < 6 && queue.length) {
      // Nearest the centre of the view first.
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].pri < queue[bi].pri) bi = i;
      const job = queue.splice(bi, 1)[0];
      const t = job.tile;
      if (t.used < tick - 2 && !job.keep) { // scrolled away before its turn came
        tiles.delete(job.k);
        continue;
      }
      loading++;
      t.state = 1;
      loadBitmap(`${base}tiles/${job.k}.${P.ext}?v=${M.version}`, false).then((bmp) => {
        t.tex = texture();
        upload(t.tex, bmp);
        if (D > 1) { // painted detail shimmers when shrunk unless it is filtered
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        }
        t.w = bmp.width;
        t.h = bmp.height;
        t.state = 2;
        bmp.close?.();
        viewer.dirty = true;
      }).catch(() => { t.state = 3; }).finally(() => {
        loading--;
        pump();
      });
    }
  };
  const want = (L, x, y, pri, keep = false) => {
    const k = key(L, x, y);
    let t = tiles.get(k);
    if (!t) {
      t = { tex: null, w: 0, h: 0, state: 0, used: tick, keep };
      tiles.set(k, t);
      queue.push({ k, tile: t, pri, keep });
    }
    t.used = tick;
    return t;
  };
  const evict = () => {
    if (tiles.size < 220) return;
    const old = [...tiles.entries()].filter(([, t]) => t.state === 2 && !t.keep).sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < old.length - 150; i++) {
      gl.deleteTexture(old[i][1].tex);
      tiles.delete(old[i][0]);
    }
  };

  // --- Sea field and sprite atlas ------------------------------------------------------
  const seaTex = texture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
  let seaReady = false;
  loadBitmap(`${base}${M.sea.file}?v=${M.version}`, false).then((bmp) => {
    upload(seaTex, bmp);
    seaReady = true;
  }).catch(() => {});

  const atlas = { tex: texture(), w: 1, h: 1, frames: {} };
  const sheets = [atlas]; // sprite textures: the atlas first, then animation sheets, then the units' sheets
  let sheet = 0;
  let unitSheet = 1; // index of the units' first sheet
  let flush = () => {};
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  // Sprite batch: quads in image coordinates.
  const MAXQ = 8000;
  const vdata = new ArrayBuffer(MAXQ * 6 * 24);
  const vf = new Float32Array(vdata), vu = new Uint32Array(vdata);
  const spriteVAO = gl.createVertexArray();
  gl.bindVertexArray(spriteVAO);
  const spriteBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.bufferData(gl.ARRAY_BUFFER, vdata.byteLength, gl.DYNAMIC_DRAW);
  const locUV = gl.getAttribLocation(progSprite.p, 'aUV'), locCol = gl.getAttribLocation(progSprite.p, 'aCol'), locZ = gl.getAttribLocation(progSprite.p, 'aZ');
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(locUV);
  gl.vertexAttribPointer(locUV, 2, gl.FLOAT, false, 24, 8);
  gl.enableVertexAttribArray(locCol);
  gl.vertexAttribPointer(locCol, 4, gl.BYTE, true, 24, 16);
  gl.enableVertexAttribArray(locZ);
  gl.vertexAttribPointer(locZ, 1, gl.FLOAT, false, 24, 20);
  let nq = 0;
  const packCol = (r, g, b, a) => ((Math.round(a * 127) & 255) << 24 | (Math.round(b * 127) & 255) << 16 | (Math.round(g * 127) & 255) << 8 | (Math.round(r * 127) & 255)) >>> 0;
  const WHITE = packCol(1, 1, 1, 1);
  // z: how far south the thing stands, for hiding it behind scenery (see FS_SPRITE); -1 for never hidden.
  const pushQuad = (x0, y0, x1, y1, u0, v0, u1, v1, col, z = -1) => {
    if (nq >= MAXQ) return;
    let o = nq * 36;
    const put = (x, y, u, v) => {
      vf[o] = x; vf[o + 1] = y; vf[o + 2] = u; vf[o + 3] = v; vu[o + 4] = col; vf[o + 5] = z;
      o += 6;
    };
    put(x0, y0, u0, v0); put(x1, y0, u1, v0); put(x0, y1, u0, v1);
    put(x1, y0, u1, v0); put(x1, y1, u1, v1); put(x0, y1, u0, v1);
    nq++;
  };
  const draw = {
    // A named frame with its anchor at (x, y). Options: flip, alpha, scale, shadow (flat colour silhouette).
    sprite(name, x, y, o) {
      const f = atlas.frames[name];
      if (!f) return;
      const s = ((o && o.scale) || 1) / (f[6] || 1); // f[6]: sprite pixels per map pixel
      const flip = o && o.flip;
      const x0 = Math.round(x * D) / D - (flip ? f[2] - f[4] : f[4]) * s, y0 = Math.round(y * D) / D - f[5] * s;
      let col = WHITE;
      if (o && o.shadow) col = packCol(o.shadow[0], o.shadow[1], o.shadow[2], -(o.alpha ?? 0.3));
      else if (o && (o.alpha != null || o.tint)) {
        const a = o.alpha ?? 1, t = o.tint || [1, 1, 1];
        col = packCol(t[0] * a, t[1] * a, t[2] * a, a);
      }
      pushQuad(x0, y0, x0 + f[2] * s, y0 + f[3] * s, flip ? f[0] + f[2] : f[0], f[1], flip ? f[0] : f[0] + f[2], f[1] + f[3], col);
    },
    // Switch to another sprite texture (0 is the atlas). Returns false if it has not loaded yet.
    use(k) {
      if (!sheets[k]) return false;
      if (k !== sheet) {
        flush();
        sheet = k;
        gl.bindTexture(gl.TEXTURE_2D, sheets[k].tex);
        gl.uniform2f(progSprite.u.uTexSize, sheets[k].w, sheets[k].h);
      }
      return true;
    },
    // Copy a rectangle of the current texture to (x, y) in the image, s map pixels per texel.
    blit(x, y, u, v, w, h, s = 1) {
      pushQuad(x, y, x + w * s, y + h * s, u, v, u + w, v + h, WHITE);
    },
    // One frame of a unit (see units/build.py): rec is [sheet, x, y, w, h, ax, ay], drawn q pixels to the map pixel.
    // z says how far south it stands (viewer.depthOf), so that scenery in front of it hides it.
    frame(rec, q, x, y, alpha = 1, z = -1) {
      if (!rec || !draw.use(unitSheet + rec[0])) return false;
      const s = 1 / q;
      // In the pixel look a unit moves in steps of the map's own pixels, so the two grids stay in register.
      const g = viewer.pixel > 1 ? Math.min(0.5, Math.max(viewer.texel, s)) : 1 / D;
      const x0 = Math.round(x / g) * g - rec[5] * s, y0 = Math.round(y / g) * g - rec[6] * s;
      pushQuad(x0, y0, x0 + rec[3] * s, y0 + rec[4] * s, rec[1], rec[2], rec[1] + rec[3], rec[2] + rec[4], alpha >= 1 ? WHITE : packCol(alpha, alpha, alpha, alpha), z);
      return true;
    },
    // A soft dark oval on the ground under something.
    blob(x, y, rx, ry, a = 0.25, z = -1) {
      const f = atlas.frames.disc_9;
      if (!f || !draw.use(0)) return;
      pushQuad(x - rx, y - ry, x + rx, y + ry, f[0], f[1], f[0] + f[2], f[1] + f[3], packCol(0.05 * a, 0.04 * a, 0.14 * a, a), z);
    },
    // A flat rectangle of image pixels. Colour components 0..1. grid: how many steps to the map pixel it may sit on.
    rect(x, y, w, h, r, g, b, a = 1, grid = 1) {
      const f = atlas.frames.white;
      if (!f) return;
      const x0 = Math.round(x * grid) / grid, y0 = Math.round(y * grid) / grid;
      pushQuad(x0, y0, x0 + w, y0 + h, f[0] + 1, f[1] + 1, f[0] + 2, f[1] + 2, packCol(r * a, g * a, b * a, a));
    },
  };

  const viewer = {
    gl, manifest: M, draw, atlas,
    cx: M.w / 2, cy: M.h / 2, zoom: 0.2, // zoom: CSS pixels per image pixel
    cssW: 1, cssH: 1, dpr: 1, minZoom: 0.05, maxZoom: D > 1 ? Math.max(D * 1.25, BASE_D * 2) : 10, detail: D, base: BASE_D,
    // The pixel look: 0 shows the picture one painted pixel to the screen pixel (smooth); 2 shows it in hard
    // pixels at least two screen pixels across, like the sprites drawn over it. texel is the size of one
    // displayed pixel of the picture, in map pixels.
    pixel: 0, texel: 1 / D,
    setPixel(n) {
      viewer.pixel = n > 1 ? n : 0;
      viewer.maxZoom = D > 1 ? Math.max(D * 1.25 * (viewer.pixel || 1), BASE_D * 2) : 10;
    },
    // How far in it is worth going at a point: the land is painted finely enough to go all the way
    // (in the towns that is a little past one screen pixel to the painted pixel, in open country about
    // two and a half, which still shows as crisp cubes); open sea has less to show and stops sooner.
    zoomLimit(x, y) {
      if (D <= 1) return 10;
      const d = D / 2 ** finestAt(x, y);
      return d > BASE_D ? Math.min(D * 1.25, d * 2.5) * (viewer.pixel || 1) : d * 2.5;
    },
    bloom: 1, contrast: 1, tilt: 1, poster: 14,
    night: 0, tint: [1, 1, 1], // set by whoever keeps the time of day
    // The lamps that light the night: seven numbers each (x, y, reach in map pixels, red, green, blue, flicker).
    setLights(list) { lamps = list; },
    dirty: true,

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      viewer.cssW = w;
      viewer.cssH = h;
      viewer.dpr = dpr;
      canvas.width = Math.max(2, Math.round(w * dpr));
      canvas.height = Math.max(2, Math.round(h * dpr));
      viewer.minZoom = Math.min(w / M.w, h / M.h) * 0.92;
      viewer.zoom = Math.max(viewer.zoom, viewer.minZoom);
    },

    toScreen(ix, iy, out = {}) {
      out.x = (ix - viewer.cx) * viewer.zoom + viewer.cssW / 2;
      out.y = (iy - viewer.cy) * viewer.zoom + viewer.cssH / 2;
      return out;
    },
    toImage(sx, sy, out = {}) {
      out.x = (sx - viewer.cssW / 2) / viewer.zoom + viewer.cx;
      out.y = (sy - viewer.cssH / 2) / viewer.zoom + viewer.cy;
      return out;
    },
    clamp() {
      const mx = viewer.cssW / viewer.zoom / 2, my = viewer.cssH / viewer.zoom / 2;
      const padX = Math.min(mx * 0.7, 600), padY = Math.min(my * 0.7, 400);
      viewer.cx = mx * 2 > M.w + 2 * padX ? M.w / 2 : Math.max(mx - padX, Math.min(M.w - mx + padX, viewer.cx));
      viewer.cy = my * 2 > M.h + 2 * padY ? M.h / 2 : Math.max(my - padY, Math.min(M.h - my + padY, viewer.cy));
    },
    // How far south something stands whose foot is drawn at image row y on ground of height h.
    depthOf: (y, h = 0) => (y - M.oy + M.ky * h) / M.kz,
    // The rectangle of the image now on screen: [x0, y0, x1, y1].
    bounds() {
      const mx = viewer.cssW / viewer.zoom / 2, my = viewer.cssH / viewer.zoom / 2;
      return [viewer.cx - mx, viewer.cy - my, viewer.cx + mx, viewer.cy + my];
    },

    // Install the sprite atlas: the baked sheet plus a strip of glyphs drawn here.
    setAtlas(source, w, h, frames) {
      gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      atlas.w = w;
      atlas.h = h;
      atlas.frames = frames;
    },

    // Add a sprite texture at index `at`, for draw.use(). smooth: it will be drawn smaller than life.
    addSheet(bitmap, at, smooth = false) {
      const tex = texture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (smooth) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, 1);
      }
      sheets[at] = { tex, w: bitmap.width, h: bitmap.height };
    },
    // Forget a sprite texture again (the sheets of a landmark that is no longer in sight).
    dropSheet(at) {
      if (!sheets[at] || at === 0) return;
      gl.deleteTexture(sheets[at].tex);
      sheets[at] = undefined;
    },
    // Where the units' sheets start among the sprite textures.
    setUnitSheet(at) { unitSheet = at; },

    // time in seconds; overlay(draw, layer) is called for layer 0 (on the sea) and 1 (in the air).
    render(time, overlay) {
      tick++;
      const W = canvas.width, H = canvas.height;
      const zd = viewer.zoom * viewer.dpr;
      const view = [viewer.cx, viewer.cy, zd, 0];
      sizeTarget(scene, W, H);
      const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1), qw = Math.max(2, W >> 2), qh = Math.max(2, H >> 2);
      sizeTarget(halfA, hw, hh); sizeTarget(halfB, hw, hh);
      sizeTarget(quartA, qw, qh); sizeTarget(quartB, qw, qh);
      sizeTarget(lightT, hw, hh);

      // 1. The image.
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.082, 0.071, 0.18, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(progTile.p);
      gl.bindVertexArray(quad);
      gl.uniform4fv(progTile.u.uView, view);
      gl.uniform2f(progTile.u.uRes, W, H);
      gl.uniform4f(progTile.u.uGeo, M.px, M.oy, M.kz, M.sea.res);
      gl.uniform2f(progTile.u.uSeaSize, M.sea.w, M.sea.h);
      gl.uniform1f(progTile.u.uTime, time);
      gl.uniform1f(progTile.u.uDetail, BASE_D);
      gl.uniform1f(progTile.u.uFx, seaReady ? Math.max(0, Math.min(1, (zd - 0.16) / 0.2)) : 0);
      gl.uniform1i(progTile.u.uTex, 0);
      gl.uniform1i(progTile.u.uSea, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, seaTex);
      gl.activeTexture(gl.TEXTURE0);

      // Pick the level whose pixels are at least as big as device pixels, so they are never minified.
      const grain = viewer.pixel > 1 ? viewer.pixel : 1;
      const L = Math.max(0, Math.min(maxLevel, Math.ceil(Math.log2((D * grain) / zd) - 0.001)));
      viewer.texel = 2 ** L / D;
      const [bx0, by0, bx1, by1] = viewer.bounds();
      const unit = 2 ** L / D; // map pixels per tile pixel at this level
      const span = TS * unit;
      const lv = LV[L];
      const tx0 = Math.max(0, Math.floor(bx0 / span)), tx1 = Math.min(lv.cols - 1, Math.floor(bx1 / span));
      const ty0 = Math.max(0, Math.floor(by0 / span)), ty1 = Math.min(lv.rows - 1, Math.floor(by1 / span));
      const drawTile = (t, rx, ry, rw, rh, u0, v0, du, dv) => {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform2f(progTile.u.uTexSize, t.w, t.h);
        gl.uniform4f(progTile.u.uRect, rx, ry, rw, rh);
        gl.uniform4f(progTile.u.uUV, u0, v0, du, dv);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      // Draw the part of a coarser tile (up levels above L) that lies over tile (tx, ty) of level L.
      const standIn = (a, up, tx, ty) => {
        const f = 2 ** up, sub = TS / f;
        const u0 = ((tx % f) * sub) / a.w, v0 = ((ty % f) * sub) / a.h;
        const du = Math.min(sub, a.w - (tx % f) * sub) / a.w, dv = Math.min(sub, a.h - (ty % f) * sub) / a.h;
        if (du > 0 && dv > 0) drawTile(a, tx * span, ty * span, du * a.w * unit * f, dv * a.h * unit * f, u0, v0, du, dv);
      };
      const ready = [];
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const pri = Math.hypot((tx + 0.5) * span - viewer.cx, (ty + 0.5) * span - viewer.cy);
          // The finest level, from this one up, that has this piece of the picture at all.
          let own = 0;
          while (L + own < maxLevel && !exists(L + own, tx >> own, ty >> own)) own++;
          const t = want(L + own, tx >> own, ty >> own, pri);
          if (t.state === 2) {
            if (own === 0) ready.push([t, tx, ty]);
            else standIn(t, own, tx, ty);
            continue;
          }
          // Not here yet: stand in with the nearest coarser tile that has arrived.
          for (let up = own + 1; L + up <= maxLevel; up++) {
            const a = tiles.get(key(L + up, tx >> up, ty >> up));
            if (!a || a.state !== 2) continue;
            a.used = tick;
            standIn(a, up, tx, ty);
            break;
          }
        }
      }
      for (const [t, tx, ty] of ready) drawTile(t, tx * span, ty * span, t.w * unit, t.h * unit, 0, 0, 1, 1);
      pump();
      evict();

      // 1b. The scenery's height over the same view, once close enough for it to matter.
      const hiding = !!OCC && zd >= 0.9;
      if (hiding) {
        sizeTarget(occT, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, occT.fb);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(progOcc.p);
        gl.uniform4fv(progOcc.u.uView, view);
        gl.uniform2f(progOcc.u.uRes, W, H);
        gl.uniform1i(progOcc.u.uTex, 0);
        gl.uniform4f(progOcc.u.uUV, 0, 0, 1, 1);
        const T = OCC.tile;
        for (let ty = Math.max(0, Math.floor(by0 / T)); ty <= Math.min(OCC.rows - 1, Math.floor(by1 / T)); ty++) {
          for (let tx = Math.max(0, Math.floor(bx0 / T)); tx <= Math.min(OCC.cols - 1, Math.floor(bx1 / T)); tx++) {
            const k = tx + '_' + ty;
            if (!occHas.has(k)) continue;
            const t = occWant(k);
            if (t.state !== 2) continue;
            gl.bindTexture(gl.TEXTURE_2D, t.tex);
            gl.uniform4f(progOcc.u.uRect, tx * T, ty * T, t.w, t.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        }
        occEvict();
        gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      }

      // 2. Sprites over it.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(progSprite.p);
      gl.bindVertexArray(spriteVAO);
      gl.uniform4fv(progSprite.u.uView, view);
      gl.uniform2f(progSprite.u.uRes, W, H);
      gl.uniform2f(progSprite.u.uTexSize, atlas.w, atlas.h);
      gl.uniform1i(progSprite.u.uTex, 0);
      gl.uniform1i(progSprite.u.uOcc, 3);
      gl.uniform4f(progSprite.u.uCam, M.oy, M.kz, M.ky, hiding ? 1 : 0);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, occT.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
      sheet = 0;
      nq = 0;
      flush = () => {
        if (!nq) return;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vf, 0, nq * 36);
        gl.drawArrays(gl.TRIANGLES, 0, nq * 6);
        nq = 0;
      };
      if (overlay) {
        for (let layer = 0; layer < 2; layer++) {
          overlay(draw, layer);
          draw.use(0);
          flush();
        }
      }
      // 2b. At night, the light the lamps throw, at half size (it is soft anyway).
      const night = viewer.night;
      if (night > 0.001) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lightT.fb);
        gl.viewport(0, 0, hw, hh);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (lamps) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(progLight.p);
          gl.uniform4fv(progLight.u.uView, view);
          gl.uniform2f(progLight.u.uRes, W, H);
          const small = 1.7 / zd; // a lamp never shrinks to nothing: from far off a town is a scatter of sparks
          for (let i = 0; i < lamps.length; i += 7) {
            const x = lamps[i], y = lamps[i + 1], r = Math.max(lamps[i + 2], small);
            if (x + r < bx0 || x - r > bx1 || y + r < by0 || y - r > by1) continue;
            const k = lamps[i + 6] ? 1 + lamps[i + 6] * (Math.sin(time * 9 + i) * 0.6 + Math.sin(time * 23 + i * 1.7) * 0.4) : 1;
            pushQuad(x - r, y - r, x + r, y + r, -1, -1, 1, 1, packCol(Math.min(1, lamps[i + 3] * k), Math.min(1, lamps[i + 4] * k), Math.min(1, lamps[i + 5] * k), 1));
            if (nq >= MAXQ - 1) flush();
          }
          flush();
        }
      }
      gl.disable(gl.BLEND);

      // 3. Bloom: keep the bright parts, blur them at half and quarter size.
      gl.bindVertexArray(quad);
      const pass = (prog, dst, w, h, src, set) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(prog.u.uTex, 0);
        set && set(prog.u);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      pass(progBright, halfA, hw, hh, scene, (u) => gl.uniform1f(u.uThreshold, 0.86));
      pass(progBlur, halfB, hw, hh, halfA, (u) => gl.uniform2f(u.uStep, 1.2 / hw, 0));
      pass(progBlur, halfA, hw, hh, halfB, (u) => gl.uniform2f(u.uStep, 0, 1.2 / hh));
      pass(progBlur, quartB, qw, qh, halfA, (u) => gl.uniform2f(u.uStep, 1.6 / qw, 0));
      pass(progBlur, quartA, qw, qh, quartB, (u) => gl.uniform2f(u.uStep, 0, 1.6 / qh));
      pass(progBlur, quartB, qw, qh, quartA, (u) => gl.uniform2f(u.uStep, 2.6 / qw, 0));
      pass(progBlur, quartA, qw, qh, quartB, (u) => gl.uniform2f(u.uStep, 0, 2.6 / qh));

      // 4. Put it together.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progFinal.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, halfA.tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, quartA.tex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightT.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(progFinal.u.uLight, 3);
      gl.uniform1f(progFinal.u.uNight, night);
      gl.uniform3fv(progFinal.u.uTint, viewer.tint);
      gl.uniform1i(progFinal.u.uScene, 0);
      gl.uniform1i(progFinal.u.uBloomA, 1);
      gl.uniform1i(progFinal.u.uBloomB, 2);
      gl.uniform2f(progFinal.u.uPx, 1 / W, 1 / H);
      const near = Math.min(1, Math.max(0, (Math.log2(viewer.zoom) + 0.5) / 3)); // 0 below 0.7x, 1 from 5.6x
      gl.uniform1f(progFinal.u.uBlur, 2.4 * viewer.dpr * viewer.tilt * (1 - 0.85 * near));
      gl.uniform1f(progFinal.u.uBloom, 0.8 * viewer.bloom * (1 - 0.45 * near) * (1 - 0.7 * night)); // and the glow with it
      gl.uniform1f(progFinal.u.uContrast, viewer.contrast);
      gl.uniform1f(progFinal.u.uPoster, viewer.pixel > 1 ? viewer.poster : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      viewer.level = L;
    },

    // Resolves once the coarsest view of the whole map is on the GPU.
    async prime() {
      const top = LV[maxLevel];
      for (let y = 0; y < top.rows; y++) for (let x = 0; x < top.cols; x++) want(maxLevel, x, y, 0, true);
      if (maxLevel > 0) {
        const l = LV[maxLevel - 1];
        for (let y = 0; y < l.rows; y++) for (let x = 0; x < l.cols; x++) want(maxLevel - 1, x, y, 1, true);
      }
      pump();
      await new Promise((resolve) => {
        const check = () => {
          const t = tiles.get(key(maxLevel, 0, 0));
          if (t && t.state >= 2) resolve();
          else setTimeout(check, 30);
        };
        check();
      });
    },
    loadBitmap,
    pending: () => loading + queue.length,
  };
  return viewer;
}
