/* CrunchSim module: export and import a save code (#82). Saves live in one browser's storage, so clearing site data or
 * changing device loses a game. EXPORT SAVE gives a code (and a file) holding both modes' saves; IMPORT SAVE reads one
 * back after a check, and the running game reloads in place. The code is base64 of JSON, prefixed and versioned; the pure
 * encode / decode lives on CS.SaveIO so tests/saveio.js can run it in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  const PREFIX = 'CRUNCHSIM1:';
  const b64e = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
  const b64d = (s) => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));
  /* saves: { progress: string|null, rivals: string|null, mode } (the raw stored JSON strings) */
  function encode(saves) { return PREFIX + b64e(JSON.stringify({ v: 1, at: saves.at || null, mode: saves.mode || 'progress', progress: saves.progress || null, rivals: saves.rivals || null })); }
  const MAX_SAVE = 2000000, MAX_LINE = 200, MAX_NUM = 1e12;
  const num = (v) => (v !== v ? 0 : Math.min(Math.max(v, -MAX_NUM), MAX_NUM));   // JSON can hold 1e999, which reads back as Infinity; clamped everywhere (money may be negative)
  const portsOf = CS.portsOf, cleanLine = CS.cleanLine;   // #279: shared with blueprints and the plant floor (data.js)
  /* one stored save as a string: parsed, checked and its numbers clamped; null when it is not a usable game */
  function clean(x) {
    let g; try { g = JSON.parse(x, (k, v) => (typeof v === 'number' ? num(v) : v)); } catch (e) { return null; }   // every number in the save, stock piles included
    if (!g || typeof g !== 'object' || !Array.isArray(g.line) || g.line.length > MAX_LINE) return null;
    const M = CS.MACHINES;
    for (const n of g.line) if (!n || typeof n !== 'object' || typeof n.m !== 'string' || (M && !M[n.m])) return null;
    g.line = cleanLine(g.line);
    return JSON.stringify(g);
  }
  /* returns { ok, saves } or { ok: false, why } ; each save must parse as a game with a line */
  function decode(code) {
    const c = String(code || '').trim();
    if (c.indexOf(PREFIX) !== 0) return { ok: false, why: 'That is not a CrunchSim save code (it should start with ' + PREFIX + ').' };
    let d; try { d = JSON.parse(b64d(c.slice(PREFIX.length))); } catch (e) { return { ok: false, why: 'The code is damaged: it could not be read.' }; }
    if (!d || d.v !== 1) return { ok: false, why: 'Unknown save version.' };
    if (d.at != null && (typeof d.at !== 'string' || d.at.length > 40)) return { ok: false, why: 'The code is damaged: its date is wrong.' };
    for (const k of ['progress', 'rivals']) {
      if (d[k] == null) { d[k] = null; continue; }
      const g = typeof d[k] === 'string' && d[k].length <= MAX_SAVE ? clean(d[k]) : null;
      if (!g) return { ok: false, why: 'A save inside the code is damaged.' };
      d[k] = g;
    }
    if (!d.progress && !d.rivals) return { ok: false, why: 'The code holds no game.' };
    return { ok: true, saves: { progress: d.progress, rivals: d.rivals, mode: d.mode === 'rivals' ? 'rivals' : 'progress', at: d.at } };
  }
  /* #194: true when the raw stored save holds a newer revision than the one a tab loaded (so that tab must not overwrite it) */
  function isNewer(raw, rev) { try { const d = raw ? JSON.parse(raw) : null; return !!d && (Math.floor(+d.rev) || 0) > rev; } catch (e) { return false; } }
  /* #341: the game refuses a machine past MAX_LINE, so every line it lets you build exports and imports */
  const lineFull = (len, more) => (len + (more == null ? 1 : more) > MAX_LINE ? 'A line holds at most ' + MAX_LINE + ' machines (a save code could not carry more). Remove one first.' : '');
  CS.SaveIO = { PREFIX, MAX_LINE, encode, decode, isNewer, cleanLine, portsOf, lineFull };

  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.saveioStarted) return; app.saveioStarted = true;
    app.on('veto:addMachine', (p) => lineFull(app.S.line.length + ((p && p.pending) || 0)));   // #341: pending = sorters of the same pair not on the line yet
    app.on('veto:applyLine', (p) => (p && Array.isArray(p.nodes) ? lineFull(p.nodes.length, 0) : ''));
    let panel = null;
    const keys = () => app.saveKeys();
    const read = (k) => { if (app.readSave) return app.readSave(k); try { return localStorage.getItem(k); } catch (e) { return null; } };   // #278: the in-memory copy when storage is blocked
    function exportCode() {
      app.save();
      const k = keys();
      return encode({ progress: read(k.progress), rivals: read(k.rivals), mode: app.S.mode, at: new Date().toISOString() });
    }
    function render() {
      if (!panel) return;
      const body = panel.querySelector('.sv-body'); body.innerHTML = '';
      body.appendChild(app.el('div', 'small', 'Your games live in this browser only. Keep a copy: the code holds both modes\' saves.'));
      const row = app.el('div', 'sv-row');
      const ex = app.el('button', 'buy', 'EXPORT SAVE'); ex.type = 'button';
      const im = app.el('button', null, 'IMPORT SAVE'); im.type = 'button';
      row.appendChild(ex); row.appendChild(im); body.appendChild(row);
      const box = app.el('div', 'sv-box hidden'); body.appendChild(box);
      ex.addEventListener('click', () => {
        const code = exportCode();
        box.classList.remove('hidden');
        // a hosted viewer's frame may not allow downloads: offer the file only on a normal page (GitHub Pages, local)
        let top = false; try { top = window.top === window; } catch (e) { top = false; }
        box.innerHTML = '<textarea class="sv-code" readonly rows="4"></textarea><div class="sv-row"><button type="button" class="sv-copy">COPY</button>' + (top ? '<button type="button" class="sv-dl">DOWNLOAD FILE</button>' : '<span class="small">Copy the code and keep it somewhere safe.</span>') + '</div>';
        const ta = box.querySelector('textarea'); ta.value = code; ta.select();
        box.querySelector('.sv-copy').addEventListener('click', () => { ta.select(); try { (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => app.log('Save code copied.', 'ok'), () => document.execCommand('copy')); } catch (e) { document.execCommand('copy'); } });
        const dl = box.querySelector('.sv-dl'); if (dl) dl.addEventListener('click', () => {
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' })); a.download = 'crunchsim-save.txt';
          document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        });
      });
      im.addEventListener('click', () => {
        box.classList.remove('hidden');
        box.innerHTML = '<textarea class="sv-code" rows="4" placeholder="Paste a save code here"></textarea><div class="sv-row"><button type="button" class="buy sv-go">IMPORT</button><span class="small sv-msg"></span></div>';
        const ta = box.querySelector('textarea'), go = box.querySelector('.sv-go'), msg = box.querySelector('.sv-msg');
        let armed = false;
        ta.addEventListener('input', () => { armed = false; go.textContent = 'IMPORT'; msg.textContent = ''; msg.className = 'small sv-msg'; });   // a changed code needs its own confirmation
        go.addEventListener('click', () => {
          const r = decode(ta.value);
          if (!r.ok) { msg.textContent = r.why; msg.className = 'small sv-msg bad'; return; }
          if (app.S.run) { msg.textContent = 'Stop the running batch first.'; return; }
          if (!armed) { armed = true; go.textContent = 'IMPORT: REPLACE BOTH GAMES?'; msg.textContent = 'This replaces the Progress and Rivals games on this browser.'; msg.className = 'small sv-msg warn'; return; }
          const k = keys(), old = { progress: read(k.progress), rivals: read(k.rivals), mode: read(k.mode) }, oldMode = app.S.mode;
          const put = (v) => {
            if (v.progress) localStorage.setItem(k.progress, v.progress); else localStorage.removeItem(k.progress);
            if (v.rivals) localStorage.setItem(k.rivals, v.rivals); else localStorage.removeItem(k.rivals);
            if (v.mode) localStorage.setItem(k.mode, v.mode); else localStorage.removeItem(k.mode);
          };
          let ok = false;
          try { put(r.saves); app.S.mode = r.saves.mode; ok = app.restoreSave() !== false; } catch (e) { ok = false; }
          if (!ok) {   // the game would not load it: put the old saves back (a failed load starts a fresh game over the key) and reload them
            let restored = true;
            try { put(old); app.S.mode = oldMode; app.restoreSave(); app.renderAll(); } catch (e) { restored = false; app.S.mode = oldMode; }   // storage gone: the game in this tab was never replaced
            msg.textContent = restored ? 'That save could not be loaded, so your current games are unchanged.' : 'This browser is blocking storage, so the save could not be imported. The game in this tab is unchanged.'; msg.className = 'small sv-msg bad'; return;
          }
          app.emit('modechange', { mode: r.saves.mode }); app.renderAll();
          app.log('Save imported' + (r.saves.at ? ' (exported ' + String(r.saves.at).slice(0, 10) + ')' : '') + '. You are playing ' + r.saves.mode.toUpperCase() + '.', 'ok');
          const tt = document.body.classList.contains('at-title') && CS.Modes && CS.Modes.live; if (tt) tt.showTitle();   // the title cards show the new saves
          if (app.layout && app.layout.closeDrawer) app.layout.closeDrawer();
        });
      });
    }
    app.on('boot', () => {
      panel = app.addPanel('left', 'saveio-panel', 'Your save', 'bank-panel');
      panel.appendChild(app.el('div', 'sv-body'));
      render();
    });
    CS.SaveIO.live = { exportCode };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
