/* CrunchSim module: playbooks (tickets #29 and #30). Loaded after blueprints; talks to the game only through CS.app.
 *
 * #29  A playbook card per bucket type (ferrous, aluminum, copper-brass-zinc, wood chips, plastic flake, rubber crumb,
 *      glass cullet, aggregate and rock flour, hydrogel): the machine sequence, the key settings, the traps, the purity
 *      and size the line is good for, its signature, and a LOAD THIS SETUP button that builds it like a preset.
 * #30  A fit readout for the lot in the feed against the current line: projected purity and recovery of every valuable
 *      material, plant energy, which materials end in mixed or reject bins, the playbooks ranked by projected margin on
 *      this feed with the cost of the machines not yet owned, and a plain-words warning when a valuable material has no
 *      separating step on the line ("This lot is 40 percent copper and your line has no way to separate it from the aluminum").
 *
 * A playbook definition is preset-shaped, the same form as CS.LINES ({ nodes: [{ m, s, src }] }), so CS.Sim.buildLine
 * rebuilds it with fresh uids. The pure parts (PLAYBOOKS, valuable, fit, canSplit, mismatch, lineMargin, rank) live on
 * CS.Playbooks and touch no DOM, so tests/playbooks.js can run them in Node. The panel runs only when CS.app exists.
 * Module state is persisted through the app's 'save' / 'load' hooks under ext.playbooks = { open }.
 */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.Sim || !CS.MACHINES) return;
  const MATERIALS = CS.MATERIALS, MACHINES = CS.MACHINES, FEEDS = CS.FEEDS, Sim = CS.Sim;

  /* ---------------- playbook cards ----------------
   * Every expect block was measured in tests/playbooks.js on the card's demo feed; the promised purity sits a few points
   * under the measured value so wear, a slider nudge or a dirtier lot does not break the promise.
   */
  const N = (m, s, src) => ({ m, s, src });
  // bottle bank: glass with steel crown caps, aluminum ring-pulls and plastic labels and closures (MRF glass-stream audits
  // put non-glass contamination at 10-15% by mass before cleaning)
  const BOTTLE_BANK = { glass: 0.86, plastic: 0.06, aluminum: 0.03, steel: 0.05 };
  const PLAYBOOKS = [
    {
      id: 'ferrous', name: 'Steel and cast iron', short: 'FERROUS', targets: ['steel', 'castiron'], feed: 'elv', tons: 15,
      blurb: 'Tear, then pull the iron with a magnet. The cheapest clean bucket in the yard.',
      steps: [
        'Twin-shaft shear shredder, cutter width 60 mm. Slow hooked cutters tear car bodies and appliances to under 250 mm at about 3 kWh/t.',
        'Magnetic drum at 250 mT on the shredder product. Steel and cast iron stick to the drum and drop off after the field; everything else flies off as the residue.'
      ],
      settings: [
        'TWIN cutter width 60 mm: wider cutters pass bigger pieces and cut less, which is fine for a magnet but too coarse for a furnace door.',
        'MAG field 250 mT: enough for pieces over 2 mm. Above 400 mT the drum starts dragging trapped non-ferrous pieces along.'
      ],
      traps: [
        'A hammermill makes the same bucket but at 11 kWh/t instead of 3: steel is ductile and soaks impact energy.',
        'A magnet ahead of the shredder lifts whole hulks with everything bolted to them, so the bucket is dirty.',
        'The residue still holds the aluminum, copper and zinc: that is the next playbook, not waste.'
      ],
      // measured: 99% ferrous at 98% recovery, P80 153 mm, 3.1 kWh/t on end-of-life vehicles
      expect: [{ node: 2, port: 'extract', label: 'ferrous shred', targets: ['steel', 'castiron'], purity: 0.95, recovery: 0.95, p80: [10, 250] }],
      def: { nodes: [N('twin', { width: 60 }, 'feed'), N('magnet', { field: 250 }, '1:product')] }
    },
    {
      id: 'aluminum', name: 'Aluminum', short: 'ALU', targets: ['aluminum'], feed: 'zorba', tons: 10,
      blurb: 'Float the aluminum off the heavy metals in a dense medium. Eddy currents cannot do this.',
      steps: [
        'Twin-shaft shear shredder, cutter width 40 mm, so every piece is small enough to sink or float on its own.',
        'Sink-float tank with the medium at 2.9 g/cc. Aluminum at 2.7 g/cc floats; zinc, brass and copper at 6.6 to 9 g/cc sink.'
      ],
      settings: [
        'SINK medium 2.9 g/cc: just above aluminum. Lower and some aluminum sinks with the heavies; above 3.2 nothing changes until zinc at 6.6.',
        'TWIN cutter width 40 mm: pieces under 150 mm keep the floats inside the aluminum size spec.'
      ],
      traps: [
        'An eddy current separator throws every conductor the same way, so zorba comes out of it still mixed.',
        'A sink-float tank fed with unshredded pieces: whole castings and assemblies trap air or carry a heavy insert and go the wrong way.',
        'Ferrous in the feed: put a magnet first when the lot came from cars, or the steel sinks with the copper and the medium is wasted.'
      ],
      // measured: 100% aluminum at 76% recovery (the rest sinks with the heavies at 2.9), P80 91 mm, 4.9 kWh/t on zorba
      expect: [{ node: 2, port: 'extract', label: 'aluminum', targets: ['aluminum'], purity: 0.95, recovery: 0.7, p80: [10, 150] }],
      def: { nodes: [N('twin', { width: 40 }, 'feed'), N('sinkfloat', { sg: 2.9 }, '1:product')] }
    },
    {
      id: 'heavies', name: 'Copper, brass and zinc', short: 'HEAVY NF', targets: ['copper', 'brass', 'potmetal'], feed: 'zorba', tons: 10,
      blurb: 'The sinks of the aluminum tank are the heavy non-ferrous mix. Only a sensor sorter can pick the copper out of it.',
      steps: [
        'Twin-shaft shear shredder, cutter width 40 mm.',
        'Sink-float tank at 2.9 g/cc: the floats are the aluminum bucket, the sinks are copper, brass and zinc die-cast together.',
        'Sensor sorter (XRT) on the sinks, target copper. The scanner reads each piece and an air jet kicks the copper over the splitter; brass and zinc stay in the residue.'
      ],
      settings: [
        'XRT target copper: the richest metal pays for the sorter. Set it to brass or pot metal for a second pass on the residue.',
        'Keep the sinks between 10 and 150 mm: the camera cannot resolve pieces under 5 mm and the jets miss them.'
      ],
      traps: [
        'No density between zinc (6.6), brass (8.5) and copper (9.0) can be reached by a sink-float medium, which stops at 4 g/cc.',
        'An eddy current separator on the sinks: copper, brass and zinc are all conductors and all get thrown.',
        'Fines in the sorter feed: anything under 10 mm is missed, so do not granulate before the XRT.'
      ],
      // measured: copper 88% pure at 90% recovery in the sorter extract; the residue is 97% of the brass and zinc, P80 84 mm; 6.4 kWh/t on zorba
      expect: [
        { node: 3, port: 'extract', label: 'copper', targets: ['copper'], purity: 0.85, recovery: 0.85, p80: [5, 100] },
        { node: 3, port: 'residue', label: 'brass and zinc heavies', targets: ['brass', 'potmetal'], purity: 0.5, recovery: 0.9 }
      ],
      def: { nodes: [N('twin', { width: 40 }, 'feed'), N('sinkfloat', { sg: 2.9 }, '1:product'), N('sensor', { target: 'copper' }, '2:residue')] }
    },
    {
      id: 'wood', name: 'Wood chips', short: 'WOOD', targets: ['wood'], feed: 'pallets', tons: 15,
      blurb: 'Tear, pull the nails, then chip. The magnet goes before anything with an edge.',
      steps: [
        'Twin-shaft shear shredder, cutter width 60 mm: pallets are 1.2 m long and no chipper accepts them whole.',
        'Magnetic drum at 250 mT on the shredder product: nails, screws and strapping out.',
        'Drum chipper, chip length 20 mm, on the magnet residue: knives slice the clean wood into uniform chips.'
      ],
      settings: [
        'CHIP chip length 20 mm gives a P80 of about 24 mm, inside the 5 to 60 mm mulch and board-furnish window.',
        'TWIN cutter width 60 mm: coarse is fine here, the chipper sets the final size.'
      ],
      traps: [
        'A chipper without a magnet ahead of it: one nail and the knives are finished.',
        'A tub grinder makes the size but beats the wood to splinters at twice the energy; a hammermill is worse.',
        'The magnet drags about a third of its own mass of wood along with the nails: that bin is scrap, not chips.'
      ],
      // measured: 98% wood at 97% recovery, P80 24 mm, 6.4 kWh/t on pallets with nails
      expect: [{ node: 3, port: 'product', label: 'wood chips', targets: ['wood'], purity: 0.95, recovery: 0.95, p80: [5, 40] }],
      def: { nodes: [N('twin', { width: 60 }, 'feed'), N('magnet', { field: 250 }, '1:product'), N('chipper', { len: 20 }, '2:residue')] }
    },
    {
      id: 'plastic', name: 'Plastic flake', short: 'PLASTIC', targets: ['plastic'], feed: 'appliance', tons: 15,
      blurb: 'Tear, magnet, lift the plastic out in an air column, then cut it to flake.',
      steps: [
        'Twin-shaft shear shredder, cutter width 60 mm.',
        'Magnetic drum at 250 mT: the steel shell and drum out.',
        'Zig-zag air classifier at 11 m/s on the magnet residue: plastic panels (terminal velocity about 6 m/s) lift out as lights; rubber, glass, stone and metal drop.',
        'Single-shaft shredder with a 30 mm screen on the lights: knives and a pusher ram cut the panels to pieces a granulator accepts.',
        'Granulator with an 8 mm screen: high-speed knives chop the pieces into melt-ready flake.'
      ],
      settings: [
        'AIR 11 m/s: lifts plastic and wood; at 14 m/s the rubber and glass come up too, at 8 the thick plastic stays down.',
        'GRAN screen 8 mm gives a P80 of about 6 mm, inside the 2 to 15 mm flake spec. The granulator only takes pieces under 40 mm, hence the single-shaft stage first.'
      ],
      traps: [
        'A granulator straight after the twin-shaft: pieces over 40 mm are scalped off at the inlet.',
        'Rubber hoses lift with the plastic if the air is set too high and end up in the flake.',
        'Knives and glass: any glass in the lights chews the granulator knives. Keep the air speed below the glass terminal velocity.'
      ],
      // measured: 92% plastic at 92% recovery, P80 6.3 mm, 14 kWh/t on white goods
      expect: [{ node: 5, port: 'product', label: 'plastic flake', targets: ['plastic'], purity: 0.85, recovery: 0.85, p80: [2, 15] }],
      def: { nodes: [N('twin', { width: 60 }, 'feed'), N('magnet', { field: 250 }, '1:product'), N('air', { air: 11 }, '2:residue'), N('single', { screen: 30 }, '3:extract'), N('granulator', { screen: 8 }, '4:product')] }
    },
    {
      id: 'rubber', name: 'Rubber crumb', short: 'RUBBER', targets: ['rubber'], feed: 'tires', tons: 8,
      blurb: 'Tear, cut, blow the fabric off while the pieces are still big, freeze-shatter, then pull the bead wire.',
      steps: [
        'Twin-shaft shear shredder, cutter width 60 mm: whole tires to strips.',
        'Single-shaft shredder with a 30 mm screen: strips to chips.',
        'Zig-zag air classifier at 9 m/s on the chips: the textile cord lifts out while the rubber and wire drop.',
        'Cryogenic mill, target P80 1 mm, on the heavies: liquid nitrogen takes the rubber below its glass transition and it shatters into crumb.',
        'Magnetic drum at 250 mT on the crumb: the bead and belt wire out.'
      ],
      settings: [
        'CRYO target 1.0 mm: the 0.2 to 6 mm crumb window. Finer costs nitrogen fast.',
        'AIR 9 m/s: below the 13 m/s a rubber chip needs to lift, above the 6 m/s of the cord.'
      ],
      traps: [
        'A hammermill or any ambient mill: rubber bounces and tears, it never makes crumb.',
        'The bead wire chews the single-shaft knives: budget for service, or screen the wire strips off first.',
        'Nitrogen is the bill: about 1 kg per kg of rubber. Sign the nitrogen supply contract before running tonnage.'
      ],
      // measured: 93% rubber at 86% recovery, P80 1.0 mm, 64 kWh/t on scrap tires
      expect: [{ node: 5, port: 'residue', label: 'rubber crumb', targets: ['rubber'], purity: 0.85, recovery: 0.8, p80: [0.2, 1.5] }],
      def: { nodes: [N('twin', { width: 60 }, 'feed'), N('single', { screen: 30 }, '1:product'), N('air', { air: 9 }, '2:product'), N('cryo', { target: 1.0 }, '3:residue'), N('magnet', { field: 250 }, '4:product')] }
    },
    {
      id: 'glass', name: 'Glass cullet', short: 'GLASS', targets: ['glass'], feed: BOTTLE_BANK, feedName: 'Bottle bank', tons: 15,
      blurb: 'Sort the caps and labels off first, then crush. Glass breaks for almost nothing but ruins knives.',
      steps: [
        'Magnetic drum at 250 mT on the raw feed: steel crown caps out.',
        'Zig-zag air classifier at 11 m/s: plastic closures and labels lift out; glass and aluminum drop.',
        'Eddy current separator at 3000 rpm on the heavies: aluminum ring-pulls fly over the splitter, glass does not react.',
        'Roll crusher, gap 20 mm, on the eddy residue: the clean glass is nipped to cullet with few fines.'
      ],
      settings: [
        'ROLL gap 20 mm gives a P80 of about 18 mm, inside the 2 to 50 mm cullet window, with little dust.',
        'AIR 11 m/s: a bottle shard at 6 mm thick needs 14 m/s to lift, a plastic label 6.'
      ],
      traps: [
        'Crushing first: once the glass is under 10 mm the magnet and eddy current drag it along and the sorters stop working.',
        'Any knife machine: glass is the most abrasive feed in the yard.',
        'A jaw crusher makes cullet too, but its 20 mm closed side gives more fines than a roll gap.'
      ],
      // measured: 100% glass at 82% recovery, P80 18 mm, 5.3 kWh/t on a bottle-bank mix
      expect: [{ node: 4, port: 'product', label: 'glass cullet', targets: ['glass'], purity: 0.95, recovery: 0.75, p80: [2, 50] }],
      def: { nodes: [N('magnet', { field: 250 }, 'feed'), N('air', { air: 11 }, '1:residue'), N('eddy', { rpm: 3000 }, '2:residue'), N('roll', { gap: 20 }, '3:residue')] }
    },
    {
      id: 'aggregate', name: 'Aggregate and rock flour', short: 'ROCK', targets: ['granite', 'limestone'], feed: 'quarry', tons: 30,
      blurb: 'Two compression stages, a screen, and a ball mill only on the fines that need it.',
      steps: [
        'Jaw crusher, closed-side setting 100 mm: run-of-mine to under 180 mm.',
        'Cone crusher, closed-side setting 20 mm: the secondary stage, product P80 about 16 mm.',
        'Vibrating screen, 8 mm aperture: the oversize (8 to 30 mm) is the road-base bucket.',
        'Ball mill, target P80 0.5 mm, on the screen undersize: the fines become rock flour.'
      ],
      settings: [
        'SCRN aperture 8 mm splits the aggregate (8/25 spec) from the fines that the mill grinds.',
        'BALL target 0.5 mm: the filler spec is under 0.6 mm. Every halving of the target doubles the energy (Bond).'
      ],
      traps: [
        'A ball mill fed with cone product: it only takes pieces under 25 mm, the rest is scalped off at the inlet.',
        'Milling the whole stream: fine grinding is where the energy goes, so grind only what the flour buyer pays for.',
        'Rubble instead of quarry rock: pull the rebar with a magnet and the timber with air before the cone, or the cone chokes.'
      ],
      // measured: 100% aggregate in both bins, road base P80 19 mm (60% of the rock), flour P80 0.5 mm (40%), 5.8 kWh/t on quarry run-of-mine
      expect: [
        { node: 3, port: 'residue', label: 'road base', targets: ['granite', 'limestone'], purity: 0.99, recovery: 0.55, p80: [8, 25] },
        { node: 4, port: 'product', label: 'rock flour', targets: ['granite', 'limestone'], purity: 0.99, recovery: 0.35, p80: [0, 0.6] }
      ],
      def: { nodes: [N('jaw', { css: 100 }, 'feed'), N('cone', { css: 20 }, '1:product'), N('screen', { aperture: 8 }, '2:product'), N('ball', { target: 0.5 }, '3:extract')] }
    },
    {
      id: 'gel', name: 'Hydrogel and water', short: 'GEL', targets: ['gel'], feed: 'gel', tons: 2,
      blurb: 'A soft solid does not fracture. Cut it small, then shear it through micron gaps. Water cannot be crushed at all.',
      steps: [
        'Single-shaft shredder with a 20 mm screen: gel blocks to lumps.',
        'Granulator with a 3 mm screen: lumps to grains small enough for a rotor-stator gap.',
        'Colloid mill, 100 µm gap: hydraulic shear tears the grains to tens of micrometres.',
        'High-pressure homogenizer at 600 bar: the pressure drop through the valve finishes the paste at about 10 µm.'
      ],
      settings: [
        'HOMO 600 bar gives a P80 of about 10 µm; the cosmetics spec is under 50 µm, so do not pay for 2000 bar.',
        'COLL gap 100 µm: a tighter gap costs energy as the square root of the gap ratio.'
      ],
      traps: [
        'Any crusher or impact mill: gel squeezes and bounces, nothing breaks.',
        'Water in the lot: liquid passes straight through every shear stage and dilutes the paste. Drain it at the gate, or freeze and crush it, or atomize it on its own.',
        'The homogenizer blocks on anything over a millimetre, so never skip the colloid mill.'
      ],
      // measured: 100% gel at 99% recovery, P80 10 µm, 126 kWh/t on gel blocks; on the gel-and-water lab feed the same line makes a 50% paste worth $8/t
      expect: [{ node: 4, port: 'product', label: 'gel paste', targets: ['gel'], purity: 0.99, recovery: 0.95, p80: [0, 0.05] }],
      def: { nodes: [N('single', { screen: 20 }, 'feed'), N('granulator', { screen: 3 }, '1:product'), N('colloid', { gap: 100 }, '2:product'), N('homog', { bar: 600 }, '3:product')] }
    }
  ];

  /* ---------------- pure helpers ---------------- */
  // material groups that count as one product, as in Sim.binStats (steel and cast iron ship together as ferrous scrap,
  // granite and limestone as aggregate)
  const GROUP = { steel: 'ferrous', castiron: 'ferrous', granite: 'aggregate', limestone: 'aggregate' };
  const CLEAN = 0.85;          // bucket purity at or above which a bin is "clean": the binStats price grade is 74% here and most scrap specs start at 85-90%
  const VALUE_SHARE = 0.03;    // a material that carries at least 3% of what the lot is worth is a product to chase (a yard grades to about that)
  const MASS_MIN = 0.005;      // and is at least 0.5% of the mass, or no separator can make a bin of it
  const WARN_MASS = 0.05;      // the mismatch warning is for a material that is at least a twentieth of the lot (below that a yard lets it ride in a mixed bin) ...
  const WARN_VALUE = 0.2;      // ... or carries a fifth of what the lot is worth, like the 1.5% of copper in a car
  const SPLIT_MIN = 0.6;       // partition difference that counts as a separating step: 80 vs 20 points sends a 50/50 mix out at 80% purity each side
  const PIECE_MM = 30;         // mm: the size shredded pieces reach a sorter at, where every partition curve is on its plateau
  const SINK_MAX = 4.0;        // g/cc: the densest medium a sink-float tank can be tuned to (the slider range in data.js)
  const SEP_ORDER = ['magnet', 'sinkfloat', 'air', 'eddy', 'sensor'];   // cheapest first, the order the fix is suggested in

  function groupOf(m) { return GROUP[m] || m; }
  function signature(nodes) {
    if (CS.Score && CS.Score.signature) return CS.Score.signature(nodes);
    return nodes.map(function (n) { return MACHINES[n.m].short; }).join('>');
  }
  function byId(id) { for (let i = 0; i < PLAYBOOKS.length; i++) if (PLAYBOOKS[i].id === id) return PLAYBOOKS[i]; return null; }
  /* composition of a card's demo feed: a preset id or an inline composition */
  function feedOf(pb) { return typeof pb.feed === 'string' ? (FEEDS[pb.feed] ? FEEDS[pb.feed].comp : {}) : pb.feed; }
  function feedName(pb) { return typeof pb.feed === 'string' ? (FEEDS[pb.feed] ? FEEDS[pb.feed].name : pb.feed) : (pb.feedName || 'custom mix'); }
  /* runnable line with the player's machine levels applied */
  function buildLine(pb, levels) {
    const line = Sim.buildLine(pb.def);
    line.forEach(function (n) { n.level = levels && levels[n.m] ? levels[n.m] : 0; });
    return line;
  }
  function normComp(comp) {
    const c = {}; let tot = 0;
    for (const m in comp) if (MATERIALS[m] && comp[m] > 0) tot += comp[m];
    if (tot > 0) for (const m in comp) if (MATERIALS[m] && comp[m] > 0) c[m] = comp[m] / tot;
    return c;
  }
  /* the materials worth chasing in a lot, richest first: [{ m, frac, valueShare }] */
  function valuable(comp) {
    const c = normComp(comp); let worth = 0;
    for (const m in c) worth += c[m] * MATERIALS[m].sell;
    const out = [];
    for (const m in c) {
      const vs = worth > 0 ? c[m] * MATERIALS[m].sell / worth : 0;
      if (vs >= VALUE_SHARE && c[m] >= MASS_MIN) out.push({ m: m, frac: c[m], valueShare: vs });
    }
    return out.sort(function (a, b) { return b.valueShare - a.valueShare; });
  }

  /* Fit of a line to a feed from an evaluation (ev = Sim.evalLine, mr = Sim.maxRate). For every valuable material: the
   * terminal bin most of it lands in, the purity of its product group there, its recovery into that bin, and its fate.
   * fate: 'clean' (purity >= CLEAN), 'mixed' (below it), 'reject' (the bin is a scalping or dross port). */
  function fit(ev, line, comp, mr) {
    const out = { mats: [], mixed: [], reject: [], clean: [], kwhT: Infinity, valuePerT: 0, R: 0 };
    if (!ev || !ev.terminals) return out;
    const R = mr ? mr.R : 0; out.R = R;
    if (CS.Score && CS.Score.plantKwhT) out.kwhT = CS.Score.plantKwhT(ev, R, line);
    const bins = ev.terminals.map(function (t) {
      const st = Sim.binStats(t.stream.m, t.form), k = line.findIndex(function (n) { return n.uid === t.uid; });
      out.valuePerT += Sim.binMatters(st) ? st.value : 0;
      const M = k >= 0 ? MACHINES[line[k].m] : null;
      return { t: t, st: st, index: k, short: M ? M.short : '?', label: M && M.outs ? M.outs[t.port] : t.port, port: t.port };
    });
    valuable(comp).forEach(function (v) {
      const m = v.m, head = ev.head.m[m] ? Sim.sum(ev.head.m[m]) : 0;
      let best = null, kg = 0;
      bins.forEach(function (b) { const a = b.t.stream.m[m]; const x = a ? Sim.sum(a) : 0; if (x > kg) { kg = x; best = b; } });
      const row = { m: m, frac: v.frac, valueShare: v.valueShare, bin: best, purity: 0, recovery: head > 0 ? kg / head : 0, fate: 'reject', contaminant: null };
      if (best && best.st.total > 0) {
        let grp = 0, cm = null, ckg = 0;
        for (const x in best.t.stream.m) {
          const xm = Sim.sum(best.t.stream.m[x]);
          if (groupOf(x) === groupOf(m)) grp += xm; else if (xm > ckg) { ckg = xm; cm = x; }
        }
        row.purity = grp / best.st.total; row.contaminant = cm;
        row.fate = (best.port === 'rejects' || best.port === 'dross') ? 'reject' : (row.purity >= CLEAN ? 'clean' : 'mixed');
      }
      out.mats.push(row); out[row.fate].push(row);
    });
    return out;
  }

  function rhoOf(D) { return D.state === 'liquid' ? 1 : D.density; }
  /* the medium that floats the lighter of two materials: 7% plus 0.1 g/cc above it clears the partition width (5% of sg
   * plus 0.03) at every density the tank reaches, and never above the tank's 4.0 g/cc limit */
  function idealSg(a, b) { return Math.min(SINK_MAX, Math.round((Math.min(rhoOf(MATERIALS[a]), rhoOf(MATERIALS[b])) * 1.07 + 0.1) * 10) / 10); }
  /* the settings a separator is judged at: the node's own, or the defaults, with a sink-float tank or a sensor sorter tuned
   * to the pair when no settings are given (that is what the fix suggestion asks) */
  function settingsFor(sepId, settings, a, b) {
    if (settings) return settings;
    const s = Object.assign({}, MACHINES[sepId].defaults);
    if (sepId === 'sinkfloat') s.sg = idealSg(a, b);
    if (sepId === 'sensor') s.target = a;
    return s;
  }
  /* Can a separator type, at the given settings (null = tuned to the pair), split material a from material b? The sim's
   * own partition curve (Sim.pExtract) is read for both at the size shredded pieces reach a sorter: a split needs the two
   * extract probabilities SPLIT_MIN apart. Ferrous pieces never go near an eddy current rotor: they stick to it. */
  function canSplit(sepId, settings, a, b) {
    const M = MACHINES[sepId], A = MATERIALS[a], B = MATERIALS[b];
    if (!M || M.kind !== 'separator' || !A || !B || a === b) return false;
    if (sepId === 'eddy' && (A.magnetic || B.magnetic)) return false;
    const s = settingsFor(sepId, settings, a, b);
    return Math.abs(Sim.pExtract(M, s, A, PIECE_MM) - Sim.pExtract(M, s, B, PIECE_MM)) >= SPLIT_MIN;
  }
  /* the plain-words fix for a pair the line cannot split, with the separator that would do it */
  function fixFor(m, c) {
    const Dm = MATERIALS[m], Dc = MATERIALS[c], nm = Dm.name.toLowerCase(), nc = Dc.name.toLowerCase();
    for (let i = 0; i < SEP_ORDER.length; i++) {
      const sep = SEP_ORDER[i];
      if (!canSplit(sep, null, m, c)) continue;
      const s = settingsFor(sep, null, m, c), M = MACHINES[sep];
      const mGoes = Sim.pExtract(M, s, Dm, PIECE_MM) > Sim.pExtract(M, s, Dc, PIECE_MM);   // which of the two leaves through the extract port
      switch (sep) {
        case 'magnet': return { sep: sep, text: 'A magnetic drum pulls the ' + (mGoes ? nm : nc) + ' out.' };
        case 'sinkfloat': return { sep: sep, text: 'A sink-float tank at ' + s.sg.toFixed(1) + ' g/cc floats the ' + (mGoes ? nm : nc) + ' off the ' + (mGoes ? nc : nm) + '.' };
        case 'air': return { sep: sep, text: 'An air classifier lifts the ' + (mGoes ? nm : nc) + ' out.' };
        case 'eddy': return { sep: sep, text: 'An eddy current separator flings the ' + (mGoes ? nm : nc) + ' off.' };
        case 'sensor': return { sep: sep, text: 'A sensor sorter set to ' + nm + ' picks it out by chemistry.' };
      }
    }
    return { sep: null, text: 'No sorter in the catalogue splits these two: smelting is the only route.' };
  }
  /* The one mismatch worth saying, or null: the richest valuable material that ends in a mixed bin while no separator on
   * the line is able to split it from the material it is mixed with. */
  function mismatch(fitRes, line) {
    if (!fitRes || !fitRes.mats.length) return null;
    const seps = (line || []).filter(function (n) { return MACHINES[n.m] && MACHINES[n.m].kind === 'separator'; });
    for (let i = 0; i < fitRes.mats.length; i++) {
      const r = fitRes.mats[i];
      if (r.fate !== 'mixed' || !r.contaminant) continue;
      if (r.frac < WARN_MASS && r.valueShare < WARN_VALUE) continue;
      const able = seps.some(function (n) { return canSplit(n.m, n.settings, r.m, r.contaminant); });
      if (able) continue;
      const fix = fixFor(r.m, r.contaminant);
      const text = 'This lot is ' + Math.round(r.frac * 100) + ' percent ' + MATERIALS[r.m].name.toLowerCase() + ' and your line has ' + (seps.length ? 'no way to separate it from the ' + MATERIALS[r.contaminant].name.toLowerCase() : 'no separator at all, so it stays mixed with the ' + MATERIALS[r.contaminant].name.toLowerCase()) + '. ' + fix.text;
      return { m: r.m, c: r.contaminant, frac: r.frac, purity: r.purity, sep: fix.sep, text: text };
    }
    return null;
  }

  /* Margin per head-tonne of a line on a feed, feed cost left out (it is the same for every line on the same lot): the
   * arithmetic of lineMarginNoFeed in app.js. Returns -Infinity when the line cannot run. */
  function lineMargin(line, comp) {
    const ev = Sim.evalLine(line, comp), mr = Sim.maxRate(ev.nodes, line), R = mr.R;
    const FX = CS.LEVEL_FX || { power: 0.1 };
    if (!(R > 0)) return { margin: -Infinity, R: 0, kwhT: Infinity, rev: 0, ev: ev, mr: mr };
    let P = 0, extra = 0, wearC = 0, rev = 0;
    ev.nodes.forEach(function (n, i) { P += Math.min(n.M.prated * (1 + FX.power * Sim.levelOf(line[i])), n.M.pidle + R * n.ePerHead); extra += n.extraCostPerHeadT; wearC += n.wearPerHeadT * n.M.service; });
    ev.terminals.forEach(function (t) { const st = Sim.binStats(t.stream.m, t.form); if (Sim.binMatters(st)) rev += st.value; });
    return { margin: rev - P / R * Sim.prices.power - extra - wearC, R: R, kwhT: P / R, rev: rev, ev: ev, mr: mr };
  }
  /* Every playbook on a feed, best projected margin first. A card is relevant when its bucket is one of the lot's valuable
   * materials; relevant cards come first, then the rest, then lines that cannot run on the feed. owned: Set of machine ids. */
  function rank(comp, owned, levels) {
    const val = {}; valuable(comp).forEach(function (v) { val[v.m] = true; });
    const rows = PLAYBOOKS.map(function (pb) {
      const line = buildLine(pb, levels), e = lineMargin(line, comp);
      const missing = {}; line.forEach(function (n) { if (!owned || !owned.has(n.m)) missing[n.m] = MACHINES[n.m].price; });
      let cost = 0; for (const m in missing) cost += missing[m];
      const f = fit(e.ev, line, comp, e.mr);
      const relevant = pb.targets.some(function (m) { return val[m]; });
      return { pb: pb, line: line, margin: e.margin, R: e.R, kwhT: e.kwhT, rev: e.rev, cost: cost, missing: Object.keys(missing), runs: e.R > 0, relevant: relevant, fit: f };
    });
    return rows.sort(function (a, b) { return (b.runs - a.runs) || (b.relevant - a.relevant) || (b.margin - a.margin); });
  }

  CS.Playbooks = { PLAYBOOKS: PLAYBOOKS, GROUP: GROUP, CLEAN: CLEAN, VALUE_SHARE: VALUE_SHARE, byId: byId, feedOf: feedOf, feedName: feedName, buildLine: buildLine, signature: signature, valuable: valuable, fit: fit, canSplit: canSplit, fixFor: fixFor, mismatch: mismatch, lineMargin: lineMargin, rank: rank };

  /* ---------------- page: panel, cards, fit readout, hooks ---------------- */
  if (typeof document === 'undefined') return;

  function install(app) {
    const state = { open: null };
    let els = null, lastEv = null, rankKey = '', lastWarn = '', loaded = false;
    const S = function () { return app.S; };

    const readExt = function (ext) { const d = ext && ext.playbooks; state.open = d && byId(d.open) ? d.open : null; loaded = true; };
    app.on('load', readExt);
    app.on('save', function () { return { playbooks: { open: state.open } }; });

    app.on('boot', function () {
      if (!loaded && app.S && app.S.ext) readExt(app.S.ext);
      buildPanel(); mountHelpLink(); render();
    });
    app.on('render', render);
    // settings sliders recompute without a full render: follow S.ev so the fit readout stays current
    app.on('tick', function () { if (els && app.S && app.S.ev && app.S.ev !== lastEv) { renderFit(); renderRank(); } });

    function buildPanel() {
      if (els) return;
      const sec = app.addPanel('left', 'playbook-panel', 'Playbooks', 'bank-panel');
      sec.querySelector('h2').appendChild(app.el('span', 'tag', PLAYBOOKS.length + ' CARDS'));
      sec.insertAdjacentHTML('beforeend',
        '<h3>Lot-to-plant fit</h3>' +
        '<div class="readouts two" id="pb-fit-ro"></div>' +
        '<div class="fit" id="pb-fit"></div>' +
        '<div id="pb-warn"></div>' +
        '<h3>Best setups for this lot</h3><div id="pb-rank"></div>' +
        '<h3>Cards</h3><div class="small">One card per bucket type. Click a card to open it.</div><div id="pb-cards"></div>');
      const css = document.createElement('style');
      css.textContent = '#playbook-panel .fit .r{display:grid;grid-template-columns:1fr 38px 74px 42px 42px;gap:6px;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dotted var(--line);align-items:center}' +
        '#playbook-panel .fit .r.h{color:var(--muted);font-size: 11px;letter-spacing:1px}#playbook-panel .fit .r span:nth-child(n+2){text-align:right}#playbook-panel .fit .r .bn{text-align:left;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '#playbook-panel .fit .r.clean span:first-child{color:var(--green)}#playbook-panel .fit .r.mixed span:first-child{color:var(--amber)}#playbook-panel .fit .r.reject span:first-child{color:var(--red)}' +
        '#playbook-panel #pb-warn .w{margin-top:6px}#playbook-panel .urow.open{border-color:var(--cyan)}#playbook-panel .urow .ic{color:var(--muted);font-family:var(--mono)}' +
        '#playbook-panel .pb-card{margin:2px 0 8px;padding:8px 10px;border:1px dashed var(--line-2);border-radius:3px;font-size:12px;line-height:1.4}' +
        '#playbook-panel .pb-card h4{font-family:var(--mono);font-size: 11px;letter-spacing:2px;color:var(--muted);margin:8px 0 3px;font-weight:400}#playbook-panel .pb-card h4:first-child{margin-top:0}' +
        '#playbook-panel .pb-card ol,#playbook-panel .pb-card ul{margin:0;padding-left:18px}#playbook-panel .pb-card li{margin:2px 0}#playbook-panel .pb-card .sig{font-family:var(--mono);color:var(--cyan)}' +
        '#playbook-panel .pb-card .exp{font-family:var(--mono);font-size:11px;color:var(--text)}#playbook-panel .pb-card .load{width:100%;margin-top:8px}';
      sec.appendChild(css);
      els = { sec: sec, ro: sec.querySelector('#pb-fit-ro'), fit: sec.querySelector('#pb-fit'), warn: sec.querySelector('#pb-warn'), rank: sec.querySelector('#pb-rank'), cards: sec.querySelector('#pb-cards') };
    }

    /* a line from the help dialog to the panel */
    function mountHelpLink() {
      const box = document.querySelector('#help .modal-box'); if (!box || box.querySelector('#pb-help-link')) return;
      const p = app.el('p', 'small', 'Stuck on a lot? The <a href="#playbook-panel" id="pb-help-link">Playbooks</a> (in the Plant drawer) hold a card for every bucket type (steel, aluminum, copper and brass, wood, plastic, rubber, glass, aggregate, gel): the machine sequence, the settings, the traps and a LOAD THIS SETUP button, plus a fit readout of the lot in the feed against your line.');
      const heads = box.querySelectorAll('h3'); let before = null;
      heads.forEach(function (h) { if (!before && /sources/i.test(h.textContent)) before = h; });
      if (before) box.insertBefore(p, before); else box.appendChild(p);
      p.querySelector('a').addEventListener('click', function (e) {
        e.preventDefault();
        const help = document.getElementById('help'); if (help) help.classList.add('hidden');
        if (!els) return;
        if (app.layout && app.layout.showDrawer) app.layout.showDrawer('flowsheet');   // the calm layout keeps the playbooks in a drawer
        if (!state.open) { state.open = PLAYBOOKS[0].id; renderCards(); }
        els.sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        els.sec.classList.add('cs-hl'); setTimeout(function () { els.sec.classList.remove('cs-hl'); }, 2000);
      });
    }

    /* build the card's line the way applyLinePreset does: veto first, fresh nodes, wear carried over per machine type,
     * the purchase cost of anything unowned to the log, then S.line, S.sel, S.linePreset = 'custom' and a full render */
    function loadSetup(pb) {
      const st = S(); if (!st) return;
      if (st.run) { app.log('Finish or stop the running batch before loading a playbook.', 'warn'); return; }
      const why = app.veto('applyLine', { id: 'playbook:' + pb.id, name: pb.name + ' playbook', nodes: pb.def.nodes });
      if (why) { app.log(why, 'bad'); return; }
      const nodes = Sim.buildLine(pb.def);
      const wearBy = {}; st.line.forEach(function (n) { wearBy[n.m] = Math.max(wearBy[n.m] || 0, n.wear || 0); });
      nodes.forEach(function (n) { n.wear = wearBy[n.m] || 0; });
      const miss = {}; nodes.forEach(function (n) { if (!st.owned.has(n.m)) miss[n.m] = MACHINES[n.m].price; });
      let cost = 0; const names = []; for (const m in miss) { cost += miss[m]; names.push(MACHINES[m].name); }
      st.line = nodes; st.sel = nodes[0].uid; st.linePreset = 'custom';
      if (cost > 0) app.log('Playbook loaded: ' + pb.name + ' (' + signature(nodes) + '). It uses ' + app.fmtMoney(cost) + ' of machines you do not own yet (' + names.join(', ') + '). Buy them from the node panel to run it.', 'warn');
      else app.log('Playbook loaded: ' + pb.name + ' (' + signature(nodes) + ').', 'ok');
      if (st.feedPreset !== pb.feed) app.log('The card was written for ' + feedName(pb) + '; the feed is still ' + (FEEDS[st.feedPreset] ? FEEDS[st.feedPreset].name : 'your custom mix') + '. The fit readout shows how it does on it.');
      app.markDirty(true);
    }

    function render() { if (!els || !S()) return; renderFit(); renderRank(); renderCards(); }

    function renderFit() {
      const st = S(); if (!els || !st) return;
      lastEv = st.ev;
      const esc = app.esc, el = app.el;
      if (!st.ev || !st.line.length) {
        els.ro.innerHTML = ''; els.fit.innerHTML = ''; els.warn.innerHTML = '';
        els.fit.appendChild(el('div', 'small', 'Build a line (or load a card) to see how it fits the lot in the feed.'));
        return;
      }
      const f = fit(st.ev, st.line, st.comp, st.mr);
      const m = app.marginPerT ? app.marginPerT() : null;
      els.ro.innerHTML = app.ro('CLEAN BUCKETS', f.clean.length + '/' + f.mats.length, '', f.mats.length && f.clean.length === f.mats.length ? 'good' : (f.clean.length ? '' : 'bad')) +
        app.ro('PLANT ENERGY', isFinite(f.kwhT) ? app.fmtNum(f.kwhT, 1) : '--', 'kWh/t', f.kwhT > 40 ? 'hi' : '') +
        app.ro('PRODUCT VALUE', app.fmtMoney(f.valuePerT), '/t', 'good') +
        (m ? app.ro('MARGIN', app.fmtMoney(m.margin), '/t', m.margin < 0 ? 'bad' : 'good') : '');
      let h = '<div class="r h"><span>MATERIAL</span><span>FEED</span><span class="bn">BIN</span><span>PURE</span><span>REC</span></div>';
      f.mats.forEach(function (r) {
        const bin = r.bin ? (r.bin.index + 1) + ':' + r.bin.short + '/' + r.bin.port.slice(0, 4).toUpperCase() : '--';
        h += '<div class="r ' + r.fate + '" title="' + esc(MATERIALS[r.m].name + ': ' + r.fate + (r.contaminant ? ', mixed with ' + MATERIALS[r.contaminant].name.toLowerCase() : '')) + '"><span>' + esc(MATERIALS[r.m].name) + '</span><span>' + Math.round(r.frac * 100) + '%</span><span class="bn">' + esc(bin) + '</span><span>' + Math.round(r.purity * 100) + '%</span><span>' + Math.round(r.recovery * 100) + '%</span></div>';
      });
      if (!f.mats.length) h += '<div class="small">Nothing in this lot is worth a bucket of its own.</div>';
      const names = function (rows) { return rows.map(function (r) { return MATERIALS[r.m].name.toLowerCase() + ' (' + Math.round(r.purity * 100) + '% in ' + (r.bin ? r.bin.short + '/' + r.bin.port : '?') + ')'; }).join(', '); };
      if (f.mixed.length) h += '<div class="small">Ends in a mixed bin: ' + esc(names(f.mixed)) + '.</div>';
      if (f.reject.length) h += '<div class="small">Ends in a reject or dross bin: ' + esc(names(f.reject)) + '.</div>';
      els.fit.innerHTML = h;
      const mm = mismatch(f, st.line);
      els.warn.innerHTML = mm ? '<div class="w warn">' + esc(mm.text) + '</div>' : '';
      // logged once per material pair, so nudging a feed slider does not repeat it with every new percentage
      const key = mm ? mm.m + '>' + mm.c + '>' + mm.sep : '';
      if (key && key !== lastWarn) app.log(mm.text, 'warn');
      lastWarn = key;
    }

    function renderRank() {
      const st = S(); if (!els || !st) return;
      const esc = app.esc, el = app.el;
      const key = JSON.stringify([st.comp, Array.from(st.owned).sort(), st.levels, Sim.prices.power, Sim.prices.market, Sim.prices.ln2]);
      if (key === rankKey && els.rank.children.length) return;
      rankKey = key;
      els.rank.innerHTML = '';
      const rows = rank(st.comp, st.owned, st.levels);
      const cur = st.line.length ? lineMargin(st.line, st.comp) : null;
      if (cur) els.rank.appendChild(el('div', 'small', 'Your line now: ' + (isFinite(cur.margin) ? '<b class="num">' + esc(app.fmtMoney(cur.margin)) + '/t</b> before feed' : 'cannot run on this feed') + '. Playbooks below are ranked by the same projected margin on this lot.'));
      rows.forEach(function (r, i) {
        const pb = r.pb, top = i === 0 && r.runs;
        const better = cur && isFinite(cur.margin) && isFinite(r.margin) ? r.margin - cur.margin : null;
        const cost = r.cost > 0 ? 'needs ' + app.fmtMoney(r.cost) + ' of machines' + (better != null && better > 0.5 ? ', pays back in ' + app.fmtNum(Math.ceil(r.cost / better), 0) + ' t' : '') : 'all machines owned';
        const row = el('div', 'urow' + (top ? ' fit' : ''),
          '<span class="ic' + (top ? ' ok' : '') + '">' + (i + 1) + '</span><span><div class="nm">' + esc(pb.name) + ' ' + (r.runs ? '<b class="' + (r.margin < 0 ? 'bad' : 'ok') + '">' + esc(app.fmtMoney(r.margin)) + '/t</b>' : '<b class="bad">cannot run</b>') + (r.relevant ? '' : ' <span class="tag">NOT IN THIS LOT</span>') + '</div>' +
          '<div class="cur">' + esc(signature(r.line)) + ' · ' + (r.runs ? app.fmtNum(r.kwhT, 1) + ' kWh/t · ' : '') + esc(cost) + '</div></span>');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'CARD'; b.title = 'Open the card';
        b.addEventListener('click', function () { state.open = pb.id; renderCards(); const c = els.cards.querySelector('.pb-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
        row.appendChild(b); els.rank.appendChild(row);
      });
    }

    function renderCards() {
      const st = S(); if (!els || !st) return;
      const esc = app.esc, el = app.el;
      els.cards.innerHTML = '';
      PLAYBOOKS.forEach(function (pb) {
        const open = state.open === pb.id, line = buildLine(pb, st.levels);
        const miss = {}; line.forEach(function (n) { if (!st.owned.has(n.m)) miss[n.m] = MACHINES[n.m].price; });
        let cost = 0; for (const m in miss) cost += miss[m];
        const row = el('div', 'urow' + (open ? ' open' : ''),
          '<span class="ic">' + (open ? '▾' : '▸') + '</span><span><div class="nm">' + esc(pb.name) + ' <span class="tag">' + esc(pb.short) + '</span></div>' +
          '<div class="cur">' + esc(signature(line)) + (cost > 0 ? ' · needs ' + esc(app.fmtMoney(cost)) : ' · owned') + '</div></span>');
        row.style.cursor = 'pointer';
        row.addEventListener('click', function () { state.open = open ? null : pb.id; renderCards(); if (app.save) app.save(); });
        els.cards.appendChild(row);
        if (!open) return;
        const e = lineMargin(line, st.comp);
        const exp = pb.expect.map(function (x) {
          const size = x.p80 ? (x.p80[0] > 0 ? fmtMm(x.p80[0]) + ' to ' + fmtMm(x.p80[1]) : 'under ' + fmtMm(x.p80[1])) : 'any size';
          return '<div class="exp">' + esc(x.label.toUpperCase()) + ' from ' + x.node + ':' + esc(MACHINES[pb.def.nodes[x.node - 1].m].short) + '/' + esc(x.port.toUpperCase()) + ' · purity ≥ ' + Math.round(x.purity * 100) + '% · recovery ≥ ' + Math.round(x.recovery * 100) + '% · P80 ' + esc(size) + '</div>';
        }).join('');
        const card = el('div', 'pb-card',
          '<div>' + esc(pb.blurb) + '</div>' +
          '<h4>SEQUENCE</h4><ol>' + pb.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
          '<h4>KEY SETTINGS</h4><ul>' + pb.settings.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
          '<h4>TRAPS</h4><ul>' + pb.traps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
          '<h4>EXPECT ON ' + esc(feedName(pb).toUpperCase()) + '</h4>' + exp +
          '<h4>SIGNATURE</h4><div class="sig">' + esc(signature(line)) + '</div>' +
          '<h4>ON THE LOT IN THE FEED</h4><div class="exp">' + (e.R > 0 ? 'margin ' + esc(app.fmtMoney(e.margin)) + '/t before feed · ' + app.fmtNum(e.kwhT, 1) + ' kWh/t · ' + app.fmtNum(e.R, 1) + ' t/h' : 'this line cannot run on the current feed') + '</div>');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'load ' + (cost > 0 ? 'buy' + (st.money < cost ? ' poor' : '') : 'primary');
        b.textContent = 'LOAD THIS SETUP' + (cost > 0 ? ' · ' + app.fmtMoney(cost) + ' TO BUY' : '');
        b.title = cost > 0 ? 'Loads the line; the machines you do not own are bought one by one from the node panel' : 'Loads the line into the flowsheet';
        b.addEventListener('click', function () { loadSetup(pb); });
        card.appendChild(b); els.cards.appendChild(card);
      });
    }
    function fmtMm(mm) { return CS.Score && CS.Score.fmtMm ? CS.Score.fmtMm(mm) : mm + ' mm'; }
  }

  if (CS.app) install(CS.app);
  else document.addEventListener('DOMContentLoaded', function () { if (CS.app) install(CS.app); });
})(typeof window !== 'undefined' ? window : globalThis);
