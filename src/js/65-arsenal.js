/* =========================================================================
   ARSENAL — field manual with one animated preview per weapon.
   Each thumbnail runs the same physics constants as the game, scaled down:
   real gravity, real apex split, real terrain roll.
   ========================================================================= */

const ARS = { open: false, raf: 0, items: [], last: 0 };

const ARSENAL_COPY = {
  he: { role: 'General purpose', line: 'Balanced high-explosive — reshapes a ridge, cheap enough to fire every turn.' },
  cluster: { role: 'Area denial', line: 'Splits into three bomblets at the apex. Punishes a crater-camper.' },
  siege: { role: 'Siege', line: 'Slow and enormous. Carves a bowl out of the hill and anything on it.' },
  rail: { role: 'Line of sight', line: 'No gravity, no wind. The bore either crosses the target or it is wasted.' },
  roller: { role: 'Finisher', line: 'Lands short, then rolls along the terrain into the target.' },
  pen: { role: 'Bunker buster', line: 'Bores through the ridge and breaks out the far side. Thick rock stops it.' }
};

const G_THUMB = 190;      // thumbnail gravity
const THUMB_GROUND = 66;
const THUMB_X0 = 20;
const THUMB_TX = 156;

function buildArsenal() {
  const host = document.getElementById('arsenalList');
  if (!host || host.dataset.built) return;
  host.dataset.built = '1';

  ARS.items = WEAPONS.map((w) => {
    const row = document.createElement('div');
    row.className = 'ars';

    const cv = document.createElement('canvas');
    cv.className = 'arsCv';
    cv.width = 360;                 // 180 CSS px at 2x
    cv.height = 168;
    cv.setAttribute('aria-label', w.name + ' preview');

    const copy = ARSENAL_COPY[w.id] || { role: '', line: w.desc };
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="arsHead">' +
        '<span class="arsName" style="color:' + w.color + '">' + w.name + '</span>' +
        '<span class="arsAmmo">' + (w.ammo === Infinity ? 'unlimited' : w.ammo + ' per round') + ' · key ' + w.keys + '</span>' +
      '</div>' +
      '<p class="arsDesc">' + copy.line + '</p>' +
      '<div class="arsStats">' +
        '<span>Role <b>' + copy.role + '</b></span>' +
        '<span>Blast <b>' + w.r + '</b></span>' +
        '<span>Damage <b>' + w.dmg + '</b></span>' +
        '<span>Velocity <b>' + w.spd.toFixed(2) + '&times;</b></span>' +
      '</div>';

    row.appendChild(cv);
    row.appendChild(body);
    host.appendChild(row);

    const it = {
      w, cv, ctx: cv.getContext('2d'),
      cw: 180, ch: 84,
      t: 0, cycle: 2.6, launchAngle: 45,
      proj: null, bomblets: [], trail: [], parts: [], rings: [], flash: 0, tunnel: []
    };
    resetThumb(it);
    return it;
  });

  ARS.items.forEach((it) => drawThumb(it));
}

function resetThumb(it) {
  it.t = 0;
  it.trail.length = 0;
  it.parts.length = 0;
  it.rings.length = 0;
  it.bomblets.length = 0;
  it.flash = 0;

  const w = it.w;

  if (w.flat) {
    const y0 = THUMB_GROUND - 30, y1 = THUMB_GROUND - 6;
    const d = Math.hypot(THUMB_TX - THUMB_X0, y1 - y0);
    it.launchAngle = Math.atan2(-(y1 - y0), THUMB_TX - THUMB_X0);
    it.proj = {
      x: THUMB_X0, y: y0,
      vx: ((THUMB_TX - THUMB_X0) / d) * 240,
      vy: ((y1 - y0) / d) * 240,
      flat: true
    };
    it.cycle = d / 240 + 1.35;
    return;
  }

  const theta = w.id === 'siege' ? 62 : w.id === 'cluster' ? 52 : w.id === 'roller' ? 40 : 46;
  const range = w.id === 'roller' ? 92 : (THUMB_TX - THUMB_X0);
  const rad = (theta * Math.PI) / 180;
  const v = Math.sqrt(Math.max(1, (range * G_THUMB) / Math.sin(2 * rad)));
  it.launchAngle = rad;
  it.proj = {
    x: THUMB_X0, y: THUMB_GROUND - 2,
    vx: Math.cos(rad) * v,
    vy: -Math.sin(rad) * v,
    flat: false
  };
  const flight = (2 * v * Math.sin(rad)) / G_THUMB;
  it.cycle = flight + (w.id === 'roller' ? 0.6 : 0) + 1.3;
}

