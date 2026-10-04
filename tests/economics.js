// Run economics (tickets #18 to #22): the pure helpers on CS.Economics, exercised on real lines from the physics core.
// Projection and its reasons, bucket pricing, wear forecasts and servicing, the per-machine power table, and the
// loss diagnosis with a cause per material and a cost per node. Exits non-zero on any failure.
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js'); require('../js/modules/economics.js');
const { MATERIALS, MACHINES, FEEDS, LINES, Sim, Economics: E } = globalThis.CS;
const f = (x, d = 2) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
Sim.prices.power = 0.12; Sim.prices.ln2 = 0.12; Sim.prices.market = 1;

/* the arithmetic of marginPerT in app.js, per head tonne */
function run(def, comp, feedC) {
  const line = Sim.buildLine(def), ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
  let P = 0, extra = 0, rev = 0;
  ev.nodes.forEach((x) => { P += Math.min(x.M.prated, x.M.pidle + R * x.ePerHead); extra += x.extraCostPerHeadT; });
  ev.terminals.forEach((t) => { const st = Sim.binStats(t.stream.m, t.form); if (st.total > 0.5) rev += st.value; });
  const wearC = E.wearCost(ev.nodes), powerC = R > 0 ? P / R * Sim.prices.power : 0;
  const m = { R, P, rev, feedC: feedC || 0, powerC, extra, wearC, margin: rev - (feedC || 0) - powerC - extra - wearC };
  return { line, ev, mr, R, m };
}

console.log('=== exports');
check(E && ['projectBatch', 'binPricing', 'serviceCost', 'wearForecast', 'shouldAutoService', 'wearCost', 'accrue', 'projectAccounts', 'powerTable', 'lossReport', 'betterLine'].every((k) => typeof E[k] === 'function'), 'CS.Economics exports the helpers');
check(E.AUTO_SERVICE_AT === 0.8 && E.RESIST === 0.3, 'auto-service at 80% wear, resistance threshold 30%');

