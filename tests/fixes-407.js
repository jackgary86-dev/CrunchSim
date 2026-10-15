// Economy fixes #407-#410: a MISC re-run counts toward a job, REFINE never runs at a loss, the job card measures purity on the
// solids, and a job's lot deal never throws away a sampled lot (and its 12-hour limit survives a reload).
// Run: node tests/fixes-407.js
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== #407: a MISC re-run delivers to a job ==');
{
  const env = load(); const { CS, app, S } = env; globalThis.__fakeStash = true;
  const J = CS.Missions.live.jobs(); J.active.length = 0; J.board.length = 0;
  const job = { id: 999, mat: 'steel', tier: 0, batches: 1, tons: 50, purity: 0.9, mult: 1.5, windowH: 1000, offerExpiresH: 1e9, client: 'X', state: 'active', t: 0, paid: 0, acceptedH: 0, deadlineH: 1e9 };
  J.active.push(job);
  const I = CS.Inventory; I.misc().steel = { t: 20, p80: 30 }; I.misc().wood = { t: 5, p80: 30 };
  app.layout.rerun(['steel', 'wood'], 'MISC', 'misc');
  S.speed = 60; app.startRun(); let k = 0; while (S.run && k++ < 5000) env.tick(0.1);
  check(job.t > 15 && job.paid > 0, 'the pure steel sorted out of MISC counts toward the steel job (' + job.t.toFixed(1) + ' t)');
}

console.log('== #408: REFINE at a loss is refused ==');
{
  const env = load(); const { CS, app, S } = env; globalThis.__fakeStash = true;
  const I = CS.Inventory; I.stock().steel = { t: 20, purity: 0.92, grade: 0.6, sf: 0.1, p80: 0.05, cost: 0 };
  S.money = 30000; CS.Refinery.live.buy(); S.money = 10;
  const q = CS.Refinery.live.quote('steel');
  check(q.ok && q.net < 0, 'steel fines quote a negative net (' + Math.round(q.net) + ')');
  CS.Refinery.live.refine('steel');
  check(S.money === 10 && I.stock().steel && I.stock().steel.t === 20, 'refining them is refused: bank and stock unchanged');
}

console.log('== #409: the job card measures purity on the solids ==');
{
  const env = load(); const Mi = env.CS.Missions;
  const st = { total: 1037.5, liquid: 100, sellable: true, perMat: { aluminum: { mass: 900 }, steel: { mass: 37.5 }, water: { mass: 100 } } };
  const bins = [{ st, form: 'loose' }];
  const J = { active: [{ id: 1, mat: 'aluminum', purity: 0.95, tons: 5, t: 0, mult: 1.3, paid: 0 }], board: [], done: [] };
  check(isFinite(Mi.jobHours(J.active[0], bins, 10)) && Mi.qualifyingKg(bins, 'aluminum', 0.95) === 900, 'a wet bin 96% aluminum on solids qualifies on the card');
  check(Mi.applyBins(J, bins, 3, () => 2000, null).length === 1, 'and delivers, as before');
}

console.log('== #410: a job lot deal keeps sampled lots, and its limit survives a reload ==');
{
  let hits = 0, deals = 0, redeal = 0;
  for (let s = 0; s < 12; s++) {
    const env = load(); const { CS, app, S } = env; globalThis.__fakeStash = true;
    const A = CS.Auction.live, J = CS.Missions.live.jobs();
    S.owned = new Set(Object.keys(CS.MACHINES)); for (const m in CS.MACHINES) S.units[m] = 5;
    S.line = CS.Sim.buildLine(CS.LINES.car); app.markDirty(true);
    S.clock = 3600 * (s * 7 + 1);
    S.money = 1e5; A.board().forEach((L) => { if (L.tier >= 3) A.sample(L, A.priceOf(L)); });
    S.money = 60000; J.board.length = 0;
    const orig = A.dealTier; A.dealTier = (k, f) => { const cur = A.board().find((L) => L.tier === k); deals++; if (cur && cur.sample) hits++; return orig(k, f); };
    for (let i = 0; i < 3; i++) { S.clock += 360; app.emit('tick', { dt: 0.1, dh: 0.1 }); }
    const d0 = deals; J.board.length = 0; app.save(); app.restoreSave(); app.emit('modechange', { mode: S.mode }); J.board.length = 0;
    for (let i = 0; i < 3; i++) { S.clock += 360; app.emit('tick', { dt: 0.1, dh: 0.1 }); }
    if (deals > d0 && d0 > 0) redeal++;
  }
  check(deals > 0, 'job lots were dealt (' + deals + ')');
  check(hits === 0, 'none replaced a lot the yard paid to sample');
  check(redeal === 0, 'a reload does not reset the once-per-12-hours limit');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' checks pass'));
process.exit(fails ? 1 : 0);
