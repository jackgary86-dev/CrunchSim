// Playbooks (tickets #29 and #30): every card's line builds, runs on its demo feed and delivers the purity and size it
// promises; the fit readout, the separator capability table, the mismatch warning and the margin ranking behave on
// known feeds. Run: node tests/playbooks.js
require('../js/data.js'); require('../js/sim.js'); require('../js/score.js'); require('../js/modules/playbooks.js');
const { MATERIALS, MACHINES, FEEDS, Sim, Score, Playbooks: PB } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, what) { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; }
const N = (m, s, src) => ({ m, s, src });

console.log('=== the nine cards');
const BUCKETS = ['ferrous', 'aluminum', 'heavies', 'wood', 'plastic', 'rubber', 'glass', 'aggregate', 'gel'];
check(PB.PLAYBOOKS.length === 9 && BUCKETS.every((id) => PB.byId(id)), 'nine cards, one per bucket type: ' + PB.PLAYBOOKS.map((p) => p.id).join(', '));
PB.PLAYBOOKS.forEach((pb) => {
  check(pb.steps.length >= 2 && pb.settings.length >= 1 && pb.traps.length >= 2 && pb.expect.length >= 1 && pb.blurb, pb.id + ': sequence, settings, traps, expectation and blurb present');
  check(pb.def.nodes.length === pb.steps.length, pb.id + ': one step per machine (' + pb.def.nodes.length + ')');
  check(pb.def.nodes.every((d) => MACHINES[d.m]), pb.id + ': every machine exists');
  check(pb.targets.every((m) => MATERIALS[m]) && pb.expect.every((x) => x.targets.every((m) => MATERIALS[m]) && x.purity > 0 && x.recovery > 0), pb.id + ': targets are materials, purity and recovery promised');
});

console.log('\n=== every card delivers its promise on its demo feed');
PB.PLAYBOOKS.forEach((pb) => {
  const line = PB.buildLine(pb), comp = PB.feedOf(pb);
  const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), kwhT = Score.plantKwhT(ev, mr.R, line);
  console.log('  -- ' + pb.name + ' (' + PB.signature(line) + ') on ' + PB.feedName(pb) + ': ' + f(mr.R) + ' t/h, ' + f(kwhT) + ' kWh/t');
  check(line.length === pb.def.nodes.length && mr.R > 0, pb.id + ': builds and runs (' + f(mr.R) + ' t/h)');
  check(!ev.nodes.some((n) => n.warnings.some((w) => w.level === 'bad' && !/knives/.test(w.text))), pb.id + ': no faults on the line (knife wear on tire wire is the documented trap)');
  pb.expect.forEach((x) => {
    const uid = line[x.node - 1].uid, t = ev.terminals.find((tt) => tt.uid === uid && tt.port === x.port);
    check(!!t, pb.id + ': ' + x.label + ' bin ' + x.node + ':' + x.port + ' is a terminal');
    if (!t) return;
    const NB = Sim.NB, arr = new Float64Array(NB); let tMass = 0, headT = 0;
    x.targets.forEach((m) => { const a = t.stream.m[m]; if (a) { for (let i = 0; i < NB; i++) arr[i] += a[i]; tMass += Sim.sum(a); } headT += ev.head.m[m] ? Sim.sum(ev.head.m[m]) : 0; });
    const tot = Sim.streamMass(t.stream), purity = tot > 0 ? tMass / tot : 0, rec = headT > 0 ? tMass / headT : 0, p80 = tMass > 0 ? Sim.percentile(arr) : 0;
    console.log('     ' + x.label.padEnd(24) + f(tot, 0).padStart(5) + ' kg  purity ' + f(purity * 100, 1).padStart(5) + '% (promised ' + Math.round(x.purity * 100) + '%)  recovery ' + f(rec * 100, 1).padStart(5) + '%  P80 ' + Score.fmtMm(p80));
    check(purity >= x.purity, pb.id + ': ' + x.label + ' purity ' + f(purity * 100, 1) + '% meets the promised ' + Math.round(x.purity * 100) + '%');
    check(rec >= x.recovery, pb.id + ': ' + x.label + ' recovery ' + f(rec * 100, 1) + '% meets the promised ' + Math.round(x.recovery * 100) + '%');
    if (x.p80) check(p80 >= x.p80[0] && p80 <= x.p80[1], pb.id + ': ' + x.label + ' P80 ' + Score.fmtMm(p80) + ' inside ' + x.p80.join('-') + ' mm');
  });
});

