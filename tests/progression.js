// Progression check for the sorted-only game (#52, #55): the starter yard is a hammermill and a magnetic drum, the
// magnet's clean steel earns a real margin on its own, everything still mixed earns nothing, and the next sorters pay in
// pairs (one sorter feeding the next) because a single sorter on the magnet's leftovers pulls nothing out pure.
// The NEXT PURCHASE block in the bank does the same search as bestSingle / bestPair below.
// Run: node tests/progression.js
require('../js/data.js'); require('../js/sim.js');
const { MACHINES, FEEDS, LINES, Sim, STARTER_MACHINES, START_BANK, PRICE_SCALE } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

/* same arithmetic as marginPerT in app.js: product value minus feed, power, consumables and wear, per head-tonne */
function economics(line, comp, feedCost) {
  const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
  let P = 0, extra = 0, wearC = 0, rev = 0, sold = 0, mixed = 0;
  ev.nodes.forEach(function (n) { P += Math.min(n.M.prated, n.M.pidle + R * n.ePerHead); extra += n.extraCostPerHeadT; wearC += n.wearPerHeadT * n.M.service; });
  ev.terminals.forEach(function (t) { const st = Sim.binStats(t.stream.m, t.form); if (st.total > 0.5) { rev += st.value; if (st.sellable) sold += st.total; else mixed += st.total; } });
  const powerC = R > 0 ? P / R * Sim.prices.power : 0;
  return { R, rev, powerC, extra, wearC, sold, mixed, margin: rev - feedCost - powerC - extra - wearC, net: rev - feedCost - powerC - extra };
}
function freePorts(line) {
  const out = [];
  line.forEach(function (n) { (MACHINES[n.m].kind === 'separator' ? ['extract', 'residue'] : ['product']).forEach(function (p) { if (!line.some(function (x) { return x.src && x.src !== 'feed' && x.src.uid === n.uid && x.src.port === p; })) out.push({ uid: n.uid, port: p }); }); });
  return out;
}

console.log('== starter set ==');
check(STARTER_MACHINES.length === 2 && STARTER_MACHINES[0] === 'hammer' && STARTER_MACHINES[1] === 'magnet', 'day one: a hammermill to grind and a magnetic drum to sort');
const L = LINES.starter, comp = FEEDS[L.feed].comp, feedCost = FEEDS[L.feed].cost;
check(L.feed === 'elv' && L.nodes.length === 2 && L.nodes[0].m === 'hammer' && L.nodes[1].m === 'magnet', 'the starter preset is hammermill then magnet on end-of-life vehicles');
check(L.nodes.every(function (d) { return STARTER_MACHINES.includes(d.m); }), 'every machine on the starter line is owned on day one');
const line = Sim.buildLine(L), e = economics(line, comp, feedCost);
console.log('  starter: sorted ' + f(e.sold / 10, 0) + '% of the feed, value ' + f(e.rev, 2) + ' $/t, feed ' + feedCost + ', power ' + f(e.powerC, 2) + ', wear ' + f(e.wearC, 2) + ' -> margin ' + f(e.margin, 2) + ' $/t at ' + f(e.R) + ' t/h');
check(e.margin > 30, 'the magnet\'s clean steel earns a real margin (' + f(e.margin, 2) + ' $/t)');
check(e.margin < 120, 'but a modest one, so the next sorters are worth buying');
check(e.mixed > 250, 'a third of the feed is still mixed and earns nothing until it is sorted (' + f(e.mixed / 10, 0) + '%)');
const hammerOnly = economics(Sim.buildLine({ nodes: [{ m: 'hammer', s: { grate: 100, rpm: 100 }, src: 'feed' }] }), comp, feedCost);
check(hammerOnly.rev === 0 && hammerOnly.margin < 0, 'a hammermill on its own sells nothing: unsorted shred has no buyer');

console.log('== bank ==');
const feedBatch = feedCost * L.tons, netBatch = e.net * L.tons;
check(START_BANK >= feedBatch, 'START_BANK $' + START_BANK + ' pays for a ' + L.tons + ' t starter batch of feed ($' + feedBatch + ')');
check(netBatch > 500, 'a starter batch banks $' + f(netBatch, 0));

