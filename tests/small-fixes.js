// Small fixes from #264. Run: node tests/small-fixes.js
//  save on pagehide / hidden tab; RANK UP fires once per climb past a threshold (high-water mark); a Rivals match left in
//  'ending' finishes on load; the cryogenic mill buys no LN2 for input a freezer already cooled; the phone header keeps the
//  Rivals place readout.
const fs = require('fs'), path = require('path');
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== saves when the page is hidden ==');
{
  const env = load(), { CS, app } = env, g = globalThis;
  let saves = 0; const key = app.saveKeys().progress, set = g.localStorage.setItem;
  g.localStorage.setItem = (k, v) => { if (k === key) saves++; set(k, v); };
  check((env.winListeners.pagehide || []).length > 0, 'a pagehide listener is registered');
  const before = saves; (env.winListeners.pagehide || []).forEach((f) => f());
  check(saves > before, 'pagehide saves');
  const v0 = saves; g.document.hidden = true; (env.docListeners.visibilitychange || []).forEach((f) => f());
  check(saves > v0, 'a tab turning hidden saves');
  const v1 = saves; g.document.hidden = false; (env.docListeners.visibilitychange || []).forEach((f) => f());
  check(saves === v1, 'a tab turning visible does not');
}

console.log('== RANK UP is a high-water mark ==');
{
  const env = load(), { CS, app, S } = env, ranks = [];
  const ui = CS.Audio.ui; CS.Audio.ui = function (k) { if (k === 'done') ranks.push(k); return ui.apply(this, arguments); };
  const at = (target) => { S.money += target - app.netWorth(); app.checkRank(); };
  at(130000); check(ranks.length === 1, 'crossing $120k announces RANK UP once');
  at(100000); at(130000); check(ranks.length === 1, 'dipping below and climbing back does not announce it again');
  at(600000); check(ranks.length === 2, 'a real new rank still does');
}

console.log('== a match left ending is finished on load ==');
{
  const env = load(), { CS, app } = env, g = globalThis, timers = [];
  g.setTimeout = (f) => { timers.push(f); return 0; };
  const RL = CS.Round.live, m = RL.state().match;
  app.emit('load', { round: { n: m.length, match: Object.assign({}, m, { ending: true, over: false }) } });
  timers.splice(0).forEach((f) => f());
  check(RL.state().match.over === true && !RL.state().match.ending, 'the match is over after load when the yard is empty and nothing runs');
}

console.log('== cryo mill LN2 on pre-frozen input ==');
{
  const { Sim, MATERIALS, MACHINES } = globalThis.CS;
  const mat = Object.keys(MATERIALS).find((id) => MATERIALS[id].coolKJ > 0 && id !== 'water');
  const ln2 = (temp) => { const st = Sim.makeFeed({ [mat]: 1 }); st.temp = temp;
    const node = { uid: 1, m: 'cryo', settings: Object.assign({}, MACHINES.cryo.defaults), wear: 0, src: 'feed' };
    return Sim.procNode(node, st).info; };
  const warm = ln2(0), cold = ln2(1);
  check(warm.ln2PerHeadT > 0, 'ambient input is charged for liquid nitrogen (' + warm.ln2PerHeadT.toFixed(2) + ' kg per head-tonne of ' + mat + ')');
  check(cold.ln2PerHeadT === 0 && cold.extraCostPerHeadT === 0, 'input a freezer already cooled is not');
}

console.log('== phone header keeps the Rivals place ==');
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const rule = css.split('\n').find((l) => /#top \.tele:has\(#rank\)/.test(l)) || '';
  check(/body:not\(\.mode-rivals\)/.test(rule), 'the small-screen rule hides the rank readout only outside Rivals');
}
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' checks pass');
process.exit(fails ? 1 : 0);
