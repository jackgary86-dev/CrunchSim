/* CrunchSim app: UI, run loop, telemetry, game layer (bank, ownership, upgrades), persistence. */
(function (G) {
  'use strict';
  const CS = G.CS;
  const { MATERIALS, MAT_ORDER, MACHINES, MACHINE_GROUPS, FEEDS, LINES, SOURCES, Sim, Audio } = CS;
  const { STARTER_MACHINES, START_BANK, LEVEL_MAX, LEVEL_FX, levelCost, PLANT_UPGRADES, RANKS } = CS;
  const Score = CS.Score;
  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = 'crunchsim.v2';
  /* Two game modes, each with its own save: PROGRESS (level up your plant on your own; the six-tier auction board, no
   * rivals) and RIVALS (round-based auctions against three rival yards). The last mode played is remembered. */
  const MODE_KEY = 'crunchsim.mode', MODES = ['progress', 'rivals'];
  let memMode = null;   // #254: the mode last chosen, for when localStorage throws
  function storedMode() { try { const m = localStorage.getItem(MODE_KEY); return MODES.indexOf(m) >= 0 ? m : null; } catch (e) { return memMode; } }
  function saveKey() { return S && S.mode === 'rivals' ? SAVE_KEY + '.rivals' : SAVE_KEY; }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  /* ---------------- formatting ---------------- */
  function fmtNum(x, d) { if (x == null || !isFinite(x)) return '--'; const f = Math.abs(x) >= 1000 ? 0 : (d == null ? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2) : d); return numFmt(f).format(x); }
  /* #335: one cached formatter per decimal count: toLocaleString builds a new one on every call, which was 15% of a batch's CPU */
  const NUM_FMT = {}; function numFmt(f) { return NUM_FMT[f] || (NUM_FMT[f] = new Intl.NumberFormat('en-US', { minimumFractionDigits: f, maximumFractionDigits: f })); }
  function fmtSize(mm) {
    if (mm == null || !isFinite(mm) || mm <= 0) return '--';
    if (mm >= 1000) return fmtNum(mm / 1000, 2) + ' m';
    if (mm >= 1) return fmtNum(mm, mm >= 100 ? 0 : 1) + ' mm';
    return fmtNum(mm * 1000, 0) + ' µm';
  }
  function fmtMoney(x) { return Score.fmtMoney(x); }
  function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return 'T+' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------------- state ---------------- */
  const S = {
    comp: {}, tons: 15, line: [], sel: null,
    money: START_BANK, tonnes: 0, kwh: 0, batches: 0, lifetime: 0,
    owned: new Set(STARTER_MACHINES), units: unitsFrom(STARTER_MACHINES), shelf: {}, levels: {}, plant: { logistics: 0, power: 0, market: 0, nitrogen: 0 },
    speed: 1, muted: false, clock: 0, run: null,
    feedPreset: 'elv', linePreset: 'starter', ev: null, mr: null
  };
  let cam = null, dirty = true, lastEval = 0, lastRealT = 0, cardTimer = 0;
  /* run-economics helpers (js/modules/economics.js, loaded after this file; every use is at render or run time) */
  const Eco = () => CS.Economics || null;
  function serviceCost(M, wear) { const E = Eco(); return E ? E.serviceCost(M, wear) : Math.round(M.service * Math.max(0.15, wear)); }
  const AUTO_SERVICE_AT = 0.8;   // the auto-service switch pays for new wear parts at 80% wear, where the 'service soon' warning fires

  /* ---------------- module interface ----------------
   * Feature modules live in js/modules/*.js, load after this file, and talk to the app only through CS.app.
   * Events: 'boot' (after first render), 'render' (every full render), 'batchStart' {run}, 'batchComplete' {r, why, net, bins, powerC},
   * 'tick' {dt, dh} every frame (dh = sim hours advanced this frame, 0 when idle), 'save' (return an object to persist), 'load' (object persisted).
   * Queries (modules edit the payload): 'feedCost' {id, cost}, 'plantValue' {key, value} (add to a plant upgrade value), 'assetValue' {value} (add owned assets to net worth).
   */
  const hooks = {};
  /* #314: rebuild a panel (build) without losing the player's place. While a field in it has focus (a half-typed TARGET price,
   * an open select) the rebuild waits until focus leaves the panel; a focused button gets focus back at the same place. */
  const FOCUSABLES = 'button, input, select, textarea, [tabindex]';
  function keepFocus(box, build) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (!box || !a || typeof a.tagName !== 'string' || box.contains(a) !== true) { if (box) box.csWait = null; build(); return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|button)$/.test(a.type)) {
      if (!box.csWaitHooked) { box.csWaitHooked = true; box.addEventListener('focusout', () => setTimeout(() => { const w = box.csWait; if (w && box.contains(document.activeElement) !== true) { box.csWait = null; w(); } }, 0)); }
      box.csWait = build; return;
    }
    // #330: match the rebuilt control on its stable data-focus-key (row + role); an unkeyed one only on a unique non-empty tag+type+text; never by index (a gone row must not hand focus, and the next Enter, to its neighbour)
    const fk = (x) => { const v = x && (x.getAttribute ? x.getAttribute('data-focus-key') : x.dataset && x.dataset.focusKey); return typeof v === 'string' ? v : ''; }, key = fk(a), txt = a.textContent || '';
    box.csWait = null; build();
    const now = Array.from(box.querySelectorAll(FOCUSABLES)), same = key ? now.filter((x) => fk(x) === key) : txt ? now.filter((x) => !fk(x) && x.tagName === a.tagName && x.type === a.type && x.textContent === txt) : [], b = same.length === 1 ? same[0] : null;
    if (b && !b.disabled && b.focus) b.focus({ preventScroll: true });
  }
  const API = {
    on(evt, fn) { (hooks[evt] || (hooks[evt] = [])).push(fn); if (evt === 'boot' && API.booted) fn(); },
    emit(evt, payload) { (hooks[evt] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error('module hook ' + evt, e); } }); },
    /* ask modules whether an action may proceed; the first non-empty string returned is the reason it may not */
    veto(evt, payload) { let why = ''; (hooks['veto:' + evt] || []).some((fn) => { try { why = fn(payload) || ''; } catch (e) { console.error('module veto ' + evt, e); } return !!why; }); return why; },
    /* add a panel to a column ('left' | 'right' | 'center'); returns the <section> to fill */
    addPanel(column, id, title, before) {
      const col = $('#' + column), sec = el('section', 'panel', '<h2>' + esc(title) + '</h2>'); sec.id = id;
      const ref = before ? $('#' + before) : null;
      if (ref && ref.parentElement === col) col.insertBefore(sec, ref); else col.appendChild(sec);
      return sec;
    },
    keepFocus,
    booted: false
  };
  CS.app = API;   // exposed before boot so modules loaded after this file can register hooks; boot() fills in the rest of the API
  /* #337: a panel parked in the hidden #stash (its drawer is closed) is not rebuilt on every render: whenShown(getEl, fn) wraps a
   * render function so it only marks the panel stale while hidden, and runs it once when a drawer opens */
  function panelHidden(el) { return !!(el && typeof el.closest === 'function' && el.closest('#stash')); }
  function whenShown(getEl, fn) {
    let stale = false;
    API.on('drawerOpen', () => { if (stale) { stale = false; fn(); } });
    return function () { if (panelHidden(getEl())) { stale = true; return; } stale = false; return fn.apply(this, arguments); };
  }
  API.panelHidden = panelHidden; API.whenShown = whenShown;

  /* ---------------- game-layer helpers ---------------- */
  function plantValue(key) { const U = PLANT_UPGRADES[key]; const q = { key, value: U.levels[Math.min(S.plant[key], U.levels.length - 1)] }; API.emit('plantValue', q); return q.value; }   // modules may add to a value (facility: the weighbridge adds batch tonnes)
  /* #304: the largest batch any plant can take: top feed logistics plus the top weighbridge (applyPlant clamps to this plant's own) */
  function maxTonsEver() { const top = (L) => (L && L.levels ? L.levels[L.levels.length - 1] : 0); return top(PLANT_UPGRADES.logistics) + top(CS.FACILITY_UPGRADES && CS.FACILITY_UPGRADES.weighbridge); }
  function applyPlant() {
    Sim.prices.power = plantValue('power'); Sim.prices.ln2 = plantValue('nitrogen'); Sim.prices.market = plantValue('market');
    const max = plantValue('logistics'); const r = $('#feed-tons'); r.max = max; if (S.tons > max) { S.tons = max; r.value = max; $('#feed-tons-v').textContent = S.tons + ' t'; }
  }
  /* Machines are bought per unit: each copy on the line needs its own unit (S.units[m]); S.owned keeps the types ever bought. */
  function unitsFrom(list) { const u = {}; list.forEach((m) => { u[m] = (u[m] || 0) + 1; }); return u; }
  function unitsOf(m) { return S.units && S.units[m] || 0; }
  /* is this node covered by a bought unit? the first units[m] nodes of type m on the line are */
  function nodeOwned(n) { let k = 0; for (const x of S.line) { if (x.m === n.m) { if (x === n) return k < unitsOf(n.m); k++; } } return false; }
  function syncLevels() { S.line.forEach((n) => { n.level = S.levels[n.m] || 0; }); }
  function levelOf(m) { return S.levels[m] || 0; }
  function assetValue() {
    let v = 0;
    S.owned.forEach((m) => { if (MACHINES[m]) { v += MACHINES[m].price * Math.max(1, unitsOf(m)); for (let l = 0; l < levelOf(m); l++) v += levelCost(MACHINES[m], l); } });
    for (const k in PLANT_UPGRADES) for (let l = 0; l < S.plant[k]; l++) v += PLANT_UPGRADES[k].costs[l];
    const q = { value: v }; API.emit('assetValue', q);   // modules add what they sold the player (facility and office upgrades)
    return q.value;
  }
  function netWorth() { const q = { value: 0 }; API.emit('liabilities', q); return S.money + assetValue() - q.value; }   // modules add what the yard owes (an advance)
  function rankOf(nw) { let i = 0; for (let k = 0; k < RANKS.length; k++) if (nw >= RANKS[k][0]) i = k; return { idx: i, name: RANKS[i][1], floor: RANKS[i][0], next: RANKS[i + 1] ? RANKS[i + 1][0] : null, nextName: RANKS[i + 1] ? RANKS[i + 1][1] : null }; }
  function unownedIn(line) { const cnt = {}, miss = {}; line.forEach((n) => { cnt[n.m] = (cnt[n.m] || 0) + 1; }); for (const m in cnt) { const short = cnt[m] - unitsOf(m); if (short > 0) miss[m] = short * MACHINES[m].price; } return miss; }
  function unownedCost(line) { let c = 0; const m = unownedIn(line); for (const k in m) c += m[k]; return c; }
  function spend(cost, what, credit) {   // credit: how far below zero this purchase may take the bank (Rivals bins, #171)
    if (S.money + (credit || 0) < cost) { Audio.ui('deny'); log('Not enough in the bank for ' + what + ' (' + fmtMoney(cost) + ', bank ' + fmtMoney(S.money) + ').', 'bad'); return false; }
    S.money -= cost; return true;
  }
  function buyMachine(id) {
    const M = MACHINES[id];
    if (!spend(M.price, M.name)) return false;
    S.owned.add(id); S.units[id] = unitsOf(id) + 1; Audio.ui('ok'); if (Audio.sfx) Audio.sfx('buy');   // #118
    log('Bought ' + M.name + ' for ' + fmtMoney(M.price) + (S.units[id] > 1 ? ' (unit ' + S.units[id] + ')' : '') + '.', 'ok'); checkRank(); return true;
  }
  function upgradeMachine(id) {
    const M = MACHINES[id], lvl = levelOf(id);
    if (lvl >= LEVEL_MAX) return false;
    const cost = levelCost(M, lvl);
    if (!spend(cost, M.name + ' level ' + (lvl + 1))) return false;
    S.levels[id] = lvl + 1; Audio.ui('ok'); log(M.name + ' upgraded to level ' + (lvl + 1) + ' for ' + fmtMoney(cost) + ': +' + Math.round(LEVEL_FX.cap * 100) + '% capacity, +' + Math.round(LEVEL_FX.eta * 100) + '% efficiency, +' + Math.round(LEVEL_FX.life * 100) + '% liner life.', 'ok');
    checkRank(); return true;
  }
  function buyPlant(key) {
    const U = PLANT_UPGRADES[key], lvl = S.plant[key];
    if (lvl >= U.costs.length) return false;
    if (!spend(U.costs[lvl], U.name)) return false;
    S.plant[key] = lvl + 1; applyPlant(); Audio.ui('ok');
    log(U.name + ' level ' + (lvl + 1) + ': now ' + fmtPlant(key) + '.', 'ok'); checkRank(); return true;
  }
  function fmtPlantVal(key, v) { const U = PLANT_UPGRADES[key]; return (key === 'market' ? v.toFixed(2) : key === 'logistics' ? String(v) : String(v)) + ' ' + U.unit; }
  function fmtPlant(key) { return fmtPlantVal(key, plantValue(key)); }
  let lastRankIdx = null;
  function checkRank() {
    const r = rankOf(netWorth());
    if (lastRankIdx != null && r.idx > lastRankIdx && S.mode !== 'rivals') { log('RANK UP: ' + r.name + '.', 'ok'); Audio.ui('done'); }   // #308: Rivals has no ranks
    lastRankIdx = Math.max(lastRankIdx == null ? r.idx : lastRankIdx, r.idx);   // high-water mark: a dip in net worth must not make the next climb a second RANK UP (#264)
  }

  /* Material comes only from auction lots or a re-run bucket (#57): the mix sliders and the preset list are a read-out of what
   * is loaded. Only the batch size stays in the operator's hands. */
  const AUCTION_ONLY = true;
  function setFeedLock(on) {
    on = on || AUCTION_ONLY;
    document.querySelectorAll('#feed-comp input').forEach((r) => { r.disabled = on; });
    $('#feed-preset').disabled = on;
    $('#feed-panel').classList.toggle('locked', on); $('#feed-lock').classList.toggle('hidden', !on);
  }
  /* where did the value go (#22): the three materials with the largest gap between what the feed was worth and what the
   * bins sell for, each with its cause, and the cost each node adds per tonne. Returns an HTML block for the score card. */
  function biggestLoss() {
    const E = Eco(); if (!S.ev || !E) return '';
    const rep = E.lossReport(S.ev, S.line, effRate(), Sim.prices);
    if (!rep.losses.length) return '';
    let h = '<div class="loss"><b>WHERE THE VALUE WENT</b> <span class="small">per tonne of feed</span>' +
      rep.losses.map((l, i) => '<div>' + (i + 1) + '. ' + esc(l.name) + ' <b>' + fmtMoney(l.loss) + '/t</b> <span class="cause">' + esc(l.text) + '</span></div>').join('');
    const by = rep.perNode.filter((n) => n.total > 0.5).sort((a, b) => b.total - a.total).slice(0, 4);
    if (by.length) h += '<div class="bynode">COST BY NODE · ' + by.map((n) => (n.idx + 1) + ' ' + esc(n.short) + ' ' + fmtMoney(n.total) + '/t').join(' · ') + '</div>';
    return h + '</div>';
  }
  /* what would have earned (#22): the single best next machine from the NEXT PURCHASE ranking, and its margin on this batch */
  function earnHint(r) {
    const E = Eco(); if (!E || !S.line.length || Object.keys(unownedIn(S.line)).length) return '';
    if (CS.Autorun && CS.Autorun.live && CS.Autorun.live.active()) return '';   // #336: mid-lot the card goes in 0.25 s: no NEXT PURCHASE ranking for it
    const picks = nextPurchases(); if (!picks || !picks.length) return '';
    const b = E.betterLine(picks[0], marginPerT().margin, r.done); if (!b) return '';
    const at = b.src ? S.line.findIndex((n) => n.uid === b.src.uid) : S.line.length - 1, from = S.line[at];
    const what = b.ms.map((m) => MACHINES[m].name).join(' + '), price = b.ms.reduce((c, m) => c + MACHINES[m].price, 0);
    return '<div class="hint">WHAT WOULD HAVE EARNED · ' + (b.ms.length > 1 ? '' : 'a ') + esc(what) + ' (' + fmtMoney(price) + ') on ' + (at + 1) + ':' + esc(MACHINES[from.m].short) + '/' + esc(String(b.port).toUpperCase()) + ' lifts the margin from ' + fmtMoney(b.base / Math.max(r.done, 1e-9)) + '/t to ' + fmtMoney(b.perT) + '/t: about ' + fmtMoney(b.net) + ' on this batch.</div>';
  }

  function feedCostPerT() {
    if (S.feedPrepaid) return 0; // a lot bought at auction (modules set and clear this flag)
    const p = FEEDS[S.feedPreset];
    if (p && sameComp(p.comp, S.comp)) { const q = { id: S.feedPreset, cost: p.cost }; API.emit('feedCost', q); return q.cost; }   // modules may scale a preset's price (feed market)
    let tot = 0, c = 0, n = 0;
    for (const m in S.comp) if (S.comp[m] > 0) { tot += S.comp[m]; c += S.comp[m] * MATERIALS[m].buy; n++; }
    if (tot <= 0) return 0;
    return (c / tot) * (n > 1 ? 0.45 : 1);
  }
  function sameComp(a, b) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6) return false;
    return true;
  }
  function node(uid) { return S.line.find((n) => n.uid === uid); }
  function info(uid) { return S.ev ? S.ev.nodes.find((n) => n.uid === uid) : null; }

  /* ---------------- evaluation ---------------- */
  function recompute() {
    syncLevels();
    S.ev = Sim.evalLine(S.line, S.comp, S.feedOpts);   // feedOpts: a re-run bucket's shred sizes and entry station (layout module, #41 #42)
    S.mr = Sim.maxRate(S.ev.nodes, S.line);
    dirty = false;
  }
  function effRate() { return S.mr ? S.mr.R : 0; }
  function nodePower(n) { const R = S.run ? S.run.rate : effRate(); return Math.min(n.M.prated * (1 + LEVEL_FX.power * levelOf(n.M.id)), n.M.pidle + R * n.ePerHead); }
  function plantPower() { let P = 0; for (const n of S.ev.nodes) P += nodePower(n); return P; }
  function binList() {
    if (!S.ev) return [];
    return S.ev.terminals.map((t) => {
      const st = Sim.binStats(t.stream.m, t.form); const n = info(t.uid);
      return { key: t.key, uid: t.uid, port: t.port, M: n ? n.M : null, idx: n ? n.index : -1, st, temp: t.stream.temp, form: t.form || null };
    }).filter((b) => Sim.binMatters(b.st)).sort((a, b) => b.st.total - a.st.total);
  }
  function revenuePerHeadT() { let v = 0; for (const b of binList()) v += b.st.value; return v; }

  /* ---------------- feed UI ---------------- */
  function buildFeed() {
    const sel = $('#feed-preset');
    sel.addEventListener('change', () => { if (sel.value !== 'custom') applyFeedPreset(sel.value); else S.feedPreset = 'custom'; });
    const box = $('#feed-comp'); box.innerHTML = '';
    for (const id of MAT_ORDER) {
      const D = MATERIALS[id];
      const row = el('div', 'mat', '<span class="name"><i style="background:' + D.color + '"></i>' + esc(D.name) + '</span><input type="range" min="0" max="100" step="1" value="0"><span class="pct">0%</span>');
      row.dataset.mat = id;
      const r = row.querySelector('input'); r.id = 'mat-' + id;
      r.addEventListener('input', () => { S.comp[id] = r.value / 100; S.feedPreset = 'custom'; sel.value = 'custom'; syncFeedRows(); markDirty(); });
      row.querySelector('.name').addEventListener('click', () => showMaterial(id));
      box.appendChild(row);
    }
    const tons = $('#feed-tons');
    tons.addEventListener('input', () => { S.tons = +tons.value; $('#feed-tons-v').textContent = S.tons + ' t'; renderPlant(); });
    renderFeedSelect(); syncFeedRows();
  }
  function renderFeedSelect() {
    const sel = $('#feed-preset'); sel.innerHTML = '';
    for (const id in FEEDS) {
      sel.appendChild(new Option(FEEDS[id].name, id));
    }
    sel.appendChild(new Option('Custom mix', 'custom'));
    sel.value = FEEDS[S.feedPreset] ? S.feedPreset : 'custom';
  }
  function applyFeedPreset(id) {
    S.feedPreset = id; S.comp = {}; const p = FEEDS[id];
    for (const m in p.comp) S.comp[m] = p.comp[m];
    $('#feed-preset').value = id; syncFeedRows(); markDirty();
  }
  function syncFeedRows() {
    let tot = 0; for (const m in S.comp) tot += S.comp[m] > 0 ? S.comp[m] : 0;
    document.querySelectorAll('#feed-comp .mat').forEach((row) => {
      const id = row.dataset.mat, f = S.comp[id] || 0;
      row.querySelector('input').value = Math.round(f * 100);
      row.querySelector('.pct').textContent = tot > 0 ? Math.round(100 * f / tot) + '%' : '0%';
      row.classList.toggle('on', f > 0);
    });
    $('#feed-tons').value = S.tons; $('#feed-tons-v').textContent = fmtNum(S.tons, S.tons < 10 ? 1 : 0) + ' t';
  }
  function updateFeedInfo() {
    const head = S.ev ? S.ev.head : null;
    const p80 = head ? Sim.percentile(Sim.aggregate(head)) : 0;
    const tags = new Set(); for (const m in S.comp) if (S.comp[m] > 0) MATERIALS[m].tags.slice(0, 2).forEach((t) => tags.add(t));
    const c = feedCostPerT();
    $('#feed-info').innerHTML = 'Feed F80 <b class="num">' + fmtSize(p80) + '</b> &middot; ' + (c < 0 ? 'you are <b class="num ok">paid ' + fmtMoney(-c) + '/t</b> to take it' : 'cost <b class="num">' + fmtMoney(c) + '/t</b>') + (tags.size ? ' &middot; ' + Array.from(tags).join(', ') : '');
  }
  function showMaterial(id) {
    const D = MATERIALS[id];
    $('#mat-info').innerHTML = '<b>' + esc(D.name) + '</b> <span class="small">' + esc(D.feed.form) + '</span>' +
      '<div class="props"><span>ρ ' + D.density.toFixed(2) + ' g/cc</span><span>Wi ' + D.Wi + ' kWh/t</span><span>ductility ' + Math.round(D.ductility * 100) + '%</span><span>σ ' + D.sigma + ' MS/m</span><span>' + (D.magnetic ? 'magnetic' : 'non-magnetic') + '</span><span>sells ' + fmtMoney(D.sell) + '/t</span></div>' +
      '<div class="tags">' + D.tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' + esc(D.note);
  }

  /* ---------------- flowsheet UI ---------------- */
  function buildLineUI() {
    const sel = $('#line-preset');
    sel.addEventListener('change', () => { if (sel.value !== 'custom') applyLinePreset(sel.value); else S.linePreset = 'custom'; });
    const add = $('#add-machine');
    add.addEventListener('change', renderAddButton);
    $('#btn-add').addEventListener('click', () => {
      const m = add.value, last = S.line[S.line.length - 1];
      const why = API.veto('addMachine', { m }); if (why) { Audio.ui('deny'); log(why, 'bad'); return; }
      const free = freeUnit(m);   // a unit bought just now is new: only a spare unit brings its old wear back
      if (!free && !buyMachine(m)) { renderBank(); return; }
      const src = last ? { uid: last.uid, port: primaryPort(last) } : 'feed';
      const n = Sim.makeNode(m, {}, src); if (free && Eco()) Eco().unshelve(S.shelf, n); S.line.push(n); S.sel = n.uid; S.linePreset = 'custom'; sel.value = 'custom';
      Audio.ui('click'); log('Added ' + MACHINES[m].name + ' as node ' + S.line.length + '.'); markDirty(true);
    });
    $('#btn-remove').addEventListener('click', () => {
      const n = node(S.sel); if (!n || runLocked()) return;
      const idx = S.line.indexOf(n);
      if (Eco()) Eco().shelve(S.shelf, n);   // #193: the unit keeps its wear while it is off the line
      S.line = S.line.filter((x) => x !== n);
      S.line.forEach((x) => { if (x.src && x.src !== 'feed' && x.src.uid === n.uid) x.src = n.src && n.src !== 'feed' ? { uid: n.src.uid, port: n.src.port } : 'feed'; });   // #365: the stations after it take what it was fed
      S.sel = S.line.length ? S.line[Math.min(idx, S.line.length - 1)].uid : null;
      S.linePreset = 'custom'; sel.value = 'custom'; Audio.ui('click'); log('Removed ' + MACHINES[n.m].name + ' from the line (you still own it).'); markDirty(true);
    });
    $('#btn-service').addEventListener('click', () => { const n = node(S.sel); if (n) serviceNode(n); });
    $('#btn-buy').addEventListener('click', () => { const n = node(S.sel); if (n && buyMachine(n.m)) markDirty(true); else renderBank(); });
    $('#btn-upgrade').addEventListener('click', () => { const n = node(S.sel); if (n && upgradeMachine(n.m)) markDirty(true); else renderBank(); });
    $('#m-autosvc').addEventListener('change', () => {
      const n = node(S.sel); if (!n) return; n.autoService = $('#m-autosvc').checked;
      log('Auto-service ' + (n.autoService ? 'on' : 'off') + ' for ' + MACHINES[n.m].name + (n.autoService ? ': new ' + MACHINES[n.m].wearInfo + ' are paid for at ' + Math.round(AUTO_SERVICE_AT * 100) + '% wear.' : '.')); save();
    });
    $('#m-src').addEventListener('change', () => {
      const n = node(S.sel); if (!n) return; const v = $('#m-src').value;
      if (runLocked()) { $('#m-src').value = n.src === 'feed' ? 'feed' : n.src.uid + ':' + n.src.port; return; }
      n.src = v === 'feed' ? 'feed' : { uid: +v.split(':')[0], port: v.split(':')[1] };
      S.linePreset = 'custom'; sel.value = 'custom'; markDirty(true);
    });
    renderLineSelects();
  }
  function renderLineSelects() {
    const sel = $('#line-preset'); sel.innerHTML = '';
    for (const id in LINES) {
      const L = LINES[id]; const miss = {}; L.nodes.forEach((d) => { if (!S.owned.has(d.m)) miss[d.m] = MACHINES[d.m].price; });
      let c = 0; for (const k in miss) c += miss[k];
      sel.appendChild(new Option(L.name + (c > 0 ? ' · needs ' + fmtMoney(c) + ' of machines' : ''), id));
    }
    sel.appendChild(new Option('Custom line', 'custom'));
    sel.value = LINES[S.linePreset] ? S.linePreset : 'custom';
    const add = $('#add-machine'); const curAdd = add.value; add.innerHTML = '';
    for (const [grp, ids] of MACHINE_GROUPS) {
      const og = document.createElement('optgroup'); og.label = grp;
      ids.forEach((id) => { const M = MACHINES[id]; og.appendChild(new Option(M.name + (S.owned.has(id) ? ' · ' + (unitsOf(id) > 1 ? unitsOf(id) + ' owned' : 'owned') + (levelOf(id) ? ', Lv ' + levelOf(id) : '') : ' · ' + fmtMoney(M.price)), id)); });
      add.appendChild(og);
    }
    if (curAdd && MACHINES[curAdd]) add.value = curAdd;
    renderAddButton();
  }
  function renderAddButton() {
    const m = $('#add-machine').value, b = $('#btn-add');
    if (!m || freeUnit(m)) { b.textContent = '+ ADD'; b.className = ''; }
    else { b.textContent = (unitsOf(m) ? 'BUY ANOTHER ' : 'BUY ') + fmtMoney(MACHINES[m].price); b.className = 'buy' + (S.money < MACHINES[m].price ? ' poor' : ''); }
  }
  function freeUnit(m) { return S.line.filter((x) => x.m === m).length < unitsOf(m); }
  function primaryPort(n) {
    const M = MACHINES[n.m];
    if (M.omni) { let best = 'rejects', bm = -1; MAT_ORDER.forEach((m) => { const p = S.ev && S.ev.ports[n.uid + ':' + m], k = p ? Sim.streamMass(p) : 0; if (k > bm) { bm = k; best = m; } }); return best; }   // #15: one port per material, the heaviest one
    return M.kind === 'separator' ? 'extract' : 'product';
  }
  /* #295: what lands in stock is the line at the end of the batch, so the line is fixed while a batch runs: adding, removing,
   * rewiring or retuning a station mid-batch would apply to every tonne already run */
  const RUN_LOCK = 'Stop the batch before changing the line: a change now would apply to every tonne already run.';
  let lockWarned = 0;
  function runLocked(quiet) {
    if (!S.run) return false;
    if (!quiet || Date.now() - lockWarned > 3000) { lockWarned = Date.now(); Audio.ui('deny'); log(RUN_LOCK, 'warn'); }
    return true;
  }
  API.on('veto:addMachine', () => (S.run ? RUN_LOCK : ''));
  API.on('veto:applyLine', () => (S.run ? RUN_LOCK : ''));
  function applyLinePreset(id) {
    const L = LINES[id];
    const why = API.veto('applyLine', { id, nodes: L.nodes }); if (why) { Audio.ui('deny'); log(why, 'bad'); $('#line-preset').value = LINES[S.linePreset] ? S.linePreset : 'custom'; return; }
    S.linePreset = id; const fresh = Sim.buildLine(L); S.line = Eco() ? Eco().carryWear(S.line, S.shelf, fresh) : fresh; S.sel = S.line[0].uid;
    // material comes only from lots and buckets (#57): a line preset never changes what is loaded, or it would be free feed
    if (!AUCTION_ONLY && L.feed && FEEDS[L.feed]) applyFeedPreset(L.feed);
    if (!AUCTION_ONLY && L.tons) S.tons = Math.min(L.tons, plantValue('logistics'));
    const c = unownedCost(S.line);
    if (c > 0) log('Blueprint loaded: ' + L.name + '. It uses ' + fmtMoney(c) + ' of machines you do not own yet. Buy them from the node panel to run it.', 'warn');
    $('#line-preset').value = id; syncFeedRows(); markDirty(true);
  }
  function portLabel(src) {
    if (!src || src === 'feed') return 'FEED';
    const k = S.line.findIndex((n) => n.uid === src.uid);
    return (k + 1) + ':' + MACHINES[S.line[k].m].short + '/' + src.port.toUpperCase();
  }
  function renderLine() {
    const box = $('#line-nodes'); box.innerHTML = '';
    if (!S.line.length) { box.appendChild(el('div', 'empty', 'No machines. Add one below or pick a preset line.')); return; }
    S.line.forEach((n, i) => {
      const M = MACHINES[n.m], inf = info(n.uid), owned = nodeOwned(n);
      const lim = S.mr && S.mr.limiter && S.mr.limiter.uid === n.uid;
      let st = '', stc = '';
      if (!owned) { st = 'BUY ' + fmtMoney(M.price); stc = 'bad'; }
      else if (inf) {
        const bad = inf.warnings.filter((w) => w.level === 'bad').length, warn = inf.warnings.filter((w) => w.level === 'warn').length;
        if (n.wear >= 0.999) { st = 'WORN OUT'; stc = 'bad'; }
        else if (bad) { st = bad + ' FAULT' + (bad > 1 ? 'S' : ''); stc = 'bad'; }
        else if (warn) { st = warn + ' WARN'; stc = 'warn'; }
        else if (inf.kind === 'separator') st = Math.round(100 * (Sim.streamMass(S.ev.ports[n.uid + ':extract']) / Math.max(inf.inKg, 1e-9))) + '% OUT';
        else if (inf.kind === 'conditioner') st = '-30 C';
        else if (inf.kind === 'furnace') st = inf.meltKg > 0 ? Math.round(100 * inf.purity) + '% PURE' : 'NO MELT';
        else st = inf.ratio > 1.05 ? (inf.ratio).toFixed(1) + ':1' : 'PASS';
        if (lim) st += ' ◄';
      }
      const lvl = levelOf(n.m);
      const d = el('div', 'node' + (n.uid === S.sel ? ' sel' : '') + (lim ? ' limit' : '') + (owned ? '' : ' unowned'),
        '<span class="idx">' + (i + 1) + '</span><span><div class="nm">' + esc(M.name) + (lvl ? '<span class="lvl">LV ' + lvl + '</span>' : '') + '</div><div class="src">← ' + esc(portLabel(n.src)) + '</div></span><span class="st ' + stc + '">' + esc(st) + '</span>');
      d.addEventListener('click', () => { S.sel = n.uid; Audio.ui('click'); renderAll(); });
      box.appendChild(d);
    });
  }

  /* ---------------- machine panel ---------------- */
  function renderMachine() {
    const n = node(S.sel);
    if (!n) { $('#m-name').textContent = 'No machine selected'; $('#m-settings').innerHTML = ''; $('#m-mech').innerHTML = ''; $('#m-how').textContent = 'Add a machine to the flowsheet or pick a preset line.'; $('#m-best').textContent = ''; $('#m-avoid').textContent = ''; $('#m-src').innerHTML = ''; $('#m-wear').textContent = ''; $('#btn-buy').classList.add('hidden'); $('#btn-upgrade').classList.add('hidden'); $('#m-autosvc-wrap').classList.add('hidden'); return; }
    const M = MACHINES[n.m], k = S.line.indexOf(n), owned = nodeOwned(n), lvl = levelOf(n.m);
    $('#m-name').textContent = (k + 1) + '. ' + M.name + (lvl ? ' · LV ' + lvl : '');
    const wears = owned && M.life < 1e8, fc = wears && Eco() ? Eco().wearForecast(n, info(n.uid)) : null;   // #20: head tonnes until the wear parts are gone
    $('#m-wear').innerHTML = !owned ? '<b class="bad">NOT OWNED</b>' : (wears ? 'WEAR <b class="' + (n.wear > 0.8 ? 'bad' : n.wear > 0.5 ? 'warn' : 'ok') + '">' + Math.round(n.wear * 100) + '%</b> · ' + esc(M.wearInfo) + (fc ? ' · about <b class="num">' + fmtNum(fc.toWorn, 0) + ' t</b> until worn out' : '') : '');
    $('#m-autosvc-wrap').classList.toggle('hidden', !wears); $('#m-autosvc').checked = !!n.autoService;
    $('#btn-service').disabled = !(owned && M.life < 1e8 && n.wear > 0.02);
    const bb = $('#btn-buy'); bb.textContent = (unitsOf(n.m) ? 'BUY ANOTHER ' : 'BUY ') + fmtMoney(M.price); bb.className = 'buy' + (owned ? ' hidden' : '') + (S.money < M.price ? ' poor' : '');
    const bu = $('#btn-upgrade');
    if (!owned) bu.className = 'buy hidden';
    else if (lvl >= LEVEL_MAX) { bu.textContent = 'MAX LEVEL'; bu.className = 'buy max'; bu.disabled = true; }
    else { const c = levelCost(M, lvl); bu.textContent = 'UPGRADE TO LV ' + (lvl + 1) + ' · ' + fmtMoney(c); bu.className = 'buy' + (S.money < c ? ' poor' : ''); bu.disabled = false; }
    const src = $('#m-src'); src.innerHTML = ''; src.appendChild(new Option('Head feed', 'feed'));
    for (let i = 0; i < k; i++) {
      const o = S.line[i], OM = MACHINES[o.m];
      const ports = CS.portsOf(OM);   // #279: the shared list in data.js
      ports.forEach((p) => src.appendChild(new Option((i + 1) + '. ' + OM.name + ' → ' + (OM.outs ? OM.outs[p] : p), o.uid + ':' + p)));
    }
    src.value = n.src === 'feed' ? 'feed' : n.src.uid + ':' + n.src.port;
    const box = $('#m-settings'); box.innerHTML = '';
    if (!M.settings.length) box.appendChild(el('div', 'small', 'No adjustable settings.'));
    M.settings.forEach((st) => {
      const row = el('div', 'setting'); const lab = el('label', null, esc(st.label));
      const v = n.settings[st.id];
      if (st.enum) {   // enum setting (a material id): a <select> instead of a range
        const sel = document.createElement('select'); sel.id = 'set-' + st.id;
        st.enum.forEach((id) => sel.appendChild(new Option(MATERIALS[id] ? MATERIALS[id].name : id, id)));
        sel.value = v;
        const sw = el('span', 'v', swatch(v));
        sel.addEventListener('change', () => { if (runLocked()) { sel.value = n.settings[st.id]; return; } n.settings[st.id] = sel.value; sw.innerHTML = swatch(sel.value); S.linePreset = 'custom'; $('#line-preset').value = 'custom'; markDirty(); });
        row.appendChild(lab); row.appendChild(sel); row.appendChild(sw); box.appendChild(row); return;
      }
      const r = document.createElement('input'); r.type = 'range'; r.id = 'set-' + st.id;
      if (st.log) { r.min = 0; r.max = 1000; r.step = 1; r.value = Math.round(1000 * Math.log(v / st.min) / Math.log(st.max / st.min)); }
      else { r.min = st.min; r.max = st.max; r.step = st.step; r.value = v; }
      const val = el('span', 'v', fmtSetting(v, st));
      r.addEventListener('input', () => {
        if (runLocked(true)) { const ov = n.settings[st.id]; r.value = st.log ? Math.round(1000 * Math.log(ov / st.min) / Math.log(st.max / st.min)) : ov; return; }
        let nv = st.log ? st.min * Math.pow(st.max / st.min, r.value / 1000) : +r.value;
        if (st.log) nv = +nv.toPrecision(3);
        n.settings[st.id] = nv; val.textContent = fmtSetting(nv, st); S.linePreset = 'custom'; $('#line-preset').value = 'custom'; markDirty();
      });
      row.appendChild(lab); row.appendChild(r); row.appendChild(val); box.appendChild(row);
    });
    const mech = $('#m-mech'); mech.innerHTML = '';
    if (M.mix) for (const m in M.mix) mech.appendChild(el('span', null, '<i style="width:' + Math.round(M.mix[m] * 100) + '%"></i><em>' + esc(CS.MECH_LABEL[m]) + ' ' + Math.round(M.mix[m] * 100) + '%</em>'));
    else mech.appendChild(el('span', null, '<em>' + esc(M.cat.toUpperCase()) + '</em>'));
    $('#m-how').textContent = M.how; $('#m-best').textContent = M.best; $('#m-avoid').textContent = M.avoid;
    renderLineLock();   // #313
  }
  function fmtSetting(v, st) { if (typeof v !== 'number') return MATERIALS[v] ? MATERIALS[v].name : String(v); const d = st.step < 0.1 ? 2 : st.step < 1 ? 1 : 0; return (st.log && v < 1 ? v.toPrecision(2) : v.toFixed(d)) + ' ' + st.unit; }
  function swatch(id) { const D = MATERIALS[id]; return D ? '<i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + D.color + ';vertical-align:middle" title="' + esc(D.name) + '"></i>' : ''; }

  /* ---------------- bank panel ---------------- */
  const advanceOwed = () => (API.layout && API.layout.loan ? API.layout.loan() : 0);   // #312: the yard advance still owed (layout.js)
  function renderBank() {
    const nw = netWorth(), r = rankOf(nw);
    const owe = advanceOwed();
    $('#bank-readouts').innerHTML = ro('BANK', fmtMoney(S.money), '', S.money < 0 ? 'bad' : 'good') + ro('NET WORTH', fmtMoney(nw), '') + ro('LIFETIME EARNED', fmtMoney(S.lifetime), '') + ro('PLANT VALUE', fmtMoney(assetValue()), '') + (owe > 0 ? ro('ADVANCE OWED', fmtMoney(owe), '', 'bad') : '');   // #312: the yard advance, repaid from 25% of what the yard takes in
    $('#rank-from').textContent = r.name.toUpperCase();
    $('#rank-to').textContent = r.nextName ? r.nextName.toUpperCase() + ' ' + fmtMoney(r.next) : 'TOP RANK';
    $('#rank-fill').style.width = (r.next ? clamp((nw - r.floor) / (r.next - r.floor), 0, 1) * 100 : 100) + '%';
    keepFocus($('#plant-upgrades'), renderUpgrades); keepFocus($('#next-buy'), renderNextPurchase);   // #314: a rebuild every batch must not drop focus
  }
  function renderUpgrades() {
    const pu = $('#plant-upgrades'); pu.innerHTML = '';
    for (const key in PLANT_UPGRADES) {
      const U = PLANT_UPGRADES[key], lvl = S.plant[key], maxed = lvl >= U.costs.length;
      const row = el('div', 'urow', '<span class="ic">' + U.icon + '</span><span><div class="nm">' + esc(U.name) + ' <span class="small">LV ' + lvl + '</span></div><div class="cur">' + esc(U.desc) + ' · now <b>' + esc(fmtPlant(key)) + '</b>' + (maxed ? '' : ' → ' + esc(fmtPlantVal(key, U.levels[lvl + 1]))) + '</div></span>');
      const b = document.createElement('button'); b.type = 'button'; b.dataset.focusKey = 'plant:' + key;   // #330
      if (maxed) { b.textContent = 'MAX'; b.className = 'buy max'; b.disabled = true; }
      else { b.textContent = fmtMoney(U.costs[lvl]); b.className = 'buy' + (S.money < U.costs[lvl] ? ' poor' : ''); b.addEventListener('click', () => { if (buyPlant(key)) markDirty(true); else renderBank(); }); }
      row.appendChild(b); pu.appendChild(row);
    }
  }

  /* ---------------- next purchase ----------------
   * Trial-adds each unowned separator (and the cone and jaw) after the last node of the current line and ranks them by the
   * margin they add per head-tonne. Feed cost cancels in the difference, so it is left out. Computed only here, from renderBank.
   */
  const TRIAL_MACHINES = ['sinkfloat', 'magnet', 'air', 'eddy', 'screen', 'cone', 'jaw'];
  let rankComp = null;   // the mix NEXT PURCHASE ranks against (null: the loaded feed)
  let rankOpts = null, lastRev = 0;   // #296: the feed options (re-run sizes, entry station) to rank rankComp with; the revenue of the last evaluation
  function lineMarginNoFeed(line) {
    const ev = rankComp ? Sim.evalLine(line, rankComp, rankOpts) : Sim.evalLine(line, S.comp, S.feedOpts), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
    lastRev = 0; if (!(R > 0)) return -Infinity;
    let P = 0, extra = 0, wearC = 0, rev = 0;
    ev.nodes.forEach((n) => { P += Math.min(n.M.prated * (1 + LEVEL_FX.power * levelOf(n.M.id)), n.M.pidle + R * n.ePerHead); extra += n.extraCostPerHeadT; wearC += n.wearPerHeadT * n.M.service; });
    ev.terminals.forEach((t) => { const st = Sim.binStats(t.stream.m, t.form); if (Sim.binMatters(st)) rev += st.value; });
    lastRev = rev; return rev - P / R * Sim.prices.power - extra - wearC;
  }
  /* null when the line cannot run on this feed; otherwise up to three {m, port, gain} sorted by gain */
  /* Everything must be sorted to be sold (#52), so a sorter often pays only together with a second one on its output (an
   * eddy current pulls the mixed metals, a sink-float tank then floats the aluminum out clean). Every free output port of
   * the line is tried for each candidate; when no single purchase adds margin, pairs are ranked instead.
   * Returns [{ ms: [machine ids], src: {uid, port}, port2, gain }] or null when the line cannot run. */
  function freePorts(line) {
    const out = [];
    line.forEach((n) => (MACHINES[n.m].kind === 'separator' ? ['extract', 'residue'] : ['product']).forEach((p) => {
      if (!line.some((x) => x.src && x.src !== 'feed' && x.src.uid === n.uid && x.src.port === p)) out.push({ uid: n.uid, port: p });
    }));
    return out;
  }
  /* #170: a sorter is only as good as its setting: the density of a sink-float medium decides what floats (wood 0.6, plastic
   * 0.9-1.4, glass 2.5, stone 2.65-2.7, aluminum 2.7, steel 7.8 g/cc); a drum's field what it lifts. The ranking tries these
   * and BUY & PLACE sets the winner. Pairs try a shorter list. */
  const SETTING_TRIALS = { sinkfloat: { sg: [1.0, 1.2, 1.5, 2.0, 2.45, 2.6, 2.8, 2.9, 3.2] }, magnet: { field: [100, 250, 400] } };
  const SETTING_TRIALS_PAIR = { sinkfloat: { sg: [1.0, 1.5, 2.45, 2.9] } };
  function trialSettings(m, pair) {
    const T = (pair ? SETTING_TRIALS_PAIR : SETTING_TRIALS)[m]; if (!T) return [{}];
    const k = Object.keys(T)[0]; return T[k].map((v) => ({ [k]: v }));
  }
  /* what your line would make of a mix, $ per tonne after power, consumables and wear, before the scrap's own price: the most
   * a lot (or a bin) is worth paying for. Cached per line and mix. */
  const estCache = new Map();
  /* everything about the line and the prices that changes what it makes */
  function lineKey() {
    const P = Sim.prices, pm = P.perMat || {};
    return S.line.map((n) => n.m + n.uid + JSON.stringify(n.settings) + JSON.stringify(n.src) + 'L' + levelOf(n.m) + (n.wear >= 0.999 ? 'w' : '')).join() +
      '|' + P.power + '|' + P.market + '|' + Object.keys(pm).map((m) => m + Math.round(50 * Math.log(Math.max(1e-6, +pm[m] || 1)))).join();   // #336, #355: the advice caches follow market moves in ~2% steps, not every batch's drift
  }
  function lotEstimate(comp) {
    if (!S.line.length || !comp) return null;
    const key = lineKey() + '|' + Object.keys(comp).sort().map((m) => m + (+comp[m]).toFixed(3)).join();
    if (estCache.has(key)) return estCache.get(key);
    let v = null; const keep = rankComp;
    try { rankComp = comp; const m = lineMarginNoFeed(S.line); v = isFinite(m) ? m : null; } catch (e) { v = null; } finally { rankComp = keep; }
    if (estCache.size > 200) estCache.clear();
    estCache.set(key, v); return v;
  }
  /* the best single setting change on the line for a mix: a sink-float at the wrong density floats wood and glass together,
   * a drum's field drags splinters; returns { i, uid, m, set, gain } when it adds over $1/t and 3% of the margin, else null */
  let tuneMemo = { key: '', v: null };
  /* opts: the feed options the batch will use (a re-run's sizes and entry station), so the advice is scored on what will run (#296) */
  function bestTune(comp, opts) {
    if (!comp || !S.line.length) return null;
    const key = lineKey() + '|' + JSON.stringify(comp) + '|' + JSON.stringify(opts || null);
    if (tuneMemo.key === key) return tuneMemo.v;
    let best = null; const keep = rankComp, keepO = rankOpts;
    try {
      rankComp = comp; rankOpts = opts || null;
      const base = lineMarginNoFeed(S.line), baseRev = lastRev;
      // a sorter can also be fed from another output: a water tank on the heavy side never sees the wood the air classifier
      // blew off. Only outputs of earlier stations that nothing else takes, and only a sorter that nothing downstream takes from.
      const free = freePorts(S.line), idx = (uid) => S.line.findIndex((x) => x.uid === uid);
      if (isFinite(base)) S.line.forEach((n, i) => {
        const sep = MACHINES[n.m].kind === 'separator', fed = S.line.some((x) => x.src && x.src !== 'feed' && x.src.uid === n.uid);
        const srcs = [null].concat(sep && !fed ? free.filter((p) => idx(p.uid) < i && p.uid !== n.uid) : []);
        srcs.forEach((src) => trialSettings(n.m).forEach((set) => {
          const k = Object.keys(set)[0];
          if (!src && (!k || n.settings[k] === set[k])) return;   // nothing would change
          const trial = S.line.map((x) => (x === n ? Object.assign({}, x, { settings: Object.assign({}, x.settings, set) }, src ? { src: { uid: src.uid, port: src.port } } : {}) : x));
          const gain = lineMarginNoFeed(trial) - base, revGain = lastRev - baseRev;
          // #296: the change must make more product value, not just save a starved sorter's power
          if (revGain >= 1 && gain > Math.max(1, 0.03 * Math.abs(base)) && (!best || gain > best.gain)) best = { i, uid: n.uid, m: n.m, set, src, gain };
        }));
      });
    } catch (e) { best = null; } finally { rankComp = keep; rankOpts = keepO; }
    tuneMemo = { key, v: best }; return best;
  }
  function portName(src) { const n = S.line.find((x) => x.uid === src.uid), M = n && MACHINES[n.m]; return (M && M.outs && M.outs[src.port] ? M.outs[src.port] : src.port).toLowerCase() + ' output'; }
  function applyTune(t) {
    const n = S.line.find((x) => x.uid === t.uid); if (!n || S.run) return;
    Object.assign(n.settings, t.set); S.linePreset = 'custom';
    if (t.src) n.src = { uid: t.src.uid, port: t.src.port };
    const k = Object.keys(t.set)[0], D = k && (MACHINES[n.m].settings || []).find((x) => x.id === k);
    const from = t.src ? ' now takes the ' + portName(t.src) + ' of station ' + (S.line.findIndex((x) => x.uid === t.src.uid) + 1) : '';
    log('Station ' + (t.i + 1) + ' ' + MACHINES[n.m].name + from + (k ? (from ? ', ' : ': ') + (D ? D.label.toLowerCase() : k) + ' ' + t.set[k] + (D && D.unit ? ' ' + D.unit : '') : '') + ' (+' + fmtMoney(t.gain) + '/t on this mix).', 'ok');
    Audio.ui('ok'); markDirty(true);
  }
  function nextPurchases() {
    if (!S.line.length) return [];
    // nothing loaded: rank against the richest lot on the board the bank can buy, the scrap that comes next
    rankComp = null;
    const A = CS.Auction && CS.Auction.live;
    if (!S.feedPrepaid && A && A.board) {
      const can = A.board().filter((L) => L.ask * L.tons <= S.money).sort((a, b) => b.ask * b.tons - a.ask * a.tons)[0];
      if (can) rankComp = can.declared;
    }
    const key = lineKey() + '|' + JSON.stringify(rankComp || S.comp) + '|' + (S.feedPrepaid ? JSON.stringify(S.feedOpts) : '') + '|' + Object.keys(S.units).map((m) => m + S.units[m]).join() + '|' + JSON.stringify(S.plant) + '|' + (CS.Slots && CS.Slots.live && CS.Slots.live.owned ? CS.Slots.live.owned() : '');   // slots and the hall decide what may be added
    if (npMemo.key === key) { rankComp = null; return npMemo.v; }
    try { const v = rankPurchases(); npMemo = { key, v }; return v; } finally { rankComp = null; }
  }
  let npMemo = { key: '', v: null };
  function rankPurchases() {
    const base = lineMarginNoFeed(S.line); if (!isFinite(base)) return null;
    const ports = freePorts(S.line), singles = [];
    TRIAL_MACHINES.forEach((m) => {
      if (freeUnit(m)) return;   // a spare unit is free to add; this block ranks purchases
      if (API.veto('addMachine', { m })) return;   // no slot or no floor for it (#51)
      let best = null;
      ports.forEach((src) => trialSettings(m).forEach((set) => {
        const n = Sim.makeNode(m, set, src); n.level = levelOf(m);
        const gain = lineMarginNoFeed(S.line.concat([n])) - base;
        if (!best || gain > best.gain) best = { ms: [m], src, gain, sets: [set] };
      }));
      if (best && best.gain > 0.5) singles.push(best);   // under fifty cents a tonne is noise
    });
    if (singles.length) return singles.sort((a, b) => b.gain - a.gain).slice(0, 3);
    const pairs = [], SORT = TRIAL_MACHINES.filter((m) => MACHINES[m].kind === 'separator');
    SORT.forEach((a) => SORT.forEach((b) => {
      if (API.veto('addMachine', { m: a }) || API.veto('addMachine', { m: b, pending: 1, pendingMs: [a] })) return;
      let best = null;
      ports.forEach((src) => trialSettings(a, true).forEach((sa) => {
        const na = Sim.makeNode(a, sa, src); na.level = levelOf(a);
        ['extract', 'residue'].forEach((port2) => trialSettings(b, true).forEach((sb) => {
          const nb = Sim.makeNode(b, sb, { uid: na.uid, port: port2 }); nb.level = levelOf(b);
          const gain = lineMarginNoFeed(S.line.concat([na, nb])) - base;
          if (!best || gain > best.gain) best = { ms: [a, b], src, port2, gain, sets: [sa, sb] };
        }));
      }));
      if (best && best.gain > 0.5) pairs.push(best);
    }));
    const cost = (p) => pairPrice(p) || 1;
    return pairs.sort((x, y) => cost(x) / x.gain - cost(y) / y.gain).slice(0, 3);   // pairs ranked by payback
  }
  const renderNextPurchase = whenShown(() => $('#next-buy'), renderNextPurchaseNow);   // #337
  function renderNextPurchaseNow() {
    const box = $('#next-buy'); if (!box) return; box.innerHTML = '';
    const note = (t) => box.appendChild(el('div', 'small', t));
    if (!S.line.length) { note('Build a line first. This block ranks the sorters that would add the most margin.'); return; }
    if (Object.keys(unownedIn(S.line)).length) { note('Buy the machines already on the line first.'); return; }
    const picks = nextPurchases();
    if (!picks) { note('The line cannot run on this feed, so nothing can be ranked.'); return; }
    if (!picks.length) { note('No new sorter, or pair of sorters, adds margin to this line on this feed.'); return; }
    if (picks[0].ms.length > 1) note('No single sorter pulls anything pure out of what is left: these pairs do, one sorter feeding the next.');
    picks.forEach((p) => {
      const at = S.line.findIndex((n) => n.uid === p.src.uid), from = (at + 1) + ':' + MACHINES[S.line[at].m].short + '/' + p.src.port.toUpperCase();
      const price = pairPrice(p);
      const name = p.ms.map((m) => MACHINES[m].name).join(' + ');
      const where = p.ms.length > 1 ? 'on ' + from + ', then the second on its ' + p.port2.toUpperCase() : 'on ' + from;
      const row = el('div', 'urow', '<span class="ic ok">&#9650;</span><span><div class="nm">' + esc(name) + ' <b class="ok">+' + fmtMoney(p.gain) + '/t</b></div><div class="cur">' + esc(where) + ' · pays back in ' + fmtNum(Math.ceil(price / p.gain), 0) + ' t</div></span>');
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'BUY & PLACE ' + fmtMoney(price); b.className = 'buy' + (S.money < price ? ' poor' : ''); b.title = p.ms.length > 1 ? 'Buy both and add them to the line' : 'Buy it and add it to the line';
      b.dataset.focusKey = 'buy:' + p.ms.join('+') + '@' + p.src.uid + '/' + p.src.port;   // #330: a bought pick's row is gone, so focus is not handed to the next pick
      b.addEventListener('click', () => buyAndAdd(p));
      row.appendChild(b); box.appendChild(row);
    });
  }
  /* what a NEXT PURCHASE pick costs: a unit for every machine in it beyond the spare units already owned (a pair of the same
   * sorter needs two) */
  function pairPrice(p) {
    const need = {}; p.ms.forEach((m) => { need[m] = (need[m] || 0) + 1; });
    let c = 0; for (const m in need) c += Math.max(0, need[m] - Math.max(0, unitsOf(m) - S.line.filter((x) => x.m === m).length)) * MACHINES[m].price;
    return c;
  }
  function buyAndAdd(p) {
    for (let i = 0; i < p.ms.length; i++) { const why = API.veto('addMachine', { m: p.ms[i], pending: i, pendingMs: p.ms.slice(0, i) }); if (why) { Audio.ui('deny'); log(why, 'bad'); return; } }   // pending: the pair's first sorter is not on the line yet
    const price = pairPrice(p);
    if (S.money < price) { Audio.ui('deny'); log('Not enough in the bank: ' + fmtMoney(price) + ' needed.', 'bad'); renderBank(); return; }
    const need = {}; p.ms.forEach((m) => { need[m] = (need[m] || 0) + 1; });
    const spare = {}; for (const m in need) spare[m] = Math.max(0, unitsOf(m) - S.line.filter((x) => x.m === m).length);   // only a spare unit has old wear to bring back (#229)
    for (const m in need) { let buy = need[m] - Math.max(0, unitsOf(m) - S.line.filter((x) => x.m === m).length); while (buy-- > 0) if (!buyMachine(m)) { renderBank(); return; } }
    const sets = p.sets || [];
    const na = Sim.makeNode(p.ms[0], sets[0] || {}, p.src); if (Eco() && spare[p.ms[0]]-- > 0) Eco().unshelve(S.shelf, na); S.line.push(na);
    let last = na;
    if (p.ms[1]) { last = Sim.makeNode(p.ms[1], sets[1] || {}, { uid: na.uid, port: p.port2 }); if (Eco() && spare[p.ms[1]]-- > 0) Eco().unshelve(S.shelf, last); S.line.push(last); }
    S.sel = last.uid; S.linePreset = 'custom';
    const setText = (m, st) => { const d = st && Object.keys(st)[0]; const D = d && (MACHINES[m].settings || []).find((x) => x.id === d); return D ? ' (' + D.label.toLowerCase() + ' ' + st[d] + (D.unit ? ' ' + D.unit : '') + ')' : ''; };
    Audio.ui('click'); log('Added ' + p.ms.map((m, i) => MACHINES[m].name + setText(m, sets[i])).join(' and ') + ' to the line.'); markDirty(true);
  }

  /* ---------------- telemetry ---------------- */
  function ro(lbl, v, u, cls) { return '<div class="ro ' + (cls || '') + '"><span class="lbl">' + lbl + '</span><span class="v">' + v + '</span><span class="u">' + (u || '') + '</span></div>'; }
  function renderTelemetry() {
    const n = node(S.sel), inf = n ? info(n.uid) : null;
    $('#tele-node').textContent = n ? MACHINES[n.m].short : '';
    if (!inf) { $('#readouts').innerHTML = ''; $('#mat-table').innerHTML = ''; $('#warnings').innerHTML = ''; drawPSD(null); return; }
    const M = inf.M, R = S.run ? S.run.rate : effRate(), flow = R * inf.flowAcc, cap = inf.capTph > 0 ? flow / inf.capTph : 0;
    const P = nodePower(inf);
    let h = '';
    if (inf.kind === 'separator') {
      const ex = Sim.streamMass(S.ev.ports[n.uid + ':extract']), tot = inf.inKg || 1;
      h += ro('TO EXTRACT', Math.round(100 * ex / tot), '%', 'good') + ro('TO RESIDUE', Math.round(100 - 100 * ex / tot), '%') + ro('FEED P80', fmtSize(inf.F80), '');
    } else if (inf.kind === 'conditioner') {
      h += ro('OUTLET', '-30', '°C', 'good') + ro('CHILL ENERGY', fmtNum(inf.eT, 1), 'kWh/t', 'hi') + ro('FEED P80', fmtSize(inf.F80), '');
    } else if (inf.kind === 'furnace') {
      h += ro('MELT PURITY', inf.meltKg > 0 ? Math.round(100 * inf.purity) : '--', '%', inf.meltKg <= 0 ? 'bad' : inf.purity >= 0.95 ? 'good' : inf.purity >= 0.85 ? '' : 'bad') + ro('TO DROSS', Math.round(100 * inf.drossFrac), '%', inf.drossFrac > 0.2 ? 'bad' : inf.drossFrac > 0.08 ? 'hi' : '') + ro('MELT ENERGY', fmtNum(inf.eT, 0), 'kWh/t', 'hi');
    } else {
      h += ro('FEED F80', fmtSize(inf.F80), '') + ro('PRODUCT P80', fmtSize(inf.P80), '', 'good') + ro('REDUCTION', inf.ratio > 1.02 ? fmtNum(inf.ratio, 1) + ':1' : 'none', '', inf.ratio > 1.02 ? '' : 'bad');
      h += ro('SPEC. ENERGY', fmtNum(inf.eT, inf.eT >= 10 ? 1 : 2), 'kWh/t', inf.eT > 30 ? 'hi' : '');
    }
    h += ro('THROUGHPUT', fmtNum(flow, 1), 't/h') + ro('POWER DRAW', fmtNum(P, 0), 'kW', P > 0.9 * M.prated ? 'hi' : '') + ro('CAPACITY USED', Math.round(cap * 100), '%', cap > 0.98 ? 'hi' : '');
    if (inf.ln2PerHeadT > 0 && inf.flowAcc > 0) h += ro('LIQUID N2', fmtNum(inf.ln2PerHeadT / inf.flowAcc / 1000, 2), 'kg/kg', 'hi');
    if (inf.flowRej > 1e-6) h += ro('SCALPED OFF', Math.round(100 * inf.flowRej / Math.max(inf.flowIn, 1e-9)), '%', 'bad');
    $('#readouts').innerHTML = h;
    let t = '<div class="r h"><span>MATERIAL</span><span>FEED</span><span>' + (inf.kind === 'separator' ? 'EXTRACT' : inf.kind === 'conditioner' ? 'kWh/t' : inf.kind === 'furnace' ? 'TO INGOT' : 'RESPONSE') + '</span><span>' + (inf.kind === 'comminution' || inf.kind === 'furnace' ? 'kWh/t' : '') + '</span></div>';
    const rows = Object.keys(inf.perMat).map((m) => [m, inf.perMat[m]]).sort((a, b) => b[1].mass - a[1].mass);
    for (const [m, pm] of rows) {
      const D = MATERIALS[m], share = Math.round(100 * pm.mass / Math.max(inf.inKg, 1e-9));
      if (share < 1 && rows.length > 6) continue;
      let c3 = '', c4 = '';
      if (inf.kind === 'separator') c3 = '<span class="bar"><i style="width:' + Math.round(pm.extractFrac * 100) + '%"></i></span>';
      else if (inf.kind === 'conditioner') c3 = fmtNum(pm.E, 1);
      else if (inf.kind === 'furnace') { c3 = '<span class="bar"><i class="' + (pm.meltFrac < 0.3 ? 'lo' : pm.meltFrac < 0.8 ? 'mid' : '') + '" style="width:' + Math.round(pm.meltFrac * 100) + '%"></i></span>'; c4 = pm.accMass > 0 ? fmtNum(pm.E, 0) : '--'; }
      else { const r = pm.liquid && !(M.mix.hyd > 0) ? 0 : pm.resp; c3 = '<span class="bar"><i class="' + (r < 0.3 ? 'lo' : r < 0.6 ? 'mid' : '') + '" style="width:' + Math.round(r * 100) + '%"></i></span>'; c4 = pm.accMass > 0 ? fmtNum(pm.E, pm.E >= 10 ? 0 : 1) : '--'; }
      t += '<div class="r"><span><i style="display:inline-block;width:8px;height:8px;background:' + D.color + ';margin-right:5px;border-radius:2px"></i>' + esc(D.name) + '</span><span>' + share + '%</span><span>' + c3 + '</span><span>' + c4 + '</span></div>';
    }
    $('#mat-table').innerHTML = t;
    $('#warnings').innerHTML = inf.warnings.map((w) => '<div class="w ' + w.level + '">' + esc(w.text) + '</div>').join('');
    drawPSD(inf);
  }

  function drawPSD(inf) {
    const cv = $('#psd'), r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(150 * dpr); }
    const ctx = cv.getContext('2d'), W = r.width, H = 150; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const x0 = 34, x1 = W - 8, y0 = 10, y1 = H - 22, NB = Sim.NB;
    const lx = (mm) => x0 + (Math.log10(mm) + 3) / 6 * (x1 - x0);
    ctx.strokeStyle = '#1e2a37'; ctx.lineWidth = 1; ctx.font = '10px "Share Tech Mono", monospace'; ctx.fillStyle = '#7d8da0'; ctx.textAlign = 'center';
    ['1µm', '10µm', '100µm', '1mm', '10mm', '100mm', '1m'].forEach((lab, i) => { const x = x0 + i / 6 * (x1 - x0); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.fillText(lab, x, H - 8); });
    ctx.textAlign = 'right';
    [0, 50, 80, 100].forEach((p) => { const y = y1 - p / 100 * (y1 - y0); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(p + '%', x0 - 4, y + 3); });
    if (!inf) return;
    const inArr = Sim.aggregate(inf.inStream);
    const outKey = inf.kind === 'separator' ? 'extract' : 'product';
    const outS = S.ev.ports[inf.uid + ':' + outKey]; const outArr = outS ? Sim.aggregate(outS) : null;
    function curve(arr, col, w) {
      const c = Sim.cumCurve(arr); if (Sim.sum(arr) <= 0) return;
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let i = 0; i < NB; i++) { const x = lx(Sim.EDGE[i]), y = y1 - c[i] * (y1 - y0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
    curve(inArr, '#7d8da0', 1.5); if (outArr) curve(outArr, '#7fe3ff', 2);
    const p80 = outArr && Sim.sum(outArr) > 0 ? Sim.percentile(outArr) : inf.P80;
    if (p80 > 0) { const x = lx(p80); ctx.strokeStyle = '#ffb25c'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#ffb25c'; ctx.textAlign = x > W / 2 ? 'right' : 'left'; ctx.fillText('P80 ' + fmtSize(p80), x + (x > W / 2 ? -4 : 4), y0 + 10); }
  }

  /* ---------------- plant ---------------- */
  function marginPerT() {
    const R = S.run ? S.run.rate : effRate(), P = plantPower();
    const rev = revenuePerHeadT(), feedC = feedCostPerT();
    let extra = 0, wearC = 0; S.ev.nodes.forEach((n) => { extra += n.extraCostPerHeadT; wearC += n.wearPerHeadT * n.M.service; });
    const powerC = R > 0 ? P / R * Sim.prices.power : 0;
    return { R, P, rev, feedC, powerC, extra, wearC, margin: rev - feedC - powerC - extra - wearC };
  }
  function renderPlant() {
    if (!S.ev) return;
    const m = marginPerT();
    const lim = S.mr && S.mr.limiter ? (S.line.findIndex((n) => n.uid === S.mr.limiter.uid) + 1) + ' ' + S.mr.limiter.why : 'none';
    $('#plant-readouts').innerHTML = ro('HEAD RATE', fmtNum(m.R, 1), 't/h') + ro('BOTTLENECK', esc(lim).toUpperCase(), '', S.mr && S.mr.limiter && S.mr.limiter.why === 'worn out' ? 'bad' : '') + ro('PLANT POWER', fmtNum(m.P, 0), 'kW') +
      ro('PLANT ENERGY', fmtNum(m.R > 0 ? m.P / m.R : 0, 1), 'kWh/t') + ro('PRODUCT VALUE', fmtMoney(m.rev), '/t', 'good') + ro('MARGIN', fmtMoney(m.margin), '/t', m.margin < 0 ? 'bad' : 'good') +
      ro('EARNING RATE', fmtMoney(m.margin * m.R), '/h', m.margin < 0 ? 'bad' : 'good') + ro('THIS BATCH', fmtMoney(m.margin * S.tons), 'net', m.margin < 0 ? 'bad' : 'good') +
      ro('WEAR COST', fmtMoney(m.wearC), '/t', m.wearC > 0.1 * Math.max(m.rev, 1) ? 'hi' : '');   // #20: liners and knives consumed per tonne, priced at the service bill
    renderRunProjection(m);
    const box = $('#bins'); box.innerHTML = '';
    const bins = binList();
    if (!bins.length) box.appendChild(el('div', 'empty', 'Nothing comes out yet.'));
    bins.forEach((b) => {
      const st = b.st, comps = Object.entries(st.perMat).sort((x, y) => y[1].mass - x[1].mass), pr = Eco() ? Eco().binPricing(st, Sim.prices.market) : null;
      const name = b.M ? (b.idx + 1) + ' ' + b.M.short + ' / ' + (b.M.outs ? b.M.outs[b.port] : b.port) : b.key;
      const top = comps.slice(0, 3).map(([mm, v]) => esc(MATERIALS[mm].name) + ' ' + Math.round(100 * v.mass / st.total) + '%').join(', ');
      const d = el('div', 'bin', '<div class="h"><b>' + esc(name.toUpperCase()) + '</b><span>' + fmtNum(st.total, 0) + ' kg</span></div>' +
        '<div class="comp">' + comps.map(([mm, v]) => '<i style="width:' + (100 * v.mass / st.total) + '%;background:' + MATERIALS[mm].color + '"></i>').join('') + '</div>' +
        '<div class="d"><span>' + top + '</span></div><div class="d"><span>P80 ' + fmtSize(st.p80) + ' · purity ' + Math.round(st.share * 100) + '% · price grade ' + Math.round(st.grade * 100) + '%' + (b.temp ? ' · frozen' : '') + (b.form ? ' · ' + esc(b.form) : '') + '</span><span class="val">' + fmtMoney(st.value) + '</span></div>' +
        (pr ? '<div class="d price"><span><b>' + fmtMoney(pr.perT) + '/t</b> · ' + esc(pr.name) + ' ' + esc(pr.text) + '</span></div>' : ''));   // #19: price per tonne and the two discounts
      box.appendChild(d);
    });
  }
  /* #141: a module may name the RUN button (RUN THE LOT / STOP THE LOT when the whole lot is chosen) */
  function runLabel(on) { const f = API.runLabel; const t = typeof f === 'function' ? f(on) : ''; return t || (on ? '&#9632; STOP' : '&#9654; RUN BATCH'); }
  /* #18: the RUN BATCH button carries the projected net of this batch and turns amber, with a one-line reason in the
   * header, when the projection is negative. While a batch runs the header shows the live net instead. */
  function renderRunProjection(m) {
    if (S.run) return;
    const b = $('#btn-run'), rn = $('#run-net'), E = Eco();
    const nothing = AUCTION_ONLY && !S.feedPrepaid;   // #65: no projection for material you do not have
    const A = CS.Auction && CS.Auction.live, P = A && A.pending ? A.pending() : null, lotT = typeof API.runLabel === 'function' && API.runLabel(false) && P && S.feedOwner === 'auction' && P.tons > S.tons ? P.tons : 0;   // #316: RUN THE LOT projects the whole lot
    const pr = !nothing && E && m && S.line.length && m.R > 0 ? E.projectBatch(m, lotT || S.tons, S.ev.nodes) : null;
    b.innerHTML = runLabel(false) + (pr ? '<small class="proj">' + (pr.net >= 0 ? '+' : '') + fmtMoney(pr.net) + '</small>' : '');
    b.classList.toggle('neg', !!(pr && pr.negative)); b.title = pr && pr.reason ? pr.reason : lotT ? 'Run the whole lot, ' + fmtNum(lotT, 0) + ' t (Space)' + (pr ? ': about ' + fmtMoney(pr.net) + ' projected' : '') : 'Run a batch (Space)';
    const why = runWhy(); b.disabled = !!why; if (why) b.title = why;   // #313: RUN would refuse: say why on the button
    rn.textContent = pr && pr.reason ? pr.reason : ''; rn.className = 'num small' + (pr && pr.reason ? ' reason' : ''); rn.title = rn.textContent;
  }

  /* ---------------- log ---------------- */
  function log(msg, cls) {
    const box = $('#log'); const d = el('div', cls || '', '<span class="t">' + fmtClock(S.clock) + '</span>' + esc(msg));
    box.prepend(d); while (box.children.length > 80) box.lastChild.remove();
  }

  /* ---------------- run loop ---------------- */
  function serviceNode(n) {
    const M = MACHINES[n.m], cost = serviceCost(M, n.wear);
    if (!spend(cost, 'service on ' + M.name)) return false;
    n.wear = 0; Audio.ui('ok'); log('Serviced ' + M.name + ': new ' + M.wearInfo + ' for ' + fmtMoney(cost) + '.', 'ok'); markDirty(true); return true;
  }
  /* #299: what would make RUN refuse with the feed loaded: machines on the line the yard does not own, or a worn-out station
   * that auto-service will not fix. null when the line can start (as far as the line goes). */
  function runBlock() {
    if (!S.line.length) return null;
    const ms = Object.keys(unownedIn(S.line));
    if (ms.length) { const miss = unownedIn(S.line); return { kind: 'buy', ms, n: ms.map((m) => Math.max(1, Math.round(miss[m] / MACHINES[m].price))), cost: unownedCost(S.line) }; }   // #323: n units of each
    const n = S.line.find((x) => !x.autoService && (x.wear || 0) >= 0.999);
    if (n) return { kind: 'service', n, i: S.line.indexOf(n), cost: serviceCost(MACHINES[n.m], n.wear) };
    return null;
  }
  /* #313: why RUN would refuse now ('' when it may start, or while it is STOP): the header RUN is disabled with this as its title */
  function runWhy() {
    if (S.run || (CS.Autorun && CS.Autorun.live && CS.Autorun.live.active())) return '';
    if (!S.line.length) return 'Add at least one machine first';
    if (AUCTION_ONLY && !S.feedPrepaid) return 'Nothing is loaded: win a lot in the Auction (it waits in the yard), or RE-RUN a bucket';
    const blk = runBlock(); if (!blk) return '';
    return blk.kind === 'buy' ? 'The yard does not own ' + blk.ms.map((x) => MACHINES[x].name).join(', ') + ': buy or remove ' + (blk.ms.length > 1 ? 'them' : 'it') : 'Station ' + (blk.i + 1) + ' ' + MACHINES[blk.n.m].name + ' is worn out: service it';
  }
  /* #313: the line's controls are refused while a batch runs (runLocked): disable them and say why instead of a deny sound per click */
  function renderLineLock() {
    const on = !!S.run, t = on ? RUN_LOCK : '';
    ['#btn-remove', '#m-src'].forEach((q) => { const e = $(q); if (e) { e.disabled = on; e.title = t; } });
    const box = $('#m-settings'); if (box && box.querySelectorAll) Array.from(box.querySelectorAll('input, select')).forEach((e) => { e.disabled = on; e.title = t; });
  }
  function startRun() {
    if (S.run) { stopRun('stopped'); return; }
    if (!S.line.length) { Audio.ui('deny'); log('Add at least one machine first.', 'bad'); return; }
    const miss = unownedIn(S.line);
    if (Object.keys(miss).length) { Audio.ui('deny'); log('You do not own ' + Object.keys(miss).map((m) => MACHINES[m].name).join(', ') + ' (' + fmtMoney(unownedCost(S.line)) + '). Buy them or remove them from the line.', 'bad'); return; }
    /* #20, #201: nodes already past the auto-service point are serviced before the run, but only once the start cannot abort.
     * The checks below see the line as if serviced (a worn-out node must not block a start the service would fix); undo() puts the wear back. */
    const due = S.line.filter((nd) => nd.autoService && nd.wear >= AUTO_SERVICE_AT), wear0 = due.map((nd) => nd.wear);
    due.forEach((nd) => { nd.wear = 0; });
    recompute();
    const undo = () => { due.forEach((nd, k) => { nd.wear = wear0[k]; }); recompute(); };
    if (!(effRate() > 0)) { undo(); Audio.ui('deny'); log('The line cannot run: ' + (S.mr.limiter ? 'node ' + (S.line.findIndex((n) => n.uid === S.mr.limiter.uid) + 1) + ' is ' + S.mr.limiter.why : 'no feed is accepted') + '.', 'bad'); return; }
    let tot = 0; for (const m in S.comp) tot += S.comp[m] > 0 ? S.comp[m] : 0;
    if (tot <= 0) { undo(); Audio.ui('deny'); log('The feed is empty.', 'bad'); return; }
    { const why = API.veto('startRun', {}); if (why) { undo(); Audio.ui('deny'); log(why, 'warn'); return; } }   // modules may refuse a batch (Rivals: MISC only in a round with no bin)
    if (AUCTION_ONLY && !S.feedPrepaid) { undo(); Audio.ui('deny'); log('Nothing is loaded. Material comes only from the auction or your MISC bucket: win a lot in the Auction (it waits in the yard), or RE-RUN a bucket.', 'bad'); return; }
    const feedC = feedCostPerT() * S.tons;
    if (feedC > 0 && !spend(feedC, S.tons + ' t of feed')) { undo(); return; }
    if (feedC <= 0) S.money -= feedC;   // paid to take it
    let svcC = 0; S.line.forEach((nd, i) => { const k = due.indexOf(nd); if (k >= 0) { nd.wear = wear0[k]; svcC += autoService(nd, i); } });   // the start is going ahead: pay for the service now
    recompute();
    const proj = marginPerT();   // #18: the projection the score card compares the actual net with
    S.run = { total: S.tons, done: 0, rate: effRate(), kwh: 0, rev: 0, extra: 0, feedC, t0: S.clock, rankIdx: rankOf(netWorth()).idx, projPerT: proj.margin, serviceC: svcC, wearC: 0, perNode: {} };
    Audio.init(); Audio.ui('ok'); hideCard();
    log('Batch start: ' + fmtNum(S.tons, S.tons < 10 ? 1 : 0) + ' t of ' + (FEEDS[S.feedPreset] ? FEEDS[S.feedPreset].name : 'custom mix') + ' at ' + fmtNum(S.run.rate, 1) + ' t/h. Feed ' + (feedC < 0 ? 'pays ' + fmtMoney(-feedC) : 'costs ' + fmtMoney(feedC)) + '.', 'ok');
    S.ev.nodes.forEach((n, i) => n.warnings.forEach((w) => { if (w.level !== 'info') log('Node ' + (i + 1) + ' ' + n.M.short + ': ' + w.text, w.level); }));
    renderRunState(); renderBank(); API.emit('batchStart', { run: S.run });
  }
  function stopRun(why) {
    why = why || 'stopped';   // public API: callers may leave the reason out
    const r = S.run; if (!r) return;
    S.run = null;
    const dt = S.clock - r.t0, powerC = r.kwh * Sim.prices.power;
    // a module may take the products into inventory instead of selling them now (returns a short reason string)
    const held = API.veto('autoSell', { r, bins: binList() }); r.held = held;
    const sold = held ? 0 : r.rev, net = sold - r.feedC - powerC - r.extra - (r.serviceC || 0);   // auto-service was paid from the bank as it happened
    S.money += sold - powerC - r.extra; S.tonnes += r.done; S.kwh += r.kwh; S.batches++; S.lifetime += Math.max(0, sold - powerC - r.extra);
    log('Batch ' + why + ': ' + fmtNum(r.done, 1) + ' t in ' + fmtClock(dt).slice(2) + ' · ' + fmtNum(r.kwh, 0) + ' kWh (' + fmtNum(r.done > 0 ? r.kwh / r.done : 0, 1) + ' kWh/t) · products ' + (r.held ? 'to ' + r.held + ' worth ' : '') + fmtMoney(r.rev) + ' · power ' + fmtMoney(powerC) + (r.extra > 0 ? ' · consumables ' + fmtMoney(r.extra) : '') + (r.serviceC > 0 ? ' · auto-service ' + fmtMoney(r.serviceC) : '') + ' · net ' + fmtMoney(net) + ' to bank.', net >= 0 ? 'ok' : 'warn');
    Audio.ui(why === 'complete' ? 'done' : 'click');
    renderHold++;   // #335: the batchComplete hooks (the next lot loading, the buckets filling) ask for full renders: one at the end does
    try { API.emit('batchComplete', { r, why, net, bins: binList(), powerC }); } finally { renderHold--; }   // #298: the products land in stock first, then the rank and the card read net worth
    const before = r.rankIdx; checkRank(); const after = rankOf(netWorth());
    showCard(r, why, dt, powerC, net, after.idx > before && S.mode !== 'rivals' ? after.name : null);   // #320: Rivals has no ranks
    renderRunState(); save(); renderAll();
  }
  function stepRun(realDt) {
    const r = S.run; if (!r) return;
    const dh = realDt * S.speed / 60;             // 1 real second = 1 sim minute at 1x
    S.clock += dh * 3600;
    if (performance.now() - lastEval > 1000 || dirty) { recompute(); r.rate = effRate(); lastEval = performance.now(); }   // #338: once a second for wear drift; a change sets dirty
    if (!(r.rate > 0)) { log('Line halted: ' + (S.mr.limiter ? 'node ' + (S.line.findIndex((n) => n.uid === S.mr.limiter.uid) + 1) + ' is ' + S.mr.limiter.why : 'no flow') + '.', 'bad'); Audio.ui('alarm'); stopRun('halted'); return; }
    let tons = r.rate * dh; if (r.done + tons > r.total) tons = r.total - r.done;
    r.done += tons;
    let kwh = 0, extra = 0, wearC = 0; const E = Eco();
    S.ev.nodes.forEach((n, i) => {
      kwh += n.ePerHead * tons + n.M.pidle * dh; extra += n.extraCostPerHeadT * tons; wearC += n.wearPerHeadT * tons * n.M.service;
      if (E) E.accrue(r.perNode, n, tons, dh);   // #21: per-machine idle / process kWh, nitrogen and consumables for the score card
      const nd = S.line[i]; if (nd && n.M.life < 1e8) {
        const before = nd.wear; nd.wear = Math.min(1, nd.wear + n.wearPerHeadT * tons);
        if (before < AUTO_SERVICE_AT && nd.wear >= AUTO_SERVICE_AT) {
          if (nd.autoService) r.serviceC += autoService(nd, i);   // #20
          else log('Node ' + (i + 1) + ' ' + n.M.short + ': ' + n.M.wearInfo + ' at 80% wear. Service soon.', 'warn');
        }
        if (before < 1 && nd.wear >= 1) { log('Node ' + (i + 1) + ' ' + n.M.short + ' has worn out.', 'bad'); dirty = true; }
      }
    });
    r.kwh += kwh; r.extra += extra; r.wearC += wearC; r.rev += revenuePerHeadT() * tons;
    if (r.done >= r.total - 1e-9) stopRun('complete');
  }
  /* #20: pay for new wear parts on a node whose auto-service switch is on. Returns what was paid (0 when the bank refused). */
  function autoService(nd, i) {
    const M = MACHINES[nd.m], cost = serviceCost(M, nd.wear);
    if (!spend(cost, 'auto-service on ' + M.name)) { log('Node ' + (i + 1) + ' ' + M.short + ' stays at ' + Math.round(nd.wear * 100) + '% wear: auto-service could not be paid.', 'warn'); return 0; }
    nd.wear = 0; dirty = true;
    log('Auto-service: node ' + (i + 1) + ' ' + M.short + ' got new ' + M.wearInfo + ' for ' + fmtMoney(cost) + '.', 'ok');
    return cost;
  }
  function renderRunState() {
    const on = !!S.run;
    $('#btn-run').innerHTML = runLabel(on); $('#btn-run').classList.toggle('running', on); if (on) { $('#btn-run').classList.remove('neg'); $('#btn-run').disabled = false; }
    renderLineLock();   // #313
    if (!on && S.ev) renderRunProjection(marginPerT());
    $('#btn-stop').disabled = !on;
    const cs = $('#cam-status'); cs.classList.remove('hidden'); cs.textContent = on ? 'RUNNING' : 'STANDBY'; cs.classList.toggle('on', on); cs.classList.toggle('idle', !on);
  }
  /* #338: the header runs every frame: write a readout only when its text changed (each write re-lays out the bar) */
  function setTxt(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function renderHeader() {
    setTxt($('#clock'), fmtClock(S.clock));
    setTxt($('#money'), fmtMoney(S.money)); $('#money').classList.toggle('bad', S.money < 0);
    const owe = advanceOwed(), bl = $('#money').previousElementSibling; if (bl) { const t = owe > 0 ? 'BANK · OWE ' + fmtMoney(owe) : 'BANK'; if (bl.textContent !== t) { bl.textContent = t; bl.classList.toggle('bad', owe > 0); bl.title = owe > 0 ? 'Yard advance owed: 25% of every sale repays it, and net worth counts it as a debt' : ''; } }   // #312
    const nw = netWorth(); setTxt($('#worth'), fmtMoney(nw)); if (S.mode !== 'rivals') setTxt($('#rank'), rankOf(nw).name);   // Rivals shows the match place there (modes.js)
    setTxt($('#tonnes'), fmtNum(S.tonnes + (S.run ? S.run.done : 0), S.tonnes > 100 ? 0 : 1) + ' t');
    { const w = S.run ? (Math.round(1000 * S.run.done / S.run.total) / 10) + '%' : '0%', pg = $('#prog'); if (pg.style.width !== w) pg.style.width = w; }
    const rn = $('#run-net');
    if (S.run) { const r = S.run, net = r.rev - r.kwh * Sim.prices.power - r.extra - r.feedC - (r.serviceC || 0); rn.textContent = (net >= 0 ? '+' : '') + fmtMoney(net); rn.className = 'num small ' + (net >= 0 ? 'ok' : 'bad'); }
    /* idle: renderRunProjection owns the field (the projection's reason, or nothing) */
  }

  /* ---------------- score card ---------------- */
  function showCard(r, why, dt, powerC, net, rankUp) {
    const card = $('#scorecard');
    const bins = binList(); const best = bins.slice().sort((a, b) => b.st.value - a.st.value)[0];
    const lim = S.mr && S.mr.limiter;
    const tip = net < 0 ? 'Negative batches usually mean the wrong machine for the material, or a feed that costs more than its products sell for. Check the warnings on each node.' :
      (r.done > 0 && r.kwh / r.done > 40 ? 'Energy is eating your margin. Fine grinding and cryogenics are expensive; make sure they are earning their keep.' :
        (lim && lim.why === 'capacity' ? 'Node ' + (S.line.findIndex((n) => n.uid === lim.uid) + 1) + ' is the bottleneck. Upgrading it raises the whole line\'s throughput.' : 'Bigger batches earn more per run. Feed logistics raises the batch limit.'));
    const loss = biggestLoss(), hint = earnHint(r);
    /* #18 projected versus actual, #20 wear, #21 power and consumables by machine */
    const projNet = r.projPerT != null ? r.projPerT * r.done : null;
    const result = net + (r.held ? r.rev : 0);   // product held in stock is part of what the batch earned
    const projRow = projNet != null ? '<dt>Projected net (' + fmtMoney(r.projPerT) + '/t before the run)</dt><dd class="' + (projNet >= 0 ? 'ok' : 'bad') + '">' + fmtMoney(projNet) + '</dd><dt>Actual versus projected (the projection charges wear)</dt><dd class="' + (result - projNet >= -1 ? 'ok' : 'bad') + '">' + (result - projNet >= 0 ? '+' : '') + fmtMoney(result - projNet) + '</dd>' : '';
    const wearRow = r.wearC > 0 ? '<dt>Wear accrued (' + fmtMoney(r.done > 0 ? r.wearC / r.done : 0) + '/t, paid at service)</dt><dd class="warn">' + fmtMoney(-r.wearC) + '</dd>' : '';
    const svcRow = r.serviceC > 0 ? '<dt>Auto-service</dt><dd>' + fmtMoney(-r.serviceC) + '</dd>' : '';
    let power = '';
    if (Eco() && r.perNode && Object.keys(r.perNode).length) {
      const pt = Eco().powerTable(r.perNode, S.ev.nodes, Sim.prices);
      power = '<div class="sec">POWER &amp; CONSUMABLES BY MACHINE</div><div class="ptable"><span class="h">MACHINE</span><span class="h">IDLE kWh</span><span class="h">PROCESS kWh</span><span class="h">COST</span>' +
        pt.rows.map((x) => '<span>' + (x.idx + 1) + ' ' + esc(x.short) + '</span><span>' + fmtNum(x.idle, 0) + '</span><span>' + fmtNum(x.proc, 0) + '</span><span>' + fmtMoney(x.cost) + '</span>').join('') +
        '<span class="tot">power</span><span class="tot">' + fmtNum(pt.totals.idle, 0) + '</span><span class="tot">' + fmtNum(pt.totals.proc, 0) + '</span><span class="tot">' + fmtMoney(pt.totals.cost) + '</span>' +
        pt.extras.map((x) => '<span>' + (x.idx + 1) + ' ' + esc(x.short) + ' ' + esc(x.what) + '</span><span></span><span>' + (x.qty > 0 ? fmtNum(x.qty, 0) + ' ' + esc(x.unit) : '') + '</span><span>' + fmtMoney(x.cost) + '</span>').join('') + '</div>';
    }
    let head = '<h2>BATCH ' + esc(why.toUpperCase()) + '<span>' + fmtNum(r.done, 1) + ' t \u00b7 ' + fmtClock(dt).slice(2) + '</span></h2>';
    card.innerHTML = '<div class="card">' + head +
      (r.held
        ? '<div class="net ' + (result >= 0 ? 'ok' : 'bad') + '"><small>BATCH RESULT · CASH PLUS STOCK</small>' + (result >= 0 ? '+' : '') + fmtMoney(result) + '</div><div class="small" style="margin:-6px 0 8px">Bank ' + (net >= 0 ? '+' : '') + fmtMoney(net) + ' now · ' + fmtMoney(r.rev) + ' of product in ' + esc(r.held) + ', sell it from the end buckets or the Sell drawer</div>'
        : '<div class="net ' + (net >= 0 ? 'ok' : 'bad') + '"><small>NET TO BANK</small>' + (net >= 0 ? '+' : '') + fmtMoney(net) + '</div>') +
      '<dl><dt>' + (r.held ? 'Products to ' + esc(r.held) + ' (worth ' + fmtMoney(r.rev) + ')' : 'Products sold') + '</dt><dd class="ok">' + fmtMoney(r.held ? 0 : r.rev) + '</dd><dt>Feed</dt><dd>' + fmtMoney(-r.feedC) + '</dd><dt>Power (' + fmtNum(r.kwh, 0) + ' kWh, ' + fmtNum(r.done > 0 ? r.kwh / r.done : 0, 1) + ' kWh/t)</dt><dd>' + fmtMoney(-powerC) + '</dd>' + (r.extra > 0 ? '<dt>Consumables</dt><dd>' + fmtMoney(-r.extra) + '</dd>' : '') + svcRow + wearRow + projRow +
      (best ? '<dt>Best product</dt><dd>' + esc(best.M ? best.M.short + ' / ' + (best.M.outs ? best.M.outs[best.port] : best.port) : '') + ' · ' + fmtMoney(best.st.value) + '/t</dd>' : '') +
      '<dt>Bank</dt><dd>' + fmtMoney(S.money) + '</dd><dt>Net worth (score)</dt><dd>' + fmtMoney(netWorth()) + '</dd></dl>' + power +
      (rankUp ? '<div class="rankup">RANK UP \u00b7 ' + esc(rankUp.toUpperCase()) + '</div>' : '') +
      loss + hint +
      '<div class="tip">' + esc(tip) + ' Click to dismiss.</div></div>';
    card.classList.remove('hidden'); cardTimer = 12;
  }
  function hideCard() { $('#scorecard').classList.add('hidden'); cardTimer = 0; }

  /* ---------------- cam state ---------------- */
  function camState(uid) {   // the selected machine by default; the plant screen asks for each machine by uid
    const n = node(uid || S.sel); if (!n || !S.ev) return null;
    const inf = info(n.uid); if (!inf) return null;
    const M = MACHINES[n.m], R = S.run ? S.run.rate : 0;
    const comp = []; const inS = inf.inStream;
    for (const m in inS.m) { const k = Sim.sum(inS.m[m]); if (k > 0) comp.push([m, k]); }
    const flow = R * inf.flowAcc;
    return { M, s: n.settings, running: !!S.run && flow > 1e-6, load: clamp(inf.capTph > 0 ? flow / inf.capTph : 0, 0, 1), comp, perMat: inf.perMat, F80: inf.F80, P80: inf.P80, topMm: inf.topMm || inf.P80 * 1.5, temp: Math.max(inS.temp, M.coldLevel ? 1 : 0), kind: inf.kind };
  }

  /* ---------------- render all ---------------- */
  function markDirty(structural) { dirty = true; if (structural) renderAll(); else { recompute(); renderLine(); renderTelemetry(); renderPlant(); updateFeedInfo(); renderHeader(); } }
  let renderHold = 0;
  function renderAll() {
    if (renderHold) { dirty = true; return; }   // #335: inside a batch end; stopRun renders once when its hooks are done
    if (dirty || !S.ev) recompute();
    renderLineSelects(); renderLine(); renderMachine(); renderTelemetry(); renderPlant(); renderBank(); updateFeedInfo(); renderHeader();
    const n = node(S.sel);
    $('#cam-name').textContent = n ? MACHINES[n.m].name.toUpperCase() : 'NO MACHINE';
    $('#cam-cat').textContent = n ? MACHINES[n.m].cat.toUpperCase() + (nodeOwned(n) ? '' : ' · NOT OWNED') : 'ADD A MACHINE TO THE FLOWSHEET';
    API.emit('render');
  }

  /* ---------------- persistence ---------------- */
  function collectExt() { const ext = {}; (hooks.save || []).forEach((fn) => { try { Object.assign(ext, fn() || {}); } catch (e) { console.error('module save', e); } }); return ext; }
  /* #194: each save carries a revision. A tab that loaded revision N only writes N+1 while storage still holds N; if another
   * tab has saved since (storage holds more), this tab is stale and stops writing, so an idle tab cannot undo a busy one. */
  let loadedRev = 0, staleWarned = false;
  /* #254: when localStorage throws (private window, blocked site data) each mode's latest save is kept in memory, so a mode switch
   * keeps the game; the player is told once that nothing reaches the disk. */
  /* #283: only a read that throws (storage blocked outright) latches storageDown; a write that throws (quota, a transient error)
   * sets writeFailing, keeps the game in memory and is tried again on the next save, so one bad write does not end saving. */
  const memSaves = {}; let storageDown = false, writeFailing = false;
  function warnStorage() { log('Progress is not being saved: this browser is blocking storage. Switching modes keeps your games for now, but closing or reloading the page loses them.', 'warn'); }
  function storageFailed() { if (storageDown) return; storageDown = true; warnStorage(); }
  function readSave(key) {
    if ((storageDown || writeFailing) && memSaves[key]) return memSaves[key];   // memory holds the newer copy
    if (!storageDown) { try { return localStorage.getItem(key); } catch (e) { storageFailed(); } }
    return memSaves[key] || null;
  }
  function warnStale() { if (staleWarned) return; staleWarned = true; log('Another tab has saved this game, so this tab stopped saving. Reload the page to pick up that progress.', 'warn'); }
  function save() {
    try {
      const key = saveKey();
      let held = null;
      if (!storageDown) { try { held = localStorage.getItem(key); } catch (e) { storageFailed(); } }
      if (!storageDown && !writeFailing && CS.SaveIO && CS.SaveIO.isNewer(held, loadedRev)) { warnStale(); return; }   // #309: saveio.js may load after the first save
      loadedRev++;
      const json = JSON.stringify({ rev: loadedRev, comp: S.comp, tons: S.tons, line: S.line, sel: S.sel, money: S.money, tonnes: S.tonnes, kwh: S.kwh, batches: S.batches, lifetime: S.lifetime, owned: Array.from(S.owned), units: S.units, shelf: S.shelf, levels: S.levels, plant: S.plant, speed: S.speed, muted: S.muted, clock: S.clock, feedPreset: S.feedPreset, linePreset: S.linePreset, ext: collectExt() });
      memSaves[key] = json;
      if (!storageDown) {
        try { localStorage.setItem(key, json); if (writeFailing) { writeFailing = false; log('Saving works again.', 'ok'); } }
        catch (e) { if (!writeFailing) { writeFailing = true; log('This save did not reach the disk (the browser refused it). The game is kept in memory and saving is tried again after each batch.', 'warn'); } }
      }
    } catch (e) { storageFailed(); }
  }
  function load() {
    try {
      const d = JSON.parse(readSave(saveKey()) || 'null'); if (!d || !Array.isArray(d.line)) return false;
      loadedRev = Math.max(0, Math.floor(+d.rev) || 0); staleWarned = false;
      S.comp = d.comp || {}; S.tons = clamp(+d.tons || 15, 1, maxTonsEver());
      S.line = CS.cleanLine(d.line).map((n) => ({ uid: n.uid, m: n.m, settings: Sim.cleanSettings(n.m, n.settings), wear: clamp(+n.wear || 0, 0, 1), level: 0, src: n.src || 'feed', autoService: !!n.autoService }));   // #262: cleanLine drops bad uids and ports
      const uids = new Set(S.line.map((n) => n.uid));
      let maxUid = 0; S.line.forEach((n) => { maxUid = Math.max(maxUid, n.uid); }); while (Sim.nextUid() < maxUid) { /* advance */ }
      S.sel = uids.has(d.sel) ? d.sel : (S.line[0] ? S.line[0].uid : null);
      S.money = isFinite(+d.money) ? +d.money : START_BANK; S.tonnes = +d.tonnes || 0; S.kwh = +d.kwh || 0; S.batches = +d.batches || 0; S.lifetime = +d.lifetime || 0;
      S.owned = new Set(STARTER_MACHINES.concat((d.owned || []).filter((m) => MACHINES[m])));
      // units: saved counts, or (older saves) as many as the saved line already uses, and at least one per type owned
      S.units = {}; S.owned.forEach((m) => { S.units[m] = 1; }); S.line.forEach((n) => { if (S.owned.has(n.m)) S.units[n.m] = Math.max(S.units[n.m], S.line.filter((x) => x.m === n.m).length); });
      if (d.units && typeof d.units === 'object') for (const m in d.units) if (S.owned.has(m)) S.units[m] = clamp(Math.floor(+d.units[m] || 1), 1, 10000);   // #340: no unit is lost on reload (a big hall holds far more than 99 of a small machine)
      S.shelf = {}; for (const m in (d.shelf || {})) if (MACHINES[m] && Array.isArray(d.shelf[m])) S.shelf[m] = d.shelf[m].slice(0, 10000).map((u) => ({ wear: clamp(+(u && u.wear) || 0, 0, 1), autoService: !!(u && u.autoService) }));
      S.levels = {}; for (const k in (d.levels || {})) if (MACHINES[k]) S.levels[k] = clamp(Math.floor(+d.levels[k] || 0), 0, LEVEL_MAX);
      S.plant = { logistics: 0, power: 0, market: 0, nitrogen: 0 }; for (const k in PLANT_UPGRADES) if (d.plant && isFinite(+d.plant[k])) S.plant[k] = clamp(Math.floor(+d.plant[k]), 0, PLANT_UPGRADES[k].costs.length);
      S.speed = [1, 10, 60].includes(+d.speed) ? +d.speed : 1; S.muted = !!d.muted; S.clock = +d.clock || 0;
      S.feedPreset = d.feedPreset || 'custom'; S.linePreset = d.linePreset || 'custom';
      S.ext = d.ext && typeof d.ext === 'object' ? d.ext : {};
      S.money += retiredRefund(d);
      return true;
    } catch (e) { return false; }
  }
  /* #78: supplier contracts and the intake stockpiles are gone. An older save gets back what it paid for both, once (the
   * fields are not written again). */
  const OLD_UNLOCK = { rubble: 2500, lab: 3000, gel: 3000, tires: 6000, zorba: 14000, appliance: 2000, everything: 5000, ewaste: 20000, pins: 60000 };
  function retiredRefund(d) {
    let v = 0;
    (Array.isArray(d.suppliers) ? d.suppliers : []).forEach((f) => { v += OLD_UNLOCK[f] || 0; });
    const piles = d.ext && d.ext.intake && d.ext.intake.piles;
    if (piles && typeof piles === 'object') for (const k in piles) { const p = piles[k]; if (p && +p.t > 0 && +p.paid > 0) v += +p.paid; }
    if (d.ext) delete d.ext.intake;
    if (v > 0) setTimeout(() => { save(); log('Supplier contracts and stockpiles are retired: ' + fmtMoney(v) + ' paid for them is back in the bank.', 'ok'); }, 0);   // #100: saved at once, so the refund is never paid twice
    return v;
  }
  let resetArmed = false;
  /* Only a Rivals match can be restarted: a Progress yard is permanent (the user's call, 2026-10-06) */
  const RESTART_LABEL = 'RESTART RIVALS';
  function saveIfHidden() { if (typeof document.hidden === 'boolean' && document.hidden) save(); }   // mobile Safari skips beforeunload; pagehide and a hidden tab still fire (#264)
  function newGame() {
    const b = $('#btn-newgame');
    if (S.mode !== 'rivals') return;
    if (S.run) { Audio.ui('deny'); log('Stop the running batch before restarting the match.', 'warn'); return; }
    if (!resetArmed) { resetArmed = true; b.textContent = 'CLICK AGAIN: WIPE THIS MATCH'; b.classList.add('bad'); setTimeout(() => { resetArmed = false; b.textContent = RESTART_LABEL; b.classList.remove('bad'); }, 4000); return; }
    delete memSaves[saveKey()];
    try { localStorage.removeItem(saveKey()); } catch (e) { /* ignore */ }
    // a page reload is the cleanest reset, but inside a hosted viewer's frame a reload can land on a blank page
    let topLevel = false; try { topLevel = window.top === window; } catch (e) { topLevel = false; }
    if (topLevel) { window.removeEventListener('beforeunload', save); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', saveIfHidden); location.reload(); return; }
    softReset();
  }
  /* rebuild the whole game state in place, without reloading the page */
  function softReset() {
    if (S.run) { S.run = null; renderRunState(); }
    hideCard();
    S.comp = {}; S.tons = 15; S.line = []; S.sel = null;
    S.money = START_BANK; S.tonnes = 0; S.kwh = 0; S.batches = 0; S.lifetime = 0;
    S.feedOwner = null;
    S.owned = new Set(STARTER_MACHINES); S.units = unitsFrom(STARTER_MACHINES); S.shelf = {}; S.levels = {}; S.plant = { logistics: 0, power: 0, market: 0, nitrogen: 0 };
    S.clock = 0; S.feedPrepaid = false; S.feedOpts = null; S.ext = {};
    Sim.prices.market = 1; if (Sim.prices.perMat) Sim.prices.perMat = {};
    API.emit('load', S.ext);
    setFeedLock(false); applyPlant(); renderFeedSelect();
    $('#log').innerHTML = '';
    applyLinePreset('starter');
    lastRankIdx = rankOf(netWorth()).idx;
    if (S.mode !== 'rivals') log('New game. You own a hammermill shredder, a magnetic drum and ' + fmtMoney(START_BANK) + '. Grind the junk, sort it, sell only what is pure.', 'ok');   // #348: a Rivals match logs its own car line
    API.emit('newgame'); renderAll(); save();
    const b = $('#btn-newgame'); resetArmed = false; b.textContent = RESTART_LABEL; b.classList.remove('bad');
    // #174: a new game opens on the guided first lot, not the help (which stays one click away on ?)
  }

  /* load this mode's save into the running game, in place (no page reload): mode switches and save imports (#82) */
  function restoreSave() {
    hideCard();
    if (!load()) { softReset(); $('#help').classList.add('hidden'); return false; }
    S.feedPrepaid = false; S.feedOpts = null; S.feedOwner = null;
    Sim.prices.market = 1; if (Sim.prices.perMat) Sim.prices.perMat = {};
    API.emit('newgame'); API.emit('load', S.ext);   // modules clear their state, then restore this mode's
    setFeedLock(true); applyPlant(); renderFeedSelect(); syncFeedRows();
    $('#log').innerHTML = '';
    if (storageDown) warnStorage();   // the log was just cleared: keep the notice on screen
    lastRankIdx = rankOf(netWorth()).idx;
    setMuted(S.muted);   // the sound switch follows this game's save
    return true;
  }
  /* switch game mode in place: save this mode's game, then load the other mode's save (or start it fresh) */
  function switchMode(mode) {
    if (MODES.indexOf(mode) < 0) return;
    if (S.run) { Audio.ui('deny'); log('Finish or stop the running batch before switching modes.', 'warn'); return; }
    const first = !storedMode();
    memMode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* ignore */ }
    if (mode === S.mode && !first) return;
    if (!first) save();
    S.mode = mode;
    restoreSave();
    log('Game mode: ' + (mode === 'rivals' ? 'RIVALS. Auction rounds against three rival yards: three bins a round, four bidders, and whoever goes home without a bin runs their MISC.' : 'PROGRESS. Build your plant on your own: buy lots from the six-tier auction board and level up.'), 'ok');
    API.emit('modechange', { mode }); renderAll(); save();
  }

  /* ---------------- boot ---------------- */
  function setSpeed(v) { S.speed = v; document.querySelectorAll('.spd').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v)); }
  function setMuted(m) { S.muted = m; Audio.setMuted(m); $('#btn-mute').innerHTML = m ? '&#128263;' : '&#128266;'; $('#btn-mute').setAttribute('aria-label', m ? 'Sound is off: turn it on' : 'Sound is on: turn it off'); }

  function boot() {
    API.S = S;
    S.mode = storedMode() || 'progress';
    Object.assign(API, { S, Score, checkRank, softReset, switchMode, storedMode, hideCard, restoreSave, readSave, runLocked, runBlock, buyPlant, serviceNode, buyMachine, saveKeys: () => ({ progress: SAVE_KEY, rivals: SAVE_KEY + '.rivals', mode: MODE_KEY }), unitsOf, nodeOwned, nextPurchases, buyAndAdd, pairPrice, lotEstimate, bestTune, applyTune, portName, serviceCost, recompute, camState, info, node, netWorth, rankOf, log, save, spend, markDirty, renderAll, renderBank, renderPlant, applyFeedPreset, syncFeedRows, renderFeedSelect, binList, feedCostPerT, marginPerT, startRun, stopRun, fmtMoney, fmtNum, fmtSize, fmtClock, esc, el, ro, plantValue, levelOf,
      setFeed(comp, presetId, tons) { S.comp = Object.assign({}, comp); S.feedPreset = presetId || 'custom'; if (tons) S.tons = tons; renderFeedSelect(); syncFeedRows(); markDirty(true); } });
    const had = load();
    if (!S.ext) S.ext = {};
    API.emit('load', S.ext);
    buildFeed(); buildLineUI(); applyPlant();
    setFeedLock(true);
    if (!had) { applyLinePreset('starter'); log('Welcome to the yard. You own a hammermill shredder, a magnetic drum and ' + fmtMoney(START_BANK) + '. Only sorted material sells: the magnet pulls the steel out clean, and everything still mixed waits in MISC until you buy another sorter. Run a few batches, run a few batches, then buy your first sorter from NEXT PURCHASE in the Plant drawer (toolbar).', 'ok'); }
    else { renderFeedSelect(); syncFeedRows(); log('Session restored.', 'ok'); }
    lastRankIdx = rankOf(netWorth()).idx;
    setSpeed(S.speed); setMuted(S.muted);
    cam = new CS.Cam($('#cam'));
    cam.audioHook = (p, k) => { const st = cam.st; Audio.crunch(p.mat, k, st && st.temp > 0); };
    cam.soundHook = (kind, k) => { if (Audio.sfx) Audio.sfx(kind, k); };
    $('#btn-run').addEventListener('click', startRun);
    $('#btn-stop').addEventListener('click', () => stopRun('stopped'));
    document.querySelectorAll('.spd').forEach((b) => b.addEventListener('click', () => { setSpeed(+b.dataset.speed); Audio.ui('click'); }));
    $('#btn-mute').addEventListener('click', () => { Audio.init(); setMuted(!S.muted); save(); });
    $('#btn-help').addEventListener('click', () => $('#help').classList.remove('hidden'));
    $('#btn-help-close').addEventListener('click', () => $('#help').classList.add('hidden'));
    $('#help').addEventListener('click', (e) => { if (e.target === $('#help')) $('#help').classList.add('hidden'); });
    $('#btn-newgame').addEventListener('click', newGame);
    $('#scorecard').addEventListener('click', hideCard);
    // #353: a BUY styled 'poor' says why on hover (in Rivals a bin may still be bought on the credit line, so it stays enabled)
    document.addEventListener('mouseover', (e) => {   // #368: written fresh on each hover, only on an enabled button the bank cannot pay (a locked one keeps its own reason)
      const b = e.target && e.target.closest && e.target.closest('button.buy'); if (!b) return;
      const base = String(b.title || '').replace(/^More than the bank holds \([^)]*\)( · )?/, '');
      b.title = b.classList.contains('poor') && !b.disabled ? 'More than the bank holds (' + fmtMoney(S.money) + ')' + (base ? ' · ' + base : '') : base;
    });
    $('#sources').innerHTML = SOURCES.map((s) => '<li><a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + '</a></li>').join('');
    window.addEventListener('keydown', (e) => {
      if (!CS.hotkeyOk(e, document)) return;   // typing, a focused button, a modifier key or an open modal keeps the key (#197)
      if (document.body.classList.contains('at-title') || e.defaultPrevented) return;   // the title screen is not the game; a station already took the key
      if (e.code === 'Space') { e.preventDefault(); $('#btn-run').click(); }   // through the button, so the RUN choice (#141) applies
      else if (e.key === '1') setSpeed(1); else if (e.key === '2') setSpeed(10); else if (e.key === '3') setSpeed(60);
      else if (e.key === 'm' || e.key === 'M') { Audio.init(); setMuted(!S.muted); }
      else if (e.key === '?') $('#help').classList.toggle('hidden');
      else if (e.key === 'Escape') hideCard();   // a layer open on top took the key first (CS.Overlays)
    });
    window.addEventListener('resize', () => { cam.resize(); drawPSD(node(S.sel) ? info(S.sel) : null); });
    window.addEventListener('beforeunload', save);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', saveIfHidden);
    document.addEventListener('pointerdown', () => Audio.init(), { once: true });
    API.cam = cam;
    CS.app = API;
    renderAll(); renderRunState();
    API.booted = true; API.emit('boot');
    lastRealT = performance.now();
    let acc = 0, idleAcc = 0;
    function tick(now) {
      const dt = Math.min(hidden() ? 1 : 0.1, (now - lastRealT) / 1000); lastRealT = now;
      const clockBefore = S.clock;
      if (S.run) { stepRun(dt); acc += dt; if (acc > 0.25) { acc = 0; renderTelemetry(); renderPlant(); renderLine(); } renderHeader(); }
      else { idleAcc += dt; if (idleAcc > 0.5) { idleAcc = 0; const rb = $('#btn-run'), why = runWhy(); if (rb && rb.disabled !== !!why) { rb.disabled = !!why; if (why) rb.title = why; else if (S.ev) renderRunProjection(marginPerT()); } } }   // a lot a module loads (the yard after a reload) enables RUN
      API.emit('tick', { dt, dh: (S.clock - clockBefore) / 3600 });
      if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) hideCard(); }
      const st = camState(); cam.setState(st);
      if (cam.cv.getClientRects().length) cam.frame(document.body.classList.contains('reduce-motion') === true ? 0 : dt);   // not drawn while its station view is closed (#45)
      const stationOpen = !!(document.getElementById('station') && !document.getElementById('station').classList.contains('hidden'));
      const hs = stationOpen ? st : (S.line[0] ? camState(S.line[0].uid) : null);   // #114: the main screen hears the head of the line
      if (hs) Audio.setHum(hs.M.scene, hs.running ? (stationOpen ? 0.5 : 0.35) + 0.5 * hs.load : 0); else Audio.setHum('jaw', 0);
      if (Audio.setBelt) Audio.setBelt(S.run ? Math.min(1, 0.3 + (S.run.rate || 0) / 60) : 0);   // #116
      next();
    }
    /* animation frames stop in a background tab; a timer keeps a running batch (or a whole lot) going there */
    function hidden() { return typeof document.hidden === 'boolean' && document.hidden; }
    let gen = 0;   // one live chain: a frame or timer from an older chain stops itself
    function next() { const g = gen; if (hidden()) setTimeout(() => { if (g === gen) tick(performance.now()); }, 100); else requestAnimationFrame((t) => { if (g === gen) tick(t); }); }
    // a pending animation frame freezes when the tab hides: start a fresh chain on every visibility change
    document.addEventListener('visibilitychange', () => { lastRealT = performance.now(); gen++; next(); });
    next();
    setInterval(save, 15000);
    // another tab saved this mode's game: say so at once, not at the next timer
    window.addEventListener('storage', (e) => { if (e.key === saveKey() && CS.SaveIO && CS.SaveIO.isNewer(e.newValue, loadedRev)) warnStale(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
