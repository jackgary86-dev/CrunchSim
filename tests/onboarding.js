// Ticket #25: the onboarding module must load in Node without a DOM, carry the inline process cartoon with its six
// stage ids, and run its CS.app hooks (load, boot, tick, batchStart, save) without touching document or window.
const assert = require('assert');
const path = require('path');
const MOD = path.join(__dirname, '..', 'js', 'modules', 'onboarding.js');
const fresh = () => { delete require.cache[require.resolve(MOD)]; };
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

/* 1. bare Node: no CS, no CS.app, no document */
delete globalThis.CS;
assert.doesNotThrow(() => require(MOD), 'module must not throw without a DOM'); checks++;
const OB = globalThis.CS && globalThis.CS.Onboarding;
ok(OB && typeof OB.SVG === 'string' && OB.SVG.length > 1000, 'CS.Onboarding.SVG is exported');
ok(typeof globalThis.CS.app === 'undefined', 'module does not fake a CS.app');

const IDS = ['stage-auction', 'stage-haulin', 'stage-offload', 'stage-shred', 'stage-sort', 'stage-sell'];
for (const id of IDS) ok(OB.SVG.includes('id="' + id + '"'), 'embedded SVG contains ' + id);
ok(OB.STAGES.length === 6 && OB.STAGES.every((s, i) => IDS[i] === 'stage-' + s.id && s.n === i + 1), 'STAGES mirror the six ids in order');
for (const s of OB.STAGES) ok(s.targets.length > 0 && s.targets.every((t) => /^#[a-z-]+$/.test(t)), 'stage ' + s.id + ' names panel selectors');
{ // #311: a stage whose panel lives in a drawer opens that drawer; none points at a stashed panel (feed, bank)
  const by = (id) => OB.STAGES.find((s) => s.id === id);
  ok(by('auction').drawer === 'auction' && by('sell').drawer === 'sell' && by('sell').targets[0] === '#inventory-panel', 'auction and sell stages open their drawers; sell points at the Sell drawer');
  ok(OB.STAGES.every((s) => s.targets.every((t) => t !== '#feed-panel' && t !== '#bank-panel')), 'no stage points at the stashed feed or bank panels');
  ok(by('haulin').targets[0] === '#lot-card' && by('offload').targets[0] === '#lot-card', 'haul in and offload point at the loaded-lot card');
  ok(/if \(st\.drawer\) L\.showDrawer\(st\.drawer\)/.test(require('fs').readFileSync(MOD, 'utf8')), 'goStage opens the drawer before it looks for the panel');
}
ok((OB.SVG.match(/data-stage="/g) || []).length >= 12, 'captions and scenes both carry data-stage');

ok(/<svg [^>]*viewBox="0 0 1800 620"/.test(OB.SVG), 'viewBox kept so the strip scales');
ok(!/<svg [^>]*\swidth="1800"/.test(OB.SVG), 'fixed width dropped from the root element');
ok(!/<style/.test(OB.SVG), 'no <style> inside the inline SVG (rules are scoped in CS.Onboarding.CSS)');
ok(!/<\/script/i.test(OB.SVG + OB.CSS), 'bundle-safe: tools/build.py inlines this file in a <script>');
ok(!/`|\$\{/.test(OB.SVG), 'template-literal safe');

// every href="#x" / url(#x) reference resolves to an id defined in the same SVG (catches typos from the cp- prefixing)
const defined = new Set(Array.from(OB.SVG.matchAll(/id="([^"]+)"/g), (m) => m[1]));
for (const m of OB.SVG.matchAll(/(?:href="#|url\(#)([^")]+)/g)) ok(defined.has(m[1]), 'reference #' + m[1] + ' resolves');
for (const id of defined) ok(/^(cp-|stage-)/.test(id), 'id ' + id + ' is namespaced');

// motion hooks: four truck wheels and four falling chunks, each inside a positioning wrapper, and reduced-motion respected
ok((OB.SVG.match(/<g transform="translate\(\d+,92\)"><use href="#cp-wheel" class="cp-wheel"\/><\/g>/g) || []).length === 4, 'four wrapped truck wheels');
ok((OB.SVG.match(/class="thin cp-fall"/g) || []).length === 4, 'four bobbing chunks');
ok(/\.cs-process \.cp-wheel \{[^}]*animation:/.test(OB.CSS) && /\.cs-process \.cp-fall \{[^}]*animation:/.test(OB.CSS), 'wheel and chunk animations defined');
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/.test(OB.CSS), 'prefers-reduced-motion disables the motion');
ok(/max-width: 100%/.test(OB.CSS) && /\.cs-hl \{/.test(OB.CSS) && /\.cs-tour \{/.test(OB.CSS), 'stylesheet covers the strip, the highlight and the tour');
ok(OB.STEPS.length === 3 && OB.STEPS[2].targets[0] === '#btn-run', 'three tour steps ending at RUN BATCH');

/* 2. the game loaded and a fake CS.app that mirrors app.js's hook interface, still without a DOM */
fresh();
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
const hooks = {};
let saves = 0;
const app = {
  booted: true,
  S: { batches: 0, ext: {} },
  on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); if (evt === 'boot' && app.booted) fn(); },
  emit(evt, p) { (hooks[evt] || []).forEach((fn) => fn(p)); },
  save() { saves++; },
  log() {}
};
globalThis.CS.app = app;
assert.doesNotThrow(() => require(MOD), 'module must wire up against CS.app without a DOM'); checks++;
const ext = () => Object.assign({}, ...hooks.save.map((fn) => fn() || {}));
ok(hooks.boot && hooks.save && hooks.load && hooks.batchStart && hooks.tick, 'registers boot, save, load, batchStart and tick hooks');
ok(ext().onboarding && ext().onboarding.done === false, 'fresh save: tour not yet done');
assert.doesNotThrow(() => {
  app.emit('load', { onboarding: { done: true } });
  app.emit('boot'); app.emit('render'); app.emit('tick', { dt: 0.016, dh: 0 });
  app.emit('batchStart', { run: {} }); app.emit('batchComplete', { r: {}, why: 'complete', net: 0, bins: [], cs: null });
}, 'hooks run without a DOM'); checks++;
ok(ext().onboarding.done === true, 'a persisted done flag survives load -> save');
app.emit('load', {}); ok(ext().onboarding.done === false, 'an empty save resets the flag');
app.emit('load', { onboarding: { done: 1 } }); ok(ext().onboarding.done === true, 'truthy flag normalised to boolean');
ok(saves === 0, 'no save is forced while no tour ran');

console.log('onboarding: ' + checks + ' checks passed');
