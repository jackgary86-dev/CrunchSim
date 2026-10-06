/* CrunchSim module: floor. The plant hall has a floor area, every machine has a footprint, and a line only fits
 * when its machines plus access space fit the hall. The hall grows through the 'room' entry of PLANT_UPGRADES,
 * which the bank panel lists like any other plant upgrade.
 *
 * The pure parts (footprints, floor use, fit checks, veto messages) live on CS.Floor and touch no DOM, so
 * tests/floor.js can run them in Node. Everything that needs the page runs only once CS.app exists.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MACHINES) return;
  const MACHINES = CS.MACHINES, PLANT_UPGRADES = CS.PLANT_UPGRADES;

  /* ---------------- pure functions ---------------- */
  // Access factor on the plan footprint: plant layout practice allows 25-35 percent of a machine's own area for
  // maintenance clearance, walkways and conveyor transfers, so 30 percent is added to every footprint.
  const ACCESS = 1.30;
  // A machine without a footprint entry (added by another module) is assumed to be a 4 x 3 m mid-size skid.
  const DEFAULT_FOOT = { w: 4, d: 3 };

  function footprint(m) {
    const M = MACHINES[m], f = M && M.foot ? M.foot : DEFAULT_FOOT;
    return { w: f.w, d: f.d, area: f.w * f.d };
  }
  /* floor a machine takes once access space is added, m2 */
  function machineArea(m) { return footprint(m).area * ACCESS; }
  /* floor used by a list of nodes, m2. Accepts S.line nodes and preset nodes alike: only .m is read. */
  function floorUsed(nodes) {
    let a = 0; (nodes || []).forEach(function (n) { if (n && MACHINES[n.m]) a += machineArea(n.m); });
    return a;
  }
  function hallLevels() { return PLANT_UPGRADES.room ? PLANT_UPGRADES.room.levels : [Infinity]; }
  function clampLevel(level) { const L = hallLevels(); return Math.max(0, Math.min(L.length - 1, Math.floor(+level || 0))); }
  /* hall floor area at a room upgrade level, m2 */
  function hallArea(level) { return hallLevels()[clampLevel(level)]; }
  /* hall plan dimensions as text, e.g. '12 x 8 m' */
  function hallDims(level) {
    const U = PLANT_UPGRADES.room, d = U && U.dims ? U.dims[clampLevel(level)] : null;
    return d ? d[0] + ' × ' + d[1] + ' m' : '';
  }
  /* { used, cap, free, frac, ok } for a line in a hall */
  function check(nodes, level) {
    const used = floorUsed(nodes), cap = hallArea(level);
    return { used: used, cap: cap, free: cap - used, frac: cap > 0 ? used / cap : 1, ok: used <= cap + 1e-9 };
  }
  function fmtArea(a) { return (a >= 100 ? Math.round(a) : Math.round(a * 10) / 10).toLocaleString('en-US'); }
  /* reason a machine cannot be added to the line, or '' when it fits */
  function addVeto(nodes, m, level) {
    const M = MACHINES[m]; if (!M) return '';
    const c = check(nodes, level), need = machineArea(m);
    if (need <= c.free + 1e-9) return '';
    const f = footprint(m);
    return 'No floor space for the ' + M.name + ': it needs ' + fmtArea(need) + ' m² (' + f.w + ' × ' + f.d + ' m plus access) and the plant hall has ' + fmtArea(Math.max(0, c.free)) + ' m² free of ' + fmtArea(c.cap) + '. Buy a bigger Plant hall in the Plant drawer, or remove a machine.';
  }
  /* reason a preset line cannot be laid out, or '' when it fits */
  function lineVeto(nodes, level, name) {
    const c = check(nodes, level); if (c.ok) return '';
    return 'The ' + (name || 'preset line') + ' needs ' + fmtArea(c.used) + ' m² of floor and the plant hall is ' + fmtArea(c.cap) + ' m² (' + hallDims(level) + '). Buy a bigger Plant hall in the Plant drawer first.';
  }
  /* smallest room level at which a line fits, or -1 if none */
  function levelFor(nodes) {
    const used = floorUsed(nodes), L = hallLevels();
    for (let i = 0; i < L.length; i++) if (used <= L[i] + 1e-9) return i;
    return -1;
  }

  CS.Floor = { ACCESS: ACCESS, DEFAULT_FOOT: DEFAULT_FOOT, footprint: footprint, machineArea: machineArea, floorUsed: floorUsed, hallArea: hallArea, hallDims: hallDims, check: check, addVeto: addVeto, lineVeto: lineVeto, levelFor: levelFor, fmtArea: fmtArea };

  /* ---------------- page integration (needs CS.app) ---------------- */
  function start() {
    const API = CS.app; if (!API || API.floorStarted) return; API.floorStarted = true;
    let readout = null;

    function room() { return API.S.plant.room || 0; }
    function initRoom() { const S = API.S; if (S && S.plant) S.plant.room = S.plant.room || 0; }   // the app only initialises its four known keys

    function renderReadout() {
      if (typeof document === 'undefined' || !API.S) return;
      const sec = document.querySelector('#line-panel'); if (!sec) return;
      if (!readout) {
        readout = API.el('div', 'small num'); readout.id = 'floor-used';
        readout.style.display = 'flex'; readout.style.alignItems = 'center'; readout.style.gap = '8px'; readout.style.margin = '-4px 0 8px';
        readout.innerHTML = '<span class="lbl">FLOOR USED</span><b id="floor-used-v"></b><span id="floor-used-bar" style="flex:1;height:3px;background:var(--line);border-radius:2px;overflow:hidden"><i style="display:block;height:100%;width:0;background:var(--green)"></i></span>';
        readout.title = 'Machine footprints plus 30% access space, against the plant hall floor area.';
        const h2 = sec.querySelector('h2');
        if (h2) h2.insertAdjacentElement('afterend', readout); else sec.prepend(readout);
      }
      const c = check(API.S.line, room());
      const cls = c.frac >= 1 - 1e-9 ? 'bad' : c.frac > 0.8 ? 'warn' : 'ok';
      const col = cls === 'bad' ? 'var(--red)' : cls === 'warn' ? 'var(--amber)' : 'var(--green)';
      const v = readout.querySelector('#floor-used-v');
      v.className = cls; v.textContent = fmtArea(c.used) + ' / ' + fmtArea(c.cap) + ' m²';
      v.title = 'Plant hall ' + hallDims(room()) + (c.ok ? ', ' + fmtArea(c.free) + ' m² free' : ': over by ' + fmtArea(-c.free) + ' m²');
      const bar = readout.querySelector('#floor-used-bar i');
      bar.style.width = Math.round(Math.min(1, c.frac) * 100) + '%'; bar.style.background = col;
    }

    /* hooks */
    API.on('load', initRoom);
    API.on('veto:addMachine', function (p) { return addVeto(API.S.line, p && p.m, room()); });
    API.on('veto:applyLine', function (p) { const L = p && CS.LINES[p.id]; return lineVeto(p && p.nodes, room(), L ? L.name : ''); });
    API.on('render', renderReadout);
    if (API.booted) { initRoom(); API.renderBank(); renderReadout(); }   // boot already ran: the bank panel was drawn before room existed
  }

  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);   // app.js assigns CS.app in boot(), which runs on this same event, registered earlier
})(typeof window !== 'undefined' ? window : globalThis);
