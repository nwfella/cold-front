/* =========================================================================
   DEATH FX — a procedurally generated detonation for every kill.
   Style, palette, ring count, secondary bursts, shard launch, crater size and
   charge time are all drawn fresh per kill, so no two endings look alike.
   ========================================================================= */

const DEATH_STYLES = [
  {
    id: 'THERMITE', scale: 1.0, pitch: 1.0, bolt: false,
    fire: ['#fffbe8', '#ffd27a', '#ff8a3c', '#ff3b1f'],
    core: 'rgba(255,246,216,0.95)', ring: 'rgba(255,170,90,0.9)',
    spark: '#ffd27a', smoke: 'rgba(84,70,60,1)'
  },
  {
    id: 'PLASMA', scale: 1.12, pitch: 1.35, bolt: false,
    fire: ['#ffffff', '#d6fbff', '#4fd6ff', '#2f7bff'],
    core: 'rgba(234,255,255,0.95)', ring: 'rgba(120,220,255,0.9)',
    spark: '#9fe8ff', smoke: 'rgba(56,70,86,1)'
  },
  {
    id: 'VOID', scale: 1.25, pitch: 0.78, bolt: false,
    fire: ['#ffffff', '#ffd6ff', '#c86bff', '#7c1fff'],
    core: 'rgba(255,240,255,0.95)', ring: 'rgba(200,120,255,0.9)',
    spark: '#e0a6ff', smoke: 'rgba(62,46,74,1)'
  },
  {
    id: 'EMP', scale: 0.92, pitch: 1.6, bolt: true,
    fire: ['#ffffff', '#e3f6ff', '#6ec3ff', '#1e5bff'],
    core: 'rgba(255,255,255,0.95)', ring: 'rgba(150,210,255,0.85)',
    spark: '#cfe8ff', smoke: 'rgba(50,62,78,1)'
  },
  {
    id: 'OVERLOAD', scale: 1.05, pitch: 1.15, bolt: true,
    fire: ['#fffdf2', '#ffe9a8', '#ffb347', '#ff5f3c'],
    core: 'rgba(255,251,232,0.95)', ring: 'rgba(255,200,120,0.9)',
    spark: '#ffdf9b', smoke: 'rgba(70,58,50,1)'
  }
];

function tankVisible(p) {
  // keep the hull on screen through the charge-up, then it is simply gone
  if (p.alive) return true;
  return !!(G.kill && G.kill.p === p && G.kill.phase === 'charge');
}

function detonate(p) {
  const style = rpick(DEATH_STYLES);
  const k = {
    p, x: p.x, y: p.y, t: 0, age: 0,
    phase: 'charge',
    style,
    charge: rr(0.22, 0.42),          // the beat before it goes
    ringN: 2 + ((rnd() * 3) | 0),    // 2-4 shockwaves
    crater: rr(74, 112),
    scale: style.scale * rr(0.9, 1.18),
    seq: [],
    blobs: [],
    turret: {
      x: p.x, y: p.y - 44, vx: 0, vy: 0, rot: rr(0, 6.28), vr: 0,
      life: 8, launched: false
    },
    chaff: [],
    emberT: 0, emberRate: rr(0.035, 0.085), emberLife: rr(2.4, 4.6),
    core: 0, glow: 0
  };

  // 2-6 secondary detonations, staggered outward from the hull
  const n = 2 + ((rnd() * 5) | 0);
  for (let i = 0; i < n; i++) {
    k.seq.push({
      t: k.charge + rr(0.18, 1.35),
      x: p.x + rr(-100, 100),
      y: p.y - rr(0, 64),
      r: rr(38, 82)
    });
  }
  k.seq.sort((a, b) => a.t - b.t);

  // implosion: sparks dragged inward during the charge
  for (let i = 0; i < 30; i++) {
    const a = rr(0, 6.283), d = rr(70, 170);
    particles.push({
      x: p.x + Math.cos(a) * d, y: p.y - 30 + Math.sin(a) * d,
      vx: -Math.cos(a) * d / k.charge, vy: -Math.sin(a) * d / k.charge,
      life: k.charge, max: k.charge, size: 2.4, color: style.spark,
      kind: 'spark', grav: 0, drag: 1, rot: 0, vr: 0, grow: 0
    });
  }

  G.kill = k;
  addShake(6);
  if (Audio2.charge) Audio2.charge(k.charge, style.pitch);
}

