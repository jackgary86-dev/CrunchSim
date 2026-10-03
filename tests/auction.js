// Scrap auction checks: lots are well-formed, deal classes land in the intended proportions, declarations stay within
// sane bounds of the truth, the board and the feed market behave, and a seed reproduces the same lots.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/auction.js');
const { MATERIALS, FEEDS, Auction: A } = globalThis.CS;
const f = (x, d = 3) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log('  !! ' + msg); } }

const FEEDS_ALL = ['elv', 'pallets', 'quarry', 'tires', 'zorba', 'rubble'];
const N = 400, SEED = 20240613;
function makeLots(seed) {
  const rng = A.mulberry32(seed), lots = [];
  for (let i = 0; i < N; i++) lots.push(A.genLot(rng, { feeds: FEEDS_ALL, limit: 30, clockH: 100, market: { elv: 1.1 }, id: 1001 + i }));
  return lots;
}
const lots = makeLots(SEED);

// 1. fractions sum to 1, every key is a material, prices and tonnages are sane
console.log('=== lot shape (' + N + ' lots)');
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
lots.forEach((L) => {
  check(Math.abs(sum(L.truth) - 1) < 1e-9, 'truth of lot ' + L.id + ' sums to ' + sum(L.truth));
  check(Math.abs(sum(L.declared) - 1) < 1e-9, 'declared of lot ' + L.id + ' sums to ' + sum(L.declared));
  check(Object.keys(L.truth).every((m) => MATERIALS[m] && L.truth[m] > 0), 'truth of lot ' + L.id + ' has a bad material');
  check(Object.keys(L.declared).every((m) => MATERIALS[m] && L.declared[m] > 0), 'declared of lot ' + L.id + ' has a bad material');
  check(FEEDS[L.base] && FEEDS_ALL.includes(L.base), 'lot ' + L.id + ' base ' + L.base);
  check(L.tons >= 1 && L.tons <= 36 && L.tons === Math.round(L.tons), 'lot ' + L.id + ' tons ' + L.tons);
  check(L.ask >= 1 && isFinite(L.ask) && L.ask === Math.round(L.ask), 'lot ' + L.id + ' ask ' + L.ask);
  check(L.expiresH > 100 && L.expiresH <= 148, 'lot ' + L.id + ' expires ' + L.expiresH);
  check(typeof L.note === 'string' && L.note.length > 10 && typeof L.seller === 'string', 'lot ' + L.id + ' note/seller');
});
console.log('  ok: fractions normalised, materials valid, tons 1-36, ask >= $1/t, timers 6-48 h');

// 2. deal classes in roughly the intended proportions
console.log('=== deal classes');
const cnt = { great: 0, fair: 0, terrible: 0 }; lots.forEach((L) => cnt[L.cls]++);
for (const k in cnt) {
  const share = cnt[k] / N, want = A.DEAL[k];
  console.log('  ' + k.padEnd(9) + cnt[k].toString().padStart(4) + '  ' + f(share, 2) + '  (intended ' + want + ')');
  check(Math.abs(share - want) <= 0.07, k + ' share ' + f(share, 2) + ' is off the intended ' + want);
}
// and the prices mean what the class says, relative to worth (0.6 x product prices) and the going yard rate
lots.forEach((L) => {
  // asks are rounded to whole dollars, so allow $1 either way (matters for $5/t rock)
  const worth = A.worthOf(L.truth), fr = A.fairRatio(L.base), mk = L.base === 'elv' ? 1.1 : 1, rate = worth * fr * mk, r = L.ask / rate;
  if (L.cls === 'great') check(L.ask <= rate * A.MULT.great[1] + 1, 'great lot ' + L.id + ' asks ' + f(r, 2) + 'x the yard rate');
  if (L.cls === 'fair') check(L.ask >= rate * A.MULT.fair[0] - 1 && L.ask <= rate * A.MULT.fair[1] + 1, 'fair lot ' + L.id + ' asks ' + f(r, 2) + 'x the yard rate');
  if (L.cls === 'terrible') check(L.padded ? L.ask >= rate * A.MULT.fair[0] - 1 : L.ask >= worth * A.MULT.terrible[0] * mk - 1, 'terrible lot ' + L.id + ' is cheap: ' + L.ask + ' vs worth ' + f(worth, 0));
  if (L.padded) check(L.truth[L.tramp] >= 0.2 && L.declared[L.tramp] < L.truth[L.tramp] && A.worthOf(L.declared) > worth, 'padded lot ' + L.id + ' is not padded, not hidden, or the pad did not dilute it');
});
const padded = lots.filter((L) => L.padded).length, trampy = lots.filter((L) => L.tramp).length;
console.log('  padded ' + padded + ', with tramp ' + trampy + '; terrible notes carry a tell: ' + lots.filter((L) => L.cls === 'terrible').every((L) => /sold as seen|previous lot|no returns|declines|not deducted|old tip|dunnage|not screened/i.test(L.note)));
check(lots.filter((L) => L.cls === 'terrible').every((L) => /sold as seen|previous lot|no returns|declines|not deducted|old tip|dunnage|not screened/i.test(L.note)), 'a terrible lot has no tell in its note');
check(padded > 0.08 * N && padded < 0.18 * N, 'padded share ' + padded / N);

