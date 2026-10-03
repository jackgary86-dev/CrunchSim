// Blueprints: a live line serialises to a preset-shaped definition and back without losing machines, settings or wiring.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js'); require('../js/modules/blueprints.js');
const { LINES, FEEDS, MACHINES, Sim, Score, Blueprints: BP } = globalThis.CS;

let fails = 0;
function check(ok, what) { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('=== round-trip the car line');
const car = Sim.buildLine(LINES.car);
const def = BP.serialise(car);
check(def.nodes.length === LINES.car.nodes.length, 'serialise keeps all ' + LINES.car.nodes.length + ' nodes');
check(def.nodes.every((d, i) => d.m === LINES.car.nodes[i].m), 'machines in order');
check(def.nodes.every((d, i) => d.src === LINES.car.nodes[i].src), 'src strings match the preset (' + def.nodes.map((d) => d.src).join(' ') + ')');
check(def.nodes.every((d, i) => Object.keys(LINES.car.nodes[i].s).every((k) => d.s[k] === LINES.car.nodes[i].s[k])), 'preset settings survive');
check(def.nodes.every((d) => Object.keys(MACHINES[d.m].defaults).every((k) => d.s[k] != null)), 'every setting of every machine is present');

const back = BP.deserialise(def);
check(back.length === car.length, 'deserialise rebuilds ' + car.length + ' nodes');
check(Score.signature(back) === Score.signature(car) && Score.signature(car) === 'HAMM>AIR>MAG>ECS>SINK', 'signature ' + Score.signature(back));
check(back.every((n, i) => same(n.settings, car[i].settings)), 'settings identical');
check(back.every((n, i) => n.uid !== car[i].uid), 'fresh uids');
const wiring = (line) => line.map((n) => n.src === 'feed' ? 'feed' : (line.findIndex((x) => x.uid === n.src.uid) + 1) + ':' + n.src.port).join(' ');
check(wiring(back) === wiring(car), 'wiring ' + wiring(back));
check(same(BP.serialise(back), def), 'serialise(deserialise(def)) is def again');

const comp = FEEDS[LINES.car.feed].comp;
const v = (line) => Sim.evalLine(line, comp).terminals.map((t) => Sim.binStats(t.stream.m).value.toFixed(6)).join(',');
check(v(back) === v(car), 'both lines produce identical bin values');

console.log('=== sanitise rejects junk');
const junk = BP.sanitise({ nodes: [
  { m: 'jaw', s: { css: 99999 }, src: '3:product' },          // forward reference, out-of-range setting
  { m: 'warpdrive', s: {}, src: '1:product' },                  // unknown machine
  { m: 'magnet', s: {}, src: '2:product' },                     // points at the dropped node
  { m: 'screen', s: { aperture: 'abc' }, src: '3:extract' },    // valid: node 3 is the magnet after renumbering
  { m: 'eddy', s: {}, src: '1:extract' }                        // jaw has no extract port
] });
check(junk && junk.nodes.length === 4, 'unknown machine dropped, ' + (junk ? junk.nodes.length : 0) + ' kept');
check(junk.nodes[0].s.css === MACHINES.jaw.settings[0].max, 'setting clamped to the range');
check(junk.nodes[0].src === 'feed' && junk.nodes[1].src === 'feed', 'forward and dangling sources fall back to feed');
check(junk.nodes[2].src === '2:extract', 'valid source renumbered to ' + junk.nodes[2].src);
check(junk.nodes[2].s.aperture === MACHINES.screen.defaults.aperture, 'non-numeric setting takes the default');
check(junk.nodes[3].src === 'feed', 'wrong port falls back to feed');
check(BP.sanitise({ nodes: [{ m: 'nope' }] }) === null && BP.sanitise(null) === null && BP.deserialise('x').length === 0, 'nothing usable gives null / empty line');
check(Sim.evalLine(BP.deserialise(junk), FEEDS.elv.comp).terminals.length > 0, 'the sanitised junk still evaluates');

console.log('=== per-contract best');
const C = Score.CONTRACTS.find((c) => c.id === 'ferrous');
const starter = Sim.buildLine({ nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'screen', s: { aperture: 40 }, src: '2:residue' }] });   // the old starter yard: TWIN>MAG>SCRN
const best = {};
check(BP.recordBest(best, { C, stars: 0, kwhT: 5 }, starter, 'elv') === false && !best.ferrous, 'zero stars is not kept');
check(BP.recordBest(best, { C, stars: 2, kwhT: 5.2, fee: 700 }, starter, 'elv') === true && best.ferrous.stars === 2 && best.ferrous.sig === 'TWIN>MAG>SCRN', 'two stars stored with signature');
check(BP.recordBest(best, { C, stars: 2, kwhT: 4 }, car, 'elv') === false && best.ferrous.sig === 'TWIN>MAG>SCRN', 'equal stars do not replace');
check(BP.recordBest(best, { C, stars: 3, kwhT: 4 }, car, 'elv') === true && best.ferrous.stars === 3 && best.ferrous.sig === 'HAMM>AIR>MAG>ECS>SINK', 'more stars replace');
check(Score.evalContract(C, BP.deserialise(best.ferrous.def), null).ev.nodes.length === 5, 'the stored best rebuilds and scores');

