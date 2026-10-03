// Tickets #27 and #26: timed contract missions and the job board. Exercises the DOM-free parts on CS.Missions
// (deadlines, phases, settlement, penalties, reputation, seeded job generation, progress from real bins, projection,
// save/load) and then drives the module's CS.app hooks against a fake app without a document.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
const { MATERIALS, FEEDS, LINES, Sim, Score } = globalThis.CS;
const path = require('path');
const MOD = path.join(__dirname, '..', 'js', 'modules', 'missions.js');
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* ---- a fake app, so the page wiring registers its hooks (no DOM: the panel is skipped, the logic runs) ---- */
const hooks = {}, logs = [];
const app = {
  booted: false,
  S: { clock: 0, money: 10000, lifetime: 0, tons: 15, line: [], run: null, mr: { R: 0 }, ev: null, contract: null, suppliers: new Set(['elv', 'pallets', 'quarry', 'zorba']), ext: {} },
  on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); if (evt === 'boot' && app.booted) fn(); },
  emit(evt, p) { (hooks[evt] || []).forEach((fn) => fn(p)); },
  log(msg, cls) { logs.push({ msg, cls }); },
  fmtMoney(x) { return (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)); }, fmtNum(x, d) { return isFinite(x) ? x.toFixed(d == null ? 1 : d) : '--'; }, esc(s) { return String(s); },
  contract() { return app.S.contract ? Score.CONTRACTS.find((c) => c.id === app.S.contract) || null : null; },
  binList() { return app.bins || []; }, plantValue() { return 30; }, save() { app.saves = (app.saves || 0) + 1; }, renderBank() {}
};
globalThis.CS.app = app;
require(MOD);
const M = globalThis.CS.Missions;
check(M && typeof M.deadlineFor === 'function', 'CS.Missions is exported');
check(hooks.load && hooks.save && hooks.boot && hooks.render && hooks.tick && hooks.batchComplete && hooks.batchStart, 'registers load, save, boot, render, tick, batchStart and batchComplete hooks');

/* ---- contract deadlines ---- */
console.log('=== deadlines');
Score.CONTRACTS.forEach((C) => {
  const w = M.deadlineFor(C);
  check(w >= M.DEADLINE_MIN_H && Number.isInteger(w), C.id + ': window ' + w + ' h is a whole number of hours, at least ' + M.DEADLINE_MIN_H);
  check(M.graceFor(w) >= M.GRACE_MIN_H && near(M.graceFor(w), Math.max(M.GRACE_MIN_H, M.GRACE_FRAC * w)), C.id + ': grace ' + f(M.graceFor(w)) + ' h');
  check(M.penaltyFor(C) > 0 && M.penaltyFor(C) < C.fee * C.tons, C.id + ': liquidated damages $' + M.penaltyFor(C) + ' are positive and below the gross fee');
});
check(M.deadlineFor({ id: 'nope', tons: 100 }) === 30 && M.deadlineFor({ id: 'tiny', tons: 1 }) === M.DEADLINE_MIN_H, 'an unknown contract gets three runs at 10 t/h, floored at half a shift');
// the intended lines of tests/contracts.js fit three times inside the window
const INTENDED = { ferrous: 44.6, mulch: 8.7, chair: 9.2, roadbase: 62.5, flour: 27.5, rebar: 28.8, crumb: 3.5, zorba: 15, gel: 0.5 };
Score.CONTRACTS.forEach((C) => { if (INTENDED[C.id]) check(3 * M.hoursNeeded(C.tons, INTENDED[C.id]) <= M.deadlineFor(C) + 1e-9, C.id + ': three runs of the intended line (' + f(3 * C.tons / INTENDED[C.id]) + ' h) fit the ' + M.deadlineFor(C) + ' h window'); });
check(M.hoursNeeded(10, 5) === 2 && M.hoursNeeded(10, 0) === Infinity && M.hoursNeeded(0, 0) === 0, 'hoursNeeded is tonnes over rate');

