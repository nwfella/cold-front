/* =========================================================================
   ENTITIES — projectiles, explosions, particles, damage
   ========================================================================= */

const particles = [];
const MAX_PARTICLES = 1100;

function spawnParticle(o) {
  if (particles.length > MAX_PARTICLES) particles.shift();
  particles.push(o);
}

function px(x, y, n, opt) {
  for (let i = 0; i < n; i++) {
    const a = opt.angle !== undefined ? opt.angle + rr(-opt.spread, opt.spread) : rr(0, Math.PI * 2);
    const sp = rr(opt.speed * 0.35, opt.speed);
    spawnParticle({
      x: x + rr(-2, 2), y: y + rr(-2, 2),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rr(opt.life * 0.6, opt.life), max: opt.life,
      size: rr(opt.size * 0.6, opt.size),
      color: rpick(opt.colors),
      kind: opt.kind || 'spark',
      grav: opt.grav === undefined ? 120 : opt.grav,
      drag: opt.drag === undefined ? 0.9 : opt.drag,
      rot: rr(0, 6.28), vr: rr(-6, 6),
      grow: opt.grow || 0
    });
  }
}

function spawnDebris(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rr(-Math.PI, 0);
    const sp = rr(90, 420);
    spawnParticle({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rr(0.7, 1.8), max: 1.8, size: rr(1.5, 4.5),
      color: color || '#6b5a4a', kind: 'dirt', grav: 780, drag: 0.995,
      rot: rr(0, 6.28), vr: rr(-10, 10), grow: 0
    });
  }
}

function addRing(x, y, r0, r1, life, color, width) {
  G.rings.push({ x, y, r: r0, r0, r1, life, max: life, color, width: width || 3 });
}
function addText(x, y, txt, color, size) {
  G.texts.push({ x, y, vy: -46, life: 1.5, max: 1.5, txt, color, size: size || 20 });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.vx *= Math.pow(p.drag, dt * 60);
    p.vy *= Math.pow(p.drag, dt * 60);
    if (p.kind === 'smoke' || p.kind === 'ash') p.vx += G.wind * 0.06 * dt * 60;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.kind === 'dirt') {
      const g = surfaceAt(p.x);
      if (p.y > g) { p.y = g; p.vy *= -0.34; p.vx *= 0.6; p.vr *= 0.5; if (Math.abs(p.vy) < 24) { p.vy = 0; p.grav = 0; } }
    }
    if (p.grow) p.size += p.grow * dt;
  }
  for (let i = G.rings.length - 1; i >= 0; i--) {
    const r = G.rings[i];
    r.life -= dt;
    if (r.life <= 0) { G.rings.splice(i, 1); continue; }
    const t = 1 - r.life / r.max;
    r.r = lerp(r.r0, r.r1, easeOut(t));
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.life -= dt;
    t.y += t.vy * dt;
    t.vy *= 0.94;
    if (t.life <= 0) G.texts.splice(i, 1);
  }
}

/* ---------------------------------------------------------------- damage */
function damageUnit(target, amount, cause, source) {
  if (!target.alive) return 0;
  const dmg = Math.max(1, Math.round(amount));
  target.hp = Math.max(0, target.hp - dmg);
  target.flash = 1;
  target.shake = 1;
  addText(target.x, target.y - 62, '-' + dmg, '#ff8a8a', 22);
  if (source) {
    source.dmg += dmg;
    G.stats.dmg += dmg;
    if (dmg > G.stats.best) G.stats.best = dmg;
  }
  Audio2.hit();
  if (target.hp <= 0) {
    target.alive = false;
    Audio2.boom(true, 70);
    addRing(target.x, target.y - 14, 8, 190, 0.7, '#fff3c4', 6);
    px(target.x, target.y - 16, 46, { speed: 520, spread: 3.14, life: 1.1, size: 3.4, colors: ['#ffd27a', '#ff8a5c', '#fff'], grav: 420, drag: 0.965 });
    spawnDebris(target.x, target.y - 10, 26, '#4a4a52');
    particles.push({ x: target.x, y: target.y - 18, vx: 0, vy: -40, life: 2.2, max: 2.2, size: 22, color: 'rgba(40,40,48,1)', kind: 'smoke', grav: -14, drag: 0.98, rot: 0, vr: 1, grow: 34 });
    addShake(22);
    G.cam.flash = 0.85;
    carve(target.x, surfaceAt(target.x) - 6, 74);
  }
  return dmg;
}

