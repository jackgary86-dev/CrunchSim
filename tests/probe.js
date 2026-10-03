require('../js/data.js'); require('../js/sim.js');
const { MATERIALS, MACHINES, FEEDS, LINES, Sim } = globalThis.CS;
const fmt = (x, d = 2) => (x == null || !isFinite(x)) ? '  -  ' : x.toFixed(d);

function single(machine, mat, settings, temp) {
  const st = Sim.makeFeed({ [mat]: 1 }); st.temp = temp || 0;
  const node = { uid: 1, m: machine, settings: Object.assign({}, MACHINES[machine].defaults, settings || {}), wear: 0, src: 'feed' };
  const r = Sim.procNode(node, st);
  const i = r.info, pm = i.perMat[mat] || {};
  const mr = Sim.maxRate([Object.assign(i, { uid: 1, M: MACHINES[machine] })], [node]);
  return { E: pm.E, r: pm.resp, F80: i.F80, P80: i.P80, rej: i.inKg ? i.rejKg / i.inKg : 0, R: mr.R, why: mr.limiter && mr.limiter.why };
}
const cases = [
  ['jaw', 'granite'], ['jaw', 'limestone'], ['jaw', 'castiron'], ['jaw', 'aluminum'], ['jaw', 'water'],
  ['cone', 'granite'], ['hpgr', 'granite'], ['vsi', 'glass'],
  ['hammer', 'steel'], ['hammer', 'castiron'], ['hammer', 'aluminum'], ['hammer', 'wood'],
  ['twin', 'steel'], ['twin', 'rubber'], ['twin', 'wood'], ['single', 'plastic'], ['single', 'wood'],
  ['chipper', 'wood'], ['tub', 'wood'], ['granulator', 'plastic'],
  ['ball', 'granite'], ['ball', 'aluminum'], ['ball', 'glass'],
  ['cryo', 'rubber'], ['cryo', 'aluminum'], ['cryo', 'steel'],
  ['colloid', 'gel'], ['homog', 'gel'], ['atomizer', 'water'],
];
console.log('machine     material    r     E kWh/t   F80mm   P80mm   rej%   maxRate t/h  limiter');
for (const [m, mat] of cases) {
  // pre-reduce feed for fine machines so they accept it
  const x = single(m, mat);
  console.log(m.padEnd(11), mat.padEnd(10), fmt(x.r), fmt(x.E, 2).padStart(9), fmt(x.F80, 2).padStart(9), fmt(x.P80, 3).padStart(8), fmt(x.rej * 100, 0).padStart(5), fmt(x.R, 1).padStart(10), '  ', x.why);
}
