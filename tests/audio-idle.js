// The audio engine (#200): no context before a gesture, idle hum and belt are stopped, hidden or muted stops the music timer.
// Run: node tests/audio-idle.js
let fails = 0, n = 0;
function check(ok, msg) { n++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; }
let made = 0, started = 0, stopped = 0, ctxCount = 0, suspends = 0, resumes = 0, timers = [], cleared = 0;
const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), start() { started++; }, stop() { stopped++; } });
class FakeCtx {
  constructor() { ctxCount++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 100; this.destination = {}; }
  createGain() { return node(); } createOscillator() { made++; return node(); } createBufferSource() { made++; return node(); } createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); } createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
  suspend() { suspends++; this.state = 'suspended'; } resume() { resumes++; this.state = 'running'; }
}
globalThis.window = globalThis; globalThis.AudioContext = FakeCtx; globalThis.CS = {};
globalThis.setInterval = (f) => { timers.push(f); return timers.length; }; globalThis.clearInterval = () => { cleared++; };
const realST = globalThis.setTimeout; globalThis.setTimeout = (f) => { f(); return 0; };   // the suspend delay runs at once
globalThis.localStorage = { getItem: () => JSON.stringify({ music: 0.5 }), setItem() {} };
require('../js/audio.js');
const A = CS.Audio, M = CS.Music;
A.setHum('jaw', 1); A.setBelt(1);
check(ctxCount === 0 && made === 0, 'hum and belt before any gesture create no context and no sources');
check(timers.length === 1, 'music at volume > 0 starts its scheduler');
A.init();
check(ctxCount === 1, 'init() (a gesture) creates the context');
A.setHum('jaw', 0); A.setBelt(0);
check(made === 0, 'a hum and belt at level 0 are not built');
A.setHum('jaw', 1); A.setBelt(1);
check(made === 3, 'a hum and belt at level > 0 are built (oscillator + noise loop, noise loop)');
const ctx = A.ctx();
A.setHum('jaw', 0); A.setBelt(0); ctx.currentTime = 2; A.setHum('jaw', 0); A.setBelt(0);
check(stopped === 0, 'level 0 for under 3 s keeps them alive');
ctx.currentTime = 6; A.setHum('jaw', 0); A.setBelt(0);
check(stopped === 3, 'level 0 for 3 s stops the oscillator and both noise loops');
A.setHum('jaw', 1); check(made === 5, 'the hum is rebuilt when the level returns');
A.setHum('jaw', 1); check(made === 5, 'a live hum is reused');
A.duck('hidden', true);
check(suspends === 1 && ctx.state === 'suspended', 'hiding the tab suspends the context');
check(cleared === 1, 'hiding the tab clears the music interval');
A.init(); check(ctx.state === 'suspended', 'init() does not resume a hidden context');
A.duck('hidden', false);
check(resumes === 1 && ctx.state === 'running', 'returning to the tab resumes it');
check(timers.length === 2, 'and restarts the music scheduler');
A.setMuted(true); check(cleared === 2, 'muting clears the music interval');
A.setMuted(false); check(timers.length === 3, 'unmuting restarts it');
ctx.state = 'interrupted'; const r0 = resumes; A.ui('click');
check(resumes === r0 + 1, '#280: an interrupted context (iOS after a call) is resumed');
ctx.state = 'interrupted'; ctx.resume = () => { resumes++; };   // a resume that has not landed yet
const m1 = made; A.ui('click'); A.setHum('jaw', 1); check(made === m1, '#280: nothing is scheduled while the context is not running');
check(A.HUM.furnace && A.HUM.furnace !== A.HUM.jaw && A.HUM.furnace.f < 45, '#281: the furnace scene has its own low rumble');
console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nall ' + n + ' audio checks pass');
process.exit(fails ? 1 : 0);
