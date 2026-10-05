// Exercises the DOM-free parts of js/modules/inventory.js: units, bin absorption (mass and value preserved),
// the seeded market walk (reproducible from the clock, bounded), selling and save/load round trips, and the
// hold-to-sell additions of ticket #34: cost basis, withdrawal for deliveries, yard storage rent, price targets and
// pricing off the market module's per-round factors.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/market.js'); require('../js/modules/inventory.js');
const { MATERIALS, MAT_ORDER, FEEDS, LINES, PLANT_UPGRADES, Sim, Inventory: Inv, Market } = globalThis.CS;
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
// #52: a sellable (pure) bin is held whole as its main material; a mixed bin goes to MISC
function heldPerT(bins, mat) { return bins.reduce((m, b) => m + (b.st.sellable && b.st.main === mat ? b.st.total : 0), 0); }
function miscPerT(bins) { return bins.reduce((m, b) => m + (b.st.sellable ? 0 : b.st.total), 0); }

Sim.prices.market = 1;
const carBins = binsOf(LINES.car, 'elv');
const stock = Inv.newStock(), misc0 = Inv.newMisc();
const produced = Inv.absorbBins(stock, carBins, 15, 0, misc0);
console.log('car line x 15 t produced: ' + Object.keys(produced).map((m) => m + ' ' + Inv.fmtUnits(produced[m].n, produced[m].unit)).join(', '));
let massOk = true;
for (const mat in stock) if (!near(stock[mat].t, heldPerT(carBins, mat) / 1000 * 15)) massOk = false;
check(massOk && Object.keys(stock).length >= 2, 'absorbBins holds each pure bin whole as its main material (bins are per head-tonne, scaled by the batch)');
check(near(Inv.miscTotal(misc0), miscPerT(carBins) / 1000 * 15) && Inv.miscTotal(misc0) > 0, 'every mixed bin goes to MISC, tonne for tonne (' + f(Inv.miscTotal(misc0), 1) + ' t)');
check(MAT_ORDER.every((m) => !stock[m] || stock[m].purity >= 0.9), 'nothing under 90% purity is held as sellable stock');
check(near(Object.keys(stock).reduce((t, m) => t + stock[m].t, 0) + Inv.miscTotal(misc0), carBins.reduce((t, b) => t + b.st.total, 0) / 1000 * 15), 'stock plus MISC is the whole batch');
const baseAfterOne = MAT_ORDER.reduce((v, m) => v + Inv.baseValue(stock, m), 0);
check(near(baseAfterOne, binsValuePerT(carBins) * 15, 1e-9), 'value is preserved on absorption: stock base value = sum of bin values x tonnes (' + f(baseAfterOne, 0) + ')');
check(MAT_ORDER.every((m) => !stock[m] || (stock[m].purity > 0 && stock[m].purity <= 1 && stock[m].grade > 0 && stock[m].grade <= 1.25 && stock[m].sf > 0 && stock[m].sf <= 1 && stock[m].p80 > 0)), 'purity, grade, size factor and p80 are in range');
// the magnet bin is 89% steel + 11% cast iron: both ferrous, so the price grade is ~1 while steel's own purity is below 90%
check(stock.steel && stock.steel.purity > 0.8 && stock.steel.grade > 0.95, 'steel from the car line is held at high purity and full ferrous grade (purity ' + f(stock.steel ? stock.steel.purity * 100 : 0, 0) + '%, grade ' + f(stock.steel ? stock.steel.grade * 100 : 0, 0) + '%)');

// a second, different batch merges into the same lots and still preserves value
const quarryBins = binsOf(LINES.quarry, 'quarry');
Inv.absorbBins(stock, quarryBins, 30);
const baseAfterTwo = MAT_ORDER.reduce((v, m) => v + Inv.baseValue(stock, m), 0);
check(near(baseAfterTwo, binsValuePerT(carBins) * 15 + binsValuePerT(quarryBins) * 30, 1e-9), 'merging a second batch (quarry, 30 t) preserves the combined value (' + f(baseAfterTwo, 0) + ')');
check(!stock.granite || near(stock.granite.t, heldPerT(quarryBins, 'granite') / 1000 * 30), 'granite tonnage from the quarry batch is right (pure aggregate bins only)');

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
  check(before.units > 0 && near(before.t, carBins.reduce((t, b) => t + (b.st.sellable ? b.st.total : 0), 0) / 1000 * 15), 'stock totals report units and the sorted tonnage of the batch');
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

