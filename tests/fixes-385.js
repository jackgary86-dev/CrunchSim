// Fixes #385, #389, #390, #391, #395. Run: node tests/fixes-385.js
//  jobs are sized from what the yard can spend and offered only from lots it holds or can buy, the window covers the work ahead,
//  the board deals a lot to match a job when nothing in reach carries a metal (#385, #395); the process line folds one more
//  station when the Omniprocessor stays out of the fold (#389); a new Rivals round redraws the process line (#390); text fixes (#391).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const { mk } = require('./browser-env.js');
const kind = (CS, m) => CS.MACHINES[m].kind === 'separator' ? 'residue' : 'product';

console.log('== #385: a job lot is sized from what the yard can spend ==');
{
  const env = mk(); env.flush();
  const M = env.CS.Missions, A = env.CS.Auction;
  const L0 = M.lotSizes(6, 0), fa = (id) => A.worthOf(env.CS.FEEDS[id].comp) * A.fairRatio(id);
  check(L0 && Object.keys(L0.lotT).every((id) => L0.lotT[id] >= Math.min(A.TIER_MAX_T[0], A.TIERS[0] / fa(id)) - 1e-6), 'an empty bank still sizes a lot at one tier-0 lot, not 1 t (' + Object.entries(L0.lotT).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') + ')');
  const { app, S } = env; S.money = 1e5; const L = A.live.board().find((x) => x.tier === 3); A.live.deliver(L, A.live.priceOf(L), 'Bought'); env.flush(); S.money = 0;
  const o = M.live.genOpts(), cheap = A.live.board().filter((x) => A.live.priceOf(x) * x.tons <= A.live.priceOf(L) * L.tons);
  check(o.capT && o.capT[L.base] >= L.tons && cheap.every((x) => o.capT[x.base] > 0), 'with the bank emptied by the lot just loaded, that lot and the board lots it is worth stay in reach (' + JSON.stringify(o.capT) + ')');
}

