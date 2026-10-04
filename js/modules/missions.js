/* CrunchSim module: missions. Timed contracts and a board of large jobs (tickets #27 and #26).
 *
 * Missions: every contract in CS.Score.CONTRACTS carries a delivery window in mission-clock hours. Accepting a
 * contract starts the clock; a scored batch delivers it. States: offered, accepted, in progress, delivered, failed.
 * A delivery after the deadline pays 60% of the fee (the app banks the full fee first, the difference is deducted
 * here). When the deadline plus a grace period passes without a delivery the client cancels and liquidated damages
 * are deducted from the bank. The mission clock only advances while a batch runs, so a window is really a budget
 * of plant time: a few runs of the right line, fewer of the wrong one.
 *
 * Jobs: clients post large jobs for the scarce non-ferrous metals: so many tonnes of a target material at a
 * purity, a delivery window, and a price well above spot. Progress accumulates across batches from every product
 * bin whose purity meets the spec (payload.bins of 'batchComplete', per head-tonne, scaled by the tonnes run).
 * The bins also go to inventory (the inventory module keeps its live stock private), so the job pays its premium
 * over spot on delivery and the tonnes are still sold at spot from inventory: nothing is paid twice. If a later
 * inventory version exposes CS.Inventory.live.withdraw(mat, t), the job takes the tonnes and pays the full price.
 *
 * Reputation rises with deliveries and completed jobs, falls with failures, and unlocks bigger job tiers.
 *
 * The pure parts (deadlines, phases, settlement, penalties, reputation, job generation, progress, projection,
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

  /* ---------------- contract missions ----------------
   * Delivery windows in sim hours from acceptance: three runs of the intended line at the head rates measured in
   * tests/contracts.js (ferrous 0.5 h a batch, mulch 1.7, office 1.1, road base 0.5, flour 1.1, rubble 0.9, crumb 2.3,
   * zorba 0.7, gel 4.0), rounded up to whole hours, floor 4 h: half a shift is the shortest window a client quotes.
   */
  const DEADLINE_H = { ferrous: 4, mulch: 6, chair: 4, roadbase: 4, flour: 4, rebar: 4, crumb: 8, zorba: 4, gel: 12 };
  const DEADLINE_MIN_H = 4;     // half a shift
  const FALLBACK_TPH = 10;      // a contract this table does not know gets three runs at 10 t/h, a small sorting line's head rate
  const GRACE_FRAC = 0.25, GRACE_MIN_H = 1;   // cure period before the client cancels: a quarter of the window, at least an hour
  const LATE_RATE = 0.6;        // a late delivery pays 60% of the fee (ticket #27); late-delivery clauses in toll agreements dock 20-50%
  const PENALTY_FRAC = 0.2;     // liquidated damages on cancellation: 20% of the contract value, the top of the usual 10-20% LD cap, since the client must now haul its feed away

  function deadlineFor(C) {
    if (!C) return DEADLINE_MIN_H;
    if (DEADLINE_H[C.id]) return DEADLINE_H[C.id];
    return Math.max(DEADLINE_MIN_H, Math.ceil(3 * (C.tons || 0) / FALLBACK_TPH));
  }
  function graceFor(windowH) { return Math.max(GRACE_MIN_H, GRACE_FRAC * windowH); }
  /* what the contract is worth at two stars with every tonne of target recovered: fee x tonnes x target share of the feed */
  function contractValue(C) {
    const comp = C && FEEDS[C.feed] ? FEEDS[C.feed].comp : {};
    let f = 0; (C && C.targets || []).forEach(function (m) { f += comp[m] || 0; });
    return (C ? C.fee * C.tons : 0) * (f > 0 ? f : 1);
  }
  function penaltyFor(C) { return Math.round(PENALTY_FRAC * contractValue(C)); }

  function newMission(C, clockH) {
    const w = deadlineFor(C);
    return { id: C.id, acceptedH: clockH, windowH: w, deadlineH: clockH + w, graceH: graceFor(w), state: 'accepted', attempts: 0, deliveries: 0, late: 0, bestStars: 0, penalty: 0 };
  }
  /* where the clock stands against the window: ontime | late (grace running) | overdue (grace spent) | failed */
  function missionPhase(m, clockH) {
    if (!m) return { phase: 'offered', leftH: 0, lateH: 0 };
    const leftH = m.deadlineH - clockH;
    if (m.state === 'failed') return { phase: 'failed', leftH: leftH, lateH: -leftH };
    if (leftH >= 0) return { phase: 'ontime', leftH: leftH, lateH: 0 };
    return { phase: clockH <= m.deadlineH + m.graceH ? 'late' : 'overdue', leftH: leftH, lateH: -leftH };
  }
  /* the state shown to the player */
  function missionState(m, running) {
    if (!m) return 'offered';
    if (m.state === 'failed') return 'failed';
    if (m.state === 'delivered') return 'delivered';
    return running ? 'in progress' : 'accepted';
  }
  /* A scored batch. cs is the contract score from the app (stars, fee). Mutates m. Every delivery after the deadline
   * pays the late rate, so a late one-star run cannot be topped up at full price afterwards. */
  function settle(m, cs, clockH) {
    m.attempts++;
    if (!cs || !(cs.stars > 0)) return { delivered: false, late: false, factor: 1, deduction: 0 };
    const late = clockH > m.deadlineH, factor = late ? LATE_RATE : 1;
    const deduction = Math.max(0, (cs.fee || 0) * (1 - factor));
    m.deliveries++; if (late) m.late++;
    m.bestStars = Math.max(m.bestStars, cs.stars);
    if (m.state === 'accepted') m.state = 'delivered';
    return { delivered: true, late: late, factor: factor, deduction: deduction, first: m.deliveries === 1 };
  }
  /* the grace period has passed with nothing delivered: the client cancels. Returns the penalty, 0 when nothing happens. */
  function expire(m, C, clockH) {
    if (!m || m.state !== 'accepted') return 0;
    if (clockH <= m.deadlineH + m.graceH) return 0;
    m.state = 'failed'; m.penalty = penaltyFor(C);
    return m.penalty;
  }
  /* plant hours to run `tons` at head rate `rate` t/h */
  function hoursNeeded(tons, rate) { return rate > 0 && tons > 0 ? tons / rate : (tons > 0 ? Infinity : 0); }

  /* ---------------- reputation ----------------
   * 0..100, like a supplier scorecard built on delivery performance. A contract on time is worth a few points, a completed
   * large job a season's worth; a failure costs more than a success earns, as it does with real procurement desks.
   */
  const REP = { start: 0, min: 0, max: 100, contractOnTime: 3, contractLate: 1, contractFail: -5, jobDone: [6, 10, 15], jobFail: -10, jobDrop: -6 };
  // tiers: a new yard gets small lots; a quarter's clean record (25 points) opens medium jobs, a year's (60) the large ones
  const TIERS = [{ min: 0, name: 'New yard' }, { min: 25, name: 'Trusted' }, { min: 60, name: 'Preferred' }];
  function tierOf(rep) { let t = 0; for (let i = 0; i < TIERS.length; i++) if (rep >= TIERS[i].min) t = i; return t; }
  function tierName(rep) { return TIERS[tierOf(rep)].name; }
  function repApply(rep, delta) { return clamp(Math.round(((+rep || 0) + delta) * 10) / 10, REP.min, REP.max); }

  /* ---------------- jobs ---------------- */
  const JOB = {
    mats: ['copper', 'brass', 'potmetal', 'aluminum'],   // the non-ferrous metals: the scarce, high-value fractions of shredder output
    minFrac: 0.01,       // a feed counts as a source of a metal when it carries at least 1% of it
    recovery: 0.75,      // a sorting line recovers 70-80% of a target metal into a clean bin (eddy current and sink-float plant data)
    batches: [[1, 2], [3, 5], [6, 12]],   // job size per tier in batches of the richest available feed
    // purity a buyer requires, by ISRI-style grade: No. 2 copper (Birch/Cliff) 94-96% is out of reach of a sorted shredder
    // stream, so copper and brass jobs ask 85-92% (sorted "meatball"-free fractions), zinc die-cast 90-96%, zorba-grade
    // aluminum 95-98% (a sink-float float fraction)
    purity: { copper: [0.85, 0.92], brass: [0.85, 0.90], potmetal: [0.90, 0.96], aluminum: [0.95, 0.98] },
    mult: [1.25, 1.6],   // job price over spot: smelters pay 25-60% over the index for guaranteed, sorted tonnage
    hoursPerBatch: 3,    // a 30 t batch at a twin-shaft shredder's 15 t/h is 2 h, plus an hour to source and load the lot
    windowSlack: 2,      // the window is twice the plant time the job needs (the yard runs other work too), with 2 h on top
    offerH: [12, 48],    // an offer stays on the board 12-48 sim hours, like an online tender
    board: { min: 2, max: 4, arriveH: 12 },   // two to four open jobs; a new one about every 12 sim hours (Poisson)
    maxActive: 2,        // two jobs at once: more and the yard is a toll processor, not a plant
    minTons: 0.5
  };
  const CLIENTS = ['Harbour Secondary Smelter', 'Northgate Brass Foundry', 'Two Rivers Die-casting', 'Westfield Rolling Mill', 'Kestrel Alloys', 'Lakeside Wire & Cable', 'Bayside Ingot Works', 'Delta Refiners'];

  /* tonnes of `mat` a batch of the richest available feed yields into a clean bin */
  function yieldPerBatch(mat, feeds, limit) {
    let best = 0;
    (feeds || []).forEach(function (id) { const F = FEEDS[id]; if (!F) return; const f = F.comp[mat] || 0; if (f >= JOB.minFrac && f > best) best = f; });
    return best * (limit > 0 ? limit : 30) * JOB.recovery;
  }
  function windowFor(batches) { return Math.ceil(batches * JOB.hoursPerBatch * 2 + JOB.windowSlack); }
  /* Generate one job. opts: { feeds: [ids the player can buy], limit: t per batch, rep, clockH, id } */
  function genJob(rng, opts) {
    opts = opts || {};
    const feeds = opts.feeds && opts.feeds.length ? opts.feeds : ['elv'];
    const cands = JOB.mats.map(function (m) { return { m: m, y: yieldPerBatch(m, feeds, opts.limit) }; }).filter(function (c) { return c.y > 0; });
    const c = cands.length ? pick(rng, cands) : { m: 'aluminum', y: yieldPerBatch('aluminum', ['elv'], opts.limit) };
    const tier = Math.floor(rng() * (tierOf(opts.rep || 0) + 1));
    const br = JOB.batches[tier], batches = Math.round(uni(rng, br[0], br[1]));
    const tons = Math.max(JOB.minTons, Math.round(c.y * batches * 10) / 10);
    const pr = JOB.purity[c.m] || [0.9, 0.95];
    const purity = Math.round(uni(rng, pr[0], pr[1]) * 100) / 100;
    const mult = Math.round(uni(rng, JOB.mult[0], JOB.mult[1]) * 100) / 100;
    const clockH = opts.clockH || 0;
    return { id: opts.id || 0, mat: c.m, tier: tier, batches: batches, tons: tons, purity: purity, mult: mult, windowH: windowFor(batches),
      offerExpiresH: clockH + Math.round(uni(rng, JOB.offerH[0], JOB.offerH[1])), client: pick(rng, CLIENTS), state: 'offered', t: 0, paid: 0, acceptedH: null, deadlineH: null };
  }
  function validJob(j) { return !!(j && typeof j === 'object' && MATERIALS[j.mat] && isFinite(+j.tons) && +j.tons > 0 && isFinite(+j.purity) && isFinite(+j.mult) && isFinite(+j.windowH)); }
  function newJobs() { return { board: [], active: [], done: [], nextId: 1 }; }
  /* Board upkeep: expire offers, let new ones arrive, keep at least board.min open. Pure: draws from rng only. */
  function tickBoard(J, rng, clockH, dh, opts) {
    const before = J.board.length;
    J.board = J.board.filter(function (j) { return j.offerExpiresH > clockH; });
    const mk = function () { return genJob(rng, Object.assign({}, opts, { clockH: clockH, id: J.nextId++ })); };
    if (dh > 0 && J.board.length < JOB.board.max && rng() < 1 - Math.exp(-dh / JOB.board.arriveH)) J.board.push(mk());
    while (J.board.length < JOB.board.min) J.board.push(mk());
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
      const st = b && b.st; if (!st || !(st.total > 0) || b.form === 'dross') return;
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
        const st = b && b.st; if (!st || !(st.total > 0) || b.form === 'dross') return;
        const pm = st.perMat && st.perMat[j.mat]; if (!pm || !(pm.mass > 0)) return;
        if (pm.mass / st.total + 1e-9 < j.purity) return;
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
  function newState() { return { rep: REP.start, mission: null, last: null, jobs: newJobs(), rngState: null }; }
  function cleanMission(m) {
    if (!m || typeof m !== 'object' || !m.id || !isFinite(+m.deadlineH)) return null;
    const windowH = isFinite(+m.windowH) && +m.windowH > 0 ? +m.windowH : DEADLINE_MIN_H;
    return { id: String(m.id), acceptedH: +m.acceptedH || 0, windowH: windowH, deadlineH: +m.deadlineH, graceH: isFinite(+m.graceH) ? +m.graceH : graceFor(windowH),
      state: ['accepted', 'delivered', 'failed'].indexOf(m.state) >= 0 ? m.state : 'accepted', attempts: Math.max(0, Math.floor(+m.attempts) || 0),
      deliveries: Math.max(0, Math.floor(+m.deliveries) || 0), late: Math.max(0, Math.floor(+m.late) || 0), bestStars: clamp(Math.floor(+m.bestStars) || 0, 0, 3), penalty: +m.penalty || 0 };
  }
  function cleanJob(j) {
    if (!validJob(j)) return null;
    return { id: Math.floor(+j.id) || 0, mat: j.mat, tier: clamp(Math.floor(+j.tier) || 0, 0, TIERS.length - 1), batches: Math.max(1, Math.floor(+j.batches) || 1), tons: +j.tons,
      purity: clamp(+j.purity, 0, 1), mult: Math.max(1, +j.mult), windowH: +j.windowH, offerExpiresH: +j.offerExpiresH || 0, client: String(j.client || CLIENTS[0]),
      state: ['offered', 'active', 'done', 'failed', 'dropped'].indexOf(j.state) >= 0 ? j.state : 'offered', t: clamp(+j.t || 0, 0, +j.tons), paid: +j.paid || 0,
      acceptedH: j.acceptedH != null && isFinite(+j.acceptedH) ? +j.acceptedH : null, deadlineH: j.deadlineH != null && isFinite(+j.deadlineH) ? +j.deadlineH : null };
  }
  function serialize(st, rngState) {
    return { rep: st.rep, mission: st.mission, last: st.last, jobs: { board: st.jobs.board, active: st.jobs.active, done: st.jobs.done, nextId: st.jobs.nextId }, rngState: rngState == null ? st.rngState : rngState };
  }
  /* saved object (or junk) -> validated state */
  function deserialize(d) {
    const st = newState();
    if (!d || typeof d !== 'object') return st;
    st.rep = isFinite(+d.rep) ? clamp(+d.rep, REP.min, REP.max) : REP.start;
    st.mission = cleanMission(d.mission); st.last = cleanMission(d.last);
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
    const whole = Math.floor(h), min = Math.round((h - whole) * 60);
    const s = whole >= 1 ? whole + ' h' + (min ? ' ' + String(min).padStart(2, '0') + ' min' : '') : min + ' min';
    return (neg ? '-' : '') + s;
  }

  CS.Missions = {
    mulberry32, DEADLINE_H, DEADLINE_MIN_H, GRACE_FRAC, GRACE_MIN_H, LATE_RATE, PENALTY_FRAC, REP, TIERS, JOB, CLIENTS, DONE_KEEP,
    deadlineFor, graceFor, contractValue, penaltyFor, newMission, missionPhase, missionState, settle, expire, hoursNeeded,
    tierOf, tierName, repApply,
    yieldPerBatch, windowFor, genJob, validJob, newJobs, tickBoard, acceptJob, dropJob, expireJobs, qualifying, qualifyingKg, applyBins, jobHours, jobPrice,
    newState, serialize, deserialize, fmtH
  };

  /* ======================= page integration (needs CS.app) ======================= */
  function start() {
    const API = CS.app; if (!API || API.missionsStarted) return; API.missionsStarted = true;
    const hasDom = typeof document !== 'undefined' && !!document.body;
    let st = newState(); const rng = mulberry32(0); let seeded = false;
    let panel = null, els = null, lastKey = -1, armed = null;
    const S = function () { return API.S; };
    const clockH = function () { return (API.S ? API.S.clock || 0 : 0) / 3600; };
    const log = function (msg, cls) { if (typeof API.log === 'function') API.log(msg, cls); };
    const money = function (x) { return typeof API.fmtMoney === 'function' ? API.fmtMoney(x) : '$' + Math.round(x); };
    const num = function (x, d) { return typeof API.fmtNum === 'function' ? API.fmtNum(x, d) : String(Math.round(x * 10) / 10); };
    const esc = function (s) { return typeof API.esc === 'function' ? API.esc(s) : String(s); };
    const contract = function () { return typeof API.contract === 'function' ? API.contract() : null; };
    const contractById = function (id) { return CS.Score ? CS.Score.CONTRACTS.find(function (c) { return c.id === id; }) || null : null; };
    const bins = function () { return typeof API.binList === 'function' ? API.binList() : []; };
    const headRate = function () { const s = S(); if (!s) return 0; return s.run ? s.run.rate : (s.mr ? s.mr.R : 0); };
    const spot = function (mat) { return MATERIALS[mat].sell * (CS.Sim && CS.Sim.prices ? CS.Sim.prices.market : 1); };
    const withdraw = function () { const L = CS.Inventory && CS.Inventory.live; return L && typeof L.withdraw === 'function' ? L.withdraw : null; };
    const feeds = function () { const s = S(); const out = []; for (const id in FEEDS) if (!FEEDS[id].unlock || (s && s.suppliers && s.suppliers.has(id))) out.push(id); return out; };
    const limit = function () { return typeof API.plantValue === 'function' ? API.plantValue('logistics') : 30; };
    const genOpts = function () { return { feeds: feeds(), limit: limit(), rep: st.rep }; };
    /* a penalty is owed whatever the balance, so this mirrors API.spend without its refusal: the bank can go negative */
    function deduct(amount, what, cls) { const s = S(); if (!s || !(amount > 0)) return; s.money -= amount; log(what + ' ' + money(amount) + ' deducted from the bank.', cls || 'bad'); }
    function credit(amount) { const s = S(); if (!s || !(amount > 0)) return; s.money += amount; s.lifetime = (s.lifetime || 0) + amount; }
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
    CS.Missions.live = { rep: function () { return st.rep; }, jobs: function () { return st.jobs; }, render: function () { render(); } };

    /* ---- the mission follows S.contract: accepting starts the clock, releasing ends it ---- */
    function sync() {
      const s = S(); if (!s) return false;
      const id = s.contract || null, m = st.mission;
      if (m && m.id === id) return false;
      let changed = false;
      if (m) {   // released (or swapped): an undelivered mission past its deadline is a failure, before it costs nothing
        const C = contractById(m.id);
        if (m.state === 'accepted' && clockH() > m.deadlineH) {
          m.state = 'failed'; m.penalty = penaltyFor(C);
          deduct(m.penalty, 'Contract ' + (C ? C.name : m.id) + ' released after its deadline: liquidated damages of');
          rep(REP.contractFail, 'contract released late');
        }
        st.last = m; st.mission = null; changed = true;
      }
      if (id) {
        const C = contractById(id);
        if (C) {
          st.mission = newMission(C, clockH()); changed = true;
          log('Mission clock started: ' + C.name + ' is due in ' + fmtH(st.mission.windowH) + ' of plant time (grace ' + fmtH(st.mission.graceH) + ', then the client cancels). Late delivery pays ' + Math.round(LATE_RATE * 100) + '%.', 'ok');
        }
      }
      return changed;
    }
    /* the clock moved: deadlines, grace periods, job windows and the job board */
    function advance(dh) {
      const h = clockH(); let changed = false;
      const m = st.mission;
      if (m) {
        const C = contractById(m.id), pen = expire(m, C, h);
        if (pen > 0) { deduct(pen, 'Contract ' + (C ? C.name : m.id) + ' cancelled by the client: deadline and grace period missed. Liquidated damages of'); rep(REP.contractFail, 'contract cancelled'); changed = true; }
      }
      expireJobs(st.jobs, h).forEach(function (j) { log('Job #' + j.id + ' failed: ' + j.client + ' needed ' + num(j.tons, 1) + ' t of ' + MATERIALS[j.mat].name.toLowerCase() + ' and got ' + num(j.t, 1) + ' t before the window closed.', 'bad'); rep(REP.jobFail, 'job failed'); changed = true; });
      if (tickBoard(st.jobs, rng, h, dh, genOpts())) changed = true;
      return changed;
    }

    /* ---- job actions ---- */
    function accept(id) {
      const r = acceptJob(st.jobs, id, clockH(), st.rep);
      if (!r.ok) { if (CS.Audio) CS.Audio.ui('deny'); log(r.why, 'warn'); return; }
      const j = r.job;
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
      panel.appendChild(API.el('h3', null, 'Contract mission'));
      const mb = API.el('div'); mb.id = 'mission-box'; panel.appendChild(mb);
      const jh = API.el('h3', null, 'Job board '); jh.appendChild(API.el('span', 'small', 'large lots, paid above spot')); panel.appendChild(jh);
      const jb = API.el('div'); jb.id = 'jobs'; panel.appendChild(jb);
      panel.appendChild(API.el('div', 'small', 'The mission clock runs only while a batch runs: a window is a budget of plant time. A job counts every product bin that meets its purity, from any batch, and pays its premium over spot on delivery; the bales still sell at spot from inventory.'));
      const css = document.createElement('style');
      css.textContent = '#missions-panel .ask{color:var(--amber);font-family:var(--mono);white-space:nowrap}#missions-panel .crow.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}#missions-panel .crow.locked{opacity:.55}' +
        '#missions-panel .jbar{display:flex;height:5px;border-radius:3px;overflow:hidden;margin:4px 0 2px;background:var(--line)}#missions-panel .jbar i{display:block;height:100%;background:var(--green)}' +
        '#missions-panel .mrow{font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);display:flex;justify-content:space-between;gap:8px}#missions-panel .mrow span:first-child{color:var(--muted);letter-spacing:1px;font-size:10px}' +
        '.mission-cd{font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--cyan)}.mission-cd.late{color:var(--amber)}.mission-cd.bad{color:var(--red)}.mission-cd.ok{color:var(--green)}';
      panel.appendChild(css);
      els = { ro: ro, mb: mb, jb: jb, tag: panel.querySelector('h2 .tag') };
    }
    function phaseText(m, h) {
      const p = missionPhase(m, h);
      if (p.phase === 'ontime') return { txt: fmtH(p.leftH) + ' LEFT', cls: p.leftH < 0.25 * m.windowH ? 'late' : 'ok' };
      if (p.phase === 'late') return { txt: 'LATE BY ' + fmtH(p.lateH) + ' · PAYS ' + Math.round(LATE_RATE * 100) + '% · GRACE ' + fmtH(m.deadlineH + m.graceH - h), cls: 'late' };
      if (p.phase === 'overdue') return { txt: 'OVERDUE · CANCELLING', cls: 'bad' };
      return { txt: 'FAILED · LD ' + money(m.penalty) + ' PAID', cls: 'bad' };
    }
    /* countdown in the app's contract rows: the rows are rebuilt in CONTRACTS order on every full render */
    function renderRows() {
      if (!hasDom || !CS.Score) return;
      const rows = document.querySelectorAll('#contracts .crow'); if (!rows.length) return;
      const h = clockH(), m = st.mission;
      CS.Score.CONTRACTS.forEach(function (C, i) {
        const row = rows[i]; if (!row) return;
        let cd = row.querySelector('.mission-cd');
        if (!cd) { cd = API.el('div', 'cd mission-cd', ''); const btn = row.querySelector('button'); if (btn) row.insertBefore(cd, btn); else row.appendChild(cd); }
        if (m && m.id === C.id) {
          const t = phaseText(m, h);
          cd.className = 'cd mission-cd ' + t.cls;
          cd.textContent = (m.state === 'delivered' ? 'DELIVERED ' + (m.late ? 'LATE' : 'ON TIME') + ' · ' : missionState(m, !!S().run).toUpperCase() + ' · ') + t.txt;
        } else { cd.className = 'cd mission-cd'; cd.textContent = 'WINDOW ' + fmtH(deadlineFor(C)) + ' OF PLANT TIME · LD ' + money(penaltyFor(C)) + ' IF MISSED'; }
      });
    }
    function render() {
      if (!els) return;
      const s = S(), h = clockH(), m = st.mission, C = contract(), R = headRate(), bl = bins();
      const tier = tierOf(st.rep);
      els.tag.textContent = st.jobs.active.length + ' JOB' + (st.jobs.active.length === 1 ? '' : 'S') + ' · ' + st.jobs.board.length + ' OPEN';
      let cd = { txt: 'NONE', cls: '' };
      if (m) { const t = phaseText(m, h); cd = { txt: t.txt, cls: t.cls === 'ok' ? 'good' : t.cls === 'late' ? 'hi' : 'bad' }; }
      els.ro.innerHTML = API.ro('REPUTATION', Math.round(st.rep), tierName(st.rep).toUpperCase(), tier >= 2 ? 'good' : '') + API.ro('MISSION CLOCK', cd.txt, '', cd.cls);
      // contract mission block
      els.mb.innerHTML = '';
      const row = function (k, v, cls) { els.mb.appendChild(API.el('div', 'mrow', '<span>' + k + '</span><span class="' + (cls || '') + '">' + v + '</span>')); };
      if (!m || !C) {
        els.mb.appendChild(API.el('div', 'small', 'No contract accepted. Each contract shows its delivery window; the clock starts when you accept.' + (st.last ? ' Last: ' + esc((contractById(st.last.id) || { name: st.last.id }).name) + ' ' + st.last.state + (st.last.late ? ' (late)' : '') + '.' : '')));
      } else {
        const state = missionState(m, !!s.run), t = phaseText(m, h);
        row('STATE', esc(state.toUpperCase()) + (m.deliveries ? ' · ' + m.deliveries + ' DELIVER' + (m.deliveries === 1 ? 'Y' : 'IES') + (m.late ? ', ' + m.late + ' LATE' : '') : '') + (m.attempts ? ' · ' + m.attempts + ' RUN' + (m.attempts === 1 ? '' : 'S') : ''), state === 'failed' ? 'bad' : state === 'delivered' ? 'ok' : '');
        row('DEADLINE', 'T+' + fmtH(m.deadlineH) + ' · ' + esc(t.txt), t.cls === 'ok' ? 'ok' : t.cls === 'late' ? 'warn' : 'bad');
        const tons = s.run ? Math.max(0, s.run.total - s.run.done) : s.tons, need = hoursNeeded(tons, R), left = m.deadlineH - h;
        const fits = isFinite(need) && need <= left;
        row('PROJECTION', (R > 0 ? num(tons, 1) + ' t at ' + num(R, 1) + ' t/h = ' + fmtH(need) : 'line cannot run') + ' vs ' + fmtH(left) + ' left', fits ? 'ok' : 'bad');
        if (!fits && m.state === 'accepted') els.mb.appendChild(API.el('div', 'small', R > 0 ? 'This run will finish after the deadline: a faster line (upgrade the bottleneck) or a smaller batch keeps it on time.' : 'Fix the line first: nothing flows.'));
        row('IF MISSED', 'pays ' + Math.round(LATE_RATE * 100) + '% late · LD ' + money(penaltyFor(C)) + ' on cancel', '');
      }
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
      if (!st.jobs.board.length && !st.jobs.active.length) els.jb.appendChild(API.el('div', 'empty', 'No jobs on the board.'));
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
      renderRows();
    }

    /* ---- hooks ---- */
    API.on('boot', function () {
      if (!seeded) { rng.setState((Math.floor(clockH() * 60) + 0x5eed) >>> 0); seeded = true; }   // first ever boot: seed from the clock, then the saved state carries the stream
      sync(); tickBoard(st.jobs, rng, clockH(), 0, genOpts());
      build(); render();
    });
    API.on('render', function () { sync(); render(); });
    API.on('batchStart', function () { render(); });
    API.on('tick', function (p) {
      if (!p || !(p.dh > 0)) return;
      const changed = advance(p.dh);
      const key = Math.floor(clockH() * 12);   // every five sim minutes the countdowns move
      if (changed || key !== lastKey) { lastKey = key; render(); if (changed && typeof API.renderBank === 'function') API.renderBank(); }
    });
    API.on('batchComplete', function (p) {
      if (!p || !p.r) return;
      const h = clockH(), m = st.mission;
      if (p.cs && p.cs.C && m && m.id === p.cs.C.id) {
        const C = p.cs.C, r = settle(m, p.cs, h);
        if (r.delivered) {
          if (r.deduction > 0) { deduct(r.deduction, 'Contract ' + C.name + ' delivered ' + fmtH(h - m.deadlineH) + ' late: it pays ' + Math.round(LATE_RATE * 100) + '% of the fee, so', 'warn'); const s = S(); if (s) s.lifetime = Math.max(0, (s.lifetime || 0) - r.deduction); }
          else log('Contract ' + C.name + ' delivered on time with ' + fmtH(m.deadlineH - h) + ' to spare.', 'ok');
          if (r.first) rep(r.late ? REP.contractLate : REP.contractOnTime, r.late ? 'late delivery' : 'on-time delivery');
        } else {
          const ph = missionPhase(m, h);
          log('Contract ' + C.name + ': run ' + m.attempts + ' did not ship. ' + (ph.phase === 'ontime' ? fmtH(ph.leftH) + ' of the window left.' : ph.phase === 'late' ? 'Past the deadline: the next delivery pays ' + Math.round(LATE_RATE * 100) + '%.' : 'The client has cancelled.'), 'warn');
        }
      }
      const dl = applyBins(st.jobs, p.bins, p.r.done, spot, withdraw());
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
