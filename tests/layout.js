// Exercises the DOM-free parts of js/modules/layout.js (ticket #38): the split of held stock into sorted end buckets
// and MISC, the RE-RUN plan, and each station's bins and leftovers on real preset lines.
// Run: node tests/layout.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/layout.js');
const { FEEDS, LINES, MAT_ORDER, Sim, Layout: L } = globalThis.CS;
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6) * Math.max(1, Math.abs(a), Math.abs(b));

/* ---- end buckets ---- */
const stock = {
  steel: { t: 8.7, purity: 0.87, grade: 0.9, sf: 1 },
  aluminum: { t: 1.1, purity: 0.64 },
  plastic: { t: 1.2, purity: 0.6 },
  rubber: { t: 1.1, purity: 0.27 },
  castiron: { t: 1.0, purity: 0.11 },
  glass: { t: 0.02, purity: 0.9 },   // dust: below the 0.05 t floor, shown nowhere
  copper: { t: 0, purity: 1 }
};
const b = L.splitBuckets(stock, MAT_ORDER);
check(b.clean.map((x) => x.m).join(',') === 'steel,aluminum,plastic', 'materials at 60% purity or better get their own bucket, in material order (60% exactly counts)');
check(near(b.misc.t, 2.1) && Object.keys(b.misc.comp).sort().join(',') === 'castiron,rubber', 'everything below 60% pools into MISC with its tonnes');
check(!b.clean.some((x) => x.m === 'glass' || x.m === 'copper') && !b.misc.comp.glass, 'empty and dust-sized stock shows in no bucket');
check(b.clean[0].grade === 0.9 && b.clean[0].sf === 1, 'a bucket carries its grade and size factor for pricing');
check(L.splitBuckets(stock, MAT_ORDER, 0.9).clean.length === 0, 'the purity cut can be raised');
check(L.splitBuckets({}, MAT_ORDER).clean.length === 0 && L.splitBuckets(null, MAT_ORDER).misc.t === 0, 'no stock, no buckets');

/* ---- RE-RUN plan ---- */
let p = L.rerunPlan(stock, ['rubber', 'castiron'], 30);
check(!p.error && near(p.comp.rubber + p.comp.castiron, 1) && near(p.comp.rubber, 1.1 / 2.1), 'MISC re-runs as its own blend, as fractions');
check(near(p.tons, 2.1) && p.tons <= p.tot + 1e-9, 'a bucket that fits one batch runs whole (#350), never more than it holds');
check(L.rerunPlan({ steel: { t: 75, p80: 20 } }, ['steel'], 30).tons === 30, 'a bigger bucket runs a full batch and keeps the rest');
p = L.rerunPlan(stock, ['steel'], 5);
check(p.tons === 5 && near(p.comp.steel, 1), 'the batch limit caps a big bucket; the rest stays');
check(L.rerunPlan(stock, ['glass'], 30).error === 'small', 'a bucket under 1 t is too small to run');
check(L.rerunPlan(stock, ['gold'], 30).error === 'small', 'an unknown material is an empty bucket');

/* ---- stations: bins and leftovers ---- */
const LONE = { nodes: [{ m: 'hammer', s: { grate: 100, rpm: 100 }, src: 'feed' }] };   // a hammermill on its own
function walk(lineId, feedId, tons) {
  const line = Sim.buildLine(lineId === 'lone' ? LONE : LINES[lineId]), ev = Sim.evalLine(line, FEEDS[feedId].comp);
  return { line, ev, flows: line.map((nd) => L.stationFlow(ev, line, tons, nd.uid)) };
}
for (const [lineId, feedId] of [['starter', 'elv'], ['car', 'elv'], ['universal', 'elv']]) {
  if (!LINES[lineId]) continue;
  const { line, ev, flows } = walk(lineId, feedId, 30);
  let ok = true, toOk = true, termKg = 0, binKg = 0;
  line.forEach((nd, k) => {
    let outKg = 0;
    for (const key in ev.ports) if (Number(key.split(':')[0]) === nd.uid) { const kg = Sim.streamMass(ev.ports[key]); if (kg >= 0.5) outKg += kg; }
    const f = flows[k], kg = f.bins.reduce((a, x) => a + x.kg, 0) + f.next.reduce((a, x) => a + x.kg, 0);
    if (!near(kg, outKg, 1e-9)) ok = false;
    f.next.forEach((x) => x.to.forEach((s) => { const d = line[s - 1]; if (!d || d.src.uid !== nd.uid || d.src.port !== x.port || s <= k + 1) toOk = false; }));
    binKg += f.bins.reduce((a, x) => a + x.kg, 0);
  });
  ev.terminals.forEach((t) => { const kg = Sim.binStats(t.stream.m, t.form).total; if (kg >= 0.5) termKg += kg; });
  check(ok, lineId + ' line: every station\'s bins plus leftovers add up to everything it puts out');
  check(toOk, lineId + ' line: leftovers point at later stations that really take that output');
  check(near(binKg, termKg, 1e-9), lineId + ' line: the stations\' bins together are every end bin of the line');
  const t30 = flows.map((f) => f.bins.reduce((a, x) => a + x.tons, 0)).reduce((a, x) => a + x, 0);
  check(near(t30, binKg / 1000 * 30, 1e-9), lineId + ' line: bin tonnes scale with the batch size');
}
{
  const { flows } = walk('lone', 'elv', 15);
  check(flows[0].bins.length >= 1 && flows[0].next.length === 0, 'a lone hammermill fills one bin of mixed shred and sends nothing on');
}
{
  const { line, flows } = walk('car', 'elv', 30);
  const k = line.findIndex((nd) => nd.m === 'magnet');
  const mag = flows[k], top = mag.bins[0];
  check(top && L.topMats(top.st, 1)[0] === 'steel' && top.st.share > 0.9, 'car line: the magnet\'s bin is clean steel');
  check(mag.next.length === 1 && mag.next[0].port === 'residue', 'car line: what the magnet leaves moves on to the next station');
  check(flows[0].bins.length === 0 && flows[0].next[0].port === 'product' && flows[0].next[0].to[0] === 2, 'car line: the shredder fills no bins; all its shred goes to station 2');
}
check(L.stationFlow(null, [], 30, 1).bins.length === 0, 'no evaluation yet: an empty station');

