// Smelting: furnaces turn sorted metal into ingots. Exercises procFurnace, ingot and dross pricing in binStats,
// the tap-temperature trade-off and the rejection of metals a furnace cannot melt. Exits non-zero on any failure.
require('../js/data.js'); require('../js/sim.js');
const { FEEDS, LINES, Sim } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
function run(def, comp) { const line = Sim.buildLine(def); const ev = Sim.evalLine(line, comp); return { line, ev, last: ev.nodes[ev.nodes.length - 1], ports: ev.ports }; }
function port(r, k, p) { return r.ports[r.line[k].uid + ':' + p]; }
function perT(st) { return st.total > 0 ? st.value / (st.total / 1000) : 0; }
function warnings(n) { n.warnings.forEach((w) => console.log('      [' + w.level + '] ' + w.text)); }

// 1. aluminum floats from the zorba line into an induction furnace
console.log('\n=== Zorba: twin -> sink-float 3.2 -> induction furnace on the floats  (per tonne of head feed)');
const z = run(LINES.ingot, FEEDS.zorba.comp);
const floats = port(z, 1, 'extract'), ingots = port(z, 2, 'product'), dross = port(z, 2, 'dross');
const loose = Sim.binStats(floats.m), cast = Sim.binStats(ingots.m, ingots.form), dr = Sim.binStats(dross.m, dross.form);
console.log('  floats  ' + f(loose.total, 0) + ' kg, purity ' + f(loose.share * 100, 1) + '%, P80 ' + f(loose.p80, 0) + ' mm, $' + f(loose.value, 0) + ' = $' + f(perT(loose), 0) + '/t as loose scrap');
console.log('  ingots  ' + f(cast.total, 0) + ' kg, form ' + ingots.form + ', purity ' + f(cast.share * 100, 1) + '%, grade ' + f(cast.grade, 2) + ', $' + f(cast.value, 0) + ' = $' + f(perT(cast), 0) + '/t');
console.log('  dross   ' + f(dr.total, 1) + ' kg, form ' + dross.form + ', $' + f(dr.value, 0) + ' · melt energy ' + f(z.last.eT, 0) + ' kWh/t charged, melt loss ' + f(z.last.meltLoss * 100, 1) + '%, tap ' + z.last.tap + ' C');
warnings(z.last);
check(ingots.form === 'ingot' && cast.form === 'ingot', 'the product port carries form = ingot');
check(cast.total > 0.9 * loose.total, 'most of the charge is cast (' + f(100 * cast.total / loose.total, 1) + '%)');
check(perT(cast) > perT(loose), 'ingot $' + f(perT(cast), 0) + '/t > loose aluminum $' + f(perT(loose), 0) + '/t');
check(cast.value > loose.value, 'ingot bin $' + f(cast.value, 0) + ' per head tonne > loose bin $' + f(loose.value, 0) + ' even after the dross loss');
check(z.last.eT > 500 && z.last.eT < 750, 'induction energy for aluminum ' + f(z.last.eT, 0) + ' kWh/t lies in 500-750');
check(Math.abs(cast.total + dr.total - loose.total) < 1e-6, 'mass balance: ingots + dross = charge');
check(z.last.purity > 0.95, 'melt purity ' + f(z.last.purity * 100, 1) + '% > 95%');
check(z.ev.terminals.some((t) => t.form === 'ingot') && z.ev.terminals.some((t) => t.form === 'dross'), 'terminals expose form ingot and dross');
const mr = Sim.maxRate(z.ev.nodes, z.line);
console.log('  head rate ' + f(mr.R, 1) + ' t/h, limited by node ' + (z.line.findIndex((n) => n.uid === mr.limiter.uid) + 1) + ' (' + mr.limiter.why + ')');
check(mr.R > 0, 'the line can run');

// 2. steel into an induction furnace is rejected to dross
console.log('\n=== Steel: twin -> induction furnace at 1250 C');
const s = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'induction', s: { tap: 1250 }, src: '1:product' }] }, { steel: 1 });
const sIng = Sim.binStats(port(s, 1, 'product').m, 'ingot'), sDr = Sim.binStats(port(s, 1, 'dross').m, 'dross');
console.log('  ingots ' + f(sIng.total, 1) + ' kg, dross ' + f(sDr.total, 0) + ' kg worth $' + f(sDr.value, 0) + ' (the loose shred would have sold for $' + f(Sim.binStats(port(s, 0, 'product').m).value, 0) + ')');
warnings(s.last);
check(sIng.total < 1e-6, 'no steel ingots from an induction furnace');
check(sDr.total > 999, 'all the steel leaves through the dross port (' + f(sDr.total, 0) + ' kg)');
check(s.last.perMat.steel.fate === 'wrong' && s.last.warnings.some((w) => w.level === 'bad'), 'fate = wrong and a fault warning explains it');
check(sDr.value < Sim.binStats(port(s, 0, 'product').m).value, 'dross is worth less than the loose steel it came from');

// 3. steel into an arc furnace: billets worth more than loose shred at about 450 kWh/t
console.log('\n=== Steel and cast iron: twin -> electric arc furnace at 1600 C');
const a = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'arc', s: { tap: 1600 }, src: '1:product' }] }, { steel: 0.9, castiron: 0.1 });
const aLoose = Sim.binStats(port(a, 0, 'product').m), aIng = Sim.binStats(port(a, 1, 'product').m, 'ingot');
console.log('  loose $' + f(perT(aLoose), 0) + '/t -> billet $' + f(perT(aIng), 0) + '/t, ferrous purity ' + f(aIng.share * 100, 0) + '%, grade ' + f(aIng.grade, 2) + ', energy ' + f(a.last.eT, 0) + ' kWh/t, melt loss ' + f(a.last.meltLoss * 100, 1) + '%');
warnings(a.last);
check(perT(aIng) > perT(aLoose), 'steel billet worth more per tonne than loose shred');
check(a.last.eT > 380 && a.last.eT < 520, 'EAF energy ' + f(a.last.eT, 0) + ' kWh/t near 450');
check(aIng.share > 0.99, 'steel and cast iron count as one ferrous melt');

