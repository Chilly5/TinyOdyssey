// Everything that moves over the finished image: ships and their wakes, clouds
// and their shadows, birds, Pegasus, Icarus, a sea monster, and the smoke,
// flames, sparks and lightning the landmarks asked for. All of it is drawn as
// sprites and flat pixels in image coordinates, on the image's own pixel grid.
// The people and animals on land are in life.js and are drawn from here too.

import { lonLatToWorld } from './config.js';
import { VOYAGE } from './sites.js';
import { mulberry32, easeInOut, clamp } from './util.js';

const GLYPHS = {
  note: ['..XX..', '..XXX.', '..X.XX', '..X..X', '..X...', '.XX...', 'XXX...', '.X....'],
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  zed: ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  spark: ['.X.', 'XXX', '.X.'],
  gust: ['....XX..', '......X.', 'XXXXXX..', '........', 'XXXX....'],
  feather: ['...XX', '..XX.', '.XX..', 'XX...', 'X....'],
  dot: ['.X.', 'XXX', '.X.'],
};
const PLAIN = { // drawn without an outline
  bird_0: ['X...X', '.X.X.', '..X..'],
  bird_1: ['.....', 'XX.XX', '..X..'],
  bird_2: ['..X..', '.X.X.', 'X...X'],
};
const DOLPHIN = [
  ['....aa..', '..aaaab.', '.aa.....', 'a.......'],
  ['..aaaa..', '.aabbaa.', 'a......a', '........'],
  ['..aa....', '.baaaa..', '.....aa.', '.......a'],
];

const hexRGB = (s) => {
  const v = parseInt(s.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

// The baked sprite sheet with a strip of small hand-pixelled glyphs added underneath.
export function buildAtlas(bitmap, meta) {
  const cv = document.createElement('canvas');
  cv.width = bitmap.width;
  cv.height = bitmap.height + 72;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const frames = { ...meta };
  let x = 1;
  const y0 = bitmap.height + 1;
  const add = (name, w, h, ax, ay, paint) => {
    paint(x, y0);
    frames[name] = [x, y0, w, h, ax, ay];
    x += w + 1;
  };
  ctx.fillStyle = '#ffffff';
  add('white', 4, 4, 0, 0, (px, py) => ctx.fillRect(px, py, 4, 4));
  for (const [name, rows] of Object.entries(GLYPHS)) {
    const h = rows.length + 2, w = rows[0].length + 2;
    const on = (i, j) => j >= 0 && j < rows.length && i >= 0 && i < rows[0].length && rows[j][i] === 'X';
    add(name, w, h, w >> 1, h >> 1, (px, py) => {
      for (let j = -1; j <= rows.length; j++) {
        for (let i = -1; i <= rows[0].length; i++) {
          if (on(i, j)) ctx.fillStyle = '#ffffff';
          else if (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1)) ctx.fillStyle = '#2a2140';
          else continue;
          ctx.fillRect(px + i + 1, py + j + 1, 1, 1);
        }
      }
    });
  }
  ctx.fillStyle = '#ffffff';
  for (const [name, rows] of Object.entries(PLAIN)) {
    add(name, rows[0].length, rows.length, 2, 1, (px, py) => {
      rows.forEach((r, j) => [...r].forEach((ch, i) => ch === 'X' && ctx.fillRect(px + i, py + j, 1, 1)));
    });
  }
  DOLPHIN.forEach((rows, k) => add(`dolphin_${k}`, 8, 4, 4, 3, (px, py) => {
    rows.forEach((r, j) => [...r].forEach((ch, i) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === 'a' ? '#3d5a80' : '#dfeaf2';
      ctx.fillRect(px + i, py + j, 1, 1);
    }));
  }));
  // Filled pixel discs (smoke, spray) and rings (splashes), white, tinted when drawn.
  ctx.fillStyle = '#ffffff';
  for (let r = 1; r <= 9; r++) {
    add(`disc_${r}`, r * 2 + 1, r * 2 + 1, r, r, (px, py) => {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) ctx.fillRect(px + r + i, py + r + j, 1, 1);
    });
  }
  for (let r = 3; r <= 15; r += 2) {
    const ry = Math.max(1, Math.round(r * 0.6));
    add(`ring_${r}`, r * 2 + 1, ry * 2 + 1, r, ry, (px, py) => {
      for (let a = 0; a < 6.283; a += 0.5 / r) ctx.fillRect(px + r + Math.round(Math.cos(a) * r), py + ry + Math.round(Math.sin(a) * ry), 1, 1);
    });
  }
  return { canvas: cv, frames };
}

