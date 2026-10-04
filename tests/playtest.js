// Headless balance playtest: a greedy operator plays from the hammermill start and the script reports
// how many batches and plant hours each rank takes. Run: node tests/playtest.js   (exit 1 if pacing is off)
require('../js/data.js'); require('../js/sim.js');
const CS = globalThis.CS, { MACHINES, FEEDS, PLANT_UPGRADES: PU, RANKS, levelCost, Sim } = CS;

const S = { money: CS.START_BANK, units: { hammer: 1 }, owned: new Set(CS.STARTER_MACHINES), levels: {}, plant: { logistics: 0, power: 0, market: 0, nitrogen: 0, room: 0 }, line: Sim.buildLine(CS.LINES.starter), hours: 0, batches: 0 };
const feed = FEEDS.elv;
const pv = (k) => PU[k].levels[Math.min(S.plant[k], PU[k].levels.length - 1)];
function assets() {
  let v = 0;
  S.owned.forEach((m) => { v += MACHINES[m].price * (S.units[m] || 1); for (let l = 0; l < (S.levels[m] || 0); l++) v += levelCost(MACHINES[m], l); });
  for (const k in S.plant) for (let l = 0; l < S.plant[k]; l++) v += PU[k].costs[l];
  return v;
}
const worth = () => S.money + assets();
function floorUsed(line) { return line.reduce((a, n) => { const f = MACHINES[n.m].foot; return a + (f ? f.w * f.d * 1.3 : 0); }, 0); }

/* per-tonne economics of a line: revenue, power, consumables, wear; and the head rate */
function econ(line) {
  line.forEach((n) => { n.level = S.levels[n.m] || 0; });
  Sim.prices.power = pv('power'); Sim.prices.market = pv('market'); Sim.prices.ln2 = pv('nitrogen');
  const ev = Sim.evalLine(line, feed.comp), R = Sim.maxRate(ev.nodes, line).R;
  if (!(R > 0)) return { margin: -1e9, R: 0 };
  let rev = 0; ev.terminals.forEach((t) => { rev += Sim.binStats(t.stream.m).value; });
  let P = 0, extra = 0, wear = 0;
  ev.nodes.forEach((n) => { P += n.M.pidle + R * n.ePerHead; extra += n.extraCostPerHeadT; wear += n.wearPerHeadT * n.M.service; });
  const margin = rev - feed.cost - P / R * Sim.prices.power - extra - wear;
  return { margin, R, rev };
}
/* trial-append one unowned or owned machine to every free port; best by margin */
function bestAppend(m) {
  let best = null;
  const ports = [];
  S.line.forEach((n) => { const M = MACHINES[n.m]; (M.kind === 'separator' ? ['extract', 'residue'] : ['product']).forEach((p) => ports.push({ uid: n.uid, port: p })); });
  for (const src of ports) {
    const node = Sim.makeNode(m, {}, src), line = S.line.concat([node]);
    if (floorUsed(line) > pv('room')) continue;
    const e = econ(line);
    if (!best || e.margin > best.e.margin) best = { line, e };
  }
  return best;
}

const CANDS = ['magnet', 'sinkfloat', 'air', 'eddy', 'screen', 'sensor', 'twin'];
const rankAt = {}; const log = [];
function rankIdx() { let i = 0; RANKS.forEach((r, k) => { if (worth() >= r[0]) i = k; }); return i; }
let lastRank = 0; rankAt[RANKS[0][1]] = { batches: 0, hours: 0 };

