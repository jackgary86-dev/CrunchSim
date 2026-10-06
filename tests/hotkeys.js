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
const real = { querySelector: (sel) => (/#endgame:not(.hidden)/.test(sel) ? {} : null) };
check(!hotkeyOk(key(target('BODY')), real), 'the open end-game card swallows the hotkeys');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' hotkey checks pass');
process.exit(fails ? 1 : 0);
