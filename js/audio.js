/* CrunchSim audio: everything is synthesized with the Web Audio API, no sample files.
 * Each material has a voice (rock thud, metal ring, wood crack, rubber thump, gel squelch, water splash, glass tinkle)
 * and each machine family has a running hum.
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  let ctx = null, master = null, hum = null, muted = false, noiseBuf = null;
  let lastCrunch = 0, crunchBudget = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    try { ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination); } catch (e) { ctx = null; return false; }
    return true;
  }
  function ready() { if (!init() || muted) return false; if (ctx.state === 'suspended') ctx.resume(); return true; }
  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function burst(t, o) {
    const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1; f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(o.gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + o.dur + 0.02);
  }
  function tone(t, o) {
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(o.gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + o.dur + 0.02);
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
  const MAT_VOICE = { granite: 'rock', limestone: 'rock', castiron: 'iron', potmetal: 'iron', steel: 'metal', aluminum: 'metal', copper: 'metal', brass: 'metal', wood: 'wood', rubber: 'rubber', plastic: 'plastic', gel: 'gel', water: 'water', glass: 'glass' };

  /* crunch(mat, strength, frozen). Rate-limited to keep dense particle storms from clipping. */
  function crunch(mat, k, frozen) {
    if (!ready()) return;
    const now = ctx.currentTime;
    crunchBudget = Math.min(6, crunchBudget + (now - lastCrunch) * 14); lastCrunch = now;
    if (crunchBudget < 1) return; crunchBudget -= 1;
    let v = MAT_VOICE[mat] || 'rock';
    if (frozen && (mat === 'water' || mat === 'gel')) v = 'ice';
    if (frozen && (mat === 'rubber' || mat === 'plastic')) v = 'glass';
    VOICE[v](now, Math.max(0.15, Math.min(1.3, k || 1)) * 0.9);
  }

  /* machine hums by scene family */
  const HUM = {
    jaw: { f: 48, type: 'sawtooth', lp: 220, n: 0.12 }, cone: { f: 60, type: 'sawtooth', lp: 260, n: 0.12 }, roll: { f: 42, type: 'triangle', lp: 200, n: 0.08 }, hpgr: { f: 38, type: 'sawtooth', lp: 180, n: 0.14 },
    vsi: { f: 140, type: 'sawtooth', lp: 900, n: 0.2 }, hammer: { f: 90, type: 'sawtooth', lp: 600, n: 0.25 }, tub: { f: 70, type: 'sawtooth', lp: 500, n: 0.2 }, cryo: { f: 110, type: 'sawtooth', lp: 700, n: 0.3 },
    twin: { f: 30, type: 'sawtooth', lp: 150, n: 0.1 }, single: { f: 55, type: 'sawtooth', lp: 300, n: 0.12 }, granulator: { f: 160, type: 'sawtooth', lp: 1200, n: 0.15 }, chipper: { f: 120, type: 'sawtooth', lp: 900, n: 0.18 },
    ball: { f: 28, type: 'triangle', lp: 160, n: 0.3 }, colloid: { f: 220, type: 'sawtooth', lp: 1800, n: 0.08 }, homog: { f: 75, type: 'square', lp: 400, n: 0.1 }, atomizer: { f: 0, type: 'sine', lp: 3000, n: 0.35 },
    freezer: { f: 0, type: 'sine', lp: 1200, n: 0.3 }, magnet: { f: 50, type: 'sine', lp: 120, n: 0.03 }, eddy: { f: 180, type: 'triangle', lp: 500, n: 0.05 }, air: { f: 0, type: 'sine', lp: 1500, n: 0.3 }, screen: { f: 16, type: 'square', lp: 120, n: 0.1 }, sinkfloat: { f: 0, type: 'sine', lp: 500, n: 0.12 },
    sensor: { f: 0, type: 'sine', lp: 2500, n: 0.18 },  // belt whine and compressed-air hiss
    omni: { f: 66, type: 'triangle', lp: 900, n: 0.16 }   // #15: a deep rotor drone under the air-jet hiss
  };
  function setHum(scene, level) {
    if (!init()) return;
    if (muted) level = 0;
    const cfg = HUM[scene] || HUM.jaw;
    if (!hum) {
      hum = { osc: ctx.createOscillator(), og: ctx.createGain(), nz: ctx.createBufferSource(), ng: ctx.createGain(), lp: ctx.createBiquadFilter(), out: ctx.createGain(), scene: null };
      hum.osc.type = cfg.type; hum.osc.frequency.value = cfg.f || 40; hum.nz.buffer = noise(); hum.nz.loop = true;
      hum.lp.type = 'lowpass'; hum.lp.frequency.value = cfg.lp; hum.og.gain.value = 0; hum.ng.gain.value = 0; hum.out.gain.value = 0;
      hum.osc.connect(hum.og); hum.og.connect(hum.lp); hum.nz.connect(hum.ng); hum.ng.connect(hum.lp); hum.lp.connect(hum.out); hum.out.connect(master);
      hum.osc.start(); hum.nz.start();
    }
    const t = ctx.currentTime;
    if (hum.scene !== scene) {
      hum.scene = scene; hum.osc.type = cfg.type;
      hum.osc.frequency.setTargetAtTime(cfg.f || 40, t, 0.1); hum.lp.frequency.setTargetAtTime(cfg.lp, t, 0.1);
      hum.og.gain.setTargetAtTime(cfg.f ? 0.18 : 0, t, 0.1); hum.ng.gain.setTargetAtTime(cfg.n, t, 0.1);
    }
    hum.out.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.55, t, 0.25);
  }
  function ui(kind) {
    if (!ready()) return; const t = ctx.currentTime;
    if (kind === 'click') tone(t, { freq: 1200, dur: 0.03, gain: 0.08, type: 'square' });
    else if (kind === 'ok') { tone(t, { freq: 660, dur: 0.06, gain: 0.12, type: 'triangle' }); tone(t + 0.07, { freq: 990, dur: 0.09, gain: 0.12, type: 'triangle' }); }
    else if (kind === 'deny') tone(t, { freq: 160, freqEnd: 110, dur: 0.16, gain: 0.14, type: 'square' });
    else if (kind === 'done') [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, { freq: f, dur: 0.18, gain: 0.1, type: 'triangle' }));
    else if (kind === 'alarm') { for (let i = 0; i < 3; i++) tone(t + i * 0.16, { freq: 880, dur: 0.1, gain: 0.1, type: 'square' }); }
  }
  function setMuted(m) { muted = !!m; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05); }
  CS.Audio = { init, crunch, setHum, ui, setMuted, isMuted: () => muted };
})(typeof window !== 'undefined' ? window : globalThis);