/* ---- #41: a re-run bucket goes in at its recorded shred size ---- */
{
  const st = { steel: { t: 10, purity: 0.9, p80: 80 }, plastic: { t: 2, purity: 0.5 } };
  const pl = L.rerunPlan(st, ['steel', 'plastic'], 30);
  check(pl.sizes.steel === 80 && !('plastic' in pl.sizes), 'the plan carries each material\'s recorded p80 (none when unknown)');
  const line = Sim.buildLine(LINES.car), comp = FEEDS.elv.comp;
  const raw = Sim.evalLine(line, comp), shred = Sim.evalLine(line, comp, { sizes: { steel: 80, aluminum: 60, plastic: 40, rubber: 40 } });
  check(shred.nodes[0].ePerHead < raw.nodes[0].ePerHead * 0.5, 'the shredder spends far less energy on feed that is already shred');
  check(Sim.binStats({ steel: shred.head.m.steel }).p80 < Sim.binStats({ steel: raw.head.m.steel }).p80 / 2, 'the head feed carries the recorded size, not the raw lump size');
  check(near(Sim.streamMass(shred.head), 1000, 1e-9), 'sized feed keeps its mass');
  const big = Sim.evalLine(line, comp, { sizes: { steel: 5000 } });
  check(near(Sim.binStats({ steel: big.head.m.steel }).p80, Sim.binStats({ steel: raw.head.m.steel }).p80, 1e-6), 'a recorded size never makes feed coarser than the raw material');
}

/* ---- #42: the entry station ---- */
{
  const line = Sim.buildLine(LINES.car);
  const k = line.findIndex((nd) => nd.m === 'air');
  check(L.defaultEntry(line, globalThis.CS.MACHINES) === line[k].uid, 'a bucket enters at the first station that is not a shredder');
  const lone = Sim.buildLine(LONE);
  check(L.defaultEntry(lone, globalThis.CS.MACHINES) === null, 'a line of shredders only: the bucket enters at station 1');
  const comp = FEEDS.elv.comp, mag = line.findIndex((nd) => nd.m === 'magnet');
  const ev = Sim.evalLine(line, comp, { entry: line[mag].uid });
  check(ev.nodes.slice(0, mag).every((nd) => !(nd.inKg > 1e-9)), 'stations ahead of the entry get nothing');
  check(near(ev.nodes[mag].inKg, 1000, 1e-9), 'the entry station takes the whole feed');
  const tk = ev.terminals.reduce((a, t) => a + Sim.streamMass(t.stream), 0);
  check(near(tk, 1000, 1e-6), 'mass is conserved through the shortened line');
  check(Sim.maxRate(ev.nodes, line).R > Sim.maxRate(Sim.evalLine(line, comp).nodes, line).R, 'skipping the shredder lifts the plant rate');
  const bad = Sim.evalLine(line, comp, { entry: 999999 }), plain = Sim.evalLine(line, comp);
  check(near(bad.nodes[0].inKg, plain.nodes[0].inKg, 1e-9), 'an entry station that is not in the line is ignored');
  const flows = line.map((nd) => L.stationFlow(ev, line, 20, nd.uid));
  check(flows.slice(0, mag).every((f) => !f.bins.length && !f.next.length), 'skipped stations fill no bins and send nothing on');
}

