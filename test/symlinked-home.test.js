// On macOS, /var is a symlink to /private/var, and some homes sit behind a symlink too.
// The guard must still allow real caches there, and still refuse everything else.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-sweep-sym-'));
fs.mkdirSync(path.join(base, 'private/var/home/Library/Caches/Google'), { recursive: true });
fs.mkdirSync(path.join(base, 'private/var/home/Movies/node_modules'), { recursive: true });
fs.mkdirSync(path.join(base, 'private/var/home/Projects/app/node_modules'), { recursive: true });
fs.symlinkSync(path.join(base, 'private/var'), path.join(base, 'var'));
process.env.HOME = path.join(base, 'var/home'); // home reached through the symlink

const { makeGuard } = await import('../src/core/guard.js');
const core = await import('../src/core/rules.js');
const mac = await import('../src/platform/darwin/rules.js');
const guard = makeGuard({ allow: [...core.ALLOW, ...mac.ALLOW], deny: [...core.DENY, ...mac.DENY] });
const H = (rel) => path.join(process.env.HOME, rel);
const cfg = { projectRoots: [H('Projects')] };

after(() => fs.rmSync(base, { recursive: true, force: true }));

test('allows caches and project node_modules under a symlinked home', async () => {
  await guard(H('Library/Caches/Google'), cfg);
  await guard(H('Projects/app/node_modules'), cfg);
});

test('still refuses non-allowlisted paths under a symlinked home', async () => {
  await assert.rejects(guard(H('Movies'), cfg), /Refused/);
  await assert.rejects(guard(H('Movies/node_modules'), cfg), /Refused/);
});