console.log('\n=== the valuable materials of a lot');
const vElv = PB.valuable(FEEDS.elv.comp).map((v) => v.m);
check(vElv[0] === 'steel' && vElv.includes('copper') && vElv.includes('aluminum') && !vElv.includes('water') && !vElv.includes('glass'), 'ELV: steel first, copper and aluminum in, water and glass out (' + vElv.join(', ') + ')');
const vQ = PB.valuable(FEEDS.quarry.comp).map((v) => v.m);
check(vQ.length === 2 && vQ.includes('granite') && vQ.includes('limestone'), 'quarry: both rocks count even though they are cheap (relative value share)');
check(PB.valuable({}).length === 0 && PB.valuable({ water: 1 }).length === 0, 'an empty or worthless lot has no valuable material');

console.log('\n=== fit readout');
function fitOf(def, comp) { const line = Sim.buildLine(def); const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line); return { line, fit: PB.fit(ev, line, comp, mr) }; }
const starter = fitOf({ nodes: [N('hammer', { grate: 100, rpm: 100 }, 'feed')] }, FEEDS.elv.comp);
const steelRow = starter.fit.mats.find((r) => r.m === 'steel'), cuRow = starter.fit.mats.find((r) => r.m === 'copper');
check(steelRow && steelRow.fate === 'mixed' && Math.abs(steelRow.purity - 0.65) < 0.02 && steelRow.recovery > 0.99, 'hammermill alone: steel is mixed at ' + f(steelRow.purity * 100, 0) + '% ferrous purity, 100% recovery');
check(cuRow && cuRow.fate === 'mixed' && cuRow.purity < 0.05 && cuRow.contaminant === 'steel', 'copper sits in the same bin, contaminant steel');
check(starter.fit.clean.length === 0 && starter.fit.mixed.length === starter.fit.mats.length, 'every valuable material ends in a mixed bin');
check(isFinite(starter.fit.kwhT) && starter.fit.kwhT > 5 && starter.fit.valuePerT > 100, 'energy ' + f(starter.fit.kwhT) + ' kWh/t and value $' + f(starter.fit.valuePerT, 0) + '/t reported');
const car = fitOf(globalThis.CS.LINES.car, FEEDS.elv.comp);
const carSteel = car.fit.mats.find((r) => r.m === 'steel'), carAl = car.fit.mats.find((r) => r.m === 'aluminum');
check(carSteel.fate === 'clean' && carSteel.bin.short === 'MAG' && carSteel.bin.port === 'extract', 'car line: steel clean in MAG/extract (' + f(carSteel.purity * 100, 0) + '%)');
check(carAl.fate === 'clean' && carAl.bin.short === 'SINK' && carAl.bin.port === 'extract', 'car line: aluminum clean in SINK/extract (' + f(carAl.purity * 100, 0) + '%)');
const scalp = fitOf({ nodes: [N('granulator', { screen: 8 }, 'feed')] }, { plastic: 1 });
check(scalp.fit.mats[0].fate === 'reject' && scalp.fit.reject.length === 1, 'plastic bumpers into a granulator: scalped off, reported as reject');
console.log('  starter: ' + starter.fit.mats.map((r) => r.m + ' ' + Math.round(r.purity * 100) + '% ' + r.fate).join(', '));

console.log('\n=== separator capabilities');
check(PB.canSplit('magnet', null, 'steel', 'plastic') && !PB.canSplit('magnet', null, 'copper', 'aluminum'), 'magnet: steel from plastic yes, copper from aluminum no');
check(!PB.canSplit('eddy', null, 'copper', 'aluminum') && PB.canSplit('eddy', null, 'aluminum', 'brass') && PB.canSplit('eddy', null, 'aluminum', 'plastic') && !PB.canSplit('eddy', null, 'steel', 'aluminum'), 'eddy: not copper from aluminum, yes aluminum from brass or plastic, never with ferrous');
check(PB.canSplit('sinkfloat', null, 'aluminum', 'copper') && PB.canSplit('sinkfloat', null, 'wood', 'plastic') && !PB.canSplit('sinkfloat', null, 'plastic', 'rubber') && !PB.canSplit('sinkfloat', null, 'copper', 'brass'), 'sink-float: aluminum from copper and wood from plastic, not plastic from rubber or copper from brass');
check(PB.canSplit('air', null, 'plastic', 'steel') && PB.canSplit('air', null, 'wood', 'granite') && !PB.canSplit('air', null, 'copper', 'brass'), 'air: light from heavy only');
check(PB.canSplit('sensor', { target: 'copper' }, 'copper', 'brass') && !PB.canSplit('sensor', { target: 'aluminum' }, 'copper', 'brass') && !PB.canSplit('screen', null, 'copper', 'brass'), 'sensor only for its target; a screen is not a material separator');

