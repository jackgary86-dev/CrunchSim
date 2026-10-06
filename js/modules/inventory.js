/* CrunchSim module: inventory. Products no longer sell the moment a batch ends: they are held as bales, big bags,
 * bins and drums in yard bays and sold on a market. With js/modules/market.js loaded (it must load first) prices are
 * the per-material factors that module sets each round; without it they drift slowly with the mission clock.
 *
 * The pure parts (unit tables, stock merging, cost basis, withdrawal, storage rent, price targets, the fallback market
 * walk, selling, serialization) live on CS.Inventory and touch no DOM, so tests/inventory.js can run them in Node.
 * Everything that needs the page runs only when CS.app exists.
 *
 * Stock per material is { t, purity, grade, sf, p80, cost }:
 *   t       tonnes held
 *   purity  mass-weighted share of that material in the bins it came from (display)
 *   grade   mass-weighted price grade of those bins (Sim.binStats grade, 0.15..1)
 *   sf      size factor, weighted by mass x grade so that  t x grade x sf  equals the sum of the bins' value terms:
 *           merging two lots never creates or destroys value
 *   p80     geometric mean P80 in mm (picks bale vs big bag for rubber and bin vs big bag for stone)
 *   cost    $ cost basis of the lot: the batch's feed, power and consumables allocated to its products by sales value at
 *           split-off (the joint-cost method a yard uses to cost by-products), plus the storage rent it has paid
 * Value of a lot = t x MATERIALS[m].sell x Sim.prices.market x factor[m] x grade x sf, the same formula Sim.binStats
 * uses at batch end.
 *
 * Sorted only (#52): a batch's pure bins (one material at 90% or better, Sim.binStats sellable) go into stock as one
 * lot of their main material; mixed bins go to the MISC store { mat: { t, p80 } }, which cannot be sold and is only
 * re-run through the plant. A saved stock lot below 90% purity (from before this rule) moves to MISC on load.
 *
 * Hold-to-sell (ticket #34): a per-material price target raises an alert in the event log when the market reaches it
 * and, with the auto-sell switch on (off by default), sells the lot at once. Yard bays rent per round; the owned bays grow
 * through the 'storage' entry of PLANT_UPGRADES. Each held material gets a sparkline of the last 30 rounds of price with
 * list price, your average cost and your target. CS.Inventory.withdraw(mat, t) hands held stock to the missions worker.
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
    water: { name: 'drum', kg: 200 },                                             // 200 L (55 US gal) drum
    silver: { name: 'bar', kg: 31 },                                              // a 1,000 troy ounce good-delivery bar is 31.1 kg
    gold: { name: 'kilo bar', kg: 1 }                                             // gold trades in kilo bars (and 12.4 kg good-delivery bars)
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
  /* Add dt tonnes of `mat` with the given bin qualities and (optionally) the $ cost of producing them.
   * Weighted merge, value preserving (see the header). */
  function addLot(stock, mat, dt, purity, grade, sf, p80, cost) {
    if (!(dt > 0) || !MATERIALS[mat]) return;
    purity = clamp(+purity || 0, 0, 1); grade = clamp(isFinite(+grade) ? +grade : 1, 0, 1.5); sf = clamp(isFinite(+sf) ? +sf : 1, 0, 1);
    cost = isFinite(+cost) && +cost > 0 ? +cost : 0;
    const lnp = Math.log(p80 > 0 ? p80 : 1e-3);
    const e = stock[mat];
    if (!e) { stock[mat] = { t: dt, purity, grade, sf, p80: Math.exp(lnp), cost }; return; }
    const t = e.t + dt;
    const g = (e.t * e.grade + dt * grade) / t;
    const vs = e.t * e.grade * e.sf + dt * grade * sf;       // sum of value terms, to be preserved
    e.sf = g > 0 ? vs / (t * g) : 1;
    e.purity = (e.t * e.purity + dt * purity) / t;
    e.p80 = Math.exp((e.t * Math.log(e.p80) + dt * lnp) / t);
    e.grade = g; e.t = t; e.cost = (e.cost || 0) + cost;
  }
  /* $ per tonne the held lot cost to make and keep */
  function avgCost(stock, mat) { const e = stock[mat]; return e && e.t > 0 ? (e.cost || 0) / e.t : 0; }
  /* Move every bin of a finished batch into stock. bins: [{st: binStats}] per head-tonne, tonnes: head tonnes run,
   * batchCost: $ the batch cost (feed, power, consumables), shared out by sales value at split-off; by mass if nothing sells.
   * Returns what this batch produced per material: { mat: { t, n, unit, p80, cost } }. */
  /* MISC: mixed material that has not been sorted yet. { mat: { t, p80 } }; never sold, only re-run. */
  function newMisc() { return {}; }
  function addMisc(misc, mat, dt, p80) {
    if (!(dt > 0) || !MATERIALS[mat]) return;
    if (mat === 'water') return;   // free water in a lot (rain, wash water) drains to the yard sewer; it is never kept as MISC
    const e = misc[mat], lnp = Math.log(p80 > 0 ? p80 : 1e-3);
    if (!e) { misc[mat] = { t: dt, p80: Math.exp(lnp) }; return; }
    e.p80 = Math.exp((e.t * Math.log(e.p80 > 0 ? e.p80 : 1e-3) + dt * lnp) / (e.t + dt)); e.t += dt;
  }
  function withdrawMisc(misc, mat, t) {
    const e = misc[mat]; if (!e || !(e.t > 0) || !(t > 0)) return { t: 0, p80: 0 };
    const take = Math.min(+t, e.t); e.t -= take; const out = { t: take, p80: e.p80 };
    if (e.t <= 1e-9) delete misc[mat];
    return out;
  }
  /* #168: shipping MISC out, as yards do with mixed residue: a downstream mixed-metals processor pays about a fifth of the
   * metal's value (it still has to sort it); the rest goes where its kind goes: waste wood to biomass or mulch (~$10/t),
   * stone and glass to inert fill (~$20/t), plastics and rubber to landfill (~$55/t, near the US average gate fee), liquids
   * and gels to treatment (~$40/t). Returns { t, metal, fee, net }. */
  const MISC_METAL_SHARE = 0.2, LANDFILL_PER_T = 55, GATE = { wood: 10, granite: 20, limestone: 20, glass: 20, water: 40, gel: 40 };
  function miscDumpQuote(misc) {
    let t = 0, metal = 0, fee = 0;
    for (const m in misc || {}) {
      const e = misc[m], D = MATERIALS[m]; if (!e || !(e.t > 0) || !D) continue;
      t += e.t;
      if (D.magnetic || D.sigma > 0) metal += e.t * D.sell * MISC_METAL_SHARE; else fee += e.t * (GATE[m] != null ? GATE[m] : LANDFILL_PER_T);
    }
    return { t, metal, fee, net: metal - fee };
  }
  function miscTotal(misc) { let t = 0; for (const m in misc || {}) t += misc[m].t > 0 ? misc[m].t : 0; return t; }

  /* A finished batch: each sellable (pure) bin becomes one lot of its main material, at the bin's purity, grade and
   * a size factor that keeps the bin's value exactly; each mixed bin goes to MISC material by material. The batch cost
   * is shared over the sellable lots by value (MISC carries none: it has no sale value yet). */
  function absorbBins(stock, bins, tonnes, batchCost, misc) {
    const produced = {};
    if (!(tonnes > 0)) return produced;
    const lots = []; let valTot = 0, massTot = 0;
    (bins || []).forEach(function (b) {
      const st = b && b.st; if (!st || !(st.total > 0)) return;
      const sellable = st.sellable != null ? st.sellable : st.share >= 0.9;
      if (!sellable) {
        if (misc) for (const mat in st.perMat) { const pm = st.perMat[mat]; if (pm && pm.mass > 0) addMisc(misc, mat, pm.mass / 1000 * tonnes, pm.p80); }
        return;
      }
      let main = st.main, mm = 0;
      if (!main || !MATERIALS[main]) for (const mat in st.perMat) if (st.perMat[mat].mass > mm) { mm = st.perMat[mat].mass; main = mat; }
      if (!main || !MATERIALS[main]) return;
      const g = clamp(isFinite(+st.grade) ? +st.grade : 1, 0, 1.5);
      // value of the bin before the market, per tonne of feed: what each material in it is paid as (priceFactor, #35) x size
      let vb = 0;
      for (const mat in st.perMat) { const pm = st.perMat[mat]; if (!(pm.mass > 0) || !MATERIALS[mat]) continue; vb += pm.mass / 1000 * MATERIALS[mat].sell * (pm.priceFactor == null ? 1 : pm.priceFactor) * (isFinite(+pm.sizeFactor) ? +pm.sizeFactor : 1) * g; }
      const dt = st.total / 1000 * tonnes, val = vb * tonnes;
      const sf = dt > 0 && g > 0 ? clamp(val / (dt * MATERIALS[main].sell * g), 0, 1) : 0;
      lots.push({ mat: main, dt, purity: st.share, grade: g, sf, p80: st.perMat[main] ? st.perMat[main].p80 : st.p80, val: val > 0 ? val : 0 });
      valTot += val > 0 ? val : 0; massTot += dt;
    });
    const cTot = isFinite(+batchCost) && +batchCost > 0 ? +batchCost : 0;
    lots.forEach(function (l) {
      const cost = cTot > 0 ? cTot * (valTot > 0 ? l.val / valTot : l.dt / massTot) : 0;
      addLot(stock, l.mat, l.dt, l.purity, l.grade, l.sf, l.p80, cost);
      const p = produced[l.mat] || (produced[l.mat] = { t: 0, lnp: 0, cost: 0 });
      p.lnp = (p.t * p.lnp + l.dt * Math.log(l.p80 > 0 ? l.p80 : 1e-3)) / (p.t + l.dt); p.t += l.dt; p.cost += cost;
    });
    for (const mat in produced) {
      const p = produced[mat], u = unitsOf(mat, p.t, Math.exp(p.lnp));
      produced[mat] = { t: p.t, n: u.n, unit: u.unit, p80: Math.exp(p.lnp), cost: p.cost };
    }
    return produced;
  }
  /* Take up to t tonnes of `mat` out of stock (for a delivery). Returns { t, purity, grade, sf, p80, cost } of what left:
   * t is the tonnage actually withdrawn, never more than is held, and purity is the lot's average purity. */
  function withdrawLot(stock, mat, t) {
    const e = stock[mat];
    if (!e || !(e.t > 0) || !(t > 0)) return { t: 0, purity: 0, grade: 0, sf: 0, p80: 0, cost: 0 };
    const take = Math.min(+t, e.t), fr = take / e.t;
    const out = { t: take, purity: e.purity, grade: e.grade, sf: e.sf, p80: e.p80, cost: (e.cost || 0) * fr };
    e.t -= take; e.cost = (e.cost || 0) - out.cost;
    if (e.t <= 1e-9) delete stock[mat];
    return out;
  }
  /* value of a lot before the market: t x sell x grade x sf */
  function baseValue(stock, mat) { const e = stock[mat]; return e ? e.t * MATERIALS[mat].sell * e.grade * e.sf : 0; }
  function lotValue(stock, mat, mkt, marketMul) { return baseValue(stock, mat) * mul(marketMul) * drift(mkt, mat); }
  function stockTotals(stock, mkt, marketMul) {
    let value = 0, units = 0, t = 0, cost = 0;
    for (const mat in stock) { const e = stock[mat]; if (!(e.t > 0)) continue; value += lotValue(stock, mat, mkt, marketMul); units += unitsOf(mat, e.t, e.p80).n; t += e.t; cost += e.cost || 0; }
    return { value, units, t, cost };
  }

  /* ---------------- yard storage ----------------
   * One product per bay, except that small lots (under smallT) share one bay on the bagged-goods rack. Bay size, owned
   * bays per level and the rents come from PLANT_UPGRADES.storage (data.js), with the same figures as fallbacks here so
   * the module works if the entry is missing.
   */
  function storageCfg() {
    const U = CS.PLANT_UPGRADES && CS.PLANT_UPGRADES.storage;
    return {
      bayT: U && U.bayT > 0 ? U.bayT : 60,                                   // t per bay: 10 x 10 m push-wall bay, 2 m deep, 0.3 t/m3
      smallT: U && U.smallT > 0 ? U.smallT : 3,                              // t below which a lot is a few bales or bags on the shared rack
      rentOwn: U && U.rent && isFinite(+U.rent.own) ? +U.rent.own : 8,       // $ per owned bay per round: 100 m2 of industrial land at ~$1.5/m2/month, one batch a working day
      rentHired: U && U.rent && isFinite(+U.rent.hired) ? +U.rent.hired : 40, // $ per hired bay per round: outdoor storage at a neighbour at ~$3/m2/month plus a loader in and out
      levels: U && Array.isArray(U.levels) && U.levels.length ? U.levels : [2]
    };
  }
  function ownedBays(level) { const L = storageCfg().levels; return L[Math.max(0, Math.min(L.length - 1, Math.floor(+level || 0)))]; }
  function baysFor(t, bayT) { return t > 1e-6 ? Math.ceil(t / (bayT || storageCfg().bayT) - 1e-9) : 0; }
  /* bays in use, owned vs hired, the round's rent and how it falls on each material. perMat[mat] is the bays a lot
   * takes on its own; the lots listed in `shared` sit together in one more bay and split its rent evenly. */
  function storage(stock, owned, miscT) {
    const cfg = storageCfg(), perMat = {}, shared = [], weight = {}; let bays = 0;
    const lots = {}; for (const mat in stock) lots[mat] = stock[mat].t;
    if (miscT > 1e-6) lots.misc = miscT;   // the MISC pile takes yard space like any product
    for (const mat in lots) {
      const t = lots[mat]; if (!(t > 1e-6)) continue;
      if (t < cfg.smallT) { shared.push(mat); continue; }
      const n = baysFor(t, cfg.bayT); perMat[mat] = n; weight[mat] = n; bays += n;
    }
    if (shared.length) { bays += 1; shared.forEach(function (mat) { weight[mat] = 1 / shared.length; }); }
    owned = Math.max(0, Math.floor(+owned) || 0);
    const own = Math.min(bays, owned), hired = Math.max(0, bays - owned);
    const rent = own * cfg.rentOwn + hired * cfg.rentHired, rentPerMat = {};
    for (const mat in weight) rentPerMat[mat] = bays > 0 ? rent * weight[mat] / bays : 0;
    return { bays, perMat, shared, owned, own, hired, rent, rentPerMat, bayT: cfg.bayT, smallT: cfg.smallT, rentOwn: cfg.rentOwn, rentHired: cfg.rentHired };
  }
  /* charge a round's rent against the lots' cost basis; returns the storage summary */
  function chargeStorage(stock, owned, miscT) {
    const s = storage(stock, owned, miscT);
    for (const mat in s.rentPerMat) if (stock[mat]) stock[mat].cost = (stock[mat].cost || 0) + s.rentPerMat[mat];
    return s;
  }

  /* ---------------- price targets ----------------
   * targets[mat] = { price: $/t (0 = none), auto: sell at once when reached, hit: alert already raised at this level }
   */
  function newTargets() { return {}; }
  function setTarget(targets, mat, price, auto) {
    if (!MATERIALS[mat]) return null;
    price = isFinite(+price) && +price > 0 ? +price : 0;
    if (!price) { delete targets[mat]; return null; }
    const t = targets[mat] || (targets[mat] = { price: 0, auto: false, hit: false });
    if (t.price !== price) t.hit = false;
    t.price = price; t.auto = !!auto;
    return t;
  }
  /* Events for every held material whose price has just reached its target. priceFn(mat) gives the live $/t. The hit flag
   * re-arms when the price drops below the target or the lot is gone, so a target fires once per crossing. */
  function targetEvents(targets, stock, priceFn) {
    const ev = [];
    for (const mat in targets) {
      const t = targets[mat]; if (!t || !(t.price > 0)) continue;
      const e = stock[mat], held = !!(e && e.t > 1e-6), p = priceFn(mat);
      if (!held || !(p >= t.price)) { t.hit = false; continue; }
      if (!t.hit) { t.hit = true; ev.push({ mat, price: p, target: t.price, t: e.t, auto: !!t.auto }); }
    }
    return ev;
  }

  /* ---------------- fallback market ----------------
   * Used only when js/modules/market.js is absent. drift[m] multiplies the list price. Each sim hour it takes one step
   * of a mean-reverting random walk (Ornstein-Uhlenbeck), clamped to 0.7..1.4. The step for (material, hour) comes from
   * a seeded hash, so the path is a pure function of the mission clock: replaying from hour 0 reproduces it exactly.
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
    return { mat, t: e.t, n: u.n, unit: u.unit, price, proceeds, grade: e.grade, sf: e.sf, purity: e.purity, cost: e.cost || 0 };
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
  function serialize(stock, mkt, targets, misc) {
    const s = {}, tg = {}, mi = {};
    for (const mat in (misc || {})) { const e = misc[mat]; if (e && e.t > 0) mi[mat] = { t: e.t, p80: e.p80 }; }
    for (const mat in stock) { const e = stock[mat]; if (e && e.t > 0) s[mat] = { t: e.t, purity: e.purity, grade: e.grade, sf: e.sf, p80: e.p80, cost: e.cost || 0 }; }
    for (const mat in (targets || {})) { const t = targets[mat]; if (t && t.price > 0) tg[mat] = { price: t.price, auto: !!t.auto, hit: !!t.hit }; }
    return { stock: s, misc: mi, market: { hour: mkt.hour, drift: Object.assign({}, mkt.drift), trend: Object.assign({}, mkt.trend) }, targets: tg };
  }
  /* Rebuild validated state from a saved object (or anything else: garbage gives fresh state).
   * Returns { stock, mkt, hadMarket, targets } where hadMarket says whether a usable market state was present. */
  function deserialize(d) {
    const stock = newStock(), mkt = newMarket(), targets = newTargets(), misc = newMisc(); let hadMarket = false;
    if (!d || typeof d !== 'object') return { stock, mkt, hadMarket, targets, misc };
    const s = d.stock && typeof d.stock === 'object' ? d.stock : {};
    for (const mat in s) {
      const e = s[mat]; if (!MATERIALS[mat] || !e || !(+e.t > 0)) continue;
      if (!(+e.purity >= 0.9)) { addMisc(misc, mat, +e.t, +e.p80); continue; }   // saved before #52: unsorted stock is MISC now
      addLot(stock, mat, +e.t, +e.purity, +e.grade, +e.sf, +e.p80, +e.cost);
    }
    const mi = d.misc && typeof d.misc === 'object' ? d.misc : {};
    for (const mat in mi) { const e = mi[mat]; if (MATERIALS[mat] && e && +e.t > 0) addMisc(misc, mat, +e.t, +e.p80); }
    const m = d.market;
    if (m && typeof m === 'object' && isFinite(+m.hour) && +m.hour >= 0 && m.drift && typeof m.drift === 'object') {
      hadMarket = true; mkt.hour = Math.floor(+m.hour);
      MAT_ORDER.forEach(function (id) {
        const v = +m.drift[id]; mkt.drift[id] = isFinite(v) ? clamp(v, DRIFT_MIN, DRIFT_MAX) : 1;
        const t = m.trend ? +m.trend[id] : 0; mkt.trend[id] = isFinite(t) ? t : 0;
      });
    }
    const tg = d.targets && typeof d.targets === 'object' ? d.targets : {};
    for (const mat in tg) { const t = tg[mat]; if (!t || typeof t !== 'object') continue; const r = setTarget(targets, mat, +t.price, !!t.auto); if (r) r.hit = !!t.hit; }
    return { stock, mkt, hadMarket, targets, misc };
  }

  /* ---------------- live stock (page) ---------------- */
  let liveStock = newStock(), liveMisc = newMisc();
  const Inv = {
    UNITS, DRIFT_MIN, DRIFT_MAX, SIGMA_H, KAPPA_H,
    unitFor, unitsOf, fmtUnits, pluralUnit,
    miscDumpQuote, MISC_METAL_SHARE, LANDFILL_PER_T, newStock, addLot, absorbBins, withdrawLot, newMisc, addMisc, takeMisc: withdrawMisc, miscTotal, avgCost, baseValue, lotValue, stockTotals,
    storageCfg, ownedBays, baysFor, storage, chargeStorage,
    newTargets, setTarget, targetEvents,
    newMarket, marketStep, marketAdvance, marketAt, priceOf, drift, trendOf, trendArrow,
    sell, sellAll, serialize, deserialize,
    /* the live stock: tonnes held per material (read-only view for other modules) */
    stock() { return liveStock; },
    /* the live MISC pile: mixed material waiting to be re-run (read-only view) */
    misc() { return liveMisc; },
    withdrawMisc(mat, tonnes) { return withdrawMisc(liveMisc, mat, tonnes); },
    dumpQuote() { return miscDumpQuote(liveMisc); },
    /* Deliver held stock: takes up to `tonnes` of `mat` out of the yard. Returns { t, purity, ... } with the tonnes actually
     * withdrawn and their average purity. Set by the page integration to refresh the panel; this is the no-page fallback. */
    withdraw(mat, tonnes) { return withdrawLot(liveStock, mat, tonnes); }
  };
  CS.Inventory = Inv;

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const API = CS.app; if (!API || API.inventoryStarted) return; API.inventoryStarted = true;
    let stock = liveStock, misc = liveMisc, mkt = newMarket(), hadMarket = false, targets = newTargets();
    let body = null;
    const Market = function () { return CS.Market && typeof CS.Market.view === 'function' ? CS.Market : null; };
    const clockHour = function () { return Math.floor((API.S ? API.S.clock : 0) / 3600); };
    const marketMul = function () { return CS.Sim.prices.market; };
    /* the market object prices are read from: the market module's view when it is loaded, else the hourly walk */
    const mv = function () { const M = Market(); return M ? M.view() : mkt; };
    const livePrice = function (mat) { return priceOf(mat, mv(), marketMul()); };
    const storageLevel = function () { return API.S && API.S.plant ? (API.S.plant.storage || 0) : 0; };

    function restore(ext) { const r = deserialize(ext && ext.inventory); stock = liveStock = r.stock; misc = liveMisc = r.misc; mkt = r.mkt; hadMarket = r.hadMarket; targets = r.targets; }
    function initStorage() { const S = API.S; if (S && S.plant) S.plant.storage = S.plant.storage || 0; }   // the app only initialises its four known keys
    function syncMarket() {
      if (Market()) return false;   // the market module owns prices: no hourly walk
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

    function sellMat(mat, why) {
      const r = sell(stock, mat, mv(), marketMul()); if (!r) return;
      credit(r.proceeds);
      API.emit('sale', { mat, t: r.t, proceeds: r.proceeds, purity: r.purity });   // milestones (#73)
      const margin = r.proceeds - r.cost;
      API.log((why || 'Sold') + ' ' + fmtUnits(r.n, r.unit) + ' of ' + matName(mat).toLowerCase() + ' (' + API.fmtNum(r.t, 1) + ' t at ' + fmtPrice(r.price) + '/t, grade ' + Math.round(r.grade * r.sf * 100) + '%) for ' + fmtPrice(r.proceeds) + (r.cost > 0 ? ', ' + (margin >= 0 ? 'margin ' : 'loss ') + fmtPrice(Math.abs(margin)) + ' on a cost of ' + fmtPrice(r.cost) : '') + '.', margin >= 0 ? 'ok' : 'warn');
      afterSale();
    }
    function sellEverything() {
      const r = sellAll(stock, mv(), marketMul()); if (!r.lots.length) return;
      credit(r.proceeds);
      r.lots.forEach(function (l) { API.emit('sale', { mat: l.mat, t: l.t, proceeds: l.proceeds, purity: l.purity }); });
      API.log('Sold all stock: ' + r.lots.map(function (l) { return fmtUnits(l.n, l.unit) + ' of ' + matName(l.mat).toLowerCase(); }).join(', ') + ' for ' + fmtPrice(r.proceeds) + '.', 'ok');
      afterSale();
    }
    function credit(amount) { API.S.money += amount; API.S.lifetime += Math.max(0, amount); }
    function afterSale() { if (CS.Audio) CS.Audio.ui('ok'); API.renderBank(); API.markDirty(false); renderPanel(); API.save(); }

    /* price targets: alerts and auto-sales for every crossing since the last check */
    function checkTargets() {
      const ev = targetEvents(targets, stock, livePrice);
      ev.forEach(function (e) {
        API.log('Price alert: ' + matName(e.mat) + ' at ' + fmtPrice(e.price) + '/t has reached your ' + fmtPrice(e.target) + '/t target (' + API.fmtNum(e.t, 1) + ' t held).', 'ok');
        if (e.auto) sellMat(e.mat, 'Auto-sell at target:');
      });
      return ev.length > 0;
    }
    function onTargetInput(mat, priceEl, autoEl) {
      const price = +priceEl.value, auto = !!autoEl.checked, had = targets[mat];
      const t = setTarget(targets, mat, price, auto);
      if (t) API.log('Target set: ' + matName(mat) + ' at ' + fmtPrice(t.price) + '/t, auto-sell ' + (t.auto ? 'on' : 'off') + '.');
      else if (had) API.log('Target cleared for ' + matName(mat) + '.');
      checkTargets(); renderPanel(); API.save();
    }

    /* sparkline: the last 30 rounds of price for one material with list price, your cost and your target */
    function drawSpark(cv, mat) {
      const M = Market(), mu = marketMul(), sell = MATERIALS[mat].sell;
      const hist = M ? M.history(mat) : [drift(mkt, mat)];
      const prices = hist.map(function (f) { return sell * mu * f; });
      const base = sell * mu, cur = prices[prices.length - 1], cost = avgCost(stock, mat), tgt = targets[mat] && targets[mat].price > 0 ? targets[mat].price : 0;
      const W = 150, H = 30, dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const ctx = cv.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const vals = prices.concat([base]); if (cost > 0) vals.push(cost); if (tgt > 0) vals.push(tgt);
      let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (!(hi > lo)) { lo = lo * 0.95; hi = hi * 1.05 || 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const x0 = 2, x1 = W - 6, y0 = 3, y1 = H - 3;
      const N = Math.max(2, (M ? M.HISTORY : 30));
      const xs = function (i) { return x0 + (x1 - x0) * (N - prices.length + i) / (N - 1); };
      const ys = function (v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); };
      const hline = function (v, col, dash) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, ys(v)); ctx.lineTo(x1, ys(v)); ctx.stroke(); ctx.setLineDash([]); };
      hline(base, '#7d8da0', [2, 3]);                 // list price x offtake deals
      if (cost > 0) hline(cost, '#ffb25c');            // your average cost
      if (tgt > 0) hline(tgt, '#5cffb1', [3, 2]);      // your target
      ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 1.5; ctx.beginPath();
      prices.forEach(function (p, i) { const x = xs(i), y = ys(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (prices.length > 1) ctx.stroke();
      ctx.fillStyle = cur >= base ? '#5cffb1' : '#ff5c6c'; ctx.beginPath(); ctx.arc(xs(prices.length - 1), ys(cur), 2.2, 0, 2 * Math.PI); ctx.fill();
    }

    function renderPanel() {
      if (!body) return;
      const mu = marketMul(), market = mv(), tot = stockTotals(stock, market, mu), M = Market();
      const sto = storage(stock, ownedBays(storageLevel()), miscTotal(misc));
      body.innerHTML = '';
      const ros = API.el('div', 'readouts', API.ro('STOCK VALUE', fmtPrice(tot.value), '', tot.value > 0 ? 'good' : '') + API.ro('UNITS', API.fmtNum(tot.units, tot.units >= 10 ? 0 : 1), '') + API.ro('IN STOCK', API.fmtNum(tot.t, 1), 't') +
        API.ro('YARD BAYS', sto.bays + ' / ' + sto.owned, 'used / owned', sto.hired > 0 ? 'hi' : '') + API.ro('STORAGE', fmtPrice(sto.rent), '/batch', sto.hired > 0 ? 'hi' : '') + API.ro('COST BASIS', fmtPrice(tot.cost), ''));
      body.appendChild(ros);
      const rows = MAT_ORDER.filter(function (mat) { return stock[mat] && stock[mat].t > 1e-6; });
      if (!rows.length) body.appendChild(API.el('div', 'empty', 'No sorted stock. Run a batch: pure buckets (one material at 90% or better) are baled and held here until you sell.'));
      rows.forEach(function (mat) {
        const e = stock[mat], D = MATERIALS[mat], u = unitsOf(mat, e.t, e.p80);
        const price = priceOf(mat, market, mu), pct = Math.round((drift(market, mat) - 1) * 100), tr = trendOf(market, mat);
        const hot = M && M.hot() && M.hot().mat === mat, cold = M && M.cold() && M.cold().mat === mat;
        const tg = targets[mat], cost = avgCost(stock, mat);
        const row = API.el('div', 'urow',
          '<span class="ic"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + D.color + ';border:1px solid rgba(0,0,0,.5)"></i></span>' +
          '<span><div class="nm">' + API.esc(D.name) + ' <span class="small">' + API.esc(fmtUnits(u.n, u.unit)) + '</span>' + (hot ? '<span class="tag hot">HOT</span>' : cold ? '<span class="tag cold">COLD</span>' : '') + '</div>' +
          '<div class="cur">' + API.fmtNum(e.t, 1) + ' t · purity ' + Math.round(e.purity * 100) + '% · <b>' + fmtPrice(price) + '</b>/t ' +
          '<span class="' + (tr > 0 ? 'ok' : tr < 0 ? 'bad' : '') + '">' + trendArrow(market, mat) + '</span> <span class="' + (pct > 0 ? 'ok' : pct < 0 ? 'bad' : '') + '">' + (pct > 0 ? '+' : '') + pct + '%</span></div>' +
          '<div class="cur">cost <b class="' + (cost > 0 && price < cost ? 'bad' : '') + '">' + fmtPrice(cost) + '</b>/t · ' + (sto.perMat[mat] ? sto.perMat[mat] + ' bay' + (sto.perMat[mat] === 1 ? '' : 's') : 'shared bay') + '</div>' +
          '<canvas class="spark" title="Price over the last 30 batches: list (grey), your cost (amber), target (green)"></canvas>' +
          '<div class="tgt"><label>TARGET $<input type="number" min="0" step="1" placeholder="—" value="' + (tg && tg.price > 0 ? Math.round(tg.price) : '') + '">/t</label><label><input type="checkbox"' + (tg && tg.auto ? ' checked' : '') + '>AUTO-SELL</label></div></span>');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'buy'; b.textContent = 'SELL ' + fmtPrice(lotValue(stock, mat, market, mu));
        b.addEventListener('click', function () { sellMat(mat); });
        row.appendChild(b); body.appendChild(row);
        drawSpark(row.querySelector('canvas.spark'), mat);
        const pe = row.querySelector('.tgt input[type=number]'), ae = row.querySelector('.tgt input[type=checkbox]');
        pe.addEventListener('change', function () { onTargetInput(mat, pe, ae); });
        ae.addEventListener('change', function () { onTargetInput(mat, pe, ae); });
      });
      const all = document.createElement('button'); all.type = 'button'; all.className = 'buy' + (rows.length ? '' : ' poor'); all.disabled = !rows.length;
      all.textContent = 'SELL ALL · ' + fmtPrice(tot.value); all.style.width = '100%'; all.style.marginTop = '6px';
      all.addEventListener('click', sellEverything);
      body.appendChild(all);
      const mt = miscTotal(misc);
      if (mt > 1e-6) {
        const mats = Object.keys(misc).sort(function (a, b) { return misc[b].t - misc[a].t; });
        body.appendChild(API.el('div', 'urow', '<span class="ic">&#9636;</span><span><div class="nm">MISC <span class="small">' + API.fmtNum(mt, 1) + ' t not sorted yet</span></div><div class="cur">' + mats.slice(0, 4).map(function (m) { return API.esc(matName(m).toLowerCase()) + ' ' + Math.round(100 * misc[m].t / mt) + '%'; }).join(', ') + '</div><div class="cur">Mixed material cannot be sold. RE-RUN it from the plant screen through different sorters.</div></span>'));
      }
      body.appendChild(API.el('div', 'small', (M ? 'Prices move once per batch; the Market bulletin names the hot and cold grades. ' : 'Prices drift with the mission clock around list price × your offtake deals. ') +
        'Each product takes a ' + sto.bayT + ' t yard bay (lots under ' + sto.smallT + ' t share one): ' + fmtPrice(sto.rentOwn) + '/batch owned, ' + fmtPrice(sto.rentHired) + '/batch hired. Set a target to be told when the price gets there.'));
    }

    function onBatchComplete(p) {
      const r = p && p.r; if (!r || r.held !== 'inventory' || !(r.done > 0)) return;
      const batchCost = Math.max(0, (r.feedC || 0)) + Math.max(0, (p.powerC || 0)) + Math.max(0, (r.extra || 0));
      const m0 = miscTotal(misc);
      const produced = absorbBins(stock, p.bins, r.done, batchCost, misc);
      const mAdd = miscTotal(misc) - m0;
      const txt = producedText(produced);
      if (txt) API.log('Into inventory: ' + txt + (batchCost > 0 ? ' (cost basis ' + fmtPrice(batchCost) + ' shared by value)' : '') + '.', 'ok');
      if (mAdd > 1e-6) API.log('Into MISC: ' + API.fmtNum(mAdd, 1) + ' t of mixed material that no sorter separated. It cannot be sold: re-run it through different sorters.', txt ? '' : 'warn');
      // a round in the yard: rent on every bay in use, owned ones cheap, hired ones dear
      const sto = chargeStorage(stock, ownedBays(storageLevel()), miscTotal(misc));
      if (sto.rent > 0) {
        API.S.money -= sto.rent;
        API.log('Yard storage: ' + sto.bays + ' bay' + (sto.bays === 1 ? '' : 's') + ' in use (' + sto.own + ' owned, ' + sto.hired + ' hired), rent ' + fmtPrice(sto.rent) + ' this batch.' + (sto.hired > 0 ? ' Sell stock or buy Yard storage in the Plant drawer.' : ''), sto.hired > 0 ? 'warn' : '');
      }
      const card = document.querySelector('#scorecard .card');
      if (card) {
        const line = API.el('div', 'small', '<b class="cyan">UNITS PRODUCED</b> ' + (txt ? API.esc(txt) : 'none') + (mAdd > 1e-6 ? ' · <b class="cyan">TO MISC</b> ' + API.fmtNum(mAdd, 1) + ' t' : '') + (sto.rent > 0 ? ' · <b class="cyan">YARD RENT</b> ' + fmtPrice(sto.rent) : ''));
        line.style.marginTop = '8px';
        const tip = card.querySelector('.tip');
        if (tip) card.insertBefore(line, tip); else card.appendChild(line);
      }
      checkTargets();   // the market module (loaded first) has already moved prices for this round
      API.renderBank();
      renderPanel();
    }

    /* delivery for the missions worker: takes stock out, refreshes the panel, returns what left */
    Inv.withdraw = function (mat, tonnes) {
      const out = withdrawLot(stock, mat, tonnes);
      if (out.t > 0) { renderPanel(); API.save(); }
      return out;
    };

    /* the plant screen's bucket list sells one material at a time */
    Inv.sellMat = function (mat) { sellMat(mat); };
    Inv.misc = function () { return misc; };
    /* #96: tonnes a stopped batch took out of a bucket and did not run go back where they came from */
    Inv.putBack = function (src, mat, out) {
      if (!out || !(out.t > 0)) return;
      if (src === 'misc') addMisc(misc, mat, out.t, out.p80); else addLot(stock, mat, out.t, out.purity, out.grade, out.sf, out.p80, out.cost);
      renderPanel(); API.save();
    };
    Inv.dumpMisc = function () {   // #168
      let q = miscDumpQuote(misc); if (!(q.t > 0)) return q;
      let f = 1;   // a bank that cannot cover the whole fee ships the share it can pay for
      if (q.net < 0 && API.S.money < -q.net) { f = Math.max(0, API.S.money) / -q.net; if (f < 0.02) { API.log('Shipping the MISC out costs ' + API.fmtMoney(-q.net) + ': sell something first.', 'warn'); return null; } }
      if (f < 1) { q = { t: q.t * f, metal: q.metal * f, fee: q.fee * f, net: q.net * f }; q.net = -Math.min(-q.net, API.S.money); }   // rounding must not ask a cent more than the bank holds
      if (q.net < 0 && !API.spend(-q.net, 'shipping ' + q.t.toFixed(1) + ' t of MISC out')) return null;
      if (q.net > 0) { API.S.money += q.net; API.S.lifetime = (API.S.lifetime || 0) + q.net; }
      for (const m in misc) { if (f >= 1) delete misc[m]; else { misc[m].t *= 1 - f; if (misc[m].t <= 1e-6) delete misc[m]; } }
      API.log('Shipped ' + q.t.toFixed(1) + ' t of MISC out: the metal in it paid ' + API.fmtMoney(q.metal) + ', landfill took ' + API.fmtMoney(q.fee) + ' (net ' + (q.net >= 0 ? '+' : '') + API.fmtMoney(q.net) + '). The yard bays are free again.', q.net >= 0 ? 'ok' : 'warn');
      renderPanel(); API.save(); API.renderAll();
      return q;
    };
    Inv.dumpQuote = function () { return miscDumpQuote(misc); };
    Inv.withdrawMisc = function (mat, tonnes) { const out = withdrawMisc(misc, mat, tonnes); if (out.t > 0) { renderPanel(); API.save(); } return out; };
    Inv.quote = function (mat) { return stock[mat] && stock[mat].t > 0 ? lotValue(stock, mat, mv(), marketMul()) : 0; };   // what SELL would pay now (#44)

    /* hooks */
    API.on('veto:autoSell', function () { return 'inventory'; });
    if (API.booted) { restore(API.S.ext); initStorage(); API.renderBank(); } else { API.on('load', restore); API.on('load', initStorage); }
    API.on('boot', function () {
      syncMarket();
      const sec = API.addPanel('right', 'inventory-panel', 'Inventory & market', 'plant-panel');
      const css = document.createElement('style');
      css.textContent = '#inventory .spark{display:block;margin:4px 0 2px}#inventory .tgt{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size: 11px;letter-spacing:1px;color:var(--muted)}' +
        '#inventory .tgt label{display:flex;align-items:center;gap:2px}#inventory .tgt input[type=number]{width:64px;background:var(--panel-2);border:1px solid var(--line-2);border-radius:3px;color:var(--cyan);font-family:var(--mono);font-size:11px;padding:1px 4px}' +
        '#inventory .tgt input[type=number]:focus{outline:none;border-color:var(--cyan)}#inventory .tgt input[type=checkbox]{margin:0 3px 0 0;accent-color:var(--green)}' +
        '#inventory .tag.hot{color:var(--amber);border-color:var(--amber);margin-left:6px}#inventory .tag.cold{color:var(--cyan);border-color:var(--cyan);margin-left:6px}';
      sec.appendChild(css);
      body = API.el('div'); body.id = 'inventory'; sec.appendChild(body);
      renderPanel();
    });
    API.on('render', renderPanel);
    API.on('batchComplete', onBatchComplete);
    API.on('tick', function (p) { if (p && p.dh > 0 && syncMarket()) { checkTargets(); renderPanel(); } });
    API.on('save', function () { return { inventory: serialize(stock, mkt, targets, misc) }; });
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
