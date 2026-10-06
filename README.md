# CrunchSim

A simulator game of how industry crunches stuff into bits, played as a plant-building score game.

Feed a mix of materials into a line of real industrial machines, run a batch, and watch what happens in a cross-section "machine cam" while mission-control telemetry reports particle size, reduction ratio, energy, power, wear and product value. Grinding earns credits into your bank. The bank buys machines and upgrades. Your score is your net worth.

## Two game modes

Each mode keeps its own save; switch any time from the toolbar (the first launch asks).

- **Progress**: build your plant on your own. Buy scrap from the six-tier auction board ($1k to $100k), grind, sort, refine and sell, and level up from Scrapyard to Mega-plant. No rivals.
- **Rivals**: auction rounds against three rival yards (Ironside Shredding, a volume buyer; Magpie Salvage, a bargain hunter; Redline Non-Ferrous, a copper specialist). Each round three large bins come up as cards, each heavy in one category (ferrous, non-ferrous, electronics and precious metal, wood, rubber and plastic, aggregate, gels, a mixed skip). The four players bid in open ascending steps of 5%; a player who wins a bin sits out the rest of the round, so one player always goes home with nothing, and that player runs their MISC bin instead (in Rivals your MISC re-runs only in a round where you won no bin). A market panel beside the cards shows the round's HOT and COLD materials and the price of everything in the bins. The next round opens when your yard is empty. Bin sizes grow with your plant. A match runs 8, 12 or 20 rounds (12 by default) and ends on a final standings screen ranked by net worth: each rival yard starts where you start and earns from the bins it wins at its own yield (an established shredder recovers about half the full sorted value, the copper specialist more on non-ferrous and electronics), so its net worth, plant and purse grow over the match; the league on the auction screen shows them, and a rival that drops out of a bin says why. tests/rivals-match.js plays 40 seeded matches per strategy to keep the rivals honest: a fair-value bidder averages second place, outbidding everyone earns far less, passing every round finishes last.

## The game loop

![From auction to sale: buy lots, haul in, offload, shred, sort into buckets, smelt and sell](docs/process.svg)

- **The plant screen.** The main screen holds only the feed and the plant. A PROJECTED line above the stations shows the margin per tonne and for the batch, and what your last change did to it; every station has a − / + row per setting, so you can tune the whole line against profit without opening each station (click a station for its full view). Your stations run left to right in the order you placed them, three at a time with arrows for longer lines. Each one shows its machine at work in a live cam, the bins it fills (striped by material, green at 90% purity) and what is left over moving on to the next station. The last section is the end result in buckets: a material held at 60% purity or better has its own bucket to SELL or RE-RUN as the next batch's feed, and everything not yet separated sits in a MISC bucket to re-run through different machines. A re-run goes in as the shred it already is (its recorded size, so shredders do not bill for breaking lumps again) and enters at the first station that is not a shredder; pick any other entry station above the plant, and the stations ahead of it sit that batch out. After the batch the feed goes back to what you had before. Click a station to sit down at it (machine cam, settings, upgrades, telemetry). Everything else opens from the toolbar in a drawer with a CLOSE button: Flowsheet, Auction, Market, Contracts & jobs, Bank & upgrades, Rivals, Plant report and Event log.
- **Sorter slots.** The sorting hall holds five sorters to start (grinders and furnaces do not count). Slots six to ten are bought one at a time in Bank & upgrades for $25k, $75k, $200k, $500k and $1.2M; the day-one plant hall (16 x 10 m) fits a grinder and five sorters.
- **Refine for the big paydays.** The Refinery in Bank & upgrades starts with a smelting furnace ($25,000) that melts a sorted base-metal bucket into ingots or billet: paid at the ingot price for the metal in it, less melt loss and the energy to melt it, which beats selling scrap (10 t of 94% aluminum: $12,100 raw, $21,000 as ingots). The precious-metals refinery ($250,000) refines gold and silver into bars and buys a rich MISC concentrate by assay, paying 92% of the gold and silver in it less a treatment charge, the way e-scrap refiners do. REFINE sits next to SELL on the bucket list.
- **Start small.** You own a hammermill shredder, a magnetic drum and $2,800. Everything must be sorted to be sold: a bucket sells only when one material makes up 90% or more of it, and cleaner buckets pay a premium (85% of list price at 90% pure, list at 95%, 125% at 99%). The magnet pulls the steel out clean; everything still mixed lands in the MISC bucket, which never sells and waits to be re-run through other sorters. One more sorter on the magnet's leftovers rarely makes anything pure on its own, so NEXT PURCHASE in Bank & upgrades ranks pairs as well: an eddy current separator pulls the mixed metals and a sink-float tank then floats the aluminum out clean.
- **Buy at auction.** Material comes only from the scrap auction, or from re-running your MISC bucket: there is no buying feed by the tonne. The board always shows six lots, one per price tier ($1k, $3k, $8k, $20k, $50k, $100k), each about that much money's worth at its asking price; the cheap tiers are skips of mixed junk, the dear ones carry zorba, circuit boards and gold-plated pins. Rival yards bid against you. A won lot waits in the yard and feeds batch after batch until it runs out; several can wait, and LOAD picks the next. Each batch pays for power and consumables; the products go to the end buckets to sell, refine or re-run.
- **Buy and upgrade.** Twenty-five more machines can be bought from the Flowsheet drawer. Each machine type can be raised five levels for more capacity, efficiency, liner life and power. Plant upgrades raise the batch size, cut the power price, lift product prices and cut liquid nitrogen cost. Supplier contracts unlock richer feeds such as tires, zorba and quarry rubble. The Facility & office section (Bank & upgrades) sells a trading desk, a sampling lab, a control room, a weighbridge, a maintenance bay, a power substation, dust and water treatment and a nitrogen tank farm; the site drawing fills in as you buy them.
- **Take contracts.** Clients post jobs with a spec sheet: target material, purity, recovery, a size window and an energy cap. They supply the feed. Bins that meet the spec ship, stars decide the fee, and every job hides a machine that looks right but is wrong for that material.
- **Beat the rival yards.** Up to four named yards compete with you: a volume buyer, a bargain hunter, a copper specialist and a late sniper, entering over the first days of plant time with credit that grows as the game goes on. They bid on auction lots from the seller's declaration through their own bias and chase the market's HOT material, so you BID in 5% steps or BUY NOW at a 15% premium, and the high bid at the timer takes the lot. A contract or job you leave untaken for a shift of plant time goes to tender: rivals whose own flowsheets meet the spec quote, the client weighs fee, reputation and delivery time, and the winner holds the work until it delivers. The Rivals drawer keeps a league table (tonnes delivered, average stars, reputation) with your rank; lose one contract three times to the same rival and the log tells you what their plant has. A sandbox switch turns rivals off.
- **Rank up.** Net worth is bank plus everything you own. It moves you from Scrapyard through Recycler, Processor, Plant operator and Industrial group to Mega-plant.

