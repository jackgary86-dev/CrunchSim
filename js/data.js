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
  const MAT_ORDER = ['steel', 'castiron', 'aluminum', 'copper', 'brass', 'potmetal', 'wood', 'rubber', 'plastic', 'glass', 'granite', 'limestone', 'gel', 'water'];

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
    /* ---- separators ---- */
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
      eSpec: 0.4, cap: 120, capRef: 1, capExp: 0, pidle: 5, prated: 30, life: 1e9, price: 18000, service: 1100, wearInfo: 'n/a',
      settings: [S('aperture', 'Aperture', 'mm', 1, 150, 1, 25, true)],
      outs: { extract: 'Undersize', residue: 'Oversize' },
      how: 'A vibrating inclined deck with square openings: pieces smaller than the aperture fall through, bigger ones ride down the deck. It does not change particle size, it sorts by it. Real plants return the oversize to the crusher.',
      best: 'Sizing, scalping and fines removal.', avoid: 'Sticky or damp fines blind the mesh.'
    },
    sinkfloat: {
      name: 'Sink-float tank', short: 'SINK', cat: 'Separation', kind: 'separator', scene: 'sinkfloat',
      eSpec: 2.0, cap: 15, capRef: 1, capExp: 0, pidle: 10, prated: 40, life: 1e9, price: 65000, service: 3900, wearInfo: 'n/a', mediaCost: 1.2,
      settings: [S('sg', 'Medium density', 'g/cc', 1.0, 4.0, 0.05, 2.9)],
      outs: { extract: 'Floats (lighter)', residue: 'Sinks (heavier)' },
      how: 'Pieces are dropped into a liquid whose density is tuned between the materials you want to split. Anything lighter floats, anything heavier sinks. A medium at about 2.9 g/cc floats aluminum at 2.7 and sinks zinc, brass and copper: it is how mixed "zorba" is split into valuable fractions.',
      best: 'Splitting non-ferrous mixes by density.', avoid: 'Very fine material and anything porous that soaks the medium.'
    }
  };
  Object.keys(MACHINES).forEach(function (id) {
    const M = MACHINES[id]; M.id = id;
    M.defaults = {}; (M.settings || []).forEach(function (st) { M.defaults[st.id] = st.def; });
  });

  const MACHINE_GROUPS = [
    ['Compression', ['jaw', 'cone', 'roll', 'hpgr']],
    ['Impact and shred', ['vsi', 'hammer', 'tub', 'twin', 'single', 'granulator', 'chipper']],
    ['Fine and cold', ['ball', 'cryo', 'freezer']],
    ['Hydraulic', ['colloid', 'homog', 'atomizer']],
    ['Separation', ['magnet', 'eddy', 'air', 'screen', 'sinkfloat']]
  ];

  /* ---------------- PRESET FEEDS ---------------- */
  const FEEDS = {
    elv: { name: 'End-of-life vehicles', blurb: 'What a car shredder eats.', cost: 110, comp: { steel: 0.58, castiron: 0.07, aluminum: 0.07, copper: 0.015, brass: 0.01, potmetal: 0.025, rubber: 0.07, plastic: 0.08, glass: 0.03, wood: 0.01, gel: 0.02, water: 0.02 } },
    rubble: { name: 'Demolition rubble', blurb: 'Concrete, rebar and timber.', cost: -8, comp: { limestone: 0.5, granite: 0.2, steel: 0.1, wood: 0.1, glass: 0.05, plastic: 0.05 } },
    pallets: { name: 'Pallets with nails', blurb: 'Wood with a tramp-metal problem.', cost: -15, comp: { wood: 0.94, steel: 0.04, plastic: 0.02 } },
    tires: { name: 'Scrap tires', blurb: 'Rubber, steel belts and fabric.', cost: -70, comp: { rubber: 0.70, steel: 0.15, plastic: 0.15 } },
    zorba: { name: 'Zorba (mixed non-ferrous)', blurb: 'Aluminum with heavy metals.', cost: 1000, comp: { aluminum: 0.70, copper: 0.08, brass: 0.07, potmetal: 0.15 } },
    quarry: { name: 'Quarry run-of-mine', blurb: 'Granite and limestone.', cost: 5, comp: { granite: 0.6, limestone: 0.4 } },
    lab: { name: 'Gel and water', blurb: 'Soft stuff you cannot crush.', cost: 20, comp: { gel: 0.5, water: 0.5 } },
    gel: { name: 'Hydrogel', blurb: 'Pure gel blocks.', cost: 60, comp: { gel: 1 } },
    water: { name: 'Water', blurb: 'A bulk liquid.', cost: 0, comp: { water: 1 } }
  };

  /* ---------------- PRESET FLOWSHEETS ---------------- */
  // src: 'feed' or 'k:port' where k is the 1-based index of an earlier node.
  const LINES = {
    starter: {
      name: 'Starter yard', feed: 'elv', tons: 15,
      blurb: 'What you own on day one: tear, pull the steel, screen the rest.',
      nodes: [
        { m: 'twin', s: { width: 60 }, src: 'feed' },
        { m: 'magnet', s: { field: 250 }, src: '1:product' },
        { m: 'screen', s: { aperture: 40 }, src: '2:residue' }
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
    }
  };

  /* ---------------- GAME LAYER: bank, ownership, upgrades, ranks ---------------- */
  // Purchase prices are scaled from real-world figures so a session of play buys a plant.
  const PRICE_SCALE = 0.2;
  Object.keys(MACHINES).forEach(function (id) { const M = MACHINES[id]; M.price = Math.max(500, Math.round(M.price * PRICE_SCALE / 500) * 500); });
  const STARTER_MACHINES = ['jaw', 'twin', 'magnet', 'screen'];
  const START_BANK = 25000;
  const LEVEL_MAX = 5;
  const LEVEL_FX = { cap: 0.20, eta: 0.06, life: 0.30, power: 0.10 };   // per level, multiplicative on base
  function levelCost(M, lvl) { return Math.round(M.price * 0.45 * Math.pow(1.7, lvl) / 100) * 100; }
  const PLANT_UPGRADES = {
    logistics: { name: 'Feed logistics', icon: '🚚', desc: 'Bigger batches per run', unit: 't per batch', levels: [30, 60, 120, 250, 500], costs: [3000, 9000, 30000, 110000] },
    power: { name: 'Power contract', icon: '⚡', desc: 'Cheaper electricity', unit: '$/kWh', levels: [0.12, 0.10, 0.085, 0.07, 0.055], costs: [4000, 12000, 40000, 150000] },
    market: { name: 'Offtake deals', icon: '📈', desc: 'Better prices for every product', unit: '× price', levels: [1.0, 1.08, 1.16, 1.25, 1.35], costs: [15000, 45000, 160000, 550000] },
    nitrogen: { name: 'Nitrogen supply', icon: '❄', desc: 'Cheaper liquid nitrogen', unit: '$/kg', levels: [0.12, 0.09, 0.065, 0.045], costs: [8000, 28000, 95000] }
  };
  // Supplier contracts: some feeds must be unlocked before they can be bought.
  const FEED_UNLOCK = { elv: 0, pallets: 0, quarry: 0, water: 0, rubble: 2500, lab: 3000, gel: 3000, tires: 6000, zorba: 14000 };
  Object.keys(FEEDS).forEach(function (id) { FEEDS[id].unlock = FEED_UNLOCK[id] || 0; });
  // Rank is read from net worth: bank plus what the plant would sell for.
  const RANKS = [[0, 'Scrapyard'], [120000, 'Recycler'], [400000, 'Processor'], [1200000, 'Plant operator'], [4000000, 'Industrial group'], [15000000, 'Mega-plant']];

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
    ['Scrap metal size reduction techniques (Okon Recycling)', 'https://www.okonrecycling.com/industrial-scrap-metal-recycling/steel-and-aluminum/scrap-metal-size-reduction-techniques/']
  ];

  G.CS = G.CS || {};
  Object.assign(G.CS, { PRICE_SCALE: PRICE_SCALE, STARTER_MACHINES: STARTER_MACHINES, START_BANK: START_BANK, LEVEL_MAX: LEVEL_MAX, LEVEL_FX: LEVEL_FX, levelCost: levelCost, PLANT_UPGRADES: PLANT_UPGRADES, RANKS: RANKS, MECH: MECH, MECH_LABEL: MECH_LABEL, MATERIALS: MATERIALS, MAT_ORDER: MAT_ORDER, MACHINES: MACHINES, MACHINE_GROUPS: MACHINE_GROUPS, FEEDS: FEEDS, LINES: LINES, SOURCES: SOURCES });
})(typeof window !== 'undefined' ? window : globalThis);
