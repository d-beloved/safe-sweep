// macOS-only rules. Shared rules live in src/core/rules.js.

import path from 'node:path';
import { HOME, du, duMany, ls, exists, running } from '../../core/util.js';
import { item } from '../../core/rules.js';

const H = (...p) => path.join(HOME, ...p);
const LIB = (...p) => H('Library', ...p);

// Anchored to the app's main binary, so a shell or editor that merely mentions the
// path doesn't count as the app running. Covers /Applications and ~/Applications.
const appRe = (bundle) => `^(/Users/[^/]+)?/Applications/${bundle.replace(/\./g, '\\.')}\\.app/Contents/MacOS/`;
const APPS = {
  chrome: { name: 'Chrome', pattern: appRe('Google Chrome') },
  spotify: { name: 'Spotify', pattern: appRe('Spotify') },
  cursor: { name: 'Cursor', pattern: appRe('Cursor') },
  codex: { name: 'Codex', pattern: appRe('Codex') },
  claude: { name: 'Claude', pattern: appRe('Claude') },
};

export async function blockedBy(...apps) {
  for (const a of apps) if (await running(APPS[a].pattern)) return `Quit ${APPS[a].name} first`;
  return null;
}

// Spread into an item: records which apps must be closed, so cleaning can re-check.
async function appGuard(...apps) {
  return { apps, blocked: await blockedBy(...apps) };
}

// ---------- App and developer caches ----------

async function appCaches() {
  const out = [];
  const caches = [
    { id: 'cache-chrome', dir: LIB('Caches/Google'), title: 'Chrome cache', app: 'chrome' },
    { id: 'cache-spotify', dir: LIB('Caches/com.spotify.client'), title: 'Spotify cache', app: 'spotify', cost: 'Offline playlists re-download. Use wifi.' },
    { id: 'cache-codex', dir: LIB('Caches/com.openai.codex'), title: 'Codex cache', app: 'codex' },
    { id: 'cache-playwright', dir: LIB('Caches/ms-playwright'), title: 'Playwright browsers', cost: 'Reinstall with npx playwright install.' },
  ];
  for (const c of caches) {
    if (!(await exists(c.dir))) continue;
    out.push(item({ id: c.id, tier: 'safe', title: c.title, bytes: await du(c.dir), paths: [c.dir],
      detail: 'App cache. The app rebuilds it.', cost: c.cost || '',
      ...(c.app ? await appGuard(c.app) : {}), action: { kind: 'empty', dir: c.dir } }));
  }
  const shipit = (await ls(LIB('Caches'))).filter((n) => n.endsWith('.ShipIt')).map((n) => LIB('Caches', n));
  if (shipit.length) {
    out.push(item({ id: 'cache-shipit', tier: 'safe', title: 'App updater leftovers (.ShipIt)', bytes: await duMany(shipit), paths: shipit,
      detail: 'Staging folders from app updates that already installed.', action: { kind: 'rm', paths: shipit } }));
  }
  const devCaches = [
    ['puppeteer', 'Puppeteer Chromium', ''],
    ['codex-runtimes', 'Codex runtimes', 'Codex re-downloads on next use.'],
    ['prisma', 'Prisma engines', 'Run prisma generate again in Prisma projects.'],
    ['firebase', 'Firebase CLI cache', ''],
  ];
  for (const [name, title, cost] of devCaches) {
    const p = H('.cache', name);
    if (!(await exists(p))) continue;
    out.push(item({ id: `devcache-${name}`, tier: 'safe', title, bytes: await du(p), paths: [p],
      detail: 'Developer tool cache.', cost, action: { kind: 'rm', paths: [p] } }));
  }
  const logs = LIB('Logs');
  if (await exists(logs)) {
    out.push(item({ id: 'user-logs', tier: 'safe', title: 'Your app logs', bytes: await du(logs), paths: [logs],
      detail: 'Log files written by apps. Useful only when debugging a crash.', cost: 'Old crash details are gone.',
      action: { kind: 'empty', dir: logs } }));
  }
  const cursorBak = LIB('Application Support/Cursor/User/globalStorage/state.vscdb.backup');
  if (await exists(cursorBak)) {
    out.push(item({ id: 'cursor-backup', tier: 'safe', title: 'Cursor database backup', bytes: await du(cursorBak), paths: [cursorBak],
      detail: 'A stale copy. Cursor keeps the live database beside it.', ...(await appGuard('cursor')),
      action: { kind: 'rm', paths: [cursorBak] } }));
  }
  const installers = [
    ...(await ls(LIB('Application Support/Adobe/com.adobe.ARMDC.ARM'))).filter((n) => n.endsWith('.pkg')).map((n) => LIB('Application Support/Adobe/com.adobe.ARMDC.ARM', n)),
    LIB('Application Support/com.docker.install'),
  ];
  const presentInstallers = [];
  for (const p of installers) if (await exists(p)) presentInstallers.push(p);
  if (presentInstallers.length) {
    out.push(item({ id: 'installers', tier: 'safe', title: 'Installer leftovers (Adobe, Docker)', bytes: await duMany(presentInstallers), paths: presentInstallers,
      detail: 'Installer packages for apps that are already installed.', action: { kind: 'rm', paths: presentInstallers } }));
  }
  return out;
}

