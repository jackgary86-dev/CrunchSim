// The run loop in js/app.js (#219): startRun / stepRun / stopRun, driven through a fake DOM (tests/app-env.js).
// Covers: a batch that runs to completion; STOP mid-batch returns the unrun lot tonnes (#96) and a trivial run does not step
// the market (#213); the abort paths in startRun spend nothing and pay no auto-service (#201); stepRun halts on a worn-out
// node and settles through stopRun; auto-service charges once at 80% wear (#20).
// Run: node tests/app-run.js
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

/* a fresh game with an elv lot bought and loaded as the feed; returns the handles the scenarios use */
function game() {
  const env = load(), { CS, app, S } = env, A = CS.Auction.live;
  const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  const done = []; app.on('batchComplete', (p) => done.push(p));
  S.speed = 10; S.money = 1e6;   // a 0.1 s frame is 1/60 sim hour (about 1.3 t); a big bank so a service can be paid
  /* the bank changes by more than the run's own settlement (inventory charges yard rent on batchComplete), so watch the
   * settlement write: stopRun clears S.run and then writes S.money once, as pre -> post */
  const w = { pre: null, post: null, armed: false }; let bank = S.money, cur = S.run;
  Object.defineProperty(S, 'money', { configurable: true, enumerable: true, get: () => bank, set: (x) => { if (w.armed) { w.post = x; w.armed = false; } bank = x; } });
  Object.defineProperty(S, 'run', { configurable: true, enumerable: true, get: () => cur, set: (x) => { if (cur && x === null) { w.pre = bank; w.armed = true; } cur = x; } });
  const run = (maxTicks) => { let k = 0; while (S.run && k++ < (maxTicks || 5000)) env.tick(0.1); return k; };
  return { env, CS, app, S, A, lot, done, run, w };
}

console.log('== a batch that runs to completion ==');
{
  const g = game(), { S, app, CS, A, done, w } = g, tons = S.tons, m0 = S.money;
  check(S.feedPrepaid && Object.keys(S.comp).length > 0 && tons > 1, 'the lot is loaded as a prepaid feed');
  const round0 = CS.Market.round();
  app.startRun();
  check(!!S.run && S.run.total === tons && S.run.rate > 0, 'startRun starts a run of the loaded tonnes at a positive rate');
  check(S.money === m0, 'a prepaid lot costs nothing to start (no feed charge, no service due)');
  g.run();
  check(S.run === null && done.length === 1 && done[0].why === 'complete', 'the run settles through stopRun as complete');
  const p = done[0];
  check(near(p.r.done, tons) && near(S.tonnes, tons) && S.batches === 1, 'tonnes and batches are added (' + S.tonnes.toFixed(2) + ' t, ' + S.batches + ' batch)');
  check(p.powerC > 0 && near(p.powerC, p.r.kwh * CS.Sim.prices.power) && near(S.kwh, p.r.kwh, 1e-9), 'power is the kWh used at the plant power price');
  check(near(w.post - w.pre, -p.powerC - p.r.extra), 'settlement: the bank pays power and consumables, and gets no cash for products held in inventory');
  check(p.r.held === 'inventory' && p.r.rev > 0, 'the products are held in inventory');
  check(CS.Market.round() === round0 + 1, 'a finished batch steps the market once');
  check(!A.pending() && A.yard().length === 0, 'the whole lot was used: nothing returns to the yard');
}

console.log('== STOP mid-batch (#96) ==');
{
  const g = game(), { S, app, A, lot, done, env, CS } = g, total = S.tons, round0 = CS.Market.round();
  app.startRun();
  while (S.run && S.run.done < total / 2) env.tick(0.1);
  const d = S.run.done; check(d > 0 && d < total, 'the run is part-way (' + d.toFixed(2) + ' of ' + total + ' t)');
  app.stopRun('stopped');
  check(S.run === null && done.length === 1 && done[0].why === 'stopped', 'stopRun settles the batch as stopped');
  check(near(S.tonnes, d, 1e-9) && S.batches === 1, 'only the tonnes that ran are counted');
  check(A.pending() && A.pending().id === lot.id && near(A.pending().tons, total - d, 2e-3), 'the unrun tonnes go back to the lot (' + (A.pending() ? A.pending().tons.toFixed(2) : 'none') + ' t)');
  check(CS.Market.round() === round0 + 1, 'a stop after half the tonnes still counts as a round');
  app.stopRun('stopped');
  check(done.length === 1 && S.batches === 1, 'a second stopRun with nothing running does nothing');
}

console.log('== a trivial run does not step the market (#213) ==');
{
  const g = game(), { S, app, A, lot, env, CS } = g, total = S.tons, round0 = CS.Market.round();
  S.speed = 1; app.startRun(); env.tick(0.1);
  const d = S.run.done; check(d > 0 && d < 1, 'a frame of work (' + d.toFixed(3) + ' t, under the 1 t floor)');
  app.stopRun('stopped');
  check(CS.Market.round() === round0, 'the market did not step');
  check(A.pending() && A.pending().id === lot.id && near(A.pending().tons, total - d, 2e-3), 'the unrun tonnes still go back to the lot');
  const g2 = game(), r2 = g2.CS.Market.round(); g2.app.startRun(); g2.app.stopRun('stopped');
  check(g2.CS.Market.round() === r2 && g2.done.length === 1 && g2.done[0].r.done === 0, 'start then STOP at once: nothing ran, the market did not step');
}

