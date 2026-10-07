# Pit Boss

**Run the house.** A local developer command center built with React, TypeScript, Tailwind CSS, Tauri 2, Rust, and SQLite.

## Run it

```sh
npm ci
npm run desktop
```

The repository pins Rust 1.95 through `rust-toolchain.toml`. Install Rust with rustup and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. Node.js 20 or newer is required. This version is built and tested on Apple Silicon macOS.

For the interactive browser demo:

```sh
npm run dev
# http://127.0.0.1:1427
```

The browser shows labeled example projects and simulates command execution. It cannot access local files or launch shell commands. The desktop app starts with an empty, real workspace. Demo data never enters its SQLite database.

Build a macOS application:

```sh
npm run desktop:build
# src-tauri/target/release/bundle/macos/Pit Boss.app
```

## First project

1. Click **Add project** and choose **Browse** to open the native folder picker. Select the repository folder directly, or enter its absolute path or `~/Code/project`, then choose **Inspect**.
2. Review detected metadata and proposed commands. Uncheck any commands you do not want, then import the project. Importing never executes commands.
3. Open the project to create or edit presets, set relative working directories and environment bindings, and organize it into a pit under **Settings**.
4. Choose **Run**, **Deploy**, or a command from **Cmd/Ctrl + K**. Every launch shows the exact command and directory; production requires typing the project name.
5. Watch streaming output in the persistent terminal drawer. Closing or collapsing it leaves the process running. Quitting the desktop app terminates its process groups.

## Included

- Native project-folder browsing from the import and discovery dialogs.
- Local registration and bounded recursive discovery for Git, Node, Rust, Python, Go, Docker, and Make-based projects. Detects package managers, scripts, frameworks, environment-file names, branches, remotes, commit hashes, working-tree changes, and ahead/behind counts.
- The Pit, a live operations view with project cards, dense tables, favorites, group filters, process metrics, listening ports, recent activity, and a persistent command drawer.
- Configurable presets with category, environment, relative working directory, inherited environment bindings, confirmation, long-running intent, concurrency policy, drag ordering, and accessible reorder buttons.
- Project actions with descriptions, icons, category groups, pinned card controls, duplicate/edit/history management, production-aware safeguards, and per-project keyboard shortcuts. Pit Boss suggests actions from package scripts, build tools, and common script folders; suggestions remain disabled until explicitly added.
- Real Rust shell execution with separate streaming stdout/stderr, duration, exit status, stop, restart, rerun, copy, and clear-visible-output controls.
- Process-group tracking and termination, including children started by package managers. Listening ports and aggregate CPU/RSS are inspected with `ps` and `lsof` on macOS/Linux.
- Automatic Port Authority detection. When its same-user Conflict Autopilot engine is running and enabled, Pit Boss loads the bundled shell helper for each launch so supported npm, pnpm, yarn, and bun `dev`/`start` commands can report conflicts without changing saved presets.
- Staging and production targets as deployment presets; deployment history records branch, commit, environment, start/end, exit code, and output.
- Concurrent group start/build/test/pull operations with individual sessions and aggregate active counts. Stop-all and Git-refresh actions are also available.
- Git fetch/pull presets, repository links, commit copying, external terminal, editor, and browser actions.
- SQLite command history, searchable by project, command, environment, branch, or captured output; clicking activity or history reopens logs.

## Configuration and secrets

A preset's environment configuration maps a variable name to a variable **name** in the environment that launched Pit Boss:

```text
DATABASE_URL=PIT_BOSS_DATABASE_URL
```

The database stores the names only. Export the source variable in your shell and start `npm run desktop` from that shell. Finder-launched apps inherit a different environment; missing source variables produce a visible error before launch. On Unix, project runs load PATH from your configured login shell (including interactive startup files for Zsh, Bash, and Fish), so tools installed through version managers such as NVM are available in desktop launches. If shell startup fails or exceeds five seconds, runs use the inherited PATH. VS Code's `code` command must be installed on PATH for the editor action.

Known sensitive inherited variables (names containing SECRET, TOKEN, PASSWORD, API_KEY, PRIVATE_KEY, or CREDENTIAL) and all explicitly bound values are redacted before event delivery and persistence, even when split across reads. This is not a general-purpose data-loss prevention system: do not paste secrets into command text or print unrelated sensitive data. Environment files are detected by filename, never read into the UI.

Commands can run arbitrary shell code with your user's permissions. Only saved project preset IDs are accepted by the runner. Working directories are canonicalized and must stay inside the registered project; symlink escapes are rejected. Imported commands require approval. Git metadata inspection disables filesystem-monitor hooks. Production confirmation is enforced in Rust as well as the UI. The desktop window uses a restricted content security policy and no remote content.

