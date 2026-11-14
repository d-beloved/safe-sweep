// Shared by every platform's schedule: input checks, wording, and the script the job runs.
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../../bin/safe-sweep.js', import.meta.url));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MINUTE = 7; // off the hour, so it doesn't land with every other job

/** Check the input before touching anything installed. Returns clean numbers. */
export function checkInput({ mode, day = 1, hour = 10 }) {
  if (!['off', 'daily', 'weekly'].includes(mode)) throw new Error('Mode must be off, daily or weekly');
  hour = Math.trunc(Number(hour)); day = Math.trunc(Number(day));
  if (mode !== 'off' && !(hour >= 0 && hour <= 23)) throw new Error('Hour must be 0–23');
  if (mode === 'weekly' && !(day >= 0 && day <= 6)) throw new Error('Day must be 0 (Sunday) to 6 (Saturday)');
  return { mode, day, hour };
}

export function describe(s) {
  if (s.mode === 'off') return 'Off';
  const t = `${String(s.hour).padStart(2, '0')}:${String(MINUTE).padStart(2, '0')}`;
  return s.mode === 'daily' ? `Every day at ${t}` : `Every ${DAYS[s.day]} at ${t}`;
}
