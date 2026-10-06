/* CrunchSim module: auction rounds (#59, #60, #61). The auction is a literal auction.
 *
 * Each round three large bins come up as cards, each heavy in one category, and four players bid: you and three rival yards
 * from the rivals module's roster (each with its own appetite, trust in sellers' claims and specialities). The cards are
 * sold one after another by open ascending bids; a player who wins a card sits out the rest of the round, so three leave
 * with a bin and one leaves with nothing. The one with nothing runs their MISC bin instead: the MISC bucket's RE-RUN is
 * open only in a round where you won no card. A market panel beside the cards shows the round's HOT and COLD materials and
 * the price of everything in the bins. Your won bin goes to the yard (the auction module's lot handling) and the next round
 * opens once the yard is empty and no batch is running.
 *
 * Numbers: bidding opens at 60% of the seller's ask (a reserve-free sale invites bargain hunters) and rises 5% a step, at
 * least $1/t; a round's bin size scales with the operator's plant (half the bank plus held stock, at least $1,500 of scrap
 * at fair price per bin, each bin 0.6-1.5x that); a rival's purse for one bin is its roster budget relative to the
 * incumbent's ($25k), times twice the round size, so the bargain hunter cannot follow the big bins and the specialist can.
 * The pure parts live on CS.Round so tests/round.js can run them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS || !CS.FEEDS) return;
  const MATERIALS = CS.MATERIALS, FEEDS = CS.FEEDS;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  const CATEGORIES = [
    { id: 'ferrous', name: 'Ferrous', feeds: ['elv', 'appliance'], color: '#8a96a3' },
    { id: 'nonferrous', name: 'Non-ferrous', feeds: ['zorba'], color: '#d98a5b' },
    { id: 'precious', name: 'Electronics & precious', feeds: ['ewaste', 'pins'], color: '#f2c94c' },
    { id: 'wood', name: 'Wood', feeds: ['pallets', 'chair'], color: '#a57a4a' },
    { id: 'rubber', name: 'Rubber & plastic', feeds: ['tires'], color: '#555c66' },
    { id: 'aggregate', name: 'Aggregate & rubble', feeds: ['quarry', 'rubble'], color: '#9aa0a6' },
    { id: 'mixed', name: 'Mixed skip', feeds: ['everything'], color: '#6b8e7f' },
    { id: 'gels', name: 'Gels & liquids', feeds: ['gel', 'lab'], color: '#5fa8d3' }
  ];
  const PLAYERS = ['ironside', 'magpie', 'redline'];   // the three rival yards at the table
  const OPEN = 0.6, STEP = 0.05, STEP_MIN = 1, MIN_SIZE = 1500, BIN_SPREAD = [0.6, 1.5];

  function roundSize(money, stockValue) { return Math.max(MIN_SIZE, Math.round(0.5 * Math.max(0, money || 0) + Math.max(0, stockValue || 0))); }
  function nextBid(price, opening) { return price > 0 ? Math.max(price + STEP_MIN, Math.ceil(price * (1 + STEP))) : opening; }
  /* three cards from three different categories; each is a real lot from the auction generator sized to the round */
  function makeCards(rng, size, opts) {
    const A = CS.Auction; opts = opts || {};
    const cats = CATEGORIES.filter((c) => c.feeds.some((f) => FEEDS[f] && A.worthOf(FEEDS[f].comp) > 1));
    const pickCats = []; const pool = cats.slice();
    while (pickCats.length < 3 && pool.length) pickCats.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return pickCats.map((cat, k) => {
      const budget = Math.round(size * (BIN_SPREAD[0] + (BIN_SPREAD[1] - BIN_SPREAD[0]) * rng()));
      // a feed fits the round when its budget buys at least 0.1 t at the fair price (gold pins wait for the big rounds)
      let feeds = cat.feeds.filter((f) => FEEDS[f] && A.worthOf(FEEDS[f].comp) > 1 && budget / Math.max(1, A.worthOf(FEEDS[f].comp) * A.fairRatio(f)) >= 0.1);
      if (!feeds.length) feeds = cat.feeds.filter((f) => FEEDS[f]).sort((a, b) => A.worthOf(FEEDS[a].comp) - A.worthOf(FEEDS[b].comp)).slice(0, 1);
      const L = A.genLot(rng, { feeds: [feeds[Math.floor(rng() * feeds.length)]], budget, market: opts.market || {}, limit: opts.limit || 30, clockH: opts.clockH || 0, id: (opts.id0 || 1) + k });
      const x = budget / L.ask;   // the bin is sized to the round at its asking price, down to 0.1 t for rich scrap
      L.tons = x < 10 ? Math.max(0.1, Math.round(x * 10) / 10) : Math.round(Math.min(x, 4000));
      L.cat = cat.id; L.catName = cat.name; L.opening = Math.max(1, Math.round(L.ask * OPEN));
      return L;
    });
  }
  function rivalPurse(R, size) { return Math.round(R.budget / 25000 * 2 * size); }
  /* the most rival R pays for card L, $/t: its own valuation (declared mix, trust, specialities, market) capped by its purse */
  function rivalMax(R, L, factor, size) {
    const RV = CS.Rivals; if (!RV || !R) return 0;
    const v = RV.valuation(R, L, factor);
    return Math.max(0, Math.min(v, Math.floor(rivalPurse(R, size) / Math.max(L.tons, 0.01))));
  }
  /* settle a card among rivals alone (you have passed or are out): the English-auction outcome, the top valuer pays one
   * step over the runner-up (or the standing price if that is higher), never more than its own limit */
  function settleRivals(L, price, leader, maxes) {
    const ids = Object.keys(maxes).filter((id) => maxes[id] > 0).sort((a, b) => maxes[b] - maxes[a]);
    if (!ids.length) return { by: leader || null, perT: price };
    const top = ids[0], second = ids[1] ? maxes[ids[1]] : 0;
    let p = Math.max(price, second > 0 ? Math.min(maxes[top], nextBid(second, L.opening)) : (leader ? price : L.opening));
    if (leader && leader !== top && maxes[top] < nextBid(price, L.opening)) return { by: leader, perT: price };   // nobody can top the standing bid
    if (leader !== top && leader) p = Math.max(p, Math.min(maxes[top], nextBid(price, L.opening)));
    return maxes[top] >= p ? { by: top, perT: p } : { by: leader || null, perT: price };
  }

  CS.Round = { CATEGORIES, PLAYERS, OPEN, STEP, STEP_MIN, MIN_SIZE, BIN_SPREAD, roundSize, nextBid, makeCards, rivalPurse, rivalMax, settleRivals };

  /* ======================= page integration ======================= */
  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.roundStarted) return; app.roundStarted = true;
    const A = () => CS.Auction, RV = () => CS.Rivals;
    const newSeed = () => (Date.now() ^ 0x5bd1e995) >>> 0;   // a game's own seed, saved with it: every new game deals different rounds, a reload replays them
    let st = { n: 0, misc: false, open: null, last: null, seed: newSeed() };   // misc: you won no card last round, so MISC may run
    let ov = null, busy = false;
    const $ = (s) => document.querySelector(s);
    const esc = (s) => app.esc(s), money = (x) => app.fmtMoney(x);
    const factor = (m) => (CS.Sim.prices.perMat && CS.Sim.prices.perMat[m]) || 1;
    const rival = (id) => RV() && RV().rivalById(id);
    const nameOf = (id) => id === 'you' ? 'You' : (rival(id) ? rival(id).name : id);
    const yardEmpty = () => { const L = A() && A().live; return !L || (!L.pending() && !(L.yard() && L.yard().length)); };
    const stockValue = () => { const I = CS.Inventory; if (!I) return 0; let v = 0; const s = I.stock(); for (const m in s) v += I.quote ? I.quote(m) : 0; return v; };
    function canStart() { return !app.S.run && yardEmpty() && !(st.open && !st.open.done); }

    /* ---- a round ---- */
    function newRound() {
      if (!canStart()) return false;
      st.n++; st.misc = false;
      const rng = CS.Auction.mulberry32((st.seed ^ Math.imul(st.n, 2654435761) ^ Math.floor(app.S.clock)) >>> 0);
      const size = roundSize(app.S.money, stockValue());
      const cards = makeCards(rng, size, { market: {}, limit: app.plantValue('logistics'), clockH: app.S.clock / 3600, id0: 3000 + st.n * 10 });
      const players = ['you'].concat(PLAYERS.filter((id) => rival(id)));
      const maxes = cards.map((L) => { const o = {}; players.forEach((id) => { if (id !== 'you') o[id] = rivalMax(rival(id), L, factor, size); }); return o; });
      st.open = { n: st.n, size, cards, maxes, k: 0, price: 0, leader: null, out: [], won: {}, passed: false, log: [], done: false };
      app.log('Auction round ' + st.n + ': three bins on the table, ' + cards.map((L) => L.catName.toLowerCase() + ' (' + fmtT(L.tons) + ' of ' + L.headline + ')').join(', ') + '.', 'ok');
      return true;
    }
    const fmtT = (t) => t >= 10 ? Math.round(t) + ' t' : t.toFixed(1) + ' t';
    const R = () => st.open, card = () => R() && R().cards[R().k];
    const inFor = (id) => !R().won[id] && R().out.indexOf(id) < 0;
    function say(t) { R().log.push(t); if (R().log.length > 40) R().log.shift(); }
    /* rivals answer: the first rival (in table order from a rotating start) able to top the price raises one step */
    function rivalsAnswer() {
      const r = R(), L = card(), order = PLAYERS.slice(r.k).concat(PLAYERS.slice(0, r.k));
      for (const id of order) {
        if (!rival(id) || !inFor(id) || r.leader === id) continue;
        const nb = nextBid(r.price, L.opening);
        if ((r.maxes[r.k][id] || 0) >= nb) { r.price = nb; r.leader = id; say(nameOf(id) + ' bids ' + money(nb) + '/t'); return true; }
      }
      return false;
    }
    function youBid() {
      const r = R(), L = card(); if (!r || r.done || busy || !inFor('you') || r.leader === 'you') return;
      const nb = nextBid(r.price, L.opening);
      if (nb * L.tons > app.S.money) { app.log('A bid of ' + money(nb) + '/t on ' + fmtT(L.tons) + ' commits ' + money(nb * L.tons) + '; the bank holds ' + money(app.S.money) + '.', 'warn'); return; }
      r.price = nb; r.leader = 'you'; say('You bid ' + money(nb) + '/t');
      busy = true; render();
      setTimeout(() => { busy = false; if (!rivalsAnswer()) sold(); render(); }, 450);
    }
    function youPass() {
      const r = R(); if (!r || r.done || busy) return;
      if (inFor('you')) { r.out.push('you'); say('You pass'); }
      settleWithoutYou();
    }
    function settleWithoutYou() {
      const r = R(), L = card(), mx = {};
      PLAYERS.forEach((id) => { if (rival(id) && inFor(id)) mx[id] = r.maxes[r.k][id] || 0; });
      const res = settleRivals(L, r.price, r.leader === 'you' ? null : r.leader, mx);
      if (r.leader === 'you' && !(res.by && res.perT > r.price)) { sold(); return; }
      if (res.by) { r.leader = res.by; r.price = res.perT; say(nameOf(res.by) + ' takes it at ' + money(res.perT) + '/t'); }
      else r.leader = null;
      sold(); render();
    }
    function sold() {
      const r = R(), L = card();
      if (r.leader) {
        r.won[r.leader] = { k: r.k, perT: r.price };
        if (r.leader === 'you') {
          const ok = A().live.deliver(Object.assign({}, L), r.price, 'Won at auction round ' + r.n + ':');
          if (!ok) { delete r.won.you; say('You could not pay: the bin goes back to the seller'); }
        } else {
          const rs = RV() && RV().live && RV().live.state && RV().live.state(); const x = rs && rs.rivals && rs.rivals[r.leader];
          if (x) { x.lots = (x.lots || 0) + 1; x.lotT = (x.lotT || 0) + L.tons; x.spent = (x.spent || 0) + r.price * L.tons; }
          app.log(L.catName + ' bin (' + fmtT(L.tons) + ' of ' + L.headline + ') to ' + nameOf(r.leader) + ' at ' + money(r.price) + '/t, ' + money(r.price * L.tons) + '.');
        }
      } else { say('No bids: the ' + L.catName.toLowerCase() + ' bin goes unsold'); app.log(L.catName + ' bin unsold: nobody met the opening price.'); }
      r.k++; r.price = 0; r.leader = null; r.out = [];
      if (r.k >= r.cards.length) return finish();
      if (!inFor('you')) { setTimeout(() => { settleWithoutYou(); }, 350); }   // you hold a card: the rest go among the rivals
      render();
    }
    function finish() {
      const r = R(); r.done = true;
      const empty = ['you'].concat(PLAYERS).filter((id) => (id === 'you' || rival(id)) && !r.won[id]);
      if (!r.won.you) {
        st.misc = true;
        const I = CS.Inventory, mt = I && I.misc ? I.miscTotal(I.misc()) : 0;
        app.log('Round ' + r.n + ': no bin for you. ' + (mt >= 1 ? 'Run your MISC bin: ' + fmtT(mt) + ' of mixed material is waiting (RE-RUN on the MISC bucket).' : 'Your MISC bin is empty; open the next round when you are ready.'), 'warn');
      }
      empty.filter((id) => id !== 'you').forEach((id) => app.log(nameOf(id) + ' left round ' + r.n + ' without a bin and re-ran its MISC.'));
      st.last = { n: r.n, won: Object.assign({}, r.won), cards: r.cards.map((L) => ({ cat: L.catName, headline: L.headline, tons: L.tons })) };
      app.save(); app.markDirty(true); render();
    }

    /* ---- the overlay ---- */
    function build() {
      if (ov) return;
      ov = document.createElement('div'); ov.className = 'overlay hidden'; ov.id = 'round';
      ov.innerHTML = '<div class="sheet wide"><div class="sheet-h"><b id="round-title">AUCTION</b><button type="button" class="danger" id="round-close">CLOSE</button></div><div class="sheet-b round-b"><div class="round-main"></div><div class="round-side"></div></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('#round-close').addEventListener('click', close);
    }
    function open() { build(); ov.classList.remove('hidden'); render(); }
    function close() { if (ov) ov.classList.add('hidden'); }
    function compBar(c) { return '<div class="rc-comp">' + Object.entries(c).sort((a, b) => b[1] - a[1]).map((e) => '<i style="flex:' + e[1].toFixed(4) + ';background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div>'; }
    function heavy(c) { const e = Object.entries(c).sort((a, b) => b[1] - a[1]); const tops = e.slice(0, 3).filter((x) => x[1] >= 0.02).map((x) => MATERIALS[x[0]].name.toLowerCase() + ' ' + Math.round(x[1] * 100) + '%'); const prec = e.filter((x) => CS.Sim.PRECIOUS.indexOf(x[0]) >= 0 && x[1] > 0 && x[1] < 0.02).map((x) => MATERIALS[x[0]].name.toLowerCase() + ' ' + Math.round(x[1] * 1e6) + ' g/t'); return tops.concat(prec).join(', '); }
    function players() {
      const r = R();
      return ['you'].concat(PLAYERS.filter((id) => rival(id))).map((id) => {
        const R0 = rival(id), w = r && r.won[id];
        const status = w ? 'won ' + r.cards[w.k].catName.toLowerCase() : r && !r.done && card() && r.leader === id ? 'leading' : r && !r.done && card() && !inFor(id) ? 'out' : '';
        return '<div class="pl' + (id === 'you' ? ' you' : '') + (r && r.leader === id && !r.done ? ' lead' : '') + (w ? ' won' : '') + '"><b>' + esc(nameOf(id)) + '</b><span>' + (id === 'you' ? money(app.S.money) + ' in the bank' : esc(R0.label)) + '</span>' + (status ? '<em>' + esc(status) + '</em>' : '') + '</div>';
      }).join('');
    }
    function cardHtml(L, k) {
      const r = R(), now = !r.done && r.k === k, w = Object.keys(r.won).find((id) => r.won[id].k === k);
      const done = k < r.k || r.done;
      let foot = '';
      if (now) foot = '<div class="rc-price">' + (r.price > 0 ? money(r.price) + '/t · ' + money(r.price * L.tons) + '<span>' + esc(nameOf(r.leader)) + ' leads</span>' : 'opens at ' + money(L.opening) + '/t · ' + money(L.opening * L.tons)) + '</div>';
      else if (done) foot = '<div class="rc-price sold">' + (w ? 'SOLD to ' + esc(nameOf(w)) + ' · ' + money(r.won[w].perT) + '/t' : 'UNSOLD') + '</div>';
      else foot = '<div class="rc-price wait">up next · opens at ' + money(L.opening) + '/t</div>';
      return '<div class="rcard' + (now ? ' now' : '') + (done ? ' done' : '') + (w === 'you' ? ' mine' : '') + '"><div class="rc-cat" style="border-color:' + (CATEGORIES.find((c) => c.id === L.cat) || {}).color + '">' + esc(L.catName.toUpperCase()) + '</div>' +
        '<div class="rc-bin"><div class="rc-fill">' + Object.entries(L.declared).sort((a, b) => a[1] - b[1]).map((e) => '<i style="flex:' + e[1].toFixed(4) + ';background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div></div>' +
        '<div class="rc-h"><b>' + fmtT(L.tons) + '</b> of ' + esc(L.headline) + '</div>' +
        '<div class="rc-d">Declared: ' + esc(heavy(L.declared)) + '</div>' + compBar(L.declared) +
        '<div class="rc-d small">' + esc(L.seller) + ': ' + esc(L.note) + '</div>' + foot + '</div>';
    }
    function marketHtml() {
      const M = CS.Market, r = R(); let h = '<h3>MARKET</h3>';
      if (M && M.hot && M.hot()) h += '<div class="mk-hc hot"><b>HOT</b> ' + esc(MATERIALS[M.hot().mat].name) + ' <span>×' + M.hot().mul.toFixed(2) + '</span><div class="small">' + esc(M.hot().why) + '</div></div>';
      if (M && M.cold && M.cold()) h += '<div class="mk-hc cold"><b>COLD</b> ' + esc(MATERIALS[M.cold().mat].name) + ' <span>×' + M.cold().mul.toFixed(2) + '</span><div class="small">' + esc(M.cold().why) + '</div></div>';
      if (!M || !M.hot || !M.hot()) h += '<div class="small">The first market round opens after your first batch: until then everything trades at list.</div>';
      const mats = new Set(); (r ? r.cards : []).forEach((L) => Object.keys(L.declared).forEach((m) => { if (L.declared[m] >= 0.01 || CS.Sim.PRECIOUS.indexOf(m) >= 0) mats.add(m); }));
      const view = M && M.view ? M.view() : null;
      h += '<div class="mk-t"><div class="r h"><span>IN THE BINS</span><span>$/t</span><span></span></div>';
      CS.MAT_ORDER.filter((m) => mats.has(m)).forEach((m) => {
        const f = factor(m), t = view ? (view.trend[m] || 0) : 0, p = MATERIALS[m].sell * CS.Sim.prices.market * f;
        h += '<div class="r"><span><i style="background:' + MATERIALS[m].color + '"></i>' + esc(MATERIALS[m].name) + '</span><span>' + money(p) + '</span><span class="' + (t > 0.0005 ? 'up' : t < -0.0005 ? 'down' : '') + '">' + (t > 0.0005 ? '&#9650;' : t < -0.0005 ? '&#9660;' : '') + '×' + f.toFixed(2) + '</span></div>';
      });
      h += '</div><div class="small">Pure buckets sell at these prices; everything still mixed sells for nothing. A bin is worth what your sorters can pull out of it clean.</div>';
      return h;
    }
    function render() {
      if (!ov || ov.classList.contains('hidden')) return;
      const main = ov.querySelector('.round-main'), side = ov.querySelector('.round-side'), r = R();
      ov.querySelector('#round-title').textContent = r ? 'AUCTION · ROUND ' + r.n : 'AUCTION';
      side.innerHTML = marketHtml();
      if (!r || r.done) {
        let h = '<div class="pls">' + players() + '</div>';
        if (r && r.done) h += '<div class="rcards">' + r.cards.map(cardHtml).join('') + '</div>';
        const can = canStart();
        h += '<div class="round-next">' + (r && r.done && !r.won.you ? '<p class="warn">No bin for you this round: run your <b>MISC bin</b> (RE-RUN on the MISC bucket), then open the next round.</p>' : '') +
          (can ? '' : '<p class="small">' + (app.S.run ? 'A batch is running.' : 'Your yard still holds a bin: run it through the plant first.') + ' The next round opens when the yard is empty.</p>') +
          '<button type="button" class="primary" id="round-start"' + (can ? '' : ' disabled') + '>' + (r ? 'NEXT ROUND' : 'START THE AUCTION') + '</button></div>';
        main.innerHTML = h;
        const b = main.querySelector('#round-start'); if (b) b.addEventListener('click', () => { if (newRound()) render(); });
        return;
      }
      const L = card(), nb = nextBid(r.price, L.opening), mine = inFor('you'), lead = r.leader === 'you';
      main.innerHTML = '<div class="pls">' + players() + '</div><div class="rcards">' + r.cards.map(cardHtml).join('') + '</div>' +
        '<div class="round-act">' + (mine ? '<button type="button" class="primary" id="round-bid"' + (lead || busy || nb * L.tons > app.S.money ? ' disabled' : '') + '>' + (lead ? 'YOU LEAD' : 'BID ' + money(nb) + '/t · ' + money(nb * L.tons)) + '</button><button type="button" id="round-pass"' + (busy ? ' disabled' : '') + '>' + (lead ? 'HOLD (no one answers)' : 'PASS') + '</button>' : '<span class="small">' + (r.won.you ? 'You hold a card this round: the rest go among the rivals.' : 'You passed on this bin.') + '</span>') + '</div>' +
        '<div class="round-log">' + r.log.slice(-6).reverse().map((t) => '<div>' + esc(t) + '</div>').join('') + '</div>';
      const bb = main.querySelector('#round-bid'); if (bb) bb.addEventListener('click', youBid);
      const pb = main.querySelector('#round-pass'); if (pb) pb.addEventListener('click', () => { if (lead) { if (!rivalsAnswer()) sold(); render(); } else youPass(); });
    }

    /* ---- hooks ---- */
    app.on('load', (ext) => { const d = ext && ext.round; st = { n: d && d.n > 0 ? Math.floor(d.n) : 0, misc: !!(d && d.misc), open: null, last: d && d.last || null, seed: d && d.seed > 0 ? d.seed >>> 0 : newSeed() }; });
    if (app.S && app.S.ext && app.S.ext.round) { const d = app.S.ext.round; st.n = d.n || 0; st.misc = !!d.misc; }
    app.on('save', () => ({ round: { n: st.n, misc: st.misc, last: st.last, seed: st.seed } }));
    app.on('newgame', () => { st = { n: 0, misc: false, open: null, last: null, seed: newSeed() }; render(); });
    app.on('boot', build);
    app.on('render', render);
    CS.Round.live = {
      open, close, canStart, state: () => st,
      miscAllowed: () => st.misc,
      useMisc: () => { st.misc = false; app.save(); }
    };
  }
  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
