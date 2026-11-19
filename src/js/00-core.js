/* =========================================================================
   COLD FRONT — modern artillery duel
   Zero dependencies. Single canvas, DOM HUD, WebAudio synth.
   ========================================================================= */

const W = 1600;            // world width  (logical field units)
const H = 900;             // world height
const GRAV = 520;          // world px / s²
const WIND_MAX = 62;       // world px / s² at full gust
const TICK = 1 / 60;       // fixed logic step
const METEOR_FLOOR = 25;   // metal storm can maul you down to here, never past it
const DEG = Math.PI / 180;
const DPR_MAX = 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const now = () => performance.now() / 1000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let RND = Math.random;
function seedRnd(seed) { const f = mulberry32(seed >>> 0); RND = f; }
const rnd = () => RND();
const rr = (a, b) => a + RND() * (b - a);
const rpick = (arr) => arr[(RND() * arr.length) | 0];

/* value noise (deterministic per seed, used for terrain + backdrop) */
let NOISE_SEED = 1;
function h1(n) {
  const s = Math.sin(n * 127.1 + NOISE_SEED * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h1(i) * (1 - u) + h1(i + 1) * u;
}
function fbm(x, oct) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { v += vnoise(x * f) * amp; norm += amp; f *= 2.03; amp *= 0.5; }
  return v / norm;
}

/* ---------------------------------------------------------------- palettes */
const PALETTES = [
  {
    id: 'dusk', name: 'DUSK',
    sky: ['#05060f', '#151129', '#3d2447', '#8a4351', '#c9704a'],
    sun: { x: 0.74, y: 0.70, r: 66, core: '#ffcf8a', glow: 'rgba(255,140,80,.32)' },
    mtn: ['#100d1f', '#191330', '#241a3d'],
    terr: ['#5a3f55', '#2a1c30', '#140e19'],
    rim: '#ffa56a', accent: '#ffb347', fog: 'rgba(255,150,110,.09)',
    cloud: 'rgba(255,178,158,.26)', stars: 0.55, grain: 0.16
  },
  {
    id: 'night', name: 'NIGHT OPS',
    sky: ['#02040a', '#050b18', '#0a1526', '#122238', '#1b3350'],
    sun: { x: 0.28, y: 0.30, r: 42, core: '#dff0ff', glow: 'rgba(150,200,255,.24)' },
    mtn: ['#070c16', '#0a1220', '#0e1a2b'],
    terr: ['#233347', '#101a28', '#070d16'],
    rim: '#7fd4ff', accent: '#6ee7ff', fog: 'rgba(110,180,255,.08)',
    cloud: 'rgba(150,190,255,.22)', stars: 1, grain: 0.13
  },
  {
    id: 'dawn', name: 'COLD DAWN',
    sky: ['#0a0f1c', '#1d2438', '#4a4059', '#a4716a', '#e0a06e'],
    sun: { x: 0.2, y: 0.74, r: 54, core: '#ffe4b0', glow: 'rgba(255,200,140,.26)' },
    mtn: ['#141a28', '#1c2436', '#28324a'],
    terr: ['#4b5566', '#242c3a', '#12161f'],
    rim: '#ffd0a0', accent: '#ffc27a', fog: 'rgba(255,210,170,.10)',
    cloud: 'rgba(255,224,206,.24)', stars: 0.25, grain: 0.15
  },
  {
    id: 'storm', name: 'SQUALL',
    sky: ['#080a0e', '#12161c', '#1e242e', '#2f3944', '#45525f'],
    sun: { x: 0.55, y: 0.34, r: 34, core: '#c9d8e6', glow: 'rgba(180,210,240,.16)' },
    mtn: ['#0b0e13', '#121720', '#1a212b'],
    terr: ['#39424d', '#1b2029', '#0b0e13'],
    rim: '#a8d8ff', accent: '#9fd0ff', fog: 'rgba(170,200,230,.12)',
    cloud: 'rgba(196,214,238,.3)', stars: 0.1, grain: 0.2
  },
  {
    id: 'toxic', name: 'TOXIC FRONT',
    sky: ['#03080a', '#08161a', '#0f2a24', '#1e4432', '#4d6b3a'],
    sun: { x: 0.62, y: 0.66, r: 48, core: '#d8ffa8', glow: 'rgba(150,255,120,.20)' },
    mtn: ['#071210', '#0b1a17', '#112520'],
    terr: ['#2f4133', '#16211a', '#080d0a'],
    rim: '#a6ff6e', accent: '#b6ff7a', fog: 'rgba(150,255,140,.10)',
    cloud: 'rgba(184,255,186,.22)', stars: 0.4, grain: 0.18
  }
];

