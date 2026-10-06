// Market swings (ticket #33): the DOM-free parts of js/modules/market.js. The per-round walk stays inside 0.7..1.4,
// every round names one hot and one cold material in their bands, hot and cold never coincide and never repeat within
// the cooldown, the draw is seeded (same round and clock hour give the same market), history is capped at 30 rounds,
// state round-trips through JSON, and Sim.binStats honours Sim.prices.perMat.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/market.js');
const { MATERIALS, MAT_ORDER, FEEDS, LINES, Sim, Market: M } = globalThis.CS;
const f = (x, d = 2) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* ---- fresh state ---- */
const s0 = M.newState();
check(s0.round === 0 && MAT_ORDER.every((m) => M.factorOf(s0, m) === 1) && !s0.hot && !s0.cold, 'a fresh market is at list price with no hot or cold material');
check(MAT_ORDER.every((m) => M.historyOf(s0, m).length === 1 && M.historyOf(s0, m)[0] === 1), 'history starts with one round at list price');
check(M.round() === 0 && M.factor('copper') === 1 && near(M.price('copper'), MATERIALS.copper.sell * Sim.prices.market), 'live API: round 0, factor 1, price = sell x offtake multiplier');
check(M.sellable().every((m) => MATERIALS[m].sell > 0) && M.sellable().indexOf('water') < 0, 'only materials with a price can be hot or cold (water is out)');

/* ---- one round ---- */
const s1 = M.newState();
const r1 = M.step(s1, 3);
check(s1.round === 1 && r1.round === 1 && s1.hour === 3, 'a step advances the round and records the clock hour');
check(r1.hot && r1.cold && MATERIALS[r1.hot.mat] && MATERIALS[r1.cold.mat], 'round 1 names a hot and a cold material (' + r1.hot.mat + ' / ' + r1.cold.mat + ')');
check(r1.hot.mat !== r1.cold.mat, 'hot and cold are different materials');
check(r1.hot.mul >= M.HOT[0] && r1.hot.mul <= M.HOT[1] && r1.cold.mul >= M.COLD[0] && r1.cold.mul <= M.COLD[1], 'hot ' + f(r1.hot.mul) + 'x and cold ' + f(r1.cold.mul) + 'x are in their bands');
check(typeof r1.hot.why === 'string' && r1.hot.why.length > 10 && typeof r1.cold.why === 'string' && r1.cold.why.length > 10, 'each carries a one-line bulletin reason');
check(near(M.factorOf(s1, r1.hot.mat), r1.hot.mul) && near(M.factorOf(s1, r1.cold.mat), r1.cold.mul), 'the hot and cold factors override the walk this round');
check(MAT_ORDER.filter((m) => m !== r1.hot.mat && m !== r1.cold.mat).every((m) => M.factorOf(s1, m) >= M.MIN && M.factorOf(s1, m) <= M.MAX && Math.abs(M.factorOf(s1, m) - 1) < 0.2), 'every other material took a small walk step inside ' + M.MIN + '..' + M.MAX);
check(MAT_ORDER.every((m) => M.historyOf(s1, m).length === 2 && M.historyOf(s1, m)[1] === M.factorOf(s1, m)), 'history gained the round and ends on the live factor');
const v1 = M.viewOf(s1);
check(MAT_ORDER.every((m) => v1.drift[m] === M.factorOf(s1, m)) && near(v1.trend[r1.hot.mat], r1.hot.mul - 1), 'viewOf gives an inventory-shaped {drift, trend} map');
check(near(M.priceOf(s1, 'copper', 1.16), MATERIALS.copper.sell * 1.16 * M.factorOf(s1, 'copper')), 'priceOf = sell x offtake multiplier x factor');

/* ---- many rounds ---- */
const sL = M.newState();
let bounded = true, bandsOk = true, same = 0, repeats = 0, maxWalk = 0, minWalk = 9;
const seen = { hot: {}, cold: {} }; let prevTags = [];
for (let k = 1; k <= 400; k++) {
  const r = M.step(sL, k * 2);
  if (r.hot.mat === r.cold.mat) same++;
  if (prevTags.indexOf(r.hot.mat) >= 0 || prevTags.indexOf(r.cold.mat) >= 0) repeats++;
  prevTags = prevTags.concat([r.hot.mat, r.cold.mat]).slice(-2 * M.COOLDOWN);
  if (!(r.hot.mul >= M.HOT[0] && r.hot.mul <= M.HOT[1] && r.cold.mul >= M.COLD[0] && r.cold.mul <= M.COLD[1])) bandsOk = false;
  seen.hot[r.hot.mat] = (seen.hot[r.hot.mat] || 0) + 1; seen.cold[r.cold.mat] = (seen.cold[r.cold.mat] || 0) + 1;
  MAT_ORDER.forEach((m) => { const w = M.walkOf(sL, m); if (!(w >= M.MIN && w <= M.MAX)) bounded = false; maxWalk = Math.max(maxWalk, w); minWalk = Math.min(minWalk, w); });
}
check(bounded, 'the walk stays within ' + M.MIN + '..' + M.MAX + ' over 400 rounds (range ' + f(minWalk) + '..' + f(maxWalk) + ')');
check(maxWalk > 1.1 && minWalk < 0.9, 'and actually moves: it reached ' + f(minWalk) + ' and ' + f(maxWalk));
check(bandsOk && same === 0, 'hot and cold stay in band and never coincide in 400 rounds');
check(repeats === 0, 'no material is hot or cold again within ' + M.COOLDOWN + ' rounds of its last headline');
const nHot = Object.keys(seen.hot).length, nCold = Object.keys(seen.cold).length;
check(nHot >= 10 && nCold >= 10, 'headlines are spread over the materials (' + nHot + ' hot, ' + nCold + ' cold of ' + M.sellable().length + ')');
check(MAT_ORDER.every((m) => M.historyOf(sL, m).length === M.HISTORY), 'history is capped at ' + M.HISTORY + ' rounds');
check(sL.recent.length === 2 * M.COOLDOWN, 'the cooldown list holds the last ' + M.COOLDOWN + ' rounds of headlines');

