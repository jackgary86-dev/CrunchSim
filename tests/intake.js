// Intake stockpile (ticket #7): blending compositions, drawing down, pile keys, the hand-mix price, the yard cap, the
// lifetime tally from real bins, save/load round trips, and the extended Feed logistics ladder.
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/intake.js');
const { MATERIALS, MAT_ORDER, FEEDS, LINES, PLANT_UPGRADES, Sim, Intake: I } = globalThis.CS;
const f = (x, d = 2) => isFinite(x) ? x.toFixed(d) : '-';
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);

check(typeof globalThis.CS.app === 'undefined' && I && typeof I.blend === 'function', 'module loads in Node without a DOM and exports CS.Intake');

/* ---- blending ---- */
const elv = FEEDS.elv.comp, zorba = FEEDS.zorba.comp;
const b = I.blend(elv, 100, zorba, 50);
let okB = true;
for (const m of new Set(Object.keys(elv).concat(Object.keys(zorba)))) if (!near(b[m] || 0, (100 * (elv[m] || 0) + 50 * (zorba[m] || 0)) / 150)) okB = false;
check(okB, '100 t ELV + 50 t zorba: every fraction is the mass-weighted average');
check(near(sum(b), (100 * sum(elv) + 50 * sum(zorba)) / 150), 'the blend\'s total is the weighted total of the parts (' + f(sum(b), 4) + ')');
check(near(b.aluminum, (100 * 0.07 + 50 * 0.70) / 150) && near(b.steel, 100 * 0.58 / 150), 'aluminum rises to ' + f(b.aluminum * 100, 1) + '%, steel falls to ' + f(b.steel * 100, 1) + '%');
check(I.sameComp(I.blend(elv, 100, elv, 50), elv), 'blending a preset into its own pile keeps the preset fractions exactly');
check(I.sameComp(I.blend({}, 0, elv, 30), elv) && I.sameComp(I.blend(elv, 30, {}, 0), elv), 'blending with an empty side is the other side');
const junkBlend = I.blend({ unobtainium: 0.5, steel: 0.5 }, 1, { steel: -1, copper: 'x' }, 1);
check(!('unobtainium' in junkBlend) && !('copper' in junkBlend) && near(junkBlend.steel, 0.25), 'unknown materials, negatives and junk are dropped');

/* ---- piles: add and draw ---- */
const p = I.newPile('ELV', elv);
I.add(p, elv, 500, 500 * 110); I.add(p, elv, 1500, 1500 * 100);
check(near(p.t, 2000) && near(p.paid, 205000) && near(I.paidPerT(p), 102.5) && I.sameComp(p.comp, elv), 'two deliveries: 2000 t, $205,000 paid, $102.50/t average, composition unchanged');
const d1 = I.draw(p, 250);
check(near(d1.t, 250) && near(d1.paid, 250 * 102.5) && near(p.t, 1750) && near(p.paid, 1750 * 102.5), 'drawing 250 t takes 250 t and its share of the money; 1750 t and $' + f(p.paid, 0) + ' remain');
check(I.sameComp(p.comp, elv), 'drawing down does not change the composition');
const d2 = I.draw(p, 5000);
check(near(d2.t, 1750) && near(d2.paid, 1750 * 102.5) && p.t === 0 && p.paid === 0, 'drawing more than the pile takes only what is there and empties it');
check(I.draw(p, 10).t === 0 && I.draw(p, -5).t === 0, 'an empty pile or a negative draw gives nothing');
check(I.add(p, elv, 0, 99).t === 0 && p.paid === 0, 'adding zero tonnes changes nothing');
// a mixed pile: 300 t of tires (paid to take) blended with 100 t of ELV
const q = I.newPile('mix');
I.add(q, FEEDS.tires.comp, 300, 300 * FEEDS.tires.cost); I.add(q, elv, 100, 100 * 110);
check(near(q.t, 400) && near(q.paid, -21000 + 11000) && near(q.comp.rubber, (300 * 0.70 + 100 * 0.07) / 400) && near(q.comp.steel, (300 * 0.15 + 100 * 0.58) / 400), 'tires then ELV: 400 t, net -$10,000 (you were paid), rubber ' + f(q.comp.rubber * 100, 1) + '%');
I.draw(q, 100);
check(near(q.paid, -7500) && near(q.t, 300), 'a negative paid balance draws down in proportion too');
// the blend feeds the physics: a 50/50 pile of quarry rock and pallets evaluates like that mix
{
  const r = I.newPile('rock and wood'); I.add(r, FEEDS.quarry.comp, 100, 500); I.add(r, FEEDS.pallets.comp, 100, -1500);
  const head = Sim.makeFeed(r.comp, 1000);
  check(near(Sim.sum(head.m.wood), 1000 * 0.94 / 2, 1e-9) && near(Sim.sum(head.m.granite), 1000 * 0.6 / 2, 1e-9), 'makeFeed on the blend gives 470 kg wood and 300 kg granite per tonne');
}

