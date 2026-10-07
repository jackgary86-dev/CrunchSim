/* CrunchSim module: run the whole lot (#74). RUN THE LOT runs batch after batch until the loaded
 * lot is used up, without a score card in between, and stops early for trouble: STOP, a halted batch, a machine about to
 * wear out (98%), or a bank in the red. One summary card at the end covers the whole lot.
 * #141: one RUN control in the header. A small choice beside RUN picks 1 BATCH or THE LOT (the lot when one is loaded, by
 * default); RUN becomes STOP while running; one speed button cycles 1x / 10x / 60x. The separate STOP, RUN THE LOT and three
 * speed buttons are hidden (kept in the page for the keyboard and the app's own wiring).
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || typeof document === 'undefined') return;
  const WEAR_STOP = 0.98;
  function start() {
    const app = CS.app; if (!app || app.autorunStarted) return; app.autorunStarted = true;
    let run = null, btn = null, pick = null, spd = null;
    let choice = 'lot';   // 'lot' | 'batch': what RUN starts when a lot is loaded (per browser)
    try { const c = localStorage.getItem('crunchsim.runChoice'); if (c === 'batch' || c === 'lot') choice = c; } catch (e) { /* ignore */ }   // run: { lot, batches, t, net, kwh, stock0, misc0, money0 }
    const lotNow = () => { const A = CS.Auction && CS.Auction.live, P = A && A.pending(); return P && app.S.feedOwner === 'auction' ? P.id : null; };
    const totals = () => { const I = CS.Inventory; if (!I) return { stock: 0, misc: 0 }; let t = 0; const s = I.stock(); for (const m in s) t += s[m].t; return { stock: t, misc: I.miscTotal(I.misc()) }; };
    function label() {
      if (!btn) return;
      btn.innerHTML = run ? '&#9632; STOP THE LOT' : '&#9654;&#9654; RUN THE LOT';
      btn.classList.toggle('running', !!run);
      btn.disabled = !run && (!!app.S.run || !lotNow());
      btn.title = run ? 'Stop after this batch... or press STOP to stop now' : lotNow() ? 'Run batch after batch until this lot is used up' : 'Load a lot from the auction first';
    }
    function go() {
      if (run) { finish('stopped by you'); return; }
      const lot = lotNow(); if (!lot || app.S.run) return;
      const t0 = totals();
      const P = CS.Auction.live.pending();
      run = { lot, batches: 0, t: 0, net: 0, rent: 0, kwh: 0, stock0: t0.stock, misc0: t0.misc, money0: app.S.money, paid: P && P.paid > 0 ? P.paid * (P.tons / (P.boughtTons || P.tons)) : 0 };
      app.log('Running the whole of lot #' + lot + ': batch after batch until it is used up.', 'ok');
      app.startRun(); if (!app.S.run) { run = null; label(); return; }   // nothing ran: no card, the app has said why
      label();
    }
    function trouble() {
      const worn = app.S.line.find((n) => (n.wear || 0) >= WEAR_STOP);
      if (worn) return CS.MACHINES[worn.m].name + ' is ' + Math.round(worn.wear * 100) + '% worn: service it at its station';
      const credit = app.S.mode === 'rivals' && CS.Round ? CS.Round.CREDIT || 0 : 0;   // a Rivals yard runs on its trade credit
      if (app.S.money < -credit) return credit ? 'the credit line is used up' : 'the bank is in the red';
      return '';
    }
    function finish(why) {
      const r = run; run = null; label(); if (!r) return;
      const t1 = totals(), gain = r.net - r.paid - r.rent;   // #303: yard rent is part of what the lot cost
      const body = '<div class="card lotcard"><h2>LOT #' + r.lot + ' DONE<span>' + r.batches + ' batch' + (r.batches === 1 ? '' : 'es') + ' · ' + app.fmtNum(r.t, 1) + ' t</span></h2>' +
        '<div class="net ' + (gain >= 0 ? 'ok' : 'bad') + '"><small>THE WHOLE LOT · AFTER WHAT IT COST</small>' + (gain >= 0 ? '+' : '') + app.fmtMoney(gain) + '</div>' +
        '<div class="small">' + app.esc(why) + '</div>' +
        '<div class="rows"><div>Products made, less power and wear</div><b>' + app.fmtMoney(r.net) + '</b><div>Lot price</div><b>' + app.fmtMoney(r.paid) + '</b>' + (r.rent > 0 ? '<div>Yard rent</div><b>' + app.fmtMoney(r.rent) + '</b>' : '') + '<div>Sorted stock added</div><b>' + app.fmtNum(Math.max(0, t1.stock - r.stock0), 1) + ' t</b><div>To MISC</div><b>' + app.fmtNum(Math.max(0, t1.misc - r.misc0), 1) + ' t</b><div>Power</div><b>' + app.fmtNum(r.kwh, 0) + ' kWh</b><div>Bank</div><b>' + app.fmtMoney(r.money0) + ' &#8594; ' + app.fmtMoney(app.S.money) + '</b></div>' +
        '<div class="tip small">Click to dismiss. Sell or refine your buckets, then buy the next lot.</div></div>';
      const sc = document.getElementById('scorecard');
      if (sc) { sc.innerHTML = body; sc.classList.remove('hidden'); }
      if (why === 'the lot is used up' && CS.Milestones && CS.Milestones.live) CS.Milestones.live.lotRun();
      app.log('Lot #' + r.lot + ': ' + r.batches + ' batches, ' + app.fmtNum(r.t, 1) + ' t, ' + (r.net - r.paid >= 0 ? '+' : '') + app.fmtMoney(r.net - r.paid) + ' after the lot price (' + why + ').', r.net - r.paid >= 0 ? 'ok' : 'warn');
    }
    app.on('batchComplete', (p) => {
      if (!run || !p || !p.r) return;
      run.batches++; run.t += p.r.done || 0; run.kwh += p.r.kwh || 0; run.rent += p.r.rent || 0;   // #303: the inventory hook (registered first) noted the yard rent paid
      run.net += (p.net || 0) + (p.r.held ? (p.r.rev || 0) : 0);   // cash plus the products put into stock, as the batch card counts it
      if (p.why !== 'complete') { const why = p.why === 'stopped' ? 'stopped by you' : 'the line halted'; setTimeout(() => finish(why), 0); return; }   // #318: after the app draws its batch card
      setTimeout(() => {
        if (!run || app.S.run) return;
        if (app.hideCard) app.hideCard();
        const why = trouble(); if (why) { finish('stopped: ' + why); return; }
        if (lotNow() !== run.lot || !app.S.feedPrepaid) { finish('the lot is used up'); return; }
        app.startRun();
        if (!app.S.run) finish('the line could not start');
      }, 250);
    });
    const lotChosen = () => choice === 'lot' && !!lotNow();
    app.runLabel = (on) => on ? (run ? '&#9632; STOP THE LOT' : '&#9632; STOP') : (lotChosen() ? '&#9654; RUN THE LOT' : '');
    function renderPick() {
      if (!pick) return;
      const has = !!lotNow() || !!run;
      pick.classList.toggle('hidden', !has);
      pick.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.c === choice); b.disabled = !!app.S.run; });
      if (spd) spd.textContent = (app.S.speed || 1) + '\u00d7';
    }
    app.on('boot', () => {
      const ref = document.getElementById('btn-run'); if (!ref) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'btn-runlot'; btn.className = 'hidden';
      btn.addEventListener('click', go);
      ref.parentNode.insertBefore(btn, ref.nextSibling);
      // RUN starts the whole lot when that is the choice; while anything runs the same button is STOP (app.startRun stops)
      ref.addEventListener('click', (e) => {
        if (run && !app.S.run) { e.stopImmediatePropagation(); finish('stopped by you'); return; }   // between two of the lot's batches: STOP means stop
        if (run || app.S.run || !lotChosen()) return;
        e.stopImmediatePropagation(); go();
      }, true);
      pick = document.createElement('div'); pick.className = 'runpick'; pick.id = 'run-pick';
      pick.innerHTML = '<button type="button" data-c="batch" title="RUN runs one batch">1 BATCH</button><button type="button" data-c="lot" title="RUN runs batch after batch until the lot is used up">THE LOT</button>';
      pick.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { choice = b.dataset.c; try { localStorage.setItem('crunchsim.runChoice', choice); } catch (e) { /* ignore */ } renderPick(); app.renderAll(); }));
      ref.parentNode.insertBefore(pick, btn);
      const stop = document.getElementById('btn-stop'); if (stop) stop.classList.add('hidden');
      const sp = document.querySelector('#top .speed');
      if (sp) {
        sp.querySelectorAll('.spd').forEach((b) => b.classList.add('hidden'));
        spd = document.createElement('button'); spd.type = 'button'; spd.className = 'spd-cycle'; spd.id = 'btn-speed'; spd.title = 'Sim speed: click to cycle 1x / 10x / 60x';
        spd.addEventListener('click', () => { const order = [1, 10, 60], i = order.indexOf(app.S.speed || 1), nx = order[(i + 1) % order.length]; const b = sp.querySelector('.spd[data-speed="' + nx + '"]'); if (b) b.click(); renderPick(); });
        sp.appendChild(spd);
      }
      label(); renderPick();
    });
    app.on('render', () => { label(); renderPick(); });
    app.on('batchStart', renderPick);
    app.on('tick', () => { if (spd && spd.textContent !== (app.S.speed || 1) + '×') spd.textContent = (app.S.speed || 1) + '×'; });   // the 1 2 3 keys
    app.on('newgame', () => { run = null; label(); });
    app.on('modechange', () => { run = null; label(); });
    CS.Autorun = { live: { active: () => !!run, go, finish } };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
