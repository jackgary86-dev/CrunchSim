// One process at a time (#411): the choices for the next sorter and for the grinder type, and swapping a grinder.
// Run: node tests/scenes.js
const { mk } = require('./browser-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

const env = mk(); globalThis.__fakeStash = true;
const { CS, app, S } = env, A = CS.Auction.live, M = CS.MACHINES;
const L = A.board().filter((l) => A.priceOf(l) * l.tons <= S.money).sort((a, b) => b.tons - a.tons)[0];
A.deliver(L, A.priceOf(L), 'test'); A.load(L.id); app.renderAll(); env.flush();

console.log('== the next sorter ==');
{
  const p = app.pickOptions();
  check(Array.isArray(p) && p.length >= 4, 'every sorter is offered (' + (p ? p.length : 0) + ')');
  check(p.every((o, k) => k === 0 || o.why || p[k - 1].why || p[k - 1].gain >= o.gain), 'ranked by what each adds per tonne');
  check(p.every((o) => o.price === (o.spare ? 0 : M[o.ms[0]].price)), 'a spare unit is free, otherwise the machine\'s price');
  const best = p.find((o) => o.src && !o.why && o.gain > 0.5);
  check(!!best && best.pulls && M[best.ms[0]] && CS.MATERIALS[best.pulls.m], 'the best pick says what it pulls out (' + (best ? best.ms[0] + ' pulls ' + best.pulls.m + ' ' + Math.round(best.pulls.share * 100) + '%' : 'none') + ')');
  check(app.pickOptions() === p, 'the ranking is kept until the line, feed, units or bank change');
  S.money = 1e6; const n0 = S.line.length; app.buyAndAdd(best);
  check(S.line.length === n0 + 1 && S.line[n0].m === best.ms[0] && S.line[n0].src.uid === best.src.uid && S.line[n0].src.port === best.src.port, 'placing it adds that sorter where it was ranked');
}

console.log('== the grinder type ==');
{
  const g0 = S.line[0], kids = S.line.filter((x) => x.src && x.src !== 'feed' && x.src.uid === g0.uid).length;
  const g = app.grinderOptions(g0.uid);
  check(Array.isArray(g) && g.some((o) => o.current && o.m === g0.m && o.gain === 0), 'the grinder on the line is listed, at +0');
  check(g.every((o, k) => k === 0 || g[k - 1].gain >= o.gain), 'the others ranked by what they add per tonne');
  check(app.grinderOptions(S.line[1].uid) === null, 'a sorter has no grinder choice');
  const alt = g.find((o) => !o.current), money0 = S.money, units0 = S.units[g0.m];
  check(app.swapGrinder(g0.uid, alt.m), 'swapping to the ' + M[alt.m].name + ' is done');
  const g1 = S.line[0];
  check(g1.m === alt.m && g1.uid !== g0.uid && S.line.filter((x) => x.src && x.src !== 'feed' && x.src.uid === g1.uid).length === kids, 'the new grinder takes its place and feeds the same stations');
  check(near(money0 - S.money, alt.price) && S.units[g0.m] === units0, 'it is bought at its price and the old grinder is still owned');
  check(app.swapGrinder(g1.uid, g0.m) && S.line[0].m === g0.m && near(money0 - S.money, alt.price), 'swapping back uses the owned unit, for free');
  app.startRun();
  check(!!S.run && !app.swapGrinder(S.line[0].uid, alt.m) && S.line[0].m === g0.m, 'no swap while a batch runs');
}
function near(a, b) { return Math.abs(a - b) < 1e-6; }

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' scene checks pass'));
process.exit(fails ? 1 : 0);
