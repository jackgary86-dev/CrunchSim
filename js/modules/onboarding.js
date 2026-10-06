/* CrunchSim module: onboarding. Loaded after app.js; talks to the game only through CS.app (see the module interface in app.js).
 *
 * Ticket #25. Three things:
 *   1. The process cartoon (docs/process.svg) is inlined at the top of the help dialog. Its six numbered stages are
 *      buttons: click one and the help closes, the matching panel scrolls into view and glows for two seconds.
 *   2. Light CSS-only motion on the cartoon: the haul-in truck's wheels turn and the chunks falling out of the tipper
 *      bob. Both stop under prefers-reduced-motion.
 *   3. A first-run tour. When the save has no batches yet, closing the help opens a three-step overlay that points at
 *      the feed preset, the projected margin and RUN BATCH. Dismissing it, finishing it or starting a batch marks it
 *      done, and that flag persists through the 'save' / 'load' hooks so it is never shown again.
 *
 * The inline SVG is a copy of docs/process.svg with these edits, so nothing leaks into or collides with the page:
 *   - the <style> block is gone; its rules live in the stylesheet this module injects, scoped under .cs-process
 *     (the SVG used generic class names such as .num and .sub that css/style.css also defines)
 *   - every defs id is prefixed cp- (cp-wheel, cp-chunk, cp-arr ...) and the width/height attributes are dropped so
 *     the viewBox scales it
 *   - the six caption groups carry id="stage-<name>", data-stage and role="button"; the scenes above them share the
 *     data-stage so the whole strip is clickable
 *   - the animated wheels and chunks sit in a positioning <g>, because a CSS transform on an SVG element replaces its
 *     transform attribute instead of composing with it
 *
 * CS.Onboarding exposes the template, stage map and stylesheet so tests/onboarding.js can check them without a DOM.
 */
