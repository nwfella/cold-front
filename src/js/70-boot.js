/* =========================================================================
   BOOT — canvas sizing, main loop, test hooks
   ========================================================================= */

let lastTs = 0, accumulator = 0, loopOn = true, hudClockAcc = 0;

function resize() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  VIEW.cw = cw; VIEW.ch = ch; VIEW.dpr = dpr;
  UI.canvas.width = Math.max(1, Math.round(cw * dpr));
  UI.canvas.height = Math.max(1, Math.round(ch * dpr));
  VIEW.canvasW = UI.canvas.width;
  layoutView();
  skyKey = '';
  if (!loopOn && CTX) render();
  try { checkOrientation(); } catch (e) {}
}

function frame(ts) {
  if (!loopOn) return;
  if (!lastTs) lastTs = ts;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.25) dt = 0.25;
  if (dt < 0) dt = 0;

  if (G.mode === 'title') {
    G.t += dt;
    updateCamera(dt);
    G.players[0].barrel = 38 + 20 * Math.sin(G.t * 0.55);
    G.players[1].barrel = 52 + 17 * Math.sin(G.t * 0.47 + 1.7);
    updateParticles(dt);
    if (UI.windTxt) {
      const wn = G.wind / WIND_MAX;
      UI.windFill.style.left = (wn >= 0 ? 50 : 50 + wn * 50) + '%';
      UI.windFill.style.width = Math.abs(wn) * 50 + '%';
      UI.windTxt.textContent = 'WIND ' + (Math.abs(G.wind) / 6.2).toFixed(1) + ' KN ' + (G.wind > 0.5 ? '→' : G.wind < -0.5 ? '←' : '·');
    }
  } else if (!G.paused) {
    accumulator += dt;
    let guard = 0;
    while (accumulator >= TICK && guard++ < 8) {
      updateGame(TICK);
      accumulator -= TICK;
    }
    if (settings.clock && G.mode === 'aim') {
      hudClockAcc += dt;
      if (hudClockAcc > 0.25) {
        hudClockAcc = 0;
        const left = Math.max(0, Math.ceil(G.timers.clock));
        UI.turnLabel.textContent = (G.turn === 0 ? 'VANGUARD' : (G.matchMode === 'ai' ? 'A.I.' : 'HOSTILE')) + ' · ' + left + 's';
      }
    }
  }
  render();
  requestAnimationFrame(frame);
}

function boot() {
  cacheUI();
  buildWeapons();
  bindInput();
  CTX = UI.canvas.getContext('2d', { alpha: false });
  if (!CTX) { document.title = 'JSERROR no canvas 2d context'; return; }

  // idle scene behind the title card
  const sceneSeed = (Math.random() * 1e9) | 0;
  makeSmokeSprite();
  seedRnd(sceneSeed);
  G.palette = PALETTES[0];
  genTerrain(sceneSeed);
  placeUnits();
  G.wind = rr(-1, 1) * WIND_MAX * 0.6;
  G.mode = 'title';
  G.projs = [];
  applyPalette();
  updateHud();
  showHud(false);
  syncSettingsUi();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 140));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio2.silenceWind();
    else if (settings.audio) Audio2.ensure();
  });
  window.addEventListener('pointerdown', () => Audio2.ensure(), { once: true });
  window.addEventListener('keydown', () => Audio2.ensure(), { once: true });

  window.addEventListener('error', (e) => {
    document.title = 'JSERROR ' + (e.message || 'unknown') + ' @' + (e.lineno || 0);
  });

  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- test API */
window.ART = {
  version: '1.0',
  get state() { return G; },
  get projs() { return G.projs; },
  get particles() { return particles; },
  start(mode, seed) {
    if (seed !== undefined) G.forceSeed = seed;
    startMatch(mode || 'ai');
    hideOverlays();
    showHud(true);
    return { mode: G.mode, seed: G.seed, round: G.round };
  },
  end() { G.matchOn = false; G.mode = 'title'; showHud(false); hideOverlays(); UI.titleOv.classList.add('show'); },
  aim(angle, power) { const p = activePlayer(); if (!p) return null; if (angle != null) p.angle = clamp(angle, 5, 89); if (power != null) p.power = clamp(power, 10, 100); syncControls(); return { angle: p.angle, power: p.power }; },
  weapon(i) { selectWeapon(i); return activePlayer().weapon; },
  fire() { fireFromUI(); return { mode: G.mode, projs: G.projs.length }; },
  tick(n) { const k = n || 1; for (let i = 0; i < k; i++) updateGame(TICK); return G.mode; },
  /* run until the shot resolves (mode leaves 'fly') or the budget runs out */
  settle(max) {
    let i = 0;
    const cap = max || 2400;
    while (G.mode === 'fly' && i++ < cap) updateGame(TICK);
    let j = 0;
    while (G.mode === 'resolve' && j++ < 240) updateGame(TICK);
    return { mode: G.mode, frames: i, turn: G.turn };
  },
  solve(tx, ty) {
    const me = G.players[0], foe = G.players[1];
    return solveBallistic(me, {
      x: tx === undefined ? foe.x : tx,
      y: ty === undefined ? foe.y - 16 : ty
    }, G.wind, weaponOf(me));
  },
  setWind(v) { G.wind = v; updateHud(); return G.wind; },
  setHp(i, v) { G.players[i].hp = v; updateHud(); return G.players[i].hp; },
  setTurn(i) { G.turn = i; G.mode = 'aim'; updateHud(); return G.turn; },
  terrainAt(x) { return surfaceAt(x); },
  terrainHash() {
    let h = 0;
    for (let x = 0; x <= W; x += 7) h = (h * 31 + Math.round(G.terrain[x] * 10)) | 0;
    return h;
  },
  carveTest() { const before = G.terrain[800]; carve(800, surfaceAt(800), 90); return { before, after: G.terrain[800] }; },
  snapshot() {
    return {
      mode: G.mode, round: G.round, turn: G.turn, wind: +G.wind.toFixed(2),
      hp: G.players.map((p) => Math.round(p.hp)),
      wins: G.players.map((p) => p.wins),
      alive: G.players.map((p) => p.alive),
      projs: G.projs.length, particles: particles.length,
      terrainHash: this.terrainHash(),
      seed: G.seed, palette: G.palette.id,
      aiming: +activePlayer().angle.toFixed(2) + '/' + Math.round(activePlayer().power)
    };
  },
  pause() { loopOn = false; return true; },
  resume() { if (!loopOn) { loopOn = true; lastTs = 0; requestAnimationFrame(frame); } return true; },
  render() { render(); return true; },
  tickCount: 0
};

/* count ticks for the soak gate */
const _origUpdate = updateGame;
updateGame = function (dt) { window.ART.tickCount++; return _origUpdate(dt); };

boot();
