/* CrunchSim physics core. No DOM here, so it can be tested in Node.
 *
 * Particle size distributions (PSD) are mass arrays over NB log-spaced size bins.
 * A "stream" is { m: { materialId: Float64Array(NB) kg }, temp } where temp is 0 ambient, 1 frozen.
 * Everything is computed per 1000 kg (1 t) of head feed and scaled by the real flow later.
 *
 * Energy follows Bond's law:  E = 10 * Wi * (1/sqrt(P80) - 1/sqrt(F80))   [kWh/t, sizes in um]
 * divided by a machine efficiency and by how well the machine's mechanisms actually break the material.
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  const MATERIALS = CS.MATERIALS, MACHINES = CS.MACHINES;

  /* ---------- size bins: 1 um .. 1 m, quarter-decade ---------- */
  const NB = 24;
  const LOW = new Float64Array(NB), EDGE = new Float64Array(NB), MID = new Float64Array(NB);
  for (let i = 0; i < NB; i++) {
    LOW[i] = Math.pow(10, -3 + 0.25 * i);
    EDGE[i] = Math.pow(10, -3 + 0.25 * (i + 1));
    MID[i] = Math.sqrt(LOW[i] * EDGE[i]);
  }

  const LN80 = 1.6094379124341003; // -ln(0.2)
  function rrCum(x, p80, n) { return 1 - Math.exp(-LN80 * Math.pow(x / p80, n)); }

  /* Rosin-Rammler distribution truncated at `top`, as bin mass fractions summing to 1. */
  function makePSD(p80, n, top) {
    const f = new Float64Array(NB);
    p80 = Math.max(p80, 1e-4);
    const cTop = top && isFinite(top) ? Math.max(rrCum(top, p80, n), 1e-9) : 1;
    let prev = Math.min(1, rrCum(LOW[0], p80, n) / cTop);
    let sum = 0;
    for (let i = 0; i < NB; i++) {
      const c = Math.min(1, rrCum(EDGE[i], p80, n) / cTop);
      f[i] = Math.max(0, c - prev) + (i === 0 ? prev : 0);
      prev = c; sum += f[i];
    }
    if (sum <= 0) { f[NB - 1] = 1; sum = 1; }
    for (let i = 0; i < NB; i++) f[i] /= sum;
    return f;
  }

  function sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }

  /* Size (mm) below which fraction q of the mass lies. Log interpolation inside a bin. */
  function percentile(arr, q) {
    q = q || 0.8;
    const tot = sum(arr);
    if (tot <= 0) return 0;
    const target = q * tot; let cum = 0;
    for (let i = 0; i < NB; i++) {
      const next = cum + arr[i];
      if (next >= target) {
        const fr = arr[i] > 0 ? (target - cum) / arr[i] : 0;
        return Math.exp(Math.log(LOW[i]) + fr * (Math.log(EDGE[i]) - Math.log(LOW[i])));
      }
      cum = next;
    }
    return EDGE[NB - 1];
  }

  /* ---------- streams ---------- */
  function newStream(temp) { return { m: {}, temp: temp || 0 }; }
  function addArr(stream, mat, arr, scale) {
    const t = stream.m[mat] || (stream.m[mat] = new Float64Array(NB));
    const k = scale == null ? 1 : scale;
    for (let i = 0; i < NB; i++) t[i] += arr[i] * k;
  }
  function streamMass(st) { let t = 0; for (const k in st.m) t += sum(st.m[k]); return t; }
  function aggregate(st) {
    const a = new Float64Array(NB);
    for (const k in st.m) { const v = st.m[k]; for (let i = 0; i < NB; i++) a[i] += v[i]; }
    return a;
  }
  function scaleStream(st, k) {
    const o = newStream(st.temp); if (st.form) o.form = st.form;
    for (const mat in st.m) addArr(o, mat, st.m[mat], k);
    return o;
  }
  /* sizes (optional): { mat: p80 mm } for feed that is already broken, such as a re-run bucket of shred (#41); the
   * spread and the top-size ratio stay those of the material's own feed */
  function makeFeed(comp, kg, sizes) {
    kg = kg || 1000;
    const st = newStream(0);
    let tot = 0; for (const k in comp) tot += comp[k] > 0 ? comp[k] : 0;
    if (tot <= 0) return st;
    for (const mat in comp) {
      const f = comp[mat] / tot; if (!(f > 0)) continue;
      const D = MATERIALS[mat]; if (!D) continue;
      const p80 = sizes && sizes[mat] > 0 ? Math.min(sizes[mat], D.feed.p80) : D.feed.p80;
      addArr(st, mat, makePSD(p80, D.feed.n, D.feed.top * p80 / D.feed.p80), f * kg);
    }
    return st;
  }

  /* material response profile at temperature level T */
  function profileFor(D, T) {
    for (let t = Math.min(T, D.resp.length - 1); t >= 0; t--) if (D.resp[t]) return D.resp[t];
    return D.resp[0];
  }
  function mixResp(M, prof) {
    let r = 0; for (const k in M.mix) r += M.mix[k] * prof[k];
    return r;
  }

  const LN2_KJ_PER_KG = 259;     // usable cooling per kg of liquid nitrogen
  // Live prices; the game layer lowers them with plant upgrades. perMat: per-material price factors written by the market module.
  const prices = { power: 0.12, ln2: 0.12, market: 1.0, perMat: {} };
  function levelOf(node) { return Math.max(0, Math.min(CS.LEVEL_MAX || 5, node.level || 0)); }
  const FX = CS.LEVEL_FX || { cap: 0.2, eta: 0.06, life: 0.3, power: 0.1 };

  function warn(info, level, text) { info.warnings.push({ level, text }); }

  /* ======================= comminution machines ======================= */
  /* The Omniprocessor (M.omni, ticket #15) is the game's one fantasy exception: every solid breaks with the same response,
   * OMNI_EFF, whatever its mechanism profile, and every material leaves through an output port named by its material id, so
   * the terminal bins come out one per material. Liquids are not broken; they drain to their own port. Scalped oversize still
   * goes to 'rejects'. Energy, capacity, wear and power keep the ordinary comminution rules. */
  const OMNI_EFF = 0.9;   // fantasy: no real machine breaks rock, rubber, steel and gel equally well (real responses run 0.02 to 1.0)
  function procComminution(node, M, stream) {
    const s = node.settings, wear = node.wear || 0, lvl = levelOf(node);
    const out = newStream(stream.temp), rej = newStream(stream.temp);
    const omniOuts = M.omni ? {} : null;
    const T = Math.max(stream.temp, M.coldLevel || 0);
    const eta = Math.min(0.97, (M.etaFn ? M.etaFn(s) : M.eta) * (1 + FX.eta * lvl)) * (1 - 0.4 * wear);
    const life = M.life * (1 + FX.life * lvl);
    const eFac = M.eFactor ? M.eFactor(s) : 1;
    const coarsen = 1 + 0.5 * wear;
    const info = { kind: 'comminution', perMat: {}, warnings: [], accKg: 0, rejKg: 0, inKg: 0 };
    const accAgg = new Float64Array(NB), outAgg = new Float64Array(NB);
    let eKWh = 0, wearPer = 0, ln2 = 0, capNum = 0, rNum = 0, rDen = 0;
    const primary = M.settings && M.settings[0] ? s[M.settings[0].id] : 1;

    for (const mat in stream.m) {
      const D = MATERIALS[mat], arr = stream.m[mat], mass = sum(arr);
      if (mass <= 1e-9) continue;
      info.inKg += mass;
      const liquidNow = D.state === 'liquid' && T === 0;
      const prof = profileFor(D, T);
      let r = mixResp(M, prof);
      if (M.liquidOnly && !liquidNow) r = 0;
      if (M.excludeLiquid && liquidNow) r = 0;
      if (M.omni) r = liquidNow ? 0 : OMNI_EFF;
      const hyd = !!(M.physical || M.eSpec) && (M.mix.hyd || 0) > 0;

      // scalp what cannot enter
      const acc = new Float64Array(NB), rj = new Float64Array(NB);
      for (let i = 0; i < NB; i++) {
        const enters = M.liquidOnly ? liquidNow : (liquidNow ? true : MID[i] <= M.maxFeed);
        if (enters) acc[i] = arr[i]; else rj[i] = arr[i];
      }
      const accMass = sum(acc), rejMass = mass - accMass;
      if (rejMass > 1e-9) addArr(rej, mat, rj);
      info.rejKg += rejMass;

      const pm = { mass, accMass, rejMass, resp: r, F80: 0, P80: 0, E: 0, liquid: liquidNow };
      info.perMat[mat] = pm;
      if (accMass <= 1e-9) continue;

      const pr = M.product(s, D);
      const p80i = pr.p80 * coarsen, n = pr.n, top = pr.top * coarsen;
      info.topMm = Math.max(info.topMm || 0, top);
      const F80 = percentile(acc);
      const prod = new Float64Array(NB);

      for (let i = 0; i < NB; i++) {
        const a = acc[i]; if (a <= 0) continue;
        const x = MID[i];
        if (x <= p80i || r <= 0.001) { prod[i] += a; continue; }
        const pach = M.screened ? p80i : x * Math.pow(p80i / x, r);
        if (pach > 0.93 * x) { prod[i] += a; continue; }
        const psd = makePSD(pach, n, Math.min(EDGE[i], top * (pach / p80i)));
        for (let j = 0; j < NB; j++) prod[j] += a * psd[j];
      }
      addArr(omniOuts ? (omniOuts[mat] || (omniOuts[mat] = newStream(stream.temp))) : out, mat, prod);
      for (let i = 0; i < NB; i++) { accAgg[i] += acc[i]; outAgg[i] += prod[i]; }

      // energy
      let E = 0;
      if (M.physical === 'pressure') E = s.bar * 1e5 / (D.density * 1000) / 3600 / eta;   // J/kg -> kWh/t
      else if (M.eSpec) E = M.eSpec(s) / (eta / 0.55);
      else if (!liquidNow && F80 > p80i) {
        E = D.Wi * 10 * (1 / Math.sqrt(p80i * 1000) - 1 / Math.sqrt(F80 * 1000)) / (eta * Math.max(r, 0.04));
      }
      E *= eFac;
      pm.E = E; pm.F80 = F80; pm.P80 = percentile(prod);
      eKWh += E * accMass / 1000;

      // wear, nitrogen
      const abr = D.abrasion + (M.knife ? 4 * D.hard : 0) + (hyd ? 0.04 : 0);
      wearPer += accMass / 1000 * abr / life * 0.12;   // liners last many thousand tonnes
      if (M.ln2 && stream.temp < 1) ln2 += accMass * D.coolKJ / LN2_KJ_PER_KG;   // kg of LN2 per head-tonne; input a freezer already cooled needs none (#264)

      // capacity weighting
      capNum += accMass * Math.pow(D.density / 2.7, 0.8);
      if (!liquidNow) { rNum += accMass * r; rDen += accMass; }
    }

    info.accKg = sum(accAgg);
    const accT = info.accKg / 1000;
    const rAvg = rDen > 0 ? rNum / rDen : 1;
    const dens = info.accKg > 0 ? capNum / info.accKg : 1;
    const setF = Math.pow(Math.max(primary, 1e-6) / M.capRef, M.capExp);
    const rF = M.screened ? 0.25 + 0.75 * rAvg : 0.6 + 0.4 * rAvg;
    let capTph = M.cap * dens * setF * rF * (1 - 0.3 * wear) * (1 + FX.cap * lvl);
    capTph = Math.max(capTph, 0.05);

    Object.assign(info, {
      flowAcc: accT, flowRej: info.rejKg / 1000, flowIn: info.inKg / 1000,
      ePerHead: eKWh, eT: accT > 0 ? eKWh / accT : 0,
      capTph, wearPerHeadT: wearPer, ln2PerHeadT: ln2, extraCostPerHeadT: ln2 * prices.ln2,
      F80: percentile(accAgg), P80: percentile(outAgg), rAvg
    });
    info.ratio = info.P80 > 0 && info.F80 > 0 ? info.F80 / info.P80 : 1;

    // diagnostics
    if (info.inKg > 0 && info.rejKg / info.inKg > 0.02) {
      const pct = Math.round(100 * info.rejKg / info.inKg);
      if (M.liquidOnly) warn(info, 'warn', pct + '% of the feed is solid. A spray nozzle only takes liquid, so the solids are rejected.');
      else warn(info, 'warn', pct + '% of the feed is too big for the ' + (M.maxFeed >= 1 ? M.maxFeed + ' mm' : Math.round(M.maxFeed * 1000) + ' µm') + ' feed opening and is scalped off. Put a smaller-size stage ahead of this one.');
    }
    for (const mat in info.perMat) {
      const pm = info.perMat[mat], D = MATERIALS[mat];
      if (pm.accMass / Math.max(info.inKg, 1e-9) < 0.04) continue;
      if (pm.liquid && !M.liquidOnly && !(M.mix.hyd > 0)) { warn(info, 'info', 'Water is an incompressible liquid. It squirts straight through without breaking up.'); continue; }
      if (pm.liquid && M.excludeLiquid) { warn(info, 'info', 'Pure liquid has no second phase to disperse here. It passes through.'); continue; }
      if (pm.resp < 0.3 && pm.accMass > 0) {
        const how = M.screened ? 'It works but burns a lot of energy and slows the machine.' : 'It barely reduces here.';
        if (M.ln2 && D.id !== 'water') warn(info, 'bad', D.name + ' does not embrittle in liquid nitrogen, so the nitrogen is wasted. ' + how);
        else warn(info, 'warn', D.name + ' resists this mechanism (efficiency ' + Math.round(pm.resp * 100) + '%). ' + how);
      }
      if (M.knife && D.hard >= 0.5 && pm.accMass / info.inKg > 0.01) warn(info, 'bad', 'Hard tramp material (' + D.name + ') is chewing the knives.');
    }
    if (M.ln2) warn(info, 'info', 'Liquid nitrogen use: ' + (info.accKg > 0 ? (ln2 / info.accKg).toFixed(2) : '0') + ' kg per kg of feed.');
    if (omniOuts) { omniOuts.rejects = rej; return { outs: omniOuts, info }; }
    return { outs: { product: out, rejects: rej }, info };
  }

  /* ======================= separators ======================= */
  const G_ACC = 9.81, RHO_AIR = 1.2;
  function sizeEffEddy(x) {
    const lo = 1 / (1 + Math.exp(-(Math.log(x) - Math.log(5)) / 0.45));
    return lo * (x > 150 ? 0.7 : 1);
  }
  /* probability a particle of material D and size x (mm) is sent to the extract port */
  function pExtract(M, s, D, x) {
    switch (M.id) {
      case 'magnet': {
        const sF = Math.min(1.4, Math.max(0.4, s.field / 250));
        if (D.magnetic) {
          const szF = x < 0.3 ? 0.55 : (x < 2 ? 0.92 : 1);
          return Math.min(0.995, 0.985 * Math.pow(sF, 0.25) * szF);
        }
        const e = 0.012 * (x < 10 ? 1.8 : 1) * Math.pow(sF, 0.8) * (D.density < 1.5 ? 1.6 : 1);
        return Math.min(0.15, e);
      }
      case 'eddy': {
        if (D.magnetic) return 0.0;
        if (!(D.sigma > 0)) return 0.02;
        const score = (D.sigma / D.density) / (37.7 / 2.7);
        const spF = Math.min(1.3, Math.max(0.5, s.rpm / 3000));
        return 0.02 + 0.95 * (1 - Math.exp(-2.2 * score * Math.pow(spF, 1.5))) * sizeEffEddy(x);
      }
      case 'air': {
        // thin pieces (film, foam, chips) fall like plates: vt depends on thickness, not size
        let vt;
        if (D.thick) vt = Math.sqrt(2 * D.density * 1000 * G_ACC * Math.min(D.thick, x) / 1000 / (1.2 * RHO_AIR));
        else vt = Math.sqrt(4 * G_ACC * (x / 1000) * (D.density * 1000) / (3 * RHO_AIR));
        const va = s.air;
        return 1 / (1 + Math.exp((vt - va) / (0.12 * va + 0.3)));
      }
      case 'screen': {
        const a = s.aperture;
        let p = 1 / (1 + Math.exp(Math.log(x / a) / 0.18));
        return Math.min(0.98, Math.max(0.02, p));
      }
      case 'sinkfloat': {
        if (D.state === 'liquid') return 1;   // #288: free liquid joins the medium and leaves with the overflow, never in the sinks
        // #288: clear water cuts sharply (plastic at 0.95 floats 84% at 1.0, was 65%); a heavy-media slurry (2+ g/cc) keeps its wider spread
        return 1 / (1 + Math.exp((D.density - s.sg) / Math.min(0.05 * s.sg + 0.03, Math.max(0.03, 0.11 * s.sg - 0.09))));
      }
      case 'sensor': {
        // XRT / LIBS belt sorters classify every piece and eject the targets with air jets. Real units run at
        // 90-98% on 10-150 mm pieces; below ~5 mm the sensor cannot resolve a piece and a jet cannot hit it,
        // above ~200 mm pieces shadow each other and some are missed. Mis-fires carry 2-3% of the rest along.
        if (D.state === 'liquid') return 0;                    // a puddle on the belt is never ejected
        if (D.id !== s.target) return 0.025;                   // false positives on every other material
        const szF = 1 / (1 + Math.exp(-(Math.log(x) - Math.log(3.7)) / 0.29));   // sigmoid on log size: 0.33 at 3 mm, 0.97 at 10 mm
        const big = x > 200 ? 0.76 : (x > 150 ? 1 - 0.24 * (x - 150) / 50 : 1);  // 92% on 10-150 mm, 70% above 200 mm
        return 0.92 * szF * big;
      }
    }
    return 0;
  }

  function procSeparator(node, M, stream) {
    const s = node.settings;
    const ext = newStream(stream.temp), res = newStream(stream.temp);
    const info = { kind: 'separator', perMat: {}, warnings: [], inKg: 0 };
    const inAgg = new Float64Array(NB), exAgg = new Float64Array(NB), rsAgg = new Float64Array(NB);
    for (const mat in stream.m) {
      const D = MATERIALS[mat], arr = stream.m[mat], mass = sum(arr);
      if (mass <= 1e-9) continue;
      info.inKg += mass;
      const e = new Float64Array(NB), r = new Float64Array(NB);
      for (let i = 0; i < NB; i++) {
        if (arr[i] <= 0) continue;
        const p = pExtract(M, s, D, MID[i]);
        e[i] = arr[i] * p; r[i] = arr[i] - e[i];
        inAgg[i] += arr[i]; exAgg[i] += e[i]; rsAgg[i] += r[i];
      }
      addArr(ext, mat, e); addArr(res, mat, r);
      info.perMat[mat] = { mass, extract: sum(e), extractFrac: sum(e) / mass, psd: arr };
    }
    const T = info.inKg / 1000;
    Object.assign(info, {
      flowAcc: T, flowRej: 0, flowIn: T, ePerHead: M.eSpec * T, eT: M.eSpec,
      capTph: M.cap * (1 + FX.cap * levelOf(node)), wearPerHeadT: 0, ln2PerHeadT: 0, extraCostPerHeadT: (M.mediaCost || 0) * T,
      F80: percentile(inAgg), P80: percentile(inAgg), ratio: 1, rAvg: 1
    });
    // diagnostics
    if (M.id === 'eddy') {
      let fe = 0; for (const mat in info.perMat) if (MATERIALS[mat].magnetic) fe += info.perMat[mat].mass;
      if (fe / Math.max(info.inKg, 1) > 0.03) warn(info, fe / Math.max(info.inKg, 1) > 0.08 ? 'bad' : 'warn', 'Ferrous metal is reaching the eddy-current rotor. In a real plant it sticks to the belt and wrecks it. Put a magnet ahead.');
      const fine = (function () { let f = 0; for (let i = 0; i < NB; i++) if (MID[i] < 4) f += inAgg[i]; return f / Math.max(sum(inAgg), 1); })();
      if (fine > 0.3) warn(info, 'warn', 'Over ' + Math.round(fine * 100) + '% of the feed is under 4 mm. Eddy currents barely move particles that small.');
    }
    if (M.id === 'magnet') {
      let nm = 0; for (const mat in info.perMat) if (!MATERIALS[mat].magnetic) nm += info.perMat[mat].extract;
      const ex = sum(exAgg);
      if (ex > 0 && nm / ex > 0.1) warn(info, 'warn', Math.round(100 * nm / ex) + '% of the magnetic fraction is non-ferrous pieces dragged along.');
    }
    if (M.id === 'sensor') {
      const T = MATERIALS[s.target], tm = info.perMat[s.target] ? info.perMat[s.target].mass : 0;
      if (T && tm / Math.max(info.inKg, 1) < 0.005) warn(info, 'warn', 'Almost no ' + T.name + ' in the feed: the sorter is scanning for something that is not there.');
      const fine = (function () { let f = 0; for (let i = 0; i < NB; i++) if (MID[i] < 10) f += inAgg[i]; return f / Math.max(sum(inAgg), 1); })();
      if (fine > 0.3) warn(info, 'warn', 'Over ' + Math.round(fine * 100) + '% of the feed is under 10 mm. The sensor cannot resolve pieces that small and the air jets miss them. Screen the fines off first.');
    }
    return { outs: { extract: ext, residue: res }, info };
  }

  /* ======================= freezer ======================= */
  function procFreezer(node, M, stream) {
    const out = newStream(1);
    const info = { kind: 'conditioner', perMat: {}, warnings: [], inKg: 0 };
    let kWh = 0;
    for (const mat in stream.m) {
      const D = MATERIALS[mat], arr = stream.m[mat], mass = sum(arr);
      if (mass <= 1e-9) continue;
      info.inKg += mass;
      if (D.state === 'liquid' && D.feed.blockP80) addArr(out, mat, makePSD(D.feed.blockP80, 2, D.feed.blockP80 * 2.2), mass);
      else addArr(out, mat, arr);
      const e = mass * D.chillKJ / 3600 / M.cop;
      kWh += e;
      info.perMat[mat] = { mass, E: e / (mass / 1000), psd: arr };
    }
    const T = info.inKg / 1000;
    Object.assign(info, {
      flowAcc: T, flowRej: 0, flowIn: T, ePerHead: kWh, eT: T > 0 ? kWh / T : 0,
      capTph: M.cap * (1 + FX.cap * levelOf(node)), wearPerHeadT: 0, ln2PerHeadT: 0, extraCostPerHeadT: 0,
      F80: percentile(aggregate(stream)), P80: percentile(aggregate(out)), ratio: 1, rAvg: 1
    });
    return { outs: { product: out }, info };
  }

  /* ======================= furnaces ======================= */
  /* A furnace melts the metals it is built for (M.melts) whose melting point lies below the tap temperature. They leave
   * through the 'product' port as one alloy bath cast into ingots (stream.form = 'ingot'); the ingot grade is the purity of
   * that bath. Non-metals, metals the furnace cannot take, metals the tap is too cold for, oversize charge and the metal
   * oxidised off the bath surface leave through 'dross' (stream.form = 'dross'), keeping their mass.
   * Energy per tonne = (melt enthalpy + liquid superheat) / thermal efficiency, from the SMELT data in data.js. */
  const INGOT_BIN = 21;                                     // 178-316 mm: the length of a standard 7-10 kg sow or ingot
  const INGOT_PSD = new Float64Array(NB); INGOT_PSD[INGOT_BIN] = 1;
  function procFurnace(node, M, stream) {
    const s = node.settings, wear = node.wear || 0, lvl = levelOf(node), tap = s.tap;
    const eta = Math.min(0.97, M.eta * (1 + FX.eta * lvl)) * (1 - 0.3 * wear);   // a worn lining leaks heat
    const life = M.life * (1 + FX.life * lvl);
    const melt = newStream(0), dross = newStream(0);
    melt.form = 'ingot'; dross.form = 'dross';
    const info = { kind: 'furnace', perMat: {}, warnings: [], inKg: 0, rejKg: 0, chargeKg: 0, meltKg: 0, drossKg: 0, tap };
    const groups = {};
    let eKWh = 0, oxKg = 0, meltableKg = 0, domMat = null, domMelt = 0;
    for (const mat in stream.m) {
      const D = MATERIALS[mat], arr = stream.m[mat], mass = sum(arr);
      if (mass <= 1e-9) continue;
      info.inKg += mass;
      // scalp what will not go through the charge door
      const acc = new Float64Array(NB), big = new Float64Array(NB);
      for (let i = 0; i < NB; i++) { if (MID[i] <= M.maxFeed) acc[i] = arr[i]; else big[i] = arr[i]; }
      const accMass = sum(acc), bigMass = mass - accMass;
      if (bigMass > 1e-9) addArr(dross, mat, big);
      info.rejKg += bigMass; info.chargeKg += accMass;
      const metal = D.melt != null, canMelt = M.melts.indexOf(mat) >= 0;
      const fate = !metal ? 'nonmetal' : (!canMelt ? 'wrong' : (tap < D.melt + 10 ? 'cold' : 'melt'));
      const pm = { mass, accMass, fate, melt: 0, dross: bigMass, meltFrac: 0, E: 0, psd: arr };
      info.perMat[mat] = pm;
      if (accMass <= 1e-9) { info.drossKg += pm.dross; continue; }
      let E = 0;
      if (fate === 'melt') {
        meltableKg += accMass;
        const dT = tap - D.melt;
        E = (D.meltKWh + D.cpL * dT / 3.6) / eta;             // superheat: cp (kJ/kg K) x K / 3.6 = kWh/t
        const tempF = 0.6 + dT / 150;                          // oxidation rate: 1.0 at 60 C superheat, about 2x at 200 C
        const ox = new Float64Array(NB), liq = new Float64Array(NB);
        for (let i = 0; i < NB; i++) {
          const x = MID[i], sizeF = x < 1 ? 4 : (x < 5 ? 2.2 : (x < 20 ? 1.3 : 1));   // surface per kg: swarf and fines lose 10-25%, chunky scrap 2-5%
          const fr = Math.min(0.6, D.drossK * M.drossF * tempF * sizeF);
          ox[i] = acc[i] * fr; liq[i] = acc[i] - ox[i];
        }
        const liqMass = sum(liq), oxMass = sum(ox);
        addArr(melt, mat, INGOT_PSD, liqMass); if (oxMass > 1e-9) addArr(dross, mat, ox);
        pm.melt = liqMass; pm.dross += oxMass; pm.meltFrac = liqMass / mass; oxKg += oxMass; info.meltKg += liqMass;
        const g = GROUP[mat] || mat; groups[g] = (groups[g] || 0) + liqMass;
        if (liqMass > domMelt) { domMelt = liqMass; domMat = mat; }
      } else {
        addArr(dross, mat, acc); pm.dross += accMass;
        // a lump that never melts still soaks sensible heat up to the bath temperature; non-metal charge heats like slag
        E = (metal ? D.meltKWh * 0.5 * Math.min(1, (tap - 25) / (D.melt - 25)) : M.slagKWh) / eta;
      }
      pm.E = E; eKWh += E * accMass / 1000;
      info.drossKg += pm.dross;
    }
    let dom = 0, domG = null; for (const g in groups) if (groups[g] > dom) { dom = groups[g]; domG = g; }
    info.purity = info.meltKg > 0 ? dom / info.meltKg : 0; info.domGroup = domG; info.domMat = domMat;
    info.drossFrac = info.inKg > 0 ? info.drossKg / info.inKg : 0;
    info.meltLoss = meltableKg > 0 ? oxKg / meltableKg : 0;   // share of the meltable metal burnt to oxide
    const chargeT = info.chargeKg / 1000;
    Object.assign(info, {
      flowAcc: chargeT, flowRej: info.rejKg / 1000, flowIn: info.inKg / 1000, ePerHead: eKWh, eT: chargeT > 0 ? eKWh / chargeT : 0,
      capTph: M.cap * (1 + FX.cap * lvl), wearPerHeadT: chargeT / life * 0.12,   // refractory erodes per tonne melted, same scale as liner wear
      ln2PerHeadT: 0, extraCostPerHeadT: (M.consumable || 0) * chargeT,
      F80: percentile(aggregate(stream)), P80: info.meltKg > 0 ? MID[INGOT_BIN] : percentile(aggregate(dross)), ratio: 1, rAvg: 1
    });
    // diagnostics
    const share = (kg) => kg / Math.max(info.inKg, 1e-9);
    for (const mat in info.perMat) {
      const pm = info.perMat[mat], D = MATERIALS[mat]; if (share(pm.accMass) < 0.03) continue;
      if (pm.fate === 'wrong') warn(info, 'bad', D.name + ' cannot be melted in this furnace: ' + Math.round(100 * share(pm.accMass)) + '% of the charge goes to the dross bin unmelted. ' + (D.magnetic ? 'Pull it with a magnet first.' : 'Sort it out first.'));
      else if (pm.fate === 'cold') warn(info, 'bad', D.name + ' melts at ' + D.melt + ' \u00b0C but the tap is ' + tap + ' \u00b0C: it sits in the bath as unmelted lumps and goes to dross. Raise the tap temperature.');
      else if (pm.fate === 'nonmetal') warn(info, 'warn', Math.round(100 * share(pm.accMass)) + '% of the charge is ' + D.name.toLowerCase() + '. It burns off or ends up in the dross, and the furnace still has to heat it.');
    }
    if (info.rejKg > 0.02 * info.inKg) warn(info, 'warn', Math.round(100 * info.rejKg / info.inKg) + '% of the feed is too big for the ' + M.maxFeed + ' mm charge door and is rejected to dross. Shred it first.');
    if (info.meltKg > 0 && info.purity < 0.9) {
      const nm = MATERIALS[domG] ? MATERIALS[domG].name.toLowerCase() : domG;
      warn(info, info.purity < 0.8 ? 'bad' : 'warn', 'The melt is only ' + Math.round(info.purity * 100) + '% ' + nm + '. Everything that melts alloys together, so a mixed ingot sells for a fraction of a clean one. Sort before you smelt.');
    }
    if (info.meltLoss > 0.08) warn(info, 'warn', Math.round(info.meltLoss * 100) + '% of the metal burns to dross: fines oxidise fast and a hot bath makes it worse.');
    if (domMat) { const D = MATERIALS[domMat]; warn(info, 'info', 'Tap ' + tap + ' \u00b0C is ' + (tap - D.melt) + ' \u00b0C above the ' + D.name.toLowerCase() + ' melting point (' + D.melt + ' \u00b0C). Each extra 100 \u00b0C costs about ' + Math.round(D.cpL * 100 / 3.6 / eta) + ' kWh/t and oxidises more metal.'); }
    return { outs: { product: melt, dross }, info };
  }

  function procNode(node, stream) {
    const M = MACHINES[node.m];
    if (M.kind === 'separator') return procSeparator(node, M, stream);
    if (M.kind === 'furnace') return procFurnace(node, M, stream);
    if (M.kind === 'conditioner') return procFreezer(node, M, stream);
    return procComminution(node, M, stream);
  }

  /* ======================= flowsheet evaluation ======================= */
  /* line: [{uid, m, settings, wear, src: 'feed' | {uid, port}}]. comp: {mat: fraction}. */
  /* opts (optional): sizes { mat: p80 } for already-broken feed (#41); entry: uid of the station the feed enters at
   * (#42). With an entry, that station takes the whole head feed and the head-fed stations ahead of it get nothing. */
  function evalLine(line, comp, opts) {
    const sizes = opts && opts.sizes, entry = opts && opts.entry != null && line.some(function (n) { return n.uid === opts.entry; }) ? opts.entry : null;
    const head = makeFeed(comp, 1000, sizes);
    const ports = {}, consumed = {}, nodes = [], index = {}, users = {};
    line.forEach(function (n) { if (n.uid !== entry && n.src && n.src !== 'feed') { const key = n.src.uid + ':' + n.src.port; users[key] = (users[key] || 0) + 1; } });
    let headUsers = 0; line.forEach(function (n) { if (entry == null && (!n.src || n.src === 'feed')) headUsers++; });
    for (let k = 0; k < line.length; k++) {
      const node = line[k]; index[node.uid] = k;
      let inS = head, share = headUsers;
      if (entry != null && node.uid === entry) { share = 1; }
      else if (entry != null && (!node.src || node.src === 'feed')) { inS = newStream(0); share = 1; }
      else if (node.src && node.src !== 'feed') {
        const key = node.src.uid + ':' + node.src.port;
        inS = ports[key] || newStream(0); consumed[key] = true; share = users[key];
      }
      if (share > 1) inS = scaleStream(inS, 1 / share);
      const res = procNode(node, inS);
      res.info.uid = node.uid; res.info.index = k; res.info.M = MACHINES[node.m];
      res.info.inStream = inS;
      nodes.push(res.info);
      for (const port in res.outs) ports[node.uid + ':' + port] = res.outs[port];
    }
    const terminals = [];
    for (const key in ports) if (!consumed[key]) {
      const p = key.split(':');
      terminals.push({ key, uid: Number(p[0]), port: p[1], stream: ports[key], form: ports[key].form || null });
    }
    return { head, nodes, ports, terminals };
  }

  /* head-feed rate limit in t/h from capacity and power of every node */
  function maxRate(nodes, line) {
    let R = Infinity, limiter = null;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k], M = n.M, node = line[k];
      if (!(n.flowAcc > 1e-9)) continue;
      if ((node.wear || 0) >= 0.999) return { R: 0, limiter: { uid: n.uid, why: 'worn out' } };
      const rCap = n.capTph / n.flowAcc;
      const rPow = n.ePerHead > 1e-9 ? (M.prated * (1 + FX.power * levelOf(node)) - M.pidle) / n.ePerHead : Infinity;
      if (rCap < R) { R = rCap; limiter = { uid: n.uid, why: 'capacity' }; }
      if (rPow < R) { R = rPow; limiter = { uid: n.uid, why: 'power' }; }
    }
    if (!isFinite(R)) R = 0;
    return { R, limiter };
  }

  /* ======================= product value ======================= */
  const GROUP = { steel: 'ferrous', castiron: 'ferrous', granite: 'aggregate', limestone: 'aggregate' };
  // A cast ingot sells on the purity of the melt: secondary alloy specs tolerate a few percent of tramp metal, and below
  // about 80% it is "alloy soup" a refiner must re-melt, worth little more than the scrap in it (floor 12% of ingot price).
  function ingotGrade(share) { return Math.max(0.12, Math.pow(Math.min(1, Math.max(0, (share - 0.8) / 0.19)), 1.5)); }
  const DROSS_VALUE = 0.15;   // dross processors pay roughly 10-20% of metal value for the metal locked in it
  /* Everything must be sorted to be sold (#52). A bucket sells only when one material (or one trade group: ferrous,
   * aggregate) makes up at least PURE_MIN of it; anything more mixed is MISC, worth nothing until it is re-run and
   * sorted. A sorted bucket is paid as what it is sold as: stray material in it is paid no more than the main material
   * (a bit of copper in a steel bale is just more steel), and the price rises with purity, because refiners and mills pay
   * a premium for clean feed: about 85% of list at 90% pure, list at 95%, and up to 125% for 99%+ ("No. 1" grades). */
  const PURE_MIN = 0.9;
  function pureGrade(share) {
    if (share < PURE_MIN) return 0;
    if (share < 0.95) return 0.85 + 3 * (share - PURE_MIN);   // 0.85 at 90%, 1.0 at 95%
    return Math.min(1.25, 1 + 6.25 * (share - 0.95));        // 1.25 at 99%
  }
  /* Is a bin worth showing and counting? Dust is not; but a few grams of gold per tonne are (#53), so a bin counts when it
   * weighs over half a kilo per head-tonne, is worth over 50 cents, or carries any precious metal. */
  const PRECIOUS = ['gold', 'silver'];
  function binMatters(st) {
    if (!st) return false;
    if (st.total > 0.5 || st.value > 0.5) return true;
    return PRECIOUS.some(function (m) { return st.perMat && st.perMat[m] && st.perMat[m].mass > 1e-6; });
  }
  /* mats: {materialId: psd}. form (optional): 'ingot' or 'dross' from a furnace; anything else is priced as loose scrap. */
  function binStats(mats, form) {
    let total = 0, liquid = 0; const groups = {}, perMat = {}, wet = {};
    for (const mat in mats) {
      const m = sum(mats[mat]); if (m <= 0) continue;
      total += m; perMat[mat] = { mass: m, p80: percentile(mats[mat]) };
      if (MATERIALS[mat] && MATERIALS[mat].state === 'liquid') { liquid += m; wet[mat] = m; continue; }   // #288: free liquid drains off a bin: it is weighed but never sets its purity
      const g = GROUP[mat] || mat; groups[g] = (groups[g] || 0) + m;
    }
    const solid = total - liquid, G = solid > 0 ? groups : wet;   // a bin of nothing but liquid is still that liquid (a drum of water, worth nothing)
    let dom = 0, domG = null;
    for (const g in G) if (G[g] > dom) { dom = G[g]; domG = g; }
    const share = total > 0 ? dom / (solid > 0 ? solid : total) : 0;
    const ingot = form === 'ingot', dross = form === 'dross', loose = !ingot && !dross;
    // dross is a furnace by-product sold to dross processors as it is; everything else must be sorted to sell
    // #291: a cast ingot always sells, priced by ingotGrade (an off-spec melt is an alloy ingot, not loose MISC)
    const sellable = solid > 0 && (dross || ingot || share >= PURE_MIN);
    let grade = !sellable ? 0 : ingot ? ingotGrade(share) : dross ? 1 : pureGrade(share);
    // reference price of what the bucket is sold as
    let refSell = 0, refMass = 0;
    for (const mat in perMat) {
      const pm = perMat[mat], D = MATERIALS[mat];
      if ((GROUP[mat] || mat) === domG) { refSell += D.sell * pm.mass; refMass += pm.mass; }
    }
    if (refMass > 0) refSell /= refMass;
    let main = null, mm = 0;
    for (const mat in perMat) if ((GROUP[mat] || mat) === domG && perMat[mat].mass > mm) { mm = perMat[mat].mass; main = mat; }
    const klass = null;
    // precious metals are bought by assay: a refiner pays for the metal, never a premium over it (#54)
    if (loose && main && PRECIOUS.indexOf(main) >= 0 && grade > 1) grade = 1;
    let value = 0;
    for (const mat in perMat) {
      const D = MATERIALS[mat], p = perMat[mat].p80, lo = D.range[0], hi = D.range[1];
      let sf = 1;
      if (ingot) { /* an ingot is a fixed form: size does not matter */ }
      else if (p > hi) sf = Math.max(0.2, 1 - 0.6 * Math.log10(p / hi));
      else if (p < lo) sf = Math.max(0.2, 1 - 0.7 * Math.log10(lo / p));
      perMat[mat].sizeFactor = sf;
      let price = ingot ? (D.ingot || D.sell) : D.sell;
      if (loose && (GROUP[mat] || mat) !== domG) price = Math.min(price, refSell);
      perMat[mat].priceFactor = loose && D.sell > 0 ? price / D.sell : 1;     // price paid relative to the list price (inventory lots)
      const v = perMat[mat].mass / 1000 * price * prices.market * ((prices.perMat && prices.perMat[mat]) || 1) * sf * grade * (dross ? (D.melt != null ? DROSS_VALUE : 0) : 1);   // per-material factor: market swings (#33); #292: dross pays only for the metal in it
      perMat[mat].value = v; value += v;
    }
    return { total, share, domGroup: domG, main, sellable, grade, klass, value, perMat, p80: percentile(aggregateMap(mats)), form: form || null, liquid };
  }
  function aggregateMap(mats) {
    const a = new Float64Array(NB);
    for (const k in mats) { const v = mats[k]; for (let i = 0; i < NB; i++) a[i] += v[i]; }
    return a;
  }

  /* cumulative % passing curve at the bin upper edges, for charts */
  function cumCurve(arr) {
    const tot = sum(arr), c = new Float64Array(NB);
    if (tot <= 0) return c;
    let cum = 0;
    for (let i = 0; i < NB; i++) { cum += arr[i]; c[i] = cum / tot; }
    return c;
  }

  /* Build a runnable line from a preset definition. src strings 'k:port' use 1-based node numbers. */
  let UID = 0;
  function nextUid() { return ++UID; }
  function makeNode(machineId, settings, src) {
    return { uid: nextUid(), m: machineId, settings: Object.assign({}, MACHINES[machineId].defaults, settings || {}), wear: 0, level: 0, src: src || 'feed' };
  }
  /* machine id + untrusted settings object -> a complete, in-range settings object: numbers clamp to [min,max] (junk takes the
   * default), an enum keeps only a listed value. Shared by load() and Blueprints.sanitise (#232). */
  function cleanSettings(machineId, raw) {
    const s = {};
    (MACHINES[machineId].settings || []).forEach(function (st) {
      const r = raw && raw[st.id];
      if (st.enum) { s[st.id] = st.enum.indexOf(r) >= 0 ? r : st.def; return; }
      const v = r != null && r !== '' && isFinite(+r) ? +r : st.def;
      s[st.id] = Math.min(st.max, Math.max(st.min, v));
    });
    return s;
  }
  function buildLine(preset) {
    const nodes = preset.nodes.map(function (d) { return makeNode(d.m, d.s, 'feed'); });
    preset.nodes.forEach(function (d, i) {
      if (!d.src || d.src === 'feed') return;
      const p = d.src.split(':'); nodes[i].src = { uid: nodes[Number(p[0]) - 1].uid, port: p[1] };
    });
    return nodes;
  }

  /* #199: panels that rebuild their DOM on the sim clock must not do it under a pressed pointer (the click would be lost) or while hidden.
     busy() says to hold the redraw; onIdle runs once the pointer is released (after the click has been delivered). */
  function panelGate(panel, doc, onIdle) {
    let down = false;
    const up = () => { if (!down) return; down = false; setTimeout(onIdle, 0); };
    panel.addEventListener('pointerdown', () => { down = true; });
    doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
    return { busy: () => down || panel.getClientRects().length === 0 };
  }

  G.CS.Sim = {
    makeNode, buildLine, cleanSettings, nextUid,
    NB, LOW, EDGE, MID, makePSD, percentile, sum, newStream, addArr, streamMass, aggregate, aggregateMap, makeFeed,
    profileFor, mixResp, procNode, procFurnace, evalLine, maxRate, binStats, binMatters, PRECIOUS, ingotGrade, pureGrade, PURE_MIN, cumCurve, pExtract,
    prices, levelOf, panelGate
  };
})(typeof window !== 'undefined' ? window : globalThis);
