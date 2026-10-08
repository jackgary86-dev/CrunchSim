// Tickets #31 and #32: rival bidders and rival plants. Exercises the DOM-free parts on CS.Rivals (roster, valuation through each
// rival's bias, the bid ladder, the sniper at the gavel, tender scoring, capability from the rivals' real flowsheets, job
// claims, the league, save/load) and then drives the module's CS.app hooks, with the auction and missions
// modules, against a fake app without a document.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
const { MATERIALS, FEEDS, Score } = globalThis.CS;
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }

/* ---- a fake app, so the page wiring of auction, missions and rivals registers its hooks (no DOM: panels are skipped) ---- */
const hooks = {}, logs = [];
const app = {
  booted: false,
  S: { clock: 0, money: 1e7, lifetime: 0, tons: 15, comp: {}, line: [], run: null, mr: { R: 0 }, ev: null, owned: new Set(['hammer']), suppliers: new Set(['elv', 'pallets', 'quarry', 'zorba', 'tires', 'rubble']), feedPrepaid: false, ext: {} },
  on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); if (evt === 'boot' && app.booted) fn(); },
  emit(evt, p) { (hooks[evt] || []).forEach((fn) => fn(p)); },
  veto(evt, p) { let why = ''; (hooks['veto:' + evt] || []).some((fn) => { why = fn(p) || ''; return !!why; }); return why; },
  log(msg, cls) { logs.push({ msg, cls }); },
  fmtMoney(x) { return (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)); }, fmtNum(x, d) { return isFinite(x) ? x.toFixed(d == null ? 1 : d) : '--'; }, esc(s) { return String(s); },
  spend(cost) { if (app.S.money < cost) return false; app.S.money -= cost; return true; },
  setFeed(comp, id, tons) { app.S.comp = Object.assign({}, comp); if (tons) app.S.tons = tons; },
  binList() { return []; }, plantValue() { return 30; }, save() {}, renderBank() {}, renderAll() {}, markDirty() {}, syncFeedRows() {}
};
globalThis.CS.app = app;
app.S.line = globalThis.CS.Sim.buildLine({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] });   // #360: the job board offers what the yard's line can meet: a zorba line makes clean aluminum
require('../js/modules/market.js'); require('../js/modules/auction.js'); require('../js/modules/missions.js'); require('../js/modules/rivals.js');
const { Auction: A, Missions: M, Rivals: RV, Market: MK } = globalThis.CS;
check(RV && typeof RV.valuation === 'function' && typeof RV.tender === 'function', 'CS.Rivals is exported');
check(['lotClose', 'lotPrice', 'veto:auctionBuy', 'auctionRender', 'tick', 'save', 'load', 'newgame', 'batchComplete'].every((e) => hooks[e] && hooks[e].length), 'registers lotClose, lotPrice, the auction and contract vetoes, auctionRender, tick, save, load, newgame and batchComplete');
check(A.live && typeof A.live.board === 'function' && M.live && typeof M.live.jobs === 'function', 'the auction and missions modules expose their live boards');
const byId = (id) => RV.rivalById(id);

/* ---- roster ---- */
console.log('=== roster');
check(RV.ROSTER.length >= 2 && RV.ROSTER.length <= 4, RV.ROSTER.length + ' named rivals');
check(['volume', 'copper', 'bargain', 'sniper'].every((k) => RV.ROSTER.some((R) => R.kind === k)), 'a volume buyer, a copper specialist, a bargain hunter and a late sniper');
check(RV.activeAt(0).length === 2 && RV.activeAt(1000).length === 4, 'two rivals at the start, four once the market has run a while');
check(RV.ROSTER.every((R) => RV.budgetAt(R, RV.DOUBLE_H) === 2 * R.budget && RV.budgetAt(R, 10) > R.budget), 'budgets grow with game time and double every ' + RV.DOUBLE_H + ' h');
check(RV.ROSTER.every((R) => R.lines.every((l) => RV.RLINES[l] && FEEDS[RV.RLINES[l].feed])), 'every rival flowsheet exists and names a feed');

