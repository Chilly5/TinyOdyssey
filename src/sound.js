// Sound. A song plays over the whole of it; everything else is made here from noise and a few
// oscillators, and kept well under the song.
//
// What is heard depends on how close the view is, in three bands that fade into each other:
//   far    the whole map, seen from high up: the song at its fullest, and the wind
//   mid    a region: the song further back, and the wind dropping. No sea yet: that is a sound of the ground
//   close  down on the ground: the sea and its waves on the shore, the murmur of a town and its market (two recordings,
//          src/audio/market.mp3 and village.mp3), and in the country leaves, cicadas, small birds, a
//          woodpecker, bees, sheep; at night crickets, frogs, an owl
// Nothing here plays a tune: the song is the only music. Nothing sounds until the visitor asks for it
// (browsers would not allow it anyway).

const MUSIC = 0.5; // the song at its fullest
const EFFECTS = 0.6; // everything else, against it
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// music: the song. town, market: recordings of people talking, for a town heard from its streets and for
// the thick of a market (either may be missing; then that part is silent).
export function createSound({ music: musicUrl = null, town: townUrl = null, market: marketUrl = null } = {}) {
  let ctx = null, master = null, meter = null, on = false;
  let bed = null; // the continuous sounds, each a gain: wind, sea, hiss, cicada, cricket, rustle
  const tapes = { town: { url: townUrl }, market: { url: marketUrl } }; // the recordings of people, fetched when first wanted
  let brown = null, white = null;
  let song = null; // { el, gain, lp, out }: the recording, once asked for
  const due = { bird: 1, warble: 3, sparrow: 2, pecker: 6, bee: 5, owl: 6, frog: 3, gull: 4, hammer: 3, wave: 2, bleat: 5, bell: 4 };
  let filter, gain;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    const limit = ctx.createDynamicsCompressor(); // thunder and a wave arriving together must not clip
    limit.threshold.value = -9;
    limit.knee.value = 6;
    limit.ratio.value = 8;
    limit.attack.value = 0.004;
    limit.release.value = 0.25;
    master.connect(limit).connect(ctx.destination);
    meter = ctx.createAnalyser(); // only listened to by level(), for checking the mix
    meter.fftSize = 2048;
    limit.connect(meter);
    const n = Math.floor(ctx.sampleRate * 4);
    white = ctx.createBuffer(1, n, ctx.sampleRate);
    brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.4;
    }
    for (let i = 0; i < 2000; i++) { // so the loop closes without a click
      const k = i / 2000;
      b[n - 2000 + i] = b[n - 2000 + i] * (1 - k) + b[i] * k;
      w[n - 2000 + i] = w[n - 2000 + i] * (1 - k) + w[i] * k;
    }
    const loop = (buffer, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start();
      return s;
    };
    filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const lfo = (hz, depth, param, type = 'sine') => { // a slow swell (or a quick rasp) on some parameter
      const o = ctx.createOscillator(), g = gain(depth);
      o.type = type;
      o.frequency.value = hz;
      o.connect(g).connect(param);
      o.start();
    };
    const side = (node, pan) => {
      if (!ctx.createStereoPanner) return node;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      return p;
    };

    // The wind, as it is heard from high up: air moving in a narrow band, whose pitch climbs as it gusts,
    // and a thin whistle over it. It must not be taken for surf, which is a wide, low noise that swells
    // and falls: so there is nothing low under it, and a gust is a rise in pitch more than in loudness.
    const wind = gain();
    const body = filter('bandpass', 560, 1.7), gust = gain(0.7);
    loop(white, 0.7).connect(filter('highpass', 240)).connect(body).connect(gust).connect(wind);
    lfo(0.083, 190, body.frequency);
    lfo(0.21, 80, body.frequency);
    lfo(0.083, 0.14, gust.gain);
    lfo(0.031, 0.1, gust.gain);
    const whistle = filter('bandpass', 1150, 7), thin = gain(0.24);
    loop(white, 1.3).connect(whistle).connect(thin).connect(wind);
    lfo(0.05, 380, whistle.frequency);
    lfo(0.23, 0.16, thin.gain);
    wind.connect(master);

    // The sea, as it is heard from the shore: a low wash that swells and falls, and the hiss of foam between.
    const sea = gain(), wash = gain(0.6);
    loop(brown).connect(filter('lowpass', 620)).connect(wash).connect(sea).connect(master);
    lfo(0.11, 0.32, wash.gain);
    lfo(0.047, 0.16, wash.gain);
    const hiss = gain(), foam = gain(0.5);
    loop(white, 0.9).connect(filter('bandpass', 2600, 0.6)).connect(foam).connect(hiss).connect(master);
    lfo(0.11, -0.4, foam.gain);

    // Cicadas: a dry rasp in the heat of the day, two of them a little out of step, rising and dying away.
    const cicada = gain();
    for (const [f, hz, swell, pan] of [[5200, 41, 0.13, -0.5], [6100, 47, 0.09, 0.55]]) {
      const rasp = gain(0.5), breath = gain(0.55);
      loop(white, 1.1).connect(filter('bandpass', f, 5)).connect(rasp).connect(breath);
      side(breath, pan).connect(cicada);
      lfo(hz, 0.5, rasp.gain, 'square');
      lfo(swell, 0.45, breath.gain);
    }
    cicada.connect(master);

    // Crickets at night: three of them, each a thin note chopped into pulses, starting and stopping.
    const cricket = gain();
    for (const [f, hz, phrase, pan] of [[4350, 13, 0.31, -0.6], [4720, 15, 0.23, 0.1], [4100, 11.5, 0.17, 0.65]]) {
      const o = ctx.createOscillator(), pulse = gain(0.5), spell = gain(0.5);
      o.frequency.value = f;
      o.connect(pulse).connect(spell);
      side(spell, pan).connect(cricket);
      o.start();
      lfo(hz, 0.5, pulse.gain, 'square');
      lfo(phrase, 0.5, spell.gain, 'square');
    }
    cricket.connect(master);

    // Leaves: the hush of a wood when the air moves in it.
    const rustle = gain(), leaf = gain(0.5);
    loop(white, 1.25).connect(filter('highpass', 2600, 0.5)).connect(filter('lowpass', 7000, 0.5)).connect(leaf).connect(rustle).connect(master);
    lfo(0.17, 0.3, leaf.gain);
    lfo(0.41, 0.15, leaf.gain);

    bed = { wind, sea, hiss, cicada, cricket, rustle };
  }

  // The song: a recording, fetched only once sound is wanted. It has its own way out, round the limiter,
  // so that a clap of thunder does not make it duck.
  function startSong() {
    if (song || !musicUrl) return;
    try {
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.src = musicUrl;
      const out = gain(0), g = gain(0), lp = filter('lowpass', 16000, 0.5);
      ctx.createMediaElementSource(el).connect(lp).connect(g).connect(out).connect(ctx.destination);
      song = { el, gain: g, lp, out };
      el.addEventListener('error', () => { if (song) song.dead = true; }); // no song: the rest carries on
    } catch { song = null; }
  }

  // A recording of people, looped: wanted only where there is a town in earshot, so fetched only then.
  // It is heard through a wall or two (its top taken off), and goes out with the other effects.
  function tape(name) {
    const tp = tapes[name];
    if (tp.el || tp.dead || !tp.url) return tp;
    try {
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.src = tp.url;
      tp.gain = gain(0);
      ctx.createMediaElementSource(el).connect(filter('lowpass', 4200, 0.5)).connect(tp.gain).connect(master);
      tp.el = el;
      el.addEventListener('error', () => { tp.dead = true; });
      if (on) el.play().catch(() => {});
    } catch { tp.dead = true; }
    return tp;
  }
  const eachTape = (fn) => { for (const tp of Object.values(tapes)) if (tp.el && !tp.dead) fn(tp); };

  const panned = (node, pan = Math.random() * 1.4 - 0.7) => {
    if (!ctx.createStereoPanner) return node;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    return p;
  };
  // One short sound: an oscillator through an envelope, panned a little to one side.
  const voice = (type, t0, dur, freq, shape, pan) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    shape(o.frequency, g.gain);
    o.connect(g);
    panned(g, pan).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  };
  // A burst of noise through a filter: the body of a wave, a knock, a breath of thunder.
  const burst = (buffer, t0, dur, type, f0, f1, q, shape, rate = 1, pan) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    shape(g.gain);
    s.connect(f).connect(g);
    panned(g, pan).connect(master);
    s.start(t0, Math.random() * 2);
    s.stop(t0 + dur + 0.1);
  };

  const chirp = (vol) => { // a small bird: two to four quick rising cheeps
    const t = ctx.currentTime + 0.02, f = 2300 + Math.random() * 1700, n = 2 + Math.floor(Math.random() * 3), pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.09 + Math.random() * 0.03);
      voice('sine', t0, 0.08, f, (fr, g) => {
        fr.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.3), t0 + 0.06);
        g.linearRampToValueAtTime(vol, t0 + 0.012);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      }, pan);
    }
  };
  const warble = (vol) => { // a warbler: a falling phrase, then a quick trill
    const t = ctx.currentTime + 0.02, f = 2600 + Math.random() * 900, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.17, fi = f * (1 - i * 0.11);
      voice('sine', t0, 0.14, fi, (fr, g) => {
        fr.exponentialRampToValueAtTime(fi * 0.86, t0 + 0.13);
        g.linearRampToValueAtTime(vol, t0 + 0.02);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      }, pan);
    }
    for (let i = 0; i < 6; i++) {
      const t0 = t + 0.56 + i * 0.055;
      voice('sine', t0, 0.04, f * (i % 2 ? 1.18 : 1.05), (fr, g) => {
        g.linearRampToValueAtTime(vol * 0.8, t0 + 0.008);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      }, pan);
    }
  };
  const sparrow = (vol) => { // sparrows in a bush: a scatter of short dry chips
    const t = ctx.currentTime + 0.02, n = 5 + Math.floor(Math.random() * 6), pan = Math.random() * 1.6 - 0.8;
    let t0 = t;
    for (let i = 0; i < n; i++) {
      const f = 3400 + Math.random() * 1500, at = t0;
      voice('triangle', at, 0.035, f, (fr, g) => {
        fr.exponentialRampToValueAtTime(f * 0.78, at + 0.03);
        g.linearRampToValueAtTime(vol, at + 0.004);
        g.exponentialRampToValueAtTime(0.0001, at + 0.035);
      }, pan);
      t0 += 0.06 + Math.random() * 0.12;
    }
  };
  const pecker = (vol) => { // a woodpecker: a roll of knocks on a hollow trunk
    const t = ctx.currentTime + 0.02, n = 7 + Math.floor(Math.random() * 6), pan = Math.random() * 1.6 - 0.8, f = 700 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.062;
      burst(brown, t0, 0.04, 'bandpass', f, f, 3, (g) => {
        g.linearRampToValueAtTime(vol * (1 - i / (n * 1.6)), t0 + 0.003);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      }, 2.2, pan);
    }
  };
  const bee = (vol) => { // a bee going by, from one side to the other
    const t0 = ctx.currentTime + 0.02, dur = 1.6 + Math.random(), f = 185 + Math.random() * 50, dir = Math.random() < 0.5 ? 1 : -1;
    const o = ctx.createOscillator(), wob = ctx.createOscillator(), wg = gain(9), g = gain(0);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t0);
    o.frequency.linearRampToValueAtTime(f * 0.93, t0 + dur);
    wob.frequency.value = 23;
    wob.connect(wg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(filter('lowpass', 1400, 0.7)).connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      out = ctx.createStereoPanner();
      out.pan.setValueAtTime(-0.9 * dir, t0);
      out.pan.linearRampToValueAtTime(0.9 * dir, t0 + dur);
      g.connect(out);
    }
    out.connect(master);
    o.start(t0); wob.start(t0);
    o.stop(t0 + dur + 0.05); wob.stop(t0 + dur + 0.05);
  };
  const owl = (vol) => { // two soft hoots, the second lower
    const t = ctx.currentTime + 0.02, pan = Math.random() * 1.6 - 0.8;
    for (const [dt, f, d] of [[0, 410, 0.22], [0.34, 365, 0.42]]) {
      voice('sine', t + dt, d, f, (fr, g) => {
        fr.linearRampToValueAtTime(f * 0.94, t + dt + d);
        g.linearRampToValueAtTime(vol, t + dt + 0.05);
        g.linearRampToValueAtTime(vol * 0.7, t + dt + d * 0.6);
        g.linearRampToValueAtTime(0.0001, t + dt + d);
      }, pan);
    }
  };
  const frog = (vol) => { // a frog in the reeds: two or three croaks
    const t = ctx.currentTime + 0.02, n = 2 + Math.floor(Math.random() * 2), pan = Math.random() * 1.6 - 0.8, f = 150 + Math.random() * 70;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.42;
      const o = ctx.createOscillator(), chop = ctx.createOscillator(), cg = gain(0.5), g = gain(0), am = gain(0.5);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t0);
      chop.type = 'square';
      chop.frequency.value = 38;
      chop.connect(cg).connect(am.gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.26);
      o.connect(filter('bandpass', 900, 2)).connect(am).connect(g);
      panned(g, pan).connect(master);
      o.start(t0); chop.start(t0);
      o.stop(t0 + 0.3); chop.stop(t0 + 0.3);
    }
  };
  const gull = (vol) => {
    const t = ctx.currentTime + 0.02, n = 1 + Math.floor(Math.random() * 3), pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.34;
      voice('triangle', t0, 0.3, 1750, (fr, g) => {
        fr.linearRampToValueAtTime(2100, t0 + 0.05);
        fr.exponentialRampToValueAtTime(1250, t0 + 0.28);
        g.linearRampToValueAtTime(vol, t0 + 0.04);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      }, pan);
    }
  };
  const hammer = (vol) => { // someone at work: two or three dull blows, wood on wood
    const t = ctx.currentTime + 0.02, n = 2 + Math.floor(Math.random() * 2), f = 900 + Math.random() * 500, pan = Math.random() * 1.2 - 0.6;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.3;
      burst(brown, t0, 0.07, 'bandpass', f, f * 0.8, 2.5, (g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.003);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      }, 2.6, pan);
    }
  };
  const wave = (vol) => { // one wave running up a beach and drawing back
    const t0 = ctx.currentTime + 0.02;
    burst(white, t0, 2.6, 'bandpass', 520, 1900, 0.7, (g) => {
      g.linearRampToValueAtTime(vol, t0 + 0.7);
      g.exponentialRampToValueAtTime(vol * 0.3, t0 + 1.5);
      g.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    }, 0.8);
  };
  const bleat = (vol) => { // a sheep, somewhere up the hill
    const t0 = ctx.currentTime + 0.02, dur = 0.5 + Math.random() * 0.35, f = 380 + Math.random() * 90;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = gain(22), g = gain(0);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t0);
    o.frequency.linearRampToValueAtTime(f * 0.88, t0 + dur);
    vib.frequency.value = 9 + Math.random() * 3;
    vib.connect(vg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.06);
    g.gain.linearRampToValueAtTime(vol * 0.8, t0 + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(filter('bandpass', 1150, 2.2)).connect(g);
    panned(g).connect(master);
    o.start(t0); vib.start(t0);
    o.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
  };
  const bell = (vol) => { // the bell on a goat's neck: a dull clank or two as it walks, more tin than note
    const t = ctx.currentTime + 0.02, f = 1700 + Math.random() * 600, n = 1 + Math.floor(Math.random() * 2), pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.24 + Math.random() * 0.2);
      burst(white, t0, 0.14, 'bandpass', f, f, 11, (g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.004);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      }, 1, pan);
    }
  };

  const api = {
    get on() { return on; },
    get hasSong() { return !!(song && !song.dead); },
    // Turn the sound on or off. Must be called from a click or a key press the first time.
    set(want) {
      if (want && !ctx) {
        try { build(); } catch { return false; }
      }
      if (!ctx) return false;
      on = want;
      if (want) {
        ctx.resume();
        startSong();
        if (song && !song.dead) song.el.play().catch(() => {});
        eachTape((tp) => tp.el.play().catch(() => {}));
      }
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(want ? EFFECTS : 0, t, want ? 0.6 : 0.15);
      if (song) {
        song.out.gain.cancelScheduledValues(t);
        song.out.gain.setTargetAtTime(want ? 1 : 0, t, want ? 1.2 : 0.2);
      }
      if (!want) {
        setTimeout(() => {
          if (on) return;
          if (song) song.el.pause();
          eachTape((tp) => tp.el.pause());
          ctx.suspend();
        }, 900);
      }
      return on;
    },
    // How loud it is just now: [rms, peak] of the last few hundredths of a second, 0..1. For checking the mix.
    // (Everything but the song, which goes out another way.)
    level() {
      if (!meter) return [0, 0];
      const buf = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(buf);
      let sum = 0, peak = 0;
      for (const v of buf) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      return [Math.sqrt(sum / buf.length), peak];
    },
    // What the mix was last set to, for checking it: the three bands, and the levels asked of the song,
    // the wind, the sea, a town's murmur and its market.
    mix: { far: 1, mid: 0, close: 0, song: 0, wind: 0, sea: 0, town: 0, market: 0 },
    // Something heavy landing in the sea, in sight. strength 0..1.
    splash(strength = 1) {
      if (!on) return;
      const t0 = ctx.currentTime + 0.02;
      burst(white, t0, 0.9, 'bandpass', 900, 2600, 0.8, (g) => {
        g.linearRampToValueAtTime(0.16 * strength, t0 + 0.02);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      });
    },
    // Thunder, when lightning strikes in sight. strength 0..1.
    thunder(strength = 1) {
      if (!on) return;
      const t0 = ctx.currentTime + 0.12 + Math.random() * 0.3; // sound is slower than light
      burst(brown, t0, 2.7, 'lowpass', 240, 240, 0.7, (g) => {
        g.linearRampToValueAtTime(0.45 * strength, t0 + 0.03);
        g.exponentialRampToValueAtTime(0.12 * strength, t0 + 0.5);
        g.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      }, 0.5 + Math.random() * 0.2);
    },
    // Every frame: what is in sight (all 0..1 but zoom) and how close the view is.
    //   zoom        the viewer's zoom: about 0.4 for the whole map, 4 at one picture pixel to the screen pixel, 40 right in
    //   sea, land   how much of the view is water or dry ground
    //   shore       how much sea is in the view or just outside it (a harbour town hears its waves)
    //   town        how near a town is
    //   crowd       how many people are in sight, 0 none .. 1 a market day
    //   night       0 day, 1 night
    update(dt, s) {
      if (!on || !ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      const to = (g, v) => g.gain.setTargetAtTime(v, t, 0.6);
      const z = s.zoom ?? 1;
      const far = 1 - smooth(0.5, 2.2, z), close = smooth(3.5, 12, z), mid = Math.max(0, 1 - far - close);
      const day = 1 - s.night, wild = s.land * (1 - s.town), shore = s.shore ?? s.sea;
      const coast = Math.min(1, shore * (1 - s.sea * 0.6) * 2.5); // sea and land together: a beach, a harbour
      const awake = 0.2 + 0.8 * day; // towns go quiet at night, not silent
      const busy = Math.min(1, s.crowd ?? 0) * Math.min(1, s.town * 2) * close * awake; // people about, and a town for them to be in (a flock of sheep is not a market)
      const m = api.mix;
      m.far = far; m.mid = mid; m.close = close;
      if (song && !song.dead) {
        // The song steps back as the view comes down, and loses its top, like a band heard from the next street.
        m.song = MUSIC * (far + 0.55 * mid + 0.24 * close) * (1 - 0.2 * s.night);
        song.gain.gain.setTargetAtTime(m.song, t, 0.8);
        song.lp.frequency.setTargetAtTime(16000 - 11500 * close - 3000 * mid, t, 0.8);
      }
      // High up there is only the wind, and it dies away on the way down. The sea is a sound of the ground:
      // nothing of it until the view is close, then the wash, the foam, the waves and the gulls together.
      m.wind = 0.3 * far + 0.07 * mid;
      m.sea = 0.24 * shore * close;
      // People: a town's talk from the streets, and on top of it the market when the view is among the stalls.
      m.town = 0.3 * s.town * (0.3 * mid + close) * awake;
      m.market = 0.34 * busy;
      for (const name of ['town', 'market']) {
        if (m[name] > 0.004) tape(name);
        if (tapes[name].gain) to(tapes[name].gain, m[name]);
      }
      to(bed.wind, m.wind);
      to(bed.sea, m.sea);
      to(bed.hiss, 0.03 * shore * close);
      to(bed.cicada, 0.034 * wild * day * (0.25 * mid + close));
      to(bed.cricket, 0.018 * s.land * s.night * (0.3 * mid + close));
      to(bed.rustle, 0.036 * wild * close * (0.5 + 0.5 * day));
      const tick = (name, rate, play) => { // rate: about how many a second
        if (rate <= 0.004) return;
        due[name] -= dt * rate;
        if (due[name] > 0) return;
        due[name] = 0.5 + Math.random();
        play();
      };
      const down = 0.2 * mid + close; // how much of the small sounds can be made out
      tick('bird', 1.1 * s.land * day * down, () => chirp(0.02 + 0.016 * close));
      tick('warble', 0.4 * wild * day * close, () => warble(0.026));
      tick('sparrow', 0.5 * s.land * day * close, () => sparrow(0.018));
      tick('pecker', 0.12 * wild * day * close, () => pecker(0.05));
      tick('bee', 0.22 * wild * day * close, () => bee(0.02));
      tick('owl', 0.12 * wild * s.night * close, () => owl(0.028));
      tick('frog', 0.5 * coast * s.night * close, () => frog(0.04));
      tick('gull', 0.88 * coast * day * close, () => gull(0.011));
      tick('wave', 0.55 * coast * close, () => wave(0.07));
      tick('hammer', 0.3 * s.town * day * close, () => hammer(0.05));
      tick('bleat', 0.2 * wild * day * close, () => bleat(0.022));
      tick('bell', 0.25 * wild * day * close, () => bell(0.05));
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) {
      if (song) song.el.pause();
      eachTape((tp) => tp.el.pause());
      ctx.suspend();
    } else {
      ctx.resume();
      if (song && !song.dead) song.el.play().catch(() => {});
      eachTape((tp) => tp.el.play().catch(() => {}));
    }
  });
  return api;
}
