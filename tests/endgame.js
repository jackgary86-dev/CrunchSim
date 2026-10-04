// End game (ticket #15): the Omniprocessor. The data entry, the M.omni branch of procComminution (one bin per material on the
// 'everything' feed, every bin above 95% purity, mass balance, ordinary machines untouched), the 'omni' cam scene running on a
// stub canvas, and the unlock rule and hooks of js/modules/endgame.js against a stand-in for CS.app.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
require('../js/cam.js'); require('../js/scenes-a.js'); require('../js/scenes-b.js');
const CS = globalThis.CS;
const { MATERIALS, MACHINES, MACHINE_GROUPS, FEEDS, RANKS, PRICE_SCALE, Sim, Score } = CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('=== data entry');
const M = MACHINES.omni;
check(!!M && M.name === 'Omniprocessor' && M.short === 'OMNI' && M.cat === 'End game' && M.kind === 'comminution' && M.omni === true && M.scene === 'omni', 'omni: name, short, cat, kind, omni flag and scene');
check(M.price / PRICE_SCALE >= 1e6, 'price is in the millions before PRICE_SCALE ($' + (M.price / PRICE_SCALE).toLocaleString('en-US') + ' real, $' + M.price.toLocaleString('en-US') + ' in game)');
check(M.settings.map((s) => s.id).join(',') === 'rate,target' && M.defaults.rate === 100 && M.defaults.target === 20, 'settings: throughput and target size');
check(M.foot && M.foot.w > 0 && M.foot.d > 0, 'has a footprint (' + M.foot.w + ' x ' + M.foot.d + ' m)');
check(M.unlock && M.unlock.rank === 'Mega-plant' && M.unlock.stars === 3, 'unlock field: Mega-plant or three stars everywhere');
check(MACHINE_GROUPS.some(([g, ids]) => g === 'End game' && ids.includes('omni')), 'End game group lists the omni');
check(CS.MAT_ORDER.every((id) => M.outs[id] === MATERIALS[id].name) && M.outs.rejects, 'outs name a port for every material plus rejects');

console.log('\n=== omni on the everything feed');
const line = [Sim.makeNode('omni', {}, 'feed')];
const ev = Sim.evalLine(line, FEEDS.everything.comp), mr = Sim.maxRate(ev.nodes, line), inf = ev.nodes[0];
const present = Object.keys(FEEDS.everything.comp).filter((m) => FEEDS.everything.comp[m] > 0);
const bins = ev.terminals.map((t) => ({ t, st: Sim.binStats(t.stream.m, t.form) })).filter((b) => b.st.total > 0.5);
console.log('  head rate ' + f(mr.R) + ' t/h (' + (mr.limiter && mr.limiter.why) + '), ' + f(inf.eT, 2) + ' kWh/t, P80 ' + f(inf.P80, 1) + ' mm');
bins.forEach((b) => console.log('  ' + b.t.port.padEnd(10) + f(b.st.total, 1).padStart(7) + ' kg  purity ' + f(b.st.share * 100, 1).padStart(5) + '%  P80 ' + f(b.st.p80, 1).padStart(6) + ' mm  $' + f(b.st.value, 1)));
check(bins.length === present.length, 'one bin per material: ' + bins.length + ' bins for ' + present.length + ' materials');
check(bins.every((b) => b.st.share > 0.95), 'every bin is above 95% purity (lowest ' + f(Math.min.apply(null, bins.map((b) => b.st.share)) * 100, 1) + '%)');
check(bins.every((b) => Object.keys(b.st.perMat)[0] === b.t.port && b.st.perMat[b.t.port].mass / b.st.total > 0.95), 'each port is named by the material it holds');
check(present.every((m) => bins.some((b) => b.t.port === m)), 'every material in the feed has its own bin');
const outKg = ev.terminals.reduce((a, t) => a + Sim.streamMass(t.stream), 0);
check(Math.abs(outKg - 1000) < 1e-6, 'mass balance: ' + f(outKg, 6) + ' kg out per 1000 kg in');
check(!ev.ports[line[0].uid + ':product'], 'no aggregate product port that would sell the feed twice');
check(Object.keys(inf.perMat).every((m) => MATERIALS[m].state === 'liquid' ? inf.perMat[m].resp === 0 : Math.abs(inf.perMat[m].resp - 0.9) < 1e-12), 'every solid breaks at efficiency 0.9; liquids pass through');
check(bins.filter((b) => MATERIALS[b.t.port].state !== 'liquid').every((b) => b.st.p80 > 10 && b.st.p80 < 30), 'solids come out near the 20 mm target');
check(mr.R > 100, 'the line runs at mega-shredder rates (' + f(mr.R) + ' t/h)');
const fine = Sim.evalLine([Object.assign(Sim.makeNode('omni', { target: 5 }, 'feed'), { uid: line[0].uid })], FEEDS.everything.comp);
check(Sim.binStats(fine.ports[line[0].uid + ':steel'].m).p80 < 7 && fine.nodes[0].eT > inf.eT, 'a 5 mm target makes finer steel and costs more energy (' + f(fine.nodes[0].eT, 2) + ' vs ' + f(inf.eT, 2) + ' kWh/t)');
const half = Sim.evalLine([Object.assign(Sim.makeNode('omni', { rate: 50 }, 'feed'), { uid: line[0].uid })], FEEDS.everything.comp);
check(Math.abs(half.nodes[0].capTph - inf.capTph / 2) < 1e-6, 'the throughput setting scales capacity (' + f(half.nodes[0].capTph) + ' vs ' + f(inf.capTph) + ' t/h)');
// a separator downstream can take one material port
const down = Sim.buildLine({ nodes: [{ m: 'omni', s: {}, src: 'feed' }, { m: 'screen', s: { aperture: 25 }, src: '1:aluminum' }] });
const evd = Sim.evalLine(down, FEEDS.everything.comp);
check(Math.abs(evd.nodes[1].inKg - 80) < 1e-6, 'a downstream node fed from 1:aluminum sees only the aluminum (' + f(evd.nodes[1].inKg, 2) + ' kg)');
// ordinary comminution is untouched
const ham = Sim.evalLine(Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] }), FEEDS.everything.comp);
check(ham.terminals.map((t) => t.port).sort().join(',') === 'product,rejects', 'the hammermill still has product and rejects ports');
check(Math.abs(ham.nodes[0].perMat.steel.resp - Sim.mixResp(MACHINES.hammer, MATERIALS.steel.resp[0])) < 1e-12, 'the hammermill still uses its own mechanism response');

