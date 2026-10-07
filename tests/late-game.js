// Late-game fixes #339-#345: a batch's product keeps the market factors it was valued at, machine units over 99 survive a reload,
// the line stops at the save code's 200 machines, jobs are sized from lots the auction deals, the $1M and $10M tiers open with
// rank and fill the top logistics levels, GROW wants a payback, big tonnages read with separators, and late milestones exist.
// Run: node tests/late-game.js
const { mk } = require('./browser-env.js');
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== #339: the product is priced at the factors its bins were valued at ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, I = CS.Inventory, A = CS.Auction.live;
  // pure: a bin valued at factor 1 that lands after the market moved copper to 2 keeps sf 1 when told the old factor
  const P = CS.Sim.prices, keep = P.perMat; P.perMat = { copper: 2 };
  const sell = CS.MATERIALS.copper.sell, mkt = P.market != null ? +P.market : 1;
  const bin = { st: { total: 1000, sellable: true, share: 1, main: 'copper', grade: 1, p80: 5, perMat: { copper: { mass: 1000, value: sell * 1 * mkt, p80: 5 } } } };
  const s1 = I.newStock(), s2 = I.newStock();
  I.absorbBins(s1, [bin], 10, 0, null, { copper: 1 }); I.absorbBins(s2, [bin], 10, 0, null);
  check(Math.abs(s1.copper.sf - 1) < 1e-6, 'with the factor it was valued at, the lot keeps size factor 1 (' + s1.copper.sf.toFixed(3) + ')');
  check(Math.abs(s2.copper.sf - 0.5) < 1e-6, 'without it, the new factor would halve it (' + s2.copper.sf.toFixed(3) + ')');
  P.perMat = keep;
  // in the game: three batches; the stock quote is the bins' value moved from the old factors to the new ones, nothing created
  let worst = 0, seen = 0;
  S.money = 1e7;
  for (let b = 0; b < 3; b++) {
    for (const m in I.stock()) I.sellMat(m);
    const L = A.dealTier(3, 'elv'); A.deliver(L, A.priceOf(L), 'Bought'); env.flush(); app.recompute();
    const pfOld = Object.assign({}, CS.Sim.prices.perMat), val = {};
    app.binList().forEach((x) => { if (x.st.sellable) val[x.st.main] = (val[x.st.main] || 0) + x.st.value; });
    const tons = S.tons; let caught = null; app.on('batchComplete', (p) => { if (!caught) caught = p; });
    env.runBatch();
    const pfNew = CS.Sim.prices.perMat;
    if (b === 0) check(!!(caught && caught.perMat), 'market.js hands the old factors on with the batch');
    for (const m in I.stock()) { if (!val[m]) continue; const exp = val[m] * tons / (pfOld[m] || 1) * (pfNew[m] || 1), q = I.quote(m); seen++; worst = Math.max(worst, Math.abs(q - exp) / Math.max(1, exp)); }
  }
  check(seen > 0 && worst < 0.02, 'each product is quoted at its bin value at the new round\'s prices (' + seen + ' lots, worst ' + (worst * 100).toFixed(2) + '%)');
}

console.log('== #340 #341: units over 99 survive a reload; a line stops at 200 machines ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env;
  S.owned.add('magnet'); S.units.magnet = 150; app.save();
  const env2 = mk({ store: { 'crunchsim.v2': env.store['crunchsim.v2'] } }); env2.flush();
  check(env2.S.units.magnet === 150, '150 magnets reload as 150 (' + env2.S.units.magnet + ')');
  const IO = CS.SaveIO;
  check(IO.MAX_LINE === 200, 'the import limit is 200 machines');
  check(IO.lineFull(199) === '' && /200/.test(IO.lineFull(200)) && /200/.test(IO.lineFull(199, 2)) && IO.lineFull(200, 0) === '', 'the 200th machine may go on, the 201st (or a pair past 200) may not');
  // a yard with every hall level and slot: only the line limit can refuse a small grinder
  S.money = 1e9; for (const k in CS.PLANT_UPGRADES) while (app.buyPlant(k)); while (CS.Slots.live.next()) CS.Slots.live.buy();
  while (S.line.length < IO.MAX_LINE - 1) S.line.push(CS.Sim.makeNode('atomizer', {}, { uid: S.line[S.line.length - 1].uid, port: 'product' }));
  check(app.veto('addMachine', { m: 'atomizer' }) === '', 'with 199 on the line the 200th may go on');
  S.line.push(CS.Sim.makeNode('atomizer', {}, { uid: S.line[S.line.length - 1].uid, port: 'product' }));
  check(/200/.test(app.veto('addMachine', { m: 'atomizer' })), 'the 201st machine is refused, naming the limit');
  check(/200/.test(app.veto('applyLine', { id: 'blueprint', nodes: new Array(201).fill({ m: 'atomizer' }) })), 'a saved line of 201 is refused');
  app.save(); const code = IO.live.exportCode(); check(IO.decode(code).ok, 'a full 200-machine line exports a code IMPORT accepts');
}

