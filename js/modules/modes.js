/* CrunchSim module: two games, two screens (#87).
 *
 * PROGRESS is the long-term sandbox: earn money, keep building the plant out, no end. RIVALS is a match of auction rounds
 * (twelve by default) against three yards, and the highest worth after the last round wins. Each keeps its own save.
 *
 * - A title screen on every launch shows both games with what their saves hold, and CONTINUE / START (Rivals: NEW MATCH).
 * - A MENU button in the toolbar takes you back to it (the game saves first); it replaces the old PROGRESS / RIVALS switch.
 * - The Rivals screen has its own colour, a match bar over the plant (round N of M, every yard's worth and place, the
 *   AUCTION ROUND button) and PLACE in the header instead of the rank. Jobs belong to the sandbox (layout.js hides them in Rivals).
 * The save summaries are pure (CS.Modes.summary) so tests/modes.js can check them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  /* what a stored save says about itself, for the title screen. raw: the stored JSON string (or null) */
  function summary(mode, raw) {
    let d = null; try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
    if (!d || !Array.isArray(d.line)) return { has: false };
    const played = (+d.batches || 0) > 0 || !!(d.ext && d.ext.auction && (d.ext.auction.pending || (d.ext.auction.yard || []).length)) || !!(d.ext && d.ext.round && d.ext.round.n > 0);   // #173
    if (!played) return { has: false };
    const out = { has: true, money: +d.money || 0, batches: +d.batches || 0, tonnes: +d.tonnes || 0, machines: d.line.length };
    if (mode === 'rivals') {
      const r = d.ext && d.ext.round, m = r && r.match;
      out.round = r && r.n > 0 ? Math.floor(r.n) : 0; out.length = m && m.length ? m.length : 12; out.over = !!(m && m.over);
    }
    return out;
  }
  CS.Modes = { summary, ord };

  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.modesStarted) return; app.modesStarted = true;
    const $ = (s) => document.querySelector(s), esc = (s) => app.esc(s), money = (x) => app.fmtMoney(x);
    let title = null, bar = null, lastPlace = 0;
    const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

    /* ---- the title screen's yard (#128): a crane drops scrap into a shredder, a belt carries the sorted pieces to their piles ---- */
    let yard = null;
    function yardLoop(now) {
      if (!yard || !yard.cv.isConnected || !title || title.classList.contains('hidden')) { if (yard) yard.raf = 0; return; }
      const cv = yard.cv, r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(r.width), H = Math.round(r.height);
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const still = document.body.classList.contains('reduce-motion');
      const t = still ? 2.2 : now / 1000, dt = still ? 0 : Math.min(0.05, (now - (yard.last || now)) / 1000); yard.last = now;
      const g = H * 0.96, sx = W * 0.3, sw = Math.min(90, W * 0.09), MAT = CS.MATERIALS;   // a strip along the bottom, under the cards
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#121b26'; ctx.fillRect(0, g, W, H - g);   // the yard floor
      // the shredder: hopper, body, rotor
      ctx.fillStyle = '#2a3644'; ctx.beginPath(); ctx.moveTo(sx - sw * 0.7, g - sw * 1.3); ctx.lineTo(sx + sw * 0.7, g - sw * 1.3); ctx.lineTo(sx + sw * 0.4, g - sw * 0.85); ctx.lineTo(sx - sw * 0.4, g - sw * 0.85); ctx.fill();
      ctx.fillStyle = '#1f2a36'; ctx.fillRect(sx - sw * 0.5, g - sw * 0.85, sw, sw * 0.85);
      ctx.strokeStyle = '#4a5a6c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, g - sw * 0.45, sw * 0.28, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 6; k++) { const a = t * 3 + k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(sx, g - sw * 0.45); ctx.lineTo(sx + Math.cos(a) * sw * 0.27, g - sw * 0.45 + Math.sin(a) * sw * 0.27); ctx.stroke(); }
      // the crane: mast, jib, a hook swinging in over the hopper
      const cx = W * 0.1, top = g - sw * 2.6; ctx.strokeStyle = '#3d4b5b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, g); ctx.lineTo(cx, top); ctx.lineTo(sx + sw * 0.2, top); ctx.stroke();
      const ph = (t % 6) / 6, hx = cx + (sx - cx) * (ph < 0.5 ? ph * 2 : 2 - ph * 2), hy = top + sw * 0.7;
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(hx, top); ctx.lineTo(hx, hy); ctx.stroke();
      if (ph < 0.5) { ctx.fillStyle = '#6b6f75'; ctx.fillRect(hx - 12, hy, 24, 14); }   // a load of scrap on the hook
      if (!still && ph > 0.45 && ph < 0.5 && Math.random() < 0.6) for (let k = 0; k < 3; k++) yard.drop.push({ x: hx + (Math.random() - 0.5) * 20, y: hy + 14, vy: 0, m: ['steel', 'wood', 'glass', 'copper', 'plastic', 'aluminum'][Math.floor(Math.random() * 6)] });
      yard.drop = yard.drop.filter((p) => { p.vy += 500 * dt; p.y += p.vy * dt; ctx.fillStyle = MAT[p.m].color; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); if (p.y > g - sw * 0.9) { yard.belt.push({ x: sx + sw * 0.5, m: p.m }); return false; } return true; });
      // the belt out of the shredder, carrying the pieces to a pile of each kind
      const by = g - 8; ctx.fillStyle = '#26313d'; ctx.fillRect(sx + sw * 0.5, by, W - sx - sw * 0.5, 6);
      const piles = {}; ['steel', 'wood', 'glass', 'copper', 'plastic', 'aluminum'].forEach((m, i) => { piles[m] = sx + sw + 40 + i * ((W - sx - sw - 80) / 6); });
      yard.belt = yard.belt.filter((p) => { p.x += 60 * dt; ctx.fillStyle = MAT[p.m].color; ctx.fillRect(p.x - 3, by - 6, 6, 6); if (p.x >= piles[p.m]) { yard.heaps[p.m] = Math.min(18, (yard.heaps[p.m] || 3) + 0.5); return false; } return true; });
      Object.keys(piles).forEach((m) => { const h = yard.heaps[m] || 4; ctx.fillStyle = MAT[m].color; ctx.beginPath(); ctx.moveTo(piles[m] - h * 1.4, g); ctx.quadraticCurveTo(piles[m], g - h * 2, piles[m] + h * 1.4, g); ctx.fill(); });
      ctx.globalAlpha = 1;
      if (!still) yard.raf = requestAnimationFrame(yardLoop); else yard.raf = 0;
    }
    function startYard() {
      if (!title) return;
      let cv = title.querySelector('canvas.tt-yard');
      if (!cv) { cv = document.createElement('canvas'); cv.className = 'tt-yard'; cv.setAttribute('aria-hidden', 'true'); title.insertBefore(cv, title.firstChild); }
      if (!yard || yard.cv !== cv) yard = { cv, drop: [], belt: [], heaps: {}, raf: 0, last: 0 };
      if (!yard.raf) yard.raf = requestAnimationFrame(yardLoop);
      setTimeout(() => { if (yard && !yard.last) { if (yard.raf) cancelAnimationFrame(yard.raf); yard.raf = 0; yardLoop(performance.now()); } }, 50);   // a first frame even where animation frames are paused
    }

    /* ---- the title screen ---- */
    function showTitle() {
      if (app.S.run) { app.log('Stop the running batch before going to the menu.', 'warn'); return; }
      app.save();
      const k = app.saveKeys(), P = summary('progress', read(k.progress)), R = summary('rivals', read(k.rivals)), cur = app.S.mode;
      if (!title) { title = document.createElement('div'); title.id = 'title'; title.className = 'title-screen'; document.body.appendChild(title); }
      const pLine = P.has ? 'Bank ' + money(P.money) + ' · ' + P.machines + ' machine' + (P.machines === 1 ? '' : 's') + ' · ' + app.fmtNum(P.tonnes, 0) + ' t processed' : 'No yard yet.';
      const rLine = !R.has || !R.round ? 'No match in progress.' : R.over ? 'Last match finished after ' + R.round + ' rounds.' : 'Round ' + R.round + ' of ' + R.length + ' · bank ' + money(R.money);
      title.innerHTML = '<div class="tt-box"><div class="tt-logo">CRUNCH<b>SIM</b></div><div class="tt-sub">BUY THE JUNK · GRIND IT · SORT IT · SELL IT PURE</div><div class="tt-cards">' +
        '<div class="tt-card tt-progress"><svg class="tt-ic" viewBox="0 0 48 32" aria-hidden="true"><path d="M2 30 H46" stroke="#7fe3ff" stroke-width="2"/><rect x="6" y="14" width="12" height="16" fill="#7fe3ff" opacity=".35"/><rect x="20" y="8" width="10" height="22" fill="#7fe3ff" opacity=".55"/><rect x="32" y="18" width="12" height="12" fill="#7fe3ff" opacity=".8"/><path d="M25 8 V3 H29" stroke="#7fe3ff" stroke-width="2" fill="none"/></svg><b>PROGRESS</b><p>The long game. Earn money, keep building out your plant: more sorters, bigger lots, a refinery. Nobody to beat, no end.</p><div class="tt-save">' + esc(pLine) + '</div>' +
          '<button type="button" class="primary" data-go="progress">' + (P.has ? 'CONTINUE' : 'START') + '</button></div>' +
        '<div class="tt-card tt-rivals"><svg class="tt-ic" viewBox="0 0 48 32" aria-hidden="true"><rect x="8" y="4" width="16" height="9" rx="2" fill="#ff8a5c" transform="rotate(-30 16 8)"/><path d="M18 12 L30 28" stroke="#ff8a5c" stroke-width="3" stroke-linecap="round"/><rect x="28" y="24" width="16" height="5" rx="1" fill="#ff8a5c" opacity=".6"/><circle cx="40" cy="9" r="3" fill="#ffb25c"/><circle cx="33" cy="6" r="3" fill="#5cffb1"/><circle cx="44" cy="15" r="3" fill="#7fe3ff"/></svg><b>RIVALS</b><p>A match of auction rounds against three yards. Three bins a round, four bidders. The highest worth after the last round wins.</p><div class="tt-save">' + esc(rLine) + '</div>' +
          (R.has && R.round && !R.over ? '<button type="button" class="primary" data-go="rivals">CONTINUE MATCH</button><button type="button" data-go="rivals-new">NEW MATCH</button>' : '<button type="button" class="primary" data-go="rivals-new">' + (R.has && R.over ? 'NEW MATCH' : 'START A MATCH') + '</button>') + '</div>' +
        '</div><div class="small tt-foot">Each game keeps its own save in this browser. MENU in the toolbar comes back here. <a href="#" id="tt-settings">Settings</a></div></div>';
      title.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      const ts = title.querySelector('#tt-settings'); if (ts) ts.addEventListener('click', (e) => { e.preventDefault(); showSettings(); });
      title.classList.remove('hidden'); document.body.classList.add('at-title');
      if (CS.Audio && CS.Audio.duck) CS.Audio.duck('plant', true); if (CS.Music) CS.Music.setTheme('title');   // #121: the title has only its own theme
      startYard();
      title.dataset.cur = cur;
    }
    /* ---- settings (#136): sound, motion, the guide, the save, restarting a match: one screen ---- */
    let sets = null, svPanel = null;
    const RM_KEY = 'crunchsim.reduceMotion';
    const reduceMotion = () => { try { return localStorage.getItem(RM_KEY) === '1'; } catch (e) { return false; } };
    function applyMotion() { document.body.classList.toggle('reduce-motion', reduceMotion()); if (title && !title.classList.contains('hidden')) startYard(); }
    function showSettings() {
      if (!sets) {
        sets = document.createElement('div'); sets.id = 'settings'; sets.className = 'overlay hidden';
        sets.innerHTML = '<div class="sheet"><div class="sheet-h"><b>SETTINGS</b><button type="button" class="danger" id="settings-close">CLOSE</button></div><div class="sheet-b set-b"></div></div>';
        document.body.appendChild(sets);
        sets.addEventListener('click', (e) => { if (e.target === sets) closeSettings(); });
        sets.querySelector('#settings-close').addEventListener('click', closeSettings);
      }
      const b = sets.querySelector('.set-b'), S = app.S;
      svPanel = svPanel || document.getElementById('saveio-panel'); const stash = document.getElementById('stash'); if (svPanel && stash) stash.appendChild(svPanel);   // out of the way before the rows are rebuilt
      const muted = CS.Audio && CS.Audio.isMuted && CS.Audio.isMuted();
      const V = CS.Audio && CS.Audio.volumes ? CS.Audio.volumes() : { master: 1, plant: 0.8, fx: 0.9, music: 0 };
      const slider = (k, label, note) => '<div class="set-row vol"><span><b>' + label + '</b><span class="small">' + note + '</span></span><input type="range" min="0" max="100" step="5" data-vol="' + k + '" value="' + Math.round((V[k] || 0) * 100) + '"><span class="num vol-v">' + Math.round((V[k] || 0) * 100) + '%</span></div>';
      b.innerHTML = '<div class="set-row"><span><b>Sound</b><span class="small">Machine sounds, sales, the gavel. Key: M</span></span><button type="button" id="set-sound">' + (muted ? 'OFF' : 'ON') + '</button></div>' +
        slider('master', 'Volume', 'Everything') + slider('plant', 'Plant', 'Machines, crunches, belts') + slider('fx', 'Effects', 'Sales, the auction, alerts') + slider('music', 'Music', 'Off at 0: a calm loop in Progress, a tense one in Rivals') +
        '<div class="set-row"><span><b>Reduce motion</b><span class="small">No flashes, bounces or sliding panels</span></span><button type="button" id="set-motion">' + (reduceMotion() ? 'ON' : 'OFF') + '</button></div>' +
        (S.mode === 'progress' ? '<div class="set-row"><span><b>Guided first lot</b><span class="small">A fresh $1k lot and the steps on the real screen</span></span><button type="button" id="set-guide">PLAY IT AGAIN</button></div>' : '') +
        (S.mode === 'rivals' ? '<div class="set-row"><span><b>Restart the match</b><span class="small">Wipes this Rivals match. Your Progress yard is never wiped.</span></span><button type="button" class="danger" id="set-restart">RESTART RIVALS</button></div>' : '') +
        '<div class="set-row"><span><b>Game</b><span class="small">Back to the title screen</span></span><button type="button" id="set-menu">MENU</button></div>' +
        '<div id="set-save"></div>';
      b.querySelectorAll('input[data-vol]').forEach((r) => r.addEventListener('input', () => { if (CS.Audio) { CS.Audio.init(); CS.Audio.setVolume(r.dataset.vol, r.value / 100); } r.parentElement.querySelector('.vol-v').textContent = r.value + '%'; }));
      b.querySelector('#set-sound').addEventListener('click', () => { const m = document.getElementById('btn-mute'); if (m) m.click(); showSettings(); });
      b.querySelector('#set-motion').addEventListener('click', () => { try { localStorage.setItem(RM_KEY, reduceMotion() ? '0' : '1'); } catch (e) { /* ignore */ } applyMotion(); showSettings(); });
      const g = b.querySelector('#set-guide'); if (g) g.addEventListener('click', () => { closeSettings(); if (CS.Guide && CS.Guide.live) CS.Guide.live.begin(); });
      const r = b.querySelector('#set-restart'); if (r) { let armed = false; r.addEventListener('click', () => { if (!armed) { armed = true; r.textContent = 'CLICK AGAIN: WIPE THIS MATCH'; return; } closeSettings(); const ng = document.getElementById('btn-newgame'); if (ng) { ng.click(); ng.click(); } }); }
      b.querySelector('#set-menu').addEventListener('click', () => { closeSettings(); showTitle(); });
      if (svPanel) b.querySelector('#set-save').appendChild(svPanel);
      sets.classList.remove('hidden');
    }
    function closeSettings() {
      if (!sets) return;
      const stash = document.getElementById('stash'); if (svPanel && stash) stash.appendChild(svPanel);
      sets.classList.add('hidden');
    }
    function hideTitle() { if (title) title.classList.add('hidden'); document.body.classList.remove('at-title'); if (CS.Audio && CS.Audio.duck) CS.Audio.duck('plant', false); if (CS.Music) CS.Music.setTheme(app.S.mode === 'rivals' ? 'rivals' : 'progress'); }
    function go(what) {
      const mode = what === 'progress' ? 'progress' : 'rivals';
      if (app.S.run) { app.log('A batch is running: let it finish (or STOP it) before switching games.', 'warn'); hideTitle(); render(); return; }
      hideTitle();
      if (mode !== app.S.mode || !app.storedMode()) app.switchMode(mode);
      if (app.S.mode !== mode) { render(); return; }   // the switch was refused: never reset the game that is still loaded
      if (what === 'rivals-new') { app.softReset(); const h = $('#help'); if (h) h.classList.add('hidden'); if (CS.Round && CS.Round.live) CS.Round.live.open(); }
      render();
    }

    /* ---- the Rivals screen: a match bar over the plant ---- */
    function renderBar() {
      const fp = $('#flow-panel'); if (!fp) return;
      if (!bar) { bar = document.createElement('div'); bar.id = 'match-bar'; bar.className = 'match-bar'; fp.insertBefore(bar, fp.firstChild); }
      const RL = CS.Round && CS.Round.live;
      if (app.S.mode !== 'rivals' || !RL || !RL.table) { bar.classList.add('hidden'); return; }
      const rows = RL.table(), rd = RL.round(), C = (CS.Round.COLORS || {});
      bar.classList.remove('hidden');
      const html = '<div class="mb-round"><b>' + (rd.over ? 'MATCH OVER' : rd.n ? 'ROUND ' + rd.n + ' OF ' + rd.length : 'MATCH OF ' + rd.length) + '</b><span>highest worth wins</span></div>' +
        '<div class="mb-table">' + rows.map((r) => '<div class="mb-p' + (r.id === 'you' ? ' you' : '') + '" style="--pc:' + (C[r.id] || '#7fe3ff') + '"><i>' + ord(r.place) + '</i><b>' + esc(r.id === 'you' ? 'You' : r.name) + '</b><span>' + money(r.worth) + '</span></div>').join('') + '</div>' +
        '<button type="button" class="primary mb-go">' + (rd.over ? 'STANDINGS' : rd.n ? 'AUCTION ROUND' : 'START THE MATCH') + '</button>';
      if (html === bar.dataset.html) return;   // unchanged: keep the button under the pointer
      bar.dataset.html = html; bar.innerHTML = html;
      bar.querySelector('.mb-go').addEventListener('click', () => RL.open());
    }
    /* header: Rivals shows your place in the match where Progress shows the rank */
    function renderHeader() {
      const lbl = document.querySelector('#rank') && document.querySelector('#rank').previousElementSibling;
      const sub = document.querySelector('#top .brand .sub');
      if (app.S.mode === 'rivals' && CS.Round && CS.Round.live && CS.Round.live.table) {
        const me = CS.Round.live.table().find((r) => r.id === 'you');
        if (me && lastPlace && me.place < lastPlace && CS.Round.live.round().n > 0 && CS.Audio && CS.Audio.sfx) CS.Audio.sfx('place');   // #118: you moved up
        lastPlace = me ? me.place : 0;
        if (lbl) lbl.textContent = 'MATCH PLACE'; $('#rank').textContent = me ? ord(me.place) + ' of 4' : '--';
        if (sub) sub.textContent = 'RIVALS · AUCTION MATCH';
      } else {
        if (lbl) lbl.textContent = 'RANK';
        if (sub) sub.textContent = 'PROGRESS · BUILD YOUR PLANT';
      }
    }
    function render() { renderBar(); renderHeader(); }

    app.on('boot', () => {
      // MENU replaces the PROGRESS / RIVALS switch: each game has its own screen
      const sw = document.getElementById('mode-switch');
      if (sw) {
        sw.querySelectorAll('.mode').forEach((b) => b.classList.add('hidden'));
        const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'tool mode-menu'; mb.id = 'btn-menu'; mb.textContent = 'MENU';
        mb.title = 'Back to the title screen: pick Progress or Rivals (the game is saved)';
        mb.addEventListener('click', showTitle); sw.insertBefore(mb, sw.firstChild);
      }
      const gear = document.getElementById('btn-settings'); if (gear) gear.addEventListener('click', showSettings);
      applyMotion(); render(); showTitle();
    });
    app.on('render', render);
    let acc = 0; app.on('tick', (p) => { acc += (p && p.dt) || 0; if (acc > 0.5) { acc = 0; render(); } });
    app.on('modechange', () => { render(); if (CS.Music && !document.body.classList.contains('at-title')) CS.Music.setTheme(app.S.mode === 'rivals' ? 'rivals' : 'progress'); });
    app.on('newgame', () => setTimeout(render, 0));
    CS.Modes.live = { showTitle, hideTitle, go, showSettings, closeSettings };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
