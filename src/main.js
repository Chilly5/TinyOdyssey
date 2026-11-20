import { createViewer } from './viewer.js';
import { createActors, buildAtlas } from './actors.js';
import { createLabels } from './labels.js';
import { createLife } from './life.js';
import { createSound } from './sound.js';
import { SITES, KINDS, VOYAGE } from './sites.js';
import { lonLatToWorld } from './config.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = window.matchMedia('(max-width: 720px)');
// ?world=folder/ shows another build of the world (used while a new one is being made).
const asked = new URLSearchParams(location.search).get('world') || '';
const BASE = /^[\w.-]+\/$/.test(asked) ? asked : 'world/';

boot().catch((err) => {
  console.error(err);
  $('loading').lastElementChild.textContent = 'The map could not start here. It needs WebGL2 and has to be opened from a web server.';
  $('loading').querySelector('.bar')?.remove();
});

async function boot() {
  const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest: ${res.status}`);
  const M = await res.json();
  const viewer = createViewer(canvas, M, BASE);
  // ?look=pixel shows the map in hard pixels like the sprites over it, ?look=smooth as it was painted.
  // The world can name its own (manifest.look). P switches between the two.
  const look = new URLSearchParams(location.search).get('look') || M.look || 'smooth';
  // ?style=pixel|voxel|painted picks which of the world's pictures to show; the button and V change it.
  const STYLE_NAMES = { pixel: 'Pixel art', voxel: 'Terraces', painted: 'Painted' };
  let remembered = null;
  try { remembered = localStorage.getItem('tiny.style'); } catch { /* private windows may refuse */ }
  const wantStyle = new URLSearchParams(location.search).get('style') || remembered;
  if (wantStyle && viewer.styles.includes(wantStyle) && wantStyle !== viewer.style) viewer.setStyle(wantStyle);
  else viewer.setPixel(0);
  if (look === 'pixel') viewer.setPixel(2);
  viewer.resize();
  const [sheet] = await Promise.all([viewer.loadBitmap(`${BASE}${M.sprites.file}?v=${M.version}`, true), viewer.prime()]);
  const atlas = buildAtlas(sheet, M.sprites.frames);
  viewer.setAtlas(atlas.canvas, atlas.canvas.width, atlas.canvas.height, atlas.frames);
  const actors = createActors(viewer, M, calm, BASE);
  const voyage = actors.voyage;

  // The units' sheets and the paths everyone walks arrive after the map is up.
  if (M.units) {
    const first = 1 + (M.animPages || []).length;
    viewer.setUnitSheet(first);
    M.units.pages.forEach((pg, i) => {
      viewer.loadBitmap(`${BASE}${pg.file}?v=${M.version}`, true).then((bmp) => viewer.addSheet(bmp, first + i, true)).catch(() => {});
    });
    if (M.life) {
      fetch(`${BASE}${M.life}?v=${M.version}`).then((r) => (r.ok ? r.json() : null)).then((data) => {
        if (!data) return;
        const life = createLife(viewer, M, data, calm);
        actors.setLife(life);
        lightUp(data.lights || []);
        for (const l of life.named) roaming[l.id] = labels.add(l);
        labels.sort();
        labels.measure();
      }).catch(() => {});
    }
  }

  const siteById = {};
  for (const s of SITES) siteById[s.id] = s;
  const place = {}; // id -> where the site is in the image
  for (const s of M.sites) place[s.id] = s;

  // ------------------------------------------------------------ day and night --
  // A day lasts five minutes: a long morning and afternoon, a short dusk, a night with lamps lit in
  // every town, and a dawn. ?time=day or ?time=night holds it still, and so does the button.
  const DAY = 300;
  const params = new URLSearchParams(location.search);
  const TIMES = ['auto', 'day', 'night'];
  let timeMode = TIMES.includes(params.get('time')) ? params.get('time') : 'auto';
  let hour = 0.14; // the part of the day gone: 0 sunrise, 0.58 sunset begins, 0.68 to 0.9 night
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bump = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w) ** 2;
  let nightNow = timeMode === 'night' ? 1 : 0;
  function keepTime(dt) {
    hour = (hour + dt / DAY) % 1;
    const want = timeMode === 'day' ? 0 : timeMode === 'night' ? 1 : smooth(0.58, 0.68, hour) - smooth(0.9, 0.98, hour);
    nightNow += (want - nightNow) * (1 - Math.exp(-dt * 1.6)); // a held time is eased into, not jumped to
    const warm = timeMode === 'auto' ? bump(hour, 0.605, 0.06) + bump(hour, 0.95, 0.045) : 0;
    viewer.night = nightNow < 0.002 ? 0 : nightNow;
    viewer.tint = [1, 1 - 0.17 * warm, 1 - 0.34 * warm];
  }
  // Lamps: one at every house (from the builder), a fire's glow wherever something burns, and a pool of
  // light at each landmark so that none of them is lost in the dark.
  function lightUp(houses) {
    const L = [];
    for (let i = 0; i < houses.length; i += 3) L.push(houses[i], houses[i + 1], houses[i + 2] === 2 ? 11 : 7.5, 1, 0.74, 0.4, 0);
    for (const e of M.effects) {
      if (e.t === 'flame') L.push(e.x, e.y - e.size * 0.4, 14 + e.size * 5, ...(e.ghost ? [0.3, 0.9, 0.5] : [1, 0.62, 0.26]), 0.22);
      else if (e.t === 'smoke' && e.glow) L.push(e.x, e.y, 16 + e.size * 2, 1, 0.5, 0.2, 0.15);
    }
    for (const q of M.sites) {
      const s = siteById[q.id];
      if (!s || s.hidden) continue;
      const k = s.minor ? 0.34 : 0.46;
      L.push(q.x, q.y - q.top * 0.3, Math.max(22, q.r * (s.minor ? 1.1 : 0.85)), k, k * 0.86, k * 0.62, 0);
    }
    viewer.setLights(new Float32Array(L));
  }
  lightUp([]);

  // ------------------------------------------------------------------- sound --
  const sound = createSound();
  let seaField = null; // the builder's map of how far the shore is, read once the sound is first turned on
  function hearSea() {
    if (seaField) return;
    seaField = { w: 0 };
    viewer.loadBitmap(`${BASE}${M.sea.file}?v=${M.version}`, false).then((bmp) => {
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      c2.drawImage(bmp, 0, 0);
      seaField = { w: bmp.width, h: bmp.height, px: c2.getImageData(0, 0, bmp.width, bmp.height).data };
    }).catch(() => {});
  }
  // 0 well inland .. 1 out at sea, at a point of the picture.
  const seaAt = (x, y) => {
    if (!seaField || !seaField.w) return 0.5;
    const i = Math.floor((x / M.px) * M.sea.res), j = Math.floor(((y - M.oy) / (M.kz * M.px)) * M.sea.res);
    if (i < 0 || j < 0 || i >= seaField.w || j >= seaField.h) return 1;
    return smooth(-0.3, 0.45, (seaField.px[(j * seaField.w + i) * 4] / 255) * 3 - 0.75);
  };
  const towns = SITES.filter((s) => s.town);
  const musical = M.effects.filter((e) => e.t === 'glyph' && (e.g || 'note') === 'note');
  const heard = { sea: 0, land: 0, town: 0, near: 0, night: 0, notes: 0 };
  function listen(dt) {
    if (!sound.on) return;
    const b = viewer.bounds(), zd = viewer.zoom;
    let sea = 0;
    for (const [u, v] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) sea += seaAt(b[0] + (b[2] - b[0]) * u, b[1] + (b[3] - b[1]) * v) / 5;
    heard.sea = sea;
    heard.land = 1 - sea;
    heard.near = smooth(0.25, 3, zd);
    heard.night = viewer.night;
    let town = 0;
    for (const s of towns) {
      const q = place[s.id];
      if (q) town = Math.max(town, 1 - Math.hypot(viewer.cx - q.x, (viewer.cy - q.y) * 1.4) / (q.r * 2.4));
    }
    heard.town = Math.max(0, town) * smooth(0.8, 3, zd);
    let notes = 0;
    if (zd > 1) for (const e of musical) if (e.x > b[0] && e.x < b[2] && e.y > b[1] && e.y < b[3]) notes = 1;
    heard.notes = notes;
    sound.update(dt, heard);
  }
  actors.onSplash = (x, y, size) => {
    const b = viewer.bounds();
    if (size >= 10 && x > b[0] && x < b[2] && y > b[1] && y < b[3]) sound.splash(0.3 + 0.7 * smooth(0.3, 3, viewer.zoom));
  };
  actors.onBolt = (e) => {
    const b = viewer.bounds();
    if (e.x > b[0] - 200 && e.x < b[2] + 200 && e.y > b[1] - 200 && e.y < b[3] + 300) sound.thunder(0.35 + 0.65 * smooth(0.2, 2, viewer.zoom));
  };
  const btnSound = $('btnSound'), btnTime = $('btnTime');
  function setSound(want) {
    const now = sound.set(want);
    if (now) hearSea();
    btnSound?.setAttribute('aria-pressed', String(now));
    if (btnSound) btnSound.title = now ? 'Sound is on' : 'Sound is off';
  }
  function setTime(mode) {
    timeMode = mode;
    if (!btnTime) return;
    btnTime.firstElementChild.textContent = mode === 'day' ? '\u2600' : mode === 'night' ? '\u263E' : '\u25D0';
    btnTime.title = mode === 'day' ? 'Always day' : mode === 'night' ? 'Always night' : 'Day and night come and go';
    btnTime.lastElementChild.textContent = mode === 'day' ? 'Day' : mode === 'night' ? 'Night' : 'Day & night';
  }
  const btnStyle = $('btnStyle');
  const nameStyle = (name) => {
    if (!btnStyle) return;
    btnStyle.lastElementChild.textContent = STYLE_NAMES[name] || name;
    btnStyle.title = 'The picture is drawn as: ' + (STYLE_NAMES[name] || name) + '. Click for the next style.';
  };
  function setStyle(name) {
    if (name !== viewer.style) viewer.setStyle(name);
    goal.zoom = Math.min(goal.zoom, viewer.maxZoom);
    try { localStorage.setItem('tiny.style', name); } catch { /* fine */ }
    nameStyle(name);
  }
  const nextStyle = () => setStyle(viewer.styles[(viewer.styles.indexOf(viewer.style) + 1) % viewer.styles.length]);
  if (btnStyle) {
    if (viewer.styles.length < 2) btnStyle.hidden = true;
    btnStyle.addEventListener('click', nextStyle);
    nameStyle(viewer.style);
  }
  btnSound?.addEventListener('click', () => setSound(!sound.on));
  btnTime?.addEventListener('click', () => setTime(TIMES[(TIMES.indexOf(timeMode) + 1) % TIMES.length]));
  setTime(timeMode);

  // ---------------------------------------------------------------- camera --
  const toImage = (lon, lat) => {
    const [x, z] = lonLatToWorld(lon, lat);
    return [x * M.px, M.oy + M.kz * z * M.px];
  };
  const [homeX, homeY] = toImage(23.4, 37.7);
  const homeZoom = () => clamp(viewer.cssW / 3300, 0.2, 0.62);
  const goal = { x: homeX, y: homeY, zoom: homeZoom(), rate: 1.3 };
  if (calm) {
    viewer.cx = goal.x; viewer.cy = goal.y; viewer.zoom = goal.zoom;
  } else {
    viewer.cx = M.w * 0.52; viewer.cy = M.h * 0.52; viewer.zoom = viewer.minZoom * 1.08;
  }
  const flyTo = (x, y, zoom, rate = 3.2) => {
    goal.x = clamp(x, 0, M.w);
    goal.y = clamp(y, 0, M.h);
    if (zoom) goal.zoom = clamp(zoom, viewer.minZoom, viewer.maxZoom);
    goal.rate = calm ? 60 : rate;
  };
  // Image distance that lifts a point by half the height of whatever covers the bottom of the screen.
  const liftFor = (px, zoom) => px / 2 / zoom;

  // ----------------------------------------------------------------- labels --
  const labels = createLabels($('labels'), viewer, (id) => (siteById[id] ? select(id) : follow(id)));
  for (const s of SITES) {
    const q = place[s.id];
    if (!q || s.hidden) continue;
    labels.add({ id: s.id, name: s.name, kind: s.kind, tier: s.tier, minor: !!s.minor, target: { x: q.x, y: q.y + q.bot + 2 }, dy: 3 });
  }
  const roaming = {};
  for (const l of actors.roaming) roaming[l.id] = labels.add(l);
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
    // The great places first, then the smaller stories of the same kind, set a little apart.
    const listed = SITES.filter((x) => x.kind === kind && !x.hidden);
    for (const s of [...listed.filter((x) => !x.minor), ...listed.filter((x) => x.minor).sort((a, b) => a.name.localeCompare(b.name))]) {
      const li = document.createElement('li');
      if (s.minor) li.className = 'minor';
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
    const s = siteById[id], q = place[id];
    if (!s || !q || s.hidden) return;
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
    unfollow();
    openSheet('card');
    selected = id;
    labels.select(id);
    setHash(id);
    if (!opts.still) {
      // Close enough to see the model, but never so close that it overflows the screen.
      const fit = Math.min(viewer.cssW, viewer.cssH) / Math.max(s.minor ? 110 : 180, q.r * 2.6);
      const zoom = clamp(Math.max(goal.zoom, Math.min(s.minor ? 6 : 2.4, fit)), viewer.minZoom, viewer.maxZoom);
      const cover = narrow.matches ? side.offsetHeight : 0;
      flyTo(q.x, q.y - q.top * 0.35 + liftFor(cover, zoom), zoom);
    }
  }

  // Follow something that moves (a ship, Pegasus, Heracles): the map stays on it, zooming included,
  // until the visitor drags the map, steers with the keys, picks a place or presses Escape.
  let following = null;
  function follow(id, thing) {
    const item = roaming[id] || thing;
    if (!item) return;
    if (!side.hidden) openSheet(null);
    following = { item, id: roaming[id] ? id : null };
    labels.select(following.id); // its name stays up however far out the view is
    goal.zoom = clamp(Math.max(goal.zoom, 1.6), viewer.minZoom, viewer.maxZoom);
  }
  function unfollow() {
    if (!following) return;
    following = null;
    labels.select(selected);
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
    unfollow();
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
  const at = {};
  // How far in it is worth going round a point: towns and landmarks are painted finer than open country.
  const limitNear = (x, y, zoom) => {
    const dx = viewer.cssW / zoom / 4, dy = viewer.cssH / zoom / 4;
    return Math.max(viewer.zoomLimit(x, y), viewer.zoomLimit(x - dx, y), viewer.zoomLimit(x + dx, y), viewer.zoomLimit(x, y - dy), viewer.zoomLimit(x, y + dy));
  };
  function zoomBy(k, sx = viewer.cssW / 2, sy = viewer.cssH / 2, rate = 10) {
    // Zoom about a screen point: that point of the image stays under the cursor.
    const ix = goal.x + (sx - viewer.cssW / 2) / goal.zoom, iy = goal.y + (sy - viewer.cssH / 2) / goal.zoom;
    let want = goal.zoom * k;
    if (k > 1) want = Math.min(want, Math.max(goal.zoom, limitNear(ix, iy, want))); // stop where the picture runs out of detail
    const next = clamp(want, viewer.minZoom, viewer.maxZoom);
    goal.zoom = next;
    goal.rate = rate;
    if (following) return; // zooming in on what is being followed: the map stays on it
    goal.x = clamp(ix - (sx - viewer.cssW / 2) / next, 0, M.w);
    goal.y = clamp(iy - (sy - viewer.cssH / 2) / next, 0, M.h);
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
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
      unfollow();
      // Dragging moves the image exactly with the finger, so skip the easing.
      viewer.cx = goal.x = clamp(goal.x - dx / viewer.zoom, 0, M.w);
      viewer.cy = goal.y = clamp(goal.y - dy / viewer.zoom, 0, M.h);
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = canvas.getBoundingClientRect();
      zoomBy(d / pinch.d, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, 30);
      pinch.d = d;
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
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    zoomBy(2, e.clientX - rect.left, e.clientY - rect.top, 6);
  });

  // A tap on the map picks the ship (or the named wanderer) under it to follow, else the landmark
  // under it, else clears the selection.
  function tap(x, y) {
    const rect = canvas.getBoundingClientRect();
    if (viewer.zoom > 0.3) {
      let pick = null, pd = 26;
      const near = (thing, id, lift) => {
        viewer.toScreen(thing.target.x, thing.target.y, at);
        const d = Math.hypot(at.x - (x - rect.left), at.y - lift * Math.min(viewer.zoom, 6) - (y - rect.top));
        if (d < pd) { pd = d; pick = [id, thing]; }
      };
      for (const sh of actors.ships) near(sh, sh.id, 3);
      for (const id of Object.keys(roaming)) near(roaming[id], id, 2);
      if (pick) { follow(pick[0], pick[1]); return; }
    }
    let best = null, bd = Infinity;
    for (const q of M.sites) {
      const site = siteById[q.id];
      if (!site || site.hidden || (site.minor && viewer.zoom < 1.2)) continue; // a minor place is too small to hit until its name shows
      viewer.toScreen(q.x, q.y - q.top * 0.4, at);
      const d = Math.hypot(at.x - (x - rect.left), at.y - (y - rect.top));
      const reach = Math.max(30, q.r * viewer.zoom * 0.6);
      if (d < reach && d / reach < bd) { bd = d / reach; best = q; }
    }
    if (best) select(best.id);
    else if (!sheets.card.hidden) openSheet(null);
  }

  const wheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    zoomBy(Math.exp(-clamp(dy, -240, 240) * 0.0022), e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  // The names lie over the map, and the one being followed sits right under the cursor.
  $('labels').addEventListener('wheel', wheel, { passive: false });
  $('zoomIn').addEventListener('click', () => zoomBy(1.6));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.6));
  $('zoomFit')?.addEventListener('click', () => { unfollow(); flyTo(M.w / 2, M.h / 2, viewer.minZoom, 3); });

  const held = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const voyaging = document.body.classList.contains('voyaging');
    if (e.key === 'Escape') {
      if (!side.hidden) openSheet(null);
      else if (following) unfollow();
      else if (voyaging) leaveVoyage();
    } else if (voyaging && e.key === 'ArrowRight') showStop(voyage.stop + 1);
    else if (voyaging && e.key === 'ArrowLeft') showStop(voyage.stop - 1);
    else if (e.key === 'v' || e.key === 'V') nextStyle();
    else if (e.key === 'm' || e.key === 'M') setSound(!sound.on);
    else if (e.key === 'n' || e.key === 'N') setTime(TIMES[(TIMES.indexOf(timeMode) + 1) % TIMES.length]);
    else if (e.key === 'p' || e.key === 'P') {
      viewer.setPixel(viewer.pixel ? 0 : 2);
      goal.zoom = Math.min(goal.zoom, viewer.maxZoom);
    } else if (e.key === '+' || e.key === '=') zoomBy(1.5);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.5);
    else if (/^Arrow|^[wasd]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && document.activeElement === document.body) {
      held.add(e.key.toLowerCase());
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());
  const resized = () => {
    viewer.resize();
    goal.zoom = Math.max(goal.zoom, viewer.minZoom);
    labels.measure();
  };
  window.addEventListener('resize', resized);

  function fromHash() {
    const h = (location.hash || '').slice(1);
    if (h === 'odyssey') {
      if (!document.body.classList.contains('voyaging')) startVoyage(0);
    } else if (siteById[h] && h !== selected) select(h);
  }
  window.addEventListener('hashchange', fromHash);

  // ------------------------------------------------------------------- loop --
  const readout = $('zoomPct');
  let clock = 0;
  let last = performance.now();
  let started = false;
  let shownPct = '';
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.1); // the first timestamp can predate `last`
    last = now;
    clock += dt;
    // A change of size can be missed (it may come while the map is still loading, as a phone's address
    // bar slides away), and a picture drawn for the wrong size is stretched. So look, every frame.
    if (canvas.clientWidth && (canvas.clientWidth !== viewer.cssW || canvas.clientHeight !== viewer.cssH)) resized();

    if (held.size) {
      const v = (520 / viewer.zoom) * dt;
      if (held.has('arrowleft') || held.has('a')) goal.x -= v;
      if (held.has('arrowright') || held.has('d')) goal.x += v;
      if (held.has('arrowup') || held.has('w')) goal.y -= v;
      if (held.has('arrowdown') || held.has('s')) goal.y += v;
      goal.x = clamp(goal.x, 0, M.w);
      goal.y = clamp(goal.y, 0, M.h);
      goal.rate = 10;
      unfollow();
    }

    actors.update(clock, dt);
    keepTime(dt);
    listen(dt);

    if (document.body.classList.contains('voyaging') && !pointers.size) {
      // Keep the ship in frame; pull in closer once it has arrived.
      const p = voyage.position;
      const stop = voyage.stops[voyage.stop];
      const q = place[stop.site];
      const arrived = !voyage.sailing;
      const zoom = clamp(arrived ? (narrow.matches ? 1.0 : 1.5) : (narrow.matches ? 0.6 : 0.9), viewer.minZoom, viewer.maxZoom);
      const tx = arrived && !stop.near ? (p.x + q.x) / 2 : p.x;
      const ty = arrived && !stop.near ? (p.y + q.y - q.top * 0.5) / 2 : p.y;
      const cover = side.hidden || !narrow.matches ? vEl.offsetHeight : side.offsetHeight;
      flyTo(tx, ty + liftFor(cover, zoom), zoom, arrived ? 2.2 : 3.5);
    } else if (following) {
      // Keep pace with it exactly (easing alone trails behind, further the closer the view), and ease
      // away only whatever distance is left. A jump (a voyage starting again) is flown, not snapped.
      const t = following.item.target, was = following.was;
      if (was && Math.hypot(t.x - was.x, t.y - was.y) < 40) {
        viewer.cx += t.x - was.x;
        viewer.cy += t.y - was.y;
      }
      following.was = { x: t.x, y: t.y };
      flyTo(t.x, t.y, goal.zoom, 4);
    }

    // Open country has less to show than a town, so it stops zooming sooner.
    const limit = limitNear(goal.x, goal.y, goal.zoom);
    if (goal.zoom > limit) goal.zoom = Math.max(limit, goal.zoom * Math.exp(-dt * 2.5));
    const k = 1 - Math.exp(-dt * goal.rate);
    // Ease the zoom, and move the centre so the path on screen is straight while zooming.
    const z0 = viewer.zoom;
    viewer.zoom *= (goal.zoom / viewer.zoom) ** k;
    if (Math.abs(goal.zoom / viewer.zoom - 1) < 0.0015) viewer.zoom = goal.zoom;
    const kz = Math.abs(goal.zoom - z0) > 1e-6 ? clamp((1 / z0 - 1 / viewer.zoom) / (1 / z0 - 1 / goal.zoom), 0, 1) : k;
    viewer.cx += (goal.x - viewer.cx) * kz;
    viewer.cy += (goal.y - viewer.cy) * kz;
    viewer.clamp();
    viewer.render(clock, actors.draw);
    labels.update();

    if (readout) {
      const pct = `${Math.round((viewer.zoom / viewer.base) * 100)}%`;
      if (pct !== shownPct) readout.textContent = shownPct = pct;
    }
    if (!started) {
      started = true;
      $('loading').classList.add('gone');
      fromHash();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__tiny = { viewer, goal, voyage, siteById, place, select, startVoyage, showStop, manifest: M, sound, setTime, setSound, setStyle, follow, actors, get following() { return following; } };
}