/* ---- keys and names ---- */
check(I.keyFor('elv', elv) === 'elv' && I.keyFor('elv', Object.assign({}, elv, { steel: 0.6 })).indexOf('mix:') === 0, 'a preset keys by id; a changed preset becomes a mix');
check(I.keyFor('custom', { steel: 0.5, copper: 0.5 }) === I.keyFor('custom', { copper: 0.504, steel: 0.496 }), 'hand mixes that read the same on the sliders share a pile (' + I.keyFor('custom', { steel: 0.5, copper: 0.5 }) + ')');
check(I.keyFor('custom', { steel: 0.5, copper: 0.5 }) !== I.keyFor('custom', { steel: 0.7, copper: 0.3 }), 'different mixes get different piles');
check(I.sig({ steel: 0.58, wood: 0.01, gel: 0 }) === 'steel98-wood2' && I.sig({}) === '', 'signature is whole-percent, biggest first');
check(I.nameFor('elv', elv) === FEEDS.elv.name && I.nameFor('mix:x', { copper: 0.6, steel: 0.4 }) === 'Mix: copper, steel', 'names: preset name or the top materials of a mix');

/* ---- hand-mix price: the same arithmetic as feedCostPerT in app.js ---- */
const mix = { steel: 0.5, copper: 0.3, wood: 0.2 };
const appFormula = (0.5 * MATERIALS.steel.buy + 0.3 * MATERIALS.copper.buy + 0.2 * MATERIALS.wood.buy) * 0.45;
check(near(I.mixCost(mix), appFormula), 'three-material mix costs ' + f(I.mixCost(mix)) + ' $/t (45% of the blended buy price)');
check(near(I.mixCost({ copper: 1 }), MATERIALS.copper.buy) && I.mixCost({}) === 0, 'a single material pays its full buy price; nothing costs nothing');

/* ---- yard cap ---- */
check(I.yardCap(500) === 5000 && I.yardCap(10000) === 100000 && I.yardCap(0) === 0, 'the yard holds ' + I.YARD_BATCHES + ' batches: 5,000 t at 500 t, 100,000 t at 10,000 t');
check(near(I.stockTotal({ a: { t: 12 }, b: { t: 30 }, c: { t: 0 } }), 42), 'stock total adds every pile');

/* ---- lifetime tally from a real line ---- */
Sim.prices.market = 1;
const line = Sim.buildLine(LINES.car), ev = Sim.evalLine(line, elv);
const bins = ev.terminals.map((t) => ({ key: t.key, st: Sim.binStats(t.stream.m, t.form) })).filter((b) => b.st.total > 0.5);
const perT = (m) => bins.reduce((a, b) => a + (b.st.perMat[m] ? b.st.perMat[m].mass : 0), 0);
const life = I.addLifetime({}, bins, 10000);
const headT = Sim.streamMass(ev.head) / 1000 * 10000;
let lifeOk = true;
for (const m in life) if (!near(life[m], perT(m) / 1000 * 10000)) lifeOk = false;
check(lifeOk && Object.keys(life).length > 5, 'a 10,000 t car-line batch tallies each material from the bins (' + Object.keys(life).length + ' materials)');
check(near(sum(life), headT, 1e-3), 'the tally sums to the head tonnage (' + f(sum(life), 1) + ' of ' + f(headT, 1) + ' t)');
I.addLifetime(life, bins, 15);
check(near(life.steel, 10015 * perT('steel') / 1000), 'a second batch adds to the tally');
check(Object.keys(I.addLifetime({}, bins, 0)).length === 0 && Object.keys(I.addLifetime({}, null, 5)).length === 0, 'zero tonnes or no bins add nothing');

