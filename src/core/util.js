import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const STATE_DIR = path.join(HOME, '.safe-sweep');
export const LEGACY_STATE_DIR = path.join(HOME, '.mac-sweep'); // the tool's name before it went public

// Scheduled jobs and app launchers get a bare PATH. Add the usual tool locations.
const extraPath = [
  path.dirname(process.execPath), // node's own bin: npm, npx, and nvm-installed globals
  '/opt/homebrew/bin', '/usr/local/bin',
  path.join(HOME, '.bun/bin'), path.join(HOME, '.local/bin'), path.join(HOME, '.cargo/bin'),
  '/usr/bin', '/bin', '/usr/sbin', '/sbin',
];
// COREPACK_ENABLE_NETWORK=0: asking pnpm or yarn for its cache folder must never download them.
export const ENV = { ...process.env, COREPACK_ENABLE_NETWORK: '0', PATH: [...new Set([...(process.env.PATH || '').split(path.delimiter), ...extraPath])].filter(Boolean).join(path.delimiter) };

/** Run a command. Never throws: returns { ok, code, stdout, stderr }. */
export function run(cmd, args = [], { timeout = 120_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: ENV, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function has(cmd) {
  return (await run('/bin/sh', ['-c', `command -v ${cmd}`])).ok;
}

export async function exists(p) {
  try { await fs.lstat(p); return true; } catch { return false; }
}

/** Size on disk in bytes via du. Returns null if unreadable. */
export async function du(p) {
  if (!(await exists(p))) return 0;
  const r = await run('du', ['-sk', p], { timeout: 300_000 });
  const kb = parseInt(r.stdout.trim().split(/\s+/)[0], 10);
  if (Number.isNaN(kb)) return null; // permission denied, timeout
  return kb * 1024;
}

/** Sum of sizes for several paths. null if every one was unreadable. */
export async function duMany(paths) {
  const sizes = await Promise.all(paths.map(du));
  if (sizes.length && sizes.every((s) => s === null)) return null;
  return sizes.reduce((a, b) => a + (b || 0), 0);
}

export async function ls(dir) {
  try { return await fs.readdir(dir); } catch { return []; }
}

/** Is an app running? Matches the app bundle's executable path. */
export async function running(bundlePattern) {
  // macOS pgrep leaves out its own parent processes unless given -a. Without it, an app
  // whose built-in terminal started safe-sweep (Cursor, Claude) would look closed.
  // On Linux, -a means something else and parents are always included.
  const args = process.platform === 'darwin' ? ['-a', '-f', bundlePattern] : ['-f', bundlePattern];
  return (await run('pgrep', args)).ok;
}

/** Parse Docker-style size strings: "1.2GB", "345.6MB", "12kB", "0B". */
export function parseSize(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*([kKMGT]?i?B)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2][0].toUpperCase();
  const pow = { B: 0, K: 1, M: 2, G: 3, T: 4 }[u] ?? 0;
  return Math.round(n * 1000 ** pow);
}

export function fmt(bytes) {
  if (bytes === null || bytes === undefined) return '?';
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function tilde(p) {
  return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}

export async function diskFree() {
  try {
    const target = (await exists('/System/Volumes/Data')) ? '/System/Volumes/Data' : HOME;
    const s = await fs.statfs(target);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}
