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
    let title = null, bar = null;
    const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

    /* ---- the title screen ---- */
    function showTitle() {
      if (app.S.run) { app.log('Stop the running batch before going to the menu.', 'warn'); return; }
      app.save();
      const k = app.saveKeys(), P = summary('progress', read(k.progress)), R = summary('rivals', read(k.rivals)), cur = app.S.mode;
      if (!title) { title = document.createElement('div'); title.id = 'title'; title.className = 'title-screen'; document.body.appendChild(title); }
      const pLine = P.has ? 'Bank ' + money(P.money) + ' · ' + P.machines + ' machine' + (P.machines === 1 ? '' : 's') + ' · ' + app.fmtNum(P.tonnes, 0) + ' t processed' : 'No yard yet.';
      const rLine = !R.has || !R.round ? 'No match in progress.' : R.over ? 'Last match finished after ' + R.round + ' rounds.' : 'Round ' + R.round + ' of ' + R.length + ' · bank ' + money(R.money);
      title.innerHTML = '<div class="tt-box"><div class="tt-logo">CRUNCH<b>SIM</b></div><div class="tt-sub">BUY THE JUNK · GRIND IT · SORT IT · SELL IT PURE</div><div class="tt-cards">' +
        '<div class="tt-card tt-progress"><b>PROGRESS</b><p>The long game. Earn money, keep building out your plant: more sorters, bigger lots, a refinery. Nobody to beat, no end.</p><div class="tt-save">' + esc(pLine) + '</div>' +
          '<button type="button" class="primary" data-go="progress">' + (P.has ? 'CONTINUE' : 'START') + '</button></div>' +
        '<div class="tt-card tt-rivals"><b>RIVALS</b><p>A match of auction rounds against three yards. Three bins a round, four bidders. The highest worth after the last round wins.</p><div class="tt-save">' + esc(rLine) + '</div>' +
          (R.has && R.round && !R.over ? '<button type="button" class="primary" data-go="rivals">CONTINUE MATCH</button><button type="button" data-go="rivals-new">NEW MATCH</button>' : '<button type="button" class="primary" data-go="rivals-new">' + (R.has && R.over ? 'NEW MATCH' : 'START A MATCH') + '</button>') + '</div>' +
        '</div><div class="small tt-foot">Each game keeps its own save in this browser. MENU in the toolbar comes back here. <a href="#" id="tt-settings">Settings</a></div></div>';
      title.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      const ts = title.querySelector('#tt-settings'); if (ts) ts.addEventListener('click', (e) => { e.preventDefault(); showSettings(); });
      title.classList.remove('hidden'); document.body.classList.add('at-title');
      title.dataset.cur = cur;
    }
    /* ---- settings (#136): sound, motion, the guide, the save, restarting a match: one screen ---- */
    let sets = null;
    const RM_KEY = 'crunchsim.reduceMotion';
    const reduceMotion = () => { try { return localStorage.getItem(RM_KEY) === '1'; } catch (e) { return false; } };
    function applyMotion() { document.body.classList.toggle('reduce-motion', reduceMotion()); }
    function showSettings() {
      if (!sets) {
        sets = document.createElement('div'); sets.id = 'settings'; sets.className = 'overlay hidden';
        sets.innerHTML = '<div class="sheet"><div class="sheet-h"><b>SETTINGS</b><button type="button" class="danger" id="settings-close">CLOSE</button></div><div class="sheet-b set-b"></div></div>';
        document.body.appendChild(sets);
        sets.addEventListener('click', (e) => { if (e.target === sets) closeSettings(); });
        sets.querySelector('#settings-close').addEventListener('click', closeSettings);
      }
      const b = sets.querySelector('.set-b'), S = app.S;
      const muted = CS.Audio && CS.Audio.isMuted && CS.Audio.isMuted();
      b.innerHTML = '<div class="set-row"><span><b>Sound</b><span class="small">Machine sounds, sales, the gavel. Key: M</span></span><button type="button" id="set-sound">' + (muted ? 'OFF' : 'ON') + '</button></div>' +
        '<div class="set-row"><span><b>Reduce motion</b><span class="small">No flashes, bounces or sliding panels</span></span><button type="button" id="set-motion">' + (reduceMotion() ? 'ON' : 'OFF') + '</button></div>' +
        (S.mode === 'progress' ? '<div class="set-row"><span><b>Guided first lot</b><span class="small">A fresh $1k lot and the steps on the real screen</span></span><button type="button" id="set-guide">PLAY IT AGAIN</button></div>' : '') +
        (S.mode === 'rivals' ? '<div class="set-row"><span><b>Restart the match</b><span class="small">Wipes this Rivals match. Your Progress yard is never wiped.</span></span><button type="button" class="danger" id="set-restart">RESTART RIVALS</button></div>' : '') +
        '<div class="set-row"><span><b>Game</b><span class="small">Back to the title screen</span></span><button type="button" id="set-menu">MENU</button></div>' +
        '<div id="set-save"></div>';
      b.querySelector('#set-sound').addEventListener('click', () => { const m = document.getElementById('btn-mute'); if (m) m.click(); showSettings(); });
      b.querySelector('#set-motion').addEventListener('click', () => { try { localStorage.setItem(RM_KEY, reduceMotion() ? '0' : '1'); } catch (e) { /* ignore */ } applyMotion(); showSettings(); });
      const g = b.querySelector('#set-guide'); if (g) g.addEventListener('click', () => { closeSettings(); if (CS.Guide && CS.Guide.live) CS.Guide.live.begin(); });
      const r = b.querySelector('#set-restart'); if (r) { let armed = false; r.addEventListener('click', () => { if (!armed) { armed = true; r.textContent = 'CLICK AGAIN: WIPE THIS MATCH'; return; } closeSettings(); const ng = document.getElementById('btn-newgame'); if (ng) { ng.click(); ng.click(); } }); }
      b.querySelector('#set-menu').addEventListener('click', () => { closeSettings(); showTitle(); });
      const sv = document.getElementById('saveio-panel'); if (sv) b.querySelector('#set-save').appendChild(sv);
      sets.classList.remove('hidden');
    }
    function closeSettings() {
      if (!sets) return;
      const sv = document.getElementById('saveio-panel'), stash = document.getElementById('stash'); if (sv && stash) stash.appendChild(sv);
      sets.classList.add('hidden');
    }
    function hideTitle() { if (title) title.classList.add('hidden'); document.body.classList.remove('at-title'); }
    function go(what) {
      const mode = what === 'progress' ? 'progress' : 'rivals';
      hideTitle();
      if (mode !== app.S.mode || !app.storedMode()) app.switchMode(mode);
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
      bar.innerHTML = '<div class="mb-round"><b>' + (rd.over ? 'MATCH OVER' : rd.n ? 'ROUND ' + rd.n + ' OF ' + rd.length : 'MATCH OF ' + rd.length) + '</b><span>highest worth wins</span></div>' +
        '<div class="mb-table">' + rows.map((r) => '<div class="mb-p' + (r.id === 'you' ? ' you' : '') + '" style="--pc:' + (C[r.id] || '#7fe3ff') + '"><i>' + ord(r.place) + '</i><b>' + esc(r.id === 'you' ? 'You' : r.name) + '</b><span>' + money(r.worth) + '</span></div>').join('') + '</div>' +
        '<button type="button" class="primary mb-go">' + (rd.over ? 'STANDINGS' : rd.n ? 'AUCTION ROUND' : 'START THE MATCH') + '</button>';
      bar.querySelector('.mb-go').addEventListener('click', () => RL.open());
    }
    /* header: Rivals shows your place in the match where Progress shows the rank */
    function renderHeader() {
      const lbl = document.querySelector('#rank') && document.querySelector('#rank').previousElementSibling;
      const sub = document.querySelector('#top .brand .sub');
      if (app.S.mode === 'rivals' && CS.Round && CS.Round.live && CS.Round.live.table) {
        const me = CS.Round.live.table().find((r) => r.id === 'you');
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
    app.on('modechange', render);
    app.on('newgame', () => setTimeout(render, 0));
    CS.Modes.live = { showTitle, hideTitle, go, showSettings, closeSettings };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
