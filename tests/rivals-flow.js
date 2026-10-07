// Rivals match flow through the booted page (tests/browser-env.js): #305 the last round with no bin, #306 a saved 'settling'
// flag, #307 no job board in Rivals, #308 no RANK UP in Rivals. Run: node tests/rivals-flow.js
const fs = require('fs'), path = require('path');
const { mk, playRound, runYard } = require('./browser-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

// #305: a one-round match where you pass every card: the match waits for your MISC batch (or END THE MATCH)
function lastRoundNoBin() {
  const env = mk(), { app, CS } = env, RL = CS.Round.live, I = CS.Inventory;
  app.switchMode('rivals'); env.flush();
  RL.open(); RL.state().match.length = 1;
  if (I.miscTotal(I.misc()) < 5) I.addMisc(I.misc(), 'steel', 40, 30);
  env.logs.length = 0;
  playRound(env, { bidOn: 99 }); env.flush();
  return env;
}
{
  const env = lastRoundNoBin(), { app, CS } = env, RL = CS.Round.live;
  check(!RL.round().over && RL.state().match.ending && RL.miscAllowed(), '#305: the last round without a bin leaves the match open for your MISC batch');
  check(env.logs.some((l) => /The match ends when that batch is done/.test(l)) && !env.logs.some((l) => /match is over/.test(l)), '#305: the log tells you to run MISC and does not end the match underneath it');
  check(!RL.canStart(), '#305: no next round opens');
  const worth0 = app.netWorth();
  RL.useMisc(); app.emit('batchComplete', {}); env.flush();   // what a MISC re-run does: the batch starts (useMisc) and completes
  check(RL.round().over && !RL.miscAllowed(), '#305: the MISC batch ends the match and clears the MISC flag');
  check(RL.state().match.final && Math.abs(RL.state().match.final.you - worth0) < 1, '#305: the final standings take your worth after that batch');
}
{
  const env = lastRoundNoBin(), { CS } = env, RL = CS.Round.live;
  env.clickRound('#round-end'); env.flush();
  check(RL.round().over && !RL.miscAllowed(), '#305: END THE MATCH ends it without the MISC batch');
  // an older save that ended with the MISC flag still set loads without it
  const d = JSON.parse(env.store['crunchsim.v2.rivals']); d.ext.round.misc = true; env.store['crunchsim.v2.rivals'] = JSON.stringify(d);
  const env2 = mk({ store: env.store }); env2.flush();
  check(env2.app.S.mode === 'rivals' && env2.CS.Round.live.round().over && !env2.CS.Round.live.miscAllowed(), '#305: a finished match never loads with the MISC flag set');
}
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'layout.js'), 'utf8');
  const body = src.slice(src.indexOf('function nextAction()'), src.indexOf('function nextAction()') + 1500);
  check(body.indexOf('RL.round().over') >= 0 && body.indexOf('RL.round().over') < body.indexOf('RL.miscAllowed()'), '#305: NEXT STEP checks for a finished match before RUN YOUR MISC');
}

// #306: a save inside open()'s settle window does not keep 'settling' and lock the restored round
{
  const env = mk(), { app, CS } = env, RL = CS.Round.live;
  app.switchMode('rivals'); env.flush();
  RL.open(); env.clickRound('#round-start'); env.flush();
  const r = RL.state().open; r.won.you = { k: 0, perT: 10 }; r.k = 1; r.price = 0; r.leader = null; r.out = [];
  app.save();
  const env2 = mk({ store: env.store }), RL2 = env2.CS.Round.live; env2.flush();
  RL2.open(); env2.app.save();   // saved while the 350 ms settle timer is pending; that page is then gone
  check(!JSON.parse(env2.store['crunchsim.v2.rivals']).ext.round.open.settling, '#306: the save does not write settling');
  check(RL2.state().open.settling === true, '#306: the live round still holds the flag while its timer is pending');
  const env3 = mk({ store: env2.store }), RL3 = env3.CS.Round.live; env3.flush();
  check(RL3.state().open && !RL3.state().open.settling, '#306: the restored round is not settling');
  RL3.open(); env3.flush(); RL3.open(); env3.flush(); RL3.open(); env3.flush();
  check(RL3.state().open && RL3.state().open.done && RL3.canStart(), '#306: the rivals settle the rest of the restored round and the next one can open');
}

// #307: the job board is hidden in Rivals: no ticks, no tenders, no deliveries
{
  const env = mk(), { app, CS, S } = env;
  app.switchMode('rivals'); env.flush();
  const J = CS.Missions.live.jobs();
  if (!J.board.length) J.board.push(CS.Missions.genJob(Math.random, { clockH: S.clock / 3600, id: J.nextId++ }));
  const ids = J.board.map((j) => j.id).join();
  env.logs.length = 0;
  for (let i = 0; i < 200; i++) { S.clock += 3600; app.emit('tick', { dh: 1, dt: 1 }); }
  check(J.board.map((j) => j.id).join() === ids, '#307: the job board does not tick in Rivals');
  check(!CS.Rivals.live.state().rjobs.length && !env.logs.some((l) => /after the tender|Job #/.test(l)), '#307: no rival takes a job by tender in Rivals');
}

// #308: the match plant's car line does not read as a RANK UP in a new Rivals match
{
  const env = mk(), { app, CS } = env;
  app.switchMode('rivals'); env.flush();
  CS.Round.live.open();
  playRound(env, { bidOn: 0, maxBids: 12 }); runYard(env);
  check(app.S.line.length > 2, '#308: the match starts on the car line');
  check(!env.logs.some((l) => /RANK UP/.test(l)), '#308: no RANK UP in Rivals');
}

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' rivals flow checks pass');
process.exit(fails ? 1 : 0);