function burstKill(k) {
  const { x, style } = k;
  const cy = k.y - 36;
  k.phase = 'burst';
  k.core = 1;
  k.glow = 1;

  // core + shockwaves
  addRing(x, cy, 12, 155 * k.scale, 0.42, style.core, 11);
  for (let i = 0; i < k.ringN; i++) {
    addRing(x, cy, 10, (104 + i * 44) * k.scale, 0.3 + i * 0.08, style.ring, Math.max(1.3, 4.5 - i * 0.9));
  }

  // volumetric fireball body
  k.blobs = [];
  const nb = 6 + ((rnd() * 4) | 0);
  for (let i = 0; i < nb; i++) {
    k.blobs.push({
      dx: rr(-46, 46) * k.scale, dy: rr(-52, 22) * k.scale,
      r: rr(24, 54) * k.scale, life: rr(0.5, 0.95), max: 0.95,
      grow: rr(34, 108)
    });
  }

  // fireball
  for (let i = 0; i < 62; i++) {
    const a = rr(0, 6.283);
    const sp = rr(150, 780 * k.scale);
    particles.push({
      x, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
      life: rr(0.35, 1.05), max: 1.05, size: rr(3.5, 9),
      color: rpick(style.fire), kind: 'ember', grav: 320, drag: 0.94,
      rot: 0, vr: 0, grow: 0
    });
  }
  // the puff that hangs around afterwards
  for (let i = 0; i < 14; i++) {
    particles.push({
      x: x + rr(-26, 26), y: cy + rr(-26, 26),
      vx: rr(-95, 95) + G.wind * 0.4, vy: rr(-150, -40),
      life: rr(1.8, 3.8), max: 3.8, size: rr(12, 26),
      color: style.smoke, kind: 'smoke', grav: -26, drag: 0.975,
      rot: 0, vr: rr(-1, 1), grow: rr(14, 30)
    });
  }
  // armour chunks
  spawnDebris(x, k.y - 10, 30, '#464c56');
  for (let i = 0; i < 9; i++) {
    const a = rr(-Math.PI, 0);
    particles.push({
      x, y: cy, vx: Math.cos(a) * rr(120, 460), vy: Math.sin(a) * rr(120, 520),
      life: rr(1.2, 2.6), max: 2.6, size: rr(3, 7), color: '#39404a',
      kind: 'dirt', grav: 980, drag: 0.997, rot: rr(0, 6.28), vr: rr(-12, 12), grow: 0
    });
  }

  // the turret itself, thrown clear
  const t = k.turret;
  t.launched = true;
  t.vx = rr(-1, 1) * rr(70, 300);
  t.vy = -rr(360, 660);
  t.vr = rr(-13, 13);

  carve(x, k.y - 14, k.crater);
  addShake(26 + rr(0, 12));
  G.cam.flash = Math.max(G.cam.flash, 0.95);
  if (Audio2.kill) Audio2.kill(style.pitch);
}

function secondary(s, k) {
  const style = k.style;
  addRing(s.x, s.y, 4, s.r * 1.5, 0.4, style.ring, 2.5);
  for (let i = 0; i < 12; i++) {
    const a = rr(0, 6.283), sp = rr(90, 420);
    particles.push({
      x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: rr(0.3, 0.8), max: 0.8, size: rr(2, 5),
      color: rpick(style.fire), kind: 'ember', grav: 340, drag: 0.94, rot: 0, vr: 0, grow: 0
    });
  }
  particles.push({
    x: s.x, y: s.y, vx: rr(-40, 40), vy: rr(-90, -20),
    life: rr(1.2, 2.4), max: 2.4, size: rr(8, 16), color: style.smoke,
    kind: 'smoke', grav: -22, drag: 0.975, rot: 0, vr: rr(-1, 1), grow: rr(10, 22)
  });
  spawnDebris(s.x, s.y, 6, '#4a4a52');
  carve(s.x, s.y, s.r * 0.55);
  addShake(4);
  Audio2.boom(false, 24);
}

