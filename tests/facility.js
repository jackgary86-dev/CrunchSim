// Facility and office upgrades (ticket #14): the OFFICE_UPGRADES and FACILITY_UPGRADES tables keep the PLANT_UPGRADES shape,
// the effect math on CS.Facility is neutral at level 0 and matches the tables at the top level, the machine-table scaling
// (maintenance bay, substation) is idempotent and reversible and moves Sim.maxRate where power is the limit, the trading
// desk multiplies the product value of real bins, the lab's sieve classes partition a PSD, the site drawing fills in as
// upgrades are bought, and the saved state round-trips with junk rejected.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/facility.js');
const { MACHINES, FEEDS, LINES, PLANT_UPGRADES, OFFICE_UPGRADES, FACILITY_UPGRADES, Sim, Facility: F } = globalThis.CS;
const f = (x, d = 2) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

console.log('=== table shape');
check(OFFICE_UPGRADES && FACILITY_UPGRADES, 'both tables are exported on CS');
const all = Object.assign({}, OFFICE_UPGRADES, FACILITY_UPGRADES);
check(Object.keys(all).length === 8 && F.KEYS.length === 8, 'eight upgrades: ' + F.KEYS.join(', '));
check(Object.keys(OFFICE_UPGRADES).every((k) => !FACILITY_UPGRADES[k]), 'no key is in both tables');
check(Object.keys(all).every((k) => !PLANT_UPGRADES[k]), 'no key collides with PLANT_UPGRADES');
for (const key in all) {
  const U = all[key];
  check(typeof U.name === 'string' && U.name && typeof U.icon === 'string' && U.icon && typeof U.desc === 'string' && U.desc && typeof U.unit === 'string', key + ': name, icon, desc and unit are strings');
  check(Array.isArray(U.levels) && Array.isArray(U.costs) && U.levels.length === U.costs.length + 1 && U.costs.length >= 1, key + ': levels.length is costs.length + 1 (' + U.levels.length + ' / ' + U.costs.length + ')');
  check(U.costs.every((c, i) => c > 0 && (i === 0 || c > U.costs[i - 1])), key + ': costs are positive and rise ' + U.costs.join(' < '));
  check(U.levels.every((v) => typeof v === 'number' && isFinite(v)), key + ': levels are numbers');
  const dir = Math.sign(U.levels[U.levels.length - 1] - U.levels[0]);
  check(dir !== 0 && U.levels.every((v, i) => i === 0 || Math.sign(v - U.levels[i - 1]) === dir), key + ': levels move one way ' + U.levels.join(' -> '));
  console.log('         ' + key.padEnd(12) + F.fmtVal(key, U.levels[0]).padEnd(16) + ' -> ' + F.fmtVal(key, U.levels[U.levels.length - 1]).padEnd(16) + ' for $' + U.costs.reduce((a, b) => a + b, 0).toLocaleString('en-US'));
}
check(all.desk.levels[0] === 1 && all.maint.levels[0] === 1 && all.substation.levels[0] === 1 && all.ln2farm.levels[0] === 1, 'every multiplier starts at 1.0');
check(all.weighbridge.levels[0] === 0 && all.treatment.levels[0] === 0 && all.lab.levels[0] === 0, 'every additive effect starts at 0');
check(all.control.levels[0] === 60 && all.control.levels[1] === 300, 'the control room goes from the stock 60x to 300x');
check(all.desk.levels.every((v) => v >= 1 && v <= 1.1), 'the trading desk stays inside a broker commission (<= 10%)');
check(all.substation.levels[all.substation.levels.length - 1] === 1.15, 'the substation tops out at the NEMA 1.15 service factor');