(function (G) {
  'use strict';
  G.CS = G.CS || {};
  const CS = G.CS;

  /* ---------------- the cartoon ---------------- */
  const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 620" role="img" aria-labelledby="cp-title cp-desc">
  <title id="cp-title">CrunchSim: from auction to sale</title>
  <desc id="cp-desc">Cartoon strip: scrap is bought at auction, trucked in and weighed, tipped into the intake bunker, shredded in a hammermill, sorted by magnet, air, eddy current, sink-float and sensor into buckets, smelted into ingots or baled, and sold; the credits buy the next lot and the next machine.</desc>
  <defs>
    <linearGradient id="cp-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d151f"/><stop offset="1" stop-color="#131c27"/></linearGradient>
    <linearGradient id="cp-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff6b2b"/></linearGradient>
    <linearGradient id="cp-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa8ff"/><stop offset="1" stop-color="#1f5a99"/></linearGradient>
    <marker id="cp-arr" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M0 0 L12 6 L0 12 z" fill="#7fe3ff"/></marker>
    <marker id="cp-arr2" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M0 0 L12 6 L0 12 z" fill="#ffb25c"/></marker>
    <g id="cp-chunk"><polygon points="-9,-6 6,-9 10,2 3,9 -8,7" /></g>
    <g id="cp-wheel"><circle r="13" fill="#2a3240" class="ol"/><circle r="5" fill="#8d98a6"/></g>
    <g id="cp-bucket"><path d="M-22 0 L22 0 L17 46 L-17 46 Z" class="ol"/><rect x="-25" y="-6" width="50" height="8" rx="3" fill="#3a4656" class="thin"/></g>
    <g id="cp-ingot"><path d="M-18 10 L-13 -6 L13 -6 L18 10 Z" class="thin"/></g>
    <g id="cp-person"><circle cy="-30" r="9" fill="#f1c9a5" class="thin"/><path d="M-14 -34 Q0 -50 14 -34 Z" fill="#ffb25c" class="thin"/><rect x="-10" y="-20" width="20" height="26" rx="5" fill="#2f6fb0" class="thin"/><rect x="-8" y="6" width="6" height="18" fill="#2a3240"/><rect x="2" y="6" width="6" height="18" fill="#2a3240"/></g>
  </defs>

  <rect width="1800" height="620" fill="url(#cp-sky)"/>
  <g stroke="#1e2a37" stroke-width="1" opacity=".5">
    <path d="M0 80 H1800 M0 160 H1800 M0 240 H1800 M0 320 H1800 M0 400 H1800 M0 480 H1800"/>
  </g>
  <rect x="0" y="470" width="1800" height="150" fill="#0a0f16"/>
  <rect x="0" y="468" width="1800" height="4" fill="#2a3a4b"/>
  <text x="900" y="44" text-anchor="middle" class="title">CRUNCHSIM · FROM AUCTION TO SALE</text>

  <!-- ===== 1 AUCTION ===== -->
  <g class="cp-stage" data-stage="auction" transform="translate(30,100)">
    <rect x="20" y="0" width="200" height="84" rx="8" fill="#c98f5a" class="ol"/>
    <rect x="34" y="84" width="12" height="60" fill="#8a5a33" class="thin"/><rect x="194" y="84" width="12" height="60" fill="#8a5a33" class="thin"/>
    <text x="120" y="34" text-anchor="middle" class="num" style="font-size:18px">SCRAP AUCTION</text>
    <text x="120" y="60" text-anchor="middle" class="tiny">LOTS CLOSE ON THE CLOCK</text>
    <!-- lot cards -->
    <g transform="translate(14,150)">
      <rect width="100" height="50" rx="6" fill="#e9f1f7" class="thin"/><text x="8" y="18" class="tiny">LOT 7 · CARS</text><text x="8" y="33" class="tiny">60 t · $110/t</text><rect x="58" y="36" width="36" height="11" rx="3" fill="#5cffb1"/><text x="76" y="45" text-anchor="middle" class="tiny" style="font-size:8px">GREAT</text>
    </g>
    <g transform="translate(122,150)">
      <rect width="100" height="50" rx="6" fill="#e9f1f7" class="thin"/><text x="8" y="18" class="tiny">LOT 9 · TIRES</text><text x="8" y="33" class="tiny">40 t · PAID $70</text><rect x="58" y="36" width="36" height="11" rx="3" fill="#ffb25c"/><text x="76" y="45" text-anchor="middle" class="tiny" style="font-size:8px">FAIR</text>
    </g>
    <g transform="translate(68,212)">
      <rect width="100" height="50" rx="6" fill="#e9f1f7" class="thin"/><text x="8" y="18" class="tiny">LOT 11 · "STEEL"</text><text x="8" y="33" class="tiny">80 t · $90/t ?</text><rect x="52" y="36" width="42" height="11" rx="3" fill="#ff5c6c"/><text x="73" y="45" text-anchor="middle" class="tiny" style="font-size:8px">TERRIBLE</text>
    </g>
    <!-- gavel -->
    <g transform="translate(205,120) rotate(-30)"><rect x="-6" y="0" width="12" height="44" rx="3" fill="#8a5a33" class="thin"/><rect x="-22" y="-16" width="44" height="18" rx="5" fill="#c98f5a" class="thin"/></g>
    <use href="#cp-person" transform="translate(236,262)"/>
  </g>

  <!-- arrow 1->2 -->
  <path d="M292 300 H330" stroke="#7fe3ff" stroke-width="5" marker-end="url(#cp-arr)"/>

  <!-- ===== 2 HAUL IN ===== -->
  <g class="cp-stage" data-stage="haulin" transform="translate(340,100)">
    <!-- gate -->
    <path d="M10 210 V60 Q110 0 210 60 V210" fill="none" stroke="#3a4656" stroke-width="8"/>
    <rect x="40" y="40" width="140" height="26" rx="6" fill="#1b2430" class="thin"/><text x="110" y="58" text-anchor="middle" class="tinyl">CRUNCHSIM PLANT</text>
    <!-- truck with a car on the trailer -->
    <g transform="translate(0,140)">
      <rect x="60" y="30" width="140" height="56" rx="4" fill="#8d98a6" class="ol"/>
      <!-- car silhouette -->
      <path d="M78 30 L92 8 L150 8 L166 30 Z" fill="#d8262c" class="thin"/><rect x="100" y="12" width="40" height="14" fill="#9ad9c9" class="thin"/>
      <circle cx="100" cy="30" r="8" fill="#2a3240" class="thin"/><circle cx="150" cy="30" r="8" fill="#2a3240" class="thin"/>
      <rect x="6" y="40" width="58" height="46" rx="6" fill="#ffb25c" class="ol"/><rect x="14" y="48" width="26" height="18" rx="3" fill="#9ad9c9" class="thin"/>
      <g transform="translate(32,92)"><use href="#cp-wheel" class="cp-wheel"/></g><g transform="translate(96,92)"><use href="#cp-wheel" class="cp-wheel"/></g><g transform="translate(130,92)"><use href="#cp-wheel" class="cp-wheel"/></g><g transform="translate(184,92)"><use href="#cp-wheel" class="cp-wheel"/></g>
      <path d="M-30 50 h22 M-36 66 h26 M-30 82 h22" stroke="#7fe3ff" stroke-width="3" opacity=".7"/>
    </g>
    <!-- weighbridge -->
    <rect x="40" y="250" width="170" height="14" rx="4" fill="#3a4656" class="thin"/>
    <rect x="86" y="268" width="82" height="24" rx="4" fill="#1b2430" class="thin"/><text x="127" y="285" text-anchor="middle" class="tinyl" style="fill:#5cffb1">60.0 t</text>
  </g>

  <path d="M562 300 H600" stroke="#7fe3ff" stroke-width="5" marker-end="url(#cp-arr)"/>

  <!-- ===== 3 OFFLOAD INTO BIN ===== -->
  <g class="cp-stage" data-stage="offload" transform="translate(610,66)">
    <!-- tipper tilted -->
    <g transform="translate(20,150) rotate(-22 120 60)">
      <rect x="50" y="20" width="120" height="50" rx="4" fill="#8d98a6" class="ol"/>
      <g fill="#8d98a6"><use href="#cp-chunk" transform="translate(70,10)" fill="#8d98a6"/><use href="#cp-chunk" transform="translate(100,6)" fill="#d8262c"/><use href="#cp-chunk" transform="translate(130,10)" fill="#b98a54"/><use href="#cp-chunk" transform="translate(155,16)" fill="#cfd9e2"/></g>
      <rect x="0" y="30" width="52" height="40" rx="6" fill="#ffb25c" class="ol"/>
      <use href="#cp-wheel" transform="translate(26,76)"/><use href="#cp-wheel" transform="translate(96,76)"/><use href="#cp-wheel" transform="translate(140,76)"/>
    </g>
    <!-- falling chunks -->
    <g class="cp-falling"><g transform="translate(178,210)"><use href="#cp-chunk" fill="#8d98a6" class="thin cp-fall"/></g><g transform="translate(196,236)"><use href="#cp-chunk" fill="#d98a5b" class="thin cp-fall"/></g><g transform="translate(170,250)"><use href="#cp-chunk" fill="#b98a54" class="thin cp-fall"/></g><g transform="translate(200,268)"><use href="#cp-chunk" fill="#cfd9e2" class="thin cp-fall"/></g></g>
    <!-- bunker -->
    <path d="M120 290 L240 290 L220 360 L140 360 Z" fill="#1b2430" class="ol"/>
    <path d="M136 326 Q180 286 224 326 L218 350 L142 350 Z" fill="#3a4656"/>
    <g class="thin"><use href="#cp-chunk" transform="translate(160,322)" fill="#8d98a6"/><use href="#cp-chunk" transform="translate(182,314)" fill="#e8695a"/><use href="#cp-chunk" transform="translate(204,324)" fill="#9ad9c9"/><use href="#cp-chunk" transform="translate(172,338)" fill="#b98a54"/><use href="#cp-chunk" transform="translate(196,340)" fill="#cfd9e2"/></g>
    <rect x="118" y="364" width="124" height="20" rx="4" fill="#0f1a26" class="thin"/><text x="180" y="378" text-anchor="middle" class="tinyl">INTAKE BUNKER · 2,400 t</text>
  </g>

  <path d="M862 300 H900" stroke="#7fe3ff" stroke-width="5" marker-end="url(#cp-arr)"/>

  <!-- ===== 4 SHRED ===== -->
  <g class="cp-stage" data-stage="shred" transform="translate(910,100)">
    <path d="M30 150 L130 150 L110 200 L50 200 Z" fill="#1b2430" class="ol"/>
    <rect x="20" y="200" width="120" height="110" rx="10" fill="#242e3a" class="ol"/>
    <circle cx="80" cy="255" r="38" fill="#0d131a" class="thin"/>
    <g transform="translate(80,255)" fill="#8d98a6" class="thin">
      <rect x="-5" y="-34" width="10" height="68" rx="3"/><rect x="-34" y="-5" width="68" height="10" rx="3"/>
      <rect x="-26" y="-26" width="10" height="52" rx="3" transform="rotate(45)"/><rect x="-26" y="-26" width="10" height="52" rx="3" transform="rotate(-45)"/>
      <circle r="8" fill="#10151c"/>
    </g>
    <!-- sparks and pieces flying out -->
    <g fill="#ffd27a"><circle cx="118" cy="232" r="3"/><circle cx="126" cy="246" r="2.5"/><circle cx="122" cy="262" r="2"/></g>
    <g class="thin"><use href="#cp-chunk" transform="translate(150,290) scale(.55)" fill="#8d98a6"/><use href="#cp-chunk" transform="translate(166,298) scale(.5)" fill="#d8262c"/><use href="#cp-chunk" transform="translate(182,292) scale(.55)" fill="#b98a54"/></g>
    <rect x="18" y="318" width="124" height="20" rx="4" fill="#0f1a26" class="thin"/><text x="80" y="332" text-anchor="middle" class="tinyl">HAMMERMILL · 2 MW</text>
    <path d="M30 150 h100" stroke="#ffb25c" stroke-width="3" stroke-dasharray="8 5"/>
  </g>

  <path d="M1102 300 H1140" stroke="#7fe3ff" stroke-width="5" marker-end="url(#cp-arr)"/>

  <!-- ===== 5 SORT ===== -->
  <g class="cp-stage" data-stage="sort" transform="translate(1150,70)">
    <!-- conveyor -->
    <rect x="0" y="286" width="400" height="12" rx="6" fill="#20252d" class="thin"/>
    <g stroke="#3a4656" stroke-width="2"><path d="M14 288 v8 M34 288 v8 M54 288 v8 M74 288 v8 M94 288 v8 M114 288 v8 M134 288 v8 M154 288 v8 M174 288 v8 M194 288 v8 M214 288 v8 M234 288 v8 M254 288 v8 M274 288 v8 M294 288 v8 M314 288 v8 M334 288 v8 M354 288 v8 M374 288 v8"/></g>
    <!-- magnet drum -->
    <g transform="translate(40,230)">
      <circle r="26" fill="#2a3240" class="ol"/>
      <path d="M0 0 L26 0 A26 26 0 0 0 0 -26 Z" fill="#b84a4a"/><path d="M0 0 L0 -26 A26 26 0 0 0 -26 0 Z" fill="#3b6ea5"/><path d="M0 0 L-26 0 A26 26 0 0 0 0 26 Z" fill="#b84a4a"/><path d="M0 0 L0 26 A26 26 0 0 0 26 0 Z" fill="#3b6ea5"/>
      <circle r="26" fill="none" class="thin"/>
      <g fill="#8d98a6" class="thin"><use href="#cp-chunk" transform="translate(-8,-40) scale(.5)"/><use href="#cp-chunk" transform="translate(10,-48) scale(.45)"/><use href="#cp-chunk" transform="translate(-2,-60) scale(.4)"/></g>
      <text x="0" y="-74" text-anchor="middle" class="tinyl">MAGNET</text>
    </g>
    <!-- zig-zag air column -->
    <g transform="translate(120,150)">
      <path d="M-10 130 L10 108 L-10 86 L10 64 L-10 42 L10 20 L-10 0" fill="none" stroke="#3a4656" stroke-width="6"/>
      <path d="M26 130 L46 108 L26 86 L46 64 L26 42 L46 20 L26 0" fill="none" stroke="#3a4656" stroke-width="6"/>
      <g fill="#b98a54" class="thin"><use href="#cp-chunk" transform="translate(18,100) scale(.45)"/><use href="#cp-chunk" transform="translate(14,66) scale(.45)" fill="#e8695a"/><use href="#cp-chunk" transform="translate(20,30) scale(.4)"/></g>
      <path d="M18 128 v-120" stroke="#7fe3ff" stroke-width="2" stroke-dasharray="3 5" opacity=".7"/>
      <text x="18" y="-10" text-anchor="middle" class="tinyl">AIR</text>
    </g>
    <!-- eddy current -->
    <g transform="translate(220,230)">
      <circle r="24" fill="#0d131a" class="ol"/>
      <g><path d="M0 0 L24 0 A24 24 0 0 0 17 -17 Z" fill="#b84a4a"/><path d="M0 0 L17 -17 A24 24 0 0 0 0 -24 Z" fill="#3b6ea5"/><path d="M0 0 L0 -24 A24 24 0 0 0 -17 -17 Z" fill="#b84a4a"/><path d="M0 0 L-17 -17 A24 24 0 0 0 -24 0 Z" fill="#3b6ea5"/><path d="M0 0 L-24 0 A24 24 0 0 0 -17 17 Z" fill="#b84a4a"/><path d="M0 0 L-17 17 A24 24 0 0 0 0 24 Z" fill="#3b6ea5"/><path d="M0 0 L0 24 A24 24 0 0 0 17 17 Z" fill="#b84a4a"/><path d="M0 0 L17 17 A24 24 0 0 0 24 0 Z" fill="#3b6ea5"/></g>
      <circle r="24" fill="none" class="thin"/>
      <path d="M26 -14 q26 -34 60 -22" fill="none" stroke="#cfd9e2" stroke-width="3" stroke-dasharray="4 4"/>
      <use href="#cp-chunk" transform="translate(62,-40) scale(.5)" fill="#cfd9e2" class="thin"/>
      <text x="0" y="-36" text-anchor="middle" class="tinyl">EDDY</text>
    </g>
    <!-- sink-float -->
    <g transform="translate(300,236)">
      <rect x="-28" y="-20" width="56" height="44" rx="4" fill="url(#cp-water)" class="ol"/>
      <use href="#cp-chunk" transform="translate(-10,-18) scale(.45)" fill="#cfd9e2" class="thin"/>
      <use href="#cp-chunk" transform="translate(8,12) scale(.45)" fill="#d98a5b" class="thin"/><use href="#cp-chunk" transform="translate(-12,14) scale(.4)" fill="#d9b94e" class="thin"/>
      <text x="0" y="-32" text-anchor="middle" class="tinyl">SINK-FLOAT</text>
    </g>
    <!-- sensor arch -->
    <g transform="translate(386,230)">
      <path d="M-14 56 V-6 Q0 -22 14 -6 V56" fill="none" stroke="#5cffb1" stroke-width="5"/>
      <path d="M-4 0 v40 M4 0 v40" stroke="#5cffb1" stroke-width="1.5" stroke-dasharray="2 3"/>
      <text x="0" y="-30" text-anchor="middle" class="tinyl">SENSOR</text>
    </g>
    <!-- buckets -->
    <g transform="translate(0,318)">
      <g transform="translate(24,0)"><use href="#cp-bucket" fill="#8d98a6"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">STEEL</text></g>
      <g transform="translate(80,0)"><use href="#cp-bucket" fill="#b98a54"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">WOOD</text></g>
      <g transform="translate(136,0)"><use href="#cp-bucket" fill="#e8695a"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">PLASTIC</text></g>
      <g transform="translate(192,0)"><use href="#cp-bucket" fill="#cfd9e2"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">ALUMINUM</text></g>
      <g transform="translate(248,0)"><use href="#cp-bucket" fill="#d98a5b"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">COPPER</text></g>
      <g transform="translate(304,0)"><use href="#cp-bucket" fill="#d9b94e"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">BRASS</text></g>
      <g transform="translate(360,0)"><use href="#cp-bucket" fill="#9ad9c9"/><text x="0" y="62" text-anchor="middle" class="tinyl" style="font-size: 10px">GLASS</text></g>
    </g>
  </g>

  <path d="M1556 300 H1588" stroke="#7fe3ff" stroke-width="5" marker-end="url(#cp-arr)"/>

  <!-- ===== 6 SMELT / FINISH ===== -->
  <g class="cp-stage" data-stage="sell" transform="translate(1596,100)">
    <!-- furnace -->
    <rect x="10" y="170" width="90" height="100" rx="12" fill="#3a4656" class="ol"/>
    <rect x="30" y="140" width="18" height="40" fill="#2a3240" class="thin"/>
    <g fill="#8d98a6" opacity=".6"><circle cx="39" cy="128" r="8"/><circle cx="48" cy="114" r="10"/><circle cx="36" cy="100" r="7"/></g>
    <rect x="28" y="196" width="54" height="40" rx="6" fill="url(#cp-glow)" class="thin"/>
    <path d="M100 236 q24 4 34 36" fill="none" stroke="#ff8a2b" stroke-width="7" stroke-linecap="round"/>
    <!-- ingots -->
    <g transform="translate(140,286)">
      <use href="#cp-ingot" transform="translate(0,-6)" fill="#d98a5b"/><use href="#cp-ingot" transform="translate(-20,10)" fill="#cfd9e2"/><use href="#cp-ingot" transform="translate(20,10)" fill="#cfd9e2"/>
    </g>
    <text x="55" y="162" text-anchor="middle" class="tinyl">FURNACE</text>
    <!-- bale -->
    <g transform="translate(160,186)">
      <rect x="-22" y="-20" width="44" height="40" rx="4" fill="#e8695a" class="ol"/>
      <path d="M-22 -8 h44 M-22 8 h44" stroke="#0b1018" stroke-width="3"/>
      <text x="0" y="-30" text-anchor="middle" class="tinyl">BALER</text>
    </g>
    <rect x="8" y="318" width="194" height="20" rx="4" fill="#0f1a26" class="thin"/><text x="105" y="332" text-anchor="middle" class="tinyl">INGOTS · BALES · UNITS</text>
  </g>

  <!-- ===== 7 SELL (right edge) ===== -->
  <g class="cp-stage" data-stage="sell" transform="translate(1706,60)">
    <rect x="-30" y="330" width="90" height="12" rx="3" fill="#8a5a33" class="thin"/>
    <rect x="-70" y="30" width="150" height="26" rx="6" fill="#0a0f16" stroke="#ffb25c" stroke-width="2"/>
    <text x="5" y="48" text-anchor="middle" class="money">SOLD · $8,200/t</text>
  </g>

  <!-- bottom: captions and numbers -->
  <g transform="translate(0,500)">
    <g id="stage-auction" class="cp-stage" data-stage="auction" role="button" tabindex="0" transform="translate(150,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">1</text><text y="42" text-anchor="middle" class="cap">AUCTION</text><text y="62" text-anchor="middle" class="sub">Bid on lots. Some are deals, some are traps.</text></g>
    <g id="stage-haulin" class="cp-stage" data-stage="haulin" role="button" tabindex="0" transform="translate(450,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">2</text><text y="42" text-anchor="middle" class="cap">HAUL IN</text><text y="62" text-anchor="middle" class="sub">Trucked to the gate and weighed.</text></g>
    <g id="stage-offload" class="cp-stage" data-stage="offload" role="button" tabindex="0" transform="translate(730,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">3</text><text y="42" text-anchor="middle" class="cap">OFFLOAD</text><text y="62" text-anchor="middle" class="sub">Tipped into the intake bunker.</text></g>
    <g id="stage-shred" class="cp-stage" data-stage="shred" role="button" tabindex="0" transform="translate(990,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">4</text><text y="42" text-anchor="middle" class="cap">SHRED</text><text y="62" text-anchor="middle" class="sub">Hammermill breaks it into bits.</text></g>
    <g id="stage-sort" class="cp-stage" data-stage="sort" role="button" tabindex="0" transform="translate(1300,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">5</text><text y="42" text-anchor="middle" class="cap">SORT</text><text y="62" text-anchor="middle" class="sub">Magnet, air, eddy, sink-float, sensor. One bucket each.</text></g>
    <g id="stage-sell" class="cp-stage" data-stage="sell" role="button" tabindex="0" transform="translate(1640,0)"><circle r="16" fill="#ffb25c" class="thin"/><text y="6" text-anchor="middle" class="num">6</text><text y="42" text-anchor="middle" class="cap">SMELT &amp; SELL</text><text y="62" text-anchor="middle" class="sub">Ingots and bales go out. Credits come in.</text></g>
  </g>

  <!-- return loop -->
  <path d="M1778 445 V596 H24 V330" fill="none" stroke="#ffb25c" stroke-width="4" stroke-dasharray="10 7" marker-end="url(#cp-arr2)"/>
  <rect x="750" y="584" width="340" height="24" rx="5" fill="#0a0f16" class="thin"/>
  <text x="920" y="601" text-anchor="middle" class="money">CREDITS BUY THE NEXT LOT AND THE NEXT MACHINE</text>
</svg>
`;

  /* The six numbered stages and the panel each one jumps to. The first selector that exists wins, so auction and
   * haul-in go to the auction panel when ticket #24's module has added it and to the feed panel otherwise. */
  const STAGES = [
    { id: 'auction', n: 1, label: 'Auction', targets: ['#auction-panel', '#feed-panel'] },
    { id: 'haulin', n: 2, label: 'Haul in', targets: ['#auction-panel', '#feed-panel'] },
    { id: 'offload', n: 3, label: 'Offload', targets: ['#feed-panel'] },
    { id: 'shred', n: 4, label: 'Shred', targets: ['#line-panel', '#flow-panel'] },
    { id: 'sort', n: 5, label: 'Sort', targets: ['#bins', '#plant-panel', '#flow-panel'] },
    { id: 'sell', n: 6, label: 'Smelt & sell', targets: ['#bank-panel'] }
  ];

  /* The first-run tour. Each step points at the first selector that exists. */
  const STEPS = [
    { targets: ['#tool-auction', '#feed-panel'], title: '1 · BUY A LOT', text: 'Material comes only from the scrap auction (and later from re-running your MISC bucket). Open Auction in the toolbar: six lots from $1k to $100k. Buy one you can afford; it lands in the yard and loads as the feed.' },
    { targets: ['#plant-readouts', '#plant-panel', '#tool-report', '#flow-panel'], title: '2 · CHECK THE MARGIN', text: 'The Plant report (toolbar) projects product value, power and margin per tonne before you spend anything. A red margin means the batch loses money: change the line or the feed first.' },
    { targets: ['#btn-run'], title: '3 · RUN THE BATCH', text: 'Press RUN BATCH (or Space). The slowest machine sets the rate, the cam shows what happens inside, and the net lands in your bank when the batch completes.' }
  ];

  /* Injected once on boot. The first block is docs/process.svg's own stylesheet, scoped so it cannot restyle the page. */
  const CSS = [
    '.cs-process { margin: 0 0 14px; }',
    '.cs-process svg { display: block; width: 100%; max-width: 100%; height: auto; border: 1px solid var(--line-2); border-radius: 4px; background: #0d151f; }',
    '.cs-process .hint { margin-top: 4px; letter-spacing: 1px; }',
    '.cs-process .ol { stroke: #0b1018; stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; }',
    '.cs-process .thin { stroke: #0b1018; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }',
    '.cs-process .cap { font: 700 17px "Share Tech Mono", "Cascadia Mono", Consolas, monospace; fill: #7fe3ff; letter-spacing: 2px; }',
    '.cs-process .sub { font: 500 13px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; fill: #d6e2ee; letter-spacing: 0; }',
    '.cs-process .tiny { font: 600 11px "Share Tech Mono", Consolas, monospace; fill: #0b1018; letter-spacing: 1px; }',
    '.cs-process .tinyl { font: 600 11px "Share Tech Mono", Consolas, monospace; fill: #d6e2ee; letter-spacing: 1px; }',
    '.cs-process .num { font: 700 16px "Share Tech Mono", Consolas, monospace; fill: #0b1018; }',
    '.cs-process .title { font: 700 26px "Share Tech Mono", Consolas, monospace; fill: #7fe3ff; letter-spacing: 4px; }',
    '.cs-process .money { font: 700 15px "Share Tech Mono", Consolas, monospace; fill: #ffb25c; letter-spacing: 1px; }',
    /* clickable stages */
    '.cs-process [data-stage] { cursor: pointer; outline: none; }',
    '.cs-process [data-stage]:hover .cap, .cs-process [data-stage]:focus .cap { fill: #5cffb1; text-decoration: underline; }',
    '.cs-process [data-stage]:hover > circle, .cs-process [data-stage]:focus > circle { fill: #5cffb1; }',
    /* motion: wheels turn, falling chunks bob. CSS transforms replace the transform attribute, hence the wrapper <g>s. */
    '.cs-process .cp-wheel { transform-box: fill-box; transform-origin: 50% 50%; animation: cs-cp-spin 1.6s linear infinite; }',
    '.cs-process .cp-fall { animation: cs-cp-bob 1.8s ease-in-out infinite; }',
    '.cs-process .cp-falling g:nth-child(2) .cp-fall { animation-delay: -0.45s; }',
    '.cs-process .cp-falling g:nth-child(3) .cp-fall { animation-delay: -0.9s; }',
    '.cs-process .cp-falling g:nth-child(4) .cp-fall { animation-delay: -1.35s; }',
    '@keyframes cs-cp-spin { to { transform: rotate(-360deg); } }',
    '@keyframes cs-cp-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(7px); } }',
    /* the help dialog is widened a little so the strip stays legible; it is still capped by the viewport */
    '#help .modal-box { max-width: min(1180px, 96vw); }',
    /* two-second glow on the panel a stage jumps to */
    '.cs-hl { box-shadow: 0 0 0 2px var(--cyan), 0 0 22px rgba(127,227,255,.45); animation: cs-hl-pulse 1s ease-in-out 2; }',
    '@keyframes cs-hl-pulse { 50% { box-shadow: 0 0 0 2px var(--green), 0 0 26px rgba(92,255,177,.5); } }',
    /* first-run tour: a spotlight ring that dims everything else, and a callout box the player can still click past */
    '.cs-tour { position: fixed; inset: 0; z-index: 30; pointer-events: none; }',
    '.cs-tour .ring { position: absolute; border: 2px solid var(--cyan); border-radius: 5px; box-shadow: 0 0 0 9999px rgba(3,6,10,.55), 0 0 18px rgba(127,227,255,.45); transition: left .25s, top .25s, width .25s, height .25s; }',
    '.cs-tour .box { position: absolute; pointer-events: auto; width: 290px; max-width: calc(100vw - 32px); background: var(--panel); border: 1px solid var(--cyan); border-radius: 5px; padding: 12px 14px; box-shadow: 0 16px 40px rgba(0,0,0,.6); font-size: 12px; line-height: 1.45; }',
    '.cs-tour .step { font-family: var(--mono); font-size: 11px; letter-spacing: 2px; color: var(--muted); }',
    '.cs-tour h4 { font-family: var(--mono); font-size: 13px; letter-spacing: 2px; color: var(--cyan); margin: 4px 0 6px; font-weight: 400; }',
    '.cs-tour p { margin: 0 0 10px; }',
    '.cs-tour .btns { display: flex; justify-content: flex-end; gap: 6px; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .cs-process .cp-wheel, .cs-process .cp-fall, .cs-hl { animation: none; }',
    '  .cs-tour .ring { transition: none; }',
    '}'
  ].join('\n');

  CS.Onboarding = { SVG: SVG, STAGES: STAGES, STEPS: STEPS, CSS: CSS };

  /* ---------------- wiring ---------------- */
  let inited = false;
  function init(app) {
    if (inited) return; inited = true;
    const state = { done: false, tour: null };
    const hlTimers = new Map();
    const hasDom = () => typeof document !== 'undefined' && !!document.body;
    const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
    const first = (sels) => { let any = null; for (let i = 0; i < sels.length; i++) { const e = document.querySelector(sels[i]); if (e && e.getClientRects().length) return e; any = any || e; } return any; };   // prefer a target on screen: the calm layout keeps most panels in drawers

    /* persistence: 'load' fires before boot when this module ran first; when the app booted first, read S.ext directly */
    const readExt = (ext) => { state.done = !!(ext && ext.onboarding && ext.onboarding.done); };
    app.on('load', readExt);
    if (app.S && app.S.ext) readExt(app.S.ext);
    app.on('save', () => ({ onboarding: { done: state.done } }));

    app.on('boot', () => {
      if (!hasDom()) return;
      injectCss(); mountCartoon();
      if (app.S && app.S.batches === 0 && !state.done) armTour();
    });
    app.on('batchStart', () => { if (state.tour) endTour('finished: first batch running'); });
    app.on('newgame', () => { state.done = false; if (state.tour) endTour('reset'); if (app.S && app.S.batches === 0) armTour(); });
    app.on('tick', () => { if (state.tour) placeTour(); });

    function injectCss() {
      if (document.getElementById('cs-onboarding-css')) return;
      const st = document.createElement('style'); st.id = 'cs-onboarding-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }

    /* ---- cartoon in the help dialog ---- */
    function mountCartoon() {
      const box = document.querySelector('#help .modal-box');
      if (!box || box.querySelector('.cs-process')) return;
      const wrap = document.createElement('div'); wrap.className = 'cs-process';
      wrap.innerHTML = SVG + '<div class="small hint">THE LOOP · click a numbered stage to jump to that panel</div>';
      box.insertBefore(wrap, box.querySelector('p'));
      const stageOf = (e) => { const g = e.target && e.target.closest ? e.target.closest('[data-stage]') : null; return g ? g.getAttribute('data-stage') : null; };
      wrap.addEventListener('click', (e) => { const id = stageOf(e); if (id) goStage(id); });
      wrap.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const id = stageOf(e); if (id) { e.preventDefault(); goStage(id); } });
    }
    function goStage(id) {
      const st = STAGES.find((s) => s.id === id); if (!st) return;
      const target = first(st.targets); if (!target) return;
      const help = document.getElementById('help'); if (help) help.classList.add('hidden');
      const panel = target.closest('.panel') || target;
      target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      highlight(panel);
    }
    function highlight(el) {
      clearTimeout(hlTimers.get(el));
      el.classList.remove('cs-hl'); void el.offsetWidth; el.classList.add('cs-hl');
      hlTimers.set(el, setTimeout(() => { el.classList.remove('cs-hl'); hlTimers.delete(el); }, 2000));
    }

    /* ---- first-run tour ---- */
    function armTour() {
      if (CS.Guide) return;   // #79: the guided first lot replaces the panel tour
      // boot() opens the help only after it has emitted 'boot', so look at the dialog on the next task
      setTimeout(() => {
        const help = document.getElementById('help');
        const start = () => { if (!state.tour && !state.done && app.S.batches === 0) setTimeout(startTour, 350); };
        if (!help || help.classList.contains('hidden')) { start(); return; }
        const mo = new MutationObserver(() => { if (help.classList.contains('hidden')) { mo.disconnect(); start(); } });
        mo.observe(help, { attributes: true, attributeFilter: ['class'] });
      }, 0);
    }
    function startTour() {
      if (state.tour || !hasDom()) return;
      const layer = document.createElement('div'); layer.className = 'cs-tour';
      layer.innerHTML = '<div class="ring"></div><div class="box"><div class="step"></div><h4></h4><p></p><div class="btns"><button type="button" class="skip">SKIP TOUR</button><button type="button" class="next primary">NEXT</button></div></div>';
      document.body.appendChild(layer);
      const t = { layer, ring: layer.querySelector('.ring'), box: layer.querySelector('.box'), next: layer.querySelector('.next'), i: 0, target: null, onKey: (e) => { if (e.key === 'Escape') endTour('skipped'); } };
      state.tour = t;
      layer.querySelector('.skip').addEventListener('click', () => endTour('skipped'));
      t.next.addEventListener('click', () => { if (t.i >= STEPS.length - 1) endTour('done'); else showStep(t.i + 1); });
      window.addEventListener('keydown', t.onKey);
      showStep(0);
    }
    function showStep(i) {
      const t = state.tour; if (!t) return;
      const st = STEPS[i]; t.i = i;
      t.layer.querySelector('.step').textContent = 'FIRST BATCH · STEP ' + (i + 1) + ' OF ' + STEPS.length;
      t.layer.querySelector('h4').textContent = st.title;
      t.layer.querySelector('p').textContent = st.text;
      t.next.textContent = i === STEPS.length - 1 ? 'DONE' : 'NEXT';
      t.target = first(st.targets);
      if (t.target) t.target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      placeTour();
    }
    /* follow the target every frame: panels re-render, columns scroll and the window resizes under the overlay */
    function placeTour() {
      const t = state.tour; if (!t) return;
      const help = document.getElementById('help');
      const helpOpen = !!help && !help.classList.contains('hidden');
      t.layer.style.display = helpOpen ? 'none' : '';
      if (helpOpen) return;
      if (!t.target || !document.body.contains(t.target)) t.target = first(STEPS[t.i].targets);
      const vw = window.innerWidth, vh = window.innerHeight, bw = t.box.offsetWidth, bh = t.box.offsetHeight, gap = 14, pad = 6;
      let x = 16, y = 70;
      if (t.target) {
        const r = t.target.getBoundingClientRect();
        t.ring.style.display = '';
        t.ring.style.left = (r.left - pad) + 'px'; t.ring.style.top = (r.top - pad) + 'px';
        t.ring.style.width = (r.width + 2 * pad) + 'px'; t.ring.style.height = (r.height + 2 * pad) + 'px';
        if (r.right + gap + bw <= vw - 8) { x = r.right + gap; y = r.top; }
        else if (r.left - gap - bw >= 8) { x = r.left - gap - bw; y = r.top; }
        else { x = r.left; y = r.bottom + gap; }
      } else t.ring.style.display = 'none';
      t.box.style.left = clamp(x, 8, Math.max(8, vw - bw - 8)) + 'px';
      t.box.style.top = clamp(y, 8, Math.max(8, vh - bh - 8)) + 'px';
    }
    function endTour(why) {
      const t = state.tour; if (!t) return;
      state.tour = null;
      window.removeEventListener('keydown', t.onKey);
      if (t.layer.parentNode) t.layer.parentNode.removeChild(t.layer);
      state.done = true;
      if (typeof app.save === 'function') app.save();
      if (typeof app.log === 'function') app.log('Tour ' + why + '. Press ? for help: the strip at the top of it jumps to each panel.');
    }
  }

  /* CS.app is assigned inside boot(), which runs on DOMContentLoaded, so a module executing at parse time waits for
   * that; a module executing after boot (the bundled page) wires up at once. 'boot' replays for late listeners. */
  if (CS.app) init(CS.app);
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => { if (CS.app) init(CS.app); });
})(typeof window !== 'undefined' ? window : globalThis);
