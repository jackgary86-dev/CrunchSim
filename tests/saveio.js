// Export and import a save code (#82). Run: node tests/saveio.js
require('../js/data.js'); require('../js/modules/saveio.js');
const { SaveIO: IO } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const prog = JSON.stringify({ line: [{ uid: 1, m: 'hammer' }], money: 1234, ext: { note: 'café · 99%' } });
const riv = JSON.stringify({ line: [], money: 5 });
const code = IO.encode({ progress: prog, rivals: riv, mode: 'rivals', at: '2026-10-06T03:00:00Z' });
check(code.indexOf(IO.PREFIX) === 0, 'the code starts with its prefix');
const back = IO.decode(code);
check(back.ok && back.saves.progress === prog && back.saves.rivals === riv && back.saves.mode === 'rivals', 'both saves and the mode round-trip exactly (non-ASCII too)');
check(IO.decode(IO.encode({ progress: prog, rivals: null })).ok, 'a code with only one mode\'s save is fine');
check(!IO.decode('hello').ok && /not a CrunchSim/.test(IO.decode('hello').why), 'something else is refused with a reason');
check(!IO.decode(IO.PREFIX + 'not-base64!!').ok, 'a damaged code is refused');
check(!IO.decode(IO.encode({ progress: '{"money":1}', rivals: null })).ok, 'a save that is not a game is refused');
check(!IO.decode(IO.encode({ progress: null, rivals: null })).ok, 'an empty code is refused');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' save-code checks pass');
process.exit(fails ? 1 : 0);
