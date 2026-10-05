// Bin valuation (#35, #52): a contaminant is paid no more than the material the bucket is sold as, and only sorted
// buckets (90% or more of one material) sell, at a premium that rises with purity. Run: node tests/valuation.js
require('../js/data.js'); require('../js/sim.js');
const { MATERIALS, Sim } = globalThis.CS;
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
Sim.prices.market = 1;
const psd = (mass) => { const a = new Float64Array(Sim.NB); const i = Math.floor(Sim.NB / 2); a[i] = mass; return a; };
// make a bin whose pieces sit in each material's ideal size range, by kg
function bin(kg, form) { const m = {}; for (const k in kg) m[k] = psd(kg[k]); return Sim.binStats(m, form); }

console.log('== contaminants in a straight grade ==');
const sinks = bin({ steel: 900, copper: 60, brass: 25, potmetal: 15 });
const pureSteel = bin({ steel: 1000 });
check(sinks.perMat.copper.priceFactor < 0.1, 'copper in a 90% ferrous bucket is paid at the steel price, not the copper price (factor ' + sinks.perMat.copper.priceFactor.toFixed(3) + ')');
const ratio = sinks.value / pureSteel.value;
check(ratio < 1.01, 'a 90% ferrous bucket is worth about as much as the same mass of steel (ratio ' + ratio.toFixed(3) + ')');
const naive = (900 * MATERIALS.steel.sell + 60 * MATERIALS.copper.sell + 25 * MATERIALS.brass.sell + 15 * MATERIALS.potmetal.sell) / 1000;
check(sinks.value < naive * 0.4, 'far below the old own-price sum ($' + sinks.value.toFixed(0) + ' vs $' + naive.toFixed(0) + ' per t)');
check(sinks.perMat.steel.priceFactor === 1, 'the dominant material keeps its own price');

console.log('== everything must be sorted to be sold (#52) ==');
const zorba = bin({ aluminum: 650, copper: 100, brass: 80, potmetal: 120, plastic: 50 });
check(!zorba.sellable && zorba.value === 0 && zorba.klass === null, 'a mixed non-ferrous bucket (old "zorba") is MISC now: it sells for nothing until it is sorted');
const at89 = bin({ aluminum: 890, plastic: 110 }), at90 = bin({ aluminum: 900, plastic: 100 });
check(!at89.sellable && at89.value === 0 && at90.sellable && at90.value > 0, 'the line is 90% of one material: 89% aluminum is MISC, 90% sells');
check(bin({ steel: 600, castiron: 320, plastic: 80 }).sellable, 'a trade group counts as one material: steel plus cast iron is sorted ferrous');
const g = [0.9, 0.95, 0.99, 1].map(Sim.pureGrade);
check(Math.abs(g[0] - 0.85) < 1e-9 && Math.abs(g[1] - 1) < 1e-9 && Math.abs(g[2] - 1.25) < 1e-9 && g[3] === 1.25 && Sim.pureGrade(0.89) === 0, 'the purity premium: 85% of list at 90% pure, list at 95%, 125% at 99% and up');
const s95 = bin({ steel: 950, plastic: 50 }), s99 = bin({ steel: 999, plastic: 1 });
check(s99.value > s95.value * 1.15, 'a 99.9% steel bucket pays well above a 95% one ($' + s99.value.toFixed(0) + ' vs $' + s95.value.toFixed(0) + ' per t)');
check(s99.main === 'steel' && at90.main === 'aluminum', 'binStats names the main material of the bucket');

console.log('== furnace products are not touched ==');
const ing = bin({ aluminum: 950, copper: 50 }, 'ingot');
check(ing.klass === null && ing.perMat.copper.priceFactor === 1, 'ingot and dross keep their own pricing rules');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nvaluation checks pass');
process.exit(fails ? 1 : 0);
