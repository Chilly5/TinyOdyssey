// Sea routes. Ships never cross land: each route is found with A* over a grid
// of open water (keeping off the coast where it can), pulled straight where
// the way is clear, and rounded at the corners.

import { WORLD_W, WORLD_D, lonLatToWorld } from '../src/config.js';
import { VOYAGE } from '../src/sites.js';

const RES = 6; // nav cells per world unit
const CLEAR = 0.09; // keep at least this far from land, in world units

export function buildRoutes({ fields, sites }) {
  const w = Math.ceil(WORLD_W * RES), h = Math.ceil(WORLD_D * RES), N = w * h;
  const sd = new Float32Array(N);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sd[j * w + i] = fields.sdAt((i + 0.5) / RES, (j + 0.5) / RES);
  // Only water joined to the open sea counts: lagoons and lakes would strand a ship.
  const main = new Uint8Array(N);
  {
    const [sx, sz] = lonLatToWorld(19.0, 36.0);
    const seed = Math.floor(sz * RES) * w + Math.floor(sx * RES);
    const stack = [seed];
    main[seed] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % w, j = Math.floor(k / w);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (!main[nk] && sd[nk] > CLEAR) { main[nk] = 1; stack.push(nk); }
      }
    }
  }
  const open = (k) => main[k] === 1;
  const cx = (k) => ((k % w) + 0.5) / RES, cz = (k) => (Math.floor(k / w) + 0.5) / RES;

  function nearestWater(x, z, min = CLEAR) {
    const i0 = Math.floor(x * RES), j0 = Math.floor(z * RES);
    let best = -1, bd = Infinity;
    for (let rad = 0; rad < 80; rad++) {
      for (let j = j0 - rad; j <= j0 + rad; j++) {
        for (let i = i0 - rad; i <= i0 + rad; i++) {
          if (Math.max(Math.abs(j - j0), Math.abs(i - i0)) !== rad) continue;
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const k = j * w + i;
          if (sd[k] <= min || !main[k]) continue;
          const d = Math.hypot(cx(k) - x, cz(k) - z);
          if (d < bd) { bd = d; best = k; }
        }
      }
      if (best >= 0 && rad / RES > bd + 0.5) break;
    }
    return best;
  }

  const gScore = new Float32Array(N), came = new Int32Array(N), stamp = new Uint32Array(N), closed = new Uint32Array(N);
  let run = 0;
  function astar(start, goal) {
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
    const gx = goal % w, gy = Math.floor(goal / w);
    const hh = (k) => Math.hypot((k % w) - gx, Math.floor(k / w) - gy);
    gScore[start] = 0;
    stamp[start] = run;
    came[start] = -1;
    push(hh(start), start);
    while (heap.length) {
      const [, k] = pop();
      if (k === goal) break;
      if (closed[k] === run) continue;
      closed[k] = run;
      const i = k % w, j = Math.floor(k / w);
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          if (!a && !b) continue;
          const ni = i + a, nj = j + b;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const nk = nj * w + ni;
          if (!open(nk) || closed[nk] === run) continue;
          if (a && b && (!open(j * w + ni) || !open(nj * w + i))) continue; // no cutting corners
          const near = sd[nk] < 0.7 ? (0.7 - sd[nk]) * 3.2 : 0;
          const g = gScore[k] + (a && b ? 1.4142 : 1) * (1 + near);
          if (stamp[nk] !== run || g < gScore[nk]) {
            gScore[nk] = g;
            stamp[nk] = run;
            came[nk] = k;
            push(g + hh(nk), nk);
          }
        }
      }
    }
    if (stamp[goal] !== run) return null;
    const path = [];
    for (let k = goal; k >= 0; k = came[k]) path.push(k);
    return path.reverse();
  }

  const clearLine = (ax, az, bx, bz, min) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * RES * 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (fields.sdAt(ax + (bx - ax) * t, az + (bz - az) * t) < min) return false;
    }
    return true;
  };

  // A route through the given world points, as a polyline in world units.
  function route(points) {
    const out = [];
    for (let s = 0; s < points.length - 1; s++) {
      const a = nearestWater(points[s][0], points[s][1]), b = nearestWater(points[s + 1][0], points[s + 1][1]);
      const cells = astar(a, b);
      if (!cells) throw new Error(`no sea route between ${points[s]} and ${points[s + 1]}`);
      let pts = cells.map((k) => [cx(k), cz(k)]);
      // Pull the string tight.
      const tight = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = Math.min(pts.length - 1, i + 60);
        while (j > i + 1 && !clearLine(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 0.22)) j--;
        tight.push(pts[j]);
        i = j;
      }
      pts = tight;
      if (out.length) pts.shift();
      out.push(...pts);
    }
    // Round the corners (Chaikin), keeping the ends.
    let pts = out;
    for (let it = 0; it < 3; it++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    return pts;
  }

  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  // Where a ship moors at a site: open water just clear of it, in front where possible.
  function mooring(stop) {
    if (stop.near) {
      const k = nearestWater(...lonLatToWorld(...stop.near), 0.3);
      return [cx(k), cz(k)];
    }
    const s = byId[stop.site];
    const want = (s.R || 0) + (s.sea ? 1.5 : 1.0);
    let best = null, score = Infinity;
    const R = Math.ceil((want + 5) * RES);
    const i0 = Math.floor(s.x * RES), j0 = Math.floor(s.z * RES);
    for (let j = j0 - R; j <= j0 + R; j++) {
      for (let i = i0 - R; i <= i0 + R; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const k = j * w + i;
        if (sd[k] < 0.4 || !main[k]) continue;
        const sc = Math.abs(Math.hypot(cx(k) - s.x, cz(k) - s.z) - want) + (cz(k) < s.z ? 1.4 : 0) + (sd[k] < 0.6 ? 0.4 : 0);
        if (sc < score) { score = sc; best = [cx(k), cz(k)]; }
      }
    }
    if (!best) {
      const k = nearestWater(s.x, s.z, 0.3);
      best = [cx(k), cz(k)];
    }
    return best;
  }

  const W = (lon, lat) => lonLatToWorld(lon, lat);
  const stops = VOYAGE.map((v) => mooring(v));
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push(route([stops[i], stops[i + 1]]));
  const iolcos = byId.iolcos;
  return {
    stops,
    legs,
    argo: route([[iolcos.x, iolcos.z + 1.2], W(25.9, 40.0), W(27.9, 40.72), W(29.14, 41.6), W(30.75, 42.0)]),
    theseus: route([W(25.16, 35.5), W(24.3, 36.9), W(23.62, 37.82)]),
    lanes: [
      [W(28.3, 36.55), W(25.9, 36.9), W(23.7, 37.8)],
      [W(15.35, 37.0), W(19.5, 37.4), W(21.4, 38.15)],
      [W(21.9, 33.0), W(24.4, 34.8), W(24.9, 34.9)],
      [W(14.2, 40.75), W(15.2, 39.2), W(15.75, 38.5)],
      [W(26.9, 38.4), W(25.3, 38.6), W(24.0, 39.9)],
      [W(19.9, 39.75), W(18.6, 40.1), W(17.3, 40.4)],
      [W(27.2, 35.9), W(26.2, 35.0), W(25.4, 35.45)],
      [W(22.95, 38.05), W(21.95, 38.3), W(20.95, 38.25)], // the Gulf of Corinth, out to Ithaca
      [W(22.9, 40.4), W(23.6, 39.6), W(24.6, 39.0)], // down the Thermaic Gulf
      [W(26.1, 39.98), W(25.4, 39.8), W(24.45, 40.05)], // Troy, Lemnos, Athos
      [W(25.15, 35.45), W(25.4, 36.3), W(25.45, 36.95)], // Knossos, Thera, Naxos
      [W(27.15, 37.9), W(26.6, 37.6), W(25.4, 37.45)], // Ephesus, Samos, Delos
      [W(15.35, 37.9), W(15.42, 37.1), W(15.2, 36.6)], // the east coast of Sicily
      [W(17.2, 40.35), W(17.35, 39.2)], // across the Gulf of Taras
      [W(21.55, 36.95), W(20.7, 37.7), W(20.5, 38.5)], // Pylos to Leucas
    ].map((pts) => { try { return route(pts); } catch { return null; } }).filter(Boolean),
  };
}
