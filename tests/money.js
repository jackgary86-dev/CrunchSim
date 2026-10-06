// The one money formatter (#261): CS.Score.fmtMoney, shared by app.js, economics.js and plant3d.js. Run: node tests/money.js
const { load } = require('./app-env.js');
const { CS, app } = load();
const f = CS.Score.fmtMoney;
let fails = 0, n = 0;
function eq(got, want) { n++; const ok = got === want; console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(got) + (ok ? '' : ' wanted ' + JSON.stringify(want))); if (!ok) fails++; }

console.log('=== whole dollars under a million');
eq(f(0), '$0'); eq(f(999), '$999'); eq(f(1234.5), '$1,235'); eq(f(-250), '-$250'); eq(f(999999), '$999,999');
console.log('=== never negative zero');
eq(f(-0.4), '$0'); eq(f(-0), '$0'); eq(f(-0.5), '-$1');
console.log('=== M, B and T');
eq(f(1e6), '$1.00M'); eq(f(60e6), '$60.00M'); eq(f(-2.5e6), '-$2.50M');
eq(f(1e9), '$1.00B'); eq(f(12.345e9), '$12.35B'); eq(f(1e12), '$1.00T'); eq(f(-1e12), '-$1.00T'); eq(f(1e15), '$1,000.00T');
console.log('=== rounding at a boundary steps up a unit');
eq(f(999999.6), '$1.00M'); eq(f(999.999e6), '$1.00B'); eq(f(999.999e9), '$1.00T');
console.log('=== bad input');
eq(f(NaN), '--'); eq(f(Infinity), '--'); eq(f(-Infinity), '--'); eq(f(undefined), '--'); eq(f(null), '--');
console.log('=== the game and the modules use it');
eq(app.fmtMoney(1e9), '$1.00B'); eq(app.fmtMoney(NaN), '--'); eq(app.fmtMoney(-0.4), '$0');
const ev = { nodes: [], terminals: [] };
const pr = CS.Economics.projectBatch({ rev: 1e9, feedC: 2e9, powerC: 0, extra: 0, wearC: 0, margin: -1e9 }, 1, ev.nodes);
n++; if (/\$2\.00B/.test(pr.reason) && /\$1\.00B/.test(pr.reason)) console.log('  ok   economics reason: ' + pr.reason); else { fails++; console.log('  FAIL economics reason: ' + pr.reason); }
console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed');
process.exit(fails ? 1 : 0);
