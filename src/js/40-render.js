/* =========================================================================
   RENDER — cinematic 2D: parallax ridges, destructible heightmap, unit art
   ========================================================================= */
let CTX = null;
let skyCache = null, skyKey = '';
let smokeSprite = null;

function makeSmokeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,0.80)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.34)');
  rg.addColorStop(0.7, 'rgba(255,255,255,0.10)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  smokeSprite = c;
}

function paletteKey() {
  return G.palette.id + '|' + VIEW.cw + 'x' + VIEW.ch + '|' + VIEW.ox.toFixed(1);
}

function drawSky(ctx) {
  const pal = G.palette, cw = VIEW.cw, ch = VIEW.ch;
  if (skyKey !== paletteKey()) {
    skyKey = paletteKey();
    const g = ctx.createLinearGradient(0, -ch * 0.1, 0, ch);
    const stops = pal.sky;
    for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
    skyCache = g;
  }
  ctx.fillStyle = skyCache || pal.sky[0];
  ctx.fillRect(0, 0, cw, ch);

  // horizon bloom
  const hx = pal.sun.x * cw, hy = pal.sun.y * ch;
  const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(cw, ch) * 0.55);
  rg.addColorStop(0, pal.sun.glow);
  rg.addColorStop(0.45, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, cw, ch);

  // stars
  if (pal.stars > 0.05) {
    const t = G.t;
    for (const s of G.stars) {
      const a = (0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p))) * pal.stars;
      ctx.fillStyle = 'rgba(230,240,255,' + (a * 0.8).toFixed(3) + ')';
      ctx.fillRect(s.x * cw, s.y * ch, s.r, s.r);
    }
  }
  // sun / moon
  const sr = pal.sun.r * (cw / 1400);
  const sglow = ctx.createRadialGradient(hx, hy, sr * 0.2, hx, hy, sr * 3.6);
  sglow.addColorStop(0, pal.sun.core);
  sglow.addColorStop(0.22, pal.sun.core);
  sglow.addColorStop(0.25, 'rgba(255,255,255,0.10)');
  sglow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = sglow;
  ctx.beginPath(); ctx.arc(hx, hy, sr * 3.6, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.sun.core;
  ctx.beginPath(); ctx.arc(hx, hy, sr * 0.55, 0, 6.2832); ctx.fill();
}

