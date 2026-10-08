// Fixes #370-#374 (and #367). Run: node tests/fixes-370.js
//  the process line folds to fit and never folds the Omniprocessor, the fold names the stations it holds and pages the plant
//  view to them (#370, #367); tonnes read '109.4 t' / '10,000 t' (#371); help and title text tell of the 8 tiers and the end
//  game, the final score names only the machine kinds the yard had, 'Station N' in the logs (#372); the job board names its
//  metals (#373); the $10M lot never costs less than the $1M lot and the seller line has one pair of parentheses (#374).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const { mk } = require('./browser-env.js');

console.log('== #370 / #367 the process line fold ==');
{
  const env = mk(), { app, CS, S } = env, Sim = CS.Sim;
  S.money = 1e8; S.owned.add('omni');
  const ms = ['magnet', 'eddy', 'cone', 'air', 'screen', 'sinkfloat', 'sensor', 'eddy', 'air', 'omni'];
  const line = [S.line[0]]; ms.forEach((m) => { const last = line[line.length - 1]; line.push(Sim.makeNode(m, {}, { uid: last.uid, port: MACHINES_KIND(CS, last.m) })); });
  S.line = line;
  app.setFeed({ steel: 0.4, aluminum: 0.3, copper: 0.3 }, 'custom', 10); S.feedPrepaid = true; S.feedOwner = 'test'; app.recompute(); app.markDirty(true); app.renderAll(); env.flush();
  const ps = env.created.filter((e) => /p-node/.test(String(e.className))); let start = 0; ps.forEach((e, i) => { if (/^<small>(LOT|BIN)</.test(String(e.innerHTML))) start = i; });
  const last = ps.slice(start), html = last.map((e) => String(e.innerHTML));
  const fold = last.find((e) => /STATIONS/.test(String(e.innerHTML))), st = html.filter((h) => /<small>STATIONS? /.test(h));
  check(!!fold && /STATIONS 3, 5-9</.test(String(fold.innerHTML)), 'the fold names the stations it holds, skipping the cone crusher in SHRED: ' + (fold ? String(fold.innerHTML).replace(/<[^>]+>/g, ' ').slice(0, 60) : 'none'));
  check(html.some((h) => /STATION 11</.test(h) && /Omniprocessor/.test(h)), 'the Omniprocessor keeps its own node');
  check(st.length <= 4 && last.length <= 9, 'at most 4 station nodes (the fold is one), 9 in all, so MONEY fits 1440 px (' + st.length + ' / ' + last.length + ')');
  fold.click(); env.flush();
  check(/showing stations? 3/.test(String(env.sel['#flow-count'].textContent)), 'a click on the fold pages the plant view to station 3 (#367): ' + env.sel['#flow-count'].textContent);
}
function MACHINES_KIND(CS, m) { return CS.MACHINES[m].kind === 'separator' ? 'residue' : 'product'; }

console.log('== #371 tonnes ==');
{
  const env = mk(), { app } = env;
  check(app.fmtT(109.355) === '109.4 t' && app.fmtT(10000) === '10,000 t' && app.fmtT(2325) === '2,325 t' && app.fmtT(0.0018) === '2 kg', 'fmtT: 109.4 t, 10,000 t, 2,325 t, 2 kg');
  check(app.fmtPerT(0.00129) === '1.3 kg/t' && app.fmtPerT(0.000012) === '12 g/t', 'fmtPerT: 1.3 kg/t, 12 g/t');
  check(!/S\.tons \+ ' t/.test(read('js/modules/layout.js')) && !/L\.tons \+ ' t/.test(read('js/modules/auction.js')), 'no raw S.tons / L.tons + \' t\' left in layout and auction');
}

console.log('== #372 help, title and log texts ==');
{
  const html = read('index.html'), modes = read('js/modules/modes.js'), app = read('js/app.js'), lay = read('js/modules/layout.js');
  check(!/six-tier|no end/.test(html + modes + app + lay) && /Omniprocessor/.test(html) && /final score/.test(html) && /Omniprocessor/.test(modes), 'no six-tier / no end; help and title card tell of the Omniprocessor and the final score');
  check(!/'Node ' \+/.test(app), "'Station N' in the batch logs, not 'Node N'");
  const env = mk(), E = env.CS.Endgame;
  check(E.yardKinds(['hammer', 'magnet', 'eddy']) === 'a shredder, magnets and eddy currents' && !/sensor/.test(E.yardKinds(['hammer', 'magnet', 'omni'])), 'FINAL SCORE names only the machine kinds the yard had: ' + E.yardKinds(['hammer', 'magnet', 'eddy']));
}

console.log('== #373 the job board ==');
{
  const src = read('js/modules/missions.js');
  check(!/large lots/.test(src) && /clients post jobs only for/.test(src), "the job board drops 'large lots' and names the job metals");
}

console.log('== #374 the auction top tiers ==');
{
  require('../js/data.js'); require('../js/sim.js'); require('../js/modules/auction.js');
  const A = globalThis.CS.Auction, FEEDS = globalThis.CS.FEEDS, rng = A.mulberry32(374), feeds = Object.keys(FEEDS).filter((id) => A.worthOf(FEEDS[id].comp) > 1);
  let max6 = 0, min7 = Infinity;
  for (let i = 0; i < 400; i++) {
    const L6 = A.genLot(rng, { feeds, limit: 10000, budget: A.TIERS[6], tier: 6 }), L7 = A.genLot(rng, { feeds, limit: 10000, budget: A.TIERS[7], tier: 7 });
    max6 = Math.max(max6, L6.ask * L6.tons); min7 = Math.min(min7, L7.ask * L7.tons);
  }
  check(min7 > max6, 'the cheapest $10M lot (' + Math.round(min7) + ') costs more than the dearest $1M lot (' + Math.round(max6) + ')');
  const s = A.sellerHtml('Delta Haulage (abandoned load)', '2 lots weighed');
  check(s === 'Delta Haulage <span class="rep">(abandoned load; 2 lots weighed)</span>' && A.sellerHtml('Kestrel Salvage', 'new to you') === 'Kestrel Salvage <span class="rep">(new to you)</span>', 'one pair of parentheses: ' + s);
}

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
