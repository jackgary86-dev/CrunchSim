/* CrunchSim module: layout. A calm main screen built from the operator's sketch.
 *
 * Main screen: the Feed panel on the left; on the right the plant as four sections divided by vertical lines: three
 * machines in the order they were placed (arrows page through longer lines) and, always last, the end result in buckets.
 * Every bucket can be sold, or re-run as the next batch's feed. Material that is not yet separated (held at under 60%
 * purity) collects in a MISC bucket, to be re-run through different machines.
 * Everything else lives behind toolbar buttons that open it in a drawer with a CLOSE button. Clicking a machine sits you
 * down at its station: the machine cam, its settings and its telemetry, also with a CLOSE button.
 * Panels are moved, never rebuilt, so every module keeps rendering into its own section while it is out of view.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;

  /* ================= pure logic (no DOM; tested in Node by tests/layout.js) ================= */
  const SORTED = 0.6;   // held stock at 60% or better has been sorted out: its own end bucket; below that it goes to MISC
                        // (inventory merges each material across bins, so stray bits lower the figure)
  /* held stock -> sorted buckets (one per material, in material order) and one MISC bucket for the rest */
  function splitBuckets(stock, order, min) {
    const lim = min == null ? SORTED : min, clean = [], misc = { t: 0, comp: {} };
    (order || Object.keys(stock || {})).forEach((m) => {
      const e = stock && stock[m]; if (!e || !(e.t > 0.05)) return;
      if ((e.purity || 0) >= lim) clean.push({ m, t: e.t, purity: e.purity, grade: e.grade, sf: e.sf });
      else { misc.t += e.t; misc.comp[m] = e.t; }
    });
    return { clean, misc };
  }
  /* what RE-RUN would load: the bucket's blend as fractions, and whole tonnes capped by the batch limit and the stock */
  function rerunPlan(stock, mats, cap) {
    const comp = {}, sizes = {}; let tot = 0;
    mats.forEach((m) => { const e = stock && stock[m], t = e ? e.t : 0; if (t > 0) { comp[m] = t; tot += t; if (e.p80 > 0) sizes[m] = e.p80; } });
    if (tot < 1) return { error: 'small', tot };
    for (const m in comp) comp[m] /= tot;
    return { comp, sizes, tot, tons: Math.max(1, Math.min(Math.floor(tot), cap)) };   // sizes: the recorded p80 of each material (#41)
  }
  /* where a re-run bucket goes in: the first station that is not a shredder or crusher; null (the head feed, station 1)
   * when that is station 1 or the line is all size reduction (#42) */
  function defaultEntry(line, machines) {
    const k = line.findIndex((n) => machines[n.m] && machines[n.m].kind !== 'comminution');
    return k > 0 ? line[k].uid : null;
  }
  /* one station's work on a batch of `tons`: the bins it fills (its unconnected outputs) and what moves on to which
   * stations (1-based placement numbers) */
  function stationFlow(ev, line, tons, uid) {
    const { Sim, MATERIALS } = CS;
    if (!ev) return { bins: [], next: [] };
    const bins = [], next = [];
    ev.terminals.forEach((t) => {
      if (t.uid !== uid) return;
      const st = Sim.binStats(t.stream.m, t.form); if (!Sim.binMatters(st)) return;
      bins.push({ st, port: t.port, kg: st.total, tons: st.total / 1000 * tons });
    });
    for (const key in ev.ports) {
      const parts = key.split(':'), port = parts[1]; if (Number(parts[0]) !== uid) continue;
      const users = line.filter((x) => x.src && x.src !== 'feed' && x.src.uid === uid && x.src.port === port);
      if (!users.length) continue;
      const kg = Sim.streamMass(ev.ports[key]);
      const st = Sim.binStats(ev.ports[key].m); if (!Sim.binMatters(st)) continue;
      next.push({ port, kg, tons: kg / 1000 * tons, to: users.map((x) => line.indexOf(x) + 1), mats: topMats(st, 2).map((m) => MATERIALS[m].name.toLowerCase()) });
    }
    bins.sort((a, b) => b.tons - a.tons);
    return { bins, next };
  }
  CS.Layout = { SORTED, splitBuckets, rerunPlan, defaultEntry, stationFlow, topMats };
  if (typeof document === 'undefined') return;
  const { MACHINES, MATERIALS, MAT_ORDER, FEEDS, Sim } = CS;

  const DRAWERS = [
    ['flowsheet', 'Flowsheet', ['line-panel', 'blueprint-panel', 'playbook-panel']],
    ['auction', 'Auction', ['auction-panel', 'intake-panel']],
    ['sales', 'Market', ['inventory-panel', 'market-panel']],
    ['jobs', 'Contracts & jobs', ['contract-panel', 'missions-panel']],
    ['bank', 'Bank & upgrades', ['bank-panel', 'facility-panel']],
    ['rivals', 'Rivals', ['rivals-panel']],
    ['report', 'Plant report', ['plant-panel']],
    ['log', 'Event log', ['log-panel']]
  ];
  const MACHINE_COLS = 3;          // three machine sections, then the buckets section
  const CLEAN = 0.9;               // a station bin at 90% purity or better is a straight grade (drawn green)
  let app = null, offset = 0, openDrawer = null, stationOpen = false, lastSig = '';
  const $ = (s) => document.querySelector(s);
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  /* tonnes, kilograms or grams: a batch's gold is a few hundred grams (#53) */
  function fmtW(t) { return t >= 0.95 ? t.toFixed(1) + ' t' : t >= 0.001 ? Math.round(t * 1000) + ' kg' : Math.max(0, Math.round(t * 1e6)) + ' g'; }
  function fmtSz(mm) { return mm >= 1 ? mm.toFixed(mm >= 100 ? 0 : 1) + ' mm' : Math.round(mm * 1000) + ' µm'; }

  /* ---------------- frame ---------------- */
  function build() {
    document.body.classList.add('lay');
    const appEl = $('#app');
    const bar = el('nav', null); bar.id = 'toolbar';
    DRAWERS.forEach(([key, label]) => {
      const b = el('button', 'tool', esc(label)); b.type = 'button'; b.id = 'tool-' + key; b.dataset.key = key;
      b.addEventListener('click', () => (openDrawer === key ? closeDrawer() : showDrawer(key)));
      bar.appendChild(b);
    });
    appEl.insertBefore(bar, $('#left'));
    const plant = el('section', 'panel'); plant.id = 'flow-panel';
    plant.innerHTML = '<h2>Plant <span class="tag" id="flow-count"></span></h2><div id="flow-feed" class="flow-feed"></div>' +
      '<div class="flow"><button type="button" class="flow-nav" id="flow-prev" aria-label="Earlier machines">&lsaquo;</button><div id="flow-nodes"></div><button type="button" class="flow-nav" id="flow-next" aria-label="Later machines">&rsaquo;</button></div>' +
      '<div class="small flow-hint">Machines run left to right in the order you placed them. Click one to sit at its station and tune it.</div>';
    const center = $('#center');
    center.insertBefore(plant, center.firstChild);
    $('#flow-prev').addEventListener('click', () => { offset = Math.max(0, offset - 1); renderFlow(true); });
    $('#flow-next').addEventListener('click', () => { offset += 1; renderFlow(true); });
    const drawer = el('div', 'overlay hidden'); drawer.id = 'drawer';
    drawer.innerHTML = '<div class="sheet"><div class="sheet-h"><b id="drawer-title"></b><button type="button" class="danger" id="drawer-close">CLOSE</button></div><div class="sheet-b" id="drawer-body"></div></div>';
    document.body.appendChild(drawer);
    const station = el('div', 'overlay hidden'); station.id = 'station';
    station.innerHTML = '<div class="sheet wide"><div class="sheet-h"><b id="station-title">Station</b><button type="button" class="danger" id="station-close">CLOSE</button></div><div class="sheet-b station-b"><div class="st-main"></div><div class="st-side"></div></div></div>';
    document.body.appendChild(station);
    station.querySelector('.st-main').appendChild($('#cam-wrap'));
    station.querySelector('.st-main').appendChild($('#machine-panel'));
    station.querySelector('.st-side').appendChild($('#tele-panel'));
    document.body.appendChild($('#scorecard'));   // the score card must show without the station open
    const stash = el('div', 'hidden'); stash.id = 'stash'; document.body.appendChild(stash);
    DRAWERS.forEach(([, , ids]) => ids.forEach((id) => { const s = document.getElementById(id); if (s) stash.appendChild(s); }));
    drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
    station.addEventListener('click', (e) => { if (e.target === station) closeStation(); });
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#station-close').addEventListener('click', closeStation);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeStation(); } });
  }
  function showDrawer(key) {
    closeStation(); closeDrawer();
    const d = DRAWERS.find((x) => x[0] === key); if (!d) return;
    const body = $('#drawer-body');
    d[2].forEach((id) => { const s = document.getElementById(id); if (s) body.appendChild(s); });
    $('#drawer-title').textContent = d[1].toUpperCase();
    $('#drawer').classList.remove('hidden'); openDrawer = key;
    document.querySelectorAll('#toolbar .tool').forEach((b) => b.classList.toggle('on', b.dataset.key === key));
    app.renderAll();
  }
  function closeDrawer() {
    if (!openDrawer) return;
    const body = $('#drawer-body'), stash = $('#stash');
    while (body.firstChild) stash.appendChild(body.firstChild);
    $('#drawer').classList.add('hidden'); openDrawer = null;
    document.querySelectorAll('#toolbar .tool').forEach((b) => b.classList.remove('on'));
  }
  function showStation(uid) {
    closeDrawer();
    app.S.sel = uid; stationOpen = true;
    $('#station').classList.remove('hidden');
    const n = app.node(uid); $('#station-title').textContent = n ? 'STATION · ' + MACHINES[n.m].name.toUpperCase() : 'STATION';
    app.renderAll();
    requestAnimationFrame(() => { if (app.cam && app.cam.resize) app.cam.resize(); });
  }
  function closeStation() { if (!stationOpen) return; $('#station').classList.add('hidden'); stationOpen = false; renderFlow(true); }

  /* ---------------- live machine cams (the station cam's own scenes, small and cropped onto the machine) ---------------- */
  const minis = new Map();   // uid -> { cv, cam }
  const VIEW = null;   // the whole scene: every separator draws its own drop bins at the sides
  function miniFor(uid) {
    let m = minis.get(uid);
    if (!m && CS.Cam) {
      const cv = el('canvas', 'fn-cam'); cv.setAttribute('aria-hidden', 'true');
      const cam = new CS.Cam(cv); cam.view = VIEW;
      m = { cv, cam }; minis.set(uid, m);
    }
    return m;
  }
  let lastT = 0;
  function miniLoop(now) {
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016; lastT = now;
    if (!stationOpen && !openDrawer && !document.hidden && app && app.S) {
      minis.forEach((m, uid) => {
        if (!m.cv.isConnected) return;
        const r = m.cv.getBoundingClientRect();
        if (Math.abs(r.width - m.cam.W) > 1 || Math.abs(r.height - m.cam.H) > 1) m.cam.resize();
        const st = app.camState(uid); if (!st) return;
        m.cam.setState(st); m.cam.frame(dt);
      });
    }
    requestAnimationFrame(miniLoop);
  }
  function pruneMinis() { const live = new Set(app.S.line.map((n) => n.uid)); minis.forEach((m, uid) => { if (!live.has(uid)) minis.delete(uid); }); }

  /* ---------------- what each station does with the material ---------------- */
  const PORT_NAME = { extract: 'pulled out', residue: 'rest', product: 'product', fines: 'fines', oversize: 'oversize', melt: 'melt', dross: 'dross' };
  function mainMat(st) { let best = null, bm = 0; for (const m in st.perMat) if (st.perMat[m].mass > bm) { bm = st.perMat[m].mass; best = m; } return best; }
  function topMats(st, k) { return Object.keys(st.perMat).sort((a, b) => st.perMat[b].mass - st.perMat[a].mass).slice(0, k); }
  /* one bin graphic: an open-top bin filled to its share of the batch, striped by the top materials in it */
  function binHtml(st, tons, port, verdict) {
    const mm = mainMat(st), D = mm ? MATERIALS[mm] : null, tops = topMats(st, 3);
    let bands = '', acc = 0;
    tops.forEach((m) => { const f = st.perMat[m].mass / st.total; bands += '<i style="flex:' + f.toFixed(3) + ';background:' + MATERIALS[m].color + '"></i>'; acc += f; });
    if (acc < 0.999) bands += '<i style="flex:' + (1 - acc).toFixed(3) + ';background:#5a6573"></i>';
    const pure = st.sellable != null ? st.sellable : st.share >= CLEAN;
    return '<div class="fbin' + (pure ? ' pure' : '') + '" title="' + esc((PORT_NAME[port] || port) + ': ' + tops.map((m) => MATERIALS[m].name + ' ' + Math.round(100 * st.perMat[m].mass / st.total) + '%').join(', ')) + '">' +
      '<div class="fbin-box"><div class="fbin-fill">' + bands + '</div></div>' +
      '<div class="fbin-t"><b>' + esc(D ? (st.form === 'ingot' ? D.name + ' ingots' : D.name) : 'mixed') + '</b><span>' + Math.round(st.share * 100) + '% · ' + fmtW(tons) + '</span>' + (verdict || (pure ? '<em class="ship ok">SELLS</em>' : '<em class="ship bad" title="Mixed: under 90% of one material. It cannot be sold; it goes to the MISC bucket to re-run.">TO MISC</em>')) + '</div></div>';
  }
  /* ---------------- contract on the plant screen (#47) ---------------- */
  let spec = null;   // Score.evalContract for the active contract, refreshed each plant render
  function contractSpec() {
    const S = app.S, C = app.contract && app.contract(); if (!C || !app.Score) return null;
    const cs = app.Score.evalContract(C, S.line, S.run ? { kwh: S.run.kwh, done: S.run.done } : null); cs.C = C;
    return cs;
  }
  /* a station bin that holds the contract's target material either ships or is off spec, and says why */
  function binVerdict(key) {
    if (!spec) return '';
    const b = spec.bins.find((x) => x.key === key); if (!b || !(b.st.total > 0.5) || !(b.tMass / b.st.total > 0.02)) return '';
    const C = spec.C;
    if (b.shippable) return '<em class="ship ok">SHIPS</em>';
    let why = '';
    if (b.purity < C.purityMin) why = Math.round(b.purity * 100) + '% pure, needs ' + Math.round(C.purityMin * 100) + '%';
    else if (b.p80 > C.p80[1]) why = 'P80 ' + app.Score.fmtMm(b.p80) + ', max ' + app.Score.fmtMm(C.p80[1]);
    else if (b.p80 < C.p80[0]) why = 'P80 ' + app.Score.fmtMm(b.p80) + ', min ' + app.Score.fmtMm(C.p80[0]);
    return '<em class="ship bad" title="Off spec: this bin stays home">OFF-SPEC · ' + esc(why) + '</em>';
  }
  function contractStrip() {
    if (!spec) return null;
    const C = spec.C, d = el('div', 'flow-contract');
    const lim = C.label + ' ≥ ' + Math.round(C.purityMin * 100) + '% pure · P80 ' + (C.p80[0] > 0 ? app.Score.fmtMm(C.p80[0]) + '–' : '≤ ') + app.Score.fmtMm(C.p80[1]) + ' · ≤ ' + C.kwhCap + ' kWh/t · recovery ≥ ' + Math.round(C.recMin * 100) + '%';
    d.innerHTML = 'CONTRACT &#9654; <b>' + esc(C.name) + '</b> for ' + esc(C.client) + ' · ' + esc(lim) +
      '<span class="cs-res"> · projected <span class="stars' + (spec.stars ? ' got' : '') + '">' + app.starsText(spec.stars) + '</span> · fee ' + app.fmtMoney(spec.fee) + ' · ' + esc(spec.reason) + '</span>';
    return d;
  }

  /* ---------------- where the feed comes from (#46) ---------------- */
  function feedSource() {
    const S = app.S, C = app.contract && app.contract();
    if (C) return { name: C.client + ' feed · ' + (FEEDS[C.feed] ? FEEDS[C.feed].name : 'client material'), note: 'supplied by the client' };
    if (loaded) return { name: 'Re-run: ' + loaded.label + ' bucket', note: 'already yours' };
    const A = CS.Auction && CS.Auction.live, P = A && A.pending ? A.pending() : null;
    if (P && S.feedPrepaid && P.truth && CS.Auction.sameComp(S.comp, P.truth)) return { name: 'Auction lot #' + P.id + (P.headline ? ' · ' + P.headline : ''), sub: P.seller ? 'from ' + P.seller : '', note: 'paid at auction' };
    const I = CS.Intake && CS.Intake.live, pile = I && I.loaded ? I.loaded() : null;
    if (pile && S.feedPrepaid) return { name: pile.name + ' stockpile', sub: Math.round(pile.t) + ' t on the pile', note: 'prepaid' };
    return null;
  }

  /* ---------------- sections ---------------- */
  function machineCol(n, i) {
    const M = MACHINES[n.m], inf = app.info(n.uid), S = app.S, owned = app.nodeOwned ? app.nodeOwned(n) : true;
    const col = el('div', 'fcol mach' + (owned ? '' : ' unowned'));
    col.tabIndex = 0; col.setAttribute('role', 'button'); col.setAttribute('aria-label', 'Open the ' + M.name + ' station');
    let status = '', warn = '';
    if (inf) {
      const R = S.run ? S.run.rate : (S.mr ? S.mr.R : 0);
      if (inf.kind === 'separator') status = Math.round(100 * Sim.streamMass(S.ev.ports[n.uid + ':extract']) / Math.max(inf.inKg, 1e-9)) + '% pulled out';
      else if (inf.kind === 'comminution') status = 'shreds to ' + fmtSz(inf.P80);
      else status = M.cat.toLowerCase();
      status += ' · ' + (R * inf.flowAcc).toFixed(1) + ' t/h';
      const bad = inf.warnings.filter((w) => w.level === 'bad').length, wn = inf.warnings.filter((w) => w.level === 'warn').length;
      if (bad) warn = '<div class="fn-w bad">' + bad + ' fault' + (bad > 1 ? 's' : '') + '</div>'; else if (wn) warn = '<div class="fn-w warn">' + wn + ' warning' + (wn > 1 ? 's' : '') + '</div>';
    }
    const lim = S.mr && S.mr.limiter && S.mr.limiter.uid === n.uid ? S.mr.limiter : null;
    if (lim && inf && inf.inKg > 1e-6) warn += '<div class="fn-w neck" title="This station sets the rate of the whole line. Level it up or service it at its station, or add a second unit.">BOTTLENECK · ' + esc(lim.why) + (S.mr.R > 0 ? ' · ' + S.mr.R.toFixed(1) + ' t/h' : '') + '</div>';
    if (!owned) warn = '<div class="fn-w bad">not owned · buy it at its station</div>';
    const entry = S.feedOpts && S.feedOpts.entry != null ? S.feedOpts.entry : null;
    const skipped = entry != null && n.uid !== entry && inf && !(inf.inKg > 1e-6);   // ahead of a re-run's entry station (#42)
    if (skipped) { col.classList.add('skipped'); status = 'skipped this batch'; warn = ''; }
    const head = n.uid === entry ? '&#9654; ENTRY · STATION ' + (i + 1) : 'STATION ' + (i + 1) + (skipped ? ' · SKIPPED' : '');
    col.innerHTML = '<div class="fn-k' + (n.uid === entry ? ' entry' : '') + '">' + head + '</div><div class="fn-camwrap"></div><div class="fn-n">' + esc(M.name) + '</div><div class="fn-s">' + esc(status) + '</div>' + warn;
    const mini = miniFor(n.uid);
    if (mini) col.querySelector('.fn-camwrap').appendChild(mini.cv);
    const f = stationFlow(S.ev, S.line, S.tons, n.uid);
    const binsBox = el('div', 'fbins');
    binsBox.innerHTML = '<div class="fn-sub">BINS FILLED HERE</div>' + (f.bins.length ? f.bins.map((b) => binHtml(b.st, b.tons, b.port, binVerdict(n.uid + ':' + b.port))).join('') : '<div class="small">None: everything moves on.</div>');
    col.appendChild(binsBox);
    f.next.forEach((x) => {
      const nx = el('div', 'fnext');
      nx.innerHTML = '<span class="fnext-a">&#10140;</span><span><b>' + fmtW(x.tons) + '</b> ' + esc(x.port === 'product' ? 'shred' : 'left over') + ' to station ' + x.to.join(' & ') + '<span class="small"> · mostly ' + esc(x.mats.join(', ')) + '</span></span>';
      col.appendChild(nx);
    });
    const open = () => showStation(n.uid);
    col.addEventListener('click', open);
    col.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return col;
  }
  function addCol() {
    const col = el('div', 'fcol add'); col.tabIndex = 0; col.setAttribute('role', 'button');
    col.innerHTML = '<div class="fn-plus">+</div><div class="fn-s">Add a machine</div>';
    const go = () => showDrawer('flowsheet');
    col.addEventListener('click', go);
    col.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return col;
  }

  /* held stock as buckets: clean materials each get one, everything below CLEAN purity pools into MISC */
  function buckets() {
    const Inv = CS.Inventory, b = splitBuckets(Inv && Inv.stock ? Inv.stock() : {}, MAT_ORDER, 0);
    const misc = Inv && Inv.misc ? Inv.misc() : {};
    b.misc = { t: 0, comp: {} };
    for (const m in misc) if (misc[m].t > 0.05) { b.misc.t += misc[m].t; b.misc.comp[m] = misc[m].t; }
    b.clean.forEach((x) => { x.value = x.t * MATERIALS[x.m].sell * Sim.prices.market * ((Sim.prices.perMat && Sim.prices.perMat[x.m]) || 1) * (x.grade == null ? 1 : x.grade) * (x.sf == null ? 1 : x.sf); });
    return b;
  }
  /* RE-RUN: the bucket becomes the feed, prepaid because the material is already yours. Nothing leaves the bucket until
   * the batch starts, so changing the feed by hand just puts the bucket back. Same pattern as the intake stockpiles. */
  let loaded = null;   // { comp, label } of the bucket currently loaded as the feed
  function sameComp(a, b) {
    a = a || {}; b = b || {};
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6) return false;
    return true;
  }
  function srcMap(src) { const Inv = CS.Inventory; return src === 'misc' ? (Inv.misc ? Inv.misc() : {}) : Inv.stock(); }
  function rerun(mats, label, src) {
    const S = app.S, stock = srcMap(src);
    if (S.run) { app.log('Wait for the batch to finish before loading a bucket.', 'warn'); return; }
    if (app.contract && app.contract()) { app.log('Release the contract first: the client supplies the feed while a contract is active.', 'warn'); return; }
    if (S.feedPrepaid && !loaded) { app.log('A prepaid lot is already loaded as the feed. Run it first, or change the feed by hand to put it back in the yard.', 'warn'); return; }
    const cap = app.plantValue('logistics'), plan = rerunPlan(stock, mats, cap);
    if (plan.error) { app.log('The ' + label + ' bucket holds under 1 t: too little to run a batch. Sell it, or let it fill up.', 'warn'); return; }
    const comp = plan.comp, tot = plan.tot, tons = plan.tons, entry = defaultEntry(S.line, MACHINES);
    const prev = loaded ? loaded.prev : (FEEDS[S.feedPreset] ? { preset: S.feedPreset, tons: S.tons } : null);   // the feed to go back to after the batch
    loaded = null;   // setFeed renders before the flag is set
    app.setFeed(comp, 'custom', tons);
    loaded = { comp: Object.assign({}, S.comp), label, sizes: plan.sizes, entry, prev, src: src || 'stock' };
    S.feedPrepaid = true;
    S.feedOpts = { sizes: plan.sizes, entry };   // it goes in as the shred it already is (#41), past the shredders (#42)
    app.markDirty(true);
    const k = entry == null ? 0 : S.line.findIndex((n) => n.uid === entry);
    offset = Math.max(0, k);   // page the plant screen to the entry station
    app.log('Loaded the ' + label + ' bucket as the feed: ' + tons + ' t per batch, no feed cost, entering at station ' + (k + 1) + '.' + (tot > tons ? ' The rest stays in the bucket (batch limit ' + cap + ' t).' : '') + ' Pick another entry station above the plant if you like, then press RUN BATCH.', 'ok');
    renderFlow(true);
  }
  function setEntry(uid) {
    if (!loaded || app.S.run) return;
    loaded.entry = uid; app.S.feedOpts = { sizes: loaded.sizes, entry: uid };
    app.markDirty(true); renderFlow(true);
  }
  /* drop the loaded bucket when the feed no longer matches it, or another module took the prepaid flag away */
  function guardLoaded() {
    if (!loaded) return;
    const S = app.S, stock = srcMap(loaded.src);
    if (!S.run && S.feedPrepaid && !app.contract() && sameComp(S.comp, loaded.comp)) {
      let have = 0; for (const m in loaded.comp) have += stock[m] ? stock[m].t : 0;   // never run more than the bucket holds
      if (S.tons > have && have >= 1) { S.tons = Math.floor(have); app.syncFeedRows(); }
      return;
    }
    if (S.run) return;
    const label = loaded.label; loaded = null;
    // the flag was ours: app.setFeed renders before another module (auction, intake) sets its own flag, so clearing it here never takes theirs
    S.feedPrepaid = false; S.feedOpts = null;
    app.log('The ' + label + ' bucket is no longer loaded: the feed was changed, so it stays in the bucket and the feed is charged at the normal price.', 'warn');
    app.markDirty();   // the feed cost and projected margin change with the flag
  }
  function onBatchStart(p) {
    if (!loaded) return;
    const S = app.S, Inv = CS.Inventory, l = loaded; loaded = null;
    if (app.contract() || !sameComp(S.comp, l.comp)) { S.feedOpts = null; return; }
    const tons = p && p.run && p.run.total ? p.run.total : S.tons;
    for (const m in l.comp) { if (l.src === 'misc' && Inv.withdrawMisc) Inv.withdrawMisc(m, tons * l.comp[m]); else Inv.withdraw(m, tons * l.comp[m]); }
    rerunActive = l.prev || true;   // the sizes and entry station hold for this batch, then the feed is ordinary again
  }
  let rerunActive = false;
  function onBatchComplete() {
    if (rerunActive) {
      const prev = rerunActive; rerunActive = false; app.S.feedOpts = null;
      // the bucket's blend is not left behind as a feed to buy at the market price: back to the feed you had before
      if (prev.preset && FEEDS[prev.preset] && !app.contract()) { app.applyFeedPreset(prev.preset); if (prev.tons) { app.S.tons = Math.min(prev.tons, app.plantValue('logistics')); app.syncFeedRows(); } }
      app.markDirty(true);
    }
    setTimeout(() => renderFlow(true), 0);
  }
  /* the market's word on a material this round (#44): HOT or COLD with the factor and the reason, else the price trend */
  function marketTag(m) {
    const Mk = CS.Market; if (!Mk || !Mk.state) return '';
    const hot = Mk.hot(), cold = Mk.cold();
    if (hot && hot.mat === m) return '<span class="mk hot" title="' + esc(hot.why) + '">HOT ×' + hot.mul.toFixed(2) + '</span> ';
    if (cold && cold.mat === m) return '<span class="mk cold" title="' + esc(cold.why) + '">COLD ×' + cold.mul.toFixed(2) + '</span> ';
    const v = Mk.view(), t = v.trend[m] || 0, f = v.drift[m] || 1;
    const arrow = t > 0.0005 ? '&#9650;' : t < -0.0005 ? '&#9660;' : '';
    if (!arrow && Math.abs(f - 1) < 0.03) return '';   // a flat, ordinary price: nothing to say
    return '<span class="mk' + (t > 0.0005 ? ' up' : t < -0.0005 ? ' down' : '') + '" title="Market factor this round, and its move since the last round">' + arrow + '×' + f.toFixed(2) + '</span> ';
  }
  function bucketsCol() {
    const col = el('div', 'fcol buckets'), b = buckets(), Inv = CS.Inventory;
    col.appendChild(el('div', 'fn-k', 'END RESULT IN BUCKETS'));
    const list = el('div', 'bk-list');
    if (!b.clean.length && !(b.misc.t > 0)) list.appendChild(el('div', 'small', 'Run a batch: what comes out lands here, ready to sell or run again.'));
    b.clean.forEach((x) => {
      const D = MATERIALS[x.m], row = el('div', 'bk');
      const mk = marketTag(x.m), pay = Inv && Inv.quote ? Inv.quote(x.m) : x.value;
      row.innerHTML = '<span class="bk-sw" style="background:' + D.color + '"></span><span class="bk-t"><b>' + esc(D.name) + '</b><span class="small">' + mk + fmtW(x.t) + ' · ' + Math.round(x.purity * 100) + '% pure</span></span>';
      const sell = el('button', 'buy', 'SELL ' + app.fmtMoney(pay)); sell.type = 'button'; sell.title = 'Sell all ' + fmtW(x.t) + ' now for ' + app.fmtMoney(pay); sell.addEventListener('click', () => { if (Inv && Inv.sellMat) Inv.sellMat(x.m); app.renderAll(); });
      const re = el('button', null, 'RE-RUN'); re.type = 'button'; re.title = 'Load this bucket as the next batch\'s feed'; re.addEventListener('click', () => rerun([x.m], D.name.toLowerCase(), 'stock'));
      row.appendChild(sell); row.appendChild(re); list.appendChild(row);
    });
    if (b.misc.t > 0) {
      const mats = Object.keys(b.misc.comp).sort((p, q) => b.misc.comp[q] - b.misc.comp[p]);
      const row = el('div', 'bk misc');
      row.innerHTML = '<span class="bk-sw misc"></span><span class="bk-t"><b>MISC</b><span class="small">' + fmtW(b.misc.t) + ' not separated yet: ' + esc(mats.slice(0, 3).map((m) => MATERIALS[m].name.toLowerCase() + ' ' + Math.round(100 * b.misc.comp[m] / b.misc.t) + '%').join(', ')) + '</span></span>';
      const re = el('button', 'buy', 'RE-RUN'); re.type = 'button'; re.title = 'Send the mixed material back through the plant'; re.addEventListener('click', () => rerun(mats, 'MISC', 'misc'));
      row.appendChild(re); list.appendChild(row);
    }
    col.appendChild(list);
    return col;
  }

  function renderFlow(force) {
    const S = app.S; if (!S || !$('#flow-nodes')) return;
    const seq = S.line.map((n, i) => ({ n, i })).concat([{ add: true }]);
    offset = Math.max(0, Math.min(offset, Math.max(0, seq.length - MACHINE_COLS)));
    const stock = CS.Inventory && CS.Inventory.stock ? CS.Inventory.stock() : {};
    const sig = JSON.stringify([offset, S.line.map((n) => [n.uid, n.m, n.settings]), S.comp, S.tons, S.feedPreset, S.feedPrepaid, S.feedOpts, S.contract, !!S.run, S.run ? Math.round(S.run.done) : -1, S.money, Object.keys(stock).map((m) => stock[m] && stock[m].t), CS.Inventory && CS.Inventory.misc ? CS.Inventory.miscTotal(CS.Inventory.misc()) : 0]);
    if (!force && sig === lastSig) return; lastSig = sig;
    const F = FEEDS[S.feedPreset], cost = app.feedCostPerT ? app.feedCostPerT() : 0, ff = $('#flow-feed');
    const src = feedSource(), name = src ? src.name : F ? F.name : 'Custom mix';
    ff.innerHTML = 'FEED &#9654; <b>' + esc(name) + '</b>' + (src && src.sub ? ' <span class="small">' + esc(src.sub) + '</span>' : '') + ' · ' + S.tons + ' t · ' + (src ? esc(src.note) : S.feedPrepaid ? 'already yours' : cost < 0 ? 'paid ' + app.fmtMoney(-cost) + '/t to take' : app.fmtMoney(cost) + '/t');
    const entry = S.feedOpts && S.feedOpts.entry != null ? S.feedOpts.entry : null;
    if (loaded && !S.run && S.line.length) {
      // the re-run bucket can go in at any station (#42)
      const lab = el('label', 'flow-entry', ' · enters at ');
      const sel = el('select'); sel.setAttribute('aria-label', 'Station the bucket enters at');
      S.line.forEach((n, k) => { const o = el('option', null, 'station ' + (k + 1) + ' · ' + esc(MACHINES[n.m].name)); o.value = String(n.uid); if (n.uid === (entry == null ? S.line[0].uid : entry)) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', () => { const u = Number(sel.value); setEntry(u === S.line[0].uid ? null : u); });
      lab.appendChild(sel); ff.appendChild(lab);
    } else if (entry != null) {
      const k = S.line.findIndex((n) => n.uid === entry);
      if (k >= 0) ff.appendChild(el('span', null, ' · enters at station ' + (k + 1)));
    }
    spec = contractSpec();
    const old = $('#flow-contract'); if (old) old.remove();
    const strip = contractStrip(); if (strip) { strip.id = 'flow-contract'; ff.after(strip); }
    const box = $('#flow-nodes'); box.innerHTML = '';
    seq.slice(offset, offset + MACHINE_COLS).forEach((x) => box.appendChild(x.add ? addCol() : machineCol(x.n, x.i)));
    for (let k = box.children.length; k < MACHINE_COLS; k++) box.appendChild(el('div', 'fcol empty'));
    box.appendChild(bucketsCol());
    $('#flow-prev').disabled = offset === 0; $('#flow-next').disabled = offset + MACHINE_COLS >= seq.length;
    $('#flow-count').textContent = S.line.length + ' machine' + (S.line.length === 1 ? '' : 's') + (S.line.length > MACHINE_COLS ? ' · showing ' + (offset + 1) + '-' + Math.min(S.line.length, offset + MACHINE_COLS) : '');
  }

  function init() {
    app = CS.app; if (!app || app.layoutStarted) return; app.layoutStarted = true;
    app.on('boot', () => {
      build(); renderFlow(true); requestAnimationFrame(miniLoop);
      // hand edits on the feed panel only do a light refresh (no render event): check the loaded bucket right after them,
      // and again just before RUN BATCH prices the feed
      const fp = $('#feed-panel'), chk = () => setTimeout(() => { guardLoaded(); renderFlow(false); }, 0);
      if (fp) { fp.addEventListener('input', chk); fp.addEventListener('change', chk); }
      document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#btn-run')) guardLoaded(); }, true);
    });
    app.on('batchStart', onBatchStart);
    app.on('render', () => { guardLoaded(); pruneMinis(); renderFlow(false); if (stationOpen && !app.node(app.S.sel)) closeStation(); });
    app.on('batchComplete', onBatchComplete);
    // a loaded bucket survives a reload: it is restored as the prepaid feed while the feed panel still shows its blend
    app.on('save', () => ({ layout: { loaded, rerunActive } }));
    const restore = (ext) => {
      const d = ext && ext.layout, S = app.S; loaded = null; rerunActive = false;
      if (!d || !S) return;
      if (d.loaded && !S.run && !S.contract && sameComp(S.comp, d.loaded.comp)) {
        loaded = d.loaded; S.feedPrepaid = true; S.feedOpts = { sizes: loaded.sizes || {}, entry: loaded.entry == null ? null : loaded.entry };
      } else if (d.rerunActive && S.feedOpts) S.feedOpts = null;
    };
    app.on('load', restore);
    let acc = 0; app.on('tick', (p) => { guardLoaded(); acc += (p && p.dt) || 0; if (acc > 0.5) { acc = 0; renderFlow(false); } });
    app.on('newgame', () => { offset = 0; loaded = null; rerunActive = false; closeDrawer(); closeStation(); renderFlow(true); });
    app.layout = { showDrawer, closeDrawer, showStation, closeStation, buckets };
  }
  if (CS.app) init();
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
