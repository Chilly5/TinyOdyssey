// The little people. Travellers and carts on the roads, townsfolk in the
// streets, shepherds and their flocks, farmers at work, fishing boats, the
// watch on the walls, and a few creatures out of the stories. Every one of them
// follows a path laid out when the world was built (gen/life.mjs) and is drawn
// from the unit sheets modelled in Blender (units/build.py). A kind that is kept
// as a sprite stack (units/stack.py: the hoplites) is drawn from that instead,
// and so faces whichever way it is going and not the nearest of eight.

import { mulberry32 } from './util.js';

// How each kind moves: map pixels a second, and how fast its legs (or oars) go.
const KIND = {
  man: [3.2, 1.3], man2: [3.0, 1.3], woman: [2.7, 1.3], woman2: [2.7, 1.3], boy: [4.2, 1.9], girl: [3.6, 1.9], elder: [1.5, 1.4], elder_woman: [1.6, 1.4], farmer: [2.8, 1.3], shepherd: [1.5, 1.3],
  hoplite: [3.0, 1.3], archer: [3.2, 1.3], priest: [2.2, 1.2], merchant: [2.6, 1.3], runner: [7.5, 0.9], bard: [1.6, 1.3],
  heracles: [3.4, 1.0], satyr: [2.4, 1.6], cyclops: [3.0, 0.5], talos: [4.2, 0.36], dancer: [1.3, 0], harpy: [9, 0],
  sheep: [1.3, 1.6], goat: [1.5, 1.6], ox: [1.3, 1.0], bull: [1.5, 1.0], horse: [5.5, 0.6], horse_white: [5.5, 0.6],
  donkey: [2.6, 1.2], deer: [3.2, 0.9], boar: [2.2, 1.2], wolf: [4.0, 0.9], lion: [2.6, 0.8], rider: [7.0, 0.55],
  centaur: [6.0, 0.6], oxcart: [2.0, 0.7], chariot: [9.5, 0.4], griffin: [8, 0], pegasus: [9, 0], eagle: [10, 0],
  skiff: [1.4, 0], skiff2: [1.2, 0], farmer_work: [0.5, 0],
};

const HOMEBODY = new Set(['man', 'man2', 'woman', 'woman2', 'boy', 'girl', 'elder', 'elder_woman', 'farmer', 'farmer_work', 'priest', 'merchant', 'runner', 'bard', 'rider', 'oxcart', 'chariot', 'shepherd', 'donkey', 'dancer']);

// A path as it comes from the builder: for each point x and y in image pixels and the height of the
// ground there (which with y says how far south the point is, and so what stands in front of it).
function makePath(src) {
  const n = src.length / 3;
  const flat = new Float32Array(n * 2), high = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    flat[i * 2] = src[i * 3];
    flat[i * 2 + 1] = src[i * 3 + 1];
    high[i] = src[i * 3 + 2];
  }
  const acc = new Float32Array(n);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    if (i) acc[i] = acc[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
    x0 = Math.min(x0, flat[i * 2]); x1 = Math.max(x1, flat[i * 2]);
    y0 = Math.min(y0, flat[i * 2 + 1]); y1 = Math.max(y1, flat[i * 2 + 1]);
  }
  return { flat, acc, high, n, total: acc[n - 1] || 1, box: [x0, y0, x1, y1] };
}

