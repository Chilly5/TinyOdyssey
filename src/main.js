import { createView, PITCH } from './view.js';
import { buildGrid } from './grid.js';
import { buildTerrain } from './terrain.js';
import { buildWater } from './water.js';
import { buildLandmarks } from './landmarks.js';
import { createFX } from './fx.js';
import { createNav } from './nav.js';
import { createActors } from './actors.js';
import { createLabels } from './labels.js';
import { SITES, KINDS, VOYAGE } from './sites.js';
import { lonLatToWorld, WORLD_W, WORLD_D, LANDMARK_SCALE } from './config.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = window.matchMedia('(max-width: 720px)');

// Let the loading screen paint before the world is built.
requestAnimationFrame(() => setTimeout(() => {
  try {
    boot();
  } catch (err) {
    console.error(err);
    $('loading').lastElementChild.textContent = 'This map needs WebGL, and it could not start here. Try another browser.';
    $('loading').querySelector('.bar').remove();
  }
}, 30));

function boot() {
  const view = createView(canvas);
  view.resize();

  const siteById = {};
  for (const s of SITES) siteById[s.id] = s;
  const grid = buildGrid(SITES);
  const terrain = buildTerrain(grid, view.uniforms);
  const water = buildWater(grid, view.uniforms);
  const fx = createFX(view);
  const landmarks = buildLandmarks(grid, SITES, fx, view.scene);
  view.scene.add(terrain.group, water.group, landmarks.mesh);
  const nav = createNav(grid);
  const actors = createActors({ view, grid, fx, nav, siteById });
  const voyage = actors.voyage;

  // ---------------------------------------------------------------- camera --
  const [homeX, homeZ] = lonLatToWorld(23.3, 37.9);
  const goal = { x: homeX, z: homeZ, ppu: 5.6, rate: 1.3 };
  if (calm) {
    view.x = goal.x; view.z = goal.z; view.ppu = goal.ppu;
  } else {
    view.x = WORLD_W * 0.52; view.z = WORLD_D * 0.5; view.ppu = view.minPpu * 1.05;
  }
  const flyTo = (x, z, ppu, rate = 3.2) => {
    goal.x = clamp(x, 0, WORLD_W);
    goal.z = clamp(z, 0, WORLD_D);
    if (ppu) goal.ppu = clamp(ppu, view.minPpu, view.maxPpu);
    goal.rate = calm ? 60 : rate;
  };
  // World distance that shifts a point up the screen by half the height of whatever covers the bottom.
  const liftFor = (px, ppu) => px / 2 / (ppu * view.artPx * Math.sin(PITCH));

  // ----------------------------------------------------------------- labels --
  const labels = createLabels($('labels'), view, (id) => (siteById[id] ? select(id) : follow(id)));
  for (const s of SITES) {
    labels.add({ id: s.id, name: s.name, kind: s.kind, tier: s.tier, target: s, reach: s.sea ? 1.6 : (s.flat || 0.3) * LANDMARK_SCALE * 0.8 + 0.2, dy: 3 });
  }
  const roaming = {};
  for (const l of actors.labels) roaming[l.id] = labels.add(l);
  labels.sort();
  labels.measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => labels.measure());

  // ------------------------------------------------------------- side panel --
  const side = $('side');
  const sheets = { card: $('card'), atlas: $('atlas'), about: $('about') };
  let selected = null;
  function openSheet(name) {
    for (const k of Object.keys(sheets)) sheets[k].hidden = k !== name;
    side.hidden = !name;
    $('btnAtlas').setAttribute('aria-pressed', String(name === 'atlas'));
    $('btnAbout').setAttribute('aria-pressed', String(name === 'about'));
    if (name !== 'card' && selected) {
      selected = null;
      labels.select(null);
      setHash('');
    }
  }
  side.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) openSheet(null);
  });
  $('btnAtlas').addEventListener('click', () => openSheet(sheets.atlas.hidden ? 'atlas' : null));
  $('btnAbout').addEventListener('click', () => openSheet(sheets.about.hidden ? 'about' : null));

  const atlasBody = $('atlasBody');
  for (const [kind, info] of Object.entries(KINDS)) {
    const h = document.createElement('h3');
    h.innerHTML = `<i class="pip" data-kind="${kind}"></i>`;
    h.append(info.label);
    const ul = document.createElement('ul');
    for (const s of SITES.filter((x) => x.kind === kind)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.name;
      b.addEventListener('click', () => select(s.id));
      li.append(b);
      ul.append(li);
    }
    atlasBody.append(h, ul);
  }

  function setHash(id) {
    try {
      if ((location.hash || '#').slice(1) !== id) location.hash = id;
    } catch { /* some embeds forbid it; the map works without */ }
  }

  function select(id, opts = {}) {
    const s = siteById[id];
    if (!s) return;
    selected = id;
    labels.select(id);
    $('cardKind').dataset.kind = s.kind;
    $('cardKind').lastElementChild.textContent = KINDS[s.kind].label;
    $('cardName').textContent = s.name;
    $('cardGreek').textContent = s.greek || '';
    $('cardText').textContent = s.text;
    const actions = $('cardActions');
    actions.replaceChildren();
    const stop = VOYAGE.findIndex((v) => v.site === id && !v.near);
    if (stop >= 0 && !document.body.classList.contains('voyaging')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn go';
      b.textContent = stop === 0 ? 'Begin the voyage here' : 'Join the voyage here';
      b.addEventListener('click', () => startVoyage(stop));
      actions.append(b);
    }
    actions.hidden = !actions.childElementCount;
    openSheet('card');
    selected = id;
    labels.select(id);
    setHash(id);
    if (!opts.still) {
      const ppu = clamp(Math.max(goal.ppu, 10), view.minPpu, view.maxPpu);
      const cover = narrow.matches ? side.offsetHeight : 0;
      flyTo(s.x, s.z + liftFor(cover, ppu) - (s.y || 0) * 0.5, ppu);
    }
  }

  // Follow one of the roaming names (a ship, Pegasus) for a moment.
  let following = null;
  function follow(id) {
    following = roaming[id] ? { item: roaming[id], until: clock + 14 } : null;
    if (following) goal.ppu = clamp(Math.max(goal.ppu, 9), view.minPpu, view.maxPpu);
  }

  // ----------------------------------------------------------------- voyage --
  const vEl = $('voyage');
  const dots = $('vDots');
  VOYAGE.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = v.title;
    b.setAttribute('aria-label', `Stop ${i + 1}: ${v.title}`);
    b.addEventListener('click', () => showStop(i));
    dots.append(b);
  });
  dots.hidden = false;
  function showStop(i) {
    i = clamp(i, 0, VOYAGE.length - 1);
    voyage.goTo(i);
    voyage.showTrail(i);
    const v = VOYAGE[i];
    $('vStep').textContent = `The Odyssey · ${i + 1} of ${VOYAGE.length} · ${v.book}`;
    $('vTitle').textContent = v.title;
    $('vText').textContent = v.text;
    $('vPrev').disabled = i === 0;
    $('vNext').disabled = i === VOYAGE.length - 1;
    [...dots.children].forEach((d, k) => {
      d.classList.toggle('done', k < i);
      if (k === i) d.setAttribute('aria-current', 'step');
      else d.removeAttribute('aria-current');
    });
  }
  function startVoyage(i = 0) {
    document.body.classList.add('voyaging');
    vEl.hidden = false;
    openSheet(null);
    following = null;
    voyage.goTo(i, true);
    showStop(i);
    setHash('odyssey');
    $('btnVoyage').hidden = true;
  }
  function leaveVoyage() {
    document.body.classList.remove('voyaging');
    vEl.hidden = true;
    voyage.release();
    $('btnVoyage').hidden = false;
    setHash('');
  }
  $('btnVoyage').addEventListener('click', () => startVoyage(0));
  $('vLeave').addEventListener('click', leaveVoyage);
  $('vPrev').addEventListener('click', () => showStop(voyage.stop - 1));
  $('vNext').addEventListener('click', () => showStop(voyage.stop + 1));

  // ------------------------------------------------------------------ input --
  const pointers = new Map();
  let pinch = null;
  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ppu: goal.ppu };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (press) press.moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 1) {
      if (press && press.moved < 4) return;
      canvas.classList.add('dragging');
      following = null;
      const s = view.ppu * view.artPx;
      view.x = goal.x = clamp(view.x - dx / s, 0, WORLD_W);
      view.z = goal.z = clamp(view.z - dy / (s * Math.sin(PITCH)), 0, WORLD_D);
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      goal.ppu = clamp((pinch.ppu * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, view.minPpu, view.maxPpu);
      goal.rate = 12;
    }
  });
  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.classList.remove('dragging');
    if (press && e.type === 'pointerup' && press.moved < 6 && performance.now() - press.t < 500) tap(e.clientX, e.clientY);
    press = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // A tap on the map picks the nearest landmark, or clears the selection.
  const pp = {};
  function tap(x, y) {
    const rect = canvas.getBoundingClientRect();
    let best = null, bd = 34;
    for (const s of SITES) {
      view.project(s.x, (s.y || 0) + 0.4, s.z, pp);
      const d = Math.hypot(pp.x - (x - rect.left), pp.y - (y - rect.top));
      if (d < bd) { bd = d; best = s; }
    }
    if (best) select(best.id);
    else if (!sheets.card.hidden) openSheet(null);
  }

  function zoomBy(k, sx = view.cssW / 2, sy = view.cssH / 2) {
    const at = view.unproject(sx, sy);
    const next = clamp(goal.ppu * k, view.minPpu, view.maxPpu);
    const f = 1 - goal.ppu / next;
    goal.x = clamp(goal.x + (at.x - goal.x) * f, 0, WORLD_W);
    goal.z = clamp(goal.z + (at.z - goal.z) * f, 0, WORLD_D);
    goal.ppu = next;
    goal.rate = 10;
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    zoomBy(Math.exp(-clamp(dy, -240, 240) * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  $('zoomIn').addEventListener('click', () => zoomBy(1.5));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.5));

  const held = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const voyaging = document.body.classList.contains('voyaging');
    if (e.key === 'Escape') {
      if (!side.hidden) openSheet(null);
      else if (voyaging) leaveVoyage();
    } else if (voyaging && e.key === 'ArrowRight') showStop(voyage.stop + 1);
    else if (voyaging && e.key === 'ArrowLeft') showStop(voyage.stop - 1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.4);
    else if (/^Arrow|^[wasd]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && document.activeElement === document.body) {
      held.add(e.key.toLowerCase());
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('resize', () => {
    view.resize();
    labels.measure();
  });

  function fromHash() {
    const h = (location.hash || '').slice(1);
    if (h === 'odyssey') {
      if (!document.body.classList.contains('voyaging')) startVoyage(0);
    } else if (siteById[h] && h !== selected) select(h);
  }
  window.addEventListener('hashchange', fromHash);

  // ------------------------------------------------------------------- loop --
  let clock = 0;
  let last = performance.now();
  let started = false;
  let slow = 0, frames = 0, level = 0;
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.1); // the first timestamp can predate `last`
    last = now;
    clock += dt;

    if (held.size) {
      const v = (26 / view.ppu) * dt * 6;
      if (held.has('arrowleft') || held.has('a')) goal.x -= v;
      if (held.has('arrowright') || held.has('d')) goal.x += v;
      if (held.has('arrowup') || held.has('w')) goal.z -= v;
      if (held.has('arrowdown') || held.has('s')) goal.z += v;
      goal.x = clamp(goal.x, 0, WORLD_W);
      goal.z = clamp(goal.z, 0, WORLD_D);
      goal.rate = 10;
      following = null;
    }

    fx.update(clock, dt);

    if (document.body.classList.contains('voyaging') && !pointers.size) {
      // Keep the ship in frame; pull in closer once it has arrived.
      const p = voyage.position;
      const stop = voyage.stops[voyage.stop];
      const site = siteById[stop.site];
      const arrived = !voyage.sailing;
      const ppu = clamp(arrived ? 9.5 : 6.8, view.minPpu, view.maxPpu);
      const tx = arrived && !stop.near ? (p.x + site.x) / 2 : p.x;
      const tz = arrived && !stop.near ? (p.z + site.z) / 2 : p.z;
      const cover = side.hidden || !narrow.matches ? vEl.offsetHeight : side.offsetHeight;
      flyTo(tx, tz + liftFor(cover, ppu), ppu, arrived ? 2.2 : 3.5);
    } else if (following) {
      const t = following.item.target;
      flyTo(t.x, t.z - t.y * 0.6, goal.ppu, 4);
      if (clock > following.until) following = null;
    }

    const k = 1 - Math.exp(-dt * goal.rate);
    view.x += (goal.x - view.x) * k;
    view.z += (goal.z - view.z) * k;
    view.ppu *= (goal.ppu / view.ppu) ** k;
    if (Math.abs(goal.ppu - view.ppu) < 0.003) view.ppu = goal.ppu;
    view.clampTarget();
    view.uniforms.uTime.value = clock;
    view.render();
    labels.update();

    if (!started) {
      started = true;
      $('loading').classList.add('gone');
      fromHash();
    }

    // If the machine is struggling, trade shadow quality for frame rate.
    if (clock > 4 && level < 2) {
      frames++;
      if (dt > 0.034) slow++;
      if (frames >= 150) {
        if (slow > 90) {
          level++;
          if (level === 1) {
            view.sun.shadow.mapSize.set(1024, 1024);
            if (view.sun.shadow.map) { view.sun.shadow.map.dispose(); view.sun.shadow.map = null; }
          } else view.sun.castShadow = false;
        }
        frames = slow = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__tiny = { view, grid, goal, voyage, siteById, select, startVoyage, showStop, fx };
}
