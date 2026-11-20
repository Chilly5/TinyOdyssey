// Sound. A song plays over the whole of it; everything else is made here from noise and a few
// oscillators: the sea, the wind, cicadas in the heat, birds by day, crickets and an owl by
// night, gulls along the coast, waves on a beach, a town talking and hammering, sheep and
// their bells in the hills, a lyre where the Muses are, thunder over Olympus.
//
// What is heard depends on how close the view is, in three bands that fade into each other:
//   far    the whole map: the song at its fullest, wind high up, the sea a murmur
//   mid    a region: the song further back, the swell of the sea, cicadas, a town as a hum
//   close  down among the houses: the song behind everything, and the small sounds in front:
//          voices, a hammer, a wave arriving, a bird in the nearest tree
// Nothing sounds until the visitor asks for it (browsers would not allow it anyway).

const SCALE = [220, 246.94, 261.63, 293.66, 329.63, 392, 440, 493.88, 523.25, 587.33, 659.25]; // A minor, the lyre's strings
const VOWELS = [[700, 1150], [460, 1850], [330, 2250], [520, 900], [360, 780]]; // the two formants of a, e, i, o, u
const MUSIC = 0.5; // the song at its fullest
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createSound({ music: musicUrl = null } = {}) {
  let ctx = null, master = null, meter = null, on = false;
  let bed = null; // the continuous sounds: { sea, hiss, wind, town, cicada } gains
  let brown = null, white = null;
  let song = null; // { el, gain, lp, out }: the recording, once asked for
  const due = { bird: 1, warble: 3, cricket: 0.5, owl: 6, gull: 4, lyre: 1, hammer: 2, voice: 1, wave: 2, bleat: 5, bell: 3 };
  let string = 4;
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
    // The sea: a low wash that swells and falls, and the hiss of foam between.
    const sea = gain(), wash = gain(0.6);
    loop(brown).connect(filter('lowpass', 620)).connect(wash).connect(sea).connect(master);
    lfo(0.11, 0.32, wash.gain);
    lfo(0.047, 0.16, wash.gain);
    const hiss = gain(), foam = gain(0.5);
    loop(white, 0.9).connect(filter('bandpass', 2600, 0.6)).connect(foam).connect(hiss).connect(master);
    lfo(0.11, -0.4, foam.gain);
    // The wind, higher up.
    const wind = gain(), wf = filter('bandpass', 460, 1.1);
    loop(white, 0.7).connect(wf).connect(wind).connect(master);
    lfo(0.07, 170, wf.frequency);
    lfo(0.19, 60, wf.frequency);
    // A town heard from a hill: many voices, none of them clear.
    const town = gain(), voices = gain(0.55);
    loop(brown, 1.6).connect(filter('bandpass', 430, 0.9)).connect(voices).connect(town).connect(master);
    lfo(0.37, 0.2, voices.gain);
    lfo(0.83, 0.16, voices.gain);
    lfo(1.9, 0.1, voices.gain);
    // Cicadas: a dry rasp in the heat of the day, two of them a little out of step, rising and dying away.
    const cicada = gain();
    for (const [f, hz, swell, pan] of [[5200, 41, 0.13, -0.5], [6100, 47, 0.09, 0.55]]) {
      const rasp = gain(0.5), breath = gain(0.55);
      let out = breath;
      if (ctx.createStereoPanner) {
        out = ctx.createStereoPanner();
        out.pan.value = pan;
        breath.connect(out);
      }
      loop(white, 1.1).connect(filter('bandpass', f, 5)).connect(rasp).connect(breath);
      out.connect(cicada);
      lfo(hz, 0.5, rasp.gain, 'square');
      lfo(swell, 0.45, breath.gain);
    }
    cicada.connect(master);
    bed = { sea, hiss, wind, town, cicada };
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
  // A burst of noise through a filter: the body of a wave, a splash, a breath of thunder.
  const burst = (buffer, t0, dur, type, f0, f1, q, shape, rate = 1) => {
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
    panned(g).connect(master);
    s.start(t0, Math.random() * 2);
    s.stop(t0 + dur + 0.1);
  };

  const chirp = (vol) => { // a small bird: two to four quick rising notes
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
  const warble = (vol) => { // a songbird: a falling phrase, then a quick trill
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
  const cricket = (vol) => {
    const t = ctx.currentTime + 0.02, f = 4300 + Math.random() * 500, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.045;
      voice('sine', t0, 0.03, f, (fr, g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.006);
        g.linearRampToValueAtTime(0.0001, t0 + 0.03);
      }, pan);
    }
  };
  const owl = (vol) => { // two soft notes, the second lower
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
  const pluck = (vol) => { // one string of the lyre: wander up or down the scale
    string = Math.max(0, Math.min(SCALE.length - 1, string + Math.floor(Math.random() * 5) - 2));
    const t0 = ctx.currentTime + 0.02, f = SCALE[string];
    for (const [type, mult, v] of [['triangle', 1, vol], ['sine', 2, vol * 0.35]]) {
      voice(type, t0, 1.3, f * mult, (fr, g) => {
        g.linearRampToValueAtTime(v, t0 + 0.006);
        g.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
      }, 0);
    }
  };
  const hammer = (vol) => { // a smith at work: two or three blows, the anvil ringing after each
    const t = ctx.currentTime + 0.02, n = 2 + Math.floor(Math.random() * 2), f = 1100 + Math.random() * 500, pan = Math.random() * 1.2 - 0.6;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.3;
      voice('triangle', t0, 0.09, f, (fr, g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.003);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      }, pan);
      voice('sine', t0, 0.5, f * 2.42, (fr, g) => {
        g.linearRampToValueAtTime(vol * 0.3, t0 + 0.004);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      }, pan);
    }
  };
  const talk = (vol) => { // someone talking, too far off for words: a few syllables at a man's pitch or a woman's
    const pan = Math.random() * 1.6 - 0.8, base = 105 + Math.random() * 135, n = 2 + Math.floor(Math.random() * 4);
    const out = panned(gain(1), pan);
    out.connect(master);
    let t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const dur = 0.11 + Math.random() * 0.15, p = base * (0.9 + Math.random() * 0.3);
      const [f1, f2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
      const o = ctx.createOscillator(), g = gain(0);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(p, t0);
      o.frequency.linearRampToValueAtTime(p * (0.9 + Math.random() * 0.22), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.linearRampToValueAtTime(vol * 0.7, t0 + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o.connect(filter('bandpass', f1, 5)).connect(g);
      o.connect(filter('bandpass', f2, 7)).connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
      t0 += dur + Math.random() * 0.07;
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
  const bell = (vol) => { // the bell on a goat's neck: a few dull clanks as it walks
    const t = ctx.currentTime + 0.02, f = 1500 + Math.random() * 700, n = 1 + Math.floor(Math.random() * 3), pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.22 + Math.random() * 0.2);
      for (const [m, v] of [[1, vol], [2.76, vol * 0.4]]) {
        voice('sine', t0, 0.35, f * m, (fr, g) => {
          g.linearRampToValueAtTime(v, t0 + 0.004);
          g.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        }, pan);
      }
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
      }
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(want ? 1.0 : 0, t, want ? 0.6 : 0.15);
      if (song) {
        song.out.gain.cancelScheduledValues(t);
        song.out.gain.setTargetAtTime(want ? 1 : 0, t, want ? 1.2 : 0.2);
      }
      if (!want) {
        setTimeout(() => {
          if (on) return;
          if (song) song.el.pause();
          ctx.suspend();
        }, 900);
      }
      return on;
    },
    // How loud it is just now: [rms, peak] of the last few hundredths of a second, 0..1. For checking the mix.
    // (The ambience only: the song goes out another way.)
    level() {
      if (!meter) return [0, 0];
      const buf = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(buf);
      let sum = 0, peak = 0;
      for (const v of buf) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      return [Math.sqrt(sum / buf.length), peak];
    },
    // What the mix was last set to, for checking it: the three bands and the song's level.
    mix: { far: 1, mid: 0, close: 0, song: 0 },
    // Something heavy landing in the sea, in sight. strength 0..1.
    splash(strength = 1) {
      if (!on) return;
      const t0 = ctx.currentTime + 0.02;
      burst(white, t0, 0.9, 'bandpass', 900, 2600, 0.8, (g) => {
        g.linearRampToValueAtTime(0.35 * strength, t0 + 0.02);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      });
    },
    // Thunder, when lightning strikes in sight. strength 0..1.
    thunder(strength = 1) {
      if (!on) return;
      const t0 = ctx.currentTime + 0.12 + Math.random() * 0.3; // sound is slower than light
      burst(brown, t0, 2.7, 'lowpass', 240, 240, 0.7, (g) => {
        g.linearRampToValueAtTime(0.9 * strength, t0 + 0.03);
        g.exponentialRampToValueAtTime(0.25 * strength, t0 + 0.5);
        g.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      }, 0.5 + Math.random() * 0.2);
    },
    // Every frame: what is in sight (all 0..1 but zoom) and how close the view is.
    //   zoom        the viewer's zoom: about 0.4 for the whole map, 4 at one picture pixel to the screen pixel, 40 right in
    //   sea, land   how much of the view is water or dry ground
    //   town        how near a town is
    //   crowd       how many people are in sight, 0 none .. 1 a market day
    //   night       0 day, 1 night
    //   notes       1 where there is music (the Muses, Orpheus)
    update(dt, s) {
      if (!on || !ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      const to = (g, v) => g.gain.setTargetAtTime(v, t, 0.6);
      const z = s.zoom ?? 1;
      const far = 1 - smooth(0.5, 2.2, z), close = smooth(3.5, 12, z), mid = Math.max(0, 1 - far - close);
      const day = 1 - s.night, wild = s.land * (1 - s.town), coast = Math.min(1, s.sea * s.land * 4);
      const crowd = s.crowd ?? s.town;
      api.mix.far = far; api.mix.mid = mid; api.mix.close = close;
      if (song && !song.dead) {
        // The song steps back as the view comes down, and loses its top, like a band heard from the next street.
        const v = MUSIC * (far + 0.55 * mid + 0.22 * close) * (1 - 0.2 * s.night);
        api.mix.song = v;
        song.gain.gain.setTargetAtTime(v, t, 0.8);
        song.lp.frequency.setTargetAtTime(16000 - 11500 * close - 3000 * mid, t, 0.8);
      }
      to(bed.wind, 0.025 + 0.15 * far + 0.05 * mid * s.land + 0.02 * close * wild);
      to(bed.sea, s.sea * (0.1 * far + 0.4 * mid + 0.5 * close));
      to(bed.hiss, 0.07 * s.sea * close);
      to(bed.town, s.town * (1 - 0.8 * s.night) * (0.26 * mid + 0.08 * close));
      to(bed.cicada, 0.05 * wild * day * (0.3 * mid + close));
      const tick = (name, rate, play) => { // rate: about how many a second
        if (rate <= 0.004) return;
        due[name] -= dt * rate;
        if (due[name] > 0) return;
        due[name] = 0.5 + Math.random();
        play();
      };
      const down = 0.25 * mid + close; // how much of the small sounds can be made out
      tick('bird', 1.3 * s.land * day * down, () => chirp(0.03 + 0.035 * close));
      tick('warble', 0.35 * wild * day * close, () => warble(0.045));
      tick('cricket', 5 * s.land * s.night * down, () => cricket(0.01 + 0.012 * close));
      tick('owl', 0.12 * wild * s.night * close, () => owl(0.05));
      tick('gull', 1.5 * coast * day * (0.3 * mid + 0.8 * close), () => gull(0.025 + 0.015 * close));
      tick('wave', 0.5 * coast * close, () => wave(0.16));
      tick('lyre', 1.9 * s.notes * (0.4 + 0.6 * down), () => pluck(0.09 * s.notes));
      tick('hammer', 0.4 * s.town * day * down, () => hammer(0.02 + 0.02 * close));
      tick('voice', 2.6 * crowd * close * (0.25 + 0.75 * day), () => talk(0.035 + 0.03 * close));
      tick('bleat', 0.22 * wild * day * close, () => bleat(0.04));
      tick('bell', 0.3 * wild * day * close, () => bell(0.02));
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) {
      if (song) song.el.pause();
      ctx.suspend();
    } else {
      ctx.resume();
      if (song && !song.dead) song.el.play().catch(() => {});
    }
  });
  return api;
}
