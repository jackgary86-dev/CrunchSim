// Checks the plant-floor layout (js/plant3d.js, pure part) without THREE or a DOM: lanes, bins and belts for the
// car line and the universal line must follow the lane rules and nothing on the floor may overlap.
require('../js/data.js'); require('../js/sim.js'); require('../js/plant3d.js');
const { LINES, FEEDS, MACHINES, Sim, Plant3D } = globalThis.CS;
const { layout, beltPoint } = Plant3D;

let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); }

// the universal line is defined by another ticket; until it lands, a stand-in exercises every lane rule:
// a primary chain, a secondary port, two consumers of one secondary port, a second consumer of a primary port
const UNIVERSAL = LINES.universal || {
  name: 'Universal (test stand-in)', feed: 'elv', tons: 15,
  nodes: [
    { m: 'twin', s: { width: 60 }, src: 'feed' },
    { m: 'magnet', s: { field: 250 }, src: '1:product' },
    { m: 'hammer', s: { grate: 100, rpm: 100 }, src: '2:residue' },
    { m: 'screen', s: { aperture: 40 }, src: '2:residue' },
    { m: 'air', s: { air: 11 }, src: '3:product' },
    { m: 'eddy', s: { rpm: 3000 }, src: '5:residue' },
    { m: 'sinkfloat', s: { sg: 2.9 }, src: '6:extract' },
    { m: 'jaw', s: { css: 60 }, src: '3:product' }
  ]
};

function boxes(L) {
  const out = [{ name: 'hopper', x: L.hopper.x, z: L.hopper.z, w: L.hopper.w, d: L.hopper.d }];
  L.nodes.forEach((n, k) => out.push({ name: 'node ' + (k + 1) + ' ' + MACHINES[n.m].short, x: n.x, z: n.z, w: n.w, d: n.d, uid: n.uid }));
  L.bins.forEach((b) => out.push({ name: 'bin ' + b.key, x: b.x, z: b.z, w: b.w, d: b.d, key: b.key }));
  return out;
}
function overlap(a, b, clear) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + clear && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + clear;
}
function inside(p, b, shrink) { return Math.abs(p.x - b.x) < b.w / 2 - shrink && Math.abs(p.z - b.z) < b.d / 2 - shrink; }

function audit(name, def, feedId) {
  console.log('\n=== ' + name);
  const line = Sim.buildLine(def), L = layout(line);
  const ev = Sim.evalLine(line, FEEDS[feedId].comp);
  console.log('  ' + L.nodes.map((n) => (n.index + 1) + ':' + MACHINES[n.m].short + '@' + n.slot + ',' + n.lane + '(' + n.why + ')').join('  '));
  console.log('  bins ' + L.bins.map((b) => b.key + '@' + b.slot + ',' + b.lane).join('  '));
  // every node has a lane and an x slot in flowsheet order
  check(L.nodes.every((n) => Number.isInteger(n.lane) && Number.isInteger(n.slot)), 'every node has an integer lane and slot');
  check(L.nodes.every((n, k) => k === 0 || n.x > L.nodes[k - 1].x), 'nodes advance along X in flowsheet order');
  check(L.nodes[0].lane === 0 && L.nodes[0].why === 'head', 'the first node runs in the hopper lane');
  // a bin for exactly the sim's terminal ports
  const termKeys = ev.terminals.map((t) => t.key).sort(), binKeys = L.bins.map((b) => b.key).sort();
  check(JSON.stringify(termKeys) === JSON.stringify(binKeys), 'bins match the sim terminals (' + binKeys.length + ')');
  // nothing overlaps on the floor (0.3 m clearance between any two boxes)
  const bx = boxes(L); let hits = 0;
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) if (overlap(bx[i], bx[j], 0.3)) { hits++; console.log('    overlap: ' + bx[i].name + ' vs ' + bx[j].name); }
  check(hits === 0, 'no two machines, bins or the hopper overlap');
  // belts: one per node input and per bin; corridor cells free of nodes and bins; path never crosses a box it does not end at
  check(L.belts.length === L.nodes.length + L.bins.length, 'one belt per node input and per bin (' + L.belts.length + ')');
  let crossings = 0, badCells = 0;
  L.belts.forEach((b) => {
    b.cells.forEach((c) => { const cell = L.cells[c]; if (cell && cell.type !== 'belt') badCells++; });
    const endUid = b.to.uid, endKey = b.to.bin != null ? L.bins[b.to.bin].key : null;
    const fromUid = b.from === 'feed' ? null : b.from.uid, fromHopper = b.from === 'feed';
    for (let s = 0; s <= b.len; s += 0.25) {
      const p = beltPoint(b, s);
      bx.forEach((box) => {
        if ((box.uid != null && (box.uid === endUid || box.uid === fromUid)) || (box.key && box.key === endKey) || (box.name === 'hopper' && fromHopper)) return;
        if (inside(p, box, 0.05)) crossings++;
      });
    }
    check(b.len > 0.5 && b.pts.length >= 2, 'belt ' + b.index + ' ' + (b.from === 'feed' ? 'feed' : b.from.uid + ':' + b.from.port) + ' -> ' + (b.to.uid != null ? 'node ' + b.to.uid : 'bin ' + b.to.bin) + ' has a path (' + b.len.toFixed(1) + ' m)');
  });
  check(badCells === 0, 'belt corridors stay clear of machines and bins');
  check(crossings === 0, 'no belt passes through a machine or bin it does not serve');
  return L;
}

