// Ticket #26: the job board (the timed contract missions of #27 were retired in #78). Exercises the DOM-free parts on CS.Missions
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
  S: { clock: 0, money: 10000, lifetime: 0, tons: 15, line: [], run: null, mr: { R: 0 }, ev: null, ext: {} },
  on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); if (evt === 'boot' && app.booted) fn(); },
  emit(evt, p) { (hooks[evt] || []).forEach((fn) => fn(p)); },
  log(msg, cls) { logs.push({ msg, cls }); },
  fmtMoney(x) { return (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)); }, fmtNum(x, d) { return isFinite(x) ? x.toFixed(d == null ? 1 : d) : '--'; }, esc(s) { return String(s); },
  binList() { return app.bins || []; }, plantValue() { return 30; }, save() { app.saves = (app.saves || 0) + 1; }, renderBank() {}
};
globalThis.CS.app = app;
require(MOD);
const M = globalThis.CS.Missions;
check(M && typeof M.genJob === 'function' && !('deadlineFor' in M), 'CS.Missions is exported, without the contract missions');
check(hooks.load && hooks.save && hooks.boot && hooks.render && hooks.tick && hooks.batchComplete && hooks.batchStart, 'registers load, save, boot, render, tick, batchStart and batchComplete hooks');

check(M.hoursNeeded(10, 5) === 2 && M.hoursNeeded(10, 0) === Infinity && M.hoursNeeded(0, 0) === 0, 'hoursNeeded is tonnes over rate');

/* ---- phases and settlement ---- */
console.log('=== reputation');
check(M.tierOf(0) === 0 && M.tierOf(24.9) === 0 && M.tierOf(25) === 1 && M.tierOf(60) === 2 && M.tierOf(100) === 2, 'tiers open at 25 and 60');
check(M.repApply(0, -10) === 0 && M.repApply(98, 15) === 100 && M.repApply(10, 3) === 13, 'reputation is clamped to 0..100');
check(M.REP.jobFail < -M.REP.jobDone[0] && M.REP.jobDone[2] > M.REP.jobDone[0], 'failures cost more than a small success earns; bigger jobs earn more');

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
check(jobsWith(5, 100, 400).every((j) => j.purity >= Sim.PURE_MIN - 1e-9), 'no job asks for less than the sellable purity (a lower bin is MISC and never ships)');
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
  const st = M.newState(); st.rep = 37.5;
  const rng = M.mulberry32(5); M.tickBoard(st.jobs, rng, 0, 0, { feeds, limit: 30, rep: st.rep }); M.acceptJob(st.jobs, st.jobs.board[0].id, 1, st.rep);
  const back = M.deserialize(JSON.parse(JSON.stringify(M.serialize(st, rng.getState()))));
  check(back.rep === 37.5 && !('mission' in back), 'reputation round-trips through JSON');
  check(back.jobs.active.length === 1 && back.jobs.board.length === st.jobs.board.length && back.jobs.nextId === st.jobs.nextId && back.rngState === rng.getState(), 'jobs, ids and the rng state round-trip');
  const junk = M.deserialize({ rep: 999, mission: { id: 'zorba', deadlineH: 'x' }, jobs: { board: [{ mat: 'unobtainium', tons: 1 }, { mat: 'copper', tons: -1 }, { mat: 'copper', tons: 3, purity: 2, mult: 0.5, windowH: 5, state: 'active' }], active: 'nope' } });
  check(junk.rep === 100 && junk.jobs.board.length === 0 && junk.jobs.active.length === 0, 'junk is clamped or dropped (a job in the wrong list is not resurrected)');
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
  // a job delivered through the batchComplete bins
  const saved = ext().missions; const jb = saved.jobs.board.find((j) => j.mat === 'aluminum' && j.tier === 0);
  if (jb) {
    const st2 = JSON.parse(JSON.stringify(saved)); st2.jobs.active = [Object.assign({}, jb, { state: 'active', acceptedH: 0, deadlineH: 1e6 })]; st2.jobs.board = st2.jobs.board.filter((j) => j.id !== jb.id);
    app.emit('load', { missions: st2 });
    const money1 = app.S.money, lt = app.S.lifetime;
    app.emit('batchComplete', { r: { done: 15 }, why: 'complete', net: 0, bins: zorba.bins, powerC: 0 });
    const after = ext().missions, aj = after.jobs.active[0] || after.jobs.done[0];
    check(aj && aj.t > 0 && app.S.money > money1 && near(app.S.money - money1, aj.paid) && near(app.S.lifetime - lt, aj.paid), 'a zorba batch credits ' + f(aj ? aj.t : 0, 2) + ' t to the aluminum job and pays the premium (' + f(app.S.money - money1, 0) + ')');
  } else check(true, '(no small aluminum job on this board; skipped the delivery check)');
  /* #216: a MISC re-run does not count again, and bins the inventory will not sell earn no premium (synthetic job, so it always runs) */
  const st3 = JSON.parse(JSON.stringify(saved)), synth = Object.assign({}, saved.jobs.board[0], { mat: 'aluminum', purity: 0.85, tier: 0, state: 'active', acceptedH: 0, deadlineH: 1e6 });
  const reload = () => { st3.jobs.active = [Object.assign({}, synth)]; app.emit('load', { missions: JSON.parse(JSON.stringify(st3)) }); };
  const jobT = () => { const j = ext().missions.jobs; return (j.active[0] || j.done[0] || { t: NaN }).t; };
  reload();
  app.emit('batchComplete', { r: { done: 15 }, why: 'complete', net: 0, bins: zorba.bins, powerC: 0 });
  check(jobT() > 0, 'control: a normal batch credits the synthetic aluminum job');
  reload();
  app.emit('batchComplete', { r: { done: 15, src: 'misc' }, why: 'complete', net: 0, bins: zorba.bins, powerC: 0 });
  check(jobT() === 0, 'a MISC re-run credits nothing to a job');
  reload();
  const unsold = zorba.bins.map((b) => Object.assign({}, b, { st: Object.assign({}, b.st, { sellable: false }) }));
  app.emit('batchComplete', { r: { done: 15 }, why: 'complete', net: 0, bins: unsold, powerC: 0 });
  check(jobT() === 0, 'bins the inventory will not sell credit nothing to a job');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' mission checks pass'));
process.exit(fails ? 1 : 0);
