// Linux-only rules. Shared rules live in src/core/rules.js.
// Linux apps keep their caches in ~/.cache/<app> (the XDG cache folder).

import path from 'node:path';
import { HOME, du, duMany, ls, exists, running } from '../../core/util.js';
import { item } from '../../core/rules.js';

const H = (...p) => path.join(HOME, ...p);
const CACHE = (...p) => H('.cache', ...p);

// Anchored to each app's own binary, so a shell or editor that merely mentions the
// name doesn't count as the app running. Covers distro packages and snaps.
const APPS = {
  chrome: { name: 'Chrome', pattern: '^/opt/google/chrome/chrome( |$)' },
  chromium: { name: 'Chromium', pattern: '/chromium(-browser)?/(chromium|chromium-browser|chrome)( |$)' },
  firefox: { name: 'Firefox', pattern: '/firefox(-esr)?/firefox(-bin|-esr)?( |$)' },
  spotify: { name: 'Spotify', pattern: '/spotify/spotify( |$)' },
};

export async function blockedBy(...apps) {
  for (const a of apps) if (await running(APPS[a].pattern)) return `Quit ${APPS[a].name} first`;
  return null;
}

async function appGuard(...apps) {
  return { apps, blocked: await blockedBy(...apps) };
}

// ---------- App and developer caches ----------

// Each name here is a folder in ~/.cache, and ALLOW below lists exactly these.
const APP_CACHES = [
  { name: 'google-chrome', title: 'Chrome cache', app: 'chrome' },
  { name: 'chromium', title: 'Chromium cache', app: 'chromium' },
  { name: 'mozilla/firefox', title: 'Firefox cache', app: 'firefox' },
  { name: 'spotify', title: 'Spotify cache', app: 'spotify', cost: 'Offline playlists re-download. Use wifi.' },
  { name: 'thumbnails', title: 'Image thumbnails', cost: 'Your file manager redraws them as you browse.' },
];
const DEV_CACHES = [
  ['ms-playwright', 'Playwright browsers', 'Reinstall with npx playwright install.'],
  ['puppeteer', 'Puppeteer Chromium', ''],
  ['Cypress', 'Cypress app', 'Reinstall with npx cypress install.'],
  ['codex-runtimes', 'Codex runtimes', 'Codex re-downloads on next use.'],
  ['prisma', 'Prisma engines', 'Run prisma generate again in Prisma projects.'],
  ['firebase', 'Firebase CLI cache', ''],
  ['pip', 'pip download cache', ''],
  ['node-gyp', 'node-gyp headers', ''],
  ['electron', 'Electron downloads', ''],
  ['typescript', 'TypeScript type cache', ''],
];

async function appCaches() {
  const out = [];
  for (const c of APP_CACHES) {
    const dir = CACHE(c.name);
    if (!(await exists(dir))) continue;
    out.push(item({ id: `cache-${c.name.replace('/', '-')}`, tier: 'safe', title: c.title, bytes: await du(dir), paths: [dir],
      detail: 'App cache. The app rebuilds it.', cost: c.cost || '',
      ...(c.app ? await appGuard(c.app) : {}), action: { kind: 'empty', dir } }));
  }
  for (const [name, title, cost] of DEV_CACHES) {
    const p = CACHE(name);
    if (!(await exists(p))) continue;
    out.push(item({ id: `devcache-${name}`, tier: 'safe', title, bytes: await du(p), paths: [p],
      detail: 'Developer tool cache.', cost, action: { kind: 'rm', paths: [p] } }));
  }
  return out;
}

// ---------- Reinstall-cost items ----------

async function reinstallItems() {
  const out = [];
  // Chrome's on-device AI model, in Chrome's data folder and any extra profile folder.
  for (const [dir, app, name] of [['google-chrome', 'chrome', 'Chrome'], ['chromium', 'chromium', 'Chromium']]) {
    const root = H('.config', dir);
    const models = [path.join(root, 'OptGuideOnDeviceModel'), ...(await ls(root)).map((n) => path.join(root, n, 'OptGuideOnDeviceModel'))];
    const present = [];
    for (const p of models) if (await exists(p)) present.push(p);
    if (!present.length) continue;
    out.push(item({ id: `${app}-ai-model`, tier: 'reinstall', title: `${name} on-device AI model`, bytes: await duMany(present), paths: present,
      detail: `${name}’s local AI model.`,
      cost: `${name} may download it again. Turn off "Enables optimization guide on device" in chrome://flags to stop that.`,
      ...(await appGuard(app)), action: { kind: 'rm', paths: present } }));
  }
  return out;
}

// ---------- Report only ----------

// Most of these are only listed, with steps to clear them by hand. A few can be deleted
// here once ticked: those carry a warning that the page shows before it deletes.
const BY_HAND_FILES = 'Open it in your file manager and sort by size. Select what you don’t need and press Shift+Delete to delete it right away, without the Trash.';

