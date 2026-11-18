/* =========================================================================
   WORLD — terrain generation, destruction, camera, view transform
   ========================================================================= */

const VIEW = { cw: 0, ch: 0, dpr: 1, scale: 1, ox: 0, oy: 0, A: { x: 0, y: 0 } };

function layoutView() {
  const cw = VIEW.cw, ch = VIEW.ch;
  // fit by width; keep at least 620 world-units of height visible
  const s = Math.min(cw / W, ch / 620);
  VIEW.scale = s;
  VIEW.ox = (cw - W * s) / 2;
  VIEW.oy = ch;
  VIEW.A.x = VIEW.ox + (W * s) / 2;
  VIEW.A.y = ch;
}

function screenToWorld(sx, sy) {
  const s = VIEW.scale * G.cam.z;
  return {
    x: (sx - VIEW.A.x) / s + W / 2 - G.cam.x,
    y: (sy - VIEW.A.y) / s + H - G.cam.y
  };
}
function worldToScreen(wx, wy) {
  const s = VIEW.scale * G.cam.z;
  return {
    x: VIEW.A.x + (wx - W / 2 + G.cam.x) * s,
    y: VIEW.A.y + (wy - H + G.cam.y) * s
  };
}

function surfaceAt(x) {
  return G.terrain[clamp(Math.round(x), 0, W)];
}

/* ---------------------------------------------------------------- terrain */
function genTerrain(seed) {
  NOISE_SEED = (seed % 9973) + 1;
  const t = new Float32Array(W + 1);
  const ridgeOn = rnd() < 0.6;
  const ridgeX = rr(0.4, 0.6) * W;
  const ridgeAmp = ridgeOn ? rr(70, 190) : 0;
  const ridgeW = rr(170, 330);
  const base = rr(665, 735);
  const amp1 = rr(105, 168);
  const amp2 = rr(30, 64);
  const freq = rr(0.0021, 0.0034);

  for (let x = 0; x <= W; x++) {
    const n = fbm(x * freq + 13.7, 5);
    const n2 = fbm(x * freq * 3.3 + 71.1, 3);
    let y = base - n * amp1 - n2 * amp2;
    if (ridgeAmp) y -= ridgeAmp * Math.exp(-Math.pow((x - ridgeX) / ridgeW, 2));
    t[x] = clamp(y, 300, H - 34);
  }
  // light smoothing
  const sm = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++) {
    const a = t[Math.max(0, x - 1)], b = t[x], c = t[Math.min(W, x + 1)];
    sm[x] = (a + 2 * b + c) / 4;
  }
  G.terrain = sm;
  G.scorch = new Float32Array(W + 1);
  G.crater = [];
  G.dots = [];
  G.ghosts = [[], []];

  // backdrop ridges (drawn behind the field, parallaxed)
  G.mtn = [];
  for (let L = 0; L < 3; L++) {
    const step = 22;
    const arr = [];
    const yBase = 452 + L * 128;
    const amp = 205 - L * 52;
    const fq = 0.0015 + L * 0.0012;
    for (let x = -700; x <= W + 700; x += step) {
      const n = fbm(x * fq + 31.4 * (L + 1), 5);
      const ridged = 1 - Math.abs(n * 2 - 1);          // sharp alpine crests
      arr.push(yBase - (n * 0.45 + ridged * 0.75) * amp);
    }
    G.mtn.push(arr);
  }
  // stars
  G.stars = [];
  for (let i = 0; i < 150; i++) {
    G.stars.push({ x: rnd(), y: rnd() * 0.72, r: rr(0.5, 1.7), p: rr(0, 6.28), s: rr(0.4, 2) });
  }
  // clouds
  G.clouds = [];
  for (let i = 0; i < 11; i++) {
    G.clouds.push({ x: rr(-200, W + 200), y: rr(60, 400), w: rr(220, 620), h: rr(30, 88), a: rr(0.5, 1), v: rr(2, 9) });
  }
}

function flattenPad(cx, half) {
  const i0 = clamp(Math.round(cx - half), 0, W);
  const i1 = clamp(Math.round(cx + half), 0, W);
  let sum = 0, n = 0;
  for (let i = i0; i <= i1; i++) { sum += G.terrain[i]; n++; }
  const avg = sum / n;
  for (let i = i0; i <= i1; i++) {
    const k = 1 - Math.abs(i - cx) / (half * 1.4);
    G.terrain[i] = lerp(G.terrain[i], avg, clamp(k, 0, 1) * 0.9);
  }
}