for (let step = 0; step < 4000 && rankIdx() < RANKS.length - 1; step++) {
  // 1) spend: pick the purchase with the best payback in batches (cost / gain per batch)
  const cur = econ(S.line), tons = pv('logistics');
  const opts = [];
  for (const m of CANDS) {
    const b = bestAppend(m); if (!b) continue;
    const gain = (b.e.margin - cur.margin) * tons; const cost = MACHINES[m].price;   // every copy is bought
    if (gain > 1) opts.push({ what: 'buy ' + m, cost, gain, apply: () => { S.owned.add(m); S.units[m] = (S.units[m] || 0) + 1; S.line = b.line; } });
  }
  // level up the bottleneck: more t/h shortens batches (time is not money here, so value it at 0) -> only levels that raise margin
  S.line.forEach((n) => {
    const lvl = S.levels[n.m] || 0; if (lvl >= CS.LEVEL_MAX) return;
    S.levels[n.m] = lvl + 1; const e = econ(S.line); S.levels[n.m] = lvl;
    const gain = (e.margin - cur.margin) * tons; if (gain > 1) opts.push({ what: 'level ' + n.m, cost: levelCost(MACHINES[n.m], lvl), gain, apply: () => { S.levels[n.m] = lvl + 1; } });
  });
  for (const k of ['logistics', 'market', 'power', 'room']) {
    const l = S.plant[k]; if (l >= PU[k].costs.length) continue;
    let gain;
    if (k === 'logistics') gain = cur.margin * (PU[k].levels[l + 1] - tons);
    else if (k === 'room') gain = 0.5;   // only bought when a machine needs it (handled below)
    else { S.plant[k]++; gain = (econ(S.line).margin - cur.margin) * tons; S.plant[k]--; }
    if (gain > 1 || k === 'room') opts.push({ what: k + ' ' + (l + 1), cost: PU[k].costs[l], gain: Math.max(gain, 0.5), apply: () => { S.plant[k]++; } });
  }
  // room: if a wanted machine does not fit, the hall becomes worth its machine's gain
  const roomOpt = opts.find((o) => o.what.startsWith('room'));
  if (roomOpt) {
    S.plant.room++; let g = 0;
    for (const m of CANDS) { const b = bestAppend(m); if (b) g = Math.max(g, (b.e.margin - cur.margin) * tons); }
    S.plant.room--; roomOpt.gain = g;
  }
  const reserve = feed.cost * tons;
  const affordable = opts.filter((o) => o.cost + reserve <= S.money && o.gain > 1).sort((a, b) => a.cost / a.gain - b.cost / b.gain);
  if (affordable.length && affordable[0].cost / affordable[0].gain < 25) { const o = affordable[0]; o.apply(); S.money -= o.cost; log.push(`b${S.batches} ${o.what} $${Math.round(o.cost)} (+$${Math.round(o.gain)}/batch)`); continue; }
  // 2) run a batch
  const e = econ(S.line);
  const bt = Math.min(tons, Math.floor(S.money / Math.max(feed.cost, 1)));   // short of cash: run a smaller batch
  if (bt < 1) { log.push('BROKE at batch ' + S.batches); break; }
  S.money += e.margin * bt; S.hours += bt / e.R; S.batches++;
  const ri = rankIdx(); if (ri > lastRank) { for (let k = lastRank + 1; k <= ri; k++) rankAt[RANKS[k][1]] = { batches: S.batches, hours: S.hours, line: S.line.map((n) => MACHINES[n.m].short).join('>'), margin: e.margin, tons }; lastRank = ri; }
}

console.log('first purchases:'); log.slice(0, 18).forEach((l) => console.log('  ' + l));
console.log('rank          batches   plant h   margin $/t   batch t   line');
for (const [, name] of RANKS) { const r = rankAt[name]; console.log((name).padEnd(18) + (r ? String(r.batches).padStart(5) + String(Math.round(r.hours)).padStart(10) + String(Math.round(r.margin || 0)).padStart(12) + String(r.tons || '').padStart(10) + '   ' + (r.line || '') : '  not reached')); }
console.log('final worth $' + Math.round(worth()) + ' after ' + S.batches + ' batches, ' + Math.round(S.hours) + ' plant h');

// pacing targets (#12): first rank within 5-30 batches; top rank in 3,000-12,000 plant hours
// (at 60x speed one plant hour is one real second, so roughly 50 minutes to 3.3 hours of play at 60x)
const bad = [];
if (!rankAt.Recycler || rankAt.Recycler.batches > 30) bad.push('Recycler too slow');
if (rankAt.Recycler && rankAt.Recycler.batches < 5) bad.push('Recycler too fast');
if (!rankAt['Mega-plant'] || rankAt['Mega-plant'].hours > 12000) bad.push('Mega-plant too slow or unreachable');
if (rankAt['Mega-plant'] && rankAt['Mega-plant'].hours < 3000) bad.push('Mega-plant too fast');
console.log(bad.length ? 'PACING: ' + bad.join('; ') : 'pacing within targets');
process.exit(bad.length ? 1 : 0);