async function reviewItems() {
  const list = [
    { p: H('.local/share/Trash'), title: 'Trash', detail: 'Files you deleted still take space until the Trash is emptied.',
      warning: 'Empties the Trash for good. You can’t restore these files after this.', action: { kind: 'trash' } },
    { p: H('Downloads'), title: 'Downloads', detail: 'Usually mostly disposable.', howTo: BY_HAND_FILES },
    { p: H('Videos'), title: 'Videos folder', detail: 'Camera originals are irreplaceable.',
      howTo: `Copy anything you want to keep to an external drive and check the copy first. ${BY_HAND_FILES}` },
    { p: H('.nvm/versions'), title: 'Node versions (nvm)', detail: 'A project’s .nvmrc may pin an old version.',
      howTo: 'List the versions, then run nvm uninstall <version> for each one you don’t need. Keep the one marked default.', cmd: 'nvm ls' },
    { p: H('.rbenv/versions'), title: 'Ruby versions (rbenv)', detail: 'A project’s .ruby-version may pin an old version.',
      howTo: 'List the versions, then run rbenv uninstall <version> for each one you don’t need.', cmd: 'rbenv versions' },
    { p: H('.local/share/flatpak'), title: 'Flatpak apps (yours)', detail: 'Runtimes no app uses any more can go.',
      howTo: 'Run this in a terminal.', cmd: 'flatpak uninstall --user --unused' },
    { p: '/var/lib/flatpak', title: 'Flatpak apps (system)', detail: 'Runtimes no app uses any more can go.',
      howTo: 'Run this in a terminal.', cmd: 'flatpak uninstall --unused' },
    { p: '/var/cache/apt/archives', title: 'apt package downloads', detail: 'Copies of packages that are already installed.',
      howTo: 'Run this in a terminal. It asks for your password.', cmd: 'sudo apt clean' },
    { p: '/var/cache/dnf', title: 'dnf package cache', detail: 'Copies of packages that are already installed.',
      howTo: 'Run this in a terminal. It asks for your password.', cmd: 'sudo dnf clean all' },
    { p: '/var/cache/pacman/pkg', title: 'pacman package cache', detail: 'Old package versions kept for downgrades.',
      howTo: 'Run this in a terminal to keep only the last three versions. It asks for your password.', cmd: 'sudo paccache -r' },
    { p: '/var/lib/snapd/snaps', title: 'Snap packages', detail: 'Old versions are kept for rollback.',
      howTo: 'Run this in a terminal to keep fewer old versions. Snap drops the extras at its next refresh.', cmd: 'sudo snap set system refresh.retain=2' },
    { p: '/var/log/journal', title: 'System journal', detail: 'System logs.',
      howTo: 'Run this in a terminal to drop logs older than two weeks. It asks for your password.', cmd: 'sudo journalctl --vacuum-time=2weeks' },
  ];
  const out = [];
  for (const { p, detail, ...rest } of list) {
    if (!(await exists(p))) continue;
    const bytes = await du(p);
    if (bytes === 0) continue;
    out.push(item({ id: `rv:${p}`, tier: 'review', bytes, paths: [p], action: { kind: 'reveal', path: p }, ...rest,
      detail: bytes === null ? `${detail} (Couldn’t measure: you may not have read access.)` : detail }));
  }
  const loose = (await ls(HOME)).filter((n) => /\.(deb|rpm)$/i.test(n)).map((n) => H(n));
  if (loose.length) {
    out.push(item({ id: 'rv:loose-installers', tier: 'review', title: 'Installers in your home folder', bytes: await duMany(loose), paths: loose,
      detail: 'Probably already installed.',
      warning: 'Deletes these installer files for good. They don’t go to the Trash. Check each package is installed first.',
      action: { kind: 'rm', paths: loose } }));
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The only places this tool deletes on Linux, relative to home (plus the shared list).
// Named folders only: ~/.cache also holds things that are not safe to drop.
export const ALLOW = [
  new RegExp(`^\\.cache\\/(${[...APP_CACHES.map((c) => c.name), ...DEV_CACHES.map(([n]) => n)].map(esc).join('|')})$`),
  /^\.config\/(google-chrome|chromium)\/([^/]+\/)?OptGuideOnDeviceModel$/,
  /^[^/]+\.(deb|rpm)$/i, // installers sitting directly in home, nowhere deeper
];
// Never on Linux, even if a pattern above matches. The Trash is emptied with gio, never by path.
export const DENY = [
  /(^|\/)\.local\/share\/Trash(\/|$)/, /(^|\/)\.ssh(\/|$)/, /(^|\/)\.gnupg(\/|$)/,
  /whatsapp/i, /(^|\/)(Dropbox|Nextcloud|ownCloud|OneDrive|pCloudDrive|Google Drive|MEGA)(\/|$)/,
];

// Scheduled checks skip these: they only list things to review.
reviewItems.reportOnly = true;

export const RULES = [appCaches, reinstallItems, reviewItems];
