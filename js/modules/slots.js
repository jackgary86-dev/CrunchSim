/* CrunchSim module: sorter slots (#51). The plant can hold a limited number of sorters (separators): 5 to start, and slots
 * 6 to 10 are bought one at a time in Bank & upgrades, each dearer than the last. Grinders, furnaces and conditioners do
 * not use a slot. Adding a sorter beyond the slots owned is refused with the price of the next slot, and so is a preset,
 * blueprint or playbook with more sorters than slots. A saved line that already has more keeps running.
 * Slot prices: each one is a bay of the sorting hall (feed conveyor, chutes, a bunker and its share of the dust extraction
 * and controls), dearer as the hall grows: $25k, $75k, $200k, $500k, $1.2M.
 * The rules are pure and live on CS.Slots so tests/slots.js can run them in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.MACHINES) return;
  const MACHINES = CS.MACHINES;

  const START = 5, MAX = 10;
  const PRICES = [25000, 75000, 200000, 500000, 1200000];   // slot 6, 7, 8, 9, 10
  function isSorter(m) { return !!(MACHINES[m] && MACHINES[m].kind === 'separator'); }
  function sortersIn(nodes) { return (nodes || []).filter((n) => isSorter(n.m)).length; }
  function nextPrice(owned) { return owned >= MAX ? null : PRICES[owned - START]; }
  /* '' when m fits, else why not. pending: sorters about to be added in the same purchase (a pair) */
  function addVeto(line, m, owned, pending) {
    if (!isSorter(m)) return '';
    const used = sortersIn(line) + (pending || 0);
    if (used < owned) return '';
    const p = nextPrice(owned);
    return 'All ' + owned + ' sorter slots are in use. ' + (p ? 'Buy slot ' + (owned + 1) + ' for $' + p.toLocaleString('en-US') + ' in Bank & upgrades, or remove a sorter.' : 'Ten is the most the sorting hall takes: remove a sorter first.');
  }
  function lineVeto(nodes, owned, name) {
    const n = sortersIn(nodes); if (n <= owned) return '';
    return (name || 'That line') + ' has ' + n + ' sorters and you own ' + owned + ' sorter slots. ' + (n > MAX ? 'It is bigger than any sorting hall.' : 'Buy ' + (n - owned) + ' more slot' + (n - owned === 1 ? '' : 's') + ' in Bank & upgrades first.');
  }
  function assetValue(owned) { let v = 0; for (let k = START; k < owned && k < MAX; k++) v += PRICES[k - START]; return v; }
  CS.Slots = { START, MAX, PRICES, isSorter, sortersIn, nextPrice, addVeto, lineVeto, assetValue };

  /* ======================= page integration ======================= */
  function start() {
    const API = CS.app; if (!API || API.slotsStarted) return; API.slotsStarted = true;
    let owned = START, panel = null;
    function buy() {
      const p = nextPrice(owned); if (!p) return;
      if (!API.spend(p, 'Sorter slot ' + (owned + 1))) { render(); return; }
      owned++;
      if (CS.Audio) CS.Audio.ui('ok');
      API.log('Sorter slot ' + owned + ' built for $' + p.toLocaleString('en-US') + ': the plant can now hold ' + owned + ' sorters.', 'ok');
      API.save(); API.markDirty(true);
    }
    function render() {
      if (!panel || !API.S) return;
      const body = panel.querySelector('.sl-body'); body.innerHTML = '';
      const used = sortersIn(API.S.line), p = nextPrice(owned);
      let pips = ''; for (let k = 1; k <= MAX; k++) pips += '<i class="' + (k <= used ? 'used' : k <= owned ? 'free' : 'locked') + '"></i>';
      const row = API.el('div', 'urow', '<span class="ic">&#9636;</span><span><div class="nm">Sorter slots <b>' + used + ' / ' + owned + '</b> <span class="small">in use / owned, ' + MAX + ' at most</span></div><div class="slot-pips">' + pips + '</div><div class="cur">' + (p ? 'Slot ' + (owned + 1) + ' adds room for one more sorter.' : 'The sorting hall is full size.') + '</div></span>');
      const b = document.createElement('button'); b.type = 'button';
      if (!p) { b.textContent = 'MAX'; b.className = 'buy max'; b.disabled = true; }
      else { b.textContent = API.fmtMoney(p); b.className = 'buy' + (API.S.money < p ? ' poor' : ''); b.title = 'Buy sorter slot ' + (owned + 1); b.addEventListener('click', buy); }
      row.appendChild(b); body.appendChild(row);
    }
    API.on('load', (ext) => { const d = ext && ext.slots; owned = d && d.owned >= START ? Math.min(MAX, Math.floor(d.owned)) : START; });
    if (API.S && API.S.ext && API.S.ext.slots) owned = Math.min(MAX, Math.max(START, Math.floor(API.S.ext.slots.owned) || START));
    API.on('save', () => ({ slots: { owned } }));
    API.on('assetValue', (q) => { if (q) q.value += assetValue(owned); });
    API.on('newgame', () => { owned = START; render(); });
    API.on('veto:addMachine', (p) => (p ? addVeto(API.S.line, p.m, owned, p.pending) : ''));
    API.on('veto:applyLine', (p) => (p ? lineVeto(p.nodes, owned, p.name) : ''));
    API.on('boot', () => {
      panel = API.addPanel('left', 'slots-panel', 'Sorting hall', 'bank-panel');
      panel.appendChild(API.el('div', 'sl-body'));
      render();
    });
    API.on('render', render);
    CS.Slots.live = { owned: () => owned, used: () => sortersIn(API.S.line), next: () => nextPrice(owned), buy };
  }
  if (CS.app) start();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
