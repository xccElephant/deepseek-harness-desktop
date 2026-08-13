/**
 * Which Node binary runs the Harness backend.
 *
 * The backend is a plain Node child process rather than something loaded into
 * Electron's own runtime, because the Harness depends on native modules
 * (`node-pty`, `sharp`) built against a stock Node ABI. A separate process keeps
 * those binaries valid and keeps a backend crash from taking the window with it.
 *
 * Resolution order: an explicit override, then the bundled runtime, then a
 * system Node new enough to run the Harness.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { bundledNodeBinary } from './paths'
import { logInfo, logWarn } from './logger'

/** Matches the Harness's own `engines.node` floor. */
const MINIMUM = { major: 22, minor: 19 }

export interface NodeRuntime {
  path: string
  version: string
  source: 'bundled' | 'environment' | 'system'
}

export class NodeRuntimeError extends Error {
  readonly hint: string

  constructor(message: string, hint: string) {
    super(message)
    this.name = 'NodeRuntimeError'
    this.hint = hint
  }
}

export function resolveNodeRuntime(searchPath: string): NodeRuntime {
  const override = process.env.DSH_DESKTOP_NODE?.trim()
  if (override) {
    const version = probeVersion(override, searchPath)
    if (version === null) {
      throw new NodeRuntimeError(
        `DSH_DESKTOP_NODE points at ${override}, which did not run.`,
        'Unset DSH_DESKTOP_NODE to fall back to the bundled runtime, or point it at a working Node 22.19+ binary.',
      )
    }
    return accept({ path: override, version, source: 'environment' })
  }

  const bundled = bundledNodeBinary()
  if (bundled) {
    const version = probeVersion(bundled, searchPath)
    if (version !== null) return accept({ path: bundled, version, source: 'bundled' })
    logWarn(`bundled Node at ${bundled} did not report a version; falling back to system Node`)
  }

  for (const candidate of systemCandidates(searchPath)) {
    const version = probeVersion(candidate, searchPath)
    if (version !== null && meetsMinimum(version)) {
      return accept({ path: candidate, version, source: 'system' })
    }
  }

  throw new NodeRuntimeError(
    'No usable Node.js runtime was found.',
    'This build ships without a bundled runtime. Install Node.js 22.19 or newer, or set DSH_DESKTOP_NODE to a Node binary.',
  )
}

function accept(runtime: NodeRuntime): NodeRuntime {
  if (!meetsMinimum(runtime.version)) {
    throw new NodeRuntimeError(
      `Node ${runtime.version} at ${runtime.path} is older than the Harness requires.`,
      `The Harness needs Node ${MINIMUM.major}.${MINIMUM.minor} or newer.`,
    )
  }
  logInfo(`node runtime: ${runtime.version} (${runtime.source}) at ${runtime.path}`)
  return runtime
}

function probeVersion(binary: string, searchPath: string): string | null {
  const probe = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: { ...process.env, PATH: searchPath },
  })
  if (probe.error || probe.status !== 0) return null
  const version = probe.stdout.trim()
  return /^v\d+\.\d+\.\d+/.test(version) ? version : null
}

function meetsMinimum(version: string): boolean {
  const parsed = /^v(\d+)\.(\d+)\./.exec(version)
  if (!parsed) return false
  const major = Number(parsed[1])
  const minor = Number(parsed[2])
  if (major > MINIMUM.major) return true
  return major === MINIMUM.major && minor >= MINIMUM.minor
}

/**
 * Candidate system binaries. `PATH` is searched first, then the install
 * locations a GUI process commonly cannot see: a desktop app inherits the
 * launcher's environment, not a login shell's.
 */
function systemCandidates(searchPath: string): string[] {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node'
  const fromPath = searchPath.split(path.delimiter).filter(Boolean)
  const extra =
    process.platform === 'win32'
      ? ['C:\\Program Files\\nodejs']
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', `${process.env.HOME ?? ''}/.local/bin`]
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const dir of [...fromPath, ...extra]) {
    if (dir === '' || seen.has(dir)) continue
    seen.add(dir)
    candidates.push(path.join(dir, executable))
  }
  return candidates
}