/* ---- persistence ---- */
{
  const st = { piles: {}, life: life, loaded: 'elv' };
  st.piles.elv = I.add(I.newPile('ELV', elv), elv, 3000, 330000);
  st.piles['mix:a'] = I.add(I.newPile('Mix: a', mix), mix, 40, 40 * I.mixCost(mix));
  st.piles.empty = I.newPile('nothing', elv);
  const back = I.deserialize(JSON.parse(JSON.stringify(I.serialize(st))));
  check(back.loaded === 'elv' && Object.keys(back.piles).join() === 'elv,mix:a', 'piles with tonnes round-trip, empty piles are dropped, the loaded key survives');
  check(near(back.piles.elv.t, 3000) && near(back.piles.elv.paid, 330000) && I.sameComp(back.piles.elv.comp, elv) && back.piles.elv.name === 'ELV', 'tonnes, money, composition and name round-trip');
  check(MAT_ORDER.every((m) => (life[m] || 0) === (back.life[m] || 0)), 'the lifetime tally round-trips');
  const junk = I.deserialize({ piles: { elv: { t: 'x', comp: elv }, zorba: { t: 5, comp: { unobtainium: 1 } }, ok: { t: 7, comp: { steel: 1 }, paid: 'lots' } }, life: { steel: -4, copper: 9, nope: 3 }, loaded: 'elv' });
  check(Object.keys(junk.piles).join() === 'ok' && junk.piles.ok.paid === 0 && junk.piles.ok.name === 'Mix: steel' && junk.loaded === null && Object.keys(junk.life).join() === 'copper', 'garbage is dropped or defaulted: bad tonnage, unknown material, non-numeric money, a loaded key with no pile');
  check(Object.keys(I.deserialize(null).piles).length === 0 && I.deserialize('x').loaded === null, 'a missing save gives an empty yard');
}

