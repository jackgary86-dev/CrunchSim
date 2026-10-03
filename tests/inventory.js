// Exercises the DOM-free parts of js/modules/inventory.js: units, bin absorption (mass and value preserved),
// the seeded market walk (reproducible from the clock, bounded), selling and save/load round trips.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/inventory.js');
const { MATERIALS, MAT_ORDER, FEEDS, LINES, Sim, Inventory: Inv } = globalThis.CS;
const f = (x, d = 2) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* ---- units ---- */
check(Inv.unitFor('steel', 60).name === 'bale' && Inv.unitFor('aluminum', 30).name === 'bale' && Inv.unitFor('plastic', 8).name === 'bale', 'steel, aluminum and plastic go in bales');
check(Inv.unitFor('rubber', 50).name === 'bale' && Inv.unitFor('rubber', 1).name === 'big bag', 'rubber shred is baled, crumb goes in big bags');
check(Inv.unitFor('wood', 20).name === 'big bag' && Inv.unitFor('glass', 10).name === 'big bag', 'wood chips and glass go in big bags');
check(Inv.unitFor('granite', 20).name === 'bin' && Inv.unitFor('limestone', 0.3).name === 'big bag', 'stone goes in bins, rock flour in big bags');
check(Inv.unitFor('gel', 0.01).name === 'drum' && Inv.unitFor('water', 0.05).name === 'drum', 'gel and water go in drums');
check(MAT_ORDER.every((m) => Inv.UNITS[m] && Inv.UNITS[m].kg > 0), 'every material has a unit with a positive mass');
check(near(Inv.unitsOf('steel', 12, 60).n, 12) && near(Inv.unitsOf('wood', 0.3, 20).n, 1) && near(Inv.unitsOf('water', 1, 0.05).n, 5), 'unit counts: 12 t steel = 12 bales, 0.3 t chips = 1 big bag, 1 t water = 5 drums');
check(Inv.fmtUnits(1, 'bale') === '1 bale' && Inv.fmtUnits(2.46, 'big bag') === '2.5 big bags' && Inv.fmtUnits(12.4, 'drum') === '12 drums', 'unit formatting');

/* ---- bins from a real line ---- */
function binsOf(preset, feed) {
  const line = Sim.buildLine(preset), ev = Sim.evalLine(line, FEEDS[feed].comp);
  return ev.terminals.map((t) => ({ key: t.key, uid: t.uid, port: t.port, st: Sim.binStats(t.stream.m) })).filter((b) => b.st.total > 0.5);
}
function binsValuePerT(bins) { return bins.reduce((v, b) => v + b.st.value, 0); }
function binsMassPerT(bins, mat) { return bins.reduce((m, b) => m + (b.st.perMat[mat] ? b.st.perMat[mat].mass : 0), 0); }

Sim.prices.market = 1;
const carBins = binsOf(LINES.car, 'elv');
const stock = Inv.newStock();
const produced = Inv.absorbBins(stock, carBins, 15);
console.log('car line x 15 t produced: ' + Object.keys(produced).map((m) => m + ' ' + Inv.fmtUnits(produced[m].n, produced[m].unit)).join(', '));
let massOk = true;
for (const mat in stock) if (!near(stock[mat].t, binsMassPerT(carBins, mat) / 1000 * 15)) massOk = false;
check(massOk && Object.keys(stock).length > 3, 'absorbBins keeps every material\'s tonnage (bins are per head-tonne, scaled by the batch)');
const baseAfterOne = MAT_ORDER.reduce((v, m) => v + Inv.baseValue(stock, m), 0);
check(near(baseAfterOne, binsValuePerT(carBins) * 15, 1e-9), 'value is preserved on absorption: stock base value = sum of bin values x tonnes (' + f(baseAfterOne, 0) + ')');
check(MAT_ORDER.every((m) => !stock[m] || (stock[m].purity > 0 && stock[m].purity <= 1 && stock[m].grade > 0 && stock[m].grade <= 1 && stock[m].sf > 0 && stock[m].sf <= 1 && stock[m].p80 > 0)), 'purity, grade, size factor and p80 are in range');
// the magnet bin is 89% steel + 11% cast iron: both ferrous, so the price grade is ~1 while steel's own purity is below 90%
check(stock.steel && stock.steel.purity > 0.8 && stock.steel.grade > 0.95, 'steel from the car line is held at high purity and full ferrous grade (purity ' + f(stock.steel ? stock.steel.purity * 100 : 0, 0) + '%, grade ' + f(stock.steel ? stock.steel.grade * 100 : 0, 0) + '%)');