function drawClouds(ctx) {
  const pal = G.palette;
  for (const c of G.clouds) {
    const x = ((c.x + G.t * c.v * 4 + G.wind * G.t * 0.35) % (W + 900)) - 300;
    const g = ctx.createRadialGradient(x, c.y, 0, x, c.y, c.w * 0.6);
    g.addColorStop(0, pal.cloud);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, c.y);
    ctx.scale(1, c.h / c.w);
    ctx.beginPath(); ctx.arc(0, 0, c.w * 0.55, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
}

function drawWind(ctx) {
  const mag = Math.abs(G.wind);
  const dir = G.wind >= 0 ? 1 : -1;
  const span = W + 320;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const seed = h1(i * 4.7 + 2);
    const y = 280 + h1(i * 9.3 + 5) * 470;
    const len = 34 + seed * 120 + mag * 1.8;
    const speed = 10 + mag * 5.5;
    let x = h1(i * 3.1 + 9) * span - 160 + dir * G.t * speed * (0.5 + seed);
    x = ((x % span) + span) % span - 160;
    const a = 0.045 + 0.07 * (mag / WIND_MAX);
    ctx.strokeStyle = 'rgba(214,232,255,' + a.toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dir * len * 0.5, y - 2.5, x + dir * len, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMountains(ctx) {
  const pal = G.palette;
  for (let L = 0; L < G.mtn.length; L++) {
    const arr = G.mtn[L];
    const px0 = G.cam.x * (0.75 - L * 0.24);
    ctx.beginPath();
    ctx.moveTo(-720 + px0, H + 10);
    for (let i = 0; i < arr.length; i++) {
      const x = -700 + i * 26 + px0;
      ctx.lineTo(x, arr[i]);
    }
    ctx.lineTo(W + 720 + px0, H + 10);
    ctx.closePath();
    ctx.fillStyle = pal.mtn[L];
    ctx.fill();
    // moonlit ridge edge — separates the layers
    ctx.strokeStyle = L === 2 ? 'rgba(255,255,255,0.13)' : L === 1 ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.045)';
    ctx.lineWidth = L === 2 ? 2 : 1.4;
    ctx.stroke();
  }
  // fog band at the base of the ridges
  const g = ctx.createLinearGradient(0, H - 420, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, pal.fog);
  ctx.fillStyle = g;
  ctx.fillRect(-700, H - 420, W + 1400, 430);
}

function drawTerrain(ctx) {
  const t = G.terrain, pal = G.palette;
  if (!t) return;
  // body
  ctx.beginPath();
  ctx.moveTo(-4, t[0]);
  for (let x = 2; x <= W; x += 2) ctx.lineTo(x, t[x]);
  ctx.lineTo(W + 4, t[W]);
  ctx.lineTo(W + 4, H + 40);
  ctx.lineTo(-4, H + 40);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 320, 0, H + 20);
  grad.addColorStop(0, pal.terr[0]);
  grad.addColorStop(0.42, pal.terr[1]);
  grad.addColorStop(1, pal.terr[2]);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // strata + speckle, deterministically keyed off the seed
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = pal.rim;
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 7; k++) {
    ctx.beginPath();
    const base = 470 + k * 58;
    for (let x = 0; x <= W; x += 40) {
      const y = base + Math.sin((x + k * 90) * 0.004 + k) * 15;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 420; i++) {
    const x = h1(i * 3.7 + 1) * W;
    const y = 360 + h1(i * 9.1 + 4) * (H - 340);
    ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.6)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // scorch
  ctx.globalAlpha = 1;
  for (let x = 0; x <= W; x += 2) {
    const s = G.scorch[x];
    if (s > 0.02) {
      const a = Math.min(0.75, s * 0.55);
      ctx.fillStyle = 'rgba(14,10,10,' + a.toFixed(3) + ')';
      ctx.fillRect(x, t[x] - 2, 2.2, 130);
    }
  }
  ctx.restore();

  // surface cover: sparse tufts keyed to the seed
  ctx.save();
  ctx.lineWidth = 1.4;
  for (let x = 6; x < W; x += 11) {
    const n = h1(x * 0.37 + 3.3);
    if (n > 0.62) continue;
    const y = t[x];
    const hgt = 3 + n * 9;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + n * 0.1).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (n - 0.3) * 8, y - hgt * 0.6, x + (n - 0.5) * 12, y - hgt);
    ctx.stroke();
  }
  ctx.restore();

  // rim light along the surface
  ctx.beginPath();
  ctx.moveTo(-4, t[0]);
  for (let x = 2; x <= W; x += 2) ctx.lineTo(x, t[x]);
  ctx.strokeStyle = pal.rim;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawTank(ctx, p) {
  const hurt = p.flash;
  const y = p.y;
  const x = p.x;
  ctx.save();
  ctx.translate(x, y);
  if (p.shake > 0.02) ctx.translate(rr(-p.shake, p.shake) * 2, 0);
  ctx.scale(TANK_S * facingOf(p), TANK_S);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.beginPath(); ctx.ellipse(0, 1, 42, 7, 0, 0, 6.2832); ctx.fill();

  const body = '#1b2028';
  const bodyLit = '#2b333e';
  const accent = p.color;

  // treads
  ctx.fillStyle = '#11151b';
  roundRect(ctx, -36, -15, 72, 14, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  for (let i = -30; i <= 30; i += 10) ctx.fillRect(i, -14, 5, 3);

  // hull
  ctx.beginPath();
  ctx.moveTo(-34, -16);
  ctx.lineTo(26, -16);
  ctx.lineTo(38, -26);
  ctx.lineTo(30, -36);
  ctx.lineTo(-30, -36);
  ctx.lineTo(-38, -27);
  ctx.closePath();
  const hg = ctx.createLinearGradient(0, -38, 0, -14);
  hg.addColorStop(0, bodyLit);
  hg.addColorStop(1, body);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // team stripe
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-26, -24, 22, 3);
  ctx.globalAlpha = 1;

  // turret
  const bx = -2, by = -36;
  const ang = -(p.barrel) * DEG;
  // barrel
  ctx.save();
  ctx.translate(6, -34);
  ctx.rotate(ang);
  const rec = easeOut(clamp(p.recoil, 0, 1)) * 13;
  ctx.translate(-rec, 0);
  const bg = ctx.createLinearGradient(0, -4, 0, 4);
  bg.addColorStop(0, '#3a4450'); bg.addColorStop(1, '#171c23');
  ctx.fillStyle = bg;
  roundRect(ctx, -4, -4.4, 54, 8.8, 3); ctx.fill();
  ctx.fillStyle = '#2b333e';
  roundRect(ctx, 40, -6, 12, 12, 2); ctx.fill();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(46, -6, 3, 12);
  ctx.globalAlpha = 1;
  ctx.restore();

  // turret body
  ctx.beginPath();
  ctx.moveTo(-16, -34);
  ctx.lineTo(14, -34);
  ctx.lineTo(18, -48);
  ctx.lineTo(6, -56);
  ctx.lineTo(-12, -56);
  ctx.lineTo(-18, -46);
  ctx.closePath();
  const tg = ctx.createLinearGradient(0, -56, 0, -32);
  tg.addColorStop(0, '#333c48');
  tg.addColorStop(1, '#161b22');
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // optics
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.arc(-6, -46, 2.6, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(-6, -46, 7, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 1;

  // antenna + status lamp
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-14, -54); ctx.lineTo(-20, -76); ctx.stroke();
  const blink = 0.4 + 0.6 * Math.abs(Math.sin(G.t * 3 + p.i));
  ctx.fillStyle = p.alive ? accent : '#662222';
  ctx.globalAlpha = blink;
  ctx.beginPath(); ctx.arc(-20, -78, 2.2, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 1;

  // damage flash
  if (hurt > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.85, hurt);
    ctx.fillStyle = '#ff9a6a';
    roundRect(ctx, -38, -58, 76, 46, 8); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // floating hp pip
  if (p.alive && p.hp < p.maxHp) {
    const w = 54, hpw = (p.hp / p.maxHp) * w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    roundRect(ctx, p.x - w / 2, p.y - 92, w, 5, 3); ctx.fill();
    ctx.fillStyle = p.color;
    roundRect(ctx, p.x - w / 2, p.y - 92, Math.max(1, hpw), 5, 3); ctx.fill();
  }
}

function drawGhost(ctx) {
  if (!settings.trace) return;
  for (let i = 0; i < 2; i++) {
    const g = G.ghosts[i];
    if (!g || g.length < 4) continue;
    ctx.save();
    ctx.strokeStyle = G.players[i].color;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 9]);
    ctx.beginPath();
    ctx.moveTo(g[0].x, g[0].y);
    for (let k = 1; k < g.length; k++) ctx.lineTo(g[k].x, g[k].y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawDots(ctx) {
  for (const d of G.dots) {
    const c = G.players[d.team].color;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(d.x - 7, d.y - 7); ctx.lineTo(d.x + 7, d.y + 7);
    ctx.moveTo(d.x + 7, d.y - 7); ctx.lineTo(d.x - 7, d.y + 7);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAim(ctx) {
  if (G.mode !== 'aim') return;
  const p = activePlayer();
  if (!p) return;
  const dir = facingOf(p);
  const a = p.angle * DEG;
  const mz = muzzlePoint(p, p.angle);
  const len = 78 + p.power * 2.3;
  const ex = mz.x + Math.cos(a) * len * dir;
  const ey = mz.y - Math.sin(a) * len;
  ctx.save();

  // launch vector
  const g = ctx.createLinearGradient(mz.x, mz.y, ex, ey);
  g.addColorStop(0, p.color);
  g.addColorStop(1, 'rgba(255,255,255,.05)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.6;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -G.t * 36;
  ctx.beginPath();
  ctx.moveTo(mz.x, mz.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);

  // arrow head along the vector
  const vdx = ex - mz.x, vdy = ey - mz.y;
  const vlen = Math.hypot(vdx, vdy) || 1;
  ctx.translate(ex, ey);
  ctx.rotate(Math.atan2(vdy / vlen, vdx / vlen));
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, 6.5); ctx.lineTo(-6, -6.5); ctx.closePath(); ctx.fill();
  ctx.rotate(-Math.atan2(vdy / vlen, vdx / vlen));
  ctx.translate(-ex, -ey);

  // elevation arc at the turret
  const pvx = p.x + PIVOT_DX * dir, pvy = p.y - PIVOT_DY;
  ctx.save();
  ctx.translate(pvx, pvy);
  ctx.scale(dir, 1);
  ctx.strokeStyle = 'rgba(255,255,255,.26)';
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(0, 0, 46, -a, 0); ctx.stroke();
  ctx.strokeStyle = p.color;
  ctx.globalAlpha = 0.45;
  ctx.beginPath(); ctx.arc(0, 0, 62, -a - 0.2, -a + 0.2); ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawProjectiles(ctx) {
  for (const p of G.projs) {
    // trail
    if (p.trail.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i < p.trail.length; i++) {
        const t = i / p.trail.length;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.05 + t * 0.36;
        ctx.lineWidth = 0.6 + t * 3.4;
        ctx.beginPath();
        ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (p.flat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      const bx = p.x - p.vx * 0.05, by = p.y - p.vy * 0.05;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.restore();
    }
    // head
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, p.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.1, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
}

function drawParticles(ctx) {
  // smoke / dirt first (normal blend)
  for (const p of particles) {
    if (p.kind === 'spark' || p.kind === 'ember') continue;
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'smoke') {
      if (smokeSprite) {
        ctx.globalAlpha = a * a * 0.5;
        ctx.drawImage(smokeSprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      }
    } else {
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  // additive sparks
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    if (p.kind !== 'spark' && p.kind !== 'ember') continue;
    const a = clamp(p.life / p.max, 0, 1);
    const sp = Math.hypot(p.vx, p.vy);
    ctx.globalAlpha = a * (p.kind === 'ember' ? 0.9 : 0.75);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(0.8, p.size * 0.7);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - (p.vx / (sp || 1)) * Math.min(16, sp * 0.03), p.y - (p.vy / (sp || 1)) * Math.min(16, sp * 0.03));
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRings(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of G.rings) {
    const a = clamp(r.life / r.max, 0, 1);
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * a + 0.6;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.2832); ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawTexts(ctx) {
  ctx.save();
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    const a = clamp(t.life / t.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = '700 ' + t.size + 'px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(t.txt, t.x + 1.5, t.y + 1.5);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawStorm(ctx) {
  if (!G.meteor) return;
  const m = G.meteor;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * Math.sin(G.t * 12);
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.moveTo(m.x, m.y - 700); ctx.lineTo(m.x, surfaceAt(m.x)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(m.x, surfaceAt(m.x), 26, 0, 6.2832); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr0 = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr0, y);
  ctx.lineTo(x + w - rr0, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr0);
  ctx.lineTo(x + w, y + h - rr0);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr0, y + h);
  ctx.lineTo(x + rr0, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr0);
  ctx.lineTo(x, y + rr0);
  ctx.quadraticCurveTo(x, y, x + rr0, y);
  ctx.closePath();
}

function render() {
  const ctx = CTX;
  if (!ctx) return;
  const c = G.cam;
  const shx = c.shake ? (rnd() - 0.5) * c.shake : 0;
  const shy = c.shake ? (rnd() - 0.5) * c.shake * 0.7 : 0;

  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.clearRect(0, 0, VIEW.cw, VIEW.ch);
  drawSky(ctx);

  const s = VIEW.scale * c.z;
  ctx.save();
  ctx.translate(VIEW.A.x + shx, VIEW.A.y + shy);
  ctx.scale(s, s);
  ctx.translate(-W / 2 + c.x, -H + c.y);

  drawMountains(ctx);
  drawClouds(ctx);
  drawWind(ctx);
  drawTerrain(ctx);
  drawDots(ctx);
  drawGhost(ctx);
  for (const p of G.players) if (p) drawTank(ctx, p);
  drawStorm(ctx);
  drawAim(ctx);
  drawProjectiles(ctx);
  drawParticles(ctx);
  drawRings(ctx);
  drawTexts(ctx);
  ctx.restore();

  if (c.flash > 0.01) {
    ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
    const g = ctx.createRadialGradient(VIEW.cw / 2, VIEW.ch * 0.55, 0, VIEW.cw / 2, VIEW.ch * 0.55, VIEW.cw * 0.8);
    g.addColorStop(0, 'rgba(255,236,200,' + (c.flash * 0.5).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.cw, VIEW.ch);
  }
}