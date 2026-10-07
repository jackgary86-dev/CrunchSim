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
    const purity = Math.round(Math.max(PURE_MIN, uni(rng, pr[0], pr[1])) * 100) / 100;   // a bin under PURE_MIN is MISC and never ships (#216), so no job asks for less
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
      acceptedH: j.acceptedH != null && isFinite(+j.acceptedH) ? +j.acceptedH : null, deadlineH: j.deadlineH != null && isFinite(+j.deadlineH) ? +j.deadlineH : null };
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
    const whole = Math.floor(h), min = Math.round((h - whole) * 60);
    const s = whole >= 1 ? whole + ' h' + (min ? ' ' + String(min).padStart(2, '0') + ' min' : '') : min + ' min';
    return (neg ? '-' : '') + s;
  }

  CS.Missions = {
    mulberry32, REP, TIERS, JOB, CLIENTS, DONE_KEEP,
    hoursNeeded,
    tierOf, tierName, repApply,
    yieldPerBatch, windowFor, genJob, validJob, newJobs, tickBoard, acceptJob, dropJob, expireJobs, qualifying, qualifyingKg, applyBins, jobHours, jobPrice,
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
    const genOpts = function () { return { feeds: feeds(), limit: limit(), rep: st.rep }; };
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
    CS.Missions.live = { rep: function () { return st.rep; }, jobs: function () { return st.jobs; }, render: function () { render(); } };

    /* the clock moved: deadlines, grace periods, job windows and the job board */
    function advance(dh) {
      const h = clockH(); let changed = false;
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
      const jh = API.el('h3', null, 'Job board '); jh.appendChild(API.el('span', 'small', 'large lots, paid above spot')); panel.appendChild(jh);
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
      els.ro.innerHTML = API.ro('REPUTATION', Math.round(st.rep), tierName(st.rep).toUpperCase(), tier >= 2 ? 'good' : '') + API.ro('ACTIVE JOBS', st.jobs.active.length + ' / ' + JOB.maxActive, '');
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
    }

    /* ---- hooks ---- */
    API.on('boot', function () {
      if (!seeded) { rng.setState((Math.floor(clockH() * 60) + 0x5eed) >>> 0); seeded = true; }   // first ever boot: seed from the clock, then the saved state carries the stream
      tickBoard(st.jobs, rng, clockH(), 0, genOpts());
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
