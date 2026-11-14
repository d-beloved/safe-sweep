// The Linux platform: what its guard allows and refuses, and the files its schedule and
// menu entry write. Runs on any OS: a stand-in systemctl records calls instead of acting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-sweep-linux-'));
const BIN_DIR = path.join(FAKE, 'stub-bin');
const CALLS = path.join(FAKE, 'systemctl-calls');
process.env.HOME = FAKE; // must be set before the modules load: they read HOME at import
process.env.SAFE_SWEEP_PLATFORM = 'linux';
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;

const mk = (rel) => fs.mkdirSync(path.join(FAKE, rel), { recursive: true });
const H = (rel) => path.join(FAKE, rel);
let guard, cfg, linux;

before(async () => {
  for (const d of ['.cache/google-chrome/Default', '.cache/mozilla/firefox', '.cache/mozilla/other', '.cache/pip', '.cache/thumbnails',
    '.cache/huggingface', '.cache/unknown-app', '.cache/keyring', '.config/google-chrome/Default/OptGuideOnDeviceModel',
    '.config/google-chrome/Default/Cookies', '.config/Code/User', '.local/share/Trash/files', '.ssh', 'Dropbox/.cache/pip',
    'Videos', 'Projects/app/node_modules', 'Projects/app/src', BIN_DIR.slice(FAKE.length + 1)]) mk(d);
  fs.writeFileSync(path.join(BIN_DIR, 'systemctl'),
    `#!/bin/sh\necho "$*" >> '${CALLS}'\ncase "$*" in *is-active*) echo active ;; esac\nexit 0\n`, { mode: 0o755 });

  const { makeGuard } = await import('../src/core/guard.js');
  const core = await import('../src/core/rules.js');
  const rules = await import('../src/platform/linux/rules.js');
  guard = makeGuard({ allow: [...core.ALLOW, ...rules.ALLOW], deny: [...core.DENY, ...rules.DENY] });
  cfg = { projectRoots: [H('Projects')] };
  linux = (await import('../src/platform/index.js')).platform;
});

after(() => fs.rmSync(FAKE, { recursive: true, force: true }));

const allows = async (p) => { await guard(p, cfg); };
const refuses = async (p) => { await assert.rejects(guard(p, cfg), /Refused/); };

test('picks the Linux platform', () => {
  assert.equal(linux.id, 'linux');
});

test('allows named caches and the Chrome AI model', async () => {
  await allows(H('.cache/google-chrome'));
  await allows(H('.cache/mozilla/firefox'));
  await allows(H('.cache/pip'));
  await allows(H('.cache/thumbnails'));
  await allows(H('.cache/huggingface'));
  await allows(H('.config/google-chrome/Default/OptGuideOnDeviceModel'));
  await allows(H('Projects/app/node_modules'));
});

test('refuses the neighbours of what it allows', async () => {
  await refuses(H('.cache'));
  await refuses(H('.cache/unknown-app'));
  await refuses(H('.cache/keyring'));
  await refuses(H('.cache/mozilla'));
  await refuses(H('.cache/mozilla/other'));
  await refuses(H('.cache/google-chrome/Default')); // the cache is emptied, not picked apart
  await refuses(H('.config/google-chrome'));
  await refuses(H('.config/google-chrome/Default'));
  await refuses(H('.config/google-chrome/Default/Cookies'));
  await refuses(H('.config/Code/User'));
  await refuses(H('.local/share/Trash'));
  await refuses(H('.local/share/Trash/files'));
  await refuses(H('.ssh'));
  await refuses(H('Dropbox/.cache/pip'));
  await refuses(H('Videos'));
  await refuses(H('Projects/app/src'));
});

test('Linux rules list caches, the AI model and report-only reviews', async () => {
  const items = (await Promise.all(linux.rules.map((r) => r({})))).flat();
  const ids = items.map((i) => i.id);
  for (const id of ['cache-google-chrome', 'cache-mozilla-firefox', 'devcache-pip', 'chrome-ai-model']) assert.ok(ids.includes(id), `missing ${id}: ${ids}`);
  const { rulesFor } = await import('../src/core/scan.js');
  assert.ok(!rulesFor({ reportOnly: false }).some((r) => r.reportOnly));
});

test('schedule writes a systemd timer and reads it back', async () => {
  const s = await linux.schedule.set({ mode: 'weekly', day: 1, hour: 9 });
  assert.equal(s.mode, 'weekly'); assert.equal(s.day, 1); assert.equal(s.hour, 9); assert.equal(s.warning, null);
  const timer = fs.readFileSync(H('.config/systemd/user/safe-sweep-check.timer'), 'utf8');
  assert.match(timer, /^OnCalendar=Mon \*-\*-\* 09:07:00$/m);
  const service = fs.readFileSync(H('.config/systemd/user/safe-sweep-check.service'), 'utf8');
  assert.match(service, /^ExecStart="[^"]+" "[^"]+safe-sweep\.js" check$/m);
  assert.equal(linux.schedule.describe(s), 'Every Monday at 09:07');

  const d = await linux.schedule.set({ mode: 'daily', hour: 23 });
  assert.equal(d.mode, 'daily'); assert.equal(d.hour, 23);

  const off = await linux.schedule.set({ mode: 'off' });
  assert.equal(off.mode, 'off');
  assert.ok(!fs.existsSync(H('.config/systemd/user/safe-sweep-check.timer')));
  const calls = fs.readFileSync(CALLS, 'utf8');
  assert.match(calls, /--user enable --now safe-sweep-check\.timer/);
  assert.match(calls, /--user disable --now safe-sweep-check\.timer/);
});

test('schedule refuses bad input before touching anything', async () => {
  await assert.rejects(linux.schedule.set({ mode: 'hourly' }), /Mode must be/);
  await assert.rejects(linux.schedule.set({ mode: 'daily', hour: 24 }), /Hour must be/);
});

test('menu entry is written and read back as current', async () => {
  let l = await linux.launchers.read();
  assert.equal(l.app.installed, false); assert.equal(l.shortcut, null);
  l = await linux.launchers.createApp();
  assert.equal(l.app.installed, true); assert.equal(l.app.current, true);
  const entry = fs.readFileSync(H('.local/share/applications/safe-sweep.desktop'), 'utf8');
  assert.match(entry, /^Exec=".+" ".+safe-sweep\.js" ui$/m);
  assert.match(entry, /^Terminal=false$/m);
});