// a second, different batch merges into the same lots and still preserves value
const quarryBins = binsOf(LINES.quarry, 'quarry');
Inv.absorbBins(stock, quarryBins, 30);
const baseAfterTwo = MAT_ORDER.reduce((v, m) => v + Inv.baseValue(stock, m), 0);
check(near(baseAfterTwo, binsValuePerT(carBins) * 15 + binsValuePerT(quarryBins) * 30, 1e-9), 'merging a second batch (quarry, 30 t) preserves the combined value (' + f(baseAfterTwo, 0) + ')');
check(near(stock.granite.t, binsMassPerT(quarryBins, 'granite') / 1000 * 30), 'granite tonnage from the quarry batch is right');

// hand-made merge: two lots of the same material, different grade and size factor
{
  const s = Inv.newStock();
  Inv.addLot(s, 'copper', 2, 1.0, 1.0, 1.0, 20);
  Inv.addLot(s, 'copper', 1, 0.5, 0.4, 0.5, 2);
  check(near(s.copper.t, 3) && near(s.copper.purity, (2 * 1 + 1 * 0.5) / 3) && near(s.copper.grade, (2 * 1 + 1 * 0.4) / 3), 'merge: tonnes, purity and grade are mass-weighted');
  check(near(Inv.baseValue(s, 'copper'), MATERIALS.copper.sell * (2 * 1 * 1 + 1 * 0.4 * 0.5)), 'merge: t x grade x sf equals the sum of the lots\' value terms');
  check(near(s.copper.p80, Math.exp((2 * Math.log(20) + Math.log(2)) / 3)), 'merge: p80 is the mass-weighted geometric mean');
}

/* ---- market ---- */
const m1 = Inv.marketAt(1000), m2 = Inv.newMarket(); Inv.marketAdvance(m2, 400); Inv.marketAdvance(m2, 1000);
check(m1.hour === 1000 && MAT_ORDER.every((m) => m1.drift[m] === m2.drift[m] && m1.trend[m] === m2.trend[m]), 'market at hour 1000 is the same whether reached in one go or in two steps');
check(MAT_ORDER.every((m) => Inv.marketAt(1000).drift[m] === m1.drift[m]), 'market path is reproducible from the clock (pure function of the hour)');
let bounded = true, moved = 0, maxAbs = 0; const mLong = Inv.newMarket();
for (let h = 1; h <= 20000; h++) { Inv.marketStep(mLong); for (const m of MAT_ORDER) { const d = mLong.drift[m]; if (!(d >= Inv.DRIFT_MIN && d <= Inv.DRIFT_MAX)) bounded = false; maxAbs = Math.max(maxAbs, Math.abs(d - 1)); } }
for (const m of MAT_ORDER) if (Math.abs(mLong.drift[m] - 1) > 0.01) moved++;
check(bounded, 'drift stays within ' + Inv.DRIFT_MIN + '..' + Inv.DRIFT_MAX + ' over 20000 sim hours (max excursion ' + f(maxAbs * 100, 1) + '%)');
check(moved >= 5, 'prices actually move: ' + moved + ' of ' + MAT_ORDER.length + ' materials are more than 1% off list after 20000 h');
check(Math.abs(Inv.marketAt(1).drift.steel - 1) < 0.02, 'one hour moves a price only slightly (' + f((Inv.marketAt(1).drift.steel - 1) * 100, 2) + '%)');
const mA = Inv.marketAt(200), mB = Inv.marketAt(200);
check(MAT_ORDER.every((m) => Inv.priceOf(m, mA, 1.16) === MATERIALS[m].sell * 1.16 * mB.drift[m]), 'price = sell x market multiplier x drift');
check(['▲', '▼', '►'].includes(Inv.trendArrow(mLong, 'steel')), 'trend arrow is one of up, down, flat');
check(Inv.marketAdvance(Inv.newMarket(), -5).hour === 0 && Inv.marketAdvance(Inv.newMarket(), 2.9).hour === 2, 'marketAdvance floors the hour and ignores negative targets');

