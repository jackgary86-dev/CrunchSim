/* CrunchSim audio: everything is synthesized with the Web Audio API, no sample files.
 * Each material has a voice (rock thud, metal ring, wood crack, rubber thump, gel squelch, water splash, glass tinkle)
 * and each machine family has a running hum.
 *
 * #120: three buses under one master (plant: hums, crunches, belts; effects: UI, sales, the gavel, sorter voices, stingers;
 * music), each with its own volume saved per browser, and a compressor-limiter after the master so a crunch storm or stacked
 * stingers never clip. #121: the master fades out while the tab is hidden; the plant bus fades out on the title screen.
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  let ctx = null, master = null, hum = null, muted = false, noiseBuf = null, comp = null, buses = null, duckHidden = false, duckPlant = false;
  const VOL_KEY = 'crunchsim.volume', VOL_DEF = { master: 1, plant: 0.8, fx: 0.9, music: 0 };   // music is off until you turn it up
  let vol = Object.assign({}, VOL_DEF);
  try { const v = JSON.parse(localStorage.getItem(VOL_KEY) || 'null'); if (v && typeof v === 'object') for (const k in VOL_DEF) if (isFinite(+v[k])) vol[k] = Math.max(0, Math.min(1, +v[k])); } catch (e) { /* defaults */ }
  const masterLevel = () => (muted || duckHidden ? 0 : 0.5 * vol.master);
  function applyLevels(tc) {
    if (!ctx) return; const t = ctx.currentTime;
    master.gain.setTargetAtTime(masterLevel(), t, tc || 0.08);
    buses.plant.gain.setTargetAtTime(duckPlant ? 0 : vol.plant, t, tc || 0.15);
    buses.fx.gain.setTargetAtTime(vol.fx, t, 0.05);
    buses.music.gain.setTargetAtTime(vol.music, t, 0.2);
  }
  let lastCrunch = 0, crunchBudget = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) { if (ctx.state === 'suspended' && ctx.resume && !duckHidden) ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    try {
      ctx = new AC(); master = ctx.createGain(); master.gain.value = masterLevel();
      comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;   // a limiter in all but name
      master.connect(comp); comp.connect(ctx.destination);
      buses = { plant: ctx.createGain(), fx: ctx.createGain(), music: ctx.createGain() };
      for (const k in buses) buses[k].connect(master);
      applyLevels(0.01);
    } catch (e) { ctx = null; return false; }
    return true;
  }
  function ready() { if (!init() || muted || duckHidden) return false; if (ctx.state === 'suspended') ctx.resume(); return true; }
  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  let plantNow = false;   // set while a crunch voice plays, so its bursts and tones go to the plant bus
  function burst(t, o) {
    if (plantNow && !o.bus) o.bus = 'plant';
    const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1; f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(o.gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    src.connect(f); f.connect(g); g.connect(buses[o.bus || 'fx']); src.start(t); src.stop(t + o.dur + 0.02);
  }
  function tone(t, o) {
    if (plantNow && !o.bus) o.bus = 'plant';
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(o.gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    osc.connect(g); g.connect(buses[o.bus || 'fx']); osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  const VOICE = {
    rock(t, k) { burst(t, { dur: 0.09 + 0.08 * k, freq: 900, freqEnd: 180, q: 0.8, gain: 0.5 * k }); tone(t, { freq: 95, freqEnd: 40, dur: 0.18, gain: 0.45 * k }); for (let i = 0; i < 3; i++) burst(t + rnd(0.01, 0.08), { dur: 0.02, freq: rnd(1500, 3500), q: 3, gain: 0.18 * k }); },
    metal(t, k) { burst(t, { dur: 0.05, freq: 2600, q: 2, gain: 0.28 * k }); tone(t, { freq: rnd(1500, 2400), freqEnd: 1100, dur: 0.28, gain: 0.16 * k, type: 'triangle' }); tone(t, { freq: 120, freqEnd: 60, dur: 0.14, gain: 0.3 * k }); },
    iron(t, k) { VOICE.rock(t, k * 0.8); tone(t, { freq: rnd(900, 1300), freqEnd: 700, dur: 0.14, gain: 0.12 * k, type: 'triangle' }); },
    wood(t, k) { burst(t, { dur: 0.08, freq: 1500, freqEnd: 500, q: 1.4, gain: 0.45 * k }); for (let i = 0; i < 4; i++) burst(t + rnd(0.0, 0.12), { dur: 0.015, freq: rnd(2000, 5000), q: 4, gain: 0.2 * k }); },
    rubber(t, k) { tone(t, { freq: 130, freqEnd: 70, dur: 0.2, gain: 0.35 * k }); burst(t, { dur: 0.12, freq: 420, q: 0.6, gain: 0.18 * k, type: 'lowpass' }); },
    plastic(t, k) { burst(t, { dur: 0.07, freq: 1900, freqEnd: 900, q: 1.2, gain: 0.32 * k }); tone(t, { freq: 400, freqEnd: 250, dur: 0.06, gain: 0.1 * k, type: 'square' }); },
    gel(t, k) { burst(t, { dur: 0.22, freq: 600, freqEnd: 140, q: 0.5, gain: 0.3 * k, type: 'lowpass' }); tone(t, { freq: 320, freqEnd: 110, dur: 0.2, gain: 0.08 * k }); },
    water(t, k) { burst(t, { dur: 0.25, freq: 2500, freqEnd: 7000, q: 0.4, gain: 0.2 * k, type: 'highpass' }); burst(t + 0.03, { dur: 0.1, freq: 900, q: 1, gain: 0.1 * k }); },
    glass(t, k) { burst(t, { dur: 0.08, freq: 4000, freqEnd: 2500, q: 1.2, gain: 0.3 * k }); for (let i = 0; i < 4; i++) tone(t + rnd(0, 0.09), { freq: rnd(3000, 7000), dur: 0.12, gain: 0.08 * k, type: 'sine' }); },
    ice(t, k) { VOICE.glass(t, k * 0.8); VOICE.rock(t, k * 0.4); }
  };
  const MAT_VOICE = { granite: 'rock', limestone: 'rock', castiron: 'iron', potmetal: 'iron', steel: 'metal', aluminum: 'metal', copper: 'metal', brass: 'metal', silver: 'metal', gold: 'metal', wood: 'wood', rubber: 'rubber', plastic: 'plastic', gel: 'gel', water: 'water', glass: 'glass' };

  /* crunch(mat, strength, frozen). Rate-limited to keep dense particle storms from clipping. */
  function crunch(mat, k, frozen) {
    if (!ready()) return;
    const now = ctx.currentTime;
    crunchBudget = Math.min(6, crunchBudget + (now - lastCrunch) * 14); lastCrunch = now;
    if (crunchBudget < 1) return; crunchBudget -= 1;
    let v = MAT_VOICE[mat] || 'rock';
    if (frozen && (mat === 'water' || mat === 'gel')) v = 'ice';
    if (frozen && (mat === 'rubber' || mat === 'plastic')) v = 'glass';
    plantNow = true; try { VOICE[v](now, Math.max(0.15, Math.min(1.3, k || 1)) * 0.9); } finally { plantNow = false; }
  }

  /* machine hums by scene family */
  const HUM = {
    jaw: { f: 48, type: 'sawtooth', lp: 220, n: 0.12 }, cone: { f: 60, type: 'sawtooth', lp: 260, n: 0.12 }, roll: { f: 42, type: 'triangle', lp: 200, n: 0.08 }, hpgr: { f: 38, type: 'sawtooth', lp: 180, n: 0.14 },
    vsi: { f: 140, type: 'sawtooth', lp: 900, n: 0.2 }, hammer: { f: 90, type: 'sawtooth', lp: 600, n: 0.25 }, tub: { f: 70, type: 'sawtooth', lp: 500, n: 0.2 }, cryo: { f: 110, type: 'sawtooth', lp: 700, n: 0.3 },
    twin: { f: 30, type: 'sawtooth', lp: 150, n: 0.1 }, single: { f: 55, type: 'sawtooth', lp: 300, n: 0.12 }, granulator: { f: 160, type: 'sawtooth', lp: 1200, n: 0.15 }, chipper: { f: 120, type: 'sawtooth', lp: 900, n: 0.18 },
    ball: { f: 28, type: 'triangle', lp: 160, n: 0.3 }, colloid: { f: 220, type: 'sawtooth', lp: 1800, n: 0.08 }, homog: { f: 75, type: 'square', lp: 400, n: 0.1 }, atomizer: { f: 0, type: 'sine', lp: 3000, n: 0.35 },
    freezer: { f: 0, type: 'sine', lp: 1200, n: 0.3 }, magnet: { f: 50, type: 'sine', lp: 120, n: 0.03 }, eddy: { f: 180, type: 'triangle', lp: 500, n: 0.05 }, air: { f: 0, type: 'sine', lp: 1500, n: 0.3 }, screen: { f: 16, type: 'square', lp: 120, n: 0.1 }, sinkfloat: { f: 0, type: 'sine', lp: 500, n: 0.12 },
    sensor: { f: 0, type: 'sine', lp: 2500, n: 0.18 },  // belt whine and compressed-air hiss
    omni: { f: 66, type: 'triangle', lp: 900, n: 0.16 },  // #15: a deep rotor drone under the air-jet hiss
    furnace: { f: 34, type: 'triangle', lp: 420, n: 0.3 }  // #281: induction furnace, EAF and kiln: a low rumble under the burner roar, not a crusher drone
  };
  /* #200: hum and belt never create the context (that waits for a gesture: init() from the pointer and key handlers). Once a
   * source has sat at level 0 for IDLE_STOP seconds it is stopped and dropped, and rebuilt when the level comes back. */
  const IDLE_STOP = 3;
  function idle(src, level, t, kill) {
    if (level > 0.001) { src.quietSince = null; return false; }
    if (src.quietSince == null) src.quietSince = t;
    if (t - src.quietSince < IDLE_STOP) return false;
    kill(); return true;
  }
  function killHum() { try { hum.osc.stop(); hum.nz.stop(); hum.out.disconnect(); } catch (e) { /* already stopped */ } hum = null; }
  function setHum(scene, level) {
    if (!ctx) return;
    if (muted || duckHidden) level = 0;
    if (!hum && !(level > 0.001)) return;   // nothing playing and nothing to play: do not build the graph
    const cfg = HUM[scene] || HUM.jaw;
    if (!hum) {
      hum = { osc: ctx.createOscillator(), og: ctx.createGain(), nz: ctx.createBufferSource(), ng: ctx.createGain(), lp: ctx.createBiquadFilter(), out: ctx.createGain(), scene: null };
      hum.osc.type = cfg.type; hum.osc.frequency.value = cfg.f || 40; hum.nz.buffer = noise(); hum.nz.loop = true;
      hum.lp.type = 'lowpass'; hum.lp.frequency.value = cfg.lp; hum.og.gain.value = 0; hum.ng.gain.value = 0; hum.out.gain.value = 0;
      hum.osc.connect(hum.og); hum.og.connect(hum.lp); hum.nz.connect(hum.ng); hum.ng.connect(hum.lp); hum.lp.connect(hum.out); hum.out.connect(buses.plant);
      hum.osc.start(); hum.nz.start();
    }
    const t = ctx.currentTime;
    if (hum.scene !== scene) {
      hum.scene = scene; hum.osc.type = cfg.type;
      hum.osc.frequency.setTargetAtTime(cfg.f || 40, t, 0.1); hum.lp.frequency.setTargetAtTime(cfg.lp, t, 0.1);
      hum.og.gain.setTargetAtTime(cfg.f ? 0.18 : 0, t, 0.1); hum.ng.gain.setTargetAtTime(cfg.n, t, 0.1);
    }
    hum.out.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.55, t, 0.25);
    idle(hum, level, t, killHum);
  }
  function ui(kind) {
    if (!ready()) return; const t = ctx.currentTime;
    if (kind === 'click') tone(t, { freq: 1200, dur: 0.03, gain: 0.08, type: 'square' });
    else if (kind === 'ok') { tone(t, { freq: 660, dur: 0.06, gain: 0.12, type: 'triangle' }); tone(t + 0.07, { freq: 990, dur: 0.09, gain: 0.12, type: 'triangle' }); }
    else if (kind === 'deny') tone(t, { freq: 160, freqEnd: 110, dur: 0.16, gain: 0.14, type: 'square' });
    else if (kind === 'done') [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, { freq: f, dur: 0.18, gain: 0.1, type: 'triangle' }));
    else if (kind === 'alarm') { for (let i = 0; i < 3; i++) tone(t + i * 0.16, { freq: 880, dur: 0.1, gain: 0.1, type: 'square' }); }
  }
  /* the key moments (#81): a cash register for a sale, a gavel when a bin is sold at auction, a rising chime when a bucket
   * crosses 90% purity and starts to sell, a furnace roar for refining, a fanfare for a rank or a milestone */
  function fx(kind) {
    if (!ready()) return; const t = ctx.currentTime;
    if (kind === 'cash') { burst(t, { dur: 0.05, freq: 3000, q: 3, gain: 0.18 }); tone(t + 0.04, { freq: 1568, dur: 0.35, gain: 0.12, type: 'triangle' }); tone(t + 0.04, { freq: 2093, dur: 0.45, gain: 0.08, type: 'sine' }); burst(t + 0.12, { dur: 0.2, freq: 5000, q: 0.8, gain: 0.05, type: 'highpass' }); }
    else if (kind === 'gavel') { burst(t, { dur: 0.08, freq: 700, freqEnd: 250, q: 1.5, gain: 0.5 }); tone(t, { freq: 140, freqEnd: 70, dur: 0.12, gain: 0.35 }); burst(t + 0.28, { dur: 0.09, freq: 750, freqEnd: 260, q: 1.5, gain: 0.55 }); tone(t + 0.28, { freq: 150, freqEnd: 70, dur: 0.14, gain: 0.4 }); }
    else if (kind === 'chime') [784, 988, 1319].forEach((f, i) => tone(t + i * 0.07, { freq: f, dur: 0.3, gain: 0.09, type: 'sine' }));
    else if (kind === 'roar') { burst(t, { dur: 1.2, freq: 180, freqEnd: 90, q: 0.5, gain: 0.35, type: 'lowpass' }); burst(t + 0.1, { dur: 0.9, freq: 900, freqEnd: 300, q: 0.4, gain: 0.08 }); tone(t, { freq: 55, freqEnd: 45, dur: 1.1, gain: 0.2, type: 'sawtooth' }); }
    else if (kind === 'fanfare') [523, 659, 784, 1046, 1319].forEach((f, i) => { tone(t + i * 0.11, { freq: f, dur: 0.22 + (i === 4 ? 0.4 : 0), gain: 0.11, type: 'triangle' }); tone(t + i * 0.11, { freq: f / 2, dur: 0.2, gain: 0.05, type: 'square' }); });
  }
  function setMuted(m) { muted = !!m; applyLevels(0.05); if (CS.Music) CS.Music.level(vol.music); }
  function setVolume(ch, v) { if (!(ch in VOL_DEF)) return; vol[ch] = Math.max(0, Math.min(1, +v || 0)); try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch (e) { /* ignore */ } applyLevels(0.05); if (ch === 'music' && CS.Music) CS.Music.level(vol.music); }
  /* #121 #200: hiding the tab fades the master out, then suspends the context so nothing renders while hidden; returning resumes it */
  let suspendTimer = null;
  function duck(what, on) {
    if (what === 'hidden') {
      duckHidden = !!on; if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
      if (duckHidden) suspendTimer = setTimeout(() => { suspendTimer = null; if (duckHidden && ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend(); }, 400);
      else if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } else if (what === 'plant') duckPlant = !!on;
    applyLevels(0.2); if (CS.Music) CS.Music.level(vol.music);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => duck('hidden', document.hidden));

  /* #115 #116 #117 #118: the sorters, the belt and bin, the auction and the stingers. Rate-limited per kind so a busy sorter
   * is busy to the ear without a wall of noise. */
  const lastSfx = {};
  function sfx(kind, k) {
    if (!ready()) return; const t = ctx.currentTime; k = k == null ? 1 : k;
    const gap = { clank: 0.07, tick: 0.05, splash: 0.09, puff: 0.08, pop: 0.05, thud: 0.25, pour: 0.3, beep: 0.2, bid: 0.05 }[kind] || 0.12;
    if (lastSfx[kind] && t - lastSfx[kind] < gap) return; lastSfx[kind] = t;
    const P = { bus: 'plant' };
    switch (kind) {
      case 'clank': tone(t, Object.assign({ freq: rnd(300, 420), freqEnd: 180, dur: 0.12, gain: 0.12 * k, type: 'square' }, P)); burst(t, Object.assign({ dur: 0.04, freq: 2400, q: 3, gain: 0.12 * k }, P)); break;   // steel snapping onto the drum
      case 'tick': tone(t, Object.assign({ freq: rnd(1800, 2600), dur: 0.03, gain: 0.07 * k, type: 'triangle' }, P)); break;   // a piece flicked off the eddy current rotor
      case 'splash': burst(t, Object.assign({ dur: 0.18, freq: 1200, freqEnd: 400, q: 0.7, gain: 0.16 * k }, P)); burst(t + 0.04, Object.assign({ dur: 0.12, freq: 3200, q: 1.5, gain: 0.06 * k, type: 'highpass' }, P)); break;
      case 'puff': burst(t, Object.assign({ dur: 0.14, freq: 3000, freqEnd: 1200, q: 0.5, gain: 0.08 * k, type: 'highpass' }, P)); break;   // air takes the light fraction
      case 'pop': burst(t, Object.assign({ dur: 0.03, freq: 2600, q: 2, gain: 0.12 * k, type: 'highpass' }, P)); break;   // a sensor sorter's air jet
      case 'thud': tone(t, { freq: 90, freqEnd: 55, dur: 0.22, gain: 0.22 * k }); burst(t, { dur: 0.08, freq: 400, q: 0.8, gain: 0.12 * k, type: 'lowpass' }); break;   // a bale lands in its bucket
      case 'beep': tone(t, { freq: 1046, dur: 0.08, gain: 0.08, type: 'square' }); tone(t + 0.12, { freq: 1046, dur: 0.08, gain: 0.08, type: 'square' }); break;   // the weighbridge ticket
      case 'bell': [880, 1320].forEach((f, i) => tone(t + i * 0.02, { freq: f, freqEnd: f * 0.98, dur: 1.1, gain: 0.08, type: 'sine' })); break;   // a round opens
      case 'bid': tone(t, { freq: 440 * Math.pow(2, (k || 0) / 12), dur: 0.07, gain: 0.08, type: 'triangle' }); break;   // a bid, pitched per yard
      case 'outbid': tone(t, { freq: 520, freqEnd: 330, dur: 0.18, gain: 0.1, type: 'sawtooth' }); break;
      case 'going': tone(t, { freq: 660, dur: 0.09, gain: 0.07, type: 'square' }); break;   // going once / going twice
      case 'win': [523, 659, 784].forEach((f, i) => tone(t + i * 0.08, { freq: f, dur: 0.2, gain: 0.1, type: 'triangle' })); break;
      case 'lose': [392, 330].forEach((f, i) => tone(t + i * 0.12, { freq: f, dur: 0.22, gain: 0.08, type: 'triangle' })); break;
      case 'buy': tone(t, { freq: 784, dur: 0.06, gain: 0.08, type: 'triangle' }); tone(t + 0.06, { freq: 1175, dur: 0.12, gain: 0.08, type: 'triangle' }); break;   // a machine or a slot bought
      case 'place': tone(t, { freq: 1568, dur: 0.05, gain: 0.06, type: 'sine' }); break;   // your place in the match moved up
      case 'matchwin': [523, 659, 784, 1046, 1319, 1568].forEach((f, i) => tone(t + i * 0.1, { freq: f, dur: 0.28 + (i === 5 ? 0.6 : 0), gain: 0.1, type: 'triangle' })); break;
      case 'matchlose': [440, 392, 349, 294].forEach((f, i) => tone(t + i * 0.16, { freq: f, dur: 0.3, gain: 0.08, type: 'triangle' })); break;
    }
  }
  /* #116: a belt rumble under the plant while a batch runs (level 0..1 from the head rate) */
  let belt = null;
  function killBelt() { try { belt.src.stop(); belt.g.disconnect(); } catch (e) { /* already stopped */ } belt = null; }
  function setBelt(level) {
    if (!ctx) return;
    if (muted || duckHidden) level = 0;
    if (!belt && !(level > 0.001)) return;
    if (!belt) { belt = { src: ctx.createBufferSource(), f: ctx.createBiquadFilter(), g: ctx.createGain() }; belt.src.buffer = noise(); belt.src.loop = true; belt.f.type = 'lowpass'; belt.f.frequency.value = 180; belt.g.gain.value = 0; belt.src.connect(belt.f); belt.f.connect(belt.g); belt.g.connect(buses.plant); belt.src.start(); }
    belt.g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.18, ctx.currentTime, 0.3);
    idle(belt, level, ctx.currentTime, killBelt);
  }
  CS.Audio = { init, crunch, setHum, humTable: () => HUM, setBelt, ui, fx, sfx, cash: () => fx('cash'), setMuted, isMuted: () => muted, isHidden: () => duckHidden, setVolume, volumes: () => Object.assign({}, vol), duck, ctx: () => ctx, bus: (k) => (buses ? buses[k] : null) };
})(typeof window !== 'undefined' ? window : globalThis);

