/**
 * Application entry. The order matters: the backend starts before the first
 * window so its slowest phase overlaps with window creation, and the window
 * opens immediately with a status surface rather than waiting for a URL.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { Backend } from './backend'
import { registerIpc } from './ipc'
import { initLogger, logError, logInfo, logWarn } from './logger'
import { installMenu } from './menu'
import { flushSettings, settings } from './settings'
import { refreshSearchPath } from './shell-path'
import { scheduleUpdateCheck } from './updates'
import {
  allWindows,
  beginShutdown,
  broadcastState,
  createWindow,
  setBackendOrigin,
} from './windows'

if (!app.requestSingleInstanceLock()) {
  // A second launch focuses the running app instead of starting a second
  // backend against the same Harness home directory. The logger does not exist
  // this early, so this one line goes to stderr.
  process.stderr.write('another instance already holds the lock; focusing it and exiting\n')
  app.quit()
} else {
  main()
}

function main(): void {
  let backend: Backend | null = null
  let quitting = false

  app.on('second-instance', () => {
    const [window] = allWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    } else if (backend !== null) {
      createWindow(backend.currentState())
    }
  })

  app.on('window-all-closed', () => {
    // macOS keeps the app (and the backend) alive so reopening from the dock is
    // instant; elsewhere closing the last window means quitting.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (backend === null) return
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backend.currentState())
  })

  app.on('before-quit', (event) => {
    if (quitting || backend === null) return
    // The backend owns child processes of its own (shells, language servers), so
    // quitting waits for an orderly teardown instead of orphaning them.
    event.preventDefault()
    quitting = true
    beginShutdown()
    logInfo('shutting down the backend before quit')
    flushSettings()
    // A quit the user asked for has to happen. If teardown stalls — a wedged
    // child, a window refusing to close — this exits anyway rather than leaving
    // an invisible process holding the single-instance lock.
    const watchdog = setTimeout(() => {
      logWarn('shutdown did not complete in time; exiting')
      app.exit(0)
    }, 8_000)
    watchdog.unref()
    void backend.stop().finally(() => {
      logInfo('backend stopped; quitting')
      app.quit()
    })
  })

  // A signalled quit (a logout, a `kill`, a supervisor) must tear the backend
  // down as deliberately as a menu quit would.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      logInfo(`received ${signal}; quitting`)
      app.quit()
    })
  }

  process.on('uncaughtException', (error) => {
    logError(`uncaught exception: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    logError(`unhandled rejection: ${String(reason)}`)
  })

  app.whenReady().then(() => {
    initLogger()
    logInfo(`starting ${app.getName()} ${app.getVersion()} on ${process.platform}-${process.arch}`)

    const stored = settings()
    backend = new Backend({ port: stored.port, extraArgs: stored.extraArgs })
    backend.on('state', (state) => {
      setBackendOrigin(state.phase === 'ready' ? state.url : null)
      broadcastState(state)
      // Menu items that depend on the backend URL are rebuilt rather than
      // mutated, which keeps their enabled state derived from one source.
      if (backend !== null) installMenu(backend)
    })

    registerIpc(backend)
    installMenu(backend)
    backend.start()
    createWindow(backend.currentState())
    refreshShellPathCache()
    scheduleUpdateCheck()
  }, (error: unknown) => {
    dialog.showErrorBox('DeepSeek Harness Desktop', `The app could not start.\n\n${String(error)}`)
    app.exit(1)
  })
}

/** Keep the cached `PATH` current, well after the window has painted. */
function refreshShellPathCache(): void {
  const timer = setTimeout(() => {
    void refreshSearchPath().catch((error: unknown) => {
      logWarn(`could not refresh the cached PATH: ${String(error)}`)
    })
  }, 2_000)
  timer.unref()
}
