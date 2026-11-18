#!/usr/bin/env node
/* Renders the app icon set from src/icon.svg through headless Chrome.
   node scripts/icons.js  ->  icon-512.png icon-192.png apple-touch-icon.png favicon-32.png */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
// Wrapped in HTML so the artwork scales to the viewport: an SVG with intrinsic
// width/height renders at 512px and a small clip then lands in the transparent corner.
const svgSrc = fs.readFileSync(path.join(ROOT, 'src', 'icon.svg'), 'utf8')
  .replace(/\s(width|height)="\d+"/g, '');
fs.mkdirSync(path.join(ROOT, '.build'), { recursive: true });
const WRAP = path.join(ROOT, '.build', 'icon.html');
fs.writeFileSync(WRAP, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{width:100vw;height:100vh;display:block}</style>${svgSrc}`);
const SVG = 'file:///' + WRAP.replace(/\\/g, '/');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const SIZES = [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png'], [32, 'favicon-32.png']];

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-icon-'));
  const dbg = 9700 + ((Math.random() * 200) | 0);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + dbg, '--window-size=520,520', 'about:blank'], { stdio: 'ignore' });
  const done = (c) => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} process.exit(c); };

  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) {}
    if (!target) await new Promise((r) => setTimeout(r, 150));
  }
  if (!target) { console.error('no chrome'); return done(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await send('Page.enable');
  for (const [size, name] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: SVG + '?v=' + size });
    await new Promise((r) => setTimeout(r, 420));
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      captureBeyondViewport: false
    });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.join(ROOT, name), buf);
    console.log('  ' + name.padEnd(22) + size + 'x' + size + '  ' + (buf.length / 1024).toFixed(1) + ' KB');
  }
  done(0);
})();
