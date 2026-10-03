require('../js/data.js'); require('../js/sim.js');
const { MATERIALS, MACHINES, FEEDS, LINES, Sim } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
for (const [id, L] of Object.entries(LINES)) {
  const line = Sim.buildLine(L);
  const comp = FEEDS[L.feed].comp;
  const ev = Sim.evalLine(line, comp);
  const mr = Sim.maxRate(ev.nodes, line);
  console.log('\n=== ' + L.name + '  (feed: ' + FEEDS[L.feed].name + ')  max head rate ' + f(mr.R) + ' t/h, limited by node uid ' + (mr.limiter && mr.limiter.uid) + ' ' + (mr.limiter && mr.limiter.why));
  let totalKW = 0;
  ev.nodes.forEach((n, i) => {
    const P = Math.min(n.M.prated, n.M.pidle + mr.R * n.ePerHead); totalKW += P;
    console.log(' ' + (i + 1) + ' ' + n.M.name.padEnd(28) + ' in ' + f(n.flowIn * 1000, 0).padStart(5) + ' kg/t  acc ' + f(n.flowAcc * 1000, 0).padStart(5) + '  rej ' + f(n.flowRej * 1000, 0).padStart(4) + '  F80 ' + f(n.F80, 2).padStart(7) + ' -> P80 ' + f(n.P80, 3).padStart(7) + 'mm  E ' + f(n.eT, 2).padStart(6) + ' kWh/t  cap ' + f(n.capTph, 1).padStart(6) + ' t/h  P ' + f(P, 0) + ' kW');
    n.warnings.forEach(w => console.log('      [' + w.level + '] ' + w.text));
  });
  console.log('  plant power at max rate: ' + f(totalKW, 0) + ' kW  (' + f(totalKW / Math.max(mr.R, 1e-9), 1) + ' kWh/t)');
  console.log('  PRODUCT BINS (per tonne of head feed):');
  let massOut = 0;
  for (const t of ev.terminals) {
    const st = Sim.binStats(t.stream.m); massOut += st.total;
    if (st.total < 0.5) continue;
    const comps = Object.entries(st.perMat).sort((a, b) => b[1].mass - a[1].mass).slice(0, 4).map(([m, v]) => m + ' ' + f(100 * v.mass / st.total, 0) + '%').join(', ');
    const nm = MACHINES[line[ev.nodes.findIndex(n => n.uid === t.uid)].m];
    console.log('   ' + (nm.short + ':' + t.port).padEnd(14) + f(st.total, 0).padStart(6) + ' kg  P80 ' + f(st.p80, 2).padStart(8) + ' mm  value $' + f(st.value, 0).padStart(5) + '  grade ' + f(st.grade, 2) + '  [' + comps + ']');
  }
  console.log('  mass balance: ' + f(massOut, 1) + ' kg out of 1000 in');
}
