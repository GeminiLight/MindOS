# CHANGELOG

## v0.4.0 — Plugin Architecture + CLI UX (2026-03-14)

### Added
- **Plugin architecture (4 phases)** — renderer directory split → manifest self-registration → codegen auto-discovery → lazy loading
- **Codegen script** — `scripts/gen-renderer-index.js` auto-scans `manifest.ts` to generate `index.ts` (142 → 23 lines)
- **Lazy Loading** — all 10 renderers use `React.lazy` + `Suspense`, loaded on demand
- **CLI update check** — non-blocking npm version check on `start`/`dev`/`doctor`, 24h cache, `MINDOS_NO_UPDATE_CHECK=1` to disable
- **`--version` / `-v`** — outputs `mindos/0.4.0 node/v22 linux-x64`
- **`--help` / `-h`** — global help (exit 0)
- **`config unset <key>`** — delete config fields, supports dot-notation
- **`config set` type inference** — auto-converts `true`/`false`/`null`/numbers
- **`mindos sync` subcommand validation** — unknown subcommands show available list
- **Unified debug module** — `bin/lib/debug.js`, `MINDOS_DEBUG=1` or `--verbose`
- **Deps incremental detection** — `ensureAppDeps` uses `package-lock.json` hash
- **MCP/Skills API** — `/api/mcp/*` + `/api/skills` endpoints
- **FindInPage** — in-file `⌘F` search with highlighting
- **UpdateBanner** — GUI update notification banner

### Changed
- **Adding a renderer = new directory + manifest.ts**, zero changes to existing files
- Startup info simplified, removed verbose MCP JSON block
- `pkill` precision: prefer `lsof -ti :PORT`
- `run()` exit code passthrough
- NO_COLOR / FORCE_COLOR compliance

---

## v0.3.0 — CLI/GUI Setup Split + Browser Onboarding (2026-03-14)

### Added
- **SyncStatusBar** — persistent sync status in sidebar (dot + text + Sync Now button)
- **SyncDot / MobileSyncDot** — sync indicators for collapsed sidebar and mobile
- **Settings → Sync empty state** — 3-step setup guide when sync not configured
- **Onboarding sync prompt** — `mindos sync init` hint card in onboarding
- **CLI onboard sync step** — ask to configure Git sync after `mindos onboard`
- **`mindos doctor` sync check** — health check item #8: sync diagnostics
- **Sync status on startup** — `mindos start/dev` prints sync status line
- **Sync recovery toast** — notification when recovering from error/conflicts
- **sync-status tests** — 17 tests covering `timeAgo` and `getStatusLevel`
- **PWA support** — manifest.json, Service Worker, app icons
- **`/api/init` endpoint** — onboarding template initialization API

### Changed
- `SyncTab` exports `SyncStatus` interface and `timeAgo()` for reuse
- `SettingsModal` supports `initialTab` prop for direct tab navigation
- `Sidebar` integrates `useSyncStatus` shared polling hook
- wiki/ directory restructured to numbered naming (00-xx)

### Fixed
- `useTick` callback variable rename to avoid shadowing
- `useSyncStatus` cleanup on `stop()`
- `mindos doctor` sync check wrapped in try/catch

---

## v0.2.0 — CLI Modularization + Component Split + Git Sync (2026-03-14)

### Added
- `mindos sync` — Git auto-sync (init/status/now/on/off/conflicts)
- `mindos open` — open Web UI in browser
- `mindos token` — multi-Agent config output
- Settings → Sync Tab — Web UI sync management
- `/api/sync` REST API

### Changed
- `bin/cli.js` split from 1219 lines into 13 lib modules + main entry (~742 lines)
- `CsvRenderer` split from 693 lines into 68 lines + 6 sub-files
- `SettingsModal` split from 588 lines into 182 lines + 8 sub-files
- `scripts/setup.js` added Step 7: startup mode selection (daemon/foreground)

### Fixed
- MCP CLI 4-bug chain fix (npm global install + command routing + -y interactive + args parsing)
- `.next` cleanup changed to full directory removal to prevent stale artifacts

---

## v0.1.9 — Build Fix (2026-03-14)

### Fixed
- Clean entire .next directory to prevent stale artifact errors

---

## v0.1.8 — Marketing + CI (2026-03-13)

### Added
- Landing page update
- Marketing materials
- CI workflow optimization

### Changed
- CLI initial modularization (bin/lib/ structure)
