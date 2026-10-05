// Sorter slots (#51): five to start, up to ten bought at rising prices; a sorter beyond the slots is refused, grinders and
// furnaces never use a slot. Run: node tests/slots.js
require('../js/data.js'); require('../js/sim.js'); require('../js/modules/slots.js');
const { LINES, Sim, Slots: SL } = globalThis.CS;
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }

check(SL.START === 5 && SL.MAX === 10 && SL.PRICES.length === SL.MAX - SL.START, 'five slots to start, ten at most, a price for each slot in between');
check(SL.PRICES.every((p, i) => i === 0 || p > SL.PRICES[i - 1]), 'each slot costs more than the last: ' + SL.PRICES.map((p) => '$' + p).join(', '));
check(SL.nextPrice(5) === SL.PRICES[0] && SL.nextPrice(9) === SL.PRICES[4] && SL.nextPrice(10) === null, 'the next price is slot 6 from five owned, none at ten');
check(SL.isSorter('magnet') && SL.isSorter('sensor') && !SL.isSorter('hammer') && !SL.isSorter('induction'), 'sorters use slots; grinders and furnaces do not');

const starter = Sim.buildLine(LINES.starter);
check(SL.sortersIn(starter) === 1, 'the starter yard uses one slot (the magnet)');
const four = starter.concat(['eddy', 'sinkfloat', 'air'].map((m) => Sim.makeNode(m, {}, 'feed')));
check(SL.addVeto(four, 'screen', 5) === '', 'the fifth sorter fits');
const five = four.concat([Sim.makeNode('screen', {}, 'feed')]);
const why = SL.addVeto(five, 'sensor', 5);
check(/All 5 sorter slots/.test(why) && why.indexOf('$' + SL.PRICES[0].toLocaleString('en-US')) >= 0, 'a sixth is refused with the price of slot 6: ' + why);
check(SL.addVeto(five, 'hammer', 5) === '', 'a grinder never needs a slot');
check(SL.addVeto(five, 'sensor', 6) === '', 'with slot 6 bought it fits');
check(SL.addVeto(four, 'sensor', 5, 1) !== '', 'a pair counts its first sorter before it is on the line');
check(/remove a sorter/.test(SL.addVeto(five.concat(five.slice(1).map((x) => Sim.makeNode(x.m, {}, 'feed'))), 'air', 10)), 'at ten slots the hall is full');

const uni = LINES.universal.nodes, nu = SL.sortersIn(uni);
check(SL.lineVeto(uni, 10, 'Universal sorting plant') === '' || nu > 10, 'a line within the slots loads');
check(nu <= 5 || /Buy \d+ more slot/.test(SL.lineVeto(uni, 5, 'Universal sorting plant')), 'a bigger preset says how many slots to buy (' + nu + ' sorters)');
check(SL.assetValue(5) === 0 && SL.assetValue(7) === SL.PRICES[0] + SL.PRICES[1] && SL.assetValue(10) === SL.PRICES.reduce((a, b) => a + b, 0), 'bought slots count toward net worth at their price');

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' slot checks pass');
process.exit(fails ? 1 : 0);
