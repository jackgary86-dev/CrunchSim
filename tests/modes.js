// #87: the title screen's save summaries (CS.Modes.summary) and place names.
global.window = undefined;
require('../js/data.js'); require('../js/modules/modes.js');
const M = globalThis.CS.Modes;
let fails = 0, n = 0;
function check(c, msg) { n++; if (!c) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }

check(M.summary('progress', null).has === false && M.summary('progress', 'junk').has === false && M.summary('progress', '{"line":5}').has === false, 'no save, junk or a save without a line: nothing to continue');
const p = M.summary('progress', JSON.stringify({ line: [{ m: 'hammer' }, { m: 'magnet' }], money: 1234.5, batches: 7, tonnes: 210 }));
check(p.has && p.money === 1234.5 && p.batches === 7 && p.tonnes === 210 && p.machines === 2 && p.round === undefined, 'a Progress save: bank, batches, tonnes, machines');
const r0 = M.summary('rivals', JSON.stringify({ line: [], money: 2800 }));
check(r0.has && r0.round === 0 && r0.length === 12 && !r0.over, 'a Rivals save before round 1: round 0 of the default 12');
const r = M.summary('rivals', JSON.stringify({ line: [], money: 900, ext: { round: { n: 5, match: { length: 8, over: false } } } }));
check(r.round === 5 && r.length === 8 && !r.over, 'a match in progress: round 5 of 8');
check(M.summary('rivals', JSON.stringify({ line: [], ext: { round: { n: 12, match: { length: 12, over: true } } } })).over === true, 'a finished match');
check(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'].join() === [1, 2, 3, 4, 11, 12, 13, 21, 22].map(M.ord).join(), 'place names');

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' modes checks pass'));
process.exit(fails ? 1 : 0);
