// Floor space: machine footprints, floor use of the preset lines, the plant hall upgrade and the fit checks on CS.Floor.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/floor.js');
const { MACHINES, LINES, PLANT_UPGRADES, Sim, Floor } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('  !! ' + msg); } }

console.log('=== footprints');
for (const id in MACHINES) {
  const M = MACHINES[id], fp = Floor.footprint(id);
  ok(M.foot && M.foot.w > 0 && M.foot.d > 0, id + ' has no footprint');
  ok(fp.area === M.foot.w * M.foot.d, id + ' footprint area mismatch');
  ok(Math.abs(Floor.machineArea(id) - fp.area * Floor.ACCESS) < 1e-9, id + ' machine area does not include access');
  console.log('  ' + id.padEnd(11) + (M.foot.w + 'x' + M.foot.d + ' m').padStart(8) + '  ' + f(fp.area, 0).padStart(3) + ' m2  with access ' + f(Floor.machineArea(id)).padStart(5) + ' m2');
}
ok(Floor.footprint('no-such-machine').area === Floor.DEFAULT_FOOT.w * Floor.DEFAULT_FOOT.d, 'unknown machine should fall back to the default skid');

console.log('\n=== plant hall upgrade');
const R = PLANT_UPGRADES.room;
ok(R && R.levels.length === 5 && R.costs.length === 4, 'room upgrade must have 5 levels and 4 costs');
ok(R.unit === 'm²', 'room unit should be m2');
R.levels.forEach((a, i) => { ok(a === R.dims[i][0] * R.dims[i][1], 'level ' + i + ' area does not match its dims'); ok(i === 0 || a > R.levels[i - 1], 'levels must grow'); });
R.costs.forEach((c, i) => ok(i === 0 || c > R.costs[i - 1], 'costs must grow'));
for (let i = 0; i < R.levels.length; i++) console.log('  level ' + i + ': ' + Floor.hallDims(i).padEnd(10) + ' ' + Floor.hallArea(i) + ' m2' + (i < R.costs.length ? '  next costs $' + R.costs[i] : ''));
ok(Floor.hallArea(-3) === R.levels[0] && Floor.hallArea(99) === R.levels[4], 'hall level must clamp');

console.log('\n=== preset lines');
for (const [id, L] of Object.entries(LINES)) {
  const line = Sim.buildLine(L), c0 = Floor.check(line, 0), lv = Floor.levelFor(line);
  ok(Math.abs(Floor.floorUsed(line) - Floor.floorUsed(L.nodes)) < 1e-9, id + ': preset nodes and built nodes must use the same floor');
  console.log('  ' + L.name.padEnd(22) + f(c0.used).padStart(6) + ' m2  fits from hall level ' + lv + (c0.ok ? '' : '  (needs an upgrade)'));
}
const car = Sim.buildLine(LINES.car), starter = Sim.buildLine(LINES.starter);
// #51: the day-one hall (16 x 10 m) takes a grinder and the five sorters of the starting sorter slots
const five = Sim.buildLine({ nodes: ['hammer', 'magnet', 'eddy', 'sinkfloat', 'air', 'screen'].map((m, i) => ({ m, src: i ? '1:product' : 'feed' })) });
ok(Floor.check(five, 0).ok, 'a grinder and five sorters fit the day-one hall (' + f(Floor.floorUsed(five)) + ' of ' + Floor.hallArea(0) + ' m2)');
ok(Floor.check(car, 0).ok, 'the car line fits the day-one hall');
ok(Floor.check(starter, 0).ok, 'the starter yard must fit the day-one hall');
ok(Floor.floorUsed([]) === 0 && Floor.check([], 0).free === Floor.hallArea(0), 'an empty line uses no floor');
const big = five.concat([Sim.makeNode('sensor', {}, 'feed'), Sim.makeNode('hammer', {}, 'feed')]);
ok(!Floor.check(big, 0).ok && Floor.check(big, 1).ok, 'a second grinder and a sixth sorter need the next hall (' + f(Floor.floorUsed(big)) + ' m2)');

console.log('\n=== vetoes');
const addHammer = Floor.addVeto(five.concat([Sim.makeNode('sensor', {}, 'feed')]), 'hammer', 0);
ok(addHammer && /Plant hall/.test(addHammer), 'a second hammermill next to a full sorting line is refused at level 0');
ok(Floor.addVeto(five, 'hammer', 1) === '', 'it fits after one hall upgrade');
['sinkfloat', 'eddy', 'air', 'screen', 'sensor'].forEach((m) => ok(Floor.addVeto(starter, m, 0) === '', 'the next sorter (' + m + ') fits next to the starter yard at hall level 0'));
ok(Floor.addVeto(starter, 'granulator', 0) === '', 'a granulator should fit the starter hall');
ok(Floor.addVeto(starter, 'no-such-machine', 0) === '', 'an unknown machine is not the floor module\'s problem');
const bigNodes = big.map((x) => ({ m: x.m }));
const lineV = Floor.lineVeto(bigNodes, 0, 'Big line');
ok(lineV && lineV.indexOf('Big line') >= 0, 'a preset bigger than the hall is refused at level 0');
ok(Floor.lineVeto(bigNodes, 1, 'Big line') === '', 'and loads after the upgrade');
// #231: a pair bought together needs both footprints: three hammermills leave room for one sink-float, not two
const trio = [1, 2, 3].map(() => Sim.makeNode('hammer', {}, 'feed')), sfNeed = Floor.machineArea('sinkfloat');
ok(Floor.check(trio, 0).free >= sfNeed && Floor.check(trio, 0).free < 2 * sfNeed, 'setup: one sink-float fits and two do not (' + f(Floor.check(trio, 0).free) + ' m2 free)');
ok(Floor.addVeto(trio, 'sinkfloat', 0) === '' && Floor.addVeto(trio, 'sinkfloat', 0, []) === '', 'the first of the pair fits');
ok(/Plant hall/.test(Floor.addVeto(trio, 'sinkfloat', 0, ['sinkfloat'])), 'the second sink-float is refused once the first is pending');
ok(Floor.addVeto(trio, 'sinkfloat', 1, ['sinkfloat']) === '', 'and fits after a hall upgrade');
console.log('  ' + addHammer);
console.log('  ' + lineV);

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nfloor space checks pass');
process.exit(fails ? 1 : 0);
