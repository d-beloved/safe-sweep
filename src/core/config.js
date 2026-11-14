import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, STATE_DIR, LEGACY_STATE_DIR, exists } from './util.js';

const CONFIG_PATH = path.join(STATE_DIR, 'config.json');

export const DEFAULTS = {
  // Folders searched for node_modules and _to_delete folders. Missing ones are skipped.
  projectRoots: ['~/Desktop/Projects', '~/Projects', '~/Developer', '~/code', '~/dev', '~/src'],
  // Projects whose node_modules are never offered, even when dormant (substring match on path).
  // Example: ["work-monorepo", "client-x"]
  protect: [],
  // A project counts as dormant after this many days without a commit or file change.
  dormantDays: 60,
  // Scheduled checks notify you when either line is crossed.
  notify: { minFreeGB: 30, minReclaimableGB: 10 },
  port: 4777,
};

const expand = (p) => (p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);

/** First run after the rename: copy settings and history from ~/.mac-sweep. The old folder is left alone. */
async function migrate() {
  if ((await exists(STATE_DIR)) || !(await exists(LEGACY_STATE_DIR))) return false;
  await fs.mkdir(STATE_DIR, { recursive: true });
  for (const f of ['config.json', 'log.jsonl']) {
    await fs.copyFile(path.join(LEGACY_STATE_DIR, f), path.join(STATE_DIR, f)).catch(() => {});
  }
  return true;
}

export async function loadConfig() {
  const migrated = await migrate();
  await fs.mkdir(STATE_DIR, { recursive: true });
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
    else throw new Error(`Can't read ${CONFIG_PATH}: ${e.message}`);
  }
  const cfg = { ...DEFAULTS, ...user, notify: { ...DEFAULTS.notify, ...(user.notify || {}) } };
  cfg.projectRoots = cfg.projectRoots.map(expand);
  cfg.path = CONFIG_PATH;
  cfg.migrated = migrated;
  return cfg;
}
