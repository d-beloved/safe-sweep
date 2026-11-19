import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scan, recheckApps } from './scan.js';
import { clean } from './clean.js';
import { STATE_DIR, HOME } from './util.js';
import { platform } from '../platform/index.js';
import { TEMPORARY, TEMPORARY_MSG, needsInstall } from './schedule.js';

const UI = new URL('./ui.html', import.meta.url);
const SCAN_FILE = path.join(STATE_DIR, 'last-scan.json');
export const IDLE_MINUTES = 15;   // the server exits after this many idle minutes
const IDLE_MS = IDLE_MINUTES * 60_000;
const MAX_CLEAN_AGE = 60 * 60_000; // cleaning needs a scan from the last hour

async function loadScan() {
  try { return JSON.parse(await fs.readFile(SCAN_FILE, 'utf8')); } catch { return null; }
}
async function saveScan(s) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(SCAN_FILE, JSON.stringify(s));
}

export async function startServer(cfg, { onListening } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const hosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`]);
  let lastScan = await loadScan(); // survives page refreshes and server restarts
  let scanning = null;
  let busy = false;
  let idle;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_MS); };

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
  const settings = async () => {
    const out = { home: HOME, platform: { id: platform.id, name: platform.name, fileManager: platform.fileManager }, schedule: null, launchers: null,
      temporary: TEMPORARY ? TEMPORARY_MSG : null };
    if (platform.schedule) {
      const s = await platform.schedule.read();
      out.schedule = { ...s, text: platform.schedule.describe(s) };
    }
    if (platform.launchers) out.launchers = await platform.launchers.read();
    return out;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // The page re-checks app-blocked items every few seconds. That alone isn't use,
    // so an open tab can't keep the server up past its idle time.
    if (url.pathname !== '/api/recheck') touch();
    // Blocks DNS-rebinding: only our own host names are served.
    if (!hosts.has(req.headers.host)) return send(res, 403, { error: 'Bad host' });

    if (req.method === 'GET' && url.pathname === '/') {
      const html = (await fs.readFile(UI, 'utf8')).replace('__TOKEN__', token);
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    // Every API call needs the token and JSON. Other websites can't send either
    // without a CORS preflight, which this server never approves.
    if (req.method !== 'POST' || req.headers['x-sweep-token'] !== token || !String(req.headers['content-type']).startsWith('application/json')) {
      return send(res, 403, { error: 'Forbidden' });
    }
    try {
      const body = await readJson(req);
      switch (url.pathname) {
        case '/api/state':
          return send(res, 200, { scan: lastScan, ...(await settings()) });

        case '/api/stop': {
          if (busy) return send(res, 409, { error: 'Cleaning in progress. Stop when it finishes.' });
          send(res, 200, { ok: true });
          setTimeout(() => process.exit(0), 200); // let the response reach the page first
          return;
        }

        case '/api/scan': {
          if (busy) return send(res, 409, { error: 'Cleaning in progress' });
          scanning ||= scan(cfg).finally(() => { scanning = null; });
          lastScan = await scanning;
          await saveScan(lastScan);
          return send(res, 200, lastScan);
        }

        case '/api/recheck': {
          // An item says "Quit Chrome first". Once Chrome is closed, it can be cleaned
          // without a fresh scan. Cleaning checks the apps again anyway.
          const s = lastScan;
          if (busy || scanning || !s) return send(res, 200, { changed: false });
          const changed = await recheckApps(s);
          if (!changed || s !== lastScan || busy) return send(res, 200, { changed: false }); // a clean or scan started meanwhile
          await saveScan(s);
          return send(res, 200, { changed: true, scan: s });
        }

        case '/api/clean': {
          if (busy || scanning) return send(res, 409, { error: 'Busy. Try again in a moment.' });
          if (!Array.isArray(body.ids) || !body.ids.length) return send(res, 400, { error: 'Nothing selected' });
          if (!lastScan || Date.now() - Date.parse(lastScan.at) > MAX_CLEAN_AGE) {
            return send(res, 409, { error: 'This scan is over an hour old. Scan again before cleaning.' });
          }
          busy = true;
          try { return send(res, 200, await clean(body.ids, lastScan, cfg)); }
          finally {
            busy = false;
            lastScan = null; // sizes are now wrong; force a fresh scan
            await fs.rm(SCAN_FILE, { force: true });
          }
        }

        case '/api/reveal': {
          const item = lastScan?.items.find((i) => i.id === body.id);
          const p = item?.paths?.[Number(body.index) || 0];
          if (!p) return send(res, 404, { error: 'Unknown item' });
          await platform.reveal(p);
          return send(res, 200, { ok: true });
        }

        case '/api/schedule':
          if (!platform.schedule) return send(res, 400, { error: 'Scheduling isn’t supported on this OS yet' });
          await platform.schedule.set(body);
          return send(res, 200, await settings());

        case '/api/launcher': {
          if (body.kind === 'app') {
            if (!platform.launchers) return send(res, 400, { error: 'Not supported on this OS yet' });
            needsInstall();
            await platform.launchers.createApp();
          } else if (body.kind === 'shortcut') {
            if (!platform.launchers?.createShortcut) return send(res, 400, { error: 'Not supported on this OS yet' });
            needsInstall();
            await platform.launchers.createShortcut();
          } else return send(res, 400, { error: 'Unknown launcher' });
          return send(res, 200, await settings());
        }

        default:
          return send(res, 404, { error: 'Not found' });
      }
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, '127.0.0.1', resolve);
  });
  touch();
  onListening?.(`http://127.0.0.1:${cfg.port}/`);
  return server;
}
