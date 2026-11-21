#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { platform, SUPPORTED_IDS } from '../src/platform/index.js';
import { loadConfig } from '../src/core/config.js';
import { scan } from '../src/core/scan.js';
import { startServer, IDLE_MINUTES } from '../src/core/server.js';
import { fmt, STATE_DIR } from '../src/core/util.js';
import { TEMPORARY } from '../src/core/schedule.js';
const [cmd = 'ui', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };

const HELP = `safe-sweep: find disk space you can free safely

  safe-sweep                 open the Scan page in your browser
  safe-sweep scan [--json]   scan and print the list (deletes nothing)
  safe-sweep check           scan, then notify if space is low (used by the schedule)
  safe-sweep schedule weekly [--day 1] [--hour 10]
  safe-sweep schedule daily [--hour 10]
  safe-sweep schedule off
  safe-sweep schedule        show the current schedule
  safe-sweep log             show what was cleaned and when

Scheduled runs only scan and notify. They never delete.`;


async function main() {
  if (!platform) {
    console.error(`safe-sweep doesn't support ${process.platform} yet. Supported: ${SUPPORTED_IDS.join(', ')}.`);
    process.exit(2);
  }
  const cfg = await loadConfig();
  if (cfg.migrated) console.log('Copied your settings and history from ~/.mac-sweep to ~/.safe-sweep.');
  if (TEMPORARY && cmd === 'ui') console.log('Running through npx. Scan and clean work. To set a schedule or launcher, install it: npm i -g @d-beloved/safe-sweep');

  if (cmd === 'ui') {
    const url = `http://127.0.0.1:${cfg.port}/`;
    try {
      await startServer(cfg, { onListening: (u) => console.log(`Safe Sweep is running at ${u}\nLeave this window open. It stops by itself after ${IDLE_MINUTES} idle minutes, from the Stop button on the page, or with Ctrl+C.`) });
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      console.log(`Already running at ${url}`);
    }
    if (!flag('no-open')) await platform.openUrl(url);
    return;
  }

  if (cmd === 'scan') {
    const r = await scan(cfg);
    if (flag('json')) return console.log(JSON.stringify(r, null, 2));
    if (r.disk) console.log(`Free: ${fmt(r.disk.free)} of ${fmt(r.disk.total)}`);
    console.log(`Safe now: ${fmt(r.totals.safe)} · Costs a reinstall: ${fmt(r.totals.reinstall)} · Your call: ${fmt(r.totals.review)}\n`);
    for (const i of r.items) {
      const tag = i.tier === 'review' ? 'REVIEW ' : i.blocked ? 'BLOCKED' : i.tier === 'safe' ? 'SAFE   ' : 'REINST ';
      console.log(`${tag} ${fmt(i.bytes).padStart(8)}  ${i.title}${i.blocked ? `  (${i.blocked})` : ''}`);
      if (i.cmd) console.log(`${' '.repeat(18)}by hand: ${i.cmd}`);
    }
    for (const e of r.errors) console.error(`! ${e}`);
    return;
  }

  if (cmd === 'check') {
    // Only the totals matter here. Skipping report-only rules keeps a background run
    // out of other apps' private folders, which macOS would otherwise ask about.
    const r = await scan(cfg, { reportOnly: false });
    const freeGB = r.disk ? r.disk.free / 1e9 : Infinity;
    const safeGB = r.totals.safe / 1e9;
    const line = `${fmt(r.disk?.free)} free · ${fmt(r.totals.safe)} safe to clear · ${fmt(r.totals.reinstall)} more with reinstalls`;
    console.log(`${new Date().toISOString()} ${line}`);
    if (freeGB < cfg.notify.minFreeGB || safeGB >= cfg.notify.minReclaimableGB) {
      await platform.notify('Safe Sweep', `${line}. Run safe-sweep to review.`);
    }
    return;
  }

  if (cmd === 'schedule') {
    if (!platform.schedule) return console.log(`Scheduling isn't supported on ${platform.name} yet.`);
    const mode = rest[0];
    const s = mode ? await platform.schedule.set({ mode, day: opt('day', 1), hour: opt('hour', 10) }) : await platform.schedule.read();
    console.log(`Schedule: ${platform.schedule.describe(s)}${s.warning ? ` (${s.warning})` : ''}`);
    if (mode && mode !== 'off') console.log('It scans and notifies you. It never deletes.');
    return;
  }

  if (cmd === 'log') {
    const p = path.join(STATE_DIR, 'log.jsonl');
    const lines = (await fs.readFile(p, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).slice(-50);
    if (!lines.length) return console.log('Nothing cleaned yet.');
    for (const l of lines) {
      const e = JSON.parse(l);
      console.log(`${e.at.slice(0, 16).replace('T', ' ')}  ${e.ok ? 'OK  ' : 'FAIL'}  ${e.title}  ${e.ok ? fmt(e.freed) : e.error}`);
    }
    return;
  }

  console.log(HELP);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