function placeUnits() {
  const p1x = rr(150, 265), p2x = rr(W - 265, W - 150);
  flattenPad(p1x, 62);
  flattenPad(p2x, 62);
  if (!G.players.length) G.players = [makePlayer(0), makePlayer(1)];
  G.players[0].x = p1x;
  G.players[1].x = p2x;
  for (const p of G.players) {
    p.y = surfaceAt(p.x);
    p.hp = p.maxHp;
    p.alive = true;
    p.drop = 0;
    p.fallStart = undefined;
    p.flash = 0;
    p.shake = 0;
    p.recoil = 0;
    p.shots = 0;
    p.hits = 0;
    p.dmg = 0;
    p.longest = 0;
    p.angle = 45;
    p.power = 62;
    p.barrel = 45;
    resetAmmo(p);
    p.lastAngle = p.angle;
    p.lastPower = p.power;
  }
}

/* circular bite out of the heightmap */
function carve(cx, cy, r) {
  const i0 = Math.max(0, Math.floor(cx - r));
  const i1 = Math.min(W, Math.ceil(cx + r));
  let any = false;
  for (let i = i0; i <= i1; i++) {
    const dx = i - cx;
    const half = Math.sqrt(Math.max(0, r * r - dx * dx));
    const bottom = cy + half;
    if (bottom > G.terrain[i] && cy < G.terrain[i] + 6) {
      G.terrain[i] = Math.min(H + 60, bottom);
      any = true;
    }
    const f = 1 - Math.abs(dx) / (r * 1.6);
    if (f > 0) G.scorch[i] = clamp(G.scorch[i] + f * 0.85, 0, 1);
  }
  if (any) {
    // soften the bite edges so the rim reads as rubble, not a saw cut
    for (let pass = 0; pass < 2; pass++) {
      for (let i = Math.max(1, i0); i < Math.min(W, i1); i++) {
        const a = G.terrain[i - 1], b = G.terrain[i], c = G.terrain[i + 1];
        G.terrain[i] = (a + b * 2 + c) / 4;
      }
    }
  }
  G.crater.push({ x: cx, y: cy, r });
  if (G.crater.length > 26) G.crater.shift();
  return any;
}

/* units follow the ground; falling causes damage */
function settleUnits(dt) {
  for (const p of G.players) {
    if (!p.alive) continue;
    const g = surfaceAt(p.x);
    if (p.y < g - 1) {
      if (p.drop === 0) p.fallStart = p.y;
      p.drop += 1700 * dt;
      p.y = Math.min(g, p.y + p.drop * dt);
      if (p.y >= g - 0.5) {
        const fell = g - (p.fallStart === undefined ? g : p.fallStart);
        p.drop = 0;
        if (fell > 80) {
          const dmg = Math.round((fell - 80) * 0.22);
          if (dmg > 0) {
            damageUnit(p, dmg, 'TERRAIN COLLAPSE');
            spawnDebris(p.x, g, 14, '#6b5a4a');
          }
        }
        p.fallStart = undefined;
      }
    } else if (p.y > g + 1) {
      p.y = g; p.drop = 0;
    } else {
      p.y = g; p.drop = 0;
    }
  }
}

/* ---------------------------------------------------------------- camera */
function camTo(x, y, z, snap) {
  G.cam.tx = x; G.cam.ty = y; G.cam.tz = z;
  if (snap) { G.cam.x = x; G.cam.y = y; G.cam.z = z; }
}
function updateCamera(dt) {
  const c = G.cam;
  const k = 1 - Math.pow(0.0016, dt);
  c.x = lerp(c.x, c.tx, k);
  c.y = lerp(c.y, c.ty, k);
  c.z = lerp(c.z, c.tz, k);
  c.shake *= Math.pow(0.0025, dt);
  if (c.shake < 0.02) c.shake = 0;
  c.flash *= Math.pow(0.0009, dt);
  if (c.flash < 0.004) c.flash = 0;
}
function addShake(amount) {
  const m = settings.shake === 0 ? 0 : settings.shake === 2 ? 1.8 : 1;
  G.cam.shake = Math.min(46, G.cam.shake + amount * m);
}
function followProjectile() {
  const p = G.proj;
  if (!p) return;
  const z = 0.9;
  const visW = VIEW.cw / (VIEW.scale * z);
  const visH = VIEW.ch / (VIEW.scale * z);
  const slackX = Math.max(0, (W - visW) / 2);
  const slackY = Math.max(0, H - visH);
  const tx = clamp((p.x - W / 2) * 1.0, -slackX * 0.92, slackX * 0.92);
  // (kept deliberately gentle: a hard cut on the follow reads as a camera glitch)
  const ty = clamp((p.y - H) * 0.55, -slackY, 0);
  camTo(tx, ty, z);
}
