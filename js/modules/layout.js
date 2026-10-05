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
  const CS = G.CS; if (!CS || typeof document === 'undefined') return;
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
  const SORTED = 0.6;              // held stock at 60% or better has been sorted out: its own end bucket; below that it goes to MISC (inventory merges each material across bins, so stray bits lower the figure)
  let app = null, offset = 0, openDrawer = null, stationOpen = false, lastSig = '';
  const $ = (s) => document.querySelector(s);
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
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
  function binHtml(st, tons, port) {
    const mm = mainMat(st), D = mm ? MATERIALS[mm] : null, tops = topMats(st, 3);
    let bands = '', acc = 0;
    tops.forEach((m) => { const f = st.perMat[m].mass / st.total; bands += '<i style="flex:' + f.toFixed(3) + ';background:' + MATERIALS[m].color + '"></i>'; acc += f; });
    if (acc < 0.999) bands += '<i style="flex:' + (1 - acc).toFixed(3) + ';background:#5a6573"></i>';
    const pure = st.share >= CLEAN;
    return '<div class="fbin' + (pure ? ' pure' : '') + '" title="' + esc((PORT_NAME[port] || port) + ': ' + tops.map((m) => MATERIALS[m].name + ' ' + Math.round(100 * st.perMat[m].mass / st.total) + '%').join(', ')) + '">' +
      '<div class="fbin-box"><div class="fbin-fill">' + bands + '</div></div>' +
      '<div class="fbin-t"><b>' + esc(D ? (st.form === 'ingot' ? D.name + ' ingots' : D.name) : 'mixed') + '</b><span>' + Math.round(st.share * 100) + '% · ' + tons.toFixed(1) + ' t</span></div></div>';
  }
  function stationFlow(n) {
    const S = app.S, ev = S.ev; if (!ev) return { bins: [], next: [] };
    const bins = [], next = [];
    ev.terminals.forEach((t) => {
      if (t.uid !== n.uid) return;
      const st = Sim.binStats(t.stream.m, t.form); if (st.total < 0.5) return;
      bins.push({ st, port: t.port, tons: st.total / 1000 * S.tons });
    });
    for (const key in ev.ports) {
      const [u, port] = key.split(':'); if (Number(u) !== n.uid) continue;
      const users = S.line.filter((x) => x.src && x.src !== 'feed' && x.src.uid === n.uid && x.src.port === port);
      if (!users.length) continue;
      const kg = Sim.streamMass(ev.ports[key]); if (kg < 0.5) continue;
      const st = Sim.binStats(ev.ports[key].m);
      next.push({ port, tons: kg / 1000 * S.tons, to: users.map((x) => S.line.indexOf(x) + 1), mats: topMats(st, 2).map((m) => MATERIALS[m].name.toLowerCase()) });
    }
    bins.sort((a, b) => b.tons - a.tons);
    return { bins, next };
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
    if (!owned) warn = '<div class="fn-w bad">not owned · buy it at its station</div>';
    col.innerHTML = '<div class="fn-k">STATION ' + (i + 1) + '</div><div class="fn-camwrap"></div><div class="fn-n">' + esc(M.name) + '</div><div class="fn-s">' + esc(status) + '</div>' + warn;
    const mini = miniFor(n.uid);
    if (mini) col.querySelector('.fn-camwrap').appendChild(mini.cv);
    const f = stationFlow(n);
    const binsBox = el('div', 'fbins');
    binsBox.innerHTML = '<div class="fn-sub">BINS FILLED HERE</div>' + (f.bins.length ? f.bins.map((b) => binHtml(b.st, b.tons, b.port)).join('') : '<div class="small">None: everything moves on.</div>');
    col.appendChild(binsBox);
    f.next.forEach((x) => {
      const nx = el('div', 'fnext');
      nx.innerHTML = '<span class="fnext-a">&#10140;</span><span><b>' + x.tons.toFixed(1) + ' t</b> ' + esc(x.port === 'product' ? 'shred' : 'left over') + ' to station ' + x.to.join(' & ') + '<span class="small"> · mostly ' + esc(x.mats.join(', ')) + '</span></span>';
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
    const Inv = CS.Inventory, stock = Inv && Inv.stock ? Inv.stock() : {};
    const clean = [], misc = { t: 0, comp: {} };
    MAT_ORDER.forEach((m) => {
      const e = stock[m]; if (!e || !(e.t > 0.05)) return;
      if ((e.purity || 0) >= SORTED) clean.push({ m, t: e.t, purity: e.purity, value: e.t * MATERIALS[m].sell * Sim.prices.market * ((Sim.prices.perMat && Sim.prices.perMat[m]) || 1) * (e.grade == null ? 1 : e.grade) * (e.sf == null ? 1 : e.sf) });
      else { misc.t += e.t; misc.comp[m] = e.t; }
    });
    return { clean, misc };
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
  function rerun(mats, label) {
    const S = app.S, stock = CS.Inventory.stock();
    if (S.run) { app.log('Wait for the batch to finish before loading a bucket.', 'warn'); return; }
    if (app.contract && app.contract()) { app.log('Release the contract first: the client supplies the feed while a contract is active.', 'warn'); return; }
    if (S.feedPrepaid && !loaded) { app.log('A prepaid lot is already loaded as the feed. Run it first, or change the feed by hand to put it back in the yard.', 'warn'); return; }
    const comp = {}; let tot = 0;
    mats.forEach((m) => { const t = stock[m] ? stock[m].t : 0; if (t > 0) { comp[m] = t; tot += t; } });
    if (tot < 1) { app.log('The ' + label + ' bucket holds under 1 t: too little to run a batch. Sell it, or let it fill up.', 'warn'); return; }
    for (const m in comp) comp[m] /= tot;
    const cap = app.plantValue('logistics'), tons = Math.max(1, Math.min(Math.floor(tot), cap));
    loaded = null;   // setFeed renders before the flag is set
    app.setFeed(comp, 'custom', tons);
    loaded = { comp: Object.assign({}, S.comp), label };
    S.feedPrepaid = true;
    app.markDirty(true);
    app.log('Loaded the ' + label + ' bucket as the feed: ' + tons + ' t per batch, no feed cost.' + (tot > tons ? ' The rest stays in the bucket (batch limit ' + cap + ' t).' : '') + ' Set up the machines, then press RUN BATCH.', 'ok');
    renderFlow(true);
  }
  /* drop the loaded bucket when the feed no longer matches it, or another module took the prepaid flag away */
  function guardLoaded() {
    if (!loaded) return;
    const S = app.S, stock = CS.Inventory.stock();
    if (!S.run && S.feedPrepaid && !app.contract() && sameComp(S.comp, loaded.comp)) {
      let have = 0; for (const m in loaded.comp) have += stock[m] ? stock[m].t : 0;   // never run more than the bucket holds
      if (S.tons > have && have >= 1) { S.tons = Math.floor(have); app.syncFeedRows(); }
      return;
    }
    if (S.run) return;
    const label = loaded.label; loaded = null;
    // the flag was ours: app.setFeed renders before another module (auction, intake) sets its own flag, so clearing it here never takes theirs
    S.feedPrepaid = false;
    app.log('The ' + label + ' bucket is no longer loaded: the feed was changed, so it stays in the bucket and the feed is charged at the normal price.', 'warn');
    app.markDirty();   // the feed cost and projected margin change with the flag
  }
  function onBatchStart(p) {
    if (!loaded) return;
    const S = app.S, Inv = CS.Inventory, l = loaded; loaded = null;
    if (app.contract() || !sameComp(S.comp, l.comp)) return;
    const tons = p && p.run && p.run.total ? p.run.total : S.tons;
    for (const m in l.comp) Inv.withdraw(m, tons * l.comp[m]);
  }
  function bucketsCol() {
    const col = el('div', 'fcol buckets'), b = buckets(), Inv = CS.Inventory;
    col.appendChild(el('div', 'fn-k', 'END RESULT IN BUCKETS'));
    const list = el('div', 'bk-list');
    if (!b.clean.length && !(b.misc.t > 0)) list.appendChild(el('div', 'small', 'Run a batch: what comes out lands here, ready to sell or run again.'));
    b.clean.forEach((x) => {
      const D = MATERIALS[x.m], row = el('div', 'bk');
      row.innerHTML = '<span class="bk-sw" style="background:' + D.color + '"></span><span class="bk-t"><b>' + esc(D.name) + '</b><span class="small">' + x.t.toFixed(1) + ' t · ' + Math.round(x.purity * 100) + '% pure · ' + app.fmtMoney(x.value) + '</span></span>';
      const sell = el('button', 'buy', 'SELL'); sell.type = 'button'; sell.addEventListener('click', () => { if (Inv && Inv.sellMat) Inv.sellMat(x.m); app.renderAll(); });
      const re = el('button', null, 'RE-RUN'); re.type = 'button'; re.title = 'Load this bucket as the next batch\'s feed'; re.addEventListener('click', () => rerun([x.m], D.name.toLowerCase()));
      row.appendChild(sell); row.appendChild(re); list.appendChild(row);
    });
    if (b.misc.t > 0) {
      const mats = Object.keys(b.misc.comp).sort((p, q) => b.misc.comp[q] - b.misc.comp[p]);
      const row = el('div', 'bk misc');
      row.innerHTML = '<span class="bk-sw misc"></span><span class="bk-t"><b>MISC</b><span class="small">' + b.misc.t.toFixed(1) + ' t not separated yet: ' + esc(mats.slice(0, 3).map((m) => MATERIALS[m].name.toLowerCase() + ' ' + Math.round(100 * b.misc.comp[m] / b.misc.t) + '%').join(', ')) + '</span></span>';
      const re = el('button', 'buy', 'RE-RUN'); re.type = 'button'; re.title = 'Send the mixed material back through the plant'; re.addEventListener('click', () => rerun(mats, 'MISC'));
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
    const sig = JSON.stringify([offset, S.line.map((n) => [n.uid, n.m, n.settings]), S.comp, S.tons, S.feedPreset, S.feedPrepaid, !!S.run, S.run ? Math.round(S.run.done) : -1, S.money, Object.keys(stock).map((m) => stock[m] && stock[m].t)]);
    if (!force && sig === lastSig) return; lastSig = sig;
    const F = FEEDS[S.feedPreset], cost = app.feedCostPerT ? app.feedCostPerT() : 0;
    $('#flow-feed').innerHTML = 'FEED &#9654; <b>' + esc(F ? F.name : 'Custom mix') + '</b> · ' + S.tons + ' t · ' + (S.feedPrepaid ? 'already yours' : cost < 0 ? 'paid ' + app.fmtMoney(-cost) + '/t to take' : app.fmtMoney(cost) + '/t');
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
    app.on('batchComplete', () => setTimeout(() => renderFlow(true), 0));
    let acc = 0; app.on('tick', (p) => { guardLoaded(); acc += (p && p.dt) || 0; if (acc > 0.5) { acc = 0; renderFlow(false); } });
    app.on('newgame', () => { offset = 0; loaded = null; closeDrawer(); closeStation(); renderFlow(true); });
    app.layout = { showDrawer, closeDrawer, showStation, closeStation, buckets };
  }
  if (CS.app) init();
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
