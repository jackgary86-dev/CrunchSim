/* CrunchSim module: endgame (ticket #15). The Omniprocessor (MACHINES.omni in js/data.js, the M.omni branch of
 * procComminution in js/sim.js, the 'omni' cam scene in js/scenes-b.js) is locked until the plant reaches Mega-plant rank (the
 * old path through three-star client contracts went with the contracts in #78). The lock is a veto on 'addMachine' and 'applyLine'; an Omniprocessor already
 * owned is never refused. When the first batch through it completes, an end-game card shows the final score (net worth), the
 * rank, lifetime earnings and a KEEP PLAYING button. Whether the card has been shown persists under ext.endgame.
 *
 * The pure parts (unlock rule, veto text, end-of-game numbers) live on CS.Endgame and touch no DOM, so tests/endgame.js can
 * run them in Node. Everything that needs the page runs only once CS.app exists.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MACHINES || !CS.RANKS) return;
  const MACHINES = CS.MACHINES, RANKS = CS.RANKS;

  /* ---------------- pure functions ---------------- */
  function isOmni(m) { return !!(MACHINES[m] && MACHINES[m].omni); }
  function lineHasOmni(nodes) { return (nodes || []).some(function (n) { return n && isOmni(n.m); }); }
  /* index into RANKS of the rank named by the machine's unlock field; the top rank when the name is missing or unknown */
  function rankNeeded(m) {
    const U = MACHINES[m] && MACHINES[m].unlock, i = U ? RANKS.findIndex(function (r) { return r[1] === U.rank; }) : -1;
    return i >= 0 ? i : RANKS.length - 1;
  }
  /* { ok, rankName } for machine m at rank index rankIdx */
  function unlockStatus(m, rankIdx) {
    const ri = rankNeeded(m);
    return { ok: (+rankIdx || 0) >= ri, rankName: RANKS[ri][1] };
  }
  /* reason machine m may not be added, or '' when it may (not an end-game machine, already owned, or unlocked) */
  function vetoFor(m, owned, rankIdx) {
    if (!isOmni(m) || owned) return '';
    const u = unlockStatus(m, rankIdx); if (u.ok) return '';
    return 'The ' + MACHINES[m].name + ' is locked: reach ' + u.rankName + ' rank.';
  }
  /* numbers on the end-game card */
  function endStats(S, netWorth, rank) {
    return {
      score: netWorth, rank: rank, lifetime: (S && S.lifetime) || 0, batches: (S && S.batches) || 0, tonnes: (S && S.tonnes) || 0,
      clock: (S && S.clock) || 0
    };
  }

  /* #372: the machine kinds this yard actually had (owned or on the line), in plant order: 'a shredder, magnets and eddy currents' */
  const KIND_WORDS = [['shred', 'a shredder'], ['magnet', 'magnets'], ['eddy', 'eddy currents'], ['air', 'air classifiers'], ['screen', 'screens'], ['sinkfloat', 'density tanks'], ['sensor', 'sensor sorters'], ['furnace', 'furnaces']];
  function yardKinds(ids) {
    const has = {}; (ids || []).forEach(function (m) { const M = MACHINES[m]; if (!M || M.omni) return; has[M.kind === 'comminution' ? 'shred' : M.kind === 'furnace' ? 'furnace' : m] = true; });
    const w = KIND_WORDS.filter(function (k) { return has[k[0]]; }).map(function (k) { return k[1]; });
    return w.length > 1 ? w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1] : w.join('');
  }

  CS.Endgame = { isOmni: isOmni, lineHasOmni: lineHasOmni, rankNeeded: rankNeeded, unlockStatus: unlockStatus, vetoFor: vetoFor, endStats: endStats, yardKinds: yardKinds };

  /* ---------------- page integration (needs CS.app) ---------------- */
  const CSS = '#endgame { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(5,9,14,.82); z-index: 60; }' +
    '#endgame .card { width: min(460px, calc(100% - 32px)); border-color: var(--cyan); }' +
    '#endgame .net { color: var(--green); } #endgame .rk { color: var(--amber); }' +
    '#endgame .lesson { margin-top: 10px; padding: 8px 10px; border-left: 3px solid var(--cyan); background: var(--panel-2); font-size: 12px; line-height: 1.4; }' +
    '#endgame button { margin-top: 12px; width: 100%; }' +
    '#endgame-status { margin-top: 6px; } #endgame-status b.ok { color: var(--green); } #endgame-status b.lock { color: var(--amber); }';

  function start() {
    const API = CS.app; if (!API || API.endgameStarted) return; API.endgameStarted = true;
    const state = { shown: false };
    let overlay = null, status = null;
    const S = function () { return API.S; };
    const rankIdx = function () { return API.rankOf && API.netWorth ? API.rankOf(API.netWorth()).idx : 0; };
    const omniId = function () { return Object.keys(MACHINES).find(isOmni) || 'omni'; };

    function restore(ext) { const e = ext && ext.endgame; state.shown = !!(e && e.shown); }
    function veto(m) { return vetoFor(m, S() && S().owned && S().owned.has(m), rankIdx()); }

    function hide() { if (overlay) overlay.classList.add('hidden'); }
    function show() {
      if (typeof document === 'undefined') return;
      if (!overlay) {
        overlay = document.createElement('div'); overlay.id = 'endgame';
        const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
      }
      const nw = API.netWorth(), st = endStats(S(), nw, API.rankOf(nw).name), M = MACHINES[omniId()], kinds = yardKinds(Array.from(S().owned || []).concat((S().line || []).map(function (n) { return n.m; })));
      overlay.innerHTML = '<div class="card"><h2>END GAME<span>' + API.esc(M.name.toUpperCase()) + ' ONLINE</span></h2>' +
        '<div class="net"><small>FINAL SCORE · NET WORTH</small>' + API.fmtMoney(st.score) + '</div>' +
        '<dl><dt>Rank</dt><dd class="rk">' + API.esc(st.rank.toUpperCase()) + '</dd>' +
        '<dt>Lifetime earnings</dt><dd>' + API.fmtMoney(st.lifetime) + '</dd>' +
        '<dt>Batches run</dt><dd>' + API.fmtNum(st.batches, 0) + '</dd>' +
        '<dt>Tonnes processed</dt><dd>' + API.fmtNum(st.tonnes, 0) + ' t</dd>' +
        '<dt>Plant clock</dt><dd>' + API.esc(API.fmtClock(st.clock)) + '</dd></dl>' +
        '<div class="lesson">One pass, one bin per material. No real plant can do this: every sensor and every breaking mechanism works on some materials and not others' + (kinds ? ', which is why the yard you built needed ' + API.esc(kinds) + ' in series' : '') + '.</div>' +   // #372: only the kinds this yard had
        '<button type="button" class="buy" id="endgame-keep">KEEP PLAYING</button></div>';
      overlay.querySelector('#endgame-keep').addEventListener('click', hide);
      overlay.classList.remove('hidden');
      if (CS.Overlays) CS.Overlays.attach(overlay, { label: 'End game', close: '#endgame-keep' });   // #236: a dialog: focus moves in, Escape keeps playing, the page behind is inert
    }

    function renderStatus() {
      if (typeof document === 'undefined' || !S()) return;
      const bar = document.querySelector('#bank-panel .rankbar'); if (!bar) return;
      if (!status) { status = API.el('div', 'small num'); status.id = 'endgame-status'; bar.insertAdjacentElement('afterend', status); }   // under the rank bar: the rank is half the unlock rule
      const id = omniId(), M = MACHINES[id];
      if (S().owned.has(id)) { status.innerHTML = 'END GAME · <b class="ok">' + API.esc(M.name.toUpperCase()) + ' OWNED</b>'; return; }
      const u = unlockStatus(id, rankIdx());
      status.innerHTML = 'END GAME · ' + (u.ok ? '<b class="ok">' + API.esc(M.name.toUpperCase()) + ' UNLOCKED</b> · ' + API.fmtMoney(M.price) + ' in the Plant drawer'
        : '<b class="lock">' + API.esc(M.name.toUpperCase()) + ' LOCKED</b> · reach ' + API.esc(u.rankName) + ' rank');
    }

    /* hooks */
    API.on('load', restore);
    if (API.S && API.S.ext) restore(API.S.ext);   // registered after boot: the 'load' event has already gone by
    API.on('save', function () { return { endgame: { shown: state.shown } }; });
    CS.Endgame.reached = function () { return state.shown; };   // #369: NEXT STEP stops growing once only the final batch is left
    API.on('newgame', function () { state.shown = false; hide(); });
    API.on('veto:addMachine', function (p) { return p ? veto(p.m) : ''; });
    API.on('veto:applyLine', function (p) {
      const nodes = (p && p.nodes) || [], hit = nodes.find(function (n) { return n && isOmni(n.m); });
      return hit ? veto(hit.m) : '';
    });
    API.on('batchComplete', function (p) {
      if (!p || p.why !== 'complete' || state.shown || !lineHasOmni(S().line)) return;
      state.shown = true; API.log('END GAME: the ' + MACHINES[omniId()].name + ' ran its first batch. Final score ' + API.fmtMoney(API.netWorth()) + '.', 'ok');
      show(); API.save();
    });
    API.on('render', renderStatus);
    if (API.booted) renderStatus();
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