console.log('\n=== levels and effects');
const s0 = F.newState();
check(F.KEYS.every((k) => F.levelOf(s0, k) === 0), 'a new state is level 0 everywhere');
const e0 = F.effects(s0);
check(e0.market === 1 && e0.ln2 === 1 && e0.serviceMul === 1 && e0.powerMul === 1 && e0.batchExtra === 0 && e0.savePerT === 0 && e0.speedMax === 60 && e0.lab === false, 'level 0 effects are neutral');
check(F.assetValue(s0) === 0 && F.nextCost(s0, 'desk') === all.desk.costs[0], 'nothing owned: asset value 0, next desk costs $' + all.desk.costs[0]);
const sMax = F.newState(); F.KEYS.forEach((k) => { sMax.levels[k] = 99; });
check(F.KEYS.every((k) => F.levelOf(sMax, k) === all[k].costs.length), 'levels clamp to the top of each table');
const eMax = F.effects(sMax);
check(eMax.market === 1.10 && eMax.ln2 === 0.70 && eMax.serviceMul === 0.70 && eMax.powerMul === 1.15 && eMax.batchExtra === 80 && eMax.savePerT === 2 && eMax.speedMax === 300 && eMax.lab === true, 'top-level effects match the tables');
const total = Object.values(all).reduce((a, U) => a + U.costs.reduce((x, y) => x + y, 0), 0);
check(F.assetValue(sMax) === total && F.nextCost(sMax, 'desk') === null, 'everything owned: asset value is the sum of all costs ($' + total.toLocaleString('en-US') + ') and nothing is for sale');
check(F.levelOf({ levels: { desk: -3 } }, 'desk') === 0 && F.levelOf({ levels: { desk: 1.7 } }, 'desk') === 1 && F.levelOf({ levels: { desk: 'x' } }, 'desk') === 0 && F.levelOf(null, 'desk') === 0, 'levels clamp, floor and reject junk');
check(near(F.marketPrice(PLANT_UPGRADES.market.levels[2], sMax), 1.16 * 1.10), 'market price stacks the plant offtake level on the desk: ' + f(F.marketPrice(1.16, sMax), 4));
check(F.fmtVal('desk', 1.03) === '1.03 × price' && F.fmtVal('weighbridge', 20) === '+20 t per batch' && F.fmtVal('lab', 0) === 'none' && F.fmtVal('control', 300) === '300×' && F.fmtVal('treatment', 1) === '$1.00/t saved', 'value formatting');

console.log('\n=== trading desk on real bins');
const comp = FEEDS[LINES.car.feed].comp, line = Sim.buildLine(LINES.car);
function binsValue() { return Sim.evalLine(line, comp).terminals.reduce((v, t) => { const st = Sim.binStats(t.stream.m); return v + (st.total > 0.5 ? st.value : 0); }, 0); }
const base = Sim.prices.market, v0 = binsValue();
Sim.prices.market = F.marketPrice(base, sMax); const v1 = binsValue(); Sim.prices.market = base;
check(near(v1, v0 * eMax.market), 'a level-3 desk lifts the car line\'s product value by 10%: ' + f(v0) + ' -> ' + f(v1) + ' $/t');
check(near(binsValue(), v0), 'and the price is restored for the rest of the tests');