/* ---- phases and settlement ---- */
console.log('=== phases and settlement');
const Cz = Score.CONTRACTS.find((c) => c.id === 'zorba');
{
  const m = M.newMission(Cz, 10);
  check(m.deadlineH === 14 && m.state === 'accepted' && M.missionState(m, false) === 'accepted' && M.missionState(m, true) === 'in progress', 'a zorba mission accepted at T+10 h is due at T+14 h');
  check(M.missionPhase(m, 12).phase === 'ontime' && near(M.missionPhase(m, 12).leftH, 2), 'two hours in: on time with 2 h left');
  check(M.missionPhase(m, 14.5).phase === 'late' && near(M.missionPhase(m, 14.5).lateH, 0.5), 'past the deadline inside the grace: late');
  check(M.missionPhase(m, 14 + m.graceH + 0.1).phase === 'overdue', 'past the grace: overdue');
  check(M.expire(m, Cz, 14.5) === 0 && m.state === 'accepted', 'no cancellation inside the grace period');
  const pen = M.expire(m, Cz, 14 + m.graceH + 0.1);
  check(pen === M.penaltyFor(Cz) && m.state === 'failed' && M.missionPhase(m, 20).phase === 'failed', 'after the grace the client cancels and charges $' + pen);
  check(M.expire(m, Cz, 30) === 0, 'a failed mission is not charged twice');
}
{
  const m = M.newMission(Cz, 0), cs = { stars: 2, fee: 1000 };
  let r = M.settle(m, { stars: 0, fee: 0 }, 1);
  check(!r.delivered && m.attempts === 1 && m.state === 'accepted', 'a zero-star run counts as an attempt, not a delivery');
  r = M.settle(m, cs, 2);
  check(r.delivered && !r.late && r.factor === 1 && r.deduction === 0 && r.first && m.state === 'delivered' && m.deliveries === 1, 'on time: full fee, state delivered');
  r = M.settle(m, { stars: 3, fee: 1000 }, 5);
  check(r.delivered && r.late && r.factor === M.LATE_RATE && near(r.deduction, 400) && !r.first && m.late === 1 && m.bestStars === 3, 'after the deadline every delivery pays ' + Math.round(M.LATE_RATE * 100) + '%: $400 of a $1000 fee is deducted');
  check(M.missionState(m, false) === 'delivered', 'display state stays delivered');
}

/* ---- reputation ---- */
console.log('=== reputation');
check(M.tierOf(0) === 0 && M.tierOf(24.9) === 0 && M.tierOf(25) === 1 && M.tierOf(60) === 2 && M.tierOf(100) === 2, 'tiers open at 25 and 60');
check(M.repApply(0, -10) === 0 && M.repApply(98, 15) === 100 && M.repApply(10, 3) === 13, 'reputation is clamped to 0..100');
check(M.REP.contractFail < 0 && M.REP.jobFail < -M.REP.jobDone[0] && M.REP.jobDone[2] > M.REP.jobDone[0], 'failures cost more than a small success earns; bigger jobs earn more');

