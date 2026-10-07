/* CrunchSim module: auction. Scrap lot board, variable lots and the feed market (tickets #24, #16, #23).
 * The lot generator and board logic are pure and live on CS.Auction so tests/auction.js can run them in Node.
 * The panel and game wiring below register through CS.app hooks only.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  const { MATERIALS, FEEDS } = CS;

  /* ---------------- seeded PRNG ---------------- */
  // mulberry32: 32-bit state, period 2^32; good enough for a lot board and reproducible from a saved state. Never Math.random.
  function mulberry32(seed) {
    let a = seed >>> 0;
    const r = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.getState = function () { return a; }; r.setState = function (s) { a = s >>> 0; };
    return r;
  }
  function uni(rng, a, b) { return a + (b - a) * rng(); }
  function normal(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }   // Box-Muller
  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  function normalise(c) { let t = 0; for (const m in c) { if (!(c[m] > 0)) delete c[m]; else t += c[m]; } if (t > 0) for (const m in c) c[m] /= t; return c; }
  function sameComp(a, b) { const keys = new Set(Object.keys(a).concat(Object.keys(b))); for (const k of keys) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6) return false; return true; }

  /* ---------------- lot economics ---------------- */
  const ALWAYS = ['elv', 'pallets', 'quarry'];   // the default feeds when a caller names none
  const WORTH_FACTOR = 0.6;     // a yard pays about 60% of finished-product value for unprocessed scrap; the rest is processing, yield loss and margin
  const VAR_SIGMA = 0.2;        // lot-to-lot scatter of each fraction: ELV ferrous content runs 65-75% between yards, about +-15% relative
  const DECL_SIGMA = 0.1;       // honest declaration vs weighbridge sample: scrap grading tolerance of about +-10%
  const BIAS_MAX = 0.35;        // sellers talk up the payable metals by up to a third and talk down the waste
  const VALUABLE = 1000;        // $/t: at or above this a material is "payable metal" the seller pushes (aluminum and up)
  const WASTE = 50;             // $/t: below this it is deductible waste (wood, glass, rock, water)
  const DEAL = { great: 0.25, fair: 0.5, terrible: 0.25 };   // a quarter of lots are bargains, half fair, a quarter bad buys
  // ask as a multiple of the going yard rate: fair = +-15% around it, great = 30-60% of it; terrible = 1.05-1.5x the full 0.6*sell worth
  const MULT = { great: [0.3, 0.6], fair: [0.85, 1.15], terrible: [1.05, 1.5] };
  const PAD = [0.25, 0.45];     // a padded lot hides 25-45% worthless material under the good stuff (dirt, moisture, dunnage, glass)
  const PAD_SHOWN = [0.2, 0.6]; // and the seller declares only 20-60% of that padding
  const TRAMP_HONEST = [0.03, 0.08];   // honest lots still carry 3-8% moisture or dirt; scrap purchase contracts deduct 2-15% for it
  const LIFE_H = [6, 48];       // online scrap auctions close in one to two days (sim hours)
  const TONS = [5, 1.2];        // 5 t (a skip lorry) up to 1.2x the logistics limit (a walking-floor trailer carries 20-25 t)
  const BOARD = { min: 3, max: 6, arriveH: 6 };   // three to six open lots; a new one arrives about every 6 sim hours (Poisson)
  // #48: the board the game shows is six lots, one per price tier. A tier's lot is about that much money's worth of scrap at a
  // fair price: a skip of mixed junk for $1k up to hundreds of tonnes, or a few tonnes of circuit boards, for $100k.
  const TIERS = [1000, 3000, 8000, 20000, 50000, 100000, 1000000, 10000000];
  const TIER_TONS = [0.1, 4000];
  const TIER_MAX_T = [30, 80, 200, 600, 1500, 4000, 3000, 10000];   // #103: the most a tier lot weighs, so cheap scrap is not a mountain (a few batches at that stage's batch size)
  // #343 #344: the $1M and $10M tiers open with rank (index into RANKS: Plant operator, Industrial group). They deal trainloads, up to the
  // rail siding (3,000 t) and loop track (10,000 t) logistics levels, so income keeps growing with the plant; the six base tiers are always dealt
  const TIER_RANK = [0, 0, 0, 0, 0, 0, 3, 4], BASE_TIERS = 6;
  const TIER_FIT_T = [4000, 4000, 4000, 4000, 4000, 4000, 15000, 100000];   // a feed fits a tier when the budget buys at most this many tonnes at a fair price (bulk scrap is then capped at TIER_MAX_T)
  function tiersOpen(rankIdx) { let n = 0; TIER_RANK.forEach((r) => { if (r <= (+rankIdx || 0)) n++; }); return Math.max(BASE_TIERS, n); }
  function tierLabel(k) { const v = TIERS[k]; return v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + v / 1000 + 'k'; }
  /* What each tier deals, lined up with the machines a plant can afford by then (start: hammermill and magnet):
   *   $1k  steel and wood only (pallets, office clear-outs): the starting magnet pulls the nails, the wood is left clean
   *   $3k  plus old windows (wood, glass, steel): a sink-float (water) tank floats the wood off the glass
   *   $8k  demolition rubble, tires and white goods: an air classifier blows off fabric and plastic film
   *   $20k car hulks and white goods: an eddy current separator throws the non-ferrous metals
   *   $50k zorba and mixed skips: density and size splits between the non-ferrous metals
   *   $100k electronics and connector pins: a sensor sorter picks copper, brass and the precious metals
   *   $1M   trainloads of car hulks, white goods and mixed skips, or a barge of zorba (from Plant operator)
   *   $10M  a unit train of the same bulk shredder feed (from Industrial group): the shredder line that got the yard here can run it;
   *         a cheap feed hits the 10,000 t cap well under the tier's money, only zorba spends it all
   * Gel and water are never dealt: there is nothing to sort. */
  const TIER_FEEDS = [
    ['pallets', 'chair'],
    ['pallets', 'chair', 'windows'],
    ['rubble', 'tires', 'appliance', 'windows'],
    ['elv', 'appliance', 'tires'],
    ['zorba', 'elv', 'everything', 'appliance'],
    ['ewaste', 'pins', 'zorba'],
    ['elv', 'everything', 'appliance', 'zorba'],
    ['elv', 'everything', 'appliance', 'zorba']
  ];   // a lot is at least a tonne and at most 4,000 t (a few trainloads)
  // feed market random walk: 3%/sqrt(h) (LME aluminium moves ~0.3%/sqrt(h), x10 for sim pace), mean-reverting to list price over about a day, pinned to 0.8-1.3x
  const MARKET = { lo: 0.8, hi: 1.3, sigma: 0.03, kappa: 0.05 };
  // bidding (ticket #31; js/modules/rivals.js places the bids): online industrial auctions raise in steps of about 5% of the standing bid, $1/t at least
  const BID = { step: 0.05, min: 1 };

  const TRAMP = [
    { m: 'water', what: 'moisture', note: 'Moisture not deducted; the pile has been outside all winter.' },
    { m: 'limestone', what: 'dirt and concrete', note: 'Dug out of the old tip. Some concrete and dirt came up with it.' },
    { m: 'wood', what: 'dunnage', note: 'Bales pressed with the dunnage and pallets still in.' },
    { m: 'glass', what: 'glass', note: 'Glass not screened out of this one.' }
  ];
  const SELLERS = ['Riverside Auto Dismantlers', 'Northgate Demolition', 'Harbour Pallet Co.', 'Mill End Tyre Depot', 'Westfield Quarries', 'Two Rivers Metals', 'Kestrel Salvage', 'Bayside Foundry', 'Delta Haulage (abandoned load)', 'County Highways depot', 'Oldfield Scrap and Steel', 'Lakeside Plating Works'];
  const NOTES = {
    great: ['Yard closing, must clear by Friday.', 'Insurance write-off, sold at scrap value with a weighbridge ticket.', 'Surplus from a cancelled contract, priced to move.', 'Sampled and graded, inspection welcome, loaded free.'],
    fair: ['Regular weekly lot, ticket available.', 'Sampled and graded as declared.', 'Loaded on request, haulage not included.', 'Mixed lot, as per declaration.', 'Repeat seller, usual quality.'],
    terrible: ['Sold as seen. No sampling, no weighbridge ticket, no claims.', 'Photos are of a previous lot. Seller firm on price.', 'Buyer takes all, no returns. Declaration is the seller\'s own estimate.', 'Seller declines a pre-sale inspection.'],
    tramp: ['Carries a little {what}, declared.', 'Some {what} in the load, allowed for in the declaration.']
  };

  function worthOf(comp) { let w = 0; for (const m in comp) if (MATERIALS[m]) w += comp[m] * MATERIALS[m].sell; return w * WORTH_FACTOR; }
  // going yard rate as a fraction of worth: US shredder yards pay $100-150/t for hulks against $300-400/t of shred, about a third;
  // zorba, a semi-finished product, trades nearer 80%. Read off the preset supplier price, floored at 0.3 for feeds you are paid to take.
  function fairRatio(id) { const F = FEEDS[id]; const w = F ? worthOf(F.comp) : 0; return w > 0 ? clamp(F.cost / w, 0.3, 0.8) : 0.3; }

  /* Generate one lot. opts: { feeds: [ids], limit: t per batch, clockH: sim hours, market: {id: factor}, id } */
  function genLot(rng, opts) {
    opts = opts || {};
    const feeds = (opts.feeds || ALWAYS).filter((id) => FEEDS[id] && worthOf(FEEDS[id].comp) > 1);
    let pool = feeds.length ? feeds : ALWAYS;
    const tiered = opts.tier != null && !!TIER_FEEDS[opts.tier];
    if (tiered) { const tf = TIER_FEEDS[opts.tier].filter((id) => feeds.includes(id)); if (tf.length) pool = tf; }   // the tier's feeds (they line up with the machines)
    if (opts.budget > 0) {   // a tier lot: only feeds whose fair price puts the budget between 1 and 4,000 t
      const fits = pool.filter((id) => { const fa = worthOf(FEEDS[id].comp) * fairRatio(id); return fa > 0.5 && opts.budget / fa >= TIER_TONS[0] && opts.budget / fa <= (opts.tier != null && TIER_FIT_T[opts.tier] ? TIER_FIT_T[opts.tier] : TIER_TONS[1]); });
      if (fits.length) pool = fits;
      // richer tiers draw richer scrap: the candidates sorted by value per tonne, and tier k picks from the top part of the list
      if (!tiered && opts.tier > 0 && pool.length > 2) {
        const ranked = pool.slice().sort((a, b) => worthOf(FEEDS[a].comp) * fairRatio(a) - worthOf(FEEDS[b].comp) * fairRatio(b));
        pool = ranked.slice(Math.min(ranked.length - 2, Math.floor(ranked.length * opts.tier / (BASE_TIERS + 1))));
      }
    }
    const base = pick(rng, pool), F = FEEDS[base];
    const u = rng(); const cls = u < DEAL.great ? 'great' : (u < DEAL.great + DEAL.fair ? 'fair' : 'terrible');
    // truth: the preset with lognormal scatter on every fraction
    const truth = {};
    for (const m in F.comp) truth[m] = F.comp[m] * Math.exp(VAR_SIGMA * clamp(normal(rng), -2.5, 2.5));
    normalise(truth);
    // tramp: a padded bad buy, or an honest trace of moisture or dirt
    let tramp = null, padded = false, frac = 0;
    // a pad must genuinely dilute: it sells for under half the lot's average and is not already a major component
    const avgSell = worthOf(truth) / WORTH_FACTOR;
    const choices = TRAMP.filter((t) => !(truth[t.m] > 0.3) && MATERIALS[t.m].sell < 0.5 * avgSell);
    if (cls === 'terrible' && choices.length && rng() < 0.5) { padded = true; tramp = pick(rng, choices); frac = uni(rng, PAD[0], PAD[1]); }
    else if (cls !== 'terrible' && choices.length && rng() < 0.3) { tramp = pick(rng, choices); frac = uni(rng, TRAMP_HONEST[0], TRAMP_HONEST[1]); }
    if (tramp) { for (const m in truth) truth[m] *= 1 - frac; truth[tramp.m] = (truth[tramp.m] || 0) + frac; normalise(truth); }
    // declared: truth plus seller bias and grading noise; motivated sellers with a ticket have less to gain from talking it up
    const bias = uni(rng, 0, BIAS_MAX) * (cls === 'great' ? 0.4 : 1);
    const declared = {};
    for (const m in truth) {
      const sell = MATERIALS[m].sell;
      let k = Math.exp(DECL_SIGMA * clamp(normal(rng), -2, 2));
      if (sell >= VALUABLE) k *= 1 + bias; else if (sell < WASTE) k *= 1 - 0.6 * bias;
      if (padded && m === tramp.m) k = uni(rng, PAD_SHOWN[0], PAD_SHOWN[1]);
      declared[m] = truth[m] * k;
    }
    normalise(declared);
    // price
    const worth = worthOf(truth), fr = fairRatio(base), mk = (opts.market && opts.market[base] > 0) ? opts.market[base] : 1;
    let ask;
    if (cls === 'great') ask = worth * fr * uni(rng, MULT.great[0], MULT.great[1]);
    else if (cls === 'fair') ask = worth * fr * uni(rng, MULT.fair[0], MULT.fair[1]);
    else if (padded) ask = worthOf(declared) * fr * uni(rng, MULT.fair[0], MULT.fair[1]);   // looks fair, because it is priced on the declaration
    else ask = worth * uni(rng, MULT.terrible[0], MULT.terrible[1]);
    ask = Math.max(1, Math.round(ask * mk));
    const limit = opts.limit > 0 ? opts.limit : 30;
    let tons = Math.max(1, Math.round(uni(rng, TONS[0], TONS[1] * limit)));
    // a tier lot costs about the tier's money at the asking price: a bargain is more tonnes for it, a bad buy fewer (#48)
    if (opts.budget > 0) { const x = clamp(opts.budget / ask * uni(rng, 0.9, 1.1), TIER_TONS[0], opts.tier != null && TIER_MAX_T[opts.tier] ? TIER_MAX_T[opts.tier] : TIER_TONS[1]); tons = x < 10 ? Math.round(x * 10) / 10 : Math.round(x); }   // small rich lots to 0.1 t
    const clockH = opts.clockH || 0, expiresH = clockH + Math.round(uni(rng, LIFE_H[0], LIFE_H[1]) * 2) / 2;
    const seller = pick(rng, SELLERS);
    let note;
    if (padded) note = tramp.note;
    else if (tramp) note = pick(rng, NOTES.tramp).replace('{what}', tramp.what);
    else note = pick(rng, NOTES[cls]);
    return { id: opts.id || 0, base, cls, truth, declared, tons, ask, worth: Math.round(worth), expiresH, seller, headline: F.name, note, tramp: tramp ? tramp.m : null, padded, tier: opts.tier == null ? null : opts.tier };
  }

  /* Board upkeep: expire lots, let new ones arrive, keep at least BOARD.min open. Pure: mutates st and draws from rng only. */
  function tickBoard(st, rng, clockH, dh, opts) {
    const before = st.board.length;
    const closed = st.board.filter((l) => !(l.expiresH > clockH));
    st.board = st.board.filter((l) => l.expiresH > clockH);
    if (opts && typeof opts.onClose === 'function') closed.forEach(opts.onClose);   // the timer ran out: the high bid, if any, takes the lot
    const mk = () => genLot(rng, Object.assign({}, opts, { clockH, id: st.nextId++ }));
    if (dh > 0 && st.board.length < BOARD.max && rng() < 1 - Math.exp(-dh / BOARD.arriveH)) st.board.push(mk());
    if (!st.board.length && before === 0) { const n = BOARD.min + Math.floor(rng() * (BOARD.max - BOARD.min + 1)); while (st.board.length < n) st.board.push(mk()); }
    while (st.board.length < BOARD.min) st.board.push(mk());
    return st.board.length !== before;
  }
  /* The tiered board (#48): one open lot per price tier, six and opts.tiers (#344: up to eight, opened by rank). Closed or sold tiers refill at once with a fresh lot. */
  function tickTiers(st, rng, clockH, opts) {
    const before = st.board.map((l) => l.id).join(',');
    const closed = st.board.filter((l) => !(l.expiresH > clockH));
    st.board = st.board.filter((l) => l.expiresH > clockH && l.tier != null);
    if (opts && typeof opts.onClose === 'function') closed.forEach(opts.onClose);
    const open = opts && opts.tiers > 0 ? Math.min(TIERS.length, opts.tiers) : BASE_TIERS;
    TIERS.forEach((budget, k) => {
      if (k >= open || st.board.some((l) => l.tier === k)) return;
      st.board.push(genLot(rng, Object.assign({}, opts, { clockH, id: st.nextId++, budget, tier: k })));
    });
    st.board.sort((a, b) => a.tier - b.tier);
    return st.board.map((l) => l.id).join(',') !== before;
  }
  /* Feed market: one mean-reverting lognormal step per feed over dh sim hours. */
  function marketStep(market, rng, dh, ids) {
    (ids || Object.keys(FEEDS)).forEach((id) => {
      let f = market[id] > 0 ? market[id] : 1;
      if (dh > 0) f *= Math.exp(-MARKET.kappa * dh * Math.log(f) + MARKET.sigma * Math.sqrt(dh) * normal(rng));
      market[id] = clamp(f, MARKET.lo, MARKET.hi);
    });
    return market;
  }
  function validLot(l) { return !!(l && typeof l === 'object' && FEEDS[l.base] && l.truth && typeof l.truth === 'object' && l.declared && isFinite(+l.tons) && isFinite(+l.ask) && isFinite(+l.expiresH)); }

  /* Bid state (ticket #31). L.bid = { perT, by, h, n }: the standing high bid in $/t, who holds it ('you' or a rival id), the sim
   * hour it was placed and the number of bids so far. The seller's ask is the reserve, so bidding opens there. */
  function minBid(L) { const b = L && L.bid; return b ? Math.max(b.perT + BID.min, Math.ceil(b.perT * (1 + BID.step))) : L.ask; }
  function placeBid(L, by, perT, clockH) {
    if (!L || !by || !(perT >= minBid(L))) return false;
    L.bid = { perT: Math.ceil(perT), by: String(by), h: +clockH || 0, n: (L.bid ? L.bid.n : 0) + 1 };
    return true;
  }
  function validBid(b) { return !!(b && typeof b === 'object' && isFinite(+b.perT) && +b.perT > 0 && typeof b.by === 'string' && b.by); }

  /* A paid sample (#75): a grab sample and an XRF reading put each fraction within about 3% (relative) of the truth, against
   * the declaration's 10% scatter and the seller's bias. Seeded from the lot id, so a lot always samples the same. */
  const SAMPLE_SIGMA = 0.03, SAMPLE_FEE = 0.01, SAMPLE_MIN = 10;   // fee: 1% of the lot's price, at least $10
  function sampleOf(L) {
    const rng = mulberry32((L.id * 2654435761 + 97) >>> 0), out = {};
    for (const m in L.truth) out[m] = L.truth[m] * Math.exp(SAMPLE_SIGMA * clamp(normal(rng), -2.5, 2.5));
    return normalise(out);
  }
  function sampleFee(L, perT) { return Math.max(SAMPLE_MIN, Math.ceil(SAMPLE_FEE * (perT || L.ask) * L.tons)); }
  /* A seller's record (#76), built at the weighbridge of every lot you buy from them: lots weighed, the average optimism of
   * their declarations (declared worth over weighbridge worth, minus one) and how many were padded. */
  function recordLot(rec, L) {
    rec = rec || { lots: 0, opt: 0, padded: 0 };
    const w = worthOf(L.truth), d = worthOf(L.declared), o = w > 0 ? d / w - 1 : 0;
    rec.opt = (rec.opt * rec.lots + o) / (rec.lots + 1); rec.lots++; if (L.padded) rec.padded++;
    return rec;
  }
  function repText(rec) {
    if (!rec || !rec.lots) return 'new to you';
    const pct = Math.round(rec.opt * 100);
    return rec.lots + ' lot' + (rec.lots === 1 ? '' : 's') + ' weighed · declarations ' + (Math.abs(pct) < 3 ? 'honest' : (pct > 0 ? '+' : '') + pct + '% ' + (pct > 0 ? 'optimistic' : 'pessimistic')) + (rec.padded ? ' · ' + rec.padded + ' padded' : '');
  }
  CS.Auction = { TIER_FEEDS, TIER_MAX_T, TIER_RANK, TIER_FIT_T, BASE_TIERS, tiersOpen, tierLabel, SAMPLE_SIGMA, SAMPLE_FEE, SAMPLE_MIN, sampleOf, sampleFee, recordLot, repText, TIERS, TIER_TONS, tickTiers, mulberry32, genLot, tickBoard, marketStep, worthOf, fairRatio, validLot, sameComp, minBid, placeBid, validBid, ALWAYS, DEAL, MULT, MARKET, BOARD, BID, WORTH_FACTOR };

  /* ---------------- game wiring (browser only) ---------------- */
  function init() {
    const app = CS.app; if (!app || init.done) return; init.done = true;
    const st = { board: [], market: {}, nextId: 1001, pending: null, settle: null, yard: [], sellers: {} };   // sellers: their record at your weighbridge (#76)   // pending: the lot loaded as the feed; yard: lots waiting their turn (#49)
    const rng = mulberry32(0); let seeded = false, lastKey = '', panel = null, gate = null, stale = false;
    const S = () => app.S, clockH = () => app.S.clock / 3600;
    const feeds = () => Object.keys(FEEDS).filter((id) => worthOf(FEEDS[id].comp) > 1);   // #57: the auction is where all scrap comes from
    let rankMemo = { key: null, idx: 0 };   // #344: the rank opens the $1M and $10M tiers; net worth is read again when the clock, the batch count or the bank moves, not every tick
    const rankIdx = () => { const s = S(), k = Math.floor(clockH() * 4) + ':' + (s ? s.batches + ':' + Math.round(Math.log(Math.max(1, s.money)) * 20) : ''); if (rankMemo.key !== k) { let i = 0; try { i = app.rankOf(app.netWorth()).idx; } catch (e) { i = 0; } rankMemo = { key: k, idx: i }; } return rankMemo.idx; };
    const genOpts = () => ({ feeds: feeds(), limit: app.plantValue('logistics'), market: st.market, onClose: closeLot, tiers: tiersOpen(rankIdx()) });
    /* hooks for js/modules/rivals.js (ticket #31): the live board, the yard lot, a redraw; 'lotPrice' {lot, perT} may raise the buy price,
     * 'veto:auctionBuy' {lot} may refuse a purchase, 'lotClose' {lot, award} may award a closing lot to the operator at award $/t,
     * and 'auctionRender' {box} lets a module add to the board after each redraw (lot rows carry data-lot) */
    const roundMode = () => app.S && app.S.mode === 'rivals';   // RIVALS mode: lots come from auction rounds (js/modules/round.js), not the tier board
    const tiers = () => { if (roundMode()) { st.board = []; return false; } return tickTiers(st, rng, clockH(), genOpts()); };
    CS.Auction.live = { priceOf: (L) => priceOf(L), board: () => st.board, pending: () => st.pending, yard: () => st.yard, render: () => render(),
      /* a lot won somewhere else (an auction round): pay for it and put it in the yard */
      deliver: (L, perT, how, credit) => take(L, perT, how, credit),
      /* LOAD a waiting lot by id (the plant screen's lot card, #64) */
      load: (id) => { const L = st.yard.find((x) => x.id === id); if (L && swapIn(L)) { render(); return true; } return false; },
      sample: (L, perT) => sample(L, perT),
      /* deal tier k a fresh lot of one feed (the guided first lot puts car hulks in the $1k tier, #79) */
      dealTier: (k, feed) => { if (!TIERS[k] || !FEEDS[feed]) return null; st.board = st.board.filter((l) => l.tier !== k); let L = null; for (let i = 0; i < 12 && (!L || L.cls === 'terrible'); i++) L = genLot(rng, Object.assign({}, genOpts(), { clockH: clockH(), id: st.nextId++, budget: TIERS[k], tier: k, feeds: [feed] }));   // never a trap for a beginner
        st.board.push(L); st.board.sort((a, b) => a.tier - b.tier); render(); return L; }, rep: (name) => repText(st.sellers[name]), sellers: () => st.sellers };
    function priceOf(L) { const q = { lot: L, perT: L.ask }; app.emit('lotPrice', q); return q.perT > 0 ? Math.ceil(q.perT) : L.ask; }
    function closeLot(L) { const q = { lot: L, award: 0 }; app.emit('lotClose', q); if (q.award > 0) take(L, q.award, 'Won at auction:'); }

    function loadState(ext) {
      const d = ext && ext.auction; if (!d || typeof d !== 'object') return;
      if (isFinite(+d.rngState)) { rng.setState(+d.rngState); seeded = true; }
      st.board = Array.isArray(d.board) ? d.board.filter(validLot) : [];
      st.market = {}; for (const id in (d.market || {})) if (FEEDS[id] && isFinite(+d.market[id])) st.market[id] = clamp(+d.market[id], MARKET.lo, MARKET.hi);
      st.nextId = Math.max(1001, Math.floor(+d.nextId) || 0);
      st.pending = validLot(d.pending) ? d.pending : null;
      st.yard = Array.isArray(d.yard) ? d.yard.filter(validLot) : [];
      st.sellers = d.sellers && typeof d.sellers === 'object' ? d.sellers : {};
      if (!st.board.every((l) => l.tier != null)) st.board = [];   // a board from before the tiers: deal a fresh one
      st.board.forEach((l) => { if (l.bid && !validBid(l.bid)) delete l.bid; });
      // #148: the page closed mid-batch: the batch never finished, so its tonnes go back to the lot they came from
      st.settle = null;
      const o = d.open; if (o && o.lot && validLot(o.lot) && +o.tons > 0) {
        const L = [st.pending].concat(st.yard).find((x) => x && x.id === o.lot.id);
        if (L) L.tons = Math.round((L.tons + +o.tons) * 1000) / 1000;
        else { const back = Object.assign({}, o.lot, { tons: +o.tons }); if (st.pending) st.yard.unshift(st.pending); st.pending = back; }
        setTimeout(() => app.log(app.fmtNum(+o.tons, 1) + ' t of lot #' + o.lot.id + ' were on the line when the page closed: back in the yard.', 'warn'), 0);
      }
    }
    app.on('load', loadState);
    if (app.S && app.S.ext) loadState(app.S.ext);   // a module that registers after boot has missed the 'load' event
    app.on('save', () => ({ auction: { rngState: rng.getState(), board: st.board, market: st.market, nextId: st.nextId, pending: st.pending, yard: st.yard, sellers: st.sellers, open: st.settle ? { tons: st.settle.tons, lot: st.settle.lot } : null } }));   // open: a batch in flight (#148)
    /* #253: lots paid for but not yet run count toward net worth at the cost paid for the tonnes still unprocessed (the loaded lot
     * and the yard), so buying a lot does not lower net worth or flip the rank-gated panels; a batch moves its tonnes on into stock. */
    app.on('assetValue', (q) => { if (!q) return; [st.pending].concat(st.yard).forEach((L) => { if (L && L.tons > 0) q.value += L.ask * L.tons; }); if (st.settle && st.settle.tons > 0) q.value += st.settle.lot.ask * st.settle.tons; });   // #277: the batch on the line counts at cost until its stock lands
    app.on('feedCost', (q) => { if (st.market[q.id] > 0) q.cost *= st.market[q.id]; });   // scales the preset price the app charges (feed market)
    const feedCost = (id) => FEEDS[id].cost * (st.market[id] > 0 ? st.market[id] : 1);

    /* ---- panel ---- */
    const fmtH = (h) => h >= 1 ? Math.round(h) + ' h' : Math.max(1, Math.round(h * 60)) + ' min';
    const compText = (c, n) => Object.entries(c).sort((a, b) => b[1] - a[1]).filter((e) => e[1] >= 0.005).slice(0, n || 5).map((e) => app.esc(MATERIALS[e[0]].name) + ' ' + Math.round(e[1] * 100) + '%').join(', ');
    const compBar = (c) => '<div class="acomp">' + Object.entries(c).sort((a, b) => b[1] - a[1]).map((e) => '<i style="width:' + (100 * e[1]) + '%;background:' + MATERIALS[e[0]].color + '"></i>').join('') + '</div>';
    function build() {
      if (panel) return;
      panel = app.addPanel('left', 'auction-panel', 'Scrap auction', 'feed-panel');
      panel.querySelector('h2').appendChild(app.el('span', 'tag', ''));
      panel.appendChild(app.el('div', 'small', 'Lots are sold on the seller\'s declaration. The weighbridge reading comes when the batch starts.'));
      panel.appendChild(app.el('div', null, '')).id = 'auction-lots';
      panel.appendChild(app.el('h3', null, 'Feed market'));
      panel.appendChild(app.el('div', 'mkt', '')).id = 'auction-market';
      const css = document.createElement('style');
      css.textContent = '#auction-panel .acomp{display:flex;height:5px;border-radius:3px;overflow:hidden;margin:4px 0 2px;background:var(--line)}#auction-panel .acomp i{display:block;height:100%}' +
        '#auction-panel .ask{color:var(--amber);font-family:var(--mono);white-space:nowrap}#auction-panel .crow.yard{border-color:var(--amber)}' +
        '#auction-panel .mkt .r{display:grid;grid-template-columns:1fr 54px 76px;gap:6px;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);align-items:center}' +
        '#auction-panel .mkt .r.h{color:var(--muted);font-size: 11px;letter-spacing:1px}#auction-panel .mkt .r span:nth-child(n+2){text-align:right}';
      panel.appendChild(css);
      gate = CS.Sim.panelGate(panel, document, () => { if (stale) refresh(false); });
    }
    function render() {
      if (!panel) return;
      stale = false;
      const box = panel.querySelector('#auction-lots'); box.innerHTML = '';
      const run = !!S().run, cap = app.plantValue('logistics'), now = clockH();
      panel.querySelector('h2 .tag').textContent = st.board.length + ' OPEN';
      const P = st.pending;
      const yardRow = (L) => {
        const row = app.el('div', 'crow yard', '<div class="ch"><b>WAITING IN THE YARD: LOT #' + L.id + '</b><span class="ask">' + app.fmtMoney(L.ask) + '/t paid</span></div><div class="cd">' + L.tons + ' t of ' + app.esc(L.headline) + ' · declared: ' + compText(L.declared) + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'LOAD'; b.className = 'buy'; b.disabled = run;
        b.title = 'Load this lot as the feed; the loaded one goes back to wait in the yard'; b.setAttribute('aria-label', 'Load lot #' + L.id + ', ' + L.tons + ' t of ' + L.headline);   // #317
        b.addEventListener('click', () => { if (swapIn(L)) render(); });
        row.appendChild(b); box.appendChild(row);
      };
      if (P) {
        const loaded = S().feedPrepaid && S().feedOwner === 'auction' && sameComp(S().comp, P.truth);
        const row = app.el('div', 'crow yard', '<div class="ch"><b>IN THE YARD: LOT #' + P.id + '</b><span class="ask">' + app.fmtMoney(P.ask) + '/t paid</span></div><div class="cd">' + P.tons + ' t of ' + app.esc(P.headline) + ' · declared: ' + compText(P.declared) + compBar(P.declared) + '</div><div class="cd">' + (loaded ? 'Loaded as the feed, prepaid. Run the batch.' : P.arriving && run ? 'Won at the gavel: it loads when this batch ends.' : 'Not loaded: the feed was changed by hand.') + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = loaded ? 'LOADED' : 'LOAD'; b.className = loaded ? 'buy max' : 'buy'; b.disabled = loaded || run; b.setAttribute('aria-label', (loaded ? 'Lot #' + P.id + ' is loaded' : 'Load lot #' + P.id + ', ' + P.tons + ' t of ' + P.headline));   // #317
        b.addEventListener('click', () => { if (loadPending()) { app.log('Lot #' + P.id + ' loaded as the feed again.', 'ok'); render(); } });
        row.appendChild(b); box.appendChild(row);
      }
      st.yard.forEach(yardRow);
      if (!st.board.length) box.appendChild(app.el('div', 'empty', 'No lots on the board.'));
      st.board.slice().sort((a, b) => (a.tier == null ? 99 : a.tier) - (b.tier == null ? 99 : b.tier) || a.expiresH - b.expiresH).forEach((L) => {
        const total = priceOf(L) * L.tons;
        const tierTag = L.tier != null ? '<span class="tier" title="Tier ' + (L.tier + 1) + ': lots up to this price, and at most ' + TIER_MAX_T[L.tier] + ' t">UP TO ' + tierLabel(L.tier) + '</span> ' : '';   // #172: a capped lot costs less than its tier
        const row = app.el('div', 'crow', '<div class="ch"><b>' + tierTag + app.esc(L.headline) + ' · ' + L.tons + ' t</b><span class="ask">' + app.fmtMoney(L.ask) + '/t</span></div>' +
          '<div class="cd">Declared: ' + compText(L.declared) + compBar(L.declared) + '</div>' + (() => { const e = app.lotEstimate ? app.lotEstimate(L.sample || L.declared) : null; return e == null ? '' : '<div class="cd est' + (e < L.ask ? ' bad' : '') + '" title="What your line as it stands would make of this mix per tonne, after power and wear, before the price">Your line: ~' + app.fmtMoney(Math.max(0, e)) + '/t against ' + app.fmtMoney(L.ask) + '/t asked' + (e < L.ask ? ' (a loss as it stands)' : '') + '</div>'; })() +
          (L.sample ? '<div class="cd sampled">Sampled: ' + compText(L.sample) + compBar(L.sample) + '</div>' : '') +
          '<div class="cd">' + app.esc(L.seller) + ' <span class="rep">(' + app.esc(repText(st.sellers[L.seller])) + ')</span>: ' + app.esc(L.note) + ' · closes in ' + fmtH(L.expiresH - now) + (L.tons > cap ? ' · over your ' + cap + ' t batch limit' : '') + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'BUY ' + app.fmtMoney(total); b.className = 'buy' + (S().money < total ? ' poor' : '');
        b.title = 'Pay ' + app.fmtMoney(total) + ' for the whole lot; it lands in the yard and feeds your batches until it runs out';
        b.addEventListener('click', () => buy(L));
        const btns = app.el('div', 'cbtns');   // SAMPLE above BUY, one column (they shared a grid cell and overlapped)
        if (!L.sample) {
          const sb = document.createElement('button'); sb.type = 'button'; sb.className = 'samp'; sb.textContent = 'SAMPLE ' + app.fmtMoney(sampleFee(L, priceOf(L)));
          sb.title = 'A grab sample and an XRF reading: the true mix within about 3%, for 1% of the lot\'s price';
          sb.addEventListener('click', () => sample(L, priceOf(L)));
          btns.appendChild(sb);
        }
        btns.appendChild(b); row.appendChild(btns);
        row.dataset.lot = L.id; box.appendChild(row);
      });
      app.emit('auctionRender', { box });
      const mk = panel.querySelector('#auction-market');
      let h = '<div class="r h"><span>FEED</span><span>MARKET</span><span>NOW</span></div>';
      feeds().filter((id) => TIER_FEEDS.some((t) => t.includes(id))).forEach((id) => {
        const f = st.market[id] > 0 ? st.market[id] : 1, c = feedCost(id);
        h += '<div class="r"><span>' + app.esc(FEEDS[id].name) + '</span><span class="' + (f < 0.97 ? 'ok' : f > 1.03 ? 'bad' : '') + '">×' + f.toFixed(2) + '</span><span>' + (c < 0 ? 'paid ' + app.fmtMoney(-c) : app.fmtMoney(c)) + '/t</span></div>';
      });
      mk.innerHTML = h;
    }

    /* ---- buying and settlement ---- */
    /* the batch a lot of t tonnes fills: all of it when it fits (or would leave under a tonne behind), else the batch limit */
    function batchTons(t, cap) { return t <= cap + 1 ? t : cap; }   // all of it, unrounded: rounding would strand a sliver
    function loadPending() {
      const P = st.pending; if (!P || S().run) return false;
      S().feedOwner = null;   // setFeed renders before the flag is set: no guard may read this as someone else's feed
      app.setFeed(P.truth, 'custom', batchTons(P.tons, app.plantValue('logistics')));
      S().feedPrepaid = true; S().feedOwner = 'auction';
      app.markDirty(true);   // redraw with the flag set: the feed line, the projection and the loop strip read it
      return true;
    }
    /* SAMPLE a lot (#75): pay the fee, see the mix within a few percent */
    function sample(L, perT) {
      if (!L || L.sample) return !!(L && L.sample);
      const fee = sampleFee(L, perT);
      if (!app.spend(fee, 'a sample of lot #' + L.id)) return false;
      L.sample = sampleOf(L); if (CS.Audio && CS.Audio.sfx) CS.Audio.sfx('beep');   // #117: the lab's reading
      app.log('Sampled lot #' + L.id + ' for ' + app.fmtMoney(fee) + ': ' + compText(L.sample, 5).replace(/&amp;/g, '&') + ' (within about 3%). Declared: ' + compText(L.declared, 5).replace(/&amp;/g, '&') + '.', 'ok');
      render(); app.save(); return true;
    }
    /* LOAD a waiting lot: it becomes the loaded one and the loaded one goes back to wait (#49) */
    function swapIn(L) {
      if (S().run) return false;
      const i = st.yard.indexOf(L); if (i < 0) return false;
      st.yard.splice(i, 1);
      if (st.pending) st.yard.unshift(st.pending);
      st.pending = L;
      if (loadPending()) app.log('Lot #' + L.id + ' (' + L.tons + ' t of ' + L.headline + ') loaded as the feed.', 'ok');
      app.save(); return true;
    }
    function buy(L) {
      if (!st.board.includes(L)) return;
      const why = app.veto('auctionBuy', { lot: L }); if (why) { app.log(why, 'warn'); return; }
      take(L, priceOf(L), 'Bought');
    }
    /* pay perT for the whole lot and put it in the yard; a lot won at the timer arrives mid-batch and loads when the batch ends */
    function take(L, perT, how, credit) {
      const total = perT * L.tons;
      if (!app.spend(total, 'lot #' + L.id + ' (' + L.tons + ' t at ' + app.fmtMoney(perT) + '/t)', credit || 0)) { render(); return false; }
      st.board = st.board.filter((x) => x !== L);
      const lot = Object.assign({}, L, { ask: perT, listAsk: L.ask, paid: total, boughtTons: L.tons, bid: undefined });
      app.emit('lotBought', { lot, total });   // milestones (#73)
      if (CS.Audio && CS.Audio.sfx) CS.Audio.sfx('buy');   // #117
      if (st.pending) st.yard.push(lot); else st.pending = lot;   // #49: lots queue in the yard
      const cap = app.plantValue('logistics');
      app.log(how + ' lot #' + L.id + ' from ' + L.seller + ': ' + L.tons + ' t of ' + L.headline + ' at ' + app.fmtMoney(perT) + '/t, ' + app.fmtMoney(total) + ' paid. Declared ' + compText(L.declared, 4).replace(/&amp;/g, '&') + '.' + (L.tons > cap ? ' Only ' + cap + ' t fit a batch; the rest waits in the yard.' : ''), 'ok');
      if (st.pending === lot && !loadPending() && S().run) st.pending.arriving = true;   // won mid-batch: it loads when the batch ends
      else if (st.pending === lot && S().mode !== 'rivals' && app.layout && app.layout.closeDrawer) setTimeout(() => app.layout.closeDrawer(), 250);   // #175: loaded: back to the plant
      tiers();   // the tier refills at once
      app.renderBank(); render(); app.save();
      return true;
    }
    app.on('batchStart', (p) => {
      S().feedPrepaid = false;   // the prepaid lot is consumed by this batch
      const P = st.pending; if (!P || S().feedOwner !== 'auction' || !sameComp(S().comp, P.truth)) return;
      if (p.run.total > P.tons) { p.run.total = P.tons; S().tons = P.tons; app.syncFeedRows(); }   // #93: the slider cannot run more than was paid for
      const tons = p.run.total;
      const extra = P.tramp ? ' ' + (P.padded ? 'A lot of ' : 'Some ') + TRAMP.find((t) => t.m === P.tramp).what + ' in the load.' : '';
      if (CS.Audio && CS.Audio.sfx) CS.Audio.sfx('beep');   // #117: the weighbridge ticket
      app.log('Weighbridge, lot #' + P.id + ': ' + compText(P.truth, 8).replace(/&amp;/g, '&') + '.' + extra, P.padded ? 'warn' : 'ok');
      if (!P.weighed && P.seller) { P.weighed = true; st.sellers[P.seller] = recordLot(st.sellers[P.seller], P); app.log(P.seller + ': ' + repText(st.sellers[P.seller]) + '.'); }
      st.settle = { lot: P, tons };
      P.tons -= tons;
      if (P.tons < 1e-6) { P.tons = 0; st.pending = st.yard.length ? st.yard.shift() : null; if (st.pending) app.log('Lot #' + P.id + ' is used up. Lot #' + st.pending.id + ' from the yard is next.'); }
      else app.log(app.fmtNum(P.tons, P.tons < 10 ? 1 : 0) + ' t of lot #' + P.id + ' stay in the yard for the next batch.');
      render();
    });
    app.on('batchComplete', (p) => {
      const s = st.settle; st.settle = null;
      if (!s) {   // a re-run or another feed ran; the lot in the yard is loaded again once the line is free
        if (st.pending && !S().feedPrepaid && loadPending()) { app.log('Lot #' + st.pending.id + ' is loaded for the next batch.', 'ok'); delete st.pending.arriving; render(); }
        return;
      }
      const back = Math.max(0, s.tons - p.r.done);
      if (back > 1e-6) {   // #96: a stopped or halted batch did not use its whole share of the lot
        s.lot.tons = Math.round((s.lot.tons + back) * 1000) / 1000;
        if (st.pending !== s.lot) { if (st.pending) st.yard.unshift(st.pending); st.yard = st.yard.filter((x) => x !== s.lot); st.pending = s.lot; }
        app.log(app.fmtNum(back, 1) + ' t of lot #' + s.lot.id + ' did not run: back in the yard.');
      }
      const L = s.lot, done = p.r.done, paid = L.ask * done, w = worthOf(L.truth) * done, dw = worthOf(L.declared) * done;
      const verdict = L.cls === 'great' ? 'a bargain' : L.cls === 'fair' ? 'a fair deal' : (L.padded ? 'a padded lot' : 'overpriced');
      app.log('Lot #' + L.id + ' settled: paid ' + app.fmtMoney(paid) + ' for ' + app.fmtNum(done, 1) + ' t. Declared worth ' + app.fmtMoney(dw) + ', weighbridge worth ' + app.fmtMoney(w) + ' (60% of product prices); the line made ' + app.fmtMoney(p.r.rev) + ' of product. That was ' + verdict + '.', L.cls === 'terrible' ? 'bad' : (L.cls === 'great' ? 'ok' : ''));
      if (st.pending && !S().feedPrepaid && loadPending()) { app.log('Lot #' + st.pending.id + ' loaded for the next batch.'); delete st.pending.arriving; }
      render();
    });
    // guard: a prepaid lot only covers its own composition and tonnage
    function guard() {
      const P = st.pending; if (!P || !S().feedPrepaid || S().feedOwner !== 'auction') return;
      if (!sameComp(S().comp, P.truth)) { S().feedPrepaid = false; S().feedOwner = null; app.log('Lot #' + P.id + ' is no longer loaded; it waits in the yard. LOAD brings it back.', 'warn'); render(); }
      else if (S().tons > P.tons) { S().tons = P.tons; app.syncFeedRows(); }
    }

    app.on('boot', () => {
      if (!seeded) { rng.setState(Math.floor(S().clock)); seeded = true; }
      marketStep(st.market, rng, 0);
      tiers();
      if (st.pending && !S().feedPrepaid && sameComp(S().comp, st.pending.truth)) { S().feedPrepaid = true; S().feedOwner = 'auction'; }   // the flag is not saved by the app
      else if (st.pending && !S().feedPrepaid) loadPending();
      build(); render();
    });
    app.on('render', render);
    app.on('newgame', () => { rng.setState(Math.floor(S().clock)); st.board = []; st.pending = null; st.yard = []; st.sellers = {}; st.settle = null; tiers(); render(); });
    /* #95: restoreSave clears the prepaid flag; load the lot in the yard again (unless a re-run bucket is the loaded feed) */
    function reassert() {
      if (!st.pending || S().run || S().feedPrepaid) return;
      if (sameComp(S().comp, st.pending.truth)) { S().feedPrepaid = true; S().feedOwner = 'auction'; app.markDirty(true); }
      else loadPending();
    }
    app.on('modechange', () => { tiers(); reassert(); render(); });
    app.on('tick', (p) => {
      if (!(p.dh > 0)) return;
      marketStep(st.market, rng, p.dh);
      const changed = tiers();
      guard();
      const key = Math.floor(clockH() * 4);
      if (changed || key !== lastKey) { lastKey = key; stale = true; }   // quarter-hourly: refresh timers and the feed price line
      if (stale) refresh(changed);
    });
    /* #199: hold the rebuild while the pointer is down in the panel or the panel is hidden; it runs on release or the next tick */
    function refresh(changed) {
      if (gate && gate.busy()) return;
      render(); if (!changed) app.markDirty();
    }
  }
  if (CS.app) init();
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);   // app.js boots on DOMContentLoaded and its listener was added first
})(typeof window !== 'undefined' ? window : globalThis);
