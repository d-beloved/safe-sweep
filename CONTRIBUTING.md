# Contributing

Thanks for helping. This tool deletes files on people's machines, so the bar for anything that deletes is high. The bar for anything that only reports is low.

## Run it

```bash
npm test          # no install step; there are no dependencies
npm start         # starts the page
```

Tests run on macOS and Linux in CI.

## Layout

```
bin/safe-sweep.js            command line
src/core/                    shared by every OS
  rules.js                   shared rules (Docker, package caches, projects) + shared ALLOW/DENY
  guard.js                   the delete guard; every path passes through it
  clean.js scan.js server.js config.js util.js ui.html
src/platform/
  index.js                   picks the module for this OS
  darwin/                    macOS: rules, allowlist, launchd schedule, app and shortcut
  linux/                     Linux: rules, allowlist, systemd timer, menu entry
test/
```

## Adding a rule

A rule is an async function that returns items. See the top of `src/core/rules.js` for the item shape.

- **Report-only items** (`action.kind: 'reveal'`) are always welcome.
- **Deleting items** need three things in the same pull request:
  1. the rule,
  2. an `ALLOW` pattern for exactly that path, in the matching `rules.js`,
  3. a test in `test/` showing the path is allowed and that its neighbours are refused.
- Prefer the tool's own cleanup command (`npm cache clean`, `brew cleanup`) over deleting its folder. Add new commands to `COMMANDS` in `src/core/clean.js`, and add a `MEASURE` function so the result shows real bytes freed.
- Never add `docker image prune -a`, `docker volume prune`, or anything that deletes user documents, chat data or source code.

## Adding an OS

Create `src/platform/<process.platform>/index.js` exporting the shape described at the top of `src/platform/index.js`, then register it in `SUPPORTED`. `schedule` and `launchers` can be `null` at first: the page hides those panels.

Notes on the existing platforms:

- **Linux** allows named folders in `~/.cache` only, never the whole folder: some apps keep state there. Anything that needs `sudo` (apt, dnf, pacman, Snap, the journal) is report-only, with the command to run. `test/linux.test.js` runs on any OS with a stand-in `systemctl`.
- **macOS** scheduled checks run under launchd without Terminal's privacy permissions. Rules that read other apps' folders are marked `reportOnly` so the check skips them.

`SAFE_SWEEP_PLATFORM=<id>` forces a platform module. It's for development and tests only. Running one OS's rules on another is not safe on a real machine.

## Style

Plain JavaScript (ES modules), no dependencies, no build step. User-facing text is short, plain English.