/* ---- #63: - / + on a station's settings ---- */
{
  const M = globalThis.CS.MACHINES, step = L.stepSetting;
  const lin = { min: 20, max: 200, step: 5 }, logS = { min: 0.1, max: 100, step: 1, log: true }, fine = { min: 1.0, max: 3.5, step: 0.05 };
  check(step(lin, 80, 1) === 85 && step(lin, 80, -1) === 75, 'a linear setting moves by the slider\'s step');
  check(step(lin, 200, 1) === 200 && step(lin, 20, -1) === 20, 'and stops at its min and max');
  check(step(fine, 2.6, 1) === 2.65 && step(fine, 1.0, -1) === 1.0, 'fine steps keep their decimals (2.60 + 0.05 = 2.65, no float dust)');
  const up = step(logS, 10, 1);
  const f40 = Math.pow(logS.max / logS.min, 1 / 40);
check(Math.abs(up / 10 - f40) < 0.01 && Math.abs(step(logS, up, -1) - 10) < 0.06, 'a log-scale setting moves a fortieth of its range on the log scale, and back');
  let v = logS.min, presses = 0; while (v < logS.max && presses < 100) { v = step(logS, v, 1); presses++; }
  check(presses >= 35 && presses <= 45, 'forty-odd presses span a log setting\'s range (' + presses + ')');
  const tgt = M.sensor.settings.find((s) => s.enum);
  const first = tgt.enum[0], last = tgt.enum[tgt.enum.length - 1];
  check(step(tgt, first, 1) === tgt.enum[1] && step(tgt, first, -1) === last && step(tgt, last, 1) === first, 'the sensor sorter\'s target cycles through the materials, wrapping round');
  check(L.fmtSetting(85, Object.assign({ unit: 'mm' }, lin)) === '85 mm' && L.fmtSetting('gold', tgt) === 'Gold', 'values read with their unit, materials by name');
  let allOk = true;
  for (const id in M) (M[id].settings || []).forEach((st) => { if (st.enum) return; const d = st.def; [1, -1].forEach((dir) => { const nv = step(st, d, dir); if (!(nv >= st.min && nv <= st.max) || !isFinite(nv)) allOk = false; }); });
  check(allOk, 'every machine setting steps from its default and stays in range');
}

/* ---- #80: settings explain themselves ---- */
{
  const M = globalThis.CS.MACHINES; let missing = [];
  for (const id in M) (M[id].settings || []).forEach((st) => { if (!L.settingHelp(id, st)) missing.push(id + ':' + st.id); });
  check(!missing.length, 'every machine setting says what it does to the material' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  const line = Sim.buildLine(LINES.car), before = L.binSnapshot(Sim.evalLine(line, FEEDS.elv.comp));
  const sf = line.find((nd) => nd.m === 'sinkfloat'); sf.settings.sg = 1.2;
  const ch = L.biggestChange(before, L.binSnapshot(Sim.evalLine(line, FEEDS.elv.comp)));
  check(ch && ch.main && Math.abs(ch.to - ch.from) >= 0.005, 'a press reports the bin it changed most (' + (ch ? ch.main + ' ' + Math.round(ch.from * 100) + '% to ' + Math.round(ch.to * 100) + '%' : 'none') + ')');
  check(L.biggestChange(before, before) === null, 'and says nothing when no bin moved');
}

// #123: THE BIN's heap
{
  const MATS = globalThis.CS.MATERIALS, comp = { wood: 0.55, glass: 0.3, steel: 0.12, plastic: 0.03 };
  const a1 = L.heapPieces(comp, 0.85, 160, 120, 7, MATS), a2 = L.heapPieces(comp, 0.85, 160, 120, 7, MATS);
  check(a1.length > 100 && JSON.stringify(a1) === JSON.stringify(a2), 'the heap is a seeded draw: the same mix and level give the same pieces (' + a1.length + ')');
  check(L.heapPieces(comp, 0, 160, 120, 7, MATS).length === 0 && L.heapPieces({}, 0.8, 160, 120, 7, MATS).length === 0, 'an empty bin draws nothing');
  const share = (m) => a1.filter((p) => p.m === m).length / a1.length;
  check(Math.abs(share('wood') - 0.55) < 0.12 && share('glass') > 0.15 && a1.every((p) => p.x >= 0 && p.x <= 160 && p.y <= 120), 'pieces follow the mix and stay inside the bin');
  const low = L.heapPieces(comp, 0.3, 160, 120, 7, MATS), topOf = (arr) => Math.min.apply(null, arr.map((p) => p.y));
  check(topOf(low) > topOf(a1) + 20 && low.length < a1.length, 'a lower level is a lower, smaller heap');
  check(a1.find((p) => p.m === 'wood').kind === 'wood' && a1.find((p) => p.m === 'glass').kind === 'angular', "each piece carries its material's look");
}

// #125: the belt carries the mix
{
  const MATS = globalThis.CS.MATERIALS;
  const p1 = L.beltPattern({ wood: 0.9, steel: 0.07, plastic: 0.03 }, MATS);
  check(p1.seq.length === 12 && p1.seq.filter((m) => m === 'wood').length >= 9 && p1.seq.includes('steel') && p1.seq.includes('plastic'), 'twelve chunks a repeat, dealt by share, a trace still shows (' + p1.seq.join(',') + ')');
  check(p1.seq.indexOf('steel') > 0 && p1.seq.indexOf('steel') < 11, 'the minor materials sit among the wood, not at one end');
  check(L.beltPattern({}, MATS).period > 0 && L.beltPattern({ wood: 1 }, MATS).seq.every((m) => m === 'wood'), 'an empty or single-material belt still draws');
}

console.log('\n' + (n - fails) + '/' + n + ' checks passed');
process.exit(fails ? 1 : 0);