console.log('\n=== contracts with the omni');
const scored = Score.CONTRACTS.filter((C) => C.feed !== 'gel').map((C) => { const L = Sim.buildLine({ nodes: [{ m: 'omni', s: {}, src: 'feed' }] }); return [C, Score.evalContract(C, L, null)]; });
scored.forEach(([C, cs]) => console.log('  ' + C.id.padEnd(9) + ' ' + cs.stars + ' stars'));
check(scored.some(([, cs]) => cs.stars >= 1), 'the omni ships at least one contract');

console.log('\n=== cam scene');
const SC = CS.Scenes.omni;
check(!!SC && typeof SC.update === 'function' && typeof SC.draw === 'function', 'CS.Scenes.omni exists');
const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
const cam = Object.assign(Object.create(CS.Cam.prototype), { parts: [], fx: [], acc: 0, t: 0, phase: 0, run: 1, belt: 0, flash: 0 });
const comp = []; for (const m in inf.inStream.m) comp.push([m, Sim.sum(inf.inStream.m[m])]);
const st = { M, s: line[0].settings, running: true, load: 0.8, comp, perMat: inf.perMat, F80: inf.F80, P80: inf.P80, topMm: inf.topMm, temp: 0, kind: inf.kind };
let err = null, chuted = 0, gone = 0;
try {
  SC.init(cam, st);
  for (let k = 0; k < 600; k++) {
    cam.t += 1 / 60; cam.phase += 0.1; cam.belt += 1;
    SC.update(cam, 1 / 60, st); cam.updateOut(1 / 60);
    chuted += cam.parts.filter((p) => p.mode === 'chute').length;
    gone += Object.keys(cam.chuteHit).length;
    SC.draw(cam, ctx, st, 0); SC.drawParticlesExtra(cam, ctx, st); SC.draw(cam, ctx, st, 1);
  }
} catch (e) { err = e; }
check(!err, 'ten seconds of the scene run and draw without error' + (err ? ': ' + err.message : ''));
check(cam.omniMats && cam.omniMats.length === present.length, 'one chute per material (' + (cam.omniMats || []).length + ')');
check(chuted > 0 && gone > 0, 'pieces reach the chutes');
check(cam.parts.filter((p) => p.stage === 4).every((p) => Math.abs(p.r - p.rOut) < 1e-9), 'pieces leave the last arch at the product size');

