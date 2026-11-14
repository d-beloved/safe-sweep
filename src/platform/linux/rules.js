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

async function reviewItems() {
  const list = [
    [H('.local/share/Trash'), 'Trash', 'Deleted files still take space until you empty the Trash in your file manager.'],
    [H('Downloads'), 'Downloads', 'Usually mostly disposable. Sort by size in your file manager.'],
    [H('Videos'), 'Videos folder', 'Camera originals are irreplaceable. Copy to an external drive and check the copy before deleting.'],
    [H('.nvm/versions'), 'Node versions (nvm)', 'Old versions may be pinned by a project’s .nvmrc. Check with nvm ls first.'],
    [H('.rbenv/versions'), 'Ruby versions (rbenv)', 'Check rbenv versions before removing one.'],
    [H('.local/share/flatpak'), 'Flatpak apps (yours)', 'Run flatpak uninstall --unused to remove runtimes no app uses.'],
    ['/var/lib/flatpak', 'Flatpak apps (system)', 'Run flatpak uninstall --unused to remove runtimes no app uses.'],
    ['/var/cache/apt/archives', 'apt package downloads', 'Packages already installed. Run sudo apt clean to remove them.'],
    ['/var/cache/dnf', 'dnf package cache', 'Run sudo dnf clean all to remove it.'],
    ['/var/cache/pacman/pkg', 'pacman package cache', 'Run sudo paccache -r to keep only the last three versions.'],
    ['/var/lib/snapd/snaps', 'Snap packages', 'Old versions are kept for rollback. Run sudo snap set system refresh.retain=2 to keep fewer.'],
    ['/var/log/journal', 'System journal', 'Run sudo journalctl --vacuum-time=2weeks to drop older logs.'],
  ];
  const out = [];
  for (const [p, title, detail] of list) {
    if (!(await exists(p))) continue;
    const bytes = await du(p);
    if (bytes === 0) continue;
    out.push(item({ id: `rv:${p}`, tier: 'review', title, bytes, paths: [p],
      detail: bytes === null ? `${detail} (Couldn’t measure: you may not have read access.)` : detail,
      action: { kind: 'reveal', path: p } }));
  }
  const loose = (await ls(HOME)).filter((n) => /\.(deb|rpm)$/i.test(n)).map((n) => H(n));
  if (loose.length) {
    out.push(item({ id: 'rv:loose-installers', tier: 'review', title: 'Installers in your home folder', bytes: await duMany(loose), paths: loose,
      detail: 'Probably already installed. Check, then move to the Trash.', action: { kind: 'reveal', path: loose[0] } }));
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The only places this tool deletes on Linux, relative to home (plus the shared list).
// Named folders only: ~/.cache also holds things that are not safe to drop.
export const ALLOW = [
  new RegExp(`^\\.cache\\/(${[...APP_CACHES.map((c) => c.name), ...DEV_CACHES.map(([n]) => n)].map(esc).join('|')})$`),
  /^\.config\/(google-chrome|chromium)\/([^/]+\/)?OptGuideOnDeviceModel$/,
];
// Never on Linux, even if a pattern above matches.
export const DENY = [
  /(^|\/)\.local\/share\/Trash(\/|$)/, /(^|\/)\.ssh(\/|$)/, /(^|\/)\.gnupg(\/|$)/,
  /whatsapp/i, /(^|\/)(Dropbox|Nextcloud|ownCloud|OneDrive|pCloudDrive|Google Drive|MEGA)(\/|$)/,
];

// Scheduled checks skip these: they only list things to review.
reviewItems.reportOnly = true;

export const RULES = [appCaches, reinstallItems, reviewItems];
