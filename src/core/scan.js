import { RULES } from './rules.js';
import { diskFree } from './util.js';
import { platform } from '../platform/index.js';

/** The rules to run. Without reportOnly, rules marked reportOnly (they only list things to review) are left out. */
export function rulesFor({ reportOnly = true } = {}) {
  return [...RULES, ...(platform?.rules || [])].filter((r) => reportOnly || !r.reportOnly);
}

/** Run every rule. One failing rule never sinks the scan. */
export async function scan(cfg, opts) {
  const started = Date.now();
  const rules = rulesFor(opts);
  const results = await Promise.all(rules.map(async (rule) => {
    try { return { items: await rule(cfg) }; }
    catch (e) { return { items: [], error: `${rule.name}: ${e.message}` }; }
  }));
  const items = results.flatMap((r) => r.items).filter((i) => i.bytes === null || i.bytes > 0);
  const tierOrder = { safe: 0, reinstall: 1, review: 2 };
  items.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || (b.bytes || 0) - (a.bytes || 0));
  for (const i of items) i.selectable = i.action.kind !== 'reveal' && !i.blocked;
  return {
    at: new Date().toISOString(),
    ms: Date.now() - started,
    disk: await diskFree(),
    totals: totals(items),
    errors: results.map((r) => r.error).filter(Boolean),
    items,
  };
}

function totals(items) {
  const sum = (f) => items.filter(f).reduce((a, i) => a + (i.bytes || 0), 0);
  return {
    safe: sum((i) => i.tier === 'safe' && i.selectable),
    reinstall: sum((i) => i.tier === 'reinstall' && i.selectable),
    review: sum((i) => i.tier === 'review'),
  };
}

/**
 * Check again whether the apps behind "Quit X first" items are still open, and update
 * the scan in place. Only items that name apps are touched: for them, the app check is
 * the only reason they can be blocked. Returns true if anything changed.
 */
export async function recheckApps(s, blockedBy = platform?.blockedBy) {
  const items = s.items.filter((i) => i.apps?.length && i.action.kind !== 'reveal');
  if (!items.length || !blockedBy) return false;
  const now = await Promise.all(items.map((i) => blockedBy(...i.apps)));
  let changed = false;
  items.forEach((i, n) => {
    if (i.blocked === now[n]) return;
    i.blocked = now[n];
    i.selectable = !now[n];
    changed = true;
  });
  if (changed) s.totals = totals(s.items);
  return changed;
}