/* ---- bid state on the auction ---- */
console.log('=== bid state');
{
  const L = { id: 1, ask: 40, tons: 10 };
  check(A.minBid(L) === 40, 'bidding opens at the seller\'s ask');
  check(!A.placeBid(L, 'x', 39, 0) && !L.bid, 'a bid under the ask is refused');
  check(A.placeBid(L, 'ironside', 40, 1) && L.bid.perT === 40 && L.bid.by === 'ironside' && L.bid.n === 1, 'a bid at the ask stands');
  check(A.minBid(L) === 42, 'the next bid is one 5% step up: $' + A.minBid(L));
  check(!A.placeBid(L, 'you', 41, 2) && A.placeBid(L, 'you', 42, 2) && L.bid.by === 'you' && L.bid.n === 2, 'a raise must clear the step');
  const T = { id: 2, ask: 5, tons: 10 }; A.placeBid(T, 'magpie', 5, 0);
  check(A.minBid(T) === 6, 'cheap lots step by at least $1/t');
  check(A.validBid(L.bid) && !A.validBid({ perT: 'x' }) && !A.validBid(null), 'validBid rejects junk');
}

/* ---- valuation through each rival's bias ---- */
console.log('=== valuation');
const FEED_SET = ['elv', 'pallets', 'quarry', 'zorba', 'tires', 'rubble'];
const lots = []; { const r = A.mulberry32(20261004); for (let i = 0; i < 400; i++) lots.push(A.genLot(r, { feeds: FEED_SET, limit: 30, clockH: 0, id: 5001 + i })); }
const iron = byId('ironside'), mag = byId('magpie'), red = byId('redline'), jay = byId('nightjar');
const bids = (R, cls) => { const s = lots.filter((L) => L.cls === cls); return s.filter((L) => RV.valuation(R, L) >= L.ask).length / s.length; };
console.log('  share of lots each rival would open: ' + RV.ROSTER.map((R) => R.id + ' great ' + bids(R, 'great').toFixed(2) + ' fair ' + bids(R, 'fair').toFixed(2) + ' terrible ' + bids(R, 'terrible').toFixed(2)).join(' | '));
check(bids(mag, 'great') > 0.8 && bids(mag, 'fair') < 0.05, 'the bargain hunter opens nearly every great lot and almost no fair one');
check(bids(iron, 'fair') > 0.3 && bids(iron, 'great') > 0.9, 'the volume buyer bids on most lots that are not overpriced');
check(lots.filter((L) => RV.valuation(mag, L) > RV.valuation(iron, L)).length === 0, 'the bargain hunter never values a lot above the volume buyer');
const noCu = lots.filter((L) => (L.declared.copper || 0) + (L.declared.brass || 0) < 0.02);
check(noCu.length > 50 && noCu.every((L) => RV.valuation(red, L) === 0), 'the copper specialist ignores the ' + noCu.length + ' lots declaring under 2% copper and brass');
const zorbaLots = lots.filter((L) => L.base === 'zorba');
const zr = zorbaLots.reduce((a, L) => a + RV.valuation(red, L) / RV.valuation(iron, L), 0) / zorbaLots.length;
check(zorbaLots.length > 10 && zr > 1, 'on zorba (' + zorbaLots.length + ' lots) the copper specialist outvalues the volume buyer on average: x' + zr.toFixed(3));
{
  const cu = { id: 77, base: 'zorba', ask: 100, tons: 5, declared: { copper: 0.5, aluminum: 0.5 } }, ratio = RV.valuation(red, cu) / RV.valuation(iron, cu);
  check(ratio > 1.15, 'and pays well over it for a copper-rich lot: x' + ratio.toFixed(2));
}
// rivals read the declaration, so they misjudge padded lots as the operator does
const padded = lots.filter((L) => L.padded), fooled = padded.filter((L) => RV.valuation(iron, L) > A.worthOf(L.truth) * A.fairRatio(L.base) * iron.appetite * 1.05);
check(padded.length > 10 && fooled.length > 0.8 * padded.length, 'the volume buyer overvalues ' + fooled.length + ' of ' + padded.length + ' padded lots against their true yard rate');
check(padded.filter((L) => RV.valuation(iron, L) >= L.ask).length > 0, 'and bids on some of them');
// the market's HOT material lifts what they pay
{
  const L = zorbaLots[0], hot = (m) => m === 'copper' ? 2.0 : 1;
  check(RV.valuation(red, L, hot) > RV.valuation(red, L) && RV.valuation(iron, L, hot) > RV.valuation(iron, L), 'a HOT copper bulletin raises every rival\'s valuation of a copper-bearing lot');
  const cold = (m) => m === 'aluminum' ? 0.5 : 1;
  check(RV.valuation(iron, L, cold) < RV.valuation(iron, L), 'a COLD aluminum bulletin lowers it');
}
check(JSON.stringify(lots.map((L) => RV.valuation(iron, L))) === JSON.stringify(lots.map((L) => RV.valuation(iron, L))), 'valuations are reproducible (seeded per rival and lot)');

