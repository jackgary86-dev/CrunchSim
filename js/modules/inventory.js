/* CrunchSim module: inventory. Products no longer sell the moment a batch ends: they are held as bales, big bags,
 * bins and drums and sold on a market whose prices drift slowly with the mission clock.
 *
 * The pure parts (unit tables, stock merging, market walk, selling, serialization) live on CS.Inventory and touch no
 * DOM, so tests/inventory.js can run them in Node. Everything that needs the page runs only when CS.app exists.
 *
 * Stock per material is { t, purity, grade, sf, p80 }:
 *   t       tonnes held
 *   purity  mass-weighted share of that material in the bins it came from (display)
 *   grade   mass-weighted price grade of those bins (Sim.binStats grade, 0.15..1)
 *   sf      size factor, weighted by mass x grade so that  t x grade x sf  equals the sum of the bins' value terms:
 *           merging two lots never creates or destroys value
 *   p80     geometric mean P80 in mm (picks bale vs big bag for rubber and bin vs big bag for stone)
 * Value of a lot = t x MATERIALS[m].sell x Sim.prices.market x drift[m] x grade x sf, the same formula Sim.binStats
 * uses at batch end with the market drift on top.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS, MAT_ORDER = CS.MAT_ORDER;

  /* ---------------- units ----------------
   * kg per unit. `fine` is the unit used when the lot's P80 is below `below` mm (crumb and flour go in bags).
   */
  const UNITS = {
    steel: { name: 'bale', kg: 1000 },                                            // shredded and baled steel (ISRI No. 2 bundle) runs about 1 t per bale or log
    castiron: { name: 'bin', kg: 10000 },                                         // broken cast iron is sold loose in a 10 t skip or roll-off bin
    aluminum: { name: 'bale', kg: 600 },                                          // baled aluminium scrap from a two-ram baler weighs 500-700 kg
    copper: { name: 'bale', kg: 500 },                                            // No. 2 copper bales are kept to about 0.5 t for forklift handling
    brass: { name: 'bale', kg: 500 },                                             // brass is baled like copper
    potmetal: { name: 'big bag', kg: 1000 },                                      // zinc die-cast (zorba heavies) ships in 1 t FIBC big bags
    wood: { name: 'big bag', kg: 300 },                                           // wood chips at about 0.3 t/m3 bulk density in a 1 m3 FIBC
    rubber: { name: 'bale', kg: 1000, fine: { below: 6, name: 'big bag', kg: 500 } }, // PAS 108 tyre-shred bales are about 1 t; crumb at 0.5 t/m3 in a 1 m3 bag
    plastic: { name: 'bale', kg: 500 },                                           // HDPE and PP bales from a horizontal baler weigh 400-600 kg
    glass: { name: 'big bag', kg: 1000 },                                         // cullet is 1.3 t/m3 but the bag is rated to its 1 t safe working load
    granite: { name: 'bin', kg: 15000, fine: { below: 1, name: 'big bag', kg: 1000 } }, // aggregate at 1.5 t/m3 fills a 10 m3 bin; rock flour in 1 t FIBCs
    limestone: { name: 'bin', kg: 15000, fine: { below: 1, name: 'big bag', kg: 1000 } }, // as granite
    gel: { name: 'drum', kg: 204 },                                               // 200 L steel drum x 1.02 g/cc
    water: { name: 'drum', kg: 200 }                                              // 200 L (55 US gal) drum
  };
  const DEFAULT_UNIT = { name: 'bale', kg: 1000 };
  function unitFor(mat, p80) {
    const U = UNITS[mat] || DEFAULT_UNIT;
    if (U.fine && p80 > 0 && p80 < U.fine.below) return U.fine;
    return U;
  }
  function unitsOf(mat, t, p80) { const U = unitFor(mat, p80); return { n: t * 1000 / U.kg, unit: U.name, kg: U.kg }; }
  function pluralUnit(name, n) { return Math.abs(n - 1) < 1e-9 ? name : name + 's'; }
  function fmtUnits(n, name) { const r = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10; return r + ' ' + pluralUnit(name, r); }

  /* ---------------- stock ---------------- */
  function newStock() { return {}; }
  /* Add dt tonnes of `mat` with the given bin qualities. Weighted merge, value preserving (see the header). */
  function addLot(stock, mat, dt, purity, grade, sf, p80) {
    if (!(dt > 0) || !MATERIALS[mat]) return;
    purity = clamp(+purity || 0, 0, 1); grade = clamp(isFinite(+grade) ? +grade : 1, 0, 1); sf = clamp(isFinite(+sf) ? +sf : 1, 0, 1);
    const lnp = Math.log(p80 > 0 ? p80 : 1e-3);
    const e = stock[mat];
    if (!e) { stock[mat] = { t: dt, purity, grade, sf, p80: Math.exp(lnp) }; return; }
    const t = e.t + dt;
    const g = (e.t * e.grade + dt * grade) / t;
    const vs = e.t * e.grade * e.sf + dt * grade * sf;       // sum of value terms, to be preserved
    e.sf = g > 0 ? vs / (t * g) : 1;
    e.purity = (e.t * e.purity + dt * purity) / t;
    e.p80 = Math.exp((e.t * Math.log(e.p80) + dt * lnp) / t);
    e.grade = g; e.t = t;
  }
  /* Move every bin of a finished batch into stock. bins: [{st: binStats}] per head-tonne, tonnes: head tonnes run.
   * Returns what this batch produced per material: { mat: { t, n, unit } }. */
  function absorbBins(stock, bins, tonnes) {
    const produced = {};
    if (!(tonnes > 0)) return produced;
    (bins || []).forEach(function (b) {
      const st = b && b.st; if (!st || !(st.total > 0)) return;
      for (const mat in st.perMat) {
        const pm = st.perMat[mat]; if (!pm || !(pm.mass > 0)) continue;
        const dt = pm.mass / 1000 * tonnes;
        addLot(stock, mat, dt, pm.mass / st.total, st.grade, pm.sizeFactor, pm.p80);
        const p = produced[mat] || (produced[mat] = { t: 0, lnp: 0 });
        p.lnp = (p.t * p.lnp + dt * Math.log(pm.p80 > 0 ? pm.p80 : 1e-3)) / (p.t + dt); p.t += dt;
      }
    });
    for (const mat in produced) {
      const p = produced[mat], u = unitsOf(mat, p.t, Math.exp(p.lnp));
      produced[mat] = { t: p.t, n: u.n, unit: u.unit, p80: Math.exp(p.lnp) };
    }
    return produced;
  }
  /* value of a lot before the market: t x sell x grade x sf */
  function baseValue(stock, mat) { const e = stock[mat]; return e ? e.t * MATERIALS[mat].sell * e.grade * e.sf : 0; }
  function lotValue(stock, mat, mkt, marketMul) { return baseValue(stock, mat) * mul(marketMul) * drift(mkt, mat); }
  function stockTotals(stock, mkt, marketMul) {
    let value = 0, units = 0, t = 0;
    for (const mat in stock) { const e = stock[mat]; if (!(e.t > 0)) continue; value += lotValue(stock, mat, mkt, marketMul); units += unitsOf(mat, e.t, e.p80).n; t += e.t; }
    return { value, units, t };
  }

  /* ---------------- market ----------------
   * drift[m] multiplies the list price. Each sim hour it takes one step of a mean-reverting random walk
   * (Ornstein-Uhlenbeck), clamped to 0.7..1.4. The step for (material, hour) comes from a seeded hash, so the path
   * is a pure function of the mission clock: replaying from hour 0 reproduces it exactly.
   */
  const DRIFT_MIN = 0.7, DRIFT_MAX = 1.4;
  const SIGMA_H = 0.003;   // 0.3 % per sim hour ~ 1.5 %/day ~ 25 %/yr, the order of LME base-metal and ferrous-scrap price volatility
  const KAPPA_H = 0.002;   // pull back toward list price, half-life ~350 h (two weeks): scrap tracks smelter demand rather than wandering off
  const SEED = 0x5eed1e55;
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /* standard normal for (material, hour): Box-Muller on a stream seeded from both */
  function gaussAt(mat, hour) {
    const r = mulberry32((fnv(mat) ^ Math.imul(hour + 1, 0x9E3779B1) ^ SEED) >>> 0);
    const u1 = Math.max(r(), 1e-12), u2 = r();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function newMarket() { const m = { hour: 0, drift: {}, trend: {} }; MAT_ORDER.forEach(function (id) { m.drift[id] = 1; m.trend[id] = 0; }); return m; }
  function marketStep(mkt) {
    mkt.hour++;
    MAT_ORDER.forEach(function (id) {
      const d = mkt.drift[id] == null ? 1 : mkt.drift[id];
      const nd = clamp(d + KAPPA_H * (1 - d) + SIGMA_H * gaussAt(id, mkt.hour), DRIFT_MIN, DRIFT_MAX);
      mkt.trend[id] = 0.9 * (mkt.trend[id] || 0) + 0.1 * (nd - d);   // smoothed recent direction for the arrow
      mkt.drift[id] = nd;
    });
  }
  const MAX_REPLAY = 400000;   // hours; a hard cap on catch-up work (45 sim years)
  function marketAdvance(mkt, toHour) {
    toHour = Math.floor(toHour > 0 ? toHour : 0);
    let n = 0; while (mkt.hour < toHour && n++ < MAX_REPLAY) marketStep(mkt);
    return mkt;
  }
  /* market state as a pure function of the clock */
  function marketAt(hour) { return marketAdvance(newMarket(), hour); }
  function drift(mkt, mat) { const d = mkt && mkt.drift ? mkt.drift[mat] : 1; return isFinite(d) ? d : 1; }
  function mul(marketMul) { return marketMul == null ? 1 : marketMul; }
  function priceOf(mat, mkt, marketMul) { return MATERIALS[mat].sell * mul(marketMul) * drift(mkt, mat); }
  const TREND_EPS = 0.0005;   // about one sigma of the smoothed step: smaller moves show as flat
  function trendOf(mkt, mat) { const t = mkt && mkt.trend ? mkt.trend[mat] || 0 : 0; return t > TREND_EPS ? 1 : t < -TREND_EPS ? -1 : 0; }
  function trendArrow(mkt, mat) { const t = trendOf(mkt, mat); return t > 0 ? '▲' : t < 0 ? '▼' : '►'; }

  /* ---------------- selling ---------------- */
  function sell(stock, mat, mkt, marketMul) {
    const e = stock[mat]; if (!e || !(e.t > 0)) return null;
    const price = priceOf(mat, mkt, marketMul), proceeds = lotValue(stock, mat, mkt, marketMul);
    const u = unitsOf(mat, e.t, e.p80);
    delete stock[mat];
    return { mat, t: e.t, n: u.n, unit: u.unit, price, proceeds, grade: e.grade, sf: e.sf, purity: e.purity };
  }
  function sellAll(stock, mkt, marketMul) {
    const lots = []; let proceeds = 0;
    MAT_ORDER.concat(Object.keys(stock).filter(function (m) { return MAT_ORDER.indexOf(m) < 0; })).forEach(function (mat) {
      const r = sell(stock, mat, mkt, marketMul); if (r) { lots.push(r); proceeds += r.proceeds; }
    });
    return { lots, proceeds };
  }

  /* ---------------- persistence ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function serialize(stock, mkt) {
    const s = {};
    for (const mat in stock) { const e = stock[mat]; if (e && e.t > 0) s[mat] = { t: e.t, purity: e.purity, grade: e.grade, sf: e.sf, p80: e.p80 }; }
    return { stock: s, market: { hour: mkt.hour, drift: Object.assign({}, mkt.drift), trend: Object.assign({}, mkt.trend) } };
  }
  /* Rebuild validated state from a saved object (or anything else: garbage gives fresh state).
   * Returns { stock, mkt, hadMarket } where hadMarket says whether a usable market state was present. */
  function deserialize(d) {
    const stock = newStock(), mkt = newMarket(); let hadMarket = false;
    if (!d || typeof d !== 'object') return { stock, mkt, hadMarket };
    const s = d.stock && typeof d.stock === 'object' ? d.stock : {};
    for (const mat in s) {
      const e = s[mat]; if (!MATERIALS[mat] || !e || !(+e.t > 0)) continue;
      addLot(stock, mat, +e.t, +e.purity, +e.grade, +e.sf, +e.p80);
    }
    const m = d.market;
    if (m && typeof m === 'object' && isFinite(+m.hour) && +m.hour >= 0 && m.drift && typeof m.drift === 'object') {
      hadMarket = true; mkt.hour = Math.floor(+m.hour);
      MAT_ORDER.forEach(function (id) {
        const v = +m.drift[id]; mkt.drift[id] = isFinite(v) ? clamp(v, DRIFT_MIN, DRIFT_MAX) : 1;
        const t = m.trend ? +m.trend[id] : 0; mkt.trend[id] = isFinite(t) ? t : 0;
      });
    }
    return { stock, mkt, hadMarket };
  }

  const Inv = {
    UNITS, DRIFT_MIN, DRIFT_MAX, SIGMA_H, KAPPA_H,
    unitFor, unitsOf, fmtUnits, pluralUnit,
    newStock, addLot, absorbBins, baseValue, lotValue, stockTotals,
    newMarket, marketStep, marketAdvance, marketAt, priceOf, drift, trendOf, trendArrow,
    sell, sellAll, serialize, deserialize
  };
  CS.Inventory = Inv;

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const API = CS.app; if (!API || API.inventoryStarted) return; API.inventoryStarted = true;
    let stock = newStock(), mkt = newMarket(), hadMarket = false;
    let body = null;
    const clockHour = function () { return Math.floor((API.S ? API.S.clock : 0) / 3600); };
    const marketMul = function () { return CS.Sim.prices.market; };

    function restore(ext) { const r = deserialize(ext && ext.inventory); stock = r.stock; mkt = r.mkt; hadMarket = r.hadMarket; }
    function syncMarket() {
      const h = clockHour();
      if (!hadMarket || mkt.hour > h) { mkt = newMarket(); hadMarket = true; }   // no saved market, or a clock that went backwards: replay from zero
      if (mkt.hour < h) { marketAdvance(mkt, h); return true; }
      return false;
    }

    function fmtPrice(x) { return API.fmtMoney(x); }
    function matName(mat) { return MATERIALS[mat] ? MATERIALS[mat].name : mat; }
    function producedText(produced) {
      const parts = [];
      MAT_ORDER.forEach(function (mat) { const p = produced[mat]; if (p && p.t > 0) parts.push(fmtUnits(p.n, p.unit) + ' of ' + matName(mat).toLowerCase()); });
      return parts.join(', ');
    }

    function sellMat(mat) {
      const r = sell(stock, mat, mkt, marketMul()); if (!r) return;
      credit(r.proceeds);
      API.log('Sold ' + fmtUnits(r.n, r.unit) + ' of ' + matName(mat).toLowerCase() + ' (' + API.fmtNum(r.t, 1) + ' t at ' + fmtPrice(r.price) + '/t, grade ' + Math.round(r.grade * r.sf * 100) + '%) for ' + fmtPrice(r.proceeds) + '.', 'ok');
      afterSale();
    }
    function sellEverything() {
      const r = sellAll(stock, mkt, marketMul()); if (!r.lots.length) return;
      credit(r.proceeds);
      API.log('Sold all stock: ' + r.lots.map(function (l) { return fmtUnits(l.n, l.unit) + ' of ' + matName(l.mat).toLowerCase(); }).join(', ') + ' for ' + fmtPrice(r.proceeds) + '.', 'ok');
      afterSale();
    }
    function credit(amount) { API.S.money += amount; API.S.lifetime += Math.max(0, amount); }
    function afterSale() { if (CS.Audio) CS.Audio.ui('ok'); API.renderBank(); API.markDirty(false); renderPanel(); API.save(); }

    function renderPanel() {
      if (!body) return;
      const mu = marketMul(), tot = stockTotals(stock, mkt, mu);
      body.innerHTML = '';
      const ros = API.el('div', 'readouts', API.ro('STOCK VALUE', fmtPrice(tot.value), '', tot.value > 0 ? 'good' : '') + API.ro('UNITS', API.fmtNum(tot.units, tot.units >= 10 ? 0 : 1), '') + API.ro('IN STOCK', API.fmtNum(tot.t, 1), 't'));
      body.appendChild(ros);
      const rows = MAT_ORDER.filter(function (mat) { return stock[mat] && stock[mat].t > 1e-6; });
      if (!rows.length) body.appendChild(API.el('div', 'empty', 'Nothing in stock. Run a batch: products are baled and held here until you sell.'));
      rows.forEach(function (mat) {
        const e = stock[mat], D = MATERIALS[mat], u = unitsOf(mat, e.t, e.p80);
        const price = priceOf(mat, mkt, mu), pct = Math.round((drift(mkt, mat) - 1) * 100), tr = trendOf(mkt, mat);
        const row = API.el('div', 'urow',
          '<span class="ic"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + D.color + ';border:1px solid rgba(0,0,0,.5)"></i></span>' +
          '<span><div class="nm">' + API.esc(D.name) + ' <span class="small">' + API.esc(fmtUnits(u.n, u.unit)) + '</span></div>' +
          '<div class="cur">' + API.fmtNum(e.t, 1) + ' t · purity ' + Math.round(e.purity * 100) + '% · <b>' + fmtPrice(price) + '</b>/t ' +
          '<span class="' + (tr > 0 ? 'ok' : tr < 0 ? 'bad' : '') + '">' + trendArrow(mkt, mat) + '</span> <span class="' + (pct > 0 ? 'ok' : pct < 0 ? 'bad' : '') + '">' + (pct > 0 ? '+' : '') + pct + '%</span></div></span>');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'buy'; b.textContent = 'SELL ' + fmtPrice(lotValue(stock, mat, mkt, mu));
        b.addEventListener('click', function () { sellMat(mat); });
        row.appendChild(b); body.appendChild(row);
      });
      const all = document.createElement('button'); all.type = 'button'; all.className = 'buy' + (rows.length ? '' : ' poor'); all.disabled = !rows.length;
      all.textContent = 'SELL ALL · ' + fmtPrice(tot.value); all.style.width = '100%'; all.style.marginTop = '6px';
      all.addEventListener('click', sellEverything);
      body.appendChild(all);
      body.appendChild(API.el('div', 'small', 'Prices drift with the mission clock around list price × your offtake deals. Sell on a rise.'));
    }

    function onBatchComplete(p) {
      const r = p && p.r; if (!r || r.held !== 'inventory' || !(r.done > 0)) return;
      const produced = absorbBins(stock, p.bins, r.done);
      const txt = producedText(produced);
      if (txt) API.log('Into inventory: ' + txt + '.', 'ok');
      const card = document.querySelector('#scorecard .card');
      if (card) {
        const line = API.el('div', 'small', '<b class="cyan">UNITS PRODUCED</b> ' + (txt ? API.esc(txt) : 'none'));
        line.style.marginTop = '8px';
        const tip = card.querySelector('.tip');
        if (tip) card.insertBefore(line, tip); else card.appendChild(line);
      }
      renderPanel();
    }

    /* hooks */
    API.on('veto:autoSell', function () { return 'inventory'; });
    if (API.booted) restore(API.S.ext); else API.on('load', restore);
    API.on('boot', function () {
      syncMarket();
      const sec = API.addPanel('right', 'inventory-panel', 'Inventory & market', 'plant-panel');
      body = API.el('div'); body.id = 'inventory'; sec.appendChild(body);
      renderPanel();
    });
    API.on('render', renderPanel);
    API.on('batchComplete', onBatchComplete);
    API.on('tick', function (p) { if (p && p.dh > 0 && syncMarket()) renderPanel(); });
    API.on('save', function () { return { inventory: serialize(stock, mkt) }; });
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