/* ---------------------------------------------------------------- firing */
function muzzlePoint(p, angle) {
  const a = angle * DEG;
  const dir = facingOf(p);
  const px0 = p.x + PIVOT_DX * dir, py0 = p.y - PIVOT_DY;
  return { x: px0 + Math.cos(a) * BARREL_LEN * dir, y: py0 - Math.sin(a) * BARREL_LEN };
}

function makeProjectile(team, x, y, vx, vy, w, extra) {
  const o = {
    x, y, vx, vy, team, w,
    r: w.r, dmg: w.dmg, color: w.color,
    age: 0, dist: 0, trail: [], smoke: 0,
    split: !!w.split, flat: !!w.flat, roll: !!w.roll,
    rolling: false, rollDist: 0, spin: rr(0, 6.28),
    dead: false
  };
  if (extra) Object.assign(o, extra);
  return o;
}

function fireShot(angle, power, weaponIdx) {
  const p = activePlayer();
  const w = WEAPONS[weaponIdx] || WEAPONS[0];
  const a = angle * DEG;
  const v = muzzleSpeed(power) * w.spd;
  const mz = muzzlePoint(p, angle);
  let x = mz.x, y = mz.y;
  // clear own barrel if buried
  const dir = facingOf(p);
  let guard = 0;
  while (y > surfaceAt(x) - 4 && guard++ < 90) { x += Math.cos(a) * 4 * dir; y -= Math.sin(a) * 4; }
  G.projs.push(makeProjectile(p.i, x, y, Math.cos(a) * v * dir, -Math.sin(a) * v, w));

  if (w.ammo !== Infinity) p.ammo[weaponIdx] = Math.max(0, p.ammo[weaponIdx] - 1);
  p.shots++; G.stats.shots++;
  p.lastAngle = angle; p.lastPower = power;
  p.recoil = 1;
  p.barrel = angle;

  G.ghosts[p.i] = [];
  G.mode = 'fly';
  G.turnCount++;
  G.timers.resolve = 0;
  Audio2.fire(power);
  Audio2.wind(G.wind);
  const mx = muzzlePoint(p, angle).x, my = muzzlePoint(p, angle).y;
  const mAng = dir > 0 ? -angle * DEG : Math.PI + angle * DEG;
  px(mx, my, 26, { speed: 460, spread: 0.4, angle: mAng, life: 0.4, size: 3, colors: ['#fff6d0', '#ffc46b', '#ff8a4c'], grav: 60, drag: 0.9 });
  px(mx, my, 8, { speed: 150, spread: 0.9, angle: mAng, life: 1.1, size: 9, colors: ['rgba(220,220,230,.5)'], grav: -20, drag: 0.94, kind: 'smoke', grow: 10 });
  addRing(mx, my, 2, 46, 0.28, 'rgba(255,220,160,.9)', 2);
  addShake(7);
  p.shake = 0.7;
  updateHud();
  return true;
}