console.log('== #343 #344: the $1M and $10M tiers open with rank and fill the top logistics levels ==');
{
  const env = mk(); env.flush();
  const A = env.CS.Auction;
  check(A.tiersOpen(0) === 6 && A.tiersOpen(2) === 6 && A.tiersOpen(3) === 7 && A.tiersOpen(4) === 8 && A.tiersOpen(5) === 8, 'six tiers to Processor, $1M from Plant operator, $10M from Industrial group');
  check(A.tierLabel(5) === '$100k' && A.tierLabel(6) === '$1M' && A.tierLabel(7) === '$10M', 'tier labels read $100k, $1M, $10M');
  const allFeeds = Object.keys(env.CS.FEEDS).filter((id) => A.worthOf(env.CS.FEEDS[id].comp) > 1);
  let ok8 = true, over1k6 = 0, over3k7 = 0, priceOk = true, n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const st = { board: [], nextId: 1, market: {} }, rr = A.mulberry32(seed);
    A.tickTiers(st, rr, 0, { feeds: allFeeds, limit: 10000, market: {}, tiers: 8 });
    if (st.board.length !== 8 || st.board.some((l, k) => l.tier !== k)) ok8 = false;
    st.board.forEach((l) => { if (l.tier < 6) return; n++; const tot = l.ask * l.tons, t = A.TIERS[l.tier]; if (tot > 1.25 * t || l.tons > A.TIER_MAX_T[l.tier] + 1e-9) priceOk = false; if (l.tier === 6 && l.tons > 1000) over1k6++; if (l.tier === 7 && l.tons > 3000) over3k7++; });
  }
  check(ok8, 'at Industrial group the board deals eight lots, one per tier');
  check(priceOk, 'a top-tier lot costs at most its tier and weighs at most ' + A.TIER_MAX_T[6] + ' / ' + A.TIER_MAX_T[7] + ' t');
  check(over1k6 >= 15 && over3k7 >= 15, 'the $1M tier deals lots over 1,000 t (' + over1k6 + ' of 60) and the $10M tier over 3,000 t (' + over3k7 + ' of 60): logistics 6 and 7 have lots to carry');
  const st6 = { board: [], nextId: 1, market: {} }; A.tickTiers(st6, A.mulberry32(5), 0, { feeds: allFeeds, limit: 30, market: {} });
  check(st6.board.length === 6, 'without a rank the board stays at six');
  env.S.money = 5e7; env.CS.Auction.live.render(); env.app.renderAll(); env.tick(0.1); env.S.clock += 3600; env.tick(0.1);
  const L = env.CS.Auction.live; L.deliver(L.board()[0], L.priceOf(L.board()[0]), 'Bought'); env.flush();
  check(L.board().some((l) => l.tier === 7), 'a $50M yard sees the $10M tier on the live board (' + L.board().length + ' lots)');
}

