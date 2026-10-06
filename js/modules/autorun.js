/* CrunchSim module: run the whole lot (#74). RUN THE LOT, next to RUN BATCH, runs batch after batch until the loaded
 * lot is used up, without a score card in between, and stops early for trouble: STOP, a halted batch, a machine about to
 * wear out (98%), or a bank in the red. One summary card at the end covers the whole lot.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || typeof document === 'undefined') return;
  const WEAR_STOP = 0.98;
  function start() {
    const app = CS.app; if (!app || app.autorunStarted) return; app.autorunStarted = true;
    let run = null, btn = null;   // run: { lot, batches, t, net, kwh, stock0, misc0, money0 }
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
      run = { lot, batches: 0, t: 0, net: 0, kwh: 0, stock0: t0.stock, misc0: t0.misc, money0: app.S.money, paid: P && P.paid > 0 ? P.paid * (P.tons / (P.boughtTons || P.tons)) : 0 };
      app.log('Running the whole of lot #' + lot + ': batch after batch until it is used up.', 'ok');
      app.startRun(); if (!app.S.run) finish('the line could not start');
      label();
    }
    function trouble() {
      const worn = app.S.line.find((n) => (n.wear || 0) >= WEAR_STOP);
      if (worn) return CS.MACHINES[worn.m].name + ' is ' + Math.round(worn.wear * 100) + '% worn: service it at its station';
      if (app.S.money < 0) return 'the bank is in the red';
      return '';
    }
    function finish(why) {
      const r = run; run = null; label(); if (!r) return;
      const t1 = totals();
      const body = '<div class="card lotcard"><h2>LOT #' + r.lot + ' DONE<span>' + r.batches + ' batch' + (r.batches === 1 ? '' : 'es') + ' · ' + app.fmtNum(r.t, 1) + ' t</span></h2>' +
        '<div class="net ' + (r.net - r.paid >= 0 ? 'ok' : 'bad') + '"><small>THE WHOLE LOT · AFTER WHAT IT COST</small>' + (r.net - r.paid >= 0 ? '+' : '') + app.fmtMoney(r.net - r.paid) + '</div>' +
        '<div class="small">' + app.esc(why) + '</div>' +
        '<div class="rows"><div>Products made, less power and wear</div><b>' + app.fmtMoney(r.net) + '</b><div>Lot price</div><b>' + app.fmtMoney(r.paid) + '</b><div>Sorted stock added</div><b>' + app.fmtNum(Math.max(0, t1.stock - r.stock0), 1) + ' t</b><div>To MISC</div><b>' + app.fmtNum(Math.max(0, t1.misc - r.misc0), 1) + ' t</b><div>Power</div><b>' + app.fmtNum(r.kwh, 0) + ' kWh</b><div>Bank</div><b>' + app.fmtMoney(r.money0) + ' &#8594; ' + app.fmtMoney(app.S.money) + '</b></div>' +
        '<div class="tip small">Click to dismiss. Sell or refine your buckets, then buy the next lot.</div></div>';
      const sc = document.getElementById('scorecard');
      if (sc) { sc.innerHTML = body; sc.classList.remove('hidden'); }
      if (why === 'the lot is used up' && CS.Milestones && CS.Milestones.live) CS.Milestones.live.lotRun();
      app.log('Lot #' + r.lot + ': ' + r.batches + ' batches, ' + app.fmtNum(r.t, 1) + ' t, ' + (r.net - r.paid >= 0 ? '+' : '') + app.fmtMoney(r.net - r.paid) + ' after the lot price (' + why + ').', r.net - r.paid >= 0 ? 'ok' : 'warn');
    }
    app.on('batchComplete', (p) => {
      if (!run || !p || !p.r) return;
      run.batches++; run.t += p.r.done || 0; run.kwh += p.r.kwh || 0;
      run.net += (p.net || 0) + (p.r.held ? (p.r.rev || 0) : 0);   // cash plus the products put into stock, as the batch card counts it
      if (p.why !== 'complete') { finish(p.why === 'stopped' ? 'stopped by you' : 'the line halted'); return; }
      setTimeout(() => {
        if (!run) return;
        if (app.hideCard) app.hideCard();
        const why = trouble(); if (why) { finish('stopped: ' + why); return; }
        if (lotNow() !== run.lot || !app.S.feedPrepaid) { finish('the lot is used up'); return; }
        app.startRun();
        if (!app.S.run) finish('the line could not start');
      }, 250);
    });
    app.on('boot', () => {
      const ref = document.getElementById('btn-run'); if (!ref) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'btn-runlot';
      btn.addEventListener('click', go);
      ref.parentNode.insertBefore(btn, ref.nextSibling);
      label();
    });
    app.on('render', label);
    app.on('newgame', () => { run = null; label(); });
    app.on('modechange', () => { run = null; label(); });
    CS.Autorun = { live: { active: () => !!run, go, finish } };
  }
  if (CS.app) start();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