/* ---- ticket #34: cost basis ---- */
{
  const s = Inv.newStock();
  const cost = 15 * 110 + 320 + 12;   // a 15 t ELV batch: feed at $110/t, $320 of power, $12 of consumables
  const produced = Inv.absorbBins(s, carBins, 15, cost);
  const allocated = MAT_ORDER.reduce((v, m) => v + (s[m] ? s[m].cost : 0), 0);
  check(near(allocated, cost), 'the batch cost is shared out over the products in full (' + f(allocated, 2) + ' of ' + cost + ')');
  const valOf = (m) => Inv.baseValue(s, m);
  check(MAT_ORDER.every((m) => !s[m] || near(s[m].cost / cost, valOf(m) / MAT_ORDER.reduce((v, k) => v + valOf(k), 0))), 'each product carries cost in proportion to its sales value at split-off');
  check(near(Object.keys(produced).reduce((v, m) => v + produced[m].cost, 0), cost), 'produced[] reports the cost that went with each material');
  check(Inv.avgCost(s, 'steel') > 0 && near(Inv.avgCost(s, 'steel'), s.steel.cost / s.steel.t), 'avgCost is $ per tonne of the lot');
  const steelBefore = s.steel.cost;
  Inv.absorbBins(s, carBins, 15, 0);
  check(near(s.steel.cost, steelBefore) && near(s.steel.t, 2 * heldPerT(carBins, 'steel') / 1000 * 15), 'a free batch (contract feed, no cost given) adds tonnes but no cost');
  const s2 = Inv.newStock(); Inv.addLot(s2, 'copper', 1, 1, 1, 1, 20, 500); Inv.addLot(s2, 'copper', 3, 1, 1, 1, 20, 100);
  check(near(s2.copper.cost, 600) && near(Inv.avgCost(s2, 'copper'), 150), 'merging lots adds their cost: $500 + $100 over 4 t = $150/t');
  const sold = Inv.sell(s2, 'copper', Inv.newMarket(), 1);
  check(near(sold.cost, 600), 'a sale reports the cost basis of what was sold');
}

/* ---- ticket #34: withdrawal for deliveries ---- */
{
  const s = Inv.newStock(); Inv.addLot(s, 'aluminum', 4, 0.95, 0.9, 1, 30, 800);
  const w = Inv.withdrawLot(s, 'aluminum', 1.5);
  check(near(w.t, 1.5) && near(w.purity, 0.95) && near(w.cost, 300) && near(s.aluminum.t, 2.5) && near(s.aluminum.cost, 500), 'withdrawing 1.5 of 4 t returns the tonnes and the lot purity and leaves the rest with its share of the cost');
  check(near(s.aluminum.grade, 0.9) && near(s.aluminum.sf, 1) && near(s.aluminum.p80, 30), 'the remaining lot keeps its grade, size factor and p80');
  const w2 = Inv.withdrawLot(s, 'aluminum', 10);
  check(near(w2.t, 2.5) && !s.aluminum, 'asking for more than is held withdraws what there is and empties the lot');
  const w3 = Inv.withdrawLot(s, 'aluminum', 1), w4 = Inv.withdrawLot(s, 'copper', -2);
  check(w3.t === 0 && w3.purity === 0 && w4.t === 0, 'withdrawing from an empty lot or a bad tonnage returns zero');
  check(typeof Inv.withdraw === 'function' && Inv.withdraw('steel', 1).t === 0 && typeof Inv.stock() === 'object', 'CS.Inventory.withdraw(material, tonnes) exists for the missions worker (nothing held here)');
}

/* ---- #52: MISC store ---- */
{
  const m = Inv.newMisc();
  Inv.addMisc(m, 'rubber', 3, 50); Inv.addMisc(m, 'rubber', 1, 20); Inv.addMisc(m, 'glass', 2, 10);
  check(near(m.rubber.t, 4) && m.rubber.p80 < 50 && m.rubber.p80 > 20 && near(Inv.miscTotal(m), 6), 'MISC merges tonnes and keeps a mean size per material');
  const w = Inv.takeMisc(m, 'rubber', 10);
  check(near(w.t, 4) && !m.rubber && near(Inv.miscTotal(m), 2), 'withdrawing from MISC never takes more than is there');
  const back = Inv.deserialize(Inv.serialize(Inv.newStock(), Inv.newMarket(), {}, m));
  check(near(Inv.miscTotal(back.misc), 2) && back.misc.glass, 'MISC round-trips through JSON');
  const old = Inv.deserialize({ stock: { steel: { t: 5, purity: 0.99, grade: 1, sf: 1, p80: 80 }, rubber: { t: 3, purity: 0.3, grade: 0.2, sf: 1, p80: 50 } } });
  check(old.stock.steel && !old.stock.rubber && near(old.misc.rubber.t, 3), 'a save from before #52: unsorted stock under 90% moves to MISC on load');
}