/* ---- selling ---- */
{
  const s = Inv.newStock(); Inv.absorbBins(s, carBins, 15);
  const mk = Inv.marketAt(300), mul = 1.08;
  const before = Inv.stockTotals(s, mk, mul);
  const e = Object.assign({}, s.steel);
  const r = Inv.sell(s, 'steel', mk, mul);
  check(r && near(r.proceeds, e.t * MATERIALS.steel.sell * mul * mk.drift.steel * e.grade * e.sf) && !s.steel, 'selling steel pays t x sell x market x drift x grade x sf and removes the lot');
  check(r.unit === 'bale' && near(r.n, e.t * 1000 / Inv.UNITS.steel.kg), 'sold lot reports its units');
  check(Inv.sell(s, 'steel', mk, mul) === null, 'selling an empty lot returns null');
  const all = Inv.sellAll(s, mk, mul);
  check(near(all.proceeds + r.proceeds, before.value) && Object.keys(s).length === 0, 'SELL ALL pays exactly the stock value and empties the stock');
  check(before.units > 0 && near(before.t, carBins.reduce((t, b) => t + b.st.total, 0) / 1000 * 15), 'stock totals report units and the batch tonnage');
}

/* ---- persistence ---- */
{
  const s = Inv.newStock(); Inv.absorbBins(s, carBins, 15); Inv.absorbBins(s, quarryBins, 30);
  const mk = Inv.marketAt(777);
  const saved = JSON.parse(JSON.stringify(Inv.serialize(s, mk)));
  const back = Inv.deserialize(saved);
  check(back.hadMarket && back.mkt.hour === 777 && MAT_ORDER.every((m) => back.mkt.drift[m] === mk.drift[m]), 'market state round-trips through JSON');
  check(MAT_ORDER.every((m) => (!s[m] && !back.stock[m]) || (near(s[m].t, back.stock[m].t) && near(Inv.baseValue(s, m), Inv.baseValue(back.stock, m)))), 'stock tonnes and value round-trip through JSON');
  Inv.marketAdvance(back.mkt, 1000);
  check(MAT_ORDER.every((m) => back.mkt.drift[m] === Inv.marketAt(1000).drift[m]), 'a restored market continues on the same path as an uninterrupted one');
  const junk = Inv.deserialize({ stock: { steel: { t: 'x' }, unobtainium: { t: 5 }, copper: { t: 2, purity: 7, grade: -1, sf: 9, p80: -3 } }, market: { hour: 'soon', drift: 1 } });
  check(!junk.hadMarket && !junk.stock.steel && !junk.stock.unobtainium && junk.stock.copper && junk.stock.copper.purity === 1 && junk.stock.copper.grade === 0 && junk.stock.copper.sf === 1 && junk.stock.copper.p80 > 0, 'garbage input is clamped or dropped');
  check(Inv.deserialize(null).mkt.hour === 0 && Object.keys(Inv.deserialize(undefined).stock).length === 0, 'missing save gives fresh state');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' inventory checks pass'));
process.exit(fails ? 1 : 0);