Preset lines act as blueprints: loading one you cannot afford shows what to buy. Progress is saved in your browser; New Game in Bank & upgrades wipes it.

## What it simulates

**Materials:** steel, cast iron, aluminum, copper, brass, pot metal (zinc die-cast), wood, rubber, plastic, glass, granite, limestone, hydrogel and water. Each has density, a Bond work index (published values for the rocks, calibrated for the rest), ductility, conductivity, magnetism, abrasiveness and a response profile to each breaking mechanism at ambient, freezer and cryogenic temperature.

**Machines (26):**

| Family | Machines |
| --- | --- |
| Compression | Jaw crusher, cone crusher, roll crusher, high-pressure grinding rolls |
| Impact and shredding | Vertical shaft impactor, hammermill shredder, tub grinder, twin-shaft shear shredder, single-shaft shredder, granulator, drum chipper |
| Fine and cold | Ball mill, cryogenic mill, blast freezer |
| Hydraulic shear | Colloid mill, high-pressure homogenizer, high-pressure atomizer |
| Separation | Magnetic drum, eddy current separator, zig-zag air classifier, vibrating screen, sink-float tank, sensor sorter (XRT / LIBS) |
| Smelting | Induction furnace, electric arc furnace, reverberatory kiln |

**End game:** the Omniprocessor is the one fantasy machine. It unlocks at Mega-plant rank or once every contract has three stars, takes any feed down to a target size and sorts every material into a bin of its own. Its price, power, capacity and footprint are those of a real mega-shredder plant with its separation hall; its first completed batch shows an end-game card with the final score.

**Physics in the numbers:**

- Particle size distributions are Rosin-Rammler curves over 24 log-spaced size bins from 1 µm to 1 m.
- Comminution energy follows Bond's law, `E = 10 · Wi · (1/√P80 − 1/√F80)` kWh/t, divided by machine efficiency and by how well the machine's mechanism mix (compression, impact, shear, attrition, cutting, hydraulic shear) breaks that material.
- Brittle solids fracture under compression and impact. Ductile metals bend and need shear or cutting. Wood is cut or hammered. Rubber bounces unless chilled below its glass transition. Gel is sheared through micron gaps. Water cannot be crushed: freeze it and crush the ice, or atomize it.
- Separators apply partition curves: magnetic recovery, eddy-current force from conductivity over density, terminal velocity in air, screen aperture, float-sink by density, and a sensor sorter that recognises one chosen material on 10 to 150 mm pieces.
- Furnaces melt the metals they are built for into one bath cast as ingots: energy is the handbook melt enthalpy plus superheat divided by thermal efficiency (about 600 kWh/t for aluminum in an induction furnace, 450 kWh/t for steel in an arc furnace), oxidation to dross grows with superheat and with fines, and an ingot sells on the purity of the melt, so mixed metal makes worthless alloy soup.
- Each machine has capacity and rated power, so the slowest or most power-limited node sets the head feed rate. Wear accrues with abrasiveness, and worn machines lose efficiency until serviced.

## Play

