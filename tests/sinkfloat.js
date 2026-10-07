// #288: a sink-float tank filled with plain water. Free water joins the medium and leaves with the overflow (never in the
// sinks), the cut near 1.0 g/cc is sharp, heavy media keep their spread, and water never sets a bin's purity.
require('../js/data.js'); require('../js/sim.js');
const { Sim, MATERIALS, MACHINES } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const M = MACHINES.sinkfloat, p = (m, sg) => Sim.pExtract(M, { sg }, MATERIALS[m], 30);

check(p('water', 1.0) === 1 && p('water', 2.9) === 1, 'free water always leaves with the floats overflow');
check(p('plastic', 1.0) > 0.8 && p('wood', 1.0) > 0.95, 'at 1.0 g/cc plastic (0.95) floats ' + f(p('plastic', 1.0) * 100, 0) + '% and wood (0.9) ' + f(p('wood', 1.0) * 100, 0) + '%');
check(p('rubber', 1.0) < 0.05 && p('glass', 1.0) < 1e-6, 'rubber and glass sink in water');
// a heavy medium keeps the spread it had before #288 (the car line's zorba split is balanced on it)
check(Math.abs(p('aluminum', 2.9) - 1 / (1 + Math.exp((2.7 - 2.9) / (0.05 * 2.9 + 0.03)))) < 1e-12, 'at 2.9 g/cc the separation curve is unchanged');

// pallets: wood with nails and rain water through a chipper and a water tank
for (const comp of [{ wood: 0.9, steel: 0.04, water: 0.06 }, { wood: 0.9, steel: 0.04 }]) {
  const L = [Sim.makeNode('chipper'), Sim.makeNode('sinkfloat')]; L[1].src = { uid: L[0].uid, port: 'product' };
  const ev = Sim.evalLine(L, comp), port = (k) => ev.terminals.find((t) => t.key === L[1].uid + ':' + k);
  const fl = Sim.binStats(port('extract').stream.m), sk = Sim.binStats(port('residue').stream.m);
  const tag = comp.water ? 'wet' : 'dry';
  console.log('  ' + tag + ': floats ' + f(fl.total, 0) + ' kg ' + f(fl.share * 100) + '% ' + fl.main + ' (water ' + f(fl.liquid, 0) + ' kg), sinks ' + f(sk.total, 0) + ' kg ' + f(sk.share * 100) + '% ' + sk.main);
  check(!sk.perMat.water && sk.sellable && sk.main === 'steel', tag + ': the sinks are sellable steel with no water in them');
  check(fl.sellable && fl.main === 'wood', tag + ': the floats are sellable wood');
  const out = ev.terminals.reduce((a, t) => a + Sim.streamMass(t.stream), 0);
  check(Math.abs(out - 1000) < 1e-6, tag + ': mass balance holds (' + f(out, 6) + ' kg)');
}

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall sink-float checks pass');
process.exit(fails ? 1 : 0);
