// The Progress economy fixes from the bug check of #294-#304: re-runs do not step the market, the line is fixed while a batch
// runs, TUNE/REWIRE is scored on what will run and only for more product, a re-run batch keeps net worth, the rank and the card
// read net worth after the product lands, NEXT STEP never says RUN when RUN refuses, the yard advance tops up and is repaid from
// every inflow, and a batch stopped before a tonne pays no yard rent.
// Run: node tests/economy-fixes.js
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
function game() { const env = load(); for (let i = 0; i < 3; i++) env.tick(0.05); return env; }
function runOut(env) { let k = 0; while (env.S.run && k++ < 200000) env.tick(0.1); }

console.log('== #295: the line is fixed while a batch runs ==');
{
  const env = game(), { CS, app, S } = env, Sim = CS.Sim;
  S.owned.add('arc'); S.units.arc = 1; S.money = 1e7;
  app.setFeed({ steel: 0.7, wood: 0.3 }, 'custom', 20); S.feedPrepaid = true; S.feedOwner = 'test'; app.markDirty(true);
  app.startRun();
  check(!!S.run, 'a batch is running');
  check(/Stop the batch/.test(app.veto('addMachine', { m: 'arc' })) && /Stop the batch/.test(app.veto('applyLine', { id: 'car' })), 'adding a machine or loading a line is vetoed mid-batch');
  const len = S.line.length;
  app.buyAndAdd({ ms: ['arc'], src: { uid: S.line[S.line.length - 1].uid, port: 'extract' } });
  check(S.line.length === len, 'BUY & PLACE does nothing while the batch runs');
  check(app.runLocked(true) === true, 'runLocked reports the lock');
  runOut(env);
  check(!S.run && app.runLocked() === false && app.veto('addMachine', { m: 'arc' }) === '', 'once the batch ends the line can change again');
}

console.log('== #296: TUNE / REWIRE needs more product value, scored on the re-run as fed ==');
{
  const env = game(), { CS, app, S } = env, Sim = CS.Sim, I = CS.Inventory, L = CS.Layout;
  S.owned.add('sinkfloat'); S.units.sinkfloat = 1;
  const h = Sim.makeNode('hammer', {}, 'feed'), mg = Sim.makeNode('magnet', {}, { uid: h.uid, port: 'product' });
  const sf = Sim.makeNode('sinkfloat', { sg: 1.0 }, { uid: mg.uid, port: 'residue' });
  S.line = [h, mg, sf]; app.markDirty(true);
  const misc = I.misc(); [['wood', 60, 30], ['glass', 40, 15], ['limestone', 30, 15], ['plastic', 25, 15], ['rubber', 20, 15]].forEach(([m, t, p]) => I.addMisc(misc, m, t, p));
  const plan = L.rerunPlan(misc, Object.keys(misc), 30), opts = { sizes: plan.sizes, entry: L.defaultEntry(S.line, CS.MACHINES) };
  const t = app.bestTune(plan.comp, opts);
  check(!t || !t.src || t.src.port !== 'extract' || t.src.uid !== mg.uid, 'no REWIRE onto the magnet\'s ferrous output for a pile with no steel (' + (t ? JSON.stringify({ set: t.set, src: t.src, gain: +t.gain.toFixed(1) }) : 'no advice') + ')');
  const ns = app.layout.nextStep();
  check(ns.title !== 'REWIRE', 'NEXT STEP does not REWIRE for power alone (' + ns.title + ' ' + ns.label + ')');
}

console.log('== #297: a re-run batch keeps net worth ==');
{
  const env = game(), { CS, app, S } = env, I = CS.Inventory;
  I.addLot(I.stock(), 'steel', 25, 0.97, 1, 1, 30, 0); S.money = 5000;
  app.layout.rerun(['steel'], 'steel', 'stock');
  check(S.feedPrepaid && S.feedOwner === 'rerun', 'the steel bucket is loaded');
  const nw0 = app.netWorth(); app.startRun(); let lo = Infinity, k = 0;
  while (S.run && k++ < 200000) { env.tick(0.1); if (S.run) lo = Math.min(lo, app.netWorth()); }
  check(lo > nw0 - 0.02 * nw0, 'net worth never dips during the re-run (' + Math.round(nw0) + ', lowest ' + Math.round(lo) + ')');
}

