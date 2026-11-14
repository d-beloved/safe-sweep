import path from 'node:path';
import { run, has } from '../../core/util.js';
import * as rules from './rules.js';
import * as schedule from './schedule.js';
import * as launchers from './launchers.js';

export default {
  id: 'linux',
  name: 'Linux',
  fileManager: 'your file manager',
  rules: rules.RULES,
  allow: rules.ALLOW,
  deny: rules.DENY,
  blockedBy: rules.blockedBy,
  notify: async (title, message) => { if (await has('notify-send')) await run('notify-send', ['--app-name=Safe Sweep', title, message]); },
  // xdg-open can't select a file, so open the folder it sits in.
  reveal: (p) => run('xdg-open', [path.dirname(p)]),
  openUrl: (u) => run('xdg-open', [u]),
  schedule: { read: schedule.readSchedule, set: schedule.setSchedule, describe: schedule.describe },
  launchers: { read: launchers.readLaunchers, createApp: launchers.createApp },
};