/* ---------------------------------------------------------------- physics */
function stepProjectiles(dt) {
  const list = G.projs;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.age += dt;
    if (p.rolling) { stepRolling(p, dt, i); continue; }

    const spd = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.min(24, Math.ceil((spd * dt) / 7)));
    const h = dt / steps;
    let done = false;

    for (let s = 0; s < steps && !done; s++) {
      if (!p.flat) { p.vy += GRAV * h; p.vx += G.wind * h; }
      const nx = p.x + p.vx * h;
      const ny = p.y + p.vy * h;
      p.dist += Math.hypot(nx - p.x, ny - p.y);

      // --- tank hit
      for (const t of G.players) {
        if (t.i === p.team && p.age < 0.25) continue;
        const hx = t.x, hy = t.y - 16;
        if (Math.abs(nx - hx) < 34 && ny > hy - 30 && ny < hy + 20) {
          explode(nx, ny, p, t);
          done = true;
          break;
        }
      }
      if (done) break;

      // --- terrain hit
      if (ny >= surfaceAt(nx)) {
        const gy = surfaceAt(nx);
        if (p.roll && !p.flat) {
          p.rolling = true;
          p.y = gy - 5;
          p.rollDist = 0;
          p.vx = p.vx * 0.55;
          Audio2.roll();
          explodeSmall(nx, gy, p);
          break;
        }
        explode(nx, gy, p, null);
        done = true;
        break;
      }

      // --- world bounds
      if (nx < -260 || nx > W + 260 || ny > H + 260) {
        pushLog(tagOf(G.players[p.team]) + ' \u25B8 OUT OF RANGE', 'miss');
        done = true;
        break;
      }
      p.x = nx; p.y = ny;
    }
    if (done) { list.splice(i, 1); continue; }

    // trail sampling
    const last = p.trail[p.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 10) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 300) p.trail.shift();
    }
    // exhaust
    p.smoke += dt;
    if (p.smoke > 0.026) {
      p.smoke = 0;
      spawnParticle({
        x: p.x, y: p.y, vx: rr(-14, 14) - p.vx * 0.02, vy: rr(-14, 14) - p.vy * 0.02,
        life: rr(0.5, 1.15), max: 1.15, size: rr(2.5, 5.5),
        color: p.flat ? 'rgba(170,200,255,.55)' : 'rgba(240,225,210,.4)',
        kind: 'smoke', grav: -8, drag: 0.97, rot: 0, vr: rr(-2, 2), grow: 13
      });
    }
    // cluster split at apex
    if (p.split && p.vy >= 0 && !p.didSplit) {
      p.didSplit = true;
      const w = { ...p.w, r: p.r, dmg: 22, split: 0, color: '#7ef2c8' };
      // bomblets inherit the shell's forward momentum and fan out from it, so the
      // cluster blankets the target instead of raining down over no-man's land
      for (let k = 0; k < 3; k++) {
        const ang = -Math.PI / 2 + rr(-0.5, 0.5);
        const sp = rr(70, 210);
        list.push(makeProjectile(p.team, p.x, p.y,
          p.vx + Math.cos(ang) * sp, Math.min(0, p.vy) + Math.sin(ang) * sp, w, { bomblet: true }));
      }
      addRing(p.x, p.y, 4, 40, 0.3, 'rgba(126,242,200,.8)', 2);
      Audio2.tick();
      list.splice(i, 1);
      continue;
    }

    if (p.age > 18) {
      pushLog(tagOf(G.players[p.team]) + ' \u25B8 SIGNAL LOST', 'miss');
      list.splice(i, 1);
    }
  }

  if (list.length === 0 && G.mode === 'fly') {
    G.mode = 'resolve';
    G.timers.resolve = 1.15;
  }
}

function stepRolling(p, dt, idx) {
  const dir = p.vx >= 0 ? 1 : -1;
  const speed = Math.max(40, Math.abs(p.vx));
  const nx = p.x + dir * speed * dt * 1.35;
  p.rollDist += Math.abs(nx - p.x);
  p.x = nx;
  const g = surfaceAt(p.x);
  p.y = g - 4;
  p.dist += speed * dt * 1.35;
  p.vx *= Math.pow(0.35, dt);
  spawnParticle({
    x: p.x, y: p.y + 2, vx: -dir * rr(20, 90), vy: rr(-40, -6),
    life: rr(0.2, 0.5), max: 0.5, size: rr(1.5, 3.5),
    color: 'rgba(200,180,255,.7)', kind: 'spark', grav: 220, drag: 0.95, rot: 0, vr: 0, grow: 0
  });
  for (const t of G.players) {
    if (t.i !== p.team && Math.abs(p.x - t.x) < 30 && Math.abs(p.y - (t.y - 16)) < 34) {
      explode(p.x, p.y, p, t); G.projs.splice(idx, 1); return;
    }
  }
  if (p.rollDist > 380 || p.x < -40 || p.x > W + 40 || speed < 60) {
    explode(p.x, p.y, p, null);
    G.projs.splice(idx, 1);
  }
}

