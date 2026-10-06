// Guards gallery.html (#239): the tile grid's column minimum must be capped at the container width, or a 375 px phone
// scrolls sideways. A real layout check needs a browser, so this reads the CSS rule.
// Run: node tests/gallery-grid.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'gallery.html'), 'utf8');
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }

const m = html.match(/\.grid\s*\{[^}]*grid-template-columns:\s*([^;}]*)/);
check(!!m, 'gallery.html has a .grid rule with grid-template-columns');
const cols = m ? m[1] : '';
check(/minmax\(\s*min\(\s*\d+px\s*,\s*100%\s*\)\s*,\s*1fr\s*\)/.test(cols), 'the column minimum is capped at 100% so narrow phones do not overflow (' + cols.trim() + ')');

console.log('\n' + (n - fails) + '/' + n + ' checks passed');
process.exit(fails ? 1 : 0);
