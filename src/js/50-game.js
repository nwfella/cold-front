/* =========================================================================
   GAME FLOW — match/round state machine, turn logic, ballistic AI
   ========================================================================= */

const AI_LEVELS = [
  { name: 'RECRUIT', err: 4.6, learn: 0.62, delay: 1.9 },
  { name: 'VETERAN', err: 2.1, learn: 0.48, delay: 1.5 },
  { name: 'ELITE', err: 0.7, learn: 0.3, delay: 1.15 }
];

function startMatch(mode) {
  G.matchMode = mode;              // 'ai' | '2p'
  G.matchOn = true;
  G.round = 1;
  G.players = [makePlayer(0), makePlayer(1)];
  G.players[0].wins = 0;
  G.players[1].wins = 0;
  if (mode === 'ai') G.players[1].name = 'A.I. ' + AI_LEVELS[settings.ai].name;
  G.stats = { shots: 0, hits: 0, dmg: 0, longest: 0, best: 0 };
  G.matchStart = now();
  G.aiErr = 1;
  G.log = [];
  newRound(true);
  showHud(true);
  Audio2.ensure();
}

function newRound(first) {
  G.seed = G.forceSeed != null ? G.forceSeed : (Math.random() * 1e9) | 0;
  seedRnd(G.seed);
  G.roundSeed = G.seed;
  G.palette = PALETTES[(G.round - 1) % PALETTES.length] || rpick(PALETTES);
  G.roundOver = false;
  G.matchOn = G.matchOn !== false;
  G.turnCount = 0;
  G.storm = 0;
  G.meteor = null;
  G.projs = [];
  G.dots = [];
  particles.length = 0;
  G.rings.length = 0;
  G.texts.length = 0;
  G.aiErr = 1;
  G.aiPlan = null;
  G.aiTimer = 0;
  G.cam.flash = 0;
  G.cam.shake = 0;
  camTo(0, 0, 1, true);
  genTerrain(G.seed);
  placeUnits();
  G.wind = rr(-1, 1) * WIND_MAX * 0.8;
  G.players[0].name = 'VANGUARD';
  G.players[1].name = G.matchMode === 'ai' ? 'A.I. ' + AI_LEVELS[settings.ai].name : 'HOSTILE';
  G.turn = first ? 0 : (G.round % 2 === 0 ? 1 : 0);
  if (G.round === 1 && first) G.turn = 0;
  G.mode = 'aim';
  G.timers.clock = 45;
  G.lastResult = '';
  applyPalette();
  updateHud();
  if (G.turn === 1 && G.matchMode === 'ai') planAI();
}

function applyPalette() {
  const pal = G.palette;
  const root = document.documentElement.style;
  root.setProperty('--accent', pal.accent);
  document.querySelector('meta[name=theme-color]').setAttribute('content', pal.sky[0]);
}

function nextTurn() {
  G.turn = 1 - G.turn;
  G.wind = rr(-1, 1) * WIND_MAX * (G.storm ? 1.3 : 1);
  G.mode = 'aim';
  G.timers.clock = 45;
  G.aiPlan = null;
  G.aiTimer = 0;
  const p = activePlayer();
  p.weapon = G.players[G.turn].ammo[p.weapon] > 0 ? p.weapon : bestWeaponIndex(p);
  // escalation
  G.turnCount++;
  if (G.turnCount >= 10) {
    G.storm = 1;
    G.meteor = { x: rr(200, W - 200), t: 2.6 };
  }
  camTo(0, 0, 1);
  Audio2.turn();
  Audio2.wind(G.wind);
  updateHud();
  if (G.turn === 1 && G.matchMode === 'ai') planAI();
  if (G.turn === 0 && G.matchMode !== 'ai') { /* human */ }
}

function bestWeaponIndex(p) {
  for (let i = 0; i < WEAPONS.length; i++) {
    if (p.ammo[i] === Infinity || p.ammo[i] > 0) return i;
  }
  return 0;
}

