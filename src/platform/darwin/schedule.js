// The launchd plist is the single source of truth for the schedule.
// The page and the CLI both read it back, so what you see is what's installed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, STATE_DIR, run, exists } from '../../core/util.js';

export const LABEL = 'io.github.d-beloved.safe-sweep';
export const PLIST = path.join(HOME, 'Library/LaunchAgents', `${LABEL}.plist`);
// The job the tool installed before it was renamed. Read so it shows up; replaced on the next Save.
const LEGACY_LABEL = 'dev.morayodeji.mac-sweep';
const LEGACY_PLIST = path.join(HOME, 'Library/LaunchAgents', `${LEGACY_LABEL}.plist`);
export const BIN = fileURLToPath(new URL('../../../bin/safe-sweep.js', import.meta.url));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const domain = () => `gui/${process.getuid()}`;

export async function readSchedule() {
  const legacy = !(await exists(PLIST)) && (await exists(LEGACY_PLIST));
  const file = legacy ? LEGACY_PLIST : PLIST;
  const label = legacy ? LEGACY_LABEL : LABEL;
  if (!(await exists(file))) return { mode: 'off' };
  const xml = await fs.readFile(file, 'utf8');
  const num = (k) => { const m = xml.match(new RegExp(`<key>${k}</key>\\s*<integer>(\\d+)</integer>`)); return m ? Number(m[1]) : null; };
  const hour = num('Hour') ?? 10;
  const weekday = num('Weekday');
  const loaded = (await run('launchctl', ['print', `${domain()}/${label}`], { timeout: 10_000 })).ok;
  const nodePath = (xml.match(/<array><string>([^<]+)<\/string>/) || [])[1];
  const nodeOk = nodePath ? await exists(nodePath) : false;
  return {
    mode: weekday === null ? 'daily' : 'weekly',
    day: weekday === null ? null : weekday % 7,
    hour,
    loaded,
    legacy,
    warning: legacy ? 'Set by the old mac-sweep. Press Save to move it over.'
      : !loaded ? 'Saved but not loaded. Set it again.' : !nodeOk ? 'The Node version it uses is gone. Set it again.' : null,
  };
}

export async function setSchedule({ mode, day = 1, hour = 10 }) {
  // Check the input before touching anything installed.
  if (!['off', 'daily', 'weekly'].includes(mode)) throw new Error('Mode must be off, daily or weekly');
  hour = Math.trunc(Number(hour)); day = Math.trunc(Number(day));
  if (mode !== 'off' && !(hour >= 0 && hour <= 23)) throw new Error('Hour must be 0–23');
  if (mode === 'weekly' && !(day >= 0 && day <= 6)) throw new Error('Day must be 0 (Sunday) to 6 (Saturday)');

  await run('launchctl', ['bootout', domain(), PLIST]); // fine if nothing was loaded
  // Retire the pre-rename job so two schedules never run side by side.
  if (await exists(LEGACY_PLIST)) {
    await run('launchctl', ['bootout', domain(), LEGACY_PLIST]);
    await fs.rm(LEGACY_PLIST, { force: true });
  }
  if (mode === 'off') {
    await fs.rm(PLIST, { force: true });
    return readSchedule();
  }
  const interval = { Hour: hour, Minute: 7 };
  if (mode === 'weekly') interval.Weekday = day;
  const dict = Object.entries(interval).map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${BIN}</string><string>check</string></array>
  <key>StartCalendarInterval</key><dict>${dict}</dict>
  <key>StandardOutPath</key><string>${path.join(STATE_DIR, 'check.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(STATE_DIR, 'check.log')}</string>
</dict></plist>
`;
  await fs.mkdir(path.dirname(PLIST), { recursive: true });
  await fs.writeFile(PLIST, xml);
  const r = await run('launchctl', ['bootstrap', domain(), PLIST]);
  if (!r.ok) throw new Error(`launchctl couldn't load the schedule: ${r.stderr.trim() || r.code}`);
  return readSchedule();
}

export function describe(s) {
  if (s.mode === 'off') return 'Off';
  const t = `${String(s.hour).padStart(2, '0')}:07`;
  return s.mode === 'daily' ? `Every day at ${t}` : `Every ${DAYS[s.day]} at ${t}`;
}
