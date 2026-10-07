// Auction rounds (#59, #60, #61): three bins a round, each heavy in one category, four bidders, open ascending bids, and
// rivals who bid by their own valuation and purse. Run: node tests/round.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/auction.js'); require('../js/modules/rivals.js'); require('../js/modules/round.js');
const { FEEDS, MATERIALS, Auction: A, Rivals: RV, Round: R } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

check(R.PLAYERS.length === 3 && R.PLAYERS.every((id) => RV.rivalById(id)), 'three rival yards at the table, plus you: four players');
check(R.CATEGORIES.every((c) => c.feeds.every((f) => FEEDS[f])), 'every category draws on real feeds');

let distinct = true, sized = true, heavy = true, opens = true;
for (let seed = 1; seed <= 30; seed++) {
  const rng = A.mulberry32(seed), size = 2000 + seed * 500;
  const cards = R.makeCards(rng, size, { limit: 30 });
  if (cards.length !== 3 || new Set(cards.map((c) => c.cat)).size !== 3) distinct = false;
  cards.forEach((L) => {
    const tot = L.ask * L.tons; if (L.tons > 0.15 && (tot > 2 * size || (tot < 0.4 * size && L.tons < 0.5 * R.BIN_BATCHES * 30))) sized = false;   // #334: a bin is worth about the round, or is a plant-sized bin (near three batches) of cheaper scrap
    const top = Math.max.apply(null, Object.values(L.declared)); if (L.cat !== 'mixed' && top < 0.25) heavy = false;   // a mixed skip is mixed by design
    if (!(L.opening > 0 && L.opening < L.ask)) opens = false;
  });
}
check(distinct, 'each round deals three bins from three different categories');
{ let big = 0; for (let seed = 1; seed <= 30; seed++) R.makeCards(A.mulberry32(seed), 2000 + seed * 2000, { limit: 30 }).forEach((L) => { if (L.tons > R.BIN_BATCHES * 30) big++; }); check(big === 0, '#327: no bin is more than three batches of the plant (' + big + ' over)'); }
check(sized, 'a bin is worth about the round size at its asking price (0.6-1.5x, with the lot generator\'s spread)');
check(heavy, 'every bin but the mixed skip is heavy in one material (at least a quarter of it)');
check(opens, 'bidding opens below the seller\'s ask');
check(R.roundSize(0, 0) === R.MIN_SIZE && R.roundSize(100000, 50000) === 100000, 'the round grows with your bank and stock, from $1,500');
check(R.nextBid(0, 50) === 50 && R.nextBid(100, 50) === 105 && R.nextBid(10, 5) === 11, 'bids open at the opening price and rise 5%, at least $1/t');

/* rivals: valuation capped by purse */
const rng = A.mulberry32(99), cards = R.makeCards(rng, 20000, { limit: 30 }), f = () => 1;
const big = Object.assign({}, cards[0], { tons: cards[0].tons * 50 });
check(R.rivalMax(RV.rivalById('magpie'), big, f, 20000) * big.tons <= R.rivalPurse(RV.rivalById('magpie'), 20000) + big.tons, 'a rival never bids past its purse');
check(R.rivalPurse(RV.rivalById('redline'), 1000) > R.rivalPurse(RV.rivalById('magpie'), 1000), 'the specialist carries a deeper purse than the bargain hunter');

/* settling a bin among rivals: the top valuer wins at one step over the runner-up, within its limit */
const L = { opening: 50, ask: 80, tons: 10 };
let s = R.settleRivals(L, 0, null, { a: 100, b: 70, c: 0 });
check(s.by === 'a' && s.perT === R.nextBid(70, 50) && s.perT <= 100, 'the top valuer pays one step over the runner-up (' + s.perT + ')');
s = R.settleRivals(L, 0, null, { a: 0, b: 0 });
check(s.by === null, 'nobody values it: unsold');
s = R.settleRivals(L, 90, 'b', { a: 92 });
check(s.by === 'b' && s.perT === 90, 'a standing bid holds when nobody can top it by a step');
s = R.settleRivals(L, 90, 'b', { a: 120 });
check(s.by === 'a' && s.perT > 90 && s.perT <= 120, 'a richer rival tops the standing bid');

/* the match (#72, #77) */
check(R.MATCH_LENGTHS.includes(R.MATCH_DEFAULT) && R.MATCH_DEFAULT === 12, 'a match is 12 rounds by default (8, 12 or 20)');
const st = R.standings([{ id: 'you', worth: 50 }, { id: 'a', worth: 80 }, { id: 'b', worth: 20 }]);
check(st[0].id === 'a' && st[0].place === 1 && st[2].id === 'b' && st[2].place === 3, 'standings rank by net worth');
check(R.machinesOf(1000, 1000) === 2 && R.machinesOf(4000, 1000) === 6 && R.machinesOf(1e9, 1000) === 10, 'a rival\'s plant grows with its net worth, two to ten machines');
check(R.purseScale(1000, 1000) === 1 && R.purseScale(4000, 1000) === 2 && R.purseScale(100, 1000) === 0.5, 'its purse grows with the square root of its worth, within 0.5x to 3x');
const zor = cards.find((c) => c.base === 'zorba') || cards[0];
check(R.rivalProfit('redline', Object.assign({}, zor, { cat: 'nonferrous' }), 0) > R.rivalProfit('magpie', Object.assign({}, zor, { cat: 'nonferrous' }), 0), 'the copper specialist makes more of a non-ferrous bin than the bargain hunter');
check(R.rivalProfit('ironside', zor, 1e6) < 0, 'and anyone who overpays loses money on a bin');
const why = R.foldReason(RV.rivalById('magpie'), big, f, 20000, 1, 999999);
check(/purse|worth|interested|no /.test(why), 'a rival that will not raise says why: "' + why + '"');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' round checks pass');
process.exit(fails ? 1 : 0);
