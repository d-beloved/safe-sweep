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