// 4. the tap slider trades energy against dross, and a cold tap leaves copper unmelted
console.log('\n=== Tap temperature trade-off (zorba floats in the induction furnace)');
function atTap(tap) { const L = { nodes: LINES.ingot.nodes.map((n) => Object.assign({}, n, { s: Object.assign({}, n.s) })) }; L.nodes[2].s.tap = tap; return run(L, FEEDS.zorba.comp).last; }
const lo = atTap(700), hi = atTap(1100);
console.log('  tap  700 C: ' + f(lo.eT, 0) + ' kWh/t, melt loss ' + f(lo.meltLoss * 100, 2) + '%   tap 1100 C: ' + f(hi.eT, 0) + ' kWh/t, melt loss ' + f(hi.meltLoss * 100, 2) + '%');
check(hi.eT > lo.eT && hi.meltLoss > lo.meltLoss, 'a hotter tap costs more energy and more dross');
const cu = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'induction', s: { tap: 740 }, src: '1:product' }] }, { copper: 1 });
const cuHot = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'induction', s: { tap: 1150 }, src: '1:product' }] }, { copper: 1 });
console.log('  copper at 740 C: fate ' + cu.last.perMat.copper.fate + ', ' + f(Sim.streamMass(port(cu, 1, 'product')), 0) + ' kg of ingots;  at 1150 C: ' + f(Sim.streamMass(port(cuHot, 1, 'product')), 0) + ' kg of ingots at ' + f(cuHot.last.eT, 0) + ' kWh/t');
check(cu.last.perMat.copper.fate === 'cold' && Sim.streamMass(port(cu, 1, 'product')) < 1e-6, 'copper does not melt below its 1085 C melting point');
check(Sim.streamMass(port(cuHot, 1, 'product')) > 950 && cuHot.last.eT > 300 && cuHot.last.eT < 450, 'copper melts at 1150 C for roughly 350-400 kWh/t');

// 5. a mixed melt is penalised: unsorted zorba straight into the kiln
console.log('\n=== Unsorted zorba: twin -> reverberatory kiln at 1150 C');
const k = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'kiln', s: { tap: 1150 }, src: '1:product' }] }, FEEDS.zorba.comp);
const kIng = Sim.binStats(port(k, 1, 'product').m, 'ingot');
console.log('  melt purity ' + f(k.last.purity * 100, 0) + '% aluminum, ingot grade ' + f(kIng.grade, 2) + ', $' + f(perT(kIng), 0) + '/t vs sorted ingot $' + f(perT(cast), 0) + '/t · kiln energy ' + f(k.last.eT, 0) + ' kWh/t, melt loss ' + f(k.last.meltLoss * 100, 1) + '%');
warnings(k.last);
check(kIng.grade < 0.5 && perT(kIng) < perT(cast), 'alloy soup sells for far less than a sorted ingot');
check(k.last.eT > z.last.eT && k.last.meltLoss > z.last.meltLoss, 'the kiln burns more energy and more metal per tonne than the induction furnace');

// 6. binStats stays compatible for callers that pass only the material map
const plain = Sim.binStats(ingots.m);
check(plain.form === null && Math.abs(plain.value - Sim.binStats(ingots.m, undefined).value) < 1e-9, 'binStats(mats) without a form still prices as loose scrap');

// #291: an off-spec melt is an alloy ingot: it sells at the ingot grade, it is never MISC
console.log('\n=== #291: Al 85 / Cu 15 into an induction furnace at 1200 C');
{ const L = [Sim.makeNode('induction', { tap: 1200 })], ev = Sim.evalLine(L, { aluminum: 0.85, copper: 0.15 }, { sizes: { aluminum: 30, copper: 30 } });
  const t = ev.terminals.find((x) => x.port === 'product'), st = Sim.binStats(t.stream.m, t.form);
  console.log('  ingot purity ' + f(st.share * 100, 1) + '%, grade ' + f(st.grade, 3) + ', $' + f(st.value, 0));
  check(st.share < Sim.PURE_MIN && st.sellable && Math.abs(st.grade - Sim.ingotGrade(st.share)) < 1e-12 && st.value > 0, 'an ' + f(st.share * 100, 0) + '% ingot sells at the ingot grade ' + f(st.grade, 2));
  check(!Sim.binStats(t.stream.m).sellable, 'the same mix as loose scrap is still MISC'); }
// #292: dross pays only for the metal in it
console.log('\n=== #292: non-metals in dross');
for (const fu of ['induction', 'arc']) {
  const ev = Sim.evalLine([Sim.makeNode(fu)], { plastic: 1 }, { sizes: { plastic: 20 } }), d = ev.terminals.find((t) => t.port === 'dross'), st = Sim.binStats(d.stream.m, d.form);
  check(st.total > 900 && st.value === 0, fu + ': pure plastic in dross is worth nothing ($' + f(st.value, 2) + ' for ' + f(st.total, 0) + ' kg)');
}
{ const st = Sim.binStats(Sim.makeFeed({ aluminum: 0.5, plastic: 0.5 }, 1000).m, 'dross');
  check(st.perMat.plastic.value === 0 && st.perMat.aluminum.value > 0, 'in mixed dross the aluminum is paid and the plastic is not'); }

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall furnace checks pass');
process.exit(fails ? 1 : 0);
