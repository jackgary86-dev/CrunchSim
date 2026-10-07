/* CrunchSim module: overlay semantics (#198).
 *
 * Every layer that covers the game (help, the station, the auction round, settings, the title screen) and the plant
 * drawer is a dialog: role=dialog with a name, focus moves into it when it opens and goes back to where it came from
 * when it closes, and Escape closes the topmost one (one handler, here, for all of them). A modal layer also makes
 * the page behind it, and any layer under it, inert so Tab cannot walk behind it. The drawer is not modal while it
 * sits beside the toolbar (#137), so it gets the dialog, the focus and Escape but no inert; at 900px and below it covers
 * the whole screen (#240), so it is modal there (modal: a media query, followed live when the window is resized).
 *
 * The modules keep opening and closing their layers the way they always did (toggling .hidden); a MutationObserver
 * here notices. The stack of open layers is pure (CS.Overlays.createStack) so tests/overlays.js can check it in Node.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS) return;

  /* the open layers, bottom to top. open() on a layer already there raises it. */
  function createStack() {
    const ids = [];
    const without = (id) => { const i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1); };
    return {
      open(id) { without(id); ids.push(id); },
      close(id) { without(id); },
      top() { return ids.length ? ids[ids.length - 1] : null; },
      list() { return ids.slice(); },
      /* which layers are inert now: every modal one but the topmost modal one that is open, and an open side panel under it (#310); none when no modal is open */
      inert(modal) {
        const open = ids.filter((id) => modal[id]);
        const top = open.length ? open[open.length - 1] : null;
        return top === null ? [] : Object.keys(modal).filter((id) => id !== top && (modal[id] || (ids.indexOf(id) >= 0 && ids.indexOf(id) < ids.indexOf(top))));
      },
      /* does the page behind the layers need to be inert: is any open layer modal */
      pageInert(modal) { return ids.some((id) => modal[id]); },
    };
  }

  const stack = createStack(), reg = {};   // id -> { el, o, opener, was }
  let seq = 0;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const isOpen = (el) => el.isConnected && !el.classList.contains('hidden');
  /* o.modal: false (never), a media query string (only while it matches), anything else (always) */
  function isModal(o, mm) {
    if (o.modal === false) return false;
    if (typeof o.modal === 'string') return !!(mm && mm(o.modal).matches);
    return true;
  }
  const mq = (q) => window.matchMedia(q);
  const modalMap = () => { const m = {}; Object.keys(reg).forEach((id) => { m[id] = isModal(reg[id].o, mq); }); return m; };
  function syncModal(id) {
    const r = reg[id]; if (isModal(r.o, mq)) r.el.setAttribute('aria-modal', 'true'); else r.el.removeAttribute('aria-modal');
    applyInert();
  }

  function applyInert() {
    const modal = modalMap(), under = stack.inert(modal), page = document.getElementById('app');
    if (page) page.inert = stack.pageInert(modal);
    Object.keys(reg).forEach((id) => { if (reg[id].el.isConnected) reg[id].el.inert = under.indexOf(id) >= 0; });
  }
  function focusIn(el) {
    // #347: the station view takes focus itself, not its CLOSE button, so Space runs and stops the batch there (Escape closes)
    if (el.id === 'station') { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; el.focus(); return; }
    const t = el.querySelector(FOCUSABLE);
    if (t) t.focus(); else { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; el.focus(); }
  }
  function sync(id) {
    const r = reg[id], now = isOpen(r.el); if (now === r.was) return;
    r.was = now;
    if (now) {
      const a = document.activeElement; r.opener = a && a !== document.body && !r.el.contains(a) ? a : null;
      stack.open(id); applyInert(); focusIn(r.el);
    } else {
      stack.close(id); applyInert();
      const a = document.activeElement, o = r.opener; r.opener = null;
      if (o && o.isConnected && (!a || a === document.body || r.el.contains(a))) o.focus();   // not if focus already went somewhere on purpose
    }
  }
  /* o: { label | labelledby, close: selector of the layer's own close button or a function (none: Escape leaves it), modal: false for a side panel } */
  function attach(el, o) {
    if (!el || el.dataset.ovId) return;
    o = o || {}; const id = 'ov' + (++seq); el.dataset.ovId = id;
    el.setAttribute('role', 'dialog');
    if (o.labelledby) el.setAttribute('aria-labelledby', o.labelledby); else if (o.label) el.setAttribute('aria-label', o.label);
    reg[id] = { el, o, opener: null, was: false };
    if (typeof o.modal === 'string' && window.matchMedia) window.matchMedia(o.modal).addEventListener('change', () => syncModal(id));   // resized across the breakpoint with the layer open
    if (o.modal !== false) syncModal(id);
    new MutationObserver(() => sync(id)).observe(el, { attributes: true, attributeFilter: ['class'] });
    sync(id);
  }
  function closeTop() {
    const id = stack.top(); if (!id) return false;
    const r = reg[id], c = r.o.close; if (!c) return false;
    if (typeof c === 'function') c(); else { const b = r.el.querySelector(c); if (b) b.click(); }
    return true;
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    // capture, so it runs before the page's own key handlers; an Escape that closes a layer is not also taken by them
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && closeTop()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    const help = () => attach(document.getElementById('help'), { label: 'How to play', close: '#btn-help-close' });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', help); else help();
  }
  CS.Overlays = { createStack, isModal, attach, closeTop, focusIn };
})(typeof window !== 'undefined' ? window : globalThis);
