/* CrunchSim module: rivals. Rival bidders at the scrap auction and rival plants on the job board (tickets #31, #32).
 *
 * Bidders (#31): up to four named yards, each with a personality: a volume buyer, a copper specialist, a bargain hunter and a
 * late sniper. They enter the market over the first days of plant time and their credit grows with game time. Each reads a
 * lot's DECLARED composition through its own bias (how far it trusts a seller's claims, which metals its plant pays most for,
 * a grading error of its own) and the market bulletin's prices, so lots rich in the HOT material are bid up and padded lots
 * fool rivals as they fool the operator. The seller's ask is the reserve; bids rise in auction steps on the 'tick' hook while
 * the lot's timer runs; the sniper only bids in the last half hour and at the gavel. The operator can BID (the next step, one
 * lot at a time) or BUY NOW at a premium over the standing price. At the timer the high bid takes the lot; the board lists the
 * results with the price paid.
 *
 * Plants (#32): every rival owns real flowsheets (preset or test-proven lines). An offered job on the missions board that the
 * operator leaves untaken for a shift of plant time goes to tender, scored on each rival's real product bins against the operator's
 * line; the client weighs fee, reputation and delivery time. Deliveries feed a league table (tonnes delivered, reputation) with the
 * operator's rank. A sandbox switch turns all of it off. (Client-contract tendering went with the contracts in #78.)
 *
 * The pure parts (roster, valuation, bidding, the gavel, tender scoring, capability, league, serialization) live on
 * CS.Rivals and touch no DOM, so tests/rivals.js can run them in Node. The page wiring registers through CS.app hooks only and
 * reads the auction board and the missions job board through CS.Auction.live and CS.Missions.live.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS, MACHINES = CS.MACHINES, FEEDS = CS.FEEDS, LINES = CS.LINES || {};
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  /* ---------------- seeded PRNG (the mulberry32 of auction.js; never Math.random) ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    const r = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.getState = function () { return a; }; r.setState = function (s) { a = s >>> 0; };
    return r;
  }
  function normal(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }   // Box-Muller
  function hashSeed(a, b) { return (Math.imul((a >>> 0) ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul((b >>> 0) + 1, 0xC2B2AE35)) >>> 0; }
  const SEED = 0x51a7e5;

  /* ---------------- tuning ---------------- */
  const BUY_NOW = 0.15;        // a buy-it-now price on online industrial auctions sits 10-20% over the expected hammer price
  const SNIPE_H = 0.5;         // snipers bid in the last minutes of an online auction; half an hour of plant time at the game's pace
  const SNIPE_RATE = 4;        // bids per hour while sniping: the sniper watches the closing lots, so it answers within 15 minutes
  const NOISE = 0.08;          // a buyer grading a lot from photos and the declaration is off by about +-8% (scrap grading tolerance is +-10%)
  const PAYABLE = 1000;        // $/t: at or above this a material is a payable metal a seller talks up (aluminum and up), as in auction.js
  const DOUBLE_H = 72;         // rival credit doubles every 72 h of plant time: a growing yard reinvests its margin and its bank line scales with turnover
  const HOT_SHARE = 0.05, HOT_RATE = 2;   // a lot declaring 5%+ of the bulletin's HOT material draws bids twice as often: every desk chases a squeeze
  const TENDER_H = 8;          // a client waits about a shift for a yard to take its work before tendering it to the next yards
  const MOBILISE_H = 2;        // a toll processor needs about two hours to truck in the client's feed and set its line
  const SLIP = 0.12, SLIP_X = 1.5;   // shredder plants run 85-90% available: one job in eight hits a breakdown, delivers 50% later and a star down
  const W = { fee: 0.5, rep: 0.3, time: 0.2 };   // MEAT tender scoring: price usually carries 40-60% of the weight, quality record and delivery the rest
  const RESULTS_KEEP = 8, NEWS_KEEP = 12;
  const REP_D = { start: 0, onTime: 3, late: 1, fail: -5, job: [6, 10, 15] };   // fallback when the missions module is absent; same scale as its REP

  /* ---------------- rival flowsheets: preset lines and test-proven lines ---------------- */
  const RLINES = {
    car: LINES.car, quarry: LINES.quarry, wood: LINES.wood, tire: LINES.tire, hydro: LINES.hydro, ingot: LINES.ingot,
    ferrous: { name: 'Shear, magnet and screen', feed: 'elv', nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'screen', s: { aperture: 40 }, src: '2:residue' }] },
    agg: { name: 'Jaw, cone and screen', feed: 'quarry', nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'cone', s: { css: 20 }, src: '1:product' }, { m: 'screen', s: { aperture: 25 }, src: '2:product' }] },
    chips: { name: 'Shear, magnet and chipper', feed: 'chair', nodes: [{ m: 'twin', s: { width: 60 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'chipper', s: { len: 20 }, src: '2:residue' }] },
    rubble: { name: 'Rubble recycling line', feed: 'rubble', nodes: [{ m: 'jaw', s: { css: 100 }, src: 'feed' }, { m: 'magnet', s: { field: 250 }, src: '1:product' }, { m: 'air', s: { air: 11 }, src: '2:residue' }, { m: 'cone', s: { css: 30 }, src: '3:residue' }] },
    zorbaXrt: { name: 'Zorba line with sensor sorter', feed: 'zorba', nodes: [{ m: 'twin', s: { width: 40 }, src: 'feed' }, { m: 'sinkfloat', s: { sg: 2.9 }, src: '1:product' }, { m: 'sensor', s: { target: 'copper' }, src: '2:residue' }] }
  };

  /* ---------------- the roster ----------------
   * appetite: what share of the going yard rate (0.6 x product value x the feed's yard ratio, as auction.js prices lots) the yard
   * will pay for what it believes is in the lot. trust: how much of a seller's payable-metal claim it believes. rate: bids per hour
   * on a lot it wants. quote: its fee on a job as a share of the list premium. rep: its record on the missions reputation scale (0-100).
   */
  const ROSTER = [
    { id: 'ironside', name: 'Ironside Shredding', kind: 'volume', label: 'volume buyer', seed: 1,
      blurb: 'A big car shredder that buys anything with tonnage in it and believes most declarations.',
      entersH: 0,            // the incumbent: the town's shredder is on the board from day one
      budget: 25000,         // a regional shredder's per-lot credit, scaled like machine prices (0.2 x real): ~$125k real, a few trailer loads of zorba
      appetite: 1.0,         // pays the going yard rate: a volume buyer lives on tonnage through the mill, not on margin per lot
      trust: 1.0,            // takes the declaration at face value (shredders rarely sample before the weighbridge)
      rate: 0.5,             // a busy buying desk looks at the board about every two hours
      quote: 0.92,           // scale lets it quote about 8% under list on toll work
      rep: 35, lines: ['car', 'ferrous', 'agg', 'quarry'] },
    { id: 'magpie', name: 'Magpie Salvage', kind: 'bargain', label: 'bargain hunter', seed: 2,
      blurb: 'A small salvage yard that only buys what it thinks is underpriced and discounts every seller\'s claims.',
      entersH: 0,
      budget: 8000,          // a small yard's purchase limit
      appetite: 0.72,        // bids to about 70% of the yard rate: bargain buyers want 25-30% of margin before they touch a lot
      trust: 0.85,           // knocks 15% off any payable metal a seller claims
      rate: 0.25,            // patient: checks the board a few times a day
      quote: 0.85,           // cheapest quotes on the board, with the lowest record
      rep: 20, lines: ['chips', 'rubble', 'wood'] },
    { id: 'redline', name: 'Redline Non-Ferrous', kind: 'copper', label: 'copper specialist', seed: 3,
      blurb: 'A non-ferrous specialist with a sensor sorter. It pays up for copper and brass and ignores lots without them.',
      entersH: 12,           // opens a buying desk once the local non-ferrous flow is worth chasing, half a day of plant time in
      budget: 40000,         // non-ferrous yards carry the most working capital: copper is worth ten times steel
      appetite: 0.95, trust: 0.95,
      focus: { copper: 1.4, brass: 1.3 },   // its sensor sorter recovers wire and meatballs a shredder loses to the heavies: it can pay 30-40% more for them
      wants: ['copper', 'brass'], minShare: 0.02,   // skips any lot declaring under 2% copper and brass, less than a car's wiring harness
      rate: 0.4, quote: 0.95, rep: 40, lines: ['zorbaXrt', 'ingot'] },
    { id: 'nightjar', name: 'Nightjar Metals', kind: 'sniper', label: 'late sniper', seed: 4,
      blurb: 'Never shows its hand: bids in the last half hour and at the gavel, when nobody can answer.',
      entersH: 36,           // the last to notice the market, a day and a half of plant time in
      budget: 15000,
      appetite: 1.05,        // snipers pay a little over the going rate because they rarely face a counter-bid
      trust: 0.95, rate: 0, quote: 1.0, rep: 25, lines: ['tire', 'hydro'] }
  ];
  function rivalById(id) { return ROSTER.find((r) => r.id === id) || null; }
  function activeAt(h) { return ROSTER.filter((r) => (h || 0) >= r.entersH); }
  function budgetAt(R, h) { return Math.round(R.budget * Math.pow(2, Math.max(0, h || 0) / DOUBLE_H)); }

  /* ---------------- valuation and bidding (#31) ---------------- */
  /* the lot as the rival reads it: the declaration, with payable-metal claims cut to what it trusts */
  function perceive(R, L) {
    const c = {};
    for (const m in (L.declared || {})) if (MATERIALS[m]) c[m] = L.declared[m] * (MATERIALS[m].sell >= PAYABLE ? R.trust : 1);
    return c;
  }
  function noiseOf(R, L) { const r = mulberry32(hashSeed(SEED + R.seed, L.id)); return Math.exp(NOISE * clamp(normal(r), -2, 2)); }
  function interested(R, L) {
    if (!(R.minShare > 0)) return true;
    let s = 0; (R.wants || []).forEach((m) => { s += (L.declared && L.declared[m]) || 0; });
    return s >= R.minShare;
  }
  /* the most R pays for L, $/t. factor(mat): the market bulletin's price factor (hot and cold included). 0 = not interested. */
  function valuation(R, L, factor) {
    const A = CS.Auction; if (!A || !L || !L.declared || !FEEDS[L.base] || !interested(R, L)) return 0;
    const f = typeof factor === 'function' ? factor : () => 1;
    const c = perceive(R, L); let w = 0;
    for (const m in c) w += c[m] * MATERIALS[m].sell * (f(m) > 0 ? f(m) : 1) * ((R.focus && R.focus[m]) || 1);
    return Math.max(0, Math.floor(w * A.WORTH_FACTOR * A.fairRatio(L.base) * R.appetite * noiseOf(R, L)));
  }
  function hotShare(L, hot) { return hot && L.declared ? (L.declared[hot] || 0) : 0; }
  /* the bid R would place on L now ($/t), or 0: it must want the lot, value it at the next step, and afford the whole lot */
  function nextBidFor(R, L, h, ctx) {
    const A = CS.Auction; if (!A || (L.bid && L.bid.by === R.id)) return 0;
    const next = A.minBid(L), v = valuation(R, L, ctx && ctx.factor);
    if (v < next || next * L.tons > budgetAt(R, h)) return 0;
    return next;
  }
  /* One tick of rival bidding over the open board (dh sim hours at hour h). ctx: { factor(mat), hot: mat id }.
   * Every rival rolls once per open lot in a fixed order, so a seed replays the same bids. Returns [{ lot, by, perT, outbid }]. */
  function bidStep(board, h, dh, rng, ctx) {
    const out = [], A = CS.Auction; if (!A || !(dh > 0)) return out;
    const act = activeAt(h);
    (board || []).slice().sort((a, b) => a.id - b.id).forEach((L) => {
      if (!(L.expiresH > h)) return;
      act.forEach((R) => {
        const sniping = R.kind === 'sniper';
        if (sniping && L.expiresH - h > SNIPE_H) return;
        const rate = sniping ? SNIPE_RATE : R.rate * (hotShare(L, ctx && ctx.hot) >= HOT_SHARE ? HOT_RATE : 1);
        if (!(rng() < 1 - Math.exp(-rate * dh))) return;
        const next = nextBidFor(R, L, h, ctx); if (!next) return;
        const prev = L.bid ? L.bid.by : null;
        if (A.placeBid(L, R.id, next, h)) out.push({ lot: L, by: R.id, perT: next, outbid: prev });
      });
    });
    return out;
  }
  /* The gavel: snipers put in their last-second bids, which nobody can answer, then the high bid takes the lot.
   * Returns { by, perT } or null when the lot closes unsold. */
  function closeLot(L, h, ctx) {
    const A = CS.Auction; if (!A || !L) return null;
    const snipers = activeAt(h).filter((R) => R.kind === 'sniper');
    for (let i = 0; i < 20; i++) {
      let any = false;
      snipers.forEach((R) => { const next = nextBidFor(R, L, h, ctx); if (next && A.placeBid(L, R.id, next, h)) any = true; });
      if (!any) break;
    }
    return L.bid ? { by: L.bid.by, perT: L.bid.perT } : null;
  }
  /* the operator's buy-now price: a premium over the next bid (the ask while nobody has bid) */
  function buyNowPrice(L) { const A = CS.Auction; return Math.ceil((A ? A.minBid(L) : L.ask) * (1 + BUY_NOW)); }

  /* ---------------- capability (#32): what each rival's own flowsheets really make ---------------- */
  const built = {}, binCache = {};
  function builtLine(lid) { const D = RLINES[lid]; if (!D || !CS.Sim) return null; return built[lid] || (built[lid] = CS.Sim.buildLine(D)); }
  /* a line's product bins on its own feed, in the shape app.binList() gives ({ st, form }), and its head rate */
  function lineBins(lid) {
    if (lid in binCache) return binCache[lid];
    const D = RLINES[lid], line = builtLine(lid), Sim = CS.Sim;
    if (!D || !line || !FEEDS[D.feed]) return (binCache[lid] = null);
    const ev = Sim.evalLine(line, FEEDS[D.feed].comp), R = Sim.maxRate(ev.nodes, line).R;
    const bins = ev.terminals.map((t) => ({ st: Sim.binStats(t.stream.m, t.form), form: t.form || null })).filter((b) => Sim.binMatters(b.st));
    return (binCache[lid] = { R, bins });
  }
  /* kg of mat per head-tonne in bins at or above the purity (dross never ships, nor does MISC), as js/modules/missions.js counts a job */
  function jobKg(bins, mat, purity) {
    let kg = 0;
    (bins || []).forEach((b) => { const st = b && b.st; if (!st || !(st.total > 0) || b.form === 'dross' || !st.sellable) return; const pm = st.perMat && st.perMat[mat]; if (pm && pm.mass > 0 && pm.mass / Math.max(1e-9, st.total - (st.liquid || 0)) + 1e-9 >= purity) kg += pm.mass; });
    return kg;
  }
  function jobHoursOn(j, bins, R) { const kg = jobKg(bins, j.mat, j.purity), rem = Math.max(0, j.tons - (j.t || 0)); return rem <= 0 ? 0 : (R > 0 && kg > 0 ? rem / (R * kg / 1000) : Infinity); }
  /* the fastest of R's lines on job j: { line, hours } or null when no line makes the purity */
  function jobCap(R, j) {
    let best = null;
    R.lines.forEach((lid) => { const b = lineBins(lid); if (!b) return; const hrs = jobHoursOn(j, b.bins, b.R); if (isFinite(hrs) && hrs > 0 && (!best || hrs + MOBILISE_H < best.hours)) best = { line: lid, hours: hrs + MOBILISE_H }; });
    return best;
  }
  /* ---------------- tenders (#32) ---------------- */
  /* Customers weigh fee, reputation and delivery time. cands: [{ who, fee, rep, hours }]. The cheapest fee and the fastest delivery score
   * full marks on their criteria and the others pro rata; reputation scores on its 0-100 scale. A tie stays with the first candidate
   * (the operator is listed first: the client asked them first). Returns { winner, scores } or null. */
  function tender(cands) {
    const ok = (cands || []).filter((c) => c && c.fee > 0 && c.hours > 0 && isFinite(c.hours));
    if (!ok.length) return null;
    let minFee = Infinity, minH = Infinity; ok.forEach((c) => { minFee = Math.min(minFee, c.fee); minH = Math.min(minH, c.hours); });
    const scores = ok.map((c) => ({ who: c.who, score: W.fee * minFee / c.fee + W.rep * clamp(+c.rep || 0, 0, 100) / 100 + W.time * minH / c.hours, c }));
    let best = scores[0]; scores.forEach((x) => { if (x.score > best.score + 1e-9) best = x; });
    return { winner: best.c, scores: scores.map((x) => ({ who: x.who, score: x.score })) };
  }

  /* ---------------- state ---------------- */
  function newRival(R) { return { rep: R.rep, tonnes: 0, starsSum: 0, starsN: 0, lots: 0, lotT: 0, spent: 0, deliveries: 0 }; }
  function newState() {
    const st = { on: true, rivals: {}, you: { tonnes: 0, starsSum: 0, starsN: 0 }, rjobs: [], seen: {}, results: [], news: [], mine: [], rngState: SEED };
    ROSTER.forEach((R) => { st.rivals[R.id] = newRival(R); });
    return st;
  }
  function repOf(st, id) { const r = st.rivals[id]; return r ? r.rep : 0; }
  function repStep() { const M = CS.Missions; return M && M.REP ? { onTime: REP_D.onTime, late: REP_D.late, fail: REP_D.fail, job: M.REP.jobDone } : REP_D; }
  function tierOf(rep) { const M = CS.Missions; return M && M.tierOf ? M.tierOf(rep) : 0; }
  function bumpRep(rs, d) { rs.rep = clamp(Math.round((rs.rep + d) * 10) / 10, 0, 100); }

  /* Tender the offered jobs that have waited a window. J: the missions job state ({ board, active }). env: { you(j) -> candidate or null }.
   * A rival that wins takes the job off the board. Returns events: { type: 'claim' | 'held', job, R, rj } */
  function tenderJobs(st, h, rng, J, env) {
    const out = []; if (!J || !Array.isArray(J.board)) return out;
    const ids = {}; J.board.forEach((j) => { ids[j.id] = true; });
    Object.keys(st.seen).forEach((id) => { if (!ids[id]) delete st.seen[id]; });
    J.board.slice().forEach((j) => {
      if (st.seen[j.id] == null || st.seen[j.id] > h) { st.seen[j.id] = h; return; }
      if (h - st.seen[j.id] < TENDER_H) return;
      st.seen[j.id] = h;
      const rivals = activeAt(h).map((R) => {
        const rep = repOf(st, R.id); if (tierOf(rep) < (j.tier || 0)) return null;
        const cap = jobCap(R, j); return cap ? { who: R.id, fee: 1 + (j.mult - 1) * R.quote, rep, hours: cap.hours, cap } : null;
      }).filter(Boolean);
      if (!rivals.length) return;
      const you = env && env.you ? env.you(j) : null;
      const t = tender((you ? [you] : []).concat(rivals)); if (!t) return;
      if (t.winner.who === 'you') { out.push({ type: 'held', job: j, t, you }); return; }
      const R = rivalById(t.winner.who), slip = rng() < SLIP;
      J.board = J.board.filter((x) => x !== j);
      const rj = { by: R.id, job: { id: j.id, mat: j.mat, tons: j.tons, purity: j.purity, tier: j.tier || 0, client: j.client, mult: j.mult }, fromH: h, untilH: h + t.winner.hours * (slip ? SLIP_X : 1), slip };
      st.rjobs.push(rj);
      out.push({ type: 'claim', job: j, R, rj, t, you });
    });
    return out;
  }
  function settleJobs(st, h) {
    const out = [], D = repStep();
    st.rjobs = st.rjobs.filter((rj) => {
      if (!(h >= rj.untilH)) return true;
      const rs = st.rivals[rj.by];
      if (rs) { rs.tonnes += rj.job.tons; rs.deliveries++; bumpRep(rs, rj.slip ? D.late : (D.job[rj.job.tier] || D.job[0])); }
      out.push({ R: rivalById(rj.by), rj });
      return false;
    });
    return out;
  }
  /* the league: the operator and every rival in the market, by tonnes delivered, then reputation, then average stars */
  function league(st, youRep, h) {
    const avg = (s) => s.starsN > 0 ? s.starsSum / s.starsN : null;
    const rows = [{ id: 'you', name: 'Your yard', label: 'you', tonnes: st.you.tonnes, stars: avg(st.you), rep: +youRep || 0 }];
    activeAt(h).forEach((R) => { const rs = st.rivals[R.id]; rows.push({ id: R.id, name: R.name, label: R.label, tonnes: rs.tonnes, stars: avg(rs), rep: rs.rep }); });
    rows.sort((a, b) => (b.tonnes - a.tonnes) || (b.rep - a.rep) || ((b.stars || 0) - (a.stars || 0)) || (a.id === 'you' ? -1 : b.id === 'you' ? 1 : 0));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  /* ---------------- persistence ---------------- */
  const num = (v, d) => isFinite(+v) ? +v : d;
  function serialize(st, rngState) {
    return { on: st.on, rivals: st.rivals, you: st.you, rjobs: st.rjobs, seen: st.seen, results: st.results, news: st.news, mine: st.mine, rngState: rngState == null ? st.rngState : rngState };
  }
  function deserialize(d) {
    const st = newState();
    if (!d || typeof d !== 'object') return st;
    st.on = d.on !== false;
    ROSTER.forEach((R) => {
      const s = d.rivals && d.rivals[R.id]; if (!s || typeof s !== 'object') return;
      const r = st.rivals[R.id];
      r.rep = clamp(num(s.rep, R.rep), 0, 100); r.tonnes = Math.max(0, num(s.tonnes, 0)); r.starsN = Math.max(0, Math.floor(num(s.starsN, 0)));
      r.starsSum = clamp(num(s.starsSum, 0), 0, 3 * r.starsN); r.lots = Math.max(0, Math.floor(num(s.lots, 0))); r.lotT = Math.max(0, num(s.lotT, 0));
      r.spent = Math.max(0, num(s.spent, 0)); r.deliveries = Math.max(0, Math.floor(num(s.deliveries, 0)));
    });
    if (d.you && typeof d.you === 'object') { st.you.tonnes = Math.max(0, num(d.you.tonnes, 0)); st.you.starsN = Math.max(0, Math.floor(num(d.you.starsN, 0))); st.you.starsSum = clamp(num(d.you.starsSum, 0), 0, 3 * st.you.starsN); }
    st.rjobs = (Array.isArray(d.rjobs) ? d.rjobs : []).filter((rj) => rj && rivalById(rj.by) && rj.job && MATERIALS[rj.job.mat] && isFinite(+rj.job.tons) && isFinite(+rj.untilH))
      .map((rj) => ({ by: rj.by, job: { id: Math.floor(num(rj.job.id, 0)), mat: rj.job.mat, tons: +rj.job.tons, purity: clamp(num(rj.job.purity, 0.9), 0, 1), tier: clamp(Math.floor(num(rj.job.tier, 0)), 0, 2), client: String(rj.job.client || ''), mult: Math.max(1, num(rj.job.mult, 1)) }, fromH: num(rj.fromH, 0), untilH: +rj.untilH, slip: !!rj.slip }));
    for (const id in (d.seen || {})) if (isFinite(+d.seen[id])) st.seen[id] = +d.seen[id];
    st.results = (Array.isArray(d.results) ? d.results : []).filter((x) => x && isFinite(+x.id)).slice(0, RESULTS_KEEP)
      .map((x) => ({ id: +x.id, headline: String(x.headline || ''), tons: num(x.tons, 0), by: x.by === 'you' || rivalById(x.by) ? x.by : null, perT: Math.max(0, num(x.perT, 0)), h: num(x.h, 0), bids: Math.max(0, Math.floor(num(x.bids, 0))), def: !!x.def }));
    st.news = (Array.isArray(d.news) ? d.news : []).filter((x) => x && typeof x.text === 'string').slice(0, NEWS_KEEP).map((x) => ({ h: num(x.h, 0), text: x.text, cls: typeof x.cls === 'string' ? x.cls : '' }));
    st.mine = (Array.isArray(d.mine) ? d.mine : []).map(Number).filter(isFinite).slice(-20);
    st.rngState = isFinite(+d.rngState) ? +d.rngState >>> 0 : SEED;
    return st;
  }

  CS.Rivals = {
    ROSTER, RLINES, BUY_NOW, SNIPE_H, SNIPE_RATE, NOISE, DOUBLE_H, HOT_SHARE, HOT_RATE, TENDER_H, MOBILISE_H, SLIP, SLIP_X, W, mulberry32,
    rivalById, activeAt, budgetAt, perceive, valuation, nextBidFor, bidStep, closeLot, buyNowPrice,
    lineBins, jobCap, jobHoursOn, tender, tenderJobs, settleJobs, league,
    newState, serialize, deserialize
  };

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const app = CS.app; if (!app || app.rivalsStarted) return; app.rivalsStarted = true;
    const hasDom = typeof document !== 'undefined' && !!document.body;
    let st = newState(); const rng = mulberry32(SEED);
    let panel = null, els = null, lastKey = -1, jobSnap = null;
    const S = () => app.S;
    const clockH = () => (app.S ? app.S.clock || 0 : 0) / 3600;
    const log = (msg, cls) => { if (typeof app.log === 'function') app.log(msg, cls); };
    const money = (x) => typeof app.fmtMoney === 'function' ? app.fmtMoney(x) : '$' + Math.round(x);
    const fnum = (x, d) => typeof app.fmtNum === 'function' ? app.fmtNum(x, d) : String(Math.round(x * 10) / 10);
    const fmtT = (t) => typeof app.fmtT === 'function' ? app.fmtT(+t) : Math.round(t * 10) / 10 + ' t';   // #371
    const esc = (s) => typeof app.esc === 'function' ? app.esc(s) : String(s);
    const fmtH = (h) => CS.Missions && CS.Missions.fmtH ? CS.Missions.fmtH(h) : (Math.round(h * 10) / 10) + ' h';
    const auction = () => CS.Auction && CS.Auction.live ? CS.Auction.live : null;
    const board = () => { const A = auction(); return A ? A.board() : []; };
    const jobsLive = () => CS.Missions && CS.Missions.live ? CS.Missions.live : null;
    const youRep = () => { const M = jobsLive(); return M ? M.rep() : 0; };
    const ctx = () => { const Mk = CS.Market, hot = Mk && typeof Mk.hot === 'function' ? Mk.hot() : null; return { factor: (m) => Mk && typeof Mk.factor === 'function' ? Mk.factor(m) : 1, hot: hot ? hot.mat : null }; };
    const nameOf = (id) => id === 'you' ? 'you' : (rivalById(id) || { name: id }).name;
    function news(text, cls) { st.news.unshift({ h: clockH(), text, cls: cls || '' }); if (st.news.length > NEWS_KEEP) st.news.length = NEWS_KEEP; }
    function save() { if (typeof app.save === 'function') app.save(); }
    function redrawAuction() { const A = auction(); if (A) A.render(); }

    /* ---- persistence ---- */
    function restore(ext) { st = deserialize(ext && ext.rivals); rng.setState(st.rngState); }
    app.on('load', restore);
    if (app.S && app.S.ext) restore(app.S.ext);   // registered after boot: the 'load' event has already fired
    app.on('save', () => ({ rivals: serialize(st, rng.getState()) }));
    app.on('newgame', () => {
      st = newState(); rng.setState(SEED);
      board().forEach((L) => { delete L.bid; });
      redrawAuction(); render();
    });

    /* ---- the operator at the auction ---- */
    const leading = () => board().find((L) => L.bid && L.bid.by === 'you') || null;
    function raise(id) {
      if (!st.on) return false;
      const A = CS.Auction, live = auction(), L = board().find((x) => x.id === id); if (!L || !A || !live) return false;
      const P = live.pending(), lead = leading();
      let why = '';
      if (lead === L) why = 'You already hold the high bid on lot #' + L.id + '.';   // #49: the yard holds several lots, so you may lead several
      const perT = A.minBid(L), total = perT * L.tons;
      if (!why && S().money < total) why = 'A bid of ' + money(perT) + '/t on lot #' + L.id + ' commits ' + money(total) + '; the bank holds ' + money(S().money) + '.';
      if (why) { if (CS.Audio) CS.Audio.ui('deny'); log(why, 'warn'); return false; }
      A.placeBid(L, 'you', perT, clockH());
      if (st.mine.indexOf(L.id) < 0) { st.mine.push(L.id); if (st.mine.length > 20) st.mine.shift(); }
      if (CS.Audio) CS.Audio.ui('ok');
      log('Bid ' + money(perT) + '/t on lot #' + L.id + ' (' + fmtT(L.tons) + ' of ' + L.headline + ', ' + money(total) + ' if it closes now). The high bid at the timer takes the lot.', 'ok');
      redrawAuction(); render(); save();
      return true;
    }
    app.on('lotPrice', (q) => { if (st.on && q && q.lot) q.perT = Math.max(q.perT, buyNowPrice(q.lot)); });
    app.on('veto:auctionBuy', (p) => {
      if (!st.on || !p || !p.lot) return '';
      return '';   // #49: buying one lot while leading another is fine, the yard holds both
    });
    app.on('lotClose', (q) => {
      if (!st.on || !q || !q.lot) return;
      const L = q.lot, h = clockH(), r = closeLot(L, h, ctx());
      const res = { id: L.id, headline: L.headline, tons: L.tons, by: r ? r.by : null, perT: r ? r.perT : 0, h, bids: L.bid ? L.bid.n : 0, def: false };
      const mine = st.mine.indexOf(L.id) >= 0;
      if (r && r.by === 'you') {
        const A = auction();
        if (S().money < r.perT * L.tons) { res.by = null; res.def = true; log('Your bid on lot #' + L.id + ' defaulted: ' + money(r.perT * L.tons) + ' due and ' + money(S().money) + ' in the bank. The seller relists.', 'bad'); }
        else q.award = r.perT;
      } else if (r) {
        const rs = st.rivals[r.by]; if (rs) { rs.lots++; rs.lotT += L.tons; rs.spent += r.perT * L.tons; }
        if (mine) log('Lot #' + L.id + ' (' + fmtT(L.tons) + ' of ' + L.headline + ') went to ' + nameOf(r.by) + ' at ' + money(r.perT) + '/t, ' + money(r.perT * L.tons) + ' in all.', 'warn');
        news('Lot #' + L.id + ' ' + L.headline + ' ' + fmtT(L.tons) + ' to ' + nameOf(r.by) + ' at ' + money(r.perT) + '/t');
      }
      st.mine = st.mine.filter((id) => id !== L.id);
      st.results.unshift(res); if (st.results.length > RESULTS_KEEP) st.results.length = RESULTS_KEEP;
      render();
    });

    /* ---- jobs: the operator as a bidder ---- */
    function youJob(j) {
      const M = CS.Missions, L = jobsLive(), s = S(); if (!M || !L || !s) return null;
      const J = L.jobs(); if ((j.tier || 0) > M.tierOf(L.rep()) || J.active.length >= M.JOB.maxActive) return null;
      const hrs = jobHoursOn(j, typeof app.binList === 'function' ? app.binList() : [], s.mr ? s.mr.R : 0);
      return isFinite(hrs) && hrs > 0 ? { who: 'you', fee: j.mult, rep: L.rep(), hours: hrs + MOBILISE_H } : null;
    }
    function step(dh) {
      const h = clockH(); let changed = false;
      // the auction: rivals raise on the open lots
      const ev = bidStep(board(), h, dh, rng, ctx());
      if (ev.length) {
        changed = true;
        ev.forEach((e) => { if (e.outbid === 'you') log('Outbid on lot #' + e.lot.id + ': ' + nameOf(e.by) + ' bids ' + money(e.perT) + '/t. BID again or let it go.', 'warn'); });
        redrawAuction();
      }
      if (S() && S().mode === 'rivals') return changed;   // #307: Rivals has no job board, so no deliveries and no tenders
      // deliveries that are due
      settleJobs(st, h).forEach((d) => { changed = true; news(d.R.name + ' delivered ' + fnum(d.rj.job.tons, 1) + ' t of ' + MATERIALS[d.rj.job.mat].name.toLowerCase() + ' to ' + d.rj.job.client + (d.rj.slip ? ', late' : '') + '.'); });
      const L = jobsLive();
      if (L) {
        const ej = tenderJobs(st, h, rng, L.jobs(), { you: youJob });
        ej.forEach((e) => {
          changed = true;
          const what = fnum(e.job.tons, 1) + ' t of ' + MATERIALS[e.job.mat].name.toLowerCase() + ' for ' + e.job.client;
          if (e.type === 'held') news(e.job.client + ' is holding job #' + e.job.id + ' for you.', 'ok');
          else { log('Job #' + e.job.id + ' (' + what + ') went to ' + e.R.name + ' after the tender' + (e.you ? '' : ': your line does not make that purity') + '.', 'warn'); news(e.R.name + ' took job #' + e.job.id + ', ' + what, 'warn'); }
        });
        if (ej.some((e) => e.type === 'claim')) L.render();
      }
      return changed;
    }
    app.on('tick', (p) => {
      if (!st.on || !p || !(p.dh > 0)) return;
      const changed = step(p.dh);
      const key = Math.floor(clockH() * 12);   // every five sim minutes the countdowns move
      if (changed || key !== lastKey) { lastKey = key; render(); }
    });
    app.on('batchStart', () => { const L = jobsLive(); jobSnap = {}; if (L) L.jobs().active.forEach((j) => { jobSnap[j.id] = j.t; }); });
    app.on('batchComplete', (p) => {
      if (!p || !p.r) return;
      const L = jobsLive();
      if (L && jobSnap) { const J = L.jobs(); J.active.concat(J.done).forEach((j) => { if (j.id in jobSnap) st.you.tonnes += Math.max(0, j.t - jobSnap[j.id]); }); }
      jobSnap = null;
      render();
    });

    function setOn(on) {
      st.on = !!on;
      if (!st.on) {
        board().forEach((L) => { delete L.bid; });
        st.rjobs = []; st.seen = {}; st.mine = [];
        log('Sandbox: rivals are off. No rival bids, no tenders; lots sell at the ask and every job stays open.', 'ok');
      } else log('Rivals are back in the market. Open lots take bids again and untaken jobs go to tender after ' + TENDER_H + ' h of plant time.', 'warn');
      redrawAuction(); if (typeof app.renderAll === 'function') app.renderAll(); render(); save();
    }

    /* ---- panel ---- */
    function build() {
      if (panel || !hasDom || typeof app.addPanel !== 'function') return;
      panel = app.addPanel('right', 'rivals-panel', 'Rivals', 'log-panel');
      panel.querySelector('h2').appendChild(app.el('span', 'tag', ''));
      const ro = app.el('div', 'readouts two'); panel.appendChild(ro);
      panel.appendChild(app.el('h3', null, 'League'));
      const lg = app.el('div', 'lg'); panel.appendChild(lg);
      panel.appendChild(app.el('h3', null, 'Who is bidding'));
      const roster = app.el('div'); panel.appendChild(roster);
      panel.appendChild(app.el('h3', null, 'Held by rivals'));
      const held = app.el('div'); panel.appendChild(held);
      panel.appendChild(app.el('h3', null, 'Trade wire'));
      const wire = app.el('div', 'wire'); panel.appendChild(wire);
      const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'tog'; tog.addEventListener('click', () => setOn(!st.on)); panel.appendChild(tog);
      const css = document.createElement('style');
      css.textContent = '#rivals-panel .lg .r{display:grid;grid-template-columns:18px 1fr 64px 40px 34px;gap:6px;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);align-items:center}' +
        '#rivals-panel .lg .r.h{color:var(--muted);font-size: 11px;letter-spacing:1px}#rivals-panel .lg .r span:nth-child(n+3){text-align:right}#rivals-panel .lg .r.you{color:var(--cyan)}' +
        '#rivals-panel .rv{font-size:11px;color:var(--muted);padding:3px 0;border-bottom:1px dotted var(--line);line-height:1.35}#rivals-panel .rv b{color:var(--text);font-weight:400}#rivals-panel .rv .k{color:var(--amber);font-family:var(--mono);font-size: 11px;letter-spacing:1px}' +
        '#rivals-panel .wire div{font-family:var(--mono);font-size: 11px;color:var(--muted);padding:1px 0}#rivals-panel .wire div.warn{color:var(--amber)}#rivals-panel .wire div.ok{color:var(--green)}#rivals-panel .tog{margin-top:8px;width:100%}' +
        '#auction-panel .rbtns{grid-column:2;grid-row:1/span 4;display:flex;flex-direction:column;gap:4px;align-self:center}#auction-panel .rbtns button{grid-column:auto;grid-row:auto}' +
        '#auction-panel .rbid{color:var(--cyan)}#auction-panel .rbid.you{color:var(--green)}#auction-panel .rres{font-family:var(--mono);font-size: 11px;color:var(--muted);padding:1px 0}#auction-panel .rres b{color:var(--amber);font-weight:400}';
      panel.appendChild(css);
      els = { ro, lg, roster, held, wire, tog, tag: panel.querySelector('h2 .tag') };
    }
    let rivStale = false;   // #337: rebuilt when the Records drawer opens, not every five sim minutes while it is closed
    app.on('drawerOpen', () => { if (rivStale) render(); });
    function render() {
      if (!els) return;
      if (panel && app.panelHidden && app.panelHidden(panel)) { rivStale = true; return; }
      rivStale = false;
      const RL = CS.Round && CS.Round.live;
      if (app.S && app.S.mode === 'rivals' && RL && RL.table) { renderMatch(RL); return; }   // #111: in Rivals the panel is the match, not the old yards
      els.tog.classList.remove('hidden');
      const h = clockH(), act = activeAt(h);
      els.tag.textContent = st.on ? act.length + ' IN THE MARKET' : 'SANDBOX';
      els.tog.textContent = st.on ? 'SANDBOX: TURN RIVALS OFF' : 'TURN RIVALS ON';
      els.tog.className = 'tog' + (st.on ? ' danger' : ' primary');
      const rows = league(st, youRep(), h), me = rows.find((r) => r.id === 'you');
      const nHeld = st.rjobs.length;
      els.ro.innerHTML = app.ro('YOUR RANK', me.rank + '/' + rows.length, me.rank === 1 ? 'TOP' : 'BY TONNES', me.rank === 1 ? 'good' : '') + app.ro('HELD BY RIVALS', nHeld, nHeld === 1 ? 'JOB' : 'JOBS', nHeld ? 'hi' : '');
      els.lg.innerHTML = '<div class="r h"><span>#</span><span>YARD</span><span>TONNES</span><span>STARS</span><span>REP</span></div>' + rows.map((r) => '<div class="r' + (r.id === 'you' ? ' you' : '') + '"><span>' + r.rank + '</span><span>' + esc(r.name) + '</span><span>' + fnum(r.tonnes, 1) + '</span><span>' + (r.stars == null ? '--' : r.stars.toFixed(1)) + '</span><span>' + Math.round(r.rep) + '</span></div>').join('');
      els.roster.innerHTML = ROSTER.map((R) => {
        const rs = st.rivals[R.id], inn = h >= R.entersH;
        return '<div class="rv"><span class="k">' + esc(R.label.toUpperCase()) + '</span> <b>' + esc(R.name) + '</b>' + (inn ? ' · credit ' + money(budgetAt(R, h)) + ' a lot · ' + rs.lots + ' lot' + (rs.lots === 1 ? '' : 's') + ' won' + (rs.lotT ? ', ' + fnum(rs.lotT, 0) + ' t' : '') : ' · enters at T+' + fmtH(R.entersH)) + '<br>' + esc(R.blurb) + '</div>';
      }).join('');
      let hb = '';
      st.rjobs.forEach((rj) => { hb += '<div class="rv"><b>Job #' + rj.job.id + '</b> ' + fnum(rj.job.tons, 1) + ' t ' + esc(MATERIALS[rj.job.mat].name.toLowerCase()) + ' · ' + esc(nameOf(rj.by)) + ' · due in ' + fmtH(Math.max(0, rj.untilH - h)) + '</div>'; });
      els.held.innerHTML = st.on ? (hb || '<div class="small">Nothing. An offered job you leave untaken for ' + TENDER_H + ' h of plant time goes to tender.</div>') : '<div class="small">Sandbox: no rival bids and no tenders. Lots sell at the ask and every contract stays open.</div>';
      els.wire.innerHTML = st.news.length ? st.news.map((n) => '<div class="' + esc(n.cls) + '">' + (typeof app.fmtClock === 'function' ? app.fmtClock(n.h * 3600) + ' ' : '') + esc(n.text) + '</div>').join('') : '<div>Quiet so far.</div>';
    }
    /* Rivals mode (#111): the three yards at the table and the match standings by worth; no sandbox switch, no old league */
    function renderMatch(RL) {
      const rows = RL.table(), rd = RL.round(), me = rows.find((r) => r.id === 'you');
      els.tag.textContent = rd.over ? 'MATCH OVER' : rd.n ? 'ROUND ' + rd.n + ' OF ' + rd.length : 'MATCH NOT STARTED';
      els.tog.classList.add('hidden');
      els.ro.innerHTML = app.ro('YOUR PLACE', me.place + '/' + rows.length, me.place === 1 ? 'LEADING' : 'BY WORTH', me.place === 1 ? 'good' : '') + app.ro('ROUND', rd.n + '/' + rd.length, rd.over ? 'OVER' : '', '');
      els.lg.innerHTML = '<div class="r h"><span>#</span><span>YARD</span><span>WORTH</span><span>BINS</span><span>T</span></div>' + rows.map((r) => '<div class="r' + (r.id === 'you' ? ' you' : '') + '"><span>' + r.place + '</span><span>' + esc(r.name) + '</span><span>' + money(r.worth) + '</span><span>' + r.bins + '</span><span>' + fnum(r.t, 0) + '</span></div>').join('');
      els.roster.innerHTML = rows.filter((r) => r.id !== 'you').map((r) => { const R = rivalById(r.id); return '<div class="rv"><span class="k">' + esc(r.label.toUpperCase()) + '</span> <b>' + esc(r.name) + '</b>' + (R && R.blurb ? ' · ' + esc(R.blurb) : '') + '</div>'; }).join('');
      els.held.innerHTML = '<div class="small">Bins are won in the auction rounds: highest worth after the last round wins the match.</div>';
      els.wire.innerHTML = '<div>The round log is on the auction screen.</div>';
    }
    /* the auction board: bid state and a BID button on each lot, buy-now on the BUY button, closed lots at the bottom */
    app.on('auctionRender', (p) => {
      if (!st.on || !p || !p.box || !hasDom) return;
      const A = CS.Auction, h = clockH(), lead = leading(), P = auction() && auction().pending();
      p.box.querySelectorAll('.crow[data-lot]').forEach((row) => {
        const L = board().find((x) => String(x.id) === row.dataset.lot); if (!L) return;
        const buy = row.querySelector('button.buy'), next = A.minBid(L), mine = L.bid && L.bid.by === 'you';
        const info = app.el('div', 'cd rbid' + (mine ? ' you' : ''), L.bid ? (mine ? 'YOU LEAD at ' : 'HIGH BID ') + money(L.bid.perT) + '/t' + (mine ? '' : ' · ' + esc(nameOf(L.bid.by))) + ' · ' + L.bid.n + ' bid' + (L.bid.n === 1 ? '' : 's') + ' · next ' + money(next) + '/t' : 'NO BIDS · bidding opens at the ask, ' + money(L.ask) + '/t');
        const wrap = app.el('div', 'rbtns');
        const b = document.createElement('button'); b.type = 'button';
        if (mine) { b.textContent = 'LEADING'; b.className = 'buy max'; b.disabled = true; }
        else {
          b.textContent = 'BID ' + money(next) + '/t'; b.className = 'buy' + (S().money < next * L.tons ? ' poor' : '');
          b.title = 'Commit ' + money(next * L.tons) + ' for ' + fmtT(L.tons) + '. The high bid at the timer takes the lot; it comes into the yard when it closes.';
          b.addEventListener('click', () => raise(L.id));
        }
        const col = row.querySelector('.cbtns');
        if (buy) { row.insertBefore(info, col || buy); buy.textContent = 'BUY NOW ' + money(buyNowPrice(L) * L.tons); buy.title = (buy.title ? buy.title + '. ' : '') + 'Buy now at ' + money(buyNowPrice(L)) + '/t: ' + Math.round(BUY_NOW * 100) + '% over the next bid, and the lot is yours at once'; }
        else row.appendChild(info);
        if (col) col.insertBefore(b, buy || null); else { wrap.appendChild(b); if (buy) wrap.appendChild(buy); row.appendChild(wrap); }
      });
      if (st.results.length) {
        p.box.appendChild(app.el('div', 'small', 'CLOSED LOTS'));
        st.results.slice(0, 5).forEach((r) => {
          p.box.appendChild(app.el('div', 'rres', '#' + r.id + ' ' + esc(r.headline) + ' ' + fmtT(r.tons) + ' · ' + (r.by ? '<b>' + esc(r.by === 'you' ? 'YOU' : nameOf(r.by)) + '</b> at ' + money(r.perT) + '/t, ' + money(r.perT * r.tons) : (r.def ? 'your bid defaulted, relisted' : 'unsold')) + ' · ' + (typeof app.fmtClock === 'function' ? app.fmtClock(r.h * 3600) : '')));
        });
      }
    });

    app.on('boot', () => { build(); render(); redrawAuction(); });
    app.on('render', render);
    start.live = { raise, setOn, state: () => st, step };
    // game modes: PROGRESS has no rivals at all; RIVALS has them (bidding happens in the auction rounds)
    const byMode = () => { if (app.S && app.S.mode) st.on = app.S.mode === 'rivals'; };
    app.on('load', byMode); app.on('newgame', byMode); app.on('modechange', () => { byMode(); render(); });
    byMode();
    CS.Rivals.live = start.live;
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
