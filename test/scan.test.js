// Scheduled checks run in the background, where macOS asks before reading another
// app's private data. They must skip the report-only rules that read such folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SAFE_SWEEP_PLATFORM = 'darwin';
const { rulesFor } = await import('../src/core/scan.js');

test('a scheduled check skips report-only rules and keeps the rest', () => {
  const all = rulesFor().map((r) => r.name);
  const background = rulesFor({ reportOnly: false }).map((r) => r.name);
  assert.ok(all.includes('reviewItems') && all.includes('dockerDisk'));
  assert.ok(!background.includes('reviewItems'), 'reviewItems reads WhatsApp and Movies');
  assert.ok(!background.includes('dockerDisk'), 'dockerDisk reads Docker’s container');
  assert.deepEqual(all.filter((n) => !background.includes(n)).sort(), ['dockerDisk', 'reviewItems']);
});

test('a normal install is not treated as an npx run', async () => {
  const { TEMPORARY, checkInput } = await import('../src/core/schedule.js');
  assert.equal(TEMPORARY, false);
  assert.deepEqual(checkInput({ mode: 'daily', hour: 9 }), { mode: 'daily', day: 1, hour: 9 });
});

// An item that says "Quit Chrome first" becomes cleanable once Chrome is closed, with no new scan.
test('recheckApps frees app-blocked items once the app is closed, and only those', async () => {
  const { recheckApps } = await import('../src/core/scan.js');
  const it = (o) => ({ paths: [], cost: '', action: { kind: 'rm', paths: [] }, ...o, selectable: !o.blocked });
  const s = {
    totals: { safe: 0, reinstall: 0, review: 30 },
    items: [
      it({ id: 'cache-chrome', tier: 'safe', bytes: 100, apps: ['chrome'], blocked: 'Quit Chrome first' }),
      it({ id: 'cache-spotify', tier: 'safe', bytes: 10, apps: ['spotify'], blocked: null }),
      it({ id: 'nm:/x', tier: 'reinstall', bytes: 50, blocked: 'Active 2 days ago' }),
      { id: 'rv:/m', tier: 'review', bytes: 30, apps: ['chrome'], blocked: null, selectable: false, paths: [], action: { kind: 'reveal' } },
    ],
  };
  s.totals.safe = 10;
  const open = new Set(['spotify']); // Chrome was quit, Spotify was opened
  const blockedBy = async (...apps) => apps.some((a) => open.has(a)) ? `Quit ${apps[0]} first` : null;

  assert.equal(await recheckApps(s, blockedBy), true);
  const byId = Object.fromEntries(s.items.map((i) => [i.id, i]));
  assert.equal(byId['cache-chrome'].blocked, null);
  assert.equal(byId['cache-chrome'].selectable, true);
  assert.equal(byId['cache-spotify'].selectable, false, 'opened again: blocked again');
  assert.equal(byId['nm:/x'].blocked, 'Active 2 days ago', 'other reasons are left alone');
  assert.equal(byId['nm:/x'].selectable, false);
  assert.equal(byId['rv:/m'].selectable, false, 'report-only items never become cleanable');
  assert.deepEqual(s.totals, { safe: 100, reinstall: 0, review: 30 });

  assert.equal(await recheckApps(s, blockedBy), false, 'nothing changed the second time');
});