/* ---- jobs: seeded generation ---- */
console.log('=== job generation');
const feeds = ['elv', 'pallets', 'quarry', 'zorba'];
function jobsWith(seed, rep, count) { const rng = M.mulberry32(seed); const out = []; for (let i = 0; i < count; i++) out.push(M.genJob(rng, { feeds, limit: 30, rep, clockH: 100, id: i + 1 })); return out; }
const J0 = jobsWith(7, 0, 300), J2 = jobsWith(7, 100, 300);
check(JSON.stringify(jobsWith(7, 0, 50)) === JSON.stringify(jobsWith(7, 0, 50)), 'the same seed gives the same jobs');
check(JSON.stringify(jobsWith(7, 0, 50)) !== JSON.stringify(jobsWith(8, 0, 50)), 'a different seed gives different jobs');
check(J0.every(M.validJob), 'every generated job is well-formed');
check(J0.every((j) => M.JOB.mats.includes(j.mat)), 'jobs ask for the non-ferrous metals only');
check(J0.every((j) => j.tier === 0), 'a new yard (rep 0) only sees small jobs');
check(J2.some((j) => j.tier === 2) && J2.some((j) => j.tier === 1) && J2.some((j) => j.tier === 0), 'at rep 100 all three tiers appear');
check(J0.every((j) => j.purity >= M.JOB.purity[j.mat][0] - 1e-9 && j.purity <= M.JOB.purity[j.mat][1] + 1e-9), 'purity requirement within the grade range of its metal');
check(J0.every((j) => j.mult >= M.JOB.mult[0] && j.mult <= M.JOB.mult[1]), 'job price is ' + Math.round((M.JOB.mult[0] - 1) * 100) + '-' + Math.round((M.JOB.mult[1] - 1) * 100) + '% over spot');
check(J0.every((j) => j.offerExpiresH > 100 && j.offerExpiresH <= 100 + M.JOB.offerH[1]), 'offers close 12-48 h after posting');
const meanT = (list, tier, mat) => { const s = list.filter((j) => j.tier === tier && j.mat === mat); return s.reduce((a, j) => a + j.tons, 0) / Math.max(1, s.length); };
check(meanT(J2, 2, 'copper') > meanT(J2, 1, 'copper') && meanT(J2, 1, 'copper') > meanT(J2, 0, 'copper'), 'copper jobs grow with tier: ' + f(meanT(J2, 0, 'copper')) + ' / ' + f(meanT(J2, 1, 'copper')) + ' / ' + f(meanT(J2, 2, 'copper')) + ' t');
check(near(M.yieldPerBatch('copper', feeds, 30), FEEDS.zorba.comp.copper * 30 * M.JOB.recovery) && near(M.yieldPerBatch('copper', ['elv'], 30), FEEDS.elv.comp.copper * 30 * M.JOB.recovery), 'a batch\'s yield follows the richest available feed (zorba 8% copper vs ELV 1.5%)');
check(M.yieldPerBatch('copper', ['pallets', 'quarry'], 30) === 0, 'no copper from pallets or quarry rock');
check(J0.every((j) => j.windowH === M.windowFor(j.batches) && j.windowH >= 2 * M.JOB.hoursPerBatch * j.batches), 'the window is twice the plant time the job needs plus slack');

/* ---- jobs: the board ---- */
console.log('=== job board');
{
  const J = M.newJobs(), rng = M.mulberry32(11), opts = { feeds, limit: 30, rep: 0 };
  M.tickBoard(J, rng, 0, 0, opts);
  check(J.board.length >= M.JOB.board.min && J.board.length <= M.JOB.board.max, 'boot fills the board to ' + J.board.length + ' offers');
  let maxLen = 0, minLen = 99, stale = 0, arrivals = 0;
  for (let h = 0; h < 2000; h++) { const ids = new Set(J.board.map((j) => j.id)); M.tickBoard(J, rng, h, 1, opts); maxLen = Math.max(maxLen, J.board.length); minLen = Math.min(minLen, J.board.length); if (J.board.some((j) => j.offerExpiresH <= h)) stale++; J.board.forEach((j) => { if (!ids.has(j.id)) arrivals++; }); }
  check(maxLen <= M.JOB.board.max && minLen >= M.JOB.board.min && stale === 0, 'over 2000 h the board stays within ' + M.JOB.board.min + '..' + M.JOB.board.max + ' offers (' + minLen + '..' + maxLen + ') and no expired offer lingers');
  check(arrivals > 2000 / M.JOB.offerH[1] && arrivals < 2000, 'offers keep arriving and expiring (' + arrivals + ' new offers in 2000 h)');
  const first = J.board[0];
  check(M.acceptJob(J, 9999, 0, 0).ok === false, 'accepting a job that is not on the board is refused');
  const a = M.acceptJob(J, first.id, 2000, 0);
  check(a.ok && a.job.state === 'active' && a.job.deadlineH === 2000 + a.job.windowH && J.active.length === 1 && !J.board.includes(first), 'accepting moves the job to active and starts its window');
  const second = J.board[0]; M.acceptJob(J, second.id, 2000, 0);
  const third = J.board[0];
  check(!M.acceptJob(J, third.id, 2000, 0).ok && J.active.length === 2, 'a third job is refused: two at once');
  const locked = M.genJob(M.mulberry32(3), { feeds, limit: 30, rep: 100, clockH: 0, id: 500 }); locked.tier = 2; J.board.push(locked);
  check(!M.acceptJob(J, 500, 2000, 10).ok && /[Rr]eputation/.test(M.acceptJob(J, 500, 2000, 10).why), 'a large-tier job is locked at low reputation');
  check(M.expireJobs(J, 2000 + 1).length === 0, 'nothing expires inside the window');
  const ex = M.expireJobs(J, 2000 + Math.max(a.job.windowH, J.active[1].windowH) + 1);
  check(ex.length === 2 && J.active.length === 0 && J.done.length === 2 && J.done.every((j) => j.state === 'failed'), 'both jobs fail once their windows close and land in the done list');
}

