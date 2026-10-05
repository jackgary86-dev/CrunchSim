// Headless balance playtest: a greedy operator plays from the starter yard (hammermill + magnetic drum) and the script
// reports how many batches and plant hours each rank takes. Run: node tests/playtest.js   (exit 1 if pacing is off)
//
// Since everything must be sorted to be sold (#52), one extra sorter often earns nothing on its own: the magnet's
// leftovers stay mixed until two sorters work together (an eddy current pulls the metals, a sink-float tank floats the
// aluminum out of them). So the operator weighs single purchases and pairs (a sorter plus a second one on its output).
// Options are recomputed only after a purchase: between purchases the plant just runs batches.
require('../js/data.js'); require('../js/sim.js');
const CS = globalThis.CS, { MACHINES, FEEDS, PLANT_UPGRADES: PU, RANKS, levelCost, Sim } = CS;

const MAX_MACHINES = 8;   // a grinder, the starter magnet and up to six more: keeps the search honest and fast
const S = { money: CS.START_BANK, units: {}, owned: new Set(CS.STARTER_MACHINES), levels: {}, plant: { logistics: 0, power: 0, market: 0, nitrogen: 0, room: 0 }, line: Sim.buildLine(CS.LINES.starter), hours: 0, batches: 0 };
CS.STARTER_MACHINES.forEach((m) => { S.units[m] = 1; });
const feed = FEEDS.elv;
if (process.env.PT_FEED_COST) feed.cost = +process.env.PT_FEED_COST;   // balance experiments only
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
  let rev = 0; ev.terminals.forEach((t) => { rev += Sim.binStats(t.stream.m, t.form).value; });
  let P = 0, extra = 0, wear = 0;
  ev.nodes.forEach((n) => { P += n.M.pidle + R * n.ePerHead; extra += n.extraCostPerHeadT; wear += n.wearPerHeadT * n.M.service; });
  const margin = rev - feed.cost - P / R * Sim.prices.power - extra - wear;
  return { margin, R, rev };
}
/* the free output ports of a line (not yet feeding another machine) */
function freePorts(line) {
  const out = [];
  line.forEach((n) => (MACHINES[n.m].kind === 'separator' ? ['extract', 'residue'] : ['product']).forEach((p) => {
    if (!line.some((x) => x.src && x.src !== 'feed' && x.src.uid === n.uid && x.src.port === p)) out.push({ uid: n.uid, port: p });
  }));
  return out;
}
function fits(line) { return line.length <= MAX_MACHINES && floorUsed(line) <= pv('room'); }
/* the best way to add machine m on any free port */
function bestAppend(base, m) {
  let best = null;
  for (const src of freePorts(base)) {
    const line = base.concat([Sim.makeNode(m, {}, src)]); if (!fits(line)) continue;
    const e = econ(line); if (!best || e.margin > best.e.margin) best = { line, e };
  }
  return best;
}
/* the best pair: a on any free port, then b on one of a's outputs */
function bestPair(base, a, b) {
  let best = null;
  for (const src of freePorts(base)) {
    const na = Sim.makeNode(a, {}, src), l1 = base.concat([na]); if (!fits(l1)) continue;
    for (const port of ['extract', 'residue']) {
      const line = l1.concat([Sim.makeNode(b, {}, { uid: na.uid, port })]); if (!fits(line)) continue;
      const e = econ(line); if (!best || e.margin > best.e.margin) best = { line, e };
    }
  }
  return best;
}

const CANDS = ['magnet', 'sinkfloat', 'air', 'eddy', 'screen', 'sensor', 'twin'];
const SORTERS = ['magnet', 'sinkfloat', 'air', 'eddy', 'screen', 'sensor'];
const rankAt = {}; const log = [];
function rankIdx() { let i = 0; RANKS.forEach((r, k) => { if (worth() >= r[0]) i = k; }); return i; }
let lastRank = 0; rankAt[RANKS[0][1]] = { batches: 0, hours: 0 };