/* ---------------------------------------------------------------- AI */
function planAI() {
  const me = G.players[1], foe = G.players[0];
  const lvl = AI_LEVELS[settings.ai] || AI_LEVELS[1];
  // pick preference
  let wi = 0;
  if (me.ammo[2] > 0 && foe.hp < 60 && rnd() < 0.55) wi = 2;
  else if (me.ammo[1] > 0 && rnd() < 0.35) wi = 1;
  else if (me.ammo[4] > 0 && rnd() < 0.18) wi = 4;
  else if (me.ammo[3] > 0 && rnd() < 0.12) wi = 3;
  if (me.ammo[wi] !== Infinity && me.ammo[wi] <= 0) wi = bestWeaponIndex(me);

  const tgt = { x: foe.x, y: foe.y - 16 };
  let sol = solveBallistic(me, tgt, G.wind, WEAPONS[wi]);
  if (wi !== 0 && (sol.blocked || sol.miss > 45)) {
    // no viable line for this round — stop wasting it, engage with HE instead
    wi = 0;
    sol = solveBallistic(me, tgt, G.wind, WEAPONS[wi]);
  }
  const jitterA = (rnd() - 0.5) * 2 * lvl.err * G.aiErr;
  const jitterP = (rnd() - 0.5) * 2 * lvl.err * 1.4 * G.aiErr;
  const angle = clamp(sol.angle + jitterA, 6, 88);
  const power = clamp(sol.power + jitterP, 12, 100);
  G.aiPlan = { angle, power, weapon: wi };
  G.aiTimer = lvl.delay;
  me.angle = clamp(angle + rr(-6, 6), 8, 86);
  me.power = clamp(power + rr(-10, 10), 14, 96);
  me.weapon = wi;
}

/* Closed-form ballistic search. Starts at the real muzzle (barrel offset shifts
   the landing point by >100 units over a full-field shot) and scores range error
   + terrain clearance, so a ridge is lobbed instead of drilled. */
function solveBallistic(shooter, target, wind, w) {
  const spdMul = (w && w.spd) || 1;
  const flat = !!(w && w.flat);
  const tx = target.x, ty = target.y;
  const dirS = facingOf(shooter);   // <- shots travel toward the enemy, not always +x
  let best = { angle: 45, power: 70, miss: 1e9, blocked: true, score: 1e9, clear: 0 };
  for (let a = 10; a <= 84; a += 0.75) {
    const rad = a * DEG;
    const mz = muzzlePoint(shooter, a);
    const x0 = mz.x, y0 = mz.y;
    for (let pw = 14; pw <= 100; pw += 2) {
      const v = muzzleSpeed(pw) * spdMul;
      const vx0 = Math.cos(rad) * v * dirS;
      const vy0 = -Math.sin(rad) * v;
      let t, miss;
      if (flat) {
        // a flat round never falls: it only hits if the bore line itself crosses
        // the target, so score the VERTICAL error at the target's x, never the range
        if (Math.abs(vx0) <= 1) continue;
        t = (tx - x0) / vx0;
        if (!(t > 0.05) || t > 14) continue;
        miss = Math.abs(y0 + vy0 * t - ty);
      } else {
        const disc = vy0 * vy0 - 2 * GRAV * (y0 - ty);
        if (disc < 0) continue;
        t = (-vy0 + Math.sqrt(disc)) / GRAV;
        if (!(t > 0.05) || t > 14) continue;
        miss = Math.abs(x0 + vx0 * t + 0.5 * wind * t * t - tx);
      }
      // Clearance is only meaningful in mid-flight: the first metres are inside
      // our own barrel and the last few are the descent onto the target, where the
      // round is *supposed* to be at ground level. Sampling those made every
      // solution read as "blocked".
      let clear = 1e9;
      for (let k = 2; k < 22; k++) {
        const tt = (k / 22) * t;
        const sx = x0 + vx0 * tt + (flat ? 0 : 0.5 * wind * tt * tt);
        const sy = y0 + vy0 * tt + (flat ? 0 : 0.5 * GRAV * tt * tt);
        if (Math.abs(sx - tx) < 46) continue;
        const c = surfaceAt(sx) - sy;
        if (c < clear) clear = c;
      }
      if (clear === 1e9) clear = 400;
      const blocked = clear < 6;
      const score = miss + (blocked ? 600 : 0) + Math.max(0, 50 - clear) * 0.6;
      if (score < best.score) best = { angle: a, power: pw, miss, blocked, score, clear };
    }
  }
  return best;
}

function aiTurnStep(dt) {
  if (!G.aiPlan) planAI();
  const me = G.players[1], plan = G.aiPlan;
  me.angle = lerp(me.angle, plan.angle, 1 - Math.pow(0.02, dt));
  me.power = lerp(me.power, plan.power, 1 - Math.pow(0.02, dt));
  me.weapon = plan.weapon;
  G.aiTimer -= dt;
  if (G.aiTimer <= 0) {
    const a = plan.angle, p = plan.power, wi = plan.weapon;
    G.aiPlan = null;
    fireShot(a, p, wi);
  }
}

