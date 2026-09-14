// ============================================================
//  tests/lib/cdp.mjs – minimaler Chrome-DevTools-Client ohne Abhängigkeiten
// ============================================================
//  Braucht Node >= 22 (WebSocket und fetch global) und Chrome, Edge oder Chromium.
//  Browser-Pfad per Umgebungsvariable CHROME überschreibbar.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [];
  if (process.platform === 'win32') {
    const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const base of pf) {
      candidates.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(join(base, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge']) {
        candidates.push(join(dir, name));
      }
    }
  }
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Kein Chrome/Edge/Chromium gefunden. Pfad per Umgebungsvariable CHROME angeben.');
  return found;
}

/** Browser samt Unterprozessen beenden und das Temp-Profil löschen */
async function stopBrowser(proc, profile) {
  if (proc.exitCode === null && proc.signalCode === null) {
    const exited = once(proc, 'exit');
    if (process.platform === 'win32') {
      // kill() beendet unter Windows nur chrome.exe selbst; Renderer/GPU-Prozesse halten sonst das Profil offen
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill();
    }
    await Promise.race([exited, sleep(5000)]);
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch { /* Reste im Temp-Ordner sind harmlos */ }
}

export async function launch({ width = 1280, height = 800 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'wc-browser-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 75 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find((t) => t.type === 'page');
    } catch { /* Browser startet noch */ }
    if (!page) await sleep(200);
  }
  if (!page) {
    await stopBrowser(proc, profile);
    throw new Error('Browser hat sich nicht gemeldet (DevTools-Port).');
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (const l of [...listeners]) l(msg);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  const logs = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') logs.push('Exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('Log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });

  const resize = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await resize(width, height);

  return {
    logs,
    send,
    resize,
    async goto(url, wait = 1500) {
      const loaded = new Promise((r) => {
        const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r(); } };
        listeners.push(l);
      });
      await send('Page.navigate', { url });
      await loaded;
      await sleep(wait);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, clip) {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try { ws.close(); } catch { /* egal */ }
      await stopBrowser(proc, profile);
    },
  };
}