/* ---------------------------------------------------------------- weapons */
const WEAPONS = [
  {
    id: 'he', name: 'HE SHELL', short: 'HE', keys: '1',
    ammo: Infinity, r: 78, dmg: 44, spd: 1.0, color: '#ffcf6b',
    desc: 'Balanced high-explosive.'
  },
  {
    id: 'cluster', name: 'CLUSTER', short: 'CLU', keys: '2',
    ammo: 3, r: 56, dmg: 26, spd: 1.02, color: '#7ef2c8', split: 3,
    desc: 'Splits into three bomblets at apex.'
  },
  {
    id: 'siege', name: 'SIEGE', short: 'SGE', keys: '3',
    ammo: 2, r: 122, dmg: 74, spd: 0.84, color: '#ff7a5a',
    desc: 'Slow, enormous blast. Reshapes terrain.'
  },
  {
    id: 'rail', name: 'RAILGUN', short: 'RAI', keys: '4',
    ammo: 1, r: 46, dmg: 58, spd: 1.85, color: '#8fb8ff', flat: true,
    desc: 'Flat trajectory — no gravity, no wind.'
  },
  {
    id: 'roller', name: 'ROLLER', short: 'ROL', keys: '5',
    ammo: 2, r: 86, dmg: 50, spd: 0.96, color: '#e0a6ff', roll: true,
    desc: 'Bounces off terrain and rolls into the target.'
  }
];

/* ---------------------------------------------------------------- settings */
const SETTINGS_KEY = 'coldfront.settings.v1';
const settings = {
  audio: true,
  shake: 1,          // 0 off, 1 normal, 2 heavy
  trace: true,
  clock: false,
  ai: 1
};
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) Object.assign(settings, JSON.parse(raw));
} catch (e) { /* private mode */ }
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

/* ---------------------------------------------------------------- state */
const G = {
  mode: 'title',           // title | aim | fly | resolve | roundover | matchover
  matchOn: false,
  round: 1,
  turn: 0,
  turnCount: 0,
  players: [],
  wind: 0,
  seed: 1,
  palette: PALETTES[0],
  terrain: null,           // Float32Array(W+1) surface y per column
  scorch: null,            // Float32Array(W+1) 0..1
  crater: [],              // {x,y,r} for render decals
  projs: [],               // live projectiles
  mtn: [], stars: [], clouds: [],
  meteor: null,
  roundSeed: 0,
  forceSeed: null,
  matchMode: 'ai',
  aiErr: 1,
  aiTimer: 0,
  paused: false,
  particles: [],
  rings: [],
  texts: [],
  dots: [],                // past impact markers
  ghosts: [[], []],        // last trajectory per player
  cam: { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, shake: 0, flash: 0 },
  timers: { resolve: 0, round: 0, clock: 0 },
  aiPlan: null,
  storm: 0,
  winner: -1,
  log: [],
  lastResult: '',
  t: 0,
  paused: false,
  matchStart: 0,
  stats: { shots: 0, hits: 0, dmg: 0, longest: 0, best: 0 }
};

function makePlayer(i) {
  return {
    i,
    name: i === 0 ? 'VANGUARD' : 'HOSTILE',
    color: i === 0 ? '#4ea8ff' : '#ff5d7e',
    x: 0, y: 0, hp: 100, maxHp: 100, wins: 0,
    angle: i === 0 ? 45 : 45,
    power: 62,
    weapon: 0,
    ammo: [],
    alive: true,
    recoil: 0,
    flash: 0,
    shake: 0,
    drop: 0,        // vertical velocity when ground vanishes
    fall: 0,        // accumulated fall height this frame
    shots: 0, hits: 0, dmg: 0, longest: 0,
    lastAngle: 45, lastPower: 62,
    barrel: 0       // visual barrel angle (eased)
  };
}

function resetAmmo(p) {
  p.ammo = WEAPONS.map((w) => (w.ammo === Infinity ? Infinity : w.ammo));
  p.weapon = 0;
}

/* helpers */
const activePlayer = () => G.players[G.turn];
const enemyOf = (i) => G.players[1 - i];
const weaponOf = (p) => WEAPONS[p.weapon] || WEAPONS[0];
const muzzleSpeed = (power) => 190 + power * 7.2;

/* unit art scale — keep the barrel/muzzle maths in one place */
const TANK_S = 1.22;
const BARREL_LEN = 46 * TANK_S;
const PIVOT_DX = 6 * TANK_S;
const PIVOT_DY = 34 * TANK_S;

function facingOf(p) { return p && p.i === 1 ? -1 : 1; }

function tagOf(p) {
  if (!p) return 'GROUND';
  return p.i === 0 ? 'VAN' : (G.matchMode === 'ai' ? 'A.I.' : 'HOS');
}

function pushLog(txt, cls) {
  G.log.push({ txt, cls: cls || '' });
  if (G.log.length > 4) G.log.shift();
  renderLog();
}
function toast(msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms || 1700);
}
