// The README's test list and retired-feature text stay true (#238). Run: node tests/readme.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
const listed = (readme.match(/node tests\/[\w-]+\.js/g) || []).map((s) => s.slice('node tests/'.length));
const real = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'app-env.js' && f !== 'browser-env.js');   // app-env.js and browser-env.js are helpers, not tests
const missing = listed.filter((f) => !fs.existsSync(path.join(__dirname, f)));
const unlisted = real.filter((f) => listed.indexOf(f) < 0);
check(!missing.length, 'every test the README runs exists' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
check(!unlisted.length, 'every tests/*.js is in the README list' + (unlisted.length ? ' (unlisted: ' + unlisted.join(', ') + ')' : ''));
check(!/Take contracts|every contract has three stars|supplier contracts unlock|Supplier contracts unlock/i.test(readme), 'no text for the contracts retired in #78');
const build = fs.readFileSync(path.join(root, 'tools', 'build.py'), 'utf8');
const outName = (build.match(/'dist',\s*'([\w.-]+\.html)'/) || [])[1];
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const named = (indexHtml.match(/dist\/[\w.-]+\.html/g) || []).concat(readme.match(/dist\/[\w.-]+\.html/g) || []);
check(!!outName && named.length > 0 && named.every((s) => s === 'dist/' + outName), 'index.html and README name the file build.py writes (' + outName + ') (#237)');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' readme checks pass');
process.exit(fails ? 1 : 0);
