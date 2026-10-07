// Rivals mode balance (#83): seeded 12-round matches against the three rival yards, played by three strategies.
//  fair   bids up to what its own plant would make of the bin (the full sorted value x its yield, less processing)
//  always outbids everyone up to 1.5x the bin's full sorted value (in an open auction it pays a step over the runner-up)
//  pass   never bids, and runs its MISC every round
// The rivals must neither overpay nor roll over: the fair bidder wins a real share of the bins and finishes in contention,
// the over-bidder earns far less, the passer falls behind. Run: node tests/rivals-match.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/auction.js'); require('../js/modules/rivals.js'); require('../js/modules/round.js');
const { Auction: A, Rivals: RV, Round: R } = globalThis.CS;
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const f = (x, d = 0) => x.toFixed(d);

const START = 12000;            // net worth at the start: $2,800 in the bank plus the hammermill and magnetic drum
const YOU_YIELD = 0.5;          // what a young plant (a grinder and a few sorters) recovers of a bin's full sorted value
const factor = () => 1;
function auction(L, maxes) {   // English auction outcome among the players still in: top valuer pays one step over the runner-up
  const ids = Object.keys(maxes).filter((id) => maxes[id] >= L.opening).sort((a, b) => maxes[b] - maxes[a]);
  if (!ids.length) return null;
  const second = ids[1] ? maxes[ids[1]] : 0;
  return { by: ids[0], perT: Math.min(maxes[ids[0]], second > 0 ? R.nextBid(second, L.opening) : L.opening) };
}
function match(seed, strategy, rounds) {
  const rng = A.mulberry32(seed), worth = { you: START }, bins = { you: 0 };
  R.PLAYERS.forEach((id) => { worth[id] = START; bins[id] = 0; });
  for (let n = 1; n <= rounds; n++) {
    const cards = R.makeCards(rng, R.roundSize(worth.you * 0.4, 0), { limit: 30 }), size = R.dealtSize(cards);   // #334: the round is what its bins are worth
    const won = {};
    cards.forEach((L) => {
      const mx = {};
      R.PLAYERS.forEach((id) => { if (!won[id]) mx[id] = R.rivalMax(RV.rivalById(id), L, factor, size, R.purseScale(worth[id], START)); });
      if (!won.you) {
        const full = R.fullValue(Object.assign({}, L, { truth: L.declared }));   // you see the declaration, not the truth
        const cash = Math.max(0, worth.you * 0.5) / Math.max(L.tons, 0.01);
        mx.you = strategy === 'pass' ? 0 : Math.min(cash, Math.floor(strategy === 'always' ? 1.5 * full : full * (YOU_YIELD - R.PROCESS)));
      }
      const res = auction(L, mx); if (!res) return;
      won[res.by] = true; bins[res.by]++;
      const v = R.fullValue(L) * L.tons;
      worth[res.by] += res.by === 'you' ? v * (YOU_YIELD - R.PROCESS) - res.perT * L.tons : R.rivalProfit(res.by, L, res.perT);
    });
    R.PLAYERS.forEach((id) => { if (!won[id]) worth[id] += R.MISC_RUN * size; });
  }
  const order = Object.keys(worth).sort((a, b) => worth[b] - worth[a]);
  return { worth, bins, place: order.indexOf('you') + 1, leader: worth[order[0]] };
}
function play(strategy, rounds) {
  let place = 0, share = 0, gain = 0, close = 0; const N = 40;
  for (let s = 1; s <= N; s++) {
    const m = match(1000 + s, strategy, rounds);
    const all = Object.values(m.bins).reduce((a, b) => a + b, 0) || 1;
    place += m.place; share += m.bins.you / all; gain += m.worth.you - START; if (m.worth.you >= 0.75 * m.leader) close++;
  }
  return { place: place / N, share: share / N, gain: gain / N, close: close / N };
}

const fair = play('fair', 12), always = play('always', 12), pass = play('pass', 12);
console.log('  strategy   avg place   bins won   avg gain     within 25% of the leader');
[['fair', fair], ['always', always], ['pass', pass]].forEach(([n, r]) => console.log('  ' + n.padEnd(9) + f(r.place, 2).padStart(9) + (f(r.share * 100) + '%').padStart(11) + ('$' + f(r.gain)).padStart(12) + (f(r.close * 100) + '%').padStart(12)));
check(fair.share >= 0.15 && fair.share <= 0.5, 'a fair bidder wins a real share of the bins, not all of them (' + f(fair.share * 100) + '%)');
// #334: rounds are sized to the plant (bins of at most three batches), so a rich round deals smaller bins: in contention in 2 of 5
check(fair.close >= 0.4 && fair.place <= 2.6, 'and finishes in contention: within 25% of the leader in 2 of 5 matches or more, average place ' + f(fair.place, 2));
// in an open auction the winner pays a step over the runner-up, so outbidding everyone does not go broke: it buys the bins the
// rivals would have overpaid for and earns far less than bidding to fair value
check(always.gain < 0.6 * fair.gain && always.place > fair.place, 'outbidding everyone earns far less than bidding to fair value ($' + f(always.gain) + ' against $' + f(fair.gain) + ')');
check(pass.place > fair.place && pass.place >= 3, 'passing every round falls behind (average place ' + f(pass.place, 2) + ')');
// the rivals are not charities either: their own results stay sane
let rivalGain = 0, overpay = 0, n = 0;
for (let s = 1; s <= 40; s++) { const m = match(2000 + s, 'pass', 12); R.PLAYERS.forEach((id) => { rivalGain += m.worth[id] - START; if (m.worth[id] < START * 0.8) overpay++; n++; }); }
check(rivalGain / n > 0, 'rival yards make money over a match on average ($' + f(rivalGain / n) + ')');
check(overpay / n < 0.15, 'and rarely lose a fifth of their worth by overpaying (' + f(overpay / n * 100) + '% of yards)');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nrivals match balance within targets');
process.exit(fails ? 1 : 0);