function thumbBurst(it, x, y, scale, big) {
  it.rings.push({ x, y, r: 3, r1: 26 * scale, life: 0.5, max: 0.5 });
  it.flash = Math.max(it.flash, big ? 1 : 0.6);
  const n = big ? 16 : 8;
  for (let i = 0; i < n; i++) {
    const a = rr(0, 6.283);
    const sp = rr(40, 150) * scale;
    it.parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
      life: rr(0.25, 0.7), max: 0.7, size: rr(1, 2.4),
      color: rpick(it.w.id === 'rail' ? ['#dfe9ff', '#8fb8ff', '#fff'] : ['#fff3c4', '#ffc46b', '#ff7a4c'])
    });
  }
}

function stepThumb(it, dt) {
  it.t += dt;
  const g = G_THUMB, gy = THUMB_GROUND;

  const p = it.proj;
  if (p && !p.dead) {
    if (!p.flat && !p.rolling) p.vy += g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    it.trail.push({ x: p.x, y: p.y });
    if (it.trail.length > 70) it.trail.shift();

    // apex split
    if (it.w.split && p.vy >= 0 && !p.didSplit) {
      p.didSplit = true;
      for (let k = 0; k < 3; k++) {
        it.bomblets.push({ x: p.x, y: p.y, vx: p.vx + (k - 1) * 42, vy: rr(-34, 8) });
      }
      thumbBurst(it, p.x, p.y, 0.5, false);
      p.dead = true;
    }

    // roller: touch down then run along the ground
    // penetrator: touch down, then bore straight through the ridge
    if (it.w.burrow && !p.rolling && p.vy > 0 && p.y >= gy - 2) {
      p.rolling = true;
      p.y = gy + 6;
      p.vy = 0;
      p.vx = 76;
      it.tunnel = [{ x: p.x, y: p.y }];
    }

    if (it.w.roll && !p.rolling && p.vy > 0 && p.y >= gy - 2) {
      p.rolling = true;
      p.y = gy - 2;
      p.vy = 0;
      p.vx = 84;
      thumbBurst(it, p.x, gy - 2, 0.45, false);
    }

    if (it.w.burrow && p.rolling) {
      if (it.tunnel) it.tunnel.push({ x: p.x, y: p.y + 6 });
      if (p.x >= THUMB_TX - 8) {
        thumbBurst(it, p.x, gy - 3, 1.3, true);
        p.dead = true;
      }
    }

    if (p.y >= gy - 2 && !it.w.burrow && (!it.w.roll || p.rolling)) {
      thumbBurst(it, p.x, gy - 3, it.w.id === 'siege' ? 1.5 : 1, true);
      p.dead = true;
    }
    if (p.x > it.cw - 2) p.dead = true;
    if (p.dead) it.proj = null;
  }

  for (const b of it.bomblets) {
    if (b.dead) continue;
    b.vy += g * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y >= gy - 2) { thumbBurst(it, b.x, gy - 3, 0.6, true); b.dead = true; }
  }
  if (it.bomblets.length) it.bomblets = it.bomblets.filter((b) => !b.dead);

  for (let i = it.parts.length - 1; i >= 0; i--) {
    const q = it.parts[i];
    q.life -= dt;
    if (q.life <= 0) { it.parts.splice(i, 1); continue; }
    q.vy += 150 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
  }
  for (let i = it.rings.length - 1; i >= 0; i--) {
    const r = it.rings[i];
    r.life -= dt;
    if (r.life <= 0) { it.rings.splice(i, 1); continue; }
    r.r = lerp(3, r.r1, easeOut(1 - r.life / r.max));
  }
  it.flash = Math.max(0, it.flash - dt * 3.2);

  if (it.t > it.cycle) resetThumb(it);
}

