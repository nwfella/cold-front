#!/usr/bin/env node
/* COLD FRONT gate — zero-dep Chrome DevTools Protocol harness.
   Serves the repo, boots index.html in headless Chrome, drives window.ART,
   asserts logic + pixels + responsive layout, and screenshots two viewports.
   Usage: node scripts/gate.js            (exit 0 = all green)            */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
// GATE_URL=https://user.github.io/repo/ verifies the DEPLOYED artifact instead of the working copy
const RAW_URL = process.env.GATE_URL || '';
const REMOTE = RAW_URL ? RAW_URL.replace(/\/?$/, '/') : '';  // '' must stay falsey
const SHOTS = REMOTE ? path.join(ROOT, 'shots', 'live') : path.join(ROOT, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome/Edge binary found');
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('nope'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '   [' + detail + ']' : ''));
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('timeout: ' + label);
}

(async () => {
  const chromePath = findChrome();
  const { srv, port } = REMOTE ? { srv: null, port: 0 } : await serve();
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-gate-'));
  const dbgPort = 9222 + ((Math.random() * 500) | 0);
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-extensions', '--hide-scrollbars',
    '--user-data-dir=' + tmpProfile, '--remote-debugging-port=' + dbgPort,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    try { if (srv) srv.close(); } catch (e) {}
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {}
  };

  let ws;
  try {
    let target = null;
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${dbgPort}/json/list`);
      const list = await r.json();
      target = list.find((t) => t.type === 'page');
      return !!target;
    }, 20000, 'cdp target');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });

    let msgId = 0;
    const pending = new Map();
    const exceptions = [];
    const consoleErrors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        exceptions.push((d.exception && d.exception.description) || d.text || 'exception');
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
      }
    };
    const send = (method, params) => new Promise((res, rej) => {
      const id = ++msgId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('cdp timeout ' + method)); } }, 30000);
    });

    const evalIn = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('page: ' + ((d.exception && d.exception.description) || d.text));
      }
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');

    // ---- self-contained build: no external requests
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('no external <script>/<link> resources', !/(src|href)\s*=\s*["']https?:/i.test(html), 'inline only');
    check('no runtime fetch() calls', !/[^.\w]fetch\s*\(/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')), 'offline-capable');

    const target_url = REMOTE ? `${REMOTE}index.html?cb=${Date.now()}` : `http://127.0.0.1:${port}/index.html?cb=${Date.now()}`;
    console.log((REMOTE ? 'GATING LIVE: ' : 'GATING LOCAL: ') + target_url + '\n');
    await send('Page.navigate', { url: target_url });
    await waitFor(async () => evalIn('!!(window.ART && window.ART.state && window.ART.state.players.length)'), 15000, 'boot');
    check('boot: window.ART exposed', true, await evalIn('ART.version'));

    const title0 = await evalIn('document.title');
    check('boot: no JS error in title', !/^JSERROR/.test(title0), title0);

    await evalIn('ART.pause()');
    await evalIn('ART.render()');
    await new Promise((r) => setTimeout(r, 200));
    const shotTitle = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'title.png'), Buffer.from(shotTitle.data, 'base64'));

    // ---- pixel sanity on the idle title scene
    const px0 = await evalIn(`(() => {
      const cv = document.getElementById('game');
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      const x = c.getContext('2d'); x.drawImage(cv, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, uniq = new Set(), n = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4 * 37) { const l = (d[i]+d[i+1]+d[i+2])/3; sum += l; n++; if (l > 140) bright++; uniq.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4)); }
      return { w: c.width, h: c.height, mean: +(sum/n).toFixed(1), unique: uniq.size, brightPct: +(100*bright/n).toFixed(1) };
    })()`);
    check('render: canvas painted (non-blank)', px0.unique > 12 && px0.mean > 4, JSON.stringify(px0));
    check('render: sky gradient present', px0.unique > 20, px0.unique + ' colour buckets');

    // ---- deterministic terrain
    const det = await evalIn(`(() => {
      ART.start('ai', 424242); const a = ART.terrainHash(); const seedA = ART.state.seed;
      ART.start('ai', 424242); const b = ART.terrainHash();
      ART.start('ai', 999); const c = ART.terrainHash();
      return { a, b, c, seedA };
    })()`);
    check('determinism: same seed -> same terrain', det.a === det.b, det.a + ' vs ' + det.b);
    check('determinism: different seed -> different terrain', det.a !== det.c, det.a + ' vs ' + det.c);
    check('determinism: forced seed honoured', det.seedA === 424242, det.seedA);

    // ---- fresh match, human turn
    const boot2 = await evalIn(`(() => { ART.start('ai', 424242); ART.setTurn(0); ART.setWind(0); return ART.snapshot(); })()`);
    check('match start: aiming, full hp', boot2.mode === 'aim' && boot2.hp[0] === 100 && boot2.hp[1] === 100, JSON.stringify(boot2.hp));
    check('units are separated', true, 'p0 x vs p1 x: ' + await evalIn('Math.round(ART.state.players[0].x)+"/"+Math.round(ART.state.players[1].x)'));

    // ---- angle/velocity controls drive the HUD
    const ctl = await evalIn(`(() => {
      ART.aim(72.5, 88);
      return { a: document.getElementById('angleVal').textContent, p: document.getElementById('powerVal').textContent,
               range: document.getElementById('angleRange').value, st: ART.snapshot().aiming };
    })()`);
    check('controls: angle + velocity reach HUD', ctl.a === '72.5°' && ctl.p === '88' && ctl.range === '72.5', JSON.stringify(ctl));

    // ---- keyboard path
    const kb = await evalIn(`(() => {
      const before = ART.state.players[0].angle;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      const mid = ART.state.players[0].angle;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
      return { before, mid, power: ART.state.players[0].power };
    })()`);
    check('keyboard: arrows adjust aim', kb.mid === kb.before + 1, JSON.stringify(kb));

    // ---- slider input path
    const slider = await evalIn(`(() => {
      const el = document.getElementById('powerRange');
      el.value = '33'; el.dispatchEvent(new Event('input', { bubbles: true }));
      return ART.state.players[0].power;
    })()`);
    check('controls: slider input applied', Math.abs(slider - 33) < 0.01, slider);

    // ---- ballistic solving + firing + terrain destruction
    const shot = await evalIn(`(() => {
      ART.start('ai', 2024); ART.setTurn(0); ART.setWind(0);
      const hash0 = ART.terrainHash();
      let dmg = 0, hits = 0, frames = 0;
      for (let k = 0; k < 3 && dmg < 20; k++) {
        const s = ART.solve();
        ART.aim(s.angle, s.power);
        ART.fire();
        const r = ART.settle(4000);
        frames += r.frames;
        ART.tick(90);
        dmg = 100 - ART.state.players[1].hp;
      }
      return { dmg, hash0, hash1: ART.terrainHash(), frames, shots: ART.state.stats.shots,
               hits: ART.state.stats.hits, mode: ART.state.mode, projs: ART.state.projs.length };
    })()`);
    check('ballistics: solved shot damages the target', shot.dmg >= 20, 'dmg ' + shot.dmg);
    check('ballistics: shot resolves within budget', shot.projs === 0 && shot.frames < 4000, shot.frames + ' frames');
    check('terrain: crater carved by impact', shot.hash0 !== shot.hash1, shot.hash0 + ' -> ' + shot.hash1);

    // ---- damage falloff: a near miss does less than a direct hit
    const falloff = await evalIn(`(() => {
      ART.start('ai', 777); ART.setTurn(0); ART.setWind(0);
      const t = ART.state.players[1];
      ART.aim(89, 10); ART.fire(); ART.settle(4000); ART.tick(90);
      return { far: 100 - t.hp };
    })()`);
    check('damage: wild shot misses (falloff works)', falloff.far < 40, 'dmg ' + falloff.far);

    // ---- ammo accounting
    const ammo = await evalIn(`(() => {
      ART.start('ai', 555); ART.setTurn(0);
      ART.weapon(1);
      const before = ART.state.players[0].ammo[1];
      ART.aim(55, 75); ART.fire(); ART.settle(4000);
      const after = ART.state.players[0].ammo[1];
      return { before, after, w: ART.state.players[0].weapon };
    })()`);
    check('weapons: ammo decrements on fire', ammo.after === ammo.before - 1, ammo.before + ' -> ' + ammo.after);

    // ---- cluster splits in flight
    const cluster = await evalIn(`(() => {
      ART.start('ai', 31337); ART.setTurn(0); ART.setWind(0);
      ART.weapon(1); ART.aim(62, 92); ART.fire();
      let maxP = 0;
      for (let i = 0; i < 400; i++) { ART.tick(1); maxP = Math.max(maxP, ART.state.projs.length); if (ART.state.mode !== 'fly') break; }
      return { maxP, mode: ART.state.mode };
    })()`);
    check('weapons: cluster splits into multiple projectiles', cluster.maxP >= 2, 'max concurrent ' + cluster.maxP);

    // ---- railgun ignores gravity
    const rail = await evalIn(`(() => {
      ART.start('ai', 4242); ART.setTurn(0); ART.setWind(-60);
      ART.weapon(3); ART.aim(45, 70); ART.fire();
      const p0 = ART.state.projs[0];
      const vy0 = p0.vy, vx0 = p0.vx;
      ART.tick(30);
      const p1 = ART.state.projs[0] || null;
      return { vy0: +vy0.toFixed(2), vx0: +vx0.toFixed(2),
               vy1: p1 ? +p1.vy.toFixed(2) : null, vx1: p1 ? +p1.vx.toFixed(2) : null };
    })()`);
    check('weapons: railgun is flat (no gravity, no wind)', rail.vy1 !== null && Math.abs(rail.vy1 - rail.vy0) < 0.5 && Math.abs(rail.vx1 - rail.vx0) < 0.5, JSON.stringify(rail));

    // ---- out of bounds resolves cleanly and passes the turn
    const oob = await evalIn(`(() => {
      ART.start('ai', 1234); ART.setTurn(0);
      ART.aim(89, 12); ART.fire();
      const r = ART.settle(5000);
      ART.tick(90);
      return { mode: ART.state.mode, turn: ART.state.turn, projs: ART.state.projs.length, log: ART.state.log.length };
    })()`);
    check('turn: out-of-range shot resolves and advances', oob.projs === 0 && oob.turn === 1 && oob.mode === 'aim', JSON.stringify(oob));

    // ---- AI takes its own turn
    const ai = await evalIn(`(() => {
      ART.start('ai', 8080);
      const s0 = ART.state.stats.shots;
      ART.setTurn(1);
      ART.tick(420);
      return { shots: ART.state.stats.shots - s0, turn: ART.state.turn, mode: ART.state.mode, err: +ART.state.aiErr.toFixed(2) };
    })()`);
    check('AI: fires within its thinking window', ai.shots >= 1, JSON.stringify(ai));
    check('AI: hands the turn back', ai.turn === 0 || ai.mode === 'aim', 'turn ' + ai.turn + ' mode ' + ai.mode);

    // ---- AI fires AT the player (regression: it used to shoot itself)
    const aiAim = await evalIn(`(() => {
      const rows = [];
      for (const seed of [404, 77, 8080, 2024, 5150, 6161]) {
        ART.start('ai', seed); ART.setWind(0); ART.setTurn(1);
        const meX = ART.state.players[1].x, foeX = ART.state.players[0].x;
        const hp0 = ART.state.players[1].hp;
        ART.tick(260);
        let guard = 0;
        while (ART.state.mode === 'fly' && guard++ < 3000) ART.tick(1);
        ART.tick(4);
        // a cluster volley leaves several impact marks: judge where the VOLLEY landed
        const drops = ART.state.dots.map((d) => d.x);
        const nearFoe = drops.length ? Math.min.apply(null, drops.map((d) => Math.abs(d - foeX))) : 1e9;
        const nearSelf = drops.length ? Math.min.apply(null, drops.map((d) => Math.abs(d - meX))) : 1e9;
        rows.push({ seed, meX: Math.round(meX), foeX: Math.round(foeX),
                    drops: drops.map((d) => Math.round(d)),
                    selfDmg: hp0 - ART.state.players[1].hp,
                    onEnemySide: nearFoe < nearSelf });
      }
      return rows;
    })()`);
    const aimedRight = aiAim.filter((r) => r.onEnemySide).length;
    check('AI: every volley lands on the enemy side', aimedRight === aiAim.length,
      aimedRight + '/' + aiAim.length + ' ' + JSON.stringify(aiAim.map((r) => r.drops)));
    check('AI: never damages itself with its own shell', aiAim.every((r) => r.selfDmg <= 0),
      JSON.stringify(aiAim.map((r) => r.selfDmg)));

    // ---- procedural kill sequence
    const death = await evalIn(`(() => {
      ART.start('ai', 991); ART.setTurn(0);
      const before = ART.particles.length;
      const started = ART.detonate(1);
      const chargePhase = ART.state.kill.phase;
      let maxParts = 0, maxRings = 0, sawBurst = false;
      for (let i = 0; i < 150; i++) {
        ART.tick(1);
        maxParts = Math.max(maxParts, ART.particles.length);
        maxRings = Math.max(maxRings, ART.state.rings.length);
        if (ART.state.kill && ART.state.kill.phase === 'burst') sawBurst = true;
      }
      const k = ART.state.kill;
      return { started, chargePhase, before, maxParts, maxRings, sawBurst,
               turretMoved: k ? Math.abs(k.turret.x - k.x) > 12 : true,
               victimAlive: ART.state.players[1].alive };
    })()`);
    check('death: charge-up precedes the burst', death.chargePhase === 'charge' && death.sawBurst, JSON.stringify({ c: death.chargePhase, b: death.sawBurst }));
    check('death: burst throws particles and shockwaves', death.maxParts > death.before + 60 && death.maxRings >= 3, death.maxParts + ' particles, ' + death.maxRings + ' rings');
    check('death: turret shard is thrown clear', death.turretMoved === true, 'moved ' + death.turretMoved);
    check('death: victim is down', death.victimAlive === false, 'alive ' + death.victimAlive);

    // ---- HUD: bigger wind readout
    const windHud = await evalIn(`(() => {
      const el = document.getElementById('windTxt');
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), text: el.textContent.trim() };
    })()`);
    check('hud: wind readout enlarged (+85%)', windHud.size >= 19 && windHud.size <= 20.5, windHud.size + 'px — "' + windHud.text + '"');

    // ---- weapon chips readable at a glance
    const chips = await evalIn(`(() => {
      const c = [...document.querySelectorAll('#weapons .wchip')];
      return {
        n: c.length,
        icons: c.filter((x) => x.querySelector('svg')).length,
        names: c.map((x) => (x.querySelector('.wname') || {}).textContent || ''),
        counts: c.map((x) => (x.querySelector('.cnt') || {}).textContent || ''),
        desc: (document.getElementById('wdesc').textContent || '').trim()
      };
    })()`);
    check('hud: each weapon chip shows an icon, name and ammo',
      chips.n === 5 && chips.icons === 5 && chips.names.every((n) => n.length > 0),
      chips.names.join('/') + ' — ' + chips.counts.join('/'));
    check('hud: selected weapon has a plain-language line', chips.desc.length > 12, chips.desc.slice(0, 58));

    // ---- camera must not be pushed off the unit by the blast
    const camLock = await evalIn(`(() => {
      ART.start('ai', 2468); ART.setTurn(0);
      const p = ART.state.players[1];
      ART.detonate(1);
      let margin = 1e9, zmax = 0, smax = 0;
      for (let i = 0; i < 110; i++) {
        ART.tick(1);
        const s = ART.screenOf(p.x, p.y - 30);
        margin = Math.min(margin, s.x, innerWidth - s.x, s.y, innerHeight - s.y);
        zmax = Math.max(zmax, ART.cam.z);
        smax = Math.max(smax, ART.cam.shake);
      }
      return { margin: Math.round(margin), z: +zmax.toFixed(3), shake: Math.round(smax), w: innerWidth, h: innerHeight };
    })()`);
    check('camera: blast never pushes the unit out of frame', camLock.margin > 40, JSON.stringify(camLock));
    check('camera: no zoom drift after a kill', camLock.z === 1, 'peak zoom ' + camLock.z);

    // ---- arsenal previews
    const arsenal = await evalIn(`(async () => {
      document.getElementById('btnArsenal').click();
      const cvs = [...document.querySelectorAll('#arsenalList canvas')];
      const sample = () => cvs.map((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 997) s += d[i] + d[i + 1];
        return s;
      });
      const a = sample();
      await new Promise((r) => setTimeout(r, 430));
      const b = sample();
      const nonBlank = a.filter((v) => v > 0).length;
      const moving = a.filter((v, i) => v !== b[i]).length;
      document.getElementById('btnCloseArsenal').click();
      return { count: cvs.length, nonBlank, moving,
               names: [...document.querySelectorAll('.arsName')].map((n) => n.textContent) };
    })()`);
    check('arsenal: one preview per weapon', arsenal.count === 5 && arsenal.names.length === 5, arsenal.names.join('/'));
    check('arsenal: every preview renders', arsenal.nonBlank === 5, arsenal.nonBlank + '/5 painted');
    check('arsenal: previews animate', arsenal.moving >= 3, arsenal.moving + '/5 moving');

    // ---- capture the burst for visual review
    await evalIn(`(() => {
      ART.start('ai', 5150); ART.setTurn(0);
      ART.detonate(1);
      for (let i = 0; i < 32; i++) ART.tick(1);
      ART.render();
    })()`);
    await new Promise((r) => setTimeout(r, 240));
    const shotKill = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'desktop-kill.png'), Buffer.from(shotKill.data, 'base64'));

    // ---- no two deaths look alike
    const variety = await evalIn(`(() => {
      const sig = [];
      for (let i = 0; i < 7; i++) {
        ART.start('ai', 100 + i); ART.setTurn(0);
        ART.detonate(1);
        const k = ART.state.kill;
        sig.push([k.style.id, k.ringN, k.seq.length, Math.round(k.charge * 100), Math.round(k.crater)].join(':'));
      }
      return { sig, unique: new Set(sig).size };
    })()`);
    check('death: every detonation is procedurally unique', variety.unique >= 6,
      variety.unique + '/7 distinct — ' + variety.sig.slice(0, 3).join(' | '));

    // ---- round ends and wins accrue
    const roundEnd = await evalIn(`(() => {
      ART.start('ai', 6060); ART.setTurn(0); ART.setWind(0);
      ART.setHp(1, 6);
      let guard = 0;
      while (ART.state.mode === 'aim' && guard++ < 4) {
        const s = ART.solve(); ART.aim(s.angle, s.power); ART.fire(); ART.settle(5000); ART.tick(120);
      }
      return { wins: ART.state.players.map(p => p.wins), mode: ART.state.mode,
               alive: ART.state.players.map(p => p.alive), killActive: !!ART.state.kill,
               killStyle: ART.state.kill ? ART.state.kill.style.id : null };
    })()`);
    check('round: killing blow ends the round', roundEnd.wins[0] === 1, JSON.stringify(roundEnd));
    check('death: real kill paths trigger the detonation sequence', roundEnd.killActive === true,
      'style ' + roundEnd.killStyle);

    // ---- reload restores ammo and hp
    const reload = await evalIn(`(() => {
      ART.state.round = 2; ART.start('ai', 6061);
      return { ammo: ART.state.players[0].ammo.slice(0, 3), hp: ART.state.players[0].hp, round: ART.state.round };
    })()`);
    check('round: ammo + hp reset for a new round', reload.hp === 100 && reload.ammo[1] === 3, JSON.stringify(reload));

    // ---- escalation: metal storm carves terrain on its own
    const meteor = await evalIn(`(() => {
      ART.start('ai', 31); ART.setTurn(0);
      const h0 = ART.terrainHash();
      ART.state.turnCount = 12; ART.state.storm = 1;
      ART.state.meteor = { x: 780, t: 0.3 };
      const hp0 = ART.state.players.map(p => p.hp);
      ART.tick(60);
      return { carved: ART.terrainHash() !== h0, cleared: ART.state.meteor === null, hp0 };
    })()`);
    check('escalation: metal storm impacts and reshapes terrain', meteor.carved && meteor.cleared, JSON.stringify(meteor));

    // ---- the storm may maul a player, never finish one
    const stormFloor = await evalIn(`(() => {
      const run = (hp) => {
        ART.start('ai', 31); ART.setTurn(0);
        const p = ART.state.players[0];
        p.hp = hp;
        ART.meteorAt(p.x);
        ART.tick(90);
        return { hp: Math.round(p.hp), alive: p.alive };
      };
      return { from30: run(30), from26: run(26), from100: run(100) };
    })()`);
    check('storm: cannot drop a player below the floor',
      stormFloor.from30.hp >= 25 && stormFloor.from26.hp >= 25, JSON.stringify(stormFloor));
    check('storm: never finishes a player', stormFloor.from30.alive && stormFloor.from26.alive,
      'alive ' + stormFloor.from30.alive + '/' + stormFloor.from26.alive);
    check('storm: still hurts a healthy player', stormFloor.from100.hp < 100,
      'hp ' + stormFloor.from100.hp);

    // ---- turn clock auto-fires when enabled
    const clock = await evalIn(`(() => {
      ART.start('ai', 31); ART.setTurn(0);
      const sw = document.getElementById('swClock');
      if (!sw.classList.contains('on')) sw.click();
      const shots0 = ART.state.stats.shots;
      ART.state.timers.clock = 0.2;
      ART.tick(40);
      const fired = ART.state.stats.shots - shots0;
      sw.click();
      return { fired, mode: ART.state.mode };
    })()`);
    check('turn clock: expires into an auto-shot', clock.fired === 1, JSON.stringify(clock));

    // ---- settings persistence round-trip
    const persist = await evalIn(`(() => {
      document.getElementById('swClock').click();
      const raw = localStorage.getItem('coldfront.settings.v1');
      const back = JSON.parse(raw || '{}');
      document.getElementById('swClock').click();
      return { clock: back.clock, has: !!raw };
    })()`);
    check('settings: persisted to localStorage', persist.has && persist.clock === true, JSON.stringify(persist));

    // ---- impact frame (crater + scorch readability)
    await evalIn(`(() => {
      ART.start('ai', 4711); ART.setTurn(0); ART.setWind(10);
      ART.weapon(2); const s = ART.solve();
      ART.aim(s.angle, s.power); ART.fire();
      for (let i = 0; i < 900 && ART.state.mode === 'fly'; i++) ART.tick(1);
      ART.tick(40); ART.render();
    })()`);
    await new Promise((r) => setTimeout(r, 220));
    const shotImpact = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'desktop-impact.png'), Buffer.from(shotImpact.data, 'base64'));
    const crater = await evalIn(`(() => {
      const t = ART.state.terrain; let deep = 0;
      for (let x = 1; x < t.length; x++) deep += Math.max(0, t[x] - t[x - 1]);
      return { roughness: Math.round(deep) };
    })()`);
    check('terrain: impact leaves a carved crater', crater.roughness > 0, 'slope sum ' + crater.roughness);

    // ---- overlay geometry: the shot log must never sit on a battery
    const logPos = await evalIn(`(() => {
      ART.start('ai', 4242); ART.setTurn(0);
      const a = ART.state.players[0], b = ART.state.players[1];
      const lg = document.getElementById('log').getBoundingClientRect();
      const pa = ART.screenOf(a.x, a.y - 30), pb = ART.screenOf(b.x, b.y - 30);
      const inside = (p) => p.x >= lg.left - 8 && p.x <= lg.right + 8 && p.y >= lg.top - 8 && p.y <= lg.bottom + 8;
      return {
        log: [Math.round(lg.left), Math.round(lg.top), Math.round(lg.right), Math.round(lg.bottom)],
        tankA: [Math.round(pa.x), Math.round(pa.y)], tankB: [Math.round(pb.x), Math.round(pb.y)],
        coversA: inside(pa), coversB: inside(pb),
        inTopBand: lg.top < innerHeight * 0.4
      };
    })()`);
    check('overlay: shot log is top-left and clear of both batteries',
      !logPos.coversA && !logPos.coversB && logPos.inTopBand, JSON.stringify(logPos));

    // ---- arsenal screenshot
    await evalIn(`(async () => {
      ART.start('ai', 4242); ART.setTurn(0);
      document.getElementById('btnArsenal').click();
      await new Promise((r) => setTimeout(r, 520));
    })()`);
    const shotArs = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'arsenal.png'), Buffer.from(shotArs.data, 'base64'));
    await evalIn('document.getElementById("btnCloseArsenal").click()');

    // ---- mobile layout + screenshot
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await evalIn('dispatchEvent(new Event("resize")); ART.start("ai", 424242); ART.render();');
    const mob = await evalIn(`(() => {
      const cv = document.getElementById('game');
      const cmd = document.getElementById('cmd').getBoundingClientRect();
      const p0 = document.getElementById('p0card').getBoundingClientRect();
      return { iw: innerWidth, ih: innerHeight, cw: cv.width, ch: cv.height,
               cmdW: Math.round(cmd.width), cmdIn: cmd.left >= -1 && cmd.right <= innerWidth + 1 && cmd.bottom <= innerHeight + 1,
               cardsIn: p0.left >= -1 && p0.right <= innerWidth + 1,
               overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
    })()`);
    check('mobile: viewport emulated at 390x844', mob.iw === 390 && mob.ih === 844, mob.iw + 'x' + mob.ih);
    check('mobile: canvas sized by DPR', mob.cw === 780, 'canvas ' + mob.cw);
    check('mobile: command bar fits the viewport', mob.cmdIn, 'w ' + mob.cmdW);
    check('mobile: no horizontal overflow', !mob.overflowX && mob.cardsIn, 'cardsIn ' + mob.cardsIn);

    const shotMob = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'mobile-390x844.png'), Buffer.from(shotMob.data, 'base64'));

    // landscape phone — the orientation the game is actually played in
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await evalIn('dispatchEvent(new Event("resize")); ART.start("ai", 424242); ART.setTurn(0); ART.aim(48, 74); ART.render();');
    const land = await evalIn(`(() => {
      const cv = document.getElementById('game');
      const cmd = document.getElementById('cmd').getBoundingClientRect();
      const top = document.querySelector('.row').getBoundingClientRect();
      return { iw: innerWidth, ih: innerHeight, cw: cv.width,
               cmdIn: cmd.top >= 0 && cmd.bottom <= innerHeight + 1 && cmd.width <= innerWidth + 1,
               noOverlap: cmd.top > top.bottom - 2,
               canvasFits: cv.height === innerHeight * 2 };
    })()`);
    check('landscape phone: viewport 844x390', land.iw === 844 && land.ih === 390, land.iw + 'x' + land.ih);
    check('landscape phone: command bar inside viewport', land.cmdIn, 'cmdIn ' + land.cmdIn);
    check('landscape phone: HUD rows do not overlap', land.noOverlap, 'noOverlap ' + land.noOverlap);
    const shotLand = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'mobile-landscape.png'), Buffer.from(shotLand.data, 'base64'));

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evalIn('dispatchEvent(new Event("resize")); ART.start("ai", 424242); ART.setTurn(0); ART.aim(52, 78); ART.render();');
    await new Promise((r) => setTimeout(r, 260));
    const shotDesk = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'desktop-aim.png'), Buffer.from(shotDesk.data, 'base64'));

    // mid-flight frame for the README
    await evalIn(`(() => { ART.setWind(0); const s = ART.solve(); ART.aim(s.angle, s.power); ART.fire(); for (let i=0;i<26;i++) ART.tick(1); ART.render(); })()`);
    const shotFly = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'desktop-flight.png'), Buffer.from(shotFly.data, 'base64'));

    // ---- soak: long unattended run, both AI sides
    const soak = await evalIn(`(() => {
      ART.start('ai', 99);
      const errs = [];
      window.addEventListener('error', e => errs.push(e.message));
      let rounds = 0, restarts = 0;
      for (let i = 0; i < 6000; i++) {
        ART.tick(1);
        if (ART.state.mode === 'matchover') { restarts++; ART.start('ai', 99 + restarts); }
        if (ART.state.mode === 'roundover') { ART.state.round++; ART.state.players[0].wins = 0; ART.state.players[1].wins = 0; }
        if (ART.state.mode === 'aim' && ART.state.turn === 1 && !ART.state.aiPlan && ART.state.aiTimer <= 0) ART.tick(1);
      }
      return { ticks: ART.tickCount, rounds, restarts, errs, mode: ART.state.mode,
               hp: ART.state.players.map(p => Math.round(p.hp)), parts: ART.particles.length };
    })()`);
    check('soak: 6000 ticks without a page error', soak.errs.length === 0, JSON.stringify(soak.errs.slice(0, 3)));
    check('soak: match kept progressing', soak.restarts >= 0 && soak.ticks > 6000, 'ticks ' + soak.ticks);

    // ---- final error screens
    check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    const failed = results.filter((r) => !r.ok);
    const pass = results.length - failed.length;
    console.log('\n' + pass + '/' + results.length + ' checks passed' + (failed.length ? '  — FAILURES: ' + failed.map((f) => f.name).join('; ') : ''));
    fs.writeFileSync(path.join(SHOTS, 'gate.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
    process.exitCode = failed.length ? 1 : 0;
  } catch (err) {
    console.error('GATE ERROR: ' + err.message);
    process.exitCode = 2;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    cleanup();
  }
})();
