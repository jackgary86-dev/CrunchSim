// Net worth counts lots paid for but not yet run (#253): app.netWorth() includes the loaded lot and the yard at the cost paid for
// the tonnes still unprocessed, through the auction module's 'assetValue' hook, so buying a lot leaves net worth (and the rank that
// gates panels) where it was. Rivals standings read app.netWorth() alone, so the bin is not counted twice.
// Run: node tests/networth-lots.js
const { load } = require('./app-env.js');
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
const rank = (CS, app) => CS.RANKS.reduce((i, r, k) => (app.netWorth() >= r[0] ? k : i), 0);

function game() {
  const env = load(), { CS, app, S } = env, A = CS.Auction.live;
  A.dealTier(0, 'elv');   // clear the guided lot out of the way
  return { env, CS, app, S, A };
}

console.log('== delivering a lot leaves net worth and rank unchanged ==');
{
  const { CS, app, S, A } = game();
  S.money = 120100 - app.netWorth() + S.money;   // net worth is exactly $120,100: rank 1
  check(near(app.netWorth(), 120100, 1e-6) && rank(CS, app) === 1, 'net worth $120,100 is rank 1');
  const lot = A.dealTier(0, 'elv'), nw0 = app.netWorth(), cost = lot.ask * lot.tons;
  check(A.deliver(lot, lot.ask, 'Bought'), 'the lot is delivered');
  check(near(app.netWorth(), nw0, 1e-6 * cost), 'net worth is unchanged by the purchase (' + nw0.toFixed(2) + ' -> ' + app.netWorth().toFixed(2) + ', lot cost ' + cost.toFixed(0) + ')');
  check(rank(CS, app) === 1, 'rank stays 1');
  const big = A.dealTier(3, 'elv'), nw1 = app.netWorth();   // a second, dearer lot waits in the yard
  A.deliver(big, big.ask, 'Bought');
  check(near(app.netWorth(), nw1, 1e-6 * big.ask * big.tons) && rank(CS, app) === 1, 'a lot queued in the yard counts too (worth ' + app.netWorth().toFixed(0) + ')');
}

console.log('== a batch moves the lot into stock without a drop ==');
{
  const { env, CS, app, S, A } = game();
  const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  S.speed = 10; const nw0 = app.netWorth(), tons0 = A.pending().tons;
  app.startRun(); let k = 0; while (S.run && k++ < 5000) env.tick(0.1);
  check(A.pending() == null || A.pending().tons < tons0, 'the batch used tonnes from the lot');
  const left = (A.pending() ? A.pending().ask * A.pending().tons : 0);
  check(left < lot.ask * tons0, 'the unprocessed part of the lot is valued at cost for what remains (' + left.toFixed(0) + ')');
  check(app.netWorth() > nw0 - 0.5 * lot.ask * tons0, 'net worth after processing stays near its starting level (' + nw0.toFixed(0) + ' -> ' + app.netWorth().toFixed(0) + ')');
}

console.log('== Rivals reads net worth alone ==');
{
  const { CS, app, S, A } = game();
  S.mode = 'rivals'; const w0 = app.netWorth();
  const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Won at auction round 1:', 5000);
  check(near(app.netWorth(), w0, 1e-6 * lot.ask * lot.tons) , 'winning a bin at its price does not lower your standing (' + w0.toFixed(0) + ' -> ' + app.netWorth().toFixed(0) + ')');
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
