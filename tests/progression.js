// Progression check for the hammermill-only start: the starter line earns a small positive margin on its own, the first sorter
// is reachable after two or three batches, the separators are priced in the intended buying order, and trial-adding sorters to
// the end of the starter line (what the NEXT PURCHASE block in the bank panel does) ranks real sorters first.
// Run: node tests/progression.js
require('../js/data.js'); require('../js/sim.js');
const { MACHINES, FEEDS, LINES, Sim, STARTER_MACHINES, START_BANK, PRICE_SCALE } = globalThis.CS;
const f = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

/* same arithmetic as marginPerT in app.js: product value minus feed, power, consumables and wear, per head-tonne */
function economics(line, comp, feedCost) {
  const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
  let P = 0, extra = 0, wearC = 0, rev = 0;
  ev.nodes.forEach(function (n) { P += Math.min(n.M.prated, n.M.pidle + R * n.ePerHead); extra += n.extraCostPerHeadT; wearC += n.wearPerHeadT * n.M.service; });
  ev.terminals.forEach(function (t) { const st = Sim.binStats(t.stream.m); if (st.total > 0.5) rev += st.value; });
  const powerC = R > 0 ? P / R * Sim.prices.power : 0;
  // net is what stopRun banks per tonne (wear is paid later, at service time)
  return { R, rev, powerC, extra, wearC, margin: rev - feedCost - powerC - extra - wearC, net: rev - feedCost - powerC - extra };
}
function append(line, m, port) { const last = line[line.length - 1]; return line.concat([Sim.makeNode(m, {}, { uid: last.uid, port })]); }
function primary(line) { return MACHINES[line[line.length - 1].m].kind === 'separator' ? 'extract' : 'product'; }

console.log('== starter set ==');
check(STARTER_MACHINES.length === 1 && STARTER_MACHINES[0] === 'hammer', 'the only starter machine is the hammermill');
const L = LINES.starter, comp = FEEDS[L.feed].comp, feedCost = FEEDS[L.feed].cost;
check(L.feed === 'elv' && L.nodes.length === 1 && L.nodes[0].m === 'hammer', 'the starter preset is a hammermill alone on end-of-life vehicles');
check(L.nodes.every(function (d) { return STARTER_MACHINES.includes(d.m); }), 'every machine on the starter line is owned on day one');
const line = Sim.buildLine(L), e = economics(line, comp, feedCost);
console.log('  hammermill only: product ' + f(e.rev, 2) + ' $/t, feed ' + feedCost + ', power ' + f(e.powerC, 2) + ', wear ' + f(e.wearC, 2) + ' -> margin ' + f(e.margin, 2) + ' $/t at ' + f(e.R) + ' t/h');
check(e.margin > 0, 'mixed shred still earns a positive margin (' + f(e.margin, 2) + ' $/t)');
check(e.margin < 60, 'but a small one, so sorters are worth buying (' + f(e.margin, 2) + ' $/t)');

console.log('== bank ==');
const feedBatch = feedCost * L.tons, netBatch = e.net * L.tons;
check(START_BANK >= feedBatch, 'START_BANK $' + START_BANK + ' pays for a ' + L.tons + ' t starter batch of feed ($' + feedBatch + ')');
const seps = ['sinkfloat', 'magnet', 'air', 'eddy', 'screen'];
const first = seps.slice().sort(function (a, b) { return MACHINES[a].price - MACHINES[b].price; })[0];
let bank = START_BANK, batches = 0;
while (bank < MACHINES[first].price && batches < 20) { bank += netBatch; batches++; console.log('  batch ' + batches + ': +$' + f(netBatch, 0) + ' -> bank $' + f(bank, 0)); }
check(batches >= 2 && batches <= 3, 'first sorter (' + MACHINES[first].name + ', $' + MACHINES[first].price + ') is reachable after ' + batches + ' batches of ' + L.tons + ' t');

console.log('== separator prices (PRICE_SCALE ' + PRICE_SCALE + ') ==');
console.log('  ' + seps.map(function (m) { return m + ' $' + MACHINES[m].price; }).join(', '));
for (let i = 1; i < seps.length; i++) check(MACHINES[seps[i - 1]].price < MACHINES[seps[i]].price, seps[i - 1] + ' is cheaper than ' + seps[i]);