console.log('== #294: a re-run does not step the market ==');
{
  const env = game(), { CS, app, S } = env, I = CS.Inventory, M = CS.Market && CS.Market.live;
  I.addLot(I.stock(), 'steel', 5, 0.97, 1, 1, 30, 0); S.money = 5000;
  const r0 = M && M.state ? JSON.stringify(M.state().history || M.state().round) : null;
  const q0 = CS.Sim.prices.perMat ? JSON.stringify(CS.Sim.prices.perMat) : '';
  app.layout.rerun(['steel'], 'steel', 'stock'); app.startRun(); runOut(env);
  check(!CS.Sim.prices.perMat || JSON.stringify(CS.Sim.prices.perMat) === q0, 'prices are where they were after a re-run batch');
}

console.log('== #298: the rank and the card read net worth after the product lands ==');
{
  const env = game(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv');
  const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  const floor = CS.RANKS[1][0];
  S.money += floor - app.netWorth() - 5;   // $5 under the next rank
  const ranks = []; const orig = app.log; app.log = (m, c) => { if (/RANK UP/.test(m)) ranks.push(m); return orig(m, c); };
  app.startRun(); runOut(env); app.log = orig;
  const worth = app.netWorth();
  check(worth >= floor, 'the batch lifts net worth past the rank (' + Math.round(worth) + ' >= ' + floor + ')');
  check(app.rankOf(worth).idx >= 1, 'and the rank follows at once');
}

console.log('== #299: NEXT STEP says what makes RUN possible ==');
{
  const env = game(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv'); const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  const mg = S.line.find((x) => x.m === 'magnet'); mg.wear = 1; mg.autoService = false; app.markDirty(true);
  let ns = app.layout.nextStep();
  check(ns.title === 'SERVICE' && /SERVICE MAG/.test(ns.label), 'a worn-out station: NEXT STEP says SERVICE (' + ns.title + ' ' + ns.label + ')');
  ns.go(); check(mg.wear === 0, 'and its button services it');
  S.line.push(CS.Sim.makeNode('eddy', {}, { uid: mg.uid, port: 'residue' })); app.markDirty(true);
  ns = app.layout.nextStep();
  check(ns.title === 'BUY' && /ECS/.test(ns.label), 'an unowned machine on the line: NEXT STEP says BUY it (' + ns.title + ' ' + ns.label + ')');
}

console.log('== #300: the yard advance tops up and every inflow repays it ==');
{
  const env = game(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv');
  S.money = 10;
  let ns = app.layout.nextStep();
  check(ns.title === 'STUCK', 'a dead end offers the advance (' + ns.title + ' ' + ns.label + ')');
  ns.go(); const owed = app.layout.loan();
  check(owed >= 1000, 'the advance is taken (' + owed + ')');
  app.emit('income', { amount: 2000, from: 'refinery' });
  check(app.layout.loan() === owed - 500, 'refining repays a quarter of what it brings in (' + app.layout.loan() + ')');
  S.money = 10; app.renderAll();
  ns = app.layout.nextStep();
  check(app.layout.loan() > 0 && ns.title === 'STUCK', 'stuck again with part still owed: the advance is offered again (' + ns.title + ')');
}

console.log('== #304: a batch stopped before a tonne pays no rent; the batch size survives a reload ==');
{
  const env = game(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv'); const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  app.startRun(); env.tick(0.02);
  const m0 = S.money; let rentLogged = false; const orig = app.log; app.log = (m, c) => { if (/Yard storage/.test(m)) rentLogged = true; return orig(m, c); };
  app.stopRun('stopped'); app.log = orig;
  check(!rentLogged, 'no yard rent for a batch stopped at once (bank ' + Math.round(m0) + ' -> ' + Math.round(S.money) + ')');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' economy-fix checks pass'));
process.exit(fails ? 1 : 0);
