/* =========================================================================
   UI — DOM HUD, controls, overlays, input
   ========================================================================= */
const $ = (id) => document.getElementById(id);
const UI = {};

function cacheUI() {
  ['hud', 'p0card', 'p1card', 'p0hp', 'p1hp', 'p0fill', 'p1fill', 'p0ghost', 'p1ghost',
    'p0wins', 'p1wins', 'p0stat', 'p1stat', 'p0name', 'p1name',
    'roundNum', 'turnLabel', 'windFill', 'windTxt', 'stormTxt', 'cmd', 'weapons', 'wdesc',
    'angleRange', 'powerRange', 'angleVal', 'powerVal', 'fireBtn', 'log', 'toast',
    'titleOv', 'settingsOv', 'roundOv', 'endOv', 'rotate', 'endStats', 'endTitle', 'endKicker',
    'roundTitle', 'roundKicker', 'roundSub'].forEach((k) => (UI[k] = $(k)));
  UI.canvas = $('game');
}

const WEAPON_ICONS = {
  he: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="14" r="4.4"/><path d="M12 9.6V6M9.6 6h4.8"/></svg>',
  cluster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="7.5" r="2.4"/><circle cx="6.6" cy="16.5" r="2.4"/><circle cx="17.4" cy="16.5" r="2.4"/><path d="M12 2.6v2.5" stroke-linecap="round"/></svg>',
  siege: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2.4"/></svg>',
  rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18.5L20 6"/><path d="M15.6 6H20v4.4"/></svg>',
  roller: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="16.4" cy="16" r="3.1"/><path d="M3 8.5c3.4-4.6 8.2 2.6 10.4 6.2" stroke-linecap="round"/></svg>'
};

function weaponLine(i) {
  const w = WEAPONS[i];
  const p = activePlayer();
  if (!w) return '';
  const ammo = p ? p.ammo[i] : w.ammo;
  const left = ammo === Infinity ? 'unlimited' : ammo + ' left';
  return '<b>' + w.name + '</b> · ' + w.desc + ' · ' + left;
}

function buildWeapons() {
  UI.weapons.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'wchip';
    b.style.setProperty('--wc', w.color);
    b.dataset.i = i;
    b.innerHTML = (WEAPON_ICONS[w.id] || '') +
      '<span class="wname">' + w.short + '</span>' +
      '<span class="cnt">' + (w.ammo === Infinity ? '∞' : '×' + w.ammo) + '</span>' +
      '<kbd>' + w.keys + '</kbd>';
    b.title = w.name + ' — ' + w.desc;
    b.addEventListener('click', () => selectWeapon(i));
    b.addEventListener('mouseenter', () => { if (UI.wdesc) UI.wdesc.innerHTML = weaponLine(i); });
    b.addEventListener('mouseleave', () => { if (UI.wdesc && G.players.length) UI.wdesc.innerHTML = weaponLine(activePlayer().weapon); });
    UI.weapons.appendChild(b);
  });
}

