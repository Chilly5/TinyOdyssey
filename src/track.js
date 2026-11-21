// Counting what visitors do: which places they open, whether they click the people, how far in they go.
// The counts go to PostHog (https://posthog.com) once a project key is set below; with no key nothing is
// loaded and nothing is sent.
//
// How it is kept modest:
//   - Nothing is stored in the visitor's browser (no cookie, no local storage), so no consent banner is
//     owed. The price: someone who comes back tomorrow is counted as a new visitor.
//   - Only the events named in main.js are sent, with what was clicked. No recording of the screen, no
//     catching of every click (the map is one canvas: a click means nothing without knowing what it hit).
//   - A browser that asks not to be tracked (Do Not Track, Global Privacy Control) is left alone.
//   - Nothing is sent from a copy running on the builder's own machine.

const KEY = ''; // the project's key, "phc_...", from PostHog > Settings > Project
const HOST = 'https://us.i.posthog.com'; // https://eu.i.posthog.com for a project kept in the EU

const waiting = []; // what happened before the library had loaded
let ph = null, off = !KEY;

// Something a visitor did. name: lower_case_words; props: a few plain values saying what.
export function track(name, props = {}) {
  if (off) return;
  if (ph) ph.capture(name, props);
  else if (waiting.length < 200) waiting.push([name, props]);
}

// Call once the map is up. about: things true of the whole visit (the style it opened in, and so on),
// sent with every event.
export function startTracking(about = {}) {
  const host = location.hostname;
  const local = !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.(test|localhost)$/.test(host);
  const asked = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  if (off || local || asked) { off = true; waiting.length = 0; return; }
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  s.onerror = () => { off = true; waiting.length = 0; }; // blocked, as many browsers will: carry on without
  s.onload = () => {
    const lib = window.posthog;
    if (!lib || typeof lib.init !== 'function') { off = true; waiting.length = 0; return; }
    lib.init(KEY, {
      api_host: HOST,
      defaults: '2025-05-24',
      persistence: 'memory',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      respect_dnt: true,
      loaded: (p) => {
        p.register(about);
        ph = p;
        for (const [name, props] of waiting.splice(0)) p.capture(name, props);
      },
    });
  };
  document.head.append(s);
}