/* ---- page hooks against a fake CS.app, still without a DOM (the pattern of tests/onboarding.js) ----
 * boot is never emitted, so no panel is built; the batch hooks and persistence run on their own. */
{
  const MOD = require.resolve('../js/modules/intake.js');
  delete require.cache[MOD];
  const hooks = {}, logs = [];
  let feedSet = null, saves = 0;
  const S = { comp: Object.assign({}, elv), tons: 15, money: 10000, run: null, feedPreset: 'elv', feedPrepaid: false, suppliers: new Set(['elv']), ext: {} };
  const app = {
    booted: false, S,
    on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); },
    emit(evt, pl) { (hooks[evt] || []).forEach((fn) => fn(pl)); },
    plantValue() { return 500; }, contract() { return null; }, log(m) { logs.push(m); }, save() { saves++; }, renderBank() {}, markDirty() {}, syncFeedRows() {},
    fmtNum: (x, d) => (+x).toFixed(d == null ? 1 : d), fmtMoney: (x) => '$' + Math.round(x), esc: (s) => String(s), el: () => ({}),
    setFeed(comp, preset, tons) { feedSet = { comp: Object.assign({}, comp), preset, tons }; S.comp = Object.assign({}, comp); S.feedPreset = preset; S.tons = tons; app.emit('render'); }
  };
  globalThis.CS.app = app;
  require(MOD);
  const ext = () => Object.assign({}, ...hooks.save.map((fn) => fn() || {})).intake;
  check(hooks.load && hooks.save && hooks.batchStart && hooks.batchComplete && hooks.render && hooks.tick, 'registers load, save, batchStart, batchComplete, render and tick hooks');
  app.emit('load', { intake: { piles: { elv: { name: 'End-of-life vehicles', t: 1000, comp: elv, paid: 110000 } }, life: {}, loaded: 'elv' } });
  check(ext().piles.elv.t === 1000 && ext().loaded === 'elv', 'a saved pile and its loaded key come back through load -> save');
  // the batch starts with the pile loaded but the prepaid flag cleared by someone else: the app charged the feed, the module refunds it
  const run = { total: 300, done: 0, feedC: 33000 };
  S.money = 10000 - 33000; S.run = run;
  app.emit('batchStart', { run });
  check(near(ext().piles.elv.t, 700) && near(ext().piles.elv.paid, 77000), 'batchStart draws 300 t and its money off the pile (700 t, $77,000 left)');
  check(run.feedC === 0 && S.money === 10000, 'a feed charge taken before the start is refunded and zeroed on the run');
  // the batch stops at 100 t: 200 t go back on the pile and the pile is reloaded for the next batch
  run.done = 100; S.run = null; S.feedPrepaid = false; feedSet = null;
  app.emit('batchComplete', { r: run, why: 'stopped', net: 0, bins, cs: null });
  check(near(ext().piles.elv.t, 900) && near(ext().piles.elv.paid, 99000), '200 t the batch did not run go back at the price paid (900 t, $99,000)');
  check(feedSet && feedSet.preset === 'elv' && feedSet.tons === 500 && S.feedPrepaid === true && ext().loaded === 'elv', 'the pile is reloaded for the next batch: 500 t (the logistics cap) of 900, prepaid');
  check(near(ext().life.steel, 100 * perT('steel') / 1000), 'the lifetime tally counts the 100 t that ran');
  // a hand edit on the sliders takes the feed off the pile and the prepaid flag with it
  S.comp.steel += 0.05; app.emit('tick', { dt: 0.016, dh: 0 });
  check(ext().loaded === null && S.feedPrepaid === false && logs.some((m) => /no longer loaded/.test(m)), 'a changed feed unloads the pile and clears the prepaid flag');
  // a preset applied through a render clears it too; another module's setFeed (preset custom) leaves the flag to that module
  app.emit('load', { intake: { piles: { elv: { name: 'ELV', t: 50, comp: elv, paid: 0 } }, life: {}, loaded: 'elv' } });
  S.comp = Object.assign({}, elv); S.feedPrepaid = true; S.feedOwner = 'auction'; S.feedPreset = 'custom'; S.comp.steel += 0.1; app.emit('render');   // #57: the flag carries its owner
  check(ext().loaded === null && S.feedPrepaid === true, 'a programmatic feed change at preset custom is left prepaid for the module that made it');
  app.emit('load', { intake: { piles: { elv: { name: 'ELV', t: 50, comp: elv, paid: 0 } }, life: {}, loaded: 'elv' } });
  S.comp = Object.assign({}, FEEDS.quarry.comp); S.feedPrepaid = true; S.feedOwner = 'intake'; S.feedPreset = 'quarry'; app.emit('render');
  check(ext().loaded === null && S.feedPrepaid === false, 'switching away from its own pile clears the stockpile\'s prepaid flag');
  check(saves === 0, 'no save is forced by the hooks themselves');
  delete globalThis.CS.app;
}

/* ---- Feed logistics ladder ---- */
const L = PLANT_UPGRADES.logistics;
check(L.levels.length === 8 && L.levels[L.levels.length - 1] === 10000 && L.costs.length === 7, 'Feed logistics runs to 10,000 t per batch over 8 levels and 7 purchases');
check(L.levels.every((v, i) => i === 0 || v > L.levels[i - 1]) && L.costs.every((c, i) => i === 0 || c > L.costs[i - 1]), 'levels and costs both grow');
check(L.levels.slice(0, 5).join() === '30,60,120,250,500' && L.costs.slice(0, 4).join() === '3000,9000,30000,110000', 'the first five levels are unchanged');
check(L.costs[6] > L.costs[5] * 2 && L.costs[6] < CS.RANKS[5][0], 'the last step (rail loop) costs more than twice the siding but less than the top rank (balance pass #12)');

console.log('\n' + (fails ? fails + ' of ' + n + ' CHECKS FAILED' : 'all ' + n + ' intake checks pass'));
process.exit(fails ? 1 : 0);
