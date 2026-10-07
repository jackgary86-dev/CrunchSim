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
  const OPEN = 0.6, STEP = 0.05, STEP_MIN = 1, MIN_SIZE = 1500, BIN_SPREAD = [0.6, 1.5], BIN_BATCHES = 3;   // #327: a bin is at most three batches of your plant

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
      { const fit = feeds.filter((f) => budget / Math.max(1, A.worthOf(FEEDS[f].comp) * A.fairRatio(f)) <= BIN_BATCHES * Math.max(1, opts.limit || 30)); feeds = fit.length ? fit : feeds.slice().sort((a, b) => A.worthOf(FEEDS[b].comp) - A.worthOf(FEEDS[a].comp)).slice(0, 1); }   // #327: the richer scrap of the category when the cheap kind would fill hundreds of batches; #334: none fits, the richest feed (fewest tonnes for the budget)
      const L = A.genLot(rng, { feeds: [feeds[Math.floor(rng() * feeds.length)]], budget, market: opts.market || {}, limit: opts.limit || 30, clockH: opts.clockH || 0, id: (opts.id0 || 1) + k });
      const x = budget / L.ask;   // the bin is sized to the round at its asking price, down to 0.1 t for rich scrap
      const cap = BIN_BATCHES * Math.max(1, opts.limit || 30);   // #327: rounds keep pace: a bin runs in a few batches, not hundreds
      L.tons = x < 10 ? Math.max(0.1, Math.round(x * 10) / 10) : Math.round(Math.min(x, cap));
      L.cat = cat.id; L.catName = cat.name; L.opening = Math.max(1, Math.round(L.ask * OPEN));
      return L;
    });
  }
  function rivalPurse(R, size) { return Math.round(R.budget / 25000 * 2 * size); }
  /* the most rival R pays for card L, $/t: its own valuation (declared mix, trust, specialities, market) capped by its purse */
  function rivalMax(R, L, factor, size, scale) {
    const RV = CS.Rivals; if (!RV || !R) return 0;
    const v = RV.valuation(R, L, factor);
    return Math.max(0, Math.min(v, Math.floor(rivalPurse(R, size) * (scale || 1) / Math.max(L.tons, 0.01))));
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

  /* ---- the match (#72, #77) ----
   * A rival yard's result on a bin: what its plant recovers from the TRUE mix (the full sorted value of the lot at list
   * price, worthOf / WORTH_FACTOR, times its yield), less processing (12% of that value: power, wear, labour, yard) and what
   * it paid. Yields: an established shredder recovers about half to two thirds of the full sorted value; the copper
   * specialist's sensor sorter pulls more out of non-ferrous and electronics bins. A yard without a bin re-runs its MISC
   * for a little (2% of the round's bin size). Each yard's purse grows with the square root of its net worth over the start. */
  const MATCH_LENGTHS = [8, 12, 20], MATCH_DEFAULT = 12;
  const YIELD = { ironside: 0.5, magpie: 0.46, redline: 0.55 }, SPECIAL = { redline: { nonferrous: 0.66, precious: 0.66 } };   // tuned by tests/rivals-match.js (#83)
  const PROCESS = 0.12, MISC_RUN = 0.02;
  const COLORS = { you: '#7fe3ff', ironside: '#e07a5f', magpie: '#e9c46a', redline: '#ef476f' };
  function fullValue(L) { const A = CS.Auction; return A.worthOf(L.truth || L.declared) / A.WORTH_FACTOR; }
  function rivalYield(id, L) { return (SPECIAL[id] && SPECIAL[id][L.cat]) || YIELD[id] || 0.5; }
  function rivalProfit(id, L, perT) { const v = fullValue(L) * L.tons; return v * rivalYield(id, L) - v * PROCESS - perT * L.tons; }
  function purseScale(worth, start) { return Math.sqrt(Math.min(9, Math.max(0.25, start > 0 ? worth / start : 1))); }
  function machinesOf(worth, start) { return Math.min(10, 2 + Math.max(0, Math.floor(2 * Math.log2(Math.max(1, start > 0 ? worth / start : 1))))); }
  /* why a rival will not top a price: not interested at all, out of money, or past its own valuation */
  function foldReason(R, L, factor, size, scale, nb) {
    const RV = CS.Rivals; if (!RV || !R) return '';
    const v = RV.valuation(R, L, factor);
    if (!(v > 0)) return R.wants ? 'no ' + R.wants.join(' or ') + ' in it' : 'not interested';
    if (rivalPurse(R, size) * (scale || 1) / Math.max(L.tons, 0.01) < nb) return 'over its purse';
    return 'not worth ' + Math.round(nb) + '/t to them';
  }
  function standings(rows) { return rows.slice().sort((a, b) => b.worth - a.worth).map((r, i) => Object.assign({ place: i + 1 }, r)); }

  /* #171: a yard buys on trade credit: a won bin may take the bank down to -$5,000 (repaid from sales; it counts against worth),
   * so one bad bin does not lock a player out of the rest of the match */
  const CREDIT = 5000;
  CS.Round = { CREDIT, CATEGORIES, PLAYERS, OPEN, STEP, STEP_MIN, MIN_SIZE, BIN_SPREAD, BIN_BATCHES, roundSize, nextBid, makeCards, rivalPurse, rivalMax, settleRivals,
    MATCH_LENGTHS, MATCH_DEFAULT, YIELD, SPECIAL, PROCESS, MISC_RUN, COLORS, fullValue, rivalYield, rivalProfit, purseScale, machinesOf, foldReason, standings };

  /* ======================= page integration ======================= */
  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.roundStarted) return; app.roundStarted = true;
    const A = () => CS.Auction, RV = () => CS.Rivals;
    const newSeed = () => (Date.now() ^ 0x5bd1e995) >>> 0;   // a game's own seed, saved with it: every new game deals different rounds, a reload replays them
    const newMatch = (len) => ({ length: len || MATCH_DEFAULT, start: 0, over: false, you: { bins: 0, t: 0 }, rivals: {} });
    let st = { n: 0, misc: false, open: null, last: null, seed: newSeed(), match: newMatch() };   // misc: you won no card last round, so MISC may run
    let ov = null, busy = false;
    const $ = (s) => document.querySelector(s);
    const esc = (s) => app.esc(s), money = (x) => app.fmtMoney(x);
    const factor = (m) => (CS.Sim.prices.perMat && CS.Sim.prices.perMat[m]) || 1;
    const rival = (id) => RV() && RV().rivalById(id);
    const nameOf = (id) => id === 'you' ? 'You' : (rival(id) ? rival(id).name : id);
    const yardEmpty = () => { const L = A() && A().live; return !L || (!L.pending() && !(L.yard() && L.yard().length)); };
    const stockValue = () =>   /* only sizes the auction round (roundSize): net worth now includes stock itself (#214) */  { const I = CS.Inventory; if (!I) return 0; let v = 0; const s = I.stock(); for (const m in s) v += I.quote ? I.quote(m) : 0; return v; };
    function canStart() { return !app.S.run && yardEmpty() && !(st.open && !st.open.done) && !st.match.over && !st.match.ending; }
    const M_ = () => st.match;
    function rivalRec(id) { const m = M_(); return m.rivals[id] || (m.rivals[id] = { worth: m.start, bins: 0, t: 0, best: null }); }
    const blank = () => ({ worth: app.netWorth(), bins: 0, t: 0, best: null });   // #112: before round 1 every yard starts where you do
    const recOf = (id) => (st.n === 0 ? blank() : rivalRec(id));
    /* #108: the match ends once the last round's bin is processed (yard empty, line idle); the standings are then frozen */
    const miscT = () => { const I = CS.Inventory; return I && I.misc ? I.miscTotal(I.misc()) : 0; };
    /* #305: a last round with no bin for you waits for your one MISC batch (or END THE MATCH) before the standings freeze */
    const waitMisc = () => st.misc && miscT() >= 1;
    function checkEnd(force) {
      const m = M_(); if (!m.ending || m.over || app.S.run || !yardEmpty() || (waitMisc() && !force)) return false;
      m.over = true; m.ending = false; st.misc = false;
      setTimeout(() => { const top = standings(['you'].concat(PLAYERS.filter((id) => rival(id))).map((id) => ({ id, worth: m.final ? m.final[id] : 0 })))[0]; snd(top && top.id === 'you' ? 'matchwin' : 'matchlose'); }, 400);   // #118
      m.final = {}; ['you'].concat(PLAYERS.filter((id) => rival(id))).forEach((id) => { m.final[id] = id === 'you' ? app.netWorth() : rivalRec(id).worth; });
      app.log('The match is over after ' + st.n + ' rounds. Final standings are on the auction screen.', 'ok');
      app.save(); render(); return true;
    }

    /* ---- a round ---- */
    function newRound() {
      if (!canStart()) return false;
      if (st.n === 0) { const m = M_(); m.start = app.netWorth(); m.over = false; m.ending = false; m.final = null; PLAYERS.forEach((id) => { if (rival(id)) m.rivals[id] = { worth: m.start, bins: 0, t: 0, best: null }; }); }
      st.n++; st.misc = false;
      const rng = CS.Auction.mulberry32((st.seed ^ Math.imul(st.n, 2654435761) ^ Math.floor(app.S.clock)) >>> 0);
      const size = roundSize(app.S.money, stockValue());
      const cards = makeCards(rng, size, { market: {}, limit: app.plantValue('logistics'), clockH: app.S.clock / 3600, id0: 3000 + st.n * 10 });
      const players = ['you'].concat(PLAYERS.filter((id) => rival(id)));
      const scales = {}; players.forEach((id) => { if (id !== 'you') scales[id] = purseScale(rivalRec(id).worth, M_().start); });
      const maxes = cards.map((L) => { const o = {}; players.forEach((id) => { if (id !== 'you') o[id] = rivalMax(rival(id), L, factor, size, scales[id]); }); return o; });
      st.open = { n: st.n, size, cards, maxes, scales, k: 0, price: 0, leader: null, out: [], won: {}, passed: false, log: [], done: false, folded: {}, pop: 0 };
      snd('bell');   // #117: the round opens
      app.log('Auction round ' + st.n + ': three bins on the table, ' + cards.map((L) => L.catName.toLowerCase() + ' (' + fmtT(L.tons) + ' of ' + L.headline + ')').join(', ') + '.', 'ok');
      return true;
    }
    const fmtT = (t) => t >= 10 ? Math.round(t) + ' t' : t.toFixed(1) + ' t';
    const snd = (kind, k) => { if (CS.Audio && CS.Audio.sfx) CS.Audio.sfx(kind, k); };
    const R = () => st.open, card = () => R() && R().cards[R().k];
    const inFor = (id) => !R().won[id] && R().out.indexOf(id) < 0;
    function say(t) { R().log.push(t); if (R().log.length > 40) R().log.shift(); }
    /* rivals answer: the first rival (in table order from a rotating start) able to top the price raises one step */
    function rivalsAnswer() {
      const r = R(), L = card(), order = PLAYERS.slice(r.k).concat(PLAYERS.slice(0, r.k));
      for (const id of order) {
        if (!rival(id) || !inFor(id) || r.leader === id) continue;
        const nb = nextBid(r.price, L.opening);
        if ((r.maxes[r.k][id] || 0) >= nb) { if (r.leader === 'you') snd('outbid'); r.price = nb; r.leader = id; r.pop++; snd('bid', 2 + PLAYERS.indexOf(id) * 3); say(nameOf(id) + ' bids ' + money(nb) + '/t'); return true; }
        const key = r.k + ':' + id;
        if (!r.folded[key] && r.price > 0) { r.folded[key] = true; say(nameOf(id) + ' folds: ' + foldReason(rival(id), L, factor, r.size, r.scales[id], nb)); }
      }
      return false;
    }
    function youBid() {
      const r = R(), L = card(); if (!r || r.done || busy || !inFor('you') || r.leader === 'you') return;
      const nb = nextBid(r.price, L.opening);
      if (nb * L.tons > app.S.money + CREDIT) { app.log('A bid of ' + money(nb) + '/t on ' + fmtT(L.tons) + ' commits ' + money(nb * L.tons) + '; the bank holds ' + money(app.S.money) + ' with a ' + money(CREDIT) + ' credit line.', 'warn'); return; }
      r.price = nb; r.leader = 'you'; r.pop++; r.bidOn = r.k; snd('bid', 0); say('You bid ' + money(nb) + '/t');
      busy = true; render();
      const live = () => R() === r && !r.done && r.k < r.cards.length;   // a reload, a new game or a mode switch ends these timers
      setTimeout(() => {
        if (!live()) { busy = false; return; }
        if (rivalsAnswer()) { busy = false; render(); return; }
        snd('going'); say('Going once...'); render();   // #117: the auctioneer's count before the gavel
        setTimeout(() => { if (!live()) { busy = false; return; } snd('going'); say('Going twice...'); render(); setTimeout(() => { busy = false; if (live()) { sold(); render(); } }, 380); }, 380);
      }, 450);
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
        r.won[r.leader] = { k: r.k, perT: r.price }; r.justWon = r.leader;   // #127: that yard flashes on the next draw
        if (r.leader === 'you') {
          const ok = A().live.deliver(Object.assign({}, L), r.price, 'Won at auction round ' + r.n + ':', CREDIT);
          if (!ok) { delete r.won.you; say('You could not pay: the bin goes to the next bidder'); r.out.push('you'); r.leader = null; r.price = 0; settleWithoutYou(); return; }
          else { M_().you.bins++; M_().you.t += L.tons; }
        } else {
          const rec = rivalRec(r.leader), pr = rivalProfit(r.leader, L, r.price);
          rec.worth += pr; rec.bins++; rec.t += L.tons; if (!rec.best || pr > rec.best.profit) rec.best = { profit: pr, what: L.headline };
          const rs = RV() && RV().live && RV().live.state && RV().live.state(); const x = rs && rs.rivals && rs.rivals[r.leader];
          if (x) { x.lots = (x.lots || 0) + 1; x.lotT = (x.lotT || 0) + L.tons; x.spent = (x.spent || 0) + r.price * L.tons; }
          app.log(L.catName + ' bin (' + fmtT(L.tons) + ' of ' + L.headline + ') to ' + nameOf(r.leader) + ' at ' + money(r.price) + '/t, ' + money(r.price * L.tons) + '.');
        }
      } else { say('No bids: the ' + L.catName.toLowerCase() + ' bin goes unsold'); app.log(L.catName + ' bin unsold: nobody met the opening price.'); }
      if (r.leader && CS.Audio && CS.Audio.fx) CS.Audio.fx('gavel');   // #81
      if (r.leader === 'you') setTimeout(() => snd('win'), 350); else if (r.leader && r.bidOn === r.k) setTimeout(() => snd('lose'), 350);   // #117
      if (!r.leader) r.justWon = null;
      r.k++; r.price = 0; r.leader = null; r.out = [];
      if (r.k >= r.cards.length) return finish();
      if (!inFor('you')) { const rr = r, kk = r.k; setTimeout(() => { if (R() === rr && !rr.done && rr.k === kk) settleWithoutYou(); }, 350); }   // you hold a card: the rest go among the rivals
      render();
    }
    function finish() {
      const r = R(); r.done = true;
      const empty = ['you'].concat(PLAYERS).filter((id) => (id === 'you' || rival(id)) && !r.won[id]);
      const last = st.n >= M_().length;
      if (!r.won.you) {
        st.misc = true;
        const mt = miscT();
        app.log('Round ' + r.n + ': no bin for you. ' + (mt >= 1 ? 'Run your MISC bin: one batch of the ' + fmtT(mt) + ' of mixed material waiting (RE-RUN on the MISC bucket).' + (last ? ' The match ends when that batch is done (or END THE MATCH on the auction screen).' : '') : last ? 'Your MISC bin is empty.' : 'Your MISC bin is empty; open the next round when you are ready.'), 'warn');
      }
      empty.filter((id) => id !== 'you').forEach((id) => { rivalRec(id).worth += MISC_RUN * r.size; app.log(nameOf(id) + ' left round ' + r.n + ' without a bin and re-ran its MISC.'); });
      if (last) { M_().ending = true; if (!checkEnd() && !waitMisc()) app.log('Last round done: the match ends when your yard is empty and the plant has finished.', 'ok'); }
      st.last = { n: r.n, won: Object.assign({}, r.won), cards: r.cards.map((L) => ({ cat: L.catName, headline: L.headline, tons: L.tons })) };
      app.save(); app.markDirty(true); render();
    }

    /* ---- the overlay ---- */
    function build() {
      if (ov) return;
      ov = document.createElement('div'); ov.className = 'overlay hidden'; ov.id = 'round';
      ov.innerHTML = '<div class="sheet wide"><div class="sheet-h"><b id="round-title">AUCTION</b><button type="button" class="danger" id="round-close">CLOSE</button></div><div class="sheet-b round-b"><div class="round-main"></div><div class="round-side"></div></div></div>';
      document.body.appendChild(ov);
      if (CS.Overlays) CS.Overlays.attach(ov, { labelledby: 'round-title', close: '#round-close' });
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('#round-close').addEventListener('click', close);
    }
    function open() {
      build(); ov.classList.remove('hidden'); render();
      const r = R(); if (r && !r.done && !busy && card() && !inFor('you') && !r.settling) { r.settling = true; const kk = r.k; setTimeout(() => { r.settling = false; if (R() === r && !r.done && r.k === kk) { settleWithoutYou(); render(); } }, 350); }   // a restored round where you are out: the rivals finish the bin
    }
    function close() { if (ov) ov.classList.add('hidden'); }
    function compBar(c) { return '<div class="rc-comp">' + Object.entries(c).sort((a, b) => b[1] - a[1]).map((e) => '<i style="flex:' + e[1].toFixed(4) + ';background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div>'; }
    function heavy(c) { const e = Object.entries(c).sort((a, b) => b[1] - a[1]); const tops = e.slice(0, 3).filter((x) => x[1] >= 0.02).map((x) => MATERIALS[x[0]].name.toLowerCase() + ' ' + Math.round(x[1] * 100) + '%'); const prec = e.filter((x) => CS.Sim.PRECIOUS.indexOf(x[0]) >= 0 && x[1] > 0 && x[1] < 0.02).map((x) => MATERIALS[x[0]].name.toLowerCase() + ' ' + Math.round(x[1] * 1e6) + ' g/t'); return tops.concat(prec).join(', '); }
    const worthOf = (id) => { const m = M_(); if (m.final && m.final[id] != null) return m.final[id]; return id === 'you' ? app.netWorth() : recOf(id).worth; };
    function emblem(id) { return '<i class="emb" style="background:' + COLORS[id] + '">' + (id === 'you' ? 'Y' : nameOf(id)[0]) + '</i>'; }
    function players() {
      const r = R(), m = M_();
      return ['you'].concat(PLAYERS.filter((id) => rival(id))).map((id) => {
        const R0 = rival(id), w = r && r.won[id], rec = id === 'you' ? m.you : recOf(id);
        const status = w ? 'won ' + r.cards[w.k].catName.toLowerCase() : r && !r.done && card() && r.leader === id ? 'leading' : r && !r.done && card() && !inFor(id) ? 'out' : '';
        const plant = id === 'you' ? app.S.line.length + ' machines' : machinesOf(rec.worth, m.start) + ' machines';
        const bid = r && !r.done && r.leader === id && r.pop ? ' paddle' + (r.pop % 2) : '', got = r && r.justWon === id ? ' gotbin' : '';
        return '<div class="pl' + (id === 'you' ? ' you' : '') + (r && r.leader === id && !r.done ? ' lead' : '') + (w ? ' won' : '') + bid + got + '" style="--pc:' + COLORS[id] + '"><b>' + emblem(id) + esc(nameOf(id)) + '</b>' +
          '<span>' + (id === 'you' ? 'you' : esc(R0.label)) + ' · ' + plant + '</span>' +
          '<span class="pl-w">' + money(worthOf(id)) + ' <small>worth · ' + rec.bins + ' bin' + (rec.bins === 1 ? '' : 's') + '</small></span>' + (status ? '<em>' + esc(status) + '</em>' : '') + '</div>';
      }).join('');
    }
    function standingsHtml() {
      const m = M_(), rows = standings(['you'].concat(PLAYERS.filter((id) => rival(id))).map((id) => ({ id, worth: worthOf(id), bins: id === 'you' ? m.you.bins : recOf(id).bins, t: id === 'you' ? m.you.t : recOf(id).t })));
      const win = rows[0];
      return '<div class="standings"><h3>FINAL STANDINGS · ' + m.length + ' ROUNDS</h3><p class="' + (win.id === 'you' ? 'ok' : 'warn') + '">' + (win.id === 'you' ? 'You win the match.' : esc(nameOf(win.id)) + ' wins the match.') + '</p>' +
        '<div class="st-t"><div class="r h"><span>#</span><span>YARD</span><span>NET WORTH</span><span>BINS</span><span>TONNES</span></div>' +
        rows.map((x) => '<div class="r' + (x.id === 'you' ? ' you' : '') + '"><span>' + x.place + '</span><span>' + emblem(x.id) + esc(nameOf(x.id)) + '</span><span>' + money(x.worth) + '</span><span>' + x.bins + '</span><span>' + fmtT(x.t) + '</span></div>').join('') + '</div>' +
        '<button type="button" class="primary" id="round-rematch">REMATCH</button></div>';
    }
    /* category art (#71): a small drawing of what is in the bin */
    const ART = {
      ferrous: '<path d="M8 30 L14 20 H36 L44 28 H56 V36 H8 Z" fill="#8a96a3"/><circle cx="18" cy="37" r="5" fill="#2b323b" stroke="#8a96a3" stroke-width="2"/><circle cx="46" cy="37" r="5" fill="#2b323b" stroke="#8a96a3" stroke-width="2"/>',
      nonferrous: '<rect x="10" y="22" width="18" height="14" rx="2" fill="#cfd9e2"/><rect x="30" y="18" width="22" height="18" rx="2" fill="#d98a5b"/><path d="M14 16 q6 -8 12 0" stroke="#d9b94e" stroke-width="3" fill="none"/>',
      precious: '<rect x="8" y="12" width="48" height="26" rx="2" fill="#2e6b3f"/><path d="M14 18 H28 V30 H40 M44 16 V34" stroke="#f2c94c" stroke-width="2" fill="none"/><rect x="30" y="20" width="8" height="8" fill="#1d2228"/><rect x="8" y="34" width="48" height="4" fill="#f2c94c"/>',
      wood: '<rect x="8" y="16" width="48" height="5" fill="#a57a4a"/><rect x="8" y="26" width="48" height="5" fill="#a57a4a"/><rect x="8" y="36" width="48" height="5" fill="#a57a4a"/><rect x="10" y="16" width="5" height="25" fill="#8a643a"/><rect x="30" y="16" width="5" height="25" fill="#8a643a"/><rect x="49" y="16" width="5" height="25" fill="#8a643a"/>',
      rubber: '<circle cx="24" cy="28" r="13" fill="#2b2f36" stroke="#555c66" stroke-width="3"/><circle cx="24" cy="28" r="5" fill="#0b1018"/><circle cx="44" cy="30" r="10" fill="#2b2f36" stroke="#555c66" stroke-width="3"/><circle cx="44" cy="30" r="4" fill="#0b1018"/>',
      aggregate: '<path d="M8 40 L16 26 L26 30 L32 18 L42 24 L50 20 L56 40 Z" fill="#9aa0a6"/><path d="M16 26 L22 40 M32 18 L36 40 M50 20 L46 40" stroke="#6f757b" stroke-width="2"/>',
      mixed: '<path d="M6 18 H58 L52 40 H12 Z" fill="#6b8e7f"/><rect x="14" y="12" width="8" height="8" fill="#cfd9e2"/><rect x="26" y="8" width="10" height="12" fill="#a57a4a"/><circle cx="44" cy="14" r="5" fill="#2b2f36"/>',
      gels: '<rect x="14" y="10" width="16" height="30" rx="3" fill="#5fa8d3"/><rect x="34" y="10" width="16" height="30" rx="3" fill="#4a90b8"/><rect x="14" y="18" width="16" height="3" fill="#2f6f93"/><rect x="34" y="18" width="16" height="3" fill="#2f6f93"/>'
    };
    function artOf(cat) { return '<svg viewBox="0 0 64 48" class="rc-art" aria-hidden="true">' + (ART[cat] || ART.mixed) + '</svg>'; }
    /* the bid guide: what your line would make of this bin per tonne (on its declaration), against the price */
    function estHtml(L) {
      const e = app.lotEstimate ? app.lotEstimate(L.sample || L.declared) : null; if (e == null) return '';
      return '<div class="rc-d est' + (e <= 0 ? ' bad' : '') + '" title="What your line as it stands would make of this mix, after power and wear, before the price you pay. Bid below it to profit.">YOUR LINE: ~' + money(Math.max(0, e)) + '/t' + (e <= 0 ? ' (it cannot sort this)' : '') + '</div>';
    }
    function cardHtml(L, k) {
      const r = R(), now = !r.done && r.k === k, w = Object.keys(r.won).find((id) => r.won[id].k === k);
      const done = k < r.k || r.done;
      let foot = '';
      if (now) foot = '<div class="rc-price' + (r.pop ? ' pop' + (r.pop % 2) : '') + '"' + (r.leader ? ' style="color:' + COLORS[r.leader] + '"' : '') + '>' + (r.price > 0 ? money(r.price) + '/t · ' + money(r.price * L.tons) + '<span>' + emblem(r.leader) + esc(nameOf(r.leader)) + ' leads</span>' : 'opens at ' + money(L.opening) + '/t · ' + money(L.opening * L.tons)) + '</div>';
      else if (done) foot = '<div class="rc-price sold">' + (w ? 'SOLD to ' + esc(nameOf(w)) + ' · ' + money(r.won[w].perT) + '/t' : 'UNSOLD') + '</div>' + (w ? '<div class="stamp" style="color:' + COLORS[w] + ';border-color:' + COLORS[w] + '">SOLD · ' + esc(w === 'you' ? 'YOU' : nameOf(w).split(' ')[0].toUpperCase()) + '</div>' : '');
      else foot = '<div class="rc-price wait">up next · opens at ' + money(L.opening) + '/t</div>';
      return '<div class="rcard' + (now ? ' now' : '') + (done ? ' done' : '') + (w === 'you' ? ' mine' : '') + (w ? ' sold' : '') + '"><div class="rc-cat" style="border-color:' + (CATEGORIES.find((c) => c.id === L.cat) || {}).color + '">' + esc(L.catName.toUpperCase()) + '</div>' +
        '<div class="rc-artwrap">' + artOf(L.cat) + '<div class="rc-bin"><div class="rc-fill">' + Object.entries(L.declared).sort((a, b) => a[1] - b[1]).map((e) => '<i style="flex:' + e[1].toFixed(4) + ';background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div></div></div>' +
        '<div class="rc-h"><b>' + fmtT(L.tons) + '</b> of ' + esc(L.headline) + '</div>' +
        '<div class="rc-d">Declared: ' + esc(heavy(L.declared)) + '</div>' + compBar(L.declared) + estHtml(L) +
        (L.sample ? '<div class="rc-d sampled">Sampled: ' + esc(heavy(L.sample)) + '</div>' + compBar(L.sample) : '') +
        '<div class="rc-d small">' + esc(L.seller) + ' <span class="rep">(' + esc(A().live.rep ? A().live.rep(L.seller) : '') + ')</span>: ' + esc(L.note) + '</div>' +
        (!r.done && k >= r.k && !L.sample && !r.sampled && r.leader !== 'you' && !r.won.you ? '<button type="button" class="samp" data-k="' + k + '">SAMPLE ' + money(A().sampleFee(L, L.opening)) + '</button>' : '') + foot + '</div>';
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
      ov.querySelector('#round-title').textContent = st.n > 0 ? 'AUCTION · ROUND ' + st.n + ' OF ' + M_().length : 'AUCTION · A MATCH OF ' + M_().length + ' ROUNDS';
      side.innerHTML = marketHtml();
      if (!r || r.done) {
        let h = '<div class="pls">' + players() + '</div>';
        if (M_().over) {
          h += standingsHtml(); main.innerHTML = h;
          const rb = main.querySelector('#round-rematch'); if (rb) rb.addEventListener('click', () => { const len = M_().length; close(); app.softReset(); M_().length = len; app.save(); });
          return;
        }
        if (r && r.done) h += '<div class="rcards">' + r.cards.map(cardHtml).join('') + '</div>';
        if (st.n === 0) h += '<div class="match-len"><span>Match length</span>' + MATCH_LENGTHS.map((n) => '<button type="button" class="ml' + (n === M_().length ? ' on' : '') + '" data-len="' + n + '">' + n + ' rounds</button>').join('') + '<span class="small">Most net worth after the last round wins.</span></div>';
        const can = canStart();
        if (M_().ending && waitMisc()) {   // #305: the last round left you without a bin: your MISC batch counts before the match ends
          const idle = !app.S.run && yardEmpty();
          h += '<div class="round-next"><p class="warn">Last round and no bin for you: run one batch of your <b>MISC bin</b> (RE-RUN on the MISC bucket) and the match ends when it is done, or end it now.</p>' + (idle ? '' : '<p class="small">A batch is running: the match ends when it is done.</p>') +
            '<button type="button" id="round-end"' + (idle ? '' : ' disabled') + '>END THE MATCH</button></div>';
          main.innerHTML = h;
          const eb = main.querySelector('#round-end'); if (eb) eb.addEventListener('click', () => { if (checkEnd(true)) render(); });
          return;
        }
        h += '<div class="round-next">' + (r && r.done && !r.won.you ? (miscT() >= 1 ? '<p class="warn">No bin for you this round: run one batch of your <b>MISC bin</b> (RE-RUN on the MISC bucket), then open the next round.</p>' : '<p class="warn">No bin for you this round, and your MISC bin holds under 1 t: nothing to run this round.</p>') : '') +
          (can ? '' : '<p class="small">' + (app.S.run ? 'A batch is running.' : M_().ending ? 'The last bin is in your yard: run it through the plant to end the match.' : 'Your yard still holds a bin: run it through the plant first.') + ' The next round opens when the yard is empty.</p>') +
          '<button type="button" class="primary" id="round-start"' + (can ? '' : ' disabled') + '>' + (M_().ending ? 'RUN THE LAST BIN TO FINISH' : st.n > 0 ? 'NEXT ROUND · ' + (st.n + 1) + ' OF ' + M_().length : 'START THE MATCH') + '</button></div>';
        main.innerHTML = h;
        const b = main.querySelector('#round-start'); if (b) b.addEventListener('click', () => { if (newRound()) render(); });
        main.querySelectorAll('.ml').forEach((x) => x.addEventListener('click', () => { M_().length = +x.dataset.len; render(); }));
        return;
      }
      const L = card(), nb = nextBid(r.price, L.opening), mine = inFor('you'), lead = r.leader === 'you';
      const deal = !r.dealt; r.dealt = true;   // #127: the three cards are dealt in once, when the round opens
      main.innerHTML = '<div class="pls">' + players() + '</div><div class="rcards' + (deal ? ' deal' : '') + '">' + r.cards.map(cardHtml).join('') + '</div>' +
        '<div class="round-act">' + (mine ? '<button type="button" class="primary" id="round-bid"' + (lead || busy || nb * L.tons > app.S.money + CREDIT ? ' disabled' : '') + '>' + (lead ? 'YOU LEAD' : 'BID ' + money(nb) + '/t · ' + money(nb * L.tons)) + '</button><button type="button" id="round-pass"' + (busy ? ' disabled' : '') + '>' + (lead ? 'HOLD (no one answers)' : 'PASS') + '</button>' : '<span class="small">' + (r.won.you ? 'You hold a card this round: the rest go among the rivals.' : 'You passed on this bin.') + '</span>') + '</div>' +
        '<div class="round-log">' + r.log.slice(-6).reverse().map((t) => '<div>' + esc(t) + '</div>').join('') + '</div>';
      if (r.justWon) setTimeout(() => { if (R() === r) r.justWon = null; }, 900);
      const bb = main.querySelector('#round-bid'); if (bb) bb.addEventListener('click', youBid);
      main.querySelectorAll('.samp').forEach((x) => x.addEventListener('click', () => { const L2 = r.cards[+x.dataset.k]; if (A().live.sample(L2, L2.opening)) { r.sampled = true; render(); } }));   // one sample a round (#75)
      const pb = main.querySelector('#round-pass'); if (pb) pb.addEventListener('click', () => { if (lead) { if (!rivalsAnswer()) sold(); render(); } else youPass(); });
    }

    /* ---- hooks ---- */
    function restore(ext) {
      const d = ext && ext.round;
      st = { n: d && d.n > 0 ? Math.floor(d.n) : 0, misc: !!(d && d.misc), open: d && d.open && Array.isArray(d.open.cards) && d.open.cards.length && !d.open.done ? d.open : null, last: d && d.last || null, seed: d && d.seed > 0 ? d.seed >>> 0 : newSeed(), match: d && d.match && d.match.length ? d.match : newMatch() };
      if (st.open) st.open.settling = false;   // #306: a settle timer never outlives the page that started it
      if (st.match.over) st.misc = false;   // #305: an older save that ended with st.misc still set
      busy = false; setTimeout(() => checkEnd(), 0);
    }
    app.on('load', restore);   // #264: a match left in 'ending' by a tab closed before the batchComplete timer ends on load. #107: an open round survives a reload or a mode switch
    if (app.S && app.S.ext && app.S.ext.round) restore(app.S.ext);   // #309: registered after boot: the 'load' event has already fired
    app.on('save', () => ({ round: { n: st.n, misc: st.misc, last: st.last, seed: st.seed, match: st.match, open: st.open && !st.open.done ? Object.assign({}, st.open, { settling: false }) : null } }));   // #306: never persist settling
    app.on('batchComplete', () => { setTimeout(checkEnd, 0); });
    // #319: shipping out or refining the MISC also settles a last round that was waiting for it
    const endSoon = () => { if (M_().ending && !M_().over) setTimeout(() => { if (checkEnd()) render(); }, 0); };
    app.on('render', endSoon); app.on('sale', endSoon); app.on('income', endSoon); app.on('refined', endSoon);
    app.on('newgame', () => { st = { n: 0, misc: false, open: null, last: null, seed: newSeed(), match: newMatch() }; busy = false; render(); setTimeout(matchPlant, 0); });
    /* A Rivals yard starts on a par with the yards it bids against (#171): established shredder yards run the classic car
     * shredder line (hammermill, zig-zag air, magnet, eddy current, sink-float), so a new match starts with that line rather
     * than the Progress starter kit. The balance (tests/rivals-match.js) assumes a plant with a few sorters. Only a fresh
     * match: no batch run, no round played, the starter line still in place. */
    function matchPlant() {
      const S = app.S, L = CS.LINES && CS.LINES.car;
      if (!S || S.mode !== 'rivals' || !L || S.batches > 0 || st.n > 0 || S.run) return;
      if (S.line.length > 2 || L.nodes.every((n) => S.owned.has(n.m))) return;
      L.nodes.forEach((n) => { S.owned.add(n.m); S.units[n.m] = Math.max(S.units[n.m] || 0, 1); });
      S.line = CS.Sim.buildLine(L); S.sel = S.line[0].uid; S.linePreset = 'car';
      app.log('Your Rivals yard runs a car shredder line, like the yards you bid against: hammermill, air classifier, magnet, eddy current and a sink-float tank.', 'ok');
      app.markDirty(true); app.save();
    }
    app.on('load', () => setTimeout(matchPlant, 0));
    app.on('boot', build);
    app.on('render', render);
    CS.Round.live = {
      open, close, canStart, state: () => st,
      miscAllowed: () => st.misc,
      /* the match table for other panels: every seat with its worth, bins and tonnes, ranked (#111) */
      table: () => { const m = M_(); return standings(['you'].concat(PLAYERS.filter((id) => rival(id))).map((id) => ({ id, name: nameOf(id), label: id === 'you' ? 'you' : rival(id).label, worth: worthOf(id), bins: id === 'you' ? m.you.bins : recOf(id).bins, t: id === 'you' ? m.you.t : recOf(id).t }))); },
      round: () => ({ n: st.n, length: M_().length, over: !!M_().over }),
      useMisc: () => { st.misc = false; app.save(); },
      ending: () => !!M_().ending && !M_().over,   // #325: the last round is waiting for your MISC batch
      endMatch: () => { const ok = checkEnd(true); if (ok) render(); return ok; }
    };
  }
  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
