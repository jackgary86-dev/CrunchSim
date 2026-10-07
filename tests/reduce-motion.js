// #258: the reduce-motion setting follows the OS when nothing is stored, survives blocked storage, and the CSS/canvas loops honour it.
// Run: node tests/reduce-motion.js
const fs = require('fs'), path = require('path');
global.window = undefined;
require('../js/data.js'); require('../js/modules/modes.js');
const M = globalThis.CS.Modes;
let fails = 0, n = 0;
function check(c, msg) { n++; if (!c) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

check(M.motionPref(null, true) === true && M.motionPref(null, false) === false, 'nothing stored: follow the OS setting');
check(M.motionPref('0', true) === false && M.motionPref('1', false) === true, 'a stored choice beats the OS setting');
const modes = read('js/modules/modes.js');
check(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(modes) && /rmMem/.test(modes), 'modes.js reads matchMedia and keeps an in-memory fallback');
const css = read('css/style.css');
check(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'style.css has a prefers-reduced-motion query');
check(/color-scheme:\s*dark/.test(css), 'style.css declares color-scheme: dark');
check(/reduce-motion'\) === true\) dt = 0/.test(read('js/modules/layout.js')), 'the mini cam and heap loop freeze under reduce-motion');
check(/contains\('reduce-motion'\) === true \? 0 : dt/.test(read('js/app.js')), 'the main cam freezes under reduce-motion');

// #282: the plant floor and the gallery read the same choice through CS.reduceMotion()
{
  const G = globalThis, CS = G.CS, st = {}; let os = false;
  G.localStorage = { getItem: (k) => (k in st ? st[k] : null) }; G.matchMedia = () => ({ matches: os });
  check(CS.reduceMotion() === false, 'reduceMotion: nothing stored and no OS setting is off');
  os = true; check(CS.reduceMotion() === true, 'reduceMotion: follows the OS setting');
  st['crunchsim.reduceMotion'] = '0'; check(CS.reduceMotion() === false, 'reduceMotion: the in-game toggle beats the OS');
  os = false; st['crunchsim.reduceMotion'] = '1'; check(CS.reduceMotion() === true, 'reduceMotion: the toggle turns it on');
  G.localStorage = { getItem: () => { throw new Error('SecurityError'); } }; os = true; check(CS.reduceMotion() === true, 'reduceMotion: blocked storage falls back to the OS');
  const p3 = read('js/plant3d.js'), gal = read('gallery.html');
  check(/CS\.reduceMotion\(\)/.test(p3) && /R3\.step\(still \? 0 : dt/.test(p3), 'plant3d.js freezes belts, fragments and drops');
  check(/CS\.reduceMotion\(\)/.test(gal) && /still \? 0/.test(gal), 'gallery.html draws still frames');
  check(/prefers-reduced-motion: reduce\) \{ #view-status/.test(read('plant3d.html')), 'plant3d.html stops the blinking status');
}
console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' reduce-motion checks pass'));
process.exit(fails ? 1 : 0);