/* ---- determinism ---- */
const a = M.newState(), b = M.newState(), c = M.newState();
for (let k = 1; k <= 20; k++) { M.step(a, k * 5); M.step(b, k * 5); M.step(c, k * 5 + 1); }
check(JSON.stringify(M.serialize(a)) === JSON.stringify(M.serialize(b)), 'the same rounds at the same clock hours give the same market');
check(JSON.stringify(M.serialize(a)) !== JSON.stringify(M.serialize(c)), 'different clock hours give a different market');

/* ---- persistence ---- */
{
  const saved = JSON.parse(JSON.stringify(M.serialize(a)));
  const back = M.deserialize(saved);
  check(back.round === a.round && back.hour === a.hour && MAT_ORDER.every((m) => near(M.factorOf(back, m), M.factorOf(a, m)) && near(M.walkOf(back, m), M.walkOf(a, m))), 'factors and walk round-trip through JSON');
  check(back.hot.mat === a.hot.mat && back.hot.why === a.hot.why && back.cold.mat === a.cold.mat && JSON.stringify(back.recent) === JSON.stringify(a.recent), 'hot, cold and the cooldown list round-trip');
  check(MAT_ORDER.every((m) => JSON.stringify(M.historyOf(back, m)) === JSON.stringify(M.historyOf(a, m))), 'history round-trips');
  M.step(back, 123); M.step(a, 123);
  check(JSON.stringify(M.serialize(back)) === JSON.stringify(M.serialize(a)), 'a restored market continues on the same path');
  const junk = M.deserialize({ round: -4, walk: { steel: 9, copper: 'x' }, hot: { mat: 'copper', mul: 99 }, cold: { mat: 'copper', mul: 0.1 }, recent: ['unobtainium', 'steel'], history: { steel: [1, 'a', 50, -2] } });
  check(junk.round === 0 && junk.walk.steel === M.MAX && junk.walk.copper === 1 && junk.hot.mul === M.HOT[1] && junk.cold === null && JSON.stringify(junk.recent) === '["steel"]', 'garbage input is clamped or dropped');
  check(junk.history.steel.length === 3 && junk.history.steel[1] === M.HOT[1] && junk.history.steel[2] === M.COLD[0], 'history entries are numbers clamped to the cold..hot range');
  check(M.deserialize(null).round === 0 && M.deserialize('nope').hot === null, 'missing save gives fresh state');
}

/* ---- Sim.binStats honours per-material factors ---- */
{
  const line = Sim.buildLine(LINES.car), ev = Sim.evalLine(line, FEEDS.elv.comp);
  const bins = () => ev.terminals.map((t) => Sim.binStats(t.stream.m, t.form));
  Sim.prices.market = 1; Sim.prices.perMat = {};
  const base = bins(); const cuBase = base.reduce((v, st) => v + (st.perMat.copper ? st.perMat.copper.value : 0), 0), totBase = base.reduce((v, st) => v + st.value, 0);
  Sim.prices.perMat = { copper: 2 };
  const twice = bins(); const cuTwice = twice.reduce((v, st) => v + (st.perMat.copper ? st.perMat.copper.value : 0), 0), totTwice = twice.reduce((v, st) => v + st.value, 0);
  check(cuBase > 0 && near(cuTwice, 2 * cuBase) && near(totTwice - totBase, cuBase), 'perMat copper x2 doubles the copper value in every bin and nothing else');
  Sim.prices.perMat = { copper: 0 };
  check(near(bins().reduce((v, st) => v + st.value, 0), totBase), 'a zero or missing factor counts as 1');
  Sim.prices.perMat = {};
  const st = M.newState(); M.step(st, 7); M.applyToSim(st);
  check(MAT_ORDER.every((m) => Sim.prices.perMat[m] === M.factorOf(st, m)), 'applyToSim writes every factor to Sim.prices.perMat');
  const fx = M.factorOf(st, 'steel'), stBins = bins();
  check(near(stBins.reduce((v, s) => v + (s.perMat.steel ? s.perMat.steel.value : 0), 0), fx * base.reduce((v, s) => v + (s.perMat.steel ? s.perMat.steel.value : 0), 0)), 'steel bin value follows the market factor (' + f(fx) + 'x)');
  Sim.prices.perMat = {};
}

/* ---- #213: trivial batches do not close a round ---- */
check(M.countsAsRound({ done: 40, total: 40 }, 'complete') && M.countsAsRound({ done: 1, total: 1 }, 'complete'), 'a completed batch of a tonne or more closes a round');
check(!M.countsAsRound({ done: 0.2, total: 0.2 }, 'complete') && !M.countsAsRound({ done: 0.99, total: 0.99 }, 'complete'), 'a sliver run to completion (under 1 t) does not');
check(!M.countsAsRound({ done: 0, total: 40 }, 'stopped') && !M.countsAsRound(null, 'stopped'), 'a batch that did nothing does not');
check(!M.countsAsRound({ done: 0.5, total: 40 }, 'stopped') && !M.countsAsRound({ done: 5, total: 40 }, 'stopped'), 'a start-then-STOP (under 1 t or under a quarter) does not');
check(M.countsAsRound({ done: 10, total: 40 }, 'stopped') && M.countsAsRound({ done: 12, total: 40 }, 'halted'), 'a batch stopped after a quarter of its tonnes still does');

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' market checks pass'));
process.exit(fails ? 1 : 0);
