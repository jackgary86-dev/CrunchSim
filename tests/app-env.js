// Shared helper: loads js/app.js and the game modules under node with a fake DOM (Proxy elements), so the run loop
// (startRun / stepRun / stopRun) can be driven without a browser. Used by tests/app-run.js.
// load() returns { CS, app, S, tick(dtSeconds) }. tick() fires the frame callback app.js registered with
// requestAnimationFrame, with a fake clock that advances by dtSeconds (app.js caps one frame at 0.1 s, or 1 s when hidden).
const path = require('path');
function fakeEl() {
  const store = {};
  const fn = function () { return fakeEl(); };
  return new Proxy(fn, {
    get(t, p) {
      if (p in store) return store[p];
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p === 'length') return 0;
      if (p === 'getClientRects') return () => [];
      if (p === 'getBoundingClientRect') return () => ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 });
      if (p === 'querySelectorAll') return () => [];
      if (p === 'getContext') return () => fakeEl();
      if (p === 'children') return { length: 0 };
      return (store[p] = fakeEl());
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return fakeEl(); }
  });
}
function load() {
  Object.keys(require.cache).forEach((k) => { if (/[\\/]js[\\/]/.test(k)) delete require.cache[k]; });   // a fresh game per call
  const g = globalThis, sel = {}, store = {}, frames = [], noop = () => {};
  g.window = g; g.CS = {};
  g.document = Object.assign(fakeEl(), {});
  g.document.readyState = 'complete'; g.document.hidden = false; g.document.title = 'CrunchSim';
  g.document.querySelector = (s) => sel[s] || (sel[s] = fakeEl());
  g.document.getElementById = (s) => sel['#' + s] || (sel['#' + s] = fakeEl());
  g.document.createElement = () => fakeEl();
  g.document.querySelectorAll = () => [];
  sel['#add-machine'] = fakeEl(); sel['#add-machine'].value = 'hammer';   // a real machine id: renderAddButton looks it up
  const wl = {}, dl = {};   // listeners app.js registered, by event name, so a test can fire them
  g.document.addEventListener = (t, f) => { (dl[t] = dl[t] || []).push(f); };
  g.window.addEventListener = (t, f) => { (wl[t] = wl[t] || []).push(f); };
  g.Option = function () { return fakeEl(); };
  g.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  let now = 1000;
  g.performance = { now: () => now };
  g.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  g.setInterval = () => 0; g.clearInterval = noop;
  g.setTimeout = () => 0;   // deferred UI work (drawer closing, end-of-round checks) is not part of the run loop
  g.matchMedia = () => ({ matches: false, addEventListener: noop });
  g.navigator = g.navigator || {};
  g.addEventListener = g.window.addEventListener;
  ['data', 'sim', 'audio', 'cam', 'scenes-a', 'scenes-b', 'score', 'app'].forEach((f) => require(path.join('..', 'js', f + '.js')));
  ['market', 'inventory', 'auction', 'missions', 'floor', 'onboarding', 'blueprints', 'playbooks', 'economics', 'facility', 'rivals', 'endgame', 'refinery', 'slots', 'round', 'autorun', 'milestones', 'saveio', 'guide', 'overlays', 'layout']
    .forEach((f) => require(path.join('..', 'js', 'modules', f + '.js')));
  const CS = g.CS;
  return {
    CS, app: CS.app, S: CS.app.S, sel, winListeners: wl, docListeners: dl,
    tick(dt) { const f = frames.shift(); now += dt * 1000; if (f) f(now); }
  };
}
module.exports = { load, fakeEl };