/* ---- ticket #34: yard storage ---- */
{
  const U = PLANT_UPGRADES.storage;
  check(U && U.levels.length === 5 && U.costs.length === 4 && U.unit === 'bays' && U.bayT > 0 && U.smallT > 0 && U.smallT < U.bayT && U.rent && U.rent.own > 0 && U.rent.hired > U.rent.own, 'PLANT_UPGRADES.storage has 5 bay levels, 4 costs, a bay size, a small-lot size and own/hired rents');
  U.levels.forEach((b, i) => check(i === 0 || (b > U.levels[i - 1] && U.costs[i - 1] > (i > 1 ? U.costs[i - 2] : 0)), 'storage level ' + i + ': ' + b + ' bays' + (i ? ' for $' + U.costs[i - 1] : '')));
  check(Inv.ownedBays(0) === U.levels[0] && Inv.ownedBays(4) === U.levels[4] && Inv.ownedBays(-1) === U.levels[0] && Inv.ownedBays(99) === U.levels[4], 'ownedBays clamps the upgrade level');
  check(Inv.baysFor(0) === 0 && Inv.baysFor(1) === 1 && Inv.baysFor(U.bayT) === 1 && Inv.baysFor(U.bayT + 0.5) === 2, 'a product takes one ' + U.bayT + ' t bay per ' + U.bayT + ' t started');
  const s = Inv.newStock(); Inv.absorbBins(s, carBins, 15);
  const held = MAT_ORDER.filter((m) => s[m] && s[m].t > 1e-6), bigLots = held.filter((m) => s[m].t >= U.smallT), small = held.filter((m) => s[m].t < U.smallT);
  const st0 = Inv.storage(s, Inv.ownedBays(0));
  const want = bigLots.reduce((n, m) => n + Math.ceil(s[m].t / U.bayT), 0) + (small.length ? 1 : 0);
  check(st0.bays === want && st0.shared.length === small.length && bigLots.every((m) => st0.perMat[m] >= 1) && small.every((m) => !st0.perMat[m]), 'a 15 t car batch takes ' + st0.bays + ' bays: ' + bigLots.join(', ') + ' alone, ' + small.length + ' small lots on the shared rack');
  check(st0.bays <= U.levels[0] && st0.hired === 0 && st0.own === st0.bays, 'so the day-one yard holds a starter batch without hiring bays (rent $' + f(st0.rent, 0) + ')');
  check(near(st0.rent, st0.own * U.rent.own + st0.hired * U.rent.hired), 'rent = owned bays x $' + U.rent.own + ' + hired bays x $' + U.rent.hired);
  check(near(Object.keys(st0.rentPerMat).reduce((v, m) => v + st0.rentPerMat[m], 0), st0.rent) && small.every((m) => near(st0.rentPerMat[m], st0.rentPerMat[small[0]])), 'the rent is shared over the materials by bays, the shared bay split evenly');
  // four car batches: aluminum, plastic and the rest grow past the small-lot size and need bays of their own
  // ten more car batches, with their MISC pile: the steel outgrows its bay and the yard has to hire
  const mi = Inv.newMisc();
  for (let k = 0; k < 10; k++) Inv.absorbBins(s, carBins, 15, 0, mi);
  const st4 = Inv.storage(s, Inv.ownedBays(0), Inv.miscTotal(mi)), st4b = Inv.storage(s, Inv.ownedBays(4), Inv.miscTotal(mi));
  check(st4.perMat.misc >= 1, 'the MISC pile takes yard bays like any product (' + f(Inv.miscTotal(mi), 1) + ' t)');
  check(st4.bays > st0.bays && st4.hired > 0 && st4.rent > st0.rent, 'after eleven batches ' + st4.bays + ' bays are in use, ' + st4.hired + ' hired: rent $' + f(st4.rent, 0) + ' per batch');
  check(st4b.hired === 0 && st4b.rent < st4.rent, 'with the yard built out nothing is hired and the rent falls to $' + f(st4b.rent, 0));
  const before = MAT_ORDER.reduce((v, m) => v + (s[m] ? s[m].cost : 0), 0);
  const charged = Inv.chargeStorage(s, Inv.ownedBays(0));
  check(near(MAT_ORDER.reduce((v, m) => v + (s[m] ? s[m].cost : 0), 0) - before, charged.rent), 'chargeStorage adds the round\'s rent to the lots\' cost basis');
  check(Inv.storage(Inv.newStock(), 2).bays === 0 && Inv.storage(Inv.newStock(), 2).rent === 0, 'an empty yard pays no rent');
  const big = Inv.newStock(); Inv.addLot(big, 'steel', 2.5 * U.bayT, 1, 1, 1, 60); Inv.addLot(big, 'copper', 1, 1, 1, 1, 20);
  check(Inv.storage(big, 2).bays === 4 && Inv.storage(big, 2).perMat.steel === 3 && Inv.storage(big, 2).shared[0] === 'copper', '150 t of steel takes 3 bays and a tonne of copper the shared one');
}

