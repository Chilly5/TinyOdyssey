// Sea routes. Ships never cross land: each route is found with A* over the
// water hexes (keeping off the coast where it can), pulled straight where there
// is open water, and rounded at the corners.

import { hexCenterX, hexCenterZ, worldToHex, neighborOffsets } from './config.js';

export function createNav(grid) {
  const { cols, rows, land, coast } = grid;
  const N = cols * rows;
  const cx = (i) => hexCenterX(i % cols, (i / cols) | 0);
  const cz = (i) => hexCenterZ((i / cols) | 0);

  // Closest water hex to a world position.
  function nearestWater(x, z) {
    const [c0, r0] = worldToHex(x, z);
    let best = -1, bd = Infinity;
    for (let rad = 0; rad < 16; rad++) {
      for (let r = r0 - rad; r <= r0 + rad; r++) {
        for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const i = r * cols + c;
          if (land[i]) continue;
          const d = Math.hypot(hexCenterX(c, r) - x, hexCenterZ(r) - z);
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0 && rad > bd + 1) break;
    }
    return best;
  }

  function astar(start, goal) {
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap = []; // [f, index] pairs kept as a binary heap
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
    const gx = cx(goal), gz = cz(goal);
    g[start] = 0;
    push(0, start);
    while (heap.length) {
      const [, i] = pop();
      if (i === goal) break;
      if (done[i]) continue;
      done[i] = 1;
      const c = i % cols, r = (i / cols) | 0;
      const nb = neighborOffsets(r);
      for (let k = 0; k < 6; k++) {
        const nc = c + nb[k][0], nr = r + nb[k][1];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (land[j] || done[j]) continue;
        const shy = coast[j] === 1 ? 3 : coast[j] === 2 ? 1 : coast[j] === 3 ? 0.3 : 0;
        const ng = g[i] + 1 + shy;
        if (ng < g[j]) {
          g[j] = ng;
          came[j] = i;
          push(ng + Math.hypot(cx(j) - gx, cz(j) - gz), j);
        }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    const path = [];
    for (let i = goal; i >= 0; i = came[i]) path.push(i);
    return path.reverse();
  }

  // Build a route through the given world points [[x, z], ...].
  function route(points) {
    let hexes = [];
    for (let k = 0; k < points.length - 1; k++) {
      const a = nearestWater(...points[k]), b = nearestWater(...points[k + 1]);
      const leg = astar(a, b) || [a, b];
      hexes = hexes.concat(k ? leg.slice(1) : leg);
    }
    let pts = hexes.map((i) => [cx(i), cz(i)]);
    const A = pts[0], B = pts[pts.length - 1];

    // Open water between two points? Near the ends the ship may hug the shore.
    const open = (p, q) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const steps = Math.ceil(d / 0.35);
      for (let s = 0; s <= steps; s++) {
        const x = p[0] + ((q[0] - p[0]) * s) / steps, z = p[1] + ((q[1] - p[1]) * s) / steps;
        const [c, r] = worldToHex(x, z);
        if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
        const i = r * cols + c;
        if (land[i]) return false;
        const nearEnd = Math.hypot(x - A[0], z - A[1]) < 3 || Math.hypot(x - B[0], z - B[1]) < 3;
        if (coast[i] < 2 && !nearEnd) return false;
      }
      return true;
    };
    // String pulling.
    const pulled = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 60);
      while (j > i + 1 && !open(pts[i], pts[j])) j--;
      pulled.push(pts[j]);
      i = j;
    }
    // Round the corners.
    pts = [pulled[0]];
    for (let k = 1; k < pulled.length - 1; k++) {
      const p = pulled[k - 1], v = pulled[k], q = pulled[k + 1];
      const l0 = Math.hypot(v[0] - p[0], v[1] - p[1]), l1 = Math.hypot(q[0] - v[0], q[1] - v[1]);
      const d = Math.min(1.1, l0 * 0.4, l1 * 0.4);
      const a = [v[0] + ((p[0] - v[0]) / l0) * d, v[1] + ((p[1] - v[1]) / l0) * d];
      const b = [v[0] + ((q[0] - v[0]) / l1) * d, v[1] + ((q[1] - v[1]) / l1) * d];
      for (let s = 0; s <= 4; s++) {
        const u = s / 4, w = 1 - u;
        pts.push([w * w * a[0] + 2 * w * u * v[0] + u * u * b[0], w * w * a[1] + 2 * w * u * v[1] + u * u * b[1]]);
      }
    }
    pts.push(pulled[pulled.length - 1]);

    const len = [0];
    for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const total = len[len.length - 1];
    let cursor = 0;
    return {
      pts, total,
      // Position and heading at a distance along the route.
      at(dist, out = {}) {
        const d = Math.max(0, Math.min(total, dist));
        if (len[cursor] > d) cursor = 0;
        while (cursor < len.length - 2 && len[cursor + 1] < d) cursor++;
        const a = pts[cursor], b = pts[cursor + 1] || a;
        const seg = len[cursor + 1] - len[cursor] || 1;
        const u = (d - len[cursor]) / seg;
        out.x = a[0] + (b[0] - a[0]) * u;
        out.z = a[1] + (b[1] - a[1]) * u;
        out.dx = (b[0] - a[0]) / seg;
        out.dz = (b[1] - a[1]) / seg;
        return out;
      },
    };
  }

  return { route, nearestWater, center: (i) => [cx(i), cz(i)] };
}