console.log('== #342: jobs ask for what the lots at the open tiers carry ==');
{
  const env = mk(); env.flush();
  const { CS } = env, M = CS.Missions, A = CS.Auction;
  const late = M.lotSizes(8), early = M.lotSizes(6, 2800);
  check(late && Object.keys(late.lotT).every((id) => late.lotT[id] <= 10000), 'no lot is sized over 10,000 t');
  check(early && early.feeds.indexOf('pins') < 0 && early.feeds.indexOf('zorba') < 0 && early.feeds.some((id) => (CS.FEEDS[id].comp.copper || 0) > 0.01), 'a $2,800 yard is offered jobs from the cheap tiers, up to the first that carries a metal (' + early.feeds.join(', ') + ')');
  // the most of each metal a real lot carries over many deals, against what a job asks per batch
  const allFeeds = Object.keys(CS.FEEDS).filter((id) => A.worthOf(CS.FEEDS[id].comp) > 1), most = {};
  for (let seed = 1; seed <= 200; seed++) { const st = { board: [], nextId: 1, market: {} }; A.tickTiers(st, A.mulberry32(seed), 0, { feeds: allFeeds, limit: 10000, market: {}, tiers: 8 }); st.board.forEach((l) => M.JOB.mats.forEach((m) => { most[m] = Math.max(most[m] || 0, Math.min(l.tons, 10000) * (l.truth[m] || 0)); })); }
  const rng = M.mulberry32(9); let worst = 0, what = '';
  for (let i = 0; i < 400; i++) { const j = M.genJob(rng, { feeds: late.feeds, lotT: late.lotT, limit: 10000, rep: 100, id: i }); const r = j.tons / j.batches / (most[j.mat] || 1e-9); if (r > worst) { worst = r; what = j.mat + ' ' + j.tons + ' t in ' + j.batches + ' batches'; } }
  check(worst <= 1, 'at a 10,000 t limit no job asks more a batch than one dealt lot carries (worst ' + worst.toFixed(2) + 'x: ' + what + ')');
  const j = M.genJob(M.mulberry32(3), { feeds: ['zorba'], lotT: { zorba: 3000 }, limit: 10000, rate: 100, rep: 100 });
  check(j.windowH >= 2 * j.batches * (3000 / 100), 'a job of 3,000 t batches at 100 t/h gets a window of twice the plant time (' + j.windowH + ' h for ' + j.batches + ')');
  check(M.windowFor(2) === M.windowFor(2, 0) && M.windowFor(2, 1) === M.windowFor(2), 'a short batch keeps the old window');
}

console.log('== #345: GROW pays back, big tonnages read with separators, late milestones ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env;
  S.money = 1e7; S.feedPrepaid = true; S.tons = 10000; app.recompute();
  const ns = app.layout.nextStep();
  check(ns.title !== 'READY' || /10,000 t/.test(ns.sub), 'the READY card reads 10,000 t, not 10000.0 t (' + ns.sub + ')');
  const MS = CS.Milestones, ids = MS.LIST.map((m) => m.id);
  check(['industrial', 'mega', 'endgame'].every((id) => ids.indexOf(id) >= 0), 'milestones for Industrial group, Mega-plant and the end game');
  const snap = { sold: 0, soldValue: 0, batchBest: 0, refined: {}, goldBars: 0, sorters: 0, slots: 5, lotBest: 0, miscMax: 0, misc: 0, lotsRun: 0, rank: 5, omniRuns: 1 };
  const got = MS.reached({}, snap);
  check(got.indexOf('industrial') >= 0 && got.indexOf('mega') >= 0 && got.indexOf('endgame') >= 0, 'rank 5 and a batch through the Omniprocessor reach all three');
  check(MS.reached({}, Object.assign({}, snap, { rank: 3, omniRuns: 0 })).filter((id) => ['industrial', 'mega', 'endgame'].indexOf(id) >= 0).length === 0, 'none of them at Plant operator');
  // GROW: a machine that adds cents a tonne for thousands of dollars is not advised
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'modules', 'layout.js'), 'utf8');
  check(/p\.gain \* Math\.max\(S\.tons \|\| 0, [^;]*\) \* 10 >= price/.test(src), 'GROW asks for a payback within ten batches');
}

console.log(fails ? '\n' + fails + ' late-game check(s) FAILED' : '\nall late-game checks pass');
process.exit(fails ? 1 : 0);
