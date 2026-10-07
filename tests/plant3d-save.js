// Checks the plant floor's reading of the game save (js/plant3d.js parseSave / readSave, #260): settings go through
// Sim.cleanSettings, machine levels and wear carry over, and the Rivals save is used when it is the one played last.
// plant3d.js only wires its panels in a browser; a stub window and a never-ready document load it without booting.
globalThis.window = globalThis;
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
globalThis.document = { readyState: 'loading', addEventListener() {} };
require('../js/data.js'); require('../js/sim.js'); require('../js/plant3d.js');
const { MACHINES, LEVEL_MAX, Plant3D } = globalThis.CS;

let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); }

const m = Object.keys(MACHINES).find((id) => (MACHINES[id].settings || []).some((st) => !st.enum));
const st = MACHINES[m].settings.find((x) => !x.enum);
const save = (extra) => JSON.stringify(Object.assign({ line: [{ uid: 1, m, settings: { [st.id]: 'junk' }, wear: 0.4, src: 'feed' }], levels: { [m]: 3 } }, extra));

let r = Plant3D.parseSave(save());
check(r && r.line[0].settings[st.id] === st.def, 'junk setting takes the default');
r = Plant3D.parseSave(save({ line: [{ uid: 1, m, settings: { [st.id]: 1e9 }, src: 'feed' }] }));
check(r.line[0].settings[st.id] === st.max, 'out-of-range setting clamps to its max');
r = Plant3D.parseSave(save());
check(r.line[0].level === 3, 'machine level from the save is applied');
check(Math.abs(r.line[0].wear - 0.4) < 1e-9, 'wear from the save is applied');
r = Plant3D.parseSave(save({ levels: { [m]: 99 } }));
check(r.line[0].level === LEVEL_MAX, 'level clamps to LEVEL_MAX');
check(Plant3D.parseSave('not json') === null && Plant3D.parseSave(null) === null, 'junk text reads as no save');

// which key is offered: the mode played last, else whichever save exists
const lvl = () => { const x = Plant3D.readSave(); return x ? x.line[0].level : null; };
check(lvl() === null, 'no save: nothing offered');
store['crunchsim.v2.rivals'] = save({ levels: { [m]: 2 } });
check(lvl() === 2, 'only a Rivals save: it is offered');
store['crunchsim.v2'] = save({ levels: { [m]: 4 } });
check(lvl() === 4, 'both saves, no mode remembered: Progress');
store['crunchsim.mode'] = 'rivals';
check(lvl() === 2, 'both saves, Rivals played last: Rivals');
store['crunchsim.v2.rivals'] = 'garbage';
check(lvl() === 4, 'unreadable Rivals save falls back to Progress');

{   // #283: the plant floor drops bad uids and ports the way the game does
  const r = Plant3D.parseSave(JSON.stringify({ line: [{ uid: 1, m: 'jaw' }, { uid: 'x', m: 'magnet' }, { uid: 1, m: 'magnet' }, { uid: 3, m: 'magnet', src: { uid: 1, port: 'nope' } }, { uid: 4, m: 'sinkfloat', src: { uid: 3, port: 'extract' } }] }));
  check(r && r.line.map((n) => n.uid).join() === '1,3,4', 'a missing or repeated uid is dropped (' + (r && r.line.map((n) => n.uid).join()) + ')');
  check(r && r.line[1].src === 'feed' && r.line[2].src.uid === 3 && r.line[2].src.port === 'extract', 'a port the machine lacks reads the feed; a real one is kept');
}
process.exit(fails ? 1 : 0);