console.log('== #395: jobs come from the lots in reach ==');
{
  const M = (mk(), globalThis.CS.Missions);
  const reach = { copper: {}, brass: {}, potmetal: {}, aluminum: { zorba: [{ s: 0.999, f: 0.6 }, { s: 1, f: 0.0001 }] } };
  const base = { feeds: ['zorba'], lotT: { zorba: 100 }, limit: 30, rate: 15, rep: 100, reach };
  const j = M.genJob(M.mulberry32(4), Object.assign({}, base, { capT: { zorba: 45 } }));
  check(j && j.batches === 1 && j.feed === 'zorba' && j.feedT <= 45, 'capT caps the batches at the tonnes in reach (' + (j && j.batches + ' batch, ' + j.feedT + ' t of zorba') + ')');
  let worst = 0; for (let s = 1; s <= 40; s++) { const x = M.genJob(M.mulberry32(s), base); if (x) worst = Math.max(worst, x.purity); }
  check(worst <= 0.999 - M.JOB.purityMargin + 1e-9, 'a job asks at least ' + M.JOB.purityMargin + ' under the purest bin that carries the metal, never the trace bin (worst ' + worst + ')');
  const tons = []; for (let s = 1; s <= 20; s++) { const x = M.genJob(M.mulberry32(s), base); if (x) tons.push(x.tons); }
  check(tons.every((t) => t > 1), 'so no job falls to the 0.5 t floor from a trace bin (' + Math.min(...tons) + ' t smallest)');
  const fast = M.genJob(M.mulberry32(5), Object.assign({}, base, { rate: 100 })), slow = M.genJob(M.mulberry32(5), Object.assign({}, base, { rate: 100, rateOf: { zorba: 5 } }));
  check(slow.windowH > fast.windowH, 'the window uses the head rate on the job\'s own feed (' + fast.windowH + ' h at 100 t/h, ' + slow.windowH + ' h at 5 t/h)');
  check(M.windowFor(2, 3, 10) === M.windowFor(2, 3) + 20 && M.windowFor(2) === M.windowFor(2, 0, 0), 'work ahead in the yard lengthens the window by twice its hours');
  check(M.fmtH(1259) === '1,259 h' && M.fmtH(1.999) === '2 h' && M.fmtH(0.5) === '30 min', '#391: hours read \'1,259 h\' and never \'1 h 60 min\' (' + M.fmtH(1259) + ', ' + M.fmtH(1.999) + ')');
}
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, M = CS.Missions, A = CS.Auction.live;
  S.line = CS.Sim.buildLine({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] }); S.money = 2e6; app.recompute();
  A.board().forEach((L) => { if (L.base === 'zorba') L.base = 'pallets'; });   // no zorba lot anywhere
  const o0 = M.live.genOpts();
  check(o0.capT && !o0.capT.zorba && !(o0.feeds || []).includes('zorba'), 'with no zorba lot on the board the yard is offered no zorba job (' + (o0.feeds || []).join(', ') + ')');
  const L = A.dealTier(4, 'zorba'), o = M.live.genOpts(), cost = A.priceOf(L) * L.tons;
  check(o.capT && Math.abs(o.capT.zorba - L.tons) < 1e-6, 'a zorba lot the bank can pay for ($' + Math.round(cost) + ') puts its ' + L.tons + ' t in reach');
  S.money = cost / 2; app.recompute(); const o2 = M.live.genOpts();
  check(!o2.capT.zorba && o2.anyT.zorba === L.tons, 'one the yard cannot pay for is out of reach, but still counts as dealt (an offer is not withdrawn when the bank dips)');
  S.money = 2e6; const J = M.live.jobs(); J.board.length = 0;
  const mkJob = (id) => Object.assign(M.genJob(M.mulberry32(id), M.live.genOpts()), { id });
  const a = mkJob(901), b = mkJob(902);
  check(a && b && a.feed === 'zorba' && b.feed === 'zorba', 'two offers sized from the same zorba lot (' + (a && a.feedT) + ' t and ' + (b && b.feedT) + ' t)');
  J.board.push(a, b); J.nextId = 903; M.live.accept(a.id); env.flush();
  check(J.active.includes(a) && (!J.board.includes(b) || a.feedT + b.feedT <= L.tons), 'accepting one withdraws the other when the lot cannot carry both (board ' + J.board.map((x) => x.id).join(', ') + ')');
  const o3 = M.live.genOpts();
  check(!(o3.capT.zorba >= a.feedT) || L.tons >= 2 * a.feedT, 'the accepted job\'s tonnes are promised: no new offer is sized from them (' + (o3.capT.zorba || 0).toFixed(1) + ' t left of ' + L.tons + ')');
  check(o3.aheadH >= M.JOB.hoursPerBatch, 'the window allows for the work ahead in the yard (' + o3.aheadH.toFixed(1) + ' h)');
}
{
  const env = mk(); env.flush();
  const { CS, app, S } = env, M = CS.Missions, A = CS.Auction.live;
  S.line = CS.Sim.buildLine({ nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' }] }); S.money = 2e6; app.recompute();
  A.board().forEach((L) => { if (L.base === 'zorba') L.base = 'pallets'; }); M.live.jobs().board.length = 0;
  S.clock += 3600; app.emit('tick', { dh: 1, dt: 0.1 }); env.flush();   // an hour of plant time passes (the board ticks only while a batch runs)
  const dealt = A.board().some((L) => L.base === 'zorba'), J = M.live.jobs();
  check(dealt && J.board.some((j) => j.feed === 'zorba'), 'an empty board is stocked: a client posts a zorba job with a zorba lot dealt to match (' + J.board.map((j) => j.mat + ' ' + j.tons + ' t').join(', ') + ')');
}

console.log('== #389: the fold keeps the station count when the Omniprocessor sits in it ==');
{
  const env = mk(), { app, CS, S } = env, Sim = CS.Sim;
  S.money = 1e8; S.owned.add('omni');
  const ms = ['magnet', 'eddy', 'air', 'screen', 'sinkfloat', 'omni', 'sensor', 'eddy', 'air', 'magnet', 'screen', 'cone'];
  const line = [S.line[0]]; ms.forEach((m) => { const last = line[line.length - 1]; line.push(Sim.makeNode(m, {}, { uid: last.uid, port: kind(CS, last.m) })); });
  S.line = line;
  app.setFeed({ steel: 0.4, aluminum: 0.3, copper: 0.3 }, 'custom', 10); S.feedPrepaid = true; S.feedOwner = 'test'; app.recompute(); app.markDirty(true); app.renderAll(); env.flush();
  const ps = env.created.filter((e) => /p-node/.test(String(e.className))); let start = 0; ps.forEach((e, i) => { if (/^<small>(LOT|BIN)</.test(String(e.innerHTML))) start = i; });
  const html = ps.slice(start).map((e) => String(e.innerHTML)), st = html.filter((h) => /<small>STATIONS? /.test(h));
  check(html.some((h) => /Omniprocessor/.test(h) && /<small>STATION 7</.test(h)), 'the Omniprocessor keeps its own node');
  check(st.length <= 4, 'still at most 4 station nodes, the fold one of them (' + st.length + ': ' + st.map((h) => h.replace(/<[^>]+>/g, ' ').trim().slice(0, 24)).join(' | ') + ')');
}

console.log('== #390: a new Rivals round redraws the process line ==');
{
  const env = mk(), { app, CS } = env, RL = CS.Round.live;
  app.switchMode('rivals'); env.flush(); app.renderAll(); env.flush();
  const binText = () => { const ps = env.created.filter((e) => /p-node/.test(String(e.className)) && /^<small>BIN</.test(String(e.innerHTML))); return ps.length ? String(ps[ps.length - 1].innerHTML) : ''; };
  RL.state().n = 1; app.renderAll(); env.flush();
  const before = binText();
  RL.state().n = 2; app.renderAll(); env.flush();
  check(/round 1 of/.test(before) && /round 2 of/.test(binText()), 'the BIN node follows the round: ' + before.replace(/<[^>]+>/g, ' ').trim() + ' -> ' + binText().replace(/<[^>]+>/g, ' ').trim());
}

console.log('== #391: text ==');
{
  const env = mk(), { app, S, CS } = env;
  const src = read('js/app.js'), auto = read('js/modules/autorun.js'), lay = read('js/modules/layout.js'), css = read('css/style.css');
  check(/numFmt\(Number\.isInteger\(v\) \? 0 : 1\)\.format\(v\)/.test(src), 'plant upgrade values go through the number format (\'10,000 t\', \'4,000 m²\')');
  { S.money = 1e9; let g = 0; while (app.buyPlant('logistics') && g++ < 20);
    const t = env.created.map((e) => String(e.innerHTML)).filter((m) => /level \d+: now /.test(m)).pop() || '';
    check(/now [\d]{1,3}(,\d{3})+ t/.test(t) && !/\d{5}/.test(t), 'the top logistics level reads with separators: ' + t); }
  check(/fT\(r\.t\)/.test(auto) && /fT\(Math\.max\(0, t1\.stock - r\.stock0\)\)/.test(auto) && !/app\.fmtNum\(r\.t, 1\) \+ ' t/.test(auto), 'the LOT DONE card prints tonnes with fmtT (\'200 kg\', not \'0.2 t\')');
  check(/rivals \? 'bid for the next bin in the auction round\.'/.test(auto), 'a Rivals LOT DONE card does not say buy the next lot');
  check(/win a bin in the <a href="#" id="ff-auction">auction round<\/a>/.test(lay), 'the Rivals FEED line points at the auction round');
  check(/first batch of 1 t or more/.test(read('js/modules/round.js')), 'the Rivals market says the first round needs a batch of 1 t or more');
  check(/@media \(max-width: 420px\) \{ #toolbar \.tool\[data-key\]::before \{ display: none; \}/.test(css) && /@media \(max-height: 480px\) \{ \.flow-cta \{ display: none; \} \}/.test(css), 'at 375 px MENU fits the toolbar; on a short landscape screen the NOTHING LOADED bar leaves NEXT STEP alone');
  // between the last batch of a lot and LOT DONE
  const AL = CS.Autorun.live;
  check(typeof AL.left === 'function' && typeof AL.stopWhy === 'function' && !AL.left() && AL.stopWhy() === 'the lot is used up', 'with no lot running, nothing is left and a STOP reads \'the lot is used up\'');
  const body = lay.slice(lay.indexOf('if (!S.run && lotOn)'), lay.indexOf('if (!S.run && lotOn)') + 600);
  check(/more \? 'The next batch of the lot starts in a moment\.' : 'The lot is used up/.test(body), 'NEXT STEP says \'next batch\' only when the lot has tonnes left');
}

console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' #385-#395 checks pass');
process.exit(fails ? 1 : 0);