function updateHud() {
  if (!G.players.length) return;
  const [a, b] = G.players;
  for (const p of G.players) {
    const sfx = p.i === 0 ? '0' : '1';
    UI['p' + sfx + 'hp'].textContent = Math.round(p.hp);
    const pct = (p.hp / p.maxHp) * 100;
    UI['p' + sfx + 'fill'].style.width = pct + '%';
    UI['p' + sfx + 'ghost'].style.width = pct + '%';
    UI['p' + sfx + 'wins'].textContent = p.wins;
    UI['p' + sfx + 'stat'].textContent = 'HITS ' + p.hits + '/' + p.shots;
    UI['p' + sfx + 'name'].textContent = p.name;
    UI['p' + sfx + 'card'].classList.toggle('active', G.turn === p.i && G.mode === 'aim');
    UI['p' + sfx + 'card'].style.setProperty('--c', p.color);
  }
  UI.roundNum.textContent = G.round;
  const act = G.players[G.turn];
  const who = G.turn === 0 ? 'VANGUARD' : (G.matchMode === 'ai' ? 'A.I.' : 'HOSTILE');
  UI.turnLabel.textContent = (G.mode === 'fly' || G.mode === 'resolve') ? who + ' FIRING' : who + ' TURN';
  UI.turnLabel.style.color = act.color;

  const wn = G.wind / WIND_MAX;
  UI.windFill.style.left = (wn >= 0 ? 50 : 50 + wn * 50) + '%';
  UI.windFill.style.width = Math.abs(wn) * 50 + '%';
  UI.windTxt.textContent = 'WIND ' + (Math.abs(G.wind) / 6.2).toFixed(1) + ' KN ' + (G.wind > 0.5 ? '→' : G.wind < -0.5 ? '←' : '·');
  UI.windTxt.classList.toggle('warn', Math.abs(wn) > 0.65);
  UI.stormTxt.classList.toggle('on', G.turnCount >= 10);

  // weapons
  const p = act;
  [...UI.weapons.children].forEach((chip, i) => {
    const ammo = p.ammo[i];
    chip.classList.toggle('sel', p.weapon === i);
    chip.classList.toggle('out', ammo !== Infinity && ammo <= 0);
    const cnt = chip.querySelector('.cnt');
    if (cnt) cnt.textContent = ammo === Infinity ? '∞' : ammo;
  });

  if (UI.wdesc) UI.wdesc.innerHTML = weaponLine(p.weapon);
  const human = !(G.turn === 1 && G.matchMode === 'ai');
  UI.cmd.classList.toggle('off', !(G.mode === 'aim' && human));
  renderLog();
  syncControls();
}

function syncControls() {
  if (!G.players.length) return;
  const p = G.players[G.turn];
  if (!p) return;
  if (document.activeElement !== UI.angleRange) UI.angleRange.value = p.angle;
  if (document.activeElement !== UI.powerRange) UI.powerRange.value = p.power;
  UI.angleVal.textContent = p.angle.toFixed(1) + '°';
  UI.powerVal.textContent = Math.round(p.power);
  setRangeFill(UI.angleRange, (p.angle - 5) / 84);
  setRangeFill(UI.powerRange, (p.power - 10) / 90);
}
function setRangeFill(el, t) {
  if (!el) return;
  el.style.setProperty('--p', (clamp(t, 0, 1) * 100).toFixed(1) + '%');
}

function setAim(angle, power) {
  const p = activePlayer();
  if (!p) return;
  if (angle !== undefined) p.angle = clamp(angle, 5, 89);
  if (power !== undefined) p.power = clamp(power, 10, 100);
  syncControls();
}
function selectWeapon(i) {
  const p = activePlayer();
  if (!p || G.mode !== 'aim') return;
  if (p.ammo[i] !== Infinity && p.ammo[i] <= 0) { toast('OUT OF AMMUNITION'); return; }
  p.weapon = i;
  Audio2.tick();
  updateHud();
}

function renderLog() {
  if (!UI.log) return;
  UI.log.innerHTML = '';
  for (const l of G.log) {
    const d = document.createElement('div');
    if (l.cls) d.className = l.cls;
    d.textContent = l.txt;
    UI.log.appendChild(d);
  }
}

function showHud(on) { UI.hud.classList.toggle('hidden', !on); }
function hideOverlays() {
  UI.titleOv.classList.remove('show');
  UI.settingsOv.classList.remove('show');
  UI.roundOv.classList.remove('show');
  UI.endOv.classList.remove('show');
  if (typeof arsenalClose === 'function') arsenalClose();
}

function openArsenal() {
  if (typeof arsenalOpen === 'function') arsenalOpen();
  G.paused = true;
}
function closeArsenal() {
  if (typeof arsenalClose === 'function') arsenalClose();
  G.paused = false;
}

function showSettings() {
  UI.settingsOv.classList.add('show');
  syncSettingsUi();
}
function syncSettingsUi() {
  $('swAudio').classList.toggle('on', settings.audio);
  $('swTrace').classList.toggle('on', settings.trace);
  $('swClock').classList.toggle('on', settings.clock);
  [...$('segShake').children].forEach((b) => b.classList.toggle('on', +b.dataset.v === settings.shake));
  [...$('segAI').children].forEach((b) => b.classList.toggle('on', +b.dataset.v === settings.ai));
}

