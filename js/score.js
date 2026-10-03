/* CrunchSim contracts: spec-sheet jobs scored with stars. No DOM here, so tests/contracts.js can run it in Node.
 *
 * A contract names a feed the client supplies (toll processing: feed costs nothing), a tonnage, the target
 * material(s), and a spec: minimum purity, minimum recovery, a P80 window and an energy cap.
 * Every terminal bin whose target purity and target P80 meet the spec is SHIPPED; recovery is the shipped
 * target mass over the target mass in the head feed. That is how a real QC desk works: off-spec lots stay home.
 *
 * Stars: 1 = at least one shippable bin and recovery >= recMin;  2 = also plant energy <= kwhCap;
 *        3 = also merged purity >= purityGoal and recovery >= recGoal.
 * Fee = fee $/t of target delivered x (0.8, 1.0, 1.2) for 1, 2, 3 stars.
 */
(function (G) {
  'use strict';
  const CS = G.CS, Sim = CS.Sim;
  const FX = CS.LEVEL_FX || { power: 0.1 };

  const CONTRACTS = [
    { id: 'ferrous', name: 'Ferrous shred', client: 'Steel mill', feed: 'elv', tons: 20, targets: ['steel', 'castiron'], label: 'ferrous scrap',
      purityMin: 0.90, purityGoal: 0.97, recMin: 0.85, recGoal: 0.95, p80: [0, 200], kwhCap: 6, fee: 45,
      lesson: 'Steel is tough and ductile. Hammers cost megawatts to break it; a slow shear tears it for a fraction of the energy. A magnet then pulls it clean.',
      hint: 'Shred, then a magnetic drum. Watch the kWh/t.' },
    { id: 'mulch', name: 'Clean mulch', client: 'Landscaping co-op', feed: 'pallets', tons: 15, targets: ['wood'], label: 'wood chips',
      purityMin: 0.97, purityGoal: 0.975, recMin: 0.85, recGoal: 0.95, p80: [5, 80], kwhCap: 7, fee: 22,
      lesson: 'Wood is fibrous: cut it or beat it, but never run it past knives with nails still in it. The magnet goes before anything with an edge.',
      hint: 'Pallets are 1.2 m long. Reduce them before any chipper.' },
    // purityGoal 0.975: the 2% plastic trim is cut and floats with the wood, so 93/95 = 97.9% is the ceiling once the steel is out
    // (measured in tests/contracts.js). kwhCap 8: shear-magnet-chipper runs at 6.2 kWh/t, a hammermill at 11.9.
    { id: 'chair', name: 'Office clear-out', client: 'Facilities department', feed: 'chair', tons: 10, targets: ['wood'], label: 'wood chips',
      purityMin: 0.97, purityGoal: 0.975, recMin: 0.85, recGoal: 0.95, p80: [5, 40], kwhCap: 8, fee: 30,
      lesson: 'Desks are particleboard full of screws and staples. A knife that meets a screw is finished, so the magnet goes before the chipper, and a slow shear shredder goes first so the drum will even accept the pieces.',
      hint: 'Tear, magnet, then chips under 40 mm. A hammermill makes the size but not the energy cap.' },
    { id: 'roadbase', name: 'Road base 8/25', client: 'County roads', feed: 'quarry', tons: 30, targets: ['granite', 'limestone'], label: 'aggregate',
      purityMin: 0.99, purityGoal: 0.99, recMin: 0.85, recGoal: 0.95, p80: [8, 25], kwhCap: 4, fee: 9,
      lesson: 'Every kilowatt-hour spent grinding below the size the customer wants is thrown away. Bond\'s law says energy climbs steeply as the product gets finer.',
      hint: 'Two compression stages and a screen. No mill.' },
    { id: 'flour', name: 'Rock flour', client: 'Filler plant', feed: 'quarry', tons: 30, targets: ['granite', 'limestone'], label: 'rock flour',
      purityMin: 0.99, purityGoal: 0.99, recMin: 0.70, recGoal: 0.90, p80: [0, 0.6], kwhCap: 12, fee: 28,
      lesson: 'A ball mill only takes small feed: crush in stages first or most of the rock is scalped at the inlet. Fine grinding is where the energy goes.',
      hint: 'Jaw, cone, then the mill. Screen oversize is lost unless you grind it too.' },
    { id: 'rebar', name: 'Rubble to aggregate', client: 'Demolition contractor', feed: 'rubble', tons: 25, targets: ['granite', 'limestone'], label: 'recycled aggregate',
      purityMin: 0.88, purityGoal: 0.95, recMin: 0.80, recGoal: 0.92, p80: [0, 40], kwhCap: 9, fee: 14,
      lesson: 'Concrete breaks, rebar does not. Pull the steel with a magnet and float the timber and plastic off with air before the second crushing stage.',
      hint: 'Crush, magnet, air classifier, crush again.' },
    { id: 'crumb', name: 'Crumb rubber', client: 'Sports surfaces', feed: 'tires', tons: 8, targets: ['rubber'], label: 'rubber crumb',
      purityMin: 0.75, purityGoal: 0.90, recMin: 0.80, recGoal: 0.92, p80: [0, 1.5], kwhCap: 80, fee: 260,
      lesson: 'Rubber bounces at room temperature. Below its glass transition it shatters like glass, so cryogenic milling makes fine crumb. The nitrogen bill is the price.',
      hint: 'Tear, cut, blow the fabric off while the pieces are still big, freeze-shatter, then pull the bead wire.' },
    { id: 'zorba', name: 'Zorba aluminum', client: 'Secondary smelter', feed: 'zorba', tons: 10, targets: ['aluminum'], label: 'aluminum',
      purityMin: 0.93, purityGoal: 0.97, recMin: 0.70, recGoal: 0.85, p80: [0, 150], kwhCap: 8, fee: 320,
      lesson: 'Eddy currents throw every conductor, so they cannot sort metals from each other. Density can: aluminum floats in a 3 g/cc medium while zinc, brass and copper sink.',
      hint: 'Shred to under 150 mm, then a sink-float tank. The medium density is the puzzle.' },
    { id: 'gel', name: 'Micronized gel', client: 'Cosmetics lab', feed: 'gel', tons: 2, targets: ['gel'], label: 'gel paste',
      purityMin: 0.99, purityGoal: 0.99, recMin: 0.90, recGoal: 0.98, p80: [0, 0.05], kwhCap: 150, fee: 420,
      lesson: 'A soft solid does not fracture. Cut it small, then shear it through micron gaps. Pressure drop through a valve is the last mile to sub-micron.',
      hint: 'Knives, then a colloid mill, then a homogenizer.' }
  ];
  CONTRACTS.forEach(function (c) { c.p80 = c.p80.map(function (v) { return v === 0 ? 0 : v; }); });

  function plantKwhT(ev, R, line) {
    if (!(R > 0)) return Infinity;
    let P = 0;
    ev.nodes.forEach(function (n, i) {
      const lvl = line && line[i] ? (line[i].level || 0) : 0;
      P += Math.min(n.M.prated * (1 + FX.power * lvl), n.M.pidle + R * n.ePerHead);
    });
    return P / R;
  }

  /* Evaluate a contract against a line. run = { kwh, done } for a finished or running batch, or null for a projection. */
  function evalContract(C, line, run) {
    const comp = CS.FEEDS[C.feed].comp;
    const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
    const kwhT = run && run.done > 0 ? run.kwh / run.done : plantKwhT(ev, R, line);
    let headT = 0; C.targets.forEach(function (m) { if (ev.head.m[m]) headT += Sim.sum(ev.head.m[m]); });
    const NB = Sim.NB;
    const bins = ev.terminals.map(function (t) {
      const st = Sim.binStats(t.stream.m);
      let tMass = 0; const tArr = new Float64Array(NB);
      C.targets.forEach(function (m) { const a = t.stream.m[m]; if (a) { for (let i = 0; i < NB; i++) tArr[i] += a[i]; tMass += Sim.sum(a); } });
      const purity = st.total > 0 ? tMass / st.total : 0, p80 = tMass > 0 ? Sim.percentile(tArr) : 0;
      const shippable = st.total > 0.5 && tMass > 0 && purity >= C.purityMin && p80 >= C.p80[0] && p80 <= C.p80[1];
      return { key: t.key, uid: t.uid, port: t.port, st: st, tMass: tMass, tArr: tArr, purity: purity, p80: p80, shippable: shippable };
    });
    const shipped = bins.filter(function (b) { return b.shippable; });
    let sMass = 0, sTot = 0; const sArr = new Float64Array(NB);
    shipped.forEach(function (b) { sMass += b.tMass; sTot += b.st.total; for (let i = 0; i < NB; i++) sArr[i] += b.tArr[i]; });
    const purity = sTot > 0 ? sMass / sTot : 0, recovery = headT > 0 ? sMass / headT : 0, p80 = sMass > 0 ? Sim.percentile(sArr) : 0;
    const checks = [
      { k: 'purity', label: 'PURITY', value: purity, text: Math.round(purity * 100) + '%', need: '≥ ' + Math.round(C.purityMin * 100) + '%', goal: '≥ ' + Math.round(C.purityGoal * 100) + '%', ok: shipped.length > 0 && purity >= C.purityMin, great: purity >= C.purityGoal },
      { k: 'recovery', label: 'RECOVERY', value: recovery, text: Math.round(recovery * 100) + '%', need: '≥ ' + Math.round(C.recMin * 100) + '%', goal: '≥ ' + Math.round(C.recGoal * 100) + '%', ok: recovery >= C.recMin, great: recovery >= C.recGoal },
      { k: 'p80', label: 'P80', value: p80, text: fmtMm(p80), need: C.p80[0] > 0 ? fmtMm(C.p80[0]) + ' to ' + fmtMm(C.p80[1]) : '≤ ' + fmtMm(C.p80[1]), goal: '', ok: shipped.length > 0, great: shipped.length > 0 },
      { k: 'energy', label: 'ENERGY', value: kwhT, text: isFinite(kwhT) ? kwhT.toFixed(1) + ' kWh/t' : '--', need: '≤ ' + C.kwhCap + ' kWh/t', goal: '', ok: kwhT <= C.kwhCap, great: kwhT <= C.kwhCap }
    ];
    let stars = 0, reason = '';
    if (!shipped.length) reason = 'No bin meets the spec: nothing can ship.';
    else if (recovery < C.recMin) reason = 'Only ' + Math.round(recovery * 100) + '% of the ' + C.label + ' reached a shippable bin (' + Math.round(C.recMin * 100) + '% needed).';
    else {
      stars = 1;
      if (kwhT <= C.kwhCap) stars = 2; else reason = 'Energy ' + kwhT.toFixed(1) + ' kWh/t is over the ' + C.kwhCap + ' kWh/t cap.';
      if (stars === 2) { if (purity >= C.purityGoal && recovery >= C.recGoal) stars = 3; else reason = 'Spec met. The goal is purity ' + Math.round(C.purityGoal * 100) + '% and recovery ' + Math.round(C.recGoal * 100) + '%.'; }
      if (stars === 3) reason = 'Spec and goals met.';
    }
    const tons = run && run.done > 0 ? run.done : C.tons;
    const deliveredT = sMass / 1000 * tons;
    const fee = stars > 0 ? C.fee * deliveredT * (0.6 + 0.2 * stars) : 0;
    return { ev: ev, mr: mr, R: R, kwhT: kwhT, headT: headT, bins: bins, shipped: shipped, purity: purity, recovery: recovery, p80: p80, checks: checks, stars: stars, reason: reason, deliveredT: deliveredT, fee: fee, tons: tons };
  }
  function fmtMm(mm) { if (!(mm > 0)) return '--'; return mm >= 1 ? (mm >= 100 ? mm.toFixed(0) : mm.toFixed(1)) + ' mm' : Math.round(mm * 1000) + ' µm'; }
  function signature(line) { return line.map(function (n) { return CS.MACHINES[n.m].short; }).join('>'); }

  CS.Score = { CONTRACTS: CONTRACTS, evalContract: evalContract, plantKwhT: plantKwhT, signature: signature, fmtMm: fmtMm };
})(typeof window !== 'undefined' ? window : globalThis);
