# safe-sweep

A local tool that scans a developer's machine for disk space that can be freed safely, and deletes only what the user ticks and confirms. Plain Node (ES modules), no dependencies, no build step. Runs on macOS and Linux.

## Commands

- `npm test`: runs `node --test` (guard, Linux platform, symlinked-home and CLI tests). Run it after every change.
- `npm start` or `safe-sweep`: starts the page at http://127.0.0.1:4777.
- `safe-sweep scan`: prints the scan without deleting anything. Safe to run while developing.
- `SAFE_SWEEP_PLATFORM=darwin HOME=<temp dir> node bin/safe-sweep.js ...`: run against a throwaway home. Use this for any manual test that cleans. Never clean against the real home while developing.

## Layout

See CONTRIBUTING.md. In short: `src/core` is shared, `src/platform/darwin` is macOS-only, `src/platform/linux` is Linux-only, and `src/platform/index.js` picks the platform and documents the interface each one exports.

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

1. **First run on a real Mac: done 2026-11-14** (macOS 26, Node 24). Settings copied from `~/.mac-sweep`, real scan, real clean (app logs), real launchd schedule and scheduled check, app built in `/Applications`, shortcut signed. The old-schedule replace was tested with a stand-in `launchctl`, since no old job was installed. Two fixes came out of it: Save now works on a flagged schedule, and `check` skips report-only rules (macOS held background reads of WhatsApp's folder).
2. **GitHub.** `d-beloved/safe-sweep`, made public on 2026-11-14 after a check for personal details.
3. **Linux platform: built 2026-11-14** (`src/platform/linux`): named `~/.cache` folders, Chrome AI model, report-only package caches and journal, systemd user timer, `.desktop` menu entry. Tested with `SAFE_SWEEP_PLATFORM=linux` in a temp home on macOS and in CI on Ubuntu. Still to do: a first run on a real Linux desktop (schedule via real systemd, notify-send, menu entry showing in the launcher).
4. **npm.** Package `safe-sweep` prepared 2026-11-14 (`private` removed, `os` set to darwin and linux). Publish with `npm publish` from this folder; bump with `npm version patch|minor` first for later releases.
5. No Windows support is planned for now.

## Known quirks

- Run through `npx`, the code lives in `~/.npm/_npx`. Schedules and launchers are refused there (`needsInstall` in `src/core/schedule.js`) and the npx cache item is blocked, so nothing points at or deletes the running copy.
- After the rename, `safe-sweep` must be linked again with `npm link` from this folder. The old `mac-sweep` command keeps working from its own folder until removed.
- Scheduled runs under launchd have none of Terminal's privacy permissions. Keep `check` away from other apps' private folders (`Group Containers`, `Containers`): mark such rules `reportOnly`.
- Shortcuts needs Settings → Advanced → Allow Running Scripts. The hand-built shortcut file may be rejected by `shortcuts sign` on some macOS versions; the app is the fallback.