console.log('\n=== unlock rule');
const { mkApp } = (function () {
  function mkApp() {
    const hooks = {}, logs = [];
    const app = {
      on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); }, emit(evt, p) { (hooks[evt] || []).forEach((fn) => fn(p)); },
      veto(evt, p) { let why = ''; (hooks['veto:' + evt] || []).some((fn) => { why = fn(p) || ''; return !!why; }); return why; },
      collect() { const o = {}; (hooks.save || []).forEach((fn) => Object.assign(o, fn() || {})); return o; },
      S: { owned: new Set(['hammer']), contracts: {}, line: [], ext: {}, lifetime: 123456, batches: 42, tonnes: 9000, clock: 3600 },
      nw: 0, Score, booted: false, saved: 0,
      netWorth() { return app.nw; },
      rankOf(nw) { let i = 0; RANKS.forEach((r, k) => { if (nw >= r[0]) i = k; }); return { idx: i, name: RANKS[i][1] }; },
      log(t, c) { logs.push(t); }, save() { app.saved++; }, fmtMoney: (x) => '$' + Math.round(x), fmtNum: (x) => String(x), fmtClock: (s) => 'T+' + s, esc: (s) => String(s), logs
    };
    return app;
  }
  return { mkApp };
})();
const app = mkApp(); CS.app = app;
require('../js/modules/endgame.js');
const E = CS.Endgame;
check(!!E && app.endgameStarted, 'CS.Endgame is exported and the module registered its hooks');
const all3 = {}; Score.CONTRACTS.forEach((C) => { all3[C.id] = 3; });
const allButOne = Object.assign({}, all3); allButOne[Score.CONTRACTS[0].id] = 2;
const MEGA = RANKS.findIndex((r) => r[1] === 'Mega-plant');
check(E.rankNeeded('omni') === MEGA, 'the omni needs rank index ' + MEGA + ' (Mega-plant)');
check(!E.unlockStatus('omni', MEGA - 1, {}, Score.CONTRACTS).ok, 'Industrial group with no stars: locked');
check(E.unlockStatus('omni', MEGA, {}, Score.CONTRACTS).ok, 'Mega-plant: unlocked');
check(E.unlockStatus('omni', 0, all3, Score.CONTRACTS).ok, 'every contract at three stars: unlocked at any rank');
const u1 = E.unlockStatus('omni', 0, allButOne, Score.CONTRACTS);
check(!u1.ok && u1.starred === Score.CONTRACTS.length - 1, 'one contract at two stars: still locked (' + u1.starred + ' of ' + u1.total + ')');
check(!E.unlockStatus('omni', 0, {}, []).ok, 'an empty contract list never unlocks by stars');
check(E.vetoFor('hammer', false, 0, {}, Score.CONTRACTS) === '', 'ordinary machines are never refused');
check(E.vetoFor('omni', true, 0, {}, Score.CONTRACTS) === '', 'an omni already owned is never refused');
const why = E.vetoFor('omni', false, 0, {}, Score.CONTRACTS);
check(/locked/.test(why) && /Mega-plant/.test(why) && /0 of 9/.test(why), 'the veto says why: ' + why);

console.log('\n=== hooks');
app.nw = RANKS[MEGA][0] - 1;
check(/locked/.test(app.veto('addMachine', { m: 'omni' })), 'veto:addMachine refuses the omni just below Mega-plant');
check(app.veto('addMachine', { m: 'magnet' }) === '', 'veto:addMachine lets a magnet through');
check(/locked/.test(app.veto('applyLine', { id: 'blueprint', nodes: [{ m: 'twin' }, { m: 'omni' }] })), 'veto:applyLine refuses a blueprint with the omni in it');
check(app.veto('applyLine', { id: 'car', nodes: CS.LINES.car.nodes }) === '', 'veto:applyLine lets the car line through');
app.nw = RANKS[MEGA][0];
check(app.veto('addMachine', { m: 'omni' }) === '', 'at Mega-plant the omni can be bought');
app.nw = 0; app.S.contracts = all3;
check(app.veto('addMachine', { m: 'omni' }) === '', 'with every contract at three stars the omni can be bought');
app.S.contracts = {}; app.S.owned.add('omni');
check(app.veto('addMachine', { m: 'omni' }) === '', 'once owned the omni stays placeable after net worth drops');
app.emit('batchComplete', { why: 'complete', r: {} });
check(!app.collect().endgame.shown, 'a batch without the omni does not end the game');
app.S.line = Sim.buildLine({ nodes: [{ m: 'omni', s: {}, src: 'feed' }] });
app.emit('batchComplete', { why: 'stopped', r: {} });
check(!app.collect().endgame.shown, 'a stopped batch does not end the game');
app.emit('batchComplete', { why: 'complete', r: {} });
check(app.collect().endgame.shown && app.saved === 1 && app.logs.some((t) => /END GAME/.test(t)), 'the first completed omni batch ends the game, logs it and saves');
app.emit('batchComplete', { why: 'complete', r: {} });
check(app.saved === 1, 'the end-game card shows once');
app.emit('newgame'); check(!app.collect().endgame.shown, 'newgame resets it');
app.emit('load', { endgame: { shown: true } }); check(app.collect().endgame.shown === true, 'load restores it');
app.emit('load', { endgame: 'junk' }); check(app.collect().endgame.shown === false, 'junk loads as not shown');
const es = E.endStats(app.S, 2e7, 'Mega-plant', Score.CONTRACTS);
check(es.score === 2e7 && es.rank === 'Mega-plant' && es.lifetime === 123456 && es.batches === 42 && es.contracts === Score.CONTRACTS.length, 'end stats: score, rank, lifetime earnings, batches');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nend game checks pass');
process.exit(fails ? 1 : 0);
