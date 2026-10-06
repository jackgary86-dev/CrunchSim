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
check(IO.isNewer('{"rev":5,"line":[]}', 4) && !IO.isNewer('{"rev":4,"line":[]}', 4) && !IO.isNewer('{"line":[]}', 0), 'a stored save is newer only when its revision is higher (older saves count as 0)');
check(!IO.isNewer(null, 3) && !IO.isNewer('garbage', 3), 'no save, or an unreadable one, never blocks a write');
// #196: the import check
const enc = (o) => IO.encode(Object.assign({ progress: null, rivals: null }, o));
const pr = (o) => JSON.stringify(Object.assign({ line: [{ uid: 1, m: 'hammer' }], money: 10 }, o));
check(!IO.decode(enc({ progress: pr({ line: [null] }) })).ok, 'a line holding null is refused');
check(!IO.decode(enc({ progress: pr({ line: [{ uid: 1, m: 'nope' }] }) })).ok, 'a machine the game does not know is refused');
check(!IO.decode(enc({ progress: pr({ line: [7] }) })).ok, 'a line node that is not an object is refused');
check(!IO.decode(enc({ progress: pr({ line: new Array(500).fill({ uid: 1, m: 'hammer' }) }) })).ok, 'an absurdly long line is refused');
check(!IO.decode(enc({ progress: 'x'.repeat(2100000) })).ok, 'an oversized save is refused');
check(!IO.decode(IO.PREFIX + Buffer.from(JSON.stringify({ v: 1, at: 5, progress: prog })).toString('base64')).ok, 'a numeric date is refused');
const big = IO.decode(enc({ progress: '{"line":[{"uid":1,"m":"hammer"}],"money":1e308,"lifetime":1e999,"ext":{"inv":{"t":1e999}}}' }));
const bg = big.ok && JSON.parse(big.saves.progress);
check(big.ok && bg.money === 1e12 && bg.lifetime === 1e12 && bg.ext.inv.t === 1e12, 'huge and infinite numbers are clamped, nested ones too');
check(IO.decode(enc({ progress: pr({ money: -50 }) })).ok && JSON.parse(IO.decode(enc({ progress: pr({ money: -50 }) })).saves.progress).money === -50, 'a normal negative bank survives');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' save-code checks pass');
process.exit(fails ? 1 : 0);
