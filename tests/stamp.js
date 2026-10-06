// index.html's, plant3d.html's and gallery.html's ?v= cache-bust hashes match the files they name (#233). Run: node tests/stamp.js
// Fix a failure with: node tools/stamp.js   (or python tools/build.py)
const fs = require('fs'), path = require('path');
const { hashFile, ASSET, PAGES } = require('../tools/stamp.js');
const root = path.join(__dirname, '..');
let fails = 0, n = 0;
function check(ok, msg) { n++; if (!ok) { console.log('  FAIL ' + msg); fails++; } }
const re = /(?:<link rel="stylesheet" href="|<script src=")((?:css|js)\/[^"?]+)(\?v=[0-9a-f]*)?"/g;
PAGES.forEach((page) => {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  let m, seen = 0; re.lastIndex = 0;
  while ((m = re.exec(html))) {
    seen++;
    const want = '?v=' + hashFile(m[1]);
    check(m[2] === want, page + ': ' + m[1] + ' is stamped ' + (m[2] || '(none)') + ', file hashes to ' + want);
  }
  check(seen > 0 && seen === (html.match(ASSET) || []).length, 'every css/js URL in ' + page + ' is one the stamp pattern covers (' + seen + ' found)');
});
const py = fs.readFileSync(path.join(root, 'tools', 'build.py'), 'utf8');
const lfCall = '.replace(b' + String.fromCharCode(39) + String.fromCharCode(92) + 'r' + String.fromCharCode(92) + 'n' + String.fromCharCode(39) + ', b' + String.fromCharCode(39) + String.fromCharCode(92) + 'n' + String.fromCharCode(39) + ')';
check(py.indexOf(lfCall) >= 0, 'tools/build.py hashes LF-normalised bytes');
console.log(fails ? '\n' + fails + ' PROBLEM(S): run node tools/stamp.js' : 'all ' + n + ' stamp checks pass');
process.exit(fails ? 1 : 0);
