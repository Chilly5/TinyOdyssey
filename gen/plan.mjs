// The settled country: a town wrapped round each great site, harbours, and the
// roads between places. Worked out once for the whole map and kept as a flag per
// ground cell, which the renderer reads while it builds each region. The roads
// and streets are also handed on to the viewer, as the ways the little people walk.

import { hash2, noise2 } from '../src/util.js';

export const PF = { ROAD: 1, PAVED: 2, WALL: 4, TOWER: 8, PIER: 16, TOWN: 32, FARM: 64 };
const TAU = Math.PI * 2;
const RS = 4; // road-finding grid: cells per node

export function buildPlan({ fields, sites, landmarks, S, GW, GD, ground, lap = () => {} }) {
  const flag = new Uint8Array(GW * GD);
  const objects = []; // { x, z, kind, v }: things the renderer stands on the ground
  const streets = []; // paved ways inside towns, as polylines of cells
  const roads = []; // tracks between places, as polylines of cells
  const towns = [];
  const inWorld = (x, z) => x >= 0 && z >= 0 && x < GW && z < GD;
  const isLand = (x, z) => inWorld(x, z) && fields.elevAt((x + 0.5) / S, (z + 0.5) / S) > 0;

  // Paint a polyline `wide` cells across into the flags, wherever test allows.
  const stroke = (pts, wide, bit, test) => {
    const r = wide / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2) || 1;
      for (let t = 0; t <= n; t++) {
        const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
        for (let b = Math.floor(z - r); b <= Math.floor(z + r); b++) {
          for (let a = Math.floor(x - r); a <= Math.floor(x + r); a++) {
            if ((a + 0.5 - x) ** 2 + (b + 0.5 - z) ** 2 > r * r + 0.3) continue;
            if (inWorld(a, b) && (!test || test(a, b))) flag[b * GW + a] |= bit;
          }
        }
      }
    }
  };

  // --- Towns ------------------------------------------------------------------------
  // A town fills the levelled ground round its landmark: streets running out from the
  // middle, a ring street, houses in rows between them, a market, perhaps a wall, and a
  // pier if the sea is near.
  for (const s of sites) {
    if (!s.town || !s.R || s.sea) continue;
    const lm = landmarks.find((l) => l.site && l.site.id === s.id);
    // R is the town's edge; the landmark's own ground reaches Rm.
    const cx = Math.round(s.x * S), cz = Math.round(s.z * S), R = s.RT * S, Rm = s.R * S;
    const pad = Math.ceil(R) + 50;
    const x0 = cx - pad, z0 = cz - pad, w = pad * 2 + 1;
    const at = (x, z) => (z - z0) * w + x - x0;
    const inBox = (x, z) => x >= x0 && z >= z0 && x < x0 + w && z < z0 + w;
    const seed = cx * 7 + cz * 13;

    // Where the landmark itself stands, with a little room round it.
    const solid = new Uint8Array(w * w);
    if (lm && lm.stampTops) {
      const sh = new Int16Array(w * w);
      lm.stampTops(sh, x0, z0, w, w);
      for (let k = 0; k < w * w; k++) if (sh[k] > 0) solid[k] = 1;
    }
    const occ = new Uint8Array(w * w);
    const GAP = 3;
    for (let z = 0; z < w; z++) {
      for (let x = 0; x < w; x++) {
        if (!solid[z * w + x]) continue;
        for (let b = Math.max(0, z - GAP); b <= Math.min(w - 1, z + GAP); b++) occ.fill(1, b * w + Math.max(0, x - GAP), b * w + Math.min(w - 1, x + GAP) + 1);
      }
    }
    const inside = (x, z, m = 0) => Math.hypot(x + 0.5 - s.x * S, z + 0.5 - s.z * S) <= R - m;
    const open = (x, z) => inBox(x, z) && !occ[at(x, z)] && inside(x, z, 1) && isLand(x, z);

    for (let z = cz - Math.ceil(R) - 84; z <= cz + Math.ceil(R) + 84; z++) {
      for (let x = cx - Math.ceil(R) - 84; x <= cx + Math.ceil(R) + 84; x++) {
        if (!inWorld(x, z)) continue;
        const d = Math.hypot(x + 0.5 - s.x * S, z + 0.5 - s.z * S);
        if (d <= R) flag[z * GW + x] |= PF.TOWN;
        else if (d <= R + 80 + (noise2(x / 23, z / 23, 311) - 0.5) * 40) flag[z * GW + x] |= PF.FARM;
      }
    }

    // Streets: spokes and a ring.
    const nSpoke = Math.max(3, Math.min(7, Math.round(s.town / 14)));
    const a0 = hash2(seed, 1, 301) * TAU;
    const spokes = [];
    for (let i = 0; i < nSpoke; i++) {
      const a = a0 + ((i + (hash2(seed, i, 302) - 0.5) * 0.3) / nSpoke) * TAU;
      spokes.push(a);
      let run = [];
      for (let r = 6; r <= R + 3; r += 3) {
        const wob = (noise2(r / 17, i * 9.1, seed & 255) - 0.5) * 0.16;
        const x = cx + Math.cos(a + wob) * r, z = cz + Math.sin(a + wob) * r;
        if (open(Math.round(x), Math.round(z)) || (r > R - 2 && isLand(Math.round(x), Math.round(z)))) run.push([x, z]);
        else {
          if (run.length > 2) streets.push(run);
          run = [];
        }
      }
      if (run.length > 2) streets.push(run);
    }
    const ringR = Rm * 0.4 + R * 0.42;
    if (R >= 40) {
      let run = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        const x = cx + Math.cos(a) * ringR, z = cz + Math.sin(a) * ringR;
        if (open(Math.round(x), Math.round(z))) run.push([x, z]);
        else {
          if (run.length > 2) streets.push(run);
          run = [];
        }
      }
      if (run.length > 2) streets.push(run);
    }
    const first = towns.length ? towns[towns.length - 1].streetEnd : 0;
    for (let i = first; i < streets.length; i++) stroke(streets[i], 2, PF.PAVED, (x, z) => isLand(x, z) && !(inBox(x, z) && solid[at(x, z)]));

    // The market: an open paved place on the ring street, on the side facing the viewer.
    let pa = spokes[0], best = -2;
    for (let i = 0; i < nSpoke; i++) {
      const mid = spokes[i] + TAU / nSpoke / 2;
      if (Math.sin(mid) > best && open(Math.round(cx + Math.cos(mid) * ringR), Math.round(cz + Math.sin(mid) * ringR))) { best = Math.sin(mid); pa = mid; }
    }
    const px = Math.round(cx + Math.cos(pa) * ringR), pz = Math.round(cz + Math.sin(pa) * ringR);
    const market = best > -2 && R >= 40;
    if (market) {
      for (let b = -8; b <= 8; b++) for (let a = -12; a <= 12; a++) {
        if ((a / 12) ** 2 + (b / 8) ** 2 <= 1 && open(px + a, pz + b)) flag[(pz + b) * GW + px + a] |= PF.PAVED;
      }
      if (open(px, pz - 9) && open(px - 8, pz - 9) && open(px + 8, pz - 9)) objects.push({ x: px, z: pz - 9, kind: 'stoa', v: hash2(seed, 5, 303) });
      objects.push({ x: px, z: pz, kind: 'statue', v: hash2(seed, 6, 303) });
      for (let i = 0; i < 5; i++) {
        const a = 0.5 + i * 0.55;
        const x = Math.round(px + Math.cos(a) * 9.5), z = Math.round(pz + Math.sin(a) * 5.5);
        if (open(x, z)) objects.push({ x, z, kind: 'stall', v: hash2(seed, i, 304) });
      }
    }

    // The wall, with towers, and gates where the streets leave.
    if (s.walls) {
      // Not a perfect circle: the wall wanders a little, as walls built over years do.
      const ph = hash2(seed, 2, 313) * TAU;
      const rwAt = (a) => (R - 8) * (1 + 0.05 * Math.sin(3 * a + ph) + 0.035 * Math.sin(5 * a + ph * 2.3));
      const rw = R - 8;
      const nT = Math.max(6, Math.round((TAU * rw) / 30));
      const n = Math.ceil(TAU * rw * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const x = Math.round(cx + Math.cos(a) * rwAt(a)), z = Math.round(cz + Math.sin(a) * rwAt(a));
        if (!isLand(x, z) || (inBox(x, z) && solid[at(x, z)])) continue;
        let gate = false;
        for (const sa of spokes) {
          const da = Math.abs(((a - sa + TAU * 1.5) % TAU) - Math.PI);
          if (da * rw < 3.2) gate = true;
        }
        if (gate) continue;
        for (let b = 0; b <= 1; b++) for (let c = 0; c <= 1; c++) if (isLand(x + c, z + b)) flag[(z + b) * GW + x + c] |= PF.WALL;
      }
      for (let i = 0; i < nT; i++) {
        const a = a0 + ((i + 0.5) / nT) * TAU;
        const x = Math.round(cx + Math.cos(a) * rwAt(a)), z = Math.round(cz + Math.sin(a) * rwAt(a));
        if (!isLand(x, z) || (inBox(x, z) && solid[at(x, z)])) continue;
        for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) if (isLand(x + c, z + b)) flag[(z + b) * GW + x + c] |= PF.WALL | PF.TOWER;
      }
    }

    // Houses, row behind row, the middle of town first.
    const taken = new Uint8Array(w * w);
    const lotFree = (x, z, rx, rz) => {
      for (let b = z - rz; b <= z + rz; b++) {
        for (let a = x - rx; a <= x + rx; a++) {
          if (!open(a, b) || !inside(a, b, 2) || taken[at(a, b)] || flag[b * GW + a] & (PF.PAVED | PF.WALL | PF.PIER)) return false;
        }
      }
      return true;
    };
    const claim = (x, z, rx, rz) => {
      for (let b = z - rz; b <= z + rz; b++) taken.fill(1, at(x - rx, b), at(x + rx, b) + 1);
    };
    let left = s.town;
    for (let r = 10; r < R - 4 && left > 0; r += 10) {
      const n = Math.floor((TAU * r) / 12);
      const ra = hash2(seed, r, 305) * TAU;
      for (let i = 0; i < n && left > 0; i++) {
        const a = ra + ((i + (hash2(i, r, seed & 1023) - 0.5) * 0.3) / n) * TAU;
        const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
        const big = r < ringR + 14 && hash2(x, z, 306) < 0.45;
        const rx = big ? 6 : 5, rz = big ? 4 : 3;
        if (!lotFree(x, z, rx, rz)) continue;
        claim(x, z, rx, rz);
        objects.push({ x, z, kind: big ? 'big' : 'house', v: hash2(x, z, 307) });
        left--;
      }
    }
    // Trees in what room is left: cypresses and olives in yards.
    for (let z = cz - Math.ceil(R); z <= cz + R; z += 5) {
      for (let x = cx - Math.ceil(R); x <= cx + R; x += 5) {
        const tx = x + Math.floor(hash2(x, z, 308) * 5), tz = z + Math.floor(hash2(x, z, 309) * 5);
        if (hash2(x, z, 310) > 0.13 || !lotFree(tx, tz, 2, 2)) continue;
        claim(tx, tz, 2, 2);
        objects.push({ x: tx, z: tz, kind: 'tree', v: hash2(tx, tz, 311) });
      }
    }

    // A harbour, if open sea is close: a pier, a paved quay, boats tied up.
    if (s.harbour !== false) {
      let h = null;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU;
        for (let r = 10; r < R + 40; r++) {
          const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
          if (!inWorld(x, z)) break;
          if (isLand(x, z)) continue;
          const far = fields.sdAt((cx + Math.cos(a) * (r + 22)) / S, (cz + Math.sin(a) * (r + 22)) / S);
          if (far > 0.35) {
            const score = r - 18 * Math.sin(a);
            if (!h || score < h.score) h = { a, r, score };
          }
          break;
        }
      }
      if (h) {
        const dx = Math.cos(h.a), dz = Math.sin(h.a);
        const p = (t, side = 0) => [cx + dx * (h.r + t) - dz * side, cz + dz * (h.r + t) + dx * side];
        stroke([p(-10), p(0)], 3, PF.PAVED, (x, z) => isLand(x, z) && !(inBox(x, z) && solid[at(x, z)]));
        stroke([p(-1), p(19)], 3, PF.PIER, (x, z) => !isLand(x, z));
        streets.push([p(-10), p(0), p(18)]);
        for (const [t, side] of [[7, 6], [14, -6], [16, 7]]) {
          const [bx, bz] = p(t, side);
          if (!isLand(Math.round(bx), Math.round(bz)) && fields.sdAt(bx / S, bz / S) > 0.08) objects.push({ x: Math.round(bx), z: Math.round(bz), kind: 'boat', v: hash2(seed, t, 312) });
        }
        s.pier = p(18).map((v) => v / S); // where the pier ends, in world units
      }
    }
    towns.push({ id: s.id, cx, cz, R, streetEnd: streets.length, market: market ? [px, pz] : null });
  }
  lap(`plan: ${towns.length} towns, ${objects.length} buildings and boats`);

  // --- Roads ------------------------------------------------------------------------
  // Each place is joined to its nearest neighbours by the easiest way over the ground:
  // A* on a coarse grid, where climbing costs and an existing road is cheap to follow.
  const rw = Math.ceil(GW / RS), rh = Math.ceil(GD / RS), RN = rw * rh;
  const hgt = new Float32Array(RN);
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      const h = ground(i * RS + (RS >> 1), j * RS + (RS >> 1));
      hgt[j * rw + i] = h === 0 ? -1 : Math.abs(h);
    }
  }
  const onRoad = new Uint8Array(RN);
  const gScore = new Float32Array(RN), came = new Int32Array(RN), stampA = new Uint32Array(RN), closed = new Uint32Array(RN);
  let run = 0;
  function astar(start, goal, limit) {
    run++;
    const heap = [];
    const push = (f, i) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const gi = goal % rw, gj = Math.floor(goal / rw);
    const hh = (k) => Math.hypot((k % rw) - gi, Math.floor(k / rw) - gj) * 0.35; // never more than the cheapest going
    gScore[start] = 0;
    stampA[start] = run;
    came[start] = -1;
    push(hh(start), start);
    let seen = 0;
    while (heap.length) {
      const [, k] = pop();
      if (k === goal) break;
      if (closed[k] === run) continue;
      closed[k] = run;
      if (++seen > limit) return null;
      const i = k % rw, j = Math.floor(k / rw);
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          if (!a && !b) continue;
          const ni = i + a, nj = j + b;
          if (ni < 0 || nj < 0 || ni >= rw || nj >= rh) continue;
          const nk = nj * rw + ni;
          if (hgt[nk] < 0 || closed[nk] === run) continue;
          const dist = a && b ? 1.4142 : 1;
          const slope = Math.abs(hgt[nk] - hgt[k]) / (dist * RS);
          const g = gScore[k] + dist * (onRoad[nk] ? 0.35 : 1) * (1 + 5 * slope + 30 * Math.max(0, slope - 0.9));
          if (stampA[nk] !== run || g < gScore[nk]) {
            gScore[nk] = g;
            stampA[nk] = run;
            came[nk] = k;
            push(g + hh(nk), nk);
          }
        }
      }
    }
    if (stampA[goal] !== run) return null;
    const path = [];
    for (let k = goal; k >= 0; k = came[k]) path.push(k);
    return path.reverse();
  }
  const nodeOf = (s) => {
    // The nearest node on land to a site.
    const i0 = Math.floor((s.x * S) / RS), j0 = Math.floor((s.z * S) / RS);
    for (let rad = 0; rad < 12; rad++) {
      for (let j = j0 - rad; j <= j0 + rad; j++) for (let i = i0 - rad; i <= i0 + rad; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== rad || i < 0 || j < 0 || i >= rw || j >= rh) continue;
        if (hgt[j * rw + i] >= 0) return j * rw + i;
      }
    }
    return -1;
  };
  const places = sites.filter((s) => !s.sea && s.road !== false && s.x != null).map((s) => ({ s, node: nodeOf(s) })).filter((p) => p.node >= 0);
  const edges = new Map();
  for (const a of places) {
    const near = places.filter((b) => b !== a).map((b) => ({ b, d: Math.hypot(a.s.x - b.s.x, a.s.z - b.s.z) })).filter((e) => e.d < 17).sort((p, q) => p.d - q.d);
    for (const { b, d } of near.slice(0, a.s.town || a.s.tier === 1 ? 3 : 2)) {
      const key = a.s.id < b.s.id ? `${a.s.id}|${b.s.id}` : `${b.s.id}|${a.s.id}`;
      if (!edges.has(key)) edges.set(key, { a, b, d });
    }
  }
  let made = 0;
  for (const { a, b, d } of [...edges.values()].sort((p, q) => p.d - q.d)) {
    const cells = astar(a.node, b.node, 260000);
    if (!cells) continue; // another island, or no way through
    let pts = cells.map((k) => {
      const x = ((k % rw) + 0.5) * RS, z = (Math.floor(k / rw) + 0.5) * RS;
      return [x + (noise2(x / 26, z / 26, 321) - 0.5) * 9, z + (noise2(x / 26, z / 26, 322) - 0.5) * 9];
    });
    pts[0] = [a.s.x * S, a.s.z * S];
    pts[pts.length - 1] = [b.s.x * S, b.s.z * S];
    for (let it = 0; it < 2; it++) { // round the grid's corners off
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    const main = (a.s.town || a.s.tier === 1) && (b.s.town || b.s.tier === 1);
    stroke(pts, main ? 3 : 2, PF.ROAD, isLand);
    for (const k of cells) onRoad[k] = 1;
    roads.push({ from: a.s.id, to: b.s.id, main: !!main, km: d * 5, pts });
    made++;
  }
  lap(`plan: ${made} roads of ${edges.size} tried`);

  // Objects by 128-cell square, for the renderer.
  const buckets = new Map();
  for (const o of objects) {
    const key = (o.z >> 7) * 4096 + (o.x >> 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }
  const objectsIn = (x0, z0, x1, z1) => {
    const out = [];
    for (let bj = Math.max(0, z0 >> 7); bj <= z1 >> 7; bj++) for (let bi = Math.max(0, x0 >> 7); bi <= x1 >> 7; bi++) {
      const list = buckets.get(bj * 4096 + bi);
      if (list) for (const o of list) if (o.x >= x0 && o.x < x1 && o.z >= z0 && o.z < z1) out.push(o);
    }
    return out;
  };

  return { flag, objects, objectsIn, streets, roads, towns };
}
