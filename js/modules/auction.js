/* CrunchSim module: auction. Scrap lot board, variable lots and the feed market (tickets #24, #16, #23).
 * The lot generator and board logic are pure and live on CS.Auction so tests/auction.js can run them in Node.
 * The panel and game wiring below register through CS.app hooks only.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  const { MATERIALS, FEEDS } = CS;

  /* ---------------- seeded PRNG ---------------- */
  // mulberry32: 32-bit state, period 2^32; good enough for a lot board and reproducible from a saved state. Never Math.random.
  function mulberry32(seed) {
    let a = seed >>> 0;
    const r = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.getState = function () { return a; }; r.setState = function (s) { a = s >>> 0; };
    return r;
  }
  function uni(rng, a, b) { return a + (b - a) * rng(); }
  function normal(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }   // Box-Muller
  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  function normalise(c) { let t = 0; for (const m in c) { if (!(c[m] > 0)) delete c[m]; else t += c[m]; } if (t > 0) for (const m in c) c[m] /= t; return c; }
  function sameComp(a, b) { const keys = new Set(Object.keys(a).concat(Object.keys(b))); for (const k of keys) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6) return false; return true; }

  /* ---------------- lot economics ---------------- */
  const ALWAYS = ['elv', 'pallets', 'quarry'];   // open-market feeds that need no supplier contract
  const WORTH_FACTOR = 0.6;     // a yard pays about 60% of finished-product value for unprocessed scrap; the rest is processing, yield loss and margin
  const VAR_SIGMA = 0.2;        // lot-to-lot scatter of each fraction: ELV ferrous content runs 65-75% between yards, about +-15% relative
  const DECL_SIGMA = 0.1;       // honest declaration vs weighbridge sample: scrap grading tolerance of about +-10%
  const BIAS_MAX = 0.35;        // sellers talk up the payable metals by up to a third and talk down the waste
  const VALUABLE = 1000;        // $/t: at or above this a material is "payable metal" the seller pushes (aluminum and up)
  const WASTE = 50;             // $/t: below this it is deductible waste (wood, glass, rock, water)
  const DEAL = { great: 0.25, fair: 0.5, terrible: 0.25 };   // a quarter of lots are bargains, half fair, a quarter bad buys
  // ask as a multiple of the going yard rate: fair = +-15% around it, great = 30-60% of it; terrible = 1.05-1.5x the full 0.6*sell worth
  const MULT = { great: [0.3, 0.6], fair: [0.85, 1.15], terrible: [1.05, 1.5] };
  const PAD = [0.25, 0.45];     // a padded lot hides 25-45% worthless material under the good stuff (dirt, moisture, dunnage, glass)
  const PAD_SHOWN = [0.2, 0.6]; // and the seller declares only 20-60% of that padding
  const TRAMP_HONEST = [0.03, 0.08];   // honest lots still carry 3-8% moisture or dirt; scrap purchase contracts deduct 2-15% for it
  const LIFE_H = [6, 48];       // online scrap auctions close in one to two days (sim hours)
  const TONS = [5, 1.2];        // 5 t (a skip lorry) up to 1.2x the logistics limit (a walking-floor trailer carries 20-25 t)
  const BOARD = { min: 3, max: 6, arriveH: 6 };   // three to six open lots; a new one arrives about every 6 sim hours (Poisson)
  // feed market random walk: 3%/sqrt(h) (LME aluminium moves ~0.3%/sqrt(h), x10 for sim pace), mean-reverting to list price over about a day, pinned to 0.8-1.3x
  const MARKET = { lo: 0.8, hi: 1.3, sigma: 0.03, kappa: 0.05 };

  const TRAMP = [
    { m: 'water', what: 'moisture', note: 'Moisture not deducted; the pile has been outside all winter.' },
    { m: 'limestone', what: 'dirt and concrete', note: 'Dug out of the old tip. Some concrete and dirt came up with it.' },
    { m: 'wood', what: 'dunnage', note: 'Bales pressed with the dunnage and pallets still in.' },
    { m: 'glass', what: 'glass', note: 'Glass not screened out of this one.' }
  ];
  const SELLERS = ['Riverside Auto Dismantlers', 'Northgate Demolition', 'Harbour Pallet Co.', 'Mill End Tyre Depot', 'Westfield Quarries', 'Two Rivers Metals', 'Kestrel Salvage', 'Bayside Foundry', 'Delta Haulage (abandoned load)', 'County Highways depot', 'Oldfield Scrap and Steel', 'Lakeside Plating Works'];
  const NOTES = {
    great: ['Yard closing, must clear by Friday.', 'Insurance write-off, sold at scrap value with a weighbridge ticket.', 'Surplus from a cancelled contract, priced to move.', 'Sampled and graded, inspection welcome, loaded free.'],
    fair: ['Regular weekly lot, ticket available.', 'Sampled and graded as declared.', 'Loaded on request, haulage not included.', 'Mixed lot, as per declaration.', 'Repeat seller, usual quality.'],
    terrible: ['Sold as seen. No sampling, no weighbridge ticket, no claims.', 'Photos are of a previous lot. Seller firm on price.', 'Buyer takes all, no returns. Declaration is the seller\'s own estimate.', 'Seller declines a pre-sale inspection.'],
    tramp: ['Carries a little {what}, declared.', 'Some {what} in the load, allowed for in the declaration.']
  };

  function worthOf(comp) { let w = 0; for (const m in comp) if (MATERIALS[m]) w += comp[m] * MATERIALS[m].sell; return w * WORTH_FACTOR; }
  // going yard rate as a fraction of worth: US shredder yards pay $100-150/t for hulks against $300-400/t of shred, about a third;
  // zorba, a semi-finished product, trades nearer 80%. Read off the preset supplier price, floored at 0.3 for feeds you are paid to take.
  function fairRatio(id) { const F = FEEDS[id]; const w = F ? worthOf(F.comp) : 0; return w > 0 ? clamp(F.cost / w, 0.3, 0.8) : 0.3; }
  function feedsFor(suppliers) { return Object.keys(FEEDS).filter((id) => (ALWAYS.includes(id) || (suppliers && suppliers.has(id))) && worthOf(FEEDS[id].comp) > 1); }

  /* Generate one lot. opts: { feeds: [ids], limit: t per batch, clockH: sim hours, market: {id: factor}, id } */
  function genLot(rng, opts) {
    opts = opts || {};
    const feeds = (opts.feeds || ALWAYS).filter((id) => FEEDS[id] && worthOf(FEEDS[id].comp) > 1);
    const base = pick(rng, feeds.length ? feeds : ALWAYS), F = FEEDS[base];
    const u = rng(); const cls = u < DEAL.great ? 'great' : (u < DEAL.great + DEAL.fair ? 'fair' : 'terrible');
    // truth: the preset with lognormal scatter on every fraction
    const truth = {};
    for (const m in F.comp) truth[m] = F.comp[m] * Math.exp(VAR_SIGMA * clamp(normal(rng), -2.5, 2.5));
    normalise(truth);
    // tramp: a padded bad buy, or an honest trace of moisture or dirt
    let tramp = null, padded = false, frac = 0;
    // a pad must genuinely dilute: it sells for under half the lot's average and is not already a major component
    const avgSell = worthOf(truth) / WORTH_FACTOR;
    const choices = TRAMP.filter((t) => !(truth[t.m] > 0.3) && MATERIALS[t.m].sell < 0.5 * avgSell);
    if (cls === 'terrible' && choices.length && rng() < 0.5) { padded = true; tramp = pick(rng, choices); frac = uni(rng, PAD[0], PAD[1]); }
    else if (cls !== 'terrible' && choices.length && rng() < 0.3) { tramp = pick(rng, choices); frac = uni(rng, TRAMP_HONEST[0], TRAMP_HONEST[1]); }
    if (tramp) { for (const m in truth) truth[m] *= 1 - frac; truth[tramp.m] = (truth[tramp.m] || 0) + frac; normalise(truth); }
    // declared: truth plus seller bias and grading noise; motivated sellers with a ticket have less to gain from talking it up
    const bias = uni(rng, 0, BIAS_MAX) * (cls === 'great' ? 0.4 : 1);
    const declared = {};
    for (const m in truth) {
      const sell = MATERIALS[m].sell;
      let k = Math.exp(DECL_SIGMA * clamp(normal(rng), -2, 2));
      if (sell >= VALUABLE) k *= 1 + bias; else if (sell < WASTE) k *= 1 - 0.6 * bias;
      if (padded && m === tramp.m) k = uni(rng, PAD_SHOWN[0], PAD_SHOWN[1]);
      declared[m] = truth[m] * k;
    }
    normalise(declared);
    // price
    const worth = worthOf(truth), fr = fairRatio(base), mk = (opts.market && opts.market[base] > 0) ? opts.market[base] : 1;
    let ask;
    if (cls === 'great') ask = worth * fr * uni(rng, MULT.great[0], MULT.great[1]);
    else if (cls === 'fair') ask = worth * fr * uni(rng, MULT.fair[0], MULT.fair[1]);
    else if (padded) ask = worthOf(declared) * fr * uni(rng, MULT.fair[0], MULT.fair[1]);   // looks fair, because it is priced on the declaration
    else ask = worth * uni(rng, MULT.terrible[0], MULT.terrible[1]);
    ask = Math.max(1, Math.round(ask * mk));
    const limit = opts.limit > 0 ? opts.limit : 30;
    const tons = Math.max(1, Math.round(uni(rng, TONS[0], TONS[1] * limit)));
    const clockH = opts.clockH || 0, expiresH = clockH + Math.round(uni(rng, LIFE_H[0], LIFE_H[1]) * 2) / 2;
    const seller = pick(rng, SELLERS);
    let note;
    if (padded) note = tramp.note;
    else if (tramp) note = pick(rng, NOTES.tramp).replace('{what}', tramp.what);
    else note = pick(rng, NOTES[cls]);
    return { id: opts.id || 0, base, cls, truth, declared, tons, ask, worth: Math.round(worth), expiresH, seller, headline: F.name, note, tramp: tramp ? tramp.m : null, padded };
  }

  /* Board upkeep: expire lots, let new ones arrive, keep at least BOARD.min open. Pure: mutates st and draws from rng only. */
  function tickBoard(st, rng, clockH, dh, opts) {
    const before = st.board.length;
    st.board = st.board.filter((l) => l.expiresH > clockH);
    const mk = () => genLot(rng, Object.assign({}, opts, { clockH, id: st.nextId++ }));
    if (dh > 0 && st.board.length < BOARD.max && rng() < 1 - Math.exp(-dh / BOARD.arriveH)) st.board.push(mk());
    if (!st.board.length && before === 0) { const n = BOARD.min + Math.floor(rng() * (BOARD.max - BOARD.min + 1)); while (st.board.length < n) st.board.push(mk()); }
    while (st.board.length < BOARD.min) st.board.push(mk());
    return st.board.length !== before;
  }
  /* Feed market: one mean-reverting lognormal step per feed over dh sim hours. */
  function marketStep(market, rng, dh, ids) {
    (ids || Object.keys(FEEDS)).forEach((id) => {
      let f = market[id] > 0 ? market[id] : 1;
      if (dh > 0) f *= Math.exp(-MARKET.kappa * dh * Math.log(f) + MARKET.sigma * Math.sqrt(dh) * normal(rng));
      market[id] = clamp(f, MARKET.lo, MARKET.hi);
    });
    return market;
  }
  function validLot(l) { return !!(l && typeof l === 'object' && FEEDS[l.base] && l.truth && typeof l.truth === 'object' && l.declared && isFinite(+l.tons) && isFinite(+l.ask) && isFinite(+l.expiresH)); }

  CS.Auction = { mulberry32, genLot, tickBoard, marketStep, worthOf, fairRatio, feedsFor, validLot, sameComp, ALWAYS, DEAL, MULT, MARKET, BOARD, WORTH_FACTOR };

  /* ---------------- game wiring (browser only) ---------------- */
  function init() {
    const app = CS.app; if (!app || init.done) return; init.done = true;
    const st = { board: [], market: {}, nextId: 1001, pending: null, settle: null };
    const rng = mulberry32(0); let seeded = false, lastKey = '', panel = null;
    const S = () => app.S, clockH = () => app.S.clock / 3600;
    const feeds = () => feedsFor(S().suppliers);
    const genOpts = () => ({ feeds: feeds(), limit: app.plantValue('logistics'), market: st.market });

    function loadState(ext) {
      const d = ext && ext.auction; if (!d || typeof d !== 'object') return;
      if (isFinite(+d.rngState)) { rng.setState(+d.rngState); seeded = true; }
      st.board = Array.isArray(d.board) ? d.board.filter(validLot) : [];
      st.market = {}; for (const id in (d.market || {})) if (FEEDS[id] && isFinite(+d.market[id])) st.market[id] = clamp(+d.market[id], MARKET.lo, MARKET.hi);
      st.nextId = Math.max(1001, Math.floor(+d.nextId) || 0);
      st.pending = validLot(d.pending) ? d.pending : null;
    }
    app.on('load', loadState);
    if (app.S && app.S.ext) loadState(app.S.ext);   // a module that registers after boot has missed the 'load' event
    app.on('save', () => ({ auction: { rngState: rng.getState(), board: st.board, market: st.market, nextId: st.nextId, pending: st.pending } }));
    app.on('feedCost', (q) => { if (st.market[q.id] > 0) q.cost *= st.market[q.id]; });   // scales the preset price the app charges (feed market)
    const feedCost = (id) => FEEDS[id].cost * (st.market[id] > 0 ? st.market[id] : 1);

    /* ---- panel ---- */
    const fmtH = (h) => h >= 1 ? Math.round(h) + ' h' : Math.max(1, Math.round(h * 60)) + ' min';
    const compText = (c, n) => Object.entries(c).sort((a, b) => b[1] - a[1]).filter((e) => e[1] >= 0.005).slice(0, n || 5).map((e) => app.esc(MATERIALS[e[0]].name) + ' ' + Math.round(e[1] * 100) + '%').join(', ');
    const compBar = (c) => '<div class="acomp">' + Object.entries(c).sort((a, b) => b[1] - a[1]).map((e) => '<i style="width:' + (100 * e[1]) + '%;background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div>';
    function build() {
      if (panel) return;
      panel = app.addPanel('left', 'auction-panel', 'Scrap auction', 'feed-panel');
      panel.querySelector('h2').appendChild(app.el('span', 'tag', ''));
      panel.appendChild(app.el('div', 'small', 'Lots are sold on the seller\'s declaration. The weighbridge reading comes when the batch starts.'));
      panel.appendChild(app.el('div', null, '')).id = 'auction-lots';
      panel.appendChild(app.el('h3', null, 'Feed market'));
      panel.appendChild(app.el('div', 'mkt', '')).id = 'auction-market';
      const css = document.createElement('style');
      css.textContent = '#auction-panel .acomp{display:flex;height:5px;border-radius:3px;overflow:hidden;margin:4px 0 2px;background:var(--line)}#auction-panel .acomp i{display:block;height:100%}' +
        '#auction-panel .ask{color:var(--amber);font-family:var(--mono);white-space:nowrap}#auction-panel .crow.yard{border-color:var(--amber)}' +
        '#auction-panel .mkt .r{display:grid;grid-template-columns:1fr 54px 76px;gap:6px;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);align-items:center}' +
        '#auction-panel .mkt .r.h{color:var(--muted);font-size:10px;letter-spacing:1px}#auction-panel .mkt .r span:nth-child(n+2){text-align:right}';
      panel.appendChild(css);
    }
    function render() {
      if (!panel) return;
      const box = panel.querySelector('#auction-lots'); box.innerHTML = '';
      const C = app.contract(), run = !!S().run, cap = app.plantValue('logistics'), now = clockH();
      panel.querySelector('h2 .tag').textContent = st.board.length + ' OPEN';
      const P = st.pending;
      if (P) {
        const loaded = S().feedPrepaid && !C && sameComp(S().comp, P.truth);
        const row = app.el('div', 'crow yard', '<div class="ch"><b>IN THE YARD: LOT #' + P.id + '</b><span class="ask">' + app.fmtMoney(P.ask) + '/t paid</span></div><div class="cd">' + P.tons + ' t of ' + app.esc(P.headline) + ' · declared: ' + compText(P.declared) + compBar(P.declared) + '</div><div class="cd">' + (loaded ? 'Loaded as the feed, prepaid. Run the batch.' : (C ? 'Waiting: the contract feed is loaded.' : 'Not loaded: the feed was changed by hand.')) + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = loaded ? 'LOADED' : 'LOAD'; b.className = loaded ? 'buy max' : 'buy'; b.disabled = loaded || !!C || run;
        b.addEventListener('click', () => { if (loadPending()) { app.log('Lot #' + P.id + ' loaded as the feed again.', 'ok'); render(); } });
        row.appendChild(b); box.appendChild(row);
      }
      if (!st.board.length) box.appendChild(app.el('div', 'empty', 'No lots on the board.'));
      st.board.slice().sort((a, b) => a.expiresH - b.expiresH).forEach((L) => {
        const total = L.ask * L.tons;
        const row = app.el('div', 'crow', '<div class="ch"><b>' + app.esc(L.headline) + ' · ' + L.tons + ' t</b><span class="ask">' + app.fmtMoney(L.ask) + '/t</span></div>' +
          '<div class="cd">Declared: ' + compText(L.declared) + compBar(L.declared) + '</div>' +
          '<div class="cd">' + app.esc(L.seller) + ': ' + app.esc(L.note) + ' · closes in ' + fmtH(L.expiresH - now) + (L.tons > cap ? ' · over your ' + cap + ' t batch limit' : '') + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'BUY ' + app.fmtMoney(total); b.className = 'buy' + (S().money < total ? ' poor' : '');
        b.title = C ? 'Release the contract first' : (run ? 'Wait for the batch' : 'Pay ' + app.fmtMoney(total) + ' and load the lot as the feed');
        b.addEventListener('click', () => buy(L));
        row.appendChild(b); box.appendChild(row);
      });
      const mk = panel.querySelector('#auction-market');
      let h = '<div class="r h"><span>FEED</span><span>MARKET</span><span>NOW</span></div>';
      feeds().forEach((id) => {
        const f = st.market[id] > 0 ? st.market[id] : 1, c = feedCost(id);
        h += '<div class="r"><span>' + app.esc(FEEDS[id].name) + '</span><span class="' + (f < 0.97 ? 'ok' : f > 1.03 ? 'bad' : '') + '">×' + f.toFixed(2) + '</span><span>' + (c < 0 ? 'paid ' + app.fmtMoney(-c) : app.fmtMoney(c)) + '/t</span></div>';
      });
      mk.innerHTML = h;
    }

    /* ---- buying and settlement ---- */
    function loadPending() {
      const P = st.pending; if (!P || app.contract() || S().run) return false;
      app.setFeed(P.truth, 'custom', Math.max(1, Math.min(P.tons, app.plantValue('logistics'))));
      S().feedPrepaid = true; return true;
    }
    function buy(L) {
      if (app.contract()) { app.log('Release the contract first: the client supplies the feed while a contract is active.', 'warn'); return; }
      if (S().run) { app.log('Finish the running batch before buying a lot.', 'warn'); return; }
      if (st.pending) { app.log('Lot #' + st.pending.id + ' (' + st.pending.tons + ' t) is still in the yard. Run it before buying another.', 'warn'); return; }
      if (!st.board.includes(L)) return;
      const total = L.ask * L.tons;
      if (!app.spend(total, 'lot #' + L.id + ' (' + L.tons + ' t at ' + app.fmtMoney(L.ask) + '/t)')) { render(); return; }
      st.board = st.board.filter((x) => x !== L);
      st.pending = Object.assign({}, L, { paid: total, boughtTons: L.tons });
      const cap = app.plantValue('logistics');
      app.log('Bought lot #' + L.id + ' from ' + L.seller + ': ' + L.tons + ' t of ' + L.headline + ' at ' + app.fmtMoney(L.ask) + '/t, ' + app.fmtMoney(total) + ' paid. Declared ' + compText(L.declared, 4).replace(/&amp;/g, '&') + '.' + (L.tons > cap ? ' Only ' + cap + ' t fit a batch; the rest waits in the yard.' : ''), 'ok');
      loadPending(); app.renderBank(); render(); app.save();
    }
    app.on('batchStart', (p) => {
      S().feedPrepaid = false;   // the prepaid lot is consumed by this batch
      const P = st.pending; if (!P || app.contract() || !sameComp(S().comp, P.truth)) return;
      const tons = p.run.total;
      const extra = P.tramp ? ' ' + (P.padded ? 'A lot of ' : 'Some ') + TRAMP.find((t) => t.m === P.tramp).what + ' in the load.' : '';
      app.log('Weighbridge, lot #' + P.id + ': ' + compText(P.truth, 8).replace(/&amp;/g, '&') + '.' + extra, P.padded ? 'warn' : 'ok');
      st.settle = { lot: P, tons };
      P.tons -= tons;
      if (P.tons < 1) st.pending = null; else app.log(P.tons + ' t of lot #' + P.id + ' stay in the yard for the next batch.');
      render();
    });
    app.on('batchComplete', (p) => {
      const s = st.settle; if (!s) return; st.settle = null;
      const L = s.lot, done = p.r.done, paid = L.ask * done, w = worthOf(L.truth) * done, dw = worthOf(L.declared) * done;
      const verdict = L.cls === 'great' ? 'a bargain' : L.cls === 'fair' ? 'a fair deal' : (L.padded ? 'a padded lot' : 'overpriced');
      app.log('Lot #' + L.id + ' settled: paid ' + app.fmtMoney(paid) + ' for ' + app.fmtNum(done, 1) + ' t. Declared worth ' + app.fmtMoney(dw) + ', weighbridge worth ' + app.fmtMoney(w) + ' (60% of product prices); the line made ' + app.fmtMoney(p.r.rev) + ' of product. That was ' + verdict + '.', L.cls === 'terrible' ? 'bad' : (L.cls === 'great' ? 'ok' : ''));
      if (st.pending && loadPending()) app.log('Lot #' + st.pending.id + ' loaded for the next batch.');
      render();
    });
    // guard: a prepaid lot only covers its own composition and tonnage
    function guard() {
      const P = st.pending; if (!P || !S().feedPrepaid || app.contract()) return;
      if (!sameComp(S().comp, P.truth)) { S().feedPrepaid = false; app.log('Feed changed by hand: lot #' + P.id + ' stays in the yard and the feed is charged at the normal price. LOAD brings the lot back.', 'warn'); render(); }
      else if (S().tons > P.tons) { S().tons = P.tons; app.syncFeedRows(); }
    }

    app.on('boot', () => {
      if (!seeded) { rng.setState(Math.floor(S().clock)); seeded = true; }
      marketStep(st.market, rng, 0);
      tickBoard(st, rng, clockH(), 0, genOpts());
      if (st.pending && !app.contract() && !S().feedPrepaid && sameComp(S().comp, st.pending.truth)) S().feedPrepaid = true;   // the flag is not saved by the app
      build(); render();
    });
    app.on('render', render);
    app.on('tick', (p) => {
      if (!(p.dh > 0)) return;
      marketStep(st.market, rng, p.dh);
      const changed = tickBoard(st, rng, clockH(), p.dh, genOpts());
      guard();
      const key = Math.floor(clockH() * 4);
      if (changed || key !== lastKey) { lastKey = key; render(); if (!changed) app.markDirty(); }   // quarter-hourly: refresh timers and the feed price line
    });
  }
  if (CS.app) init();
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);   // app.js boots on DOMContentLoaded and its listener was added first
})(typeof window !== 'undefined' ? window : globalThis);
