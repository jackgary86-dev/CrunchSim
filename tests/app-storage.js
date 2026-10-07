// #254: with localStorage throwing, a mode switch keeps each mode's game in memory and the player is warned once that nothing is saved.
// Run: node tests/app-storage.js
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

const { app, S } = load();
const boom = () => { throw new Error('SecurityError'); };
globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
const logEl = globalThis.document.querySelector('#log'), seen = [];
logEl.prepend = (d) => { seen.push(String(d.innerHTML)); };
const warned = () => seen.filter((t) => /not being saved/.test(t)).length;
app.softReset();
check(warned() === 1, 'the first failed save warns that progress is not being saved');
S.batches = 3; S.tonnes = 16; S.money = 1657;
app.save();
app.switchMode('rivals');
check(S.mode === 'rivals' && S.batches === 0, 'Rivals starts fresh');
S.money = 1234;
app.switchMode('progress');
check(S.mode === 'progress' && S.batches === 3 && S.tonnes === 16 && S.money === 1657, 'switching back keeps the Progress game (batches ' + S.batches + ', tonnes ' + S.tonnes + ', money ' + S.money + ')');
app.switchMode('rivals');
check(S.money === 1234, 'and the Rivals game');

app.save(); app.save();
check(warned() >= 1 && seen.filter((t) => /not being saved/.test(t)).length === warned(), 'repeat failures do not add a warning per save');

check(JSON.parse(app.readSave(app.saveKeys().rivals) || 'null').money === 1234 && JSON.parse(app.readSave(app.saveKeys().progress) || 'null').money === 1657, '#278: readSave serves both games from memory (export and the title cards read it)');

// #283: one write that throws does not end saving: the game stays in memory and the next save that works reaches the disk
{
  const e2 = load(), store = {}; let fail = 1;
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { if (fail-- > 0) throw new Error('QuotaExceededError'); store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const k = e2.app.saveKeys().progress;
  e2.S.money = 4321; e2.app.save();
  check(!(k in store) && JSON.parse(e2.app.readSave(k)).money === 4321, 'a refused write keeps the save in memory');
  e2.S.money = 5555; e2.app.save();
  check(k in store && JSON.parse(store[k]).money === 5555, 'the next save reaches storage (money ' + (store[k] ? JSON.parse(store[k]).money : '-') + ')');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' app-storage checks pass'));
process.exit(fails ? 1 : 0);
