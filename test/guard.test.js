// The delete guard is the part of mac-sweep that has to be right.
// These tests build a throwaway home folder and check what the guard allows and refuses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-sweep-test-'));
process.env.HOME = FAKE; // must be set before the modules load: they read HOME at import

const mk = (rel) => fs.mkdirSync(path.join(FAKE, rel), { recursive: true });
let guard, cfg;

before(async () => {
  mk('Library/Caches/Google');
  mk('Library/Group Containers/group.net.whatsapp.WhatsApp.shared');
  mk('Library/Application Support/Google/Chrome/Default/OptGuideOnDeviceModel');
  mk('Library/Application Support/Google/Chrome/OptGuideOnDeviceModel');
  mk('Library/Application Support/Cursor/User/globalStorage');
  mk('Library/CloudStorage/GoogleDrive-x/Library/Caches/thing');
  mk('Movies');
  mk('Projects/app/node_modules');
  mk('Projects/app/src');
  mk('Projects/app/.git');
  mk('Projects/app/_to_delete');
  mk('elsewhere/node_modules');
  mk('Library/Application Support/Claude/vm_bundles/claudevm.bundle');
  mk('Downloads');
  mk('.Trash');
  for (const f of ['Setup.dmg', 'Tool.pkg', 'Downloads/Other.dmg', 'notes.txt']) fs.writeFileSync(path.join(FAKE, f), 'x');
  fs.symlinkSync(path.join(FAKE, 'Movies'), path.join(FAKE, 'Linked.dmg'));
  fs.symlinkSync(path.join(FAKE, 'Movies'), path.join(FAKE, 'Library/Caches/evil'));
  fs.symlinkSync(path.join(FAKE, 'Movies'), path.join(FAKE, 'Projects/app/linked'));
  fs.mkdirSync(path.join(FAKE, 'Movies/node_modules'));

  // Load the macOS lists directly so these tests run on any OS (including CI on Linux).
  const { makeGuard } = await import('../src/core/guard.js');
  const core = await import('../src/core/rules.js');
  const mac = await import('../src/platform/darwin/rules.js');
  guard = makeGuard({ allow: [...core.ALLOW, ...mac.ALLOW], deny: [...core.DENY, ...mac.DENY] });
  cfg = { projectRoots: [path.join(FAKE, 'Projects')] };
});

after(() => fs.rmSync(FAKE, { recursive: true, force: true }));

const H = (rel) => path.join(FAKE, rel);
const allows = async (p) => { await guard(p, cfg); };
const refuses = async (p) => { await assert.rejects(guard(p, cfg), /Refused/); };

test('allows caches, logs and known leftovers (macOS lists)', async () => {
  await allows(H('Library/Caches/Google'));
  await allows(H('Library/Application Support/Google/Chrome/OptGuideOnDeviceModel'));
  await allows(H('Library/Application Support/Google/Chrome/Default/OptGuideOnDeviceModel'));
});

test('allows node_modules and _to_delete only inside a project root', async () => {
  await allows(H('Projects/app/node_modules'));
  await allows(H('Projects/app/_to_delete'));
  await refuses(H('elsewhere/node_modules'));
});

test('refuses your files and project sources', async () => {
  await refuses(H('Movies'));
  await refuses(H('Projects/app/src'));
  await refuses(H('Projects/app/.git'));
  await refuses(H('Projects/app'));
  await refuses(FAKE);
});

test('refuses WhatsApp, cloud storage and Cursor’s live database even under allowed patterns', async () => {
  await refuses(H('Library/Group Containers/group.net.whatsapp.WhatsApp.shared'));
  await refuses(H('Library/CloudStorage/GoogleDrive-x/Library/Caches/thing'));
  await refuses(H('Library/Application Support/Cursor/User/globalStorage/state.vscdb'));
});

test('refuses symlinks and paths that escape through one', async () => {
  await refuses(H('Library/Caches/evil'));
  await refuses(H('Projects/app/linked/node_modules')); // resolves into ~/Movies
});

test('refuses relative, unnormalised and outside-home paths', async () => {
  await refuses('Library/Caches/Google');
  await refuses(H('Library/Caches/../../Movies'));
  await refuses('/etc');
  await refuses('/');
});

test('allows the Your call items it can delete, and refuses their neighbours', async () => {
  await allows(H('Library/Application Support/Claude/vm_bundles'));
  await allows(H('Setup.dmg'));
  await allows(H('Tool.pkg'));
  await refuses(H('Library/Application Support/Claude'));
  await refuses(H('Library/Application Support/Claude/vm_bundles/claudevm.bundle'));
  await refuses(H('Downloads/Other.dmg')); // only installers sitting directly in home
  await refuses(H('Downloads'));
  await refuses(H('notes.txt'));
  await refuses(H('Linked.dmg')); // a symlink, even with an installer's name
  await refuses(H('.Trash')); // emptied through Finder, never by path
});