/* ---- ticket #34: price targets ---- */
{
  const s = Inv.newStock(); Inv.addLot(s, 'copper', 2, 1, 1, 1, 20); Inv.addLot(s, 'steel', 5, 1, 1, 1, 60);
  const tg = Inv.newTargets();
  check(Inv.setTarget(tg, 'copper', 9000, false).price === 9000 && tg.copper.auto === false && tg.copper.hit === false, 'a target starts armed with auto-sell off');
  check(Inv.setTarget(tg, 'unobtainium', 5, true) === null && !tg.unobtainium, 'unknown materials get no target');
  let price = { copper: 8500, steel: 300 };
  const at = (m) => price[m];
  check(Inv.targetEvents(tg, s, at).length === 0, 'below the target nothing fires');
  price.copper = 9200;
  let ev = Inv.targetEvents(tg, s, at);
  check(ev.length === 1 && ev[0].mat === 'copper' && ev[0].price === 9200 && ev[0].target === 9000 && near(ev[0].t, 2) && ev[0].auto === false, 'crossing the target fires one event with price, target, tonnes held and the auto flag');
  check(Inv.targetEvents(tg, s, at).length === 0 && tg.copper.hit === true, 'it does not fire again while the price stays above');
  price.copper = 8800; Inv.targetEvents(tg, s, at); price.copper = 9500;
  check(Inv.targetEvents(tg, s, at).length === 1, 'dropping below and rising again re-arms it');
  price.copper = 9600; Inv.setTarget(tg, 'copper', 9550, true);
  ev = Inv.targetEvents(tg, s, at);
  check(ev.length === 1 && ev[0].auto === true, 'changing the target re-arms it and the auto flag is reported');
  Inv.setTarget(tg, 'steel', 280, false); price.steel = 290;
  delete s.steel;
  check(Inv.targetEvents(tg, s, at).length === 0 && tg.steel.hit === false, 'a target on a material you no longer hold stays quiet and armed');
  Inv.addLot(s, 'steel', 1, 1, 1, 1, 60);
  check(Inv.targetEvents(tg, s, at).length === 1, 'and fires as soon as new stock arrives above it');
  Inv.setTarget(tg, 'steel', 0, true);
  check(!tg.steel, 'a zero price clears the target');
  const saved = JSON.parse(JSON.stringify(Inv.serialize(s, Inv.newMarket(), tg))), back = Inv.deserialize(saved);
  check(back.targets.copper && back.targets.copper.price === 9550 && back.targets.copper.auto === true && back.targets.copper.hit === true && !back.targets.steel, 'targets round-trip through JSON with their auto and hit flags');
  check(near(back.stock.copper.cost, s.copper.cost) && Inv.deserialize({ targets: { copper: { price: 'x' }, steel: { price: 100, auto: 'yes' } } }).targets.steel.auto === true && !Inv.deserialize({ targets: { copper: { price: 'x' } } }).targets.copper, 'cost round-trips and junk targets are dropped');
}

/* ---- ticket #33 + #34: prices off the market module ---- */
{
  const st = Market.newState(); Market.step(st, 10); Market.step(st, 20);
  const view = Market.viewOf(st);
  check(MAT_ORDER.every((m) => near(Inv.priceOf(m, view, 1.08), Market.priceOf(st, m, 1.08))), 'Inventory.priceOf on the market view equals Market.priceOf');
  check(MAT_ORDER.every((m) => near(Inv.drift(view, m), Market.factorOf(st, m))), 'the market factor is the drift the inventory prices with');
  const hot = st.hot.mat, s = Inv.newStock(); Inv.addLot(s, hot, 1, 1, 1, 1, 20);
  check(near(Inv.lotValue(s, hot, view, 1), MATERIALS[hot].sell * st.hot.mul), 'a lot of the hot material is worth the hot multiple');
  check(['▲', '▼', '►'].includes(Inv.trendArrow(view, 'steel')) && Inv.trendOf(view, hot) === 1, 'the trend arrow reads the per-round change (hot material points up)');
  check(Market.history(hot).length === 1 && Market.historyOf(st, hot).length === 3, 'sparkline history: one point live (no rounds yet), three after two rounds');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' inventory checks pass'));
process.exit(fails ? 1 : 0);
