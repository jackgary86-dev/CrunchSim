// Cam.resize (#215): sizes the bitmap to the true CSS box and does not touch the canvas when nothing changed.
// DOM-free stub canvas. Run: node tests/cam-resize.js
globalThis.window = globalThis.window || globalThis;
require('../js/data.js'); require('../js/cam.js');
let fails = 0, n = 0;
function check(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
let rect = { width: 187, height: 116 }, wset = 0, hset = 0, w = 0, h = 0;
const cv = {
  getContext() { return {}; }, getBoundingClientRect() { return rect; },
  get width() { return w; }, set width(v) { w = v; wset++; },
  get height() { return h; }, set height(v) { h = v; hset++; }
};
window.devicePixelRatio = 1;
const cam = new globalThis.CS.Cam(cv);
check(cam.W === 187 && cam.H === 116, 'size follows the real rect, not a 200x160 floor');
check(w === 187 && h === 116, 'bitmap matches the rect at dpr 1');
const w0 = wset, h0 = hset;
for (let i = 0; i < 100; i++) cam.resize();
check(wset === w0 && hset === h0, 'repeated resize at the same size never reassigns the canvas');
check(Math.abs(rect.width - cam.W) <= 1 && Math.abs(rect.height - cam.H) <= 1, 'miniLoop 1px comparison is satisfied after resize');
rect = { width: 254, height: 158 }; cam.resize();
check(cam.W === 254 && cam.H === 158 && w === 254 && h === 158, 'a real change resizes');
window.devicePixelRatio = 2; cam.resize();
check(w === 508 && h === 316, 'dpr change reallocates');
rect = { width: 0, height: 0 }; cam.resize();
check(cam.W === 1 && cam.H === 1, 'a hidden (0x0) box clamps to 1, never 0');
console.log(fails ? fails + ' FAILED' : 'all ' + n + ' passed'); process.exit(fails ? 1 : 0);
