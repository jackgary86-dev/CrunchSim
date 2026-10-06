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
    const tot = L.ask * L.tons; if (L.tons > 0.15 && L.tons < 3999 && (tot < 0.4 * size || tot > 2 * size)) sized = false;
    const top = Math.max.apply(null, Object.values(L.declared)); if (L.cat !== 'mixed' && top < 0.25) heavy = false;   // a mixed skip is mixed by design
    if (!(L.opening > 0 && L.opening < L.ask)) opens = false;
  });
}
check(distinct, 'each round deals three bins from three different categories');
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

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' round checks pass');
process.exit(fails ? 1 : 0);