// ---------- Reinstall-cost items ----------

async function reinstallItems() {
  const out = [];
  // Chrome's on-device AI model. It sits in Chrome's data folder, and again in any extra
  // data folder a tool launched Chrome with (--user-data-dir inside Chrome's folder).
  const chromeRoot = LIB('Application Support/Google/Chrome');
  const models = [path.join(chromeRoot, 'OptGuideOnDeviceModel'),
    ...(await ls(chromeRoot)).map((n) => path.join(chromeRoot, n, 'OptGuideOnDeviceModel'))];
  const presentModels = [];
  for (const p of models) if (await exists(p)) presentModels.push(p);
  if (presentModels.length) {
    out.push(item({ id: 'chrome-ai-model', tier: 'reinstall', title: 'Chrome on-device AI model', bytes: await duMany(presentModels), paths: presentModels,
      detail: presentModels.length > 1 ? `Chrome’s local AI model, found in ${presentModels.length} Chrome data folders.` : 'Chrome’s local AI model.',
      cost: 'Chrome may download it again. Turn off "Enables optimization guide on device" in chrome://flags to stop that.',
      ...(await appGuard('chrome')), action: { kind: 'rm', paths: presentModels } }));
  }
  return out;
}

// ---------- Docker Desktop's disk file ----------

async function dockerDisk() {
  const raw = LIB('Containers/com.docker.docker');
  if (!(await exists(raw))) return [];
  return [item({ id: 'docker-disk', tier: 'review', title: 'Docker virtual disk', bytes: await du(raw),
    detail: 'Pruning frees space inside this file. It may not shrink on your real disk until Docker Desktop restarts. Images and volumes are not touched by this tool: with zero containers, Docker treats all of them as unused.',
    howTo: 'List your images, remove the ones you no longer use with docker rmi, then quit and reopen Docker Desktop. Troubleshoot → Clean / Purge data in Docker Desktop empties it completely, including every image, container and volume.',
    cmd: 'docker images',
    paths: [raw], action: { kind: 'reveal', path: raw } })];
}

// ---------- Your call ----------
// Most of these are only listed, with steps to clear them by hand. A few can be deleted
// here once ticked: those carry a warning that the page shows before it deletes.

const BY_HAND_FINDER = 'Open it in Finder, choose View → as List and sort by Size. Select what you don’t need and press Option-Command-Delete to delete it right away, without the Trash.';