console.log('\n=== machine scaling (maintenance bay, substation)');
const basePrated = {}, baseService = {}; for (const id in MACHINES) { basePrated[id] = MACHINES[id].prated; baseService[id] = MACHINES[id].service; }
// power-limited case: the twin-shaft shear shredder on steel (tests/probe.js lists it as power limited)
function rateOf(m, mat) {
  const node = Sim.makeNode(m, {}, 'feed'), st = Sim.makeFeed({ [mat]: 1 });
  const r = Sim.procNode(node, st); const info = Object.assign(r.info, { uid: node.uid, M: MACHINES[m] });
  return Sim.maxRate([info], [node]);
}
const r0 = rateOf('twin', 'steel');
check(r0.limiter && r0.limiter.why === 'power', 'twin-shaft shredder on steel is power limited at ' + f(r0.R, 1) + ' t/h');
F.scaleMachines(eMax);
check(Object.keys(MACHINES).every((id) => near(MACHINES[id].prated, basePrated[id] * 1.15) && near(MACHINES[id].service, baseService[id] * 0.70)), 'every machine: rated power x1.15, service x0.70');
const r1 = rateOf('twin', 'steel');
check(r1.R > r0.R * 1.10 && r1.R < r0.R * 1.2, 'maxRate follows the service factor: ' + f(r0.R, 1) + ' -> ' + f(r1.R, 1) + ' t/h (pidle is not scaled, so a little under +15%)');
const c0 = rateOf('hammer', 'castiron');
check(c0.limiter && c0.limiter.why === 'capacity', 'a capacity-limited machine is unchanged by the substation (' + f(c0.R, 1) + ' t/h, hammermill on cast iron)');
F.scaleMachines(eMax); F.scaleMachines(eMax);
check(Object.keys(MACHINES).every((id) => near(MACHINES[id].prated, basePrated[id] * 1.15)), 'scaling again is idempotent');
F.scaleMachines(e0);
check(Object.keys(MACHINES).every((id) => MACHINES[id].prated === basePrated[id] && MACHINES[id].service === baseService[id]), 'level 0 restores the data-table values exactly');
check(near(rateOf('twin', 'steel').R, r0.R), 'and the rate is back to ' + f(r0.R, 1) + ' t/h');
check(F.baseOf('hammer').prated === basePrated.hammer && F.baseOf('hammer').service === baseService.hammer, 'baseOf reports the data-table values');
console.log('         hammermill service $' + baseService.hammer + ' -> $' + f(baseService.hammer * 0.85, 0) + ' with a crane bay, $' + f(baseService.hammer * 0.70, 0) + ' with hardfacing');

console.log('\n=== lab sieve classes');
check(F.CUTS.every((c) => Array.from(Sim.EDGE).some((e) => near(e, c, 1e-3))), 'every cut sits on a sim bin edge: ' + F.CUTS.join(', ') + ' mm');
const psd = Sim.makePSD(50, 1.6, 300);
const cls = F.sizeClasses(psd);
check(cls.length === 6 && cls.every((c, k) => c.label === F.CUT_LABELS[k]), 'six labelled classes');
check(near(cls.reduce((a, c) => a + c.frac, 0), 1), 'fractions sum to 1');
const pass56 = Sim.cumCurve(psd)[Array.from(Sim.EDGE).findIndex((e) => near(e, 56.2, 1e-3))];
check(near(cls[0].frac + cls[1].frac + cls[2].frac + cls[3].frac, pass56), 'mass under 56 mm equals the cumulative passing at that edge (' + f(pass56 * 100, 1) + '%)');
check(cls[3].frac + cls[4].frac > 0.7, 'a 50 mm P80 shred sits mostly in the 10-56 and 56-178 mm classes (' + cls.map((c) => Math.round(c.frac * 100) + '%').join(' ') + ')');
check(F.sizeClasses(new Float64Array(Sim.NB)).every((c) => c.frac === 0), 'an empty bin reports zeros');
const ev = Sim.evalLine(line, comp);
ev.terminals.forEach((t) => { const c = F.sizeClasses(Sim.aggregateMap(t.stream.m)); check(near(c.reduce((a, x) => a + x.frac, 0), 1) || Sim.streamMass(t.stream) <= 0, 'car line bin ' + t.key + ': ' + c.map((x) => x.label + ' ' + Math.round(x.frac * 100) + '%').join(', ')); });