/* #119: optional music, synthesized (no files) on the music bus: a calm open loop for Progress, a tenser faster one for a
 * Rivals match, a quiet theme for the title screen. Notes are scheduled a little ahead on the audio clock. Off at volume 0. */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.Audio || typeof window === 'undefined') return;
  const A = CS.Audio, hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const THEMES = {
    // Progress: A minor, 72 bpm, slow arpeggios over Am F C G
    progress: { bpm: 72, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], arp: [0, 1, 2, 1], bass: true, hat: false, wave: 'triangle', gain: 0.05 },
    // Rivals: D minor, 116 bpm, a driving bass pulse and hats
    rivals: { bpm: 116, chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], arp: [0, 2, 1, 2, 0, 2, 1, 2], bass: true, hat: true, wave: 'sawtooth', gain: 0.03 },
    // the title: a soft high arpeggio
    title: { bpm: 64, chords: [[69, 72, 76], [65, 69, 72], [60, 64, 67], [67, 71, 74]], arp: [0, 1, 2, 1], bass: false, hat: false, wave: 'sine', gain: 0.045 }
  };
  let theme = 'title', timer = null, next = 0, step = 0;
  function note(ctx, bus, t, f, dur, gain, wave) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = wave; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function tick() {
    const ctx = A.ctx && A.ctx(), bus = A.bus && A.bus('music'); if (!ctx || !bus || A.isMuted() || !(A.volumes().music > 0)) return;
    const T = THEMES[theme] || THEMES.progress, beat = 60 / T.bpm / 2;   // eighth notes
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
    while (next < ctx.currentTime + 0.25) {
      const bar = Math.floor(step / 8) % T.chords.length, ch = T.chords[bar], i = step % 8;
      note(ctx, bus, next, hz(ch[T.arp[i % T.arp.length]] + 12), beat * 1.8, T.gain, T.wave);
      if (T.bass && i % 4 === 0) note(ctx, bus, next, hz(ch[0] - 12), beat * 3.5, T.gain * 1.6, 'triangle');
      if (T.hat && i % 2 === 1) { const n = ctx.createBufferSource(), g = ctx.createGain(), hp = ctx.createBiquadFilter(); const b = ctx.createBuffer(1, 2205, ctx.sampleRate), d = b.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; n.buffer = b; hp.type = 'highpass'; hp.frequency.value = 7000; g.gain.setValueAtTime(T.gain * 0.6, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.05); n.connect(hp); hp.connect(g); g.connect(bus); n.start(next); n.stop(next + 0.06); }
      next += beat; step++;
    }
  }
  function setTheme(t) { if (THEMES[t] && t !== theme) { theme = t; step = 0; } }
  /* #200: the 80 ms scheduler only runs while music is audible: not at volume 0, not muted, not with the tab hidden */
  function level(v) { if (A.isMuted() || A.isHidden()) v = 0; if (v > 0 && !timer) timer = setInterval(tick, 80); else if (!(v > 0) && timer) { clearInterval(timer); timer = null; } }
  level(A.volumes().music);
  CS.Music = { THEMES, setTheme, level, theme: () => theme };
})(typeof window !== 'undefined' ? window : globalThis);
