// Where the little people go. Everything that walks follows a path worked out
// here, once: the roads between places, the streets of the towns, loops for
// herds to graze round, lines for farmers to work along, circuits for fishing
// boats. Paths are handed to the viewer in image pixels, already following the
// rise and fall of the ground, so the viewer only has to move sprites along them.
// Each point is x, y and the height of the ground there: from y and the height the
// viewer knows how far south the walker stands, and so what hides it (the scenery's
// own height, as the camera sees it, is in the occlusion tiles; see gen/tiles.mjs).

import { hash2, mulberry32 } from '../src/util.js';
import { worldToLonLat } from '../src/config.js';
import { PF } from './plan.mjs';
import { KZ, KY } from './region.mjs';

const TAU = Math.PI * 2;

export function buildLife({ renderer, fields, sites }) {
  const { S, OY, GW, GD, ground, quant } = renderer;
  const P = renderer.plan();
  const rnd = mulberry32(90210);
  const flagAt = (x, z) => (x >= 0 && z >= 0 && x < GW && z < GD ? P.flag[Math.round(z) * GW + Math.round(x)] : 0);
  const heightAt = (x, z) => {
    const h = ground(Math.round(x), Math.round(z));
    return h === 0 ? -1 : quant(Math.abs(h));
  };
  const r1 = (v) => Math.round(v * 10) / 10;

  // A polyline of ground cells -> image pixels, stepping every few cells and easing the climbs.
  function trace(cells, { step = 3, closed = false, sea = false } = {}) {
    const pts = [];
    for (let i = 0; i < cells.length - (closed ? 0 : 1); i++) {
      const [ax, az] = cells[i], [bx, bz] = cells[(i + 1) % cells.length];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
      for (let t = 0; t < n; t++) pts.push([ax + ((bx - ax) * t) / n, az + ((bz - az) * t) / n]);
    }
    if (!closed) pts.push(cells[cells.length - 1]);
    const hs = pts.map(([x, z]) => (sea ? 0 : Math.max(0, heightAt(x, z))));
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      let sum = 0, cnt = 0;
      for (let k = -2; k <= 2; k++) {
        const j = closed ? (i + k + pts.length) % pts.length : i + k;
        if (j >= 0 && j < pts.length) { sum += hs[j]; cnt++; }
      }
      const h = r1(sum / cnt);
      out.push(r1(pts[i][0]), r1(OY + KZ * pts[i][1] - KY * h), h);
    }
    if (closed) out.push(out[0], out[1], out[2]);
    return out;
  }
  const onLand = (x, z) => heightAt(x, z) > 0;
  const level = (x, z, r) => { // is the ground round here nearly flat, dry and unbuilt?
    const h = heightAt(x, z);
    if (h <= 0) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const hh = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (hh <= 0 || Math.abs(hh - h) > 4) return false;
    }
    return true;
  };

  // --- Roads: the whole way from one place to the next, without the stretch inside the landmark ---
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const roads = P.roads.map((r) => {
    const a = byId[r.from], b = byId[r.to];
    const keep = r.pts.filter(([x, z]) => Math.hypot(x - a.x * S, z - a.z * S) > a.R * S * 0.6 && Math.hypot(x - b.x * S, z - b.z * S) > b.R * S * 0.6);
    return keep.length > 4 ? { from: r.from, to: r.to, main: r.main, pts: trace(keep) } : null;
  }).filter(Boolean);

  // --- Streets, town by town ---
  const towns = [];
  let s0 = 0;
  for (const t of P.towns) {
    const streets = P.streets.slice(s0, t.streetEnd).filter((st) => st.length > 3).map((st) => trace(st, { step: 2 }));
    s0 = t.streetEnd;
    const site = byId[t.id];
    const town = { id: t.id, streets, market: null, wall: null, fields: [], boats: [] };
    if (t.market) {
      const [mx, mz] = t.market;
      town.market = Array.from({ length: 5 }, (_, i) => {
        const loop = [];
        const n = 5 + (i % 3);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + i, rr = 3 + ((i * 7 + k * 3) % 5) * 1.6;
          loop.push([mx + Math.cos(a) * rr * 1.25, mz + Math.sin(a) * rr * 0.8]);
        }
        return trace(loop, { step: 2, closed: true });
      });
    }
    if (site.walls) { // the watch walks round outside the wall, a few steps clear of it
      const loop = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * TAU;
        let far = 0;
        for (let rr = t.R * 0.5; rr < t.R + 16; rr++) if (flagAt(t.cx + Math.cos(a) * rr, t.cz + Math.sin(a) * rr) & PF.WALL) far = rr;
        const rr = (far || t.R) + 5;
        const x = t.cx + Math.cos(a) * rr, z = t.cz + Math.sin(a) * rr;
        if (onLand(x, z) && !(flagAt(x, z) & PF.WALL)) loop.push([x, z]);
      }
      if (loop.length > 30) town.wall = trace(loop, { step: 3, closed: true });
    }
    // People at work in the fields round the town.
    for (let tries = 0; tries < 60 && town.fields.length < Math.min(10, 3 + site.town / 8); tries++) {
      const a = rnd() * TAU, rr = t.R + 10 + rnd() * 55;
      const x = Math.round(t.cx + Math.cos(a) * rr), z = Math.round(t.cz + Math.sin(a) * rr);
      if (!(flagAt(x, z) & PF.FARM) || flagAt(x, z) & (PF.ROAD | PF.TOWN) || !level(x, z, 6)) continue;
      const len = 5 + rnd() * 6;
      town.fields.push({ kind: rnd() < 0.3 ? 'ox' : 'farmer', pts: trace([[x - len, z], [x + len, z]], { step: 2 }) });
    }
    if (site.pier) { // boats working out of the harbour
      const [px, pz] = [site.pier[0] * S, site.pier[1] * S];
      for (let k = 0; k < 3; k++) {
        const loop = [];
        const cx = px + (rnd() - 0.5) * 90, cz = pz + (rnd() - 0.2) * 70, rr = 12 + rnd() * 16;
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * TAU;
          loop.push([cx + Math.cos(a) * rr * 1.3, cz + Math.sin(a) * rr]);
        }
        if (loop.every(([x, z]) => fields.sdAt(x / S, z / S) > 0.12)) town.boats.push(trace(loop, { step: 3, closed: true, sea: true }));
      }
    }
    towns.push(town);
  }

  // --- Herds: a loop to graze round, on open level ground away from towns and fields ---
  const herds = [];
  const STEP = 64;
  for (let lj = 1; lj < GD / STEP - 1; lj++) {
    for (let li = 1; li < GW / STEP - 1; li++) {
      if (hash2(li, lj, 401) > 0.085) continue;
      const cx = Math.round((li + hash2(li, lj, 402)) * STEP), cz = Math.round((lj + hash2(li, lj, 403)) * STEP);
      if (!level(cx, cz, 10) || flagAt(cx, cz) & (PF.TOWN | PF.FARM | PF.ROAD)) continue;
      const e = fields.softAt(cx / S, cz / S);
      if (e < 6 || e > 1150) continue;
      const [lon, lat] = worldToLonLat(cx / S, cz / S);
      const M = fields.moistAt(cx / S, cz / S);
      const v = hash2(li, lj, 404);
      let kind = v < 0.5 ? 'sheep' : v < 0.74 ? 'goat' : v < 0.86 ? 'ox' : 'horse';
      if (e > 700) kind = v < 0.6 ? 'goat' : v < 0.85 ? 'deer' : 'wolf';
      else if (M > 0.7 && v > 0.55) kind = v < 0.8 ? 'deer' : 'boar';
      else if (lat < 34.2) kind = v < 0.6 ? 'goat' : 'sheep';
      else if (lat > 39 && lat < 40 && lon > 21.6 && lon < 23 && v > 0.5) kind = 'horse'; // the horse country of Thessaly
      const loop = [];
      const n = 7, rr = 9 + hash2(li, lj, 405) * 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, q = rr * (0.7 + 0.6 * hash2(li * 7 + k, lj, 406));
        loop.push([cx + Math.cos(a) * q * 1.2, cz + Math.sin(a) * q]);
      }
      if (!loop.every(([x, z]) => onLand(x, z) && !(flagAt(x, z) & (PF.TOWN | PF.WALL)))) continue;
      const wild = kind === 'deer' || kind === 'wolf' || kind === 'boar';
      herds.push({ kind, n: wild ? 2 + Math.floor(v * 7) % 3 : 4 + Math.floor(hash2(li, lj, 407) * 6), keeper: !wild && kind !== 'horse', pts: trace(loop, { step: 2, closed: true }) });
    }
  }

  // --- Out of the stories: creatures that keep to their own country ---
  const roam = (id, kind, n, r0, r1, opts = {}) => {
    const s = byId[id];
    if (!s) return null;
    for (let tries = 0; tries < 40; tries++) {
      const a0 = rnd() * TAU, d0 = (s.RT || s.R || 0) * S + r0 + rnd() * (r1 - r0);
      const cx = s.x * S + Math.cos(a0) * d0, cz = s.z * S + Math.sin(a0) * d0 * 0.8;
      const loop = [];
      const rr = opts.loop || 16;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU, q = rr * (0.75 + 0.5 * rnd());
        loop.push([cx + Math.cos(a) * q * 1.2, cz + Math.sin(a) * q]);
      }
      if (opts.air || loop.every(([x, z]) => onLand(x, z) && !(flagAt(x, z) & (PF.TOWN | PF.WALL)))) {
        return { kind, n, name: opts.name || null, air: opts.air || 0, pts: trace(loop, { step: 2, closed: true, sea: !!opts.air }) };
      }
    }
    return null;
  };
  const myths = [
    roam('pelion', 'centaur', 3, 6, 40, { loop: 22, name: 'Centaurs' }),
    roam('arcadia', 'satyr', 3, 4, 26, { loop: 9, name: 'Satyrs' }),
    roam('cyclops', 'cyclops', 1, 10, 50, { loop: 26 }),
    roam('etna', 'cyclops', 1, 60, 120, { loop: 24 }),
    roam('pieria', 'dancer', 5, 2, 10, { loop: 5 }),
    roam('helicon', 'dancer', 4, 2, 10, { loop: 5 }),
    roam('naxos', 'dancer', 4, 2, 12, { loop: 5 }),
    roam('lykaion', 'wolf', 4, 4, 30, { loop: 16 }),
    roam('calydon', 'boar', 1, 6, 30, { loop: 14 }),
    roam('erymanthos', 'boar', 1, 6, 30, { loop: 14 }),
    roam('gortyn', 'bull', 2, 4, 30, { loop: 12 }),
    roam('marathon', 'bull', 1, 4, 30, { loop: 12 }),
    roam('abdera', 'horse', 4, 6, 36, { loop: 18 }),
    roam('tegea', 'deer', 3, 6, 36, { loop: 14 }),
    roam('thrace', 'bard', 1, 2, 14, { loop: 8 }),
    roam('olympus', 'eagle', 2, 0, 20, { loop: 60, air: 150 }),
    roam('ida', 'eagle', 1, 0, 20, { loop: 44, air: 120 }),
    roam('salmydessus', 'harpy', 3, 0, 20, { loop: 40, air: 46 }),
    roam('hesperides', 'griffin', 1, 10, 60, { loop: 50, air: 60 }),
    roam('ismarus', 'griffin', 1, 20, 90, { loop: 60, air: 70 }),
    roam('troy', 'chariot', 2, 4, 26, { loop: 34 }),
    roam('olympia', 'chariot', 1, 4, 20, { loop: 22 }),
    roam('sparta', 'hoplite', 6, 2, 16, { loop: 12 }),
    roam('aulis', 'hoplite', 5, 2, 12, { loop: 8 }),
    roam('tenedos', 'hoplite', 4, 1, 8, { loop: 6 }),
  ].filter(Boolean);
  // Figures that used to be part of a landmark's own animation, now walked by the units:
  // the lion prowling round its rock at Nemea, the runners on the track at Olympia.
  if (byId.nemea) {
    const s = byId.nemea, loop = [];
    for (let k = 0; k < 16; k++) loop.push([s.x * S + Math.cos((k / 16) * TAU) * 31, s.z * S + Math.sin((k / 16) * TAU) * 31]);
    myths.push({ kind: 'lion', n: 1, name: null, air: 0, pts: trace(loop, { step: 2, closed: true }) });
  }
  if (byId.olympia) {
    const s = byId.olympia, U = 56; // the stadium, in the landmark's own units (see gen/landmarks.js)
    myths.push({ kind: 'runner', n: 3, name: null, air: 0, line: true, pts: trace([[s.x * S - 0.7 * U, s.z * S + 0.55 * U], [s.x * S + 0.9 * U, s.z * S + 0.55 * U]], { step: 2 }) });
  }

  // --- Fishing boats along the coasts ---
  const fishers = [];
  const FSTEP = 110;
  for (let lj = 1; lj < GD / FSTEP - 1; lj++) {
    for (let li = 1; li < GW / FSTEP - 1; li++) {
      const cx = (li + hash2(li, lj, 411)) * FSTEP, cz = (lj + hash2(li, lj, 412)) * FSTEP;
      const sd = fields.sdAt(cx / S, cz / S);
      if (sd < 0.2 || sd > 1.5 || hash2(li, lj, 413) > 0.8) continue;
      const loop = [];
      const rr = 10 + hash2(li, lj, 414) * 14;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        loop.push([cx + Math.cos(a) * rr * 1.4, cz + Math.sin(a) * rr]);
      }
      if (loop.every(([x, z]) => fields.sdAt(x / S, z / S) > 0.14)) fishers.push(trace(loop, { step: 3, closed: true, sea: true }));
    }
  }
  // --- Lamps for the night: one at every house, hall and market stall ---
  const lights = [];
  for (const o of P.objects) {
    if (o.kind !== 'house' && o.kind !== 'big' && o.kind !== 'stoa' && o.kind !== 'stall') continue;
    const h = heightAt(o.x, o.z);
    if (h < 0) continue;
    lights.push(Math.round(o.x), Math.round(OY + KZ * o.z - KY * (h + (o.kind === 'stall' ? 2 : 4))), o.kind === 'big' || o.kind === 'stoa' ? 2 : 1);
  }
  return { v: 2, roads, towns, herds, myths, fishers, lights };
}
