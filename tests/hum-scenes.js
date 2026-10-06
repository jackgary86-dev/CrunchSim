// Machine hums (#281): every cam scene a machine uses has its own HUM entry, so none falls back to the jaw crusher drone.
// Run: node tests/hum-scenes.js
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
globalThis.window = globalThis; globalThis.CS = {}; globalThis.localStorage = { getItem: () => null, setItem() {} };
require('../js/data.js'); require('../js/audio.js');
const HUM = CS.Audio.humTable();
const scenes = [...new Set(Object.values(CS.MACHINES).map((m) => m.scene))].sort();
scenes.forEach((s) => check(!!HUM[s] && typeof HUM[s].lp === 'number', 'scene "' + s + '" has its own hum entry'));
check(scenes.includes('furnace'), 'the furnace scene is used by a machine');
check(HUM.furnace && HUM.furnace.f !== HUM.jaw.f, 'the furnace hum is not the jaw crusher drone (' + (HUM.furnace && HUM.furnace.f) + ' Hz vs ' + HUM.jaw.f + ' Hz)');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall hum checks pass');
process.exit(fails ? 1 : 0);
