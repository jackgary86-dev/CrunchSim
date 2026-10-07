// Shared helper: boots js/ like a browser page (DOMContentLoaded fires after every module loaded, or with postBoot the
// document is already complete when app.js runs) with a fake DOM whose elements keep click listeners, a queued setTimeout
// (flush() runs it) and a fake localStorage (pass store to reload a saved game). playRound / runYard drive a Rivals round.
const path = require('path');
const ROOT = path.join(__dirname, '..');
function fakeEl(name) {
  const store = {}; const kids = {}; const ls = {};
  const fn = function () { return fakeEl(); };
  const el = new Proxy(fn, {
    get(t, p) {
      if (p in store) return store[p];
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p === 'length') return 0;
      if (p === '__name') return name;
      if (p === 'getClientRects') return () => [];
      if (p === 'getBoundingClientRect') return () => ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 });
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector') return (s) => kids[s] || (kids[s] = fakeEl(s));
      if (p === 'addEventListener') return (t, f) => { (ls[t] = ls[t] || []).push(f); };
      if (p === 'click') return () => (ls.click || []).forEach((f) => f({ target: null, stopImmediatePropagation() {}, preventDefault() {} }));
      if (p === '__ls') return ls;
      if (p === 'classList') { const c = new Set(['hidden']); return store.classList = { add: (...a) => a.forEach((x) => c.add(x)), remove: (...a) => a.forEach((x) => c.delete(x)), contains: (x) => c.has(x), toggle: (x, on) => { if (on === undefined ? !c.has(x) : on) c.add(x); else c.delete(x); } }; }
      if (p === 'getContext') return () => fakeEl();
      if (p === 'children') return { length: 0 };
      return (store[p] = fakeEl());
    },
    set(t, p, v) { if (p === "innerHTML") { for (const k in kids) delete kids[k]; } store[p] = v; return true; },
    apply() { return fakeEl(); }
  });
  return el;
}
function mk(opts = {}) {
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(path.join(ROOT, 'js')) === 0) delete require.cache[k]; });   // a fresh game per call
  const g = globalThis, sel = {}, store = opts.store || {}, frames = [], noop = () => {};
  g.window = g; g.CS = {};
  g.document = fakeEl('doc');
  g.document.readyState = opts.postBoot ? 'complete' : 'loading'; g.document.hidden = false;
  g.document.querySelector = (s) => sel[s] || (sel[s] = fakeEl(s));
  g.document.getElementById = (s) => sel['#' + s] || (sel['#' + s] = fakeEl('#' + s));
  const created = []; g.document.createElement = (t) => { const e = fakeEl(t); created.push(e); return e; };
  g.document.querySelectorAll = () => [];
  sel['#add-machine'] = fakeEl(); sel['#add-machine'].value = 'hammer';
  const wl = {}, dl = {};
  g.document.addEventListener = (t, f) => { (dl[t] = dl[t] || []).push(f); };
  g.window.addEventListener = (t, f) => { (wl[t] = wl[t] || []).push(f); };
  g.window.removeEventListener = noop;
  g.Option = function () { return fakeEl(); };
  g.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  let now = 1000;
  g.performance = { now: () => now };
  g.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  g.cancelAnimationFrame = noop;
  g.setInterval = () => 0; g.clearInterval = noop;
  const q = [];
  g.setTimeout = (f) => { q.push(f); return q.length; };
  g.matchMedia = () => ({ matches: false, addEventListener: noop });
  g.navigator = g.navigator || {};
  g.addEventListener = g.window.addEventListener;
  g.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  ['data', 'sim', 'audio', 'cam', 'scenes-a', 'scenes-b', 'score', 'app'].forEach((f) => require(path.join(ROOT, 'js', f + '.js')));
  ['market', 'inventory', 'auction', 'missions', 'floor', 'onboarding', 'blueprints', 'playbooks', 'economics', 'facility', 'rivals', 'endgame', 'refinery', 'slots', 'round', 'autorun', 'milestones', 'saveio', 'guide', 'overlays', 'layout'].concat(opts.modes ? ['modes'] : [])
    .forEach((f) => require(path.join(ROOT, 'js', 'modules', f + '.js')));
  g.document.readyState = 'complete'; (dl.DOMContentLoaded || []).forEach((f) => f());
  const CS = g.CS;
  const env = { CS, app: CS.app, S: CS.app.S, sel, store, created, wl, dl,
    tick(dt) { const f = frames.shift(); now += dt * 1000; if (f) f(now); },
    flush(n = 50) { for (let i = 0; i < n && q.length; i++) { const b = q.splice(0); b.forEach((f) => { try { f(); } catch (e) { console.error('timer', e.stack); } }); } },
    logs: [] };
  const logEl = g.document.querySelector('#log'); logEl.prepend = (d) => { env.logs.push(String(d.innerHTML).replace(/<[^>]+>/g, '')); };
  env.runBatch = () => { env.S.speed = 60; CS.app.startRun(); let k = 0; while (env.S.run && k++ < 20000) env.tick(0.1); env.flush(); };
  // the round overlay: the created element with id 'round'
  env.roundOv = () => created.find((e) => e.id === 'round');
  env.clickRound = (s) => { const ov = env.roundOv(); const main = ov.querySelector('.round-main'); const b = main.querySelector(s); b.click(); };
  return env;
}
// one Rivals round through the overlay buttons: bid (up to maxBids times) on card bidOn, pass every other card
function playRound(env, { bidOn = 0, maxBids = 6 } = {}) {
  const RL = env.CS.Round.live;
  env.clickRound('#round-start'); env.flush();
  let g = 0;
  while (RL.state().open && !RL.state().open.done && g++ < 60) {
    const r = RL.state().open, inFor = !r.won.you && r.out.indexOf('you') < 0;
    if (inFor && r.k === bidOn && (r.bids = (r.bids || 0)) < maxBids && r.leader !== 'you') { r.bids++; env.clickRound('#round-bid'); env.flush(); }
    else if (inFor) { env.clickRound('#round-pass'); env.flush(); }
    else env.flush();
  }
}
// run every load in the yard, then sell what was made
function runYard(env) {
  const { CS, S } = env, A = CS.Auction.live; let g = 0;
  while ((A.pending() || A.yard().length) && g++ < 200) {
    if (!S.feedPrepaid && A.pending()) { const y = A.yard(); if (y.length) A.load(y[0].id); }
    env.runBatch();
    if (!S.batches) break;
  }
  const I = CS.Inventory, s = I.stock(); for (const m in s) I.sellMat(m);
}
module.exports = { mk, fakeEl, playRound, runYard };