// note: with an empty feed maxRate is already 0, so startRun's own 'feed is empty' branch is unreachable from app state; the rate-0 branch aborts first
console.log('== startRun aborts spend nothing and pay no auto-service (#201) ==');
{
  const prep = (g) => { g.S.line.forEach((nd) => { nd.autoService = true; nd.wear = 0.9; }); return g.S.line.map((nd) => nd.wear); };
  const aborted = (g, wear, m0, what) => {
    check(!g.S.run && g.done.length === 0, what + ': no run starts');
    check(g.S.money === m0, what + ': the bank is untouched (no feed, no service)');
    check(g.S.line.every((nd, i) => nd.wear === wear[i]), what + ': wear is put back, the service was not paid');
  };
  { const g = game(), w = prep(g), m0 = g.S.money; g.S.comp = {}; g.app.startRun(); aborted(g, w, m0, 'empty feed (the line cannot run, rate 0)'); }
  { const g = game(), w = prep(g), m0 = g.S.money; let asked = 0; g.app.on('veto:startRun', () => { asked++; return 'a module says no'; }); g.app.startRun(); check(asked === 1, 'veto: the module was asked'); aborted(g, w, m0, 'veto'); }
  { const g = game(), w = prep(g), m0 = g.S.money; g.S.feedPrepaid = false; g.app.startRun(); aborted(g, w, m0, 'no lot loaded'); }
  { const g = game(), m0 = g.S.money; g.S.line.length = 0; g.app.startRun(); check(!g.S.run && g.S.money === m0, 'no machines: nothing starts, nothing is spent'); }
  {
    const g = game(); prep(g); const M = g.CS.MACHINES, m0 = g.S.money, due = g.S.line.slice();   // every node is flagged and at 90%
    g.app.startRun();
    const paid = due.reduce((c, nd) => c + g.CS.Economics.serviceCost(M[nd.m], 0.9), 0);
    check(!!g.S.run && due.length > 0 && g.S.run.serviceC === paid && g.S.money === m0 - paid, 'control: a start that goes ahead pays the auto-service once (' + paid + ')');
    check(due.every((nd) => nd.wear < 0.8), 'control: and the serviced nodes start with fresh parts');
  }
}

console.log('== stepRun halts on a worn-out node ==');
{
  const g = game(), { S, app, A, lot, done, env, w } = g, total = S.tons;
  S.line.forEach((nd) => { nd.autoService = false; nd.wear = 0.1; });
  app.startRun();
  for (let i = 0; i < 3; i++) env.tick(0.1);
  const d0 = S.run.done; check(!!S.run && d0 > 0, 'running before the failure');
  S.line[0].wear = 1;   // the hammermill's wear parts are gone
  let k = 0; while (S.run && k++ < 50) env.tick(0.1);
  check(S.run === null && done.length === 1 && done[0].why === 'halted', 'the line halts and settles through stopRun as halted');
  const p = done[0];
  check(p.r.done < total && p.r.done >= d0 && near(S.tonnes, p.r.done, 1e-9) && S.batches === 1, 'only the tonnes made before the halt are counted');
  check(near(w.post - w.pre, -p.powerC - p.r.extra) && p.powerC > 0, 'settlement: the bank pays for the power already used');
  check(A.pending() && A.pending().id === lot.id && near(A.pending().tons, total - p.r.done, 2e-3), 'the unrun tonnes return to the lot');
}

console.log('== auto-service charges once at 80% wear (#20) ==');
{
  const setup = (on) => { const g = game(); g.S.speed = 1; g.S.line.forEach((nd) => { nd.autoService = false; nd.wear = 0; }); g.S.line[0].autoService = on; g.S.line[0].wear = 0.799; return g; };
  const g = setup(true), { S, app, CS, done, w } = g, M = CS.MACHINES;   // speed 1: fine steps, so wear crosses 80% inside one frame and cannot cross twice
  const m0 = S.money; app.startRun();
  check(S.run.serviceC === 0 && S.money === m0, 'below 80% nothing is charged at the start');
  g.run(20000);
  const p = done[0], one = CS.Economics.serviceCost(M[S.line[0].m], 0.8);
  check(!!p && p.why === 'complete', 'the batch completes');
  check(p.r.serviceC >= one && p.r.serviceC < 2 * one, 'one service charged (' + p.r.serviceC + '; one service is about ' + one + ')');
  check(near(w.pre, m0 - p.r.serviceC), 'the service came out of the bank as it happened');
  check(near(w.post - w.pre, -p.powerC - p.r.extra), 'and settlement does not charge it again');
  check(S.line[0].wear < 0.8 && S.line[0].wear > 0, 'the node got new parts and wore again from zero, below the trigger');
  const s2 = setup(false); s2.app.startRun(); s2.run(20000);
  check(s2.done[0].r.serviceC === 0, 'control: with the switch off no service is paid');
}

console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' passed'); process.exit(fails ? 1 : 0);