function drawThumb(it) {
  const c = it.ctx, cw = it.cw, ch = it.ch, gy = THUMB_GROUND;
  if (!c) return;
  c.setTransform(2, 0, 0, 2, 0, 0);
  c.clearRect(0, 0, cw, ch);

  const sky = c.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, '#0c1523');
  sky.addColorStop(1, '#060a11');
  c.fillStyle = sky;
  c.fillRect(0, 0, cw, ch);

  // ground
  c.fillStyle = '#18212e';
  c.fillRect(0, gy, cw, ch - gy);
  c.strokeStyle = 'rgba(255,170,120,.55)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, gy + 0.5);
  for (let x = 0; x <= cw; x += 6) c.lineTo(x, gy + 0.5 - Math.sin(x * 0.09) * 1.2);
  c.stroke();

  // a ridge for the penetrator to bore through
  if (it.w.burrow) {
    c.fillStyle = '#16202c';
    c.strokeStyle = 'rgba(255,170,120,.32)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(74, gy + 1);
    c.quadraticCurveTo(108, gy - 30, 146, gy + 1);
    c.closePath();
    c.fill();
    c.stroke();
  }

  // the bore itself
  if (it.tunnel && it.tunnel.length > 1) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(it.tunnel[0].x, it.tunnel[0].y);
    for (let i = 1; i < it.tunnel.length; i++) c.lineTo(it.tunnel[i].x, it.tunnel[i].y);
    c.strokeStyle = 'rgba(150,180,220,.22)';
    c.lineWidth = 9;
    c.stroke();
    c.strokeStyle = '#05070b';
    c.lineWidth = 6;
    c.stroke();
  }

  // launcher
  c.save();
  c.translate(THUMB_X0, gy);
  c.fillStyle = '#39424f';
  c.fillRect(-9, -8, 18, 8);
  c.fillStyle = 'rgba(255,255,255,.18)';
  c.fillRect(-9, -8, 18, 2);
  c.translate(0, -8);
  c.rotate(-it.launchAngle);
  c.fillStyle = '#2b333e';
  c.fillRect(0, -2, 16, 4);
  c.restore();

  // target
  c.save();
  c.translate(THUMB_TX + 8, gy);
  c.fillStyle = '#3a4452';
  c.strokeStyle = 'rgba(255,255,255,.22)';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(-9, 0); c.lineTo(-7, -7); c.lineTo(5, -7); c.lineTo(9, 0);
  c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#ff5d7e';
  c.fillRect(-5, -6, 7, 2.4);
  c.fillRect(-6, -1.6, 13, 1.6);
  c.restore();

  // trail
  if (it.trail.length > 1) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 1; i < it.trail.length; i++) {
      const a = i / it.trail.length;
      c.strokeStyle = it.w.color;
      c.globalAlpha = a * 0.75;
      c.lineWidth = 0.6 + a * 2.4;
      c.beginPath();
      c.moveTo(it.trail[i - 1].x, it.trail[i - 1].y);
      c.lineTo(it.trail[i].x, it.trail[i].y);
      c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  // rings
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const r of it.rings) {
    c.globalAlpha = Math.max(0, r.life / r.max) * 0.9;
    c.strokeStyle = it.w.color;
    c.lineWidth = 1.4;
    c.beginPath(); c.arc(r.x, r.y, r.r, 0, 6.2832); c.stroke();
  }
  c.restore();
  c.globalAlpha = 1;

  // particles
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const q of it.parts) {
    c.globalAlpha = Math.max(0, q.life / q.max);
    c.fillStyle = q.color;
    c.beginPath(); c.arc(q.x, q.y, q.size, 0, 6.2832); c.fill();
  }
  c.restore();
  c.globalAlpha = 1;

  // bomblets
  for (const b of it.bomblets) {
    c.fillStyle = it.w.color;
    c.beginPath(); c.arc(b.x, b.y, 1.8, 0, 6.2832); c.fill();
  }

  // the round itself
  const p = it.proj;
  if (p) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, it.w.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, 11, 0, 6.2832); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(p.x, p.y, 1.7, 0, 6.2832); c.fill();
    c.restore();
  }

  // impact flash
  if (it.flash > 0.01) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(THUMB_TX, gy - 6, 0, THUMB_TX, gy - 6, 60 * it.flash);
    g.addColorStop(0, 'rgba(255,240,210,' + (0.5 * it.flash).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, cw, ch);
    c.restore();
  }
}

function arsenalOpen() {
  buildArsenal();
  const ov = document.getElementById('arsenalOv');
  if (!ov) return;
  ov.classList.add('show');
  ARS.open = true;
  ARS.last = performance.now();
  cancelAnimationFrame(ARS.raf);
  ARS.raf = requestAnimationFrame(arsenalFrame);
}

function arsenalClose() {
  ARS.open = false;
  cancelAnimationFrame(ARS.raf);
  const ov = document.getElementById('arsenalOv');
  if (ov) ov.classList.remove('show');
}

function arsenalFrame(ts) {
  if (!ARS.open) return;
  let dt = (ts - ARS.last) / 1000;
  if (!(dt > 0) || dt > 0.05) dt = 0.016;
  ARS.last = ts;
  for (const it of ARS.items) {
    stepThumb(it, dt);
    drawThumb(it);
  }
  ARS.raf = requestAnimationFrame(arsenalFrame);
}