/* ---- the bid ladder ---- */
console.log('=== bidding');
function ladder(seed, L, h0, hours, ctx) {
  const rng = A.mulberry32(seed), ev = [];
  for (let h = h0; h < h0 + hours; h += 0.25) RV.bidStep([L], h, 0.25, rng, ctx || {}).forEach((e) => ev.push({ by: e.by, perT: e.perT, h }));
  return ev;
}
{
  const L = JSON.parse(JSON.stringify(lots.find((x) => x.base === 'elv' && RV.activeAt(0).every((R) => RV.valuation(R, x) >= 1.2 * x.ask)))); L.expiresH = 200;
  const ev = ladder(7, L, 0, 60);
  const vals = RV.activeAt(60).filter((R) => R.kind !== 'sniper').map((R) => ({ id: R.id, v: RV.valuation(R, L) }));   // the sniper waits for the gavel
  console.log('  great ELV lot ask $' + L.ask + '/t: ' + ev.length + ' bids, high $' + L.bid.perT + '/t by ' + L.bid.by + '; valuations ' + vals.map((x) => x.id + ' $' + x.v).join(', '));
  check(ev.length >= 2 && ev.every((e, i) => i === 0 || e.perT > ev[i - 1].perT), 'bids only go up');
  check(ev.every((e, i) => i === 0 || e.by !== ev[i - 1].by), 'nobody raises its own high bid');
  const lead = vals.find((x) => x.id === L.bid.by);
  check(lead && L.bid.perT <= lead.v, 'the leader never bids over its own valuation');
  check(vals.every((x) => x.id === L.bid.by || x.v < A.minBid(L)), 'after the ladder settles no other rival values the lot at the next step');
  check(vals.every((x) => x.v <= lead.v), 'the lot ends with the rival that values it most');
  check(JSON.stringify(ladder(7, Object.assign(JSON.parse(JSON.stringify(L)), { bid: undefined }), 0, 60)) === JSON.stringify(ev), 'the same seed replays the same bids');
}
{
  const L = JSON.parse(JSON.stringify(lots.find((x) => x.cls === 'great' && x.base === 'elv' && RV.valuation(jay, x) >= x.ask))); L.expiresH = 50; delete L.bid;
  const early = ladder(9, L, 40, 9.25);   // up to 0.75 h before the gavel: outside the sniping window
  check(early.every((e) => e.by !== 'nightjar'), 'the sniper stays quiet until the last ' + RV.SNIPE_H + ' h');
  const before = L.bid ? L.bid.by : null;
  const vj = RV.valuation(jay, L), next = A.minBid(L), r = RV.closeLot(L, 50, {});
  check(vj >= next ? r.by === 'nightjar' : r.by === before, 'at the gavel the sniper takes the lot with a last-second bid when it values it at the next step (' + (vj >= next ? 'it does: $' + vj + ' vs $' + next : 'it does not') + ')');
  const U = { id: 9, ask: 999999, tons: 5, base: 'elv', declared: { steel: 1 }, expiresH: 10 };
  check(RV.closeLot(U, 50, {}) === null, 'a lot nobody bids on closes unsold');
}
{
  // budget: a rival never commits more than its credit to one lot
  const L = JSON.parse(JSON.stringify(lots.find((x) => x.base === 'zorba' && RV.valuation(iron, x) >= x.ask))); delete L.bid; L.tons = 1000; L.expiresH = 999;
  const ev = ladder(3, L, 0, 30);
  check(ev.every((e) => e.perT * L.tons <= RV.budgetAt(byId(e.by), e.h)), 'no bid commits more than the rival\'s credit at the time');
}
check(RV.buyNowPrice({ ask: 100, tons: 1 }) === 115 && RV.buyNowPrice({ ask: 100, tons: 1, bid: { perT: 200, by: 'magpie', n: 1 } }) === Math.ceil(210 * 1.15), 'buy-now is ' + Math.round(RV.BUY_NOW * 100) + '% over the next bid');

