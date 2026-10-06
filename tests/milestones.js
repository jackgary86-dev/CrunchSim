// Milestones (#73): goals beyond the next rank. Run: node tests/milestones.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/milestones.js');
const { Milestones: M } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const base = { sold: 0, soldValue: 0, batchBest: 0, refined: {}, goldBars: 0, sorters: 1, slots: 5, lotBest: 0, misc: 0, miscMax: 0, lotsRun: 0, rank: 0 };
const snap = (o) => Object.assign({}, base, o);

check(M.LIST.length >= 10 && new Set(M.LIST.map((m) => m.id)).size === M.LIST.length, 'ten or more milestones, each with its own id');
check(M.LIST.every((m) => m.name && m.hint && typeof m.ok === 'function'), 'each has a name, a hint and a check');
check(M.reached({}, snap({})).length === 0, 'a fresh game has reached none');
check(M.reached({}, snap({ sold: 1 })).join() === 'firstSale', 'selling a pure bucket ticks the first one');
check(M.reached({ firstSale: 1 }, snap({ sold: 3 })).length === 0, 'a milestone is reached once');
check(M.reached({}, snap({ refined: { aluminum: 1 } })).includes('ingot') && !M.reached({}, snap({ refined: { gold: 1 } })).includes('ingot'), 'refining a base metal is the first ingot; gold is not');
check(M.reached({}, snap({ goldBars: 1 })).includes('goldBar'), 'a gold bar');
check(M.reached({}, snap({ sorters: 5 })).includes('five') && M.reached({}, snap({ slots: 10 })).includes('hall'), 'five sorters, a full hall');
check(!M.reached({}, snap({ misc: 0, miscMax: 2 })).includes('clean') && M.reached({}, snap({ misc: 0, miscMax: 12 })).includes('clean'), 'MISC back to zero counts only after it grew past 10 t');
check(M.reached({}, snap({ rank: 3 })).includes('recycler') && M.reached({}, snap({ rank: 3 })).includes('operator'), 'ranks count too');
check(M.reached({}, snap({ lotBest: 100000, batchBest: 12000, lotsRun: 1 })).length === 3, 'a $100k lot, a $10k batch, a whole lot run');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' milestone checks pass');
process.exit(fails ? 1 : 0);