/* ---- jobs: progress from real bins ---- */
console.log('=== progress from bins');
function binsOf(preset, feed) {
  const line = Sim.buildLine(preset), ev = Sim.evalLine(line, FEEDS[feed].comp), mr = Sim.maxRate(ev.nodes, line);
  const bins = ev.terminals.map((t) => ({ key: t.key, uid: t.uid, port: t.port, st: Sim.binStats(t.stream.m, t.form), form: t.form || null })).filter((b) => b.st.total > 0.5);
  return { bins, R: mr.R };
}
Sim.prices.market = 1;
const zorba = binsOf({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] }, 'zorba');
const car = binsOf(LINES.car, 'elv');
{
  const al = M.qualifying(zorba.bins, 'aluminum', 0.95);
  check(al.length === 1 && al[0].share >= 0.95, 'the sink-float floats are a ' + Math.round(al[0].share * 100) + '% aluminum bin that meets a 95% spec');
  check(M.qualifyingKg(zorba.bins, 'copper', 0.85) === 0, 'the sinks (copper, brass, zinc mixed) do not meet an 85% copper spec');
  const J = M.newJobs();
  const job = { id: 1, mat: 'aluminum', tier: 1, batches: 2, tons: 20, purity: 0.95, mult: 1.4, windowH: 14, offerExpiresH: 0, client: 'x', state: 'offered', t: 0, paid: 0, acceptedH: null, deadlineH: null };
  J.board.push(job); M.acceptJob(J, 1, 0, 50);
  const kg = M.qualifyingKg(zorba.bins, 'aluminum', 0.95);
  const d1 = M.applyBins(J, zorba.bins, 15, (mat) => MATERIALS[mat].sell);
  check(d1.length === 1 && near(d1[0].t, kg / 1000 * 15) && !d1[0].done, 'a 15 t zorba batch delivers ' + f(d1[0].t, 2) + ' t of aluminum (bins are per head-tonne, scaled by the batch)');
  check(near(d1[0].pay, d1[0].t * (job.mult - 1) * MATERIALS.aluminum.sell) && d1[0].withdrawn === 0, 'without a stock withdrawal the job pays only its premium over spot (' + f(d1[0].pay, 0) + ')');
  check(near(M.jobHours(job, zorba.bins, zorba.R), (20 - job.t) / (zorba.R * kg / 1000)), 'projection: ' + f(M.jobHours(job, zorba.bins, zorba.R)) + ' h more at ' + f(zorba.R) + ' t/h to finish');
  check(M.jobHours(job, car.bins, 10) === Infinity, 'the car line makes no 95% aluminum bin: the job cannot be finished on it');
  const d2 = M.applyBins(J, zorba.bins, 100, (mat) => MATERIALS[mat].sell, (mat, t) => t);
  check(d2.length === 1 && d2[0].done && near(job.t, 20) && J.active.length === 0 && J.done[0] === job && job.state === 'done', 'a big batch tops the job up to exactly 20 t and completes it');
  check(near(d2[0].pay, d2[0].t * job.mult * MATERIALS.aluminum.sell) && near(d2[0].withdrawn, d2[0].t), 'with a withdraw function the tonnes leave stock and the full price is paid');
  check(M.applyBins(J, zorba.bins, 15, (m) => MATERIALS[m].sell).length === 0, 'no active job, nothing delivered');
  // two jobs on the same material share one batch: the first accepted is served first, a bin cannot ship twice
  const J2 = M.newJobs();
  const a = Object.assign({}, job, { id: 1, t: 0, paid: 0, state: 'offered', tons: 2 }), b = Object.assign({}, job, { id: 2, t: 0, paid: 0, state: 'offered', tons: 50 });
  J2.board.push(a, b); M.acceptJob(J2, 1, 0, 50); M.acceptJob(J2, 2, 0, 50);
  const d3 = M.applyBins(J2, zorba.bins, 15, (m) => MATERIALS[m].sell);
  check(d3.length === 2 && near(d3[0].t, 2) && d3[0].done && near(d3[0].t + d3[1].t, kg / 1000 * 15), 'two aluminum jobs split one batch: 2 t fills the first, the rest goes to the second');
  check(M.applyBins(M.newJobs(), [{ st: { total: 100, perMat: { aluminum: { mass: 100 } } }, form: 'dross' }], 10, (m) => 1).length === 0, 'dross never ships');
}

