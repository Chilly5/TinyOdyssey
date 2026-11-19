// Everything that roams the map rather than belonging to one site: clouds,
// ships, Pegasus, Daedalus and Icarus, dolphins and the sea monster.

import * as THREE from './three.js';
import { Geo, rgb } from './kit.js';
import { C, galley, cloud, person, beast } from './models.js';
import { WORLD_W, WORLD_D, LANDMARK_SCALE, lonLatToWorld, worldToHex, hexCenterX, hexCenterZ } from './config.js';
import { VOYAGE } from './sites.js';
import { easeInOut, mulberry32 } from './util.js';

const TAU = Math.PI * 2;

function makeShip(fx, scene, o = {}) {
  const g = new Geo();
  galley(g, o);
  const ship = new THREE.Group();
  const hull = fx.mesh(ship, g, { shadow: true });
  hull.scale.setScalar(o.scale || 1);
  // Wake: two foam streaks trailing from the stern.
  const wg = new Geo();
  const foam = rgb('#f6fcf7');
  for (const side of [-1, 1]) {
    wg.quad([-0.7, 0, side * 0.1], [-1.9, 0, side * 0.52], [-1.9, 0, side * 0.62], [-0.7, 0, side * 0.2], foam);
    wg.quad([-0.7, 0, side * 0.2], [-1.9, 0, side * 0.62], [-1.9, 0, side * 0.52], [-0.7, 0, side * 0.1], foam);
  }
  const wake = fx.mesh(ship, wg, { glow: true });
  wake.scale.setScalar(o.scale || 1);
  wake.position.y = 0.03;
  scene.add(ship);
  const p = {};
  return {
    group: ship, hull, wake,
    label: { x: 0, y: 0, z: 0 },
    // Put the ship at a distance along a route; dir is +1 or -1.
    place(route, dist, t, moving = true, dir = 1) {
      route.at(dist, p);
      ship.position.set(p.x, 0, p.z);
      ship.rotation.y = Math.atan2(-p.dz * dir, p.dx * dir);
      hull.position.y = 0.07 + Math.sin(t * 1.9 + p.x) * 0.035;
      hull.rotation.z = Math.sin(t * 1.5) * 0.05;
      hull.rotation.x = Math.sin(t * 1.1 + 1) * 0.07;
      wake.visible = moving;
      this.label.x = p.x;
      this.label.z = p.z;
      this.label.y = 0;
    },
  };
}

