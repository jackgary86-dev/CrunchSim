/* CrunchSim module: blueprints. Save the current flowsheet under a name, list the saved lines with their signature
 * and the feed they were built on, reload one later.
 *
 * A blueprint definition is preset-shaped, the same form as CS.LINES: { nodes: [{ m, s, src: 'feed' | 'k:port' }] }
 * with k the 1-based index of an earlier node, so CS.Sim.buildLine rebuilds it with fresh uids.
 *
 * The pure parts (serialise, deserialise, sanitise, sanitiseState, recordBest, offer) live on CS.Blueprints and touch
 * no DOM, so tests/blueprints.js can run them in Node. Everything that needs the page runs only when CS.app exists.
 * Module state is persisted through the app's 'save' / 'load' hooks under ext.blueprints = { saved: [...] }.
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
      const s = Sim.cleanSettings(d.m, d.s);   // #232: same clamp and enum check as load()
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

  /* persisted state -> { saved } with every record validated; junk is dropped rather than trusted */
  function sanitiseState(raw) {
    const out = { saved: [] };
    if (!raw || typeof raw !== 'object') return out;
    (Array.isArray(raw.saved) ? raw.saved : []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      const def = sanitise(b.def), name = cleanName(b.name);
      if (!def || !name || out.saved.length >= MAX_SAVED) return;
      out.saved.push({
        id: String(b.id || (Date.now().toString(36) + out.saved.length)), name: name, sig: signature(def.nodes), def: def,
        feed: FEEDS[b.feed] ? b.feed : 'custom', tons: isFinite(+b.tons) && +b.tons > 0 ? +b.tons : 0,
        t: isFinite(+b.t) ? +b.t : 0
      });
    });
    return out;
  }

  /* Order the shelf for the current situation: those saved on the current feed preset come first. Each row says whether it fits. */
  function offer(saved, ctx) {
    ctx = ctx || {};
    const rows = (saved || []).map(function (bp, i) {
      let fit = false;
      if (ctx.feedPreset && ctx.feedPreset !== 'custom') fit = bp.feed === ctx.feedPreset;
      return { bp: bp, fit: fit, i: i };
    });
    rows.sort(function (a, b) { return (b.fit - a.fit) || (a.i - b.i); });
    return rows;
  }

  CS.Blueprints = { serialise: serialise, deserialise: deserialise, sanitise: sanitise, sanitiseState: sanitiseState, offer: offer, signature: signature, MAX_SAVED: MAX_SAVED, NAME_MAX: NAME_MAX };

  /* ---------------- page: panel, save / load / delete, hooks ---------------- */
  if (typeof document === 'undefined') return;

  function install(app) {
    const state = { saved: [] };
    const Eco = function () { return CS.Economics || null; };
    let loaded = false, els = null, armed = null;

    app.on('load', function (ext) { Object.assign(state, sanitiseState(ext && ext.blueprints)); loaded = true; });
    app.on('save', function () { return { blueprints: { saved: state.saved } }; });

    app.on('boot', function () {
      // if this module registered after boot() had already emitted 'load', read the persisted block directly
      if (!loaded && app.S && app.S.ext) { Object.assign(state, sanitiseState(app.S.ext.blueprints)); loaded = true; }
      buildPanel(); render();
    });
    app.on('render', render);

    function buildPanel() {
      if (els) return;
      const sec = app.addPanel('left', 'blueprint-panel', 'Blueprints', 'bank-panel');
      sec.insertAdjacentHTML('beforeend',
        '<div class="small">SAVE CURRENT LINE</div>' +
        '<div class="row"><input type="text" id="bp-name" class="bp-name" maxlength="' + NAME_MAX + '" placeholder="name, e.g. tires v2" autocomplete="off"><button id="bp-save" type="button">SAVE</button></div>' +
        '<h3>Saved lines</h3><div id="bp-list"></div>');
      els = { sec: sec, name: sec.querySelector('#bp-name'), save: sec.querySelector('#bp-save'), list: sec.querySelector('#bp-list') };
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
      const rec = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: name, sig: sig, def: def, feed: FEEDS[S.feedPreset] ? S.feedPreset : 'custom', tons: S.tons, t: S.clock || 0 };
      if (existing >= 0) { rec.id = state.saved[existing].id; state.saved[existing] = rec; app.log('Blueprint replaced: ' + name + ' (' + sig + ').', 'ok'); }
      else if (state.saved.length >= MAX_SAVED) { app.log('The blueprint shelf is full (' + MAX_SAVED + '). Delete one first.', 'warn'); return; }
      else { state.saved.push(rec); app.log('Blueprint saved: ' + name + ' (' + sig + ', ' + feedName(rec.feed) + ').', 'ok'); }
      els.name.value = '';
      if (app.save) app.save();
      render();
    }

    /* Rebuild the line from a definition the way applyLinePreset does: veto first, then fresh nodes, then the purchase
     * cost of anything unowned goes to the log. Wear and the AUTO flag are carried over per unit (line and shelf) so reloading is not a free service. */
    function loadDef(def, label, feedId) {
      const S = app.S; if (!S) return;
      if (S.run) { app.log('Finish or stop the running batch before loading a blueprint.', 'warn'); return; }
      const clean = sanitise(def);
      if (!clean) { app.log('Blueprint ' + label + ' has no usable machines.', 'bad'); return; }
      const why = app.veto('applyLine', { id: 'blueprint', name: label, nodes: clean.nodes });
      if (why) { app.log(why, 'bad'); return; }
      const nodes = Sim.buildLine(clean);
      if (Eco()) Eco().carryWear(S.line, S.shelf, nodes);
      const miss = {}; nodes.forEach(function (n) { if (!S.owned.has(n.m)) miss[n.m] = MACHINES[n.m].price; });
      let cost = 0; const names = []; for (const m in miss) { cost += miss[m]; names.push(MACHINES[m].name); }
      S.line = nodes; S.sel = nodes[0].uid; S.linePreset = 'custom';
      if (cost > 0) app.log('Blueprint loaded: ' + label + '. It uses ' + app.fmtMoney(cost) + ' of machines you do not own yet (' + names.join(', ') + '). Buy them from the node panel to run it.', 'warn');
      else app.log('Blueprint loaded: ' + label + ' (' + signature(nodes) + ').', 'ok');
      if (feedId && feedId !== S.feedPreset) app.log('It was built for ' + feedName(feedId) + '; the feed is still ' + feedName(S.feedPreset) + '.');
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
      const rows = offer(state.saved, { feedPreset: S.feedPreset });
      els.list.innerHTML = '';
      if (!rows.length) els.list.appendChild(el('div', 'empty', 'No blueprints yet. Build a line and save it.'));
      rows.forEach(function (r) {
        const bp = r.bp;
        const row = el('div', 'urow' + (r.fit ? ' fit' : ''),
          '<span class="ic">' + (r.fit ? '◈' : '▦') + '</span><span><div class="nm">' + esc(bp.name) + (r.fit ? '<span class="tag fit">BUILT FOR THIS</span>' : '') + '</div>' +
          '<div class="cur">' + esc(bp.sig) + ' · ' + esc(feedName(bp.feed)) + (bp.tons ? ', ' + bp.tons + ' t' : '') + '</div></span>');
        const btns = el('span', 'btns');
        const bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'LOAD'; bl.addEventListener('click', function () { loadDef(bp.def, bp.name, bp.feed); });
        const bd = document.createElement('button'); bd.type = 'button'; bd.className = 'danger'; bd.textContent = 'DELETE'; bd.addEventListener('click', function () { deleteBlueprint(bp, bd); });
        btns.appendChild(bl); btns.appendChild(bd); row.appendChild(btns); els.list.appendChild(row);
      });

    }
  }

  if (CS.app) install(CS.app);
  else document.addEventListener('DOMContentLoaded', function () { if (CS.app) install(CS.app); });
})(typeof window !== 'undefined' ? window : globalThis);
