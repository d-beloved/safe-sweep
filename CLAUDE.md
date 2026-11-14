# safe-sweep

A local tool that scans a developer's machine for disk space that can be freed safely, and deletes only what the user ticks and confirms. Plain Node (ES modules), no dependencies, no build step. macOS only for now; Linux next, then Windows.

## Commands

- `npm test`: runs `node --test` (guard, symlinked-home and CLI tests). Run it after every change.
- `npm start` or `safe-sweep`: starts the page at http://127.0.0.1:4777.
- `safe-sweep scan`: prints the scan without deleting anything. Safe to run while developing.
- `SAFE_SWEEP_PLATFORM=darwin HOME=<temp dir> node bin/safe-sweep.js ...`: run against a throwaway home. Use this for any manual test that cleans. Never clean against the real home while developing.

## Layout

See CONTRIBUTING.md. In short: `src/core` is shared, `src/platform/darwin` is macOS-only, and `src/platform/index.js` picks the platform and documents the interface each one exports.

## Rules for changes

This tool deletes files on people's machines. Treat anything that deletes as high risk.

- Every delete goes through `src/core/guard.js`. Never bypass it, and never widen `ALLOW` without a matching test in `test/`.
- A new delete rule needs the rule, an `ALLOW` pattern for exactly that path, and a test that its neighbours are refused.
- Never add `docker image prune -a`, `docker volume prune`, or anything touching user documents, chat data (WhatsApp), cloud-synced folders or `.git`.
- Prefer a tool's own cleanup command over deleting its folder, and add a `MEASURE` entry so results show real bytes freed.
- No network calls and no telemetry.
- The server must stay bound to 127.0.0.1 with the Host check and per-session token.
- User-facing text: plain English, short sentences, no hype.

## Status and next steps

1. **First run on a real Mac after the restructure.** The core/platform split, the rename from mac-sweep and the migration were tested only in a Linux sandbox with stand-ins for `launchctl`, `osacompile`, `shortcuts` and `docker`. Check: settings copied from `~/.mac-sweep`, the old schedule flagged and replaced on Save, the app and shortcut built under the new name, a real scan and clean.
2. **GitHub.** Push to `d-beloved/safe-sweep`, private first; make it public after step 1. Watch the first CI run (macOS and Ubuntu, Node 20 and 22).
3. **Linux platform** (`src/platform/linux`). The CONTRIBUTING.md notes list what's known. Testable on Linux directly.
4. **Windows** later, and only with testing on a real Windows machine.

## Known quirks

- After the rename, `safe-sweep` must be linked again with `npm link` from this folder. The old `mac-sweep` command keeps working from its own folder until removed.
- Shortcuts needs Settings → Advanced → Allow Running Scripts. The hand-built shortcut file may be rejected by `shortcuts sign` on some macOS versions; the app is the fallback.
