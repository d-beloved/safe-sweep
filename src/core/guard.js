// The delete guard. Every path is checked here right before it is removed.
// A path must match an ALLOW pattern, match no DENY pattern, stay allowed with
// symlinks resolved, and not be a symlink itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, tilde } from './util.js';

const PROJECT_FOLDERS = ['node_modules', '_to_delete'];

const realOr = (p) => fs.realpath(p).catch(() => p);

export function makeGuard({ allow, deny }) {
  function allowedRel(abs, home, roots) {
    if (!abs.startsWith(home + path.sep)) return false;
    const rel = path.relative(home, abs).split(path.sep).join('/'); // patterns use forward slashes
    if (deny.some((r) => r.test(rel))) return false;
    if (allow.some((r) => r.test(rel))) return true;
    // Inside a project root: only node_modules and _to_delete folders.
    return roots.some((root) => abs.startsWith(root + path.sep))
      && PROJECT_FOLDERS.includes(path.basename(abs));
  }

  return async function guard(p, cfg) {
    if (!path.isAbsolute(p) || p !== path.normalize(p)) throw new Error(`Refused: not a clean absolute path: ${p}`);
    if (!allowedRel(p, HOME, cfg.projectRoots)) throw new Error(`Refused: outside the allowlist: ${tilde(p)}`);
    const realParent = await fs.realpath(path.dirname(p));
    const real = path.join(realParent, path.basename(p));
    if (real !== p) {
      // Compare resolved with resolved: home or a project root may itself sit behind a symlink
      // (on macOS, /var is /private/var).
      const realHome = await realOr(HOME);
      const realRoots = await Promise.all(cfg.projectRoots.map(realOr));
      if (!allowedRel(real, realHome, realRoots)) throw new Error(`Refused: resolves outside the allowlist: ${tilde(real)}`);
    }
    // A target that is itself a symlink could point anywhere. Emptying it would follow the link.
    const st = await fs.lstat(p).catch(() => null);
    if (st?.isSymbolicLink()) throw new Error(`Refused: is a symlink: ${tilde(p)}`);
  };
}
