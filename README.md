# safe-sweep

Find the disk space you can free on a developer's machine, and delete only what you tick.

safe-sweep scans for caches, build leftovers and dormant `node_modules`, sorts them by how safe they are to remove, and shows you the sizes. Nothing is deleted until you tick it and confirm. It runs as a small page on your own machine: no account, no network calls, no telemetry.

![safe-sweep after a scan](docs/screenshot.png)
<sub>Screenshot uses sample sizes.</sub>

**Platforms:** macOS today. Linux is next, then Windows. See [Platform support](#platform-support).

## Install

Needs Node 20 or newer. No dependencies.

```bash
git clone https://github.com/d-beloved/safe-sweep.git
cd safe-sweep
npm link        # puts `safe-sweep` on your PATH
safe-sweep      # opens the Scan page in your browser
```

The first run creates `~/.safe-sweep/config.json`. macOS may ask Terminal for access to Desktop or Documents. Allow it, or projects there won't be found.

## How it works

1. Press **Scan**. Sizes are measured, not estimated.
2. Tick what you want gone. **Select all safe** ticks the first list.
3. Press **Clean selected** and confirm. The result shows what each item freed and how much your free space really went up.

The scan is saved, so refreshing the page keeps it. Cleaning needs a scan from the last hour, because sizes drift.

### The three lists

**Safe to clear.** Caches and leftovers that rebuild themselves. Docker build cache and dangling images, npm / yarn / pnpm / bun / uv caches, `brew cleanup`, app caches (Chrome, Spotify, Codex, Playwright), app-updater leftovers, `~/.cache` dev caches, app logs.

**Safe, costs a reinstall.** Comes back with a download or an install command. Hugging Face models, Chrome's on-device AI model, `_to_delete` folders, and `node_modules` in dormant projects. A `node_modules` folder is only offered when:
- the project has had no commit or file change for `dormantDays` (default 60),
- its lockfile is committed to git, so a reinstall gives the same versions,
- its path doesn't match anything in your `protect` list.

**Your call.** Shown so you know where space went, with a button to open the folder. safe-sweep never deletes these: WhatsApp media, Docker's virtual disk, Movies, Downloads, Trash, old Node and Ruby versions, loose installers.

## Safety

This tool deletes files, so it is built to refuse first.

- **Allowlist.** It deletes only inside a fixed list of path patterns per OS (`src/core/rules.js` plus `src/platform/<os>/rules.js`). Anything else is refused, even if a rule asks for it.
- **Denylist.** WhatsApp's container, iCloud, CloudStorage (Google Drive, Dropbox) and every `.git` folder are blocked even if an allowlist pattern matches.
- **Symlinks.** Paths are checked as written and with symlinks resolved. A target that is itself a symlink is refused.
- **Open apps.** It re-checks that Chrome, Spotify, Cursor or Codex are closed right before clearing their caches.
- **Docker.** It never runs `docker image prune -a` or `docker volume prune`. With zero containers, Docker counts every image and volume as unused, including the ones you need.
- **Local only.** The page is served on `127.0.0.1`, checks the Host header, and needs a per-session token on every action, so other websites can't trigger a clean.
- **Logged.** Every clean is written to `~/.safe-sweep/log.jsonl`. Run `safe-sweep log` to read it.

The delete guard has its own tests (`npm test`). Read `src/core/guard.js` before trusting it with your disk: it's about 40 lines.

## Commands

| Command | What it does |
|---|---|
| `safe-sweep` | Starts the page at http://127.0.0.1:4777 and opens it. Stops after 15 idle minutes, or press **Stop**. |
| `safe-sweep scan` | Prints the list in the terminal. Deletes nothing. Add `--json` for raw output. |
| `safe-sweep check` | Scans and sends a notification if free space is low or a lot is reclaimable. |
| `safe-sweep schedule weekly --day 1 --hour 10` | Runs `check` every Monday at 10:07. |
| `safe-sweep schedule daily --hour 9` | Same, every day. |
| `safe-sweep schedule off` | Removes the schedule. |
| `safe-sweep schedule` | Shows the current schedule. |
| `safe-sweep log` | Shows what was cleaned, when, and how much it freed. |

Scheduled runs only scan and notify. They never delete.

## Opening it without a terminal (macOS)

From the page:
- **Create app** builds `Safe Sweep.app` in `/Applications` (or `~/Applications` if that isn't writable). It opens from Spotlight, Launchpad or the Dock.
- **Add to Shortcuts** builds a shortcut and opens Shortcuts' own Add dialog. It needs Shortcuts → Settings → Advanced → **Allow Running Scripts**. That setting applies to every shortcut, so only add shortcuts you trust. The app needs no such setting.

## Config

`~/.safe-sweep/config.json`. Changes apply the next time safe-sweep starts.

```json
{
  "projectRoots": ["~/Desktop/Projects", "~/Projects", "~/Developer", "~/code", "~/dev", "~/src"],
  "protect": [],
  "dormantDays": 60,
  "notify": { "minFreeGB": 30, "minReclaimableGB": 10 },
  "port": 4777
}
```

- `projectRoots`: where to look for `node_modules` and `_to_delete` folders. Missing folders are skipped.
- `protect`: substrings of project paths whose `node_modules` are never offered, e.g. `["work-monorepo"]`.

## Platform support

| | macOS | Linux | Windows |
|---|---|---|---|
| Scan and clean | ✅ | planned next | planned |
| Scheduled check | ✅ launchd | planned (systemd timer) | planned (Task Scheduler) |
| App / shortcut | ✅ | planned (.desktop) | planned |

On an unsupported OS, safe-sweep exits with a message and touches nothing. Each OS is one folder under `src/platform/`. See [CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to help with Linux or Windows.

## Known gaps

- Docker Desktop frees pruned space inside its disk file. Your real disk may not get it back until Docker Desktop restarts.
- Sizes for Trash, Downloads and Desktop need Terminal to have Full Disk Access. Without it they show `?`.
- The schedule, app and shortcut pin the Node binary you created them with. If you remove that Node version, the page flags the schedule and the app. Save and rebuild them.
- The shortcut file is hand-built. If `shortcuts sign` rejects it on your macOS version, the page shows the error. Use the app instead.

## Upgrading from mac-sweep

safe-sweep was called mac-sweep before it was public. On first run it copies your settings and history from `~/.mac-sweep` and leaves that folder alone. The page flags the old schedule, app and shortcut. Press **Save** on the schedule to move it over, create the new app, then delete the old "Mac Sweep" app and shortcut.

## License

MIT. See [LICENSE](LICENSE).