/* ---- tenders and capability ---- */
console.log('=== tenders');
{
  const t = RV.tender([{ who: 'you', fee: 100, rep: 50, hours: 4 }, { who: 'a', fee: 90, rep: 50, hours: 4 }]);
  check(t.winner.who === 'a', 'the cheaper quote wins on equal reputation and delivery');
  check(RV.tender([{ who: 'you', fee: 100, rep: 90, hours: 2 }, { who: 'a', fee: 95, rep: 20, hours: 6 }]).winner.who === 'you', 'a better record and faster delivery beat a 5% cheaper quote');
  check(RV.tender([{ who: 'you', fee: 100, rep: 40, hours: 4 }, { who: 'a', fee: 100, rep: 40, hours: 4 }]).winner.who === 'you', 'a tie stays with the yard asked first');
  check(RV.tender([{ who: 'x', fee: 0, rep: 1, hours: 1 }, { who: 'y', fee: 10, rep: 1, hours: Infinity }]) === null, 'junk candidates are dropped');
  check(Math.abs(RV.W.fee + RV.W.rep + RV.W.time - 1) < 1e-9, 'fee, reputation and delivery weights sum to 1');
}
{
  // #234: a MISC bin (not sellable) is not capability, whatever its mix says
  const mk = (sellable) => [{ st: { total: 1000, sellable, perMat: { copper: { mass: 880 } } }, form: null }];
  check(RV.jobHoursOn({ mat: 'copper', purity: 0.85, tons: 2, t: 0 }, mk(true), 10) < Infinity && RV.jobHoursOn({ mat: 'copper', purity: 0.85, tons: 2, t: 0 }, mk(false), 10) === Infinity, 'rivals and your line do not count unsellable (MISC) bins toward a job');
}
{
  // jobs on the missions board
  const rng = A.mulberry32(77), st = RV.newState(), J = M.newJobs();
  const cu = { id: 31, mat: 'aluminum', tier: 0, tons: 3.6, purity: 0.95, mult: 1.4, windowH: 20, offerExpiresH: 999, client: 'Lakeside Wire & Cable', state: 'offered', t: 0, paid: 0 };
  const pm = { id: 32, mat: 'potmetal', tier: 0, tons: 3, purity: 0.94, mult: 1.4, windowH: 20, offerExpiresH: 999, client: 'Two Rivers Die-casting', state: 'offered', t: 0, paid: 0 };
  J.board.push(cu, pm);
  check(RV.jobCap(red, cu) && (!RV.jobCap(iron, cu) || RV.jobCap(red, cu).hours < RV.jobCap(iron, cu).hours) && !RV.ROSTER.some((R) => RV.jobCap(R, pm)), 'the zorba-line specialist delivers 95% aluminum first (the car line just reaches it once water drains, #288/#323); nobody makes 94% zinc');
  RV.tenderJobs(st, 20, rng, J, {});
  const ev = RV.tenderJobs(st, 20 + RV.TENDER_H, rng, J, {});
  check(ev.length === 1 && ev[0].R.id === 'redline' && !J.board.includes(cu) && J.board.includes(pm) && st.rjobs.length === 1, 'Redline takes the aluminum job off the board after the window; the zinc job stays');
  RV.settleJobs(st, st.rjobs[0].untilH);
  check(!st.rjobs.length && st.rivals.redline.tonnes === cu.tons, 'and its tonnes count when it delivers');
  const st2 = RV.newState(), J2 = M.newJobs(); J2.board.push(Object.assign({}, cu, { tier: 2 }));
  RV.tenderJobs(st2, 0, rng, J2, {}); RV.tenderJobs(st2, RV.TENDER_H, rng, J2, {});
  check(J2.board.length === 1, 'a rival below the job\'s reputation tier cannot take it');
}
{
  const st = RV.newState(); st.you.tonnes = 50; st.rivals.ironside.tonnes = 80; st.rivals.magpie.tonnes = 10; st.you.starsSum = 5; st.you.starsN = 2;
  const rows = RV.league(st, 12, 0);
  check(rows.length === 3 && rows[0].id === 'ironside' && rows[1].id === 'you' && rows[1].rank === 2 && rows[1].stars === 2.5 && rows[1].rep === 12, 'the league ranks by tonnes delivered and shows the operator\'s rank, stars and reputation');
  check(RV.league(st, 0, 100).length === 5, 'rivals join the league as they enter the market');
}
{
  const st = RV.newState(); st.on = false; st.rivals.redline.rep = 55;
  st.results.push({ id: 7, headline: 'x', tons: 5, by: 'magpie', perT: 30, h: 2, bids: 3 });
  const back = RV.deserialize(JSON.parse(JSON.stringify(RV.serialize(st, 1234))));
  check(back.on === false && back.rivals.redline.rep === 55 && back.results[0].by === 'magpie' && back.rngState === 1234, 'state round-trips through save and load');
  const junk = RV.deserialize({ rivals: { redline: { rep: 'x' }, nobody: {} }, claims: { zorba: { by: 'nobody', untilH: 3 }, nope: { by: 'redline', untilH: 3 } }, rjobs: [{ by: 'redline', job: { mat: 'unobtainium' } }], results: 'x', losses: { zorba: { ghost: 4 } } });
  check(junk.on && junk.rivals.redline.rep === red.rep && !junk.rjobs.length && !junk.results.length, 'junk in the save is rejected');
}