function showRoundOver(wIdx) {
  const p = G.players[wIdx];
  UI.roundKicker.textContent = 'Round ' + G.round + ' complete';
  UI.roundTitle.innerHTML = '<span class="c" style="color:' + p.color + '">' + p.name + '</span> takes the round';
  UI.roundSub.textContent = p.name + ' leads ' + p.wins + '–' + G.players[1 - wIdx].wins + '. New terrain, new palette, fresh ammo.';
  UI.roundOv.classList.add('show');
  updateHud();
}

function showEnd(wIdx) {
  const p = G.players[wIdx];
  const acc = G.stats.shots ? Math.round((G.stats.hits / G.stats.shots) * 100) : 0;
  const secs = Math.round(now() - G.matchStart);
  UI.endKicker.textContent = 'Match complete — ' + G.players[0].wins + ':' + G.players[1].wins;
  UI.endTitle.innerHTML = '<span style="color:' + p.color + '">' + p.name + '</span> wins the front';
  const rows = [
    ['Rounds', p.wins + ' <small>of 3</small>'],
    ['Shots fired', G.stats.shots],
    ['Direct hits', G.stats.hits + ' <small>(' + acc + '%)</small>'],
    ['Damage dealt', G.stats.dmg],
    ['Best single hit', G.stats.best],
    ['Longest shot', Math.round(G.stats.longest) + ' <small>m</small>'],
    ['Match time', Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')],
    ['Terrain', G.palette.name]
  ];
  UI.endStats.innerHTML = rows.map((r) => '<div class="stat"><div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div></div>').join('');
  UI.endOv.classList.add('show');
  hideRoundOverlay();
}
function hideRoundOverlay() { UI.roundOv.classList.remove('show'); }

/* ---------------------------------------------------------------- input */
let dragging = false;

function bindInput() {
  const cv = UI.canvas;

  cv.addEventListener('pointerdown', (e) => {
    Audio2.ensure();
    if (!G.matchOn || G.mode !== 'aim') return;
    if (G.turn === 1 && G.matchMode === 'ai') return;
    cv.setPointerCapture(e.pointerId);
    dragging = true;
    aimAtPointer(e);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    aimAtPointer(e);
  });
  const stop = (e) => { dragging = false; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  window.addEventListener('keydown', (e) => {
    Audio2.ensure();
    if (e.key === 'Escape') {
      const ars = document.getElementById('arsenalOv');
      if (ars && ars.classList.contains('show')) { closeArsenal(); return; }
      if (UI.settingsOv.classList.contains('show')) { UI.settingsOv.classList.remove('show'); return; }
      if (G.matchOn) { showSettings(); return; }
    }
    if (e.key === 'm' || e.key === 'M' || e.key === '?') {
      e.preventDefault();
      openArsenal();
      return;
    }
    if (!G.matchOn || G.mode !== 'aim') return;
    if (G.turn === 1 && G.matchMode === 'ai') return;
    const p = activePlayer();
    const step = e.shiftKey ? 5 : 1;
    switch (e.key) {
      case 'ArrowUp': p.angle = clamp(p.angle + (e.shiftKey ? 0.5 : 1), 5, 89); break;
      case 'ArrowDown': p.angle = clamp(p.angle - (e.shiftKey ? 0.5 : 1), 5, 89); break;
      case 'ArrowRight': p.power = clamp(p.power + step, 10, 100); break;
      case 'ArrowLeft': p.power = clamp(p.power - step, 10, 100); break;
      case ' ': case 'Enter': fireFromUI(); e.preventDefault(); return;
      case '1': case '2': case '3': case '4': case '5': selectWeapon(+e.key - 1); break;
      default: return;
    }
    e.preventDefault();
    syncControls();
  });

  UI.angleRange.addEventListener('input', () => {
    setAim(parseFloat(UI.angleRange.value), undefined);
  });
  UI.powerRange.addEventListener('input', () => {
    setAim(undefined, parseFloat(UI.powerRange.value));
  });
  UI.fireBtn.addEventListener('click', () => { Audio2.ensure(); fireFromUI(); });

  // buttons
  $('btnAI').addEventListener('click', () => { hideOverlays(); startMatch('ai'); });
  $('btn2P').addEventListener('click', () => { hideOverlays(); startMatch('2p'); });
  $('btnSet').addEventListener('click', showSettings);
  $('btnArsenal').addEventListener('click', openArsenal);
  $('btnArsenal2').addEventListener('click', () => {
    UI.settingsOv.classList.remove('show');
    openArsenal();
  });
  $('btnCloseArsenal').addEventListener('click', closeArsenal);
  $('btnCloseSet').addEventListener('click', () => {
    UI.settingsOv.classList.remove('show');
    if (!G.matchOn) UI.titleOv.classList.add('show');
  });
  $('btnQuit').addEventListener('click', () => {
    G.matchOn = false; G.mode = 'title';
    hideOverlays(); showHud(false);
    UI.titleOv.classList.add('show');
    document.querySelectorAll('.ov').forEach((o) => o.classList.remove('show'));
    UI.titleOv.classList.add('show');
  });
  $('btnNextRound').addEventListener('click', () => {
    hideRoundOverlay();
    G.round++;
    newRound(true);
  });
  $('btnReplay').addEventListener('click', () => {
    const mode = G.matchMode || 'ai';
    hideOverlays();
    startMatch(mode);
  });
  $('btnMenu').addEventListener('click', () => {
    G.matchOn = false;
    hideOverlays(); showHud(false);
    UI.titleOv.classList.add('show');
  });
  $('btnShare').addEventListener('click', () => {
    const p = G.players[G.winner] || G.players[0];
    const txt = 'COLD FRONT — ' + p.name + ' wins ' + G.players[0].wins + ':' + G.players[1].wins +
      ' · ' + G.stats.hits + '/' + G.stats.shots + ' hits · ' + G.stats.dmg + ' dmg · longest ' + Math.round(G.stats.longest) + 'm';
    try {
      navigator.clipboard.writeText(txt);
      toast('RESULT COPIED');
    } catch (err) { toast('COPY BLOCKED'); }
  });

  // settings controls
  $('swAudio').addEventListener('click', (e) => {
    settings.audio = !settings.audio;
    e.currentTarget.classList.toggle('on', settings.audio);
    Audio2.ensure();
    Audio2.setMuted(!settings.audio);
    saveSettings();
  });
  $('swTrace').addEventListener('click', (e) => {
    settings.trace = !settings.trace;
    e.currentTarget.classList.toggle('on', settings.trace);
    saveSettings();
  });
  $('swClock').addEventListener('click', (e) => {
    settings.clock = !settings.clock;
    e.currentTarget.classList.toggle('on', settings.clock);
    saveSettings();
  });
  $('segShake').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    settings.shake = +b.dataset.v;
    [...$('segShake').children].forEach((x) => x.classList.toggle('on', x === b));
    saveSettings();
  });
  $('segAI').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    settings.ai = +b.dataset.v;
    [...$('segAI').children].forEach((x) => x.classList.toggle('on', x === b));
    saveSettings();
    if (G.matchOn && G.players[1]) {
      G.players[1].name = 'A.I. ' + AI_LEVELS[settings.ai].name;
      updateHud();
    }
  });
}

