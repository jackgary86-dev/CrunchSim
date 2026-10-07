/* CrunchSim data: materials, machines, separators, presets.
 * Rock values (granite, limestone, glass) are published Bond work indices.
 * Metal, wood, polymer and gel values are game-calibrated "toughness" indices so that
 * the specific energies land in realistic ranges. Prices are rough indicative scrap prices.
 */
(function (G) {
  'use strict';

  // Mechanisms a machine can apply to a particle.
  const MECH = ['comp', 'impact', 'shear', 'attr', 'cut', 'hyd'];
  const MECH_LABEL = {
    comp: 'Compression', impact: 'Impact', shear: 'Shear / tearing',
    attr: 'Attrition', cut: 'Cutting', hyd: 'Hydraulic shear'
  };
  const R = (comp, impact, shear, attr, cut, hyd) => ({ comp, impact, shear, attr, cut, hyd });

  /* ---------------- MATERIALS ----------------
   * resp[T]: how well each mechanism breaks the material, 0..1.
   *   T = 0 ambient, 1 freezer (-30C), 2 cryogenic (-196C). Missing entries fall back downwards.
   * sigma: electrical conductivity MS/m (drives eddy current separation, sigma/density).
   * coolKJ: kJ/kg to chill to cryogenic working temperature. chillKJ: kJ/kg to reach -30C.
   */
  const MATERIALS = {
    aluminum: {
      name: 'Aluminum', color: '#cfd9e2', density: 2.70, Wi: 35, ductility: 0.9, magnetic: false, sigma: 37.7,
      abrasion: 0.12, hard: 0, state: 'solid', kind: 'plate', thick: 6,
      feed: { p80: 260, n: 1.8, top: 520, form: 'extrusions and sheet scrap' },
      sell: 1300, buy: 850, range: [10, 150], coolKJ: 108, chillKJ: 45, tags: ['ductile', 'non-magnetic', 'conductor'],
      resp: [R(0.16, 0.30, 0.95, 0.12, 0.85, 0)],
      note: 'Ductile (face-centred cubic). It bends and balls up instead of cracking, so squeezing barely works. Shear and cutting do. It stays ductile even in liquid nitrogen. Non-magnetic but an excellent conductor for its weight, so eddy-current separators fling it hard.'
    },
    copper: {
      name: 'Copper', color: '#d98a5b', density: 8.96, Wi: 45, ductility: 0.95, magnetic: false, sigma: 59.6,
      abrasion: 0.10, hard: 0, state: 'solid', kind: 'plate', thick: 0,
      feed: { p80: 180, n: 1.8, top: 400, form: 'tube, bus bar and cable' },
      sell: 8200, buy: 6000, range: [5, 100], coolKJ: 46, chillKJ: 19, tags: ['ductile', 'non-magnetic', 'conductor', 'dense'],
      resp: [R(0.14, 0.28, 0.90, 0.10, 0.75, 0)],
      note: 'Very ductile and very dense. It smears under impact and tears under shear. The best conductor, but its high density lowers the conductivity-to-weight ratio, so it is harder to eject than aluminum. It sinks in heavy media.'
    },
    brass: {
      name: 'Brass', color: '#d9b94e', density: 8.50, Wi: 40, ductility: 0.8, magnetic: false, sigma: 15.0,
      abrasion: 0.12, hard: 0.1, state: 'solid', kind: 'plate', thick: 0,
      feed: { p80: 120, n: 1.8, top: 300, form: 'plumbing fittings and valves' },
      sell: 5200, buy: 3800, range: [5, 100], coolKJ: 46, chillKJ: 19, tags: ['ductile', 'non-magnetic', 'dense'],
      resp: [R(0.24, 0.45, 0.85, 0.18, 0.70, 0)],
      note: 'Copper-zinc alloy. Tougher and less conductive than copper, so eddy-current separators recover it poorly. Dense, so it ends up in the heavy fraction of a sink-float tank.'
    },
    steel: {
      name: 'Steel', color: '#8d98a6', density: 7.85, Wi: 70, ductility: 0.75, magnetic: true, sigma: 7.0,
      abrasion: 0.35, hard: 0.6, state: 'solid', kind: 'plate', thick: 0,
      feed: { p80: 450, n: 1.6, top: 900, form: 'appliances, bales and structural offcuts' },
      sell: 290, buy: 200, range: [10, 250], coolKJ: 59, chillKJ: 25, tags: ['tough', 'magnetic', 'dense'],
      resp: [R(0.20, 0.30, 0.95, 0.10, 0.60, 0), null, R(0.70, 0.90, 0.60, 0.50, 0.20, 0)],
      note: 'Tough and ductile at room temperature, which is why car shredders need megawatts. Below roughly -100 C mild steel goes through its ductile-to-brittle transition and shatters like glass. Strongly magnetic, so a magnetic drum pulls it out easily.'
    },
    castiron: {
      name: 'Cast iron', color: '#5d636b', density: 7.20, Wi: 18, ductility: 0.1, magnetic: true, sigma: 2.0,
      abrasion: 0.45, hard: 0.8, state: 'solid', kind: 'angular', thick: 0,
      feed: { p80: 280, n: 1.8, top: 600, form: 'engine blocks and manifolds' },
      sell: 260, buy: 170, range: [10, 250], coolKJ: 54, chillKJ: 24, tags: ['brittle', 'magnetic', 'dense'],
      resp: [R(0.90, 1.00, 0.45, 0.65, 0.20, 0)],
      note: 'Graphite flakes in the iron act as built-in cracks. It shatters under impact instead of bending, which is why hammermills handle it so well. Magnetic and abrasive.'
    },
    potmetal: {
      name: 'Pot metal', color: '#9fa8a3', density: 6.60, Wi: 10, ductility: 0.2, magnetic: false, sigma: 16.9,
      abrasion: 0.15, hard: 0.1, state: 'solid', kind: 'angular', thick: 0,
      feed: { p80: 90, n: 1.8, top: 200, form: 'zinc die-cast handles and trim' },
      sell: 1500, buy: 900, range: [5, 80], coolKJ: 47, chillKJ: 20, tags: ['brittle', 'non-magnetic', 'low-melting'],
      resp: [R(0.75, 0.90, 0.55, 0.55, 0.35, 0), null, R(0.92, 1.00, 0.50, 0.65, 0.25, 0)],
      note: 'Zinc die-cast alloy (zamak). Weak, brittle and low-melting. It shatters in a hammermill, ends up in the non-ferrous "zorba" stream, and has to be split from aluminum by density because it sinks while aluminum floats.'
    },
    // Precious metals (#53). Prices: gold about $2,650 per troy ounce = $85,000/kg; silver about $31/oz = $1,000/kg. A loose
    // bucket of sorted gold or silver pieces sells to a refiner at about 90% of the metal price (sell); a refined bar (SMELT
    // ingot) at the full price. They arrive in electronics as plating, pins, bonding wire, contacts and solder paste: grams
    // per tonne, so a sensor sorter has to concentrate them pass by pass (each pass also ejects 2.5% of everything else).
    silver: {
      name: 'Silver', color: '#e4e8ee', density: 10.49, Wi: 38, ductility: 0.95, magnetic: false, sigma: 63.0,
      abrasion: 0.06, hard: 0, state: 'solid', kind: 'plate', thick: 0,
      feed: { p80: 15, n: 1.6, top: 45, form: 'contacts, plated pins and solder paste' },
      sell: 900000, buy: 700000, range: [0.1, 60], coolKJ: 28, chillKJ: 12, tags: ['ductile', 'non-magnetic', 'conductor', 'dense', 'precious'],
      resp: [R(0.14, 0.26, 0.90, 0.12, 0.78, 0)],
      note: 'The best electrical conductor of all, soft and very ductile. In scrap it is a thin layer on contacts and a powder in solder paste: grams per tonne of circuit board. It never cracks, it smears and tears like copper, and it sinks with the heavy metals. A sensor sorter set to silver finds the pieces that carry it.'
    },
    gold: {
      name: 'Gold', color: '#f2c94c', density: 19.32, Wi: 36, ductility: 1.0, magnetic: false, sigma: 45.2,
      abrasion: 0.04, hard: 0, state: 'solid', kind: 'plate', thick: 0,
      feed: { p80: 12, n: 1.6, top: 40, form: 'plated edge fingers, pins and bonding wire' },
      sell: 76000000, buy: 60000000, range: [0.1, 60], coolKJ: 15, chillKJ: 6, tags: ['ductile', 'non-magnetic', 'conductor', 'dense', 'precious'],
      resp: [R(0.12, 0.24, 0.92, 0.12, 0.80, 0)],
      note: 'The most ductile metal there is: a gram draws into kilometres of wire. On circuit boards it is a micron-thin plating on edge fingers and pins and the hair-fine bonding wire inside chips, about a quarter of a kilo per tonne of good boards. Dense (19.3) and conductive but never magnetic. Only a sensor sorter can find it, pass after pass, and a refiner pays for every gram.'
    },
    wood: {
      name: 'Wood', color: '#b98a54', density: 0.50, Wi: 16, ductility: 0.5, magnetic: false, sigma: 0,
      abrasion: 0.05, hard: 0, state: 'solid', kind: 'wood', thick: 12,
      feed: { p80: 600, n: 1.5, top: 1200, form: 'pallets, logs and demolition timber' },
      sell: 28, buy: -22, range: [5, 60], coolKJ: 204, chillKJ: 100, tags: ['fibrous', 'light', 'tramp-metal risk'],
      resp: [R(0.35, 0.60, 0.75, 0.25, 1.00, 0), R(0.45, 0.70, 0.70, 0.30, 0.90, 0), R(0.50, 0.80, 0.60, 0.35, 0.80, 0)],
      note: 'Fibrous and anisotropic. Compression just crushes the fibres, so wood is cut (chipper, knives) or beaten into splinters (hammer grinders). Any nail or tramp metal damages knives, so it is magnet-sorted early.'
    },
    gel: {
      name: 'Hydrogel', color: '#52d6c4', density: 1.02, Wi: 8, ductility: 0.5, magnetic: false, sigma: 0,
      abrasion: 0.0, hard: 0, state: 'solid', kind: 'blob', thick: 15,
      feed: { p80: 150, n: 2.0, top: 300, form: 'gel blocks' },
      sell: 150, buy: 60, range: [0.0001, 0.05], coolKJ: 600, chillKJ: 440, tags: ['soft solid', 'viscoelastic'],
      resp: [R(0.02, 0.08, 0.45, 0.30, 0.55, 1.0), R(0.60, 0.80, 0.50, 0.50, 0.30, 0.50), R(0.65, 0.85, 0.50, 0.55, 0.30, 0.50)],
      note: 'A soft viscoelastic network full of water. Pressure squeezes it and impact bounces off. It does not fracture, so you cut it, shear it between a rotor and stator, or force it through a tiny valve. Frozen, the water in it turns it brittle.'
    },
    water: {
      name: 'Water', color: '#4aa8ff', density: 1.00, Wi: 3, ductility: 0, magnetic: false, sigma: 0,
      abrasion: 0.0, hard: 0, state: 'liquid', kind: 'drop', thick: 0,
      feed: { p80: 800, n: 1.5, top: 1000, form: 'bulk liquid', blockP80: 120 },
      sell: 0, buy: 0, range: [0.01, 0.2], coolKJ: 628, chillKJ: 481, tags: ['liquid', 'incompressible'],
      resp: [R(0, 0, 0, 0, 0, 1.0), R(0.75, 0.90, 0.50, 0.60, 0.35, 0), R(0.75, 0.90, 0.50, 0.60, 0.35, 0)],
      note: 'A liquid cannot be crushed. Squeeze it and it just flows away. To reduce it you either atomize it into mist with a high-pressure nozzle, or freeze it first (about 334 kJ/kg of latent heat) and crush the ice, which is brittle.'
    },
    glass: {
      name: 'Glass', color: '#9ad9c9', density: 2.50, Wi: 3.5, ductility: 0.0, magnetic: false, sigma: 0,
      abrasion: 0.60, hard: 0.9, state: 'solid', kind: 'angular', thick: 6,
      feed: { p80: 70, n: 2.0, top: 150, form: 'bottles and windscreen' },
      sell: 45, buy: -15, range: [2, 50], coolKJ: 100, chillKJ: 42, tags: ['brittle', 'abrasive'],
      resp: [R(1.0, 1.0, 0.35, 0.80, 0.10, 0)],
      note: 'The textbook brittle solid, with a published Bond work index of about 3 kWh/t. It breaks with almost no energy but is brutally abrasive on liners and knives.'
    },
    granite: {
      name: 'Granite', color: '#c98f8a', density: 2.70, Wi: 15, ductility: 0.0, magnetic: false, sigma: 0,
      abrasion: 0.75, hard: 1.0, state: 'solid', kind: 'angular', thick: 0,
      feed: { p80: 300, n: 1.5, top: 560, form: 'quarry run-of-mine' },
      sell: 22, buy: 6, range: [0.1, 63], coolKJ: 95, chillKJ: 40, tags: ['brittle', 'hard', 'abrasive'],
      resp: [R(1.0, 0.95, 0.30, 0.80, 0.05, 0)],
      note: 'Hard, strong, abrasive rock with a Bond work index around 15 kWh/t. The textbook feed for jaw and cone crushers: compressive strength is high but it fails in a brittle way.'
    },
    limestone: {
      name: 'Limestone', color: '#e3dcc6', density: 2.65, Wi: 12, ductility: 0.0, magnetic: false, sigma: 0,
      abrasion: 0.35, hard: 0.5, state: 'solid', kind: 'angular', thick: 0,
      feed: { p80: 250, n: 1.5, top: 500, form: 'quarried stone and concrete rubble' },
      sell: 16, buy: 4, range: [0.1, 63], coolKJ: 100, chillKJ: 42, tags: ['brittle', 'friable'],
      resp: [R(1.0, 1.0, 0.35, 0.85, 0.10, 0)],
      note: 'Softer and more friable than granite, with a Bond work index of about 12 kWh/t. Used as a stand-in for concrete rubble.'
    },
    rubber: {
      name: 'Rubber', color: '#3c3f46', density: 1.10, Wi: 28, ductility: 0.9, magnetic: false, sigma: 0,
      abrasion: 0.06, hard: 0, state: 'solid', kind: 'rubber', thick: 12,
      feed: { p80: 650, n: 2.5, top: 800, form: 'whole tires' },
      sell: 320, buy: -60, range: [0.2, 6], coolKJ: 228, chillKJ: 95, tags: ['elastic', 'tough'],
      resp: [R(0.08, 0.12, 0.70, 0.08, 0.85, 0), R(0.10, 0.15, 0.70, 0.10, 0.85, 0), R(0.75, 0.95, 0.60, 0.50, 0.40, 0)],
      note: 'An elastomer: it absorbs impact and springs back. Above its glass transition (about -70 C) it can only be torn or cut. Below it, rubber is glassy and shatters, which is how cryogenic plants make fine crumb.'
    },
    plastic: {
      name: 'Plastic', color: '#e8695a', density: 0.95, Wi: 18, ductility: 0.8, magnetic: false, sigma: 0,
      abrasion: 0.03, hard: 0, state: 'solid', kind: 'plastic', thick: 3,
      feed: { p80: 200, n: 1.8, top: 500, form: 'bumpers, bins and packaging' },
      sell: 400, buy: -20, range: [2, 15], coolKJ: 276, chillKJ: 115, tags: ['ductile', 'light', 'melts'],
      resp: [R(0.12, 0.25, 0.85, 0.15, 1.00, 0), R(0.15, 0.30, 0.85, 0.15, 1.00, 0), R(0.70, 0.90, 0.60, 0.50, 0.40, 0)],
      note: 'Polyolefins like HDPE are tough and low-density. Cutting into flake is the standard route. Cryogenic embrittlement works for fine powder. Floats in water and lifts easily in an air stream.'
    }
  };
  Object.keys(MATERIALS).forEach(function (id) { MATERIALS[id].id = id; });
  const MAT_ORDER = ['steel', 'castiron', 'aluminum', 'copper', 'brass', 'potmetal', 'silver', 'gold', 'wood', 'rubber', 'plastic', 'glass', 'granite', 'limestone', 'gel', 'water'];

  /* ---------------- SMELTING DATA ----------------
   * melt: melting point (C). meltKWh: theoretical energy to heat 1 t from 25 C and melt it (sensible + latent heat,
   * handbook cp and heat of fusion). cpL: liquid specific heat kJ/kg K, for superheat above the melting point.
   * drossK: fraction of chunky scrap lost to oxide at modest superheat. ingot: $/t for a clean cast ingot or billet.
   */
  const SMELT = {
    aluminum: { melt: 660, meltKWh: 269, cpL: 1.18, drossK: 0.035, ingot: 2400 },   // 0.90 kJ/kgK x 635 K + 397 kJ/kg latent = 969 kJ/kg; 2-5% melt loss on clean scrap; secondary Al ingot ~$2,400/t
    copper: { melt: 1085, meltKWh: 170, cpL: 0.49, drossK: 0.012, ingot: 9500 },    // 0.385 x 1060 + 205 latent = 613 kJ/kg; copper barely oxidises in a covered bath; refined copper ~$9,500/t
    brass: { melt: 920, meltKWh: 141, cpL: 0.45, drossK: 0.030, ingot: 6200 },      // 0.38 x 895 + 168 latent = 508 kJ/kg; zinc fumes off a hot brass melt; brass ingot ~$6,200/t
    potmetal: { melt: 385, meltKWh: 70, cpL: 0.48, drossK: 0.025, ingot: 2600 },    // zinc: 0.39 x 360 + 112 latent = 252 kJ/kg; zamak ingot ~$2,600/t
    steel: { melt: 1510, meltKWh: 364, cpL: 0.82, drossK: 0.020, ingot: 550 },      // ~0.70 x 1485 + 270 latent = 1310 kJ/kg; EAF metallic yield 90-95%; billet ~$550/t
    castiron: { melt: 1180, meltKWh: 259, cpL: 0.90, drossK: 0.030, ingot: 450 },    // 0.60 x 1155 + 240 latent = 933 kJ/kg; pig iron ~$450/t
    silver: { melt: 962, meltKWh: 90, cpL: 0.31, drossK: 0.002, ingot: 1000000 },    // 0.235 x 937 + 105 latent = 325 kJ/kg; a 1,000 oz good-delivery bar at ~$31/oz = $1,000/kg
    gold: { melt: 1064, meltKWh: 55, cpL: 0.15, drossK: 0.001, ingot: 85000000 }     // 0.129 x 1039 + 64 latent = 198 kJ/kg; gold does not oxidise; ~$2,650/oz = $85,000/kg
  };
  Object.keys(SMELT).forEach(function (id) { Object.assign(MATERIALS[id], SMELT[id]); });

  /* ---------------- MACHINES ---------------- */
  const S = (id, label, unit, min, max, step, def, log) => ({ id, label, unit, min, max, step, def, log: !!log });

  const MACHINES = {
    /* ---- compression ---- */
    jaw: {
      name: 'Jaw crusher', short: 'JAW', cat: 'Primary crushing', kind: 'comminution', scene: 'jaw',
      mix: { comp: 0.8, impact: 0.1, attr: 0.1 }, eta: 0.45, cap: 70, capRef: 80, capExp: 0.6, maxFeed: 650, screened: false,
      pidle: 18, prated: 220, life: 400, price: 40000, service: 2400, wearInfo: 'manganese jaw plates',
      settings: [S('css', 'Closed-side setting', 'mm', 20, 200, 5, 80)],
      product: (s) => ({ p80: 0.85 * s.css, n: 1.4, top: 1.8 * s.css }),
      how: 'A fixed plate and a swinging jaw squeeze rock in a V-shaped chamber. The forward stroke crushes. On the back stroke the broken rock drops lower into a narrower gap, until it is small enough to fall out. The closed-side setting (CSS) is the gap at the bottom of the stroke and sets the product size.',
      best: 'Hard, brittle rock, concrete, cast iron, glass, ice.', avoid: 'Ductile metals: they just flatten between the plates. Liquids squirt out.'
    },
    cone: {
      name: 'Cone crusher', short: 'CONE', cat: 'Secondary crushing', kind: 'comminution', scene: 'cone',
      mix: { comp: 0.75, attr: 0.15, impact: 0.1 }, eta: 0.50, cap: 120, capRef: 25, capExp: 0.5, maxFeed: 250, screened: false,
      pidle: 30, prated: 280, life: 500, price: 90000, service: 5400, wearInfo: 'manganese mantle and bowl liner',
      settings: [S('css', 'Closed-side setting', 'mm', 6, 60, 1, 25)],
      product: (s) => ({ p80: 0.80 * s.css, n: 1.7, top: 1.5 * s.css }),
      how: 'A conical mantle gyrates eccentrically inside a bowl liner. Rock is squeezed progressively through a narrowing annular gap, so it is compressed on a different side of the cone every fraction of a second. It is the standard secondary and tertiary stage in a hard-rock plant.',
      best: 'Hard abrasive rock after a primary crusher.', avoid: 'Anything sticky or ductile. Feed larger than the feed opening bridges.'
    },
    roll: {
      name: 'Roll crusher', short: 'ROLL', cat: 'Secondary crushing', kind: 'comminution', scene: 'roll',
      mix: { comp: 0.85, shear: 0.15 }, eta: 0.50, cap: 60, capRef: 20, capExp: 0.7, maxFeed: 120, screened: false,
      pidle: 12, prated: 110, life: 300, price: 35000, service: 2100, wearInfo: 'roll shells',
      settings: [S('gap', 'Roll gap', 'mm', 5, 60, 1, 20)],
      product: (s) => ({ p80: 0.90 * s.gap, n: 2.2, top: 1.15 * s.gap }),
      how: 'Two counter-rotating cylindrical rolls nip the feed and fracture it. The roll gap sets the maximum particle size very precisely and produces few fines.',
      best: 'Friable, medium-hard material: limestone, coal, glass.', avoid: 'Very hard abrasive rock wears the rolls fast. Ductile stock slips.'
    },
    hpgr: {
      name: 'High-pressure grinding rolls', short: 'HPGR', cat: 'Fine crushing', kind: 'comminution', scene: 'hpgr',
      mix: { comp: 0.95, attr: 0.05 }, eta: 0.75, etaFn: (s) => 0.55 + s.press / 200, cap: 90, capRef: 25, capExp: 0.4, maxFeed: 60, screened: false,
      pidle: 40, prated: 520, life: 900, price: 220000, service: 13000, wearInfo: 'studded roll surfaces',
      settings: [S('gap', 'Roll gap', 'mm', 8, 50, 1, 25), S('press', 'Specific pressure', 'bar', 30, 80, 1, 55)],
      product: (s) => ({ p80: 0.16 * s.gap * Math.pow(65 / s.press, 0.8), n: 1.1, top: 0.6 * s.gap }),
      how: 'Two rolls squeeze a packed bed of particles at 45 to 75 bar, so particles break against each other (inter-particle comminution) instead of against steel. That is more energy-efficient: 10 to 30 percent savings are reported against conventional circuits. It leaves micro-cracks and a lot of fines.',
      best: 'Hard brittle ore and rock when you want fine product with low energy.', avoid: 'Feed above about 60 mm, ductile metals and wet sticky material.'
    },
    vsi: {
      name: 'Vertical shaft impactor', short: 'VSI', cat: 'Fine crushing', kind: 'comminution', scene: 'vsi',
      mix: { impact: 0.9, attr: 0.1 }, eta: 0.40, cap: 80, capRef: 14, capExp: 0.3, maxFeed: 60, screened: false,
      pidle: 30, prated: 260, life: 200, price: 85000, service: 5100, wearInfo: 'rotor tips and anvils',
      settings: [S('tip', 'Rotor tip speed', 'm/s', 30, 80, 1, 55)],
      product: (s) => ({ p80: 14 * Math.pow(55 / s.tip, 2), n: 1.6, top: 40 * Math.pow(55 / s.tip, 2) }),
      how: 'A rotor flings rock outward at 30 to 80 m/s against anvils or a bed of rock. Particles break along their natural planes of weakness, giving a cubical product. Compared with a cone crusher the product contains far more fines, and it can use less power.',
      best: 'Brittle, moderately abrasive rock and glass. Good for shaping aggregate.', avoid: 'Anything tough or ductile. Abrasion wears rotor tips quickly.'
    },
    /* ---- impact / shredders ---- */
    hammer: {
      name: 'Hammermill shredder', short: 'HAMM', cat: 'Impact shredding', kind: 'comminution', scene: 'hammer',
      mix: { impact: 0.65, shear: 0.25, attr: 0.10 }, eta: 0.22, cap: 90, capRef: 100, capExp: 0.5, maxFeed: 900, screened: true,
      pidle: 90, prated: 2200, life: 250, price: 450000, service: 27000, wearInfo: 'hammers and breaker plates',
      settings: [S('grate', 'Grate opening', 'mm', 30, 250, 5, 100), S('rpm', 'Rotor speed', '%', 60, 100, 1, 100)],
      product: (s, D) => ({ p80: s.grate * (0.5 + 0.4 * D.ductility) * Math.pow(100 / s.rpm, 0.5), n: 2.2, top: 1.5 * s.grate }),
      eFactor: (s) => Math.pow(s.rpm / 100, 1.0),
      how: 'Heavy swinging hammers on a spinning rotor smash and fling pieces against breaker plates. Anything that fits through the discharge grate leaves; the rest recirculates. Car shredders run rotors of 1 to 3 MW. Brittle metals shatter, but ductile ones ball up and soak energy.',
      best: 'Cars, appliances, cast iron, brittle scrap, wood waste.', avoid: 'Tough ductile metal: it works, but at a huge energy cost.'
    },
    twin: {
      name: 'Twin-shaft shear shredder', short: 'TWIN', cat: 'Shear shredding', kind: 'comminution', scene: 'twin',
      mix: { shear: 0.7, cut: 0.3 }, eta: 0.25, cap: 25, capRef: 50, capExp: 0.4, maxFeed: 1500, screened: false,
      pidle: 10, prated: 150, life: 350, price: 120000, service: 7200, wearInfo: 'hooked cutter discs',
      settings: [S('width', 'Cutter width', 'mm', 20, 150, 5, 50)],
      product: (s) => ({ p80: 2.4 * s.width, n: 1.3, top: 4.5 * s.width }),
      how: 'Two slow, high-torque shafts with hooked cutters intermesh and tear whatever falls between them. There is no screen, so the product size is uneven. It needs little pre-processing and no special foundation, so it is the usual primary stage for bulky, tough or mixed waste.',
      best: 'Tires, bulky ductile metal, timber, plastics, bales, big stuff.', avoid: 'You cannot get fine, uniform output from it alone. Follow it with another stage.'
    },
    single: {
      name: 'Single-shaft shredder', short: 'SHRD', cat: 'Shear shredding', kind: 'comminution', scene: 'single',
      mix: { cut: 0.55, shear: 0.45 }, eta: 0.10, cap: 8, capRef: 40, capExp: 0.4, maxFeed: 600, screened: true, knife: true,
      pidle: 8, prated: 90, life: 160, price: 70000, service: 4200, wearInfo: 'rotor knives and bed knife',
      settings: [S('screen', 'Screen size', 'mm', 10, 80, 1, 40)],
      product: (s) => ({ p80: 0.8 * s.screen, n: 2.6, top: 1.1 * s.screen }),
      how: 'A knife rotor and a hydraulic pusher ram that forces material against it. A screen below holds everything in until it is small enough to pass, so the output is uniform.',
      best: 'Plastics, rubber, wood, paper, cables, uniform output.', avoid: 'Hard stuff like steel, glass and stone ruins the knives.'
    },
    granulator: {
      name: 'Granulator', short: 'GRAN', cat: 'Fine cutting', kind: 'comminution', scene: 'granulator',
      mix: { cut: 0.8, shear: 0.2 }, eta: 0.08, cap: 2.5, capRef: 8, capExp: 0.4, maxFeed: 40, screened: true, knife: true,
      pidle: 5, prated: 55, life: 90, price: 45000, service: 2700, wearInfo: 'rotating and bed knives',
      settings: [S('screen', 'Screen size', 'mm', 3, 16, 1, 8)],
      product: (s) => ({ p80: 0.75 * s.screen, n: 3.0, top: 1.1 * s.screen }),
      how: 'High-speed knives chop small pre-shredded pieces against fixed bed knives until the flake passes a perforated screen. It is a secondary stage after a shredder, giving the 3 to 16 mm flake recyclers can melt.',
      best: 'Plastic and rubber pieces, cable, foam.', avoid: 'Anything bigger than about 40 mm, anything hard.'
    },
    chipper: {
      name: 'Drum wood chipper', short: 'CHIP', cat: 'Cutting', kind: 'comminution', scene: 'chipper',
      mix: { cut: 0.9, shear: 0.1 }, eta: 0.35, cap: 80, capRef: 20, capExp: 0.3, maxFeed: 400, screened: true, knife: true,
      pidle: 14, prated: 180, life: 140, price: 55000, service: 3300, wearInfo: 'chipper knives',
      settings: [S('len', 'Chip length', 'mm', 8, 50, 1, 20)],
      product: (s) => ({ p80: 1.1 * s.len, n: 3.5, top: 2 * s.len }),
      how: 'Knives on a spinning drum slice wood into uniform chips. Chippers give the highest-value wood product, but they are limited to clean wood: rocks and metal chip the knives.',
      best: 'Clean logs, branches and lumber.', avoid: 'Nails, rock, anything that is not wood.'
    },
    tub: {
      name: 'Tub grinder', short: 'TUB', cat: 'Impact shredding', kind: 'comminution', scene: 'tub',
      mix: { impact: 0.55, shear: 0.3, attr: 0.15 }, eta: 0.30, cap: 200, capRef: 75, capExp: 0.4, maxFeed: 2000, screened: true,
      pidle: 30, prated: 420, life: 250, price: 180000, service: 11000, wearInfo: 'carbide-tipped hammers',
      settings: [S('screen', 'Screen size', 'mm', 25, 150, 5, 75)],
      product: (s) => ({ p80: 0.7 * s.screen, n: 1.8, top: 1.4 * s.screen }),
      how: 'A slowly rotating tub feeds a hammer rotor with carbide-tipped flails that pound wood waste into splintered fibre, with pieces up to about 2.4 m accepted. The cracks and splinters give composting microbes lots of surface.',
      best: 'Whole pallets, stumps, brush, demolition timber.', avoid: 'Heavy metal and rock: the carbide tips take the abuse but it still throws shrapnel.'
    },
    /* ---- fine milling ---- */
    ball: {
      name: 'Ball mill', short: 'BALL', cat: 'Fine grinding', kind: 'comminution', scene: 'ball',
      mix: { impact: 0.5, attr: 0.5 }, eta: 1.0, cap: 30, capRef: 1, capExp: 0.0, maxFeed: 25, screened: true,
      pidle: 40, prated: 450, life: 700, price: 160000, service: 9600, wearInfo: 'liners and steel media',
      settings: [S('target', 'Target P80', 'mm', 0.05, 3, 0.01, 0.5, true)],
      product: (s) => ({ p80: s.target, n: 1.0, top: 8 * s.target }),
      how: 'A rotating drum half-filled with steel balls. Rock rides up the wall and cascades down, breaking by impact and by rubbing between balls. Bond\'s work index is defined on this machine. It can reach 50 micrometres, at a price: grinding fine is by far the most energy-hungry step.',
      best: 'Brittle rock, glass, ice, frozen gel, anything that fractures.', avoid: 'Ductile metals form flakes and cold-weld. Fibrous material just mats.'
    },
    cryo: {
      name: 'Cryogenic mill', short: 'CRYO', cat: 'Fine grinding', kind: 'comminution', scene: 'cryo', coldLevel: 2,
      mix: { impact: 0.8, attr: 0.2 }, eta: 0.30, cap: 6, capRef: 1.5, capExp: 0.2, maxFeed: 40, screened: true, ln2: true,
      pidle: 25, prated: 140, life: 350, price: 260000, service: 15600, wearInfo: 'hammer tips and screens',
      settings: [S('target', 'Target P80', 'mm', 0.2, 5, 0.05, 1.5, true)],
      product: (s) => ({ p80: s.target, n: 1.4, top: 4 * s.target }),
      how: 'Feed is sprayed with liquid nitrogen at -196 C until it passes below its glass transition. Rubber and plastics turn glassy and shatter into clean fine powder with almost no heat damage. Steel also embrittles, so it separates cleanly. Aluminum and copper do not embrittle, so cooling them just burns nitrogen.',
      best: 'Tire rubber, plastics, steel-belted waste, polymers, frozen foods.', avoid: 'Aluminum, copper, brass: they stay ductile, and the nitrogen is wasted.'
    },
    /* ---- hydraulic ---- */
    colloid: {
      name: 'Colloid mill', short: 'COLL', cat: 'Hydraulic shear', kind: 'comminution', scene: 'colloid', excludeLiquid: true,
      mix: { hyd: 0.85, attr: 0.15 }, eta: 0.55, cap: 8, capRef: 100, capExp: 0.0, maxFeed: 3, screened: false,
      pidle: 6, prated: 45, life: 180, price: 60000, service: 3600, wearInfo: 'rotor and stator faces',
      settings: [S('gap', 'Rotor-stator gap', 'µm', 10, 500, 5, 100, true)],
      product: (s) => ({ p80: 0.0005 * s.gap, n: 2.2, top: 0.0012 * s.gap }),
      eSpec: (s) => 15 * Math.sqrt(100 / s.gap),
      how: 'A cone-shaped rotor spins against a stator with an adjustable gap measured in micrometres. Fluid is dragged through the gap, which exerts intense hydraulic and mechanical shear that tears soft solids and droplets down to roughly 0.1 to 25 micrometres.',
      best: 'Soft solids already chopped small, pastes, gels, emulsions.', avoid: 'Anything coarser than a couple of millimetres. Pure liquid: there is nothing to break up.'
    },
    homog: {
      name: 'High-pressure homogenizer', short: 'HOMO', cat: 'Hydraulic shear', kind: 'comminution', scene: 'homog', excludeLiquid: true,
      mix: { hyd: 1.0 }, eta: 0.8, cap: 5, capRef: 600, capExp: 0.0, maxFeed: 0.8, screened: false,
      pidle: 10, prated: 220, life: 450, price: 150000, service: 9000, wearInfo: 'valve seat and piston',
      settings: [S('bar', 'Pressure', 'bar', 100, 2000, 10, 600, true)],
      product: (s) => ({ p80: 0.04 * Math.pow(100 / s.bar, 0.6), n: 2.5, top: 0.12 * Math.pow(100 / s.bar, 0.6) }),
      physical: 'pressure',
      how: 'A pump forces fluid at hundreds to 2000 bar through a hairline valve gap into low pressure. The pressure drop, turbulence and cavitation bubbles tear particles and droplets down to sub-micron sizes. The energy is simply pressure drop divided by density.',
      best: 'Gels already cut small, emulsions, suspensions.', avoid: 'Particles above about a millimetre, which would block the valve.'
    },
    atomizer: {
      name: 'High-pressure atomizer', short: 'ATOM', cat: 'Hydraulic shear', kind: 'comminution', scene: 'atomizer', liquidOnly: true,
      mix: { hyd: 1.0 }, eta: 0.7, cap: 6, capRef: 300, capExp: 0.0, maxFeed: 1000, screened: false,
      pidle: 6, prated: 60, life: 600, price: 25000, service: 1500, wearInfo: 'nozzle orifice',
      settings: [S('bar', 'Nozzle pressure', 'bar', 50, 1000, 10, 300, true)],
      product: (s) => ({ p80: 0.08 * Math.pow(100 / s.bar, 0.5), n: 2.5, top: 0.25 * Math.pow(100 / s.bar, 0.5) }),
      physical: 'pressure',
      how: 'A high-pressure pump pushes liquid through a small orifice. The jet breaks up by surface-tension and shear instability into a mist of droplets, finer at higher pressure. Only liquids can be crushed this way, and energy is again the pressure drop per unit of mass.',
      best: 'Water and other liquids.', avoid: 'Solids of any kind.'
    },
    /* ---- conditioner ---- */
    freezer: {
      name: 'Blast freezer', short: 'FRZ', cat: 'Conditioning', kind: 'conditioner', scene: 'freezer', temp: 1,
      cap: 15, capRef: 1, capExp: 0, maxFeed: 99999,
      pidle: 12, prated: 360, life: 1e9, price: 70000, service: 4200, wearInfo: 'n/a', cop: 2.2,
      settings: [],
      how: 'Air at about -30 C freezes everything on the belt. Water turns into brittle ice and gel into a brittle frozen block, so they can finally be crushed. The catch is the latent heat of fusion: about 334 kJ per kg of water, roughly 60 kWh per tonne of electricity.',
      best: 'Water and hydrogel ahead of a crusher.', avoid: 'Dry metals and rock: freezing them only wastes power.'
    },
    /* ---- separators ----
     * Purchase prices climb in the order a hammermill-only yard should buy them: sink-float, magnet, air classifier,
     * eddy current, screen. The first three are the cheap, high-yield sorters for mixed shred; the screen only pays on rock and wood.
     */
    magnet: {
      name: 'Magnetic drum', short: 'MAG', cat: 'Separation', kind: 'separator', scene: 'magnet',
      eSpec: 0.15, cap: 80, capRef: 1, capExp: 0, pidle: 4, prated: 20, life: 1e9, price: 22000, service: 1300, wearInfo: 'n/a',
      settings: [S('field', 'Field strength', 'mT', 50, 500, 10, 250)],
      outs: { extract: 'Ferrous (magnetic)', residue: 'Non-magnetic' },
      how: 'A stationary magnet sector sits inside a rotating drum. Ferrous pieces stick to the drum while it carries them through the field and drop off after the field ends. Everything else flies off the belt. Stronger fields recover more steel but also drag along trapped non-ferrous pieces.',
      best: 'Pulling steel and cast iron out of any mixed stream.', avoid: 'Very fine, tangled or wet material traps contaminants.'
    },
    eddy: {
      name: 'Eddy current separator', short: 'ECS', cat: 'Separation', kind: 'separator', scene: 'eddy',
      eSpec: 1.0, cap: 20, capRef: 1, capExp: 0, pidle: 8, prated: 40, life: 1e9, price: 90000, service: 5400, wearInfo: 'n/a',
      settings: [S('rpm', 'Magnet rotor speed', 'rpm', 1000, 4000, 100, 3000)],
      outs: { extract: 'Non-ferrous (conductive)', residue: 'Non-conductive reject' },
      how: 'A fast-spinning rotor of alternating magnets sits under a belt. The changing field induces eddy currents in conductive pieces, which then repel themselves off the rotor and are thrown forward over a splitter. The force scales with conductivity over density, so aluminum jumps farthest. Pieces below a few millimetres barely react.',
      best: 'Recovering aluminum, copper, brass and zinc from shredded residue.', avoid: 'Ferrous pieces must be removed first or they jam to the rotor. It cannot tell metals apart.'
    },
    air: {
      name: 'Zig-zag air classifier', short: 'AIR', cat: 'Separation', kind: 'separator', scene: 'air',
      eSpec: 3.0, cap: 25, capRef: 1, capExp: 0, pidle: 10, prated: 90, life: 1e9, price: 70000, service: 4200, wearInfo: 'n/a',
      settings: [S('air', 'Air velocity', 'm/s', 2, 25, 0.5, 11)],
      outs: { extract: 'Lights (fluff)', residue: 'Heavies' },
      how: 'Pieces tumble down a zig-zag column against an upward air stream. A particle is carried out the top if its terminal velocity is lower than the air speed. Terminal velocity grows with the square root of size times density, so wood, foam, film and plastic leave as "fluff" and metal drops.',
      best: 'Removing wood, rubber, plastic and foam from metal.', avoid: 'Large, dense pieces never lift. Wet or oily fluff clumps.'
    },
    screen: {
      name: 'Vibrating screen', short: 'SCRN', cat: 'Separation', kind: 'separator', scene: 'screen',
      // price: a 6 x 16 ft double-deck scalping screen for shredder output, with feeder, support tower, chutes and dust enclosure, is about $115k installed.
      eSpec: 0.4, cap: 120, capRef: 1, capExp: 0, pidle: 5, prated: 30, life: 1e9, price: 115000, service: 1100, wearInfo: 'n/a',
      settings: [S('aperture', 'Aperture', 'mm', 1, 150, 1, 25, true)],
      outs: { extract: 'Undersize', residue: 'Oversize' },
      how: 'A vibrating inclined deck with square openings: pieces smaller than the aperture fall through, bigger ones ride down the deck. It does not change particle size, it sorts by it. Real plants return the oversize to the crusher.',
      best: 'Sizing, scalping and fines removal.', avoid: 'Sticky or damp fines blind the mesh.'
    },
    sinkfloat: {
      name: 'Sink-float tank', short: 'SINK', cat: 'Separation', kind: 'separator', scene: 'sinkfloat',
      // price: a small skid-mounted float-sink tank with drag-out conveyors (plastics-washing-line class) is about $18k new; the heavy medium is bought per tonne as mediaCost.
      eSpec: 2.0, cap: 15, capRef: 1, capExp: 0, pidle: 10, prated: 40, life: 1e9, price: 18000, service: 3900, wearInfo: 'n/a', mediaCost: 1.2,
      // it comes filled with plain water (1.0 g/cc): wood and most plastics float, glass, stone and metal sink. Heavier media
      // (magnetite or ferrosilicon slurry, up to ~3.5) are what split aluminum (2.7) from zinc, brass and copper.
      settings: [S('sg', 'Medium density', 'g/cc', 1.0, 4.0, 0.05, 1.0)],
      outs: { extract: 'Floats (lighter)', residue: 'Sinks (heavier)' },
      how: 'Pieces are dropped into a liquid whose density is tuned between the materials you want to split. Anything lighter floats, anything heavier sinks. A medium at about 2.9 g/cc floats aluminum at 2.7 and sinks zinc, brass and copper: it is how mixed "zorba" is split into valuable fractions.',
      best: 'Splitting non-ferrous mixes by density.', avoid: 'Very fine material and anything porous that soaks the medium.'
    },
    sensor: {
      name: 'Sensor sorter', short: 'XRT', cat: 'Separation', kind: 'separator', scene: 'sensor',
      // XRT / LIBS belt sorters: about 10 t/h on a 1 m belt of 10-150 mm pieces; about 2 kWh/t for the X-ray tube, the ejection-air
      // compressor and the belt; 8 kW idle (tube, electronics, belt), 40 kW installed (mostly the compressor); about $300k for a small unit.
      eSpec: 2.0, cap: 10, capRef: 1, capExp: 0, pidle: 8, prated: 40, life: 1e9, price: 300000, service: 18000, wearInfo: 'n/a',
      // enum setting: the value is a material id, there is no min/max/step
      settings: [{ id: 'target', label: 'Target material', enum: MAT_ORDER, def: 'copper' }],
      outs: { extract: 'Target material', residue: 'Everything else' },
      how: 'Pieces are spread on a fast belt and run under a scanner: an X-ray transmission (XRT) camera reads the atomic density of each piece, or a laser (LIBS) vaporises a speck of its surface and reads the emission spectrum. A computer decides in milliseconds whether the piece is the target material, and a bank of air valves at the end of the belt fires a jet that kicks that piece over a splitter. It sorts by chemistry rather than by a physical property, so it can pull copper out of brass and zinc, or split alloys, which no magnet, eddy current or sink-float can do.',
      best: 'Picking one metal out of a mixed non-ferrous stream of 10 to 150 mm pieces.', avoid: 'Fines under about 5 mm: the camera cannot resolve them and the jets miss. Pieces over 200 mm shadow their neighbours. Wet or dusty feed fouls the window.'
    }
  };
  /* ---- smelting ----
   * kind 'furnace': metals listed in `melts` whose melting point is below the tap temperature leave as ingots; everything
   * else goes to the dross port. eta is thermal efficiency on the theoretical melt enthalpy (SMELT above), so energy
   * per tonne = (meltKWh + superheat) / eta. drossF scales oxidation loss; slagKWh is what heating non-metal charge costs.
   */
  Object.assign(MACHINES, {
    induction: {
      name: 'Induction furnace', short: 'INDC', cat: 'Smelting', kind: 'furnace', scene: 'furnace',
      melts: ['aluminum', 'copper', 'brass', 'potmetal'], eta: 0.50, drossF: 1.0, slagKWh: 150,   // coreless induction couples poorly to Al: 269/0.5 + superheat ~ 600 kWh/t, copper ~ 360-400 kWh/t (industry figures 550-650 and 350-450)
      cap: 4, capRef: 1, capExp: 0, maxFeed: 300,                                                   // 4 t/h melt rate for a 5 t coreless furnace; the crucible mouth takes pieces to ~300 mm
      pidle: 120, prated: 3000, life: 150, price: 750000, service: 45000, wearInfo: 'crucible refractory', consumable: 2,   // 3 MW supply; holding power ~120 kW; lining lasts ~250 heats x 5 t; $2/t of flux
      settings: [S('tap', 'Tap temperature', '°C', 450, 1250, 10, 740)],
      outs: { product: 'Ingots', dross: 'Dross' },
      how: 'A water-cooled copper coil around a refractory crucible induces eddy currents in the charge, which heat it from the inside and stir the bath. The tap temperature sets the superheat: every metal whose melting point is below it melts into one alloy, anything above it sits in the bath unmelted. Hotter taps cost more energy and oxidise more metal into dross.',
      best: 'Clean, sorted aluminum, copper, brass or zinc scrap. Pure feed makes a pure ingot.', avoid: 'Steel and cast iron: this crucible is lined and rated for non-ferrous temperatures. Mixed metals melt into worthless alloy soup. Fines and swarf burn to oxide.'
    },
    arc: {
      name: 'Electric arc furnace', short: 'EAF', cat: 'Smelting', kind: 'furnace', scene: 'furnace',
      melts: ['steel', 'castiron'], eta: 0.85, drossF: 1.0, slagKWh: 150,                           // 364/0.85 + superheat ~ 450 kWh/t electrical, as a scrap EAF (oxygen and carbon supply the rest of the heat)
      cap: 12, capRef: 1, capExp: 0, maxFeed: 600,                                                  // a 10 t heat every ~50 min; the charge bucket takes pieces to ~600 mm
      pidle: 250, prated: 8000, life: 360, price: 1200000, service: 72000, wearInfo: 'hearth refractory and electrodes', consumable: 9,   // 8 MVA transformer; auxiliaries ~250 kW; hearth ~300 heats; graphite electrodes ~1.8 kg/t at $5/kg
      settings: [S('tap', 'Tap temperature', '°C', 1250, 1750, 10, 1600)],
      outs: { product: 'Ingots', dross: 'Dross' },
      how: 'Three graphite electrodes strike an arc onto a charge of scrap steel. The arc runs above 3000 C, so steel and cast iron melt in under an hour. Slag floats the oxides off and the steel is tapped into billets. A furnace this size draws megawatts, so the power contract matters.',
      best: 'Magnet-cleaned steel and cast iron.', avoid: 'Copper and zinc in the charge dissolve into the steel and cannot be removed: they poison the heat. Non-metals burn off and waste power.'
    },
    kiln: {
      name: 'Reverberatory kiln', short: 'REVB', cat: 'Smelting', kind: 'furnace', scene: 'furnace',
      melts: ['aluminum', 'copper', 'brass', 'potmetal'], eta: 0.30, drossF: 1.8, slagKWh: 150,   // gas-fired reverberatory: 25-35% thermal efficiency; a flame over an open bath oxidises 5-10% of the aluminum; fuel billed at the plant energy price
      cap: 6, capRef: 1, capExp: 0, maxFeed: 500,                                                   // a wide hearth door takes bulky charge to ~500 mm
      pidle: 350, prated: 6000, life: 600, price: 350000, service: 21000, wearInfo: 'hearth refractory', consumable: 4,   // 6 MW of burners; a hot hearth loses ~350 kW on hold; a bricked hearth lasts years; $4/t of salt flux
      settings: [S('tap', 'Tap temperature', '°C', 450, 1250, 10, 760)],
      outs: { product: 'Ingots', dross: 'Dross' },
      how: 'A gas flame plays over a shallow bath in a brick hearth; the roof reflects (reverberates) the heat down onto the charge. It is cheap to build and takes big, dirty charges, but most of the heat goes up the stack and the flame oxidises the surface of the melt, so dross losses are high.',
      best: 'Bulk aluminum when capital is tight.', avoid: 'Steel, fines, and anything you want melted efficiently.'
    }
  });
  /* ---- end game (ticket #15) ----
   * The Omniprocessor is the one fantasy machine: it liberates every material to the target size and sorts every particle into a
   * bin of its own (see procComminution in js/sim.js). Its size, power, capacity and price are anchored on a real mega-shredder plant
   * with its full downstream separation hall, so the economics around it stay grounded. It unlocks when the plant reaches Mega-plant rank
   * (js/modules/endgame.js).
   */
  const OMNI_OUTS = {}; MAT_ORDER.forEach(function (id) { OMNI_OUTS[id] = MATERIALS[id].name; }); OMNI_OUTS.rejects = 'Oversize rejects';
  Object.assign(MACHINES, {
    omni: {
      name: 'Omniprocessor', short: 'OMNI', cat: 'End game', kind: 'comminution', scene: 'omni', omni: true,
      mix: { impact: 0.4, shear: 0.3, cut: 0.2, comp: 0.1 },                                        // display only: the sim uses a flat 0.9 response on every material
      eta: 0.5, cap: 400, capRef: 100, capExp: 1, maxFeed: 2500, screened: true,                     // eta ~2x a hammermill, as bed-breakage HPGR gets over impact; 400 t/h is the rating of the largest mega-shredders; takes a flattened car hulk (~2.5 m)
      pidle: 400, prated: 9000, life: 5000, price: 30000000, service: 1800000, wearInfo: 'scan arches and rotor cassettes',   // 10,000 hp (7.5 MW) mega-shredder plus 1.5 MW of downstream drives; a complete mega-shredder plant with its separation hall costs $25-40M; service at 6% of price like the rest of the table
      settings: [S('rate', 'Throughput', '%', 20, 100, 5, 100), S('target', 'Target size', 'mm', 1, 100, 1, 20, true)],
      product: (s) => ({ p80: s.target, n: 2.4, top: 1.6 * s.target }),
      outs: OMNI_OUTS,
      unlock: { rank: 'Mega-plant', text: 'Reach Mega-plant rank.' },
      how: 'A long sealed unit that does in one pass what a whole plant does in twenty machines. Rotor cassettes take the feed down to the target size while a row of scan arches reads every particle (X-ray transmission, laser spectroscopy, induction and colour at once), and a bank of air jets fires each one down a chute of its own. No such machine exists: real plants need a shredder, magnets, eddy currents, air, density and sensor sorters in series because no single sensor and no single breaking mechanism works on every material.',
      best: 'Anything. One output bin per material.', avoid: 'Nothing, except a small bank balance.'
    }
  });
  Object.keys(MACHINES).forEach(function (id) {
    const M = MACHINES[id]; M.id = id;
    // st.def is copied as-is, so an enum setting (a string such as a material id) defaults like a numeric one
    M.defaults = {}; (M.settings || []).forEach(function (st) { M.defaults[st.id] = st.def; });
  });
  /* Plan footprint of each machine in metres, width x depth: typical skid or plan sizes of mid-size units from vendor
   * data sheets (drive, feed chute and discharge included, no access aisles). Used by the floor-space module.
   */
  const FOOTPRINT = {
    jaw: [3, 2],          // single-toggle jaw with ~900x600 mm feed opening sits on a 3x2 m skid
    cone: [4, 3],         // standard 4 ft cone crusher with drive and lube unit
    roll: [3, 2],         // double-roll crusher, 1 m rolls
    hpgr: [5, 3],         // HPGR with two drive trains alongside the rolls
    vsi: [4, 4],          // rotor crusher is square in plan, drive on the side
    hammer: [7, 5],       // 60x60 in automobile shredder box with motor and infeed conveyor
    tub: [9, 4],          // trailer-mounted tub grinder is about 9 m long
    twin: [5, 3],         // twin-shaft shredder with hopper and hydraulic power pack
    single: [4, 3],       // single-shaft shredder with ram box
    granulator: [2, 2],   // granulator and its sound enclosure
    chipper: [4, 2],      // drum chipper with infeed table
    ball: [9, 3],         // 2.4 m x 3.6 m ball mill with girth gear drive and feed end
    cryo: [6, 3],         // cryogenic mill with pre-cooler screw and LN2 manifold
    colloid: [2, 1],      // bench-scale colloid mill on a frame
    homog: [3, 2],        // high-pressure homogenizer with its pump block
    atomizer: [2, 2],     // high-pressure pump skid and nozzle stand
    freezer: [8, 3],      // tunnel blast freezer, belt length sets the dwell time
    magnet: [3, 2],       // magnetic drum over a 1.2 m belt
    eddy: [4, 2],         // eddy current separator with splitter and feed vibrator
    air: [3, 3],          // zig-zag column with fan and cyclone
    screen: [5, 2],       // 5x1.5 m inclined vibrating screen deck
    sinkfloat: [6, 3],
    // sensor sorter: 2 m wide belt unit with a 6 m acceleration conveyor; furnaces: 5 t induction cell, 10 t arc furnace with transformer bay, 20 t reverberatory
    sensor: [6, 2], induction: [5, 4], arc: [8, 6], kiln: [10, 4],    // heavy-media drum with media pumps and drain screens
    omni: [40, 12]        // the length of a mega-shredder's downstream separation building, folded into one enclosure
  };
  Object.keys(MACHINES).forEach(function (id) { const f = FOOTPRINT[id]; if (f) MACHINES[id].foot = { w: f[0], d: f[1] }; });

  const MACHINE_GROUPS = [
    ['Compression', ['jaw', 'cone', 'roll', 'hpgr']],
    ['Impact and shred', ['vsi', 'hammer', 'tub', 'twin', 'single', 'granulator', 'chipper']],
    ['Fine and cold', ['ball', 'cryo', 'freezer']],
    ['Hydraulic', ['colloid', 'homog', 'atomizer']],
    ['Separation', ['magnet', 'eddy', 'air', 'screen', 'sinkfloat', 'sensor']],
    ['Smelting', ['induction', 'arc', 'kiln']],
    ['End game', ['omni']]
  ];

  /* ---------------- PRESET FEEDS ---------------- */
  const FEEDS = {
    elv: { name: 'End-of-life vehicles', blurb: 'What a car shredder eats.', cost: 170, comp: { steel: 0.58, castiron: 0.07, aluminum: 0.07, copper: 0.015, brass: 0.01, potmetal: 0.025, rubber: 0.07, plastic: 0.08, glass: 0.03, wood: 0.01, gel: 0.02, water: 0.02 } },
    rubble: { name: 'Demolition rubble', blurb: 'Concrete, rebar and timber.', cost: -8, comp: { limestone: 0.5, granite: 0.2, steel: 0.1, wood: 0.1, glass: 0.05, plastic: 0.05 } },
    pallets: { name: 'Pallets with nails', blurb: 'Wood with a tramp-metal problem.', cost: -15, comp: { wood: 0.94, steel: 0.04, plastic: 0.02 } },
    tires: { name: 'Scrap tires', blurb: 'Rubber, steel belts and fabric.', cost: -70, comp: { rubber: 0.70, steel: 0.15, plastic: 0.15 } },
    zorba: { name: 'Zorba (mixed non-ferrous)', blurb: 'Aluminum with heavy metals.', cost: 1000, comp: { aluminum: 0.70, copper: 0.08, brass: 0.07, potmetal: 0.15 } },
    quarry: { name: 'Quarry run-of-mine', blurb: 'Granite and limestone.', cost: 5, comp: { granite: 0.6, limestone: 0.4 } },
    lab: { name: 'Gel and water', blurb: 'Soft stuff you cannot crush.', cost: 20, comp: { gel: 0.5, water: 0.5 } },
    gel: { name: 'Hydrogel', blurb: 'Pure gel blocks.', cost: 60, comp: { gel: 1 } },
    water: { name: 'Water', blurb: 'A bulk liquid.', cost: 0, comp: { water: 1 } },
    // Office furniture is particleboard and MDF held together by steel screws, staples and glides with plastic trim:
    // about 93% wood by mass. A clear-out pays a small tipping fee (-$5/t) because the board is clean enough to chip.
    // Old timber windows and doors from a house clear-out: by mass roughly half timber frame, a third glazing (4 mm float glass,
    // double-glazed units), steel hinges, stays and fixings, and a little PVC trim and seal. Demolition contractors pay to get
    // rid of them, so a yard is paid a little to take a load.
    windows: { name: 'Old windows & doors', blurb: 'Timber frames, panes of glass, steel hinges and fixings.', cost: -10, comp: { wood: 0.55, glass: 0.30, steel: 0.12, plastic: 0.03 } },
    chair: { name: 'Office clear-out', blurb: 'Desks and chairs: particleboard full of screws, staples and plastic glides.', cost: -5, comp: { wood: 0.93, steel: 0.05, plastic: 0.02 } },
    // Washing machine by mass (WEEE composition studies): ~55% steel shell and drum, 5% cast iron (drum spider), 4% copper
    // (motor windings and wiring), 3% aluminum, 18% plastics (tub and panels), 4% rubber (hoses, door seal), 3% glass (door)
    // and the concrete counterweight (~8%, stood in for by limestone). Whole units trade at about $60/t.
    appliance: { name: 'White goods', blurb: 'Washing machines: a steel shell round a concrete counterweight, motor copper and a plastic tub.', cost: 60, comp: { steel: 0.55, castiron: 0.05, copper: 0.04, aluminum: 0.03, plastic: 0.18, rubber: 0.04, glass: 0.03, limestone: 0.08 } },
    // A mixed C&D skip topped up with yard scrap, so every material is present. Weights follow C&D waste surveys
    // (concrete and masonry dominate the non-metal, wood ~15%, plastics 1-3%, glass a few percent) plus a scrap-metal
    // fraction; the metal content makes it worth paying $40/t for, the rubble keeps that price low.
    // electronics (#53): high-grade circuit boards and devices. Per tonne about 200 kg copper, 300 kg epoxy and plastic, 290 kg
    // glass fibre and ceramics, 70 kg steel, 50 kg aluminum, 40 kg brass connectors, 40 kg solder and zinc, 1 kg silver and a
    // quarter of a kilo of gold (published PCB assays run 150-400 g/t Au, 600-1,500 g/t Ag). Buyers pay about 60% of the
    // contained metal: the rest is the sorting and refining it still needs.
    ewaste: { name: 'Electronics (circuit boards)', blurb: 'Boards, connectors and devices: copper, plastic, glass fibre, and grams of silver and gold.', cost: 9000, comp: { plastic: 0.30875, glass: 0.29, copper: 0.20, steel: 0.07, aluminum: 0.05, brass: 0.04, potmetal: 0.04, silver: 0.001, gold: 0.00025 } },
    // plated pins and contacts: connector strip, relay contacts and edge fingers, 2 kg gold and 20 kg silver per tonne on brass
    // and copper. Sold to refiners by assay, around 60% of contained value.
    pins: { name: 'Gold-plated pins and contacts', blurb: 'Connector strip and relay contacts: brass and copper with real gold and silver on them.', cost: 115000, comp: { brass: 0.45, copper: 0.38, plastic: 0.10, steel: 0.048, silver: 0.02, gold: 0.002 } },
    everything: { name: 'Everything', blurb: 'A mixed skip: every material at once, down to an old phone or two. The universal plant was built for it.', cost: 40, comp: { steel: 0.28, castiron: 0.03, aluminum: 0.08, copper: 0.02, brass: 0.015, potmetal: 0.025, silver: 0.00002, gold: 0.000002, wood: 0.16, rubber: 0.05, plastic: 0.025, glass: 0.04, granite: 0.09, limestone: 0.154978, gel: 0.015, water: 0.015 } }
  };

  /* ---------------- PRESET FLOWSHEETS ---------------- */
  // src: 'feed' or 'k:port' where k is the 1-based index of an earlier node.
  const LINES = {
    starter: {
      name: 'Starter yard', feed: 'elv', tons: 15,
      blurb: 'Day one: a hammermill grinds the junk and a magnetic drum pulls the steel out clean. Only sorted material sells; the rest waits in MISC for your next sorter.',
      nodes: [
        { m: 'hammer', s: { grate: 100, rpm: 100 }, src: 'feed' },
        { m: 'magnet', src: '1:product' }
      ]
    },
    car: {
      name: 'Car shredder line', feed: 'elv', tons: 15,
      blurb: 'Hammermill, then air, magnet, eddy current and heavy-media tank.',
      nodes: [
        { m: 'hammer', s: { grate: 100, rpm: 100 }, src: 'feed' },
        { m: 'air', s: { air: 11 }, src: '1:product' },
        { m: 'magnet', s: { field: 250 }, src: '2:residue' },
        { m: 'eddy', s: { rpm: 3000 }, src: '3:residue' },
        { m: 'sinkfloat', s: { sg: 2.9 }, src: '4:extract' }
      ]
    },
    quarry: {
      name: 'Quarry plant', feed: 'quarry', tons: 30,
      blurb: 'Jaw, cone, screen, then ball mill for rock flour.',
      nodes: [
        { m: 'jaw', s: { css: 100 }, src: 'feed' },
        { m: 'cone', s: { css: 25 }, src: '1:product' },
        { m: 'screen', s: { aperture: 20 }, src: '2:product' },
        { m: 'ball', s: { target: 0.5 }, src: '3:extract' }
      ]
    },
    wood: {
      name: 'Wood waste line', feed: 'pallets', tons: 15,
      blurb: 'Tub grinder, magnet to catch nails, then screen the mulch.',
      nodes: [
        { m: 'tub', s: { screen: 75 }, src: 'feed' },
        { m: 'magnet', s: { field: 250 }, src: '1:product' },
        { m: 'screen', s: { aperture: 40 }, src: '2:residue' }
      ]
    },
    tire: {
      name: 'Cryogenic tire line', feed: 'tires', tons: 8,
      blurb: 'Tear, cut, freeze-shatter, then magnet out the steel.',
      nodes: [
        { m: 'twin', s: { width: 60 }, src: 'feed' },
        { m: 'single', s: { screen: 30 }, src: '1:product' },
        { m: 'cryo', s: { target: 1.0 }, src: '2:product' },
        { m: 'magnet', s: { field: 250 }, src: '3:product' }
      ]
    },
    ice: {
      name: 'Freeze and crush', feed: 'lab', tons: 10,
      blurb: 'You cannot crush water. Freeze it, then you can.',
      nodes: [
        { m: 'freezer', s: {}, src: 'feed' },
        { m: 'jaw', s: { css: 30 }, src: '1:product' },
        { m: 'roll', s: { gap: 8 }, src: '2:product' }
      ]
    },
    hydro: {
      name: 'Gel micronizer', feed: 'gel', tons: 2,
      blurb: 'Gel does not fracture. Cut it small, then shear it through micron gaps.',
      nodes: [
        { m: 'single', s: { screen: 20 }, src: 'feed' },
        { m: 'granulator', s: { screen: 3 }, src: '1:product' },
        { m: 'colloid', s: { gap: 100 }, src: '2:product' },
        { m: 'homog', s: { bar: 600 }, src: '3:product' }
      ]
    },
    mist: {
      name: 'Water atomizer', feed: 'water', tons: 5,
      blurb: 'A liquid cannot be crushed, but a nozzle can turn it into mist.',
      nodes: [
        { m: 'atomizer', s: { bar: 300 }, src: 'feed' }
      ]
    },
    universal: {
      name: 'Universal sorting plant', feed: 'everything', tons: 20,
      blurb: 'Tear, liberate in the hammermill, then sort by magnetism, air, eddy current, density and size. Without a sensor sorter the heavy sinks stay a copper-brass-zinc mix and glass stays with the stone.',
      // Air at 11 m/s lifts wood (terminal velocity ~9 m/s) and plastic flake (~6 m/s) and drops rubber, glass and metal (13 m/s and up).
      // Sink-float 2.9 floats aluminum (2.7) off the zinc, brass and copper (6.6 to 9.0). Sink-float 1.0 floats wood and plastic
      // (0.5, 0.95) and sinks rubber (1.10). The 50 mm screen on the eddy reject pulls the stone, which the hammermill broke to
      // under 50 mm, away from rubber and wood that stayed coarse (measured in tests/universal.js: +$14/t of product).
      nodes: [
        { m: 'twin', s: { width: 60 }, src: 'feed' },
        { m: 'hammer', s: { grate: 100, rpm: 100 }, src: '1:product' },
        { m: 'magnet', s: { field: 250 }, src: '2:product' },
        { m: 'air', s: { air: 11 }, src: '3:residue' },
        { m: 'eddy', s: { rpm: 3000 }, src: '4:residue' },
        { m: 'sinkfloat', s: { sg: 2.9 }, src: '5:extract' },
        { m: 'sinkfloat', s: { sg: 1.0 }, src: '4:extract' },
        { m: 'screen', s: { aperture: 50 }, src: '5:residue' }
      ]
    },
    ingot: {
      name: 'Zorba to aluminum ingot', feed: 'zorba', tons: 10,
      blurb: 'Shred, float the aluminum off the heavy metals, then melt it into ingots.',
      nodes: [
        { m: 'twin', s: { width: 40 }, src: 'feed' },
        { m: 'sinkfloat', s: { sg: 3.2 }, src: '1:product' },
        { m: 'induction', s: { tap: 740 }, src: '2:extract' }
      ]
    }
  };

  /* ---------------- GAME LAYER: bank, ownership, upgrades, ranks ---------------- */
  // Purchase prices are scaled from real-world figures so a session of play buys a plant.
  const PRICE_SCALE = 0.2;
  Object.keys(MACHINES).forEach(function (id) { const M = MACHINES[id]; M.price = Math.max(500, Math.round(M.price * PRICE_SCALE / 500) * 500); });
  // Day one is a hammermill alone: unsorted shred sells at a discount, and the sorters are unlocked one purchase at a time.
  const STARTER_MACHINES = ['hammer', 'magnet'];   // a grinder and one sorter: only sorted material sells (#52, #55)
  // $2,800 pays for one 15 t batch of ELV feed (170 $/t, about 30% of what the hulks are worth fully sorted: US shredder
  // yards pay roughly a third of the shred value for a hulk). Only sorted material sells (#52), so the day-one yard is a
  // hammermill and a magnetic drum: the magnet's clean steel nets about $1,100 a batch, and the next sorters pay in pairs
  // (eddy current + sink-float for clean aluminum). tests/progression.js and tests/playtest.js check the pacing (#55).
  const START_BANK = 2800;
  const LEVEL_MAX = 5;
  const LEVEL_FX = { cap: 0.20, eta: 0.06, life: 0.30, power: 0.10 };   // per level, multiplicative on base
  function levelCost(M, lvl) { return Math.round(M.price * 0.45 * Math.pow(1.7, lvl) / 100) * 100; }
  const PLANT_UPGRADES = {
    // Batch size is what the yard can receive and weigh in one go. Up to 500 t it is trucks and a loader. 1,000 t needs a pit
    // weighbridge and another hectare of paved yard (~$1.75M real, so $350k at PRICE_SCALE); 3,000 t a rail siding with a
    // turnout (~1 km of industrial track, $5-6M real); 10,000 t a loop track for unit trains and a stacker-reclaimer (~$17M real).
    logistics: { name: 'Feed logistics', icon: '🚚', desc: 'Bigger batches per run', unit: 't per batch', levels: [30, 60, 120, 250, 500, 1000, 3000, 10000], costs: [3000, 9000, 30000, 110000, 500000, 2500000, 12000000] },   // big tiers: rail siding, second weighbridge, barge berth; priced to pay back over ~10 batches
    power: { name: 'Power contract', icon: '⚡', desc: 'Cheaper electricity', unit: '$/kWh', levels: [0.12, 0.10, 0.085, 0.07, 0.055], costs: [4000, 12000, 40000, 150000] },
    market: { name: 'Offtake deals', icon: '📈', desc: 'Better prices for every product', unit: '× price', levels: [1.0, 1.08, 1.16, 1.25, 1.35], costs: [15000, 45000, 160000, 550000] },
    nitrogen: { name: 'Nitrogen supply', icon: '❄', desc: 'Cheaper liquid nitrogen', unit: '$/kg', levels: [0.12, 0.09, 0.065, 0.045], costs: [8000, 28000, 95000] },
    // Plant hall floor area: 12x8, 20x12, 30x18, 50x30, 80x50 m. A pre-engineered steel hall costs roughly $500-1000 per m2
    // built; at PRICE_SCALE the added floor runs $80-240 per m2, rising with span. Machine footprints are MACHINES[id].foot.
    room: { name: 'Plant hall', icon: '🏭', desc: 'More floor area for machines', unit: 'm²', levels: [160, 240, 540, 1500, 4000], costs: [12000, 45000, 160000, 600000], dims: [[16, 10], [20, 12], [30, 18], [50, 30], [80, 50]] },
    // Yard storage for held product (inventory module): concrete push-wall bays, 10 x 10 m with 3 m interlocking-block walls, one
    // product per bay. bayT: a bay stacked 2 m deep holds about 60 t of bales or loose shred at 0.3 t/m3 bulk density. Costs: a bay
    // runs $12-15k built (blocks, slab, drainage); at PRICE_SCALE that is about $2,750 per bay added (2, 4, 8, 16 bays per level).
    // rent.own: a bay on your own land still costs about $8 per batch (100 m2 of industrial land at ~$1.5/m2/month, one batch a
    // working day). rent.hired: stock that overflows into a hired bay at a neighbouring yard costs about $40 per batch (outdoor
    // industrial storage at ~$3/m2/month plus a loader in and out). smallT: lots under 3 t (a few bales or big bags) sit together
    // on the bagged-goods rack and count as one shared bay between them, as a yard does with its odds and ends.
    storage: { name: 'Yard storage', icon: '🏗', desc: 'More yard bays for held stock', unit: 'bays', levels: [2, 4, 8, 16, 32], costs: [5500, 11000, 22000, 44000], bayT: 60, smallT: 3, rent: { own: 8, hired: 40 } }
  };
  /* ---------------- OFFICE AND FACILITY UPGRADES (module js/modules/facility.js) ----------------
   * Same shape as PLANT_UPGRADES: levels[0] is the baseline a new yard has, costs[i] buys levels[i + 1]. Costs are real-world
   * figures at PRICE_SCALE like the machines. The module applies each effect; see the header of js/modules/facility.js.
   */
  const OFFICE_UPGRADES = {
    // scrap brokers take a 3-5% commission on offtake; selling direct to mills (LV 1-2) and hedging on the LME (LV 3) keeps it in the yard
    desk: { name: 'Trading desk', icon: '📊', desc: 'Sell direct and hedge: better offtake prices', unit: '× price', levels: [1.0, 1.03, 1.06, 1.10], costs: [12000, 40000, 140000] },
    // a sieve shaker, a stack of test sieves and a bench run about $25k; the lab reports a six-class sieve analysis of every product bin
    lab: { name: 'Sampling lab', icon: '🔬', desc: 'Sieve analysis of every product bin', unit: 'size classes', levels: [0, 6], costs: [5000] },
    // a SCADA control room with a historian (about $40k of HMI stations and licences) lets a whole shift be reviewed in minutes: 300x
    control: { name: 'Control room', icon: '🖥', desc: 'Review a shift in minutes: faster sim speed', unit: '× max speed', levels: [60, 300], costs: [8000] }
  };
  const FACILITY_UPGRADES = {
    // without a certified weighbridge loads are taken on the seller's ticket and a batch is what the yard can hand-check; an 18 m
    // 60 t pit weighbridge ($30-60k installed) takes a full semi-trailer (20 t payload) per weigh, a second deck doubles that, and
    // a drive-through twin lane with unmanned ticketing takes B-double road trains (80 t)
    weighbridge: { name: 'Weighbridge', icon: '⚖', desc: 'Bigger loads accepted per batch', unit: 't per batch', levels: [0, 20, 40, 80], costs: [6000, 18000, 50000] },
    // vendor field service bills travel and labour at a 15-30% premium over an in-house crew with a crane bay (LV 1); a hardfacing
    // station (LV 2) rebuilds hammers and liners for about half the price of new parts
    maint: { name: 'Maintenance bay', icon: '🔧', desc: 'Cheaper service and wear parts', unit: '× service cost', levels: [1.0, 0.85, 0.70], costs: [9000, 30000] },
    // NEMA MG-1 service factor: a motor on a stiff dedicated 11 kV supply runs continuously at 1.15x nameplate, while the start-up
    // voltage sag of a shared LV feed forces a derate. A 2 MVA transformer bay costs about $100k, a second bay with ring main $350k
    substation: { name: 'Power substation', icon: '🔌', desc: 'Drives run at their service factor', unit: '× rated power', levels: [1.0, 1.08, 1.15], costs: [20000, 70000] },
    // shredder fines and baghouse dust (1-2% of feed) go to landfill at $50-60/t and dust-suppression water is bought by the m3: a
    // baghouse (LV 1) keeps the fines dry and saleable with the fluff, a closed-loop water plant (LV 2) recycles media and wash water
    treatment: { name: 'Dust & water treatment', icon: '💧', desc: 'Lower disposal and water cost', unit: '/t saved', levels: [0, 1.0, 2.0], costs: [7000, 25000] },
    // liquid nitrogen by tanker into a 20,000 L bulk tank costs about 15% less per kg than micro-bulk deliveries, and a telemetry-managed
    // tank farm on a take-or-pay contract gets the full bulk rate, about 30% below
    ln2farm: { name: 'Nitrogen tank farm', icon: '🧊', desc: 'Bulk liquid nitrogen deliveries', unit: '× LN2 price', levels: [1.0, 0.85, 0.70], costs: [10000, 35000] }
  };
  // Rank is read from net worth: bank plus what the plant would sell for.
  const RANKS = [[0, 'Scrapyard'], [120000, 'Recycler'], [500000, 'Processor'], [2500000, 'Plant operator'], [12000000, 'Industrial group'], [60000000, 'Mega-plant']];   // balance pass #12: roughly 10 / 25 / 45 / 80 / 140 batches. #344: the advice follower reaches Industrial group in ~160-245 and Mega-plant in ~240-345 with the $1M and $10M lot tiers (it was ~400 and ~1,500)

  /* ---------------- SOURCES ---------------- */
  const SOURCES = [
    ['How it Works: Crushers, Grinding Mills and Pulverizers (GlobalSpec)', 'https://insights.globalspec.com/article/5353/how-it-works-crushers-grinding-mills-and-pulverizers'],
    ['Size Reduction (University of Michigan Chemical Engineering Encyclopedia)', 'https://encyclopedia.che.engin.umich.edu/size-reduction/'],
    ['Bond Work Index Formula (911Metallurgist)', 'https://www.911metallurgist.com/blog/bond-work-index-formula-equation/'],
    ['Eddy current separator (Wikipedia)', 'https://en.wikipedia.org/wiki/Eddy_current_separator'],
    ['Zato: high-purity zorba (Recycling Today)', 'https://www.recyclingtoday.com/article/zato-equipment-combination-unlocks-high-purity-zorba/'],
    ['Size Reduction Equipment Review (BioCycle)', 'https://www.biocycle.net/size-reduction-equipment-review/'],
    ['Woodchipper (Wikipedia)', 'https://en.wikipedia.org/wiki/Woodchipper'],
    ['Single-Shaft vs. Dual Shaft Shredders (Arlington Machinery)', 'https://www.arlingtonmachinery.com/knowledge-center/choosing-a-shredder/'],
    ['Cryogenic grinding in tire recycling', 'https://xray.greyb.com/tires/cryogenic-grinding'],
    ['Energy-efficient comminution with VSI and HPGR (Materials, MDPI)', 'https://doi.org/10.3390/ma18153553'],
    ['Colloid Mill vs. Homogenizer (Pion)', 'https://www.pion-inc.com/blog/what-is-a-colloid-mill-how-does-it-compare-to-a-homogenizer'],
    ['Scrap metal size reduction techniques (Okon Recycling)', 'https://www.okonrecycling.com/industrial-scrap-metal-recycling/steel-and-aluminum/scrap-metal-size-reduction-techniques/'],
    ['Improving energy efficiency in aluminum melting (U.S. DOE Industrial Technologies Program)', 'https://www.energy.gov/sites/prod/files/2013/11/f4/aluminum_melting.pdf']
  ];

  // May a global hotkey act on this keydown? Not while typing, on a modified key (Ctrl+1 is the browser's), with a focused
  // button or link (Space must activate it; #btn-run is the exception, Space runs the batch), or behind an open modal (#197).
  const HOTKEY_MODAL = '.modal:not(.hidden), .overlay:not(.hidden):not(#station):not(#drawer), #station:not(.hidden), #drawer:not(.hidden)[aria-modal], #endgame:not(.hidden)';   // #endgame: the end-game card (#236); #drawer only while modal, a side panel at desktop width (#257); #310: an open station is modal too
  function hotkeyOk(e, doc) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return false;
    if (t && t.closest && !t.closest('#btn-run') && t.closest('button, a, [role="button"]')) return false;
    if (doc && doc.querySelector && doc.querySelector(HOTKEY_MODAL)) return false;
    return true;
  }

  G.CS = G.CS || {};
  Object.assign(G.CS, { hotkeyOk: hotkeyOk });
  Object.assign(G.CS, { PRICE_SCALE: PRICE_SCALE, STARTER_MACHINES: STARTER_MACHINES, START_BANK: START_BANK, LEVEL_MAX: LEVEL_MAX, LEVEL_FX: LEVEL_FX, levelCost: levelCost, PLANT_UPGRADES: PLANT_UPGRADES, RANKS: RANKS, MECH: MECH, MECH_LABEL: MECH_LABEL, MATERIALS: MATERIALS, MAT_ORDER: MAT_ORDER, MACHINES: MACHINES, MACHINE_GROUPS: MACHINE_GROUPS, FEEDS: FEEDS, LINES: LINES, SOURCES: SOURCES });
  Object.assign(G.CS, { OFFICE_UPGRADES: OFFICE_UPGRADES, FACILITY_UPGRADES: FACILITY_UPGRADES });

  /* #279: the output ports a machine offers, one list for the game, the save checks, blueprints and the plant floor
   * (a sorter has one port per material plus rejects; a furnace pours product and dross) */
  function portsOf(M) { return M.omni && M.outs ? Object.keys(M.outs) : M.kind === 'separator' ? ['extract', 'residue'] : M.kind === 'conditioner' ? ['product'] : M.kind === 'furnace' ? ['product', 'dross'] : ['product', 'rejects']; }
  /* #262: a saved line made safe to run. A node needs a known machine and a finite integer uid (1..MAX_UID), unused so far;
   * others are dropped. A src must name an earlier kept node and one of its real ports, else the node reads the head feed.
   * Without this a missing uid or port threw in the renderers on every boot, and only clearing site data got past it. */
  const MAX_UID = 1e6;
  function cleanLine(line) {
    const M = G.CS.MACHINES, seen = new Map(), out = [];
    for (const n of line) {
      if (!n || typeof n !== 'object' || (M && !M[n.m]) || !Number.isInteger(n.uid) || n.uid < 1 || n.uid > MAX_UID || seen.has(n.uid)) continue;
      const s = n.src, from = s && typeof s === 'object' ? seen.get(s.uid) : null;
      const ok = from && (!M || (typeof s.port === 'string' && portsOf(M[from.m]).indexOf(s.port) >= 0));
      seen.set(n.uid, n); out.push(s == null ? n : Object.assign({}, n, { src: ok ? { uid: s.uid, port: s.port } : 'feed' }));   // a node with no src is left as saved
    }
    return out;
  }
  Object.assign(G.CS, { portsOf: portsOf, cleanLine: cleanLine });

  /* #282: the Reduce motion choice for the pages without the game (plant floor, gallery): the in-game toggle when it was set
   * ('1' on, '0' off), else the OS setting. Same rule as modes.js motionPref. */
  function reduceMotion() {
    let v = null; try { v = G.localStorage && G.localStorage.getItem('crunchsim.reduceMotion'); } catch (e) { /* storage blocked */ }
    if (v === '1') return true; if (v === '0') return false;
    try { return typeof G.matchMedia === 'function' && G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  G.CS.reduceMotion = reduceMotion;
})(typeof window !== 'undefined' ? window : globalThis);
