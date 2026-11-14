// One-click ways to open Safe Sweep without Terminal.
// State is read from disk each time, so the page always shows what's really installed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, STATE_DIR, run, exists, has } from '../../core/util.js';
import { BIN } from './schedule.js';

// Main Applications folder first: Spotlight indexes it reliably. Your own ~/Applications is the fallback.
const appPaths = (name) => [path.join('/Applications', name), path.join(HOME, 'Applications', name)];
export const APP_PATHS = appPaths('Safe Sweep.app');
const LEGACY_APP_PATHS = appPaths('Mac Sweep.app'); // built before the rename; points at the old folder

async function findApp(paths = APP_PATHS) {
  for (const p of paths) if (await exists(p)) return p;
  return null;
}
const SHORTCUT_NAME = 'Safe Sweep';
const LEGACY_SHORTCUT_NAME = 'Mac Sweep';

// Background the server so the launcher returns at once instead of hanging until the server stops.
const shellLine = () => `'${process.execPath}' '${BIN}' ui > /dev/null 2>&1 &`;
const appleString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function readLaunchers() {
  const appPath = await findApp();
  let appCurrent = false;
  if (appPath) {
    // The app stores the Node and script paths. If either moved, it needs rebuilding.
    const src = await run('osadecompile', [path.join(appPath, 'Contents/Resources/Scripts/main.scpt')], { timeout: 10_000 });
    appCurrent = src.ok && src.stdout.includes(process.execPath) && src.stdout.includes(BIN);
  }
  let shortcut = false, legacyShortcut = false;
  if (await has('shortcuts')) {
    const list = await run('shortcuts', ['list'], { timeout: 15_000 });
    const names = list.ok ? list.stdout.split('\n').map((l) => l.trim()) : [];
    shortcut = names.includes(SHORTCUT_NAME);
    legacyShortcut = names.includes(LEGACY_SHORTCUT_NAME);
  }
  const legacyApp = await findApp(LEGACY_APP_PATHS);
  return {
    app: { installed: !!appPath, current: appCurrent, path: appPath, folder: appPath ? path.dirname(appPath).replace(HOME, '~') : null,
      legacy: legacyApp ? legacyApp.replace(HOME, '~') : null,
      text: { title: 'Safe Sweep app', hint: 'Opens from Spotlight, Launchpad or the Dock.',
        create: 'Create app', again: 'Rebuild and show', stale: 'Rebuild app' } },
    shortcut: { installed: shortcut, available: await has('shortcuts'), legacy: legacyShortcut },
  };
}

async function compileTo(target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rm(target, { recursive: true, force: true }); // only ever our own launcher
  return run('osacompile', ['-o', target, '-e', `do shell script ${appleString(shellLine())}`]);
}

/**
 * A small AppleScript app. Rebuilt in place if it already exists (so a copy you moved stays put);
 * otherwise built in /Applications, falling back to ~/Applications if that folder isn't writable.
 */
export async function createApp() {
  const existing = await findApp();
  const targets = existing ? [existing] : APP_PATHS;
  let built = null, lastErr = '';
  for (const t of targets) {
    try {
      const r = await compileTo(t);
      if (r.ok) { built = t; break; }
      lastErr = r.stderr.trim();
    } catch (e) { lastErr = e.message; } // EACCES on /Applications: try the next folder
  }
  if (!built) throw new Error(`Couldn’t build the app: ${lastErr}`);
  // Nudge Spotlight to index it now rather than whenever it gets round to it.
  await run('mdimport', [built], { timeout: 20_000 });
  await run('open', ['-R', built]); // show it in Finder, ready to drag to the Dock
  return readLaunchers();
}

/**
 * Builds a one-action shortcut ("Run Shell Script"), signs it, and opens it.
 * Shortcuts then shows its own "Add Shortcut" dialog; nothing is added without your click.
 */
export async function createShortcut() {
  if (!(await has('shortcuts'))) throw new Error('The shortcuts command isn’t available on this Mac.');
  const dir = path.join(STATE_DIR, 'shortcut');
  await fs.mkdir(dir, { recursive: true });
  const raw = path.join(dir, 'unsigned.shortcut');
  const signed = path.join(dir, `${SHORTCUT_NAME}.shortcut`);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>WFWorkflowActions</key><array><dict>
    <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.runshellscript</string>
    <key>WFWorkflowActionParameters</key><dict>
      <key>Script</key><string>${esc(shellLine())}</string>
      <key>Shell</key><string>/bin/zsh</string>
    </dict>
  </dict></array>
  <key>WFWorkflowClientVersion</key><string>2302.0.4</string>
  <key>WFWorkflowIcon</key><dict>
    <key>WFWorkflowIconStartColor</key><integer>4292093695</integer>
    <key>WFWorkflowIconGlyphNumber</key><integer>59511</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key><array/>
  <key>WFWorkflowInputContentItemClasses</key><array/>
  <key>WFWorkflowMinimumClientVersion</key><integer>900</integer>
  <key>WFWorkflowTypes</key><array/>
</dict></plist>
`;
  await fs.writeFile(raw, xml);
  const conv = await run('plutil', ['-convert', 'binary1', raw]);
  if (!conv.ok) throw new Error(`plutil failed: ${conv.stderr.trim()}`);
  await fs.rm(signed, { force: true });
  const sign = await run('shortcuts', ['sign', '--mode', 'anyone', '--input', raw, '--output', signed], { timeout: 60_000 });
  if (!sign.ok || !(await exists(signed))) {
    throw new Error(`Couldn’t sign the shortcut: ${(sign.stderr || sign.stdout).trim() || 'unknown error'}. Use the Safe Sweep app instead.`);
  }
  await run('open', [signed]);
  return { opened: true };
}
