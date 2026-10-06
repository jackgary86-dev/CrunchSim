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

  /* Money for the header slots and logs: whole dollars with thousands separators under a million, then M, B and T with two
   * decimals. Non-finite input prints '--'. A value that rounds to zero prints $0, never -$0. */
  const MONEY_UNITS = [['M', 1e6], ['B', 1e9], ['T', 1e12]];
  function fmtMoney(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '--';
    const a = Math.abs(x), r = Math.round(a);
    let s;
    if (r < 1e6) s = r.toLocaleString('en-US');
    else {
      let i = 0;
      while (i < MONEY_UNITS.length - 1 && a >= MONEY_UNITS[i + 1][1]) i++;
      if (i < MONEY_UNITS.length - 1 && (a / MONEY_UNITS[i][1]).toFixed(2) === '1000.00') i++;   // 999.999M reads $1.00B, not $1000.00M
      s = (a / MONEY_UNITS[i][1]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + MONEY_UNITS[i][0];
    }
    return (x < 0 && r > 0 ? '-$' : '$') + s;
  }

  CS.Score = { plantKwhT: plantKwhT, signature: signature, fmtMm: fmtMm, fmtMoney: fmtMoney };
})(typeof window !== 'undefined' ? window : globalThis);
