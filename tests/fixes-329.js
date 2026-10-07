// Fixes #329-#334. Run: node tests/fixes-329.js
//  hotkeys at a station (#329), keepFocus on a stable data-focus-key (#330), the hall/slot advice asks the floor and slot rules
//  directly and only when the upgrade lets a paying sorter in (#331), a rewire redraws the process line (#332), the
//  Omniprocessor is a station on the process line (#333), a Rivals bin that fits no feed takes the richest one (#334).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

console.log('== #329 Space / 1 2 3 / M / ? act at a station ==');
{
  require('../js/data.js');
  const sel = read('js/data.js').match(/const HOTKEY_MODAL = '([^']+)'/)[1];
  check(!/#station:not\(\.hidden\)/.test(sel) && /:not\(#station\)/.test(sel), 'HOTKEY_MODAL leaves an open station out');
  check(/^\.modal \{[^}]*z-index: 80/m.test(read('css/style.css')), 'help (a .modal) still draws above the station');
}

console.log('== #330 keepFocus matches on data-focus-key, never by index ==');
{
  const { load } = require('./app-env.js');
  const env = load(), { app } = env, g = globalThis;
  let gen = 0;
  const mkEl = (tag, type, key, text) => ({ tagName: tag, type, gen, textContent: text || '', disabled: false, dataset: { focusKey: key }, focus() { g.document.activeElement = this; } });
  const box = { kids: [], contains(a) { return this.kids.includes(a); }, querySelectorAll() { return this.kids; }, addEventListener() {} };
  let mats = ['steel', 'aluminum', 'copper'];
  const build = () => { gen++; box.kids = []; mats.forEach((m) => box.kids.push(mkEl('INPUT', 'number', 'target:' + m), mkEl('INPUT', 'checkbox', 'auto:' + m), mkEl('BUTTON', 'button', 'sell:' + m, 'SELL $' + gen))); };
  build();
  g.document.activeElement = box.kids.find((k) => k.dataset.focusKey === 'auto:copper'); app.keepFocus(box, build);
  check(g.document.activeElement.dataset.focusKey === 'auto:copper' && g.document.activeElement.gen === gen, 'a focused AUTO-SELL checkbox gets focus back on its own row');
  g.document.activeElement = box.kids.find((k) => k.dataset.focusKey === 'sell:aluminum'); app.keepFocus(box, build);
  check(g.document.activeElement.dataset.focusKey === 'sell:aluminum' && g.document.activeElement.gen === gen, 'a SELL button whose price text changed is found again by its key');
  const sold = box.kids.find((k) => k.dataset.focusKey === 'sell:aluminum'); g.document.activeElement = sold; mats = ['steel', 'copper']; app.keepFocus(box, build);
  check(g.document.activeElement === sold, 'the sold row is gone: focus is not handed to the next row\'s SELL');
  const inv = read('js/modules/inventory.js'), appSrc = read('js/app.js');
  check(/focusKey = 'sell:' \+ mat/.test(inv) && /focusKey = 'auto:' \+ mat/.test(inv) && /focusKey = 'plant:' \+ key/.test(appSrc) && /focusKey = 'buy:'/.test(appSrc) && /focusKey = 'slot-buy'/.test(read('js/modules/slots.js')) && /focusKey = 'refinery:'/.test(read('js/modules/refinery.js')), 'the Sell rows, plant upgrades, NEXT PURCHASE, sorter slots and refinery rows carry a key');
}

const { mk } = require('./browser-env.js');
console.log('== #331 the hall is advised only when it lets a paying sorter in ==');
{
  const env = mk(), { CS, app, S } = env, Sim = CS.Sim, SL = CS.Slots.live;
  S.money = 5e6; while (SL.next()) SL.buy();
  const sorters = ['eddy', 'air', 'screen', 'sinkfloat', 'sensor', 'eddy', 'air', 'screen', 'sinkfloat'];
  for (const m of sorters) { app.buyMachine(m); const last = S.line[S.line.length - 1]; S.line.push(Sim.makeNode(m, {}, { uid: last.uid, port: last.m === 'hammer' ? 'product' : 'residue' })); }
  S.plant.room = 3; app.recompute(); S.money = 5e6; app.nextPurchases = () => [];
  const st = app.layout.nextStep();
  check(!/HALL|SLOT/.test(st.label), 'ten sorters, ten slots (the most): no BIGGER PLANT HALL, no slot (' + st.label + ')');
}
{
  const env = mk(), { CS, app, S } = env, F = CS.Floor;
  S.money = 5e6; S.plant.room = 0;
  while (!F.addVeto(S.line, 'sinkfloat', 0)) S.line.push(CS.Sim.makeNode('hammer', {}, { uid: S.line[S.line.length - 1].uid, port: 'product' }));
  check(!!F.addVeto(S.line, 'sinkfloat', 0) && !CS.Slots.addVeto(S.line, 'sinkfloat', CS.Slots.live.owned()), 'setup: the floor blocks a sorter, the slots do not');
  const pick = { ms: ['sinkfloat'], src: { uid: S.line[0].uid, port: 'product' }, gain: 5, sets: [{}] };
  let asked = [];
  app.nextPurchases = () => { asked.push(S.plant.room); return F.addVeto(S.line, 'sinkfloat', S.plant.room) ? [] : [pick]; };
  const fits1 = !F.addVeto(S.line, 'sinkfloat', 1);
  const st = app.layout.nextStep();
  check(!fits1 || /BIGGER PLANT HALL/.test(st.label), 'the floor blocks and a bigger hall lets a paying sorter in: BUY A BIGGER PLANT HALL (' + st.label + ')');
  check(S.plant.room === 0 && asked.includes(1), 'NEXT PURCHASE was asked as if the hall were one level up, then the room put back');
  app.nextPurchases = () => [];
  S.money += 1000;   // a new cache key
  const st2 = app.layout.nextStep();
  check(!/HALL/.test(st2.label), 'a bigger hall that lets no paying sorter in is not advised (' + st2.label + ')');
}