console.log('== next purchase ranking from the starter line ==');
const cands = seps.concat(['cone', 'jaw']);
const base = e.margin;
const ranked = cands.map(function (m) {
  const g = economics(append(line, m, primary(line)), comp, feedCost).margin - base;
  console.log('  ' + m.padEnd(10) + ' gain ' + f(g, 2).padStart(8) + ' $/t  price $' + MACHINES[m].price + '  payback ' + (g > 0.5 ? f(MACHINES[m].price / g, 0) + ' t' : '-'));
  return { m, gain: g };
}).sort(function (a, b) { return b.gain - a.gain; });
const top3 = ranked.filter(function (r) { return r.gain > 0.5; }).slice(0, 3).map(function (r) { return r.m; });
check(top3.length === 3 && top3.every(function (m) { return MACHINES[m].kind === 'separator'; }), 'the top three are all separators: ' + top3.join(', '));
check(top3.indexOf('sinkfloat') >= 0 && top3.indexOf('magnet') >= 0 && top3.indexOf('eddy') >= 0, 'sink-float, magnet and eddy are the top three');
const gainOf = function (m) { return ranked.filter(function (r) { return r.m === m; })[0].gain; };
check(gainOf('air') < gainOf('sinkfloat') && gainOf('air') > 0.5, 'the air classifier pays, but less than the other three');
// by payback (price / gain, what a player buying with limited cash cares about) the order is the real-world one
const pay = function (m) { return MACHINES[m].price / gainOf(m); };
check(pay('sinkfloat') < pay('eddy') && pay('magnet') < pay('eddy') && pay('eddy') < pay('air'), 'payback order: magnet and sink-float first, then eddy, then air');
check(top3.indexOf('screen') < 0, 'the screen does not pay on mixed shred, so it is not recommended');
check(ranked.filter(function (r) { return r.m === 'cone' || r.m === 'jaw'; }).every(function (r) { return r.gain <= 0.5; }), 'a second crusher adds nothing to shredded cars');

console.log('== following the block does not dead-end ==');
/* what the NEXT PURCHASE block does: try each unowned candidate on each output port of the last node, keep the best gain */
function bestNext(l) {
  const last = l[l.length - 1], ports = MACHINES[last.m].kind === 'separator' ? ['extract', 'residue'] : ['product'];
  const b0 = economics(l, comp, feedCost).margin, owned = new Set(STARTER_MACHINES.concat(l.map(function (n) { return n.m; })));
  let best = null;
  cands.forEach(function (m) {
    if (owned.has(m)) return;
    ports.forEach(function (port) { const g = economics(append(l, m, port), comp, feedCost).margin - b0; if (!best || g > best.gain) best = { m, port, gain: g }; });
  });
  return best;
}
let cur = line; const path = ['hammer'];
for (let step = 0; step < 4; step++) { const p = bestNext(cur); if (!p || p.gain <= 0.5) break; cur = append(cur, p.m, p.port); path.push(p.m + '/' + p.port + ' +$' + f(p.gain, 0)); }
console.log('  greedy path: ' + path.join(' > ') + '  -> margin ' + f(economics(cur, comp, feedCost).margin, 1) + ' $/t');
check(path.length >= 3, 'taking the recommendation twice in a row buys two sorters that both pay');
check(path[1].indexOf('screen') < 0 && path[1].indexOf('cone') < 0, 'the first recommendation is a sorter, not a crusher or a screen (' + path[1] + ')');
check(economics(cur, comp, feedCost).margin > base + 100, 'the greedy path is far ahead of unsorted shred');

// For the record (not asserted): the car-line order and the ticket order, margin after each purchase.
const A = [line]; A.push(append(A[0], 'sinkfloat', 'product')); A.push(append(A[1], 'magnet', 'residue'));
A.push(A[2].concat([Sim.makeNode('air', {}, { uid: A[1][1].uid, port: 'extract' })])); A.push(A[3].concat([Sim.makeNode('eddy', {}, { uid: A[2][2].uid, port: 'residue' })]));
const B = [line]; B.push(append(B[0], 'magnet', 'product')); B.push(append(B[1], 'air', 'residue')); B.push(append(B[2], 'eddy', 'residue')); B.push(append(B[3], 'sinkfloat', 'extract'));
console.log('  ticket order  hammer > sink-float > magnet > air > eddy: ' + A.map(function (l) { return f(economics(l, comp, feedCost).margin, 0); }).join(' > ') + ' $/t');
console.log('  car order     hammer > magnet > air > eddy > sink-float: ' + B.map(function (l) { return f(economics(l, comp, feedCost).margin, 0); }).join(' > ') + ' $/t');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nprogression checks pass');
process.exit(fails ? 1 : 0);