export function createActors({ view, grid, fx, nav, siteById }) {
  const scene = view.scene;
  const rnd = mulberry32(2024);
  const labels = [];

  // ----------------------------------------------------------------- clouds --
  const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#9aa3bd'), emissiveIntensity: 0.55 });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new Geo();
    cloud(g, i + 11);
    const m = new THREE.Mesh(g.build(), cloudMat);
    m.castShadow = true;
    const k = 1.1 + rnd() * 1.0;
    m.scale.set(k, k * 0.9, k);
    scene.add(m);
    clouds.push({ m, x: rnd() * (WORLD_W + 40) - 20, z: 12 + rnd() * (WORLD_D - 24), y: 9 + rnd() * 3.5, v: 0.35 + rnd() * 0.3 });
  }
  fx.tick((t, dt) => {
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > WORLD_W + 22) c.x = -22;
      c.m.position.set(c.x, c.y, c.z);
    }
  });

  // ------------------------------------------------------- Odysseus' voyage --
  const stopPoint = (stop) => {
    if (stop.near) return lonLatToWorld(...stop.near);
    // Moor in open water just clear of the landmark, in front of it where possible.
    const s = siteById[stop.site];
    const want = (s.flat || 0) * LANDMARK_SCALE + (s.sea ? 2.6 : 1.4);
    const [c0, r0] = worldToHex(s.x, s.z);
    const R = Math.ceil(want + 5);
    let best = null, score = Infinity;
    for (let r = r0 - R; r <= r0 + R; r++) {
      for (let c = c0 - R; c <= c0 + R; c++) {
        if (!grid.inside(c, r) || grid.land[grid.idx(c, r)]) continue;
        const x = hexCenterX(c, r), z = hexCenterZ(r);
        const sc = Math.abs(Math.hypot(x - s.x, z - s.z) - want) + (z < s.z ? 1.4 : 0) + (grid.coast[grid.idx(c, r)] < 2 ? 0.5 : 0);
        if (sc < score) { score = sc; best = [x, z]; }
      }
    }
    return best || nav.center(nav.nearestWater(s.x, s.z));
  };
  const stops = VOYAGE.map((v) => ({ ...v, point: stopPoint(v) }));
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push(nav.route([stops[i].point, stops[i + 1].point]));

  // The wake of the story: a dotted line along every leg already sailed.
  const dot = rgb('#fff3c4');
  const trail = legs.map((leg) => {
    const g = new Geo();
    const p = {};
    for (let d = 1.2; d < leg.total - 0.6; d += 1.1) {
      leg.at(d, p);
      const r = 0.13;
      g.quad([p.x - r, 0.03, p.z], [p.x, 0.03, p.z + r], [p.x + r, 0.03, p.z], [p.x, 0.03, p.z - r], dot);
    }
    const m = fx.mesh(scene, g, { glow: true });
    m.visible = false;
    return m;
  });

  const ody = makeShip(fx, scene, { scale: 1.45, sail: C.sail, device: C.red, trim: C.red, crew: true });
  labels.push({ id: 'odysseus', name: 'Odysseus', kind: 'ship', tier: 1, target: ody.label, dy: 12 });
  const voyage = {
    stops, legs, trail,
    // Show the route sailed so far (guided voyage only).
    showTrail(upTo) {
      trail.forEach((m, i) => { m.visible = i < upTo; });
    },
    mode: 'idle', // idle: sails the whole route on its own; guided: waits for the reader
    leg: 0, dist: 0, pause: 3,
    stop: 0, // guided: the stop the ship is at or sailing to
    anim: null,
    get position() { return ody.label; },
    get sailing() { return voyage.mode === 'guided' ? !!voyage.anim : voyage.pause <= 0; },
    // Guided mode: go to a stop. Adjacent stops are sailed; others are jumped to.
    goTo(i, instant = false) {
      i = Math.max(0, Math.min(stops.length - 1, i));
      voyage.mode = 'guided';
      const from = voyage.stop;
      voyage.stop = i;
      if (!instant && Math.abs(i - from) === 1 && !voyage.anim) {
        const leg = legs[Math.min(i, from)];
        const dur = Math.max(3.2, Math.min(9, leg.total / 16));
        voyage.anim = { leg, t: 0, dur, dir: i > from ? 1 : -1 };
      } else {
        voyage.anim = null;
        voyage.leg = Math.min(i, legs.length - 1);
        voyage.dist = i === stops.length - 1 ? legs[voyage.leg].total : 0;
      }
    },
    release() {
      voyage.mode = 'idle';
      voyage.anim = null;
      voyage.showTrail(0);
      voyage.leg = Math.min(voyage.stop, legs.length - 1);
      voyage.dist = voyage.stop === stops.length - 1 ? legs[voyage.leg].total : 0;
      voyage.pause = 2;
    },
  };
  fx.tick((t, dt) => {
    if (voyage.mode === 'guided') {
      const a = voyage.anim;
      if (a) {
        a.t += dt / a.dur;
        const u = easeInOut(Math.min(1, a.t));
        ody.place(a.leg, a.dir > 0 ? u * a.leg.total : (1 - u) * a.leg.total, t, true, a.dir);
        if (a.t >= 1) {
          voyage.anim = null;
          voyage.leg = Math.min(voyage.stop, legs.length - 1);
          voyage.dist = voyage.stop === stops.length - 1 ? legs[voyage.leg].total : 0;
        }
      } else ody.place(legs[voyage.leg], voyage.dist, t, false);
      return;
    }
    if (voyage.pause > 0) {
      voyage.pause -= dt;
      ody.place(legs[voyage.leg], voyage.dist, t, false);
      return;
    }
    voyage.dist += dt * 2.6;
    if (voyage.dist >= legs[voyage.leg].total) {
      voyage.leg++;
      voyage.dist = 0;
      voyage.pause = 5;
      if (voyage.leg >= legs.length) { // home; after a rest the story starts again
        voyage.leg = 0;
        voyage.pause = 14;
      }
    }
    voyage.stop = voyage.leg;
    ody.place(legs[voyage.leg], voyage.dist, t, true);
  });

  // ------------------------------------------------------------ other ships --
  const W = (lon, lat) => lonLatToWorld(lon, lat);
  const shuttle = (ship, route, speed, rest = 6) => {
    let d = 0, dir = 1, wait = 0;
    fx.tick((t, dt) => {
      if (wait > 0) wait -= dt;
      else {
        d += dir * speed * dt;
        if (d >= route.total || d <= 0) {
          d = Math.max(0, Math.min(route.total, d));
          dir = -dir;
          wait = rest;
        }
      }
      ship.place(route, d, t, wait <= 0, dir);
    });
  };
  const iolcos = siteById.iolcos;
  const argo = makeShip(fx, scene, { scale: 1.25, sail: rgb('#f3e3a8'), device: C.gold, trim: C.gold, hull: rgb('#4f3a2a'), crew: true });
  shuttle(argo, nav.route([[iolcos.x, iolcos.z + 1], W(25.9, 40.0), W(27.9, 40.72), W(29.14, 41.6), W(30.75, 42.0)]), 2.3, 9);
  labels.push({ id: 'argo', name: 'The Argo', kind: 'ship', tier: 2, target: argo.label, dy: 11 });

  const theseus = makeShip(fx, scene, { scale: 1.1, sail: rgb('#2b2436'), trim: C.blue, hull: rgb('#3a2c22') });
  shuttle(theseus, nav.route([W(25.16, 35.45), W(24.3, 36.9), W(23.66, 37.86)]), 1.9, 8);
  labels.push({ id: 'theseus', name: 'Theseus', kind: 'ship', tier: 3, target: theseus.label, dy: 10 });

  const lanes = [
    [W(28.3, 36.5), W(25.9, 36.9), W(23.7, 37.8)],
    [W(15.35, 37.0), W(19.5, 37.4), W(21.4, 38.15)],
    [W(21.9, 33.0), W(24.4, 34.8), W(24.9, 34.9)],
    [W(14.2, 40.75), W(15.2, 39.2), W(15.75, 38.5)],
    [W(26.9, 38.4), W(25.3, 38.6), W(24.0, 39.9)],
  ];
  lanes.forEach((lane, i) => {
    const s = makeShip(fx, scene, { scale: 0.85, sail: [C.sail, rgb('#e9c9a0'), rgb('#d7e6f2')][i % 3], trim: [C.blue, C.teal, C.red][i % 3] });
    shuttle(s, nav.route(lane), 1.3 + (i % 3) * 0.25, 5 + i * 2);
  });

  // -------------------------------------------------------- winged fliers --
  // A body with two wings that beat. Returns the group and a flap(t) function.
  const winged = (bodyGeo, span, chord, color, at) => {
    const group = new THREE.Group();
    fx.mesh(group, bodyGeo, { shadow: true });
    const wings = [-1, 1].map((side) => {
      const wg = new Geo();
      wg.sheet([chord * 0.5, 0, 0], [chord * 0.1, 0.05, side * span], [-chord * 0.7, 0, side * span * 0.8], [-chord * 0.5, 0, 0], color, rgb('#dcd6e8'));
      const m = fx.mesh(group, wg, { shadow: true });
      m.position.set(at[0], at[1], side * at[2]);
      return { m, side };
    });
    scene.add(group);
    return {
      group,
      flap(t, rate = 8, amp = 0.7) {
        for (const w of wings) w.m.rotation.x = -w.side * (0.15 + Math.sin(t * rate) * amp);
      },
    };
  };

  // Pegasus circles central Greece.
  {
    const hg = new Geo();
    beast(hg, 0, 0, 0, 0.95, { body: C.white, legs: rgb('#e6e2f0'), neck: 0.3, headUp: 0.7, snout: rgb('#e6e2f0'), mane: rgb('#f6c945'), tail: rgb('#f6c945'), legH: 0.34, bodyH: 0.3, bodyW: 0.3 });
    const peg = winged(hg, 1.0, 0.6, C.white, [0.05, 0.62, 0.12]);
    const [cx, cz] = W(22.95, 38.25);
    const target = { x: 0, y: 0, z: 0 };
    labels.push({ id: 'pegasus', name: 'Pegasus', kind: 'ship', tier: 2, target, dy: 10 });
    fx.tick((t) => {
      const a = t * 0.11;
      const x = cx + Math.cos(a) * 15, z = cz + Math.sin(a) * 8.5;
      const y = 6.2 + Math.sin(t * 0.5) * 0.8;
      peg.group.position.set(x, y, z);
      peg.group.rotation.y = Math.atan2(-Math.cos(a) * 8.5, -Math.sin(a) * 15);
      peg.group.rotation.z = 0.12;
      peg.flap(t, 7, 0.75);
      target.x = x; target.y = y; target.z = z;
    });
  }

  // Daedalus and Icarus leave Crete. One of them does not listen.
  {
    const mk = (tunic) => {
      const g = new Geo();
      // Flying prone: build the figure upright, then lay it forward along +x.
      g.withMatrix(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.25), (q) => person(q, 0, -0.2, 0, 0.5, { tunic, rot: Math.PI / 2, noArms: true }));
      return winged(g, 0.55, 0.3, C.white, [0.12, 0.02, 0.06]);
    };
    const dae = mk(rgb('#b9a0d9')), ica = mk(C.red);
    const k = siteById.knossos, fall = siteById.icaria;
    const start = [k.x, k.z - 1], end = [fall.x, fall.z];
    const dx = end[0] - start[0], dz = end[1] - start[1];
    const heading = Math.atan2(-dz, dx);
    const feathers = fx.glyphs(scene, { glyph: 'feather', color: '#ffffff', n: 5, x: end[0], y: 1.2, z: end[1], rise: 2.6, spread: 0.5, life: 2.4 });
    let splashed = false;
    const target = { x: 0, y: 0, z: 0 };
    labels.push({ id: 'icarus', name: 'Icarus', kind: 'ship', tier: 2, target, dy: 9 });
    fx.tick((t) => {
      const c = t % 34;
      const u = Math.min(1, c / 20); // the crossing
      // Daedalus keeps a middle course and flies on.
      const du = c / 20;
      dae.group.visible = du < 1.45;
      dae.group.position.set(start[0] + dx * du + 0.8, 3 + Math.sin(t * 1.1) * 0.15, start[1] + dz * du + 0.5);
      dae.group.rotation.y = heading;
      dae.flap(t, 9, 0.6);
      // Icarus climbs, then falls.
      let y, spin = 0;
      if (c < 20) y = 3.4 + 4.2 * u ** 2.2 + Math.sin(t * 1.3) * 0.15;
      else {
        const f = Math.min(1, (c - 20) / 2.2);
        y = 7.6 * (1 - f * f);
        spin = f * 9;
      }
      ica.group.visible = c < 22.2;
      ica.group.position.set(start[0] + dx * u, y, start[1] + dz * u);
      ica.group.rotation.set(spin, heading, spin * 0.7);
      ica.flap(t, c < 20 ? 11 : 26, c < 20 ? 0.65 : 0.25);
      feathers.on = c > 19.5 && c < 23;
      if (c >= 22.2 && !splashed) {
        splashed = true;
        fx.splash(end[0], end[1], 1.0);
        fx.splash(end[0], end[1], 0.55);
      }
      if (c < 1) splashed = false;
      const tg = ica.group.visible ? ica.group.position : dae.group.position;
      target.x = tg.x; target.y = tg.y; target.z = tg.z;
    });
  }

  // ---------------------------------------------------------------- dolphins --
  {
    const dg = new Geo();
    const grey = rgb('#6f8fb5'), belly = rgb('#cfe0ee');
    dg.blob(0, 0, 0, 0.3, 0.1, 0.1, grey, { dark: belly });
    dg.cyl(0.02, 0.06, 0, 0.07, 0, 0.14, 4, grey);
    dg.box(-0.32, -0.02, 0, 0.1, 0.03, 0.2, grey);
    dg.box(0.3, -0.03, 0, 0.12, 0.05, 0.06, grey);
    const geo = dg.build();
    const pods = [W(24.6, 38.5), W(25.0, 36.3), W(19.6, 37.2), W(17.2, 39.3), W(26.6, 35.6), W(13.0, 39.2)];
    pods.forEach((p, pi) => {
      for (let i = 0; i < 3; i++) {
        const m = fx.mesh(scene, geo, { shadow: true });
        let wet = true;
        fx.tick((t) => {
          const a = t * 0.05 + pi * 2; // the pod wanders in a slow circle
          const ox = p[0] + Math.cos(a) * 3.5, oz = p[1] + Math.sin(a) * 2.5;
          const hx = -Math.sin(a), hz = Math.cos(a);
          const c = (t * 0.45 + i * 0.31 + pi * 0.17) % 1; // one leap per cycle
          const leap = c < 0.42 ? c / 0.42 : -1;
          m.visible = leap >= 0;
          const along = (i - 1) * 0.7 + (leap >= 0 ? leap * 1.5 : 0);
          const x = ox + hx * along + hz * (i - 1) * 0.35, z = oz + hz * along - hx * (i - 1) * 0.35;
          if (leap >= 0) {
            m.position.set(x, Math.sin(leap * Math.PI) * 0.55 - 0.05, z);
            m.rotation.set(0, Math.atan2(-hz, hx), (0.5 - leap) * 1.9, 'YXZ');
            if (wet) { wet = false; fx.splash(x, z, 0.3); }
          } else if (!wet) {
            wet = true;
            fx.splash(x + hx * 1.5, z + hz * 1.5, 0.35);
          }
        });
      }
    });
  }

  // --------------------------------------------------------- the sea monster --
  {
    const [cx, cz] = W(18.6, 35.2);
    const segs = [];
    const hide = rgb('#2f9e86'), hide2 = rgb('#237a6d');
    for (let i = 0; i < 8; i++) {
      const g = new Geo();
      if (i === 0) {
        g.blob(0, 0, 0, 0.42, 0.3, 0.3, hide, { dark: hide2 });
        g.box(0.3, -0.06, 0, 0.3, 0.16, 0.34, hide);
        g.box(0.2, 0.2, 0.14, 0.08, 0.08, 0.06, C.flame);
        g.box(0.2, 0.2, -0.14, 0.08, 0.08, 0.06, C.flame);
        g.cyl(-0.1, 0.22, 0, 0.1, 0, 0.3, 4, rgb('#f29a4a'));
      } else {
        const k = 1 - i * 0.07;
        g.blob(0, 0, 0, 0.36 * k, 0.3 * k, 0.26 * k, i % 2 ? hide2 : hide, { dark: hide2 });
        g.cyl(0, 0.2 * k, 0, 0.08, 0, 0.2, 4, rgb('#f29a4a'));
      }
      segs.push(fx.mesh(scene, g, { shadow: true }));
    }
    const target = { x: cx, y: 0, z: cz };
    labels.push({ id: 'ketos', name: 'Ketos', kind: 'monster', tier: 3, target, dy: 10 });
    fx.tick((t) => {
      segs.forEach((m, i) => {
        const a = t * 0.16 - i * 0.14;
        const x = cx + Math.cos(a) * 4.2, z = cz + Math.sin(a) * 3;
        m.position.set(x, (i === 0 ? 0.22 : -0.02) + Math.sin(t * 1.6 - i * 0.9) * 0.24, z);
        m.rotation.y = Math.atan2(-Math.cos(a) * 3, -Math.sin(a) * 4.2);
        if (i === 0) { target.x = x; target.z = z; }
      });
    });
  }

  return { voyage, labels };
}