/* ---- #18 projection ---- */
console.log('=== #18 pre-run projection');
const starter = run(LINES.starter, FEEDS.elv.comp, FEEDS.elv.cost);
let pr = E.projectBatch(starter.m, 15, starter.ev.nodes);
check(near(pr.net, starter.m.margin * 15) && pr.perT === starter.m.margin, 'projected net is margin x tonnes (' + f(pr.net, 0) + ' on 15 t of cars)');
check(!pr.negative && pr.reason === '' && pr.cause === '', 'the starter yard projects positive: no reason');
// cryogenic mill on zorba: aluminum does not embrittle, a fault-level warning, and the nitrogen bill sinks the batch
// cut to under 40 mm first so all of it enters the cryo mill (scalped zorba would sell as tradeable zorba since #35)
const cryo = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'single', s: { screen: 30 }, src: '1:product' }, { m: 'cryo', s: { target: 1.5 }, src: '2:product' }] }, FEEDS.zorba.comp, FEEDS.zorba.cost);
pr = E.projectBatch(cryo.m, 10, cryo.ev.nodes);
console.log('  cryo on zorba: margin ' + f(cryo.m.margin, 0) + ' $/t -> ' + pr.reason);
check(pr.negative && pr.cause === 'machine' && /^Wrong machine: node 3 CRYO/.test(pr.reason) && /embrittle/.test(pr.reason), 'a wrong machine is named first, with the node and the warning');
// a feed that costs more than its products: the hammermill on zorba (loose shred of non-ferrous) still pays, so build the case by hand
pr = E.projectBatch({ rev: 95, feedC: 110, powerC: 8, extra: 0, wearC: 1, margin: -24 }, 15, starter.ev.nodes);
check(pr.cause === 'feed' && /Feed costs \$110\/t but the products sell for \$95\/t/.test(pr.reason), 'feed dearer than products: ' + pr.reason);
pr = E.projectBatch({ rev: 95, feedC: 40, powerC: 60, extra: 0, wearC: 1, margin: -6 }, 15, starter.ev.nodes);
check(pr.cause === 'energy' && /^Energy: \$60\/t of power/.test(pr.reason), 'energy eats the margin: ' + pr.reason);
pr = E.projectBatch({ rev: 95, feedC: 40, powerC: 30, extra: 20, wearC: 10, margin: -5 }, 15, starter.ev.nodes);
check(pr.cause === 'consumables' && /Consumables and wear \(\$30\/t\)/.test(pr.reason), 'consumables and wear: ' + pr.reason);
const bad = { rev: 95, feedC: 110, powerC: 8, extra: 0, wearC: 1, margin: -24 };
check(E.projectBatch(bad, 15, cryo.ev.nodes).cause === 'machine', 'a wrong machine outranks the feed price');
check(E.wrongMachine(starter.ev.nodes) === null && E.resisting(starter.ev.nodes) && /Rubber resists/.test(E.resisting(starter.ev.nodes).text), 'the 7% of rubber the hammermill bounces is a resisting material, not a wrong machine');
pr = E.projectBatch({ rev: 95, feedC: 40, powerC: 60, extra: 0, wearC: 1, margin: -6 }, 15, starter.ev.nodes);
check(pr.cause === 'energy' && /\(1 HAMM: Rubber resists this mechanism/.test(pr.reason), 'the energy reason names the resisting material: ' + pr.reason);

/* ---- #19 bucket pricing ---- */
console.log('=== #19 bucket pricing');
const car = run(LINES.car, FEEDS.elv.comp, FEEDS.elv.cost);
let binsChecked = 0;
car.ev.terminals.forEach((t) => {
  const st = Sim.binStats(t.stream.m, t.form); if (st.total < 0.5) return;
  const p = E.binPricing(st, Sim.prices.market); binsChecked++;
  const pm = st.perMat[p.dom];
  check(near(p.perT * st.total / 1000, st.value, 1e-9), 'bin ' + t.key + ': $/t x mass = bin value (' + f(p.perT, 0) + ' $/t)');
  check(near(p.domPerT * pm.mass / 1000, pm.value, 1e-9), '  ' + p.name + ' list x purity x size reproduces its value: ' + p.text);
  check(/^\$[\d,]+ × \d\.\d\d purity × \d\.\d\d size$/.test(p.text), '  text has the two discounts');
  check(p.grade === st.grade && near(p.sf, pm.sizeFactor), '  grade is the bin grade, size factor is the dominant material\'s');
});
check(binsChecked >= 4, binsChecked + ' bins priced on the car line');
// the hammermill alone: mixed shred, steel dominant, both discounts bite
const mixed = Sim.binStats(starter.ev.terminals.find((t) => t.port === 'product').stream.m);
const mp = E.binPricing(mixed, 1);
console.log('  hammermill shred: ' + f(mp.perT, 0) + ' $/t = ' + mp.name + ' ' + mp.text);
check(mp.dom === 'steel' && mp.grade < 0.4 && mp.list === MATERIALS.steel.sell, 'unsorted shred is steel at a low purity grade (65% ferrous, grade ' + f(mp.grade) + ')');
// market multiplier scales the list price; ingot and dross forms are labelled
const ingotLine = run(LINES.ingot, FEEDS.zorba.comp, FEEDS.zorba.cost);
const ing = ingotLine.ev.terminals.find((t) => t.form === 'ingot'), dro = ingotLine.ev.terminals.find((t) => t.form === 'dross');
Sim.prices.market = 1.16;   // offtake deals level 2: binStats and binPricing must see the same multiplier
const ip = E.binPricing(Sim.binStats(ing.stream.m, 'ingot'), Sim.prices.market);
Sim.prices.market = 1;
const dp = E.binPricing(Sim.binStats(dro.stream.m, 'dross'), 1);
check(near(ip.list, MATERIALS.aluminum.ingot * 1.16) && Math.abs(ip.form - 1) < 1e-9 && !/dross/.test(ip.text), 'an ingot bin prices at the ingot list price x offtake deals: ' + ip.text);
check(dp.form > 0.14 && dp.form < 0.16 && /× 0\.15 dross$/.test(dp.text), 'a dross bin shows the dross factor: ' + dp.text);
check(E.binPricing({ total: 0, value: 0, grade: 1, perMat: {} }, 1) === null, 'an empty bin has no price line');

/* ---- #20 wear and servicing ---- */
console.log('=== #20 wear and servicing');
const H = MACHINES.hammer;
check(E.serviceCost(H, 0.5) === Math.round(H.service * 0.5) && E.serviceCost(H, 0.01) === Math.round(H.service * 0.15) && E.serviceCost(H, 1) === H.service, 'service bill is wear x service price, floored at 15% of a full set');
const hn = starter.line[0], hi = starter.ev.nodes[0];
let fc = E.wearForecast(hn, hi);
console.log('  hammermill on cars: ' + f(hi.wearPerHeadT * 1e6, 2) + ' ppm wear per head tonne -> about ' + f(fc.toWorn, 0) + ' t until worn out, ' + f(fc.toService, 0) + ' t to the service point');
check(fc && fc.toWorn > 100 && fc.toWorn < 1e6 && near(fc.toWorn, 1 / hi.wearPerHeadT), 'tonnes until worn out = remaining wear / wear per tonne');
check(near(fc.toService, 0.8 / hi.wearPerHeadT), 'tonnes to the 80% service point');
hn.wear = 0.5; fc = E.wearForecast(hn, hi);
check(near(fc.toWorn, 0.5 / hi.wearPerHeadT) && near(fc.toService, 0.3 / hi.wearPerHeadT), 'at 50% wear both forecasts shrink accordingly');
hn.wear = 0.9; check(E.wearForecast(hn, hi).toService === 0, 'past the service point the service forecast is zero');
hn.wear = 0;
check(E.wearForecast(car.line[2], car.ev.nodes[2]) === null, 'a magnetic drum does not wear out');
check(E.wearForecast(hn, { wearPerHeadT: 0 }) === null, 'no flow, no forecast');
check(!E.shouldAutoService({ wear: 0.9 }) && !E.shouldAutoService({ wear: 0.5, autoService: true }) && E.shouldAutoService({ wear: 0.8, autoService: true }) && E.shouldAutoService({ wear: 0.95, autoService: true }, 0.9), 'auto-service only when switched on and at or past the threshold');
const wc = E.wearCost(starter.ev.nodes);
check(wc > 0 && near(wc, hi.wearPerHeadT * H.service), 'wear cost per tonne = wear per tonne x service bill (' + f(wc, 2) + ' $/t)');
check(near(E.wearCost(car.ev.nodes), car.ev.nodes.reduce((c, x) => c + x.wearPerHeadT * x.M.service, 0)) && E.wearCost([]) === 0, 'wear cost sums over the line');

/* ---- #21 power and consumables ---- */
console.log('=== #21 power and consumables by machine');
// walk a 15 t batch of the car line in 20 steps the way stepRun does, then compare the table with the metered totals
{
  const acc = {}; let kwh = 0, extra = 0; const R = car.R, tons = 15, dh = tons / R / 20;
  for (let s = 0; s < 20; s++) car.ev.nodes.forEach((x) => { E.accrue(acc, x, tons / 20, dh); kwh += x.ePerHead * tons / 20 + x.M.pidle * dh; extra += x.extraCostPerHeadT * tons / 20; });
  const pt = E.powerTable(acc, car.ev.nodes, Sim.prices);
  pt.rows.forEach((r) => console.log('  ' + (r.idx + 1) + ' ' + r.short.padEnd(5) + ' idle ' + f(r.idle, 1).padStart(7) + '  process ' + f(r.proc, 1).padStart(8) + ' kWh  $' + f(r.cost, 2)));
  pt.extras.forEach((x) => console.log('  ' + (x.idx + 1) + ' ' + x.short.padEnd(5) + ' ' + x.what + (x.qty ? ' ' + f(x.qty, 1) + ' ' + x.unit : '') + '  $' + f(x.cost, 2)));
  check(pt.rows.length === car.line.length && pt.rows.every((r, i) => r.idx === i && r.short === MACHINES[car.line[i].m].short), 'one row per machine, in flowsheet order');
  check(near(pt.totals.kwh, kwh, 1e-9) && near(pt.totals.cost, kwh * Sim.prices.power, 1e-9), 'idle + process kWh sum to the metered kWh (' + f(kwh, 1) + ')');
  check(pt.rows.every((r) => r.idle > 0) && pt.rows[0].proc > pt.rows[1].proc, 'every machine idles; the hammermill does most of the work');
  const media = pt.extras.find((x) => x.what === 'heavy medium');
  check(media && media.short === 'SINK' && near(media.cost + pt.totals.ln2C, extra, 1e-9) && pt.totals.ln2Kg === 0, 'the sink-float tank bills heavy medium and nothing bills nitrogen');
  check(near(pt.totals.wear, E.wearCost(car.ev.nodes) * tons, 1e-9), 'wear accrues at the service price');
  const proj = E.powerTable(E.projectAccounts(car.ev.nodes, tons, R), car.ev.nodes, Sim.prices);
  check(near(proj.totals.kwh, pt.totals.kwh, 1e-9), 'a projection of the same batch gives the same table');
}
// the cryogenic tire line bills liquid nitrogen
{
  const tire = run(LINES.tire, FEEDS.tires.comp, FEEDS.tires.cost);
  const pt = E.powerTable(E.projectAccounts(tire.ev.nodes, 8, tire.R), tire.ev.nodes, Sim.prices);
  const ln2 = pt.extras.find((x) => x.what === 'liquid nitrogen');
  console.log('  tire line, 8 t: ' + (ln2 ? f(ln2.qty, 0) + ' kg of liquid nitrogen at ' + ln2.short + ', $' + f(ln2.cost, 0) : 'no nitrogen?'));
  check(ln2 && ln2.short === 'CRYO' && ln2.qty > 1000 && near(ln2.cost, ln2.qty * Sim.prices.ln2), 'the cryogenic mill lists nitrogen in kg and dollars');
  const proj = E.powerTable(E.projectAccounts(tire.ev.nodes, 8, tire.R), tire.ev.nodes, Sim.prices);
  check(near(proj.totals.ln2C, ln2.cost), 'nitrogen is the whole consumables bill on that line');
}
check(E.powerTable({ 999: { idle: 1, proc: 2, ln2: 0, extra: 0, wear: 0 } }, car.ev.nodes, Sim.prices).rows[0].short === 'gone', 'a node removed mid-run is still listed');

/* ---- #22 loss diagnosis ---- */
console.log('=== #22 loss diagnosis');
const CAUSES = ['scalp', 'reject', 'size', 'energy'];
function report(r, name) {
  const rep = E.lossReport(r.ev, r.line, r.R, Sim.prices);
  console.log('  ' + name + ':');
  rep.losses.forEach((l, i) => console.log('    ' + (i + 1) + '. ' + l.name.padEnd(10) + ' $' + f(l.loss, 1).padStart(7) + '/t  [' + l.cause + '] ' + l.text));
  console.log('    by node: ' + rep.perNode.map((x) => (x.idx + 1) + ' ' + x.short + ' $' + f(x.total, 1) + ' (power ' + f(x.power, 1) + ', wear ' + f(x.wear, 1) + ', extra ' + f(x.extra, 1) + ', scalp ' + f(x.scalp, 1) + ')').join(' · '));
  return rep;
}
const rs = report(starter, 'hammermill only on cars');
check(rs.losses.length === 3 && rs.losses.every((l) => CAUSES.includes(l.cause) && l.text.length > 10 && l.loss >= E.MIN_LOSS), 'three losses, each with a cause and a sentence');
check(rs.losses[0].loss >= rs.losses[1].loss && rs.losses[1].loss >= rs.losses[2].loss, 'sorted by loss');
check(rs.losses[0].cause === 'reject' && /sits in 1 HAMM\/product at \d+% purity/.test(rs.losses[0].text), 'unsorted shred: the top loss is dilution in the mixed bin');
check(rs.all.every((l) => near(l.parts.scalp + l.parts.reject + l.parts.size + l.parts.energy, l.loss)), 'the parts add up to the loss');
check(rs.perNode.length === 1 && rs.perNode[0].short === 'HAMM' && rs.perNode[0].power > 0 && rs.perNode[0].wear > 0 && near(rs.perNode[0].total, rs.perNode[0].power + rs.perNode[0].wear + rs.perNode[0].extra + rs.perNode[0].scalp), 'one node carries power and wear');
const rc = report(car, 'car line');
const sumLoss = (rep) => rep.all.reduce((s, l) => s + l.loss, 0);
check(sumLoss(rc) < sumLoss(rs), 'the sorted car line loses less than unsorted shred ($' + f(sumLoss(rc), 0) + ' vs $' + f(sumLoss(rs), 0) + '/t)');
check(rc.perNode.length === 5 && rc.perNode.every((x) => x.total >= 0), 'five nodes attributed');
// scalped at a feed opening: a drum chipper fed whole pallets (1.2 m) takes nothing over 400 mm
const chip = run({ nodes: [{ m: 'chipper', s: { len: 20 }, src: 'feed' }] }, FEEDS.pallets.comp, FEEDS.pallets.cost);
const rch = report(chip, 'chipper on pallets');
const wood = rch.losses.find((l) => l.m === 'wood');
check(wood && wood.cause === 'scalp' && /scalped at 1 CHIP: too big for the 400 mm feed opening/.test(wood.text), 'wood is scalped at the chipper feed opening');
check(rch.perNode[0].scalp > 0, 'the scalped value is charged to the chipper');
// energy on a resistant material: a jaw crusher squeezing aluminum (response 17%)
const jawAl = run({ nodes: [{ m: 'jaw', s: { css: 30 }, src: 'feed' }] }, { aluminum: 1 }, MATERIALS.aluminum.buy);
const rj = report(jawAl, 'jaw on aluminum');
const al = rj.losses.find((l) => l.m === 'aluminum');
check(al && al.cause === 'energy' && /power breaking it in 1 JAW, where it resists the mechanism \(response 1\d%\)/.test(al.text), 'aluminum in a jaw: energy on a resistant material');
check(near(al.parts.energy, jawAl.ev.nodes[0].perMat.aluminum.E * Sim.prices.power, 1e-6), 'the energy loss is that material\'s kWh/t at the power price');
// below or above the size spec: a twin-shaft shredder leaves tires at 120 mm, crumb sells at 0.2 to 6 mm
const twinR = run({ nodes: [{ m: 'twin', s: { width: 50 }, src: 'feed' }] }, { rubber: 1 }, MATERIALS.rubber.buy);
const rt = report(twinR, 'twin shredder on rubber');
const rub = rt.losses.find((l) => l.m === 'rubber');
check(rub && rub.cause === 'size' && /sold above its 200 µm to 6\.0 mm size spec \(P80 \d+ mm in 1 TWIN\/product\)/.test(rub.text), 'coarse rubber: sold above its size spec');
// dross: steel into an induction furnace
const steelInd = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'induction', s: { tap: 1250 }, src: '1:product' }] }, { steel: 1 }, MATERIALS.steel.buy);
const rd = report(steelInd, 'steel into an induction furnace');
const st = rd.losses.find((l) => l.m === 'steel');
check(st && st.cause === 'reject' && /goes to dross in 2 INDC/.test(st.text) && rd.perNode[1].scalp > 0, 'steel in the wrong furnace goes to dross, charged to the furnace');
// nothing to say about a clean line
const clean = run({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 2.9 }, src: '1:product' }] }, { aluminum: 1 }, MATERIALS.aluminum.buy);
const rcl = E.lossReport(clean.ev, clean.line, clean.R, Sim.prices);
check(rcl.losses.length === 0, 'pure aluminum torn and floated: no loss worth reporting');

/* ---- what would have earned ---- */
console.log('=== what would have earned');
const b = E.betterLine({ m: 'sinkfloat', port: 'product', gain: 40 }, 25, 15);
check(b && b.perT === 65 && b.net === 975 && b.base === 375 && b.m === 'sinkfloat', 'a $40/t gain on a $25/t margin: $975 on 15 t instead of $375');
check(E.betterLine(null, 25, 15) === null && E.betterLine({ gain: 0.2 }, 25, 15) === null, 'no pick, or a gain under fifty cents, gives no hint');

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' economics checks pass'));
process.exit(fails ? 1 : 0);
