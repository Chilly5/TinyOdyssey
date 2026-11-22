// The map is one very large pre-rendered image, cut into tiles. This module
// draws the part of it you are looking at: it streams tiles for the current
// zoom, keeps their pixels hard-edged when magnified and smooth when shrunk,
// animates the sea, lets other modules draw sprites on top, and finishes with
// bloom, a contrast curve and a tilt-shift blur. At night it darkens and cools the
// whole picture and lets lamps (viewer.setLights) light what is round them.
//
// Positions everywhere are in "map pixels", the grid of the whole-map render. The
// picture exists several times finer than that, and finer still round the towns
// and landmarks, where extra levels of tiles exist; only the tile code here needs
// to know. A world can hold the picture in more than one style (manifest.styles:
// pixel art, stacked terraces, the painted version), each a pyramid of its own.

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

// A sprite stack (units/stack.py) is a model kept as flat slices, one for each step of its height. Its
// picture is put together here whenever it turns: every slice drawn into a small picture of its own,
// each a little higher than the one below and all turned by the same angle, in hard pixels. That small
// picture is then drawn on the map like any other sprite. A ship has a picture to itself (draw.stack);
// people, who come in numbers, share theirs (draw.pose).
const VS_STACK = `#version 300 es
in vec2 aPos;    // pixels of the picture being made
in vec2 aUV;     // texels of the sheet of slices
in vec4 aCol;    // red: this copy of the slice is the one that shows its top; alpha below 0: its shadow
uniform vec2 uRes;
out vec2 vUV;
out vec4 vCol;
void main() {
  vUV = aUV;
  vCol = aCol;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

// Under each slice on the sheet are its notes (units/stack.py): which way each cube's surface faces, and
// whether its top shows. The sun stands in the north-west and the model is seen from the south, so a side
// is lit by where it faces once the model has been turned: three flat tones for a side and one for a top,
// as the map's own buildings have (gen/looks.mjs).
const FS_STACK = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTurn;    // cosine and sine of the way it is heading (0 east, then clockwise on the map)
uniform vec4 uShadow;  // what its shadow is written as: a dark blue as strong as the daylight, or a plain mark
uniform int uNotes;    // how many rows below a slice its notes are
in vec2 vUV;
in vec4 vCol;
out vec4 o;
void main() {
  ivec2 at = ivec2(vUV);
  vec4 c = texelFetch(uTex, at, 0);
  if (c.a < 0.5) discard;
  if (vCol.a < 0.0) { o = uShadow; return; }
  vec3 note = texelFetch(uTex, at + ivec2(0, uNotes), 0).rgb;
  vec3 col = c.rgb;
  if (vCol.r > 0.5 && note.g > 0.5) col = mix(col, vec3(1.0, 0.98, 0.89), 0.08);
  else {
    float a = floor(note.r * 31.0 + 0.5) * 0.19634954;
    vec2 n = vec2(cos(a), sin(a));
    vec2 w = vec2(n.x * uTurn.x - n.y * uTurn.y, n.x * uTurn.y + n.y * uTurn.x);
    if (w.y < 0.0) w = -w;   // whichever face of it looks south is the one in sight
    float sun = note.b > 0.5 ? -0.3 : dot(w, vec2(-0.7071, -0.7071));
    col = sun > 0.2 ? mix(col, vec3(0.47, 0.48, 0.63), 0.1) * 0.94
        : sun > -0.86 ? mix(col, vec3(0.36, 0.38, 0.58), 0.2) * 0.9
        : mix(col, vec3(0.25, 0.27, 0.52), 0.34) * 0.82;
  }
  o = vec4(col, 1.0);
}`;

