/* CrunchSim module: missions. A board of large jobs (ticket #26); the timed client contracts of #27 were retired in #78.
 * The mission clock only advances while a batch runs, so a job's window is really a budget of plant time.
 *
 * Jobs: clients post large jobs for the scarce non-ferrous metals: so many tonnes of a target material at a
 * purity, a delivery window, and a price well above spot. Progress accumulates across batches from every product
 * bin whose purity meets the spec (payload.bins of 'batchComplete', per head-tonne, scaled by the tonnes run).
 * The bins also go to inventory (the inventory module keeps its live stock private), so the job pays its premium
 * over spot on delivery and the tonnes are still sold at spot from inventory: nothing is paid twice (#304: the premium-only
 * path is the design; the job never withdraws stock).
 *
 * Reputation rises with deliveries and completed jobs, falls with failures, and unlocks bigger job tiers.
 *
 * The pure parts (reputation, job generation, progress, projection,
 * serialization) live on CS.Missions and touch no DOM, so tests/missions.js can run them in Node. The page wiring
 * below registers through CS.app hooks only and tolerates a missing document.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS, FEEDS = CS.FEEDS;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  /* ---------------- seeded PRNG (the mulberry32 of auction.js; never Math.random) ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    const r = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.getState = function () { return a; }; r.setState = function (s) { a = s >>> 0; };
    return r;
  }
  function uni(rng, a, b) { return a + (b - a) * rng(); }
  function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }

  /* plant hours to run `tons` at head rate `rate` t/h */
  function hoursNeeded(tons, rate) { return rate > 0 && tons > 0 ? tons / rate : (tons > 0 ? Infinity : 0); }

  /* ---------------- reputation ----------------
   * 0..100, like a supplier scorecard built on delivery performance. A completed
   * large job a season's worth; a failure costs more than a success earns, as it does with real procurement desks.
   */
  const REP = { start: 0, min: 0, max: 100, jobDone: [6, 10, 15], jobFail: -10, jobDrop: -6 };
  // tiers: a new yard gets small lots; a quarter's clean record (25 points) opens medium jobs, a year's (60) the large ones
  const TIERS = [{ min: 0, name: 'New yard' }, { min: 25, name: 'Trusted' }, { min: 60, name: 'Preferred' }];
  function tierOf(rep) { let t = 0; for (let i = 0; i < TIERS.length; i++) if (rep >= TIERS[i].min) t = i; return t; }
  function tierName(rep) { return TIERS[tierOf(rep)].name; }
  function repApply(rep, delta) { return clamp(Math.round(((+rep || 0) + delta) * 10) / 10, REP.min, REP.max); }

  /* ---------------- jobs ---------------- */
  const PURE_MIN = CS.Sim && CS.Sim.PURE_MIN || 0.9;   // the purity at which a bin is sellable (js/sim.js binStats)
  const JOB = {
    mats: ['copper', 'brass', 'potmetal', 'aluminum'],   // the non-ferrous metals: the scarce, high-value fractions of shredder output
    minFrac: 0.01,       // a feed counts as a source of a metal when it carries at least 1% of it
    recovery: 0.75,      // a sorting line recovers 70-80% of a target metal into a clean bin (eddy current and sink-float plant data)
    batches: [[1, 2], [3, 5], [6, 12]],   // job size per tier in batches of the richest available feed
    // purity a buyer requires, by ISRI-style grade: No. 2 copper (Birch/Cliff) 94-96% is out of reach of a sorted shredder
    // stream, so copper and brass jobs ask 85-92% (sorted "meatball"-free fractions; genJob floors it at PURE_MIN, a lower bin is MISC), zinc die-cast 90-96%, zorba-grade
    // aluminum 95-98% (a sink-float float fraction)
    purity: { copper: [0.85, 0.92], brass: [0.85, 0.90], potmetal: [0.90, 0.96], aluminum: [0.95, 0.98] },
    mult: [1.25, 1.6],   // job price over spot: smelters pay 25-60% over the index for guaranteed, sorted tonnage
    hoursPerBatch: 3,    // a 30 t batch at a twin-shaft shredder's 15 t/h is 2 h, plus an hour to source and load the lot
    windowSlack: 2,      // the window is twice the plant time the job needs (the yard runs other work too), with 2 h on top
    offerH: [12, 48],    // an offer stays on the board 12-48 sim hours, like an online tender
    board: { min: 2, max: 4, arriveH: 12 },   // two to four open jobs; a new one about every 12 sim hours (Poisson)
    maxActive: 2,        // two jobs at once: more and the yard is a toll processor, not a plant
    minTons: 0.5,
    lineMargin: 0.85,    // #360: a dealt lot runs leaner than its listing (sellers pad, the mix varies), so a job sized from the line asks 85% of what it makes
    purityMargin: 0.04   // #395: and its bins come out up to three or four points less pure (a lot scatters about its listing), so a job asks four points under the line's purest bin and counts only the bins that clear it by as much
  };
  const CLIENTS = ['Harbour Secondary Smelter', 'Northgate Brass Foundry', 'Two Rivers Die-casting', 'Westfield Rolling Mill', 'Kestrel Alloys', 'Lakeside Wire & Cable', 'Bayside Ingot Works', 'Delta Refiners'];

  /* tonnes of `mat` a batch of the richest available feed yields into a clean bin. #342: lotT { feed: t } is the most a lot of that
   * feed weighs at the auction's open tiers (lotSizes): a batch is never bigger than the lot it runs, whatever the logistics limit */
  function yieldPerBatch(mat, feeds, limit, lotT) { return bestBatch(mat, feeds, limit, lotT).y; }
  /* { y: t of mat into a clean bin, t: feed tonnes of that batch } for the richest feed */
  function bestBatch(mat, feeds, limit, lotT) {
    let best = 0, bt = 0, bid = null; const lim = limit > 0 ? limit : 30;
    (feeds || []).forEach(function (id) { const F = FEEDS[id]; if (!F) return; const f = F.comp[mat] || 0; if (!(f >= JOB.minFrac)) return; const t = lotT && lotT[id] > 0 ? Math.min(lim, lotT[id]) : lim; if (f * t > best) { best = f * t; bt = t; bid = id; } });
    return { y: best * JOB.recovery, t: bt, id: bid };
  }
  /* #342: the feeds the auction deals at tiers 0..open-1 and the most a lot of each weighs: the tier's money at a fair price, capped at
   * the tier's tonnage (CS.Auction). maxBudget leaves out the tiers the yard cannot pay for yet, except the first one up that deals a
   * job metal (a yard with no metal in reach is offered jobs from the next lots it can buy). null without the auction. */
  function lotSizes(open, maxBudget) {
    // #376: a lot is no bigger than the yard can buy at the fair price, so a job asks for what can actually be bought.
    // #385: maxBudget is what the yard can spend (bank, stock and the loaded lot), floored at one tier-0 lot: a bank emptied by the lot it runs is not a 1 t yard
    const A = CS.Auction; if (!A || !A.TIERS || !A.TIER_FEEDS) return null;
    const lotT = {}, mb = maxBudget != null ? Math.max(A.TIERS[0], +maxBudget || 0) : null; let any = false, metal = false;
    for (let k = 0; k < Math.min(open || A.TIERS.length, A.TIERS.length); k++) {
      if (k > 0 && mb != null && A.TIERS[k] > mb && metal) break;
      (A.TIER_FEEDS[k] || []).forEach(function (id) { const F = FEEDS[id]; if (!F) return; const fa = A.worthOf(F.comp) * A.fairRatio(id); if (!(fa > 0.5)) return; if (JOB.mats.some(function (m) { return (F.comp[m] || 0) >= JOB.minFrac; })) metal = true; const t = Math.min(A.TIER_MAX_T[k] || Infinity, A.TIERS[k] / fa * 1.1, mb != null ? mb / fa : Infinity); if (!(t > (lotT[id] || 0))) return; lotT[id] = t; any = true; });
    }
    return any ? { feeds: Object.keys(lotT), lotT: lotT } : null;
  }
  /* #342: hpb, the plant hours a batch takes (its tonnes at the head rate, plus an hour to source and load), when longer than JOB.hoursPerBatch */
  /* #395: aheadH, the plant hours of work already in the yard (lots and the MISC pile) that run before the job's lot gets its turn */
  function windowFor(batches, hpb, aheadH) { return Math.ceil((batches * Math.max(JOB.hoursPerBatch, hpb > 0 ? hpb : 0) + (aheadH > 0 ? aheadH : 0)) * 2 + JOB.windowSlack); }
  /* #360: the lowest purity a job for mat asks (a bin under PURE_MIN is MISC and never ships) */
  function purityFloor(mat) { const pr = JOB.purity[mat] || [0.9, 0.95]; return Math.round(Math.max(PURE_MIN, pr[0]) * 100) / 100; }
  /* #360: { mat: { feed: [{ s: purity, f: t per head-tonne }] } }, the clean bins carrying each job metal that the line makes from a lot of
   * each feed (its listed mix), purity on the solids as applyBins measures it. evalLine(comp) returns the line's terminals
   * ({ stream: { m }, form }); binStats is CS.Sim.binStats. reachMax is the purest bin, reachAt the tonnes per head-tonne at a purity. */
  function reachMax(bins) { let p = 0; (bins || []).forEach(function (b) { if (b.s > p) p = b.s; }); return p; }
  function reachAt(bins, purity) { let f = 0; (bins || []).forEach(function (b) { if (b.s + 1e-9 >= purity) f += b.f; }); return f; }
  function lineReach(evalLine, binStats, feeds) {
    const out = {}; JOB.mats.forEach(function (m) { out[m] = {}; });
    (feeds || []).forEach(function (id) {
      const F = FEEDS[id]; if (!F || !JOB.mats.some(function (m) { return (F.comp[m] || 0) >= JOB.minFrac; })) return;
      let ev = null; try { ev = evalLine(F.comp); } catch (e) { ev = null; }
      const bins = {}; JOB.mats.forEach(function (m) { bins[m] = []; });
      ((ev && ev.terminals) || []).forEach(function (t) {
        if (t.form === 'dross') return; const st = binStats(t.stream.m, t.form); if (!st || !st.sellable || !(st.total > 0)) return;
        const solid = Math.max(1e-9, st.total - (st.liquid || 0));
        JOB.mats.forEach(function (m) { const pm = st.perMat && st.perMat[m]; if (pm && pm.mass > 0) bins[m].push({ s: pm.mass / solid, f: pm.mass / 1000 }); });
      });
      JOB.mats.forEach(function (m) { if ((F.comp[m] || 0) >= JOB.minFrac) out[m][id] = bins[m]; });
    });
    return out;
  }
  /* Generate one job. opts: { feeds: [ids the player can buy], limit: t per batch, lotT: { feed: most t in a lot }, rate: head t/h, rep, clockH, id,
   * reach: lineReach's bins }. #360: with reach, only a metal and feed the line sorts clean at the job's purity floor are offered, the purity
   * asked is at most the line's purest bin, the tonnes are what the line puts in bins of that purity (not a flat recovery), and null comes
   * back when the line makes no such metal (the board then shows fewer jobs) */
  function genJob(rng, opts) {
    opts = opts || {};
    const feeds = opts.feeds && opts.feeds.length ? opts.feeds : ['elv'], reach = opts.reach || null;
    const lim = opts.limit > 0 ? opts.limit : 30, lotOf = function (id) { const t = opts.lotT && opts.lotT[id] > 0 ? Math.min(lim, opts.lotT[id]) : lim; return opts.capT && opts.capT[id] > 0 ? Math.min(t, opts.capT[id]) : t; };   // #395: never a batch bigger than the tonnes in reach
    const fromLine = function (m) { let c = { m: m, y: 0, t: 0, id: null }; feeds.forEach(function (id) { const b = reach[m] && reach[m][id], y = reachAt(b, purityFloor(m) + JOB.purityMargin) * lotOf(id); if (y > c.y) c = { m: m, y: y, t: lotOf(id), id: id }; }); return c; };
    const cands = JOB.mats.map(function (m) { if (reach) return fromLine(m); const b = bestBatch(m, feeds, opts.limit, opts.lotT); return { m: m, y: b.y, t: b.t, id: b.id }; })
      .filter(function (c) { const nb = opts.capT && c.id && opts.capT[c.id] > 0 && c.t > 0 ? Math.max(1, Math.min(JOB.batches[0][1], Math.floor(opts.capT[c.id] / c.t + 1e-9))) : JOB.batches[0][1]; return c.y > 0 && (!reach || c.y * nb * JOB.lineMargin >= JOB.minTons); });   // #360: two batches make at least the smallest job; #395: or the batches the lots in reach run
    if (!cands.length && reach) return null;
    const c = cands.length ? pick(rng, cands) : Object.assign({ m: 'aluminum' }, bestBatch('aluminum', ['elv'], opts.limit, opts.lotT));
    const rate = opts.rateOf && opts.rateOf[c.id] > 0 ? opts.rateOf[c.id] : opts.rate, hpb = rate > 0 && c.t > 0 ? c.t / rate + 1 : 0;   // #395: rateOf { feed: t/h }, the line's head rate on that feed (a rich feed runs slower than the one loaded)
    const tier = Math.floor(rng() * (tierOf(opts.rep || 0) + 1));
    const br = JOB.batches[tier], capT = opts.capT && c.id && opts.capT[c.id] > 0 && c.t > 0 ? opts.capT[c.id] : 0;
    const batches = capT ? Math.max(1, Math.min(Math.round(uni(rng, br[0], br[1])), Math.floor(capT / c.t + 1e-9))) : Math.round(uni(rng, br[0], br[1]));   // #395: capT { feed: t }, the tonnes of that feed the yard holds or can buy off the board now: a job asks no more batches than those lots run
    let tons = Math.max(JOB.minTons, Math.round(c.y * batches * 10) / 10);
    const pr = JOB.purity[c.m] || [0.9, 0.95];
    let purity = Math.round(Math.max(PURE_MIN, uni(rng, pr[0], pr[1])) * 100) / 100;   // a bin under PURE_MIN is MISC and never ships (#216), so no job asks for less
    if (reach && c.id) {   // #360: never above the line's purest bin, and the tonnes its bins of that purity make
      const b = reach[c.m][c.id], lo = purityFloor(c.m) + JOB.purityMargin, base = reachAt(b, lo); let top = lo; (b || []).forEach(function (q) { if (q.s > top && q.s + 1e-9 >= lo && q.f >= 0.25 * base) top = q.s; });   // #395: the purest bin that carries a real share of the metal, not a trace bin
      purity = Math.max(purityFloor(c.m), Math.min(purity, Math.floor((top - JOB.purityMargin + 1e-9) * 100) / 100));
      tons = Math.max(JOB.minTons, Math.round(reachAt(b, purity + JOB.purityMargin) * c.t * batches * JOB.lineMargin * 10) / 10);
    }
    const mult = Math.round(uni(rng, JOB.mult[0], JOB.mult[1]) * 100) / 100;
    const clockH = opts.clockH || 0;
    return { id: opts.id || 0, mat: c.m, tier: tier, batches: batches, tons: tons, purity: purity, mult: mult, windowH: windowFor(batches, hpb, opts.aheadH),
      offerExpiresH: clockH + Math.round(uni(rng, JOB.offerH[0], JOB.offerH[1])), client: pick(rng, CLIENTS), state: 'offered', t: 0, paid: 0, acceptedH: null, deadlineH: null, ...(capT ? { feed: c.id, feedT: Math.round(c.t * batches * 10) / 10 } : {}) };   // #395: the feed and tonnes of it the job was sized from, so the board withdraws it when those lots are gone or promised to another job
  }
  function validJob(j) { return !!(j && typeof j === 'object' && MATERIALS[j.mat] && isFinite(+j.tons) && +j.tons > 0 && isFinite(+j.purity) && isFinite(+j.mult) && isFinite(+j.windowH)); }
  function newJobs() { return { board: [], active: [], done: [], nextId: 1 }; }
  /* Board upkeep: expire offers, let new ones arrive, keep at least board.min open. Pure: draws from rng only. */
  function tickBoard(J, rng, clockH, dh, opts) {
    const before = J.board.length;
    J.board = J.board.filter(function (j) { return j.offerExpiresH > clockH; });
    const mk = function () { const j = genJob(rng, Object.assign({}, opts, { clockH: clockH, id: J.nextId })); if (j) J.nextId++; return j; };   // #360: null when the line can meet no job
    if (dh > 0 && J.board.length < JOB.board.max && rng() < 1 - Math.exp(-dh / JOB.board.arriveH)) { const j = mk(); if (j) J.board.push(j); }
    while (J.board.length < JOB.board.min) { const j = mk(); if (!j) break; J.board.push(j); }
    return J.board.length !== before;
  }
  function acceptJob(J, id, clockH, rep) {
    const j = J.board.find(function (x) { return x.id === id; });
    if (!j) return { ok: false, why: 'That job is no longer on the board.' };
    if (j.tier > tierOf(rep)) return { ok: false, why: 'Reputation ' + TIERS[j.tier].min + ' is needed for a ' + TIERS[j.tier].name.toLowerCase() + '-tier job.' };
    if (J.active.length >= JOB.maxActive) return { ok: false, why: 'Two jobs are already running. Finish or drop one first.' };
    J.board = J.board.filter(function (x) { return x !== j; });
    j.state = 'active'; j.acceptedH = clockH; j.deadlineH = clockH + j.windowH;
    J.active.push(j);
    return { ok: true, why: '', job: j };
  }
  const DONE_KEEP = 6;   // the panel lists the last six finished jobs
  function finish(J, j, state) {
    j.state = state; J.active = J.active.filter(function (x) { return x !== j; });
    J.done.unshift(j); if (J.done.length > DONE_KEEP) J.done.length = DONE_KEEP;
  }
  function dropJob(J, id) { const j = J.active.find(function (x) { return x.id === id; }); if (!j) return null; finish(J, j, 'dropped'); return j; }
  /* active jobs past their deadline fail; returns them */
  function expireJobs(J, clockH) {
    const out = [];
    J.active.slice().forEach(function (j) { if (clockH > j.deadlineH) { finish(J, j, 'failed'); out.push(j); } });
    return out;
  }
  /* kg of `mat` per head-tonne in bins that meet the purity, with the share of each bin (dross never ships) */
  function qualifying(bins, mat, purity) {
    const out = [];
    (bins || []).forEach(function (b) {
      const st = b && b.st; if (!st || !(st.total > 0) || b.form === 'dross' || !st.sellable) return;
      const pm = st.perMat && st.perMat[mat]; if (!pm || !(pm.mass > 0)) return;
      if (pm.mass / st.total + 1e-9 >= purity) out.push({ kg: pm.mass, share: pm.mass / st.total });
    });
    return out;
  }
  function qualifyingKg(bins, mat, purity) { return qualifying(bins, mat, purity).reduce(function (s, q) { return s + q.kg; }, 0); }
  /* Credit a finished batch to the active jobs, first accepted first. bins are per head-tonne, tonnes is the head tonnage run.
   * spot(mat) is the price the tonnes fetch anyway ($/t); withdraw(mat, t), when given, takes them out of stock and the job
   * then pays its full price. Returns deliveries [{ job, t, pay, done }]. */
  function applyBins(J, bins, tonnes, spot, withdraw) {
    const out = [];
    if (!(tonnes > 0)) return out;
    const pools = {};   // per bin, remaining kg of each material: a bin shipped to one job is gone for the next
    (bins || []).forEach(function (b, i) { pools[i] = {}; });
    J.active.slice().forEach(function (j) {
      let need = j.tons - j.t, got = 0;
      (bins || []).forEach(function (b, i) {
        if (need <= 1e-9) return;
        const st = b && b.st; if (!st || !(st.total > 0) || b.form === 'dross' || !st.sellable) return;
        const pm = st.perMat && st.perMat[j.mat]; if (!pm || !(pm.mass > 0)) return;
        if (pm.mass / Math.max(1e-9, st.total - (st.liquid || 0)) + 1e-9 < j.purity) return;   // #323: purity on the solids, as binStats measures it
        const avail = (pools[i][j.mat] == null ? pm.mass / 1000 * tonnes : pools[i][j.mat]);
        const take = Math.min(avail, need);
        pools[i][j.mat] = avail - take; need -= take; got += take;
      });
      if (got <= 1e-9) return;
      const price = spot ? spot(j.mat) : MATERIALS[j.mat].sell;
      let taken = 0;
      if (typeof withdraw === 'function') { const w = withdraw(j.mat, got); taken = isFinite(+w) ? clamp(+w, 0, got) : 0; }
      const pay = taken * j.mult * price + (got - taken) * (j.mult - 1) * price;
      j.t += got; j.paid += pay;
      const done = j.t >= j.tons - 1e-6;
      if (done) finish(J, j, 'done');
      out.push({ job: j, t: got, pay: pay, done: done, withdrawn: taken });
    });
    return out;
  }
  /* plant hours the current line needs to finish a job: remaining tonnes over (head rate x qualifying kg per head-tonne) */
  function jobHours(j, bins, R) {
    const kg = qualifyingKg(bins, j.mat, j.purity), rem = Math.max(0, j.tons - j.t);
    if (rem <= 0) return 0;
    if (!(R > 0) || kg <= 0) return Infinity;
    return rem / (R * kg / 1000);
  }
  function jobPrice(j, spot) { return j.mult * (spot || MATERIALS[j.mat].sell); }

  /* ---------------- state and persistence ---------------- */
  function newState() { return { rep: REP.start, jobs: newJobs(), rngState: null }; }
  function cleanJob(j) {
    if (!validJob(j)) return null;
    return { id: Math.floor(+j.id) || 0, mat: j.mat, tier: clamp(Math.floor(+j.tier) || 0, 0, TIERS.length - 1), batches: Math.max(1, Math.floor(+j.batches) || 1), tons: +j.tons,
      purity: clamp(+j.purity, 0, 1), mult: clamp(+j.mult, 1, JOB.mult[1]), windowH: +j.windowH, offerExpiresH: +j.offerExpiresH || 0, client: String(j.client || CLIENTS[0]),
      state: ['offered', 'active', 'done', 'failed', 'dropped'].indexOf(j.state) >= 0 ? j.state : 'offered', t: clamp(+j.t || 0, 0, +j.tons), paid: +j.paid || 0,
      acceptedH: j.acceptedH != null && isFinite(+j.acceptedH) ? +j.acceptedH : null, deadlineH: j.deadlineH != null && isFinite(+j.deadlineH) ? +j.deadlineH : null, ...(FEEDS[j.feed] && +j.feedT > 0 ? { feed: j.feed, feedT: +j.feedT } : {}) };
  }
  function serialize(st, rngState) {
    return { rep: st.rep, jobs: { board: st.jobs.board, active: st.jobs.active, done: st.jobs.done, nextId: st.jobs.nextId }, rngState: rngState == null ? st.rngState : rngState };
  }
  /* saved object (or junk) -> validated state */
  function deserialize(d) {
    const st = newState();
    if (!d || typeof d !== 'object') return st;
    st.rep = isFinite(+d.rep) ? clamp(+d.rep, REP.min, REP.max) : REP.start;
    const J = d.jobs && typeof d.jobs === 'object' ? d.jobs : {};
    const list = function (a, state) { return (Array.isArray(a) ? a : []).map(cleanJob).filter(function (j) { return j && (!state || state.indexOf(j.state) >= 0); }); };
    st.jobs.board = list(J.board, ['offered']); st.jobs.active = list(J.active, ['active']); st.jobs.done = list(J.done, ['done', 'failed', 'dropped']).slice(0, DONE_KEEP);
    let maxId = 0; st.jobs.board.concat(st.jobs.active, st.jobs.done).forEach(function (j) { maxId = Math.max(maxId, j.id); });
    st.jobs.nextId = Math.max(maxId + 1, Math.floor(+J.nextId) || 1);
    st.rngState = isFinite(+d.rngState) ? +d.rngState : null;
    return st;
  }
  function fmtH(h) {
    if (!isFinite(h)) return '--';
    const neg = h < 0; h = Math.abs(h);
    const tm = Math.round(h * 60), whole = Math.floor(tm / 60), min = tm - whole * 60;   // whole minutes first, so never '1 h 60 min'
    const s = whole >= 1 ? String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' h' + (min ? ' ' + String(min).padStart(2, '0') + ' min' : '') : min + ' min';   // #391: '1,259 h', not '1259 h'
    return (neg ? '-' : '') + s;
  }

  CS.Missions = {
    mulberry32, REP, TIERS, JOB, CLIENTS, DONE_KEEP,
    hoursNeeded,
    tierOf, tierName, repApply,
    yieldPerBatch, lotSizes, windowFor, purityFloor, reachMax, reachAt, lineReach, genJob, validJob, newJobs, tickBoard, acceptJob, dropJob, expireJobs, qualifying, qualifyingKg, applyBins, jobHours, jobPrice,
    newState, serialize, deserialize, fmtH
  };

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const API = CS.app; if (!API || API.missionsStarted) return; API.missionsStarted = true;
    const hasDom = typeof document !== 'undefined' && !!document.body;
    let st = newState(); const rng = mulberry32(0); let seeded = false;
    let panel = null, els = null, lastKey = -1, armed = null, gate = null, stale = false, bankStale = false;
    const S = function () { return API.S; };
    const clockH = function () { return (API.S ? API.S.clock || 0 : 0) / 3600; };
    const log = function (msg, cls) { if (typeof API.log === 'function') API.log(msg, cls); };
    const money = function (x) { return typeof API.fmtMoney === 'function' ? API.fmtMoney(x) : '$' + Math.round(x); };
    const num = function (x, d) { return typeof API.fmtNum === 'function' ? API.fmtNum(x, d) : String(Math.round(x * 10) / 10); };
    const esc = function (s) { return typeof API.esc === 'function' ? API.esc(s) : String(s); };
    const bins = function () { return typeof API.binList === 'function' ? API.binList() : []; };
    const headRate = function () { const s = S(); if (!s) return 0; return s.run ? s.run.rate : (s.mr ? s.mr.R : 0); };
    const spot = function (mat) { return MATERIALS[mat].sell * (CS.Sim && CS.Sim.prices ? CS.Sim.prices.market : 1); };
    const feeds = function () { return Object.keys(FEEDS); };
    const limit = function () { return typeof API.plantValue === 'function' ? API.plantValue('logistics') : 30; };
    /* #342: jobs are sized from the lots the auction deals at the tiers open to this yard (by rank) and within reach of its bank (lotSizes);
     * #395: with the live auction, from the lots on its board the yard can pay for and the lots it holds (lotsInReach) */
    let optMemo = { key: null, v: null };   // net worth is read once per sim hour, batch, bank or limit change, not on every tick
    const lotsKey = function () { const A = CS.Auction && CS.Auction.live; if (!A) return ''; return [A.pending()].concat(A.yard(), A.board()).map(function (L) { return L ? L.id + '/' + L.tons : ''; }).join(); };   // #395: a lot bought, dealt or run changes the jobs on offer
    const genOpts = function () {
      const s = S(), key = Math.floor(clockH()) + ':' + (s ? s.batches + ':' + Math.round(Math.log(Math.max(1, s.money)) * 20) : '') + ':' + limit() + ':' + Math.round(headRate()) + ':' + st.rep + ':' + lotsKey() + ':' + st.jobs.active.map(function (j) { return j.id + '/' + Math.round(j.t * 10); }).join() + ':' + (s && s.line ? s.line.map((n) => n.m + n.uid + JSON.stringify(n.settings) + JSON.stringify(n.src)).join() : ''); if (optMemo.key === key) return optMemo.v;   // #368: a changed line reaches other metals
      optMemo = { key, v: genOptsNow() }; return optMemo.v;
    };
    /* #385: what the yard can spend on a lot: the bank, its stock at the SELL quote and the lots it holds at cost, the batch on the line included
     * (a lot just loaded leaves the bank near zero, and it comes back as stock) */
    const spendable = function () {
      const s = S(); if (!s) return null; let v = Math.max(0, s.money);
      try { const I = CS.Inventory, sk = I && I.stock ? I.stock() : null; if (sk && typeof I.quote === 'function') for (const m in sk) v += Math.max(0, I.quote(m) || 0); } catch (e) { /* no inventory */ }
      const A = CS.Auction && CS.Auction.live; if (A) { [A.pending()].concat(A.yard()).forEach(function (L) { if (L && L.tons > 0) v += L.ask * L.tons; }); const se = typeof A.settle === 'function' ? A.settle() : null; if (se && se.lot && se.tons > 0) v += se.lot.ask * se.tons; }
      return v;
    };
    /* #395: the lots a job can be met from: those in the yard and those on the auction board the yard can pay for. capT { feed: t } is the
     * tonnes of each feed they carry together, less what accepted jobs still need from it; anyT the same for every lot whatever its price
     * (an offer is withdrawn only when its lots are gone, not when the bank dips). null without a live board. */
    const lotsInReach = function (spend) {
      const A = CS.Auction && CS.Auction.live; if (!A || typeof A.board !== 'function') return null;
      const lotT = {}, capT = {}, anyT = {}, add = function (L, paid) { const id = L.base; anyT[id] = (anyT[id] || 0) + L.tons; if (!paid) return; lotT[id] = Math.max(lotT[id] || 0, L.tons); capT[id] = (capT[id] || 0) + L.tons; };
      [A.pending()].concat(A.yard()).forEach(function (L) { if (L && L.tons > 0 && FEEDS[L.base]) add(L, true); });
      const left = {}; A.board().map(function (L) { return { L: L, c: (typeof A.priceOf === 'function' ? A.priceOf(L) : L.ask) * L.tons }; }).sort(function (a, b) { return a.c - b.c; }).forEach(function (x) { const id = x.L.base, l = left[id] == null ? spend : left[id]; if (!(x.L.tons > 0) || !FEEDS[id]) return; const ok = x.c <= l + 1e-6; if (ok) left[id] = l - x.c; add(x.L, ok); });   // each feed's lots, cheapest first, as far as the money goes
      st.jobs.active.forEach(function (j) { const need = j.feed ? j.feedT * Math.max(0, 1 - j.t / j.tons) : 0; if (need > 0) { if (capT[j.feed] > 0) capT[j.feed] = Math.max(0, capT[j.feed] - need); if (anyT[j.feed] > 0) anyT[j.feed] = Math.max(0, anyT[j.feed] - need); } });   // tonnes an accepted job still needs are promised: no second job is sized from the same lot
      return { feeds: Object.keys(lotT).filter(function (id) { return capT[id] > 0; }), lotT: lotT, capT: capT, anyT: anyT };
    };
    /* #395: an offer whose lots are gone (sold, closed or promised to an accepted job) is withdrawn, so the board shows only jobs the yard can meet */
    /* #395: tonnes already in the yard ahead of a new lot: the loaded lot, the yard queue, the batch on the line and the MISC pile */
    function aheadT() {
      let t = 0; const A = CS.Auction && CS.Auction.live; if (A) { [A.pending()].concat(A.yard()).forEach(function (L) { if (L && L.tons > 0) t += L.tons; }); const se = typeof A.settle === 'function' ? A.settle() : null; if (se && se.tons > 0) t += se.tons; }
      try { const I = CS.Inventory; if (I && I.misc && I.miscTotal) t += I.miscTotal(I.misc()); } catch (e) { /* no inventory */ }
      return t;
    }
    function pruneOffers(o) {
      if (!o || !o.anyT) return false; const n = st.jobs.board.length;
      st.jobs.board = st.jobs.board.filter(function (j) { return !j.feed || (o.anyT[j.feed] || 0) >= 0.9 * j.feedT; });
      return st.jobs.board.length !== n;
    }
    const genOptsNow = function () {
      let open = 0; try { open = CS.Auction.tiersOpen(API.rankOf(API.netWorth()).idx); } catch (e) { open = 0; }
      const spend = spendable(), live = lotsInReach(spend || 0), L = live || lotSizes(open, spend);
      const o = L && L.feeds.length ? { feeds: L.feeds, lotT: L.lotT, limit: limit(), rate: headRate(), rep: st.rep } : { feeds: live ? [] : feeds(), limit: limit(), rate: headRate(), rep: st.rep };
      if (live) { o.capT = live.capT; o.anyT = live.anyT; }
      const r = reachNow(live ? feeds() : o.feeds); if (r) { o.reach = r; o.rateOf = reachMemo.rate; }   // #395: every feed, so the memo holds while the lots in reach come and go (genJob reads only o.feeds)
      const ah = aheadT(), R = headRate(); o.aheadH = (R > 0 ? ah / R : 0) + JOB.hoursPerBatch;   // #395: the window also covers the work the yard runs before the job's lot, and one more batch (a MISC re-run)
      return o;
    };
    /* #360: what the line makes of each job metal from each feed, read again only when the line (machines, settings, wiring, levels) or the feeds change */
    let reachMemo = { key: null, v: null };
    function reachNow(fs) {
      const s = S(); if (!s || !Array.isArray(s.line) || !CS.Sim || !CS.Sim.evalLine || !CS.Sim.binStats) return null;
      const lv = function (m) { try { return typeof API.levelOf === 'function' ? API.levelOf(m) : 0; } catch (e) { return 0; } };
      const key = JSON.stringify(s.line.map(function (n) { return [n.m, n.uid, n.settings, n.src, lv(n.m)]; })) + '|' + fs.join();
      if (reachMemo.key !== key) {
        const evs = new Map(), v = lineReach(function (comp) { const ev = CS.Sim.evalLine(s.line, comp); evs.set(comp, ev); return ev; }, CS.Sim.binStats, fs), rate = {};
        fs.forEach(function (id) { const ev = FEEDS[id] && evs.get(FEEDS[id].comp); if (!ev || !CS.Sim.maxRate) return; try { const R = CS.Sim.maxRate(ev.nodes, s.line).R; if (R > 0) rate[id] = R; } catch (e) { /* no rate */ } });   // #395: the head rate on each feed, for the job window
        reachMemo = { key: key, v: v, rate: rate };
      }
      return reachMemo.v;
    }
    function credit(amount) { const s = S(); if (!s || !(amount > 0)) return; s.money += amount; s.lifetime = (s.lifetime || 0) + amount; if (API.emit) API.emit('income', { amount, from: 'job' }); }
    function rep(delta, why) { const before = st.rep; st.rep = repApply(st.rep, delta); if (st.rep !== before) log('Reputation ' + (delta > 0 ? '+' : '') + delta + ' (' + why + '): now ' + st.rep + ', ' + tierName(st.rep) + '.', delta > 0 ? 'ok' : 'warn'); }

    /* ---- persistence ---- */
    function restore(ext) {
      st = deserialize(ext && ext.missions);
      if (st.rngState != null) { rng.setState(st.rngState); seeded = true; }
    }
    API.on('load', restore);
    if (API.S && API.S.ext) restore(API.S.ext);   // registered after boot: the 'load' event has already fired
    API.on('save', function () { return { missions: serialize(st, rng.getState()) }; });
    /* rival yards (ticket #32, js/modules/rivals.js) read the live reputation and job board, and may take an offered job off the board */
    CS.Missions.live = { rep: function () { return st.rep; }, jobs: function () { return st.jobs; }, genOpts: function () { return genOptsNow(); }, render: function () { render(); }, accept: function (id) { accept(id); } };   // accept: the ACCEPT button (tests)

    /* the clock moved: deadlines, grace periods, job windows and the job board */
    function advance(dh) {
      const h = clockH(); let changed = false;
      expireJobs(st.jobs, h).forEach(function (j) { log('Job #' + j.id + ' failed: ' + j.client + ' needed ' + num(j.tons, 1) + ' t of ' + MATERIALS[j.mat].name.toLowerCase() + ' and got ' + num(j.t, 1) + ' t before the window closed.', 'bad'); rep(REP.jobFail, 'job failed'); changed = true; });
      const o = genOpts(); if (pruneOffers(o)) changed = true;
      if (tickBoard(st.jobs, rng, h, dh, o)) changed = true;
      if (st.jobs.board.length < JOB.board.min && !(h - lastDealH < JOB.board.arriveH) && dealFor(o)) { lastDealH = h; tickBoard(st.jobs, rng, h, 0, genOpts()); changed = true; }   // #395: keep the board stocked
      return changed;
    }
    /* #395: no lot in reach carries a metal the line sorts clean: a client posts its job with a lot to match, dealt in a tier the yard can
     * pay for (never a bad buy, CS.Auction.live.dealTier) in place of that tier's lot, unless that lot is what a job counts on. At most once
     * every JOB.board.arriveH hours of plant time, so the auction board is not churned. */
    let lastDealH = -Infinity;
    function dealFor(o) {
      const A = CS.Auction, live = A && A.live; if (!live || typeof live.dealTier !== 'function' || !A.TIERS || !A.TIER_FEEDS || !o || !o.reach) return false;
      let open = 0; try { open = A.tiersOpen(API.rankOf(API.netWorth()).idx); } catch (e) { open = A.BASE_TIERS || 6; }
      const spend = spendable() || 0, used = {}; st.jobs.active.concat(st.jobs.board).forEach(function (j) { if (j.feed) used[j.feed] = 1; });
      const sorts = function (id) { return JOB.mats.some(function (m) { return reachAt(o.reach[m] && o.reach[m][id], purityFloor(m) + JOB.purityMargin) > 0; }); };
      const opts = []; for (let k = 0; k < Math.min(open, A.TIERS.length); k++) { if (A.TIERS[k] > spend) break; const cur = live.board().find(function (L) { return L.tier === k; }); if (cur && used[cur.base]) continue; (A.TIER_FEEDS[k] || []).forEach(function (id) { if (FEEDS[id] && sorts(id)) opts.push([k, id]); }); }
      if (!opts.length) return false; const p = pick(rng, opts); return !!live.dealTier(p[0], p[1]);
    }

    /* ---- job actions ---- */
    function accept(id) {
      const r = acceptJob(st.jobs, id, clockH(), st.rep);
      if (!r.ok) { if (CS.Audio) CS.Audio.ui('deny'); log(r.why, 'warn'); return; }
      const j = r.job; pruneOffers(genOpts());   // #395: the other offers sized from the lots this job takes are withdrawn
      if (CS.Audio) CS.Audio.ui('ok');
      log('Job #' + j.id + ' accepted: ' + num(j.tons, 1) + ' t of ' + MATERIALS[j.mat].name.toLowerCase() + ' at ≥ ' + Math.round(j.purity * 100) + '% purity for ' + j.client + ', ' + money(jobPrice(j, spot(j.mat))) + '/t (spot ' + money(spot(j.mat)) + '), due in ' + fmtH(j.windowH) + ' of plant time. Every bin that meets the purity counts, from any batch.', 'ok');
      if (typeof API.save === 'function') API.save();
      render();
    }
    function drop(id, btn) {
      if (armed !== id) { armed = id; if (btn) { btn.textContent = 'SURE?'; btn.classList.add('bad'); } setTimeout(function () { if (armed === id) { armed = null; render(); } }, 3000); return; }
      armed = null;
      const j = dropJob(st.jobs, id); if (!j) return;
      log('Job #' + j.id + ' dropped: ' + j.client + ' will look elsewhere for its ' + MATERIALS[j.mat].name.toLowerCase() + '.', 'warn');
      rep(REP.jobDrop, 'job dropped');
      if (typeof API.save === 'function') API.save();
      render();
    }

    /* ---- panel ---- */
    function build() {
      if (panel || !hasDom || typeof API.addPanel !== 'function') return;
      panel = API.addPanel('left', 'missions-panel', 'Missions', 'bank-panel');
      panel.querySelector('h2').appendChild(API.el('span', 'tag', ''));
      const ro = API.el('div', 'readouts two'); ro.id = 'missions-readouts'; panel.appendChild(ro);
      const jh = API.el('h3', null, 'Job board '); jh.appendChild(API.el('span', 'small', 'paid above spot')); panel.appendChild(jh);   // #373: a job can be under a tonne, so no promise of big lots (the header had been commented out with this note)
      const jb = API.el('div'); jb.id = 'jobs'; panel.appendChild(jb);
      panel.appendChild(API.el('div', 'small', 'The mission clock runs only while a batch runs: a window is a budget of plant time. A job counts every product bin that meets its purity, from any batch, and pays its premium over spot on delivery; the bales still sell at spot from inventory.'));
      const css = document.createElement('style');
      css.textContent = '#missions-panel .ask{color:var(--amber);font-family:var(--mono);white-space:nowrap}#missions-panel .crow.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}#missions-panel .crow.locked{opacity:.55}' +
        '#missions-panel .jbar{display:flex;height:5px;border-radius:3px;overflow:hidden;margin:4px 0 2px;background:var(--line)}#missions-panel .jbar i{display:block;height:100%;background:var(--green)}' +
        '#missions-panel .mrow{font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);display:flex;justify-content:space-between;gap:8px}#missions-panel .mrow span:first-child{color:var(--muted);letter-spacing:1px;font-size: 11px}' +
        '.mission-cd{font-family:var(--mono);font-size: 11px;letter-spacing:1px;color:var(--cyan)}.mission-cd.late{color:var(--amber)}.mission-cd.bad{color:var(--red)}.mission-cd.ok{color:var(--green)}';
      panel.appendChild(css);
      els = { ro: ro, jb: jb, tag: panel.querySelector('h2 .tag') };
      gate = CS.Sim && CS.Sim.panelGate ? CS.Sim.panelGate(panel, document, function () { if (stale) refresh(); }) : null;
    }
    function render() {
      if (!els) return;
      stale = false;
      const h = clockH(), R = headRate(), bl = bins();
      const tier = tierOf(st.rep);
      els.tag.textContent = st.jobs.active.length + ' JOB' + (st.jobs.active.length === 1 ? '' : 'S') + ' · ' + st.jobs.board.length + ' OPEN';
      els.ro.innerHTML = API.ro('REPUTATION', Math.round(st.rep), '&nbsp;· ' + tierName(st.rep).toUpperCase(), tier >= 2 ? 'good' : '') + API.ro('ACTIVE JOBS', st.jobs.active.length + ' / ' + JOB.maxActive, '');   // #373: 'REPUTATION 0 · NEW YARD', not '0NEW YARD'
      // job board
      els.jb.innerHTML = '';
      const matName = function (mat) { return MATERIALS[mat].name.toLowerCase(); };
      st.jobs.active.forEach(function (j) {
        const need = jobHours(j, bl, R), left = j.deadlineH - h, frac = clamp(j.t / j.tons, 0, 1);
        const fits = isFinite(need) && need <= left;
        const r = API.el('div', 'crow active', '<div class="ch"><b>#' + j.id + ' · ' + num(j.tons, 1) + ' t ' + esc(matName(j.mat)) + ' ≥ ' + Math.round(j.purity * 100) + '%</b><span class="ask">' + money(jobPrice(j, spot(j.mat))) + '/t</span></div>' +
          '<div class="cd">' + esc(j.client) + ' · ' + num(j.t, 1) + ' of ' + num(j.tons, 1) + ' t delivered · paid ' + money(j.paid) + '<div class="jbar"><i style="width:' + Math.round(frac * 100) + '%"></i></div></div>' +
          '<div class="cd"><span class="' + (left < 0.25 * j.windowH ? 'warn' : 'ok') + '">' + fmtH(left) + ' left</span> · <span class="' + (fits ? 'ok' : 'bad') + '">' + (isFinite(need) ? 'needs ' + fmtH(need) + ' at this line' : (R > 0 ? 'no bin on this line meets ' + Math.round(j.purity * 100) + '% ' + esc(matName(j.mat)) : 'line cannot run')) + '</span></div>');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'danger'; b.textContent = armed === j.id ? 'SURE?' : 'DROP'; b.title = 'Give the job up (reputation ' + REP.jobDrop + ')';
        b.addEventListener('click', function () { drop(j.id, b); });
        r.appendChild(b); els.jb.appendChild(r);
      });
      if (!st.jobs.board.length && !st.jobs.active.length) els.jb.appendChild(API.el('div', 'empty', 'No jobs on the board: clients post jobs only for ' + JOB.mats.map(function (m) { return matName(m).toLowerCase() + ' (' + Math.round(purityFloor(m) * 100) + '%+)'; }).join(', ').replace(/, ([^,]*)$/, ' and $1') + ', when your line sorts that metal clean and a lot carrying it is in your yard or on the auction board at a price you can pay.'));   // #360; #373: name the job metals and their purity floors; #395: and the lot
      st.jobs.board.slice().sort(function (a, b) { return a.offerExpiresH - b.offerExpiresH; }).forEach(function (j) {
        const locked = j.tier > tier, full = st.jobs.active.length >= JOB.maxActive;
        const sp = spot(j.mat), price = jobPrice(j, sp);
        const r = API.el('div', 'crow' + (locked ? ' locked' : ''), '<div class="ch"><b>' + num(j.tons, 1) + ' t ' + esc(matName(j.mat)) + ' ≥ ' + Math.round(j.purity * 100) + '%</b><span class="ask">' + money(price) + '/t</span></div>' +
          '<div class="cd">' + esc(j.client) + ' · ' + esc(TIERS[j.tier].name) + ' tier · spot ' + money(sp) + '/t, premium ' + money(price - sp) + '/t · worth ' + money((price - sp) * j.tons) + ' over spot</div>' +
          '<div class="cd">' + fmtH(j.windowH) + ' of plant time once accepted · offer closes in ' + fmtH(j.offerExpiresH - h) + (locked ? ' · needs reputation ' + TIERS[j.tier].min : '') + '</div>');
        const b = document.createElement('button'); b.type = 'button';
        if (locked) { b.textContent = 'LOCKED'; b.className = 'buy poor'; b.disabled = true; }
        else { b.textContent = 'ACCEPT'; b.className = 'buy' + (full ? ' poor' : ''); b.title = full ? 'Two jobs are already running' : 'Take the job'; b.addEventListener('click', function () { accept(j.id); }); }
        r.appendChild(b); els.jb.appendChild(r);
      });
      if (st.jobs.done.length) {
        const d = st.jobs.done[0];
        els.jb.appendChild(API.el('div', 'small', 'Last job: #' + d.id + ' ' + num(d.tons, 1) + ' t ' + esc(matName(d.mat)) + ' for ' + esc(d.client) + ' ' + d.state + (d.state === 'done' ? ', paid ' + money(d.paid) : d.t > 0 ? ', ' + num(d.t, 1) + ' t delivered' : '') + '.'));
      }
    }

    /* ---- hooks ---- */
    API.on('boot', function () {
      if (!seeded) { rng.setState((Math.floor(clockH() * 60) + 0x5eed) >>> 0); seeded = true; }   // first ever boot: seed from the clock, then the saved state carries the stream
      const o = genOpts(); pruneOffers(o); tickBoard(st.jobs, rng, clockH(), 0, o);
      build(); render();
    });
    API.on('render', function () { render(); });
    API.on('batchStart', function () { render(); });
    const rivals = function () { return !!(S() && S().mode === 'rivals'); };   // #307: the job board is hidden and frozen in Rivals
    API.on('tick', function (p) {
      if (!p || !(p.dh > 0) || rivals()) return;
      const changed = advance(p.dh);
      const key = Math.floor(clockH() * 12);   // every five sim minutes the countdowns move
      if (changed || key !== lastKey) { lastKey = key; stale = true; }
      if (changed) bankStale = true;
      if (stale) refresh();
    });
    /* #199: hold the rebuild while the pointer is down in the panel or the panel is hidden; it runs on release or the next tick */
    function refresh() {
      if (gate && gate.busy()) return;
      const bank = bankStale; bankStale = false;
      render(); if (bank && typeof API.renderBank === 'function') API.renderBank();
    }
    API.on('batchComplete', function (p) {
      if (!p || !p.r || rivals()) return;
      const dl = p.r.src === 'stock' || p.r.src === 'misc' ? [] : applyBins(st.jobs, p.bins, p.r.done, spot, null);   // #98: re-running a held bucket does not deliver it a second time
      dl.forEach(function (d) {
        const j = d.job;
        credit(d.pay);
        log('Job #' + j.id + ': ' + num(d.t, 1) + ' t of ' + MATERIALS[j.mat].name.toLowerCase() + ' delivered to ' + j.client + ' (' + num(j.t, 1) + ' of ' + num(j.tons, 1) + ' t). ' + (d.withdrawn > 0 ? 'Paid ' + money(d.pay) + '.' : 'Premium ' + money(d.pay) + ' paid; the bales sell at spot from inventory.'), 'ok');
        if (d.done) { log('Job #' + j.id + ' complete: ' + j.client + ' paid ' + money(j.paid) + ' over spot in all.', 'ok'); rep(REP.jobDone[j.tier] || REP.jobDone[0], 'job complete'); if (CS.Audio) CS.Audio.ui('done'); }
      });
      render();   // the app saves and re-renders after this event
    });
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