/* ---- car line: hammer, air, magnet, eddy, sink-float ---- */
const car = audit('Car shredder line', LINES.car, LINES.car.feed);
const cn = car.nodes;
check(cn[1].lane === cn[0].lane && cn[1].why === 'primary', 'air takes the hammermill product in the same lane');
check(cn[2].lane !== cn[1].lane && cn[2].why === 'secondary port', 'magnet on the air residue gets its own lane');
check(cn[3].lane !== cn[2].lane && cn[3].why === 'secondary port', 'eddy on the magnet residue gets another lane');
check(cn[4].lane === cn[3].lane && cn[4].why === 'primary', 'sink-float follows the eddy extract in its lane');
check(new Set([cn[0].lane, cn[2].lane, cn[3].lane]).size === 3, 'three distinct lanes for the car line');
const hammerRejects = car.bins.find((b) => b.uid === cn[0].uid && b.port === 'rejects');
const airLights = car.bins.find((b) => b.uid === cn[1].uid && b.port === 'extract');
check(!!hammerRejects && !!airLights, 'hammermill rejects and air lights end in bins');
check(airLights && airLights.lane === cn[1].lane && airLights.slot === cn[1].slot + 1, 'the unused primary port continues in its own lane to a bin');

/* ---- universal line ---- */
const uni = audit('Universal line' + (LINES.universal ? '' : ' (stand-in)'), UNIVERSAL, UNIVERSAL.feed);
if (!LINES.universal) {
  const un = uni.nodes;
  check(un[1].lane === un[0].lane, 'magnet follows the shredder lane');
  check(un[2].lane !== un[1].lane, 'hammer on magnet residue gets its own lane');
  check(un[3].lane !== un[1].lane && un[3].lane !== un[2].lane && un[3].why === 'secondary port', 'second consumer of the same residue port gets yet another lane');
  check(un[4].lane === un[2].lane, 'air follows the hammer lane');
  check(un[5].lane !== un[4].lane, 'eddy on air residue gets its own lane');
  check(un[6].lane === un[5].lane, 'sink-float follows the eddy lane');
  check(un[7].lane !== un[2].lane && un[7].why === 'shared port', 'second consumer of the hammer product gets its own lane');
  check(uni.bins.some((b) => b.uid === un[1].uid && b.port === 'extract'), 'the magnet ferrous port, unused, ends in a bin');
} else {
  const lanes = new Set(uni.nodes.map((n) => n.lane));
  check(lanes.size >= 1, 'universal line uses ' + lanes.size + ' lane(s)');
}

/* ---- every preset, for good measure ---- */
for (const id in LINES) { if (id === 'car' || id === 'universal') continue; audit(LINES[id].name, LINES[id], LINES[id].feed); }

/* ---- a line with a bad source reference falls back to the head feed ---- */
const broken = Sim.buildLine(LINES.car); broken[2].src = { uid: 999999, port: 'product' };
const bl = layout(broken);
check(bl.nodes[2].src === 'feed' && bl.belts.some((b) => b.from === 'feed' && b.to.uid === broken[2].uid), 'an unknown source is treated as head feed');

// wheel zoom: one Firefox notch (3 lines) must zoom about as much as one Chrome notch (100 px), and pages more
const { wheelZoom } = Plant3D;
const chrome = wheelZoom(40, 100, 0), ff = wheelZoom(40, 3, 1), pg = wheelZoom(40, 1, 2);
check(Math.abs(ff - chrome) / chrome < 0.05, 'a Firefox line-mode notch zooms like a Chrome pixel-mode notch (' + ff.toFixed(2) + ' vs ' + chrome.toFixed(2) + ')');
check(Math.abs(pg - chrome) < 1e-9, 'a page-mode wheel step is 100 px');
check(wheelZoom(40, -1e6, 0) === 6 && wheelZoom(40, 1e6, 0) === 150, 'wheel zoom stays within 6..150 m');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall layout checks pass');
process.exit(fails ? 1 : 0);
