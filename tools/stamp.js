// Node port of stamp() in tools/build.py (#233), for machines without Python. Run: node tools/stamp.js
// Appends ?v=<first 10 hex of sha1 of the file with CRLF turned into LF> to every local css/js URL in the PAGES (index, plant3d, gallery),
// so a CRLF (Windows) checkout and an LF checkout give the same hashes. build.py must hash the same way.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'plant3d.html', 'gallery.html'];   // #264: the two side pages load js/ too and were never stamped
const ASSET = /(<link rel="stylesheet" href="|<script src=")((?:css|js)\/[^"?]+)(?:\?v=[0-9a-f]*)?(")/g;

function hashFile(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');   // byte-exact, only CRLF changes
  return crypto.createHash('sha1').update(lf).digest('hex').slice(0, 10);
}
function stamp(html) {
  return html.replace(ASSET, (m, pre, rel, post) => pre + rel + '?v=' + hashFile(rel) + post);
}
module.exports = { stamp, hashFile, ASSET, PAGES };

if (require.main === module) {
  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const html = fs.readFileSync(file, 'utf8');
    const out = stamp(html);
    if (out !== html) { fs.writeFileSync(file, out); console.log(page + ' asset URLs re-stamped'); }
    else console.log(page + ' asset URLs already current');
  }
}
