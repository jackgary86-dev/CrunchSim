/* CrunchSim module: run economics (tickets #18 to #22). Pure helpers behind the pre-run projection on the RUN BATCH
 * button, the bucket price breakdown, wear cost and servicing forecasts, the per-machine power and consumables table
 * on the score card, and the loss diagnosis. Nothing here touches the DOM: app.js draws the plant panel, the bins, the
 * machine panel and the score card from these numbers, and tests/economics.js runs them in Node.
 *
 * Every function takes the physics core's own outputs (Sim.evalLine nodes and terminals, Sim.binStats, Sim.prices) so
 * the numbers on the page are the numbers the batch is settled with.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.Sim || !CS.MATERIALS) return;
  const MATERIALS = CS.MATERIALS, MACHINES = CS.MACHINES, Sim = CS.Sim;
  const FX = CS.LEVEL_FX || { cap: 0.2, eta: 0.06, life: 0.3, power: 0.1 };

  /* ---------------- constants ---------------- */
  const AUTO_SERVICE_AT = 0.8;   // condition-based maintenance: liners, hammers and knives are changed at about 80% of wear life so the change is planned, not a breakdown
  const SERVICE_MIN = 0.15;      // a service call-out carries a fixed cost (labour, crane, lost shift): at least 15% of the full liner set even when little is worn
  const RESIST = 0.3;            // below 30% mechanism response a material is "resistant": the same threshold sim.js warns at
  const MIXED_GRADE = 0.6;       // a bin whose price grade is under 60% is a mixed or reject lot rather than a product
  const MIN_LOSS = 2;            // $/t of head feed: smaller gaps are rounding, not a diagnosis
  const NOISE = 0.5;             // $/t: a cost line under fifty cents a tonne is not worth a row

  function money(x) { return CS.Score.fmtMoney(x); }
  function fmtMm(mm) { if (!(mm > 0)) return '--'; return mm >= 1 ? (mm >= 100 ? mm.toFixed(0) : mm.toFixed(1)) + ' mm' : Math.round(mm * 1000) + ' µm'; }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function nodeOf(ev, uid) { return ev.nodes.find(function (n) { return n.uid === uid; }) || null; }
  function label(n) { return n ? (n.index + 1) + ' ' + n.M.short : '?'; }

  /* ---------------- #18 pre-run projection ----------------
   * m is marginPerT() from app.js: { rev, feedC, powerC, extra, wearC, margin } in $ per head tonne. tons is the batch.
   * nodes are ev.nodes (for their warnings). Returns the projected net and, when it is negative, a one-line reason in
   * the order the ticket lists them: a wrong machine for the material, feed dearer than its products, then energy.
   */
  function projectBatch(m, tons, nodes) {
    const net = m.margin * tons;
    let reason = '', cause = '';
    if (m.margin < 0) {
      const wrong = wrongMachine(nodes || []);
      if (wrong) { cause = 'machine'; reason = 'Wrong machine: node ' + wrong.label + ', ' + wrong.text; }
      else if (m.feedC >= m.rev) { cause = 'feed'; reason = 'Feed costs ' + money(m.feedC) + '/t but the products sell for ' + money(m.rev) + '/t.'; }
      else if (m.powerC >= m.rev - m.feedC) { cause = 'energy'; const rs = resisting(nodes || []); reason = 'Energy: ' + money(m.powerC) + '/t of power on ' + money(m.rev - m.feedC) + '/t of product after feed' + (rs ? ' (' + rs.label + ': ' + rs.text + ')' : '.'); }
      else { cause = 'consumables'; reason = 'Consumables and wear (' + money(m.extra + m.wearC) + '/t) eat the ' + money(m.rev - m.feedC - m.powerC) + '/t left after feed and power.'; }
    }
    return { net: net, perT: m.margin, negative: m.margin < 0, cause: cause, reason: reason };
  }
  /* first fault-level warning on any node (wrong furnace, knives on tramp metal, wasted nitrogen, ferrous on the eddy
   * rotor): { label, text } or null. A "resists" warning on a minor constituent is not a wrong machine; see resisting(). */
  function wrongMachine(nodes) { return firstWarning(nodes, function (w) { return w.level === 'bad'; }); }
  /* first "resists this mechanism" warning: the material soaking up the energy */
  function resisting(nodes) { return firstWarning(nodes, function (w) { return /resists this mechanism/.test(w.text); }); }
  function firstWarning(nodes, test) {
    let hit = null;
    nodes.some(function (n) {
      const w = (n.warnings || []).find(test);
      if (w) hit = { label: label(n), text: w.text.split('. ')[0].replace(/\.$/, '') + '.' };
      return !!hit;
    });
    return hit;
  }

  /* ---------------- #19 bucket pricing ----------------
   * st is Sim.binStats(...) for one bin; market is Sim.prices.market. The bin sells for perT $/t. The dominant
   * material's price is list x grade x size (x dross for a dross bin): the two discounts the ticket asks to show.
   */
  function binPricing(st, market) {
    market = market == null ? 1 : market;
    let dom = null, domMass = 0;
    for (const mat in st.perMat) if (st.perMat[mat].mass > domMass) { domMass = st.perMat[mat].mass; dom = mat; }
    if (!dom) return null;
    const D = MATERIALS[dom], pm = st.perMat[dom], ingot = st.form === 'ingot';
    const list = (ingot ? (D.ingot || D.sell) : D.sell) * market;
    const sf = pm.sizeFactor == null ? 1 : pm.sizeFactor, grade = st.grade;
    const base = pm.mass / 1000 * list * sf * grade;
    const form = base > 0 ? pm.value / base : 1;   // 0.15 for dross; 1 for scrap and ingots
    const perT = st.total > 0 ? st.value / (st.total / 1000) : 0;
    const text = money(list) + ' × ' + grade.toFixed(2) + ' purity × ' + sf.toFixed(2) + ' size' + (Math.abs(form - 1) > 0.01 ? ' × ' + form.toFixed(2) + ' ' + (st.form || 'form') : '');
    return { perT: perT, dom: dom, name: D.name, list: list, grade: grade, sf: sf, form: form, domPerT: list * sf * grade * form, text: text };
  }

  /* ---------------- #20 wear and servicing ---------------- */
  function serviceCost(M, wear) { return Math.round(M.service * Math.max(SERVICE_MIN, wear || 0)); }
  /* head tonnes until this node is worn out and until it reaches the auto-service point; null when it does not wear */
  function wearForecast(node, info) {
    const M = MACHINES[node.m]; if (!M || M.life >= 1e8) return null;
    const w = info && info.wearPerHeadT; if (!(w > 0)) return null;
    const wear = node.wear || 0;
    return { toWorn: Math.max(0, 1 - wear) / w, toService: Math.max(0, AUTO_SERVICE_AT - wear) / w, perT: w };
  }
  function shouldAutoService(node, at) { return !!(node && node.autoService && (node.wear || 0) >= (at == null ? AUTO_SERVICE_AT : at)); }
  /* #193: wear and the AUTO-service flag belong to the owned unit, not the node. A removed node leaves its state on a shelf
   * (stash[machine] = [{ wear, autoService }]) and the next ADD of that type takes it back, so REMOVE + ADD is not a free service. */
  function shelve(stash, node) { if (!node || !(node.wear > 0 || node.autoService)) return; (stash[node.m] = stash[node.m] || []).push({ wear: node.wear || 0, autoService: !!node.autoService }); }
  function unshelve(stash, node) { const u = stash[node.m] && stash[node.m].pop(); if (!u) return; node.wear = u.wear; node.autoService = u.autoService; }
  /* a rebuilt line (preset, blueprint, playbook) keeps wear per unit: the old line's nodes and the shelf's units of each type are
   * dealt to the new nodes of that type worst first, so one worn unit does not wear every node. Units the new line has no node
   * for go back on the shelf, and the units it took leave it (no phantom wear for a later ADD). */
  function carryWear(oldLine, stash, nodes) {
    const pool = {};
    (oldLine || []).forEach(function (n) { (pool[n.m] = pool[n.m] || []).push({ wear: n.wear || 0, autoService: !!n.autoService }); });
    for (const m in (stash || {})) (stash[m] || []).forEach(function (u) { (pool[m] = pool[m] || []).push({ wear: u.wear || 0, autoService: !!u.autoService }); });
    for (const m in pool) pool[m].sort(function (a, b) { return b.wear - a.wear; });
    nodes.forEach(function (n) { const u = pool[n.m] && pool[n.m].shift(); if (u) { n.wear = u.wear; n.autoService = u.autoService; } });
    if (stash) {
      for (const m in stash) delete stash[m];
      for (const m in pool) { const rest = pool[m].filter(function (u) { return u.wear > 0 || u.autoService; }).reverse(); if (rest.length) stash[m] = rest; }   // unshelve pops the worst
    }
    return nodes;
  }
  /* wear cost per head tonne of the whole line: what the liners consumed, priced at the service bill */
  function wearCost(nodes) { let c = 0; (nodes || []).forEach(function (n) { c += (n.wearPerHeadT || 0) * n.M.service; }); return c; }

  /* ---------------- #21 power and consumables ----------------
   * acc[uid] accumulates per node during a run: idle kWh (pidle x hours), process kWh (ePerHead x tonnes), liquid
   * nitrogen kg and the consumables bill (media, flux, electrodes, nitrogen) in $, plus the wear accrued in $.
   * Mirrors what stepRun in app.js charges, so the table on the score card sums to the metered kWh.
   */
  function accrue(acc, info, tons, dh) {
    const a = acc[info.uid] || (acc[info.uid] = { idle: 0, proc: 0, ln2: 0, extra: 0, wear: 0 });
    a.idle += info.M.pidle * dh; a.proc += info.ePerHead * tons;
    a.ln2 += (info.ln2PerHeadT || 0) * tons; a.extra += (info.extraCostPerHeadT || 0) * tons;
    a.wear += (info.wearPerHeadT || 0) * tons * info.M.service;
    return a;
  }
  /* projection of the same accumulators for a batch of `tons` at head rate R, from the live evaluation */
  function projectAccounts(nodes, tons, R) {
    const acc = {}; const dh = R > 0 ? tons / R : 0;
    (nodes || []).forEach(function (n) { accrue(acc, n, tons, dh); });
    return acc;
  }
  function consumableName(M) {
    if (M.ln2) return 'liquid nitrogen';
    if (M.mediaCost) return 'heavy medium';
    if (M.kind === 'furnace') return M.id === 'arc' ? 'electrodes and flux' : 'flux';
    return 'consumables';
  }
  /* rows for the score card: one per machine with idle / process kWh and power cost, then nitrogen and media lines */
  function powerTable(acc, nodes, prices) {
    prices = prices || Sim.prices;
    const rows = [], extras = []; const tot = { idle: 0, proc: 0, kwh: 0, cost: 0, ln2Kg: 0, ln2C: 0, mediaC: 0, wear: 0 };
    const byUid = {}; (nodes || []).forEach(function (n) { byUid[n.uid] = n; });
    const uids = Object.keys(acc).sort(function (a, b) { const na = byUid[a], nb = byUid[b]; return (na ? na.index : 1e9) - (nb ? nb.index : 1e9); });
    uids.forEach(function (uid) {
      const a = acc[uid], n = byUid[uid], M = n ? n.M : null;
      const kwh = a.idle + a.proc, cost = kwh * prices.power;
      rows.push({ uid: +uid, idx: n ? n.index : -1, short: M ? M.short : 'gone', name: M ? M.name : 'removed machine', idle: a.idle, proc: a.proc, kwh: kwh, cost: cost });
      tot.idle += a.idle; tot.proc += a.proc; tot.kwh += kwh; tot.cost += cost; tot.wear += a.wear;
      const ln2C = a.ln2 * prices.ln2, mediaC = Math.max(0, a.extra - ln2C);
      if (a.ln2 > 0) { extras.push({ uid: +uid, idx: n ? n.index : -1, short: M ? M.short : 'gone', what: 'liquid nitrogen', qty: a.ln2, unit: 'kg', cost: ln2C }); tot.ln2Kg += a.ln2; tot.ln2C += ln2C; }
      if (mediaC > NOISE / 100) { extras.push({ uid: +uid, idx: n ? n.index : -1, short: M ? M.short : 'gone', what: M ? consumableName(M) : 'consumables', qty: 0, unit: '', cost: mediaC }); tot.mediaC += mediaC; }
    });
    return { rows: rows, extras: extras, totals: tot };
  }

  /* ---------------- #22 loss diagnosis ----------------
   * For every material in the head feed, the gap between what it would fetch as a clean, in-spec product and what the
   * bins pay for it, split by cause:
   *   scalp   it sits in a comminution rejects bin: too big for that machine's feed opening
   *   reject  it sits in a dross bin, or is diluted in a mixed bin and sold at that bin's price grade
   *   size    it is sold outside its size spec (binStats size factor)
   *   energy  power spent breaking it in a machine whose mechanism it resists (response under 30%)
   * The top three by total loss carry the largest cause as text. perNode attributes $/t to each machine: its power,
   * wear and consumables, plus the value lost in its own rejects and dross bins.
   */
  function lossReport(ev, line, R, prices) {
    prices = prices || Sim.prices;
    const head = ev.head;
    const bins = ev.terminals.map(function (t) { return { t: t, st: Sim.binStats(t.stream.m, t.form), n: nodeOf(ev, t.uid) }; });
    const all = [], scalpByNode = {};
    for (const m in head.m) {
      const hm = Sim.sum(head.m[m]); if (hm < 5) continue;
      const D = MATERIALS[m], ideal = hm / 1000 * D.sell * prices.market; if (ideal < 1) continue;
      const parts = { scalp: 0, reject: 0, size: 0, energy: 0 };
      let got = 0, scalpBin = null, rejBin = null, sizeBin = null, eNode = null;
      bins.forEach(function (b) {
        const a = b.t.stream.m[m]; if (!a) return; const mass = Sim.sum(a); if (mass <= 0) return;
        const pm = b.st.perMat[m]; if (!pm) return;
        const full = mass / 1000 * D.sell * prices.market, gap = Math.max(0, full - pm.value);
        const sizePart = Math.max(0, full * (1 - (pm.sizeFactor == null ? 1 : pm.sizeFactor)));
        if (b.t.port === 'rejects') { parts.scalp += gap; scalpByNode[b.t.uid] = (scalpByNode[b.t.uid] || 0) + gap; if (!scalpBin || mass > scalpBin.mass) scalpBin = { b: b, mass: mass }; }
        else if (b.t.port === 'dross') { parts.reject += gap; scalpByNode[b.t.uid] = (scalpByNode[b.t.uid] || 0) + gap; if (!rejBin || gap > rejBin.gap) rejBin = { b: b, mass: mass, gap: gap, dross: true }; }
        else {
          const gradePart = Math.max(0, gap - sizePart);
          parts.size += sizePart; parts.reject += gradePart;
          if (gradePart > 0 && (!rejBin || gradePart > rejBin.gap)) rejBin = { b: b, mass: mass, gap: gradePart, dross: false };
          if (sizePart > 0 && (!sizeBin || sizePart > sizeBin.gap)) sizeBin = { b: b, mass: mass, gap: sizePart, p80: pm.p80 };
        }
        got += pm.value;
      });
      ev.nodes.forEach(function (n) {
        if (n.kind !== 'comminution') return; const pm = n.perMat[m]; if (!pm || !(pm.accMass > 0) || pm.liquid) return;
        if (pm.resp < RESIST) { const c = pm.E * pm.accMass / 1000 * prices.power; parts.energy += c; if (!eNode || c > eNode.cost) eNode = { n: n, cost: c, resp: pm.resp }; }
      });
      const loss = parts.scalp + parts.reject + parts.size + parts.energy;
      let cause = 'reject', best = -1; for (const k in parts) if (parts[k] > best) { best = parts[k]; cause = k; }
      let text = '', uid = null;
      if (cause === 'scalp' && scalpBin) { const n = scalpBin.b.n; uid = n ? n.uid : null; text = pct(scalpBin.mass / hm) + ' of it is scalped at ' + label(n) + ': too big for the ' + fmtMm(n ? n.M.maxFeed : 0) + ' feed opening.'; }
      else if (cause === 'reject' && rejBin) { const n = rejBin.b.n; uid = n ? n.uid : null; text = rejBin.dross ? pct(rejBin.mass / hm) + ' of it goes to dross in ' + label(n) + ', paid at scrap-in-dross rates.' : pct(rejBin.mass / hm) + ' of it sits in ' + label(n) + '/' + rejBin.b.t.port + ' at ' + pct(rejBin.b.st.share) + ' purity, price grade ' + pct(rejBin.b.st.grade) + '.'; }
      else if (cause === 'size' && sizeBin) { const n = sizeBin.b.n; uid = n ? n.uid : null; const below = sizeBin.p80 < D.range[0]; text = pct(sizeBin.mass / hm) + ' of it is sold ' + (below ? 'below' : 'above') + ' its ' + fmtMm(D.range[0]) + ' to ' + fmtMm(D.range[1]) + ' size spec (P80 ' + fmtMm(sizeBin.p80) + ' in ' + label(n) + '/' + sizeBin.b.t.port + ').'; }
      else if (cause === 'energy' && eNode) { uid = eNode.n.uid; text = money(eNode.cost) + '/t of power breaking it in ' + label(eNode.n) + ', where it resists the mechanism (response ' + pct(eNode.resp) + ').'; }
      else text = 'diluted across mixed bins.';
      all.push({ m: m, name: D.name, loss: loss, ideal: ideal, got: got, parts: parts, cause: cause, text: text, uid: uid });
    }
    all.sort(function (a, b) { return b.loss - a.loss; });
    const losses = all.filter(function (l) { return l.loss >= MIN_LOSS; }).slice(0, 3);
    const perNode = ev.nodes.map(function (n, k) {
      const node = line && line[k] ? line[k] : {}, lvl = Sim.levelOf(node);
      const P = Math.min(n.M.prated * (1 + FX.power * lvl), n.M.pidle + R * n.ePerHead);
      const power = R > 0 ? P / R * prices.power : 0, wear = (n.wearPerHeadT || 0) * n.M.service, extra = n.extraCostPerHeadT || 0, scalp = scalpByNode[n.uid] || 0;
      return { uid: n.uid, idx: k, short: n.M.short, name: n.M.name, power: power, wear: wear, extra: extra, scalp: scalp, total: power + wear + extra + scalp };
    });
    return { losses: losses, all: all, perNode: perNode };
  }

  /* "what would have earned": the margin a trial-added machine (a pick from nextPurchases in app.js) would have made */
  function betterLine(pick, margin, tons) {
    if (!pick || !(pick.gain > NOISE)) return null;
    const perT = margin + pick.gain;
    const ms = pick.ms || [pick.m];   // a single machine or, since #52, a pair that only pays together
    return { m: ms[0], ms: ms, port: pick.port || (pick.src && pick.src.port), src: pick.src || null, gain: pick.gain, perT: perT, net: perT * tons, base: margin * tons };
  }

  CS.Economics = {
    shelve: shelve, unshelve: unshelve, carryWear: carryWear,
    AUTO_SERVICE_AT: AUTO_SERVICE_AT, SERVICE_MIN: SERVICE_MIN, RESIST: RESIST, MIXED_GRADE: MIXED_GRADE, MIN_LOSS: MIN_LOSS, NOISE: NOISE,
    projectBatch: projectBatch, wrongMachine: wrongMachine, resisting: resisting, binPricing: binPricing,
    serviceCost: serviceCost, wearForecast: wearForecast, shouldAutoService: shouldAutoService, wearCost: wearCost,
    accrue: accrue, projectAccounts: projectAccounts, powerTable: powerTable, consumableName: consumableName,
    lossReport: lossReport, betterLine: betterLine, money: money, fmtMm: fmtMm
  };
})(typeof window !== 'undefined' ? window : globalThis);