// 3. declared composition within sane bounds of the truth
console.log('=== declaration vs truth');
let maxAbsHonest = 0, maxAbsAll = 0, maxL1 = 0, biasUp = 0;
lots.forEach((L) => {
  let l1 = 0, worst = 0;
  for (const m of new Set(Object.keys(L.truth).concat(Object.keys(L.declared)))) { const d = Math.abs((L.declared[m] || 0) - (L.truth[m] || 0)); l1 += d; worst = Math.max(worst, d); }
  maxL1 = Math.max(maxL1, l1); maxAbsAll = Math.max(maxAbsAll, worst);
  if (!L.padded) maxAbsHonest = Math.max(maxAbsHonest, worst);
  if (A.worthOf(L.declared) >= A.worthOf(L.truth)) biasUp++;
  check(worst <= 0.4, 'lot ' + L.id + ' (' + L.cls + (L.padded ? ', padded' : '') + ') declared differs by ' + f(worst, 2) + ' on one material');
  check(l1 <= 0.8, 'lot ' + L.id + ' declared L1 distance ' + f(l1, 2));
  if (!L.padded) check(worst <= 0.2, 'unpadded lot ' + L.id + ' declared differs by ' + f(worst, 2) + ' on one material');
  check(Object.keys(L.truth).every((m) => L.declared[m] > 0), 'lot ' + L.id + ' leaves a true material out of the declaration');
});
console.log('  max per-material gap: unpadded ' + f(maxAbsHonest) + ', all ' + f(maxAbsAll) + '; max L1 ' + f(maxL1) + '; declared worth >= true worth in ' + biasUp + '/' + N);
check(biasUp > N * 0.6, 'sellers should mostly talk a lot up (' + biasUp + '/' + N + ')');

// 4. determinism: same seed, same lots; different seed, different lots
console.log('=== reproducibility');
check(JSON.stringify(makeLots(SEED)) === JSON.stringify(lots), 'same seed gave different lots');
check(JSON.stringify(makeLots(SEED + 1)) !== JSON.stringify(lots), 'different seed gave the same lots');
console.log('  ok: seed ' + SEED + ' reproduces the board');

// 5. board upkeep over a long run keeps 3 to 6 lots and expires old ones
console.log('=== board upkeep');
const rng = A.mulberry32(7), st = { board: [], nextId: 1 }, opts = { feeds: FEEDS_ALL, limit: 60, market: {} };
A.tickBoard(st, rng, 0, 0, opts);
check(st.board.length >= A.BOARD.min && st.board.length <= A.BOARD.max, 'initial board has ' + st.board.length + ' lots');
let minN = 99, maxN = 0, arrivals = 0, h = 0;
for (let i = 0; i < 2000; i++) { const before = st.nextId; h += 0.25; A.tickBoard(st, rng, h, 0.25, opts); arrivals += st.nextId - before; minN = Math.min(minN, st.board.length); maxN = Math.max(maxN, st.board.length); st.board.forEach((L) => check(L.expiresH > h, 'expired lot left on the board')); }
console.log('  over 500 sim hours: ' + arrivals + ' lots came and went, board size ' + minN + '..' + maxN);
check(minN >= A.BOARD.min && maxN <= A.BOARD.max, 'board size out of range');
check(arrivals > 60 && arrivals < 200, 'arrival rate ' + arrivals + ' per 500 h looks wrong (about one per 6 h plus refills)');

// 6. feed market stays pinned to 0.8-1.3 and actually moves
console.log('=== feed market');
const market = A.marketStep({}, rng, 0, FEEDS_ALL);
check(FEEDS_ALL.every((id) => market[id] === 1), 'market should start at 1.0');
let lo = 1, hi = 1;
for (let i = 0; i < 4000; i++) { A.marketStep(market, rng, 0.5, FEEDS_ALL); FEEDS_ALL.forEach((id) => { lo = Math.min(lo, market[id]); hi = Math.max(hi, market[id]); }); }
console.log('  over 2000 sim hours factors ranged ' + f(lo, 2) + '..' + f(hi, 2));
check(lo >= A.MARKET.lo && hi <= A.MARKET.hi, 'market factor escaped its band');
check(lo < 0.95 && hi > 1.05, 'market factor barely moves');

// 7. a market factor scales the ask
const r1 = A.mulberry32(99), r2 = A.mulberry32(99);
const a = A.genLot(r1, { feeds: ['elv'], limit: 30, market: {} }), b = A.genLot(r2, { feeds: ['elv'], limit: 30, market: { elv: 1.25 } });
check(Math.abs(b.ask - Math.round(a.ask * 1.25)) <= 1, 'market factor did not scale the ask: ' + a.ask + ' vs ' + b.ask);

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nauction checks pass');
process.exit(fails ? 1 : 0);
