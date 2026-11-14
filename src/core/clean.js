import fs from 'node:fs/promises';
import path from 'node:path';
import { STATE_DIR, run, duMany, diskFree } from './util.js';
import { MEASURE, ALLOW, DENY } from './rules.js';
import { makeGuard } from './guard.js';
import { platform } from '../platform/index.js';

const COMMANDS = new Set(['docker', 'npm', 'yarn', 'pnpm', 'uv', 'bun', 'brew']);

export const guard = makeGuard({
  allow: [...ALLOW, ...(platform?.allow || [])],
  deny: [...DENY, ...(platform?.deny || [])],
});

async function log(entry) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.appendFile(path.join(STATE_DIR, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

async function cleanOne(item, cfg) {
  if (item.action.kind === 'reveal') throw new Error('Report-only item');
  if (item.apps?.length) {
    const b = await platform.blockedBy(...item.apps);
    if (b) throw new Error(b);
  }
  const a = item.action;
  const measure = MEASURE[item.id] || (item.paths.length ? () => duMany(item.paths) : null);
  const before = measure ? await measure() : null;

  if (a.kind === 'cmd') {
    if (!COMMANDS.has(a.cmd)) throw new Error(`Refused: unknown command ${a.cmd}`);
    const r = await run(a.cmd, a.args, { timeout: 600_000 });
    if (!r.ok) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `${a.cmd} exited ${r.code}`);
  } else if (a.kind === 'rm') {
    for (const p of a.paths) await guard(p, cfg);
    for (const p of a.paths) await fs.rm(p, { recursive: true, force: true });
  } else if (a.kind === 'empty') {
    await guard(a.dir, cfg);
    for (const name of await fs.readdir(a.dir)) {
      const child = path.join(a.dir, name);
      try { await fs.rm(child, { recursive: true, force: true }); }
      catch (e) { if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY') throw e; } // skip files an app holds open
    }
  } else {
    throw new Error(`Unknown action ${a.kind}`);
  }

  const after = measure ? await measure() : null;
  const freed = before !== null && after !== null ? Math.max(0, before - after) : null;
  return { freed };
}

/** Clean the chosen items from the last scan, one at a time. Stops nothing on a single failure. */
export async function clean(ids, lastScan, cfg) {
  if (!lastScan) throw new Error('Scan first');
  const byId = new Map(lastScan.items.map((i) => [i.id, i]));
  const diskBefore = await diskFree();
  const results = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) { results.push({ id, ok: false, error: 'Not in the last scan. Scan again.' }); continue; }
    if (!item.selectable) { results.push({ id, ok: false, error: item.blocked || 'Not cleanable' }); continue; }
    try {
      const { freed } = await cleanOne(item, cfg);
      results.push({ id, title: item.title, ok: true, freed, expected: item.bytes, insideDocker: !!item.insideDocker });
      await log({ id, title: item.title, ok: true, freed, expected: item.bytes, action: item.action });
    } catch (e) {
      results.push({ id, title: item.title, ok: false, error: e.message, expected: item.bytes });
      await log({ id, title: item.title, ok: false, error: e.message });
    }
  }
  const diskAfter = await diskFree();
  return {
    results,
    diskFreed: diskBefore && diskAfter ? Math.max(0, diskAfter.free - diskBefore.free) : null,
    disk: diskAfter,
  };
}
