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

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' reduce-motion checks pass'));
process.exit(fails ? 1 : 0);
