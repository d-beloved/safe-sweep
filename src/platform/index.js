// Picks the code for the OS this runs on. Each platform module exports the same shape:
//
//   id, name, fileManager
//   rules        array of async (cfg) => items[]   (added to the shared rules)
//                set rule.reportOnly = true on rules that only list things to review;
//                scheduled checks skip them
//   allow, deny  RegExp[] matched against paths relative to home
//   blockedBy(...appKeys)  returns "Quit X first" or null
//   notify(title, message), reveal(path), openUrl(url)
//   schedule     { read, set, describe } or null if not supported yet
//   launchers    { read, createApp, createShortcut } or null
//
// SAFE_SWEEP_PLATFORM forces a platform module. It exists for development and tests;
// forcing one OS's rules onto another is not safe on a real machine.

const SUPPORTED = { darwin: './darwin/index.js' };

const id = process.env.SAFE_SWEEP_PLATFORM || process.platform;
export const platform = SUPPORTED[id] ? (await import(SUPPORTED[id])).default : null;
export const SUPPORTED_IDS = Object.keys(SUPPORTED);
