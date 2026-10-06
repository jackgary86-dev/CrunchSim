/* CrunchSim plant floor: a 3D walk-through of a flowsheet, built on three.js r128 (global THREE).
 *
 * The layout function is pure (no DOM, no THREE) so tests/plant3d-layout.js can run it in Node. The renderer and the
 * controls panel only exist in a browser. The page shares js/data.js, js/sim.js and js/score.js with the game but
 * not js/app.js: it keeps its own small state and reads the player's saved plant straight from localStorage.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.Sim) return;
  const MATERIALS = CS.MATERIALS, MACHINES = CS.MACHINES, FEEDS = CS.FEEDS, LINES = CS.LINES, Sim = CS.Sim;

  /* ================= layout: pure geometry of the plant floor =================
   * Units are metres. Nodes sit in index order along X, one slot each. A lane is a parallel belt run offset in Z.
   * Lane rule: a node takes its source's lane when it is the first consumer of that source's primary port. A node fed
   * from a secondary port (rejects, residue), from a port an earlier node already uses, or as a second user of the
   * head feed gets a fresh lane, fanned out alternately to +Z and -Z. Every unconsumed port ends in a bin on a free
   * cell. Belts leave the +X face, change lane in the gap right after the source, then run straight along the
   * destination lane, so the cells a belt crosses are known and nothing is placed on them.
   */
  const PITCH = 6;        // m between machine centres: shredder plants space units 5 to 8 m apart for crane and maintenance access
  const LANE_W = 5;       // m between parallel belt lanes: a 1.2 m belt each side of a walkway
  const BELT_Y = 1.0;     // m belt height: troughed scrap conveyors run about a metre off the floor
  const BELT_W = 1.2;     // m belt width: 1200 mm is the usual downstream belt width in a car-shredder plant
  const BELT_SPEED = 1.5; // m/s: sorting belts run 1 to 2 m/s
  const SIZE = { comminution: [3.2, 2.8, 3.0], separator: [2.6, 1.9, 2.4], conditioner: [3.0, 2.4, 2.8] }; // [w, h, d] m: a 1 MW hammermill housing is about 3 m across
  const BIN_SIZE = [2.0, 1.5, 2.0];     // m: a 6 m3 roll-off skip
  const HOPPER_SIZE = [2.8, 2.4, 2.8];  // m: a whole-car infeed hopper
  const MAX_W = SIZE.comminution[0];

  function primaryPort(M) { return M.kind === 'separator' ? 'extract' : 'product'; }
  function portsOf(M) { return M.kind === 'separator' ? ['extract', 'residue'] : (M.kind === 'conditioner' ? ['product'] : (M.kind === 'furnace' ? ['product', 'dross'] : ['product', 'rejects'])); }
  function srcKey(src) { return !src || src === 'feed' ? 'feed' : src.uid + ':' + src.port; }

  function layout(line) {
    const ck = function (slot, lane) { return slot + ',' + lane; };
    // a source must be an earlier node; anything else is treated as the head feed (same rule as the game's loader)
    const srcs = line.map(function (n, k) {
      if (!n.src || n.src === 'feed') return 'feed';
      for (let i = 0; i < k; i++) if (line[i].uid === n.src.uid) return n.src;
      return 'feed';
    });
    const consumers = {};
    srcs.forEach(function (s, k) { const key = srcKey(s); (consumers[key] || (consumers[key] = [])).push(line[k].uid); });
    const nodes = [], byUid = {}, cells = {}, belts = [], bins = [];
    let laneCount = 0;
    function freshLane() { laneCount++; const k = Math.ceil(laneCount / 2); return laneCount % 2 ? k : -k; }
    const hopper = { slot: 0, lane: 0, x: 0, z: 0, w: HOPPER_SIZE[0], h: HOPPER_SIZE[1], d: HOPPER_SIZE[2] };
    cells[ck(0, 0)] = { type: 'hopper' };

    line.forEach(function (n, k) {
      const M = MACHINES[n.m], slot = k + 1, s = srcs[k];
      let lane, why;
      if (s === 'feed') {
        if (consumers.feed[0] === n.uid) { lane = 0; why = 'head'; } else { lane = freshLane(); why = 'shared feed'; }
      } else {
        const src = byUid[s.uid], key = srcKey(s);
        const first = consumers[key][0] === n.uid, prim = s.port === primaryPort(MACHINES[src.m]);
        if (prim && first) { lane = src.lane; why = 'primary'; } else { lane = freshLane(); why = prim ? 'shared port' : 'secondary port'; }
      }
      const sz = SIZE[M.kind] || SIZE.comminution;
      const nd = { uid: n.uid, m: n.m, index: k, slot: slot, lane: lane, x: slot * PITCH, z: lane * LANE_W, w: sz[0], h: sz[1], d: sz[2], why: why, src: s };
      nodes.push(nd); byUid[n.uid] = nd; cells[ck(slot, lane)] = { type: 'node', uid: n.uid };
    });

    function corridor(fromObj, toObj) { const c = []; for (let s = fromObj.slot + 1; s < toObj.slot; s++) c.push(ck(s, toObj.lane)); return c; }
    function addBelt(from, fromObj, port, to, toObj) {
      const prim = fromObj === hopper || port === primaryPort(MACHINES[fromObj.m]);
      const side = toObj.z === fromObj.z ? 1 : Math.sign(toObj.z - fromObj.z);
      const zOut = fromObj.z + (prim ? 0 : side * fromObj.d * 0.3);
      const xOut = fromObj.x + fromObj.w / 2, xIn = toObj.x - toObj.w / 2;
      const pts = [[xOut, zOut]];
      if (Math.abs(toObj.z - zOut) > 1e-9) pts.push([xOut + 0.75 * (PITCH - (fromObj.w + MAX_W) / 2), toObj.z]);
      pts.push([xIn, toObj.z]);
      const cc = corridor(fromObj, toObj);
      cc.forEach(function (c) { if (!cells[c]) cells[c] = { type: 'belt' }; });
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const b = { from: from, to: to, pts: pts, len: len, cells: cc, lane: toObj.lane, index: belts.length };
      belts.push(b); return b;
    }
    nodes.forEach(function (nd) {
      if (nd.src === 'feed') addBelt('feed', hopper, null, { uid: nd.uid }, nd);
      else addBelt({ uid: nd.src.uid, port: nd.src.port }, byUid[nd.src.uid], nd.src.port, { uid: nd.uid }, nd);
    });

    // bins for every unconsumed port: primary tries its own lane first, secondary tries the neighbouring lanes;
    // the cell and the belt corridor to it must both be free, otherwise widen the search and then step one slot on
    nodes.forEach(function (nd) {
      const M = MACHINES[nd.m];
      portsOf(M).forEach(function (port) {
        const key = nd.uid + ':' + port; if (consumers[key]) return;
        const prim = port === primaryPort(M);
        let slot = nd.slot + 1, lane = null, guard = 0;
        while (lane == null && guard++ < 200) {
          const cand = []; if (prim) cand.push(nd.lane);
          for (let j = 1; j <= 6; j++) cand.push(nd.lane + j, nd.lane - j);
          if (!prim) cand.push(nd.lane);
          for (let i = 0; i < cand.length && lane == null; i++) {
            const L = cand[i]; if (cells[ck(slot, L)]) continue;
            let free = true; for (let s = nd.slot + 1; s < slot; s++) if (cells[ck(s, L)]) { free = false; break; }
            if (free) lane = L;
          }
          if (lane == null) slot++;
        }
        const b = { key: key, uid: nd.uid, port: port, index: bins.length, slot: slot, lane: lane, x: slot * PITCH, z: lane * LANE_W, w: BIN_SIZE[0], h: BIN_SIZE[1], d: BIN_SIZE[2], label: M.outs ? M.outs[port] : port };
        bins.push(b); cells[ck(slot, lane)] = { type: 'bin', key: key };
        addBelt({ uid: nd.uid, port: port }, nd, port, { bin: b.index }, b);
      });
    });

    let laneMin = 0, laneMax = 0, slots = 0;
    nodes.concat(bins).forEach(function (o) { laneMin = Math.min(laneMin, o.lane); laneMax = Math.max(laneMax, o.lane); slots = Math.max(slots, o.slot); });
    const bounds = { laneMin: laneMin, laneMax: laneMax, slots: slots, xMin: -HOPPER_SIZE[0] / 2 - 2, xMax: slots * PITCH + MAX_W / 2 + 2, zMin: laneMin * LANE_W - MAX_W / 2 - 2, zMax: laneMax * LANE_W + MAX_W / 2 + 2 };
    return { nodes: nodes, bins: bins, belts: belts, hopper: hopper, cells: cells, bounds: bounds };
  }

  /* point on a belt polyline at distance s, with the local direction */
  function beltPoint(b, s) {
    const pts = b.pts; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], L = Math.hypot(dx, dz);
      if (s <= acc + L || i === pts.length - 1) { const f = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; return { x: pts[i - 1][0] + dx * f, z: pts[i - 1][1] + dz * f, dx: L > 0 ? dx / L : 1, dz: L > 0 ? dz / L : 0 }; }
      acc += L;
    }
    return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
  }

  CS.Plant3D = { layout: layout, beltPoint: beltPoint, wheelZoom: wheelZoom, primaryPort: primaryPort, portsOf: portsOf, PITCH: PITCH, LANE_W: LANE_W, BELT_Y: BELT_Y, BELT_W: BELT_W, BELT_SPEED: BELT_SPEED, SIZE: SIZE, BIN_SIZE: BIN_SIZE, HOPPER_SIZE: HOPPER_SIZE };

  /* ================= everything below needs a browser ================= */
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const Score = CS.Score;
  const SAVE_KEY = 'crunchsim.v2';
  const MAX_FRAG = 400;
  const $ = function (s) { return document.querySelector(s); };
  const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  /* Camera distance after one wheel event. Chrome reports pixels (a notch is ~100), Firefox reports lines (~3) or pages,
   * so deltaY is normalised to pixels first: DOM_DELTA_LINE (1) is about 33 px, DOM_DELTA_PAGE (2) about 100 px. */
  function wheelZoom(r, deltaY, deltaMode) {
    const px = deltaY * (deltaMode === 1 ? 33 : deltaMode === 2 ? 100 : 1);
    return Math.max(6, Math.min(150, r * Math.exp(px * 0.001)));
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function fmtNum(x, d) { if (x == null || !isFinite(x)) return '--'; const f = d == null ? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2) : d; return x.toLocaleString('en-US', { minimumFractionDigits: f, maximumFractionDigits: f }); }
  function fmtSize(mm) { if (!(mm > 0)) return '--'; if (mm >= 1000) return fmtNum(mm / 1000, 2) + ' m'; if (mm >= 1) return fmtNum(mm, mm >= 100 ? 0 : 1) + ' mm'; return fmtNum(mm * 1000, 0) + ' µm'; }
  function fmtMoney(x) { return CS.Score.fmtMoney(x); }
  function fmtSetting(v, st) { const d = st.step < 0.1 ? 2 : st.step < 1 ? 1 : 0; return (st.log && v < 1 ? v.toPrecision(2) : v.toFixed(d)) + ' ' + st.unit; }
  function ro(lbl, v, u, cls) { return '<div class="ro ' + (cls || '') + '"><span class="lbl">' + lbl + '</span><span class="v">' + v + '</span><span class="u">' + (u || '') + '</span></div>'; }

  /* ---------------- state ---------------- */
  const V = { feedId: 'elv', comp: {}, lineId: null, line: [], lay: null, ev: null, mr: null, binsInfo: [], capKg: 1, tons: 15, done: 0, running: false, complete: false, speed: 1, mine: null };
  const DEFAULT_LINE = LINES.universal ? 'universal' : (LINES.car ? 'car' : Object.keys(LINES)[0]);

  function recompute() {
    V.ev = Sim.evalLine(V.line, V.comp);
    V.mr = Sim.maxRate(V.ev.nodes, V.line);
    V.binsInfo = V.ev.terminals.map(function (t) { return { key: t.key, uid: t.uid, port: t.port, st: Sim.binStats(t.stream.m), temp: t.stream.temp }; });
    let cap = 0; V.binsInfo.forEach(function (b) { cap = Math.max(cap, b.st.total); });
    V.capKg = Math.max(1, cap * V.tons);
  }
  function headRate() { return V.mr ? V.mr.R : 0; }
  function plantPower(R) { let P = 0; V.ev.nodes.forEach(function (n) { P += Math.min(n.M.prated, n.M.pidle + R * n.ePerHead); }); return P; }
  function revenuePerT() { let v = 0; V.binsInfo.forEach(function (b) { if (Sim.binMatters(b.st)) v += b.st.value; }); return v; }
  function nodeIndex(uid) { for (let k = 0; k < V.line.length; k++) if (V.line[k].uid === uid) return k; return -1; }

  /* The game's saved plant, the way app.js load() reads it: settings through Sim.cleanSettings (a tampered or imported save
   * must not feed NaN or out-of-range values to the sim), plus the machine levels and wear. Pure, so tests/plant3d-save.js runs it. */
  function parseSave(text) {
    try {
      const d = JSON.parse(text || 'null');
      if (!d || !Array.isArray(d.line) || !d.line.length) return null;
      const lv = {}; for (const k in (d.levels || {})) if (MACHINES[k]) lv[k] = clamp(Math.floor(+d.levels[k] || 0), 0, CS.LEVEL_MAX);
      const line = d.line.filter(function (n) { return n && MACHINES[n.m]; }).map(function (n) {
        return { uid: +n.uid, m: n.m, settings: Sim.cleanSettings(n.m, n.settings), wear: clamp(+n.wear || 0, 0, 1), level: lv[n.m] || 0, src: n.src && n.src !== 'feed' ? { uid: +n.src.uid, port: n.src.port } : 'feed' };
      });
      const uids = new Set(line.map(function (n) { return n.uid; }));
      line.forEach(function (n, i) { if (n.src !== 'feed' && !(uids.has(n.src.uid) && line.findIndex(function (x) { return x.uid === n.src.uid; }) < i)) n.src = 'feed'; });
      if (!line.length) return null;
      let tot = 0; for (const m in (d.comp || {})) tot += d.comp[m] > 0 ? d.comp[m] : 0;
      return { line: line, comp: tot > 0 ? d.comp : null, feedPreset: d.feedPreset, tons: clamp(+d.tons || 15, 1, 500) };
    } catch (e) { return null; }
  }
  /* the Progress save and the Rivals save live under two keys; take the one for the mode played last, else whichever exists */
  function readSave() {
    let mode = null; try { mode = localStorage.getItem('crunchsim.mode'); } catch (e) { /* storage unavailable */ }
    const keys = mode === 'rivals' ? [SAVE_KEY + '.rivals', SAVE_KEY] : [SAVE_KEY, SAVE_KEY + '.rivals'];
    for (let i = 0; i < keys.length; i++) { let t = null; try { t = localStorage.getItem(keys[i]); } catch (e) { /* storage unavailable */ } const r = parseSave(t); if (r) return r; }
    return null;
  }
  CS.Plant3D.parseSave = parseSave; CS.Plant3D.readSave = readSave;

  /* ---------------- boot ---------------- */
  function boot() {
    const wrap = $('#view-wrap'), canvas = $('#view');
    if (typeof THREE === 'undefined') { wrap.appendChild(el('div', 'view-msg', 'three.js did not load. The 3D floor needs https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js; the panels still work.')); }
    let R3 = null;
    if (typeof THREE !== 'undefined') {
      // WebGLRenderer throws when WebGL is blocklisted or context-limited; keep the panels wired without it
      try { R3 = makeRenderer(canvas, wrap); }
      catch (e) { wrap.appendChild(el('div', 'view-msg', 'WebGL is unavailable in this browser, so the 3D floor cannot draw; the panels still work.')); }
    }

    /* ---- feed and line selects ---- */
    const feedSel = $('#feed'), lineSel = $('#line');
    for (const id in FEEDS) feedSel.appendChild(new Option(FEEDS[id].name, id));
    for (const id in LINES) lineSel.appendChild(new Option(LINES[id].name, id));
    V.mine = readSave();
    const mineBtn = $('#btn-mine'); mineBtn.disabled = !V.mine;
    $('#mine-note').textContent = V.mine ? V.mine.line.length + ' machines saved in this browser' : 'no saved game in this browser';
    if (V.mine) { lineSel.appendChild(new Option('My plant (saved game)', 'mine')); if (V.mine.comp) feedSel.appendChild(new Option('My feed (saved game)', 'mine')); }

    function setFeed(id) {
      V.feedId = id;
      V.comp = id === 'mine' && V.mine && V.mine.comp ? Object.assign({}, V.mine.comp) : Object.assign({}, FEEDS[id] ? FEEDS[id].comp : FEEDS.elv.comp);
      feedSel.value = id;
      if (R3) R3.setDropKind(dropKind());
      refresh(false);
    }
    function setLine(id) {
      V.lineId = id;
      if (id === 'mine' && V.mine) { V.line = V.mine.line.map(function (n) { return Object.assign({}, n, { settings: Object.assign({}, n.settings) }); }); V.tons = V.mine.tons; }
      else { const L = LINES[id]; V.line = Sim.buildLine(L); V.tons = L.tons || 15; }
      lineSel.value = id;
      V.lay = layout(V.line);
      resetBatch();
      if (R3) R3.build(V.lay);
      buildNodePanel();
      refresh(true);
      if (R3) R3.frame();
    }
    feedSel.addEventListener('change', function () { setFeed(feedSel.value); });
    lineSel.addEventListener('change', function () {
      const id = lineSel.value;
      if (id === 'mine') { setLine('mine'); setFeed(V.mine.comp ? 'mine' : (FEEDS[V.mine.feedPreset] ? V.mine.feedPreset : 'elv')); }
      else { setLine(id); if (LINES[id].feed) setFeed(LINES[id].feed); }
    });
    mineBtn.addEventListener('click', function () { if (!V.mine) return; lineSel.value = 'mine'; lineSel.dispatchEvent(new Event('change')); });

    /* ---- run, speed ---- */
    const runBtn = $('#btn-run');
    function resetBatch() { V.done = 0; V.complete = false; V.running = false; if (R3) R3.clearFragments(); renderRun(); }
    function renderRun() {
      runBtn.innerHTML = V.running ? '&#9646;&#9646; PAUSE' : (V.complete ? '&#9654; RUN AGAIN' : (V.done > 0 ? '&#9654; RESUME' : '&#9654; RUN'));
      runBtn.classList.toggle('running', V.running);
      $('#prog').style.width = (100 * clamp(V.done / V.tons, 0, 1)) + '%';
      const st = $('#view-status'); st.textContent = V.running ? 'RUNNING' : (V.complete ? 'BATCH COMPLETE' : 'STANDBY'); st.classList.toggle('on', V.running); st.classList.toggle('idle', !V.running);
    }
    runBtn.addEventListener('click', function () {
      if (V.complete) { resetBatch(); }
      if (!(headRate() > 0)) { $('#view-msg-line').textContent = 'The line cannot run: ' + (V.mr && V.mr.limiter ? 'node ' + (nodeIndex(V.mr.limiter.uid) + 1) + ' is ' + V.mr.limiter.why : 'no feed is accepted') + '.'; return; }
      $('#view-msg-line').textContent = '';
      V.running = !V.running; renderRun();
    });
    document.querySelectorAll('.spd').forEach(function (b) { b.addEventListener('click', function () { V.speed = +b.dataset.speed; document.querySelectorAll('.spd').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
    window.addEventListener('keydown', function (e) {
      if (!CS.hotkeyOk(e, document)) return;
      if (e.code === 'Space') { e.preventDefault(); runBtn.click(); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') { const b = document.querySelectorAll('.spd')[+e.key - 1]; if (b) b.click(); }
    });

    /* ---- node panel: one block per node with its settings sliders ---- */
    const statusEls = [];
    function srcLabel(n) {
      if (!n.src || n.src === 'feed') return 'FEED';
      const k = nodeIndex(n.src.uid); return k < 0 ? 'FEED' : (k + 1) + ':' + MACHINES[V.line[k].m].short + '/' + n.src.port.toUpperCase();
    }
    function buildNodePanel() {
      const box = $('#nodes'); box.innerHTML = ''; statusEls.length = 0;
      V.line.forEach(function (n, k) {
        const M = MACHINES[n.m], ld = V.lay.nodes[k];
        const d = el('div', 'n3');
        const head = el('div', 'n3h', '<span class="idx">' + (k + 1) + '</span><span><div class="nm">' + esc(M.name) + '</div><div class="src">&larr; ' + esc(srcLabel(n)) + ' &middot; lane ' + (ld.lane >= 0 ? '+' : '') + ld.lane + '</div></span><span class="st"></span>');
        head.addEventListener('click', function () { if (R3) R3.focus(ld.x, ld.z); });
        d.appendChild(head); statusEls.push(head.querySelector('.st'));
        if (!M.settings.length) d.appendChild(el('div', 'small', 'No adjustable settings.'));
        M.settings.forEach(function (st) {
          const row = el('div', 'setting'); row.appendChild(el('label', null, esc(st.label)));
          const r = document.createElement('input'); r.type = 'range';
          const v = n.settings[st.id];
          if (st.log) { r.min = 0; r.max = 1000; r.step = 1; r.value = Math.round(1000 * Math.log(v / st.min) / Math.log(st.max / st.min)); }
          else { r.min = st.min; r.max = st.max; r.step = st.step; r.value = v; }
          const val = el('span', 'v', fmtSetting(v, st));
          r.addEventListener('input', function () {
            let nv = st.log ? st.min * Math.pow(st.max / st.min, r.value / 1000) : +r.value;
            if (st.log) nv = +nv.toPrecision(3);
            n.settings[st.id] = nv; val.textContent = fmtSetting(nv, st);
            refresh(false);   // the sim, routing probabilities and bin targets all read from V.ev, so this is immediate
          });
          row.appendChild(r); row.appendChild(val); d.appendChild(row);
        });
        box.appendChild(d);
      });
    }
    function renderStatuses() {
      V.ev.nodes.forEach(function (inf, k) {
        const n = V.line[k], e = statusEls[k]; if (!e) return;
        const bad = inf.warnings.filter(function (w) { return w.level === 'bad'; }).length, warn = inf.warnings.filter(function (w) { return w.level === 'warn'; }).length;
        let st = '', cls = '';
        if (bad) { st = bad + ' FAULT' + (bad > 1 ? 'S' : ''); cls = 'bad'; }
        else if (warn) { st = warn + ' WARN'; cls = 'warn'; }
        else if (inf.kind === 'separator') st = Math.round(100 * Sim.streamMass(V.ev.ports[n.uid + ':extract']) / Math.max(inf.inKg, 1e-9)) + '% OUT';
        else if (inf.kind === 'conditioner') st = '-30 C';
        else st = inf.ratio > 1.05 ? inf.ratio.toFixed(1) + ':1' : 'PASS';
        if (V.mr.limiter && V.mr.limiter.uid === n.uid) st += ' ◄';
        e.textContent = st; e.className = 'st ' + cls;
        e.title = inf.warnings.map(function (w) { return w.text; }).join('\n');
      });
    }

    /* ---- readouts and bins table ---- */
    function renderReadouts() {
      const R = headRate(), P = plantPower(R), rev = revenuePerT();
      const lim = V.mr.limiter ? (nodeIndex(V.mr.limiter.uid) + 1) + ' ' + V.mr.limiter.why : 'none';
      const kwhT = Score ? Score.plantKwhT(V.ev, R, V.line) : (R > 0 ? P / R : Infinity);
      const head = V.ev.head, f80 = Sim.percentile(Sim.aggregate(head));
      $('#plant-readouts').innerHTML = ro('HEAD RATE', fmtNum(R, 1), 't/h') + ro('BOTTLENECK', esc(lim).toUpperCase(), '', V.mr.limiter && V.mr.limiter.why === 'worn out' ? 'bad' : '') + ro('PLANT POWER', fmtNum(P, 0), 'kW') +
        ro('PLANT ENERGY', isFinite(kwhT) ? fmtNum(kwhT, 1) : '--', 'kWh/t') + ro('PRODUCT VALUE', fmtMoney(rev), '/t', 'good') + ro('BATCH', fmtNum(V.done, 1) + ' / ' + V.tons, 't');
      $('#t-rate').textContent = fmtNum(R, 1) + ' t/h'; $('#t-power').textContent = fmtNum(P, 0) + ' kW'; $('#t-value').textContent = fmtMoney(rev) + '/t';
      const F = FEEDS[V.feedId];
      $('#feed-info').innerHTML = 'Feed F80 <b class="num">' + fmtSize(f80) + '</b>' + (F ? ' &middot; ' + esc(F.blurb) + ' &middot; ' + (F.cost < 0 ? 'paid ' + fmtMoney(-F.cost) + '/t to take it' : 'costs ' + fmtMoney(F.cost) + '/t') : ' &middot; custom mix from the saved game') + ' &middot; batch ' + V.tons + ' t';
    }
    function renderBins() {
      const box = $('#bins'); box.innerHTML = '';
      const list = V.binsInfo.filter(function (b) { return Sim.binMatters(b.st); }).sort(function (a, b) { return b.st.total - a.st.total; });
      if (!list.length) box.appendChild(el('div', 'empty', 'Nothing comes out yet.'));
      list.forEach(function (b) {
        const st = b.st, k = nodeIndex(b.uid), M = k >= 0 ? MACHINES[V.line[k].m] : null;
        const name = M ? (k + 1) + ' ' + M.short + ' / ' + (M.outs ? M.outs[b.port] : b.port) : b.key;
        const comps = Object.entries(st.perMat).sort(function (x, y) { return y[1].mass - x[1].mass; });
        const rows = comps.map(function (c) { const D = MATERIALS[c[0]]; return '<div class="r"><span><i style="background:' + D.color + '"></i>' + esc(D.name) + '</span><span>' + fmtNum(c[1].mass, c[1].mass < 10 ? 1 : 0) + ' kg/t</span><span>' + Math.round(100 * c[1].mass / st.total) + '%</span></div>'; }).join('');
        const d = el('div', 'bin', '<div class="h"><b>' + esc(name.toUpperCase()) + '</b><span>' + fmtNum(st.total, 0) + ' kg/t</span></div>' +
          '<div class="comp">' + comps.map(function (c) { return '<i style="width:' + (100 * c[1].mass / st.total) + '%;background:' + MATERIALS[c[0]].color + '"></i>'; }).join('') + '</div>' +
          '<div class="brows">' + rows + '</div>' +
          '<div class="d"><span>P80 ' + fmtSize(st.p80) + ' &middot; purity ' + Math.round(st.share * 100) + '% &middot; grade ' + Math.round(st.grade * 100) + '%' + (b.temp ? ' &middot; frozen' : '') + '</span><span class="val">' + fmtMoney(st.value) + '/t</span></div>');
        d.addEventListener('click', function () { const bl = V.lay.bins.find(function (x) { return x.key === b.key; }); if (bl && R3) R3.focus(bl.x, bl.z); });
        box.appendChild(d);
      });
    }
    function refresh(structural) {
      recompute();
      renderStatuses(); renderReadouts(); renderBins();
      if (R3) R3.setTargets();
      if (structural) renderRun();
    }
    function dropKind() {
      if (V.feedId === 'elv') return 'car';
      if (V.feedId === 'pallets') return 'chair';
      if (V.feedId === 'tires') return 'tire';
      if (V.feedId === 'quarry' || V.feedId === 'rubble') return 'rock';
      if (V.feedId === 'zorba') return 'chunks';
      if (V.feedId === 'water' || V.feedId === 'lab' || V.feedId === 'gel') return 'barrel';
      let dom = null, dm = 0; for (const m in V.comp) if (V.comp[m] > dm) { dm = V.comp[m]; dom = m; }
      return { steel: 'car', castiron: 'car', wood: 'chair', rubber: 'tire', granite: 'rock', limestone: 'rock', glass: 'rock', aluminum: 'chunks', copper: 'chunks', brass: 'chunks', potmetal: 'chunks', silver: 'chunks', gold: 'chunks', gel: 'barrel', water: 'barrel', plastic: 'crate' }[dom] || 'crate';
    }

    /* ---- batch progress and the frame loop ---- */
    let last = performance.now(), fpsN = 0, fpsT = 0, fps = 0;
    function tick(now) {
      const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
      fpsN++; fpsT += dtReal; if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; $('#t-frag').textContent = (R3 ? R3.fragCount() : 0) + ' · ' + fps + ' fps'; }
      let dt = 0;
      if (V.running) {
        dt = dtReal * V.speed;
        const R = headRate();
        V.done += R * dt / 60;              // one real second is one plant minute at 1x, as in the game
        if (V.done >= V.tons) { V.done = V.tons; V.running = false; V.complete = true; renderRun(); }
        $('#prog').style.width = (100 * clamp(V.done / V.tons, 0, 1)) + '%';
        $('#plant-readouts .ro:last-child .v').textContent = fmtNum(V.done, 1) + ' / ' + V.tons;
      }
      if (R3) { R3.step(dt, dtReal); R3.frame(); }
      requestAnimationFrame(tick);
    }

    setLine(DEFAULT_LINE);
    setFeed(V.lineId !== 'mine' && LINES[V.lineId] && LINES[V.lineId].feed ? LINES[V.lineId].feed : 'elv');
    requestAnimationFrame(tick);
  }

  /* ================= three.js renderer ================= */
  function makeRenderer(canvas, wrap) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f16);
    scene.fog = new THREE.Fog(0x0a0f16, 70, 180);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight(0x9fb8d0, 0x0e1218, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(25, 40, 15); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7fe3ff, 0.18); fill.position.set(-30, 20, -20); scene.add(fill);

    /* ---- orbit camera: drag rotates, wheel zooms, right-drag or shift-drag pans ---- */
    const cam = { theta: -0.55, phi: 1.0, r: 40, target: new THREE.Vector3(12, 0, 0), goal: null };
    function applyCam() {
      const t = cam.target;
      camera.position.set(t.x + cam.r * Math.sin(cam.phi) * Math.sin(cam.theta), t.y + cam.r * Math.cos(cam.phi), t.z + cam.r * Math.sin(cam.phi) * Math.cos(cam.theta));
      camera.lookAt(t);
    }
    let drag = null;
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) { drag = { b: e.button === 2 || e.shiftKey ? 'pan' : 'rot', x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); cam.goal = null; });
    canvas.addEventListener('pointerup', function () { drag = null; });
    canvas.addEventListener('pointercancel', function () { drag = null; });          // a cancelled touch must not leave the drag set
    canvas.addEventListener('lostpointercapture', function () { drag = null; });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 'rot') { cam.theta -= dx * 0.005; cam.phi = clamp(cam.phi - dy * 0.005, 0.12, 1.5); }
      else {
        const k = cam.r * 0.0014;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      }
    });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); cam.r = wheelZoom(cam.r, e.deltaY, e.deltaMode); }, { passive: false });
    // keyboard camera: arrows orbit, + / - zoom (the canvas is focusable so this works without a mouse)
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D plant floor. Arrow keys rotate the view, plus and minus zoom.');
    canvas.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') cam.theta += 0.08;
      else if (e.key === 'ArrowRight') cam.theta -= 0.08;
      else if (e.key === 'ArrowUp') cam.phi = clamp(cam.phi - 0.06, 0.12, 1.5);
      else if (e.key === 'ArrowDown') cam.phi = clamp(cam.phi + 0.06, 0.12, 1.5);
      else if (e.key === '+' || e.key === '=') cam.r = clamp(cam.r * 0.9, 6, 150);
      else if (e.key === '-' || e.key === '_') cam.r = clamp(cam.r * 1.1, 6, 150);
      else return;
      e.preventDefault(); cam.goal = null;
    });
    // a lost WebGL context draws nothing; preventDefault lets the browser restore it, and three.js re-uploads on restore
    let ctxLost = false;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); ctxLost = true; });
    canvas.addEventListener('webglcontextrestored', function () { ctxLost = false; resize(); });
    function resize() { const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize); resize();

    /* ---- shared materials and label sprites (canvas-drawn, no files) ---- */
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x151c26, roughness: 0.9, metalness: 0.2 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.6, metalness: 0.5 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.35 });
    const FAMILY_COLOR = { 'Primary crushing': 0x4a5a6e, 'Secondary crushing': 0x4a5a6e, 'Fine crushing': 0x50607a, 'Impact shredding': 0x7a5a2c, 'Shear shredding': 0x7a5a2c, 'Fine cutting': 0x6e5a30, 'Cutting': 0x6e5a30, 'Fine grinding': 0x2f6a78, 'Hydraulic shear': 0x2c6a64, 'Conditioning': 0x4a7aa0, 'Separation': 0x3a7a5a };
    const labels = [];
    function drawLabel(sp) {
      const L = sp.userData.label, ctx = L.c.getContext('2d');
      ctx.clearRect(0, 0, 256, 96);
      ctx.fillStyle = 'rgba(7,10,15,0.78)'; ctx.fillRect(8, 8, 240, 80);
      ctx.strokeStyle = L.color; ctx.globalAlpha = 0.6; ctx.strokeRect(8.5, 8.5, 239, 79); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.fillStyle = L.color; ctx.font = '600 30px "Share Tech Mono", Consolas, monospace'; ctx.fillText(L.text, 128, 46);
      ctx.fillStyle = '#9fb0c2'; ctx.font = '17px "IBM Plex Sans", system-ui, sans-serif'; ctx.fillText(L.sub, 128, 74);
      L.tex.needsUpdate = true;
    }
    function makeLabel(text, sub, color, w) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 96;
      const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.scale.set(w || 3.6, (w || 3.6) * 96 / 256, 1); sp.renderOrder = 10;
      sp.userData.label = { c: c, tex: tex, text: text, sub: sub, color: color }; labels.push(sp); drawLabel(sp); return sp;
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { labels.forEach(drawLabel); });
    function edges(geom) { return new THREE.LineSegments(new THREE.EdgesGeometry(geom), edgeMat); }

    /* belt ribbon with uv.x in metres along the path, mitred at the bend */
    function ribbon(pts, width, y) {
      const n = pts.length, pos = [], uv = [], idx = [], dirs = []; let dist = 0;
      for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], L = Math.hypot(dx, dz) || 1; dirs.push([dx / L, dz / L, L]); }
      for (let i = 0; i < n; i++) {
        const d0 = dirs[Math.max(0, i - 1)], d1 = dirs[Math.min(n - 2, i)];
        let tx = d0[0] + d1[0], tz = d0[1] + d1[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const sc = width / 2 / Math.max(0.5, tx * d1[0] + tz * d1[1]);
        const nx = -tz * sc, nz = tx * sc;
        pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
        uv.push(dist, 0, dist, 1);
        if (i < n - 1) dist += dirs[i][2];
      }
      for (let i = 0; i < n - 1; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    }
    const beltMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, base: { value: new THREE.Color(0x1a2029) }, stripe: { value: new THREE.Color(0x2c3b4d) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float t; uniform vec3 base; uniform vec3 stripe; varying vec2 vUv; void main() { float s = step(0.55, fract(vUv.x * 0.8 - t * 0.8)); float e = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y)); vec3 c = mix(base, stripe, s); c = mix(base * 0.45, c, e); gl_FragColor = vec4(c, 1.0); }',
      side: THREE.DoubleSide
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.9, metalness: 0.3 });

    /* ---- scene objects, rebuilt per line ---- */
    let plant = null, lay = null, machines = [], binObjs = [], roomBuilt = false, room = null;
    const matColor = {}; for (const m in MATERIALS) matColor[m] = new THREE.Color(MATERIALS[m].color);
    const frostCol = new THREE.Color(0xdff4ff);

    function buildRoom(b) {
      if (room) { scene.remove(room); disposeAll(room); }
      room = new THREE.Group();
      const W = (b.xMax - b.xMin) + 24, Dp = (b.zMax - b.zMin) + 24, cx = (b.xMin + b.xMax) / 2, cz = (b.zMin + b.zMax) / 2;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshStandardMaterial({ color: 0x0c121a, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -0.02, cz); room.add(floor);
      const grid = new THREE.GridHelper(Math.max(W, Dp), Math.round(Math.max(W, Dp) / 2), 0x2a3a4b, 0x182230); grid.position.set(cx, 0, cz); room.add(grid);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f1720, roughness: 1, side: THREE.DoubleSide });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W, 9), wallMat); back.position.set(cx, 4.5, cz - Dp / 2); room.add(back);
      const left = new THREE.Mesh(new THREE.PlaneGeometry(Dp, 9), wallMat); left.rotation.y = Math.PI / 2; left.position.set(cx - W / 2, 4.5, cz); room.add(left);
      const trimMat = new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.35 });
      const trim1 = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, 0.08), trimMat); trim1.position.set(cx, 6.5, cz - Dp / 2 + 0.05); room.add(trim1);
      const trim2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, Dp), trimMat); trim2.position.set(cx - W / 2 + 0.05, 6.5, cz); room.add(trim2);
      scene.add(room); roomBuilt = true;
    }
    function disposeAll(obj) {
      obj.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== beltMat && o.material !== darkMat && o.material !== steelMat && o.material !== edgeMat && o.material !== frameMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    }

    function makeMachine(nd) {
      const M = MACHINES[nd.m], g = new THREE.Group(); g.position.set(nd.x, 0, nd.z);
      const bodyGeom = new THREE.BoxGeometry(nd.w, nd.h, nd.d);
      const body = new THREE.Mesh(bodyGeom, new THREE.MeshStandardMaterial({ color: FAMILY_COLOR[M.cat] || 0x4a5a6e, roughness: 0.7, metalness: 0.3 }));
      body.position.y = 0.3 + nd.h / 2; g.add(body);
      const e = edges(bodyGeom); e.position.copy(body.position); g.add(e);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(nd.w + 0.4, 0.3, nd.d + 0.4), darkMat); plinth.position.y = 0.15; g.add(plinth);
      // inlet chute at belt height on the -X face, outlet on the +X face
      const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, BELT_W + 0.3), steelMat); inlet.position.set(-nd.w / 2 - 0.2, BELT_Y + 0.3, 0); g.add(inlet);
      const outlet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, nd.d * 0.9), steelMat); outlet.position.set(nd.w / 2 + 0.15, BELT_Y + 0.1, 0); g.add(outlet);
      let spin = null;
      if (M.kind === 'comminution') {
        spin = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, nd.w * 0.7, 12), steelMat); spin.rotation.z = Math.PI / 2; spin.position.y = 0.3 + nd.h + 0.4; spin.userData.axis = 'x';
        const bear = new THREE.Mesh(new THREE.BoxGeometry(nd.w * 0.8, 0.3, 0.6), darkMat); bear.position.y = 0.3 + nd.h + 0.1; g.add(bear);
      } else if (M.kind === 'separator') {
        spin = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, nd.d * 0.8, 12), steelMat); spin.rotation.x = Math.PI / 2; spin.position.set(-nd.w / 2 + 0.3, 0.3 + nd.h + 0.45, 0); spin.userData.axis = 'z';
      } else {
        spin = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.15, 16), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.4, metalness: 0.4 })); spin.position.y = 0.3 + nd.h + 0.1; spin.userData.axis = 'y';
      }
      if (spin) { spin.add(edges(spin.geometry)); g.add(spin); }
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0x5cffb1 })); lamp.position.set(nd.w / 2 - 0.3, 0.3 + nd.h + 0.15, nd.d / 2 - 0.3); g.add(lamp);
      const lab = makeLabel((nd.index + 1) + ' ' + M.short, M.name, '#7fe3ff'); lab.position.y = 0.3 + nd.h + 1.9; g.add(lab);
      g.userData = { spin: spin, lamp: lamp, nd: nd };
      return g;
    }
    function makeBin(b, idx) {
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.7, metalness: 0.5 });
      const t = 0.08;
      [[b.w, b.h, t, 0, b.d / 2 - t / 2], [b.w, b.h, t, 0, -b.d / 2 + t / 2], [t, b.h, b.d, b.w / 2 - t / 2, 0], [t, b.h, b.d, -b.w / 2 + t / 2, 0]].forEach(function (s) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), wallMat); m.position.set(s[3], b.h / 2, s[4]); g.add(m);
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.1, b.d), darkMat); base.position.y = 0.05; g.add(base);
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, b.h, b.d)), new THREE.LineBasicMaterial({ color: 0xffb25c, transparent: true, opacity: 0.5 })); rim.position.y = b.h / 2; g.add(rim);
      const layers = [];
      for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(b.w - 2 * t - 0.04, 1, b.d - 2 * t - 0.04), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.95 })); m.visible = false; g.add(m); layers.push(m); }
      const lab = makeLabel(b.label.toUpperCase().slice(0, 14), 'bin ' + (idx + 1), '#ffb25c', 3.0); lab.position.y = b.h + 1.3; g.add(lab);
      g.userData = { b: b, layers: layers, fill: 0, target: 0, comps: [], label: lab };
      return g;
    }
    function makeHopper(h) {
      const g = new THREE.Group(); g.position.set(h.x, 0, h.z);
      const funnelGeom = new THREE.CylinderGeometry(h.w * 0.62, 0.55, h.h - 0.3, 4, 1, true);
      const funnel = new THREE.Mesh(funnelGeom, new THREE.MeshStandardMaterial({ color: 0x5a4320, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }));
      funnel.rotation.y = Math.PI / 4; funnel.position.y = 0.3 + (h.h - 0.3) / 2; g.add(funnel);
      const e = edges(funnelGeom); e.rotation.y = Math.PI / 4; e.position.copy(funnel.position); g.add(e);
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, h.h, 0.15), steelMat); leg.position.set(c[0] * h.w * 0.42, h.h / 2, c[1] * h.d * 0.42); g.add(leg); });
      const chute = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, BELT_W + 0.2), steelMat); chute.position.set(h.w / 2 + 0.1, BELT_Y + 0.1, 0); g.add(chute);
      const lab = makeLabel('FEED', 'intake hopper', '#5cffb1'); lab.position.y = h.h + 1.6; g.add(lab);
      return g;
    }

    /* ---- fragments: one instanced box, coloured per material, scaled by size ---- */
    const fragMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.2 }), MAX_FRAG);
    fragMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fragMesh.frustumCulled = false;
    const dummy = new THREE.Object3D(), tmpCol = new THREE.Color();
    for (let i = 0; i < MAX_FRAG; i++) { dummy.position.set(0, -10, 0); dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix(); fragMesh.setMatrixAt(i, dummy.matrix); fragMesh.setColorAt(i, tmpCol.set(0x808080)); }
    fragMesh.instanceMatrix.needsUpdate = true; fragMesh.instanceColor.needsUpdate = true;
    scene.add(fragMesh);
    const frags = []; for (let i = 0; i < MAX_FRAG; i++) frags.push({ alive: false });
    let aliveCount = 0, beltsFrom = {}, beltTravel = 0, spawnAcc = 0;
    function visSize(mm) { return 0.08 + 0.3 * clamp((Math.log10(Math.max(mm, 1e-4)) + 2) / 5, 0, 1); }
    function pickMaterial() {
      let tot = 0; for (const m in V.comp) tot += V.comp[m] > 0 ? V.comp[m] : 0;
      let r = Math.random() * tot; for (const m in V.comp) { if (!(V.comp[m] > 0)) continue; r -= V.comp[m]; if (r <= 0) return m; }
      for (const m in V.comp) if (V.comp[m] > 0) return m; return null;
    }
    function spawnFragment() {
      if (aliveCount >= MAX_FRAG) return;
      const feedBelts = beltsFrom.feed; if (!feedBelts || !feedBelts.length) return;
      const mat = pickMaterial(); if (!mat) return;
      for (let i = 0; i < MAX_FRAG; i++) {
        const f = frags[i]; if (f.alive) continue;
        const D = MATERIALS[mat];
        f.alive = true; f.mat = mat; f.mm = D.feed.p80 * (0.5 + Math.random()); f.frozen = false; f.node = -1; f.dwell = 0;
        f.belt = feedBelts[Math.floor(Math.random() * feedBelts.length)]; f.s = 0; f.jit = (Math.random() - 0.5) * (BELT_W - 0.4); f.rot = Math.random() * Math.PI;
        aliveCount++; return;
      }
    }
    /* which port a fragment leaves node k by, using the same physics the sim uses for the mass flows */
    function routeAt(k, f) {
      const node = V.line[k], M = MACHINES[node.m], inf = V.ev.nodes[k], D = MATERIALS[f.mat];
      if (M.kind === 'separator') return Math.random() < Sim.pExtract(M, node.settings, D, f.mm) ? 'extract' : 'residue';
      if (M.kind === 'furnace') { const pmf = inf && inf.perMat && inf.perMat[f.mat]; return (pmf && Math.random() < (pmf.meltFrac || 0)) ? 'product' : 'dross'; }
      if (M.kind === 'conditioner') { f.frozen = true; if (D.state === 'liquid' && D.feed.blockP80) f.mm = D.feed.blockP80 * (0.6 + 0.8 * Math.random()); return 'product'; }
      const pm = inf.perMat[f.mat];
      if (pm && pm.mass > 0 && Math.random() < pm.rejMass / pm.mass) return 'rejects';
      if (pm && pm.P80 > 0) f.mm = Math.min(f.mm, pm.P80 * (0.6 + 0.8 * Math.random()));
      return 'product';
    }
    function stepFragments(dt) {
      for (let i = 0; i < MAX_FRAG; i++) {
        const f = frags[i]; if (!f.alive) continue;
        if (f.node >= 0) {
          f.dwell -= dt; if (f.dwell > 0) continue;
          const port = routeAt(f.node, f), list = beltsFrom[V.line[f.node].uid + ':' + port];
          if (!list || !list.length) { f.alive = false; aliveCount--; continue; }
          f.belt = list[Math.floor(Math.random() * list.length)]; f.s = 0; f.node = -1;
          continue;
        }
        f.s += BELT_SPEED * dt;
        if (f.s >= f.belt.len) {
          if (f.belt.to.uid != null) { f.node = nodeIndex(f.belt.to.uid); f.dwell = 0.5; if (f.node < 0) { f.alive = false; aliveCount--; } }
          else { const bo = binObjs[f.belt.to.bin]; if (bo) bo.userData.pulse = 1; f.alive = false; aliveCount--; }
        }
      }
    }
    function drawFragments() {
      for (let i = 0; i < MAX_FRAG; i++) {
        const f = frags[i];
        if (!f.alive || f.node >= 0) { dummy.position.set(0, -10, 0); dummy.scale.set(0.001, 0.001, 0.001); }
        else {
          const p = beltPoint(f.belt, f.s), sz = visSize(f.mm);
          dummy.position.set(p.x - p.dz * f.jit, BELT_Y + 0.04 + sz / 2, p.z + p.dx * f.jit);
          dummy.rotation.set(0, f.rot, 0); dummy.scale.set(sz * 1.3, sz * 0.8, sz);
          tmpCol.copy(matColor[f.mat]); if (f.frozen) tmpCol.lerp(frostCol, 0.55);
          fragMesh.setColorAt(i, tmpCol);
        }
        dummy.updateMatrix(); fragMesh.setMatrixAt(i, dummy.matrix);
      }
      fragMesh.instanceMatrix.needsUpdate = true; fragMesh.instanceColor.needsUpdate = true;
    }

    /* ---- the thing that drops into the hopper ---- */
    let dropKind = 'car', drops = [], dropT = 1.5;
    function makeDrop(kind) {
      const g = new THREE.Group();
      const mat = function (c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 }); };
      const box = function (w, h, d, c, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
      const cyl = function (r, h, c, x, y, z, rx, rz, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 10), mat(c)); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); g.add(m); return m; };
      if (kind === 'car') {
        const paint = [0xb03a3a, 0x3a6ab0, 0xd0d4d8, 0x3f8a5a, 0xe0c060][Math.floor(Math.random() * 5)];
        box(2.2, 0.5, 1.0, paint, 0, 0.55, 0); box(1.1, 0.45, 0.9, paint, -0.1, 1.0, 0);
        [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]].forEach(function (p) { cyl(0.24, 0.2, 0x2a2d33, p[0], 0.3, p[1], Math.PI / 2, 0, 12); });
      } else if (kind === 'chair') {
        box(0.8, 0.08, 0.8, 0xb98a54, 0, 0.5, 0); box(0.8, 0.7, 0.08, 0xb98a54, 0, 0.9, -0.36);
        [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].forEach(function (p) { cyl(0.04, 0.5, 0xa07a48, p[0], 0.25, p[1], 0, 0, 6); });
      } else if (kind === 'tire') {
        const m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 8, 16), mat(0x3c3f46)); m.position.y = 0.6; m.rotation.x = Math.PI / 2; g.add(m);
      } else if (kind === 'rock') {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), mat(Math.random() < 0.6 ? 0xc98f8a : 0xe3dcc6)); m.position.y = 0.6; m.rotation.set(Math.random(), Math.random(), 0); g.add(m);
      } else if (kind === 'chunks') {
        for (let i = 0; i < 6; i++) box(0.25 + Math.random() * 0.3, 0.2, 0.25 + Math.random() * 0.3, [0xcfd9e2, 0xd98a5b, 0xd9b94e, 0x9fa8a3][i % 4], (Math.random() - 0.5) * 1.2, 0.3 + i * 0.12, (Math.random() - 0.5) * 1.2);
      } else if (kind === 'barrel') {
        cyl(0.4, 1.0, 0x2f6ab0, 0, 0.5, 0, 0, 0, 14); cyl(0.42, 0.08, 0x1c3a5e, 0, 0.3, 0, 0, 0, 14); cyl(0.42, 0.08, 0x1c3a5e, 0, 0.75, 0, 0, 0, 14);
      } else {
        box(1.0, 0.8, 1.0, 0xe8695a, 0, 0.4, 0);
      }
      return g;
    }
    function spawnDrop() {
      if (!lay) return;
      const g = makeDrop(dropKind); g.position.set(lay.hopper.x + (Math.random() - 0.5) * 0.6, lay.hopper.h + 5.5, lay.hopper.z + (Math.random() - 0.5) * 0.6);
      g.rotation.y = Math.random() * Math.PI * 2; g.userData = { vy: 0, spin: (Math.random() - 0.5) * 2 };
      scene.add(g); drops.push(g);
    }
    function stepDrops(dt) {
      for (let i = drops.length - 1; i >= 0; i--) {
        const g = drops[i], u = g.userData;
        u.vy -= 9.81 * dt; g.position.y += u.vy * dt; g.rotation.y += u.spin * dt;   // free fall at 1 g
        const top = lay.hopper.h;
        if (g.position.y < top) { const k = clamp((g.position.y - top + 1.2) / 1.2, 0, 1); g.scale.set(k, k, k); }
        if (g.position.y < top - 1.2) { scene.remove(g); disposeAll(g); drops.splice(i, 1); }
      }
    }

    /* ---- build the plant from a layout ---- */
    function build(L) {
      lay = L;
      if (plant) { scene.remove(plant); disposeAll(plant); labels.length = 0; }
      for (let i = drops.length - 1; i >= 0; i--) { scene.remove(drops[i]); disposeAll(drops[i]); } drops.length = 0;
      plant = new THREE.Group(); machines = []; binObjs = []; beltsFrom = {};
      buildRoom(L.bounds);
      plant.add(makeHopper(L.hopper));
      L.nodes.forEach(function (nd) { const g = makeMachine(nd); machines.push(g); plant.add(g); });
      L.bins.forEach(function (b, i) { const g = makeBin(b, i); binObjs.push(g); plant.add(g); });
      // belts: stripe ribbon, a dark frame under it and legs every 2.5 m
      let legs = 0; L.belts.forEach(function (b) { legs += Math.floor(b.len / 2.5) + 1; });
      const legMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, BELT_Y - 0.2, 0.12), frameMat, Math.max(1, legs)); let li = 0;
      L.belts.forEach(function (b) {
        const y = BELT_Y + 0.004 * (b.index % 7);   // a few millimetres apart so crossing belts do not z-fight
        const belt = new THREE.Mesh(ribbon(b.pts, BELT_W, y), beltMat); belt.userData.belt = b; plant.add(belt);
        plant.add(new THREE.Mesh(ribbon(b.pts, BELT_W + 0.3, y - 0.12), frameMat));
        for (let s = 0.6; s < b.len && li < legs; s += 2.5) { const p = beltPoint(b, s); dummy.position.set(p.x, (BELT_Y - 0.2) / 2, p.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); legMesh.setMatrixAt(li++, dummy.matrix); }
        const key = b.from === 'feed' ? 'feed' : b.from.uid + ':' + b.from.port;
        (beltsFrom[key] || (beltsFrom[key] = [])).push(b);
      });
      legMesh.count = li; legMesh.instanceMatrix.needsUpdate = true; plant.add(legMesh);
      scene.add(plant);
      const bb = L.bounds; cam.target.set((bb.xMin + bb.xMax) / 2, 0.5, (bb.zMin + bb.zMax) / 2); cam.goal = null;
      cam.r = clamp(Math.max(bb.xMax - bb.xMin, (bb.zMax - bb.zMin) * 1.6) * 0.9 + 10, 18, 120);
      clearFragments();
    }
    function clearFragments() { for (let i = 0; i < MAX_FRAG; i++) frags[i].alive = false; aliveCount = 0; spawnAcc = 0; drawFragments(); binObjs.forEach(function (g) { g.userData.fill = 0; }); }

    /* ---- targets from the sim: bin fill composition and machine lamps ---- */
    function setTargets() {
      if (!lay) return;
      const byKey = {}; V.binsInfo.forEach(function (b) { byKey[b.key] = b; });
      binObjs.forEach(function (g) {
        const b = g.userData.b, info = byKey[b.key], total = info ? info.st.total : 0;
        const show = total > 0.5; g.visible = show;
        g.userData.comps = info ? Object.entries(info.st.perMat).sort(function (x, y) { return y[1].mass - x[1].mass; }).slice(0, 6) : [];
        g.userData.total = total;
      });
      // belts to hidden bins are hidden too
      plant.traverse(function (o) { if (o.userData && o.userData.belt && o.userData.belt.to.bin != null) { const bo = binObjs[o.userData.belt.to.bin]; o.visible = !!(bo && bo.visible); } });
      V.ev.nodes.forEach(function (inf, k) {
        const g = machines[k]; if (!g) return;
        const bad = inf.warnings.some(function (w) { return w.level === 'bad'; }), warn = inf.warnings.some(function (w) { return w.level === 'warn'; });
        g.userData.lamp.material.color.set(bad ? 0xff5c6c : warn ? 0xffb25c : 0x5cffb1);
      });
    }
    function drawBins(dtReal) {
      binObjs.forEach(function (g) {
        if (!g.visible) return;
        const u = g.userData, b = u.b;
        u.target = clamp(u.total * V.done / V.capKg, 0, 1);
        u.fill += (u.target - u.fill) * Math.min(1, dtReal * 3);
        if (u.pulse > 0) u.pulse = Math.max(0, u.pulse - dtReal * 3);
        const H = (b.h - 0.14) * u.fill + 0.02 * (u.pulse || 0); let y = 0.1;
        u.layers.forEach(function (m, i) {
          const c = u.comps[i]; if (!c || H <= 0.005) { m.visible = false; return; }
          const h = H * c[1].mass / u.total; if (h < 0.004) { m.visible = false; return; }
          m.visible = true; m.scale.y = h; m.position.y = y + h / 2; y += h;
          m.material.color.copy(matColor[c[0]]);
        });
      });
    }

    let spinT = 0;
    function step(dt, dtReal) {
      if (dt > 0) {
        beltTravel += BELT_SPEED * dt; beltMat.uniforms.t.value = beltTravel;
        spawnAcc += 14 * dt; while (spawnAcc >= 1) { spawnAcc -= 1; spawnFragment(); }   // fragment rate is visual, not mass-true
        stepFragments(dt);
        dropT -= dt; if (dropT <= 0) { spawnDrop(); dropT = 2.5 + Math.random() * 2; }
        spinT += dt;
        machines.forEach(function (g) { const s = g.userData.spin; if (!s) return; const a = s.userData.axis; if (a === 'x') s.rotation.x += 4 * dt; else if (a === 'z') s.rotation.z -= 2 * dt; else s.rotation.y += 6 * dt; });
      }
      stepDrops(dt);
      drawFragments(); drawBins(dtReal);
      if (cam.goal) { cam.target.lerp(cam.goal, Math.min(1, dtReal * 4)); if (cam.target.distanceTo(cam.goal) < 0.05) cam.goal = null; }
    }
    function frame() { if (ctxLost) return; applyCam(); renderer.render(scene, camera); }
    function focus(x, z) { cam.goal = new THREE.Vector3(x, 0.8, z); if (cam.r > 30) cam.r = 24; }

    return { build: build, setTargets: setTargets, step: step, frame: frame, focus: focus, clearFragments: clearFragments, fragCount: function () { return aliveCount; }, setDropKind: function (k) { dropKind = k; } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
