// Regressions found after the economy and Rivals fixes (#318-#323): the LOT DONE card survives a STOP, a Rivals match waiting
// for MISC ends when the MISC is shipped out, no RANK UP banner in Rivals, a re-run's worth is not counted twice inside
// batchComplete, dross lots keep their lot on reload, the BUY step buys every missing unit, the advance covers a red bank.
// Run: node tests/regressions.js
const { mk, playRound } = require('./browser-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== #318: the LOT DONE card survives a STOP ==');
{
  const env = mk(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv'); const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  CS.Autorun.live.go(); S.speed = 1;
  for (let i = 0; i < 20; i++) env.tick(0.1);
  check(!!S.run, 'the lot is running');
  app.startRun(); env.flush();
  const html = String(env.sel['#scorecard'].innerHTML);
  check(/LOT #\d+ DONE/.test(html) && !/BATCH STOPPED/.test(html), 'the card shows LOT DONE, not the single batch');
}

console.log('== #319: a last round waiting for MISC ends when the MISC is shipped out ==');
{
  const env = mk(), { app, CS, S } = env, RL = CS.Round.live, I = CS.Inventory;
  app.switchMode('rivals'); env.flush();
  RL.open(); RL.state().match.length = 1;
  if (I.miscTotal(I.misc()) < 5) I.addMisc(I.misc(), 'steel', 40, 30);
  playRound(env, { bidOn: 99 }); env.flush();
  check(RL.state().match.ending && !RL.round().over, 'the match waits for the MISC batch');
  S.money = 1e6; I.dumpMisc(); env.flush(50); app.renderAll(); env.flush();
  check(RL.round().over, 'shipping the MISC out ends the match');
  const ns = app.layout.nextStep();
  check(/STANDINGS/.test(ns.label), 'NEXT STEP points at the standings (' + ns.label + ')');
}

console.log('== #320: no RANK UP banner in Rivals ==');
{
  const env = mk(), { app, CS, S } = env;
  app.switchMode('rivals'); env.flush();
  app.setFeed({ steel: 0.7, wood: 0.3 }, 'custom', 20); S.feedPrepaid = true; S.feedOwner = 'test'; app.markDirty(true);
  const idx = app.rankOf(app.netWorth()).idx, next = CS.RANKS[idx + 1];
  S.money += next[0] - app.netWorth() - 5;
  env.runBatch();
  check(app.netWorth() >= next[0], 'net worth crossed a rank floor');
  check(!/class="rankup"/.test(String(env.sel['#scorecard'].innerHTML)), 'the batch card has no RANK UP banner');
}

console.log('== #321: inside batchComplete a re-run is counted once ==');
{
  const env = mk(), { app, CS, S } = env, I = CS.Inventory;
  I.addLot(I.stock(), 'steel', 25, 0.97, 1, 1, 30, 0); S.money = 5000;
  app.layout.rerun(['steel'], 'steel', 'stock');
  let inHook = null; app.on('batchComplete', () => { inHook = app.netWorth(); });
  env.runBatch();
  check(inHook != null && Math.abs(inHook - app.netWorth()) < 1, 'net worth read in batchComplete is the final figure (' + Math.round(inHook) + ' vs ' + Math.round(app.netWorth()) + ')');
}

console.log('== #322: a dross lot under 90% keeps its lot on reload ==');
{
  const env = mk(), { CS, app, S } = env, I = CS.Inventory, Sim = CS.Sim;
  S.owned.add('induction'); S.units.induction = 1; S.money = 1e6;
  S.line = [Sim.makeNode('induction', {}, 'feed')]; S.sel = S.line[0].uid; app.markDirty(true);
  app.setFeed({ aluminum: 0.6, steel: 0.25, copper: 0.15 }, 'custom', 20); S.feedPrepaid = true; S.feedOwner = 'test'; app.markDirty(true);
  env.runBatch();
  const dross = Object.keys(I.stock()).find((m) => I.stock()[m].purity < 0.9);
  check(!!dross && I.stock()[dross].alloy === true, 'the dross lot is held and flagged (' + dross + ')');
  const w0 = app.netWorth(); app.save();
  const env2 = mk({ store: env.store }); env2.flush();
  const I2 = env2.CS.Inventory;
  check(I2.stock()[dross] && I2.miscTotal(I2.misc()) < 0.01 && Math.abs(env2.app.netWorth() - w0) < 1, 'after a reload it is still a lot, not MISC, and net worth holds');
}

console.log('== #323: BUY buys every missing unit; the advance covers a red bank ==');
{
  const env = mk(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv'); const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  const mg = S.line.find((x) => x.m === 'magnet');
  S.line.push(CS.Sim.makeNode('eddy', {}, { uid: mg.uid, port: 'residue' }), CS.Sim.makeNode('eddy', {}, { uid: mg.uid, port: 'extract' }));
  S.money = 1e6; app.markDirty(true);
  const ns = app.layout.nextStep(); ns.go();
  check(app.unitsOf('eddy') === 2, 'one click buys both eddy current separators (' + ns.label + ')');
}
{
  const env = mk(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv');
  S.money = -800; app.renderAll();
  const ns = app.layout.nextStep();
  check(ns.title === 'STUCK', 'a red bank is stuck');
  ns.go();
  const cheapest = Math.min.apply(null, A.board().map((L) => (A.priceOf ? A.priceOf(L) : L.ask) * L.tons));
  check(S.money >= cheapest, 'one advance reaches the cheapest lot (bank ' + Math.round(S.money) + ', lot ' + Math.round(cheapest) + ')');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' regression checks pass'));
process.exit(fails ? 1 : 0);