function updateKill(dt) {
  const k = G.kill;
  if (!k) return;
  k.t += dt;
  k.age += dt;

  if (k.phase === 'charge') {
    if (k.t >= k.charge) burstKill(k);
    k.core = Math.min(1, k.t / k.charge) * 0.6;
    return;
  }

  // turret shard physics
  const t = k.turret;
  if (t.launched && t.life > 0) {
    t.life -= dt;
    t.vy += 1500 * dt;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.rot += t.vr * dt;
    const g = surfaceAt(t.x);
    if (t.y > g) {
      t.y = g;
      t.vy *= -0.42;
      t.vx *= 0.74;
      t.vr *= 0.62;
      if (Math.abs(t.vy) < 70) { t.vy = 0; t.vx *= 0.88; t.vr *= 0.7; }
      spawnDebris(t.x, g, 3, '#4a4a52');
    }
    // burning trail while airborne
    if (t.life > 3 && rnd() < 0.6) {
      particles.push({
        x: t.x, y: t.y, vx: rr(-30, 30), vy: rr(-40, 0),
        life: rr(0.3, 0.7), max: 0.7, size: rr(2, 4),
        color: rpick(k.style.fire), kind: 'ember', grav: 120, drag: 0.95,
        rot: 0, vr: 0, grow: 0
      });
    }
  }

  // scheduled secondary detonations
  while (k.seq.length && k.seq[0].t <= k.t) secondary(k.seq.shift(), k);

  // embers breathing out of the wreck for a few seconds
  k.emberT -= dt;
  if (k.emberT <= 0 && k.t < k.charge + 4.5) {
    k.emberT = k.emberRate;
    particles.push({
      x: k.x + rr(-k.crater * 0.5, k.crater * 0.5), y: k.y - rr(0, 20),
      vx: rr(-24, 24) + G.wind * 0.22, vy: -rr(40, 130),
      life: k.emberLife, max: k.emberLife, size: rr(1.2, 2.8),
      color: rpick(k.style.fire), kind: 'ember', grav: -30, drag: 0.985,
      rot: 0, vr: 0, grow: 0
    });
  }

  for (const b of k.blobs) {
    if (b.life > 0) { b.life -= dt; b.r += b.grow * dt; }
  }
  k.core = Math.max(0, k.core - dt * 1.95);
  k.glow = Math.max(0, k.glow - dt * 0.55);
  if (k.t > k.charge + 7.5) G.kill = null;
}

/* ---------------------------------------------------------------- render */
function drawKill(ctx) {
  const k = G.kill;
  if (!k) return;
  const cy = k.y - 36;
  const style = k.style;

  if (k.phase === 'charge') {
    const p = clamp(k.t / k.charge, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = 120 - p * 70;
    const g = ctx.createRadialGradient(k.x, cy, 0, k.x, cy, r);
    g.addColorStop(0, style.core);
    g.addColorStop(0.45, style.ring);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.3 + p * 0.55;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(k.x, cy, r, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }

  const ct = k.t - k.charge;

  // ground glow under the wreck
  if (k.glow > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.crater * 2.2);
    gg.addColorStop(0, style.ring);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = k.glow * 0.35;
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(k.x, k.y, k.crater * 2.2, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ground pressure wave: a flattened ring tearing outward along the surface
  if (ct < 0.75) {
    const p = ct / 0.75;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - p) * 0.55;
    ctx.strokeStyle = style.ring;
    ctx.lineWidth = 2 + (1 - p) * 8;
    const rx = (36 + p * 560) * k.scale;
    ctx.beginPath();
    ctx.ellipse(k.x, k.y, rx, Math.max(3, rx * 0.13), 0, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // fireball body
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of k.blobs) {
    if (b.life <= 0) continue;
    const a = clamp(b.life / b.max, 0, 1);
    const bx = k.x + b.dx, by = cy + b.dy;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.85 * a).toFixed(3) + ')');
    g.addColorStop(0.42, style.fire[1] || style.fire[0]);
    g.addColorStop(0.75, style.fire[2] || style.fire[0]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, b.r, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // core flash
  if (k.core > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = (150 + 360 * (1 - k.core)) * k.scale;
    const g = ctx.createRadialGradient(k.x, cy, 0, k.x, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.95 * k.core).toFixed(3) + ')');
    g.addColorStop(0.3, style.core);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = Math.min(1, k.core * 1.4);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(k.x, cy, r, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // EMP / overload styles throw arcs for the first third of a second
  if (style.bolt && ct < 0.32) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = style.spark;
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.16 + rnd() * 0.24;
      ctx.lineWidth = 1.6 + rnd() * 1.8;
      const a = rr(0, 6.283);
      const reach = rr(55, 132) * k.scale;
      const steps = 5 + ((rnd() * 3) | 0);
      ctx.beginPath();
      ctx.moveTo(k.x, cy);
      for (let s = 1; s <= steps; s++) {
        const d = (s / steps) * reach;
        ctx.lineTo(k.x + Math.cos(a) * d + rr(-13, 13), cy + Math.sin(a) * d + rr(-13, 13));
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // the thrown turret
  const t = k.turret;
  if (t.launched && t.life > 0) {
    ctx.save();
    if (t.life > 3) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 46);
      g.addColorStop(0, style.spark);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = Math.min(1, (t.life - 3) * 0.5) * 0.5;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(t.x, t.y, 46, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = Math.min(1, t.life / 1.2);
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rot);
    ctx.fillStyle = '#232a33';
    ctx.strokeStyle = 'rgba(255,190,140,.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-15, -9); ctx.lineTo(9, -9); ctx.lineTo(13, 1); ctx.lineTo(-11, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a2028';
    ctx.fillRect(7, -5, 30, 6);
    ctx.strokeStyle = 'rgba(255,190,140,.35)';
    ctx.strokeRect(7, -5, 30, 6);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
