# DeepSeek Harness Desktop

English | [中文](README.zh.md)

A desktop application for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) — the agent runtime DeepSeek open-sourced on 2026-08-13. Upstream ships a
CLI that serves a local web UI; this repository wraps it into an app you launch
from your dock, with nothing to install first.

> **Unofficial.** Not affiliated with, endorsed by, or supported by DeepSeek. See
> [NOTICE.md](NOTICE.md).

![The Harness UI running in the desktop app](docs/screenshot.png)

## What this adds

Upstream's `npx @deepseek-ai/dsh web` needs Node.js 22.19+, a terminal that stays
open, and a browser tab. This app removes all three:

- **Zero prerequisites.** A pinned Node runtime and a pinned Harness release are
  bundled in the installer. Node does not need to be installed.
- **A real application window.** Native menus and shortcuts, remembered window
  geometry and zoom, multiple windows over one backend, and no browser chrome
  competing for the keyboard.
- **A supervised backend.** The `dsh web` process starts with the app, restarts
  itself after an unexpected exit, and is torn down on quit — including its own
  child processes, so no shells or language servers are orphaned.
- **The agent's real `PATH`.** A GUI process inherits the launcher's environment,
  not a login shell's, so a desktop-launched agent would normally lose `git`,
  `rg`, and every toolchain installed through Homebrew, nvm, or asdf. This app
  reads the login shell's `PATH` once and caches it, so the agent's tools match
  what your terminal has.
- **Failures you can read.** When the backend cannot start, the window explains
  why and offers the backend's own output, a restart, and a one-click diagnostics
  copy — instead of a blank page.

![The status surface when the backend fails to start](docs/screenshot-backend-error.png)

## Install