function aimAtPointer(e) {
  const r = UI.canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const w = screenToWorld(sx, sy);
  const p = activePlayer();
  if (!p) return;
  const dir = facingOf(p);
  const pivX = p.x + PIVOT_DX * dir, pivY = p.y - PIVOT_DY;
  // aim is always toward the enemy; the pointer sets elevation + charge
  const a = clamp(Math.atan2(pivY - w.y, Math.abs(w.x - pivX)) / DEG, 5, 89);
  const d = Math.hypot(w.x - pivX, w.y - pivY);
  const pw = clamp((d / 560) * 100, 10, 100);
  setAim(a, pw);
}

function fireFromUI() {
  if (!G.matchOn || G.mode !== 'aim') return;
  if (G.turn === 1 && G.matchMode === 'ai') return;
  const p = activePlayer();
  fireShot(p.angle, p.power, p.weapon);
}

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth * 1.05;
  const narrow = window.innerWidth < 720;
  UI.rotate.classList.toggle('show', portrait && narrow && !sessionStorage.getItem('cf.rotated'));
  if (portrait && narrow) {
    const dismiss = () => {
      sessionStorage.setItem('cf.rotated', '1');
      UI.rotate.classList.remove('show');
    };
    UI.rotate.onclick = dismiss;
    setTimeout(() => { if (UI.rotate.classList.contains('show')) dismiss(); }, 4200);
  }
}
