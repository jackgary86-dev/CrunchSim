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
  /* returns { ok, saves } or { ok: false, why } ; each save must parse as a game with a line */
  function decode(code) {
    const c = String(code || '').trim();
    if (c.indexOf(PREFIX) !== 0) return { ok: false, why: 'That is not a CrunchSim save code (it should start with ' + PREFIX + ').' };
    let d; try { d = JSON.parse(b64d(c.slice(PREFIX.length))); } catch (e) { return { ok: false, why: 'The code is damaged: it could not be read.' }; }
    if (!d || d.v !== 1) return { ok: false, why: 'Unknown save version.' };
    const good = (x) => { if (x == null) return true; try { const g = JSON.parse(x); return !!(g && Array.isArray(g.line)); } catch (e) { return false; } };
    if (!good(d.progress) || !good(d.rivals)) return { ok: false, why: 'A save inside the code is damaged.' };
    if (!d.progress && !d.rivals) return { ok: false, why: 'The code holds no game.' };
    return { ok: true, saves: { progress: d.progress, rivals: d.rivals, mode: d.mode === 'rivals' ? 'rivals' : 'progress', at: d.at } };
  }
  CS.SaveIO = { PREFIX, encode, decode };

  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.saveioStarted) return; app.saveioStarted = true;
    let panel = null;
    const keys = () => app.saveKeys();
    const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
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
        box.innerHTML = '<textarea class="sv-code" readonly rows="4"></textarea><div class="sv-row"><button type="button" class="sv-copy">COPY</button><button type="button" class="sv-dl">DOWNLOAD FILE</button></div>';
        const ta = box.querySelector('textarea'); ta.value = code; ta.select();
        box.querySelector('.sv-copy').addEventListener('click', () => { ta.select(); try { (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => app.log('Save code copied.', 'ok'), () => document.execCommand('copy')); } catch (e) { document.execCommand('copy'); } });
        box.querySelector('.sv-dl').addEventListener('click', () => {
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' })); a.download = 'crunchsim-save.txt';
          document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        });
      });
      im.addEventListener('click', () => {
        box.classList.remove('hidden');
        box.innerHTML = '<textarea class="sv-code" rows="4" placeholder="Paste a save code here"></textarea><div class="sv-row"><button type="button" class="buy sv-go">IMPORT</button><span class="small sv-msg"></span></div>';
        const ta = box.querySelector('textarea'), go = box.querySelector('.sv-go'), msg = box.querySelector('.sv-msg');
        let armed = false;
        go.addEventListener('click', () => {
          const r = decode(ta.value);
          if (!r.ok) { msg.textContent = r.why; msg.className = 'small sv-msg bad'; return; }
          if (app.S.run) { msg.textContent = 'Stop the running batch first.'; return; }
          if (!armed) { armed = true; go.textContent = 'IMPORT: REPLACE BOTH GAMES?'; msg.textContent = 'This replaces the Progress and Rivals games on this browser.'; msg.className = 'small sv-msg warn'; return; }
          const k = keys();
          try {
            if (r.saves.progress) localStorage.setItem(k.progress, r.saves.progress); else localStorage.removeItem(k.progress);
            if (r.saves.rivals) localStorage.setItem(k.rivals, r.saves.rivals); else localStorage.removeItem(k.rivals);
            localStorage.setItem(k.mode, r.saves.mode);
          } catch (e) { msg.textContent = 'This browser would not store the save.'; return; }
          app.S.mode = r.saves.mode;
          app.restoreSave(); app.emit('modechange', { mode: r.saves.mode }); app.renderAll();
          app.log('Save imported' + (r.saves.at ? ' (exported ' + r.saves.at.slice(0, 10) + ')' : '') + '. You are playing ' + r.saves.mode.toUpperCase() + '.', 'ok');
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
