// Global hotkeys leave focused buttons, modified keys and open modals alone (#197). Run: node tests/hotkeys.js
require('../js/data.js');
const { hotkeyOk } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
// Minimal DOM stand-ins: closest() answers for the selectors hotkeyOk asks, querySelector() for an open modal.
function target(tag, id, inside) { return { tagName: tag, id: id || '', closest: (sel) => (sel === '#btn-run' ? (id === 'btn-run' ? {} : null) : (inside || /^(BUTTON|A)$/.test(tag) ? {} : null)) }; }
const key = (t, mods) => Object.assign({ target: t, ctrlKey: false, metaKey: false, altKey: false }, mods);
const none = { querySelector: () => null }, modal = { querySelector: () => ({}) };
check(hotkeyOk(key(target('BODY')), none), 'a plain key on the page acts');
check(!hotkeyOk(key(target('INPUT')), none) && !hotkeyOk(key(target('TEXTAREA')), none) && !hotkeyOk(key(target('SELECT')), none), 'typing in a field keeps the key');
check(!hotkeyOk(key(target('BUTTON', 'btn-buy')), none), 'a focused BUY/SELL/LOAD/CLOSE button keeps Space to activate itself');
check(!hotkeyOk(key(target('SPAN', '', true)), none), 'a child of a button counts as the button');
check(!hotkeyOk(key(target('A')), none), 'a focused link keeps the key');
check(hotkeyOk(key(target('BUTTON', 'btn-run')), none), '#btn-run is the exception: Space still runs the batch');
check(!hotkeyOk(key(target('BODY'), { ctrlKey: true }), none) && !hotkeyOk(key(target('BODY'), { metaKey: true }), none) && !hotkeyOk(key(target('BODY'), { altKey: true }), none), 'Ctrl, Meta or Alt held leaves the key to the browser');
check(!hotkeyOk(key(target('BODY')), modal), 'an open modal, drawer, Settings or round overlay swallows the hotkeys');
// the end-game card is a modal layer too (#236): the real selector must name it, and a closed one must not block
const real = { querySelector: (sel) => (sel.includes('#endgame:not(.hidden)') ? {} : null) };
check(!hotkeyOk(key(target('BODY')), real), 'the open end-game card swallows the hotkeys');
// the Plant drawer is non-modal at desktop width (no aria-modal): it must not swallow the hotkeys, but a modal one (narrow) does (#257)
// tiny matcher for the compound selectors in HOTKEY_MODAL: tag-less parts of .class / #id / [attr] / :not(...) over { id, classes, attrs } nodes
function matches(n, part) {
  const rest = part.replace(/:not\(([^)]*)\)/g, (m, inner) => { if (matches(n, inner)) throw 0; return ''; });
  return (rest.match(/[.#]?[\w-]+|\[[\w-]+\]/g) || []).every((tok) => tok[0] === '.' ? n.classes.includes(tok.slice(1)) : tok[0] === '#' ? n.id === tok.slice(1) : tok[0] === '[' ? tok.slice(1, -1) in n.attrs : false);
}
const hit = (n, part) => { try { return matches(n, part.trim()); } catch (e) { return false; } };
const withNodes = (nodes) => ({ querySelector: (sel) => nodes.find((n) => sel.split(',').some((p) => hit(n, p))) || null });
const drawer = (attrs, classes) => ({ id: 'drawer', classes: ['overlay'].concat(classes || []), attrs: attrs });
check(hotkeyOk(key(target('BODY')), withNodes([drawer({})])), 'an open non-modal drawer (desktop width) leaves the hotkeys alone');
check(!hotkeyOk(key(target('BODY')), withNodes([drawer({ 'aria-modal': 'true' })])), 'an open modal drawer (narrow width) swallows the hotkeys');
check(hotkeyOk(key(target('BODY')), withNodes([drawer({ 'aria-modal': 'true' }, ['hidden'])])), 'a closed drawer does not');
check(!hotkeyOk(key(target('BODY')), withNodes([drawer({}), { id: 'settings', classes: ['overlay'], attrs: {} }])), 'another open overlay still swallows them beside the drawer');
// #310: '?' behind an open station opened help under it; an open station is modal for the hotkeys
check(!hotkeyOk(key(target('BODY')), withNodes([{ id: 'station', classes: ['overlay'], attrs: {} }])), 'an open station swallows the hotkeys (#310)');
check(hotkeyOk(key(target('BODY')), withNodes([{ id: 'station', classes: ['overlay', 'hidden'], attrs: {} }])), 'a closed station does not');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' hotkey checks pass');
process.exit(fails ? 1 : 0);
