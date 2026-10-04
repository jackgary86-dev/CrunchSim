/* CrunchSim module: intake. An intake stockpile per feed source, so feed is bought by the thousand tonnes ahead of
 * the batches that eat it (ticket #7).
 *
 * A pile is { name, t, comp, paid }: tonnes on the ground, the mass-weighted blend of every delivery's composition,
 * and the money paid for what is still there. BUY TO STOCKPILE pays today's feed price (the feed market scales a
 * preset's list price through the app's 'feedCost' query) for N tonnes of a preset or of the current hand mix.
 * RUN FROM STOCKPILE loads a pile's blend as the feed and marks it prepaid (S.feedPrepaid, as the auction does with a
 * won lot). When the batch starts the batch tonnage is drawn off the pile; whatever a stopped batch did not run goes
 * back on it, and a pile with tonnes left is reloaded for the next batch. Piles are keyed by preset id, or by the
 * whole-percent composition of a hand mix, so unrelated mixes never blend.
 *
 * The pure parts (blending, draw-down, keys, the hand-mix price, the yard cap, the lifetime tally, serialisation) live
 * on CS.Intake and touch no DOM, so tests/intake.js runs them in Node. The page part runs only once CS.app exists.
 *
 * Cost per frame: the 'tick' hook compares two short composition objects while a pile is loaded and does nothing
 * otherwise; the panel is redrawn on the app's 'render' event and on this module's own actions, never per frame. The
 * app's own run-loop renderers are throttled to 250 ms (tick() in app.js), so a 10,000 t batch at 60x costs the same
 * per frame as a 15 t one.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS || !CS.FEEDS) return;
  const MATERIALS = CS.MATERIALS, MAT_ORDER = CS.MAT_ORDER, FEEDS = CS.FEEDS;

  /* ---------------- pure functions ---------------- */
  // A yard holds about ten batches of feed: scrap yards and crusher run-of-mine pads carry one to two weeks of stock
  // ahead of a plant that turns a batch a day, and the Feed logistics upgrade (weighbridge, yard, rail siding) sets both.
  const YARD_BATCHES = 10;
  const MIX_DISCOUNT = 0.45;   // same arithmetic as feedCostPerT in app.js: a hand mix of several materials is bought at 45% of the blended buy price
  function sameComp(a, b) {
    a = a || {}; b = b || {};
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6) return false;
    return true;
  }
  /* copy of a composition with only known materials and positive fractions */
  function cleanComp(comp) { const c = {}; for (const m in (comp || {})) if (MATERIALS[m] && +comp[m] > 0) c[m] = +comp[m]; return c; }
  /* Mass-weighted blend of two compositions: tA tonnes of a with tB tonnes of b. Fractions are averaged as they are
   * (makeFeed in sim.js normalises), so adding a preset to its own pile leaves the preset's fractions exactly. */
  function blend(a, tA, b, tB) {
    a = cleanComp(a); b = cleanComp(b);
    const t = tA + tB; if (!(t > 0)) return a;
    const out = {}, keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(function (m) { const v = (tA * (a[m] || 0) + tB * (b[m] || 0)) / t; if (v > 0) out[m] = v; });
    return out;
  }
  function newPile(name, comp) { return { name: String(name || 'Stockpile'), t: 0, comp: cleanComp(comp), paid: 0 }; }
  /* add tonnes of comp bought for cost in total (negative when you were paid to take it) */
  function add(pile, comp, tonnes, cost) {
    if (!(tonnes > 0)) return pile;
    pile.comp = blend(pile.comp, pile.t, comp, tonnes);
    pile.t += tonnes; pile.paid += isFinite(+cost) ? +cost : 0;
    return pile;
  }
  /* take tonnes off the pile; returns what came off and its share of the money paid */
  function draw(pile, tonnes) {
    const t = Math.min(Math.max(0, +tonnes || 0), pile.t);
    const paid = pile.t > 0 ? pile.paid * t / pile.t : 0;
    pile.t -= t; pile.paid -= paid;
    if (pile.t < 1e-9) { pile.t = 0; pile.paid = 0; }
    return { t: t, paid: paid };
  }
  function paidPerT(pile) { return pile.t > 0 ? pile.paid / pile.t : 0; }
  /* 'steel58-castiron7-...' from the fractions rounded to whole percent, biggest first: two hand mixes that read the same
   * on the sliders share a pile */
  function sig(comp) {
    const c = cleanComp(comp); let tot = 0; for (const m in c) tot += c[m];
    return Object.keys(c).map(function (m) { return [m, Math.round(100 * c[m] / (tot || 1))]; })
      .filter(function (e) { return e[1] > 0; })
      .sort(function (x, y) { return y[1] - x[1] || (x[0] < y[0] ? -1 : 1); })
      .map(function (e) { return e[0] + e[1]; }).join('-');
  }
  function keyFor(presetId, comp) { return FEEDS[presetId] && sameComp(FEEDS[presetId].comp, comp) ? presetId : 'mix:' + sig(comp); }
  function nameFor(key, comp) {
    if (FEEDS[key]) return FEEDS[key].name;
    const top = Object.entries(cleanComp(comp)).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 3).map(function (e) { return MATERIALS[e[0]].name.toLowerCase(); });
    return 'Mix: ' + (top.join(', ') || 'empty');
  }
  /* price per tonne of a hand mix, the same arithmetic as feedCostPerT in app.js (one material pays its full buy price) */
  function mixCost(comp) {
    const c = cleanComp(comp); let tot = 0, cost = 0, n = 0;
    for (const m in c) { tot += c[m]; cost += c[m] * MATERIALS[m].buy; n++; }
    return tot > 0 ? (cost / tot) * (n > 1 ? MIX_DISCOUNT : 1) : 0;
  }
  function yardCap(batchCap) { return YARD_BATCHES * (batchCap > 0 ? batchCap : 0); }
  function stockTotal(piles) { let t = 0; for (const k in piles) if (piles[k] && piles[k].t > 0) t += piles[k].t; return t; }
  /* tonnes processed per material from a finished batch: bins are per head-tonne (Sim.binStats), scaled by the tonnes run */
  function addLifetime(life, bins, tonnes) {
    if (!(tonnes > 0)) return life;
    (bins || []).forEach(function (b) {
      const st = b && b.st; if (!st || !st.perMat) return;
      for (const m in st.perMat) { const pm = st.perMat[m]; if (pm && pm.mass > 0 && MATERIALS[m]) life[m] = (life[m] || 0) + pm.mass / 1000 * tonnes; }
    });
    return life;
  }
  function serialize(st) {
    const piles = {};
    for (const k in st.piles) { const p = st.piles[k]; if (p && p.t > 0) piles[k] = { name: p.name, t: p.t, comp: p.comp, paid: p.paid }; }
    return { piles: piles, life: Object.assign({}, st.life), loaded: st.loaded && piles[st.loaded] ? st.loaded : null };
  }
  /* rebuild validated state from a saved object; garbage is dropped or defaulted rather than trusted */
  function deserialize(d) {
    const st = { piles: {}, life: {}, loaded: null };
    if (!d || typeof d !== 'object') return st;
    const piles = d.piles && typeof d.piles === 'object' ? d.piles : {};
    for (const k in piles) {
      const p = piles[k]; if (!p || typeof p !== 'object' || !(+p.t > 0)) continue;
      const comp = cleanComp(p.comp); if (!Object.keys(comp).length) continue;
      st.piles[k] = { name: typeof p.name === 'string' && p.name ? p.name.slice(0, 60) : nameFor(k, comp), t: +p.t, comp: comp, paid: isFinite(+p.paid) ? +p.paid : 0 };
    }
    const life = d.life && typeof d.life === 'object' ? d.life : {};
    for (const m in life) if (MATERIALS[m] && +life[m] > 0) st.life[m] = +life[m];
    st.loaded = typeof d.loaded === 'string' && st.piles[d.loaded] ? d.loaded : null;
    return st;
  }

  CS.Intake = { YARD_BATCHES, MIX_DISCOUNT, sameComp, cleanComp, blend, newPile, add, draw, paidPerT, sig, keyFor, nameFor, mixCost, yardCap, stockTotal, addLifetime, serialize, deserialize };

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const app = CS.app; if (!app || app.intakeStarted) return; app.intakeStarted = true;
    let st = { piles: {}, life: {}, loaded: null }, settle = null, panel = null, els = null, lifeBox = null;
    const S = function () { return app.S; };
    const cap = function () { return app.plantValue('logistics'); };
    const fmtT = function (t) { return app.fmtNum(t, t >= 100 ? 0 : 1); };
    const compText = function (c) { return Object.entries(c).sort(function (a, b) { return b[1] - a[1]; }).filter(function (e) { return e[1] >= 0.005; }).slice(0, 5).map(function (e) { return app.esc(MATERIALS[e[0]].name) + ' ' + Math.round(e[1] * 100) + '%'; }).join(', '); };
    const compBar = function (c) { return '<div class="icomp">' + Object.entries(c).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return '<i style="width:' + (100 * e[1]) + '%;background:' + MATERIALS[e[0]].color + '"></i>'; }).join('') + '</div>'; };

    function restore(ext) { st = deserialize(ext && ext.intake); }
    app.on('load', restore);
    if (app.booted && app.S && app.S.ext) restore(app.S.ext);   // registered after boot: the 'load' event has already gone by
    app.on('save', function () { return { intake: serialize(st) }; });

    /* what can be bought: every preset with a supplier contract at its market price, and the current hand mix */
    function presetCost(id) { const q = { id: id, cost: FEEDS[id].cost }; app.emit('feedCost', q); return q.cost; }
    function sources() {
      const out = [], s = S();
      Object.keys(FEEDS).forEach(function (id) { if (s.suppliers.has(id)) out.push({ id: id, name: FEEDS[id].name, comp: FEEDS[id].comp, cost: presetCost(id) }); });
      if (s.feedPreset === 'custom' && !app.contract() && Object.keys(cleanComp(s.comp)).length) out.push({ id: 'current', name: 'Current hand mix', comp: cleanComp(s.comp), cost: mixCost(s.comp) });
      return out;
    }

    /* ---- panel ---- */
    function build() {
      if (panel) return;
      panel = app.addPanel('left', 'intake-panel', 'Intake stockpile', 'line-panel');
      panel.querySelector('h2').appendChild(app.el('span', 'tag', ''));
      panel.appendChild(app.el('div', 'small', 'Buy feed ahead by the thousand tonnes. A pile blends every delivery; RUN FROM STOCKPILE loads it prepaid and each batch draws its tonnage off the pile.'));
      panel.insertAdjacentHTML('beforeend',
        '<div class="row"><label for="intake-src">Source</label><select id="intake-src"></select></div>' +
        '<div class="row"><label for="intake-t">Tonnes</label><input type="number" id="intake-t" class="intake-t" min="1" step="1"><button id="intake-buy" type="button" class="buy">BUY</button></div>' +
        '<div id="intake-yard" class="small"></div><div id="intake-piles"></div>');
      els = { src: panel.querySelector('#intake-src'), t: panel.querySelector('#intake-t'), buy: panel.querySelector('#intake-buy'), yard: panel.querySelector('#intake-yard'), piles: panel.querySelector('#intake-piles'), tag: panel.querySelector('h2 .tag') };
      els.t.value = cap();
      els.src.addEventListener('change', updateBuy);
      els.t.addEventListener('input', updateBuy);
      els.buy.addEventListener('click', buy);
      const css = document.createElement('style');
      css.textContent = '#intake-panel .intake-t{width:72px;flex:none;background:var(--panel-2);border:1px solid var(--line-2);border-radius:3px;padding:4px 6px;font-family:var(--mono);font-size:12px}#intake-panel .intake-t:focus{outline:none;border-color:var(--cyan)}' +
        '#intake-panel #intake-buy{flex:1;white-space:nowrap;padding:5px 6px}#intake-panel .icomp{display:flex;height:5px;border-radius:3px;overflow:hidden;margin:4px 0 2px;background:var(--line)}#intake-panel .icomp i{display:block;height:100%}' +
        '#intake-panel .crow.loaded{border-color:var(--green)}#intake-panel .tons{color:var(--amber);font-family:var(--mono);white-space:nowrap}#intake-panel .crow button{width:92px;white-space:normal;line-height:1.3;padding:5px 6px}' +
        '#intake-life .r{display:grid;grid-template-columns:1fr 64px 60px;gap:6px;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);align-items:center}#intake-life .r.h{color:var(--muted);font-size:10px;letter-spacing:1px}' +
        '#intake-life .r span:nth-child(2){text-align:right}#intake-life .bar{height:4px;background:var(--line);border-radius:2px;overflow:hidden}#intake-life .bar i{display:block;height:100%;background:var(--cyan)}';
      panel.appendChild(css);
      // the lifetime tally is its own small block on the bank panel, above NEW GAME
      const bank = document.querySelector('#bank-panel');
      if (bank) {
        const h = app.el('h3', null, 'Lifetime processed'); lifeBox = app.el('div', null, ''); lifeBox.id = 'intake-life';
        const ng = bank.querySelector('#btn-newgame');
        if (ng) { bank.insertBefore(h, ng); bank.insertBefore(lifeBox, ng); } else { bank.appendChild(h); bank.appendChild(lifeBox); }
      }
    }
    function updateBuy() {
      if (!els) return;
      const s = sources().find(function (x) { return x.id === els.src.value; }), t = Math.floor(+els.t.value);
      const ok = !!s && t >= 1, cost = ok ? s.cost * t : 0;
      els.buy.textContent = ok ? (cost < 0 ? 'TAKE ' + app.fmtNum(t, 0) + ' t · +' + app.fmtMoney(-cost) : 'BUY ' + app.fmtNum(t, 0) + ' t · ' + app.fmtMoney(cost)) : 'BUY';
      els.buy.className = 'buy' + (ok && cost > S().money ? ' poor' : '');
      els.buy.disabled = !ok;
    }
    function render() {
      if (!els) return;
      const srcs = sources(), cur = els.src.value, c = cap();
      els.src.innerHTML = '';
      srcs.forEach(function (s) { els.src.appendChild(new Option(s.name + ' · ' + (s.cost < 0 ? 'paid ' + app.fmtMoney(-s.cost) : app.fmtMoney(s.cost)) + '/t', s.id)); });
      if (srcs.some(function (s) { return s.id === cur; })) els.src.value = cur;
      const total = stockTotal(st.piles), yc = yardCap(c);
      els.tag.textContent = fmtT(total) + ' T';
      els.yard.innerHTML = 'Yard holds <b class="num">' + app.fmtNum(yc, 0) + ' t</b> (' + YARD_BATCHES + ' batches of ' + c + ' t) · <b class="num">' + fmtT(Math.max(0, yc - total)) + ' t</b> free';
      updateBuy();
      const box = els.piles; box.innerHTML = '';
      const keys = Object.keys(st.piles).filter(function (k) { return st.piles[k].t > 0; }).sort(function (a, b) { return st.piles[b].t - st.piles[a].t; });
      if (!keys.length) box.appendChild(app.el('div', 'empty', 'The yard is empty. Buy feed to a stockpile above.'));
      const run = !!S().run, C = app.contract();
      keys.forEach(function (k) {
        const p = st.piles[k], loaded = st.loaded === k, ppt = paidPerT(p), batches = Math.ceil(p.t / c);
        const row = app.el('div', 'crow' + (loaded ? ' loaded' : ''), '<div class="ch"><b>' + app.esc(p.name.toUpperCase()) + '</b><span class="tons">' + fmtT(p.t) + ' t</span></div>' +
          '<div class="cd">' + compText(p.comp) + compBar(p.comp) + '</div>' +
          '<div class="cd">' + (ppt < 0 ? 'paid ' + app.fmtMoney(-ppt) + '/t to take' : 'bought at ' + app.fmtMoney(ppt) + '/t') + ' · ' + (loaded ? 'loaded as the feed, prepaid' : batches + ' batch' + (batches > 1 ? 'es' : '') + ' of up to ' + c + ' t') + '</div>');
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = loaded ? 'LOADED' : 'RUN FROM STOCKPILE'; b.className = loaded ? 'buy max' : 'buy'; b.disabled = loaded || run || !!C;
        b.title = C ? 'Release the contract first' : run ? 'Wait for the batch' : 'Load this pile as the feed; each batch draws its tonnage from it';
        b.addEventListener('click', function () { if (runFrom(k)) render(); });
        row.appendChild(b); box.appendChild(row);
      });
    }
    function renderLife() {
      if (!lifeBox) return;
      const rows = MAT_ORDER.filter(function (m) { return st.life[m] > 0; }).sort(function (a, b) { return st.life[b] - st.life[a]; });
      if (!rows.length) { lifeBox.innerHTML = '<div class="small">Tonnes processed per material, counted from the product bins of every finished batch.</div>'; return; }
      const max = st.life[rows[0]]; let tot = 0;
      let h = '<div class="r h"><span>MATERIAL</span><span>TONNES</span><span></span></div>';
      rows.forEach(function (m) {
        tot += st.life[m];
        h += '<div class="r"><span><i style="display:inline-block;width:8px;height:8px;background:' + MATERIALS[m].color + ';margin-right:5px;border-radius:2px"></i>' + app.esc(MATERIALS[m].name) + '</span><span>' + fmtT(st.life[m]) + '</span><span class="bar"><i style="width:' + Math.round(100 * st.life[m] / max) + '%"></i></span></div>';
      });
      h += '<div class="r h"><span>TOTAL</span><span>' + fmtT(tot) + '</span><span></span></div>';
      lifeBox.innerHTML = h;
    }

    /* ---- buying ---- */
    function buy() {
      const s = sources().find(function (x) { return x.id === els.src.value; }); if (!s) return;
      const t = Math.floor(+els.t.value); if (!(t >= 1)) return;
      const free = yardCap(cap()) - stockTotal(st.piles);
      if (t > free + 1e-9) { app.log('The yard has room for ' + fmtT(Math.max(0, free)) + ' t more (' + YARD_BATCHES + ' batches of ' + cap() + ' t). Run some down or buy Feed logistics.', 'warn'); return; }
      const cost = s.cost * t;
      if (cost > 0 && !app.spend(cost, t + ' t of ' + s.name + ' to the stockpile')) { app.renderBank(); return; }
      if (cost <= 0) S().money -= cost;   // paid to take it
      const key = s.id === 'current' ? keyFor('custom', s.comp) : s.id;
      const pile = st.piles[key] || (st.piles[key] = newPile(nameFor(key, s.comp), s.comp));
      add(pile, s.comp, t, cost);
      app.log('Stockpiled ' + app.fmtNum(t, 0) + ' t of ' + s.name + (cost < 0 ? ', paid ' + app.fmtMoney(-cost) + ' to take it' : ' for ' + app.fmtMoney(cost)) + '. The ' + pile.name + ' pile holds ' + fmtT(pile.t) + ' t.', 'ok');
      if (CS.Audio) CS.Audio.ui('ok');
      if (st.loaded === key && !S().run) runFrom(key, true);   // a blended hand mix shifts a little: reload it so the feed matches the pile
      app.renderBank(); app.save(); render();
    }

    /* ---- loading a pile as the feed ---- */
    function runFrom(key, quiet) {
      const s = S(), pile = st.piles[key]; if (!pile || !(pile.t > 0)) return false;
      if (s.run) { if (!quiet) app.log('Finish the running batch first.', 'warn'); return false; }
      if (app.contract()) { if (!quiet) app.log('Release the contract first: the client supplies the feed while a contract is active.', 'warn'); return false; }
      if (s.feedPrepaid && !st.loaded) { if (!quiet) app.log('A prepaid auction lot is loaded as the feed. Run it first, or change the feed by hand to put it back in the yard.', 'warn'); return false; }
      const tons = Math.max(1, Math.min(Math.floor(pile.t), cap()));
      st.loaded = null;   // setFeed renders before the flag is set; the render guard must not read this as a hand change
      app.setFeed(pile.comp, FEEDS[key] ? key : 'custom', tons);
      st.loaded = key; s.feedPrepaid = true;
      app.markDirty();   // feed info and the projected margin now show prepaid feed
      if (!quiet) app.log('Feed loaded from the ' + pile.name + ' stockpile: ' + tons + ' t per batch, prepaid; ' + fmtT(pile.t) + ' t on the pile.', 'ok');
      return true;
    }
    /* The loaded pile must still be what the feed panel shows. A hand edit on the sliders, a preset or a contract takes
     * the feed away from the pile and the prepaid flag goes with it. Another module loading its own prepaid feed (the
     * auction's lot) goes through app.setFeed, which renders before that module sets the flag: seen from a render with the
     * preset at 'custom', the flag is left to it. */
    function guard(viaRender) {
      const k = st.loaded; if (!k) return;
      const s = S(), pile = st.piles[k], C = app.contract();
      if (pile && !C && sameComp(s.comp, pile.comp)) {
        if (!s.run && pile.t >= 1 && s.tons > pile.t) { s.tons = Math.floor(pile.t); app.syncFeedRows(); app.markDirty(); }
        return;
      }
      st.loaded = null;
      const theirs = viaRender && !C && s.feedPreset === 'custom';
      if (!theirs) s.feedPrepaid = false;
      if (pile) app.log('The ' + pile.name + ' stockpile is no longer loaded: the feed was changed' + (C ? ' by the contract.' : theirs ? '.' : ', so feed is charged at the normal price again.'), 'warn');
      if (!viaRender) render();
    }

    /* ---- batches ---- */
    app.on('batchStart', function (p) {
      const k = st.loaded; if (!k) return;
      const s = S(), pile = st.piles[k], run = p.run;
      if (!pile || app.contract() || !sameComp(s.comp, pile.comp)) { st.loaded = null; return; }
      const d = draw(pile, run.total);
      // the pile is prepaid: if another module cleared the flag before the batch started, the app charged the feed; give it back
      if (run.feedC) { s.money += run.feedC; app.log('Stockpile feed is prepaid: ' + app.fmtMoney(run.feedC) + ' of feed charges refunded.', 'ok'); run.feedC = 0; app.renderBank(); }
      settle = { key: k, name: pile.name, comp: Object.assign({}, pile.comp), drawn: d.t, paidPerT: d.t > 0 ? d.paid / d.t : 0 };
      app.log('Drawn ' + fmtT(d.t) + ' t from the ' + pile.name + ' stockpile' + (pile.t > 0 ? '; ' + fmtT(pile.t) + ' t remain.' : '; the pile is empty.'));
      if (!(pile.t > 0)) { delete st.piles[k]; st.loaded = null; }
      render();
    });
    app.on('batchComplete', function (p) {
      const r = p && p.r; if (!r) return;
      addLifetime(st.life, p.bins, r.done);
      const sd = settle; settle = null;
      if (sd) {
        const back = sd.drawn - r.done;
        if (back > 1e-6) {
          const pile = st.piles[sd.key] || (st.piles[sd.key] = newPile(sd.name, sd.comp));
          add(pile, sd.comp, back, back * sd.paidPerT);
          app.log(fmtT(back) + ' t the batch did not run went back on the ' + pile.name + ' stockpile (' + fmtT(pile.t) + ' t).');
        }
        const pile = st.piles[sd.key];
        if (pile && pile.t >= 1 && runFrom(sd.key, true)) app.log('Next batch loaded from the ' + pile.name + ' stockpile: ' + S().tons + ' t of ' + fmtT(pile.t) + ' t.');
      }
      renderLife(); render();
    });

    /* hooks */
    app.on('boot', function () {
      build();
      if (st.loaded) {   // the prepaid flag is not saved by the app: restore it for a pile that is still the feed
        const pile = st.piles[st.loaded];
        if (pile && !app.contract() && !S().feedPrepaid && sameComp(S().comp, pile.comp)) S().feedPrepaid = true; else st.loaded = null;
      }
      renderLife(); render();
    });
    app.on('render', function () { guard(true); render(); });
    app.on('tick', function () { if (st.loaded) guard(false); });
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
