/* CrunchSim module: facility. Office and facility upgrades (ticket #14): a trading desk, a sampling lab, a control room,
 * a weighbridge, a maintenance bay, a power substation, dust and water treatment and a nitrogen tank farm. The tables are
 * CS.OFFICE_UPGRADES and CS.FACILITY_UPGRADES in js/data.js, in the PLANT_UPGRADES shape, and the panel draws the site as
 * inline SVG blocks that fill in as they are bought.
 *
 * How each effect reaches the game (a module only has CS.app, Sim.prices and the shared tables to work with):
 *   desk         Sim.prices.market = plant offtake value x desk multiplier. applyPlant() in app.js rewrites the plant value on
 *                boot, on every plant purchase, so the multiplier is re-applied from the 'render' hook
 *                whenever the price is found back at the plant value. A price that is neither the plant value nor the one this
 *                module wrote last was set by another module and is left alone (CS.Facility.effects() exposes the multiplier).
 *   ln2farm      Sim.prices.ln2, the same way, on top of the nitrogen supply upgrade.
 *   control      a 300x button after the 1x / 10x / 60x buttons (key 4). S.speed is the app's own field; the app does not
 *                persist 300x, so a reload comes back at 1x like any other session.
 *   weighbridge  extra tonnes on top of the feed logistics value through the app's 'plantValue' query hook, so the batch
 *                slider, the lot board and the preset lines all see the bigger limit.
 *   maint        MACHINES[id].service is scaled from its data-table value: the SERVICE button and the per-tonne wear cost in
 *                the margin both read it. The base value is kept so the scale is idempotent and reversible.
 *   substation   MACHINES[id].prated is scaled the same way: Sim.maxRate and the app's power readouts both read it.
 *   treatment    a per-tonne credit banked on 'batchComplete' (the sim's extraCostPerHeadT cannot be touched from a module).
 *   lab          a six-class sieve analysis row under every product bin, cut on the sim's quarter-decade bin edges.
 * Purchases count toward net worth through the app's 'assetValue' query hook and persist under ext.facility.
 * The pure parts live on CS.Facility and touch no DOM, so tests/facility.js can run them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MACHINES || !CS.OFFICE_UPGRADES || !CS.FACILITY_UPGRADES) return;
  const MACHINES = CS.MACHINES, OFFICE = CS.OFFICE_UPGRADES, FACILITY = CS.FACILITY_UPGRADES, PLANT = CS.PLANT_UPGRADES;

  /* ---------------- tables and levels ---------------- */
  const TABLES = { office: OFFICE, facility: FACILITY };
  const KEYS = Object.keys(OFFICE).concat(Object.keys(FACILITY));
  function table(key) { return OFFICE[key] || FACILITY[key] || null; }
  function clampLevel(key, lvl) { const U = table(key); if (!U) return 0; return Math.max(0, Math.min(U.costs.length, Math.floor(+lvl || 0))); }
  function newState() { const s = { levels: {} }; KEYS.forEach(function (k) { s.levels[k] = 0; }); return s; }
  function levelOf(state, key) { return clampLevel(key, state && state.levels ? state.levels[key] : 0); }
  function valueAt(key, lvl) { const U = table(key); return U ? U.levels[clampLevel(key, lvl)] : null; }
  function valueOf(state, key) { return valueAt(key, levelOf(state, key)); }
  function nextCost(state, key) { const U = table(key), l = levelOf(state, key); return U && l < U.costs.length ? U.costs[l] : null; }
  /* what the upgrades bought so far would sell for: the costs paid, like the app's assetValue does for plant upgrades */
  function assetValue(state) {
    let v = 0;
    KEYS.forEach(function (k) { const U = table(k), l = levelOf(state, k); for (let i = 0; i < l; i++) v += U.costs[i]; });
    return v;
  }
  /* every effect at the current levels, in the units the game applies them */
  function effects(state) {
    return {
      market: valueOf(state, 'desk'),            // x on every product price, on top of the plant's offtake deals
      ln2: valueOf(state, 'ln2farm'),            // x on the liquid nitrogen price, on top of the nitrogen supply upgrade
      speedMax: valueOf(state, 'control'),       // highest sim speed button offered
      lab: valueOf(state, 'lab') > 0,            // sieve analysis on the bins
      batchExtra: valueOf(state, 'weighbridge'), // t added to the feed logistics batch limit
      serviceMul: valueOf(state, 'maint'),       // x on MACHINES[id].service
      powerMul: valueOf(state, 'substation'),    // x on MACHINES[id].prated
      savePerT: valueOf(state, 'treatment')      // $ credited per tonne processed
    };
  }
  /* list price multiplier the market applies after the plant's offtake deals and the trading desk */
  function marketPrice(plantMul, state) { return plantMul * effects(state).market; }
  function fmtVal(key, v) {
    const U = table(key); if (!U) return String(v);
    if (key === 'lab') return v > 0 ? v + ' ' + U.unit : 'none';
    if (key === 'control') return v + '×';
    if (key === 'weighbridge') return '+' + v + ' ' + U.unit;
    if (key === 'treatment') return '$' + v.toFixed(2) + U.unit;
    return v.toFixed(2) + ' ' + U.unit;
  }

  /* ---------------- machine table scaling (maintenance bay, substation) ---------------- */
  const BASE = {};   // id -> { prated, service } as the data table had them, captured the first time a machine is scaled
  function scaleMachines(fx, machines) {
    const T = machines || MACHINES;
    Object.keys(T).forEach(function (id) {
      const M = T[id]; if (!M || !(M.prated > 0)) return;
      const b = BASE[id] || (BASE[id] = { prated: M.prated, service: M.service });
      M.prated = b.prated * fx.powerMul; M.service = b.service * fx.serviceMul;
    });
  }
  function baseOf(id) { return BASE[id] || { prated: MACHINES[id].prated, service: MACHINES[id].service }; }

  /* ---------------- lab: sieve analysis ----------------
   * Six classes cut at 0.1, 1, 10, 56 and 178 mm. The cuts sit on the sim's quarter-decade bin edges so no bin is split:
   * dust, fines, granulate, shred, lumps and oversize, the splits a yard's QC desk reports.
   */
  const CUTS = [0.1, 1, 10, 56.2, 178];
  const CUT_LABELS = ['<0.1', '0.1-1', '1-10', '10-56', '56-178', '>178'];
  function sizeClasses(psd) {
    const Sim = CS.Sim, out = [];
    for (let k = 0; k <= CUTS.length; k++) out.push({ lo: k ? CUTS[k - 1] : 0, hi: k < CUTS.length ? CUTS[k] : Infinity, label: CUT_LABELS[k], frac: 0 });
    const tot = Sim.sum(psd); if (!(tot > 0)) return out;
    let k = 0;
    for (let i = 0; i < Sim.NB; i++) { while (k < CUTS.length && Sim.EDGE[i] > CUTS[k] * 1.001) k++; out[k].frac += psd[i] / tot; }
    return out;
  }

  /* ---------------- site drawing ----------------
   * Plan of the yard as inline SVG: the plant hall, the office and the gate road are always there; each upgrade is a block
   * drawn dashed until it is bought, then solid with one pip per level. Pure string so tests can check it.
   */
  const SITE = {
    desk: { x: 146, y: 64, w: 22, h: 16, label: 'DESK', inside: true },
    lab: { x: 171, y: 64, w: 22, h: 16, label: 'LAB', inside: true },
    control: { x: 196, y: 64, w: 22, h: 16, label: 'CTRL', inside: true },
    weighbridge: { x: 222, y: 96, w: 58, h: 10, label: 'WEIGHBRIDGE', below: true },
    maint: { x: 24, y: 100, w: 52, h: 18, label: 'MAINT BAY', inside: true },
    substation: { x: 140, y: 14, w: 30, h: 26, label: 'SUBSTATION', below: true },
    treatment: { x: 182, y: 14, w: 36, h: 26, label: 'TREATMENT', below: true },
    ln2farm: { x: 232, y: 14, w: 52, h: 26, label: 'LN2 FARM', below: true }
  };
  const DECOR = {
    substation: '<path d="M146 20h18M146 26h18M146 32h18"/><path d="M155 14v-6"/>',
    treatment: '<rect x="187" y="18" width="6" height="18"/><ellipse cx="206" cy="30" rx="9" ry="6"/>',
    ln2farm: '<rect x="236" y="18" width="44" height="8" rx="4"/><rect x="236" y="29" width="44" height="8" rx="4"/>',
    maint: '<rect x="44" y="108" width="12" height="10"/>',
    weighbridge: '<path d="M226 101h50"/>'
  };
  function siteSvg(state) {
    let s = '<svg class="site" viewBox="0 0 300 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Site plan: plant hall, office, yard and the upgrades bought">';
    s += '<g class="fixed"><rect x="24" y="30" width="108" height="62" rx="2"/><text x="78" y="64" text-anchor="middle">PLANT HALL</text>';
    s += '<rect x="142" y="56" width="80" height="34" rx="2"/><text x="182" y="52" text-anchor="middle">OFFICE</text>';
    s += '<path class="road" d="M0 122H300"/><path class="road" d="M251 118V92"/></g>';
    KEYS.forEach(function (key) {
      const b = SITE[key], U = table(key), lvl = levelOf(state, key);
      if (!b) return;
      s += '<g class="blk' + (lvl > 0 ? ' built' : '') + '" data-key="' + key + '" data-level="' + lvl + '">';
      s += '<title>' + U.name + ': level ' + lvl + ' of ' + U.costs.length + '</title>';
      s += '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="1.5"/>';
      if (DECOR[key]) s += DECOR[key];
      const ty = b.below ? b.y + b.h + 9 : b.y + b.h / 2 + 2.5;
      s += '<text x="' + (b.x + b.w / 2) + '" y="' + ty + '" text-anchor="middle">' + b.label + '</text>';
      for (let i = 0; i < U.costs.length; i++) s += '<rect class="pip' + (i < lvl ? ' on' : '') + '" x="' + (b.x + i * 7) + '" y="' + (b.y - 5) + '" width="5" height="2"/>';
      s += '</g>';
    });
    return s + '</svg>';
  }

  /* ---------------- persistence ---------------- */
  function serialize(state) { const levels = {}; KEYS.forEach(function (k) { levels[k] = levelOf(state, k); }); return { levels: levels }; }
  function deserialize(d) {
    const s = newState();
    if (!d || typeof d !== 'object' || !d.levels || typeof d.levels !== 'object') return s;
    KEYS.forEach(function (k) { s.levels[k] = clampLevel(k, d.levels[k]); });
    return s;
  }

  CS.Facility = {
    TABLES: TABLES, KEYS: KEYS, CUTS: CUTS, CUT_LABELS: CUT_LABELS, SITE: SITE,
    table: table, clampLevel: clampLevel, newState: newState, levelOf: levelOf, valueAt: valueAt, valueOf: valueOf, nextCost: nextCost,
    assetValue: assetValue, effects: effects, marketPrice: marketPrice, fmtVal: fmtVal, scaleMachines: scaleMachines, baseOf: baseOf,
    sizeClasses: sizeClasses, siteSvg: siteSvg, serialize: serialize, deserialize: deserialize
  };

  /* ======================= page integration (needs CS.app) ======================= */
  if (typeof document === 'undefined') return;

  const CSS = '#facility-panel .site{display:block;width:100%;height:auto;margin:0 0 6px;background:var(--panel-2);border:1px solid var(--line);border-radius:3px}' +
    '#facility-panel .site .fixed rect{fill:#121b26;stroke:var(--line-2);stroke-width:1}' +
    '#facility-panel .site .fixed .road{fill:none;stroke:var(--line-2);stroke-width:2;stroke-dasharray:4 3}' +
    '#facility-panel .site text{font-family:var(--mono);font-size:7px;letter-spacing:1px;fill:var(--muted)}' +
    '#facility-panel .site .blk rect,#facility-panel .site .blk ellipse,#facility-panel .site .blk path{fill:none;stroke:var(--line-2);stroke-width:1;stroke-dasharray:2 2}' +
    '#facility-panel .site .blk.built rect,#facility-panel .site .blk.built ellipse,#facility-panel .site .blk.built path{fill:#163043;stroke:var(--cyan);stroke-dasharray:none}' +
    '#facility-panel .site .blk.built text{fill:var(--cyan)}' +
    '#facility-panel .site .blk .pip{fill:none;stroke:var(--line-2);stroke-dasharray:none}' +
    '#facility-panel .site .blk .pip.on{fill:var(--green);stroke:var(--green)}' +
    '.bin .lab-psd{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin-top:5px;font-family:var(--mono);font-size:10px;color:var(--text)}' +
    '.bin .lab-psd span{text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:2px 0}' +
    '.bin .lab-psd span.top{color:var(--cyan)}' +
    '.bin .lab-psd em{display:block;font-style:normal;font-size:8px;color:var(--muted);letter-spacing:.5px}';

  function start() {
    const API = CS.app; if (!API || API.facilityStarted) return; API.facilityStarted = true;
    const Sim = CS.Sim;
    let state = newState(), panel = null, drawing = null, rows = null, speedBtn = null;
    const written = { market: null, ln2: null };   // the last value this module wrote into Sim.prices
    const S = function () { return API.S; };

    function restore(ext) { state = deserialize(ext && ext.facility); }
    function plantMul(key) { const U = PLANT[key], l = S() && S().plant ? S().plant[key] || 0 : 0; return U.levels[Math.min(l, U.levels.length - 1)]; }

    /* multiply our factor onto the plant value; leave a price alone when another module has written its own */
    function applyPrice(key, plantKey, mult) {
      const base = plantMul(plantKey), cur = Sim.prices[key], want = base * mult;
      if (Math.abs(cur - want) < 1e-12) return false;
      const ours = written[key] != null && Math.abs(cur - written[key]) < 1e-12;
      if (Math.abs(cur - base) > 1e-12 && !ours) return false;
      Sim.prices[key] = want; written[key] = want; return true;
    }
    function setSpeed(v) {
      S().speed = v;
      document.querySelectorAll('.spd').forEach(function (b) { b.classList.toggle('on', +b.dataset.speed === v); });
      if (CS.Audio) CS.Audio.ui('click');
    }
    function syncSpeed(fx) {
      const box = document.querySelector('#top .speed'); if (!box) return;
      if (fx.speedMax > 60) {
        if (!speedBtn) {
          speedBtn = API.el('button', 'spd', fx.speedMax + '&times;'); speedBtn.type = 'button'; speedBtn.dataset.speed = String(fx.speedMax);
          speedBtn.title = 'Control room: review a shift in minutes (key 4)';
          speedBtn.addEventListener('click', function () { setSpeed(fx.speedMax); });
          box.appendChild(speedBtn);
        }
        if (S().speed === fx.speedMax) speedBtn.classList.add('on');
      } else if (speedBtn) { speedBtn.remove(); speedBtn = null; if (S().speed > 60) setSpeed(60); }
    }
    /* the batch slider's max is only set by the app's applyPlant(), so after a weighbridge purchase it is set here too */
    function syncBatchMax() {
      const r = document.querySelector('#feed-tons'); if (!r) return;
      const max = API.plantValue('logistics');
      if (+r.max !== max) r.max = max;
    }
    /* push every effect into the game; true when a price changed and the plant numbers need a recompute */
    function apply() {
      const fx = effects(state);
      let changed = applyPrice('market', 'market', fx.market);
      if (applyPrice('ln2', 'nitrogen', fx.ln2)) changed = true;
      scaleMachines(fx);
      syncSpeed(fx); syncBatchMax();
      return changed;
    }

    /* lab: a sieve row under each bin the app drew; the app rebuilds #bins on every plant render, so this is re-run after */
    function decorateBins() {
      if (!effects(state).lab || !S() || !S().ev) return;
      const box = document.querySelector('#bins'); if (!box) return;
      const els = box.querySelectorAll('.bin'); if (!els.length || els[0].querySelector('.lab-psd')) return;
      const bins = API.binList(); if (bins.length !== els.length) return;
      bins.forEach(function (b, i) {
        const t = S().ev.terminals.find(function (x) { return x.key === b.key; }); if (!t) return;
        const cls = sizeClasses(Sim.aggregateMap(t.stream.m));
        let top = 0; cls.forEach(function (c, k) { if (c.frac > cls[top].frac) top = k; });
        const row = API.el('div', 'lab-psd', cls.map(function (c, k) {
          return '<span class="' + (k === top && c.frac > 0 ? 'top' : '') + '" title="' + c.label + ' mm"><em>' + c.label + '</em>' + Math.round(c.frac * 100) + '%</span>';
        }).join(''));
        row.title = 'Sampling lab: sieve analysis, % of bin mass by size class in mm';
        els[i].appendChild(row);
      });
    }

    /* ---- panel ---- */
    function build() {
      if (panel) return;
      panel = API.addPanel('left', 'facility-panel', 'Facility & office', 'bank-panel');
      drawing = API.el('div', 'sitewrap'); panel.appendChild(drawing);
      rows = { office: API.el('div'), facility: API.el('div') };
      panel.appendChild(API.el('h3', null, 'Office')); panel.appendChild(rows.office);
      panel.appendChild(API.el('h3', null, 'Facility')); panel.appendChild(rows.facility);
      const css = document.createElement('style'); css.textContent = CSS; panel.appendChild(css);
    }
    function render() {
      if (!panel || !S()) return;
      drawing.innerHTML = siteSvg(state);
      ['office', 'facility'].forEach(function (grp) {
        const box = rows[grp]; box.innerHTML = '';
        Object.keys(TABLES[grp]).forEach(function (key) {
          const U = TABLES[grp][key], lvl = levelOf(state, key), maxed = lvl >= U.costs.length;
          const row = API.el('div', 'urow', '<span class="ic">' + U.icon + '</span><span><div class="nm">' + API.esc(U.name) + ' <span class="small">LV ' + lvl + '</span></div><div class="cur">' +
            API.esc(U.desc) + ' · now <b>' + API.esc(fmtVal(key, U.levels[lvl])) + '</b>' + (maxed ? '' : ' → ' + API.esc(fmtVal(key, U.levels[lvl + 1]))) + '</div></span>');
          const b = document.createElement('button'); b.type = 'button';
          if (maxed) { b.textContent = 'MAX'; b.className = 'buy max'; b.disabled = true; }
          else { b.textContent = API.fmtMoney(U.costs[lvl]); b.className = 'buy' + (S().money < U.costs[lvl] ? ' poor' : ''); b.addEventListener('click', function () { buy(key); }); }
          row.appendChild(b); box.appendChild(row);
        });
      });
    }
    function buy(key) {
      const U = table(key), lvl = levelOf(state, key); if (!U || lvl >= U.costs.length) return;
      if (!API.spend(U.costs[lvl], U.name + ' level ' + (lvl + 1))) { render(); return; }
      state.levels[key] = lvl + 1;
      if (CS.Audio) CS.Audio.ui('ok');
      API.log(U.name + ' level ' + (lvl + 1) + ' for ' + API.fmtMoney(U.costs[lvl]) + ': ' + U.desc.toLowerCase() + ', now ' + fmtVal(key, valueOf(state, key)) + '.', 'ok');
      apply(); API.save(); API.markDirty(true);   // full render: plant numbers, bank, net worth and this panel
    }

    /* ---- hooks ---- */
    API.on('load', restore);
    if (API.S && API.S.ext) restore(API.S.ext);   // registered after boot: the 'load' event has already gone by
    API.on('save', function () { return { facility: serialize(state) }; });
    API.on('plantValue', function (q) { if (q && q.key === 'logistics') q.value += effects(state).batchExtra; });
    API.on('assetValue', function (q) { if (q) q.value += assetValue(state); });
    API.on('boot', function () {
      build();
      const changed = apply();
      if (changed) API.renderAll(); else { render(); decorateBins(); }   // renderAll re-emits 'render', which renders this panel
    });
    API.on('render', function () { if (apply()) API.markDirty(); render(); decorateBins(); });
    API.on('tick', function (p) { if (p && p.dh > 0 && S().run) decorateBins(); });   // the app redraws the bins every quarter second of a run
    API.on('batchComplete', function (p) {
      const fx = effects(state), r = p && p.r;
      if (!(fx.savePerT > 0) || !r || !(r.done > 0)) return;
      const credit = fx.savePerT * r.done;
      S().money += credit; S().lifetime += credit;
      API.log('Dust & water treatment: ' + API.fmtMoney(credit) + ' of disposal and water cost avoided on ' + API.fmtNum(r.done, 1) + ' t.', 'ok');
    });
    window.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const fx = effects(state);
      if (e.key === '4' && fx.speedMax > 60) setSpeed(fx.speedMax);
    });
  }

  if (CS.app) start();
  else document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
