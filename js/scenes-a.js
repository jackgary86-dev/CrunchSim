/* Machine cam scenes, part A: compression, impact/rotor, shear/cutting, tumbling. */
(function (G) {
  'use strict';
  const CS = G.CS, U = CS.CamUtil, S = CS.Scenes;
  const { TAU, rnd, clamp, lerp, pxOf, gapPx, pickMat, sizeIn, sizeOut, respOf, newPiece, drawBelt, gear, label, wedgeUpdate } = U;
  const wrap = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

  function strip(ctx, fn, y0, y1, dx0, dx1, fill, stroke) {
    ctx.beginPath();
    for (let y = y0; y <= y1; y += 8) ctx.lineTo(fn(y) + dx0, y);
    for (let y = y1; y >= y0; y -= 8) ctx.lineTo(fn(y) + dx1, y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke || '#0a0e13'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function teeth(ctx, fn, y0, y1, dir, step, col) {
    ctx.fillStyle = col; ctx.beginPath();
    for (let y = y0 + 6; y < y1 - 6; y += step) {
      const x = fn(y); ctx.moveTo(x, y); ctx.lineTo(x + dir * 6, y + step / 2); ctx.lineTo(x, y + step);
    }
    ctx.fill();
  }
  function frame(ctx, x, y, w, h) { ctx.fillStyle = '#141a22'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#26303c'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
  function hopper(ctx, xl, xr, y0, y1, w0) {
    ctx.beginPath(); ctx.moveTo(xl - w0, y0); ctx.lineTo(xr + w0, y0); ctx.lineTo(xr, y1); ctx.lineTo(xl, y1); ctx.closePath();
    ctx.fillStyle = '#1b2430'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 2; ctx.stroke();
  }
  function tag(ctx, text, x, y, align) { label(ctx, text, x, y, '#7fe3ff', align); }

  /* ======================= JAW ======================= */
  function jawGeom(cam, st) {
    const yT = 62, yB = 300, gC = 1.4 * gapPx(st.s.css);
    const s = (1 + Math.cos(cam.phase)) / 2;
    const t = (y) => clamp((y - yT) / (yB - yT), 0, 1);
    const xf = (y) => 328 + 95 * t(y);
    const xm = (y) => xf(y) + lerp(170, gC, t(y)) + s * lerp(10, 30, t(y));
    return { yT, yB, xf, xm, gC, s };
  }
  S.jaw = {
    omega: () => 7,
    update(cam, dt, st) { const g = jawGeom(cam, st); wedgeUpdate(cam, dt, st, [{ yTop: g.yT, yBot: g.yB, xl: g.xf, xr: g.xm }], {}); },
    draw(cam, ctx, st, pass) {
      const g = jawGeom(cam, st);
      if (pass === 0) {
        frame(ctx, 240, 36, 420, 304);
        hopper(ctx, g.xf(g.yT) - 6, g.xm(g.yT) + 6, 14, g.yT, 50);
        strip(ctx, g.xf, g.yT, g.yB + 6, -44, 0, '#46515f');
        teeth(ctx, g.xf, g.yT, g.yB, 1, 14, '#6a7685');
        strip(ctx, g.xm, g.yT, g.yB + 6, 0, 34, '#3d4856');
        teeth(ctx, g.xm, g.yT, g.yB, -1, 14, '#6a7685');
        // pitman and toggle
        const cr = 15, fx = 745, fy = 112;
        gear(ctx, fx, fy, 58, 14, cam.phase, '#2a3340', '#56677a');
        const ex = fx + Math.cos(cam.phase) * cr, ey = fy + Math.sin(cam.phase) * cr;
        ctx.strokeStyle = '#59697b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(g.xm(g.yT + 24) + 34, g.yT + 24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(g.xm(g.yB - 8) + 34, g.yB - 8); ctx.lineTo(668, 318); ctx.stroke(); ctx.lineCap = 'butt';
        ctx.fillStyle = '#1c2530'; ctx.fillRect(660, 300, 40, 40);
      } else {
        tag(ctx, 'CSS ' + st.s.css + ' mm', (g.xf(g.yB) + g.xm(g.yB)) / 2, g.yB + 26, 'center');
        ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(g.xf(g.yB), g.yB + 10); ctx.lineTo(g.xf(g.yB) + g.gC, g.yB + 10); ctx.stroke();
        drawBelt(ctx, 346, 250, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= CONE ======================= */
  function coneGeom(cam, st) {
    const yT = 76, yB = 300, cx = 450, A = 14, gC = 1.3 * gapPx(st.s.css);
    const t = (y) => clamp((y - yT) / (yB - yT), 0, 1);
    const hm = (y) => lerp(40, 92, t(y));
    const d = Math.cos(cam.phase);
    const dl = (y) => d * A * t(y);
    const hb = (y) => hm(y) + lerp(150, gC + A, t(y));
    return { yT, yB, cx, hm, dl, hb, gC };
  }
  S.cone = {
    omega: () => 6,
    update(cam, dt, st) {
      const g = coneGeom(cam, st);
      wedgeUpdate(cam, dt, st, [
        { yTop: g.yT, yBot: g.yB, xl: (y) => g.cx - g.hb(y), xr: (y) => g.cx - g.hm(y) + g.dl(y) },
        { yTop: g.yT, yBot: g.yB, xl: (y) => g.cx + g.hm(y) + g.dl(y), xr: (y) => g.cx + g.hb(y) }
      ], {});
    },
    draw(cam, ctx, st, pass) {
      const g = coneGeom(cam, st);
      if (pass === 0) {
        frame(ctx, 220, 36, 460, 304);
        hopper(ctx, g.cx - g.hb(g.yT) - 6, g.cx + g.hb(g.yT) + 6, 16, g.yT, 40);
        strip(ctx, (y) => g.cx - g.hb(y), g.yT, g.yB + 6, -60, 0, '#46515f');
        strip(ctx, (y) => g.cx + g.hb(y), g.yT, g.yB + 6, 0, 60, '#46515f');
        // mantle (rocking cone)
        ctx.beginPath(); ctx.moveTo(g.cx - 26 + g.dl(g.yT) * 0.2, g.yT - 22); ctx.lineTo(g.cx + 26 + g.dl(g.yT) * 0.2, g.yT - 22);
        for (let y = g.yT; y <= g.yB + 6; y += 8) ctx.lineTo(g.cx + g.hm(y) + g.dl(y), y);
        for (let y = g.yB + 6; y >= g.yT; y -= 8) ctx.lineTo(g.cx - g.hm(y) + g.dl(y), y);
        ctx.closePath(); ctx.fillStyle = '#4c5867'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(g.cx - 8 + g.dl(g.yT) * 0.2, g.yT - 18); ctx.lineTo(g.cx - 28 + g.dl(g.yB), g.yB); ctx.stroke();
        gear(ctx, g.cx, 322, 22, 12, cam.phase, '#2a3340', '#56677a');
      } else {
        tag(ctx, 'CSS ' + st.s.css + ' mm', g.cx, 20, 'center');
        drawBelt(ctx, 346, 220, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= ROLLS and HPGR ======================= */
  function rollScene(cfg) {
    function geom(st) {
      const R = cfg.R, yc = 218, g = 1.2 * gapPx(st.s[cfg.key]);
      const x1 = 450 - R - g / 2, x2 = 450 + R + g / 2;
      const hw = (y) => { const d = y - yc; return Math.sqrt(Math.max(0, R * R - d * d)); };
      return { R, yc, g, x1, x2, hw };
    }
    return {
      omega: () => cfg.w,
      update(cam, dt, st) {
        const g = geom(st);
        wedgeUpdate(cam, dt, st, [{ yTop: g.yc - g.R * 0.92, yBot: g.yc + 6, xl: (y) => g.x1 + g.hw(y), xr: (y) => g.x2 - g.hw(y) }], { continuous: true });
      },
      draw(cam, ctx, st, pass) {
        const g = geom(st);
        if (pass === 0) {
          frame(ctx, 210, 40, 480, 296);
          hopper(ctx, 450 - g.R * 0.7, 450 + g.R * 0.7, 18, g.yc - g.R * 0.9, 70);
          [[g.x1, 1], [g.x2, -1]].forEach(function (a) {
            ctx.save(); ctx.translate(a[0], g.yc); ctx.rotate(cam.phase * a[1]);
            ctx.beginPath(); ctx.arc(0, 0, g.R, 0, TAU); ctx.fillStyle = '#46515f'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
            ctx.strokeStyle = '#5f6d7d'; ctx.lineWidth = 3;
            for (let i = 0; i < 24; i++) {
              const an = i / 24 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(an) * (g.R - 2), Math.sin(an) * (g.R - 2));
              ctx.lineTo(Math.cos(an) * (g.R + (cfg.stud ? 3 : -8)), Math.sin(an) * (g.R + (cfg.stud ? 3 : -8))); ctx.stroke();
            }
            ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(0, 0, g.R * 0.35, 0, TAU); ctx.fill();
            ctx.strokeStyle = '#7b8794'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-g.R * 0.3, 0); ctx.lineTo(g.R * 0.3, 0); ctx.stroke();
            ctx.restore();
          });
          if (cfg.stud) { // hydraulic cylinders squeezing the floating roll
            ctx.fillStyle = '#273240'; ctx.fillRect(g.x2 + g.R + 12, g.yc - 18, 70, 36);
            ctx.fillStyle = '#c9a24a'; ctx.fillRect(g.x2 + g.R, g.yc - 5, 14, 10);
            ctx.fillStyle = '#273240'; ctx.fillRect(g.x1 - g.R - 82, g.yc - 18, 70, 36);
            ctx.fillStyle = '#6a7685'; ctx.fillRect(g.x1 - g.R - 14, g.yc - 5, 14, 10);
          }
        } else {
          tag(ctx, (cfg.key === 'gap' ? 'GAP ' : '') + st.s[cfg.key] + ' mm' + (cfg.stud ? '   ' + st.s.press + ' bar' : ''), 450, g.yc + g.R + 24, 'center');
          drawBelt(ctx, 346, 210, 900, cam.belt, 60);
        }
      }
    };
  }
  S.roll = rollScene({ R: 74, w: 2.6, key: 'gap' });
  S.hpgr = rollScene({ R: 92, w: 1.6, key: 'gap', stud: true });

  /* ======================= ROTOR family: hammermill, tub grinder, cryogenic mill ======================= */
  function rotorHit(cam, p, st, om, al, rho, cfg) {
    p.cool = 0.09; p.hits++;
    const tx = -Math.sin(al), ty = Math.cos(al), v = om * rho * 0.75;
    const r = respOf(st, p.mat);
    const small = p.mm <= Math.max((st.P80 || 1) * 0.6, 0.15);
    if (p.liquid) { p.vx = tx * v * 0.4 + rnd(-40, 40); p.vy = ty * v * 0.4; return; }
    if (!small && (Math.random() < clamp(r * 1.3, 0.06, 1) || p.hits >= 4)) {
      const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.5), 2, 6));
      for (let k = 0; k < nf; k++) {
        const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.05, p.mm * 0.8), p.x + rnd(-5, 5), p.y + rnd(-5, 5));
        q.vx = tx * v * rnd(0.3, 0.8) + rnd(-110, 110); q.vy = ty * v * rnd(0.3, 0.8) + rnd(-110, 80);
        q.inside = true; q.hits = p.hits; q.tint = p.tint; q.liquid = false; q.cool = 0.05; cam.push(q);
      }
      cam.crunch(p, clamp(p.r / 14, 0.3, 1.4)); if (p.D.hard > 0.5) cam.spark(p.x, p.y, 3);
      if (p.D.ductility < 0.3 && Math.random() < 0.5) cam.mist(p.x, p.y, 2, 'rgba(190,178,158,.55)', 35);   // #126: dust off brittle material
      p.state = 'gone';
    } else {
      p.vx = tx * v + rnd(-80, 80); p.vy = ty * v + rnd(-80, 80) - 50;
      p.r *= 0.93; p.mm *= 0.9; p.ay = lerp(p.ay, 1, 0.25); p.ax = lerp(p.ax, 1, 0.25);
      cam.crunch(p, 0.5);
    }
  }
  function rotorScene(cfg) {
    return {
      omega: (st) => cfg.w * (st.M.id === 'hammer' ? 0.7 + 0.3 * (st.s.rpm / 100) : 1),
      update(cam, dt, st) {
        const om = this.omega(st), cx = cfg.cx, cy = cfg.cy;
        const n = cam.spawnCount(dt, 1.5 + 8 * st.load);
        for (let i = 0; i < n; i++) {
          const mat = pickMat(st); if (!mat) break;
          const p = newPiece(mat, sizeIn(st, mat), 0, 0);
          cfg.spawn(p); p.liquid = p.D.state === 'liquid' && !st.temp;
          if (cfg.cold) p.tint = 0.85;
          p.inside = false; cam.push(p);
        }
        if (cfg.cold && st.running && Math.random() < dt * 40) cam.mist(cx - 40 + rnd(-10, 10), cy - cfg.casing - 20, 1, '#e8f6ff', 25);
        const hole = clamp(pxOf((st.topMm || 40)) * 0.95, 4, 26);
        const arr = cam.parts;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i]; if (p.state !== 'free') continue;
          p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt; p.cool = Math.max(0, (p.cool || 0) - dt);
          if (cfg.floor && !p.inside && p.y > cfg.floor - p.r) { p.y = cfg.floor - p.r; p.vy = 0; p.vx = 75; }
          const dx = p.x - cx, dy = p.y - cy, rho = Math.hypot(dx, dy) || 1, al = Math.atan2(dy, dx);
          if (!p.inside) { if (rho < cfg.casing - p.r * 0.6) p.inside = true; else continue; }
          if (!p.cool && rho < cfg.tip + p.r * 0.7 && rho > cfg.hub) {
            for (let h = 0; h < cfg.nHam; h++) {
              const d = wrap(al - (cam.phase + h * TAU / cfg.nHam));
              if (d < om * dt * 1.6 + 0.12 + p.r / rho * 0.5) { rotorHit(cam, p, st, om, al, rho, cfg); break; }
            }
            if (p.state !== 'free') continue;
          }
          if (rho + p.r > cfg.casing) {
            const nx = dx / rho, ny = dy / rho, a = wrap(al);
            const inGrate = a > cfg.gA0 && a < cfg.gA1;
            if (inGrate && (p.liquid || (p.r <= hole && p.mm <= (st.topMm || 1e9) * 1.05))) {
              p.state = 'drop'; p.x = cx + nx * cfg.casing; p.y = cy + ny * cfg.casing; p.vx = nx * 70 + rnd(-20, 20); p.vy = ny * 120 + 40; p.tint = cfg.cold ? 0.4 : 0; continue;
            }
            const vn = p.vx * nx + p.vy * ny;
            if (vn > 0) { p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny; }
            p.x = cx + nx * (cfg.casing - p.r - 0.5); p.y = cy + ny * (cfg.casing - p.r - 0.5);
          } else if (rho < cfg.hub + p.r) { p.x = cx + dx / rho * (cfg.hub + p.r); p.y = cy + dy / rho * (cfg.hub + p.r); }
        }
      },
      draw(cam, ctx, st, pass) {
        const cx = cfg.cx, cy = cfg.cy;
        if (pass === 0) {
          // feed
          if (cfg.floor) { // tub
            ctx.beginPath(); ctx.moveTo(110, 96); ctx.lineTo(cx - cfg.casing - 30, 96); ctx.lineTo(cx - cfg.casing - 4, cfg.floor + 6); ctx.lineTo(110, cfg.floor + 6); ctx.closePath();
            ctx.fillStyle = '#18212b'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
            ctx.strokeStyle = 'rgba(127,227,255,0.25)'; ctx.lineWidth = 2; ctx.beginPath();
            for (let x = 118 + (cam.belt % 24); x < cx - cfg.casing - 6; x += 24) { ctx.moveTo(x, cfg.floor + 2); ctx.lineTo(x, cfg.floor + 6); }
            ctx.stroke();
            label(ctx, 'ROTATING TUB', 220, 118, '#4f6a82', 'center');
          } else {
            ctx.beginPath(); ctx.moveTo(cx - 150, 22); ctx.lineTo(cx + 60, 22); ctx.lineTo(cx + 30, cy - cfg.casing + 8); ctx.lineTo(cx - 90, cy - cfg.casing + 8); ctx.closePath();
            ctx.fillStyle = '#18212b'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
          }
          // casing
          ctx.beginPath(); ctx.arc(cx, cy, cfg.casing, 0, TAU); ctx.fillStyle = '#0d131a'; ctx.fill();
          ctx.lineWidth = 18; ctx.strokeStyle = cfg.cold ? '#2c4a62' : '#242e3a';
          ctx.beginPath(); ctx.arc(cx, cy, cfg.casing + 9, 0, TAU); ctx.stroke();
          // grate
          ctx.lineWidth = 6; ctx.strokeStyle = '#4b5968'; ctx.setLineDash([3, 7]);
          ctx.beginPath(); ctx.arc(cx, cy, cfg.casing - 1, cfg.gA0, cfg.gA1); ctx.stroke(); ctx.setLineDash([]);
          // rotor
          const om = this.omega(st);
          ctx.fillStyle = '#2f3946'; ctx.beginPath(); ctx.arc(cx, cy, cfg.hub, 0, TAU); ctx.fill();
          for (let h = 0; h < cfg.nHam; h++) {
            const th = cam.phase + h * TAU / cfg.nHam - 0.1 * Math.min(1, om / 4);
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(th);
            ctx.fillStyle = '#6f7c8b'; ctx.fillRect(cfg.hub - 4, -6, cfg.tip - cfg.hub + 4, 12);
            ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1; ctx.strokeRect(cfg.hub - 4, -6, cfg.tip - cfg.hub + 4, 12);
            ctx.fillStyle = cfg.carbide ? '#e8d8a0' : '#a8b4c2'; ctx.fillRect(cfg.tip - 12, -8, 12, 16);
            ctx.restore();
          }
          ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(cx, cy, cfg.hub * 0.45, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#7b8794'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(cam.phase) * cfg.hub * 0.4, cy + Math.sin(cam.phase) * cfg.hub * 0.4); ctx.stroke();
        } else {
          if (cfg.cold) { // frost speckle on the casing and LN2 inlet
            ctx.fillStyle = 'rgba(220,240,255,0.5)';
            for (let i = 0; i < 40; i++) { const a = i * 2.399, rr = cfg.casing + 4 + (i % 5) * 3; ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2, 2); }
            ctx.fillStyle = '#2c4a62'; ctx.fillRect(cx - 80, cy - cfg.casing - 44, 80, 16);
            label(ctx, 'LN2  -196 C', cx - 40, cy - cfg.casing - 50, '#a9dcff', 'center');
          }
          tag(ctx, cfg.label(st), cx, cy + cfg.casing + 30, 'center');
          drawBelt(ctx, 346, 120, 900, cam.belt, 60);
        }
      }
    };
  }
  const HAM = { cx: 450, cy: 200, hub: 30, tip: 98, casing: 126, nHam: 6, w: 9, gA0: 0.3, gA1: 2.85,
    spawn: (p) => { p.x = 420 + rnd(-30, 30); p.y = 30; p.vy = 80; p.vx = rnd(-10, 25); },
    label: (st) => 'GRATE ' + st.s.grate + ' mm   ' + st.s.rpm + '% RPM' };
  S.hammer = rotorScene(HAM);
  S.tub = rotorScene({ cx: 520, cy: 210, hub: 26, tip: 86, casing: 110, nHam: 4, w: 7, gA0: 0.3, gA1: 2.85, floor: 264, carbide: true,
    spawn: (p) => { p.x = 150 + rnd(0, 150); p.y = 70; p.vx = rnd(20, 60); },
    label: (st) => 'SCREEN ' + st.s.screen + ' mm' });
  S.cryo = rotorScene({ cx: 470, cy: 212, hub: 22, tip: 80, casing: 102, nHam: 4, w: 11, gA0: 0.3, gA1: 2.85, cold: true,
    spawn: (p) => { p.x = 450 + rnd(-25, 25); p.y = 40; p.vy = 80; p.vx = rnd(-10, 20); },
    label: (st) => 'TARGET P80 ' + st.s.target + ' mm' });

  /* ======================= VSI ======================= */
  S.vsi = {
    omega: (st) => 4 + st.s.tip / 8,
    update(cam, dt, st) {
      const cx = 450, cy = 190, ring = 128;
      const n = cam.spawnCount(dt, 2 + 9 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), cx + rnd(-8, 8), 28); p.vy = 120; p.mode = 'feed'; p.liquid = p.D.state === 'liquid' && !st.temp; cam.push(p);
      }
      const arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        p.ang += p.spin * dt;
        if (p.mode === 'feed') {
          p.y += p.vy * dt; p.vy += 300 * dt;
          if (p.y > cy - 30) { // caught by the rotor and flung
            const a = rnd(0, TAU), v = 160 + st.s.tip * 3.2; p.mode = 'fling'; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.x = cx; p.y = cy;
          }
        } else if (p.mode === 'fling') {
          p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
          const rho = Math.hypot(p.x - cx, p.y - cy);
          if (rho > ring - p.r) { // impact on the anvil ring
            const r = respOf(st, p.mat);
            const nx = (p.x - cx) / rho, ny = (p.y - cy) / rho;
            if (!p.liquid && p.mm > Math.max(st.P80 * 0.7, 0.2) && (Math.random() < clamp(r * 1.2, 0.05, 1) || p.hits > 3)) {
              const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.5), 2, 6));
              for (let k = 0; k < nf; k++) {
                const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.05, p.mm * 0.8), cx + nx * (ring - 6), cy + ny * (ring - 6));
                q.mode = 'fall'; q.vx = -nx * rnd(20, 90) + rnd(-50, 50); q.vy = -ny * rnd(20, 80) + rnd(-30, 30); cam.push(q);
              }
              cam.crunch(p, clamp(p.r / 14, 0.3, 1.4)); cam.spark(p.x, p.y, 2, '#cfe6ff'); p.state = 'gone';
            } else {
              p.hits++; const vn = p.vx * nx + p.vy * ny; p.vx -= 1.7 * vn * nx; p.vy -= 1.7 * vn * ny; p.x = cx + nx * (ring - p.r - 1); p.y = cy + ny * (ring - p.r - 1); p.mode = 'fall'; p.r *= 0.95; cam.crunch(p, 0.4);
            }
          }
        } else { // fall: drops down the housing to the discharge
          p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          const rho = Math.hypot(p.x - cx, p.y - cy);
          if (rho > ring - p.r && p.y < 300) { const nx = (p.x - cx) / rho, ny = (p.y - cy) / rho, vn = p.vx * nx + p.vy * ny; if (vn > 0) { p.vx -= 1.4 * vn * nx; p.vy -= 1.4 * vn * ny; } p.x = cx + nx * (ring - p.r - 1); p.y = cy + ny * (ring - p.r - 1); }
          if (p.y > 312) { p.state = 'drop'; p.vx = rnd(-20, 20); p.vy = 60; p.x = clamp(p.x, 410, 490); }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      const cx = 450, cy = 190, ring = 128;
      if (pass === 0) {
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(cx - 40, 8); ctx.lineTo(cx + 40, 8); ctx.lineTo(cx + 14, 70); ctx.lineTo(cx - 14, 70); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU); ctx.fillStyle = '#0d131a'; ctx.fill();
        ctx.lineWidth = 16; ctx.strokeStyle = '#242e3a'; ctx.beginPath(); ctx.arc(cx, cy, ring + 8, 0, TAU); ctx.stroke();
        for (let i = 0; i < 18; i++) { // anvils / rock shelf
          const a = i / 18 * TAU; ctx.save(); ctx.translate(cx + Math.cos(a) * (ring + 2), cy + Math.sin(a) * (ring + 2)); ctx.rotate(a);
          ctx.fillStyle = '#6d7886'; ctx.fillRect(-8, -9, 12, 18); ctx.restore();
        }
        ctx.beginPath(); ctx.moveTo(cx - ring + 10, cy + 82); ctx.lineTo(cx - 36, 318); ctx.lineTo(cx + 36, 318); ctx.lineTo(cx + ring - 10, cy + 82); ctx.fillStyle = '#18212b'; ctx.fill();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(cam.phase);
        ctx.fillStyle = '#3c4755'; ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
        for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); ctx.fillStyle = '#0d131a'; ctx.fillRect(14, -5, 26, 10); ctx.fillStyle = '#c9d4e0'; ctx.fillRect(38, -6, 5, 12); }
        ctx.restore();
      } else {
        tag(ctx, 'TIP SPEED ' + st.s.tip + ' m/s', cx, 360 - 20, 'center');
        drawBelt(ctx, 346, 120, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= SHEAR family ======================= */
  S.twin = {
    omega: () => 2.2,
    update(cam, dt, st) {
      const n = cam.spawnCount(dt, 1.8 + 7 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 450 + rnd(-70, 70), 30); p.vy = 60; p.liquid = p.D.state === 'liquid' && !st.temp; cam.push(p);
      }
      const widthPx = clamp(pxOf(st.s.width) * 1.1, 4, 18), arr = cam.parts;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free') continue;
        p.t += dt; p.vy = Math.min(p.vy + 480 * dt, 260); p.y += p.vy * dt; p.ang += p.spin * dt * 0.3;
        const wallL = 330 + (p.y - 50) * 0.32, wallR = 570 - (p.y - 50) * 0.32;
        if (p.x < wallL + p.r) p.x = wallL + p.r; if (p.x > wallR - p.r) p.x = wallR - p.r;
        p.x += (450 - p.x) * Math.min(1, dt * (p.y > 150 ? 4 : 0.8));
        if (p.y > 178 && p.state === 'free') {
          if (p.liquid) { p.state = 'drop'; p.vx = rnd(-40, 40); p.vy = 120; continue; }
          const r = respOf(st, p.mat);
          if (p.mm > Math.max(st.P80 * 0.5, 0.2) && r > 0.15) { // torn into strips
            const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.45), 2, 5));
            for (let k = 0; k < nf; k++) {
              const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.1, p.mm * 0.9), 450 + rnd(-24, 24), 232 + rnd(0, 12));
              q.r = Math.max(2, Math.min(q.r, widthPx * 1.4)); q.ax = clamp(1.7 + rnd(0, 0.9), 1, 3); q.ay = 0.42; q.state = 'drop'; q.vx = rnd(-30, 30); q.vy = 70 + rnd(0, 40); cam.push(q);
            }
            cam.crunch(p, clamp(p.r / 14, 0.3, 1.3)); p.state = 'gone';
          } else { p.state = 'drop'; p.x = 450 + rnd(-14, 14); p.y = 240; p.vx = rnd(-20, 20); p.vy = 60; }
        }
      }
    },
    draw(cam, ctx, st, pass) {
      if (pass === 0) {
        frame(ctx, 290, 20, 320, 310);
        ctx.beginPath(); ctx.moveTo(300, 30); ctx.lineTo(600, 30); ctx.lineTo(540, 190); ctx.lineTo(360, 190); ctx.closePath();
        ctx.fillStyle = '#1b2430'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        const R = 40, teethN = 6;
        [[414, 1], [486, -1]].forEach(function (a) {
          ctx.save(); ctx.translate(a[0], 214); ctx.rotate(cam.phase * a[1]);
          ctx.beginPath(); ctx.arc(0, 0, R - 8, 0, TAU); ctx.fillStyle = '#3d4856'; ctx.fill();
          for (let i = 0; i < teethN; i++) {
            ctx.save(); ctx.rotate(i * TAU / teethN);
            ctx.beginPath(); ctx.moveTo(R - 14, -9); ctx.lineTo(R + 7, -2); ctx.lineTo(R + 7, 4); ctx.lineTo(R - 14, 11); ctx.closePath();
            ctx.fillStyle = '#7d8a99'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.stroke(); ctx.restore();
          }
          ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.restore();
        });
      } else {
        tag(ctx, 'CUTTER WIDTH ' + st.s.width + ' mm', 450, 292, 'center');
        drawBelt(ctx, 346, 250, 900, cam.belt, 60);
      }
    }
  };

  /* single-shaft shredder and granulator share a knife rotor over a screen */
  function knifeScene(cfg) {
    return {
      omega: () => cfg.w,
      update(cam, dt, st) {
        const cx = cfg.cx, cy = cfg.cy, ramX = cfg.ram ? lerp(250, 360, (1 - Math.cos(cam.phase * 0.35)) / 2) : 0;
        const n = cam.spawnCount(dt, 1.5 + 7 * st.load);
        for (let i = 0; i < n; i++) {
          const mat = pickMat(st); if (!mat) break;
          const p = newPiece(mat, sizeIn(st, mat), cfg.spawnX + rnd(-30, 30), 30); p.mode = 'in'; p.liquid = p.D.state === 'liquid' && !st.temp; cam.push(p);
        }
        const hole = clamp(pxOf(st.topMm || 8) * 0.95, 3, 22), arr = cam.parts;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i]; if (p.state !== 'free') continue;
          p.t += dt;
          if (p.mode === 'in') {
            p.vy = Math.min(p.vy + 450 * dt, 280); p.y += p.vy * dt; p.ang += p.spin * dt * 0.3; p.x += p.vx * dt;
            if (p.y > cfg.floorY - p.r) { p.y = cfg.floorY - p.r; p.vy = 0; p.vx = 0; p.spin *= 0.3; p.ang *= 0.9; p.mode = 'table'; }
          } else if (p.mode === 'table') {
            p.vx = cfg.ram ? 0 : 45; if (cfg.ram && p.x < ramX + p.r + 14) p.x = ramX + p.r + 14; else p.x += p.vx * dt;
            if (cfg.ram && p.x > cx - cfg.R - p.r - 4 - 0) p.x += 40 * dt;
            if (p.x > cx - cfg.R - p.r * 0.5) {
              if (p.liquid) { p.state = 'drop'; p.x = cx + rnd(-30, 30); p.y = cy + cfg.screenR; p.vx = 0; p.vy = 80; continue; }
              p.mode = 'cut'; p.t = 0; const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.4), 2, 5));
              for (let k = 0; k < nf; k++) {
                const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.1, p.mm * 0.85), cx + rnd(-cfg.R, 0), cy + cfg.R * 0.7 + rnd(-6, 6));
                q.mode = 'basin'; q.t = 0; q.exitAt = rnd(0.2, 0.7); q.vx = rnd(-30, 30); q.vy = -rnd(20, 90); q.hits = 0; cam.push(q);
              }
              cam.crunch(p, clamp(p.r / 14, 0.3, 1.2)); if (p.D.hard > 0.4) cam.spark(p.x, p.y, 4); p.state = 'gone';
            }
          } else if (p.mode === 'basin') {
            p.vy += 360 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
            const dx = p.x - cx, ys = cy + Math.sqrt(Math.max(1, cfg.screenR * cfg.screenR - Math.min(dx * dx, cfg.screenR * cfg.screenR - 1)));
            if (p.y > ys - p.r) {
              p.y = ys - p.r; p.vy = -Math.abs(p.vy) * 0.4 - rnd(10, 60); p.vx += rnd(-30, 30);
              if (p.t > p.exitAt) {
                if (p.r <= hole && p.mm <= (st.topMm || 1e9) * 1.05) { p.state = 'drop'; p.y = ys + 4; p.vx = rnd(-10, 10); p.vy = 60; p.mode = 'out'; }
                else { p.t = 0; p.exitAt = rnd(0.15, 0.4); p.mm *= 0.75; p.r = pxOf(p.mm); p.cool = 1; cam.crunch(p, 0.35); }
              }
            }
          }
        }
      },
      draw(cam, ctx, st, pass) {
        const cx = cfg.cx, cy = cfg.cy;
        if (pass === 0) {
          frame(ctx, cx - cfg.R - 150, 16, cfg.R * 2 + 200, 316);
          ctx.beginPath(); ctx.moveTo(cfg.spawnX - 90, 20); ctx.lineTo(cfg.spawnX + 90, 20); ctx.lineTo(cfg.spawnX + 90, cfg.floorY); ctx.lineTo(cfg.spawnX - 90, cfg.floorY); ctx.closePath();
          ctx.fillStyle = '#18212b'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#242e3a'; ctx.fillRect(cfg.spawnX - 90, cfg.floorY, cx - cfg.R - cfg.spawnX + 90, 8);
          if (cfg.ram) {
            const ramX = lerp(250, 360, (1 - Math.cos(cam.phase * 0.35)) / 2);
            ctx.fillStyle = '#3c4755'; ctx.fillRect(ramX, 150, 14, cfg.floorY - 150); ctx.fillStyle = '#26303c'; ctx.fillRect(160, 195, ramX - 160, 12);
          }
          // screen basket
          ctx.beginPath(); ctx.arc(cx, cy, cfg.screenR + 8, 0.15, Math.PI - 0.15); ctx.lineWidth = 10; ctx.strokeStyle = '#2b3744'; ctx.stroke();
          ctx.setLineDash([2, 6]); ctx.lineWidth = 4; ctx.strokeStyle = '#6e7d8d'; ctx.beginPath(); ctx.arc(cx, cy, cfg.screenR + 8, 0.15, Math.PI - 0.15); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(cx, cy, cfg.screenR, 0, TAU); ctx.fillStyle = '#0d131a'; ctx.fill();
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(cam.phase);
          ctx.beginPath(); ctx.arc(0, 0, cfg.R - 8, 0, TAU); ctx.fillStyle = '#3d4856'; ctx.fill();
          for (let i = 0; i < cfg.knives; i++) { ctx.save(); ctx.rotate(i * TAU / cfg.knives); ctx.fillStyle = '#d3dce6'; ctx.fillRect(cfg.R - 16, -4, 14, 8); ctx.fillStyle = '#6a7685'; ctx.fillRect(cfg.R - 20, -7, 6, 14); ctx.restore(); }
          ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.restore();
          ctx.fillStyle = '#d3dce6'; ctx.fillRect(cx - cfg.R - 8, cfg.floorY - 12, 12, 12);   // bed knife
        } else {
          tag(ctx, 'SCREEN ' + st.s.screen + ' mm', cx, cy + cfg.screenR + 34, 'center');
          drawBelt(ctx, 346, 120, 900, cam.belt, 60);
        }
      }
    };
  }
  S.single = knifeScene({ cx: 520, cy: 190, R: 62, screenR: 84, knives: 4, w: 5, ram: true, spawnX: 250, floorY: 236 });
  S.granulator = knifeScene({ cx: 500, cy: 190, R: 54, screenR: 74, knives: 6, w: 14, ram: false, spawnX: 320, floorY: 236 });

  /* drum wood chipper */
  S.chipper = {
    omega: () => 8,
    update(cam, dt, st) {
      const cx = 430, cy = 200, R = 72;
      const n = cam.spawnCount(dt, 1.2 + 4 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 40, 214); p.mode = 'feed'; p.liquid = p.D.state === 'liquid' && !st.temp; p.vx = 60; p.r = Math.min(p.r, 20); p.state = 'free'; cam.push(p);
      }
      const arr = cam.parts, lenPx = clamp(pxOf(st.s.len) * 0.9, 3, 16);
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]; if (p.state !== 'free' || p.mode !== 'feed') continue;
        p.x += 62 * dt; p.y = 226 - Math.min(p.r, 18); p.ang = 0;
        if (p.x > cx - R + 4) {
          if (p.liquid) { p.state = 'drop'; p.vx = rnd(-20, 20); p.vy = 100; p.x = cx; p.y = 280; continue; }
          p.x -= 10 * dt * 6; // slice off a few chips, then the stock shortens
          const r = respOf(st, p.mat);
          const nf = Math.round(clamp(Math.pow(p.mm / Math.max(sizeOut(st, p.mat), 0.05), 0.35), 2, 5));
          for (let k = 0; k < nf; k++) {
            const q = newPiece(p.mat, clamp(sizeOut(st, p.mat), 0.1, p.mm * 0.9), cx + R * 0.6, cy - R * 0.2 + rnd(-10, 10));
            q.r = Math.max(2.5, Math.min(lenPx, q.r)); q.ax = 1.5; q.ay = 0.5; q.state = 'drop'; q.vx = rnd(130, 230); q.vy = -rnd(60, 140); q.spin = rnd(-6, 6); cam.push(q);
          }
          if (p.D.hard > 0.3 || r < 0.3) cam.spark(cx - R + 6, 226, 6, '#ffd27a');
          cam.crunch(p, clamp(p.r / 14, 0.3, 1)); p.state = 'gone';
        }
      }
    },
    draw(cam, ctx, st, pass) {
      const cx = 430, cy = 200, R = 72;
      if (pass === 0) {
        frame(ctx, 20, 150, 640, 190);
        ctx.fillStyle = '#18212b'; ctx.fillRect(20, 226, cx - R - 20 + 6, 12);
        ctx.fillStyle = '#2b3744'; for (let x = 30 + (cam.belt % 24); x < cx - R - 10; x += 24) ctx.fillRect(x, 238, 2, 4);
        [[cx - R - 46, 1], [cx - R - 46, -1]].forEach(function (a, i) {
          ctx.save(); ctx.translate(a[0], i ? 192 : 252 - 6); ctx.rotate(cam.phase * 0.5 * (i ? -1 : 1));
          ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fillStyle = '#46515f'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
          for (let k = 0; k < 8; k++) { ctx.fillStyle = '#6a7685'; ctx.fillRect(14, -2, 6, 4); ctx.rotate(TAU / 8); }
          ctx.restore();
        });
        ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, TAU); ctx.fillStyle = '#0d131a'; ctx.fill(); ctx.lineWidth = 14; ctx.strokeStyle = '#242e3a'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 20, cy - R - 22); ctx.lineTo(cx + 230, cy - R - 60); ctx.lineTo(cx + 230, cy - R - 10); ctx.lineTo(cx + 60, cy - R + 8); ctx.closePath();
        ctx.fillStyle = '#18212b'; ctx.fill(); ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(cam.phase);
        ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = '#3d4856'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(i * TAU / 3); ctx.fillStyle = '#d9e2ec'; ctx.beginPath(); ctx.moveTo(R - 4, -10); ctx.lineTo(R + 10, -3); ctx.lineTo(R + 10, 3); ctx.lineTo(R - 4, 10); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#10151c'; ctx.fillRect(R * 0.45, -5, R * 0.35, 10); ctx.restore(); }
        ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); ctx.restore();
      } else {
        tag(ctx, 'CHIP LENGTH ' + st.s.len + ' mm', cx, 330, 'center');
        drawBelt(ctx, 346, 380, 900, cam.belt, 60);
      }
    }
  };

  /* ======================= BALL MILL ======================= */
  S.ball = {
    omega: () => 1.3,
    init(cam) {
      const cx = 450, cy = 195, R = 122;
      const balls = [];
      for (let i = 0; i < 24; i++) balls.push({ th: Math.PI / 2 + Math.random() * 2.2, rho: R * (0.5 + Math.random() * 0.38), rad: 8 + Math.random() * 3, rel: Math.PI + 0.5 + Math.random() * 0.45, mode: 'c', x: 0, y: 0, vx: 0, vy: 0 });
      const dots = [];
      while (dots.length < 170) {
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R * 0.9, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (y > cy + 0.42 * R + 0.26 * (x - cx) - 8 && r < R * 0.9) dots.push({ x, y, ph: Math.random() * TAU, k: Math.random(), pop: 0 });
      }
      cam.bm = { balls, dots, cx, cy, R };
    },
    update(cam, dt, st) {
      const b = cam.bm, om = 1.3;
      for (let i = 0; i < b.balls.length; i++) {
        const q = b.balls[i];
        if (q.mode === 'c') {
          q.th += om * dt; q.x = b.cx + Math.cos(q.th) * q.rho; q.y = b.cy + Math.sin(q.th) * q.rho;
          if (q.th > q.rel) { q.mode = 'f'; q.vx = -Math.sin(q.th) * q.rho * om * 1.25; q.vy = Math.cos(q.th) * q.rho * om * 1.25; }
        } else {
          q.vy += 230 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
          if (q.y > b.cy + 0.45 * b.R + 0.26 * (q.x - b.cx) && q.vy > 0) {
            q.mode = 'c'; q.th = Math.PI / 2 + 0.25 + Math.random() * 0.9; q.rho = b.R * (0.5 + Math.random() * 0.38);
            for (let k = 0; k < b.dots.length; k++) { const d = b.dots[k]; if (Math.hypot(d.x - q.x, d.y - q.y) < 34) d.pop = 1; }
            if (st.running) cam.crunch({ mat: 'steel', r: 14 }, 0.55);
          }
        }
      }
      for (let k = 0; k < b.dots.length; k++) b.dots[k].pop = Math.max(0, b.dots[k].pop - dt * 3);
      const n = cam.spawnCount(dt, 1.5 + 5 * st.load);
      for (let i = 0; i < n; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, sizeIn(st, mat), 230 + rnd(-10, 10), 40); p.mode = 'spout'; p.vy = 40; cam.push(p);
      }
      for (let i = 0; i < cam.parts.length; i++) {
        const p = cam.parts[i]; if (p.state !== 'free' || p.mode !== 'spout') continue;
        p.vy = Math.min(p.vy + 400 * dt, 240); p.y += p.vy * dt; p.x += (300 - p.x) * dt * 0.9;
        if (p.y > b.cy - 40) p.state = 'gone';
      }
      const m = cam.spawnCount(dt, (1 + 8 * st.load) * 0 + 6 * st.load);
      for (let i = 0; i < m; i++) {
        const mat = pickMat(st); if (!mat) break;
        const p = newPiece(mat, clamp(sizeOut(st, mat), 0.03, 2), b.cx + b.R + 46, b.cy + 40);
        p.state = 'drop'; p.vx = rnd(20, 60); p.vy = rnd(0, 40); cam.push(p);
      }
    },
    draw(cam, ctx, st, pass) {
      const b = cam.bm; if (!b) return;
      if (pass === 0) {
        ctx.fillStyle = '#18212b'; ctx.beginPath(); ctx.moveTo(180, 20); ctx.lineTo(290, 20); ctx.lineTo(b.cx - b.R - 40, b.cy - 36); ctx.lineTo(b.cx - b.R - 40, b.cy + 6); ctx.lineTo(240, 90); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#33414f'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#1f2833'; ctx.fillRect(b.cx - b.R - 60, b.cy - 20, 40, 200); ctx.fillRect(b.cx + b.R + 20, b.cy - 20, 40, 200);
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.R + 8, 0, TAU); ctx.fillStyle = '#0d131a'; ctx.fill();
        ctx.lineWidth = 14; ctx.strokeStyle = '#3a4656'; ctx.stroke();
        for (let i = 0; i < 10; i++) { const a = cam.phase + i * TAU / 10; ctx.strokeStyle = '#5b6b7d'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(b.cx + Math.cos(a) * (b.R + 1), b.cy + Math.sin(a) * (b.R + 1)); ctx.lineTo(b.cx + Math.cos(a) * (b.R - 12), b.cy + Math.sin(a) * (b.R - 12)); ctx.stroke(); }
        // charge: fines of the actual feed mix
        const c = st.comp && st.comp.length ? st.comp : [['granite', 1]];
        for (let k = 0; k < b.dots.length; k++) {
          const d = b.dots[k], m = CS.MATERIALS[c[k % c.length][0]];
          const sz = clamp(pxOf(Math.sqrt(Math.max(st.F80, 0.1) * Math.max(st.P80, 0.05))) * 0.55, 1.2, 5) * (0.7 + d.k * 0.6) * (1 + d.pop * 0.7);
          ctx.fillStyle = m.color; ctx.globalAlpha = 0.85;
          ctx.fillRect(d.x + Math.sin(cam.t * 4 + d.ph) * 1.6 - sz / 2, d.y + Math.cos(cam.t * 3 + d.ph) * 1.6 - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < b.balls.length; i++) {
          const q = b.balls[i];
          ctx.beginPath(); ctx.arc(q.x, q.y, q.rad, 0, TAU); ctx.fillStyle = '#9aa7b6'; ctx.fill(); ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(q.x - q.rad * 0.3, q.y - q.rad * 0.3, q.rad * 0.28, 0, TAU); ctx.fill();
        }
      } else {
        tag(ctx, 'TARGET P80 ' + st.s.target + ' mm', b.cx, b.cy + b.R + 36, 'center');
        drawBelt(ctx, 346, 120, 900, cam.belt, 60);
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
