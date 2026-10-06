// Overlay semantics (#198): the stack of open layers, which of them are inert, and that the page wires the module in. Run: node tests/overlays.js
require('../js/data.js'); require('../js/modules/overlays.js');
const fs = require('fs');
const O = globalThis.CS.Overlays;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

const s = O.createStack();
check(s.top() === null && s.list().length === 0, 'no layer open: no top, so Escape has nothing to close');
s.open('title'); s.open('settings');
check(s.top() === 'settings' && s.list().join() === 'title,settings', 'Settings over the title is the topmost layer');
s.open('title');
check(s.top() === 'title' && s.list().length === 2, 'opening a layer again raises it rather than listing it twice');
s.close('title');
check(s.top() === 'settings', 'closing the top hands Escape to the layer below');
s.close('nope'); s.close('settings');
check(s.top() === null, 'closing a layer that is not open is harmless');

const modal = { drawer: false, station: true, round: true, title: true };
const t = O.createStack();
check(t.inert(modal).length === 0 && !t.pageInert(modal), 'nothing open: nothing inert');
t.open('drawer');
check(!t.pageInert(modal) && t.inert(modal).length === 0, 'the drawer is not modal: the toolbar beside it stays usable');
t.open('title'); t.open('round');
check(t.pageInert(modal) && t.inert(modal).sort().join() === 'station,title', 'a modal layer makes the page and every other modal layer inert but itself');
t.close('round');
check(t.inert(modal).sort().join() === 'round,station', 'the title is the live layer again once the round closes');

/* #240: the drawer is modal exactly while it covers the screen (max-width:900px) */
const mm = (w) => (q) => ({ matches: q === '(max-width: 900px)' && w <= 900 });
check(O.isModal({ modal: false }, mm(500)) === false && O.isModal({}, mm(1400)) === true, 'modal: false is never modal, the default always is');
check(O.isModal({ modal: '(max-width: 900px)' }, mm(500)) && !O.isModal({ modal: '(max-width: 900px)' }, mm(1400)), 'a media-query layer is modal only while the query matches');
check(/modal: '[(]max-width: 900px[)]'/.test(fs.readFileSync(__dirname + '/../js/modules/layout.js', 'utf8')) && /#drawer[.]overlay [{] top: 0; width: 100%/.test(fs.readFileSync(__dirname + '/../css/style.css', 'utf8')), 'the drawer attaches with the same 900px breakpoint the CSS uses to make it full screen');

/* #248: the live sync. attach() listens for the breakpoint changing under an open layer and flips aria-modal with it */
{
  const attrs = {}, mqls = {}, el = { dataset: {}, isConnected: true, classList: { contains: () => true }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, querySelector: () => null };
  const q = '(max-width: 900px)';
  globalThis.window = { matchMedia: (s) => mqls[s] || (mqls[s] = { matches: true, listeners: [], addEventListener(ev, fn) { if (ev === 'change') this.listeners.push(fn); } }), addEventListener() {} };
  globalThis.document = { getElementById: () => null, activeElement: null, body: {} };
  globalThis.MutationObserver = class { observe() {} };
  O.attach(el, { label: 'Drawer', modal: q });
  check(attrs['aria-modal'] === 'true', 'a media-query layer attached while the query matches is aria-modal');
  const m = mqls[q]; m.matches = false; m.listeners.forEach((f) => f());
  check(!('aria-modal' in attrs) && m.listeners.length === 1, 'the matchMedia change listener drops aria-modal when the window widens past the breakpoint');
  m.matches = true; m.listeners.forEach((f) => f());
  check(attrs['aria-modal'] === 'true', 'and sets it again when the window narrows');
}

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8'), build = fs.readFileSync(__dirname + '/../tools/build.py', 'utf8');
check(html.indexOf('js/modules/overlays.js') > 0 && html.indexOf('js/modules/overlays.js') < html.indexOf('js/modules/layout.js'), 'overlays.js loads before the modules that attach layers to it');
check(/'overlays', 'layout'/.test(build), 'the single-file bundle loads it in the same place');
check(/id="log"[^>]*aria-live="polite"/.test(html) && /id="scorecard"[^>]*aria-live/.test(html), 'the event log and the score card are live regions');
check(['btn-mute', 'btn-settings', 'btn-help', 'btn-help-close'].every((id) => new RegExp('id="' + id + '"[^>]*aria-label=').test(html)), 'the icon-only buttons carry an aria-label');

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' overlays checks pass'));
process.exit(fails ? 1 : 0);