// A polyline given as [x0, y0, x1, y1, ...], walkable by distance.
function makePath(flat) {
  const n = flat.length / 2;
  const acc = new Float32Array(n);
  for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
  return {
    total: acc[n - 1],
    at(d, out) {
      d = clamp(d, 0, acc[n - 1]);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (acc[mid] <= d) lo = mid;
        else hi = mid;
      }
      const seg = acc[hi] - acc[lo] || 1, u = (d - acc[lo]) / seg;
      out.x = flat[lo * 2] + (flat[hi * 2] - flat[lo * 2]) * u;
      out.y = flat[lo * 2 + 1] + (flat[hi * 2 + 1] - flat[lo * 2 + 1]) * u;
      out.dx = (flat[hi * 2] - flat[lo * 2]) / seg;
      out.dy = (flat[hi * 2 + 1] - flat[lo * 2 + 1]) / seg;
      return out;
    },
  };
}

export function createActors(viewer, M, calm, base = 'world/') {
  const S = M.px, KZ = M.kz, KY = M.ky;
  const rnd = mulberry32(4711);
  const seaPoint = (lon, lat) => {
    const [x, z] = lonLatToWorld(lon, lat);
    return [x * S, M.oy + KZ * z * S];
  };
  const tickers = [];
  const layers = [[], []]; // draw callbacks: 0 on the sea, 1 in the air
  const roaming = [];
  let now = 0;
  let life = null; // the people and animals, once their paths have loaded (life.js)

  // Draw one frame of a unit from the Blender-made sheets, at the size that suits the zoom.
  // Returns false until those sheets have loaded, so callers can fall back to an older sprite.
  const UNITS = (M.units && M.units.units) || {};
  const unit = (d, name, heading, frame, x, y, z = -1) => {
    const u = UNITS[name];
    if (!u) return false;
    const zd = viewer.zoom * viewer.dpr;
    let set = u.sets[0];
    const need = viewer.pixel > 1 ? 0.99 / viewer.texel : zd * 0.85;
    for (let i = u.sets.length - 1; i > 0; i--) if (u.sets[i].q >= need) { set = u.sets[i]; break; }
    const ok = d.frame(set.at[(frame % u.frames) * u.heads + (heading % u.heads)], set.q, x, y, 1, z);
    d.use(0);
    return ok;
  };
  const SHIP_UNIT = { odysseus: 'odysseus', argo: 'argo', theseus: 'theseus', trader0: 'merchant_ship', trader1: 'merchant_ship2', trader2: 'trireme' };
  const stacks = {}; // the models kept as sprite stacks (units/stack.py), by the unit's name

  // --- Splashes ------------------------------------------------------------------
  const rings = Array.from({ length: 12 }, () => ({ t0: -10, x: 0, y: 0, size: 9 }));
  let nextRing = 0;
  const splash = (x, y, size = 9) => {
    const r = rings[nextRing++ % rings.length];
    r.t0 = now; r.x = x; r.y = y; r.size = size;
    if (api.onSplash) api.onSplash(x, y, size);
  };
  layers[0].push((d) => {
    for (const r of rings) {
      const u = (now - r.t0) / 0.9;
      if (u < 0 || u >= 1) continue;
      const rr = clamp(Math.round((r.size * (0.3 + u * 0.9)) / 2) * 2 + 1, 3, 15);
      d.sprite(`ring_${rr}`, r.x, r.y, { alpha: 1 - u * 0.7 });
      if (r.size < 10 || u > 0.8) continue;
      // Something heavy went in: a column of spray goes up and falls back.
      const v = u / 0.8;
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4 + r.x, out = Math.cos(a) * r.size * (0.15 + 0.5 * v), up = (0.6 + 0.4 * Math.sin(i * 1.7)) * r.size * 1.5 * Math.sin(Math.PI * Math.min(1, v * 1.1));
        d.sprite(i % 3 ? 'disc_1' : 'disc_2', r.x + out, r.y - up + Math.sin(a) * 1.5, { alpha: 1 - v * v });
      }
    }
  });

  // --- Ships ---------------------------------------------------------------------
  const p = {};
  const ships = []; // every one of them, for the visitor to pick and follow: { id (if it has a name), target }
  function makeShip(kind, label) {
    const ship = { kind, x: 0, y: 0, k: 0, moving: false, wake: [], last: null, target: { x: 0, y: 0 }, ph: rnd() * 6, course: 0, turn: null, pics: [] };
    ship.place = (path, dist, moving, dir = 1) => {
      const fromX = ship.x, fromY = ship.y;
      path.at(dist, p);
      ship.x = p.x;
      ship.y = p.y;
      const dx = p.dx * dir, dz = (p.dy * dir) / KZ;
      ship.course = Math.atan2(dz, dx); // 0 east, then clockwise as the map lies
      ship.k = ((Math.round((ship.course / (Math.PI * 2)) * 16) % 16) + 16) % 16;
      // Set down somewhere else (the voyage beginning again): it is facing its course already.
      if (ship.turn === null || Math.hypot(p.x - fromX, p.y - fromY) > 60) ship.turn = ship.course;
      ship.moving = moving;
      ship.target.x = p.x;
      ship.target.y = p.y;
      if (moving && (!ship.last || Math.hypot(p.x - ship.last[0], p.y - ship.last[1]) > 5)) {
        ship.last = [p.x, p.y];
        ship.wake.push({ x: p.x, y: p.y, nx: -p.dy, ny: p.dx, t: now });
        if (ship.wake.length > 16) ship.wake.shift();
      }
    };
    layers[0].push((d, b) => {
      if (ship.x < b[0] - 80 || ship.x > b[2] + 80 || ship.y < b[1] - 80 || ship.y > b[3] + 80) return;
      for (const w of ship.wake) {
        const age = now - w.t;
        if (age > 2.6) continue;
        const a = 0.85 * (1 - age / 2.6), spread = 2 + age * 3.2;
        d.rect(w.x + w.nx * spread, w.y + w.ny * spread * KZ, 2, 1, 0.96, 0.99, 0.95, a);
        d.rect(w.x - w.nx * spread, w.y - w.ny * spread * KZ, 2, 1, 0.96, 0.99, 0.95, a);
      }
      const bob = calm ? 0 : Math.round(Math.sin(now * 2.1 + ship.ph) * 0.8);
      const oars = ship.moving && !calm ? Math.floor(now * 2.6 + ship.ph) : 0;
      // A ship is on the water, so a headland or an island nearer the camera hides it.
      const depth = viewer.depthOf(ship.y);
      // One kept as a sprite stack faces exactly the way it is going, and pulls a whole stroke of the oars
      // (frame 0 has them shipped, for lying still). Seen from far off the stroke is too small to show, and
      // the oars are simply out.
      const st = stacks[SHIP_UNIT[kind]];
      if (st) {
        const far = viewer.zoom * viewer.dpr < 1.2;
        const f = !ship.moving || calm ? 0 : far ? st.frames >> 1 : Math.floor((now * 0.85 + ship.ph) * st.frames) % st.frames;
        if (d.stack(st, f, ship.turn, ship.x, ship.y + bob, depth, ship.pics)) return;
      }
      if (!unit(d, SHIP_UNIT[kind], ship.k, oars, ship.x, ship.y + bob, depth)) d.sprite(`${kind}_${ship.k}`, ship.x, ship.y + bob);
    });
    // It comes about over a moment, not at once: quickly enough to follow a winding course.
    tickers.push((t, dt) => {
      if (ship.turn === null) return;
      const off = Math.atan2(Math.sin(ship.course - ship.turn), Math.cos(ship.course - ship.turn));
      ship.turn += off * (1 - Math.exp(-dt * 3.2));
    });
    if (label) roaming.push({ id: label.id, name: label.name, kind: 'ship', tier: label.tier, target: ship.target, dy: 10 });
    ships.push({ id: label ? label.id : null, target: ship.target });
    return ship;
  }

  // Odysseus.
  const stops = VOYAGE.map((v, i) => ({ ...v, point: M.voyage.stops[i] }));
  const legs = M.voyage.legs.map(makePath);
  const ody = makeShip('odysseus', { id: 'odysseus', name: 'Odysseus', tier: 1 });
  const IDLE_SPEED = 1.7 * S;
  const voyage = {
    stops, legs,
    upTo: 0, // legs whose trail is shown (guided voyage only)
    showTrail(n) { voyage.upTo = n; },
    mode: 'idle', leg: 0, dist: 0, pause: 3, stop: 0, anim: null,
    get position() { return ody.target; },
    get sailing() { return voyage.mode === 'guided' ? !!voyage.anim : voyage.pause <= 0; },
    goTo(i, instant = false) {
      i = clamp(i, 0, stops.length - 1);
      voyage.mode = 'guided';
      const from = voyage.stop;
      voyage.stop = i;
      if (!instant && Math.abs(i - from) === 1 && !voyage.anim) {
        const leg = legs[Math.min(i, from)];
        voyage.anim = { leg, t: 0, dur: clamp(leg.total / (16 * S), 3.2, 9), dir: i > from ? 1 : -1 };
      } else {
        voyage.anim = null;
        voyage.leg = Math.min(i, legs.length - 1);
        voyage.dist = i === stops.length - 1 ? legs[voyage.leg].total : 0;
      }
    },
    release() {
      voyage.mode = 'idle';
      voyage.anim = null;
      voyage.upTo = 0;
      voyage.leg = Math.min(voyage.stop, legs.length - 1);
      voyage.dist = voyage.stop === stops.length - 1 ? legs[voyage.leg].total : 0;
      voyage.pause = 2;
    },
  };
  tickers.push((t, dt) => {
    if (voyage.mode === 'guided') {
      const a = voyage.anim;
      if (a) {
        a.t += dt / a.dur;
        const u = easeInOut(Math.min(1, a.t));
        ody.place(a.leg, a.dir > 0 ? u * a.leg.total : (1 - u) * a.leg.total, true, a.dir);
        if (a.t >= 1) {
          voyage.anim = null;
          voyage.leg = Math.min(voyage.stop, legs.length - 1);
          voyage.dist = voyage.stop === stops.length - 1 ? legs[voyage.leg].total : 0;
        }
      } else ody.place(legs[voyage.leg], voyage.dist, false);
      return;
    }
    if (voyage.pause > 0) {
      voyage.pause -= dt;
      ody.place(legs[voyage.leg], voyage.dist, false);
      return;
    }
    voyage.dist += dt * IDLE_SPEED;
    if (voyage.dist >= legs[voyage.leg].total) {
      voyage.leg++;
      voyage.dist = 0;
      voyage.pause = 5;
      if (voyage.leg >= legs.length) {
        voyage.leg = 0;
        voyage.pause = 14;
      }
    }
    voyage.stop = voyage.leg;
    ody.place(legs[voyage.leg], voyage.dist, true);
  });
  // The wake of the story: a dotted line along every leg already sailed.
  layers[0].unshift((d, b) => {
    for (let i = 0; i < voyage.upTo && i < legs.length; i++) {
      const leg = legs[i];
      for (let dist = 30; dist < leg.total - 16; dist += 30) {
        leg.at(dist, p);
        if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue;
        d.sprite('dot', p.x, p.y, { tint: [1, 0.95, 0.77] });
      }
    }
  });

  const shuttle = (ship, flat, speed, rest) => {
    const path = makePath(flat);
    let dist = rnd() * path.total, dir = 1, wait = 0;
    tickers.push((t, dt) => {
      if (wait > 0) wait -= dt;
      else {
        dist += dir * speed * dt;
        if (dist >= path.total || dist <= 0) {
          dist = clamp(dist, 0, path.total);
          dir = -dir;
          wait = rest;
        }
      }
      ship.place(path, dist, wait <= 0, dir);
    });
  };
  shuttle(makeShip('argo', { id: 'argo', name: 'The Argo', tier: 2 }), M.routes.argo, 1.5 * S, 9);
  shuttle(makeShip('theseus', { id: 'theseus', name: 'Theseus', tier: 3 }), M.routes.theseus, 1.25 * S, 8);
  M.routes.lanes.forEach((lane, i) => {
    shuttle(makeShip(`trader${i % 3}`), lane, (0.85 + (i % 3) * 0.16) * S, 5 + (i % 7) * 2);
    if (i % 2 === 0) shuttle(makeShip(`trader${(i + 1) % 3}`), lane, (0.7 + (i % 4) * 0.12) * S, 8 + (i % 5) * 2); // and one coming the other way
  });

  // --- Sea life --------------------------------------------------------------------
  const pods = [[19.2, 37.9], [24.9, 36.5], [16.6, 36.4], [25.6, 39.2], [22.2, 35.3], [27.6, 35.6], [18.4, 39.3], [23.9, 38.9]].map(([lon, lat]) => seaPoint(lon, lat));
  pods.forEach(([px, py], k) => {
    const fish = Array.from({ length: 3 }, (_, i) => ({ ox: (rnd() - 0.5) * 40, oy: (rnd() - 0.5) * 18, ph: rnd() * 5 + i, wet: false }));
    layers[0].push((d, b) => {
      if (px < b[0] - 60 || px > b[2] + 60 || py < b[1] - 40 || py > b[3] + 40) return;
      const dir = k % 2 ? 1 : -1;
      for (const f of fish) {
        const c = (now * 0.5 + f.ph) % 3.2;
        if (c > 1) { f.wet = false; continue; }
        const x = px + f.ox + dir * c * 14, y = py + f.oy;
        if (c > 0.86 && !f.wet) { f.wet = true; splash(x + dir * 2, y, 5); }
        d.sprite(`dolphin_${Math.min(2, Math.floor(c * 3))}`, x, y - Math.sin(c * Math.PI) * 5, { flip: dir < 0 });
      }
    });
  });
  {
    const [kx, ky] = seaPoint(18.2, 34.6);
    layers[0].push((d, b) => {
      const a = now * 0.035;
      const x = kx + Math.cos(a) * 340, y = ky + Math.sin(a) * 150;
      if (x < b[0] - 90 || x > b[2] + 90 || y < b[1] - 60 || y > b[3] + 60) return;
      d.sprite(`ketos_${Math.floor(now * 3) % 4}`, x, y, { flip: Math.sin(a) > 0 });
      if (Math.floor(now * 3) % 4 === 0 && Math.random() < 0.05) splash(x - 20 + Math.random() * 40, y + 2, 5);
    });
    const target = { x: kx, y: ky };
    tickers.push(() => {
      const a = now * 0.035;
      target.x = kx + Math.cos(a) * 340;
      target.y = ky + Math.sin(a) * 150;
    });
    roaming.push({ id: 'ketos', name: 'Ketos', kind: 'monsters', tier: 3, target, dy: 8 });
  }

  // --- The landmarks' moving parts, as pre-rendered frames --------------------------------
  // Rendered in Blender (units/anims.py): each frame is a handful of pieces (a bird, a rock, a giant), at
  // two or three sizes. Every size of every landmark has sheets of its own, fetched when it is first drawn
  // and let go a while after it was last. An older world has one flat frame per moment instead (the second
  // branch below).
  const pages = (M.animPages || []).map((pg, i) => ({ file: pg.file, at: i + 1, state: 0 }));
  const fetchPage = (pg) => {
    if (pg.state) return;
    pg.state = 1;
    viewer.loadBitmap(base + pg.file + '?v=' + M.version, true).then((bmp) => {
      viewer.addSheet(bmp, pg.at, true);
      pg.state = 2;
    }).catch(() => { pg.state = 3; });
  };
  const flat = (M.anims || []).some((a) => !a.sets);
  if (flat) pages.forEach(fetchPage);
  // Three of the old kind (the phalanx at Sparta, the runners at Olympia, the lion at Nemea) are played
  // by the units instead, once those have loaded; the new kind leaves them out altogether.
  const REPLACED = new Set(['sparta', 'olympia', 'nemea']);
  layers[0].push((d, b) => {
    const zd = viewer.zoom * viewer.dpr;
    const need = viewer.pixel > 1 ? 0.99 / viewer.texel : zd * 0.85;
    for (const a of M.anims || []) {
      const inView = !(a.box[2] < b[0] || a.box[0] > b[2] || a.box[3] < b[1] || a.box[1] > b[3]);
      if (a.sets) {
        const show = inView && zd > 0.3;
        let set = a.sets[0];
        for (let i = a.sets.length - 1; i > 0; i--) if (a.sets[i].q >= need) { set = a.sets[i]; break; }
        for (const t of a.sets) {
          if (show && t === set) {
            if (!t.loaded) {
              for (let k = 0; k < t.pages; k++) fetchPage(pages[t.page + k]);
              t.loaded = true;
            }
            t.seen = now;
          } else if (t.loaded && now - t.seen > 20) { // not drawn for a while: give its sheets back
            for (let k = 0; k < t.pages; k++) { viewer.dropSheet(pages[t.page + k].at); pages[t.page + k].state = 0; }
            t.loaded = false;
          }
        }
        if (!show) continue;
        // Until the size wanted has arrived, draw whichever size is here.
        let use = set;
        if (pages[set.page].state !== 2) use = a.sets.find((t) => t.loaded && pages[t.page].state === 2) || set;
        const fi = calm ? 0 : Math.floor(now * a.fps) % a.n;
        if (a.events && fi !== a.at) { // a rock has landed, the rocks have met
          if (a.at != null) for (const e of a.events) if ((e[0] - a.at - 1 + a.n) % a.n < (fi - a.at + a.n) % a.n) splash(e[1], e[2], e[3]);
          a.at = fi;
        }
        const fr = use.frames[fi], sp = use.sprites, k = 1 / use.q;
        for (let i = 0; i < fr.length; i += 3) {
          const r = sp[fr[i]];
          if (d.use(pages[use.page + r[0]].at)) d.blit(a.box[0] + fr[i + 1] * k, a.box[1] + fr[i + 2] * k, r[1], r[2], r[3], r[4], k);
        }
        continue;
      }
      if (!inView || (life && REPLACED.has(a.id))) continue; // the units do this one now
      const o = (calm ? 0 : Math.floor(now * a.fps) % a.n) * 7;
      const f = a.frames;
      if (f[o + 3] && d.use(f[o] + 1)) d.blit(f[o + 5], f[o + 6], f[o + 1], f[o + 2], f[o + 3], f[o + 4], 1 / (a.q || 1));
    }
    d.use(0);
  });

  // --- The people and animals (life.js) ------------------------------------------------
  layers[0].push((d, b) => life && life.draw(d, b, 0));

  // --- Landmark effects --------------------------------------------------------------
  const fine = () => viewer.zoom * viewer.dpr > 0.34; // too small to matter when zoomed far out
  // Flames and smoke are drawn in pixels of their own. Close up those want to be as small as the picture's.
  const grain = () => { const zd = viewer.zoom * viewer.dpr; return zd > 7 ? 4 : zd > 2.6 ? 2 : 1; };
  for (const e of M.effects) {
    const seed = rnd() * 10;
    if (e.t === 'smoke') {
      const [r, g, bl] = hexRGB(e.c);
      layers[1].push((d, b) => {
        if (!fine() || e.x < b[0] - 200 || e.x > b[2] + 200 || e.y < b[1] - 60 || e.y - e.rise > b[3] + 60) return;
        for (let i = 0; i < e.n; i++) {
          const u = (now / e.life + i / e.n) % 1;
          const fade = Math.min(1, u * 8) * Math.min(1, (1 - u) * 3.2);
          const rad = clamp(Math.round(e.size * (0.45 + u * 1.1) * 0.5), 1, 9);
          const x = e.x + e.dx * u * u * 2 + Math.sin(u * 5 + seed + i) * 4, y = e.y - e.rise * u;
          const a = e.glow ? fade : fade * 0.82;
          // A puff is three discs: shade below right, body, and a small highlight above left.
          // Close up, the largest disc is drawn small instead, so the puff has finer pixels.
          const gr = grain();
          const disc = (rr, px, py, tint) => (gr > 1
            ? d.sprite(rr * gr <= 9 ? `disc_${rr * gr}` : 'disc_9', px, py, { tint, alpha: a, scale: rr * gr <= 9 ? 1 / gr : rr / 9 })
            : d.sprite(`disc_${rr}`, px, py, { tint, alpha: a }));
          disc(rad, x + 1, y + 1, [r * 0.66, g * 0.66, bl * 0.76]);
          disc(Math.max(1, rad - 1), x, y, [r, g, bl]);
          if (rad > 3) disc(Math.max(1, rad - 3), x - 1 - (rad >> 2), y - 1 - (rad >> 2), [Math.min(1, r * 1.25 + 0.06), Math.min(1, g * 1.25 + 0.06), Math.min(1, bl * 1.22 + 0.06)]);
        }
      });
    } else if (e.t === 'flame') {
      const cols = e.ghost ? [[0.18, 0.75, 0.44], [0.55, 0.94, 0.66], [0.9, 1, 0.9]] : [[1, 0.42, 0.12], [1, 0.7, 0.18], [1, 0.95, 0.66]];
      layers[1].push((d, b) => {
        if (!fine() || e.x < b[0] - 30 || e.x > b[2] + 30 || e.y < b[1] - 30 || e.y > b[3] + 60) return;
        const k = calm ? 1 : 1 + 0.22 * Math.sin(now * 13 + seed) + 0.14 * Math.sin(now * 7.3 + seed * 2);
        const gr = grain(), px = 1 / gr; // rows this tall, on a grid this fine
        [1, 0.62, 0.34].forEach((f, i) => {
          const h = Math.max(2, Math.round(e.size * 1.25 * k * f * gr)), w = Math.max(1, Math.round(e.size * 0.8 * f * gr));
          for (let row = 0; row < h; row++) {
            const ww = Math.max(1, Math.round(w * (1 - (row / h) ** 1.4)));
            const sway = Math.round(Math.sin(now * 9 + (row / gr) * 0.9 + seed) * (row / h) * 1.2 * gr);
            d.rect(e.x + (sway - ww / 2) * px, e.y - row * px, ww * px, px, ...cols[i], 1, gr);
          }
        });
      });
    } else if (e.t === 'glyph') {
      const tint = hexRGB(e.c);
      layers[1].push((d, b) => {
        if (viewer.zoom * viewer.dpr < 0.6 || e.x < b[0] - 120 || e.x > b[2] + 120 || e.y < b[1] - 30 || e.y - e.rise > b[3] + 30) return;
        for (let i = 0; i < e.n; i++) {
          const s2 = i * 2.4 + seed;
          const u = (now / e.life + i / e.n + s2 * 0.13) % 1;
          if (u < 0.04 || u > 0.92) continue;
          d.sprite(e.g, e.x + Math.sin(s2 * 5) * e.spread + Math.sin(u * 6 + s2) * 8 + e.dx * u, e.y - e.rise * u, { tint });
        }
      });
    } else if (e.t === 'bolt') {
      const col = hexRGB(e.c);
      let next = 2 + rnd() * 4, until = 0, pts = [];
      tickers.push((t) => {
        if (t < next || calm) return;
        next = t + 2.2 + Math.random() * 5;
        until = t + 0.3;
        const a = Math.random() * 6.283, r = e.storm ? 20 + Math.random() * 60 : 70 + Math.random() * 90;
        const x1 = e.x + Math.cos(a) * r, y1 = e.y + e.drop + Math.sin(a) * r * 0.5;
        pts = [[e.x + Math.cos(a) * 10, e.y]];
        for (let i = 1; i <= 7; i++) {
          const u = i / 7, j = i === 7 ? 0 : 14;
          pts.push([e.x + (x1 - e.x) * u + (Math.random() - 0.5) * j, e.y + (y1 - e.y) * u]);
        }
        if (e.storm) splash(x1, y1, 7);
        if (api.onBolt) api.onBolt(e);
      });
      layers[1].push((d) => {
        if (now > until || Math.sin(now * 90) < -0.4) return;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
          const n = Math.max(1, Math.ceil(by - ay));
          for (let s = 0; s < n; s++) d.rect(ax + ((bx - ax) * s) / n - 1, ay + s, i < 3 ? 3 : 2, 1, ...col);
        }
      });
    } else if (e.t === 'ring') { // cloud drifting round a summit
      const puffs = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * 6.283, f: i % 3, dy: (i % 2) * 14 }));
      const sorted = [...puffs];
      layers[1].push((d, b) => {
        if (e.x < b[0] - 260 || e.x > b[2] + 260 || e.y < b[1] - 160 || e.y > b[3] + 160) return;
        const turn = now * 0.1;
        sorted.sort((p1, p2) => Math.sin(p1.a + turn) - Math.sin(p2.a + turn)); // far side first
        for (const pf of sorted) d.sprite(`puff_${pf.f}`, e.x + Math.cos(pf.a + turn) * e.r, e.y + Math.sin(pf.a + turn) * e.r * KZ - pf.dy, { alpha: 0.96 });
      });
    } else if (e.t === 'whirl') {
      layers[0].push((d, b) => {
        if (!fine() || e.x < b[0] - 80 || e.x > b[2] + 80 || e.y < b[1] - 60 || e.y > b[3] + 60) return;
        for (let arm = 0; arm < 3; arm++) {
          for (let i = 0; i < 26; i++) {
            const r = 3 + i * (e.r / 26), a = -now * 1.7 + arm * 2.094 + i * 0.22;
            d.rect(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * KZ, i > 18 ? 3 : 2, 1, 0.96, 0.99, 0.95, 0.95 - i * 0.02);
          }
        }
      });
    } else if (e.t === 'rain') {
      layers[0].push((d, b) => { // the storm's shadow on the sea
        if (e.x < b[0] - 300 || e.x > b[2] + 300 || e.y < b[1] - 200 || e.y - e.h > b[3] + 200) return;
        const sway = Math.sin(now * 0.2) * 24;
        d.sprite('storm_0', e.x - 40 + sway + e.h * 0.45, e.y + e.h, { shadow: SHADE, alpha: 0.3 });
        d.sprite('storm_1', e.x + 50 + sway + e.h * 0.45, e.y + e.h + 8, { shadow: SHADE, alpha: 0.3 });
      });
      layers[1].push((d, b) => {
        if (e.x < b[0] - 300 || e.x > b[2] + 300 || e.y < b[1] - 200 || e.y > b[3] + 200) return;
        const sway = Math.sin(now * 0.2) * 24;
        d.sprite('storm_0', e.x - 40 + sway, e.y + 6);
        d.sprite('storm_1', e.x + 50 + sway, e.y + 14);
        if (!fine()) return;
        for (let i = 0; i < 46; i++) {
          const h1 = (i * 0.618) % 1, h2 = (i * 0.377 + 0.2) % 1;
          const u = (now * (1.3 + h2 * 0.6) + h1 * 7) % 1;
          const x = e.x + (h1 - 0.5) * e.w - u * 26, y = e.y + u * e.h;
          d.rect(x, y, 1, 3, 0.78, 0.9, 1, 0.7);
          d.rect(x - 1, y + 3, 1, 2, 0.78, 0.9, 1, 0.5);
        }
      });
    }
  }

  // --- Birds -----------------------------------------------------------------------
  const flap = [0, 1, 2, 1];
  const flocks = [];
  M.sites.forEach((s, i) => {
    if (i % 3 !== 0) return;
    flocks.push({ x: s.x + 30, y: s.y - s.top - 24, r: 26 + (i % 4) * 9, n: 3 + (i % 3), sp: 0.5 + (i % 5) * 0.08 });
  });
  for (let i = 0; i < 14; i++) flocks.push({ x: rnd() * M.w, y: M.oy + rnd() * (M.h - M.oy - 200), r: 30 + rnd() * 40, n: 3 + ((rnd() * 4) | 0), sp: 0.3 + rnd() * 0.3, drift: 6 + rnd() * 10 });
  layers[1].push((d, b) => {
    if (viewer.zoom * viewer.dpr < 0.45 || viewer.night > 0.6) return; // birds roost at night
    for (const f of flocks) {
      const fx = f.drift ? ((f.x + now * f.drift) % (M.w + 400)) - 200 : f.x;
      if (fx < b[0] - 90 || fx > b[2] + 90 || f.y < b[1] - 90 || f.y > b[3] + 90) continue;
      for (let i = 0; i < f.n; i++) {
        const a = now * f.sp + (i / f.n) * 6.283 + i;
        const rr = f.r * (0.7 + 0.5 * ((i * 0.37) % 1));
        d.sprite(`bird_${flap[Math.floor(now * 7 + i * 1.7) % 4]}`, fx + Math.cos(a) * rr, f.y + Math.sin(a) * rr * KZ - i * 3);
      }
    }
  });

  // --- Pegasus, Daedalus and Icarus -----------------------------------------------------
  const SHADE = [0.08, 0.1, 0.28];
  {
    const [cx, cy] = M.flights.pegasus;
    const target = { x: cx, y: cy };
    roaming.push({ id: 'pegasus', name: 'Pegasus', kind: 'ship', tier: 2, target, dy: 14 });
    layers[1].push((d) => {
      const a = now * 0.11;
      const x = cx + Math.cos(a) * 15 * S, gy = cy + Math.sin(a) * 8.5 * S * KZ;
      const alt = (4.6 + Math.sin(now * 0.5) * 0.6) * S * KY;
      const k = ((Math.round((Math.atan2(Math.cos(a) * 8.5, -Math.sin(a) * 15) / 6.283) * 8) % 8) + 8) % 8;
      const f = calm ? 0 : Math.floor(now * 6) & 1;
      d.sprite(`pegasus_${k}_${f}`, x + alt * 0.45, gy, { shadow: SHADE, alpha: 0.26 });
      if (!unit(d, 'pegasus', k, calm ? 0 : Math.floor(now * 6), x, gy - alt)) d.sprite(`pegasus_${k}_${f}`, x, gy - alt);
      target.x = x;
      target.y = gy - alt;
    });
  }
  {
    const [sx, sy, ex, ey] = M.flights.icarus;
    const target = { x: sx, y: sy };
    roaming.push({ id: 'icarus', name: 'Icarus', kind: 'ship', tier: 2, target, dy: 12 });
    let wet = false;
    layers[1].push((d) => {
      const c = now % 34;
      const u = Math.min(1, c / 20), du = c / 20;
      const f = Math.floor(now * 9) & 1;
      const unit = S * KY;
      if (du < 1.45) {
        const x = sx + (ex - sx) * du + 26, y = sy + (ey - sy) * du + 10, alt = (3 + Math.sin(now * 1.1) * 0.15) * unit;
        d.sprite(`daedalus_${f}`, x + alt * 0.45, y, { shadow: SHADE, alpha: 0.24 });
        d.sprite(`daedalus_${f}`, x, y - alt);
      }
      const x = sx + (ex - sx) * u, y = sy + (ey - sy) * u;
      let alt, falling = false;
      if (c < 20) alt = (3.4 + 4.2 * u ** 2.2 + Math.sin(now * 1.3) * 0.15) * unit;
      else {
        const k = Math.min(1, (c - 20) / 2.2);
        alt = 7.6 * (1 - k * k) * unit;
        falling = true;
      }
      if (c < 22.2) {
        d.sprite(`icarus_${f}`, x + alt * 0.45, y, { shadow: SHADE, alpha: 0.24 });
        d.sprite(`icarus_${falling ? Math.floor(now * 20) & 1 : f}`, x, y - alt, { flip: falling && (Math.floor(now * 8) & 1) === 1 });
        wet = false;
      } else if (!wet) {
        wet = true;
        splash(ex, ey, 13);
        splash(ex, ey, 7);
      }
      if (c > 19.5 && c < 24) { // feathers
        for (let i = 0; i < 5; i++) {
          const fu = ((now * 0.42 + i * 0.2) % 1);
          d.sprite('feather', ex + Math.sin(i * 5 + fu * 6) * 12, ey - 20 - (1 - fu) * 7.6 * unit * 0.5, { alpha: 1 - fu });
        }
      }
      target.x = x;
      target.y = y - (c < 22.2 ? alt : 0);
    });
  }

  layers[1].push((d, b) => life && life.draw(d, b, 1)); // whatever flies, under the clouds

  // --- Clouds, with their shadows on the world below ---------------------------------------
  const clouds = Array.from({ length: 38 }, (_, i) => ({
    f: i % 6, x: rnd() * (M.w + 600) - 300, y: M.oy + 80 + rnd() * (M.h - M.oy - 260), alt: 150 + rnd() * 90, v: 7 + rnd() * 7,
  }));
  tickers.push((t, dt) => {
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > M.w + 320) c.x = -320;
    }
  });
  layers[0].push((d, b) => {
    for (const c of clouds) {
      if (c.x + c.alt * 0.45 < b[0] - 240 || c.x > b[2] + 240 || c.y < b[1] - 80 || c.y > b[3] + 80) continue;
      d.sprite(`cloud_${c.f}`, c.x + c.alt * 0.45, c.y, { shadow: SHADE, alpha: 0.2 });
    }
  });
  layers[1].push((d, b) => {
    // Close to the ground you are under the clouds: they thin out and are gone.
    const under = clamp((viewer.zoom * viewer.dpr - 2.5) / 3.5, 0, 1);
    if (under >= 1) return;
    for (const c of clouds) {
      if (c.x < b[0] - 240 || c.x > b[2] + 240 || c.y - c.alt < b[1] - 80 || c.y - c.alt > b[3] + 80) continue;
      d.sprite(`cloud_${c.f}`, c.x, c.y - c.alt, { alpha: 0.97 * (1 - under) });
    }
  });

  const api = {
    voyage, roaming, splash, ships,
    onBolt: null, // called with the effect when lightning strikes (for the thunder)
    onSplash: null, // called with x, y and size whenever something hits the water
    setLife(l) { life = l; },
    setStack(name, st) { stacks[name] = st; },
    update(t, dt) {
      now = t;
      for (const f of tickers) f(t, dt);
      if (life) life.update(t);
    },
    draw(d, layer) {
      const b = viewer.bounds();
      for (const f of layers[layer]) f(d, b);
    },
  };
  return api;
}
