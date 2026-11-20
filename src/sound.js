// Sound: the sea, the wind, birds by day and crickets by night, the murmur and hammering of a
// town, gulls along the coast, a lyre where the Muses are, thunder over Olympus. All of it is
// made here from noise and a few oscillators; there are no recordings to download. Nothing
// sounds until the visitor asks for it (browsers would not allow it anyway).

const SCALE = [220, 246.94, 261.63, 293.66, 329.63, 392, 440, 493.88, 523.25, 587.33, 659.25]; // A minor, the lyre's strings

export function createSound() {
  let ctx = null, master = null, on = false;
  let bed = null; // the continuous sounds: { sea, hiss, wind, town } gains
  let brown = null, white = null;
  const due = { bird: 1, cricket: 0.5, gull: 4, lyre: 1, hammer: 2 };
  let string = 4;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
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
    const filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const lfo = (hz, depth, param) => { // a slow swell on some parameter
      const o = ctx.createOscillator(), g = gain(depth);
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
    // A town heard from above: many voices, none of them clear.
    const town = gain(), voices = gain(0.55);
    loop(brown, 1.6).connect(filter('bandpass', 430, 0.9)).connect(voices).connect(town).connect(master);
    lfo(0.37, 0.2, voices.gain);
    lfo(0.83, 0.16, voices.gain);
    lfo(1.9, 0.1, voices.gain);
    bed = { sea, hiss, wind, town };
  }

  // One short sound: an oscillator through an envelope, panned a little to one side.
  const voice = (type, t0, dur, peak, freq, shape) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    shape(o.frequency, g.gain);
    let out = g;
    if (ctx.createStereoPanner) {
      out = ctx.createStereoPanner();
      out.pan.value = Math.random() * 1.4 - 0.7;
      g.connect(out);
    }
    o.connect(g);
    out.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    void peak;
  };
  const chirp = (vol) => { // a small bird: two to four quick rising notes
    const t = ctx.currentTime + 0.02, f = 2300 + Math.random() * 1700, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.09 + Math.random() * 0.03);
      voice('sine', t0, 0.08, vol, f, (fr, g) => {
        fr.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.3), t0 + 0.06);
        g.linearRampToValueAtTime(vol, t0 + 0.012);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      });
    }
  };
  const cricket = (vol) => {
    const t = ctx.currentTime + 0.02, f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.045;
      voice('sine', t0, 0.03, vol, f, (fr, g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.006);
        g.linearRampToValueAtTime(0.0001, t0 + 0.03);
      });
    }
  };
  const gull = (vol) => {
    const t = ctx.currentTime + 0.02, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.34;
      voice('triangle', t0, 0.3, vol, 1750, (fr, g) => {
        fr.linearRampToValueAtTime(2100, t0 + 0.05);
        fr.exponentialRampToValueAtTime(1250, t0 + 0.28);
        g.linearRampToValueAtTime(vol, t0 + 0.04);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      });
    }
  };
  const pluck = (vol) => { // one string of the lyre: wander up or down the scale
    string = Math.max(0, Math.min(SCALE.length - 1, string + Math.floor(Math.random() * 5) - 2));
    const t0 = ctx.currentTime + 0.02, f = SCALE[string];
    for (const [type, mult, v] of [['triangle', 1, vol], ['sine', 2, vol * 0.35]]) {
      voice(type, t0, 1.3, v, f * mult, (fr, g) => {
        g.linearRampToValueAtTime(v, t0 + 0.006);
        g.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
      });
    }
  };
  const hammer = (vol) => { // someone at work: two or three taps
    const t = ctx.currentTime + 0.02, n = 2 + Math.floor(Math.random() * 2), f = 1100 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.26;
      voice('triangle', t0, 0.09, vol, f, (fr, g) => {
        g.linearRampToValueAtTime(vol, t0 + 0.003);
        g.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      });
    }
  };

  const api = {
    get on() { return on; },
    // Turn the sound on or off. Must be called from a click or a key press the first time.
    set(want) {
      if (want && !ctx) {
        try { build(); } catch { return false; }
      }
      if (!ctx) return false;
      on = want;
      if (want) ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(want ? 0.7 : 0, ctx.currentTime, want ? 0.6 : 0.15);
      if (!want) setTimeout(() => { if (!on) ctx.suspend(); }, 900);
      return on;
    },
    // Thunder, when lightning strikes in sight. strength 0..1.
    thunder(strength = 1) {
      if (!on) return;
      const t0 = ctx.currentTime + 0.12 + Math.random() * 0.3; // sound is slower than light
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = brown;
      s.playbackRate.value = 0.5 + Math.random() * 0.2;
      f.type = 'lowpass';
      f.frequency.value = 240;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.9 * strength, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.25 * strength, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      s.connect(f).connect(g).connect(master);
      s.start(t0, Math.random() * 2);
      s.stop(t0 + 2.8);
    },
    // Every frame: how much of each thing is in sight (all 0..1) and how close the view is.
    //   sea, land   how much of the view is water or dry ground
    //   town        how near a town is
    //   near        0 looking at the whole map, 1 down among the houses
    //   night       0 day, 1 night
    //   notes       1 where there is music (the Muses, Orpheus)
    update(dt, s) {
      if (!on || !ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      const to = (g, v) => g.gain.setTargetAtTime(v, t, 0.6);
      to(bed.sea, 0.5 * s.sea * (0.35 + 0.65 * s.near));
      to(bed.hiss, 0.06 * s.sea * s.near);
      to(bed.wind, 0.05 + 0.14 * (1 - s.near) + 0.04 * s.land * (1 - s.night));
      to(bed.town, 0.3 * s.town * (1 - 0.8 * s.night));
      const day = 1 - s.night;
      const tick = (name, rate, play) => { // rate: about how many a second
        due[name] -= dt * rate;
        if (due[name] > 0) return;
        due[name] = 0.5 + Math.random();
        play();
      };
      if (s.land * day * s.near > 0.08) tick('bird', 1.4 * s.land * day * s.near, () => chirp(0.035 + 0.03 * s.near));
      if (s.land * s.night * s.near > 0.08) tick('cricket', 5 * s.land * s.night, () => cricket(0.012 + 0.01 * s.near));
      if (s.sea * s.land * day > 0.03) tick('gull', 1.6 * Math.min(1, s.sea * s.land * 4) * day * (0.3 + s.near), () => gull(0.03));
      if (s.notes > 0) tick('lyre', 1.9 * s.notes, () => pluck(0.09 * s.notes));
      if (s.town * day > 0.25) tick('hammer', 0.45 * s.town * day, () => hammer(0.03 * s.town));
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
  return api;
}
