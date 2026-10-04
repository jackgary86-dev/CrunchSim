/* CrunchSim module: blueprints. Save the current flowsheet under a name, list the saved lines with their signature
 * and the feed they were built on, reload one later, and keep the best-scoring line per contract automatically.
 *
 * A blueprint definition is preset-shaped, the same form as CS.LINES: { nodes: [{ m, s, src: 'feed' | 'k:port' }] }
 * with k the 1-based index of an earlier node, so CS.Sim.buildLine rebuilds it with fresh uids.
 *
 * The pure parts (serialise, deserialise, sanitise, sanitiseState, recordBest, offer) live on CS.Blueprints and touch
 * no DOM, so tests/blueprints.js can run them in Node. Everything that needs the page runs only when CS.app exists.
 * Module state is persisted through the app's 'save' / 'load' hooks under ext.blueprints = { saved: [...], best: {...} }.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.Sim || !CS.MACHINES) return;
  const MACHINES = CS.MACHINES, FEEDS = CS.FEEDS, Sim = CS.Sim;
  const MAX_SAVED = 24;      // a shelf of 24 drawings keeps the panel readable; a real plant office keeps a handful of P&IDs per product
  const NAME_MAX = 40;

  /* ---------------- pure helpers ---------------- */
  function signature(nodes) {
    if (CS.Score && CS.Score.signature) return CS.Score.signature(nodes);
    return nodes.map(function (n) { return MACHINES[n.m].short; }).join('>');
  }
  function portsOf(m) {
    const M = MACHINES[m];
    if (M.omni && M.outs) return Object.keys(M.outs);   // #15: one port per material plus rejects
    return M.kind === 'separator' ? ['extract', 'residue'] : (M.kind === 'conditioner' ? ['product'] : ['product', 'rejects']);
  }

  /* live line [{uid, m, settings, src}] -> preset-shaped definition { nodes: [{m, s, src}] } */
  function serialise(line) {
    const kept = (line || []).filter(function (n) { return n && MACHINES[n.m]; });
    const idx = {}; kept.forEach(function (n, i) { idx[n.uid] = i; });
    const nodes = kept.map(function (n, i) {
      let src = 'feed';
      if (n.src && n.src !== 'feed') { const k = idx[n.src.uid]; if (k != null && k < i) src = (k + 1) + ':' + n.src.port; }
      return { m: n.m, s: Object.assign({}, n.settings || {}), src: src };
    });
    return { nodes: nodes };
  }

  /* definition -> clean definition, or null when nothing survives. Unknown machines are dropped, settings are clamped to
   * the machine's ranges (missing ones take the default), and a src that points forward, at a dropped node or at a port
   * the machine does not have falls back to the head feed. */
  function sanitise(def) {
    if (!def || !Array.isArray(def.nodes)) return null;
    const keep = [], map = {};   // old 1-based index -> new 1-based index
    def.nodes.forEach(function (d, i) {
      if (!d || !MACHINES[d.m]) return;
      const M = MACHINES[d.m], s = {};
      (M.settings || []).forEach(function (st) {
        const raw = d.s && d.s[st.id] != null ? +d.s[st.id] : NaN;
        const v = isFinite(raw) ? raw : st.def;
        s[st.id] = Math.min(st.max, Math.max(st.min, v));
      });
      map[i + 1] = keep.length + 1;
      keep.push({ m: d.m, s: s, src: typeof d.src === 'string' ? d.src : 'feed' });
    });
    keep.forEach(function (d, i) {
      if (d.src === 'feed') return;
      const p = d.src.split(':'), k = map[+p[0]], port = p[1];
      const ok = k && k <= i && port && portsOf(keep[k - 1].m).indexOf(port) >= 0;
      d.src = ok ? k + ':' + port : 'feed';
    });
    return keep.length ? { nodes: keep } : null;
  }

  /* definition -> runnable line with fresh uids (empty array when nothing usable) */
  function deserialise(def) {
    const d = sanitise(def);
    return d ? Sim.buildLine(d) : [];
  }

  function feedName(id) { return FEEDS[id] ? FEEDS[id].name : 'custom mix'; }
  function cleanName(name) { return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }

  /* persisted state -> { saved, best } with every record validated; junk is dropped rather than trusted */
  function sanitiseState(raw) {
    const out = { saved: [], best: {} };
    if (!raw || typeof raw !== 'object') return out;
    (Array.isArray(raw.saved) ? raw.saved : []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      const def = sanitise(b.def), name = cleanName(b.name);
      if (!def || !name || out.saved.length >= MAX_SAVED) return;
      out.saved.push({
        id: String(b.id || (Date.now().toString(36) + out.saved.length)), name: name, sig: signature(def.nodes), def: def,
        feed: FEEDS[b.feed] ? b.feed : 'custom', tons: isFinite(+b.tons) && +b.tons > 0 ? +b.tons : 0,
        contract: b.contract && CS.Score && CS.Score.CONTRACTS.some(function (c) { return c.id === b.contract; }) ? b.contract : null,
        t: isFinite(+b.t) ? +b.t : 0
      });
    });
    const best = raw.best && typeof raw.best === 'object' ? raw.best : {};
    for (const cid in best) {
      if (!CS.Score || !CS.Score.CONTRACTS.some(function (c) { return c.id === cid; })) continue;
      const b = best[cid]; if (!b || typeof b !== 'object') continue;
      const def = sanitise(b.def), stars = Math.floor(+b.stars || 0);
      if (!def || stars < 1) continue;
      out.best[cid] = { sig: signature(def.nodes), def: def, stars: Math.min(3, stars), feed: FEEDS[b.feed] ? b.feed : 'custom', kwhT: isFinite(+b.kwhT) ? +b.kwhT : null, fee: isFinite(+b.fee) ? +b.fee : null };
    }
    return out;
  }

  /* After a scored batch: keep the line when its stars beat the stored best for that contract. Returns true when stored.
   * Ties are not replaced, so the first line to reach a star count stays the reference until a better one appears. */
  function recordBest(best, cs, line, feed) {
    if (!best || !cs || !cs.C || !(cs.stars > 0)) return false;
    const prev = best[cs.C.id];
    if (prev && prev.stars >= cs.stars) return false;
    const def = serialise(line); if (!def.nodes.length) return false;
    best[cs.C.id] = { sig: signature(def.nodes), def: def, stars: cs.stars, feed: feed || 'custom', kwhT: isFinite(cs.kwhT) ? cs.kwhT : null, fee: isFinite(cs.fee) ? cs.fee : null };
    return true;
  }

  /* Order the shelf for the current situation: blueprints built for the active contract (saved under it, or on its feed)
   * come first; with no contract, those saved on the current feed preset come first. Each row says whether it fits. */
  function offer(saved, ctx) {
    ctx = ctx || {};
    const rows = (saved || []).map(function (bp, i) {
      let fit = false;
      if (ctx.contract) fit = bp.contract === ctx.contract || (!!ctx.contractFeed && bp.feed === ctx.contractFeed);
      else if (ctx.feedPreset && ctx.feedPreset !== 'custom') fit = bp.feed === ctx.feedPreset;
      return { bp: bp, fit: fit, i: i };
    });
    rows.sort(function (a, b) { return (b.fit - a.fit) || (a.i - b.i); });
    return rows;
  }

  CS.Blueprints = { serialise: serialise, deserialise: deserialise, sanitise: sanitise, sanitiseState: sanitiseState, recordBest: recordBest, offer: offer, signature: signature, MAX_SAVED: MAX_SAVED, NAME_MAX: NAME_MAX };

  /* ---------------- page: panel, save / load / delete, hooks ---------------- */
  if (typeof document === 'undefined') return;

  function install(app) {
    const state = { saved: [], best: {} };
    let loaded = false, els = null, armed = null;
    const starsText = function (n) { return app.starsText ? app.starsText(n) : '★★★'.slice(0, n); };

    app.on('load', function (ext) { Object.assign(state, sanitiseState(ext && ext.blueprints)); loaded = true; });
    app.on('save', function () { return { blueprints: { saved: state.saved, best: state.best } }; });

    app.on('boot', function () {
      // if this module registered after boot() had already emitted 'load', read the persisted block directly
      if (!loaded && app.S && app.S.ext) { Object.assign(state, sanitiseState(app.S.ext.blueprints)); loaded = true; }
      buildPanel(); render();
    });
    app.on('render', render);
    app.on('batchComplete', function (p) {
      if (!p || !p.cs || !p.cs.C || !app.S) return;
      if (recordBest(state.best, p.cs, app.S.line, app.S.feedPreset)) {
        const b = state.best[p.cs.C.id];
        app.log('Blueprint: ' + b.sig + ' is now your best line for ' + p.cs.C.name + ' (' + b.stars + ' star' + (b.stars === 1 ? '' : 's') + ').', 'ok');
        render();
      }
    });

    function buildPanel() {
      if (els) return;
      const sec = app.addPanel('left', 'blueprint-panel', 'Blueprints', 'bank-panel');
      sec.insertAdjacentHTML('beforeend',
        '<div class="small">SAVE CURRENT LINE</div>' +
        '<div class="row"><input type="text" id="bp-name" class="bp-name" maxlength="' + NAME_MAX + '" placeholder="name, e.g. tires v2" autocomplete="off"><button id="bp-save" type="button">SAVE</button></div>' +
        '<h3>Saved lines</h3><div id="bp-list"></div>' +
        '<h3>Best per contract</h3><div id="bp-best"></div>');
      els = { sec: sec, name: sec.querySelector('#bp-name'), save: sec.querySelector('#bp-save'), list: sec.querySelector('#bp-list'), best: sec.querySelector('#bp-best') };
      els.save.addEventListener('click', saveCurrent);
      els.name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveCurrent(); } });
    }

    function saveCurrent() {
      const S = app.S; if (!S) return;
      if (!S.line.length) { app.log('Nothing to save: the flowsheet is empty.', 'warn'); return; }
      const def = serialise(S.line); if (!def.nodes.length) return;
      const sig = signature(def.nodes);
      let name = cleanName(els.name.value);
      if (!name) name = cleanName(feedName(S.feedPreset) + ' · ' + sig);
      const existing = state.saved.findIndex(function (b) { return b.name.toLowerCase() === name.toLowerCase(); });
      const C = app.contract ? app.contract() : null;
      const rec = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: name, sig: sig, def: def, feed: FEEDS[S.feedPreset] ? S.feedPreset : 'custom', tons: S.tons, contract: C ? C.id : null, t: S.clock || 0 };
      if (existing >= 0) { rec.id = state.saved[existing].id; state.saved[existing] = rec; app.log('Blueprint replaced: ' + name + ' (' + sig + ').', 'ok'); }
      else if (state.saved.length >= MAX_SAVED) { app.log('The blueprint shelf is full (' + MAX_SAVED + '). Delete one first.', 'warn'); return; }
      else { state.saved.push(rec); app.log('Blueprint saved: ' + name + ' (' + sig + ', ' + feedName(rec.feed) + (C ? ', contract ' + C.name : '') + ').', 'ok'); }
      els.name.value = '';
      if (app.save) app.save();
      render();
    }

    /* Rebuild the line from a definition the way applyLinePreset does: veto first, then fresh nodes, then the purchase
     * cost of anything unowned goes to the log. Wear is carried over per machine type so reloading is not a free service. */
    function loadDef(def, label, feedId) {
      const S = app.S; if (!S) return;
      if (S.run) { app.log('Finish or stop the running batch before loading a blueprint.', 'warn'); return; }
      const clean = sanitise(def);
      if (!clean) { app.log('Blueprint ' + label + ' has no usable machines.', 'bad'); return; }
      const why = app.veto('applyLine', { id: 'blueprint', name: label, nodes: clean.nodes });
      if (why) { app.log(why, 'bad'); return; }
      const nodes = Sim.buildLine(clean);
      const wearBy = {}; S.line.forEach(function (n) { wearBy[n.m] = Math.max(wearBy[n.m] || 0, n.wear || 0); });
      nodes.forEach(function (n) { n.wear = wearBy[n.m] || 0; });
      const miss = {}; nodes.forEach(function (n) { if (!S.owned.has(n.m)) miss[n.m] = MACHINES[n.m].price; });
      let cost = 0; const names = []; for (const m in miss) { cost += miss[m]; names.push(MACHINES[m].name); }
      S.line = nodes; S.sel = nodes[0].uid; S.linePreset = 'custom';
      if (cost > 0) app.log('Blueprint loaded: ' + label + '. It uses ' + app.fmtMoney(cost) + ' of machines you do not own yet (' + names.join(', ') + '). Buy them from the node panel to run it.', 'warn');
      else app.log('Blueprint loaded: ' + label + ' (' + signature(nodes) + ').', 'ok');
      const C = app.contract ? app.contract() : null;
      if (feedId && !C && feedId !== S.feedPreset) app.log('It was built for ' + feedName(feedId) + '; the feed is still ' + feedName(S.feedPreset) + '.');
      app.markDirty(true);
    }

    function deleteBlueprint(bp, btn) {
      if (armed !== bp.id) { armed = bp.id; btn.textContent = 'SURE?'; btn.classList.add('bad'); setTimeout(function () { if (armed === bp.id) { armed = null; render(); } }, 3000); return; }
      armed = null;
      state.saved = state.saved.filter(function (b) { return b.id !== bp.id; });
      app.log('Blueprint deleted: ' + bp.name + '.');
      if (app.save) app.save();
      render();
    }

    function render() {
      if (!els || !app.S) return;
      const S = app.S, esc = app.esc, el = app.el;
      const C = app.contract ? app.contract() : null;
      const rows = offer(state.saved, { contract: C ? C.id : null, contractFeed: C ? C.feed : null, feedPreset: S.feedPreset });
      els.list.innerHTML = '';
      if (!rows.length) els.list.appendChild(el('div', 'empty', 'No blueprints yet. Build a line and save it.'));
      rows.forEach(function (r) {
        const bp = r.bp;
        const row = el('div', 'urow' + (r.fit ? ' fit' : ''),
          '<span class="ic">' + (r.fit ? '◈' : '▦') + '</span><span><div class="nm">' + esc(bp.name) + (r.fit ? '<span class="tag fit">BUILT FOR THIS</span>' : '') + '</div>' +
          '<div class="cur">' + esc(bp.sig) + ' · ' + esc(feedName(bp.feed)) + (bp.tons ? ', ' + bp.tons + ' t' : '') + (bp.contract && CS.Score ? ' · ' + esc((CS.Score.CONTRACTS.find(function (c) { return c.id === bp.contract; }) || { name: bp.contract }).name) : '') + '</div></span>');
        const btns = el('span', 'btns');
        const bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'LOAD'; bl.addEventListener('click', function () { loadDef(bp.def, bp.name, bp.feed); });
        const bd = document.createElement('button'); bd.type = 'button'; bd.className = 'danger'; bd.textContent = 'DELETE'; bd.addEventListener('click', function () { deleteBlueprint(bp, bd); });
        btns.appendChild(bl); btns.appendChild(bd); row.appendChild(btns); els.list.appendChild(row);
      });
      els.best.innerHTML = '';
      let any = false;
      (CS.Score ? CS.Score.CONTRACTS : []).forEach(function (Ct) {
        const b = state.best[Ct.id]; if (!b) return; any = true;
        const row = el('div', 'urow' + (C && C.id === Ct.id ? ' fit' : ''),
          '<span class="ic amber">' + b.stars + '★</span><span><div class="nm">best for ' + esc(Ct.name) + ': <b class="num">' + esc(b.sig) + '</b> <span class="stars got">' + starsText(b.stars) + '</span></div>' +
          '<div class="cur">' + esc(feedName(b.feed)) + (b.kwhT != null ? ' · ' + b.kwhT.toFixed(1) + ' kWh/t' : '') + (b.fee != null && app.fmtMoney ? ' · fee ' + app.fmtMoney(b.fee) : '') + '</div></span>');
        const bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'LOAD'; bl.addEventListener('click', function () { loadDef(b.def, 'best for ' + Ct.name, b.feed); });
        row.appendChild(bl); els.best.appendChild(row);
      });
      if (!any) els.best.appendChild(el('div', 'small', 'Complete a contract and its best-scoring line is kept here.'));
    }
  }

  if (CS.app) install(CS.app);
  else document.addEventListener('DOMContentLoaded', function () { if (CS.app) install(CS.app); });
})(typeof window !== 'undefined' ? window : globalThis);
