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
const carUse = Floor.floorUsed(car);
ok(carUse > Floor.hallArea(0), 'car line should not fit the level-0 hall (' + f(carUse) + ' vs ' + Floor.hallArea(0) + ')');
ok(carUse <= Floor.hallArea(2), 'car line should fit the level-2 hall (' + f(carUse) + ' vs ' + Floor.hallArea(2) + ')');
ok(!Floor.check(car, 0).ok && Floor.check(car, 2).ok, 'check() must agree with the hall areas');
ok(Floor.check(starter, 0).ok, 'the starter yard must fit the day-one hall');
ok(Floor.floorUsed([]) === 0 && Floor.check([], 0).free === Floor.hallArea(0), 'an empty line uses no floor');

console.log('\n=== vetoes');
const quarry = Sim.buildLine(LINES.quarry);   // 71.5 m2: a 45.5 m2 hammermill no longer fits the 96 m2 hall
const addHammer = Floor.addVeto(quarry, 'hammer', 0);
ok(addHammer && /Plant hall/.test(addHammer), 'adding a hammermill to the quarry plant at level 0 should be refused');
ok(Floor.addVeto(quarry, 'hammer', 1) === '', 'the hammermill should fit after one hall upgrade');
ok(Floor.addVeto(starter, 'hammer', 0) === '', 'a hammermill should still fit next to the starter yard (85.8 of 96 m2)');
ok(Floor.addVeto(starter, 'granulator', 0) === '', 'a granulator should fit the starter hall');
ok(Floor.addVeto(starter, 'no-such-machine', 0) === '', 'an unknown machine is not the floor module\'s problem');
const lineV = Floor.lineVeto(LINES.car.nodes, 0, LINES.car.name);
ok(lineV && lineV.indexOf(LINES.car.name) >= 0, 'the car line preset should be refused at level 0');
ok(Floor.lineVeto(LINES.car.nodes, 2, LINES.car.name) === '', 'the car line preset should load at level 2');
console.log('  ' + addHammer);
console.log('  ' + lineV);

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nfloor space checks pass');
process.exit(fails ? 1 : 0);
