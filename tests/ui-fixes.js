// UI fixes #310-#317. Run: node tests/ui-fixes.js
//  help above the station and drawer (#310), the yard advance shown while owed (#312), buttons disabled with the reason
//  when their action would be refused (#313), panels that keep a typed value and focus across a rebuild (#314), stale texts
//  (#316) and small fixes: title screen, aria-labels, NEW YARD disarm, LOT DONE over the phone drawer (#317).
const fs = require('fs'), path = require('path');
const { load } = require('./app-env.js');
const ROOT = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const css = read('css/style.css'), layout = read('js/modules/layout.js'), appSrc = read('js/app.js'), html = read('index.html');
const zOf = (sel) => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.#]/g, '\\$&') + ' \\{[^}]*z-index: (\\d+)')); return m ? +m[2] : -1; };

console.log('== #310 help sits above every layer it can open over ==');
check(zOf('.modal') > zOf('.overlay') && zOf('.modal') > zOf('body.lay #scorecard') && zOf('.modal') > 60, 'the help modal is above the station, the drawer (60 on a phone) and the LOT DONE card');
check(/closest\('[^']*#help'\)/.test(layout), 'a click inside the help does not close the drawer behind it');

console.log('== #312 the yard advance owed ==');
{
  const env = load(), { app, sel } = env;
  app.emit('load', { layout: { loan: 1500 } }); app.renderAll();
  check(app.layout.loan() === 1500, 'the advance is restored from the save');
  check(/ADVANCE OWED/.test(sel['#bank-readouts'].innerHTML), 'the bank readouts show ADVANCE OWED while it is owed');
  app.emit('load', { layout: { loan: 0 } }); app.renderAll();
  check(!/ADVANCE OWED/.test(sel['#bank-readouts'].innerHTML), 'and drop it once repaid');
  check(/BANK · OWE/.test(appSrc) && /25% of the sale repays/.test(read('js/modules/inventory.js')) && /repays the ' \+ app\.fmtMoney\(loan\)/.test(layout), 'the header and the sell buttons say a quarter repays the advance');
}

console.log('== #313 RUN is disabled with the reason when it would refuse ==');
{
  const env = load(), { app, S, sel } = env;
  S.feedPrepaid = false; S.run = null; app.renderAll();
  const b = sel['#btn-run'];
  check(b.disabled === true && /Nothing is loaded/.test(b.title), 'nothing loaded: RUN is disabled and its title says why');
  S.feedPrepaid = true; app.renderAll();
  check(b.disabled === false, 'with a lot loaded RUN is enabled again');
  check(/function rerunWhy/.test(layout) && /rerunButton\(re, \[x\.m\], 'stock'/.test(layout) && /rerunButton\(re, mats, 'misc'/.test(layout), 'both RE-RUN buttons take their disabled state and title from rerunWhy');
  check(/if \(app\.S\.run\) \{ b\.disabled = true;/.test(layout), 'the station column -/+ are disabled while a batch runs');
  check(/function renderLineLock/.test(appSrc) && /'#btn-remove', '#m-src'/.test(appSrc), 'REMOVE, the Input select and the setting sliders lock while a batch runs');
}

console.log('== #314 a rebuild keeps a typed value and the focus ==');
{
  const env = load(), { app } = env, g = globalThis;
  const mk = (tag, type, text) => ({ tagName: tag, type, textContent: text || '', disabled: false, focused: 0, focus() { this.focused++; g.document.activeElement = this; } });
  const box = { kids: [], listeners: {}, contains(x) { return this.kids.indexOf(x) >= 0; }, querySelectorAll() { return this.kids; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } };
  const input = mk('INPUT', 'number'); box.kids = [input];
  const timers = []; g.setTimeout = (f) => { timers.push(f); return timers.length; };
  let built = 0; const build = () => { built++; box.kids = [mk('INPUT', 'number')]; };
  g.document.activeElement = input; app.keepFocus(box, build);
  check(built === 0 && box.kids[0] === input, 'a focused TARGET field is not rebuilt under the typing');
  g.document.activeElement = g.document.body = {}; (box.listeners.focusout || []).forEach((f) => f()); timers.splice(0).forEach((f) => f());
  check(built === 1, 'the rebuild runs once focus leaves the panel');
  const sell = mk('BUTTON', 'button', 'SELL $40'); box.kids = [mk('BUTTON', 'button', 'SELL $10'), sell];
  const rebuildButtons = () => { built++; box.kids = [mk('BUTTON', 'button', 'SELL $10'), mk('BUTTON', 'button', 'SELL $40')]; };
  g.document.activeElement = sell; app.keepFocus(box, rebuildButtons);
  check(built === 2 && box.kids[1].focused === 1, 'a focused button is rebuilt and its new copy gets the focus back');
  g.document.activeElement = {}; app.keepFocus(box, rebuildButtons);
  check(built === 3, 'focus elsewhere: the panel rebuilds at once');
  check(/API\.keepFocus\(body, renderPanelNow\)/.test(read('js/modules/inventory.js')) && /keepFocus\(\$\('#plant-upgrades'\), renderUpgrades\)/.test(appSrc), 'the Sell stock rows and the Plant upgrades rebuild through keepFocus');
}

console.log('== #316 stale texts ==');
check(!/old windows \(a magnet and a water tank\) at \$1k/.test(html) && /old windows \(a water tank\) from \$3k/.test(html), 'help: old windows start in the $3k tier');
check(!/Flowsheet drawer/.test(html) && /from the Plant drawer/.test(html), 'help: other machines are bought in the Plant drawer');
check(!/charged at the normal price/.test(layout), 'guardLoaded no longer talks about a feed price');
check(/miscT\(\) >= 1 \? '<p class="warn">No bin for you this round: run one batch/.test(read('js/modules/round.js')), 'the Rivals no-bin message asks for a MISC batch only when MISC holds 1 t or more');
check(/E\.projectBatch\(m, lotT \|\| S\.tons/.test(appSrc), 'RUN THE LOT projects the whole lot');

console.log('== #317 small fixes ==');
check(/\.title-screen \{[^}]*align-items: flex-start; justify-content: flex-start/.test(css) && /\.title-screen \.tt-box \{[^}]*margin: auto/.test(css), 'the title box centres by auto margins, so it scrolls on a short screen');
check(/b\.setAttribute\('aria-label', b\.title\)/.test(layout) && /aria-label="Load lot #/.test(layout) && /'Load lot #' \+ L\.id/.test(read('js/modules/auction.js')), '-/+ and yard LOAD buttons have names');
{ const modes = read('js/modules/modes.js'); check((modes.match(/WIPE THIS YARD'; [^\n]*setTimeout\(/g) || []).length === 2 && /WIPE THIS MATCH'; setTimeout\(/.test(modes), 'NEW YARD (title and Settings) and RESTART RIVALS disarm after 3 s'); }
check(/@media \(max-width: 900px\) \{[^@]*body\.lay #scorecard \{ z-index: (\d+)/.test(css) && +css.match(/body\.lay #scorecard \{ z-index: (\d+); \}   \/\* #317/)[1] > 60, 'on a phone the LOT DONE card shows over the full-screen drawer');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' UI fix checks pass');
process.exit(fails ? 1 : 0);