/* ---------------------------------------------------------------- resolve */
function resolveTurn() {
  const dead0 = !G.players[0].alive, dead1 = !G.players[1].alive;
  if (dead0 || dead1) {
    const w = dead0 && dead1 ? -1 : dead0 ? 1 : 0;
    if (w === -1) {
      // mutual destruction: the shooter (current turn) loses the round
      endRound(1 - G.turn);
    } else {
      endRound(w);
    }
    return;
  }
  if (G.matchMode === 'ai') G.aiErr *= (AI_LEVELS[settings.ai] || AI_LEVELS[1]).learn;
  G.aiErr = clamp(G.aiErr, 0.25, 1.6);
  nextTurn();
}

function endRound(wIdx) {
  const p = G.players[wIdx];
  p.wins++;
  G.mode = 'roundover';
  updateHud();
  G.ghosts = [[], []];
  if (p.wins >= 2) {
    G.winner = wIdx;
    G.mode = 'matchover';
    setTimeout(() => showEnd(wIdx), 900);
    if (G.matchMode !== 'ai' || wIdx === 0) Audio2.win(); else Audio2.lose();
  } else {
    if (G.matchMode !== 'ai' || wIdx === 0) Audio2.win(); else Audio2.lose();
    setTimeout(() => showRoundOver(wIdx), 800);
  }
}

/* ---------------------------------------------------------------- update */
function updateGame(dt) {
  G.t += dt;
  updateCamera(dt);
  for (const p of G.players) {
    if (!p) continue;
    p.flash = Math.max(0, p.flash - dt * 2.6);
    p.shake = Math.max(0, p.shake - dt * 3.2);
    p.recoil = Math.max(0, p.recoil - dt * 2.4);
    const targetAngle = (G.mode === 'aim' && p.i === G.turn) ? p.angle : p.angle;
    p.barrel = lerp(p.barrel, targetAngle, 1 - Math.pow(0.004, dt));
  }

  if (G.mode === 'fly') {
    stepProjectiles(dt);
    settleUnits(dt);
    followProjectile();
  } else if (G.mode === 'resolve') {
    settleUnits(dt);
    G.timers.resolve -= dt;
    camTo(0, 0, 1);
    if (G.timers.resolve <= 0) resolveTurn();
  } else if (G.mode === 'aim') {
    settleUnits(dt);
    if (G.turn === 1 && G.matchMode === 'ai') aiTurnStep(dt);
    if (settings.clock && G.timers.clock > 0) {
      G.timers.clock -= dt;
      if (G.timers.clock <= 0) {
        toast('CLOCK EXPIRED — AUTO FIRE');
        fireShot(activePlayer().angle, activePlayer().power, activePlayer().weapon);
      }
    }
  }

  // meteor / metal storm
  if (G.meteor && (G.mode === 'aim' || G.mode === 'fly')) {
    G.meteor.t -= dt;
    if (G.meteor.t <= 0) {
      const mx = G.meteor.x;
      const my = surfaceAt(mx);
      const fake = { w: WEAPONS[2], r: 96, dmg: 34, team: 1 - G.turn, dist: 0, bomblet: true };
      explode(mx, my - 10, fake, null);
      carve(mx, my - 10, 88);
      addShake(24);
      for (let i = 0; i < 3; i++) {
        px(mx, my - 4, 16, { speed: 420, spread: 1.2, angle: -1.57, life: 0.8, size: 4, colors: ['#ffd27a', '#ff8a5c'], grav: 420, drag: 0.96 });
      }
      toast('METAL STORM IMPACT');
      G.meteor = null;
    }
  }

  updateParticles(dt);
  // trail ghosts for the active player fill from the live projectile
  if (G.mode === 'fly') {
    for (const pr of G.projs) {
      const arr = G.ghosts[pr.team];
      const last = arr[arr.length - 1];
      if (!last || Math.hypot(pr.x - last.x, pr.y - last.y) > 26) {
        arr.push({ x: pr.x, y: pr.y });
        if (arr.length > 90) arr.shift();
      }
    }
  }
  // dots age out visually
  for (let i = G.dots.length - 1; i >= 0; i--) {
    G.dots[i].t += dt;
    if (G.dots[i].t > 26) G.dots.splice(i, 1);
  }
}
