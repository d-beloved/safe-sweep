// Whole-program checks that don't need macOS: settings migration and the unsupported-OS exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/safe-sweep.js', import.meta.url));
const runBin = (args, env) => spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safe-sweep-cli-'));

test('an unsupported OS exits with a clear message and touches nothing', () => {
  const home = tmpHome();
  const r = runBin(['scan'], { HOME: home, SAFE_SWEEP_PLATFORM: 'plan9' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /doesn't support .* yet/);
  assert.equal(fs.existsSync(path.join(home, '.safe-sweep')), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('first run copies settings and history from ~/.mac-sweep and leaves the old folder alone', () => {
  const home = tmpHome();
  const old = path.join(home, '.mac-sweep');
  fs.mkdirSync(old);
  const cfg = { projectRoots: ['~/work'], protect: ['client-x'], dormantDays: 30 };
  fs.writeFileSync(path.join(old, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(old, 'log.jsonl'), '{"at":"2026-11-02T10:00:00Z","ok":true,"title":"npm cache","freed":1}\n');

  const r = runBin(['log'], { HOME: home, SAFE_SWEEP_PLATFORM: 'darwin' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Copied your settings/);
  assert.match(r.stdout, /npm cache/);
  const moved = JSON.parse(fs.readFileSync(path.join(home, '.safe-sweep', 'config.json'), 'utf8'));
  assert.deepEqual(moved.protect, ['client-x']);
  assert.ok(fs.existsSync(path.join(old, 'config.json')), 'old folder kept');

  // Second run: no copy again, no message.
  const r2 = runBin(['log'], { HOME: home, SAFE_SWEEP_PLATFORM: 'darwin' });
  assert.doesNotMatch(r2.stdout, /Copied your settings/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a fresh install writes generic defaults with nothing protected', () => {
  const home = tmpHome();
  const r = runBin(['log'], { HOME: home, SAFE_SWEEP_PLATFORM: 'darwin' });
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.safe-sweep', 'config.json'), 'utf8'));
  assert.deepEqual(cfg.protect, []);
  assert.ok(cfg.projectRoots.includes('~/Projects'));
  fs.rmSync(home, { recursive: true, force: true });
});
