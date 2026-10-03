// Ticket #4: sensor-based sorter (XRT / LIBS). A zorba feed is torn, the aluminum floated off at 2.9 g/cc,
// and the sorter picks copper out of the sinks. Checks the partition curve, the data entry and the line result.
require('../js/data.js'); require('../js/sim.js');
const { MATERIALS, MACHINES, MACHINE_GROUPS, FEEDS, Sim } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, text) { console.log((ok ? '  ok   ' : '  FAIL ') + text); if (!ok) fails++; }

/* ---- data entry ---- */
const M = MACHINES.sensor;
check(!!M && M.kind === 'separator' && M.scene === 'sensor', 'sensor machine exists as a separator with its own scene');
check(M.defaults.target === 'copper', 'enum setting defaults to copper (defaults.target = ' + M.defaults.target + ')');
check(M.settings[0].enum === globalThis.CS.MAT_ORDER && M.settings[0].min == null, 'target setting is an enum over MAT_ORDER with no min/max');
check(MACHINE_GROUPS.some(([g, ids]) => g === 'Separation' && ids.includes('sensor')), 'sensor is listed in the Separation group');
check(M.price === 60000, 'price after PRICE_SCALE is $60,000 (got ' + M.price + ')');

/* ---- partition curve ---- */
const s = { target: 'copper' }, Cu = MATERIALS.copper;
const p = (D, x) => Sim.pExtract(M, s, D, x);
console.log('  copper eject probability by size: ' + [1, 3, 5, 10, 50, 150, 200, 300].map((x) => x + ' mm ' + f(p(Cu, x) * 100, 0) + '%').join(', '));
check(Math.abs(p(Cu, 3) - 0.30) < 0.04, 'copper at 3 mm is about 30% (' + f(p(Cu, 3) * 100, 0) + '%)');
check(p(Cu, 10) > 0.88 && p(Cu, 50) > 0.915 && p(Cu, 150) > 0.915, 'copper at 10-150 mm is about 92%');
check(Math.abs(p(Cu, 300) - 0.70) < 0.01, 'copper above 200 mm is about 70% (' + f(p(Cu, 300) * 100, 0) + '%)');
check(Math.abs(p(MATERIALS.aluminum, 50) - 0.025) < 1e-9 && Math.abs(p(MATERIALS.brass, 50) - 0.025) < 1e-9, 'other materials are 2.5% false positives');
check(p(MATERIALS.water, 50) === 0, 'liquids are never ejected');
check(Math.abs(Sim.pExtract(M, { target: 'aluminum' }, MATERIALS.aluminum, 50) - 0.92) < 0.002, 'switching the target to aluminum ejects aluminum');

/* ---- the line: twin, sink-float 2.9, sensor target copper on zorba ---- */
const line = Sim.buildLine({ nodes: [
  { m: 'twin', s: { width: 40 }, src: 'feed' },
  { m: 'sinkfloat', s: { sg: 2.9 }, src: '1:product' },
  { m: 'sensor', s: { target: 'copper' }, src: '2:residue' }
] });
const ev = Sim.evalLine(line, FEEDS.zorba.comp), mr = Sim.maxRate(ev.nodes, line);
const sensor = line[2], inf = ev.nodes[2];
const ext = ev.ports[sensor.uid + ':extract'], res = ev.ports[sensor.uid + ':residue'];
const cuHead = Sim.sum(ev.head.m.copper), cuExt = ext.m.copper ? Sim.sum(ext.m.copper) : 0;
const extTot = Sim.streamMass(ext), resTot = Sim.streamMass(res);
const purity = extTot > 0 ? cuExt / extTot : 0, recovery = cuHead > 0 ? cuExt / cuHead : 0;

console.log('\n=== zorba > twin 40 mm > sink-float 2.9 > sensor (copper)   head rate ' + f(mr.R) + ' t/h, limited by node ' + (mr.limiter && (line.findIndex((n) => n.uid === mr.limiter.uid) + 1)) + ' ' + (mr.limiter && mr.limiter.why));
console.log('  sensor feed ' + f(inf.inKg, 0) + ' kg/t, F80 ' + f(inf.F80, 1) + ' mm, ' + f(inf.eT, 1) + ' kWh/t, cap ' + f(inf.capTph, 1) + ' t/h');
console.log('  material      feed kg   to extract   to residue');
Object.keys(inf.perMat).sort((a, b) => inf.perMat[b].mass - inf.perMat[a].mass).forEach((m) => {
  const pm = inf.perMat[m];
  console.log('  ' + m.padEnd(12) + f(pm.mass, 1).padStart(8) + f(pm.extract, 1).padStart(12) + ' (' + f(pm.extractFrac * 100, 0).padStart(3) + '%)' + f(pm.mass - pm.extract, 1).padStart(9));
});
inf.warnings.forEach((w) => console.log('      [' + w.level + '] ' + w.text));
const bs = Sim.binStats(ext.m);
console.log('  extract bin: ' + f(extTot, 1) + ' kg, P80 ' + f(bs.p80, 1) + ' mm, value $' + f(bs.value, 0) + ' per head tonne, grade ' + f(bs.grade, 2));
console.log('  COPPER PURITY of extract ' + f(purity * 100, 1) + '%   COPPER RECOVERY ' + f(recovery * 100, 1) + '%   (copper in head feed ' + f(cuHead, 1) + ' kg/t)\n');

check(purity > 0.85, 'copper purity of the sensor extract is above 85% (' + f(purity * 100, 1) + '%)');
check(recovery > 0.60, 'copper recovery is above 60% (' + f(recovery * 100, 1) + '%)');
check(Math.abs(extTot + resTot - inf.inKg) < 1e-6, 'mass balance across the sorter holds');
check(mr.R > 0, 'the line can run (head rate ' + f(mr.R, 2) + ' t/h)');
check(!inf.warnings.some((w) => w.level === 'bad'), 'no faults on the sorter');

/* ---- warnings fire when they should ---- */
const dumb = Sim.buildLine({ nodes: [{ m: 'sensor', s: { target: 'gel' }, src: 'feed' }] });
const ev2 = Sim.evalLine(dumb, FEEDS.zorba.comp);
check(ev2.nodes[0].warnings.some((w) => /Almost no Hydrogel/.test(w.text)), 'warns when the target material is not in the feed');
const fine = Sim.buildLine({ nodes: [{ m: 'single', s: { screen: 10 }, src: 'feed' }, { m: 'sensor', s: { target: 'copper' }, src: '1:product' }] });
const ev3 = Sim.evalLine(fine, { copper: 0.5, aluminum: 0.5 });
check(ev3.nodes[1].warnings.some((w) => /under 10 mm/.test(w.text)), 'warns when the feed is mostly fines');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nsensor sorter checks pass');
process.exit(fails ? 1 : 0);
