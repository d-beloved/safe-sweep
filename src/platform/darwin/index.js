import { run } from '../../core/util.js';
import * as rules from './rules.js';
import * as schedule from './schedule.js';
import * as launchers from './launchers.js';

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export default {
  id: 'darwin',
  name: 'macOS',
  fileManager: 'Finder',
  rules: rules.RULES,
  allow: rules.ALLOW,
  deny: rules.DENY,
  blockedBy: rules.blockedBy,
  notify: (title, message) => run('osascript', ['-e', `display notification ${q(message)} with title ${q(title)}`]),
  reveal: (p) => run('open', ['-R', p]),
  openUrl: (u) => run('open', [u]),
  schedule: { read: schedule.readSchedule, set: schedule.setSchedule, describe: schedule.describe },
  launchers: { read: launchers.readLaunchers, createApp: launchers.createApp, createShortcut: launchers.createShortcut },
};
