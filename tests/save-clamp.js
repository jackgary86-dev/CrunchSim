// #232: load() clamps saved node settings and validates enums, so a tampered save cannot mint money or NaN the bank.
const { load } = require('./app-env.js');
let fails = 0;
function check(ok, what) { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; }

function loaded(settings, m) {
  const env = load(), { CS, app, S } = env;
  const key = app.saveKeys().progress;
  localStorage.setItem(key, JSON.stringify({ line: [{ uid: 1, m: m || 'hammer', settings: settings, src: 'feed' }], money: 1000, owned: [] }));
  app.restoreSave();
  return { CS, S, st: S.line[0].settings, M: CS.MACHINES[m || 'hammer'] };
}
const id = loaded({}, 'hammer').M.settings[0].id, ref = loaded({}).M.settings[0];
console.log('=== numeric settings');
let r = loaded({ [id]: 1e12 }); check(r.st[id] === ref.max, 'huge value clamps to max (' + r.st[id] + ')');
r = loaded({ [id]: -5 }); check(r.st[id] === ref.min, 'negative clamps to min (' + r.st[id] + ')');
r = loaded({ [id]: 'abc' }); check(r.st[id] === ref.def, 'junk takes the default (' + r.st[id] + ')');
r = loaded({ [id]: null }); check(r.st[id] === ref.def, 'null takes the default');
r = loaded({}); check(r.st[id] === ref.def, 'missing takes the default');
r = loaded({ [id]: 1e12 });
const ev = r.CS.Sim.evalLine(r.S.line, r.S.comp), mr = r.CS.Sim.maxRate(ev.nodes, r.S.line);
check(isFinite(mr.R) && mr.R < 1e5, 'a tampered grate no longer mints throughput (R=' + mr.R + ')');

console.log('=== enum settings');
const E = load().CS.MACHINES; const em = Object.keys(E).find((k) => (E[k].settings || []).some((s) => s.enum));
const est = E[em].settings.find((s) => s.enum);
r = loaded({ [est.id]: 'not-a-material' }, em); check(r.st[est.id] === est.def, 'unknown enum value falls back to the default');
r = loaded({ [est.id]: est.enum[est.enum.length - 1] }, em); check(r.st[est.id] === est.enum[est.enum.length - 1], 'a listed enum value is kept');

/* #262: a hand-edited line (no uid, bad port, repeated uid) must load into something every renderer can draw */
console.log('=== line integrity (#262)');
function boot(line, extra) {
  const env = load(), { CS, app, S } = env;
  localStorage.setItem(app.saveKeys().progress, JSON.stringify(Object.assign({ line: line, money: 1000, owned: [] }, extra || {})));
  let err = null; try { app.restoreSave(); app.renderAll(); } catch (e) { err = e; }
  return { CS, S, err };
}
const hm = (o) => Object.assign({ m: 'hammer', settings: {}, src: 'feed' }, o);
r = boot([hm({}), hm({ uid: 2 })]);
check(!r.err && r.S.line.length === 1 && r.S.line[0].uid === 2, 'a node with no uid is dropped and the game boots' + (r.err ? ' (' + r.err.message + ')' : ''));
r = boot([hm({ uid: 1 }), hm({ uid: 1.5 }), hm({ uid: '3' }), hm({ uid: 1e12 }), hm({ uid: -4 })]);
check(!r.err && r.S.line.length === 1, 'fractional, string, huge and negative uids are dropped (kept ' + r.S.line.length + ')');
r = boot([hm({ uid: 1 }), hm({ uid: 1 }), hm({ uid: 2 })]);
check(!r.err && r.S.line.map((n) => n.uid).join() === '1,2', 'a repeated uid keeps only its first node');
r = boot([hm({ uid: 1 }), hm({ uid: 2, src: { uid: 1 } })]);
check(!r.err && r.S.line[1].src === 'feed', 'a src with no port reads the head feed');
r = boot([hm({ uid: 1 }), hm({ uid: 2, src: { uid: 1, port: 'extract' } })]);
check(!r.err && r.S.line[1].src === 'feed', 'a port the source machine lacks reads the head feed');
r = boot([hm({ uid: 1 }), hm({ uid: 2, src: { uid: 1, port: 'rejects' } })]);
check(!r.err && r.S.line[1].src.uid === 1 && r.S.line[1].src.port === 'rejects', 'a real port on an earlier node is kept');
r = boot([hm({ uid: 1, src: { uid: 2, port: 'product' } }), hm({ uid: 2 })]);
check(!r.err && r.S.line[0].src === 'feed', 'a src pointing at a later node reads the head feed');
const { CS: C2 } = load(), dec = C2.SaveIO.decode(C2.SaveIO.encode({ progress: JSON.stringify({ line: [hm({}), hm({ uid: 7, src: { uid: 7, port: 'product' } }), hm({ uid: 8 })] }) }));
check(dec.ok && JSON.parse(dec.saves.progress).line.map((n) => n.uid).join() === '7,8' && JSON.parse(dec.saves.progress).line[0].src === 'feed', 'an imported save is cleaned the same way');

console.log('=== job multiplier (#262)');
const MS = load().CS.Missions, jb = { id: 1, mat: 'aluminum', tier: 0, batches: 1, tons: 10, purity: 0.9, windowH: 10, state: 'offered' };
const dj = (mult) => MS.deserialize({ rep: 50, jobs: { board: [Object.assign({ mult: mult }, jb)], active: [], done: [], nextId: 2 } }).jobs.board[0];
check(dj(1e9).mult === MS.JOB.mult[1], 'a huge saved mult is capped at the top of the job range');
check(dj(0.2).mult === 1 && dj(1.4).mult === 1.4, 'a low mult still floors at 1 and a normal one is kept');

console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