console.log('== separator prices (PRICE_SCALE ' + PRICE_SCALE + ') ==');
const seps = ['sinkfloat', 'magnet', 'air', 'eddy', 'screen'];
console.log('  ' + seps.map(function (m) { return m + ' $' + MACHINES[m].price; }).join(', '));
for (let i = 1; i < seps.length; i++) check(MACHINES[seps[i - 1]].price < MACHINES[seps[i]].price, seps[i - 1] + ' is cheaper than ' + seps[i]);

console.log('== next purchase from the starter line ==');
const SORT = ['sinkfloat', 'magnet', 'air', 'eddy', 'screen'];
function bestSingle(l) {
  const b0 = economics(l, comp, feedCost).margin; let best = null;
  SORT.concat(['cone', 'jaw']).forEach(function (m) { freePorts(l).forEach(function (src) { const g = economics(l.concat([Sim.makeNode(m, {}, src)]), comp, feedCost).margin - b0; if (!best || g > best.gain) best = { ms: [m], src, gain: g }; }); });
  return best;
}
function bestPair(l) {
  const b0 = economics(l, comp, feedCost).margin; let best = null;
  SORT.forEach(function (a) { SORT.forEach(function (b) { freePorts(l).forEach(function (src) { const na = Sim.makeNode(a, {}, src); ['extract', 'residue'].forEach(function (p2) {
    const g = economics(l.concat([na, Sim.makeNode(b, {}, { uid: na.uid, port: p2 })]), comp, feedCost).margin - b0;
    const cost = MACHINES[a].price + MACHINES[b].price;
    if (g > 0.5 && (!best || cost / g < best.cost / best.gain)) best = { ms: [a, b], src, port2: p2, gain: g, cost };
  }); }); }); });
  return best;
}
const s1 = bestSingle(line);
console.log('  best single: ' + s1.ms[0] + ' on ' + s1.src.port + ' ' + f(s1.gain, 2) + ' $/t');
check(s1.gain <= 0.5, 'no single sorter pulls anything pure out of the magnet\'s leftovers: they stay MISC');
const p1 = bestPair(line);
console.log('  best pair:   ' + (p1 ? p1.ms.join(' + ') + ' (' + p1.src.port + ', then ' + p1.port2 + ') +' + f(p1.gain, 1) + ' $/t for $' + p1.cost : 'none'));
check(p1 && p1.gain > 30, 'a pair of sorters does: one pulls a stream, the next makes it pure');
check(p1 && p1.ms.every(function (m) { return MACHINES[m].kind === 'separator'; }) && p1.ms.indexOf('screen') < 0, 'the recommended pair is two real sorters, not a screen');
let bank = START_BANK, batches = 0;
while (p1 && bank < p1.cost && batches < 60) { bank += netBatch; batches++; }
check(p1 && batches <= 25, 'the first pair ($' + (p1 ? p1.cost : '-') + ') is affordable after ' + batches + ' starter batches');

console.log('== following the block does not dead-end ==');
let cur = line; const path = ['hammer > magnet'];
for (let step = 0; step < 3; step++) {
  const s = bestSingle(cur), p = s && s.gain > 0.5 ? s : bestPair(cur); if (!p || !(p.gain > 0.5)) break;
  const na = Sim.makeNode(p.ms[0], {}, p.src); cur = cur.concat([na]); if (p.ms[1]) cur = cur.concat([Sim.makeNode(p.ms[1], {}, { uid: na.uid, port: p.port2 })]);
  path.push(p.ms.join(' + ') + ' +$' + f(p.gain, 0));
}
const eEnd = economics(cur, comp, feedCost);
console.log('  greedy path: ' + path.join(' > ') + '  -> margin ' + f(eEnd.margin, 1) + ' $/t, ' + f(eEnd.sold / 10, 0) + '% sorted');
check(path.length >= 3, 'taking the recommendation twice in a row buys sorters that pay both times');
check(eEnd.margin > e.margin + 40 && eEnd.sold > e.sold, 'the greedy path sorts more of the feed and earns well above the starter yard');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nprogression checks pass');
process.exit(fails ? 1 : 0);
