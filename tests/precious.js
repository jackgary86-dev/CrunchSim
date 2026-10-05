// Gold, silver and the electronics feeds (#53): real properties, grams per tonne in the feed, and a sensor sorter that
// concentrates them pass by pass until the bucket is pure enough to sell. Run: node tests/precious.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/market.js'); require('../js/modules/inventory.js');
const { MATERIALS, MAT_ORDER, FEEDS, Sim, Inventory: Inv } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';

const G = MATERIALS.gold, A = MATERIALS.silver;
check(MAT_ORDER.includes('gold') && MAT_ORDER.includes('silver'), 'gold and silver are in the material list');
check(Math.abs(G.density - 19.32) < 0.01 && Math.abs(A.density - 10.49) < 0.01, 'handbook densities: gold 19.32, silver 10.49 g/cm3');
check(!G.magnetic && !A.magnetic && A.sigma > MATERIALS.copper.sigma && G.sigma < MATERIALS.copper.sigma, 'non-magnetic; silver conducts better than copper, gold a little worse');
check(G.sell > 1000 * MATERIALS.copper.sell && A.sell > 50 * MATERIALS.copper.sell && G.sell > 50 * A.sell, 'gold is worth thousands of times copper, silver tens of times');
check(G.tags.includes('precious') && A.tags.includes('precious') && Sim.PRECIOUS.includes('gold'), 'both are tagged precious');
check(Inv.UNITS.gold.kg === 1 && Inv.UNITS.silver.kg === 31, 'gold is held in kilo bars, silver in 31 kg (1,000 oz) bars');

const E = FEEDS.ewaste.comp;
check(E.gold > 0.0001 && E.gold < 0.0005 && E.silver > 0.0005 && E.silver < 0.002, 'circuit boards carry 100-500 g/t gold and 0.5-2 kg/t silver (' + f(E.gold * 1e6, 0) + ' g and ' + f(E.silver * 1e6, 0) + ' g)');
check(FEEDS.pins.comp.gold > E.gold * 5, 'plated pins and contacts are far richer in gold than boards');

/* a hammermill then sensor sorters in series, each set to gold, each fed the last one's extract */
function chain(k) {
  const nodes = [{ m: 'hammer', s: { grate: 30, rpm: 100 }, src: 'feed' }];
  for (let i = 0; i < k; i++) nodes.push({ m: 'sensor', s: { target: 'gold' }, src: (i + 1) + ':' + (i ? 'extract' : 'product') });
  const line = Sim.buildLine({ nodes }), ev = Sim.evalLine(line, E);
  const t = ev.terminals.find((x) => x.uid === line[k].uid && x.port === 'extract');
  return Sim.binStats(t.stream.m);
}
const goldFrac = (st) => st.perMat.gold ? st.perMat.gold.mass / st.total : 0;
const shares = [1, 2, 3, 4].map((k) => goldFrac(chain(k)));
console.log('  gold share after 1-4 passes: ' + shares.map((s) => f(s * 100, 1) + '%').join(', '));
check(shares[0] < 0.05 && shares[1] > shares[0] && shares[2] > shares[1], 'each sensor pass concentrates the gold');
const four = chain(4);
check(four.sellable && four.main === 'gold' && four.value > 1000, 'four passes make a sellable gold bucket worth $' + f(four.value, 0) + ' per tonne of boards');
check(!chain(1).sellable && Sim.binMatters(chain(1)), 'one pass is a concentrate: still MISC, but it counts (it holds gold)');
const dust = Sim.binStats({ gold: (() => { const a = new Float64Array(Sim.NB); a[10] = 0.0002; return a; })() });
check(dust.total < 0.5 && Sim.binMatters(dust), 'a bin of a few grams of gold is never dropped as dust');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' precious-metal checks pass');
process.exit(fails ? 1 : 0);
