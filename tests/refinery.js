// Refining (#54): sorted metal buckets melt into ingots or refine into bars for more than they fetch raw, and rich MISC
// concentrates sell to the precious refinery by assay. Run: node tests/refinery.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/refinery.js');
const { MATERIALS, FEEDS, Sim, Refinery: R } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const f = (x, d = 0) => isFinite(x) ? x.toFixed(d) : '-';
const raw = (m, e) => e.t * MATERIALS[m].sell * e.grade * e.sf;   // what SELL pays at list (market factor 1)

check(R.LEVELS.length === 3 && R.LEVELS[1].cost < R.LEVELS[2].cost, 'two refinery levels: a smelting furnace, then a precious-metals refinery');
check(R.levelFor('aluminum') === 1 && R.levelFor('steel') === 1 && R.levelFor('gold') === 2 && R.levelFor('plastic') === 0, 'base metals need the furnace, gold and silver the precious refinery, plastic is never refined');

const al = { t: 10, purity: 0.94, grade: 0.98, sf: 0.95 };
const qa = R.quoteBucket('aluminum', al, 1, raw('aluminum', al), 0.12, 1);
console.log('  10 t of 94% aluminum: raw $' + f(raw('aluminum', al)) + ', ingots $' + f(qa.value) + ' less $' + f(qa.cost) + ' = $' + f(qa.net));
check(qa.ok && qa.gain > 0.3 * raw('aluminum', al), 'aluminum ingots pay far more than aluminum scrap (+' + f(qa.gain) + ')');
check(Math.abs(qa.metalT - 10 * 0.94 * (1 - MATERIALS.aluminum.drossK) * 0.95) < 1e-9, 'paid on the metal in the bucket, less melt loss (size unknown: the size factor sets recovery)');
{   // #301: fines oxidise in the melt; oversize pieces melt whole; the purity premium (grade) is not a recovery factor
  const lo = MATERIALS.copper.range[0], hi = MATERIALS.copper.range[1];
  const ok = R.quoteBucket('copper', { t: 10, purity: 0.95, grade: 1.1, sf: 0.6, p80: hi * 10 }, 1, 0, 0.12, 1);
  const dust = R.quoteBucket('copper', { t: 10, purity: 0.95, grade: 1.1, sf: 0.15, p80: lo / 50 }, 1, 0, 0.12, 1);
  const full = 10 * 0.95 * (1 - (MATERIALS.copper.drossK || 0));
  check(Math.abs(ok.metalT - full) < 1e-9, '#301: oversize copper melts whole (' + ok.metalT.toFixed(2) + ' t)');
  check(Math.abs(dust.metalT - full * 0.15) < 1e-9 && dust.value < 0.2 * ok.value, '#301: copper dust recovers only its size factor (' + dust.metalT.toFixed(2) + ' t)');
}
check(Math.abs(qa.kwh - 10 * MATERIALS.aluminum.meltKWh / R.ETA) < 1e-9, 'energy is the melt enthalpy over the furnace efficiency');
check(!R.quoteBucket('aluminum', al, 0, 0, 0.12, 1).ok, 'without a furnace there is no REFINE');
const st = { t: 10, purity: 0.99, grade: 1.25, sf: 0.99 };
const qs = R.quoteBucket('steel', st, 1, raw('steel', st), 0.12, 1);
check(qs.ok && qs.gain > 0, 'even clean steel pays more as billet (+' + f(qs.gain) + ')');

/* #212: offtake deals x trading desk lift SELL, so they must lift the refined value too (max 1.35 x 1.10 = 1.485) */
const cu = { t: 10, purity: 0.97, grade: 1.05, sf: 1 };
const q1 = R.quoteBucket('copper', cu, 1, raw('copper', cu), 0.12, 1, 1), q2 = R.quoteBucket('copper', cu, 1, raw('copper', cu) * 1.485, 0.12, 1, 1.485);
check(Math.abs(q2.value - q1.value * 1.485) < 1e-6, 'refined value scales with the market multiplier (x1.485)');
check(q2.gain > 0 && q2.gain > q1.gain, 'copper still gains from refining at market x1.485 against a raw sale at x1.485 (+' + f(q2.gain) + ')');

/* gold: from a real line, four sensor passes on circuit boards */
const nodes = [{ m: 'hammer', s: { grate: 30, rpm: 100 }, src: 'feed' }];
for (let i = 0; i < 4; i++) nodes.push({ m: 'sensor', s: { target: 'gold' }, src: (i + 1) + ':' + (i ? 'extract' : 'product') });
const line = Sim.buildLine({ nodes }), ev = Sim.evalLine(line, FEEDS.ewaste.comp);
const gb = Sim.binStats(ev.terminals.find((t) => t.uid === line[4].uid && t.port === 'extract').stream.m);
check(gb.sellable && gb.grade <= 1, 'a gold bucket sells raw at no more than the metal: refiners pay by assay, never a premium');
const ge = { t: gb.total / 1000 * 15, purity: gb.share, grade: gb.grade, sf: 1 };
const qg = R.quoteBucket('gold', ge, 2, raw('gold', ge), 0.12, 1);
console.log('  gold from a 15 t batch of boards: ' + f(ge.t * 1e6) + ' g, raw $' + f(raw('gold', ge)) + ', bars $' + f(qg.net));
check(qg.ok && qg.gain > 0, 'refining it into bars pays more than selling it raw');
check(!R.quoteBucket('gold', ge, 1, 0, 0.12, 1).ok, 'a furnace alone cannot refine gold');

/* concentrate: one sensor pass on boards, sold by assay */
const one = Sim.buildLine({ nodes: nodes.slice(0, 2) }), ev1 = Sim.evalLine(one, FEEDS.ewaste.comp);
const cb = Sim.binStats(ev1.terminals.find((t) => t.port === 'extract').stream.m);
const misc = {}; for (const m in cb.perMat) misc[m] = { t: cb.perMat[m].mass / 1000 * 15 };
const qc = R.quoteConcentrate(misc, 2, { gold: MATERIALS.gold.ingot, silver: MATERIALS.silver.ingot });
console.log('  one sensor pass: ' + f(qc.t, 2) + ' t of concentrate at $' + f(qc.perT) + '/t of precious metal, pays $' + f(qc.net));
check(qc.ok && qc.net > 0.8 * qc.pv - qc.cost - 1, 'a rich concentrate is bought for 92% of its gold and silver, less treatment');
check(!R.quoteConcentrate(misc, 1, {}).ok, 'only the precious refinery buys concentrate');
const lean = R.quoteConcentrate({ plastic: { t: 100 }, gold: { t: 0.000001 } }, 2, { gold: MATERIALS.gold.ingot });
check(!lean.ok && /lean/i.test(lean.why), 'a lean pile is refused: concentrate it first');
check(!R.quoteConcentrate({ plastic: { t: 5 } }, 2, {}).ok, 'MISC with no gold or silver is not a concentrate');
check(R.assetValue(2) === R.LEVELS[1].cost + R.LEVELS[2].cost && R.assetValue(0) === 0, 'the refinery counts toward net worth at its cost');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' refinery checks pass');
process.exit(fails ? 1 : 0);
