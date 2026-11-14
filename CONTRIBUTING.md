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

What we know is needed:

**Linux**
- Rules: per-app folders in `~/.cache` (each one named, never the whole folder), `~/.local/share/Trash` as report-only, journald and apt/dnf caches as report-only (they need sudo; this tool never asks for it), Flatpak unused runtimes via `flatpak uninstall --unused` (report first).
- Schedule: a systemd user timer. Notify: `notify-send`. Reveal: `xdg-open` on the parent folder.

**Windows**
- `du` and `pgrep` don't exist. Sizes need a Node directory walk; running apps need `tasklist`.
- Paths: `%LOCALAPPDATA%\Temp`, `%LOCALAPPDATA%\npm-cache`, browser caches under `%LOCALAPPDATA%`. The guard compares with forward slashes, so patterns stay portable.
- Schedule: Task Scheduler (`schtasks`). Notify: a PowerShell toast.
- Please only open a Windows pull request if you've run it on a real Windows machine.

`SAFE_SWEEP_PLATFORM=<id>` forces a platform module. It's for development and tests only. Running one OS's rules on another is not safe on a real machine.

## Style

Plain JavaScript (ES modules), no dependencies, no build step. User-facing text is short, plain English.
