// The app-level wiring around pure helpers that other tests cover on their own (#263), driven through tests/app-env.js:
// wear carried over by a blueprint load (#247), a playbook load (#247) and NEXT PURCHASE's buyAndAdd (#247), and the
// pendingMs the pair checks hand to the floor veto in nextPurchases and buyAndAdd (#243). Run: node tests/wiring.js
const { load } = require('./app-env.js');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

/* capture every click handler the panels register: document.createElement hands out elements that remember theirs */
function spy(env) {
  const made = [], orig = document.createElement;
  document.createElement = (t) => { const e = orig(t); const rec = { e, click: null }; e.addEventListener = (ev, fn) => { if (ev === 'click') rec.click = fn; }; made.push(rec); return e; };
  return made;
}
const labelled = (made, re) => made.filter((r) => r.click && re.test(String(r.e.textContent)));

console.log('== a blueprint load carries wear (#247) ==');
{
  const env = load(), { CS, app, S } = env, made = spy(env);
  S.line = CS.Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] });
  S.line[0].wear = 0.9; S.line[0].autoService = true;
  app.emit('load', { blueprints: { saved: [{ id: 'b1', name: 'wear test', sig: 'x', feed: S.feedPreset, tons: 0, def: { nodes: [{ m: 'hammer', s: {}, src: 'feed' }, { m: 'jaw', s: {}, src: '1:product' }] } }] } });
  app.emit('render');
  const load1 = labelled(made, /^LOAD$/);
  check(load1.length === 1, 'the saved blueprint has a LOAD button');
  if (load1.length) {
    load1[0].click();
    const h = S.line.find((x) => x.m === 'hammer');
    check(S.line.length === 2 && h && h.wear === 0.9 && h.autoService === true, 'loading it keeps the hammermill\'s wear and AUTO flag');
  }
}

console.log('== a playbook load carries wear (#247) ==');
{
  const env = load(), { CS, app, S } = env, made = spy(env), pb = CS.Playbooks.PLAYBOOKS[0], m = pb.def.nodes[0].m;
  S.line = CS.Sim.buildLine({ nodes: [{ m, s: {}, src: 'feed' }] }); S.line[0].wear = 0.7;
  app.emit('render'); app.emit('drawerOpen', { key: 'plant' });   // the Plant drawer is open (a stashed panel skips renders, #337)
  const row = made.find((r) => r.click && typeof r.e.innerHTML === 'string' && r.e.innerHTML.indexOf(pb.short) > 0 && /urow/.test(r.e.className));   // the first card's row: clicking it opens the card, and its LOAD button
  if (row) row.click();
  const btn = labelled(made, /^LOAD THIS SETUP/).pop();
  check(!!btn, 'an open playbook card has a LOAD THIS SETUP button');
  if (btn) {
    btn.click();
    const u = S.line.find((x) => x.m === m);
    check(S.linePreset === 'custom' && u && u.wear === 0.7, 'loading it keeps the old wear on the ' + m);
  }
}

console.log('== NEXT PURCHASE buyAndAdd unshelves a spare unit (#247) ==');
{
  const env = load(), { CS, app, S } = env;
  S.money = 1e9; S.line = CS.Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] });
  S.units.jaw = 1; S.owned.add('jaw'); S.shelf.jaw = [{ wear: 0.6, autoService: true }];
  app.buyAndAdd({ ms: ['jaw'], src: { uid: S.line[0].uid, port: 'product' }, sets: [{}], gain: 5 });
  const j = S.line.find((x) => x.m === 'jaw');
  check(!!j && j.wear === 0.6 && j.autoService === true, 'the spare jaw crusher comes back with its old wear');
  check(!S.shelf.jaw || S.shelf.jaw.length === 0, 'and leaves the shelf');
}

console.log('== the pair checks pass pendingMs to the floor veto (#243) ==');
{
  const env = load(), { CS, app, S } = env;
  S.money = 1e9; S.line = CS.Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] });
  const calls = []; app.on('veto:addMachine', (p) => { calls.push(p); });
  app.buyAndAdd({ ms: ['jaw', 'cone'], src: { uid: S.line[0].uid, port: 'product' }, port2: 'extract', sets: [{}, {}], gain: 5 });
  check(calls.length >= 2 && calls[1].m === 'cone' && calls[1].pendingMs && calls[1].pendingMs.join() === 'jaw', 'buyAndAdd asks about the second sorter with the first as pending');
  check(!calls[0].pendingMs || calls[0].pendingMs.length === 0, 'and about the first with nothing pending');

  const e2 = load(), a2 = e2.app, S2 = e2.S;
  S2.line = e2.CS.Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] });
  const c1 = []; a2.on('veto:addMachine', (p) => { c1.push(p); });
  a2.nextPurchases();
  const K = c1.length;   // the single-sorter pass asks about every trial machine once; veto those so the pair pass runs
  const e3 = load(), a3 = e3.app; e3.S.line = e3.CS.Sim.buildLine({ nodes: [{ m: 'hammer', s: {}, src: 'feed' }] });
  const c2 = []; a3.on('veto:addMachine', (p) => { c2.push(p); if (c2.length <= K && !(p.pendingMs && p.pendingMs.length)) return 'no'; });
  a3.nextPurchases();
  check(c1.every((p) => !p.pendingMs) && K > 0, 'precondition: the single pass sends no pendingMs (' + K + ' calls)');
  check(c2.some((p) => p.pendingMs && p.pendingMs.length === 1 && p.pending === 1), 'nextPurchases\' pair trial asks about the second sorter with the first as pending (' + c2.length + ' calls)');
}

console.log('\n' + (fails ? fails + ' of ' + n + ' checks FAILED' : 'all ' + n + ' wiring checks pass'));
process.exit(fails ? 1 : 0);