async function reviewItems() {
  const list = [
    { p: LIB('Group Containers/group.net.whatsapp.WhatsApp.shared'), title: 'WhatsApp media and chats',
      detail: 'Your chat database is inside. This tool never deletes it.',
      howTo: 'In WhatsApp, go to Settings → Storage and Data → Manage Storage and delete large media there. Set media auto-download to Never so it doesn’t fill up again.' },
    { p: LIB('Application Support/Cursor/User/globalStorage/state.vscdb'), title: 'Cursor live database',
      detail: 'Holds your Cursor chat history. This tool never deletes it.',
      howTo: 'Delete old chats inside Cursor. Don’t delete the file itself.' },
    { p: H('Movies'), title: 'Movies folder', detail: 'Camera originals are irreplaceable.',
      howTo: `Copy anything you want to keep to an external drive and check the copy first. ${BY_HAND_FINDER}` },
    { p: H('Downloads'), title: 'Downloads', detail: 'Usually mostly disposable.', howTo: BY_HAND_FINDER },
    { p: H('.nvm/versions'), title: 'Node versions (nvm)', detail: 'A project’s .nvmrc may pin an old version.',
      howTo: 'List the versions, then run nvm uninstall <version> for each one you don’t need. Keep the one marked default.', cmd: 'nvm ls' },
    { p: H('.rbenv/versions'), title: 'Ruby versions (rbenv)', detail: 'A project’s .ruby-version may pin an old version.',
      howTo: 'List the versions, then run rbenv uninstall <version> for each one you don’t need.', cmd: 'rbenv versions' },
    { p: LIB('Application Support/Claude/vm_bundles'), title: 'Claude desktop VM image',
      detail: 'The disk image Claude uses for local sessions.', ...(await appGuard('claude')),
      warning: 'Claude downloads this again the next time it starts a local session.',
      action: { kind: 'rm', paths: [LIB('Application Support/Claude/vm_bundles')] } },
    { p: H('.Trash'), title: 'Trash', detail: 'Files you deleted in Finder still take space until the Trash is emptied.',
      warning: 'Empties the Trash for good, on every drive. Put Back won’t work after this. The first time, macOS asks to let Safe Sweep control Finder.',
      action: { kind: 'trash' } },
  ];
  const out = [];
  for (const { p, detail, ...rest } of list) {
    if (!(await exists(p))) continue;
    const bytes = await du(p);
    out.push(item({ id: `rv:${p}`, tier: 'review', bytes, paths: [p], action: { kind: 'reveal', path: p }, ...rest,
      detail: bytes === null ? `${detail} (Couldn’t measure: Terminal may need Full Disk Access.)` : detail }));
  }
  // Loose installers in your home folder
  const loose = (await ls(HOME)).filter((n) => /\.(pkg|dmg)$/i.test(n)).map((n) => H(n));
  if (loose.length) {
    out.push(item({ id: 'rv:loose-installers', tier: 'review', title: 'Installers in your home folder', bytes: await duMany(loose), paths: loose,
      detail: 'Probably already installed.',
      warning: 'Deletes these installer files for good. They don’t go to the Trash. Check each app is installed first.',
      action: { kind: 'rm', paths: loose } }));
  }
  return out;
}

// The only places this tool deletes on macOS, relative to home (plus the shared list).
export const ALLOW = [
  /^Library\/Caches\/.+/,
  /^Library\/Logs$/,
  /^\.cache\/.+/,
  /^Library\/Application Support\/Cursor\/User\/globalStorage\/state\.vscdb\.backup$/,
  /^Library\/Application Support\/Adobe\/com\.adobe\.ARMDC\.ARM\/[^/]+\.pkg$/,
  /^Library\/Application Support\/com\.docker\.install$/,
  /^Library\/Application Support\/Google\/Chrome\/([^/]+\/)?OptGuideOnDeviceModel$/,
  /^Library\/Application Support\/Claude\/vm_bundles$/,
  /^[^/]+\.(pkg|dmg)$/i, // installers sitting directly in home, nowhere deeper
];
// Never on macOS, even if a pattern above matches.
export const DENY = [/group\.net\.whatsapp/i, /CloudStorage/, /Mobile Documents/];

// Report-only rules read private folders (WhatsApp, Docker). A scheduled check skips them:
// macOS asks before a background job reads another app's data, and the check doesn't need them.
dockerDisk.reportOnly = true;
reviewItems.reportOnly = true;

export const RULES = [appCaches, reinstallItems, dockerDisk, reviewItems];
