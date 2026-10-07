// #309: app.js boots before the modules when the document is already loaded (a bundled page): the save must still load and
// survive the next save, round.js must restore the whole match, and Rivals sales must not count for the Progress guide.
// Run: node tests/boot-order.js
const { mk } = require('./browser-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

{
  const e1 = mk(); e1.app.switchMode('progress'); e1.S.money = 98765; e1.S.batches = 9; e1.app.save();
  const e2 = mk({ store: e1.store, postBoot: true });
  check(e2.S.money === 98765 && e2.S.batches === 9, 'a save loads when app.js boots before saveio.js');
  e2.app.save();
  check(JSON.parse(e2.store['crunchsim.v2']).money === 98765, 'and the next save keeps it');
}
{
  const e1 = mk(); e1.app.switchMode('rivals'); e1.flush();
  const RL = e1.CS.Round.live; RL.open(); e1.clickRound('#round-start'); e1.flush();
  const st = RL.state(); st.match.length = 8; e1.app.save();
  const e2 = mk({ store: e1.store, postBoot: true }); e2.flush();
  const s2 = e2.CS.Round.live.state();
  check(e2.app.S.mode === 'rivals' && s2.n === st.n && s2.seed === st.seed && s2.match.length === 8 && s2.open && s2.open.cards.length === st.open.cards.length, 'round.js loaded after boot restores the whole match: round, seed, match and the open round');
}
{
  const e = mk(); e.app.switchMode('progress'); e.flush();
  const G = e.CS.Guide.live; G.begin(); Object.assign(G.state().done, { buy: true, bin: true, run: true, buckets: true });   // paused on SELL
  e.app.switchMode('rivals'); e.flush();
  e.app.emit('sale', {}); e.app.emit('sale', {});
  e.app.switchMode('progress'); e.flush(); e.app.emit('render'); e.flush();
  check(G.state().on && !G.state().done.sell, 'Rivals sales do not complete the paused Progress guide\'s SELL step');
}

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' boot order checks pass');
process.exit(fails ? 1 : 0);
