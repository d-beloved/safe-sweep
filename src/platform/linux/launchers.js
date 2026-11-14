// A menu entry, so Safe Sweep opens from your app launcher without a terminal.
// State is read from disk each time, so the page always shows what's really installed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME } from '../../core/util.js';
import { BIN } from '../../core/schedule.js';

export const DESKTOP_FILE = path.join(HOME, '.local/share/applications/safe-sweep.desktop');

// Desktop entry Exec rules: quote each argument; inside quotes escape " ` $ and \.
// Then the whole value is unescaped once more, so backslashes double again. % must be %%.
const arg = (s) => `"${String(s).replace(/([\\"`$])/g, '\\$1').replace(/\\/g, '\\\\').replace(/%/g, '%%')}"`;
const execLine = () => `${arg(process.execPath)} ${arg(BIN)} ui`;

export async function readLaunchers() {
  const src = await fs.readFile(DESKTOP_FILE, 'utf8').catch(() => null);
  return {
    app: { installed: !!src, current: !!src && src.includes(`Exec=${execLine()}\n`), path: src ? DESKTOP_FILE : null,
      folder: src ? path.dirname(DESKTOP_FILE).replace(HOME, '~') : null, legacy: null,
      text: { title: 'Menu entry', hint: 'Opens from your app launcher.',
        create: 'Add to menu', again: 'Update entry', stale: 'Update entry' } },
    shortcut: null,
  };
}

export async function createApp() {
  await fs.mkdir(path.dirname(DESKTOP_FILE), { recursive: true });
  await fs.writeFile(DESKTOP_FILE, `[Desktop Entry]
Type=Application
Name=Safe Sweep
Comment=Free disk space safely
Exec=${execLine()}
Icon=user-trash-full
Terminal=false
Categories=Utility;System;
`);
  return readLaunchers();
}
