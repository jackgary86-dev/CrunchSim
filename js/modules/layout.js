/* CrunchSim module: layout. A calm main screen built from the operator's sketch.
 *
 * Main screen: the Feed panel on the left; on the right the plant as four sections divided by vertical lines: three
 * machines in the order they were placed (arrows page through longer lines) and, always last, the end result in buckets.
 * Every bucket can be sold, or re-run as the next batch's feed. Material that is not yet separated (under 90% one
 * material) collects in a MISC bucket, to be re-run through different machines.
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
      next.push({ port, kg, tons: kg / 1000 * tons, to: users.map((x) => line.indexOf(x) + 1), mats: topMats(st, 2).map((m) => MATERIALS[m].name.toLowerCase()), ids: topMats(st, 3) });
    }
    bins.sort((a, b) => b.tons - a.tons);
    return { bins, next };
  }
  /* one - or + press on a machine setting (#63): the slider's own step for a linear setting, a fortieth of the range on the
   * log scale for a log-scale one (40 presses span it; three significant figures as at the station), the next or previous option for a material
   * pick-list; always inside min and max */
  const LOG_STEPS = 40;
  function stepSetting(st, v, dir) {
    if (st.enum) { const k = st.enum.indexOf(v), n = st.enum.length; return st.enum[((k < 0 ? 0 : k) + (dir > 0 ? 1 : -1) + n) % n]; }
    let nv;
    if (st.log) nv = +(v * Math.pow(st.max / st.min, (dir > 0 ? 1 : -1) / LOG_STEPS)).toPrecision(3);
    else { nv = v + (dir > 0 ? 1 : -1) * st.step; const d = st.step < 1 ? Math.min(6, Math.ceil(-Math.log10(st.step) + 1e-9)) : 0; nv = +nv.toFixed(d); }
    return Math.min(st.max, Math.max(st.min, nv));
  }
  function fmtSetting(v, st) {
    if (st.enum) return MATERIALS_REF()[v] ? MATERIALS_REF()[v].name : String(v);
    const d = st.step < 0.1 ? 2 : st.step < 1 ? 1 : 0;
    return (st.log && v < 1 ? v.toPrecision(2) : v.toFixed(st.log ? (v < 10 ? 1 : 0) : d)) + (st.unit ? ' ' + st.unit : '');
  }
  function MATERIALS_REF() { return CS.MATERIALS; }
  /* what each setting does to the material, in plain words (#80); keyed machine:setting, or the setting alone */
  const SETTING_HELP = {
    css: 'Lower: a tighter jaw, finer product, more power and slower. Higher: coarser product, more throughput.',
    'roll:gap': 'Lower: rolls closer together, finer product, more power. Higher: coarser, faster.',
    'hpgr:gap': 'Lower: a tighter bed, finer product and more micro-cracks, more power. Higher: coarser, faster.',
    'colloid:gap': 'Lower: a finer rotor-stator gap, smaller droplets and particles, slower. Higher: coarser, faster.',
    press: 'Higher: more crushing force in the bed, finer product and more liberated grains, more power and wear.',
    tip: 'Higher: harder impacts, finer product and more breakage of brittle pieces, more power and wear.',
    grate: 'Lower: a smaller grate, finer shred that frees more metal, but more power and a slower line. Higher: coarser shred, faster and cheaper.',
    'hammer:rpm': 'Higher: faster hammers hit harder: finer shred, more power and wear. Lower: gentler, coarser shred.',
    'eddy:rpm': 'Higher: a faster magnet rotor throws aluminum and copper further: more metal pulled out, but more stray pieces too.',
    width: 'Lower: narrower cutters tear smaller strips. Higher: bigger pieces, more throughput.',
    screen: 'Lower: a finer screen keeps material in the cutting chamber longer: smaller product, slower. Higher: coarser, faster.',
    len: 'Lower: shorter chips. Higher: longer chips, more throughput.',
    'ball:target': 'Lower: grind finer, a much longer and costlier mill run. Higher: a coarser powder, faster.',
    'cryo:target': 'Lower: grind the frozen pieces finer, more nitrogen and power. Higher: coarser, cheaper.',
    'sensor:target': 'The material the scanner looks for: those pieces are blown into the extract bin, everything else (plus 2.5% misfires) goes on.',
    'omni:target': 'The size the all-in-one machine grinds to before it sorts.',
    bar: 'Higher: more pressure through the nozzle, finer droplets and particles, more power.',
    field: 'Higher: a stronger magnet pulls more steel and cast iron out, but drags some non-magnetic pieces with it. Lower: cleaner steel, some left behind.',
    air: 'Higher: faster air lifts heavier pieces into the light fraction: more plastic and foam out, but some light metal goes with it. Lower: only the lightest fluff lifts.',
    aperture: 'Lower: smaller holes, only fines fall through. Higher: bigger pieces fall through to the undersize bin.',
    sg: 'The liquid\'s density: anything lighter floats, anything heavier sinks. About 1.0 floats plastic and wood off rubber and metal; 2.0 floats rubber and glass off aluminum; 3.0 floats aluminum off copper, brass and zinc.',
    tap: 'Higher: hotter melt, so more metals melt and pour, more energy and more dross. Lower: only the low-melting metals pour.',
    rate: 'Higher: more tonnes an hour through the machine, at more power.'
  };
  function settingHelp(m, st) { return SETTING_HELP[m + ':' + st.id] || SETTING_HELP[st.id] || ''; }
  /* each end bin's main material and purity, to say what a press changed */
  function binSnapshot(ev) {
    const o = {}; if (!ev) return o;
    ev.terminals.forEach((t) => { const b = CS.Sim.binStats(t.stream.m, t.form); if (CS.Sim.binMatters(b)) o[t.key] = { main: b.main || topMats(b, 1)[0], share: b.share, kg: b.total }; });
    return o;
  }
  function biggestChange(a, b) {
    let best = null;
    for (const k in b) {
      const x = a[k], y = b[k]; if (!y) continue;
      const d = x ? y.share - x.share : y.share;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { k, d, from: x ? x.share : 0, to: y.share, main: y.main };
    }
    return best && Math.abs(best.d) >= 0.005 ? best : null;
  }
  CS.Layout = { SORTED, splitBuckets, rerunPlan, defaultEntry, stationFlow, topMats, stepSetting, fmtSetting, SETTING_HELP, settingHelp, binSnapshot, biggestChange };
  if (typeof document === 'undefined') return;
  const { MACHINES, MATERIALS, MAT_ORDER, FEEDS, Sim } = CS;

  /* #138: the toolbar follows the game loop. AUCTION buys, PLANT builds (next purchase, sorter slots, refinery, upgrades, the
   * line), SELL sells (buckets, jobs, prices), RECORDS looks back. MENU (modes.js) is the title screen. */
  const DRAWERS = [
    ['auction', 'Auction', ['auction-panel']],
    ['plant', 'Plant', ['bank-panel', 'slots-panel', 'refinery-panel', 'line-panel', 'facility-panel', 'blueprint-panel', 'playbook-panel']],
    ['sell', 'Sell', ['inventory-panel', 'missions-panel', 'market-panel']],
    ['records', 'Records', ['rivals-panel', 'milestones-panel', 'plant-panel', 'log-panel']]
  ];
  const DRAWER_ALIAS = { flowsheet: 'plant', bank: 'plant', sales: 'sell', market: 'sell', jobs: 'sell', report: 'records', log: 'records', rivals: 'records' };   // older callers
  /* #140 #142: what each game shows. Rivals is the match: no jobs, blueprints, playbooks, facility or milestones. In Progress the
   * depth arrives when it is useful: jobs, playbooks and the facility at Recycler rank, blueprints once the line has four machines. */
  const RIVALS_HIDE = ['missions-panel', 'blueprint-panel', 'playbook-panel', 'facility-panel', 'milestones-panel'];
  const UNLOCK = {
    'missions-panel': (S, rank) => rank >= 1, 'playbook-panel': (S, rank) => rank >= 1, 'facility-panel': (S, rank) => rank >= 1,
    'blueprint-panel': (S) => S.line.length >= 4
  };
  function panelShown(id) {
    const S = app.S;
    if (id === 'rivals-panel') return S.mode === 'rivals';
    if (S.mode === 'rivals') return RIVALS_HIDE.indexOf(id) < 0;
    const u = UNLOCK[id]; if (!u) return true;
    const rank = app.rankOf && app.netWorth ? app.rankOf(app.netWorth()).idx : 0;
    return u(S, rank);
  }
  const drawerLabel = (key, label) => app.S.mode === 'rivals' ? ({ auction: 'Auction round', records: 'Standings' }[key] || label) : label;
  let seenPanels = {};   // panels the player has already been shown (a NEW badge marks the drawer the first time one appears)
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
      const b = el('button', 'tool', esc(label)); b.type = 'button'; b.id = 'tool-' + key; b.dataset.key = key; b.dataset.label = label;
      b.addEventListener('click', () => (openDrawer === key ? closeDrawer() : showDrawer(key)));
      bar.appendChild(b);
    });
    const modes = el('div', 'modesw'); modes.id = 'mode-switch';
    [['progress', 'PROGRESS'], ['rivals', 'RIVALS']].forEach(([m, label]) => {
      const b = el('button', 'tool mode', label); b.type = 'button'; b.dataset.mode = m;
      b.title = m === 'rivals' ? 'Auction rounds against three rival yards (its own save)' : 'Build your plant on your own (its own save)';
      b.addEventListener('click', () => app.switchMode(m));
      modes.appendChild(b);
    });
    const ng = document.getElementById('btn-newgame'); if (ng) { ng.classList.add('tool'); modes.appendChild(ng); }   // RESTART RIVALS: shown in Rivals only
    bar.appendChild(modes);
    appEl.insertBefore(bar, $('#left'));
    const plant = el('section', 'panel'); plant.id = 'flow-panel';
    plant.innerHTML = '<nav id="loop" class="loop" aria-label="The game loop"></nav><h2>Plant <span class="tag" id="flow-count"></span></h2><div id="flow-feed" class="flow-feed"></div><div id="flow-margin" class="flow-margin"></div>' +
      '<div class="flow"><button type="button" class="flow-nav" id="flow-prev" aria-label="Earlier machines">&lsaquo;</button><div class="flow-wrap"><div id="flow-nodes"></div><div id="flow-cta" class="flow-cta hidden"></div></div><button type="button" class="flow-nav" id="flow-next" aria-label="Later machines">&rsaquo;</button></div>' +
      '<div class="small flow-hint">Machines run left to right in the order you placed them. Click one to sit at its station and tune it.</div>';
    const center = $('#center');
    center.insertBefore(plant, center.firstChild);
    LOOP.forEach(([key, label, hint]) => {
      const b = el('button', 'loop-step', '<b>' + label + '</b><span>' + hint + '</span>'); b.type = 'button'; b.dataset.key = key;
      b.addEventListener('click', () => goStep(key));
      $('#loop').appendChild(b);
    });
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
    // #64: the Feed panel (sliders nobody can move any more) gives way to a card for the loaded lot; the batch-size row moves into it
    const lc = el('section', 'panel lotcard-panel'); lc.id = 'lot-card';
    lc.innerHTML = '<h2>Loaded</h2><div id="lot-body"></div>';
    const left = $('#left'); left.insertBefore(lc, left.firstChild);
    const nc = el('section', 'panel nextcard'); nc.id = 'next-card'; nc.innerHTML = '<h2>Next step</h2><div id="next-body"></div>'; lc.after(nc);
    const lbc = el('section', 'panel lastcard hidden'); lbc.id = 'last-card'; lbc.innerHTML = '<h2>Last batch</h2><div id="last-body"></div>'; nc.after(lbc);
    const tonsRow = $('#feed-tons') && $('#feed-tons').closest('.row'); if (tonsRow) { tonsRow.classList.add('lot-tons'); lc.appendChild(tonsRow); }
    const fp = $('#feed-panel'); if (fp) stash.appendChild(fp);
    // #144: the bank in the header opens the records (milestones, the plant report and the event log of every sale and cost)
    const bank = $('#money') && $('#money').closest('.tele'); if (bank) { bank.classList.add('clicky'); bank.title = 'Where the money went: RECORDS'; bank.addEventListener('click', () => { showDrawer('records'); const lp = document.getElementById('log-panel'); if (lp) lp.scrollIntoView({ block: 'start' }); }); }
    DRAWERS.forEach(([, , ids]) => ids.forEach((id) => { const s = document.getElementById(id); if (s) stash.appendChild(s); }));
    const sv = document.getElementById('saveio-panel'); if (sv) stash.appendChild(sv);   // shown in SETTINGS (#136)
    drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
    // #137: the drawer sits at the side under the toolbar; a click anywhere else on the screen (not the toolbar) closes it
    document.addEventListener('mousedown', (e) => {
      if (!openDrawer || drawer.contains(e.target) || e.target.closest('#toolbar, #top, .overlay:not(#drawer), #scorecard, .guide, .title-screen')) return;
      closeDrawer();
    });
    station.addEventListener('click', (e) => { if (e.target === station) closeStation(); });
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#station-close').addEventListener('click', closeStation);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeStation(); } });
  }
  /* the game loop across the top (#58): Auction / Shred / Sort / Refine / Sell; each step takes you to that part of the game */
  const LOOP = [['auction', 'AUCTION', 'buy a lot'], ['shred', 'SHRED', 'grind into the BIN'], ['sort', 'SORT', 'up to 10 sorters'], ['refine', 'REFINE', 'ingots and bars'], ['sell', 'SELL', 'pure buckets only']];
  function goStep(key) {
    if (key === 'auction') return showDrawer('auction');
    if (key === 'sell') return showDrawer('sell');
    if (key === 'refine') { showDrawer('plant'); const r = document.getElementById('refinery-panel'); if (r) r.scrollIntoView({ block: 'start' }); return; }
    closeDrawer(); closeStation();
    const seq = flowSeq(), k = key === 'shred' ? 0 : Math.max(0, seq.findIndex((x) => x.n && MACHINES[x.n.m].kind === 'separator'));
    offset = k; renderFlow(true);
    const col = key === 'shred' ? document.querySelector('.fcol.bincol') : document.querySelector('.fcol.mach.sorter');
    if (col) { col.classList.remove('flash'); void col.offsetWidth; col.classList.add('flash'); }
  }
  function loopHints() {
    const S = app.S, I = CS.Inventory, A = CS.Auction && CS.Auction.live, RL = CS.Round && CS.Round.live, SL = CS.Slots && CS.Slots.live, RF = CS.Refinery && CS.Refinery.live;
    const stock = I ? I.stock() : {}, mats = Object.keys(stock).filter((m) => stock[m].t > 0.05);
    let value = 0; mats.forEach((m) => { value += I.quote ? I.quote(m) : 0; });
    const st = RL && RL.state ? RL.state() : null;
    const auction = S.mode === 'rivals' && st ? (st.match && st.match.over ? 'match over' : st.n ? 'round ' + st.n + ' of ' + st.match.length : 'start the match') : (A ? A.board().length + ' lots on the board' : 'buy a lot');
    const P = A && A.pending ? A.pending() : null;
    const shred = S.run ? fmtW(S.run.total - S.run.done) + ' to go' : S.feedPrepaid ? (P && S.feedOwner === 'auction' ? fmtW(P.tons) + ' in the yard' : S.tons + ' t loaded') : 'nothing loaded';
    const sort = SL ? SL.used() + ' / ' + SL.owned() + ' sorter slots' : 'sorters';
    const lvl = RF ? RF.level() : 0, refine = lvl >= 2 ? 'furnace + precious' : lvl === 1 ? 'smelting furnace' : 'no refinery yet';
    const sell = mats.length ? mats.length + ' bucket' + (mats.length === 1 ? '' : 's') + ' · ' + app.fmtMoney(value) : 'pure buckets only';
    return { auction, shred, sort, refine, sell };
  }
  function loopState() {
    const S = app.S, Inv = CS.Inventory, stock = Inv ? Inv.stock() : {}, held = Object.keys(stock).some((m) => stock[m].t > 0.05);
    if (S.run) return ['shred', 'sort'];
    if (S.mode === 'rivals' && CS.Round && CS.Round.live && CS.Round.live.miscAllowed() && CS.Inventory.miscTotal(CS.Inventory.misc()) >= 1) return ['shred'];   // no bin this round: run your MISC
    if (!S.feedPrepaid) return held ? ['sell', 'auction'] : ['auction'];
    return held ? ['shred', 'sell'] : ['shred'];
  }
  function showDrawer(key) {
    if (key === 'auction' && app.S.mode === 'rivals' && CS.Round && CS.Round.live) { closeStation(); closeDrawer(); CS.Round.live.open(); return; }
    closeStation(); closeDrawer();
    key = DRAWER_ALIAS[key] || key;
    const d = DRAWERS.find((x) => x[0] === key); if (!d) return;
    const body = $('#drawer-body');
    d[2].forEach((id) => { const s = document.getElementById(id); if (s && panelShown(id)) { body.appendChild(s); seenPanels[id] = true; } });
    $('#drawer-title').textContent = drawerLabel(key, d[1]).toUpperCase();
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
  /* #122: each station cam is cropped onto its machine at 16:10, so the machine fills the column; drop bins a crop leaves out are
   * listed under the station as BINS FILLED HERE, and the station view (click) shows the whole scene. */
  const VIEWS = {   // per scene, measured off each scene's drawing (scene units: 900 x 380)
    jaw: { x: 150, y: 0, w: 560, h: 340 }, cone: { x: 130, y: 0, w: 520, h: 330 }, roll: { x: 120, y: 0, w: 500, h: 310 }, hpgr: { x: 110, y: 0, w: 520, h: 320 },
    vsi: { x: 130, y: 0, w: 480, h: 300 }, hammer: { x: 170, y: 0, w: 530, h: 330 }, twin: { x: 140, y: 0, w: 560, h: 350 }, single: { x: 80, y: 0, w: 560, h: 350 },
    granulator: { x: 100, y: 10, w: 500, h: 320 }, chipper: { x: 20, y: 20, w: 600, h: 340 }, tub: { x: 80, y: 20, w: 560, h: 340 }, ball: { x: 100, y: 0, w: 480, h: 300 },
    cryo: { x: 150, y: 0, w: 480, h: 300 }, colloid: { x: 130, y: 0, w: 480, h: 300 }, homog: { x: 60, y: 60, w: 760, h: 280 }, atomizer: { x: 170, y: 0, w: 520, h: 330 },
    magnet: { x: 370, y: 40, w: 460, h: 300 }, eddy: { x: 300, y: 60, w: 480, h: 290 }, air: { x: 200, y: 0, w: 640, h: 380 },
    sinkfloat: { x: 130, y: 0, w: 720, h: 380 }, furnace: { x: 130, y: 0, w: 560, h: 350 }
  };   // screen, sensor, freezer and omni run the width of the scene and keep it whole
  function miniFor(uid) {
    let m = minis.get(uid);
    if (!m && CS.Cam) {
      const cv = el('canvas', 'fn-cam'); cv.setAttribute('aria-hidden', 'true');
      const cam = new CS.Cam(cv); cam.view = null;
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
        m.cam.view = VIEWS[st.M.scene] || null;
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
      '<div class="fbin-box"><div class="fbin-fill"' + (runProg >= 0 ? ' style="height:' + Math.round(10 + 75 * runProg) + '%"' : '') + '>' + bands + '</div></div>' +
      '<div class="fbin-t"><b>' + esc(D ? (st.form === 'ingot' ? D.name + ' ingots' : D.name) : 'mixed') + '</b><span>' + Math.round(st.share * 100) + '% · ' + fmtW(tons) + '</span>' + (verdict || (pure ? '<em class="ship ok">SELLS</em>' : '<em class="ship bad" title="Mixed: under 90% of one material. It cannot be sold; it goes to the MISC bucket to re-run.">TO MISC</em>')) + '</div></div>';
  }
  /* ---------------- where the feed comes from (#46) ---------------- */
  /* A batch takes its lot's tonnes (and clears the prepaid flag) when it starts, and the flag comes back when it ends: while a
   * batch runs, the source is the one it started with. */
  let runSrc = null;
  function feedSource() {
    const S = app.S;
    if (S.run) return runSrc;
    runSrc = sourceNow();
    return runSrc;
  }
  function sourceNow() {
    const S = app.S;
    if (loaded) return { name: 'Re-run: ' + loaded.label + ' bucket', note: 'already yours' };
    const A = CS.Auction && CS.Auction.live, P = A && A.pending ? A.pending() : null;
    if (P && S.feedPrepaid && P.truth && CS.Auction.sameComp(S.comp, P.truth)) return { name: 'Auction lot #' + P.id + (P.headline ? ' · ' + P.headline : ''), sub: P.seller ? 'from ' + P.seller : '', note: 'paid at auction' };
    return null;
  }

  /* ---------------- the lot card (#64) and the idle plant (#65) ---------------- */
  let idleNow = false, runProg = -1, pureSeen = null, lastNote = null;
  function isIdle() { return !app.S.feedPrepaid && !app.S.run; }
  function compBars(c, n) {
    const e = Object.entries(c || {}).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const bar = '<div class="lc-comp">' + e.map((x) => '<i style="flex:' + x[1].toFixed(4) + ';background:' + MATERIALS[x[0]].color + '"></i>').join('') + '</div>';
    const list = e.slice(0, n || 4).map((x) => '<div class="lc-m"><span class="sw" style="background:' + MATERIALS[x[0]].color + '"></span>' + esc(MATERIALS[x[0]].name) + '<b>' + (x[1] >= 0.001 ? (x[1] * 100).toFixed(x[1] < 0.1 ? 1 : 0) + '%' : Math.round(x[1] * 1e6) + ' g/t') + '</b></div>').join('');
    return bar + list;
  }
  function binPic(c) { const e = Object.entries(c || {}).filter((x) => x[1] > 0).sort((a, b) => a[1] - b[1]); return '<div class="lc-bin"><div class="lc-fill">' + e.map((x) => '<i style="flex:' + x[1].toFixed(4) + ';background:' + MATERIALS[x[0]].color + '"></i>').join('') + '</div></div>'; }
  /* what to do when nothing is loaded: one clear action, by mode */
  function nextAction() {
    const S = app.S, I = CS.Inventory, mt = I && I.misc ? I.miscTotal(I.misc()) : 0, RL = CS.Round && CS.Round.live;
    if (S.mode === 'rivals' && RL) {
      if (RL.miscAllowed() && mt >= 1) return { label: 'RUN YOUR MISC', sub: 'No bin for you this round: ' + fmtW(mt) + ' of mixed material is waiting.', go: () => { const mats = Object.keys(I.misc()).filter((m) => I.misc()[m].t > 0); rerun(mats, 'MISC', 'misc'); } };
      const st = RL.state(); if (st.match && st.match.over) return { label: 'SEE THE STANDINGS', sub: 'The match is over.', go: () => showDrawer('auction') };
      return { label: RL.canStart() ? (st.n ? 'NEXT AUCTION ROUND' : 'START THE MATCH') : 'OPEN THE AUCTION', sub: 'Material comes only from bins you win at auction, or your MISC bin in a round you win nothing.', go: () => showDrawer('auction') };
    }
    return { label: 'BUY A LOT', sub: 'Material comes only from the auction or your MISC bucket. Six lots wait on the board, from $1k to $100k.' + (mt >= 1 ? ' Or RE-RUN your MISC bucket: ' + fmtW(mt) + ' of mixed material is waiting.' : ''), go: () => showDrawer('auction') };
  }
  /* #135: the one next step, decided in one place for every state: the bottom note and the NEXT STEP card both show it */
  let npCache = { at: 0, key: '', v: null };
  function topPurchase() {   // NEXT PURCHASE's best pick, cached: the ranking evaluates the line for every candidate
    const S = app.S; if (!app.nextPurchases || S.run || !S.line.length) return null;
    const key = S.line.map((n) => n.m + n.uid).join() + '|' + Math.floor(S.money / 500);
    if (npCache.key !== key || Date.now() - npCache.at > 5000) { const ps = app.nextPurchases(); npCache = { at: Date.now(), key, v: ps && ps[0] ? ps[0] : null }; }
    return npCache.v;
  }
  function nextStep() {
    const S = app.S, I = CS.Inventory, mt = I && I.misc ? I.miscTotal(I.misc()) : 0;
    if (S.run) {
      const lot = CS.Autorun && CS.Autorun.live && CS.Autorun.live.active();
      return { title: 'RUNNING', label: lot ? 'STOP THE LOT' : 'STOP', sub: fmtW(S.run.total - S.run.done) + ' to go in this batch' + (lot ? ', then the rest of the lot' : '') + '.', go: () => $('#btn-run').click(), quiet: true };
    }
    if (S.feedPrepaid) return { title: 'READY', label: 'RUN', sub: (S.feedOwner === 'rerun' && loaded ? 'The ' + loaded.label + ' bucket' : 'The loaded lot') + ' is on the belt: ' + S.tons + ' t a batch.', go: () => $('#btn-run').click() };
    if (S.mode === 'rivals') { const a = nextAction(); return Object.assign({ title: 'NEXT' }, a); }
    // money first: the best pure bucket
    const stock = I && I.stock ? I.stock() : {};
    let best = null; for (const m in stock) { const v = I.quote ? I.quote(m) : 0; if (stock[m].t > 0.05 && v > 0 && (!best || v > best.v)) best = { m, v }; }
    if (best && best.v >= 50) return { title: 'SELL', label: 'SELL ' + MATERIALS[best.m].name.toUpperCase() + ' ' + app.fmtMoney(best.v), sub: 'A pure bucket is money waiting: ' + fmtW(stock[best.m].t) + ' of ' + MATERIALS[best.m].name.toLowerCase() + '.', go: () => { if (I.sellMat) I.sellMat(best.m); } };
    const p = topPurchase();
    if (p) {
      const price = p.ms.reduce((c, m) => c + (app.unitsOf(m) > S.line.filter((x) => x.m === m).length ? 0 : MACHINES[m].price), 0);
      if (price <= S.money) return { title: 'GROW', label: 'BUY & PLACE ' + p.ms.map((m) => MACHINES[m].short).join(' + '), sub: p.ms.map((m) => MACHINES[m].name).join(' + ') + ' adds ' + app.fmtMoney(p.gain) + '/t for ' + app.fmtMoney(price) + '.', go: () => app.buyAndAdd && app.buyAndAdd(p) };
    }
    if (mt >= 1) return { title: 'RE-RUN', label: 'RE-RUN MISC', sub: fmtW(mt) + ' of mixed material is waiting for your sorters.', go: () => { const mats = Object.keys(I.misc()).filter((m) => I.misc()[m].t > 0); rerun(mats, 'MISC', 'misc'); } };
    return Object.assign({ title: 'BUY' }, nextAction());
  }
  /* the left column (#132): NEXT STEP and the LAST BATCH under the loaded lot */
  let lastBatch = null;
  function renderSideCards() {
    const nb = $('#next-body'); if (nb) {
      const a = nextStep();
      nb.innerHTML = '<div class="ns-t">' + esc(a.title) + '</div><div class="ns-s">' + esc(a.sub) + '</div>';
      if (!a.quiet || app.S.run) { const b = el('button', 'primary', esc(a.label)); b.type = 'button'; b.addEventListener('click', () => a.go()); nb.appendChild(b); }
    }
    const lb = $('#last-body'); if (lb) {
      lb.parentElement.classList.toggle('hidden', !lastBatch);
      if (lastBatch) lb.innerHTML = '<div class="lb-n ' + (lastBatch.net >= 0 ? 'ok' : 'bad') + '">' + (lastBatch.net >= 0 ? '+' : '') + app.fmtMoney(lastBatch.net) + '</div><div class="small">' + esc(fmtW(lastBatch.t) + (lastBatch.why !== 'complete' ? ' (' + lastBatch.why + ')' : '') + (lastBatch.best ? ' · best: ' + lastBatch.best : '')) + '</div>';
    }
  }
  function renderLotCard() {
    const box = $('#lot-body'), S = app.S; if (!box) return;
    const A = CS.Auction && CS.Auction.live, P = A && A.pending ? A.pending() : null, yard = A && A.yard ? A.yard() : [];
    const tonsRow = document.querySelector('#lot-card .lot-tons');
    let h = '';
    if (P && S.feedPrepaid && S.feedOwner === 'auction') {
      const seen = P.boughtTons && P.tons < P.boughtTons ? P.truth : P.declared;   // the weighbridge tells the truth once the first batch ran
      h = '<div class="lc-h"><b>LOT #' + P.id + '</b><span>' + esc(P.headline) + '</span></div>' + binPic(seen) +
        '<div class="lc-t"><b>' + fmtW(P.tons) + '</b> left of ' + fmtW(P.boughtTons || P.tons) + '<span>paid ' + app.fmtMoney(P.ask) + '/t</span></div>' +
        '<div class="small">' + esc(P.seller || '') + (seen === P.truth ? ' · weighbridge mix' : ' · declared mix') + '</div>' + compBars(seen, 4);
    } else if (loaded && S.feedPrepaid) {
      h = '<div class="lc-h"><b>RE-RUN</b><span>' + esc(loaded.label) + ' bucket</span></div>' + binPic(loaded.comp) + '<div class="lc-t"><b>' + S.tons + ' t</b> per batch<span>already yours</span></div>' + compBars(loaded.comp, 4);
    } else if (S.feedPrepaid) {
      const src = feedSource();
      h = '<div class="lc-h"><b>LOADED</b><span>' + esc(src ? src.name : 'material') + '</span></div>' + binPic(S.comp) + compBars(S.comp, 4);
    } else {
      const a = nextAction();
      h = '<div class="lc-empty"><div class="small">Nothing is loaded.</div><button type="button" class="primary lc-go">' + esc(a.label) + '</button><div class="small">' + esc(a.sub) + '</div></div>';
    }
    if (yard && yard.length && S.mode !== 'rivals') h += '<div class="lc-yard"><div class="fn-sub">WAITING IN THE YARD</div>' + yard.map((L) => '<div class="lc-y"><span><b>#' + L.id + '</b> ' + esc(L.headline) + ' · ' + fmtW(L.tons) + '</span><button type="button" data-lot="' + L.id + '"' + (S.run ? ' disabled' : '') + '>LOAD</button></div>').join('') + '</div>';
    box.innerHTML = h;
    const go = box.querySelector('.lc-go'); if (go) go.addEventListener('click', () => nextAction().go());
    box.querySelectorAll('.lc-y button').forEach((b) => b.addEventListener('click', () => { if (A.load(+b.dataset.lot)) renderFlow(true); }));
    if (tonsRow) tonsRow.classList.toggle('hidden', !S.feedPrepaid);
  }

  /* ---------------- conveyors between the columns (#66) ---------------- */
  function belt(tons, ids, label) {
    if (!(tons > 0)) return '';
    const S = app.S, frac = Math.min(1, tons / Math.max(S.tons, 1e-9)), h = Math.round(5 + 11 * Math.sqrt(frac));
    const cols = (ids || []).map((m) => MATERIALS[m] ? MATERIALS[m].color : '#5a6573');
    while (cols.length < 3) cols.push(cols[0] || '#5a6573');
    const stripes = 'repeating-linear-gradient(90deg,' + cols[0] + ' 0 10px,#0b1018 10px 14px,' + cols[1] + ' 14px 22px,#0b1018 22px 26px,' + cols[2] + ' 26px 32px,#0b1018 32px 36px)';
    return '<div class="belt" style="height:' + h + 'px"><div class="belt-load" style="background:' + stripes + '"></div><span class="belt-l">' + esc(label) + '</span></div>';
  }

  /* ---------------- sections ---------------- */
  function machineCol(n, i) {
    const M = MACHINES[n.m], inf = app.info(n.uid), S = app.S, owned = app.nodeOwned ? app.nodeOwned(n) : true;
    const col = el('div', 'fcol mach' + (M.kind === 'separator' ? ' sorter' : '') + (owned ? '' : ' unowned'));
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
    if (M.settings && M.settings.length) col.appendChild(settingsBox(n, M));
    const binsBox = el('div', 'fbins');
    if (idleNow) {   // #65: no material, no projections
      binsBox.innerHTML = '<div class="fn-sub">BINS FILLED HERE</div><div class="small">Waiting for material.</div>';
      col.appendChild(binsBox);
    } else {
      const f = stationFlow(S.ev, S.line, S.tons, n.uid);
      binsBox.innerHTML = '<div class="fn-sub">BINS FILLED HERE</div>' + (f.bins.length ? f.bins.map((b) => binHtml(b.st, b.tons, b.port)).join('') : '<div class="small">None: everything moves on.</div>');
      col.appendChild(binsBox);
      f.next.forEach((x) => {
        const nx = el('div', 'fnext');
        nx.innerHTML = '<span class="fnext-a">&#10140;</span><span>' + esc(x.port === 'product' ? 'shred' : 'left over') + ' to station ' + x.to.join(' & ') + '<span class="small"> · mostly ' + esc(x.mats.join(', ')) + '</span></span>';
        col.appendChild(nx);
      });
      const out = f.next.reduce((a, x) => a + x.tons, 0);
      if (out > 0) col.insertAdjacentHTML('beforeend', belt(out, f.next[0].ids, fmtW(out)));
    }
    if (idleNow) col.classList.add('idle');
    const open = () => showStation(n.uid);
    col.addEventListener('click', open);
    col.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return col;
  }
  /* the station's settings on its column: label, - value +, one row each (#63) */
  function settingsBox(n, M) {
    const box = el('div', 'fset');
    M.settings.forEach((st) => {
      const row = el('div', 'fset-r');
      const help = settingHelp(n.m, st); if (help) row.title = st.label + ': ' + help;
      row.appendChild(el('span', 'fset-l', esc(st.label) + (help ? ' <i class="fset-q">?</i>' : '')));
      const minus = el('button', 'fset-b', '&minus;'), plus = el('button', 'fset-b', '+');
      const val = el('span', 'fset-v', esc(fmtSetting(n.settings[st.id], st)));
      [[minus, -1], [plus, 1]].forEach(([b, dir]) => {
        b.type = 'button'; b.title = (dir > 0 ? 'Raise ' : 'Lower ') + st.label.toLowerCase();
        const v = n.settings[st.id];
        if (!st.enum && ((dir < 0 && v <= st.min) || (dir > 0 && v >= st.max))) b.disabled = true;
        b.addEventListener('click', (e) => {
          e.stopPropagation();   // the column itself opens the station
          const before = binSnapshot(app.S.ev);
          n.settings[st.id] = stepSetting(st, n.settings[st.id], dir);
          app.S.linePreset = 'custom'; const lp = document.getElementById('line-preset'); if (lp) lp.value = 'custom';
          if (app.recompute) app.recompute();
          const ch = biggestChange(before, binSnapshot(app.S.ev));   // #80: say which bin the press changed
          lastNote = { uid: n.uid, at: Date.now(), text: ch ? (MATERIALS[ch.main] ? MATERIALS[ch.main].name.toLowerCase() : 'mixed') + ' bin ' + Math.round(ch.from * 100) + '% \u2192 ' + Math.round(ch.to * 100) + '%' + (ch.from < 0.9 && ch.to >= 0.9 ? ': it sells now' : ch.from >= 0.9 && ch.to < 0.9 ? ': it no longer sells' : '') : 'no bin changed much' };
          app.markDirty(true);
        });
      });
      const ctl = el('span', 'fset-c'); ctl.appendChild(minus); ctl.appendChild(val); ctl.appendChild(plus);
      row.appendChild(ctl); box.appendChild(row);
    });
    if (lastNote && lastNote.uid === n.uid && Date.now() - lastNote.at < 8000) box.appendChild(el('div', 'fset-note', esc(lastNote.text)));
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('keydown', (e) => e.stopPropagation());   // Enter on a button must not open the station
    return box;
  }
  function addCol() {
    const col = el('div', 'fcol add'); col.tabIndex = 0; col.setAttribute('role', 'button');
    col.innerHTML = '<div class="fn-plus">+</div><div class="fn-s">Add a machine</div>';
    // #143: the best next sorter, bought and placed in one click (NEXT PURCHASE's top pick)
    const picks = app.nextPurchases && !app.S.run && app.S.line.length ? app.nextPurchases() : null, p = picks && picks[0];
    if (p && app.buyAndAdd) {
      const price = p.ms.reduce((c, m) => c + (app.unitsOf(m) > app.S.line.filter((x) => x.m === m).length ? 0 : MACHINES[m].price), 0);
      const sug = el('div', 'add-sug', '<div class="fn-sub">NEXT PURCHASE</div><b>' + esc(p.ms.map((m) => MACHINES[m].name).join(' + ')) + '</b><div class="ok">+' + app.fmtMoney(p.gain) + '/t</div>');
      const b = el('button', 'buy' + (app.S.money < price ? ' poor' : ''), 'BUY &amp; PLACE ' + app.fmtMoney(price)); b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); app.buyAndAdd(p); });
      sug.appendChild(b); col.appendChild(sug);
    }
    const go = () => showDrawer('plant');
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
   * the batch starts, so changing the feed by hand just puts the bucket back.  */
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
    if (src === 'misc' && S.mode === 'rivals' && CS.Round && CS.Round.live && !CS.Round.live.miscAllowed()) { app.log('In Rivals mode your MISC bin runs only in a round where you win no bin. Pass on the cards (or lose them) and it is yours to run.', 'warn'); return; }
    if (S.run) { app.log('Wait for the batch to finish before loading a bucket.', 'warn'); return; }
    const cap = app.plantValue('logistics'), plan = rerunPlan(stock, mats, cap);
    if (plan.error) { app.log('The ' + label + ' bucket holds under 1 t: too little to run a batch. Sell it, or let it fill up.', 'warn'); return; }
    const comp = plan.comp, tot = plan.tot, tons = plan.tons, entry = defaultEntry(S.line, MACHINES);
    const prev = loaded ? loaded.prev : (FEEDS[S.feedPreset] ? { preset: S.feedPreset, tons: S.tons } : null);   // the feed to go back to after the batch
    loaded = null; S.feedOwner = null;   // setFeed renders before the flag is set; a loaded auction lot goes back to wait in the yard
    app.setFeed(comp, 'custom', tons);
    loaded = { comp: Object.assign({}, S.comp), label, sizes: plan.sizes, entry, prev, src: src || 'stock' };
    S.feedPrepaid = true; S.feedOwner = 'rerun';
    S.feedOpts = { sizes: plan.sizes, entry };   // it goes in as the shred it already is (#41), past the shredders (#42)
    app.markDirty(true);
    const k = entry == null ? 0 : S.line.findIndex((n) => n.uid === entry);
    offset = Math.max(0, flowSeq().findIndex((x) => x.n && x.n.uid === (entry == null ? S.line[0].uid : entry)));   // page the plant screen to the entry station
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
    if (!S.run && S.feedPrepaid && S.feedOwner === 'rerun' && sameComp(S.comp, loaded.comp)) {
      let have = 0; for (const m in loaded.comp) have += stock[m] ? stock[m].t : 0;   // never run more than the bucket holds
      if (S.tons > have && have >= 1) { S.tons = Math.floor(have); app.syncFeedRows(); }
      return;
    }
    if (S.run) return;
    const label = loaded.label; loaded = null;
    if (S.feedOwner === 'rerun') { S.feedPrepaid = false; S.feedOwner = null; }   // only our own flag: another module may have loaded its feed
    S.feedOpts = null;
    app.log('The ' + label + ' bucket is no longer loaded: the feed was changed, so it stays in the bucket and the feed is charged at the normal price.', 'warn');
    app.markDirty();   // the feed cost and projected margin change with the flag
  }
  function onBatchStart(p) {
    if (!loaded) return;
    const S = app.S, Inv = CS.Inventory, l = loaded; loaded = null;
    if (!sameComp(S.comp, l.comp)) { S.feedOpts = null; return; }
    if (p && p.run) p.run.src = l.src;   // #98: jobs do not count a batch of material already sold to stock
    const tons = p && p.run && p.run.total ? p.run.total : S.tons, took = {};
    for (const m in l.comp) took[m] = l.src === 'misc' && Inv.withdrawMisc ? Inv.withdrawMisc(m, tons * l.comp[m]) : Inv.withdraw(m, tons * l.comp[m]);
    if (l.src === 'misc' && S.mode === 'rivals' && CS.Round && CS.Round.live) CS.Round.live.useMisc();
    rerunActive = { prev: l.prev || true, took, tons, src: l.src };   // the sizes and entry station hold for this batch, then the feed is ordinary again
  }
  let rerunActive = false;
  function onBatchComplete(p) {
    if (p && p.r) {   // #132: the LAST BATCH card
      const sel = (p.bins || []).filter((b) => b.st && b.st.sellable && b.st.main).sort((x, y) => y.st.value - x.st.value)[0];
      lastBatch = { t: p.r.done || 0, net: (p.net || 0) + (p.r.held ? (p.r.rev || 0) : 0), why: p.why || 'complete', best: sel ? MATERIALS[sel.st.main].name.toLowerCase() + ' ' + Math.round(sel.st.share * 100) + '%' : '' };
    }
    if (rerunActive) {
      const ra = rerunActive; rerunActive = false; app.S.feedOpts = null;
      const done = p && p.r ? p.r.done : 0;
      if (ra.took && ra.tons > 0 && done < ra.tons - 1e-6 && CS.Inventory && CS.Inventory.putBack) {   // #96: a stopped batch gives the unrun tonnes back
        const f = 1 - done / ra.tons;
        for (const m in ra.took) { const o = ra.took[m]; if (o && o.t > 0) CS.Inventory.putBack(ra.src, m, Object.assign({}, o, { t: o.t * f, cost: (o.cost || 0) * f })); }
        app.log(app.fmtNum(ra.tons - done, 1) + ' t did not run: back in the ' + (ra.src === 'misc' ? 'MISC bucket' : 'bucket') + '.');
      }
      // nothing is bought by the tonne any more (#57): the auction module reloads the lot waiting in the yard
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
  /* REFINE (#54): metal buckets melted into ingots or refined into bars; a rich MISC concentrate sold by assay */
  function refineButton(m) {
    const R = CS.Refinery && CS.Refinery.live; if (!R) return null;
    const q = R.quote(m); if (!q || !q.need) return null;
    const b = el('button', 'refine' + (q.ok && q.gain > 0 ? ' buy' : ''), q.ok ? 'REFINE ' + app.fmtMoney(q.net) : 'REFINE · needs ' + esc(q.needName.toLowerCase())); b.type = 'button';
    b.title = q.ok ? 'Refine into ' + q.form + ': ' + app.fmtMoney(q.value) + ' less ' + app.fmtMoney(q.cost) + ' = ' + app.fmtMoney(q.net) + ' (' + (q.gain >= 0 ? '+' : '-') + app.fmtMoney(Math.abs(q.gain)) + ' against selling raw)' : q.why;
    if (!q.ok) b.disabled = true;
    b.addEventListener('click', () => withMoney(b, () => { R.refine(m); renderFlow(true); }));
    return b;
  }
  function refineMiscButton() {
    const R = CS.Refinery && CS.Refinery.live; if (!R) return null;
    const q = R.quoteMisc(); if (!q || !(q.pv > 0)) return null;
    const b = el('button', 'refine' + (q.ok ? ' buy' : ''), q.ok ? 'REFINE ' + app.fmtMoney(q.net) : 'REFINE · ' + (CS.Refinery.live.level() < 2 ? 'needs precious refinery' : 'too lean')); b.type = 'button';
    b.title = q.ok ? 'Sell the MISC pile to the precious refinery by assay: ' + app.fmtMoney(q.value) + ' for the gold and silver in it, less ' + app.fmtMoney(q.cost) + ' treatment' : q.why;
    if (!q.ok) b.disabled = true;
    b.addEventListener('click', () => withMoney(b, () => { R.refineMisc(); renderFlow(true); }));
    return b;
  }
  /* a held lot drawn as what it is stored in: bale, big bag, bin, drum or bar, sized by tonnes (#68) */
  function unitPic(m, t, p80) {
    const I = CS.Inventory, U = I && I.unitFor ? I.unitFor(m, p80) : { name: 'bale' }, D = MATERIALS[m];
    const kind = /bag/.test(U.name) ? 'bag' : /bin/.test(U.name) ? 'bin' : /drum/.test(U.name) ? 'drum' : /bar/.test(U.name) ? 'bar' : 'bale';
    const sz = Math.round(18 + 20 * Math.min(1, Math.sqrt(t / 40)));
    return '<span class="unit ' + kind + '" style="--uc:' + D.color + ';--us:' + sz + 'px" title="' + esc(U.name) + 's of ' + esc(D.name.toLowerCase()) + '"></span>';
  }
  /* money that flies from a button to the bank (#68) */
  function flyMoney(a, amount) {   // a: the button's rectangle, taken before the click redrew it
    const bank = document.getElementById('money'); if (!a || !bank || !(Math.abs(amount) >= 1)) return;
    const b = bank.getBoundingClientRect();
    const f = el('div', 'flymoney' + (amount < 0 ? ' neg' : ''), (amount > 0 ? '+' : '') + app.fmtMoney(amount));
    f.style.left = (a.left + a.width / 2) + 'px'; f.style.top = a.top + 'px';
    document.body.appendChild(f);
    requestAnimationFrame(() => { f.style.transform = 'translate(' + (b.left + b.width / 2 - a.left - a.width / 2) + 'px,' + (b.top - a.top) + 'px) scale(.8)'; f.style.opacity = '0.2'; });
    setTimeout(() => { f.remove(); bank.classList.remove('bump'); void bank.offsetWidth; bank.classList.add('bump'); }, 750);
    if (CS.Audio && CS.Audio.cash) CS.Audio.cash();
  }
  function withMoney(btn, act) { const m0 = app.S.money, rect = btn.getBoundingClientRect(); act(); flyMoney(rect, app.S.money - m0); }
  function bucketsCol() {
    const col = el('div', 'fcol buckets'), b = buckets(), Inv = CS.Inventory;
    col.appendChild(el('div', 'fn-k', 'END RESULT IN BUCKETS'));
    const list = el('div', 'bk-list');
    if (!b.clean.length && !(b.misc.t > 0)) list.appendChild(el('div', 'small', 'Run a batch: what comes out lands here, ready to sell or run again.'));
    b.clean.forEach((x) => {
      const D = MATERIALS[x.m], row = el('div', 'bk shelf'), e = (CS.Inventory.stock() || {})[x.m] || {};
      const mk = marketTag(x.m), pay = Inv && Inv.quote ? Inv.quote(x.m) : x.value;
      row.innerHTML = unitPic(x.m, x.t, e.p80) + '<span class="bk-t"><b>' + esc(D.name) + '</b><span class="small">' + mk + fmtW(x.t) + ' · ' + Math.round(x.purity * 100) + '% pure</span></span>';
      const sell = el('button', 'buy', 'SELL ' + app.fmtMoney(pay)); sell.type = 'button'; sell.title = 'Sell all ' + fmtW(x.t) + ' now for ' + app.fmtMoney(pay); sell.addEventListener('click', () => withMoney(sell, () => { if (Inv && Inv.sellMat) Inv.sellMat(x.m); app.renderAll(); }));
      const re = el('button', null, 'RE-RUN'); re.type = 'button'; re.title = 'Load this bucket as the next batch\'s feed'; re.addEventListener('click', () => rerun([x.m], D.name.toLowerCase(), 'stock'));
      row.appendChild(sell); row.appendChild(re);
      const rf = refineButton(x.m); if (rf) { row.classList.add('rf'); row.appendChild(rf); }
      row.classList.add('clicky'); row.title = D.name + ': prices, jobs and selling part of it are in SELL';   // #144
      row.addEventListener('click', (e) => { if (!e.target.closest('button')) showDrawer('sell'); });
      list.appendChild(row);
    });
    if (b.misc.t > 0) {
      const mats = Object.keys(b.misc.comp).sort((p, q) => b.misc.comp[q] - b.misc.comp[p]);
      const row = el('div', 'bk misc');
      row.innerHTML = '<span class="unit heap" style="--us:' + Math.round(18 + 20 * Math.min(1, Math.sqrt(b.misc.t / 40))) + 'px"></span><span class="bk-t"><b>MISC</b><span class="small">' + fmtW(b.misc.t) + ' not separated yet: ' + esc(mats.slice(0, 3).map((m) => MATERIALS[m].name.toLowerCase() + ' ' + Math.round(100 * b.misc.comp[m] / b.misc.t) + '%').join(', ')) + '</span></span>';
      const re = el('button', 'buy', 'RE-RUN'); re.type = 'button'; re.title = 'Send the mixed material back through the plant'; re.addEventListener('click', () => rerun(mats, 'MISC', 'misc'));
      row.appendChild(re);
      const rf = refineMiscButton(); if (rf) { row.classList.add('rf'); row.appendChild(rf); }
      list.appendChild(row);
    }
    col.appendChild(list);
    return col;
  }

  /* the plant in screen order: the grinding stage (the stations at the head of the line that break material), then THE BIN
   * everything falls into, then the sorters and the rest in placement order, then the add-a-machine column (#50) */
  function flowSeq() {
    const S = app.S, seq = S.line.map((n, i) => ({ n, i }));
    let k = 0; while (k < S.line.length && MACHINES[S.line[k].m] && MACHINES[S.line[k].m].kind === 'comminution') k++;
    if (k > 0) seq.splice(k, 0, { bin: true, from: S.line[k - 1] });
    return seq.concat([{ add: true }]);
  }
  function binCol(from) {
    const S = app.S, col = el('div', 'fcol bincol');
    const port = !idleNow && S.ev && S.ev.ports[from.uid + ':product'];
    const st = port ? Sim.binStats(port.m) : null, tons = st ? st.total / 1000 * S.tons : 0;
    if (idleNow) col.classList.add('idle');
    let bands = '', list = '';
    if (st && st.total > 0) {
      topMats(st, 8).forEach((m) => {
        const f = st.perMat[m].mass / st.total;
        bands += '<i style="flex:' + f.toFixed(4) + ';background:' + MATERIALS[m].color + '"></i>';
        if (f >= 0.005 || CS.Sim.PRECIOUS.indexOf(m) >= 0) list += '<div class="bin-row"><span class="sw" style="background:' + MATERIALS[m].color + '"></span>' + esc(MATERIALS[m].name) + '<b>' + (f >= 0.001 ? (f * 100).toFixed(f < 0.1 ? 1 : 0) + '%' : Math.round(f * 1e6) + ' g/t') + '</b></div>';
      });
    }
    col.innerHTML = '<div class="fn-k">THE BIN</div>' +
      '<div class="bigbin"><div class="bigbin-fill">' + bands + '</div></div>' +
      '<div class="fn-n">' + (st && st.total > 0 ? fmtW(tons) + ' of mixed shred' : 'empty') + '</div>' +
      '<div class="fn-s">' + (st && st.total > 0 ? 'P80 ' + fmtSz(st.p80) + ' · everything the grinder breaks falls in here' : 'Load a lot: the grinder fills it') + '</div>' +
      '<div class="bin-list">' + list + '</div>' +
      '<div class="fnext"><span class="fnext-a">&#10140;</span><span>the sorters take it from here</span></div>' +
      (st && st.total > 0 ? belt(tons, topMats(st, 3), fmtW(tons)) : '');
    // #144: THE BIN leads to where its material comes from: the auction when nothing is loaded, else the loaded lot's card
    col.classList.add('clicky'); col.title = idleNow ? 'Nothing loaded: open the auction' : 'Show the loaded lot';
    col.addEventListener('click', () => { if (idleNow) { showDrawer('auction'); return; } const lc = document.getElementById('lot-card'); if (lc) { lc.classList.remove('flash'); void lc.offsetWidth; lc.classList.add('flash'); } });
    return col;
  }
  function renderMode() {
    const m = app.S.mode;
    document.querySelectorAll('#mode-switch .mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    document.body.dataset.mode = m;
    // labels per game, and a NEW badge on a drawer the first time one of its panels appears (#140)
    if (!seenPanels.__primed) { DRAWERS.forEach(([, , ids]) => ids.forEach((id) => { if (panelShown(id)) seenPanels[id] = true; })); seenPanels.__primed = true; }
    DRAWERS.forEach(([key, label, ids]) => {
      const b = document.getElementById('tool-' + key); if (!b) return;
      const fresh = ids.some((id) => panelShown(id) && !seenPanels[id]);
      b.innerHTML = esc(drawerLabel(key, label)) + (fresh ? ' <i class="newb">NEW</i>' : '');
    });
  }
  /* the first launch asks which game to play */
  function chooseMode() {
    if (app.storedMode && app.storedMode()) return;
    const d = el('div', 'overlay'); d.id = 'mode-pick';
    d.innerHTML = '<div class="sheet"><div class="sheet-h"><b>CHOOSE A GAME</b></div><div class="sheet-b mode-b">' +
      '<button type="button" class="mode-card" data-mode="progress"><b>PROGRESS</b><span>Build your plant on your own. Buy scrap from the six-tier auction board, grind it, sort it, refine it and sell it, and level up from scrapyard to mega-plant.</span></button>' +
      '<button type="button" class="mode-card" data-mode="rivals"><b>RIVALS</b><span>Auction rounds against three rival yards. Three bins a round, four bidders: whoever goes home without a bin runs their MISC instead. Watch the market to judge your bids.</span></button>' +
      '<div class="small">Each mode keeps its own save. Switch any time from the toolbar.</div></div></div>';
    document.body.appendChild(d);
    d.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => { d.remove(); app.switchMode(b.dataset.mode); }));
  }
  /* the live projection above the stations (#63): margin per tonne and for the batch, and what the last change did to it,
   * so the - / + buttons on the stations can be tuned against profit without opening each station */
  let lastMargin = null, lastDelta = 0, deltaAt = 0;
  function renderMargin() {
    const box = $('#flow-margin'), S = app.S; if (!box || !S.ev || !app.marginPerT) return;
    if (isIdle()) { box.innerHTML = 'PROJECTED &#9654; <span class="small">nothing loaded: margins appear once a lot or bucket is loaded</span>'; lastMargin = null; return; }
    const m = app.marginPerT(), per = m.margin, batch = per * S.tons;
    if (lastMargin != null && Math.abs(per - lastMargin) > 0.005) { lastDelta = per - lastMargin; deltaAt = Date.now(); }
    lastMargin = per;
    const fresh = Date.now() - deltaAt < 6000 && Math.abs(lastDelta) >= 0.5;   // under 50 cents a tonne is noise
    const sold = m.rev, cls = per >= 0 ? 'ok' : 'bad';
    box.innerHTML = 'PROJECTED &#9654; margin <b class="' + cls + '">' + (per >= 0 ? '+' : '') + app.fmtMoney(per) + '/t</b> · this batch <b class="' + cls + '">' + (batch >= 0 ? '+' : '') + app.fmtMoney(batch) + '</b>' +
      (fresh ? ' <span class="dm ' + (lastDelta > 0 ? 'ok' : 'bad') + '">' + (lastDelta > 0 ? '&#9650; +' : '&#9660; ') + app.fmtMoney(lastDelta) + '/t</span>' : '') +
      ' <span class="small">· sells ' + app.fmtMoney(sold) + '/t · power ' + app.fmtMoney(m.powerC) + '/t · ' + (m.R > 0 ? m.R.toFixed(1) + ' t/h' : 'cannot run') + '</span>';
  }
  function renderFlow(force) {
    const S = app.S; if (!S || !$('#flow-nodes')) return;
    idleNow = isIdle(); runProg = S.run && S.run.total > 0 ? Math.min(1, S.run.done / S.run.total) : -1;
    document.body.classList.toggle('plant-running', !!S.run);
    renderMode(); renderMargin(); renderLotCard(); renderSideCards();
    const seq = flowSeq();
    offset = Math.max(0, Math.min(offset, Math.max(0, seq.length - MACHINE_COLS)));
    const stock = CS.Inventory && CS.Inventory.stock ? CS.Inventory.stock() : {};
    const sig = JSON.stringify([offset, S.line.map((n) => [n.uid, n.m, n.settings]), S.comp, S.tons, S.feedPreset, S.feedPrepaid, S.feedOpts, !!S.run, S.run ? Math.round(20 * S.run.done / Math.max(S.run.total, 1e-9)) : -1, CS.Auction && CS.Auction.live ? [CS.Auction.live.yard().length, CS.Auction.live.pending() && CS.Auction.live.pending().tons] : 0, S.money, Object.keys(stock).map((m) => stock[m] && stock[m].t), CS.Inventory && CS.Inventory.misc ? CS.Inventory.miscTotal(CS.Inventory.misc()) : 0]);
    if (!force && sig === lastSig) return; lastSig = sig;
    const F = FEEDS[S.feedPreset], cost = app.feedCostPerT ? app.feedCostPerT() : 0, ff = $('#flow-feed');
    const src = feedSource(), name = src ? src.name : F ? F.name : 'Custom mix';
    if (!src && !S.feedPrepaid && !S.run) {   // #57: nothing is bought by the tonne
      ff.innerHTML = 'FEED &#9654; <b>nothing loaded</b> · win a lot in the <a href="#" id="ff-auction">Auction</a>, or RE-RUN a bucket';
      const a = ff.querySelector('#ff-auction'); if (a) a.addEventListener('click', (e) => { e.preventDefault(); showDrawer('auction'); });
    } else {
      ff.innerHTML = 'FEED &#9654; <b>' + esc(name) + '</b>' + (src && src.sub ? ' <span class="small">' + esc(src.sub) + '</span>' : '') + ' · ' + S.tons + ' t · ' + (src ? esc(src.note) : S.feedPrepaid ? 'already yours' : cost < 0 ? 'paid ' + app.fmtMoney(-cost) + '/t to take' : app.fmtMoney(cost) + '/t');
    }
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
    // #81: a chime when a change makes a station bin pure enough to sell
    if (!idleNow && S.ev) {
      const pure = new Set(); S.ev.terminals.forEach((t) => { const b = Sim.binStats(t.stream.m, t.form); if (b.sellable && Sim.binMatters(b)) pure.add(t.key + ':' + b.main); });
      if (pureSeen && !S.run) { for (const k of pure) if (!pureSeen.has(k)) { if (CS.Audio && CS.Audio.fx) CS.Audio.fx('chime'); break; } }
      pureSeen = pure;
    } else pureSeen = null;
    const box = $('#flow-nodes'); box.innerHTML = '';
    box.classList.toggle('idle', idleNow);
    const cta = $('#flow-cta');
    if (idleNow) {   // #65: a small note at the bottom of the screen, out of the plant's way
      const a = nextStep();
      cta.innerHTML = '<div class="cta-card" title="' + esc(a.sub) + '"><b>NOTHING LOADED</b><button type="button" class="primary">' + esc(a.label) + '</button></div>';
      cta.querySelector('button').addEventListener('click', () => nextStep().go());
      cta.classList.remove('hidden');
    } else cta.classList.add('hidden');
    seq.slice(offset, offset + MACHINE_COLS).forEach((x) => box.appendChild(x.add ? addCol() : x.bin ? binCol(x.from) : machineCol(x.n, x.i)));
    const lit = loopState(), hints = loopHints(); document.querySelectorAll('#loop .loop-step').forEach((b) => { b.classList.toggle('on', lit.indexOf(b.dataset.key) >= 0); const sp = b.querySelector('span'); if (sp && hints[b.dataset.key]) sp.textContent = hints[b.dataset.key]; });
    for (let k = box.children.length; k < MACHINE_COLS; k++) box.appendChild(el('div', 'fcol empty'));
    box.appendChild(bucketsCol());
    $('#flow-prev').disabled = offset === 0; $('#flow-next').disabled = offset + MACHINE_COLS >= seq.length;
    const SL = CS.Slots && CS.Slots.live;
    $('#flow-count').textContent = S.line.length + ' machine' + (S.line.length === 1 ? '' : 's') + (SL ? ' · sorters ' + SL.used() + ' / ' + SL.owned() + ' slots' : '') + (S.line.length > MACHINE_COLS ? ' · showing ' + (offset + 1) + '-' + Math.min(S.line.length, offset + MACHINE_COLS) : '');
  }

  function init() {
    app = CS.app; if (!app || app.layoutStarted) return; app.layoutStarted = true;
    app.on('boot', () => {
      build(); renderFlow(true); requestAnimationFrame(miniLoop); if (!CS.Modes) chooseMode();   // #87: the title screen (modes.js) picks the game
      // hand edits on the feed panel only do a light refresh (no render event): check the loaded bucket right after them,
      // and again just before RUN BATCH prices the feed
      const fp = $('#feed-panel'), chk = () => setTimeout(() => { guardLoaded(); renderFlow(false); }, 0);
      if (fp) { fp.addEventListener('input', chk); fp.addEventListener('change', chk); }
      document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#btn-run')) guardLoaded(); }, true);
    });
    app.on('batchStart', onBatchStart);
    // #109: a MISC bucket loaded in a no-bin round cannot run once a later round has handed you a bin
    app.on('veto:startRun', () => {
      const S = app.S;
      if (loaded && loaded.src === 'misc' && S.feedOwner === 'rerun' && S.mode === 'rivals' && CS.Round && CS.Round.live && !CS.Round.live.miscAllowed()) return 'Your MISC bin runs only in a round where you win no bin. It stays in the bucket until then.';
      return '';
    });
    app.on('render', () => { guardLoaded(); pruneMinis(); renderFlow(false); if (stationOpen && !app.node(app.S.sel)) closeStation(); });
    app.on('batchComplete', onBatchComplete);
    // a loaded bucket survives a reload: it is restored as the prepaid feed while the feed panel still shows its blend
    app.on('save', () => ({ layout: { loaded, rerunActive, seen: seenPanels } }));
    const restore = (ext) => {
      const d = ext && ext.layout, S = app.S; loaded = null; rerunActive = false;
      seenPanels = d && d.seen && typeof d.seen === 'object' ? Object.assign({}, d.seen) : {};
      if (!d || !S) return;
      if (d.loaded && !S.run && sameComp(S.comp, d.loaded.comp)) {
        loaded = d.loaded; S.feedPrepaid = true; S.feedOwner = 'rerun'; S.feedOpts = { sizes: loaded.sizes || {}, entry: loaded.entry == null ? null : loaded.entry };
      } else if (d.rerunActive && S.feedOpts) S.feedOpts = null;
    };
    app.on('load', restore);
    let acc = 0; app.on('tick', (p) => { guardLoaded(); acc += (p && p.dt) || 0; if (acc > 0.5) { acc = 0; renderFlow(false); } });
    app.on('modechange', () => { offset = 0; closeDrawer(); closeStation(); renderFlow(true); });   // #94: 'newgame' and 'load' already set loaded for this mode
    app.on('newgame', () => { offset = 0; seenPanels = {}; lastBatch = null; loaded = null; rerunActive = false; closeDrawer(); closeStation(); renderFlow(true); });
    app.layout = { showDrawer, closeDrawer, showStation, closeStation, buckets };
  }
  if (CS.app) init();
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
