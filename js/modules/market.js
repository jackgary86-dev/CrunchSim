/* CrunchSim module: market. Per-material price swings (ticket #33). Loads before the inventory module, which reads it.
 *
 * Every round (one batch, counted on 'batchComplete') each material's list price takes one step of a seeded,
 * mean-reverting random walk bounded to 0.7..1.4 of base, and the trade bulletin names one HOT material (1.6..2.5x) and
 * one COLD material (0.4..0.7x) for that round. Hot and cold are never the same material and a material that was hot or
 * cold in the last three rounds is not picked again. The factor of every material is written to Sim.prices.perMat so
 * that Sim.binStats, the plant panel's product value and the batch revenue all agree with the bulletin.
 *
 * The pure parts (state, step, factors, serialization) live on CS.Market and touch no DOM, so tests/market.js can run
 * them in Node. CS.Market.price(mat) and CS.Market.factor(mat) read the live state the page integration keeps.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS, MAT_ORDER = CS.MAT_ORDER;

  /* ---------------- tuning ---------------- */
  const MIN = 0.7, MAX = 1.4;    // bounds of the ordinary walk, as a multiple of list price
  const SIGMA = 0.04;            // step per round: ferrous and non-ferrous scrap indices reprice in 3-5% moves between weekly settlements; a round is one batch, taken as one settlement
  const KAPPA = 0.10;            // pull back toward list price per round, half-life about 7 rounds: scrap follows smelter demand and reverts within weeks
  const HOT = [1.6, 2.5];        // a buyer short of material pays a 60-150% premium for prompt delivery (spot squeezes of that size are reported for copper cathode and clean cast)
  const COLD = [0.4, 0.7];       // a buyer's outage or an import glut knocks 30-60% off a grade until the stock clears
  const COOLDOWN = 3;            // rounds a material sits out after being hot or cold, so headlines rarely repeat
  const HISTORY = 30;            // rounds of price history kept per material, for the inventory sparklines
  const SEED = 0x3a9b1e77;

  /* ---------------- seeded PRNG (mulberry32, as in js/modules/auction.js) ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function uni(rng, a, b) { return a + (b - a) * rng(); }
  function normal(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }   // Box-Muller
  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  /* the draw for a round is a pure function of the round number and the mission clock hour it closed at */
  function roundSeed(round, hour) { return (SEED ^ Math.imul(round + 1, 0x9E3779B1) ^ Math.imul(hour + 1, 0x85EBCA6B)) >>> 0; }

  /* ---------------- trade bulletin reasons: one line each, trade-press style ---------------- */
  const REASONS = {
    hot: {
      steel: ['Mini-mills restock ahead of a rebar order book.', 'A Turkish buying spree lifts shredded scrap.'],
      castiron: ['Foundries pour engine blocks for a new truck line.', 'A pipe foundry outbids the mills for clean cast.'],
      aluminum: ['Secondary smelters are short of sorted shred.', 'Can-sheet mills run flat out and bid for every bale.'],
      copper: ['A cable plant restocks after a strike.', 'Cathode jumps on a mine outage; scrap follows.'],
      brass: ['Valve makers chase brass for a water-main contract.', 'Brass ingot makers are short of clean fittings.'],
      potmetal: ['Zinc die-casters rebuild stock after a smelter outage.', 'Galvanizers bid up zinc scrap.'],
      wood: ['Biomass boilers buy chips ahead of winter.', 'Board mills short of clean chip after a mill fire.'],
      rubber: ['A sports-surface contract wants crumb by the trainload.', 'Cement kilns burn tyre shred as fuel this quarter.'],
      plastic: ['Virgin resin is up; recyclers pay more for flake.', 'A packaging mandate lifts recycled-content demand.'],
      glass: ['A new container furnace runs on cullet.', 'Glass-wool makers take every tonne of cullet.'],
      granite: ['A highway job needs aggregate by the month.', 'A rail ballast tender lifts hard-rock prices.'],
      limestone: ['Cement kilns run full after a quarry closure.', 'Road base demand is up with the paving season.'],
      gel: ['A cosmetics launch buys micronized gel.', 'A pharma pilot plant orders hydrogel paste.'],
      water: ['Drought: process water is trucked in.']
    },
    cold: {
      steel: ['Mill outage: ferrous buyers step back.', 'Cheap billet imports flood the market.'],
      castiron: ['Foundry summer shutdowns: nobody wants cast.', 'A foundry closure leaves cast scrap unsold.'],
      aluminum: ['Smelters are flooded with imported shred.', 'A can-sheet mill idles a line; bales back up.'],
      copper: ['Cathode slides as warehouse stocks swell.', 'A cable plant idles; copper bales back up.'],
      brass: ['Brass mills destock; fittings pile up.', 'Cheap imported brass ingot undercuts scrap.'],
      potmetal: ['Zinc slides on an exchange stock build.', 'Die-casters are down for retooling.'],
      wood: ['A warm winter leaves the boilers full of chip.', 'A board mill strike leaves chip unsold.'],
      rubber: ['The crumb market is saturated after a big import.', 'Playground budgets are cut; crumb demand is off.'],
      plastic: ['Virgin resin is dumped below recycled flake.', 'A flake buyer defaults; the market is oversupplied.'],
      glass: ['Cullet stockpiles overflow after a furnace rebuild.', 'A bottle plant closes; cullet goes begging.'],
      granite: ['Paving season is over: aggregate yards are full.', 'A rail ballast tender is cancelled.'],
      limestone: ['A cement kiln is down for relining.', 'A wet winter stalls road base sales.'],
      gel: ['A cosmetics line is pulled; gel orders cancelled.', 'The gel buyer switches to a synthetic.'],
      water: ['Floods: nobody is buying water.']
    }
  };
  const GENERIC = { hot: ['A buyer is short and pays up for prompt delivery.'], cold: ['The usual buyer is out of the market.'] };

  /* ---------------- pure state ---------------- */
  function newState() {
    const s = { round: 0, hour: 0, walk: {}, prev: {}, hot: null, cold: null, recent: [], history: {} };
    MAT_ORDER.forEach(function (id) { s.walk[id] = 1; s.prev[id] = 1; s.history[id] = [1]; });
    return s;
  }
  function walkOf(state, mat) { const d = state && state.walk ? state.walk[mat] : 1; return isFinite(d) ? d : 1; }
  /* the factor on list price this round: the hot or cold premium if named, else the walk */
  function factorOf(state, mat) {
    if (!state) return 1;
    if (state.hot && state.hot.mat === mat) return state.hot.mul;
    if (state.cold && state.cold.mat === mat) return state.cold.mul;
    return walkOf(state, mat);
  }
  function sellable() { return MAT_ORDER.filter(function (id) { return MATERIALS[id].sell > 0; }); }
  function candidates(state) {
    const c = sellable().filter(function (id) { return state.recent.indexOf(id) < 0; });
    return c.length >= 2 ? c : sellable();
  }
  /* #213: a batch closes a round only when it did real work (at least 1 t, and a quarter of its tonnes unless it finished), so a start-then-STOP or a sliver run to completion cannot re-roll the bulletin */
  const MIN_SHARE = 0.25, MIN_TONNES = 1;
  function countsAsRound(r, why) {
    if (!r || !(r.done > 0)) return false;
    if (r.src === 'stock' || r.src === 'misc') return false;   // #294: a re-run of held stock or MISC is no new feed: it would re-roll the bulletin for the price of the power
    return r.done >= MIN_TONNES && (why === 'complete' || r.done >= MIN_SHARE * (r.total || 0));
  }

  /* one round: the walk steps, a hot and a cold material are named, history grows. hour: mission clock hour the batch closed at. */
  function step(state, hour) {
    hour = Math.floor(hour > 0 ? hour : 0);
    const rng = mulberry32(roundSeed(state.round + 1, hour));
    MAT_ORDER.forEach(function (id) { state.prev[id] = factorOf(state, id); });
    state.round++; state.hour = hour;
    MAT_ORDER.forEach(function (id) {
      const d = walkOf(state, id);
      state.walk[id] = clamp(d + KAPPA * (1 - d) + SIGMA * normal(rng), MIN, MAX);
    });
    const c = candidates(state);
    const hot = pick(rng, c), cold = pick(rng, c.filter(function (id) { return id !== hot; }));
    state.hot = { mat: hot, mul: Math.round(uni(rng, HOT[0], HOT[1]) * 100) / 100, why: pick(rng, REASONS.hot[hot] || GENERIC.hot) };
    state.cold = { mat: cold, mul: Math.round(uni(rng, COLD[0], COLD[1]) * 100) / 100, why: pick(rng, REASONS.cold[cold] || GENERIC.cold) };
    state.recent = state.recent.concat([hot, cold]).slice(-2 * COOLDOWN);
    MAT_ORDER.forEach(function (id) {
      const h = state.history[id] || (state.history[id] = []);
      h.push(factorOf(state, id));
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
    });
    return { round: state.round, hot: state.hot, cold: state.cold };
  }
  function factorsMap(state) { const m = {}; MAT_ORDER.forEach(function (id) { m[id] = factorOf(state, id); }); return m; }
  function trendMap(state) { const m = {}; MAT_ORDER.forEach(function (id) { m[id] = factorOf(state, id) - (state && state.prev && isFinite(state.prev[id]) ? state.prev[id] : 1); }); return m; }
  /* a market object in the shape js/modules/inventory.js prices with: { drift: {mat: factor}, trend: {mat: change} } */
  function viewOf(state) { return { hour: state ? state.round : 0, drift: factorsMap(state), trend: trendMap(state) }; }
  function priceOf(state, mat, marketMul) { return MATERIALS[mat].sell * (marketMul == null ? 1 : marketMul) * factorOf(state, mat); }
  function historyOf(state, mat) { const h = state && state.history ? state.history[mat] : null; return Array.isArray(h) && h.length ? h.slice() : [1]; }
  /* write the factors where Sim.binStats reads them */
  function applyToSim(state) { if (CS.Sim && CS.Sim.prices) CS.Sim.prices.perMat = factorsMap(state); }

  function serialize(state) {
    return { round: state.round, hour: state.hour, walk: Object.assign({}, state.walk), prev: Object.assign({}, state.prev), hot: state.hot ? Object.assign({}, state.hot) : null, cold: state.cold ? Object.assign({}, state.cold) : null, recent: state.recent.slice(), history: MAT_ORDER.reduce(function (o, id) { o[id] = historyOf(state, id); return o; }, {}) };
  }
  /* rebuild validated state from a saved object; garbage gives fresh state */
  function deserialize(d) {
    const s = newState();
    if (!d || typeof d !== 'object') return s;
    s.round = Math.max(0, Math.floor(+d.round) || 0); s.hour = Math.max(0, Math.floor(+d.hour) || 0);
    MAT_ORDER.forEach(function (id) {
      const w = d.walk ? +d.walk[id] : NaN; s.walk[id] = isFinite(w) ? clamp(w, MIN, MAX) : 1;
      const p = d.prev ? +d.prev[id] : NaN; s.prev[id] = isFinite(p) ? clamp(p, COLD[0], HOT[1]) : 1;
      const h = d.history && Array.isArray(d.history[id]) ? d.history[id].map(Number).filter(isFinite).map(function (v) { return clamp(v, COLD[0], HOT[1]); }) : [];
      s.history[id] = h.length ? h.slice(-HISTORY) : [1];
    });
    const tag = function (t, lo, hi, list) {
      if (!t || typeof t !== 'object' || !MATERIALS[t.mat] || !isFinite(+t.mul)) return null;
      return { mat: t.mat, mul: clamp(+t.mul, lo, hi), why: typeof t.why === 'string' && t.why ? t.why : (list[t.mat] || GENERIC[lo < 1 ? 'cold' : 'hot'])[0] };
    };
    s.hot = tag(d.hot, HOT[0], HOT[1], REASONS.hot); s.cold = tag(d.cold, COLD[0], COLD[1], REASONS.cold);
    if (s.hot && s.cold && s.hot.mat === s.cold.mat) s.cold = null;
    s.recent = (Array.isArray(d.recent) ? d.recent : []).filter(function (id) { return MATERIALS[id]; }).slice(-2 * COOLDOWN);
    return s;
  }

  /* ---------------- live state and the exported API ---------------- */
  let live = newState();
  const Market = {
    MIN, MAX, SIGMA, KAPPA, HOT, COLD, COOLDOWN, HISTORY, REASONS, mulberry32,
    newState, step, countsAsRound, MIN_SHARE, MIN_TONNES, factorOf, walkOf, factorsMap, trendMap, viewOf, priceOf, historyOf, applyToSim, serialize, deserialize, sellable,
    state() { return live; },
    round() { return live.round; },
    hot() { return live.hot; },
    cold() { return live.cold; },
    factor(mat) { return factorOf(live, mat); },
    price(mat) { return priceOf(live, mat, CS.Sim && CS.Sim.prices ? CS.Sim.prices.market : 1); },
    history(mat) { return historyOf(live, mat); },
    view() { return viewOf(live); }
  };
  CS.Market = Market;

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const API = CS.app; if (!API || API.marketStarted) return; API.marketStarted = true;
    let body = null;
    const clockHour = function () { return Math.floor((API.S ? API.S.clock : 0) / 3600); };
    const matName = function (mat) { return MATERIALS[mat] ? MATERIALS[mat].name : mat; };
    const fx = function (m) { return '×' + m.toFixed(2); };

    function restore(ext) { live = deserialize(ext && ext.market); applyToSim(live); }

    function logRound() {
      if (!live.hot || !live.cold) return;
      API.log('Market round ' + live.round + '. HOT: ' + matName(live.hot.mat) + ' ' + fx(live.hot.mul) + ' at ' + API.fmtMoney(Market.price(live.hot.mat)) + '/t: ' + live.hot.why, 'ok');
      API.log('Market round ' + live.round + '. COLD: ' + matName(live.cold.mat) + ' ' + fx(live.cold.mul) + ' at ' + API.fmtMoney(Market.price(live.cold.mat)) + '/t: ' + live.cold.why, 'warn');
    }

    function renderBulletin() {
      if (!body) return;
      body.innerHTML = '';
      if (!live.round) { body.appendChild(API.el('div', 'small', 'No bulletin yet. Prices move once per batch: complete one and the first swing comes in.')); return; }
      const tagRow = function (kind, t, cls) {
        return API.el('div', 'urow', '<span class="ic">' + (kind === 'HOT' ? '&#9650;' : '&#9660;') + '</span><span><div class="nm"><b class="' + cls + '">' + kind + '</b> ' + API.esc(matName(t.mat)) + ' <span class="num ' + cls + '">' + fx(t.mul) + '</span> <span class="small">' + API.fmtMoney(Market.price(t.mat)) + '/t</span></div><div class="cur">' + API.esc(t.why) + '</div></span>');
      };
      body.appendChild(API.el('div', 'small', 'ROUND ' + live.round + ' · closed at ' + API.fmtClock(live.hour * 3600) + ' · prices move once per batch'));
      if (live.hot) body.appendChild(tagRow('HOT', live.hot, 'ok'));
      if (live.cold) body.appendChild(tagRow('COLD', live.cold, 'bad'));
      const chips = API.el('div', 'chips');
      sellable().forEach(function (id) {
        const f = factorOf(live, id), hot = live.hot && live.hot.mat === id, cold = live.cold && live.cold.mat === id;
        const cls = hot ? 'hot' : cold ? 'cold' : f > 1.03 ? 'up' : f < 0.97 ? 'down' : '';
        chips.appendChild(API.el('span', 'tag ' + cls, API.esc(MATERIALS[id].name) + ' ' + fx(f)));
      });
      body.appendChild(chips);
    }

    function onBatchComplete(p) {
      const r = p && p.r; if (!countsAsRound(r, p && p.why)) return;
      if (p && !p.perMat && CS.Sim && CS.Sim.prices) p.perMat = Object.assign({}, CS.Sim.prices.perMat || {});   // #339: the factors this batch's bins were valued at, kept before the round steps
      step(live, clockHour());
      applyToSim(live);
      logRound();
      API.markDirty(false);   // the plant panel's product value now reads the new factors
      renderBulletin();
    }

    /* hooks */
    if (API.booted) { restore(API.S.ext); API.markDirty(false); } else API.on('load', restore);
    API.on('boot', function () {
      applyToSim(live);
      const sec = API.addPanel('right', 'market-panel', 'Market bulletin', 'plant-panel');
      const css = document.createElement('style');
      css.textContent = '#market-panel .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}#market-panel .chips .tag{font-family:var(--mono)}' +
        '#market-panel .tag.up{color:var(--green);border-color:var(--line-2)}#market-panel .tag.down{color:var(--red);border-color:var(--line-2)}' +
        '#market-panel .tag.hot{color:var(--amber);border-color:var(--amber)}#market-panel .tag.cold{color:var(--cyan);border-color:var(--cyan)}';
      sec.appendChild(css);
      body = API.el('div'); body.id = 'market'; sec.appendChild(body);
      renderBulletin();
    });
    API.on('render', renderBulletin);
    API.on('batchComplete', onBatchComplete);
    API.on('save', function () { return { market: serialize(live) }; });
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
