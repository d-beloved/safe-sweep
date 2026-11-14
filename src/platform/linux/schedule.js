// A systemd user timer runs the scheduled check. The unit files are the single source of
// truth: the page and the CLI read them back, so what you see is what's installed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, STATE_DIR, run, exists, has } from '../../core/util.js';
import { BIN, DAYS, MINUTE, checkInput, describe } from '../../core/schedule.js';

export const UNIT = 'safe-sweep-check';
const DIR = path.join(HOME, '.config/systemd/user');
export const SERVICE = path.join(DIR, `${UNIT}.service`);
export const TIMER = path.join(DIR, `${UNIT}.timer`);
export { describe };

const ctl = (...args) => run('systemctl', ['--user', ...args], { timeout: 20_000 });
// systemd reads % as a specifier and splits on spaces: quote each word, double each %.
const word = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
const pad = (n) => String(n).padStart(2, '0');

export async function readSchedule() {
  if (!(await exists(TIMER))) return { mode: 'off' };
  const timer = await fs.readFile(TIMER, 'utf8');
  const service = await fs.readFile(SERVICE, 'utf8').catch(() => '');
  const m = timer.match(/^OnCalendar=(?:(\w{3}) )?\*-\*-\* (\d{1,2}):/m);
  const hour = m ? Number(m[2]) : 10;
  const day = m?.[1] ? DAYS.findIndex((d) => d.startsWith(m[1])) : null;
  const active = (await ctl('is-active', `${UNIT}.timer`)).stdout.trim() === 'active';
  const nodePath = (service.match(/^ExecStart="([^"]+)"/m) || [])[1];
  const nodeOk = nodePath ? await exists(nodePath) : false;
  return {
    mode: day === null ? 'daily' : 'weekly',
    day: day === null || day < 0 ? null : day,
    hour,
    loaded: active,
    warning: !active ? 'Saved but not running. Set it again.' : !nodeOk ? 'The Node version it uses is gone. Set it again.' : null,
  };
}

export async function setSchedule(input) {
  const { mode, day, hour } = checkInput(input);
  if (!(await has('systemctl'))) throw new Error('Scheduling needs systemd, and systemctl isn’t available here.');

  await ctl('disable', '--now', `${UNIT}.timer`); // fine if nothing was installed
  if (mode === 'off') {
    await fs.rm(TIMER, { force: true });
    await fs.rm(SERVICE, { force: true });
    await ctl('daemon-reload');
    return readSchedule();
  }
  const log = path.join(STATE_DIR, 'check.log');
  const when = `${mode === 'weekly' ? DAYS[day].slice(0, 3) + ' ' : ''}*-*-* ${pad(hour)}:${pad(MINUTE)}:00`;
  await fs.mkdir(DIR, { recursive: true });
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(SERVICE, `[Unit]
Description=Safe Sweep scheduled check

[Service]
Type=oneshot
ExecStart=${word(process.execPath)} ${word(BIN)} check
StandardOutput=append:${log.replace(/%/g, '%%')}
StandardError=append:${log.replace(/%/g, '%%')}
`);
  await fs.writeFile(TIMER, `[Unit]
Description=Run the Safe Sweep check on a schedule

[Timer]
OnCalendar=${when}
Persistent=true

[Install]
WantedBy=timers.target
`);
  await ctl('daemon-reload');
  const r = await ctl('enable', '--now', `${UNIT}.timer`);
  if (!r.ok) throw new Error(`systemctl couldn't start the schedule: ${r.stderr.trim() || r.code}`);
  return readSchedule();
}
