// Measures what intended lines achieve on every contract, so caps and floors are set from real numbers.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js');
const { LINES, Sim, Score } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';

// intended solutions (preset shape: src 'k:port' is 1-based)
const INTENDED = {
  ferrous: [
    ['starter yard', { nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'screen', s: { aperture: 40 }, src: '2:residue' }] }],
    ['car line', LINES.car],
  ],
  mulch: [
    ['wood line', LINES.wood],
    ['twin, magnet, chipper', { nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'chipper', s: { len: 20 }, src: '2:residue' }] }],
    ['chipper only (trap)', { nodes: [{ m: 'chipper', s: { len: 20 }, src: 'feed' }] }],
  ],
  roadbase: [
    ['jaw, cone, screen', { nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'cone', s: { css: 20 }, src: '1:product' }, { m: 'screen', s: { aperture: 25 }, src: '2:product' }] }],
    ['jaw, cone', { nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'cone', s: { css: 18 }, src: '1:product' }] }],
    ['quarry line (trap: mill)', LINES.quarry],
  ],
  flour: [
    ['quarry line', LINES.quarry],
    ['jaw, tight cone, mill', { nodes: [{ m: 'jaw', s: { css: 80 }, src: 'feed' }, { m: 'cone', s: { css: 14 }, src: '1:product' }, { m: 'ball', s: { target: 0.5 }, src: '2:product' }] }],
    ['jaw straight to mill (trap)', { nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'ball', s: { target: 0.5 }, src: '1:product' }] }],
  ],
  rebar: [
    ['jaw, magnet, air, cone', { nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'air', s: { air: 11 }, src: '2:residue' }, { m: 'cone', s: { css: 30 }, src: '3:residue' }] }],
    ['jaw, cone (trap)', { nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'cone', s: { css: 30 }, src: '1:product' }] }],
  ],
  crumb: [
    ['tire line', LINES.tire],
    ['fiber off before cryo', { nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'single', s: { screen: 30 }, src: '1:product' }, { m: 'air', s: { air: 9 }, src: '2:product' }, { m: 'cryo', s: { target: 1.0 }, src: '3:residue' }, { m: 'magnet', s: { field: 250 }, src: '4:product' }] }],
    ['hammermill (trap)', { nodes: [{ m: 'hammer', s: { grate: 30, rpm: 100 }, src: 'feed' }] }],
  ],
  zorba: [
    ['twin, sink-float 2.9', { nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 2.9 }, src: '1:product' }] }],
    ['twin, sink-float 3.2', { nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] }],
    ['twin, eddy (trap)', { nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'eddy', s: { rpm: 3000 }, src: '1:product' }] }],
    ['sink-float unshredded (trap)', { nodes: [{ m: 'sinkfloat', s: { sg: 3.2 }, src: 'feed' }] }],
  ],
  gel: [
    ['gel micronizer', LINES.hydro],
    ['single + colloid (trap)', { nodes: [{ m: 'single', s: { screen: 20 }, src: 'feed' }, { m: 'colloid', s: { gap: 100 }, src: '1:product' }] }],
  ],
};

let fails = 0;
for (const C of Score.CONTRACTS) {
  console.log('\n=== ' + C.name + ' (' + C.feed + ', ' + C.tons + ' t): ' + C.label + ' purity>=' + C.purityMin + ' rec>=' + C.recMin + ' P80 ' + C.p80.join('-') + ' mm  energy<=' + C.kwhCap);
  const cases = INTENDED[C.id] || [];
  cases.forEach(([name, def], idx) => {
    const line = Sim.buildLine(def);
    const r = Score.evalContract(C, line, null);
    const ship = r.shipped.map(b => { const n = r.ev.nodes.find(x => x.uid === b.uid); return n.M.short + '/' + b.port; }).join('+') || 'none';
    console.log('  ' + name.padEnd(30) + ' stars ' + r.stars + '  purity ' + f(r.purity * 100, 0).padStart(3) + '%  rec ' + f(r.recovery * 100, 0).padStart(3) + '%  P80 ' + Score.fmtMm(r.p80).padStart(8) + '  ' + f(r.kwhT, 1).padStart(5) + ' kWh/t  rate ' + f(r.R, 1).padStart(5) + '  fee $' + f(r.fee, 0).padStart(5) + '  ship ' + ship + '   ' + r.reason);
    if (idx === 0 && r.stars < 1) { fails++; console.log('  !! intended line fails'); }
    if (/trap/.test(name) && r.stars >= 2) { fails++; console.log('  !! trap scores too well'); }
  });
}
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall intended lines pass, all traps fail');
process.exit(fails ? 1 : 0);
