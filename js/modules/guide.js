/* CrunchSim module: the guided first lot (#79). Instead of a tour of panels, a new Progress game walks you through your
 * first lot on the real screen, one prompt at a time; each prompt waits for you to do the thing:
 *   1 buy the pallet lot in the $1k tier (dealt for the lesson, never a padded trap)
 *   2 look at THE BIN: everything the grinder breaks falls in there, mixed
 *   3 press RUN (RUN THE LOT or RUN BATCH: the pallet lot is a single batch, so both run it once; #315)
 *   4 the buckets: the wood comes out pure, so it SELLS; the magnet's nails carry splinters, so they wait in MISC
 *   5 sell the wood
 *   6 the first sorter to buy: a sink-float (water) tank, for the windows lots: wood floats, glass sinks
 *   7 the next lot: 1 BATCH or THE LOT beside RUN, then bigger lots
 * It can be skipped, and replayed from the help. Steps and their checks are pure (CS.Guide) for tests/guide.js.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;
  const STEPS = [
    { id: 'buy', title: 'BUY YOUR FIRST LOT', text: 'Material only comes from the scrap auction. Open the Auction and buy the pallets in the $1k tier: wood with nails in it, a lot your hammermill and magnet can handle.', target: ['#auction-panel .crow[data-lot] .cbtns button.buy', '#tool-auction'], wait: (s) => s.loaded },   // #104: the lot's BUY once the drawer is open
    { id: 'bin', title: 'THE BIN', text: 'The hammermill breaks the pallets and everything falls into THE BIN: wood, nails and a little plastic, all mixed. Mixed material sells for nothing. Sorting is how you make money.', target: '.fcol.bincol', next: true },
    { id: 'run', title: 'RUN IT', text: 'Press RUN (or Space). This lot is a single batch, so RUN THE LOT and RUN BATCH both run it once. The magnet pulls the nails out of the BIN while the batch runs, and the wood goes on past it.', target: '#btn-run', wait: (s) => s.batches >= 1 },
    { id: 'buckets', title: 'PURE SELLS, MIXED WAITS', text: 'With the nails out, the wood is over 90% pure, so it sells. The nails came off with splinters stuck to them: under 90% steel, so they wait in the MISC bucket until a sorter can clean them.', target: '.fcol.buckets', next: true },
    { id: 'sell', title: 'SELL THE WOOD', text: 'Press SELL on the wood bucket. Pure material pays a premium: the cleaner the bucket, the higher the price.', target: '.bk.shelf', wait: (s) => s.sold >= 1 },
    { id: 'pair', title: 'YOUR FIRST SORTER', text: 'From the $3k tier the board can deal old windows: wood, glass and steel. A sink-float (water) tank splits them: it comes filled with plain water (1.0 g/cc), so the wood floats and the glass sinks. The Plant drawer sells it, and NEXT PURCHASE ranks what each sorter would add. Each richer tier on the board needs the next machine.', target: '#tool-plant', next: true },
    { id: 'lot', title: 'THE NEXT LOT', text: 'Buy the next lot in the Auction. Once it is loaded, the choice beside RUN picks 1 BATCH (one batch) or THE LOT (batch after batch until the lot is used up). Then buy bigger lots, sell what is pure, and grow the plant. That is the game.', target: ['#run-pick', '#tool-auction'], next: true, last: true }   // #315: the first lot is used up by now
  ];
  /* the step to show: the first one not done; a waiting step is done when its check passes on the snapshot */
  function nextStep(done, snap) {
    for (const st of STEPS) {
      if (done[st.id]) continue;
      if (st.wait && st.wait(snap)) { done[st.id] = true; continue; }
      return st;
    }
    return null;
  }
  /* #256: Escape skips the guide, but only when it is not meant for something else: not already handled (a drawer or
   * dialog closing), and focus is inside the guide or on nothing in particular */
  function escapeSkips(key, handled, inLayer, onBody) { return key === 'Escape' && !handled && (inLayer || onBody); }
  CS.Guide = { STEPS, nextStep, escapeSkips };

  if (typeof document === 'undefined') return;
  function start() {
    const app = CS.app; if (!app || app.guideStarted) return; app.guideStarted = true;
    let g = { on: false, done: {}, finished: false }, layer = null, sold = 0, shownId = null;
    const snap = () => { const A = CS.Auction && CS.Auction.live; return { loaded: !!(A && A.pending() && app.S.feedOwner === 'auction'), batches: app.S.batches, sold }; };
    function begin() {
      if (app.S.mode !== 'progress') return;
      g = { on: true, done: {}, finished: false }; sold = 0;
      const A = CS.Auction && CS.Auction.live; if (A && A.dealTier) A.dealTier(0, 'pallets');
      app.save(); show();
    }
    function stop(why) { g.on = false; if (why === 'finished' || why === 'skipped') g.finished = true; if (layer) { layer.remove(); layer = null; } app.save(); }
    function show() {
      if (!g.on) return;
      const help = document.getElementById('help'); if (help && !help.classList.contains('hidden')) { if (layer) layer.classList.add('hidden'); return; }
      const st = nextStep(g.done, snap());
      if (!st) { stop('finished'); return; }
      if (!layer) {
        layer = document.createElement('div'); layer.className = 'guide'; shownId = null;
        layer.setAttribute('role', 'region'); layer.setAttribute('aria-label', 'Guided first lot');   // #256: a landmark, and the step text is announced when it changes
        layer.innerHTML = '<div class="g-ring" aria-hidden="true"></div><div class="g-box" tabindex="-1" aria-live="polite" aria-atomic="true"><div class="g-step"></div><b class="g-title"></b><p class="g-text"></p><div class="g-btns"><button type="button" class="g-skip">SKIP</button><button type="button" class="primary g-next">GOT IT</button></div></div>';
        document.body.appendChild(layer);
        layer.querySelector('.g-skip').addEventListener('click', () => { stop('skipped'); app.log('Guide skipped. You can replay it from the help (?).'); });
        layer.querySelector('.g-next').addEventListener('click', () => { const s2 = nextStep(g.done, snap()); if (s2 && s2.next) { g.done[s2.id] = true; if (s2.last) { stop('finished'); app.log('Guide finished. Good luck with the plant.', 'ok'); return; } } show(); });
      }
      layer.classList.remove('hidden');
      const k = STEPS.indexOf(st), fresh = shownId !== st.id; shownId = st.id;
      if (fresh) {   // show() runs every tick: rewriting identical text would re-announce it
        layer.querySelector('.g-step').textContent = 'FIRST LOT · STEP ' + (k + 1) + ' OF ' + STEPS.length;
        layer.querySelector('.g-title').textContent = st.title;
        layer.querySelector('.g-text').textContent = st.text;
      }
      const nb = layer.querySelector('.g-next'); nb.classList.toggle('hidden', !st.next); nb.textContent = st.last ? 'DONE' : 'GOT IT';
      place(st, fresh);
      if (fresh && k === 0) layer.querySelector('.g-box').focus({ preventScroll: true });   // #256: the first prompt takes focus once, so keyboard and screen-reader users land on it; later steps are announced, not forced
    }
    function place(st, fresh) {
      if (!layer) return;
      st = st || nextStep(g.done, snap()); if (!st) return;
      const t = [].concat(st.target).map((q) => document.querySelector(q)).find((x) => x && x.getClientRects().length), ring = layer.querySelector('.g-ring'), box = layer.querySelector('.g-box');
      if (!t || !t.getClientRects().length) { ring.style.display = 'none'; box.style.left = '50%'; box.style.top = '120px'; box.style.transform = 'translateX(-50%)'; return; }
      let r = t.getBoundingClientRect();
      // #302: a new step whose target is off screen brings it into view (no smooth scroll: the ring follows at once)
      if (fresh && (r.top < 0 || r.bottom > window.innerHeight) && t.scrollIntoView) { t.scrollIntoView({ block: 'center' }); r = t.getBoundingClientRect(); }
      ring.style.display = 'block';
      Object.assign(ring.style, { left: (r.left - 6) + 'px', top: (r.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
      const bw = 320, left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
      const bh = box.offsetHeight || 184, below = r.bottom + 14, above = r.top - bh - 14;
      let top = below + bh < window.innerHeight - 12 ? below : above >= 12 ? above : window.innerHeight - bh - 12;
      top = Math.max(12, Math.min(top, window.innerHeight - bh - 12));   // #302: always on screen, over the target if it must be
      Object.assign(box.style, { left: left + 'px', top: top + 'px', transform: 'none', width: bw + 'px' });
    }
    app.on('sale', () => { if (app.S.mode !== 'progress') return; sold++; if (g.on) show(); });   // #309: a Rivals sale does not finish a paused Progress guide's SELL step
    app.on('render', () => { if (g.on) show(); });
    app.on('batchComplete', () => { if (g.on) setTimeout(show, 50); });
    let acc = 0; app.on('tick', (p) => { if (!g.on) return; acc += (p && p.dt) || 0; if (acc > 0.4) { acc = 0; show(); } });
    window.addEventListener('resize', () => { if (g.on) place(); });
    let scrollQueued = false;   // #302: the ring and box are fixed: they follow the page when it scrolls
    window.addEventListener('scroll', () => { if (!g.on || scrollQueued) return; scrollQueued = true; requestAnimationFrame(() => { scrollQueued = false; place(); }); }, { passive: true, capture: true });
    document.addEventListener('keydown', (e) => {
      if (!g.on || !layer || layer.classList.contains('hidden')) return;
      const a = document.activeElement;
      if (CS.Guide.escapeSkips(e.key, e.defaultPrevented, !!(a && layer.contains(a)), !a || a === document.body)) { stop('skipped'); app.log('Guide skipped. You can replay it from the help (?).'); }
    });
    app.on('save', () => ({ guide: { on: g.on, done: g.done, finished: g.finished } }));
    app.on('load', (ext) => { const d = ext && ext.guide; g = { on: !!(d && d.on), done: (d && d.done) || {}, finished: !!(d && d.finished) }; if (!g.on && layer) { layer.remove(); layer = null; } });
    app.on('newgame', () => { if (layer) { layer.remove(); layer = null; } g = { on: false, done: {}, finished: false }; setTimeout(() => { if (app.S.mode === 'progress' && app.S.batches === 0 && !g.finished && !g.on) begin(); }, 0); });   // #99: a skipped or finished guide stays put after a mode switch
    app.on('modechange', () => { if (layer) { layer.remove(); layer = null; } });
    app.on('boot', () => {
      // replay from the help
      const box = document.querySelector('#help .modal-box');
      if (box && !box.querySelector('.g-replay')) {
        const p = app.el('p', 'small g-replay', '<a href="#">Play the guided first lot again</a>: a fresh lot in the $1k tier and the steps on the real screen.');
        p.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); const h = document.getElementById('help'); if (h) h.classList.add('hidden'); if (app.S.mode !== 'progress') app.switchMode('progress'); begin(); });
        box.insertBefore(p, box.querySelector('h3'));
      }
      if (app.S.mode === 'progress' && app.S.batches === 0 && !g.finished && !g.on) begin();
      else if (g.on) show();
    });
    CS.Guide.live = { begin, stop, state: () => g };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
