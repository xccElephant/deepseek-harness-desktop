/**
 * A GUI process on macOS and Linux inherits the launcher's environment, not a
 * login shell's, so `PATH` is typically `/usr/bin:/bin:/usr/sbin:/sbin`. That is
 * fine for a normal app and wrong for this one: the agent shells out to `git`,
 * `rg`, language toolchains, and whatever else the user installed through
 * Homebrew, nvm, or asdf. Asking the login shell once at startup makes the
 * desktop app's tool surface match the terminal's.
 */

import { execFile, spawnSync } from 'node:child_process'
import path from 'node:path'
import { logInfo, logWarn } from './logger'
import { settings, updateSettings } from './settings'

const SENTINEL = '__DSH_DESKTOP_PATH__'
const PROBE_TIMEOUT_MS = 8_000

/**
 * The `PATH` to give the backend. Reuses the value cached from a previous launch
 * so startup never waits on an interactive shell; a restart re-reads the cache,
 * which {@link refreshSearchPath} keeps current.
 */
export function searchPath(): string {
  if (process.platform === 'win32') return process.env.PATH ?? ''
  const cached = settings().shellPath
  if (cached !== undefined) return cached
  const resolved = resolveShellPath()
  updateSettings({ shellPath: resolved })
  return resolved
}

/**
 * Re-read the login shell's `PATH` off the startup path. This does not touch a
 * running backend — it decides what the next start sees, so a `PATH` change
 * takes effect on the next backend restart or app launch.
 */
export async function refreshSearchPath(): Promise<void> {
  if (process.platform === 'win32') return
  const resolved = await resolveShellPathAsync()
  if (resolved !== settings().shellPath) updateSettings({ shellPath: resolved })
}

/** Blocking resolution, used only when no cached value exists yet. */
function resolveShellPath(): string {
  const inherited = process.env.PATH ?? ''
  if (process.platform === 'win32') return inherited
  const shell = loginShell()
  const probe = spawnSync(shell, probeArgs(), {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    // An interactive shell that expects a terminal must not inherit ours.
    stdio: ['ignore', 'pipe', 'ignore'],
    env: probeEnv(),
  })
  const fromShell = probe.error ? null : extract(probe.stdout)
  return finish(fromShell, inherited)
}

async function resolveShellPathAsync(): Promise<string> {
  const inherited = process.env.PATH ?? ''
  if (process.platform === 'win32') return inherited
  const fromShell = await new Promise<string | null>((resolve) => {
    execFile(
      loginShell(),
      probeArgs(),
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', env: probeEnv() },
      (error, stdout) => {
        resolve(error ? null : extract(stdout))
      },
    )
  })
  return finish(fromShell, inherited)
}

function finish(fromShell: string | null, inherited: string): string {
  if (fromShell === null) {
    logWarn('could not read the login shell PATH; using the inherited environment')
    return merge(inherited, fallbackDirectories())
  }
  const merged = merge(fromShell, inherited.split(path.delimiter))
  logInfo(`resolved PATH from login shell (${merged.split(path.delimiter).length} entries)`)
  return merged
}

function loginShell(): string {
  return process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
}

function probeArgs(): string[] {
  return ['-ilc', `printf %s ${SENTINEL}; printenv PATH`]
}

function probeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TERM: 'dumb' }
}

function extract(stdout: string | undefined): string | null {
  if (typeof stdout !== 'string') return null
  const marker = stdout.lastIndexOf(SENTINEL)
  if (marker < 0) return null
  const value = stdout.slice(marker + SENTINEL.length).trim()
  return value === '' ? null : value
}

function fallbackDirectories(): string[] {
  const home = process.env.HOME ?? ''
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    home === '' ? '' : path.join(home, '.local', 'bin'),
  ].filter((entry) => entry !== '')
}

function merge(primary: string, extra: readonly string[]): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const entry of [...primary.split(path.delimiter), ...extra]) {
    const trimmed = entry.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    entries.push(trimmed)
  }
  return entries.join(path.delimiter)
}
