/**
 * Owns the `dsh web` child process: start, readiness, crash recovery, shutdown.
 *
 * Readiness is observed rather than assumed. The Harness prints exactly one
 * line — `dsh web: http://127.0.0.1:<port>` — after its HTTP server is
 * listening, and that line carries the port, which is why this shell asks for
 * `--port 0` and lets the OS choose: no port probing, no collision with a `dsh`
 * the user already runs in a terminal, and no fixed port to fight over.
 *
 * Loading the window from `127.0.0.1` (rather than `file://` plus an IPC bridge)
 * keeps the Harness's own loopback same-origin trust fence satisfied, so the
 * privileged surfaces — settings, credentials, the native directory picker —
 * behave exactly as they do in a browser session.
 */

import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import type { Readable } from 'node:stream'
import type { BackendState } from '../shared/contract'
import { dshEntryPoint } from './paths'
import { logBackend, logError, logInfo, logTail, logWarn } from './logger'
import { NodeRuntimeError, resolveNodeRuntime, type NodeRuntime } from './node-runtime'
import { settings } from './settings'
import { resolveShellPath } from './shell-path'

/** How long the backend gets to print its URL line before we call it stuck. */
const READY_TIMEOUT_MS = 120_000
/** Automatic restarts after an unexpected exit, before we surface the failure. */
const MAX_AUTOMATIC_RESTARTS = 2
const SIGKILL_GRACE_MS = 5_000

const READY_LINE = /dsh web:\s*(https?:\/\/[^\s,)]+)/

/** stdin is closed, so the child's typed shape has a null first stream. */
type BackendProcess = ChildProcessByStdio<null, Readable, Readable>

export interface BackendOptions {
  /** Listen port; 0 lets the OS pick a free one. */
  port: number
  /** Extra arguments appended to `dsh web`, for advanced users. */
  extraArgs: readonly string[]
}

export class Backend extends EventEmitter {
  private child: BackendProcess | null = null
  private state: BackendState = { phase: 'starting', attempt: 1, message: 'Preparing…' }
  private searchPath: string | null = null
  private runtime: NodeRuntime | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private restarts = 0
  private stopping = false
  private stdoutCarry = ''

  constructor(private options: BackendOptions) {
    super()
  }

  currentState(): BackendState {
    return this.state
  }

  nodeRuntime(): NodeRuntime | null {
    return this.runtime
  }

  /** The base URL once ready, for menu actions and new windows. */
  url(): string | null {
    return this.state.phase === 'ready' ? this.state.url : null
  }

  start(): void {
    if (this.child !== null) return
    this.stopping = false
    this.publish({
      phase: 'starting',
      attempt: this.restarts + 1,
      message: this.restarts === 0 ? 'Starting the Harness backend…' : 'Restarting the backend…',
    })

    const entry = dshEntryPoint()
    if (entry === null) {
      this.fail(
        'The bundled Harness payload is missing.',
        'This looks like an incomplete build. Run `npm run prepare:payload` in a checkout, or reinstall the app.',
      )
      return
    }

    this.searchPath ??= settings().shellPath ?? resolveShellPath()
    let runtime: NodeRuntime
    try {
      runtime = resolveNodeRuntime(this.searchPath)
    } catch (error) {
      if (error instanceof NodeRuntimeError) this.fail(error.message, error.hint)
      else this.fail('Could not resolve a Node.js runtime.', String(error))
      return
    }
    this.runtime = runtime

    const args = ['web', '--port', String(this.options.port), ...this.options.extraArgs]
    logInfo(`spawning backend: ${runtime.path} ${entry} ${args.join(' ')}`)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: this.searchPath,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      DSH_DESKTOP: '1',
    }
    // Electron-specific variables would follow a stock Node child into a
    // configuration it does not understand.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS

    let child: BackendProcess
    try {
      child = spawn(runtime.path, [entry, ...args], {
        cwd: os.homedir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      this.fail('The backend process could not be started.', String(error))
      return
    }

    this.child = child
    this.stdoutCarry = ''
    this.armReadyTimeout()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      logBackend('stdout', chunk)
      this.scanForReady(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      logBackend('stderr', chunk)
    })
    child.on('error', (error) => {
      logError(`backend process error: ${error.message}`)
      this.fail('The backend process reported an error.', error.message)
    })
    child.on('exit', (code, signal) => {
      this.child = null
      this.clearReadyTimeout()
      logInfo(`backend exited (code=${String(code)} signal=${String(signal)})`)
      if (this.stopping) return
      this.handleUnexpectedExit(code, signal)
    })
  }

  /** Deliberate restart, e.g. from the menu. Resets the crash budget. */
  async restart(): Promise<void> {
    this.restarts = 0
    this.publish({ phase: 'restarting', message: 'Restarting the Harness backend…' })
    await this.stop()
    this.start()
  }

  async stop(): Promise<void> {
    const child = this.child
    this.stopping = true
    this.clearReadyTimeout()
    if (child === null || child.exitCode !== null) {
      this.child = null
      return
    }
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })
    if (process.platform === 'win32' && child.pid !== undefined) {
      // A Windows child cannot be signalled; the tree must be torn down by pid,
      // or `dsh`'s own grandchildren (shells, language servers) would survive.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        logWarn('backend did not exit on SIGTERM; sending SIGKILL')
        child.kill('SIGKILL')
      }
    }, SIGKILL_GRACE_MS)
    await exited
    clearTimeout(timer)
    this.child = null
  }

  private scanForReady(chunk: string): void {
    if (this.state.phase === 'ready') return
    const text = this.stdoutCarry + chunk
    const lines = text.split(/\r?\n/)
    this.stdoutCarry = lines.pop() ?? ''
    // The carry may itself hold a complete URL if the line lacks a trailing
    // newline, so it is scanned too rather than waiting for more output.
    for (const line of [...lines, this.stdoutCarry]) {
      const match = READY_LINE.exec(line)
      if (!match?.[1]) continue
      this.clearReadyTimeout()
      this.restarts = 0
      logInfo(`backend ready at ${match[1]}`)
      this.publish({ phase: 'ready', url: match[1] })
      return
    }
  }

  private handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason =
      code !== null ? `exit code ${String(code)}` : `signal ${String(signal ?? 'unknown')}`
    if (this.restarts < MAX_AUTOMATIC_RESTARTS) {
      this.restarts += 1
      logWarn(`restarting backend after ${reason} (attempt ${String(this.restarts + 1)})`)
      setTimeout(() => {
        if (!this.stopping) this.start()
      }, 500 * this.restarts)
      return
    }
    this.fail(
      `The Harness backend stopped unexpectedly (${reason}).`,
      'The log below is the backend\u2019s own output. A missing provider key or an unreadable config file is the usual cause.',
    )
  }

  private armReadyTimeout(): void {
    this.clearReadyTimeout()
    this.readyTimer = setTimeout(() => {
      logWarn('backend did not report a URL before the readiness deadline')
      void this.stop().then(() => {
        this.fail(
          'The backend started but never reported its address.',
          'It may be blocked on a first-run task. Try restarting the backend, or run `dsh web` in a terminal to see the same output live.',
        )
      })
    }, READY_TIMEOUT_MS)
  }

  private clearReadyTimeout(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private fail(message: string, hint?: string): void {
    logError(hint === undefined ? message : `${message} — ${hint}`)
    this.publish({
      phase: 'failed',
      message,
      ...(hint === undefined ? {} : { hint }),
      logTail: logTail(30),
    })
  }

  private publish(state: BackendState): void {
    this.state = state
    this.emit('state', state)
  }
}
