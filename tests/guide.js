// The guided first lot (#79). Run: node tests/guide.js
require('../js/data.js'); require('../js/modules/guide.js');
const { Guide: G } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const ids = G.STEPS.map((s) => s.id);
check(ids.join() === 'buy,bin,run,buckets,sell,pair,lot', 'seven steps in order: buy, the BIN, run, the buckets, sell, more sorters, the rest of the lot');
check(G.STEPS.every((s) => s.title && s.text && s.target && (s.wait || s.next)), 'every step has words, a target on the screen, and either waits for an action or a GOT IT');
const done = {};
check(G.nextStep(done, { loaded: false, batches: 0, sold: 0 }).id === 'buy', 'a new game starts at buying the lot');
check(G.nextStep(done, { loaded: true, batches: 0, sold: 0 }).id === 'bin' && done.buy, 'buying the lot moves on to the BIN');
done.bin = true;
check(G.nextStep(done, { loaded: true, batches: 0, sold: 0 }).id === 'run', 'then waits for RUN BATCH');
check(G.nextStep(done, { loaded: true, batches: 1, sold: 0 }).id === 'buckets', 'a finished batch moves on to the buckets');
done.buckets = true;
check(G.nextStep(done, { loaded: true, batches: 1, sold: 0 }).id === 'sell' && G.nextStep(done, { loaded: true, batches: 1, sold: 1 }).id === 'pair', 'selling moves on to the sorters you need for MISC');
done.pair = true; done.lot = true;
check(G.nextStep(done, { loaded: true, batches: 1, sold: 1 }) === null, 'and the guide ends');
// #256: keyboard and screen-reader access
check(G.escapeSkips('Escape', false, false, true) && G.escapeSkips('Escape', false, true, false), 'Escape skips the guide from the page or from inside it');
check(!G.escapeSkips('Escape', true, false, true) && !G.escapeSkips('Escape', false, false, false) && !G.escapeSkips('Enter', false, true, true), 'but not when something else handled it, focus is in another control, or the key is not Escape');
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'modules', 'guide.js'), 'utf8');
check(/setAttribute\('role', 'region'\)/.test(src) && /aria-live="polite"/.test(src) && /tabindex="-1"/.test(src), 'the layer is a labelled region whose box is a polite live region and can take focus');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' guide checks pass');
process.exit(fails ? 1 : 0);
