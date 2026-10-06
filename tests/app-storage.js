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

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' app-storage checks pass'));
process.exit(fails ? 1 : 0);