// The stack's picture, finished: a line round it in a darker, bluer shade of whatever it runs along,
// as the other units have (units/build.py).
const FS_RIM = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uPx;
in vec2 uv;
out vec4 o;
void main() {
  vec4 c = texture(uTex, uv);
  if (c.a > 0.9) { o = c; return; }
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = i == 0 ? vec2(uPx.x, 0.0) : i == 1 ? vec2(-uPx.x, 0.0) : i == 2 ? vec2(0.0, uPx.y) : vec2(0.0, -uPx.y);
    vec4 q = texture(uTex, uv + d);
    if (q.a > 0.9) sum += q;
  }
  o = sum.a > 0.5 ? vec4(sum.rgb / sum.a * vec3(0.5, 0.48, 0.58), 1.0) : c;
}`;

// A shadow laid on the ground by draw.shade(). The picture's alpha is 1 everywhere; a shadow lowers it
// by its own strength, and where several cross only the lowest is kept (they are blended with gl.MIN).
// shade() then darkens the view once by what has been marked. Hidden behind scenery as a sprite is.
const FS_CAST = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uOcc;
uniform vec2 uTexSize;
uniform vec2 uRes;
uniform vec4 uCam;
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
  o = vec4(0.0, 0.0, 0.0, 1.0 - sharp(uTex, vUV / uTexSize, uTexSize).r * vCol.a);
}`;

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
  // The styles the picture comes in. An older world has one: the painted pyramid, or the plain render's tiles.
  const STYLES = M.styles || { painted: { dir: 'tiles', ...(M.paint || { detail: 1, ext: 'png', tile: M.tile, levels: M.levels }) } };
  // These describe the pyramid being shown, and change together when the style does (setStyle).
  let P, D, LV, TS, BASE_D, maxLevel, sparse, NATIVE;
  const usePyramid = (name) => {
    P = STYLES[name];
    D = P.detail; LV = P.levels; TS = P.tile;
    BASE_D = P.base || D; // the detail of the level that covers the whole map
    maxLevel = LV.length - 1;
    // The finest levels only have tiles where something was drawn in more detail.
    sparse = LV.map((l) => (l.tiles ? new Set(l.tiles) : null));
    NATIVE = P.dir !== 'tiles'; // every level drawn in its own pixels (not a painting, which is smooth)
  };
  usePyramid(Object.keys(STYLES)[0]);
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
  const progStack = program(gl, VS_STACK, FS_STACK);
  const progRim = program(gl, VS_QUAD, FS_RIM);
  const progCast = program(gl, VS_SPRITE, FS_CAST);
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
  let era = 0; // goes up when the style changes: tiles asked for before then are no longer wanted
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
      const asked = era;
      loadBitmap(`${base}${P.dir}/${job.k}.${P.ext}?v=${M.version}`, false).then((bmp) => {
        if (asked !== era) { bmp.close?.(); return; }
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
  // zb: the same for its bottom edge, when the thing lies on the ground and so comes nearer down the screen.
  const pushQuad = (x0, y0, x1, y1, u0, v0, u1, v1, col, z = -1, zb = z) => {
    if (nq >= MAXQ) return;
    let o = nq * 36;
    const put = (x, y, u, v, d) => {
      vf[o] = x; vf[o + 1] = y; vf[o + 2] = u; vf[o + 3] = v; vu[o + 4] = col; vf[o + 5] = d;
      o += 6;
    };
    put(x0, y0, u0, v0, z); put(x1, y0, u1, v0, z); put(x0, y1, u0, v1, zb);
    put(x1, y0, u1, v0, z); put(x1, y1, u1, v1, zb); put(x0, y1, u0, v1, zb);
    nq++;
  };
  // The same rectangle of a texture, turned: (ox, oy) its top left corner, (ax, ay) the step along its
  // top edge for each texel and (bx, by) the step down its side.
  const pushTurned = (ox, oy, ax, ay, bx, by, u0, v0, w, h, col) => {
    if (nq >= MAXQ) flush();
    let o = nq * 36;
    const put = (i, j) => {
      vf[o] = ox + ax * i + bx * j; vf[o + 1] = oy + ay * i + by * j; vf[o + 2] = u0 + i; vf[o + 3] = v0 + j; vu[o + 4] = col; vf[o + 5] = -1;
      o += 6;
    };
    put(0, 0); put(w, 0); put(0, h);
    put(w, 0); put(w, h); put(0, h);
    nq++;
  };

  // --- Sprite stacks (units/stack.py) ----------------------------------------------------
  // A shadow runs this many voxels east, and as many south, for each voxel of height (gen/bake.mjs).
  const SUN = 0.8;
  const TURN = Math.PI / 120; // the smallest turn that is drawn afresh
  // Each size of a stack has a sheet of slices, fetched when that size is first wanted.
  const wantSlices = (set) => {
    if (set.state) return;
    set.state = 1;
    loadBitmap(`${base}${set.file}?v=${set.v}`, false).then((bmp) => {
      set.tex = texture(gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      // Five bits a channel is plenty for flat colours and the notes beside them, and half the memory.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB5_A1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      bmp.close?.();
      set.state = 2;
      viewer.dirty = true;
    }).catch(() => { set.state = 3; });
  };
  // Every ship has a finished picture of its own (two of one model seldom head the same way). The pictures
  // are sprite textures too, numbered well clear of the others, and are given up when the ship has not been
  // in sight for a while.
  const pics = new Set(), freeSheets = [];
  let stackSheet = 1000;
  const newPic = (set, holder, slot) => {
    const pic = { fb: gl.createFramebuffer(), tex: texture(), w: 0, h: 0, key: '', used: tick, holder, slot, sheet: freeSheets.length ? freeSheets.pop() : stackSheet++ };
    sizeTarget(pic, set.w, set.h);
    gl.bindTexture(gl.TEXTURE_2D, pic.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    sheets[pic.sheet] = { tex: pic.tex, w: set.w, h: set.h };
    pics.add(pic);
    if (!set.a) { // where a picture is put together before it gets its outline: one for all ships of this model and size
      set.a = { fb: gl.createFramebuffer(), tex: texture(gl.NEAREST), w: 0, h: 0 };
      sizeTarget(set.a, set.w, set.h);
    }
    return pic;
  };
  const dropPics = () => {
    for (const pic of pics) {
      if (pic.used > tick - 900) continue;
      gl.deleteFramebuffer(pic.fb);
      gl.deleteTexture(pic.tex);
      sheets[pic.sheet] = undefined;
      freeSheets.push(pic.sheet);
      pic.holder[pic.slot] = null;
      pics.delete(pic);
    }
    for (const set of figSets) if (set.used <= tick - 900) shutCells(set);
  };
  // What follows draws a stack's slices into a small picture, w by h, with the model's middle at (ax, ay).
  const SHADOW = packCol(0, 0, 0, -1), SIDE = packCol(0, 0, 0, 1), TOP = packCol(1, 0, 0, 1);
  const slicing = (set, w, h, c, s, r, g, b, a) => {
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); // a slice covers what is under it
    gl.useProgram(progStack.p);
    gl.bindVertexArray(spriteVAO);
    gl.uniform2f(progStack.u.uRes, w, h);
    gl.uniform2f(progStack.u.uTurn, c, s);
    gl.uniform4f(progStack.u.uShadow, r, g, b, a);
    gl.uniform1i(progStack.u.uNotes, set.notes);
    gl.uniform1i(progStack.u.uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, set.tex);
  };
  // One level: its corner turned about the model's middle, squeezed as the ground is, and moved by (dx, dy).
  const slice = (set, r, c, s, ax, ay, dx, dy, col) => {
    if (!r) return;
    const p = set.p, kz = M.kz, x = r[4], y = r[5];
    pushTurned(ax + (x * c - y * s) * p + dx, ay + (x * s + y * c) * p * kz + dy, c * p, s * p * kz, -s * p, c * p * kz, r[0], r[1], r[2], r[3], col);
  };
  // The shadow, flat on the ground: each level thrown as far to the south-east as it is high (twice within
  // its height, so that the shadow of something thin, a sail seen edge on or a spear, has no gaps).
  const thrown = (set, levels, c, s, ax, ay) => {
    const d = SUN * 0.5 * set.p;
    for (let k = 0; k < levels.length * 2; k++) slice(set, set.rects[levels[k >> 1]], c, s, ax, ay, d * (k + 0.5), d * (k + 0.5) * M.kz, SHADOW);
  };
  // The pile itself. Each level is as thick on the screen as it is tall: drawn again a pixel higher until the next begins.
  const piled = (set, levels, c, s, ax, ay) => {
    for (let k = 0; k < levels.length; k++) {
      const top = Math.round((k + 1) * set.p * M.ky);
      for (let up = Math.round(k * set.p * M.ky) + 1; up <= top; up++) slice(set, set.rects[levels[k]], c, s, ax, ay, 0, -up, up === top ? TOP : SIDE);
    }
  };
  // The picture in `from`, w by h, with a line put round it, into whatever is bound and wherever the viewport is.
  const rimmed = (from, w, h) => {
    gl.bindVertexArray(quad);
    gl.useProgram(progRim.p);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(progRim.u.uTex, 0);
    gl.uniform2f(progRim.u.uPx, 1 / w, 1 / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  let prog = progSprite; // what the sprite batch is being drawn with (draw.shade changes it for a while)
  const toScene = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.bindVertexArray(spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    sheet = -1;
  };
  // Put a ship's picture together: frame f of it, heading `turn` (radians), at one of its sizes.
  const compose = (set, pic, f, turn, shade) => {
    flush(); // whatever of the scene is waiting goes out first
    const c = Math.cos(turn), s = Math.sin(turn);
    const levels = set.frames[f % set.frames.length];
    gl.bindFramebuffer(gl.FRAMEBUFFER, set.a.fb);
    slicing(set, set.w, set.h, c, s, 0.03 * shade, 0.05 * shade, 0.17 * shade, shade);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (shade > 0.01) thrown(set, levels, c, s, set.ax, set.ay); // its shadow first, on the water
    piled(set, levels, c, s, set.ax, set.ay);
    flush();
    // The line round it, and smaller copies for when it is seen from far off.
    gl.bindFramebuffer(gl.FRAMEBUFFER, pic.fb);
    rimmed(set.a.tex, set.w, set.h);
    gl.bindTexture(gl.TEXTURE_2D, pic.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    toScene();
  };

  // --- Figures: stacks that many share ---------------------------------------------------
  // A ship has a picture of its own. People come in numbers and march in step, so each picture one of them
  // can show (this moment of the stride, facing this way) is put together once, in a cell of a sheet that
  // everyone of that kind and size is then drawn from: a soldier is one sprite, as in any old game, and a
  // company of them one batch. Their shadows are kept apart, on a second sheet, so that they can be laid
  // down first and together (draw.shade).
  // A sheet holds so many pictures of one figure at one size (set.n: more of the small ones, which are cheap and
  // are what a wide view full of people needs); the one longest unused gives way to a new one.
  const CELLS = 512;   // more than any sheet holds: a picture is known by its size and its cell together
  const FACINGS = 64;  // the ways a figure can face
  const figSets = new Set(); // the sizes that have sheets now
  const cellSheet = (cw, ch, n, format, kind) => {
    let W = 256;
    while (W < 2048 && W * W < n * cw * ch) W *= 2;
    const cols = Math.max(1, Math.floor(W / cw)), H = Math.ceil(n / cols) * ch;
    const t = { fb: gl.createFramebuffer(), tex: texture(), w: W, h: H, cols, sheet: freeSheets.length ? freeSheets.pop() : stackSheet++ };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, W, H, 0, kind, gl.UNSIGNED_BYTE, null);
    // Half-size copies too, for when it is seen a little smaller than drawn. No smaller: a cell would run into the next.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 1);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    sheets[t.sheet] = { tex: t.tex, w: W, h: H };
    return t;
  };
  const openCells = (set) => {
    set.body = cellSheet(set.bw, set.bh, set.n, gl.RGBA8, gl.RGBA);
    set.cast = cellSheet(set.cw, set.ch, set.n, gl.R8, gl.RED);
    set.a = { fb: gl.createFramebuffer(), tex: texture(gl.NEAREST), w: 0, h: 0 }; // where a figure is piled up before it gets its outline
    sizeTarget(set.a, set.bw, set.bh);
    set.where = new Map(); // frame and facing -> cell
    set.keys = new Int32Array(set.n).fill(-1);
    set.uses = new Int32Array(set.n);
    figSets.add(set);
    toScene();
  };
  const shutCells = (set) => {
    for (const t of [set.body, set.cast]) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
      sheets[t.sheet] = undefined;
      freeSheets.push(t.sheet);
    }
    gl.deleteFramebuffer(set.a.fb);
    gl.deleteTexture(set.a.tex);
    set.body = set.cast = set.a = null;
    figSets.delete(set);
  };
  // Put a figure's picture together in cell i: frame f, facing `turn`. Its shadow goes into the same cell of the other sheet.
  const composeCell = (set, i, f, turn) => {
    flush();
    const c = Math.cos(turn), s = Math.sin(turn);
    const levels = set.frames[f % set.frames.length];
    const B = set.body, S = set.cast;
    gl.bindFramebuffer(gl.FRAMEBUFFER, set.a.fb);
    slicing(set, set.bw, set.bh, c, s, 1, 1, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    piled(set, levels, c, s, set.bx, set.by);
    flush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb);
    gl.viewport((i % B.cols) * set.bw, Math.floor(i / B.cols) * set.bh, set.bw, set.bh);
    rimmed(set.a.tex, set.bw, set.bh);
    const x = (i % S.cols) * set.cw, y = Math.floor(i / S.cols) * set.ch;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    slicing(set, set.cw, set.ch, c, s, 1, 1, 1, 1);
    gl.viewport(x, y, set.cw, set.ch);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, set.cw, set.ch);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    thrown(set, levels, c, s, set.sx, set.sy);
    flush();
    B.stale = S.stale = true;
    toScene();
  };
  // The half-size copies of a sheet are made when it is next drawn from, once for however many cells were filled.
  const fresh = (t) => {
    if (!t.stale) return;
    flush();
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    t.stale = false;
    sheet = -1;
  };
  // The cell that holds a figure at frame f, facing step n of FACINGS; -1 if there is no room for another this frame.
  const cellFor = (set, f, n) => {
    const key = f * FACINGS + n;
    let i = set.where.get(key);
    if (i === undefined) {
      i = 0;
      for (let k = 1; k < set.n; k++) if (set.uses[k] < set.uses[i]) i = k;
      if (set.uses[i] === tick) return -1;
      if (set.keys[i] >= 0) set.where.delete(set.keys[i]);
      set.keys[i] = key;
      set.where.set(key, i);
      composeCell(set, i, f, (n / FACINGS) * Math.PI * 2);
    }
    set.uses[i] = tick;
    return i;
  };
  const shaded = [0, 0, 0, 0]; // how much of the picture the shadows of draw.shade() have reached
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
        gl.uniform2f(prog.u.uTexSize, sheets[k].w, sheets[k].h);
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
      // The thing has length as well as height: the part of it drawn below its anchor (a ship's bow, an ox's
      // head) stands that much nearer the camera, and must not be hidden by the level water or ground it is on.
      const near = z < 0 ? z : z + (Math.max(0, rec[4] - rec[6]) * s) / M.kz;
      pushQuad(x0, y0, x0 + rec[3] * s, y0 + rec[4] * s, rec[1], rec[2], rec[1] + rec[3], rec[2] + rec[4], alpha >= 1 ? WHITE : packCol(alpha, alpha, alpha, alpha), near);
      return true;
    },
    // A sprite stack (viewer.addStack) with its middle at (x, y): frame f of its movement, heading `turn`
    // radians (0 east, then clockwise as the map lies). z as for frame(). mine: an array the caller keeps for
    // this one ship, where its finished pictures are held. Returns false until it can be drawn.
    stack(st, f, turn, x, y, z = -1, mine = st.mine) {
      const zd = viewer.zoom * viewer.dpr;
      const need = viewer.pixel > 1 ? 0.99 / viewer.texel : zd * 0.85;
      let i = 0;
      for (let k = st.sets.length - 1; k > 0; k--) if (st.sets[k].q >= need) { i = k; break; }
      // The slices for that size may not have come yet: ask, and meanwhile make do with the nearest size that has.
      wantSlices(st.sets[i]);
      if (st.sets[i].state !== 2) {
        let j = -1;
        for (let k = i + 1; k < st.sets.length && j < 0; k++) if (st.sets[k].state === 2) j = k;
        for (let k = i - 1; k >= 0 && j < 0; k--) if (st.sets[k].state === 2) j = k;
        if (j < 0) {
          wantSlices(st.sets[st.sets.length - 1]); // the smallest is soonest here
          return false;
        }
        i = j;
      }
      const set = st.sets[i];
      let pic = mine[i];
      if (!pic) {
        flush(); // making one changes what is bound
        pic = mine[i] = newPic(set, mine, i);
      }
      pic.used = tick;
      // Its picture is put together again only when it has turned enough to show (a degree and a half; three
      // times that when it is seen small), moved an oar, or the light has changed.
      const step = zd < 1.2 ? TURN * 3 : TURN;
      const n = Math.round(turn / step), shade = (Math.round((1 - viewer.night) * 12) / 12) * 0.26;
      const key = f + '/' + n * step + '/' + shade;
      if (pic.key !== key) {
        compose(set, pic, f, n * step, shade);
        pic.key = key;
      }
      if (!draw.use(pic.sheet)) return false;
      const s = 1 / set.q;
      const g = viewer.pixel > 1 ? Math.min(0.5, Math.max(viewer.texel, s)) : 1 / D;
      const x0 = Math.round(x / g) * g - set.ax * s, y0 = Math.round(y / g) * g - set.ay * s;
      const x1 = x0 + set.w * s, ym = y0 + set.ay * s;
      // What is above its middle stands about there. What is below lies on the water (the near side of the
      // hull, the oars, the shadow) and so is nearer the camera row by row; scenery hides each part accordingly.
      pushQuad(x0, y0, x1, ym, 0, 0, set.w, set.ay, WHITE, z < 0 ? z : z + 2);
      pushQuad(x0, ym, x1, y0 + set.h * s, 0, set.ay, set.w, set.h, WHITE, z, z < 0 ? z : z + ((set.h - set.ay) * s) / M.kz);
      draw.use(0);
      return true;
    },
    // A figure that many share (viewer.addStack of a person): frame f of its stride, facing `turn` radians
    // (0 east, then clockwise as the map lies). Returns what cast() and figure() draw, or -1 until it can be
    // drawn. Ask for everyone's before drawing any of them: a picture not yet made is made here.
    pose(st, f, turn) {
      const zd = viewer.zoom * viewer.dpr;
      const need = viewer.pixel > 1 ? 0.99 / viewer.texel : zd * 0.85;
      let i = 0;
      for (let k = st.sets.length - 1; k > 0; k--) if (st.sets[k].q >= need) { i = k; break; }
      wantSlices(st.sets[i]);
      if (st.sets[i].state !== 2) {
        let j = -1;
        for (let k = i + 1; k < st.sets.length && j < 0; k++) if (st.sets[k].state === 2) j = k;
        for (let k = i - 1; k >= 0 && j < 0; k--) if (st.sets[k].state === 2) j = k;
        if (j < 0) {
          wantSlices(st.sets[st.sets.length - 1]);
          return -1;
        }
        i = j;
      }
      const set = st.sets[i];
      if (!set.body) {
        flush();
        openCells(set);
      }
      set.used = tick;
      // Sixty-four ways to face when it is seen large, half as many when small.
      const coarse = set.q < 8 ? 2 : 1;
      const n = (((Math.round((turn / (Math.PI * 2)) * (FACINGS / coarse)) * coarse) % FACINGS) + FACINGS) % FACINGS;
      const cell = cellFor(set, ((f % st.frames) + st.frames) % st.frames, n);
      return cell < 0 ? -1 : i * CELLS + cell;
    },
    // The figure pose() found, standing at (x, y). z as for frame().
    figure(st, at, x, y, z = -1, alpha = 1) {
      const set = st.sets[(at / CELLS) | 0], i = at % CELLS, B = set.body;
      if (!B) return false;
      fresh(B);
      if (!draw.use(B.sheet)) return false;
      const s = 1 / set.q;
      const g = viewer.pixel > 1 ? Math.min(0.5, Math.max(viewer.texel, s)) : 1 / D;
      const x0 = Math.round(x / g) * g - set.bx * s, y0 = Math.round(y / g) * g - set.by * s;
      const u = (i % B.cols) * set.bw, v = Math.floor(i / B.cols) * set.bh;
      pushQuad(x0, y0, x0 + set.bw * s, y0 + set.bh * s, u, v, u + set.bw, v + set.bh, alpha >= 1 ? WHITE : packCol(alpha, alpha, alpha, alpha), z < 0 ? z : z + 1);
      return true;
    },
    // Its shadow on the ground, `a` strong (0..1). Only inside draw.shade().
    cast(st, at, x, y, z = -1, a = 0.36) {
      const set = st.sets[(at / CELLS) | 0], i = at % CELLS, S = set.cast;
      if (!S) return;
      fresh(S);
      if (!draw.use(S.sheet)) return;
      const s = 1 / set.q;
      const g = viewer.pixel > 1 ? Math.min(0.5, Math.max(viewer.texel, s)) : 1 / D;
      const x0 = Math.round(x / g) * g - set.sx * s, y0 = Math.round(y / g) * g - set.sy * s;
      const u = (i % S.cols) * set.cw, v = Math.floor(i / S.cols) * set.ch;
      // It lies on the ground, so each row of it is as far south as it is far down the picture.
      pushQuad(x0, y0, x0 + set.cw * s, y0 + set.ch * s, u, v, u + set.cw, v + set.ch, packCol(0, 0, 0, a), z < 0 ? z : Math.max(0, z - (set.sy * s) / M.kz), z < 0 ? z : z + ((set.ch - set.sy) * s) / M.kz);
      shaded[0] = Math.min(shaded[0], x0); shaded[1] = Math.min(shaded[1], y0);
      shaded[2] = Math.max(shaded[2], x0 + set.cw * s); shaded[3] = Math.max(shaded[3], y0 + set.ch * s);
    },
    // Shadows laid on the ground together: fn draws them with draw.cast(). Where several cross, the ground is
    // darkened once and not once for each (a company of men would otherwise stand in a pool of ink): each
    // marks the picture's alpha, the lowest mark stays, and then the view is darkened by the marks and they
    // are wiped (FS_CAST).
    shade(fn) {
      const w = atlas.frames.white;
      if (!w) return;
      flush();
      prog = progCast;
      gl.useProgram(prog.p);
      sheet = -1;
      gl.colorMask(false, false, false, true);
      gl.blendEquation(gl.MIN);
      shaded[0] = shaded[1] = 1e9;
      shaded[2] = shaded[3] = -1e9;
      fn();
      flush();
      prog = progSprite;
      gl.useProgram(prog.p);
      sheet = -1;
      gl.blendEquation(gl.FUNC_ADD);
      draw.use(0);
      const wash = (col) => { // over as much of the picture as the shadows reached
        pushQuad(shaded[0] - 1, shaded[1] - 1, shaded[2] + 1, shaded[3] + 1, w[0] + 1, w[1] + 1, w[0] + 2, w[1] + 2, col);
        flush();
      };
      gl.colorMask(true, true, true, false);
      gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.DST_ALPHA);
      wash(packCol(0.03, 0.05, 0.17, 1));
      gl.colorMask(false, false, false, true);
      gl.blendFunc(gl.ONE, gl.ZERO);
      wash(WHITE);
      gl.colorMask(true, true, true, true);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    },
    // A soft dark oval on the ground under something.
    blob(x, y, rx, ry, a = 0.25, z = -1) {
      const f = atlas.frames.disc_9;
      if (!f || !draw.use(0)) return;
      pushQuad(x - rx, y - ry, x + rx, y + ry, f[0], f[1], f[0] + f[2], f[1] + f[3], packCol(0.05 * a, 0.04 * a, 0.14 * a, a), z < 0 ? z : z + ry / M.kz);
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
    cssW: 1, cssH: 1, dpr: 1, minZoom: 0.05, maxZoom: 10, detail: D, base: BASE_D,
    styles: Object.keys(STYLES), style: Object.keys(STYLES)[0],
    // Show the picture in another of its styles. Everything drawn over it stays as it is.
    setStyle(name) {
      if (!STYLES[name]) return;
      era++;
      for (const t of tiles.values()) if (t.tex) gl.deleteTexture(t.tex);
      tiles.clear();
      queue.length = 0;
      usePyramid(name);
      viewer.style = name;
      viewer.detail = D;
      viewer.base = BASE_D;
      viewer.setPixel(viewer.pixel);
      viewer.prime();
      viewer.dirty = true;
    },
    // The pixel look: 0 shows the picture one painted pixel to the screen pixel (smooth); 2 shows it in hard
    // pixels at least two screen pixels across, like the sprites drawn over it. texel is the size of one
    // displayed pixel of the picture, in map pixels.
    pixel: 0, texel: 1 / D,
    setPixel(n) {
      viewer.pixel = n > 1 ? n : 0;
      viewer.maxZoom = NATIVE ? D * 2.5 : D > 1 ? Math.max(D * 1.25 * (viewer.pixel || 1), BASE_D * 2) : 10;
    },
    // How far in it is worth going at a point: the land is painted finely enough to go all the way
    // (in the towns that is a little past one screen pixel to the painted pixel, in open country about
    // two and a half, which still shows as crisp cubes); open sea has less to show and stops sooner.
    zoomLimit(x, y) {
      if (D <= 1) return 10;
      const d = D / 2 ** finestAt(x, y);
      // Drawn pixels stay crisp when enlarged, so a native level may be shown a few times its size.
      if (NATIVE) return d > BASE_D ? d * 2.5 : d * 4;
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
    // Take in a sprite stack: what units/stack.py wrote about it. Nothing is fetched until it is drawn.
    // Returns what draw.stack() wants.
    addStack(meta) {
      const st = { frames: meta.frames, sets: [], mine: [] };
      const even = (n) => n + (n & 1);
      for (const m of meta.sets) { // finest first
        // Two pixels to the cube: a slice turned in hard pixels keeps its thin lines whole, and each cube shows a top and a side.
        const p = 2, q = m.r * p;
        const tall = m.n / m.r, reach = Math.ceil(m.reach * q), far = Math.ceil(SUN * tall * q);
        const set = { q, p, frames: m.frames, rects: m.rects, notes: m.notes, file: m.file, v: m.v, tex: null, state: 0, a: null };
        set.ax = 2 + reach; // where the model's middle, at the waterline, comes in its picture
        set.ay = 2 + Math.ceil((tall * M.ky + m.reach * M.kz) * q);
        set.w = set.ax + reach + far + 2; // room for it at any heading, and for its shadow to the south-east
        set.h = set.ay + Math.ceil((m.reach * q + far) * M.kz) + 2;
        // For a figure many share (draw.pose): the cell its picture fills, with its middle at (bx, by), and
        // the cell its shadow fills, with its middle at (sx, sy). Even sizes, so that the half-size copies of
        // one cell take nothing from the next.
        set.bx = set.ax; set.by = set.ay;
        set.bw = set.bx * 2; set.bh = even(set.by + Math.ceil(reach * M.kz) + 2);
        set.sx = 2 + reach; set.sy = 2 + Math.ceil(reach * M.kz);
        set.cw = even(set.sx + reach + far + 2); set.ch = even(set.sy + Math.ceil((reach + far) * M.kz) + 2);
        set.body = set.cast = null;
        set.n = q >= 16 ? 96 : q >= 8 ? 192 : 384;
        st.sets.push(set);
      }
      return st;
    },

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
      gl.uniform1f(progTile.u.uDetail, BASE_D); // (set again below once the level is known, for a native style)
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
      if (NATIVE) gl.uniform1f(progTile.u.uDetail, Math.min(D / 2 ** L, Math.max(1, zd))); // the sea moves in pixels the size of the picture's
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
      if (tick % 120 === 0) dropPics();

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
      for (const pr of [progCast, progSprite]) { // shadows laid together (draw.shade) see the view as the sprites do
        gl.useProgram(pr.p);
        gl.uniform4fv(pr.u.uView, view);
        gl.uniform2f(pr.u.uRes, W, H);
        gl.uniform1i(pr.u.uTex, 0);
        gl.uniform1i(pr.u.uOcc, 3);
        gl.uniform4f(pr.u.uCam, M.oy, M.kz, M.ky, hiding ? 1 : 0);
      }
      prog = progSprite;
      gl.bindVertexArray(spriteVAO);
      gl.uniform2f(progSprite.u.uTexSize, atlas.w, atlas.h);
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
      pass(progBright, halfA, hw, hh, scene, (u) => gl.uniform1f(u.uThreshold, P.glow ?? 0.86));
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
      gl.uniform1f(progFinal.u.uBloom, 0.8 * viewer.bloom * (P.bloom ?? 1) * (1 - 0.45 * near) * (1 - 0.7 * night)); // and the glow with it
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
