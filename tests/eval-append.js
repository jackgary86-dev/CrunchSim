// #379: Sim.evalAppend evaluates a line plus appended stations by reusing the line's own evaluation. It must agree with a full
// evalLine for every trial NEXT PURCHASE makes (a sorter, or a pair, on a free port), leave the base evaluation untouched, and
// refuse (null) a trial that reads a port the line already reads.
// Run: node tests/eval-append.js
require('../js/data.js'); require('../js/sim.js');
const { Sim, LINES, FEEDS, MACHINES } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; if (!ok) { fails++; console.log('  FAIL ' + msg); } }
const sig = (ev) => ev.terminals.map((t) => t.key + '=' + Sim.streamMass(t.stream).toFixed(6) + ':' + Sim.binStats(t.stream.m, t.form).value.toFixed(6)).sort().join('|');
const SORT = ['magnet', 'eddy', 'air', 'sinkfloat', 'screen', 'sensor'];
let trials = 0;
['car', 'starter', 'zorba'].filter((id) => LINES[id]).forEach((id) => {
  const line = Sim.buildLine(LINES[id]);
  ['elv', 'everything', 'zorba', 'pallets'].filter((f) => FEEDS[f]).forEach((f) => {
    const comp = FEEDS[f].comp, base = Sim.evalLine(line, comp, null), before = sig(base);
    base.terminals.forEach((t) => {
      SORT.forEach((m) => {
        const a = Sim.makeNode(m, {}, { uid: t.uid, port: t.port }), trial = line.concat([a]);
        const fast = Sim.evalAppend(base, line.length, trial), full = Sim.evalLine(trial, comp, null);
        check(fast && sig(fast) === sig(full) && fast.nodes.length === full.nodes.length, id + '/' + f + ' + ' + m + ' on ' + t.key);
        const p2 = MACHINES[m].kind === 'separator' ? 'residue' : 'product', b = Sim.makeNode('sinkfloat', { sg: 1.5 }, { uid: a.uid, port: p2 }), pair = trial.concat([b]);
        const fast2 = Sim.evalAppend(base, line.length, pair), full2 = Sim.evalLine(pair, comp, null);
        check(fast2 && sig(fast2) === sig(full2), id + '/' + f + ' + ' + m + ' > sinkfloat on ' + t.key);
        trials += 2;
      });
    });
    check(sig(base) === before, id + '/' + f + ': the base evaluation is untouched by the trials');
    const read = line.find((x) => x.src && x.src !== 'feed');
    if (read) check(Sim.evalAppend(base, line.length, line.concat([Sim.makeNode('magnet', {}, read.src)])) === null, id + '/' + f + ': a port the line already reads is refused');
  });
});
// #380: Sim.evalFrom reuses the stations before the one a TUNE or REWIRE changes; it agrees with a full evalLine, or returns null
let tunes = 0, refused = 0;
['car', 'starter', 'zorba'].filter((id) => LINES[id]).forEach((id) => {
  const line = Sim.buildLine(LINES[id]);
  ['elv', 'everything', 'zorba'].filter((f) => FEEDS[f]).forEach((f) => {
    const comp = FEEDS[f].comp, base = Sim.evalLine(line, comp, null), before = sig(base), free = base.terminals.map((t) => ({ uid: t.uid, port: t.port }));
    line.forEach((node, i) => {
      if (i === 0) return;
      const D = (MACHINES[node.m].settings || [])[0], trials = [];
      if (D && !D.enum) trials.push(Object.assign({}, node, { settings: Object.assign({}, node.settings, { [D.id]: (D.min + D.max) / 2 }) }));
      free.filter((p) => line.findIndex((x) => x.uid === p.uid) < i).forEach((p) => trials.push(Object.assign({}, node, { src: { uid: p.uid, port: p.port } })));
      trials.forEach((tn) => {
        const trial = line.map((x) => (x === node ? tn : x)), fast = Sim.evalFrom(base, line, i, trial, comp, null), full = Sim.evalLine(trial, comp, null);
        if (fast === null) { refused++; return; }
        tunes++; check(sig(fast) === sig(full) && fast.nodes.length === full.nodes.length, id + '/' + f + ' station ' + (i + 1) + ' ' + JSON.stringify(tn.src) + ' ' + JSON.stringify(tn.settings));
      });
    });
    check(sig(base) === before, id + '/' + f + ': evalFrom leaves the base evaluation untouched');
  });
});
check(tunes > 30, 'evalFrom took most trials (' + tunes + ' exact, ' + refused + ' refused to a full evaluation)');
console.log((fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' eval-append checks pass') + ' (' + trials + ' trials)');
process.exit(fails ? 1 : 0);
