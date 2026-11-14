// Every rule returns zero or more items. An item is one row in the UI.
//
// tier:  'safe'      cache or leftover; nothing of yours is lost
//        'reinstall' safe, but costs a reinstall or re-download later
//        'review'    shown for information; the tool never deletes these
//
// action.kind:  'cmd'    run the tool's own cleanup command
//               'rm'     delete the listed paths
//               'empty'  delete the folder's contents, keep the folder
//               'reveal' report only: a button shows it in your file manager
//
// Lessons kept from the Aug 2026 triage:
// - Never `docker image prune -a` or `docker volume prune`. With zero containers,
//   every image and volume counts as "unused", including the ones you need.
// - Never touch WhatsApp's container directly. The chat database lives there.
// - Measure before and after. Estimates drift.
//
// This file holds rules every platform shares. Platform-only rules live in
// src/platform/<os>/rules.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, run, has, du, ls, exists, parseSize } from './util.js';
import { TEMPORARY } from './schedule.js';

const H = (...p) => path.join(HOME, ...p);

export const item = (o) => ({ blocked: null, cost: '', paths: [], ...o });

// ---------- Docker ----------

async function dockerUp() {
  return (await has('docker')) && (await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 })).ok;
}

// Cleanups that run a command have no folder to measure afterwards.
// These measure what's still reclaimable, before and after, so the result is real.
async function dockerBuildCache() {
  const df = await run('docker', ['system', 'df', '--format', '{{json .}}']);
  const rows = df.stdout.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const build = rows.find((r) => /build cache/i.test(r.Type));
  return build ? parseSize(String(build.Reclaimable).split(' ')[0]) : null;
}
async function dockerDangling() {
  const r = await run('docker', ['images', '-f', 'dangling=true', '--format', '{{.Size}}']);
  return r.ok ? r.stdout.trim().split('\n').filter(Boolean).reduce((a, s) => a + parseSize(s), 0) : null;
}
async function brewReclaimable() {
  const dry = await run('brew', ['cleanup', '-n', '-s'], { timeout: 180_000 });
  if (!dry.ok) return null;
  const m = dry.stdout.match(/free approximately ([\d.]+\s*[KMGT]?B)/i);
  return m ? parseSize(m[1].replace(/\s/g, '')) : 0;
}
export const MEASURE = { 'docker-build-cache': dockerBuildCache, 'docker-dangling': dockerDangling, brew: brewReclaimable };

async function docker() {
  if (!(await has('docker'))) return [];
  if (!(await dockerUp())) {
    return [item({ id: 'docker', tier: 'safe', title: 'Docker caches', bytes: null,
      detail: 'Docker isn’t running, so its caches can’t be measured.',
      blocked: 'Start Docker, then scan again', action: { kind: 'reveal' } })];
  }
  const out = [];
  const build = await dockerBuildCache();
  if (build !== null) {
    out.push(item({ id: 'docker-build-cache', tier: 'safe', title: 'Docker build cache', bytes: build, insideDocker: true,
      detail: 'Layers left over from image builds. Touches no image, container or volume. With Docker Desktop, the space is freed inside its disk file and your disk gets it back when Docker Desktop restarts.',
      cost: 'Next build of each image is slower.',
      action: { kind: 'cmd', cmd: 'docker', args: ['builder', 'prune', '-f'] } }));
  }
  out.push(item({ id: 'docker-dangling', tier: 'safe', title: 'Docker dangling images', bytes: await dockerDangling(), insideDocker: true,
    detail: 'Untagged image layers no tag points to. This is plain prune, never prune -a. With Docker Desktop, also freed inside its disk file.',
    action: { kind: 'cmd', cmd: 'docker', args: ['image', 'prune', '-f'] } }));
  return out;
}

// ---------- Package manager caches (use each tool's own command) ----------

async function pkgCaches() {
  const out = [];
  const npmDir = (await run('npm', ['config', 'get', 'cache'])).stdout.trim() || H('.npm');
  const cacache = path.join(npmDir, '_cacache');
  if (await exists(cacache)) {
    out.push(item({ id: 'npm-cache', tier: 'safe', title: 'npm cache', bytes: await du(cacache), paths: [cacache],
      detail: 'Downloaded package tarballs. npm re-fetches what it needs.',
      action: { kind: 'cmd', cmd: 'npm', args: ['cache', 'clean', '--force'] } }));
  }
  const npx = path.join(npmDir, '_npx');
  if (await exists(npx)) {
    out.push(item({ id: 'npx-cache', tier: 'safe', title: 'npx download cache', bytes: await du(npx), paths: [npx],
      detail: 'Packages fetched by one-off npx runs.', cost: 'Next npx run of each tool re-downloads it.',
      // Never pull the floor out from under ourselves when run through npx.
      blocked: TEMPORARY ? 'safe-sweep is running from here' : null,
      action: { kind: 'rm', paths: [npx] } }));
  }
  const tools = [
    { id: 'yarn-cache', bin: 'yarn', title: 'Yarn cache', dirCmd: ['cache', 'dir'], clean: ['cache', 'clean'] },
    { id: 'pnpm-store', bin: 'pnpm', title: 'pnpm store (unreferenced packages)', dirCmd: ['store', 'path'], clean: ['store', 'prune'] },
    { id: 'uv-cache', bin: 'uv', title: 'uv Python cache', dirCmd: ['cache', 'dir'], clean: ['cache', 'clean'] },
  ];
  for (const t of tools) {
    if (!(await has(t.bin))) continue;
    const dir = (await run(t.bin, t.dirCmd, { timeout: 20_000 })).stdout.trim().split('\n').pop();
    if (!dir || !(await exists(dir))) continue;
    out.push(item({ id: t.id, tier: 'safe', title: t.title, bytes: await du(dir), paths: [dir],
      detail: 'Re-downloadable package cache.', action: { kind: 'cmd', cmd: t.bin, args: t.clean } }));
  }
  const bunCache = H('.bun/install/cache');
  if ((await has('bun')) && (await exists(bunCache))) {
    out.push(item({ id: 'bun-cache', tier: 'safe', title: 'Bun cache', bytes: await du(bunCache), paths: [bunCache],
      detail: 'Re-downloadable package cache.', action: { kind: 'cmd', cmd: 'bun', args: ['pm', 'cache', 'rm'] } }));
  }
  if (await has('brew')) {
    out.push(item({ id: 'brew', tier: 'safe', title: 'Homebrew old versions and downloads', bytes: await brewReclaimable(),
      detail: 'Outdated formula versions and cached downloads.', action: { kind: 'cmd', cmd: 'brew', args: ['cleanup', '-s'] } }));
  }
  return out;
}