/* ---- the module against the fake app ---- */
console.log('=== page wiring');
app.emit('load', app.S.ext);
const live = RV.live;
function tick(dh) { app.S.clock += dh * 3600; app.emit('tick', { dt: 0.016, dh }); }
app.S.run = { total: 1e9, done: 0, rate: 30 };   // the clock only moves while a batch runs
for (let i = 0; i < 4 * 40; i++) tick(0.25);
const st = live.state();
const rivalLots = Object.values(st.rivals).reduce((a, r) => a + r.lots, 0);
console.log('  after 40 h: ' + st.results.length + ' lots in the closed list, ' + rivalLots + ' won by rivals');
check(rivalLots > 0 && st.results.some((r) => r.by && r.by !== 'you' && r.perT > 0), 'rivals win lots at the timer and the board lists the price paid');
check(A.live.board().some((L) => L.bid) || st.results.length > 0, 'open lots carry bid state');
// the operator bids: keep the high bid until the gavel
const target = A.live.board().slice().sort((a, b) => a.expiresH - b.expiresH)[0];
check(live.raise(target.id) && target.bid.by === 'you', 'BID puts the operator on top of lot #' + target.id + ' at $' + target.bid.perT + '/t');
const other = A.live.board().find((L) => L !== target);
// #49: the yard holds several lots, so the operator may lead several and buy now while leading
check(live.raise(other.id) && other.bid.by === 'you' && target.bid.by === 'you', 'a second BID on another lot is fine: the yard holds several lots');
check(!live.raise(other.id) && /already hold/.test(logs[logs.length - 1].msg), 'but not a second bid on a lot you already lead');
check(app.veto('auctionBuy', { lot: other }) === '' && app.veto('auctionBuy', { lot: target }) === '', 'buy-now is never vetoed for leading elsewhere');
{ const q = { lot: other, perT: other.ask }; app.emit('lotPrice', q); check(q.perT === RV.buyNowPrice(other) && q.perT > other.ask, 'the buy price carries the buy-now premium: $' + other.ask + ' -> $' + q.perT + '/t'); }
const money0 = app.S.money; let paid = 0, guard = 0;
while (A.live.board().includes(target) && guard++ < 4000) { tick(0.05); if (A.live.board().includes(target) && target.bid && target.bid.by !== 'you') { live.raise(target.id); } }
const P = A.live.pending();
check(P && P.id === target.id && st.results[0].id === target.id && st.results[0].by === 'you', 'the high bid at the timer takes the lot into the yard');
if (P) { paid = money0 - app.S.money; check(Math.abs(paid - P.ask * P.tons) < 1e-6 && P.ask === st.results[0].perT && P.ask >= target.ask, 'the bank pays the winning bid, $' + P.ask + '/t x ' + P.tons + ' t'); }
check(logs.some((l) => /Won at auction: lot #/.test(l.msg)), 'the win is logged');
if (P) {
  check(P.arriving === true && !app.S.feedPrepaid, 'a lot won mid-batch waits for the line');
  const run = app.S.run; app.S.run = null;
  app.emit('batchComplete', { r: { done: 1, rev: 0 }, bins: [] });
  check(app.S.feedPrepaid && A.sameComp(app.S.comp, P.truth) && !P.arriving, 'and loads as the prepaid feed when the batch ends');
  app.S.run = run;
}
const third = A.live.board().find((L) => !(L.bid && L.bid.by === 'you'));
check(!third || live.raise(third.id), 'bidding goes on while a lot waits in the yard (#49)');
// jobs taken by rivals
for (let i = 0; i < 4 * 200; i++) tick(0.25);
console.log('  after 240 h: deliveries ' + Object.values(st.rivals).map((r) => r.deliveries).join('/'));
check(Object.values(st.rivals).some((r) => r.deliveries > 0), 'rivals win tenders and deliver');
check(RV.league(st, M.live.rep(), app.S.clock / 3600).length === 5, 'all four rivals are in the league by now');
// save, load and new game
const saved = JSON.parse(JSON.stringify(Object.assign({}, ...hooks.save.map((fn) => fn()))));
check(saved.rivals && saved.auction && saved.auction.board.every((L) => !L.bid || A.validBid(L.bid)), 'the rivals state and the lots\' bid state are saved');
app.emit('load', saved);
check(JSON.stringify(RV.serialize(live.state(), 0)) === JSON.stringify(RV.serialize(RV.deserialize(saved.rivals), 0)), 'and load back');
// sandbox switch
live.setOn(false);
check(!live.state().on && !live.state().rjobs.length && A.live.board().every((L) => !L.bid), 'the sandbox switch clears bids and claims');
check((() => { const q = { lot: A.live.board()[0], perT: A.live.board()[0].ask }; app.emit('lotPrice', q); return q.perT === A.live.board()[0].ask; })(), 'with rivals off nothing is vetoed and lots sell at the ask');
for (let i = 0; i < 4 * 20; i++) tick(0.25);
check(A.live.board().every((L) => !L.bid) && !live.state().rjobs.length, 'and no rival bids or claims while it is off');
live.setOn(true);
check(live.state().on, 'rivals come back on');
app.emit('load', {}); app.emit('newgame');
check(live.state().on && live.state().results.length === 0 && live.state().you.tonnes === 0 && Object.values(live.state().rivals).every((r) => r.lots === 0), 'a new game resets the rivals');

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' rivals checks pass'));
process.exit(fails ? 1 : 0);