let opts = null, cur = null;
function options() {
  cur = econ(S.line); const tons = pv('logistics'), out = [];
  const buy = (ms, b, what) => {
    const cost = ms.reduce((a, m) => a + MACHINES[m].price, 0), gain = (b.e.margin - cur.margin) * tons;
    if (gain > 1) out.push({ what, cost, gain, apply: () => { ms.forEach((m) => { S.owned.add(m); S.units[m] = (S.units[m] || 0) + 1; }); S.line = b.line; } });
  };
  for (const m of CANDS) { const b = bestAppend(S.line, m); if (b) buy([m], b, 'buy ' + m); }
  if (!out.length) for (const a of SORTERS) for (const b of SORTERS) { const p = bestPair(S.line, a, b); if (p) buy([a, b], p, 'buy ' + a + ' + ' + b); }
  // level up: only levels that raise margin
  S.line.forEach((n) => {
    const lvl = S.levels[n.m] || 0; if (lvl >= CS.LEVEL_MAX || out.some((o) => o.what === 'level ' + n.m)) return;
    S.levels[n.m] = lvl + 1; const e = econ(S.line); S.levels[n.m] = lvl;
    const gain = (e.margin - cur.margin) * tons; if (gain > 1) out.push({ what: 'level ' + n.m, cost: levelCost(MACHINES[n.m], lvl), gain, apply: () => { S.levels[n.m] = lvl + 1; } });
  });
  for (const k of ['logistics', 'market', 'power', 'room']) {
    const l = S.plant[k]; if (l >= PU[k].costs.length) continue;
    let gain;
    if (k === 'logistics') gain = cur.margin * (PU[k].levels[l + 1] - tons);
    else if (k === 'room') { S.plant.room++; gain = 0; for (const m of CANDS) { const b = bestAppend(S.line, m); if (b) gain = Math.max(gain, (b.e.margin - cur.margin) * tons); } S.plant.room--; }
    else { S.plant[k]++; gain = (econ(S.line).margin - cur.margin) * tons; S.plant[k]--; }
    if (gain > 1) out.push({ what: k + ' ' + (l + 1), cost: PU[k].costs[l], gain, apply: () => { S.plant[k]++; } });
  }
  return out;
}

for (let step = 0; step < 4000 && rankIdx() < RANKS.length - 1; step++) {
  if (!opts) opts = options();
  const tons = pv('logistics'), reserve = feed.cost * tons;
  const affordable = opts.filter((o) => o.cost + reserve <= S.money).sort((a, b) => a.cost / a.gain - b.cost / b.gain);
  if (affordable.length && affordable[0].cost / affordable[0].gain < 25) {
    const o = affordable[0]; o.apply(); S.money -= o.cost; opts = null;
    log.push(`b${S.batches} ${o.what} $${Math.round(o.cost)} (+$${Math.round(o.gain)}/batch)`); continue;
  }
  // run a batch
  const bt = Math.min(tons, Math.floor(S.money / Math.max(feed.cost, 1)));   // short of cash: run a smaller batch
  if (bt < 1) { log.push('BROKE at batch ' + S.batches); break; }
  S.money += cur.margin * bt; S.hours += bt / cur.R; S.batches++;
  const ri = rankIdx(); if (ri > lastRank) { for (let k = lastRank + 1; k <= ri; k++) rankAt[RANKS[k][1]] = { batches: S.batches, hours: S.hours, line: S.line.map((n) => MACHINES[n.m].short).join('>'), margin: cur.margin, tons }; lastRank = ri; }
}

console.log('first purchases:'); log.slice(0, 18).forEach((l) => console.log('  ' + l));
console.log('rank          batches   plant h   margin $/t   batch t   line');
for (const [, name] of RANKS) { const r = rankAt[name]; console.log((name).padEnd(18) + (r ? String(r.batches).padStart(5) + String(Math.round(r.hours)).padStart(10) + String(Math.round(r.margin || 0)).padStart(12) + String(r.tons || '').padStart(10) + '   ' + (r.line || '') : '  not reached')); }
console.log('final worth $' + Math.round(worth()) + ' after ' + S.batches + ' batches, ' + Math.round(S.hours) + ' plant h');

// pacing targets (#12, #55): first rank within 5-30 batches; top rank in 3,000-12,000 plant hours
// (at 60x speed one plant hour is one real second, so roughly 50 minutes to 3.3 hours of play at 60x)
const bad = [];
if (!rankAt.Recycler || rankAt.Recycler.batches > 30) bad.push('Recycler too slow');
if (rankAt.Recycler && rankAt.Recycler.batches < 5) bad.push('Recycler too fast');
if (!rankAt['Mega-plant'] || rankAt['Mega-plant'].hours > 12000) bad.push('Mega-plant too slow or unreachable');
if (rankAt['Mega-plant'] && rankAt['Mega-plant'].hours < 3000) bad.push('Mega-plant too fast');
console.log(bad.length ? 'PACING: ' + bad.join('; ') : 'pacing within targets');
process.exit(bad.length ? 1 : 0);
