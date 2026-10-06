// Net worth counts unsold stock (#214, net-worth item of #219): app.netWorth() includes held lots at their SELL quote and MISC at
// its dump quote (never below zero), through the inventory module's 'assetValue' hook. Selling leaves worth unchanged, and the
// Rivals standings (js/modules/round.js) no longer add the stock a second time.
// Run: node tests/networth-stock.js
const fs = require('fs'), path = require('path');
const { load } = require('./app-env.js');
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

function game() {
  const env = load(), { CS, app, S } = env, A = CS.Auction.live;
  const lot = A.dealTier(0, 'elv'); A.deliver(lot, lot.ask, 'Bought');
  S.speed = 10; S.money = 1e6;
  return { env, CS, app, S };
}
const heldQuote = (I) => { let v = 0; for (const m in I.stock()) v += I.quote(m); return v; };

console.log('== a batch that goes to stock raises net worth ==');
{
  const { env, CS, app, S } = game(), I = CS.Inventory;
  check(heldQuote(I) === 0 && I.dumpQuote().t === 0, 'a fresh yard holds nothing');
  app.startRun();
  let k = 0;
  while (S.run && k++ < 5000) env.tick(0.1);
  check(S.run === null && heldQuote(I) > 0, 'the batch ended with stock held (quote ' + heldQuote(I).toFixed(0) + ')');
  const held = heldQuote(I), nw = app.netWorth();
  // hold the MISC fixed and take the stock lots away without selling: the difference is exactly the lots' SELL quotes
  const mats = Object.keys(I.stock());
  mats.forEach((m) => I.withdraw(m, 1e9));
  const nwNoStock = app.netWorth();
  check(near(nw - nwNoStock, held, 1e-6 * Math.max(1, held)), 'worth with stock exceeds worth without by the lots\' SELL quotes (' + (nw - nwNoStock).toFixed(0) + ' vs ' + held.toFixed(0) + ')');
}

console.log('== selling the stock leaves net worth unchanged ==');
{
  const { env, CS, app, S } = game(), I = CS.Inventory;
  app.startRun(); let k = 0; while (S.run && k++ < 5000) env.tick(0.1);
  const before = app.netWorth(), bank0 = S.money, held = heldQuote(I);
  Object.keys(I.stock()).forEach((m) => I.sellMat(m));
  check(heldQuote(I) === 0, 'all lots sold');
  check(near(S.money - bank0, held, 1e-6 * Math.max(1, held)), 'the bank rose by the quotes (' + (S.money - bank0).toFixed(0) + ')');
  check(near(app.netWorth(), before, 1e-6 * Math.max(1, held)), 'net worth is unchanged by selling at the quote (' + before.toFixed(2) + ' -> ' + app.netWorth().toFixed(2) + ')');
}

console.log('== MISC counts at its dump quote, never below zero ==');
{
  const { CS, app, S } = game(), I = CS.Inventory;
  const w0 = app.netWorth();
  I.misc().steel = { t: 10, p80: 20 };   // metal pays ~20% of its value: a positive dump quote
  const dq = I.dumpQuote();
  check(dq.net > 0 && near(app.netWorth() - w0, dq.net, 1e-6), 'a metal pile adds its dump quote (' + dq.net.toFixed(0) + ')');
  const w1 = app.netWorth(), bank = S.money;
  I.dumpMisc();
  check(near(app.netWorth(), w1, 1e-6) && near(S.money - bank, dq.net, 1e-6), 'shipping it out at the quote leaves worth unchanged');
  I.misc().plastic = { t: 10, p80: 20 };   // landfill fee only: net is negative
  const dn = I.dumpQuote(), w2 = app.netWorth();
  check(dn.net < 0 && near(w2, w1, 1e-6), 'a pile that costs money to ship adds nothing (quote ' + dn.net.toFixed(0) + ')');
  I.dumpMisc();
  check(near(app.netWorth() - w2, dn.net, 1e-6), 'paying the gate fee lowers worth by the fee: the pile was valued at zero, so the cost shows up when it is shipped');
}

console.log('== Rivals does not double count ==');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'round.js'), 'utf8');
  check(!/netWorth\(\)\s*\+\s*stockValue\(\)/.test(src), 'round.js adds no stockValue() on top of app.netWorth() for your worth');
  check(/blank = \(\) => \(\{ worth: app\.netWorth\(\)/.test(src) && /m\.start = app\.netWorth\(\);/.test(src) && /'you' \? app\.netWorth\(\)/.test(src), 'start, blank record, final and live worth all read app.netWorth() alone');
  const { CS, app } = game(), I = CS.Inventory;
  I.stock().copper = { t: 5, purity: 1, grade: 1, sf: 1, p80: 20, cost: 0 };
  const q = I.quote('copper'), w = app.netWorth(); delete I.stock().copper;
  check(q > 0 && near(w - app.netWorth(), q, 1e-6), 'stock enters net worth exactly once (' + q.toFixed(0) + ')');
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