**Play it online:** <https://jackgary86-dev.github.io/CrunchSim/> (the `main` branch, served by GitHub Pages). The 3D plant floor is at `plant3d.html` and the machine gallery at `gallery.html` under the same address. A single-file bundle for hosts that only allow inline code is built with `python tools/build.py` into `dist/`.

Open `index.html` in a browser. There is no build step and no dependency. To serve it:

```bash
python -m http.server 8000
```

Then browse to <http://localhost:8000>. On GitHub, enable Pages (Settings → Pages → deploy from the `main` branch, root folder) to host it.

**Controls:** Space runs or stops a batch, 1/2/3 sets simulation speed, M toggles sound, ? opens help. Click a flowsheet node to see it in the cam and edit its settings. Click a material name for its properties. Progress is saved in your browser.

**Plant floor in 3D:** `plant3d.html` lays a flowsheet out as a plant hall: an intake hopper that swallows a car, chair, tire or rock depending on the feed, labelled machine blocks along striped conveyors, and bins that fill with the sim's steady-state product masses. Fragments shrink at crushers and are routed at separators with the same partition curves the game uses, so moving a settings slider changes the traffic at once. Pick a preset feed and line or press "use my plant" to load the line saved by the game. It loads three.js r128 from cdnjs; drag to orbit, wheel to zoom, right-drag to pan.

## Project layout

```
index.html        page shell
css/style.css     mission-control theme
js/data.js        materials, machines, preset feeds and lines, prices, upgrades, ranks, sources
js/sim.js         physics core (no DOM): size distributions, Bond energy, breakage, separation, flowsheet evaluation
js/cam.js         animated machine cam engine and particle system
js/scenes-a.js    cam scenes: compression, rotor, shear, cutting, tumbling machines
js/scenes-b.js    cam scenes: hydraulic machines, freezer, separators
js/audio.js       synthesized sound (Web Audio)
js/score.js       contracts: spec sheets, shipping rule, stars and fees (no DOM)
js/app.js         UI, run loop, telemetry, game layer (bank, ownership, upgrades, contracts), persistence
plant3d.html      standalone 3D plant floor demo (three.js r128 from cdnjs; shares data, sim and score)
js/plant3d.js     plant-floor layout (pure, tested in Node) and the three.js renderer and controls
gallery.html      developer page: every machine cam scene running live
tools/build.py    bundles the game into one file for hosts that only allow inline code
tests/            Node scripts that exercise the physics core
```

Run the physics and contract checks with:

```bash
node tests/lines.js
```

```bash
node tests/contracts.js
```

```bash
node tests/sensor.js
node tests/furnace.js
node tests/plant3d-layout.js
node tests/facility.js
node tests/rivals.js
node tests/playtest.js
node tests/endgame.js
node tests/layout.js
node tests/precious.js
node tests/refinery.js
node tests/slots.js
node tests/round.js
node tests/rivals-match.js
```

## Sources

The equipment descriptions and material behaviour were drawn from these references:

- [How it Works: Crushers, Grinding Mills and Pulverizers (GlobalSpec)](https://insights.globalspec.com/article/5353/how-it-works-crushers-grinding-mills-and-pulverizers)
- [Size Reduction (University of Michigan Chemical Engineering Encyclopedia)](https://encyclopedia.che.engin.umich.edu/size-reduction/)
- [Bond Work Index Formula (911Metallurgist)](https://www.911metallurgist.com/blog/bond-work-index-formula-equation/)
- [Eddy current separator (Wikipedia)](https://en.wikipedia.org/wiki/Eddy_current_separator)
- [Zato equipment combination unlocks high-purity zorba (Recycling Today)](https://www.recyclingtoday.com/article/zato-equipment-combination-unlocks-high-purity-zorba/)
- [Size Reduction Equipment Review (BioCycle)](https://www.biocycle.net/size-reduction-equipment-review/)
- [Woodchipper (Wikipedia)](https://en.wikipedia.org/wiki/Woodchipper)
- [Single-Shaft vs. Dual Shaft Shredders (Arlington Machinery)](https://www.arlingtonmachinery.com/knowledge-center/choosing-a-shredder/)
- [Cryogenic grinding in tire recycling](https://xray.greyb.com/tires/cryogenic-grinding)
- [Energy-efficient gold flotation via VSI and HPGR comminution (Materials, MDPI)](https://doi.org/10.3390/ma18153553)
- [Colloid Mill vs. Homogenizer (Pion)](https://www.pion-inc.com/blog/what-is-a-colloid-mill-how-does-it-compare-to-a-homogenizer)
- [Scrap metal size reduction techniques (Okon Recycling)](https://www.okonrecycling.com/industrial-scrap-metal-recycling/steel-and-aluminum/scrap-metal-size-reduction-techniques/)
- [Bond work index values for limestone, granite, quartz and bauxite (ResearchGate)](https://www.researchgate.net/publication/343230685_Investigate_the_relationship_between_of_the_bond_work_index_and_the_physical_and_mechanical_properties_of_rocks_case_study_the_feed_of_Uremia_cement_plant)