function explodeSmall(x, y, p) {
  addRing(x, y, 3, 40, 0.3, 'rgba(224,166,255,.7)', 2);
  px(x, y, 8, { speed: 160, spread: 1.4, angle: -1.6, life: 0.5, size: 2.4, colors: ['#e0a6ff', '#fff'], grav: 300, drag: 0.94 });
}

function explode(x, y, proj, hitTarget) {
  const w = proj.w || WEAPONS[0];
  const r = proj.r || w.r;
  const dmg = proj.dmg || w.dmg;
  const src = G.players[proj.team];

  carve(x, y, r * 0.92);
  addRing(x, y, 6, r * 2.2, 0.55, 'rgba(255,240,200,.95)', 5);
  addRing(x, y, 2, r * 3.0, 0.85, 'rgba(255,150,90,.35)', 2);
  G.cam.flash = Math.min(1, G.cam.flash + 0.55);
  addShake(proj.bomblet ? 9 : 15 + r * 0.06);
  Audio2.boom(r > 100, dmg);

  px(x, y, proj.bomblet ? 16 : 34, { speed: 520, spread: 3.14, life: 0.75, size: 3.6, colors: ['#fff3c4', '#ffc46b', '#ff7a4c', '#fff'], grav: 380, drag: 0.955 });
  spawnDebris(x, y, proj.bomblet ? 10 : 22, '#5a4a3c');
  for (let i = 0; i < (proj.bomblet ? 3 : 6); i++) {
    particles.push({
      x: x + rr(-r * 0.3, r * 0.3), y: y + rr(-12, 12),
      vx: rr(-70, 70) + G.wind * 0.3, vy: rr(-90, -20),
      life: rr(1.1, 2.4), max: 2.4, size: rr(9, 20),
      color: 'rgba(210,205,200,1)', kind: 'smoke', grav: -18, drag: 0.975,
      rot: 0, vr: rr(-1.5, 1.5), grow: rr(6, 15)
    });
  }

  // damage falloff
  const reach = r * 1.45;
  let hitAny = false, direct = false, enemyDmg = 0;
  for (const t of G.players) {
    const d = dist(x, y, t.x, t.y - 16);
    if (d < reach) {
      const f = Math.pow(1 - d / reach, 1.45);
      const amt = Math.max(3, dmg * f);
      damageUnit(t, amt, 'blast', src);
      if (t.i !== proj.team) enemyDmg += Math.round(amt);
      if (f > 0.55) { hitAny = true; if (t === hitTarget) direct = true; }
    }
  }

  if (direct) {
    pushLog(tagOf(src) + ' \u25B8 ' + tagOf(hitTarget) + '   \u2212' + enemyDmg, 'hit');
    addText(hitTarget.x, hitTarget.y - 108, 'DIRECT HIT', '#ffe9a8', 17);
    src.hits++; G.stats.hits++;
  } else if (hitAny) {
    pushLog(tagOf(src) + ' \u25B8 NEAR MISS   \u2212' + enemyDmg, 'hit');
  } else {
    pushLog(tagOf(src) + ' \u25B8 CRATER', 'miss');
  }
  if (proj.dist > src.longest) src.longest = proj.dist;
  if (proj.dist > G.stats.longest) G.stats.longest = proj.dist;

  G.dots.push({ x, y, r: Math.min(70, r), team: proj.team, t: 0 });
  if (G.dots.length > 14) G.dots.shift();
}
