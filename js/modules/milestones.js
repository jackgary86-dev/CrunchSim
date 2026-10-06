/* CrunchSim module: milestones (#73). Goals to chase beyond the next rank: each one is checked as the game goes, ticks off
 * on a list in Bank & upgrades, and pops a short notice with a fanfare when it is reached. A rank up gets the fanfare too.
 * The definitions and the checks are pure (CS.Milestones) so tests/milestones.js can run them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  /* each check reads a snapshot: { sold, soldValue, batchBest, refined: {mat: n}, goldBars, sorters, slots, lotBest, miscMax,
   * misc, lotsRun, rank } */
  const LIST = [
    { id: 'firstSale', name: 'First pure bucket sold', hint: 'Sell a bucket that is 90% or more one material.', ok: (s) => s.sold >= 1 },
    { id: 'batch10k', name: 'A $10k batch', hint: 'Run one batch whose products are worth $10,000 more than it cost to run.', ok: (s) => s.batchBest >= 10000 },
    { id: 'lotRun', name: 'A whole lot run', hint: 'Use RUN THE LOT to run a lot to the end.', ok: (s) => s.lotsRun >= 1 },
    { id: 'ingot', name: 'First ingot', hint: 'Build a smelting furnace and refine a metal bucket.', ok: (s) => Object.keys(s.refined).some((m) => m !== 'gold' && m !== 'silver' && m !== 'misc') },
    { id: 'goldBar', name: 'First gold bar', hint: 'Sort gold pure, or refine a gold concentrate, at the precious-metals refinery.', ok: (s) => s.goldBars >= 1 },
    { id: 'five', name: 'Five sorters on the line', hint: 'Fill every starting sorter slot.', ok: (s) => s.sorters >= 5 },
    { id: 'hall', name: 'A full sorting hall', hint: 'Buy all ten sorter slots.', ok: (s) => s.slots >= 10 },
    { id: 'bigLot', name: 'A $100k lot', hint: 'Buy a lot worth $100,000 or more.', ok: (s) => s.lotBest >= 100000 },
    { id: 'clean', name: 'MISC back to zero', hint: 'Let MISC grow past 10 t, then re-run it until nothing is left.', ok: (s) => s.miscMax >= 10 && s.misc < 0.05 },
    { id: 'recycler', name: 'Recycler rank', hint: 'Reach a net worth of $120,000.', ok: (s) => s.rank >= 1 },
    { id: 'operator', name: 'Plant operator rank', hint: 'Reach a net worth of $2.5 million.', ok: (s) => s.rank >= 3 }
  ];
  function newState() { return { done: {}, sold: 0, soldValue: 0, batchBest: 0, refined: {}, goldBars: 0, lotBest: 0, miscMax: 0, lotsRun: 0, rankSeen: 0 }; }
  /* the milestones newly reached in snapshot s, given what is already done */
  function reached(done, s) { return LIST.filter((m) => !done[m.id] && m.ok(s)).map((m) => m.id); }
  CS.Milestones = { LIST, newState, reached };

  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.milestonesStarted) return; app.milestonesStarted = true;
    let st = newState(), panel = null, ready = false;   // no checks until the game has booted: a loaded save must not fanfare its old rank
    function snapshot() {
      const S = app.S, I = CS.Inventory, SL = CS.Slots;
      return { sold: st.sold, soldValue: st.soldValue, batchBest: st.batchBest, refined: st.refined, goldBars: st.goldBars, lotBest: st.lotBest, lotsRun: st.lotsRun,
        sorters: SL ? SL.sortersIn(S.line) : 0, slots: SL && SL.live ? SL.live.owned() : 5,
        misc: I && I.misc ? I.miscTotal(I.misc()) : 0, miscMax: st.miscMax, rank: app.rankOf ? app.rankOf(app.netWorth()).idx : 0 };
    }
    function toast(text, sub) {
      const t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = '<b>' + app.esc(text) + '</b>' + (sub ? '<span>' + app.esc(sub) + '</span>' : '');
      document.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add('in'));
      setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 500); }, 3600);
      if (CS.Audio && CS.Audio.fx) CS.Audio.fx('fanfare');
    }
    function check() {
      if (!ready) return;
      const s = snapshot();
      st.miscMax = Math.max(st.miscMax, s.misc); s.miscMax = st.miscMax;
      if (s.rank > st.rankSeen) { if (st.rankSeen || s.rank) toast('NEW RANK', app.rankOf(app.netWorth()).name); st.rankSeen = s.rank; }
      const got = reached(st.done, s);
      got.forEach((id) => { st.done[id] = app.S.clock || 1; const M = LIST.find((m) => m.id === id); app.log('Milestone: ' + M.name + '.', 'ok'); toast('MILESTONE', M.name); });
      if (got.length) { app.save(); render(); }
    }
    function render() {
      if (!panel) return;
      const body = panel.querySelector('.ms-body'), n = Object.keys(st.done).length;
      panel.querySelector('h2 .tag').textContent = n + ' / ' + LIST.length;
      body.innerHTML = LIST.map((m) => '<div class="ms' + (st.done[m.id] ? ' done' : '') + '"><span class="ms-ic">' + (st.done[m.id] ? '&#10003;' : '') + '</span><span><b>' + app.esc(m.name) + '</b><span class="small">' + app.esc(m.hint) + '</span></span></div>').join('');
    }
    app.on('sale', (p) => { st.sold++; st.soldValue += (p && p.proceeds) || 0; check(); });
    app.on('refined', (p) => { if (!p) return; st.refined[p.mat] = (st.refined[p.mat] || 0) + 1; if (p.mat === 'gold' || (p.metal && p.metal.gold > 0)) st.goldBars++; check(); });
    app.on('lotBought', (p) => { if (p && p.total > st.lotBest) st.lotBest = p.total; check(); });
    app.on('batchComplete', (p) => { if (p && p.r) { const v = (p.net || 0) + (p.r.held ? (p.r.rev || 0) : 0); if (v > st.batchBest) st.batchBest = v; } setTimeout(check, 0); });
    app.on('render', () => { const I = CS.Inventory; if (I && I.misc) st.miscMax = Math.max(st.miscMax, I.miscTotal(I.misc())); check(); });
    app.on('save', () => ({ milestones: st }));
    app.on('load', (ext) => { const d = ext && ext.milestones; st = Object.assign(newState(), d && typeof d === 'object' ? d : {}); render(); });
    app.on('newgame', () => { st = newState(); render(); });
    app.on('boot', () => {
      panel = app.addPanel('left', 'milestones-panel', 'Milestones', 'bank-panel');
      panel.querySelector('h2').appendChild(app.el('span', 'tag', ''));
      panel.appendChild(app.el('div', 'ms-body'));
      st.rankSeen = Math.max(st.rankSeen || 0, app.rankOf ? app.rankOf(app.netWorth()).idx : 0);
      ready = true; render();
    });
    CS.Milestones.live = { state: () => st, lotRun: () => { st.lotsRun++; check(); } };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