console.log('=== auto-offer ordering');
const saved = [
  { id: 'a', name: 'rock', feed: 'quarry', contract: null, def: BP.serialise(Sim.buildLine(LINES.quarry)) },
  { id: 'b', name: 'cars', feed: 'elv', contract: null, def },
  { id: 'c', name: 'steel job', feed: 'elv', contract: 'ferrous', def },
  { id: 'd', name: 'mulch job', feed: 'pallets', contract: 'mulch', def: BP.serialise(Sim.buildLine(LINES.wood)) }
];
let rows = BP.offer(saved, { contract: 'ferrous', contractFeed: 'elv', feedPreset: 'elv' });
check(rows.map((r) => r.bp.id).join('') === 'bcad' && rows[0].fit && rows[1].fit && !rows[2].fit, 'contract active: lines on its feed first, stable order (' + rows.map((r) => r.bp.id + (r.fit ? '*' : '')).join(' ') + ')');
rows = BP.offer(saved, { contract: null, feedPreset: 'pallets' });
check(rows[0].bp.id === 'd' && rows[0].fit && rows.filter((r) => r.fit).length === 1, 'no contract: feed preset match first');
rows = BP.offer(saved, { contract: null, feedPreset: 'custom' });
check(rows.every((r) => !r.fit) && rows.map((r) => r.bp.id).join('') === 'abcd', 'custom feed: nothing tagged, original order');

console.log('=== persisted state is validated');
const st = BP.sanitiseState({ saved: [
  { id: 'x', name: '  keep   me  ', feed: 'elv', tons: 15, contract: 'ferrous', def },
  { id: 'y', name: 'no def', feed: 'elv', def: { nodes: [{ m: 'nope' }] } },
  { id: 'z', name: '', feed: 'elv', def },
  'garbage'
], best: { ferrous: { stars: 9, def, feed: 'elv' }, bogus: { stars: 2, def }, mulch: { stars: 0, def } } });
check(st.saved.length === 1 && st.saved[0].name === 'keep me' && st.saved[0].sig === 'HAMM>AIR>MAG>ECS>SINK' && st.saved[0].contract === 'ferrous', 'one valid blueprint kept, name trimmed, signature recomputed');
check(Object.keys(st.best).join() === 'ferrous' && st.best.ferrous.stars === 3, 'best clamped to 3 stars, unknown contract and 0-star entries dropped');
check(same(BP.sanitiseState(null), { saved: [], best: {} }) && same(BP.sanitiseState('x'), { saved: [], best: {} }), 'missing state gives empty shelves');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nblueprints round-trip');
process.exit(fails ? 1 : 0);
