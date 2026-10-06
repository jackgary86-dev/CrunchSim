/* Machine cam scenes, part B: hydraulic shear, freezer, separators. */
(function (G) {
  'use strict';
  const CS = G.CS, U = CS.CamUtil, S = CS.Scenes, Sim = CS.Sim;
  const { TAU, rnd, clamp, lerp, pxOf, pickMat, sizeIn, sizeOut, respOf, newPiece, drawBelt, gear, label } = U;
  const tag = (ctx, t, x, y, a) => label(ctx, t, x, y, '#7fe3ff', a);
  const EXT_COL = '#5cffb1', RES_COL = '#ffb25c';

  function frame(ctx, x, y, w, h) { ctx.fillStyle = '#141a22'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#26303c'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }

  /* sample a real size (mm) from a bin-mass array */
  function sampleMm(psd) {
    let tot = 0; for (let i = 0; i < psd.length; i++) tot += psd[i];
    if (tot <= 0) return null;
    let r = Math.random() * tot;
    for (let i = 0; i < psd.length; i++) { r -= psd[i]; if (r <= 0) return Math.exp(Math.log(Sim.LOW[i]) + Math.random() * (Math.log(Sim.EDGE[i]) - Math.log(Sim.LOW[i]))); }
    return Sim.MID[Sim.NB - 1];
  }
  /* a feed piece whose size, material and fate come from the live simulation */
  function sepPiece(cam, st, x, y) {
    const mat = pickMat(st); if (!mat) return null;
    const m = st.perMat && st.perMat[mat];
    const mm = (m && m.psd && sampleMm(m.psd)) || sizeIn(st, mat);
    const p = newPiece(mat, mm, x, y);
    p.fate = Math.random() < Sim.pExtract(st.M, st.s, CS.MATERIALS[mat], mm);   // true = goes to the extract port
    return p;
  }
  function count(cam, which) { cam.cnt = cam.cnt || { a: 0, b: 0 }; cam.cnt[which]++; }
  function decay(cam, dt) { if (cam.cnt) { cam.cnt.a *= Math.exp(-dt * 0.12); cam.cnt.b *= Math.exp(-dt * 0.12); } }
  function bins(cam, ctx, a, b, nameA, nameB) {
    const c = cam.cnt || { a: 0, b: 0 }, tot = c.a + c.b;
    [[a, c.a, EXT_COL, nameA], [b, c.b, RES_COL, nameB]].forEach(function (z) {
      const r = z[0], lv = clamp(z[1] / 26, 0, 1);
      ctx.fillStyle = 'rgba(14,20,28,0.95)'; ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.fillStyle = z[2]; ctx.globalAlpha = 0.28; ctx.fillRect(r[0] + 2, r[1] + r[3] - (r[3] - 4) * lv - 2, r[2] - 4, (r[3] - 4) * lv); ctx.globalAlpha = 1;
      ctx.strokeStyle = z[2]; ctx.lineWidth = 2; ctx.strokeRect(r[0], r[1], r[2], r[3]);
      label(ctx, z[3], r[0] + r[2] / 2, r[1] - 6, z[2], 'center');
      label(ctx, tot > 1 ? Math.round(100 * z[1] / tot) + '%' : '', r[0] + r[2] / 2, r[1] + r[3] / 2 + 4, z[2], 'center');
    });
  }

  /* ======================= COLLOID MILL ======================= */
  S.colloid = {
    omega: () => 12,
    update(cam, dt, st) {
      const n = cam.spawnCount(dt, 3 + 14 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 450 + rnd(-24, 24), 24); p.vy = 60; p.mode = 'in'; p.side = Math.random() < 0.5 ? -1 : 1; p.r0 = p.r; p.mm0 = p.mm; cam.push(p);
      }
      const g = clamp(3 + st.s.gap / 500 * 11, 3, 14), arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'in') { p.vy += 300 * dt; p.y += p.vy * dt; p.x += (450 + p.side * 70 - p.x) * dt * 1.5; if (p.y > 100) { p.mode = 'gap'; p.t = 0; } }
        else if (p.mode === 'gap') {
          p.t += dt * 0.6; const y = 100 + p.t * 205, hs = lerp(70, 34, p.t), hr = hs - g;
          p.x = 450 + p.side * (hs + hr) / 2; p.y = y; p.ax = lerp(1, 1.9, Math.min(1, p.t * 2)); p.ay = lerp(1, 0.5, Math.min(1, p.t * 2));
          p.r = Math.max(1.6, lerp(p.r0, clamp(pxOf(sizeOut(st, p.mat)), 1.6, p.r0), p.t)); p.ang = p.side * 1.3;
          if (p.t >= 1) { p.state = 'drop'; p.ax = 1; p.ay = 1; p.ang = 0; p.vx = p.side * rnd(5, 25); p.vy = 70; if (Math.random() < 0.25) cam.crunch(p, 0.25); }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      const g = clamp(3 + st.s.gap / 500 * 11, 3, 14);
      if (pass === 0) {
        frame(ctx, 330, 14, 240, 316);
        ctx.beginPath(); ctx.moveTo(390, 20); ctx.lineTo(510, 20); ctx.lineTo(494, 100); ctx.lineTo(406, 100); ctx.closePath(); ctx.fillStyle = '#18212b'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#3b4756'; ctx.beginPath(); ctx.moveTo(450 - 76, 100); ctx.lineTo(450 - 76, 100); ctx.lineTo(450 - 34, 306); ctx.lineTo(450 - 74, 306); ctx.lineTo(450 - 110, 100); ctx.fill();
        ctx.beginPath(); ctx.moveTo(450 + 76, 100); ctx.lineTo(450 + 34, 306); ctx.lineTo(450 + 74, 306); ctx.lineTo(450 + 110, 100); ctx.fill();
        // spinning rotor cone
        ctx.beginPath(); ctx.moveTo(450 - (70 - g), 100); ctx.lineTo(450 + (70 - g), 100); ctx.lineTo(450 + (34 - g), 306); ctx.lineTo(450 - (34 - g), 306); ctx.closePath(); ctx.fillStyle = '#566678'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let k = 0; k < 14; k++) { const y = 100 + ((k * 16 + cam.phase * 40) % 200), t = (y - 100) / 206, hw = lerp(70 - g, 34 - g, t); ctx.moveTo(450 - hw, y); ctx.lineTo(450 + hw, y + 7); }
        ctx.stroke();
        ctx.fillStyle = '#10151c'; ctx.fillRect(445, 20, 10, 80);
        gear(ctx, 450, 322, 16, 10, cam.phase, '#2a3340', '#56677a');
      } else {
        tag(ctx, 'GAP ' + st.s.gap + ' µm', 450, 12, 'center');
        drawBelt(ctx, 346, 330, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= HOMOGENIZER ======================= */
  S.homog = {
    omega: () => 5,
    update(cam, dt, st) {
      const n = cam.spawnCount(dt, 3 + 11 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 165, 195 + rnd(-12, 12)); p.mode = 'hp'; p.vx = 50; p.tint = 0; cam.push(p);
      }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'hp') {
          const t = (p.x - 165) / 315; p.vx = 45 + 340 * t * t * t; p.x += p.vx * dt; p.y += (200 - p.y) * dt * (1 + 8 * t); p.ay = lerp(p.ay, 0.55, Math.min(1, dt * 3)); p.ax = lerp(p.ax, 1.7, Math.min(1, dt * 3));
          p.col = p.D.color;
          if (p.x > 480) {
            const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.01), 0.35), 2, 6));
            for (let k = 0; k < nf; k++) {
              const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.003, p.mm), 486, 200 + rnd(-4, 4)); q.r = Math.max(1.5, q.r);
              const a = rnd(-0.45, 0.45); q.state = 'drop'; q.vx = Math.cos(a) * rnd(140, 260); q.vy = Math.sin(a) * rnd(100, 220); cam.push(q);
            }
            cam.fx.push({ x: 488, y: 200 + rnd(-6, 6), vx: rnd(20, 80), vy: rnd(-40, 40), g: 0, life: 0.25, max: 0.25, size: rnd(3, 6), grow: 20, col: '#ffffff', soft: true });
            cam.crunch(p, 0.3); p.state = 'gone';
          }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        frame(ctx, 100, 120, 640, 160);
        const pressure = clamp(Math.log10(st.s.bar / 100) / 1.3, 0, 1);
        // high-pressure side shaded by pressure, low-pressure side clear
        ctx.fillStyle = 'rgba(' + Math.round(60 + 190 * pressure) + ',70,70,0.20)'; ctx.fillRect(130, 170, 350, 60);
        ctx.fillStyle = '#10161e'; ctx.fillRect(480, 170, 260, 60);
        ctx.fillStyle = '#2d3846'; ctx.fillRect(130, 160, 350, 10); ctx.fillRect(130, 230, 350, 10); ctx.fillRect(480, 160, 260, 10); ctx.fillRect(480, 230, 260, 10);
        // valve seat and spring-loaded poppet
        ctx.fillStyle = '#6a7685'; ctx.fillRect(470, 160, 12, 36); ctx.fillRect(470, 206, 12, 34);
        const lift = 2 + 1.5 * Math.sin(cam.phase * 14);
        ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.moveTo(500, 200 - lift); ctx.lineTo(486, 200 - lift - 8); ctx.lineTo(486, 200 + lift + 8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#8b99a9'; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k < 7; k++) { ctx.lineTo(505 + k * 8, 200 + (k % 2 ? 6 : -6)); } ctx.stroke();
        // plunger
        const px = 100 + 12 * Math.sin(cam.phase);
        ctx.fillStyle = '#4c5867'; ctx.fillRect(px, 172, 36, 56); ctx.fillStyle = '#7b8794'; ctx.fillRect(px - 60, 192, 62, 16);
        // gauge
        ctx.beginPath(); ctx.arc(640, 80, 32, 0, TAU); ctx.fillStyle = '#10151c'; ctx.fill(); ctx.strokeStyle = '#46515f'; ctx.lineWidth = 3; ctx.stroke();
        const a = Math.PI * 0.8 + pressure * Math.PI * 1.4; ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(640, 80); ctx.lineTo(640 + Math.cos(a) * 26, 80 + Math.sin(a) * 26); ctx.stroke();
        label(ctx, st.s.bar + ' bar', 640, 126, '#ff9a80', 'center');
      } else {
        tag(ctx, 'HIGH PRESSURE', 300, 150, 'center'); tag(ctx, 'LOW PRESSURE', 610, 150, 'center');
        drawBelt(ctx, 346, 440, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= ATOMIZER ======================= */
  S.atomizer = {
    omega: () => 5,
    update(cam, dt, st) {
      const n = cam.spawnCount(dt, 8 + 60 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const mm = clamp(sizeOut(st, mat), 0.01, 1);
        const p = newPiece(mat, mm, 330 + rnd(-4, 4), 150 + rnd(-6, 6)); p.r = Math.max(1.6, Math.min(p.r, 3.2));
        const a = Math.PI * 0.18 + rnd(-0.38, 0.38), v = rnd(180, 340); p.mode = 'spray'; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; cam.push(p);
      }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free' || p.mode !== 'spray') continue;
        p.vx *= Math.exp(-dt * 1.4); p.vy = p.vy * Math.exp(-dt * 1.2) + 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > 338 || p.x > 880) { p.state = 'drop'; p.vx = 20; p.vy = 0; }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        frame(ctx, 220, 20, 520, 320);
        ctx.fillStyle = '#2d3846'; ctx.fillRect(290, 20, 60, 36);
        ctx.fillStyle = '#6a7685'; ctx.beginPath(); ctx.moveTo(300, 56); ctx.lineTo(340, 56); ctx.lineTo(336, 80); ctx.lineTo(304, 80); ctx.closePath(); ctx.fill();
        // intact liquid jet that breaks into droplets
        const len = clamp(70 - Math.log10(st.s.bar / 50) * 18, 30, 80);
        ctx.fillStyle = 'rgba(90,170,255,0.8)'; ctx.beginPath(); ctx.moveTo(318, 80); ctx.lineTo(322, 80); ctx.lineTo(323 + 2 * Math.sin(cam.phase * 9), 80 + len); ctx.lineTo(317, 80 + len); ctx.closePath(); ctx.fill();
        // pump
        ctx.fillStyle = '#273240'; ctx.fillRect(240, 30, 40, 70); ctx.fillStyle = '#c9a24a'; ctx.fillRect(244 + 3 * Math.sin(cam.phase * 6), 46, 32, 10);
        ctx.strokeStyle = '#4f6a82'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(280, 60); ctx.lineTo(300, 60); ctx.stroke();
        // spray cone
        ctx.strokeStyle = 'rgba(127,227,255,0.14)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(330, 150); ctx.lineTo(700, 300); ctx.moveTo(330, 150); ctx.lineTo(430, 340); ctx.stroke();
      } else {
        tag(ctx, 'NOZZLE ' + st.s.bar + ' bar', 480, 30, 'center');
        drawBelt(ctx, 346, 220, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= FREEZER ======================= */
  S.freezer = {
    omega: () => 14,
    update(cam, dt, st) {
      const n = cam.spawnCount(dt, 1.5 + 5 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const mm = sizeIn(st, mat), p = newPiece(mat, mm, 50, 0);
        p.mode = 'belt'; p.vx = 48; p.y = 232 - p.r; p.liquid = p.D.state === 'liquid'; p.r = Math.min(p.r, 16); p.y = 232 - p.r; cam.push(p);
      }
      if (st.running && Math.random() < dt * 25) cam.mist(rnd(200, 700), 110, 1, '#bfe6ff', 30);
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free' || p.mode !== 'belt') continue;
        p.x += p.vx * dt; p.tint = clamp((p.x - 120) / 560, 0, 1);
        if (p.liquid && p.tint > 0.45 && p.kind === 'drop') { p.kind = 'ice'; p.col = '#cfeaff'; p.r *= 1.25; p.ax = 1.1; p.ay = 0.9; p.y = 232 - p.r; }
        if (p.x > 800) { p.state = 'drop'; p.vx = 40; p.vy = 20; }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        const g = ctx.createLinearGradient(120, 0, 780, 0); g.addColorStop(0, 'rgba(120,150,170,0.10)'); g.addColorStop(1, 'rgba(110,190,255,0.26)');
        ctx.fillStyle = '#18222c'; ctx.fillRect(100, 70, 700, 230); ctx.fillStyle = g; ctx.fillRect(110, 82, 680, 206);
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 4; ctx.strokeRect(100, 70, 700, 230);
        for (let f = 0; f < 4; f++) { // evaporator fans
          const fx = 210 + f * 150; ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(fx, 110, 26, 0, TAU); ctx.fill();
          ctx.save(); ctx.translate(fx, 110); ctx.rotate(cam.phase * (f % 2 ? 1 : -1));
          ctx.fillStyle = '#7fb4d6'; for (let b = 0; b < 4; b++) { ctx.rotate(TAU / 4); ctx.beginPath(); ctx.ellipse(11, 0, 11, 4.5, 0, 0, TAU); ctx.fill(); }
          ctx.restore();
        }
        ctx.fillStyle = '#20252d'; ctx.fillRect(20, 232, 840, 9); ctx.fillStyle = '#2d343e'; ctx.fillRect(20, 232, 840, 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let x = 20 + (cam.belt % 18); x < 860; x += 18) { ctx.moveTo(x, 235); ctx.lineTo(x, 241); } ctx.stroke();
      } else {
        const t = ctx.createLinearGradient(120, 0, 780, 0); t.addColorStop(0, '#ffb25c'); t.addColorStop(1, '#6fc3ff');
        ctx.fillStyle = t; ctx.fillRect(120, 270, 660, 6);
        label(ctx, '+20 C', 120, 292, '#ffb25c', 'left'); label(ctx, '-30 C', 780, 292, '#6fc3ff', 'right'); tag(ctx, 'AIR FREEZE', 450, 62, 'center');
        drawBelt(ctx, 346, 640, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= MAGNETIC DRUM ======================= */
  const MAG = { cx: 560, cy: 190, R: 62, end: 1.9 };
  S.magnet = {
    omega: () => 2,
    update(cam, dt, st) {
      decay(cam, dt);
      const n = cam.spawnCount(dt, 3 + 11 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, 50, 0); if (!p) break; p.r = Math.min(p.r, 15); p.y = MAG.cy - MAG.R - p.r + 2; p.mode = 'belt'; p.vx = 120; cam.push(p); }
      const arr = cam.parts, v = 120;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'belt') {
          p.x += v * dt; p.ang *= 0.9;
          if (p.x >= MAG.cx) {
            if (p.fate) { p.mode = 'stick'; p.a = -Math.PI / 2; if (Math.random() < 0.6) cam.spark(p.x, p.y, 2, '#bfe3ff'); }   // #126: a flick as steel snaps to the drum else { p.mode = 'air'; p.vx = 150 + rnd(-15, 15); p.vy = -rnd(10, 40); }
          }
        } else if (p.mode === 'stick') {
          p.a += v / MAG.R * dt; const rr = MAG.R + p.r * 0.8;
          p.x = MAG.cx + Math.cos(p.a) * rr; p.y = MAG.cy + Math.sin(p.a) * rr; p.ang = p.a + Math.PI / 2;
          if (p.a > MAG.end) { p.mode = 'fall'; p.vx = -rnd(10, 40); p.vy = 40; }
        } else { // air or fall
          p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y > 318) { count(cam, p.fate ? 'a' : 'b'); p.state = 'gone'; }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        const { cx, cy, R } = MAG;
        ctx.fillStyle = '#20252d'; ctx.beginPath(); ctx.moveTo(50, cy - R); ctx.lineTo(cx, cy - R); ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); ctx.lineTo(50, cy + R); ctx.arc(50, cy, R, Math.PI / 2, -Math.PI / 2 + TAU, false); ctx.closePath();
        ctx.lineWidth = 8; ctx.strokeStyle = '#2d343e'; ctx.stroke();
        ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0, TAU); ctx.fill();
        // fixed magnet sector, poles alternating, with field lines
        for (let k = 0; k < 8; k++) { const a0 = -Math.PI / 2 + k * (MAG.end + Math.PI / 2) / 8, a1 = a0 + (MAG.end + Math.PI / 2) / 8; ctx.fillStyle = k % 2 ? '#3b6ea5' : '#b84a4a'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R - 10, a0, a1); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.strokeStyle = 'rgba(127,227,255,0.16)'; ctx.lineWidth = 1;
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(cx, cy, R + k * 9, -Math.PI / 2, MAG.end); ctx.stroke(); }
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(cam.phase); ctx.strokeStyle = '#46515f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-R + 2, 0); ctx.lineTo(R - 2, 0); ctx.moveTo(0, -R + 2); ctx.lineTo(0, R - 2); ctx.stroke(); ctx.restore();
        ctx.beginPath(); ctx.moveTo(cx - 12, cy + R + 10); ctx.lineTo(cx + 40, cy + R + 60); ctx.lineWidth = 5; ctx.strokeStyle = '#4b5968'; ctx.stroke();  // splitter
      } else {
        bins(cam, ctx, [400, 300, 130, 72], [630, 300, 150, 72], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, st.s.field + ' mT', MAG.cx, 40, 'center');
      }
    }
  };

  /* ======================= EDDY CURRENT SEPARATOR ======================= */
  const ECS = { cx: 520, cy: 190, R: 58 };
  S.eddy = {
    omega: () => 3,
    update(cam, dt, st) {
      decay(cam, dt);
      const n = cam.spawnCount(dt, 3 + 10 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, 50, 0); if (!p) break; p.r = Math.min(p.r, 15); p.y = ECS.cy - ECS.R - p.r + 2; p.mode = 'belt'; p.vx = 125; cam.push(p); }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'belt') {
          p.x += 125 * dt; p.ang *= 0.9;
          if (p.x >= ECS.cx + 12) { p.mode = 'air'; p.vx = p.fate ? 125 + 150 + rnd(-20, 30) : 120 + rnd(-10, 10); p.vy = p.fate ? -rnd(60, 110) : -rnd(0, 25); if (p.fate && Math.random() < 0.5) cam.spark(p.x, p.y, 2, '#ffcf8a'); }   // #126: thrown off the rotor
        } else {
          p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y > 318) { count(cam, p.fate ? 'a' : 'b'); p.state = 'gone'; }
        }
      }
    },
    drawParticlesExtra(cam, ctx) {
      // induced eddy currents: rings around conductive pieces sitting over the rotor
      for (let i = 0; i < cam.parts.length; i++) {
        const p = cam.parts[i];
        if (p.mode === 'belt' && p.D.sigma > 0 && !p.D.magnetic && p.x > ECS.cx - 70) {
          ctx.strokeStyle = 'rgba(127,227,255,' + (0.35 + 0.3 * Math.sin(cam.t * 20 + i)) + ')'; ctx.lineWidth = 1;
          for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r + 4 * k, (p.r + 4 * k) * 0.6, 0, 0, TAU); ctx.stroke(); }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        const { cx, cy, R } = ECS;
        ctx.fillStyle = '#20252d'; ctx.beginPath(); ctx.moveTo(50, cy - R); ctx.lineTo(cx, cy - R); ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); ctx.lineTo(50, cy + R); ctx.arc(50, cy, R, Math.PI / 2, -Math.PI / 2 + TAU, false); ctx.closePath();
        ctx.lineWidth = 8; ctx.strokeStyle = '#2d343e'; ctx.stroke();
        ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0, TAU); ctx.fill();
        const spin = cam.phase * (st.s.rpm / 500);
        for (let k = 0; k < 16; k++) { const a0 = spin + k * TAU / 16; ctx.fillStyle = k % 2 ? '#3b6ea5' : '#b84a4a'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R - 10, a0, a0 + TAU / 16); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6a7685'; ctx.beginPath(); ctx.moveTo(672, 210); ctx.lineTo(684, 330); ctx.lineTo(660, 330); ctx.closePath(); ctx.fill(); // splitter blade
      } else {
        bins(cam, ctx, [700, 300, 150, 72], [530, 300, 130, 72], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, st.s.rpm + ' rpm', ECS.cx, 40, 'center');
      }
    }
  };

  /* ======================= AIR CLASSIFIER ======================= */
  S.air = {
    omega: () => 12,
    update(cam, dt, st) {
      decay(cam, dt);
      const n = cam.spawnCount(dt, 3 + 11 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, 300, 180); if (!p) break; p.r = Math.min(p.r, 13); p.mode = 'feed'; p.vx = 110; p.vy = 0; p.seed2 = Math.random() * 6; cam.push(p); }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        p.ang += p.spin * dt;
        if (p.mode === 'feed') { p.x += p.vx * dt; p.vy += 300 * dt; p.y += p.vy * dt * 0.2; if (p.x > 400) { p.mode = p.fate ? 'up' : 'down'; if (p.fate && Math.random() < 0.5) cam.mist(p.x, p.y, 2, 'rgba(223,244,255,.5)', 40); } }   // #126: the air takes it
        else if (p.mode === 'up') {
          p.y -= (80 + st.s.air * 4) * dt * (0.8 + 0.4 * Math.sin(p.seed2)); p.x = 450 + 42 * Math.sin(p.y * 0.07 + p.seed2) * 0.9;
          if (p.y < 52) { p.mode = 'out'; p.vx = 120; }
        } else if (p.mode === 'out') { p.x += p.vx * dt; p.y += (90 - p.y) * dt * 2; if (p.x > 640) { count(cam, 'a'); p.state = 'gone'; } }
        else { // heavies bounce down the zig-zag
          p.vy = Math.min(p.vy + 520 * dt, 230); p.y += p.vy * dt; p.x = 450 + 40 * Math.sin(p.y * 0.07 + p.seed2);
          if (p.y > 322) { count(cam, 'b'); p.state = 'gone'; }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 6; ctx.beginPath();
        for (let y = 40; y <= 330; y += 36) { ctx.lineTo(380 + ((y / 36) % 2 ? 22 : -4), y); }
        ctx.stroke(); ctx.beginPath();
        for (let y = 40; y <= 330; y += 36) { ctx.lineTo(520 + ((y / 36) % 2 ? 4 : -22), y); }
        ctx.stroke();
        ctx.fillStyle = '#18212b'; ctx.fillRect(240, 168, 150, 12);     // feed chute
        // rising air
        ctx.strokeStyle = 'rgba(127,227,255,0.35)'; ctx.lineWidth = 2;
        const sp = (cam.t * (20 + st.s.air * 6)) % 36;
        for (let c = 0; c < 3; c++) for (let y = 330 - sp; y > 50; y -= 36) { const x = 420 + c * 30; ctx.beginPath(); ctx.moveTo(x - 6, y + 6); ctx.lineTo(x, y); ctx.lineTo(x + 6, y + 6); ctx.stroke(); }
        // fan and cyclone
        ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(600, 90, 38, 0, TAU); ctx.fill(); ctx.strokeStyle = '#46515f'; ctx.lineWidth = 4; ctx.stroke();
        ctx.save(); ctx.translate(600, 90); ctx.rotate(cam.phase); ctx.fillStyle = '#7fb4d6'; for (let b = 0; b < 5; b++) { ctx.rotate(TAU / 5); ctx.beginPath(); ctx.ellipse(17, 0, 17, 5, 0, 0, TAU); ctx.fill(); } ctx.restore();
        ctx.fillStyle = '#18212b'; ctx.fillRect(520, 70, 60, 36);
      } else {
        bins(cam, ctx, [680, 150, 150, 80], [400, 332, 100, 40], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, 'AIR ' + st.s.air + ' m/s', 450, 24, 'center');
      }
    }
  };

  /* ======================= VIBRATING SCREEN ======================= */
  const DECK = { x0: 140, y0: 120, x1: 700, y1: 224 };
  const deckY = (x) => DECK.y0 + (x - DECK.x0) / (DECK.x1 - DECK.x0) * (DECK.y1 - DECK.y0);
  S.screen = {
    omega: () => 30,
    update(cam, dt, st) {
      decay(cam, dt);
      const n = cam.spawnCount(dt, 3 + 12 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, 160, 40); if (!p) break; p.r = Math.min(p.r, 15); p.mode = 'in'; p.vy = 0; p.dropAt = rnd(DECK.x0 + 90, DECK.x0 + 400); cam.push(p); }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'in') { p.vy += 500 * dt; p.y += p.vy * dt; p.x += 8 * dt; if (p.y > deckY(p.x) - p.r) { p.mode = 'deck'; p.vy = 0; } }
        else if (p.mode === 'deck') {
          p.x += 62 * dt * (0.8 + 0.4 * Math.random()); p.y = deckY(p.x) - p.r - Math.abs(Math.sin(cam.phase * 0.5 + p.seed * 9)) * 2.2; p.ang = Math.atan2(DECK.y1 - DECK.y0, DECK.x1 - DECK.x0);
          if (p.fate && p.x > p.dropAt) { p.mode = 'through'; p.vy = 30; }
          if (p.x > DECK.x1) { p.mode = 'end'; p.vx = 60; p.vy = 20; }
        } else if (p.mode === 'through') { p.vy += 520 * dt; p.y += p.vy * dt; if (p.y > 322) { count(cam, 'a'); p.state = 'gone'; } }
        else { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt; if (p.y > 322) { count(cam, 'b'); p.state = 'gone'; } }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        const j = Math.sin(cam.phase) * 1.3;
        ctx.save(); ctx.translate(0, j);
        ctx.strokeStyle = '#46515f'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(DECK.x0, DECK.y0 + 6); ctx.lineTo(DECK.x1, DECK.y1 + 6); ctx.stroke();
        ctx.strokeStyle = '#7b8794'; ctx.lineWidth = 2; ctx.setLineDash([2, clamp(2 + st.s.aperture * 0.35, 3, 20)]); ctx.beginPath(); ctx.moveTo(DECK.x0, DECK.y0 + 2); ctx.lineTo(DECK.x1, DECK.y1 + 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
        ctx.strokeStyle = '#273240'; ctx.lineWidth = 4;   // springs
        [[200, 290], [620, 290]].forEach(function (s) { ctx.beginPath(); for (let k = 0; k < 6; k++) ctx.lineTo(s[0] + (k % 2 ? 7 : -7), deckY(s[0]) + 14 + k * 9 + j); ctx.stroke(); });
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(100, 20); ctx.lineTo(220, 20); ctx.lineTo(190, 88); ctx.lineTo(130, 88); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
      } else {
        bins(cam, ctx, [270, 300, 200, 72], [730, 300, 130, 72], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, 'APERTURE ' + st.s.aperture + ' mm', 420, 24, 'center');
      }
    }
  };

  /* ======================= SINK-FLOAT TANK ======================= */
  const TANK = { x0: 180, x1: 700, top: 190, bot: 318 };
  S.sinkfloat = {
    omega: () => 6,
    update(cam, dt, st) {
      decay(cam, dt);
      const n = cam.spawnCount(dt, 2.5 + 9 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, 250 + rnd(-10, 10), 30); if (!p) break; p.r = Math.min(p.r, 14); p.mode = 'fall'; p.vy = 40; cam.push(p); }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        p.ang += p.spin * dt * 0.3;
        if (p.mode === 'fall') { p.vy += 480 * dt; p.y += p.vy * dt; if (p.y > TANK.top) { p.mode = p.fate ? 'rise' : 'sink'; cam.spark(p.x, TANK.top, 4, '#8fd0ff'); } }   // #126: a splash
        else if (p.mode === 'rise') { p.vy = Math.max(p.vy - 700 * dt, -90); p.y += p.vy * dt; if (p.y < TANK.top - p.r * 0.2) { p.y = TANK.top - p.r * 0.2; p.vy = 0; p.mode = 'skim'; } }
        else if (p.mode === 'sink') { p.vy = Math.min(p.vy + 100 * dt, 110); p.y += p.vy * dt; if (p.y > TANK.bot - p.r) { p.y = TANK.bot - p.r; p.mode = 'crawl'; } }
        else if (p.mode === 'skim') { p.x += 52 * dt; p.y = TANK.top - p.r * 0.2 + Math.sin(cam.t * 3 + p.seed * 9) * 1.2; if (p.x > TANK.x1 + 20) { p.mode = 'out'; p.vx = 70; p.vy = -10; } }
        else if (p.mode === 'crawl') { p.x += 46 * dt; if (p.x > TANK.x1 + 16) { p.mode = 'outlow'; p.vx = 50; p.vy = 0; } }
        else if (p.mode === 'out') { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 176) { count(cam, 'a'); p.state = 'gone'; } }
        else { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 324) { count(cam, 'b'); p.state = 'gone'; } }
      }
    },
    draw(cam, ctx, st, pass) {
      const dens = clamp((st.s.sg - 1) / 3, 0, 1);
      if (pass === 0) {
        ctx.fillStyle = '#10161e'; ctx.fillRect(TANK.x0, TANK.top - 20, TANK.x1 - TANK.x0, TANK.bot - TANK.top + 32);
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 5; ctx.strokeRect(TANK.x0, TANK.top - 20, TANK.x1 - TANK.x0, TANK.bot - TANK.top + 32);
        ctx.fillStyle = 'rgba(' + Math.round(70 - 30 * dens) + ',' + Math.round(150 - 60 * dens) + ',' + Math.round(210 - 40 * dens) + ',' + (0.28 + 0.3 * dens) + ')';
        ctx.beginPath(); ctx.moveTo(TANK.x0 + 2, TANK.top);
        for (let x = TANK.x0 + 2; x <= TANK.x1 - 2; x += 8) ctx.lineTo(x, TANK.top + Math.sin(x * 0.05 + cam.t * 3) * 1.6);
        ctx.lineTo(TANK.x1 - 2, TANK.bot + 10); ctx.lineTo(TANK.x0 + 2, TANK.bot + 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(220, 14); ctx.lineTo(290, 14); ctx.lineTo(276, 80); ctx.lineTo(234, 80); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        // skimmer paddle wheel and bottom scraper belt
        ctx.save(); ctx.translate(TANK.x1 - 14, TANK.top - 6); ctx.rotate(-cam.phase * 0.5);
        ctx.fillStyle = '#6a7685'; for (let b = 0; b < 4; b++) { ctx.rotate(TAU / 4); ctx.fillRect(0, -2, 26, 4); } ctx.restore();
        ctx.fillStyle = '#20252d'; ctx.fillRect(TANK.x0 + 6, TANK.bot + 2, TANK.x1 - TANK.x0 + 70, 7);
      } else {
        bins(cam, ctx, [730, 118, 130, 62], [730, 292, 130, 70], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, 'MEDIUM ' + st.s.sg.toFixed(2) + ' g/cc', 440, TANK.top - 30, 'center');
      }
    }
  };

  /* ======================= SENSOR SORTER (XRT / LIBS) ======================= */
  // belt from x0 to the head pulley at x1; the scanner arch sits over `scan`, the air-jet bar just past the pulley
  const SNS = { x0: 50, x1: 600, y: 232, scan: 330, jet: 608, split: 735 };
  S.sensor = {
    omega: () => 4,
    init(cam) { cam.scan = 0; cam.scanHit = 0; },
    update(cam, dt, st) {
      decay(cam, dt);
      cam.scan = Math.max(0, (cam.scan || 0) - dt * 5); cam.scanHit = Math.max(0, (cam.scanHit || 0) - dt * 4);
      const n = cam.spawnCount(dt, 3 + 10 * st.load);
      for (let i = 0; i < n; i++) { const p = sepPiece(cam, st, SNS.x0, 0); if (!p) break; p.r = Math.min(p.r, 15); p.y = SNS.y - p.r; p.mode = 'belt'; p.vx = 130; p.tagged = false; cam.push(p); }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'belt') {
          const was = p.x; p.x += 130 * dt; p.ang *= 0.9;
          if (was < SNS.scan && p.x >= SNS.scan) { if (p.fate) { p.tagged = true; cam.scanHit = 1; } else cam.scan = 1; }   // the scanner decides here
          if (p.x >= SNS.x1) {
            p.mode = 'air';
            if (p.tagged) {   // air jet fires: the piece is kicked up and over the splitter
              p.vx = 250 + rnd(-15, 25); p.vy = -rnd(120, 160);
              for (let k = 0; k < 4; k++) cam.fx.push({ x: SNS.jet + rnd(-4, 4), y: SNS.y + 8, vx: rnd(-10, 40), vy: -rnd(120, 220), g: 0, life: 0.22, max: 0.22, size: rnd(2, 4), grow: 14, col: '#ffffff', soft: true });
            } else { p.vx = 130 + rnd(-10, 10); p.vy = 0; }
          }
        } else {
          p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y > 318) { count(cam, p.fate ? 'a' : 'b'); p.state = 'gone'; }
        }
      }
    },
    drawParticlesExtra(cam, ctx) {
      // pieces the scanner recognised carry a green ring until the jets take them
      for (let i = 0; i < cam.parts.length; i++) {
        const p = cam.parts[i]; if (p.mode !== 'belt' || !p.tagged) continue;
        ctx.strokeStyle = 'rgba(92,255,177,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, TAU); ctx.stroke();
      }
    },
    draw(cam, ctx, st, pass) {
      const T = CS.MATERIALS[st.s.target], hit = cam.scanHit || 0, seen = cam.scan || 0;
      if (pass === 0) {
        // belt and head pulley
        ctx.fillStyle = '#20252d'; ctx.fillRect(SNS.x0 - 30, SNS.y, SNS.x1 - SNS.x0 + 30, 9); ctx.fillStyle = '#2d343e'; ctx.fillRect(SNS.x0 - 30, SNS.y, SNS.x1 - SNS.x0 + 30, 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let x = SNS.x0 - 30 + (cam.belt * 2 % 18); x < SNS.x1; x += 18) { ctx.moveTo(x, SNS.y + 3); ctx.lineTo(x, SNS.y + 9); } ctx.stroke();
        ctx.fillStyle = '#2d343e'; ctx.beginPath(); ctx.arc(SNS.x1, SNS.y + 4.5, 7, 0, TAU); ctx.fill();
        // scanner gantry: X-ray tube above the belt, line detector under it
        ctx.fillStyle = '#2d3846'; ctx.fillRect(SNS.scan - 46, 118, 6, 127); ctx.fillRect(SNS.scan + 40, 118, 6, 127);
        ctx.fillStyle = '#18212b'; ctx.fillRect(SNS.scan - 46, 112, 92, 46); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.strokeRect(SNS.scan - 46, 112, 92, 46);
        ctx.fillStyle = '#6a7685'; ctx.fillRect(SNS.scan - 8, 158, 16, 8);                     // tube window
        ctx.fillStyle = '#3b4756'; ctx.fillRect(SNS.scan - 34, SNS.y + 10, 68, 8);             // detector line
        // fan beam: cyan at rest, bright when any piece is read, green when it is the target
        const g = ctx.createLinearGradient(0, 166, 0, SNS.y + 10);
        const col = hit > 0.05 ? '92,255,177' : '127,227,255', a = 0.12 + 0.5 * hit + 0.2 * seen;
        g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(1, 'rgba(' + col + ',' + (a * 0.25) + ')');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(SNS.scan - 6, 166); ctx.lineTo(SNS.scan + 6, 166); ctx.lineTo(SNS.scan + 34, SNS.y + 10); ctx.lineTo(SNS.scan - 34, SNS.y + 10); ctx.closePath(); ctx.fill();
        // decision lamp on the gantry
        ctx.fillStyle = hit > 0.05 ? 'rgba(92,255,177,' + (0.4 + 0.6 * hit) + ')' : '#263038'; ctx.beginPath(); ctx.arc(SNS.scan + 32, 124, 5, 0, TAU); ctx.fill();
        // air-jet valve bar past the head pulley, fed from a receiver tank
        ctx.fillStyle = '#6a7685'; ctx.fillRect(SNS.jet - 7, SNS.y + 12, 14, 28);
        ctx.fillStyle = '#10151c'; for (let k = 0; k < 3; k++) ctx.fillRect(SNS.jet - 2, SNS.y + 15 + k * 8, 4, 3);
        ctx.strokeStyle = '#4f6a82'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(SNS.jet, SNS.y + 40); ctx.lineTo(SNS.jet, 300); ctx.lineTo(540, 300); ctx.stroke();
        ctx.fillStyle = '#273240'; ctx.fillRect(470, 286, 70, 28); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 2; ctx.strokeRect(470, 286, 70, 28);
        label(ctx, 'AIR', 505, 304, '#9fb3c8', 'center');
        // splitter blade between the two chutes
        ctx.fillStyle = '#6a7685'; ctx.beginPath(); ctx.moveTo(SNS.split, 262); ctx.lineTo(SNS.split + 10, 330); ctx.lineTo(SNS.split - 10, 330); ctx.closePath(); ctx.fill();
      } else {
        bins(cam, ctx, [760, 300, 130, 72], [610, 300, 110, 72], st.M.outs.extract, st.M.outs.residue);
        tag(ctx, 'TARGET ' + (T ? T.name : String(st.s.target)).toUpperCase(), SNS.scan, 100, 'center');
      }
    }
  };

  /* ======================= FURNACE (induction, arc, reverberatory) ======================= */
  const FUR = { x0: 300, x1: 600, top: 150, bath: 212, bot: 300 };
  /* incandescence colour of the bath: dull red at 450 C, orange around 1000 C, yellow-white at 1750 C */
  function bathColor(tap) {
    const t = clamp((tap - 450) / 1300, 0, 1);
    return [(200 + 55 * t) | 0, (40 + 190 * t) | 0, (10 + 150 * t * t) | 0];
  }
  S.furnace = {
    omega: () => 4,
    init(cam) { cam.ingots = []; cam.melted = []; cam.pourAcc = 0; },
    update(cam, dt, st) {
      decay(cam, dt);
      if (!cam.ingots) S.furnace.init(cam);
      const [cr, cg, cb] = bathColor(st.s.tap), hot = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      const n = cam.spawnCount(dt, 2 + 8 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const m = st.perMat && st.perMat[mat];
        const mm = (m && m.psd && sampleMm(m.psd)) || sizeIn(st, mat);
        const p = newPiece(mat, mm, 360 + rnd(-22, 22), 14); p.r = Math.min(p.r, 14); p.vy = 40; p.mode = 'charge';
        p.fate = Math.random() < (m ? m.meltFrac : 0);   // true = melts into the bath, false = skimmed to dross
        cam.push(p);
      }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'charge') {
          p.vy += 520 * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y > FUR.bath - p.r * 0.5) {
            p.y = FUR.bath - p.r * 0.5; p.vy = 0;
            if (p.fate) { p.mode = 'melting'; p.t = 0; cam.mist(p.x, FUR.bath - 6, 3, hot, 16); cam.crunch(p, 0.2); }
            else { p.mode = 'float'; p.vx = -rnd(40, 70); }
          }
        } else if (p.mode === 'melting') {   // sinks into the bath, glowing, and shrinks away
          p.t += dt; p.r = Math.max(1, p.r * (1 - dt * 2.2)); p.col = hot; p.y += 12 * dt;
          if (p.t > 0.7 || p.r <= 1.2) { count(cam, 'a'); if (cam.melted.length < 16) cam.melted.push(p.mat); p.state = 'gone'; }
        } else if (p.mode === 'float') {     // unmelted: rides the surface to the skimmer on the left
          p.x += p.vx * dt; p.y = FUR.bath - p.r * 0.4 + Math.sin(cam.t * 3 + p.seed * 9) * 1.2;
          if (p.x < FUR.x0 + 10) { p.mode = 'skim'; p.vx = -70; p.vy = -50; }
        } else if (p.mode === 'skim') {
          p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y > 326) { count(cam, 'b'); p.state = 'gone'; }
        }
      }
      // reverberatory stack smoke
      if (st.M.id === 'kiln' && st.running && Math.random() < dt * 8) cam.fx.push({ x: FUR.x1 + 17 + rnd(-4, 4), y: 4, vx: rnd(-6, 6), vy: -30, g: -8, life: 0.7, max: 0.7, size: 5, grow: 12, col: '#55606c', soft: true });
      // pour: ingots cast at the spout and carried off on the belt, coloured by what melted
      const pouring = !!(cam.cnt && cam.cnt.a > 0.5);
      cam.pourAcc += pouring ? dt * (0.3 + 1.4 * st.load) : 0;
      while (cam.pourAcc >= 1) {
        cam.pourAcc -= 1;
        const mat = cam.melted.length ? cam.melted[Math.floor(Math.random() * cam.melted.length)] : pickMat(st);
        if (!mat) break;
        cam.ingots.push({ x: FUR.x1 + 54, y: 316, vy: 0, w: 46, h: 15, col: CS.MATERIALS[mat].color, heat: 1, state: 'drop' });
        cam.mist(FUR.x1 + 54, 330, 2, hot, 10);
      }
      const ing = cam.ingots;
      for (let i = ing.length - 1; i >= 0; i--) {
        const g = ing[i];
        if (g.state === 'drop') { g.vy += 520 * dt; g.y += g.vy * dt; if (g.y >= 346 - g.h / 2) { g.y = 346 - g.h / 2; g.state = 'belt'; } }
        else { g.x += 55 * dt; g.heat = Math.max(0, g.heat - dt * 0.35); if (g.x > 940) { ing[i] = ing[ing.length - 1]; ing.pop(); } }
      }
    },
    draw(cam, ctx, st, pass) {
      const [cr, cg, cb] = bathColor(st.s.tap), hot = 'rgb(' + cr + ',' + cg + ',' + cb + ')', id = st.M.id;
      const fl = 0.9 + 0.1 * Math.sin(cam.t * 11) * Math.sin(cam.t * 7.3);
      if (pass === 0) {
        // charge chute
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(310, 10); ctx.lineTo(410, 10); ctx.lineTo(392, 60); ctx.lineTo(328, 60); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        // steel shell, firebrick lining, empty freeboard
        ctx.fillStyle = '#2b3340'; ctx.fillRect(FUR.x0 - 30, FUR.top - 10, FUR.x1 - FUR.x0 + 60, FUR.bot - FUR.top + 36);
        ctx.fillStyle = '#6b4a3a'; ctx.fillRect(FUR.x0 - 16, FUR.top, FUR.x1 - FUR.x0 + 32, FUR.bot - FUR.top + 22);
        ctx.fillStyle = '#10151c'; ctx.fillRect(FUR.x0, FUR.top, FUR.x1 - FUR.x0, FUR.bot - FUR.top);
        // glow in the freeboard, then the incandescent bath with a rippling surface
        const gl = ctx.createLinearGradient(0, FUR.top, 0, FUR.bath);
        gl.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)'); gl.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.3 * fl) + ')');
        ctx.fillStyle = gl; ctx.fillRect(FUR.x0, FUR.top, FUR.x1 - FUR.x0, FUR.bath - FUR.top);
        const g = ctx.createLinearGradient(0, FUR.bath, 0, FUR.bot);
        g.addColorStop(0, 'rgba(' + Math.min(255, cr + 40) + ',' + Math.min(255, cg + 50) + ',' + Math.min(255, cb + 60) + ',' + fl + ')');
        g.addColorStop(1, 'rgb(' + ((cr * 0.55) | 0) + ',' + ((cg * 0.4) | 0) + ',' + ((cb * 0.3) | 0) + ')');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(FUR.x0, FUR.bath);
        for (let x = FUR.x0; x <= FUR.x1; x += 10) ctx.lineTo(x, FUR.bath + Math.sin(x * 0.06 + cam.t * 2.5) * 1.5);
        ctx.lineTo(FUR.x1, FUR.bot); ctx.lineTo(FUR.x0, FUR.bot); ctx.closePath(); ctx.fill();
        if (id === 'induction') {   // water-cooled copper coil turns on both walls, pulsing with the field
          ctx.strokeStyle = '#c47a4a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
          for (let y = FUR.top + 18; y < FUR.bot; y += 18) { ctx.globalAlpha = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(cam.t * 9 + y * 0.3)); ctx.beginPath(); ctx.moveTo(FUR.x0 - 26, y); ctx.lineTo(FUR.x0 - 8, y); ctx.moveTo(FUR.x1 + 8, y); ctx.lineTo(FUR.x1 + 26, y); ctx.stroke(); }
          ctx.globalAlpha = 1; ctx.lineCap = 'butt';
        } else if (id === 'arc') {   // three graphite electrodes with arcs to the bath
          for (let k = 0; k < 3; k++) {
            const x = 400 + k * 50, yT = FUR.bath - 36 + 6 * Math.sin(cam.phase + k);
            ctx.fillStyle = '#20242a'; ctx.fillRect(x - 9, 0, 18, yT); ctx.fillStyle = '#3a4350'; ctx.fillRect(x - 14, 0, 28, 14);
            if (st.running && Math.random() < 0.7) { ctx.strokeStyle = 'rgba(190,230,255,' + rnd(0.5, 1) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x + rnd(-8, 8), yT + 14); ctx.lineTo(x + rnd(-6, 6), FUR.bath); ctx.stroke(); if (Math.random() < 0.12) cam.spark(x, FUR.bath - 4, 3, '#dff4ff'); }
          }
        } else {   // reverberatory: burner on the left wall, flame licking over the bath, stack on the right
          ctx.fillStyle = '#3a4350'; ctx.fillRect(FUR.x0 - 48, FUR.top + 24, 34, 24);
          for (let k = 0; k < 7; k++) { const t = k / 7; ctx.fillStyle = 'rgba(255,' + ((120 + 100 * t) | 0) + ',40,' + (0.36 - 0.04 * k) + ')'; ctx.beginPath(); ctx.ellipse(FUR.x0 + 20 + 240 * t, FUR.top + 36 + 16 * t * Math.sin(cam.t * 6 + k * 1.7), 30 - 2 * k, 10 + 2 * k, 0, 0, TAU); ctx.fill(); }
          ctx.fillStyle = '#2b3340'; ctx.fillRect(FUR.x1 + 4, 0, 26, FUR.top);
        }
        // tap spout and launder to the casting belt
        ctx.fillStyle = '#6b4a3a'; ctx.beginPath(); ctx.moveTo(FUR.x1 + 16, FUR.bath - 8); ctx.lineTo(FUR.x1 + 62, FUR.bath + 4); ctx.lineTo(FUR.x1 + 62, FUR.bath + 18); ctx.lineTo(FUR.x1 + 16, FUR.bath + 6); ctx.closePath(); ctx.fill();
        if (cam.cnt && cam.cnt.a > 0.5 && st.running) { ctx.fillStyle = hot; ctx.globalAlpha = 0.8 * fl; ctx.fillRect(FUR.x1 + 54, FUR.bath + 10, 5 + 2 * Math.sin(cam.t * 13), 346 - FUR.bath - 10); ctx.globalAlpha = 1; }
      } else {
        drawBelt(ctx, 346, 560, 900, cam.belt, 55);
        const ing = cam.ingots || [];
        for (let i = 0; i < ing.length; i++) {   // flat bars, glowing while hot, cooling to the metal colour down the belt
          const b = ing[i];
          ctx.fillStyle = b.col; ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
          ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.75 * b.heat) + ')'; ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(b.x - b.w / 2 + 4, b.y - b.h / 2 + 3); ctx.lineTo(b.x + b.w / 2 - 4, b.y - b.h / 2 + 3); ctx.stroke();
        }
        bins(cam, ctx, [700, 60, 130, 50], [200, 296, 110, 62], 'INGOTS', 'DROSS');
        tag(ctx, 'TAP ' + st.s.tap + ' °C', 450, FUR.top - 22, 'center');
        label(ctx, id === 'induction' ? 'INDUCTION COIL' : id === 'arc' ? 'GRAPHITE ELECTRODES' : 'GAS BURNER', 450, FUR.bot + 44, '#7d8da0', 'center');
      }
    }
  };

  /* ======================= OMNIPROCESSOR (end game, ticket #15) ======================= */
  // a long sealed unit: hopper and intake belt at left, rotor cassettes under four scan arches, a fan of chutes at right,
  // one chute per material in the feed. Pieces shrink arch by arch from their feed size to the product size the sim computed.
  const OMN = { x0: 150, x1: 640, top: 128, bot: 272, belt: 212, arches: [235, 335, 435, 535], pivot: [664, 212], reach: 150, spread: 0.92 };
  function omniMats(st) { return (st.comp || []).slice().sort(function (a, b) { return b[1] - a[1]; }).map(function (c) { return c[0]; }); }
  function omniChute(k, n) {   // end point of chute k of n, fanned over +-spread radians from the pivot
    const a = n > 1 ? -OMN.spread + 2 * OMN.spread * k / (n - 1) : 0;
    return [OMN.pivot[0] + OMN.reach * Math.cos(a), OMN.pivot[1] + OMN.reach * Math.sin(a)];
  }
  S.omni = {
    omega: () => 7,
    init(cam) { cam.arcGlow = [0, 0, 0, 0]; cam.arcCol = ['#7fe3ff', '#7fe3ff', '#7fe3ff', '#7fe3ff']; cam.chuteHit = {}; },
    update(cam, dt, st) {
      if (!cam.arcGlow) S.omni.init(cam);
      const mats = omniMats(st); cam.omniMats = mats;
      for (let k = 0; k < 4; k++) cam.arcGlow[k] = Math.max(0, cam.arcGlow[k] - dt * 3);
      for (const m in cam.chuteHit) cam.chuteHit[m] = Math.max(0, cam.chuteHit[m] - dt * 2);
      const n = cam.spawnCount(dt, 4 + 14 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 70 + rnd(-14, 14), 12); p.r = Math.min(p.r, 16); p.r0 = p.r; p.vy = 40; p.mode = 'fall';
        p.rOut = clamp(pxOf(sizeOut(st, mat)), 1.6, p.r0); p.stage = 0; cam.push(p);
      }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        if (p.mode === 'fall') {   // drop out of the hopper onto the intake belt
          p.vy += 520 * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
          if (p.y >= OMN.belt - p.r) { p.y = OMN.belt - p.r; p.vy = 0; p.mode = 'belt'; p.vx = 120 + rnd(-10, 10); }
        } else if (p.mode === 'belt') {   // through the arches: each one breaks the piece a step closer to the product size
          const was = p.x; p.x += p.vx * dt; p.ang *= 0.92; p.y = OMN.belt - p.r + Math.sin(cam.t * 20 + p.seed * 9) * (p.x > OMN.x0 ? 1.5 : 0);
          for (let k = p.stage; k < 4; k++) {
            if (was < OMN.arches[k] && p.x >= OMN.arches[k]) {
              p.stage = k + 1; p.r = lerp(p.r0, p.rOut, p.stage / 4);
              cam.arcGlow[k] = 1; cam.arcCol[k] = p.col;
              if (Math.random() < 0.35) cam.spark(p.x, OMN.belt - p.r, 2, p.col);
              if (k === 1 && Math.random() < 0.3) cam.crunch(p, clamp(p.r0 / 16, 0.2, 0.8));
            }
          }
          if (p.x >= OMN.pivot[0] - 8) {   // the jet bank fires the piece down the chute of its own material
            const k = Math.max(0, mats.indexOf(p.mat)), end = omniChute(k, mats.length);
            p.mode = 'chute'; p.t = 0; p.sx = p.x; p.sy = p.y; p.ex = end[0]; p.ey = end[1];
          }
        } else if (p.mode === 'chute') {
          p.t += dt * 1.6; const t = Math.min(1, p.t);
          p.x = lerp(p.sx, p.ex, t); p.y = lerp(p.sy, p.ey, t) - Math.sin(t * Math.PI) * 10; p.ang += p.spin * dt;
          if (t >= 1) { cam.chuteHit[p.mat] = 1; p.state = 'gone'; }
        }
      }
    },
    drawParticlesExtra(cam, ctx) {
      // a faint halo in the material colour on every piece inside the enclosure: the scanners have already read it
      for (let i = 0; i < cam.parts.length; i++) {
        const p = cam.parts[i]; if (p.mode !== 'belt' || p.x < OMN.x0 || p.stage < 1) continue;
        ctx.globalAlpha = 0.35; ctx.strokeStyle = p.col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
    },
    draw(cam, ctx, st, pass) {
      const mats = cam.omniMats || omniMats(st), glow = cam.arcGlow || [0, 0, 0, 0], cols = cam.arcCol || [];
      const pulse = 0.5 + 0.5 * Math.sin(cam.phase * 0.8);
      if (pass === 0) {
        // intake hopper
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(120, 8); ctx.lineTo(96, 70); ctx.lineTo(44, 70); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        // chutes: one per material, coloured by it, brighter while a piece is riding down
        for (let k = 0; k < mats.length; k++) {
          const e = omniChute(k, mats.length), D = CS.MATERIALS[mats[k]], h = (cam.chuteHit && cam.chuteHit[mats[k]]) || 0;
          ctx.strokeStyle = '#1b232d'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(OMN.pivot[0], OMN.pivot[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
          ctx.globalAlpha = 0.35 + 0.5 * h; ctx.strokeStyle = D.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(OMN.pivot[0] + 10, OMN.pivot[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); ctx.globalAlpha = 1;
        }
        // the enclosure: dark chamber, intake belt running through it, rotor cassettes under the arches
        ctx.fillStyle = '#0e141c'; ctx.fillRect(OMN.x0, OMN.top, OMN.x1 - OMN.x0, OMN.bot - OMN.top);
        ctx.fillStyle = '#20252d'; ctx.fillRect(30, OMN.belt, OMN.pivot[0] - 30, 9); ctx.fillStyle = '#2d343e'; ctx.fillRect(30, OMN.belt, OMN.pivot[0] - 30, 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let x = 30 + (cam.belt * 2 % 18); x < OMN.pivot[0]; x += 18) { ctx.moveTo(x, OMN.belt + 3); ctx.lineTo(x, OMN.belt + 9); } ctx.stroke();
        OMN.arches.forEach(function (x) { gear(ctx, x, OMN.belt + 30, 14, 9, cam.phase * 1.6, '#2a3340', '#56677a'); });
      } else {
        // shell over the particles: roof and floor plates round a glazed slot, so the stream stays visible
        ctx.fillStyle = '#1a222c'; ctx.fillRect(OMN.x0 - 8, OMN.top - 26, OMN.x1 - OMN.x0 + 16, 26); ctx.fillRect(OMN.x0 - 8, OMN.bot, OMN.x1 - OMN.x0 + 16, 22);
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.strokeRect(OMN.x0 - 8, OMN.top - 26, OMN.x1 - OMN.x0 + 16, OMN.bot - OMN.top + 48);
        ctx.strokeStyle = 'rgba(127,227,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(OMN.x0, OMN.top, OMN.x1 - OMN.x0, OMN.bot - OMN.top);
        ctx.fillStyle = 'rgba(127,227,255,' + (0.25 + 0.35 * pulse) + ')';
        for (let x = OMN.x0 + 10; x < OMN.x1 - 10; x += 22) ctx.fillRect(x, OMN.top - 14, 10, 3);   // status lights along the roof
        // scan arches: a ring of light round the stream, flaring in the colour of the last piece read
        OMN.arches.forEach(function (x, k) {
          const g = glow[k] || 0, col = g > 0.05 && cols[k] ? cols[k] : '#7fe3ff';
          ctx.save(); ctx.globalAlpha = 0.25 + 0.25 * pulse + 0.5 * g; ctx.strokeStyle = col; ctx.lineWidth = 4 + 3 * g;
          ctx.beginPath(); ctx.ellipse(x, (OMN.top + OMN.bot) / 2, 14, (OMN.bot - OMN.top) / 2 + 10, 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 0.08 + 0.18 * g; ctx.fillStyle = col; ctx.fillRect(x - 10, OMN.top, 20, OMN.bot - OMN.top); ctx.restore();
        });
        // jet bank at the outlet
        ctx.fillStyle = '#6a7685'; ctx.fillRect(OMN.x1, OMN.belt - 26, 12, 52);
        ctx.fillStyle = '#10151c'; for (let k = 0; k < 5; k++) ctx.fillRect(OMN.x1 + 4, OMN.belt - 22 + k * 10, 4, 4);
        // chute end labels: material and its share of the feed
        let tot = 0; (st.comp || []).forEach(function (c) { tot += c[1]; });
        const share = {}; (st.comp || []).forEach(function (c) { share[c[0]] = tot > 0 ? c[1] / tot : 0; });
        for (let k = 0; k < mats.length; k++) {
          const e = omniChute(k, mats.length), D = CS.MATERIALS[mats[k]];
          ctx.fillStyle = D.color; ctx.fillRect(e[0] - 4, e[1] - 4, 8, 8);
          label(ctx, D.name.slice(0, 4).toUpperCase() + ' ' + Math.round(100 * (share[mats[k]] || 0)) + '%', e[0] + 8, e[1] + 4, '#9fb3c8', 'left');
        }
        tag(ctx, 'TARGET ' + st.s.target + ' mm · ' + mats.length + ' STREAMS', (OMN.x0 + OMN.x1) / 2, OMN.top - 34, 'center');
        label(ctx, 'THROUGHPUT ' + st.s.rate + '%', (OMN.x0 + OMN.x1) / 2, OMN.bot + 40, '#7d8da0', 'center');
      }
    }
  };

  S.fallback = { omega: () => 1, update() {}, draw(cam, ctx) { label(ctx, 'NO VIEW FOR THIS MACHINE', 450, 190, '#7fe3ff', 'center'); } };
  CS.Scenes.sampleMm = sampleMm;
})(typeof window !== 'undefined' ? window : globalThis);