console.log('\n=== mismatch warning in plain words');
const lot = { copper: 0.4, aluminum: 0.6 };
const ecs = fitOf({ nodes: [N('twin', { width: 40 }, 'feed'), N('eddy', { rpm: 3000 }, '1:product')] }, lot);
const mm = PB.mismatch(ecs.fit, ecs.line);
console.log('  ' + (mm ? mm.text : '(none)'));
check(mm && mm.m === 'copper' && mm.c === 'aluminum', 'twin + eddy on a 40/60 copper-aluminum lot: copper is the mismatch');
check(mm && mm.text.indexOf('This lot is 40 percent copper and your line has no way to separate it from the aluminum.') === 0, 'the warning reads as the ticket asks');
check(mm && mm.sep === 'sinkfloat' && /sink-float tank at 3\.0 g\/cc floats the aluminum off the copper/.test(mm.text), 'and names the fix: a sink-float tank at 3.0 g/cc');
const fixed = fitOf({ nodes: [N('twin', { width: 40 }, 'feed'), N('sinkfloat', { sg: 2.9 }, '1:product')] }, lot);
check(PB.mismatch(fixed.fit, fixed.line) === null, 'with the tank on the line the warning goes away');
const bare = PB.mismatch(starter.fit, starter.line);
console.log('  ' + (bare ? bare.text : '(none)'));
check(bare && bare.m === 'steel' && /no separator at all/.test(bare.text) && /magnetic drum/.test(bare.text), 'hammermill alone on cars: steel, no separator at all, a magnet is the fix');
const pallets = fitOf({ nodes: [N('twin', { width: 60 }, 'feed'), N('magnet', { field: 250 }, '1:product')] }, FEEDS.pallets.comp);
check(PB.mismatch(pallets.fit, pallets.line) === null, 'a magnet that drags wood along is imperfect, not a mismatch (it can split steel from wood)');
check(PB.mismatch(PB.fit(null), []) === null, 'no evaluation, no warning');
const soup = PB.fixFor('copper', 'brass');
check(soup.sep === 'sensor' && /sensor sorter set to copper/.test(soup.text), 'copper from brass: only the sensor sorter (' + soup.text + ')');

console.log('\n=== ranking by projected margin');
const owned = new Set(['hammer']);
[['quarry', 'aggregate'], ['tires', 'rubber'], ['pallets', 'wood'], ['gel', 'gel'], ['zorba', 'heavies']].forEach(([feed, want]) => {
  const rows = PB.rank(FEEDS[feed].comp, owned, {});
  console.log('  ' + feed.padEnd(8) + rows.slice(0, 3).map((r) => r.pb.id + (r.relevant ? '*' : '') + ' $' + f(r.margin, 0) + (r.cost ? ' (buy $' + r.cost + ')' : '')).join(' > ') + ' ... ' + rows.filter((r) => !r.runs).map((r) => r.pb.id + ' x').join(' '));
  check(rows[0].pb.id === want && rows[0].runs && rows[0].relevant, feed + ': the ' + want + ' playbook ranks first');
  check(rows.every((r, i) => i === 0 || !r.runs || !rows[i - 1].runs || r.relevant !== rows[i - 1].relevant || rows[i - 1].margin >= r.margin), feed + ': within a relevance tier the runnable lines are sorted by margin');
  check(rows.every((r, i) => i === 0 || !(r.relevant && !rows[i - 1].relevant && rows[i - 1].runs)), feed + ': cards whose bucket is in the lot come before the rest');
});
const rElv = PB.rank(FEEDS.elv.comp, owned, {});
check(rElv.filter((r) => r.relevant).map((r) => r.pb.id).sort().join() === 'aluminum,ferrous,heavies,plastic,rubber' && !rElv.find((r) => r.pb.id === 'wood').relevant, 'ELV: the metal, plastic and rubber cards are relevant, wood (1%) and glass are not');
const rz = PB.rank(FEEDS.zorba.comp, new Set(['twin', 'sinkfloat']), {});
const alRow = rz.find((r) => r.pb.id === 'aluminum'), hvRow = rz.find((r) => r.pb.id === 'heavies');
check(alRow.cost === 0 && alRow.missing.length === 0 && hvRow.cost === MACHINES.sensor.price && hvRow.missing.join() === 'sensor', 'unowned machine cost: aluminum card is owned, heavies card needs the $' + MACHINES.sensor.price + ' sensor');
const lm = PB.lineMargin(Sim.buildLine(globalThis.CS.LINES.car), FEEDS.elv.comp);
check(isFinite(lm.margin) && lm.R > 0 && lm.kwhT > 0, 'lineMargin on the car line: $' + f(lm.margin, 0) + '/t at ' + f(lm.R) + ' t/h');
check(PB.lineMargin(Sim.buildLine({ nodes: [N('atomizer', { bar: 300 }, 'feed')] }), FEEDS.quarry.comp).margin === -Infinity, 'a line that cannot run has -Infinity margin');

console.log('\n=== module stays DOM-free in Node');
check(typeof globalThis.document === 'undefined' && typeof globalThis.CS.app === 'undefined', 'no document, no fake CS.app');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nplaybooks: every card keeps its promise');
process.exit(fails ? 1 : 0);
