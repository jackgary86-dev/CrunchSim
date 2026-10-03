// Bin valuation (#35): a contaminant is paid no more than the material the bucket is sold as, and a mixed non-ferrous bucket
// trades as zorba or zebra at its own price. Run: node tests/valuation.js
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

console.log('== zorba and zebra ==');
const zorba = bin({ aluminum: 650, copper: 100, brass: 80, potmetal: 120, plastic: 50 });
const zebra = bin({ aluminum: 150, copper: 350, brass: 250, potmetal: 200, plastic: 50 });
check(zorba.klass === 'zorba' && zebra.klass === 'zebra', 'mixed non-ferrous is named zorba when mostly aluminum and zebra when mostly heavies');
check(zorba.value > 500, 'an honest zorba bucket is still worth something ($' + zorba.value.toFixed(0) + ' per t)');
check(zebra.value > zorba.value, 'zebra (heavies) is worth more than zorba');
const own = (650 * MATERIALS.aluminum.sell + 100 * MATERIALS.copper.sell + 80 * MATERIALS.brass.sell + 120 * MATERIALS.potmetal.sell + 50 * MATERIALS.plastic.sell) / 1000;
check(zorba.value < own && zorba.perMat.copper.priceFactor < 1, 'a mix is paid below the sum of its metals at straight prices ($' + zorba.value.toFixed(0) + ' vs $' + own.toFixed(0) + ')');
check(bin({ aluminum: 950, copper: 50 }).klass === null, 'a 95% aluminum bucket is a straight grade, not zorba');

console.log('== furnace products are not touched ==');
const ing = bin({ aluminum: 950, copper: 50 }, 'ingot');
check(ing.klass === null && ing.perMat.copper.priceFactor === 1, 'ingot and dross keep their own pricing rules');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nvaluation checks pass');
process.exit(fails ? 1 : 0);