/* ---- persistence ---- */
console.log('=== persistence');
{
  const st = M.newState(); st.rep = 37.5; st.mission = M.newMission(Cz, 5); M.settle(st.mission, { stars: 1, fee: 100 }, 6);
  const rng = M.mulberry32(5); M.tickBoard(st.jobs, rng, 0, 0, { feeds, limit: 30, rep: st.rep }); M.acceptJob(st.jobs, st.jobs.board[0].id, 1, st.rep);
  const back = M.deserialize(JSON.parse(JSON.stringify(M.serialize(st, rng.getState()))));
  check(back.rep === 37.5 && back.mission.id === 'zorba' && back.mission.state === 'delivered' && back.mission.deliveries === 1 && back.mission.deadlineH === 9, 'reputation and mission round-trip through JSON');
  check(back.jobs.active.length === 1 && back.jobs.board.length === st.jobs.board.length && back.jobs.nextId === st.jobs.nextId && back.rngState === rng.getState(), 'jobs, ids and the rng state round-trip');
  const junk = M.deserialize({ rep: 999, mission: { id: 'zorba', deadlineH: 'x' }, jobs: { board: [{ mat: 'unobtainium', tons: 1 }, { mat: 'copper', tons: -1 }, { mat: 'copper', tons: 3, purity: 2, mult: 0.5, windowH: 5, state: 'active' }], active: 'nope' } });
  check(junk.rep === 100 && junk.mission === null && junk.jobs.board.length === 0 && junk.jobs.active.length === 0, 'junk is clamped or dropped (a job in the wrong list is not resurrected)');
  check(M.deserialize(null).rep === M.REP.start && M.deserialize('x').jobs.board.length === 0, 'a missing save gives fresh state');
}
check(M.fmtH(2.5) === '2 h 30 min' && M.fmtH(0.25) === '15 min' && M.fmtH(-1) === '-1 h' && M.fmtH(Infinity) === '--', 'hour formatting');

