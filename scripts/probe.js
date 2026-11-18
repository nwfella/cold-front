#!/usr/bin/env node
/* Tiny CDP console: node scripts/probe.js "<js expression>"  — prints the JSON result. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const expr = process.argv[2] || 'ART.snapshot()';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

(async () => {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, (req.url || '/').split('?')[0] === '/' ? 'index.html' : (req.url || '').split('?')[0]);
    fs.readFile(f, (e, b) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'text/plain', 'cache-control': 'no-store' });
      res.end(b);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dbg = 9300 + ((Math.random() * 400) | 0);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-probe-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + dbg, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  const done = (code) => { try { chrome.kill('SIGKILL'); } catch (e) {} try { srv.close(); } catch (e) {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} process.exit(code); };

  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {}
    if (!target) await new Promise((r) => setTimeout(r, 150));
  }
  if (!target) { console.error('no target'); return done(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.error('PAGE EXCEPTION: ' + ((d.exception && d.exception.description) || d.text));
    }
  };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?cb=${Date.now()}` });
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: '!!window.ART', returnByValue: true });
    if (r.result.value) break;
    await new Promise((r2) => setTimeout(r2, 120));
  }
  const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) console.error('ERR: ' + JSON.stringify(out.exceptionDetails.exception && out.exceptionDetails.exception.description || out.exceptionDetails.text));
  console.log(JSON.stringify(out.result.value, null, 1));
  done(0);
})();
