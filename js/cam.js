/* Machine cam: animated canvas view of the selected machine.
 * Particles are drawn from the same numbers the simulation computes (feed size, product size,
 * per-material response, separation probabilities), so what you see matches the telemetry.
 * Virtual canvas is VW x VH and is scaled to fit.
 */
(function (G) {
  'use strict';
  const CS = G.CS;
  const TAU = Math.PI * 2;
  const VW = 900, VH = 380;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const log10 = Math.log10;

  /* particle radius in px for a piece of size mm (compressed scale so 1 mm .. 1 m all read) */
  function pxOf(mm) { return clamp(1.6 + 3.6 * Math.pow(log10(1 + Math.max(mm, 0)), 1.45), 1.5, 22); }
  const gapPx = (mm) => 2 * pxOf(mm);

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k < 0) { r *= 1 + k; g *= 1 + k; b *= 1 + k; } else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  /* ---------------- pieces ---------------- */
  function pickMat(st) {
    const c = st.comp; if (!c || !c.length) return null;
    let tot = 0; for (let i = 0; i < c.length; i++) tot += c[i][1];
    let r = Math.random() * tot;
    for (let i = 0; i < c.length; i++) { r -= c[i][1]; if (r <= 0) return c[i][0]; }
    return c[0][0];
  }
  function pm(st, mat) { return st.perMat && st.perMat[mat]; }
  function sizeIn(st, mat) {
    const m = pm(st, mat); const base = m && m.F80 > 0 ? m.F80 : (st.F80 > 0 ? st.F80 : 50);
    return base * Math.exp(rnd(-0.55, 0.4));
  }
  function sizeOut(st, mat) {
    const m = pm(st, mat); const base = m && m.P80 > 0 ? m.P80 : (st.P80 > 0 ? st.P80 : 10);
    return base * Math.exp(rnd(-0.7, 0.3));
  }
  function respOf(st, mat) { const m = pm(st, mat); return m && m.resp != null ? m.resp : 0.5; }

  function newPiece(mat, mm, x, y) {
    const D = CS.MATERIALS[mat];
    const n = 7, shape = [];
    for (let i = 0; i < n; i++) shape.push(rnd(0.68, 1.08));
    const flatKind = D.kind === 'plate' || D.kind === 'plastic' || D.kind === 'rubber';
    return {
      x, y, vx: 0, vy: 0, mm, r: pxOf(mm), mat, D, kind: D.kind, col: D.color,
      ang: rnd(0, TAU), spin: rnd(-2.5, 2.5), shape, ax: flatKind ? rnd(1.0, 1.5) : 1, ay: flatKind ? rnd(0.4, 0.65) : 1,
      state: 'free', t: 0, tint: 0, hits: 0, seed: Math.random()
    };
  }

  function shapePath(ctx, p) {
    const r = p.r;
    ctx.beginPath();
    switch (p.kind) {
      case 'plate': {
        const w = r * p.ax, h = r * p.ay, b = h * 0.9;
        ctx.moveTo(-w, -h); ctx.quadraticCurveTo(0, -h - b, w, -h * 0.7);
        ctx.lineTo(w, h * 0.7); ctx.quadraticCurveTo(0, h - b, -w, h); ctx.closePath(); break;
      }
      case 'wood': {
        const w = r * 1.5 * p.ax, h = r * 0.62 * p.ay;
        ctx.rect(-w, -h, w * 2, h * 2); break;
      }
      case 'blob': {
        const wob = 1 + 0.08 * Math.sin(p.t * 5 + p.seed * 9);
        ctx.ellipse(0, 0, r * 1.05 * wob * p.ax, r * 0.9 / wob * p.ay, 0, 0, TAU); break;
      }
      case 'drop': ctx.arc(0, 0, r * 0.85, 0, TAU); break;
      case 'rubber': {
        ctx.arc(0, 0, r, 0.3, 2.9); ctx.arc(0, 0, r * 0.55, 2.9, 0.3, true); ctx.closePath(); break;
      }
      case 'plastic': {
        const w = r * 1.2 * p.ax, h = r * 0.8 * p.ay, c = Math.min(w, h) * 0.45;
        ctx.moveTo(-w + c, -h); ctx.lineTo(w - c, -h); ctx.quadraticCurveTo(w, -h, w, -h + c);
        ctx.lineTo(w, h - c); ctx.quadraticCurveTo(w, h, w - c, h); ctx.lineTo(-w + c, h);
        ctx.quadraticCurveTo(-w, h, -w, h - c); ctx.lineTo(-w, -h + c); ctx.quadraticCurveTo(-w, -h, -w + c, -h); ctx.closePath(); break;
      }
      default: { // angular, ice
        const n = p.shape.length;
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU, rr = r * p.shape[i];
          const px = Math.cos(a) * rr * p.ax, py = Math.sin(a) * rr * p.ay;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
      }
    }
  }

  function drawPiece(ctx, p) {
    const r = p.r;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
    if (r < 2.4) {
      ctx.fillStyle = p.col; ctx.fillRect(-r, -r, r * 2, r * 2);
      if (p.tint > 0) { ctx.fillStyle = 'rgba(200,235,255,' + (p.tint * 0.6) + ')'; ctx.fillRect(-r, -r, r * 2, r * 2); }
      ctx.restore(); return;
    }
    shapePath(ctx, p);
    let alpha = 1;
    if (p.kind === 'blob') alpha = 0.78;
    if (p.kind === 'drop') alpha = 0.85;
    ctx.globalAlpha = alpha; ctx.fillStyle = p.col; ctx.fill(); ctx.globalAlpha = 1;
    if (p.tint > 0) { ctx.fillStyle = 'rgba(200,235,255,' + (p.tint * 0.6) + ')'; ctx.fill(); }
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    // details
    if (p.kind === 'wood') {
      const w = r * 1.5 * p.ax, h = r * 0.62 * p.ay;
      ctx.strokeStyle = 'rgba(70,40,10,0.55)'; ctx.beginPath();
      ctx.moveTo(-w * 0.9, -h * 0.35); ctx.lineTo(w * 0.9, -h * 0.35); ctx.moveTo(-w * 0.9, h * 0.3); ctx.lineTo(w * 0.9, h * 0.3); ctx.stroke();
    } else if (p.kind === 'plate' || p.kind === 'plastic') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath();
      ctx.moveTo(-r * 0.6 * p.ax, -r * 0.3 * p.ay); ctx.lineTo(r * 0.5 * p.ax, -r * 0.35 * p.ay); ctx.stroke();
    } else if (p.kind === 'blob' || p.kind === 'drop') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.25, r * 0.15, -0.6, 0, TAU); ctx.fill();
    } else if (p.kind === 'angular' || p.kind === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.7 * p.shape[0], 0); ctx.lineTo(0, r * 0.6 * p.shape[2]); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- shared chrome ---------------- */
  function drawBelt(ctx, y, x0, x1, t, speed) {
    ctx.fillStyle = '#20252d'; ctx.fillRect(x0, y, x1 - x0, 9);
    ctx.fillStyle = '#2d343e'; ctx.fillRect(x0, y, x1 - x0, 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath();
    const off = (t * (speed || 60)) % 18;
    for (let x = x0 - 18 + off; x < x1; x += 18) { if (x > x0) { ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9); } }
    ctx.stroke();
  }
  function gear(ctx, x, y, R, teeth, ang, fill, stroke) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = i / (teeth * 2) * TAU, rr = i % 2 ? R * 0.86 : R;
      const a2 = a + TAU / (teeth * 4);
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#10141a'; ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function label(ctx, text, x, y, color, align) {
    ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace';
    ctx.fillStyle = color || '#7fe3ff'; ctx.textAlign = align || 'left'; ctx.fillText(text, x, y);
  }
  function bin(ctx, x, y, w, h, text, color) {
    ctx.fillStyle = 'rgba(20,26,34,0.9)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color || '#3a4656'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    label(ctx, text, x + w / 2, y + 14, color || '#9fb3c8', 'center');
  }

  /* ---------------- the cam ---------------- */
  function Cam(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.parts = []; this.t = 0; this.phase = 0; this.run = 0; this.scene = null; this.sceneId = null; this.st = null;
    this.dpr = 1; this.W = VW; this.H = VH; this.acc = 0; this.audioHook = null; this.flash = 0;
    this.belt = 0; this.pile = 0; this.fx = [];
    this.resize();
  }
  Cam.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(200, r.width); this.H = Math.max(160, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  };
  Cam.prototype.setState = function (st) {
    if (!st) return;
    if (st.M.id !== this.sceneId) {
      this.sceneId = st.M.id; this.scene = CS.Scenes[st.M.scene] || CS.Scenes.fallback;
      this.parts.length = 0; this.phase = 0; this.acc = 0;
      if (this.scene.init) this.scene.init(this, st);
    }
    this.st = st;
  };
  Cam.prototype.frame = function (dt) {
    const st = this.st; if (!st || !this.scene) return;
    dt = Math.min(dt, 0.05);
    this.run += ((st.running ? 1 : 0) - this.run) * Math.min(1, dt * 3);
    if (this.run < 0.002) this.run = 0;
    const e = this.run;
    this.t += dt * Math.max(e, 0.05);
    this.phase += dt * e * (this.scene.omega ? this.scene.omega(st) : 6);
    this.belt += dt * e * 60;
    const sdt = dt * e;
    if (sdt > 0.0004) {
      this.scene.update(this, sdt, st);
      this.updateOut(sdt);
      const fx = this.fx;
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i]; f.life -= sdt;
        if (f.life <= 0) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }
        f.vy += f.g * sdt; f.x += f.vx * sdt; f.y += f.vy * sdt; if (f.grow) f.size += f.grow * sdt;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    this.draw();
  };
  /* spawn rate helper: returns how many to spawn this step */
  Cam.prototype.spawnCount = function (sdt, perSec) {
    this.acc += sdt * perSec; const n = Math.floor(this.acc); this.acc -= n; return n;
  };
  Cam.prototype.push = function (p) { if (this.parts.length < 330) this.parts.push(p); return p; };
  /* particles that have left the machine ride a short belt and leave */
  Cam.prototype.updateOut = function (dt) {
    const arr = this.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (p.state === 'drop') {
        p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
        if (p.y >= 346 - p.r) { p.y = 346 - p.r; p.state = 'belt'; p.vx = 55 + rnd(-8, 8); p.vy = 0; p.spin = 0; }
      } else if (p.state === 'belt') {
        p.x += p.vx * dt;
        if (p.x > VW + 30) { arr[i] = arr[arr.length - 1]; arr.pop(); }
      } else if (p.state === 'gone') { arr[i] = arr[arr.length - 1]; arr.pop(); }
    }
  };
  Cam.prototype.spark = function (x, y, n, col) {
    for (let i = 0; i < n && this.fx.length < 220; i++) {
      const life = rnd(0.2, 0.55);
      this.fx.push({ x, y, vx: rnd(-170, 170), vy: rnd(-230, 30), g: 520, life, max: life, size: rnd(1, 2.2), col: col || '#ffd27a' });
    }
  };
  Cam.prototype.mist = function (x, y, n, col, spread) {
    for (let i = 0; i < n && this.fx.length < 220; i++) {
      const life = rnd(0.5, 1.1);
      this.fx.push({ x: x + rnd(-8, 8), y: y + rnd(-4, 4), vx: rnd(-(spread || 20), spread || 20), vy: rnd(10, 50), g: 20, life, max: life, size: rnd(2, 4), grow: 8, col: col || '#dff4ff', soft: true });
    }
  };
  Cam.prototype.crunch = function (p, strength) {
    this.flash = Math.min(1, this.flash + 0.15);
    if (this.audioHook) this.audioHook(p, strength || 1);
  };
  Cam.prototype.draw = function () {
    const ctx = this.ctx, W = this.W, H = this.H, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    // background
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1018'); g.addColorStop(1, '#10161f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(80,140,180,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < W; x += 30) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y < H; y += 30) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
    // view: an optional crop of the 900 x 380 scene (the plant screen's small cams zoom onto the machine)
    const V = this.view || { x: 0, y: 0, w: VW, h: VH };
    const k = Math.min(W / V.w, H / V.h), ox = (W - V.w * k) / 2 - V.x * k, oy = (H - V.h * k) / 2 - V.y * k;
    ctx.setTransform(d * k, 0, 0, d * k, d * ox, d * oy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
    this.scene.draw(this, ctx, this.st, 0);
    const arr = this.parts;
    for (let i = 0; i < arr.length; i++) if (!arr[i].front) drawPiece(ctx, arr[i]);
    const fx = this.fx;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i], a = clamp(f.life / f.max, 0, 1);
      ctx.globalAlpha = f.soft ? a * 0.45 : a; ctx.fillStyle = f.col;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.scene.drawParticlesExtra) this.scene.drawParticlesExtra(this, ctx, this.st);
    if (this.scene.draw) this.scene.draw(this, ctx, this.st, 1);
    for (let i = 0; i < arr.length; i++) if (arr[i].front) drawPiece(ctx, arr[i]);
    if (this.flash > 0.01) { ctx.fillStyle = 'rgba(255,230,180,' + (this.flash * 0.05) + ')'; ctx.fillRect(0, 0, VW, VH); }
    ctx.restore();
  };

  /* generic wedge-crush logic used by jaw, cone, roll and HPGR.
   * chambers: [{ yTop, yBot, xl(y,cam), xr(y,cam) }]. A piece falls until it wedges, then is squeezed. */
  function wedgeUpdate(cam, dt, st, chambers, opts) {
    const nSpawn = cam.spawnCount(dt, 2 + 9 * st.load);
    for (let i = 0; i < nSpawn; i++) {
      const mat = pickMat(st); if (!mat) break;
      const ch = chambers[Math.floor(Math.random() * chambers.length)];
      const mm = sizeIn(st, mat); const p = newPiece(mat, mm, 0, ch.yTop - 20);
      p.ch = ch; p.x = (ch.xl(ch.yTop) + ch.xr(ch.yTop)) / 2 + rnd(-8, 8); p.vy = 40;
      p.liquid = p.D.state === 'liquid' && !st.temp;
      cam.push(p);
    }
    const arr = cam.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i]; if (p.state !== 'free') continue;
      p.t += dt; const ch = p.ch;
      if (!ch) { p.state = 'gone'; continue; }
      p.vy = Math.min(p.vy + 520 * dt, 300); p.y += p.vy * dt; p.ang += p.spin * dt * 0.4;
      const xl = ch.xl(p.y), xr = ch.xr(p.y), w = xr - xl, need = p.r * 2 * (p.kind === 'plate' ? 0.7 + 0.5 * p.ay : 1);
      const cx = (xl + xr) / 2;
      if (p.liquid) { // water just flows through
        p.x += (cx - p.x) * Math.min(1, dt * 6); p.r = Math.max(2, p.r - dt * 1);
        if (p.y > ch.yBot) { p.state = 'drop'; p.vx = rnd(-20, 20); p.vy = 120; }
        continue;
      }
      if (w < need && p.y < ch.yBot) { // wedged
        p.y -= p.vy * dt; p.vy = 0; p.x += (cx - p.x) * Math.min(1, dt * 8);
        if (w < need * 0.92 || (opts.continuous && p.t > 0.05)) {
          p.hits++;
          const r = respOf(st, p.mat);
          if (Math.random() < clamp(r * 1.2, 0.05, 1) || p.hits > 5) {
            const n = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.55), 2, 6));
            for (let k = 0; k < n; k++) {
              const mm = clamp(sizeOut(st, p.mat), 0.05, p.mm * 0.8);
              const q = newPiece(p.mat, mm, p.x + rnd(-6, 6), p.y + rnd(-4, 6));
              q.r = Math.min(q.r, Math.max(1.6, w * 0.5)); q.ch = ch; q.vy = 40 + rnd(0, 60); q.vx = rnd(-15, 15); q.tint = p.tint;
              cam.push(q);
            }
            cam.crunch(p, clamp(p.r / 14, 0.3, 1.5));
            p.state = 'gone';
          } else { // ductile: flattened, not broken
            p.r *= 0.9; p.ay = Math.max(0.25, p.ay * 0.85); p.ax = Math.min(2, p.ax * 1.08);
            cam.crunch(p, 0.4);
          }
        }
      } else p.x += (cx - p.x) * Math.min(1, dt * 3) + rnd(-5, 5) * dt;
      if (p.y >= ch.yBot) { p.state = 'drop'; p.vx = rnd(-25, 25); p.vy = 80; p.tint = p.tint || 0; }
    }
  }

  CS.Scenes = CS.Scenes || {};
  CS.CamUtil = { TAU, VW, VH, rnd, clamp, lerp, pxOf, gapPx, shade, pickMat, pm, sizeIn, sizeOut, respOf, newPiece, drawPiece, drawBelt, gear, label, bin, wedgeUpdate };
  CS.Cam = Cam;
})(typeof window !== 'undefined' ? window : globalThis);
