/* CrunchSim plant measures shared by the modules: energy per tonne at a head rate, a line's signature and a size in mm.
 * No DOM here, so the Node tests can use it. (The client-contract engine that lived here was retired in #78.)
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  const FX = CS.LEVEL_FX || { power: 0.1 };

  function plantKwhT(ev, R, line) {
    if (!(R > 0)) return Infinity;
    let P = 0;
    ev.nodes.forEach(function (n, i) {
      const lvl = line && line[i] ? (line[i].level || 0) : 0;
      P += Math.min(n.M.prated * (1 + FX.power * lvl), n.M.pidle + R * n.ePerHead);
    });
    return P / R;
  }

  function fmtMm(mm) { if (!(mm > 0)) return '--'; return mm >= 1 ? (mm >= 100 ? mm.toFixed(0) : mm.toFixed(1)) + ' mm' : Math.round(mm * 1000) + ' µm'; }
  function signature(line) { return line.map(function (n) { return CS.MACHINES[n.m].short; }).join('>'); }

  CS.Score = { plantKwhT: plantKwhT, signature: signature, fmtMm: fmtMm };
})(typeof window !== 'undefined' ? window : globalThis);
