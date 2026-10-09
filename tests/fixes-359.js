// Fixes #359-#361: NEXT STEP leads to the Omniprocessor at Mega-plant (the hall it needs, then BUY & PLACE, and its first batch
// ends the game), the job board only offers jobs the yard's line can meet, and a tier the rank opens shows without the clock moving.
// Run: node tests/fixes-359.js
const { mk } = require('./browser-env.js');
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== #359: NEXT STEP leads to the end game ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, U = CS.PLANT_UPGRADES.room, omni = CS.MACHINES.omni;
  const area = CS.Floor.machineArea('omni');
  check(area > U.levels[2], 'the Omniprocessor needs ' + Math.round(area) + ' m², more than the ' + U.levels[2] + ' m² hall the advice builds for sorters');
  S.money = 1e6; app.renderAll();
  check(!/END GAME/.test(app.layout.nextStep().title), 'below Mega-plant the advice never offers it');
  S.money = 1.2 * CS.RANKS[CS.RANKS.length - 1][0]; S.plant.room = 2; app.renderAll();
  check(app.rankOf(app.netWorth()).name === 'Mega-plant', 'at Mega-plant');
  let ns = app.layout.nextStep();
  check(ns.title === 'END GAME' && /PLANT HALL/.test(ns.label), 'with the money it first offers the hall the machine needs (' + ns.label + ')');
  let guard = 0; while (/PLANT HALL/.test(ns.label) && guard++ < 5) { ns.go(); env.flush(); ns = app.layout.nextStep(); }
  check(!CS.Floor.addVeto(S.line, 'omni', S.plant.room), 'then the hall (' + U.levels[S.plant.room] + ' m²) has room for it');
  check(ns.title === 'END GAME' && /BUY & PLACE OMNI/.test(ns.label), 'then BUY & PLACE OMNI (' + ns.label + ')');
  const m0 = S.money; ns.go(); env.flush();
  check(S.line.some((n) => n.m === 'omni') && S.owned.has('omni') && m0 - S.money >= app.pairPrice({ ms: ['omni'] }) - 1e-6, 'it is bought and placed on the head feed');
  { const n2 = app.layout.nextStep(); check(!/OMNI|HALL|SLOT|BIGGER/.test(n2.label), 'and the advice moves on to the final batch, no second offer and no more growth (#369: ' + n2.title + ' ' + n2.label + ')'); }
  const env2 = mk(); env2.flush(); env2.S.money = 1.2 * env2.CS.RANKS[env2.CS.RANKS.length - 1][0]; env2.S.mode = 'rivals';
  check(!/END GAME/.test(env2.app.layout.nextStep().title || ''), 'never in Rivals');
}

console.log('== #360: jobs the line can meet ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, M = CS.Missions;
  const o0 = M.live.genOpts();
  check(!!o0.reach && Object.values(o0.reach).every((f) => Object.values(f).every((b) => M.reachMax(b) < M.purityFloor('copper'))), 'the line of a new yard makes no clean metal, so it is offered no job');
  S.line = CS.Sim.buildLine({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] }); S.money = 2e6; app.recompute(); CS.Auction.live.dealTier(4, 'zorba');   // #395: jobs come only from lots on the board, so deal one that carries aluminum
  const o = M.live.genOpts();
  check(!!o.reach && Math.max(0, ...Object.values(o.reach.aluminum).map(M.reachMax)) >= 0.95, 'a twin + sink-float line reads as clean aluminum');
  let worst = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) { const j = M.genJob(M.mulberry32(seed), o); if (!j) continue; n++; const best = Math.max(0, ...Object.values(o.reach[j.mat] || {}).map(M.reachMax)); worst = Math.max(worst, j.purity - best); }
  check(n > 0 && worst <= 1e-9, 'no job asks a purity above what the line makes (' + n + ' of 30 draws offered a job)');
}

console.log('== #361: a tier the rank opens shows at once ==');
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, A = CS.Auction;
  S.speed = 0; const tiers = () => A.live.board().filter((L) => L.tier != null).map((L) => L.tier);
  check(!tiers().includes(6), 'a new yard has no $1M lot');
  S.money = 3e6; app.renderAll();
  check(app.rankOf(app.netWorth()).idx >= 3 && tiers().includes(6), 'reaching Plant operator opens the $1M tier on the next redraw, before the clock moves');
  const e2 = mk(); e2.flush(); e2.S.speed = 0;
  e2.S.money = 3e6; e2.app.emit('income', { amount: 1, from: 'test' });
  check(e2.CS.Auction.live.board().some((L) => L.tier === 6), 'and on income (a sale or a job)');
}

console.log(fails ? fails + ' FAILED' : 'all #359-#361 checks pass');
process.exit(fails ? 1 : 0);
