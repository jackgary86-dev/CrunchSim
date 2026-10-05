/* CrunchSim module: refinery (#54). Metals can be refined for big paydays.
 *
 * Two levels, bought in Bank & upgrades:
 *   1  Smelting furnace: melts a sorted base-metal bucket (steel, cast iron, aluminum, copper, brass, zinc) into ingots or
 *      billet. Paid at the ingot price for the metal in it, less melt loss (dross); costs the melt energy at the power
 *      contract's price and a casting charge per tonne.
 *   2  Precious-metals refinery: refines sorted gold and silver into bars at the full metal price, and buys rich MISC
 *      concentrates by assay the way e-scrap refiners do (Umicore, Boliden): they pay for the gold and silver contained, less
 *      a treatment charge, and nothing for the copper, plastic and glass around it.
 * Numbers: furnace thermal efficiency 0.6 (induction on clean charge); casting and handling $25/t; precious refining 1% of
 * metal value plus $400/t of bars; concentrates pay 92% of contained precious metal less $1,200/t treatment and must assay
 * at least $3,000/t of precious metal to be worth the lot.
 * The quotes are pure and live on CS.Refinery so tests/refinery.js can run them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS;

  const LEVELS = [
    { name: 'No refinery', cost: 0 },
    { name: 'Smelting furnace', cost: 25000, desc: 'Melts sorted base-metal buckets into ingots and billet' },
    { name: 'Precious-metals refinery', cost: 250000, desc: 'Refines gold and silver into bars and buys rich MISC concentrates by assay' }
  ];
  const BASE = ['steel', 'castiron', 'aluminum', 'copper', 'brass', 'potmetal'];
  const PRECIOUS = ['gold', 'silver'];
  const ETA = 0.6, CAST_PER_T = 25;                 // furnace thermal efficiency; casting and handling $/t
  const PREC_FEE = 0.01, PREC_PER_T = 400;          // refining charge: 1% of metal value plus $/t of bars
  const CONC_PAY = 0.92, CONC_PER_T = 1200, CONC_MIN = 3000;   // concentrate: payable share, treatment $/t, minimum precious $/t

  function levelFor(mat) { return BASE.indexOf(mat) >= 0 ? 1 : PRECIOUS.indexOf(mat) >= 0 ? 2 : 0; }
  /* Quote refining a sorted bucket. e = { t, purity, grade, sf } as held in inventory; rawValue = what SELL pays now;
   * factor = the material's market factor this round; power = $/kWh. */
  function quoteBucket(mat, e, level, rawValue, power, factor) {
    const D = MATERIALS[mat], need = levelFor(mat);
    if (!D || !need || !e || !(e.t > 0)) return { ok: false, why: 'This material is not refined: sell it as it is.' };
    const metalT = e.t * (e.purity || 0) * (1 - (D.drossK || 0));
    const value = metalT * (D.ingot || D.sell) * (factor || 1);
    const kwh = e.t * (D.meltKWh || 0) / ETA;
    const cost = kwh * (power || 0.12) + (need === 2 ? PREC_FEE * value + PREC_PER_T * e.t : CAST_PER_T * e.t);
    const net = value - cost;
    const out = { ok: level >= need, need, needName: LEVELS[need].name, metalT, value, kwh, cost, net, gain: net - (rawValue || 0), form: need === 2 ? 'bars' : 'ingots' };
    if (!out.ok) out.why = 'Needs a ' + LEVELS[need].name.toLowerCase() + ' (Bank & upgrades).';
    return out;
  }
  /* Quote selling a MISC concentrate to the precious refinery by assay. misc = { mat: { t } }; prices = { gold, silver } $/t
   * of metal (bar price x market factor). */
  function quoteConcentrate(misc, level, prices) {
    let t = 0, pv = 0; const metal = {};
    for (const m in misc || {}) { const x = misc[m]; if (!(x && x.t > 0)) continue; t += x.t; if (PRECIOUS.indexOf(m) >= 0) { metal[m] = x.t; pv += x.t * (prices && prices[m] || MATERIALS[m].ingot); } }
    if (!(t > 0) || !(pv > 0)) return { ok: false, why: 'No gold or silver in MISC.', t, pv: 0 };
    const perT = pv / t, value = CONC_PAY * pv, cost = CONC_PER_T * t, net = value - cost;
    const out = { ok: level >= 2 && perT >= CONC_MIN && net > 0, t, metal, pv, perT, value, cost, net };
    if (level < 2) out.why = 'Needs a precious-metals refinery (Bank & upgrades).';
    else if (perT < CONC_MIN) out.why = 'Too lean: ' + Math.round(perT) + ' $/t of precious metal, the refiner wants ' + CONC_MIN + ' $/t. Concentrate it with a sensor sorter first.';
    else if (net <= 0) out.why = 'The treatment charge would eat it all.';
    return out;
  }
  function assetValue(level) { let v = 0; for (let l = 1; l <= level && l < LEVELS.length; l++) v += LEVELS[l].cost; return v; }

  CS.Refinery = { LEVELS, BASE, PRECIOUS, ETA, CAST_PER_T, PREC_FEE, PREC_PER_T, CONC_PAY, CONC_PER_T, CONC_MIN, levelFor, quoteBucket, quoteConcentrate, assetValue };

  /* ======================= page integration ======================= */
  function start() {
    const API = CS.app; if (!API || API.refineryStarted) return; API.refineryStarted = true;
    let level = 0, panel = null;
    const Inv = () => CS.Inventory;
    const factor = (m) => (CS.Sim.prices.perMat && CS.Sim.prices.perMat[m]) || 1;
    const power = () => CS.Sim.prices.power;
    const preciousPrices = () => ({ gold: MATERIALS.gold.ingot * factor('gold'), silver: MATERIALS.silver.ingot * factor('silver') });

    function quote(mat) {
      const I = Inv(); if (!I) return null;
      const e = I.stock()[mat]; if (!e) return null;
      return quoteBucket(mat, e, level, I.quote ? I.quote(mat) : 0, power(), factor(mat));
    }
    function quoteMisc() { const I = Inv(); return I && I.misc ? quoteConcentrate(I.misc(), level, preciousPrices()) : null; }
    function credit(x) { API.S.money += x; API.S.lifetime += Math.max(0, x); }
    function refine(mat) {
      const q = quote(mat), I = Inv(); if (!q) return;
      if (!q.ok) { API.log(q.why, 'warn'); return; }
      if (API.S.run) { API.log('The furnace crew is on the line: refine between batches.', 'warn'); return; }
      const out = I.withdraw(mat, I.stock()[mat].t); if (!(out.t > 0)) return;
      credit(q.net);
      if (CS.Audio) CS.Audio.ui('ok');
      API.log('Refined ' + API.fmtNum(out.t, out.t >= 1 ? 1 : 3) + ' t of ' + MATERIALS[mat].name.toLowerCase() + ' into ' + API.fmtNum(q.metalT, q.metalT >= 1 ? 1 : 3) + ' t of ' + q.form + ': ' + API.fmtMoney(q.value) + ' less ' + API.fmtMoney(q.cost) + ' (' + API.fmtNum(q.kwh, 0) + ' kWh and charges) = ' + API.fmtMoney(q.net) + ', ' + (q.gain >= 0 ? API.fmtMoney(q.gain) + ' more' : API.fmtMoney(-q.gain) + ' less') + ' than selling it raw.', 'ok');
      after();
    }
    function refineMisc() {
      const q = quoteMisc(), I = Inv(); if (!q) return;
      if (!q.ok) { API.log(q.why, 'warn'); return; }
      if (API.S.run) { API.log('Refine between batches.', 'warn'); return; }
      const misc = I.misc(); Object.keys(misc).forEach((m) => I.withdrawMisc(m, misc[m].t));
      credit(q.net);
      if (CS.Audio) CS.Audio.ui('ok');
      API.log('Sold ' + API.fmtNum(q.t, 1) + ' t of MISC concentrate to the precious refinery by assay: ' + Object.keys(q.metal).map((m) => Math.round(q.metal[m] * 1e6) + ' g ' + m).join(', ') + ' paid at ' + Math.round(CONC_PAY * 100) + '% (' + API.fmtMoney(q.value) + ') less ' + API.fmtMoney(q.cost) + ' treatment = ' + API.fmtMoney(q.net) + '. The copper, plastic and glass around it went with it.', 'ok');
      after();
    }
    function after() { API.renderBank(); API.save(); API.markDirty(true); }
    function buy() {
      const next = level + 1; if (next >= LEVELS.length) return;
      if (!API.spend(LEVELS[next].cost, LEVELS[next].name)) { render(); return; }
      level = next;
      if (CS.Audio) CS.Audio.ui('ok');
      API.log(LEVELS[next].name + ' built for ' + API.fmtMoney(LEVELS[next].cost) + ': ' + LEVELS[next].desc.toLowerCase() + '. REFINE appears on the buckets it can take.', 'ok');
      API.save(); API.markDirty(true);
    }
    function render() {
      if (!panel) return;
      const body = panel.querySelector('.rf-body'); body.innerHTML = '';
      LEVELS.slice(1).forEach((L, i) => {
        const l = i + 1, have = level >= l;
        const row = API.el('div', 'urow', '<span class="ic">' + (l === 1 ? '&#9832;' : '&#9733;') + '</span><span><div class="nm">' + API.esc(L.name) + (have ? ' <span class="small">BUILT</span>' : '') + '</div><div class="cur">' + API.esc(L.desc) + '</div></span>');
        const b = document.createElement('button'); b.type = 'button';
        if (have) { b.textContent = 'BUILT'; b.className = 'buy max'; b.disabled = true; }
        else if (l > level + 1) { b.textContent = API.fmtMoney(L.cost); b.className = 'buy poor'; b.disabled = true; b.title = 'Build the ' + LEVELS[l - 1].name.toLowerCase() + ' first'; }
        else { b.textContent = API.fmtMoney(L.cost); b.className = 'buy' + (API.S.money < L.cost ? ' poor' : ''); b.addEventListener('click', buy); }
        row.appendChild(b); body.appendChild(row);
      });
      body.appendChild(API.el('div', 'small', 'Refining pays the ingot or bar price for the metal in a sorted bucket, less melt loss and the energy to melt it. Use REFINE on the bucket list.'));
    }

    API.on('load', (ext) => { const d = ext && ext.refinery; level = d && d.level >= 0 && d.level < LEVELS.length ? Math.floor(d.level) : 0; });
    if (API.S && API.S.ext) { const d = API.S.ext.refinery; level = d && d.level > 0 ? Math.min(LEVELS.length - 1, Math.floor(d.level)) : 0; }
    API.on('save', () => ({ refinery: { level } }));
    API.on('assetValue', (q) => { if (q) q.value += assetValue(level); });
    API.on('newgame', () => { level = 0; render(); });
    API.on('boot', () => {
      panel = API.addPanel('left', 'refinery-panel', 'Refinery', 'bank-panel');
      panel.appendChild(API.el('div', 'rf-body'));
      render();
    });
    API.on('render', render);
    CS.Refinery.live = { level: () => level, quote, quoteMisc, refine, refineMisc };
  }
  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
