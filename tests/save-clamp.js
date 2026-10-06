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

console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