console.log('== #332 / #333 the process line ==');
{
  const env = mk(), { app, CS, S } = env, Sim = CS.Sim;
  const pnodes = () => env.created.filter((e) => /p-node/.test(String(e.className)));
  S.money = 1e6; app.buyMachine('eddy');
  const [, magnet] = S.line, eddy = Sim.makeNode('eddy', {}, { uid: magnet.uid, port: 'residue' }); S.line.push(eddy);
  app.setFeed({ steel: 0.3, aluminum: 0.3, wood: 0.4 }, 'custom', 10); S.feedPrepaid = true; S.feedOwner = 'test'; app.markDirty(true); env.flush();
  const nBefore = pnodes().length;
  eddy.src = { uid: magnet.uid, port: 'extract' }; app.markDirty(true); env.flush();
  check(pnodes().length > nBefore, 'rewiring a station input redraws the process line (#332)');
}
{
  const env = mk(), { app, CS, S } = env, Sim = CS.Sim;
  S.money = 1e8; S.owned.add('omni'); app.buyMachine('omni');
  const hammer = S.line[0]; S.line = [hammer, Sim.makeNode('omni', {}, { uid: hammer.uid, port: 'product' })];
  app.setFeed({ steel: 0.4, aluminum: 0.3, copper: 0.3 }, 'custom', 10); S.feedPrepaid = true; S.feedOwner = 'test'; app.recompute(); app.markDirty(true); app.renderAll(); env.flush();
  const ps = env.created.filter((e) => /p-node/.test(String(e.className))); let start = 0; ps.forEach((e, i) => { if (/^<small>(LOT|BIN)</.test(String(e.innerHTML))) start = i; });
  const last = ps.slice(start).map((e) => String(e.innerHTML));
  const shred = last.find((h) => /SHRED/.test(h)) || '', omni = last.find((h) => /STATION/.test(h) && /Omniprocessor/.test(h));
  check(!/Omniprocessor/.test(shred) && !!omni && !last.some((h) => /no sorter yet/.test(h)), 'the Omniprocessor is a station node, not part of SHRED (#333)');
}

console.log('== #334 a bin with no feed that fits three batches takes the richest feed ==');
{
  const env = mk(), { CS } = env, R = CS.Round, A = CS.Auction, FEEDS = CS.FEEDS;
  let ok = true, seen = 0;
  for (let s = 1; s <= 40; s++) {
    const cards = R.makeCards(A.mulberry32(s * 31 + 7), 5e5, { market: {}, limit: 30, clockH: 0, id0: 1 });
    cards.forEach((L) => {
      const cat = R.CATEGORIES.find((c) => c.id === L.cat), fs = cat.feeds.filter((f) => FEEDS[f] && A.worthOf(FEEDS[f].comp) > 1);
      if (!fs.every((f) => 5e5 * R.BIN_SPREAD[0] / Math.max(1, A.worthOf(FEEDS[f].comp) * A.fairRatio(f)) > R.BIN_BATCHES * 30)) return;   // a feed of the category may fit three batches
      seen++;
      const rich = Math.max.apply(null, fs.map((f) => A.worthOf(FEEDS[f].comp)));
      if (A.worthOf(FEEDS[L.base].comp) < rich - 1e-9) ok = false;
    });
  }
  check(/none fits, the richest feed/.test(read('js/modules/round.js')), 'makeCards falls back to the richest feed of the category');
  check(ok, 'every capped bin is the richest feed of its category (' + seen + ' checked)');
}

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' checks pass');
process.exit(fails ? 1 : 0);