/* ---- the hooks against the fake app (no DOM) ---- */
console.log('=== hooks');
{
  const ext = () => Object.assign({}, ...hooks.save.map((fn) => fn() || {}));
  app.emit('load', {}); app.booted = true; app.emit('boot');
  check(ext().missions && ext().missions.rep === 0 && ext().missions.jobs.board.length >= M.JOB.board.min, 'boot fills the job board and a fresh save carries it');
  const boardBefore = JSON.stringify(ext().missions.jobs.board);
  app.emit('load', JSON.parse(JSON.stringify(ext())));
  check(JSON.stringify(ext().missions.jobs.board) === boardBefore, 'load restores the same board');
  // accept the zorba contract through the app's state; the render hook picks it up
  app.S.contract = 'zorba'; app.S.tons = Cz.tons; app.S.clock = 3600 * 2;
  app.emit('render');
  let m = ext().missions.mission;
  check(m && m.id === 'zorba' && m.acceptedH === 2 && m.deadlineH === 2 + M.deadlineFor(Cz) && m.state === 'accepted', 'accepting a contract starts a mission at the current clock');
  check(logs.some((l) => /Mission clock started/.test(l.msg)), 'the start is logged');
  // a scored batch on time: nothing deducted
  const money0 = app.S.money;
  app.S.clock = 3600 * 3; app.emit('batchComplete', { r: { done: 10 }, why: 'complete', net: 0, bins: [], cs: { C: Cz, stars: 2, fee: 1000 }, powerC: 0 });
  check(app.S.money === money0 && ext().missions.mission.state === 'delivered' && ext().missions.rep === M.REP.contractOnTime, 'on-time delivery: no deduction, reputation +' + M.REP.contractOnTime);
  // a second scored batch after the deadline: 40% comes back out
  app.S.clock = 3600 * (2 + M.deadlineFor(Cz) + 0.5); app.S.money = 5000;
  app.emit('batchComplete', { r: { done: 10 }, why: 'complete', net: 0, bins: [], cs: { C: Cz, stars: 3, fee: 1000 }, powerC: 0 });
  check(near(app.S.money, 5000 - 1000 * (1 - M.LATE_RATE)) && logs.some((l) => /late/.test(l.msg) && /deducted/.test(l.msg)), 'a late delivery has 40% of its fee deducted and logged');
  // release, accept again, let the grace run out on the tick hook
  app.S.contract = null; app.emit('render');
  check(ext().missions.mission === null && ext().missions.last && ext().missions.last.id === 'zorba', 'releasing clears the mission and keeps the last one');
  app.S.contract = 'zorba'; app.emit('render'); m = ext().missions.mission;
  app.S.money = 5000; const repBefore = ext().missions.rep;
  app.S.clock = 3600 * (m.deadlineH + m.graceH + 0.1); app.emit('tick', { dt: 0.1, dh: 0.1 });
  check(ext().missions.mission.state === 'failed' && near(app.S.money, 5000 - M.penaltyFor(Cz)) && ext().missions.rep === M.repApply(repBefore, M.REP.contractFail), 'deadline and grace missed on tick: liquidated damages $' + M.penaltyFor(Cz) + ' deducted, reputation ' + M.REP.contractFail);
  check(logs.some((l) => /cancelled by the client/.test(l.msg) && l.cls === 'bad'), 'the cancellation is logged as bad');
  app.emit('tick', { dt: 0.1, dh: 0 });
  check(near(app.S.money, 5000 - M.penaltyFor(Cz)), 'an idle tick (dh = 0) changes nothing');
  // a job delivered through the batchComplete bins
  app.S.contract = null; app.emit('render');
  const saved = ext().missions; const jb = saved.jobs.board.find((j) => j.mat === 'aluminum' && j.tier === 0);
  if (jb) {
    const st2 = JSON.parse(JSON.stringify(saved)); st2.jobs.active = [Object.assign({}, jb, { state: 'active', acceptedH: 0, deadlineH: 1e6 })]; st2.jobs.board = st2.jobs.board.filter((j) => j.id !== jb.id);
    app.emit('load', { missions: st2 });
    const money1 = app.S.money, lt = app.S.lifetime;
    app.emit('batchComplete', { r: { done: 15 }, why: 'complete', net: 0, bins: zorba.bins, cs: null, powerC: 0 });
    const after = ext().missions, aj = after.jobs.active[0] || after.jobs.done[0];
    check(aj && aj.t > 0 && app.S.money > money1 && near(app.S.money - money1, aj.paid) && near(app.S.lifetime - lt, aj.paid), 'a zorba batch credits ' + f(aj ? aj.t : 0, 2) + ' t to the aluminum job and pays the premium (' + f(app.S.money - money1, 0) + ')');
  } else check(true, '(no small aluminum job on this board; skipped the delivery check)');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' mission checks pass'));
process.exit(fails ? 1 : 0);