// figures: kind -> its sprite stack (viewer.addStack), for the kinds that have one.
export function createLife(viewer, M, data, calm, figures = {}) {
  const U = M.units.units;
  const KZ = M.kz;
  const rnd = mulberry32(1207);
  const movers = [];
  const named = []; // the ones with a name to follow: { id, name, tier, kind, target }

  // One thing on a path. side: pixels to the left of the way; gap: how far behind the leader.
  const add = (path, kind, o = {}) => {
    if (!U[kind] || !path || path.total < 2) return null;
    const k = KIND[kind] || [3, 1.3];
    const m = {
      path, kind, u: U[kind], speed: (o.speed || k[0]) * (0.85 + rnd() * 0.3), step: k[1],
      phase: o.phase ?? rnd() * path.total * 2, loop: !!o.loop, side: o.side ?? (rnd() - 0.5) * 2.4, gap: o.gap || 0,
      idle: o.idle || 0, air: o.air || 0, x: 0, y: 0, z: -1, k: 0, f: 0,
      // For one kept as a sprite stack: the stack, which way it faces (radians: 0 east, then clockwise as the
      // map lies), which moment of its stride it is at, and the picture the viewer found for that.
      fig: figures[kind] || null, turn: 0, ff: 0, at: -1, troop: null,
      // For whoever asks about them (people.js): a number, and where their path lies and with whom.
      id: movers.length, ctx: o.ctx || null, who: null,
      // Most people go indoors at night; a few stay out, and so do the animals, the boats and the monsters.
      home: HOMEBODY.has(kind) && rnd() < 0.72,
    };
    movers.push(m);
    return m;
  };
  const follow = (leader, kind, gap, side = 0, role = 'with') => {
    const m = add(leader.path, kind, { phase: leader.phase, loop: leader.loop, side: leader.side + side, gap, idle: leader.idle, air: leader.air, ctx: { ...leader.ctx, role, lead: leader } });
    if (m) m.speed = leader.speed;
    return m;
  };
  const pick = (table) => { // [kind, weight, kind, weight, ...]
    let total = 0;
    for (let i = 1; i < table.length; i += 2) total += table[i];
    let v = rnd() * total;
    for (let i = 0; i < table.length; i += 2) {
      v -= table[i + 1];
      if (v <= 0) return table[i];
    }
    return table[0];
  };

  // --- The roads ---
  const roadPaths = data.roads.map((r) => ({ ...r, path: makePath(r.pts) }));
  for (const r of roadPaths) {
    const n = Math.max(1, Math.min(16, Math.round((r.path.total / 130) * (r.main ? 1.5 : 1))));
    for (let i = 0; i < n; i++) {
      const kind = pick(['man2', 22, 'merchant', 12, 'oxcart', 11, 'woman', 7, 'farmer', 10, 'rider', r.main ? 10 : 3, 'hoplite', 8, 'priest', 3, 'runner', 3, 'bard', 2, 'shepherd', 5, 'chariot', r.main ? 2 : 0]);
      const lead = add(r.path, kind, { ctx: { where: 'road', from: r.from, to: r.to } });
      if (!lead) continue;
      if (kind === 'merchant') follow(lead, 'donkey', 4.5, 0, 'pack');
      else if (kind === 'hoplite') { follow(lead, 'hoplite', 3.4, 0, 'file'); follow(lead, 'hoplite', 6.8, 0, 'file'); if (rnd() < 0.5) follow(lead, 'hoplite', 10.2, 0, 'file'); }
      else if (kind === 'shepherd') { for (let k = 0; k < 4; k++) follow(lead, rnd() < 0.7 ? 'sheep' : 'goat', -3 - k * 2.6, (rnd() - 0.5) * 3, 'flock'); }
      else if (kind === 'man2' && rnd() < 0.3) follow(lead, 'woman2', 3.2, 1.4, 'spouse');
    }
  }
  // Heracles is always on his way to the next labour; Talos walks his rounds of Crete.
  const wanderer = (id, name, kind, wants) => {
    const r = roadPaths.filter((q) => wants.includes(q.from) || wants.includes(q.to)).sort((a, b) => b.path.total - a.path.total)[0];
    const m = r && add(r.path, kind, { side: 0, ctx: { where: 'road', from: r.from, to: r.to } });
    if (m) named.push({ id, name, kind: 'ship', tier: 3, target: m, dy: 4 });
  };
  wanderer('heracles', 'Heracles', 'heracles', ['nemea', 'lerna', 'stymphalia', 'erymanthos']);
  wanderer('talos', 'Talos', 'talos', ['knossos', 'ida', 'dikte', 'gortyn']);

  // --- The towns ---
  for (const t of data.towns) {
    for (const st of t.streets) {
      const p = makePath(st);
      const n = Math.max(1, Math.min(4, Math.round(p.total / 30)));
      for (let i = 0; i < n; i++) add(p, pick(['man', 22, 'woman', 18, 'woman2', 12, 'boy', 9, 'girl', 8, 'elder', 7, 'elder_woman', 6, 'man2', 8, 'merchant', 8, 'priest', 5, 'farmer', 8, 'hoplite', 5, 'bard', 2, 'donkey', 4]), { side: (rnd() - 0.5) * 1.6, ctx: { where: 'street', town: t.id } });
    }
    for (const loop of t.market || []) {
      const p = makePath(loop);
      add(p, pick(['man', 3, 'woman', 3, 'woman2', 2, 'merchant', 2, 'elder_woman', 1, 'boy', 1]), { loop: true, speed: 1.2 + rnd(), idle: 0.7, ctx: { where: 'market', town: t.id } });
      if (rnd() < 0.6) add(p, pick(['man', 3, 'woman', 3, 'priest', 1]), { loop: true, speed: 1.2 + rnd(), idle: 0.7, ctx: { where: 'market', town: t.id } });
    }
    if (t.wall) {
      const p = makePath(t.wall);
      for (let i = 0; i < 3; i++) {
        const lead = add(p, 'hoplite', { loop: true, phase: (i / 3) * p.total, side: 0, ctx: { where: 'wall', town: t.id } });
        if (lead) follow(lead, 'hoplite', 3.4, 0, 'file');
      }
    }
    for (const fl of t.fields) {
      const p = makePath(fl.pts);
      if (fl.kind === 'ox') {
        const lead = add(p, 'ox', { speed: 1.0, side: 0, ctx: { where: 'field', town: t.id } });
        if (lead) follow(lead, 'farmer', 4.2, 0, 'plough');
      } else add(p, 'farmer_work', { side: 0, idle: 0.5, ctx: { where: 'field', town: t.id } });
    }
    for (const b of t.boats) add(makePath(b), rnd() < 0.5 ? 'skiff' : 'skiff2', { loop: true, side: 0, idle: 0.6, ctx: { where: 'boat', town: t.id } });
  }

  // --- Herds, and the creatures that keep to their own country ---
  for (const h of data.herds) {
    const p = makePath(h.pts);
    const lead = add(p, h.kind, { loop: true, idle: 0.75, side: 0, ctx: { where: 'herd', n: h.n, keeper: h.keeper } });
    if (!lead) continue;
    for (let i = 1; i < h.n; i++) follow(lead, h.kind, (rnd() - 0.2) * 14, (rnd() - 0.5) * 12, 'herd');
    if (h.keeper) follow(lead, 'shepherd', 9, (rnd() - 0.5) * 8, 'keeper');
  }
  for (const c of data.myths) {
    const p = makePath(c.pts);
    const spread = c.kind === 'dancer' ? p.total / c.n : c.kind === 'hoplite' ? 3.4 : c.kind === 'chariot' ? p.total / c.n : 7;
    let lead = null;
    for (let i = 0; i < c.n; i++) {
      // A line is run there and back, abreast (the runners at Olympia); the rest go round a loop.
      if (!lead) lead = add(p, c.kind, { ctx: { where: 'myth', name: c.name }, loop: !c.line, side: c.line ? -(c.n - 1) * 1.3 : 0, air: c.air, idle: c.line || c.air || c.kind === 'chariot' || c.kind === 'hoplite' || c.kind === 'dancer' ? 0 : 0.5 });
      else if (c.line) follow(lead, c.kind, (i % 2) * 0.8, i * 2.6, 'band');
      else follow(lead, c.kind, i * spread, c.kind === 'dancer' || c.kind === 'hoplite' || c.kind === 'chariot' ? 0 : (rnd() - 0.5) * 9, 'band');
    }
    if (lead && c.name) named.push({ id: c.kind, name: c.name, kind: 'monsters', tier: 3, target: lead, dy: 4 });
  }
  for (const f of data.fishers) add(makePath(f), rnd() < 0.5 ? 'skiff' : 'skiff2', { loop: true, side: 0, idle: 0.6, ctx: { where: 'sea' } });

  // --- A company on the march ---
  // Hoplites in close order, going down a road and back as one body. At each end they halt, every man turns
  // about where he stands, and the rear rank leads the way home: nobody walks back through his own company.
  // (Made last, so that everyone made before it is who they were before it existed.)
  const RANK = 3.5, FILE = 3.2; // map pixels from one rank to the next, and from one file to the next
  // keep: how far short of each end of the road they turn, to stay out on the open ground between the towns.
  const company = (id, name, from, to, files, ranks, keep) => {
    const r = roadPaths.find((q) => q.from === from && q.to === to);
    const len = (ranks - 1) * RANK;
    if (!r || r.path.total < len + keep[0] + keep[1] + 20) return;
    const troop = { lo: keep[0] + len, hi: r.path.total - keep[1], halt: 6.5, speed: 2.5 };
    let lead = null;
    for (let i = 0; i < ranks; i++) {
      for (let j = 0; j < files; j++) {
        const m = add(r.path, 'hoplite', { phase: 0, side: (j - (files - 1) / 2) * FILE, gap: i * RANK, ctx: { where: 'company', town: r.from, from: r.from, to: r.to, rank: i, ranks, file: j, files, n: files * ranks, lead: i || j ? lead : null } });
        if (!m) return;
        m.troop = troop;
        m.speed = troop.speed;
        lead = lead || m;
      }
    }
    named.push({ id, name, kind: 'ship', tier: 3, target: lead, dy: 4 });
  };
  // Fifty of them on the plain outside Ismarus, where Odysseus's men stayed too long and the Cicones mustered.
  company('phalanx', 'The phalanx', 'ismarus', 'abdera', 5, 10, [64, 132]);

  // The point d along a path, into `out` (x, y, and the height of the ground there).
  const pt = { x: 0, y: 0, h: 0 }, pa = { x: 0, y: 0, h: 0 }, pb = { x: 0, y: 0, h: 0 };
  const along = (p, d, out) => {
    let lo = 0, hi = p.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p.acc[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = p.flat, u = Math.max(0, Math.min(1, (d - p.acc[lo]) / (p.acc[hi] - p.acc[lo] || 1)));
    out.x = f[lo * 2] + (f[hi * 2] - f[lo * 2]) * u;
    out.y = f[lo * 2 + 1] + (f[hi * 2 + 1] - f[lo * 2 + 1]) * u;
    out.h = p.high[lo] + (p.high[hi] - p.high[lo]) * u;
    return out;
  };
  const ease = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
  const WAY = 1.8;   // a figure faces along this much of its path either side of it, so that it turns a corner and does not snap round it
  const ABOUT = 1.1; // and turns about over this much of the path at the end of one walked there and back

  // Where a mover is now. Loops go round; other paths are walked there and back.
  const place = (m, t) => {
    const p = m.path;
    let d, dir = 1, about = 0, going = true, walked;
    if (m.troop) {
      // Out; halt, and about turn; back; halt, and about turn.
      const T = m.troop, leg = (T.hi - T.lo) / T.speed, cyc = 2 * (leg + T.halt);
      let u = ((t % cyc) + cyc) % cyc;
      if (u >= leg + T.halt) { u -= leg + T.halt; dir = -1; }
      const D = u < leg ? (dir > 0 ? T.lo + u * T.speed : T.hi - u * T.speed) : dir > 0 ? T.hi : T.lo;
      if (u >= leg) {
        going = false;
        about = ease((u - leg - T.halt * 0.22) / (T.halt * 0.4)) * Math.PI;
      }
      walked = D;
      d = D - m.gap;
    } else {
      d = m.phase + m.speed * t;
      if (m.idle) d += Math.sin(t * 0.21 + m.phase) * m.idle * 9 + Math.sin(t * 0.083 + m.phase * 0.7) * m.idle * 14; // stop and go
      d -= m.gap;
      if (m.loop) d = ((d % p.total) + p.total) % p.total;
      else {
        d = ((d % (2 * p.total)) + 2 * p.total) % (2 * p.total);
        if (d > p.total) { d = 2 * p.total - d; dir = -1; }
      }
      walked = d + m.gap;
    }
    along(p, d, pt);
    let dx, dy; // the way it is going: a step of one map pixel
    if (m.fig || m.troop) {
      // Taken across a little of the path, which also keeps the files of a company from jumping at each bend of the road.
      const wrap = (v) => (m.loop ? ((v % p.total) + p.total) % p.total : Math.max(0, Math.min(p.total, v)));
      along(p, wrap(d - WAY), pa);
      along(p, wrap(d + WAY), pb);
      const l = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      dx = ((pb.x - pa.x) / l) * dir;
      dy = ((pb.y - pa.y) / l) * dir;
      if (!m.troop && !m.loop) { // coming to the end of its path it wheels half way round, and the rest of the way as it sets off again
        const end = Math.min(d, p.total - d);
        if (end < ABOUT) about = (1 - end / ABOUT) * (Math.PI / 2) * ((d < p.total / 2) === (dir < 0) ? 1 : -1);
      }
    } else {
      let lo = 0, hi = p.n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (p.acc[mid] <= d) lo = mid;
        else hi = mid;
      }
      const f = p.flat, seg = p.acc[hi] - p.acc[lo] || 1;
      dx = ((f[hi * 2] - f[lo * 2]) / seg) * dir;
      dy = ((f[hi * 2 + 1] - f[lo * 2 + 1]) / seg) * dir;
    }
    m.x = pt.x - dy * m.side * dir;
    m.y = pt.y + dx * m.side * dir * KZ;
    // How far south it stands, for the viewer to hide it behind whatever is nearer. Fliers are never hidden.
    m.z = m.air ? -1 : viewer.depthOf(m.y, pt.h);
    const heads = m.u.heads;
    m.turn = Math.atan2(dy / KZ, dx) + about;
    m.k = ((Math.round((m.turn / (Math.PI * 2)) * heads) % heads) + heads) % heads;
    const still = calm || !going;
    m.f = m.step && !still ? Math.floor(Math.abs(walked) * m.step) % m.u.frames : still ? 0 : Math.floor(t * 5 + m.phase) % m.u.frames;
    // A stack has more moments to its stride than a sheet has frames: the same pace, cut finer.
    if (m.fig) m.ff = still ? 0 : Math.floor(Math.abs(walked) * m.step * (m.fig.frames / m.u.frames)) % m.fig.frames;
  };

  const seen = [];
  let now = 0;
  let watched = null; // the one the visitor is following, kept placed every frame like the named ones
  const height = (m) => (m.u.sets[0].at[0][3] / m.u.sets[0].q) * 0.8; // roughly how tall it stands on the picture
  return {
    named,
    count: movers.length,
    update(t) {
      now = t;
      for (const n of named) place(n.target, t); // so their labels and the camera can follow them
      if (watched) place(watched, t);
    },
    // Whoever is nearest a point of the picture, within r map pixels of the middle of their body.
    pick(x, y, r) {
      const abed = viewer.night > 0.97;
      let best = null, bd = r;
      for (const m of movers) {
        if (abed && m.home) continue;
        const bx = m.path.box;
        if (bx[2] + 40 < x || bx[0] - 40 > x || bx[3] + 40 < y || bx[1] - 60 - m.air > y) continue;
        place(m, now);
        const d = Math.hypot(m.x - x, m.y - m.air - height(m) * 0.5 - y);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    watch(m) { watched = m; },
    height,
    // How many people are about in a stretch of the picture (for the sound of them), counted from what was last drawn.
    crowd: 0,
    // layer 0: everything on the ground and the water. layer 1: whatever flies.
    draw(d, b, layer) {
      const zd = viewer.zoom * viewer.dpr;
      const alpha = Math.min(1, (zd - 0.42) / 0.3);
      if (alpha <= 0) return;
      seen.length = 0;
      const mx = 30, my = 40;
      const abed = viewer.night > 0.97; // the streets are empty by now
      for (const m of movers) {
        if ((m.air > 0) !== (layer === 1) || (abed && m.home)) continue;
        const bx = m.path.box;
        if (bx[2] + mx < b[0] || bx[0] - mx > b[2] || bx[3] + my < b[1] || bx[1] - my - m.air > b[3]) continue;
        place(m, now);
        if (m.x < b[0] - mx || m.x > b[2] + mx || m.y < b[1] - my || m.y - m.air > b[3] + my) continue;
        seen.push(m);
      }
      if (layer === 0) this.crowd = seen.length;
      if (!seen.length) return;
      seen.sort((p, q) => p.y - q.y);
      // Those kept as sprite stacks: the viewer finds (or makes) the picture of each as it now stands.
      let stacked = 0;
      for (const m of seen) {
        m.at = m.fig ? d.pose(m.fig, m.ff, m.turn) : -1;
        if (m.at >= 0) stacked++;
      }
      if (zd > 1.1) {
        for (const m of seen) {
          if (m.at >= 0) continue; // these throw a shadow of their own shape
          const r = m.u.sets[0].at[0][3] / m.u.sets[0].q * 0.42;
          d.blob(m.x + m.air * 0.45, m.y + 0.2, r, r * 0.45, (m.air ? 0.18 : 0.26) * alpha * (m.home ? 1 - viewer.night : 1), m.air ? -1 : m.z + 1.5);
        }
        // Thrown to the south-east as the map's own shadows are, and laid together: men in close order shade one patch of ground once.
        const dark = 0.36 * alpha * (1 - viewer.night); // as dark as a tree's shadow on the map
        if (stacked && dark > 0.01) d.shade(() => { for (const m of seen) if (m.at >= 0) d.cast(m.fig, m.at, m.x, m.y, m.z, dark); });
      }
      for (const m of seen) {
        const a = m.home ? alpha * (1 - viewer.night) : alpha; // going indoors as the light goes
        if (a <= 0.02) continue;
        if (m.at >= 0) { d.figure(m.fig, m.at, m.x, m.y - m.air, m.z, a); continue; }
        const sets = m.u.sets;
        // The set drawn for about this zoom; in the pixel look, the one whose pixels are the size of the map's.
        const need = viewer.pixel > 1 ? 0.99 / viewer.texel : zd * 0.85;
        let set = sets[0];
        for (let i = sets.length - 1; i > 0; i--) if (sets[i].q >= need) { set = sets[i]; break; }
        d.frame(set.at[m.f * m.u.heads + m.k], set.q, m.x, m.y - m.air, a, m.z);
      }
      d.use(0);
    },
  };
}