// ---------- Model caches ----------

async function modelCaches() {
  const hf = H('.cache/huggingface');
  if (!(await exists(hf))) return [];
  return [item({ id: 'devcache-huggingface', tier: 'reinstall', title: 'Hugging Face models', bytes: await du(hf), paths: [hf],
    detail: 'Downloaded model weights.', cost: 'Any model you use re-downloads. Can be large.', action: { kind: 'rm', paths: [hf] } })];
}

// ---------- Projects: dormant node_modules and _to_delete folders ----------

const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'];
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo']);

async function walk(root, depth, found) {
  if (depth < 0) return;
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
  const names = new Set(entries.map((e) => e.name));
  if (names.has('node_modules') && names.has('package.json')) found.nodeModules.push(root);
  if (names.has('_to_delete')) found.toDelete.push(path.join(root, '_to_delete'));
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink() || SKIP.has(e.name) || e.name === '_to_delete') continue;
    if (e.name.startsWith('.') && e.name !== '.') continue;
    await walk(path.join(root, e.name), depth - 1, found);
  }
}

async function lastActivity(dir) {
  let newest = 0;
  const log = await run('git', ['-C', dir, 'log', '-1', '--format=%ct'], { timeout: 10_000 });
  if (log.ok && log.stdout.trim()) newest = parseInt(log.stdout.trim(), 10) * 1000;
  for (const n of await ls(dir)) {
    if (n === 'node_modules' || n === '.git') continue;
    try { newest = Math.max(newest, (await fs.stat(path.join(dir, n))).mtimeMs); } catch {}
  }
  return newest;
}

async function lockCommitted(dir) {
  for (const f of LOCKFILES) {
    if (!(await exists(path.join(dir, f)))) continue;
    if ((await run('git', ['-C', dir, 'ls-files', '--error-unmatch', f], { timeout: 10_000 })).ok) return f;
  }
  return null;
}

async function projects(cfg) {
  const found = { nodeModules: [], toDelete: [] };
  for (const r of cfg.projectRoots) await walk(r, 3, found);
  // Roots can overlap (one inside another, or a symlink). Count each folder once.
  found.nodeModules = [...new Set(found.nodeModules)];
  found.toDelete = [...new Set(found.toDelete)];
  const out = [];
  const now = Date.now();
  for (const dir of found.nodeModules) {
    const nm = path.join(dir, 'node_modules');
    const name = path.relative(path.dirname(cfg.projectRoots.find((r) => dir.startsWith(r)) || dir), dir);
    const days = Math.floor((now - (await lastActivity(dir))) / 86_400_000);
    const lock = await lockCommitted(dir);
    const isProtected = cfg.protect.some((p) => dir.toLowerCase().includes(p.toLowerCase()));
    let blocked = null;
    if (isProtected) blocked = 'Protected in your config';
    else if (days < cfg.dormantDays) blocked = `Active ${days} days ago`;
    else if (!lock) blocked = 'No lockfile committed to git; reinstall could change versions';
    out.push(item({ id: `nm:${dir}`, tier: 'reinstall', group: 'node_modules', title: `node_modules · ${name}`, bytes: await du(nm), paths: [nm],
      detail: lock ? `Untouched for ${days} days. ${lock} is committed.` : `Untouched for ${days} days.`,
      cost: 'Run your package manager’s install when you return to this project.',
      blocked, action: { kind: 'rm', paths: [nm] } }));
  }
  for (const td of found.toDelete) {
    out.push(item({ id: `td:${td}`, tier: 'reinstall', group: '_to_delete', title: `_to_delete · ${path.relative(HOME, path.dirname(td))}`, bytes: await du(td), paths: [td],
      detail: 'A folder parked for deletion. Some tools, AI agents included, move files here when they can’t delete them.',
      cost: 'Open it first if you’re not sure what’s inside.', action: { kind: 'rm', paths: [td] } }));
  }
  return out;
}

// Paths every platform may delete, relative to home. Platforms add their own.
export const ALLOW = [/^\.npm\/_npx$/, /^\.cache\/huggingface$/];
// Never deleted on any platform.
export const DENY = [/(^|\/)\.git(\/|$)/];

export const RULES = [docker, pkgCaches, modelCaches, projects];