Port Authority remains optional. Pit Boss looks for its configured executable, standard application locations, or the process serving Port Authority's private same-user Autopilot socket. It activates the shell helper only after that socket confirms Conflict Autopilot is enabled; a missing, closed, disabled, or incompatible Port Authority installation leaves command execution unchanged.

## Persistence

Desktop data lives in the OS application-data directory for `dev.oddware.pitboss` (on macOS, `~/Library/Application Support/dev.oddware.pitboss/pit-boss.sqlite`). Its containing directory is private to the current user on Unix. Back up the directory while the app is closed.

Every execution is stored. The current UI loads the most recent 500 runs; each run retains the last 1 MiB of combined output. Running output is checkpointed about every two seconds and on completion. A crash can lose the last checkpoint interval; stale running records become **Interrupted** on next launch. Clear output clears the display only. Removing a project preserves files and run history.

## Architecture

```text
src/
  App.tsx                 Workspace state, navigation, group operations
  bridge.ts               Typed native IPC / explicitly isolated demo adapter
  types.ts                Shared frontend data contracts
  demo.ts                 Browser-only sample workspace
  components/
    ProjectCard.tsx        Live project controls
    ProjectDetail.tsx     Commands, processes, Git, deployments, settings
    Terminal.tsx          Persistent output sessions
    Dialogs.tsx           Import, configuration, launch review, palette
    ui.tsx                Shared visual primitives
src-tauri/src/
  lib.rs                  Narrow Tauri command handlers and lifecycle
  models.rs               Serializable project, preset, run, snapshot models
  projects.rs             Discovery, path resolution, metadata suggestions
  runner.rs               Launch policy, streaming, redaction, lifecycle
  storage.rs              SQLite persistence
  git.rs                  Read-only Git inspection and safe remote URLs
  ports.rs                Process-group metrics and port ownership
```

Deployment targets use ordinary saved command presets rather than provider-specific code. A future provider can prepare a command/job and translate its status into the existing run contract without changing project registration or the operations UI.

## Verification

```sh
npm run build
npm test
npm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run desktop:build
```

If Playwright's browser is not installed, run `npx playwright install chromium` first. The browser tests start their own server on port 1427 and refuse to reuse an unrelated process. Stop your development server before running them.

Rust integration tests execute harmless commands in temporary directories and cover approval enforcement, concurrency, streaming, stdout/stderr, secret boundaries, UTF-8, working-directory confinement, production safeguards, SQLite recovery, process-tree cleanup, and an ephemeral local listening port. The port test uses Python 3 and `lsof`.

## Current limits

- The process drawer is a streaming output viewer, not a PTY. Interactive prompts and terminal input are not supported; use **Open terminal** for those commands.
- Port and resource inspection targets Unix. Windows has a shell-launch/process-tree-stop path but is not validated in this release; Linux desktop packaging is also untested.
- Stop and restart terminate the entire tracked process group immediately. Daemons that deliberately detach into a new session are outside that group and should be managed by their own service manager.
- Bind errors that include a port or a standard --port/-p argument append the current port owner to the run log. Errors that omit the port cannot be diagnosed automatically. Port-owner lookup is also available beside detected listeners.
- Native cloud providers, remote process management, tray/background persistence, auto-updates, signed distribution, advanced resource charts, and history paging/export are future work. No cloud credentials or remote APIs are required.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.

## House Edge browser analytics

The browser version includes House Edge page/view tracking, anonymous sessions, errors, and Web Vitals. Native Tauri sessions are always excluded, even when analytics environment variables are set. Named views are mapped to fixed paths; project names, file contents, and search text are not used as page names.

Create a House Edge project with key `pit-boss` and allow this site's exact origin. Set `VITE_HOUSE_EDGE_KEY` to its **browser ingestion key** and `VITE_HOUSE_EDGE_ENDPOINT` to your collector URL ending in `/api/collect`, using `.env.local` or your build environment. `.env.example` lists the settings. Rebuild and redeploy the browser version, then check Live Activity for `page_view` and `session_start` after about five seconds.

Tracking is off when the key or endpoint is missing, and development requires `VITE_HOUSE_EDGE_TRACK_DEVELOPMENT=true`. Do Not Track is respected. The SDK is installed from the checked-in `vendor/house-edge-analytics-0.1.1.tgz`, so independent builds need no sibling House Edge checkout. Commit the tarball with its package manifest and lockfile.

## macOS Release

Run `npm run release:mac:check` to validate prerequisites, then `npm run release:desktop` for Developer ID signed, notarized ARM64, Intel and universal apps/DMGs. See [macOS release setup, credentials, outputs and verification](docs/MACOS_RELEASE.md). Existing development and Windows/Linux commands remain available.
