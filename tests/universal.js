// Runs the universal sorting plant on the 'everything' and 'elv' feeds and reports, per material, the purity and
// recovery of the bin where most of it lands. Steel, aluminum and wood must each reach 85% purity wherever they are a
// product (at least 5% of the feed); a trace constituent such as the 1% of wood in a car cannot form a product bin.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
const { MATERIALS, MAT_ORDER, MACHINES, FEEDS, LINES, Sim, Score } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
const PURITY_MIN = 0.85, PRODUCT_FRAC = 0.05, MUST = ['steel', 'aluminum', 'wood'];
let fails = 0;
function fail(msg) { fails++; console.log('  !! ' + msg); }

// the feeds this ticket added must be complete and normalised
for (const id of ['chair', 'appliance', 'everything']) {
  const F = FEEDS[id]; if (!F) { fail('feed ' + id + ' is missing'); continue; }
  let tot = 0; for (const m in F.comp) { tot += F.comp[m]; if (!MATERIALS[m]) fail('feed ' + id + ' names unknown material ' + m); }
  if (Math.abs(tot - 1) > 1e-6) fail('feed ' + id + ' weights sum to ' + tot.toFixed(4) + ', not 1');
}
if (Object.keys(FEEDS.everything.comp).length !== MAT_ORDER.length) fail('everything should list all ' + MAT_ORDER.length + ' materials');
if (LINES.universal.feed !== 'everything') fail('universal line should be designed for the everything feed');

for (const feedId of ['everything', 'elv']) {
  const L = LINES.universal, line = Sim.buildLine(L), comp = FEEDS[feedId].comp;
  const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line);
  const bins = ev.terminals.map((t) => {
    const n = ev.nodes.find((x) => x.uid === t.uid), st = Sim.binStats(t.stream.m);
    return { name: n.M.short + '/' + t.port, st, m: t.stream.m };
  });
  let value = 0; bins.forEach((b) => { value += b.st.value; });
  console.log('\n=== ' + L.name + ' on ' + FEEDS[feedId].name + ': head rate ' + f(mr.R) + ' t/h, ' + f(Score.plantKwhT(ev, mr.R, line)) + ' kWh/t, product $' + f(value, 0) + ' per tonne of feed');
  bins.forEach((b) => {
    if (b.st.total < 0.5) return;
    const top = Object.entries(b.st.perMat).sort((a, c) => c[1].mass - a[1].mass).slice(0, 4).map(([m, v]) => m + ' ' + f(100 * v.mass / b.st.total, 0) + '%').join(', ');
    console.log('  ' + b.name.padEnd(14) + f(b.st.total, 0).padStart(5) + ' kg  P80 ' + f(b.st.p80, 1).padStart(6) + ' mm  $' + f(b.st.value, 0).padStart(4) + '  [' + top + ']');
  });
  console.log('  material      feed %   main bin        purity  recovery');
  MAT_ORDER.forEach((mat) => {
    const head = ev.head.m[mat] ? Sim.sum(ev.head.m[mat]) : 0; if (head <= 0) return;
    let best = null;
    bins.forEach((b) => { const kg = b.m[mat] ? Sim.sum(b.m[mat]) : 0; if (!best || kg > best.kg) best = { b, kg }; });
    const purity = best.kg / best.b.st.total, rec = best.kg / head, frac = head / 1000;
    const must = MUST.indexOf(mat) >= 0 && frac >= PRODUCT_FRAC;
    const note = must ? (purity >= PURITY_MIN ? '  ok' : '  BELOW ' + Math.round(PURITY_MIN * 100) + '%') : (MUST.indexOf(mat) >= 0 ? '  (trace: not a product here)' : '');
    console.log('  ' + mat.padEnd(12) + f(100 * frac, 1).padStart(6) + '%   ' + best.b.name.padEnd(16) + f(100 * purity, 1).padStart(5) + '%   ' + f(100 * rec, 1).padStart(5) + '%' + note);
    if (must && purity < PURITY_MIN) fail(mat + ' on ' + feedId + ': purity ' + f(100 * purity, 1) + '% in ' + best.b.name);
  });
}
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nuniversal plant: steel, aluminum and wood each reach 85% purity where they are a product');
process.exit(fails ? 1 : 0);