console.log('\n=== site drawing');
const svg0 = F.siteSvg(s0), svg1 = F.siteSvg(sMax);
check(/^<svg [^>]*viewBox="0 0 300 126"/.test(svg0) && svg0.endsWith('</svg>'), 'siteSvg is one SVG element');
check(F.KEYS.every((k) => svg0.indexOf('data-key="' + k + '"') >= 0), 'every upgrade has a block');
check(!/class="blk built"/.test(svg0) && (svg0.match(/class="blk"/g) || []).length === 8, 'nothing is built on day one');
check((svg1.match(/class="blk built"/g) || []).length === 8, 'everything is built at the top level');
const pipsOn = (svg1.match(/class="pip on"/g) || []).length, pipsAll = (svg0.match(/class="pip"/g) || []).length;
check(pipsAll === Object.values(all).reduce((a, U) => a + U.costs.length, 0) && pipsOn === pipsAll, 'one pip per purchasable level: ' + pipsAll + ', all lit at the top');
const s1 = F.newState(); s1.levels.weighbridge = 2;
const svgW = F.siteSvg(s1);
check(/data-key="weighbridge" data-level="2"/.test(svgW) && (svgW.match(/class="blk built"/g) || []).length === 1 && (svgW.match(/class="pip on"/g) || []).length === 2, 'a level-2 weighbridge is the only built block, with two pips lit');
check(svg0.indexOf('<script') < 0 && svg0.indexOf('onclick') < 0, 'no script in the drawing');

console.log('\n=== persistence');
const ser = F.serialize(s1);
check(JSON.stringify(ser) === JSON.stringify({ levels: F.KEYS.reduce((o, k) => { o[k] = k === 'weighbridge' ? 2 : 0; return o; }, {}) }), 'serialize writes every key');
const back = F.deserialize(JSON.parse(JSON.stringify(ser)));
check(F.KEYS.every((k) => F.levelOf(back, k) === F.levelOf(s1, k)), 'round trip');
const junk = F.deserialize({ levels: { desk: 99, lab: -1, control: 'two', bogus: 5, maint: 1.9 } });
check(F.levelOf(junk, 'desk') === all.desk.costs.length && F.levelOf(junk, 'lab') === 0 && F.levelOf(junk, 'control') === 0 && F.levelOf(junk, 'maint') === 1 && !('bogus' in junk.levels), 'junk is clamped, floored or dropped');
check(F.KEYS.every((k) => F.levelOf(F.deserialize(null), k) === 0 && F.levelOf(F.deserialize('x'), k) === 0 && F.levelOf(F.deserialize({}), k) === 0), 'missing state is a fresh yard');

console.log('\n=== treatment credit (#217)');
{
  // load a second copy of the module against a stub app so its batchStart / batchComplete handlers can be driven directly
  const handlers = {}, S = { money: 0, lifetime: 0, feedOwner: null, ext: { facility: { levels: { treatment: 1 } } } };
  globalThis.window = globalThis; globalThis.document = { addEventListener() {} }; globalThis.addEventListener = () => {};   // the module needs a document, picks window as its global and binds a keydown listener
  const prevApp = globalThis.CS.app;
  globalThis.CS.app = { S, on(ev, fn) { handlers[ev] = fn; }, log() {}, fmtMoney: (x) => '$' + x, fmtNum: (x) => String(x) };
  delete require.cache[require.resolve('../js/modules/facility.js')];
  require('../js/modules/facility.js');
  globalThis.CS.app = prevApp; delete globalThis.window; delete globalThis.document; delete globalThis.addEventListener;
  const per = F.effects(F.deserialize(S.ext.facility)).savePerT;
  const run = (owner) => { S.feedOwner = owner; const r = { done: 100 }; handlers.batchStart({ run: r }); S.feedOwner = null; const m0 = S.money; handlers.batchComplete({ r }); return S.money - m0; };
  check(per > 0, 'treatment level 1 saves $' + f(per) + ' per tonne');
  check(near(run(null), per * 100) && near(S.lifetime, per * 100), 'a batch of new feed is credited savePerT x tonnes');
  check(run('rerun') === 0 && near(S.lifetime, per * 100), 'a RE-RUN of stock or MISC earns no credit');
  check(near(run('auction'), per * 100), 'an auction lot is new feed and is credited');
}

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nfacility checks pass');
process.exit(fails ? 1 : 0);