Download an installer from [Releases](https://github.com/xccElephant/deepseek-harness-desktop/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `…-arm64.dmg` |
| macOS (Intel) | `…-x64.dmg` |
| Windows x64 | `…-setup.exe` |
| Linux x64 | `…-x86_64.AppImage` or `…-amd64.deb` |

Builds carry no developer certificate, so the OS will warn on first launch:

- **macOS** — the app is ad-hoc signed but not notarized, so macOS refuses to open
  it until you clear the download quarantine. Copy it to *Applications* first, then
  either allow it under *System Settings → Privacy & Security → Open Anyway*, or run:

  ```sh
  xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness Desktop.app"
  ```

  Do this before the first launch attempt; macOS caches its verdict, so clearing the
  flag afterwards may require a fresh copy of the app.

- **Windows** — SmartScreen shows *Windows protected your PC*. Choose *More
  info* → *Run anyway*.

The app ships no API credentials. On first run the Harness asks for a provider
key, exactly as the CLI does.

## How it works

```text
Electron main process
 ├─ spawns: <bundled node> <bundled dsh>/lib/bin.js web --port 0
 │            └─ prints "dsh web: http://127.0.0.1:<port>" once listening
 └─ BrowserWindow loads that URL
```

Three decisions are worth knowing about, because they are the reason this is
robust rather than clever:

**The backend is a separate process, not code loaded into Electron.** The Harness
depends on native modules (`node-pty`, `sharp`) compiled against a stock Node
ABI. Running them under a plain Node binary keeps those modules valid with no
rebuilding, and keeps a backend crash from taking the window down with it.

**The window loads `http://127.0.0.1`, not `file://` plus an IPC bridge.** The
Harness gates its privileged surfaces — settings, credentials, the native
directory picker, opening paths in the OS — behind a loopback same-origin fence.
Serving the real origin satisfies that fence, so the desktop app behaves
identically to a browser session with no shims to maintain.

**The port is `0`.** The backend prints the port the OS assigned, and the shell
reads it from that line. Nothing probes for a free port, and the app never
collides with a `dsh` you are already running in a terminal.

Startup on a warm cache is roughly 1.5 seconds from launch to a rendered UI.

## Where things live

| What | Path |
| --- | --- |
| Shell log | `<userData>/logs/desktop.log` (File → Open Log Folder) |
| Shell settings | `<userData>/settings.json` |
| Harness data, config, sessions | `~/.dsh` (File → Open Harness Home) |

`<userData>` is `~/Library/Application Support/DeepSeek Harness Desktop` on
macOS, `%APPDATA%\DeepSeek Harness Desktop` on Windows, and
`~/.config/DeepSeek Harness Desktop` on Linux.

Everything the agent itself does — providers, models, permissions, skills, MCP
servers — is configured inside the Harness UI and stored in `~/.dsh`, not here.
This shell owns only window state and two backend knobs:

```json
{
  "port": 0,
  "extraArgs": []
}
```

`port` pins the backend to a fixed port instead of letting the OS choose, and
`extraArgs` is appended to `dsh web` verbatim.

## Build from source

Requires Node.js 24 (the version pinned in `package.json` under
`dshDesktop.nodeVersion`) and a C++ toolchain, since the Harness payload compiles
`node-pty` during install.

```sh
git clone https://github.com/xccElephant/deepseek-harness-desktop.git
cd deepseek-harness-desktop
npm ci
npm run prepare:payload   # downloads the Node runtime, installs the Harness (~2 min)
npm run dev               # build and launch
npm run dist              # build an installer for the current platform into release/
```

`prepare:payload` verifies the Node download against `SHASUMS256.txt` and skips
work that is already current; pass `--force` to either prepare script to redo it.

Installers are built per platform on a runner of that platform, never
cross-compiled: the bundled Node binary and the Harness's native modules are
architecture-specific. The [release workflow](.github/workflows/release.yml)
covers macOS arm64, macOS x64, Windows x64, and Linux x64.

## Updating the bundled Harness

Upstream is in developer preview and warns of compatibility-breaking changes, so
the version is pinned rather than floating:

```jsonc
// package.json
"dshDesktop": {
  "dshVersion": "0.1.0-rc.6",
  "nodeVersion": "24.19.0"
}
```

Bump `dshVersion`, run `npm run prepare:dsh`, and check that the app still
reaches its UI. Nothing else in this repository tracks upstream internals — the
only coupling is the CLI invocation (`dsh web --port`) and the one line it prints
when the server is listening.

Watching for that is automated.
[upstream-watch](.github/workflows/upstream-watch.yml) compares the pin against
npm's `latest` daily and, when they differ, opens a pull request touching only
that field and starts a full build of the branch: all four platforms packaged,
then the Linux and Windows builds installed and launched. Merging and releasing
stay manual, because a developer-preview upstream can change either coupling
above and that kind of regression deserves a human look.

## Updates

The app checks for a
[newer release](https://github.com/xccElephant/deepseek-harness-desktop/releases/latest)
shortly after launch and only speaks up when there is one; a prompt can be
dismissed for that version. Help → Check for Updates… asks on demand.

It asks the releases API and falls back to the redirect from `/releases/latest`
when that will not answer, because neither source is enough alone: the API is
authoritative but allows 60 anonymous requests an hour per address, a budget
often already gone behind a shared one, while the redirect has no budget but is
served from a cache seen lagging minutes behind a publish. A check that fails
either way is logged and forgotten; it never delays startup or interrupts.

Nothing is downloaded or installed automatically. Without a developer
certificate, an app that replaced its own binary would be executing an
unverified download, so it reports and leaves the decision to you.

## Limitations

- **No developer certificate or notarization** (macOS builds are only ad-hoc
  signed), hence the first-launch warnings above.
- **Updates are announced, not installed.** See [Updates](#updates).
- **Upstream is a developer preview.** Breaking changes land often. The automated
  check installs and launches the Linux and Windows builds; the macOS ones still
  need a manual launch before a release.
- **One backend per machine.** A second launch focuses the running window rather
  than starting a second backend against the same `~/.dsh`.

## License

[MIT](LICENSE) for this repository's own code. Bundled payloads keep their own
licenses; see [NOTICE.md](NOTICE.md).
