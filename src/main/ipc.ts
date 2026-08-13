/**
 * The handful of main-process actions the status surface can take. Every channel
 * is either a read of shell-owned state or an explicitly user-initiated action;
 * nothing here is reachable from the Harness UI, which runs on its own origin
 * without this preload's surface in reach of remote content.
 */

import { app, clipboard, ipcMain, shell } from 'electron'
import { IPC, type EnvironmentInfo } from '../shared/contract'
import { logFilePath, logFolder, logTail } from './logger'
import { dshPayloadVersion } from './paths'
import { openExternally } from './windows'
import type { Backend } from './backend'

export function registerIpc(backend: Backend): void {
  ipcMain.handle(IPC.getState, () => backend.currentState())

  ipcMain.handle(IPC.getEnvironment, (): EnvironmentInfo => {
    const runtime = backend.nodeRuntime()
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      nodeRuntime: runtime === null ? null : { ...runtime },
      dshVersion: dshPayloadVersion(),
      logFile: logFilePath(),
    }
  })

  ipcMain.handle(IPC.restartBackend, async () => {
    await backend.restart()
  })

  ipcMain.handle(IPC.openLogFolder, async () => {
    await shell.openPath(logFolder())
  })

  ipcMain.handle(IPC.copyDiagnostics, () => {
    const runtime = backend.nodeRuntime()
    const report = [
      `App ${app.getVersion()} (${process.platform}-${process.arch})`,
      `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}`,
      `Harness payload ${dshPayloadVersion() ?? 'unknown'}`,
      runtime === null ? 'Node runtime unresolved' : `Node ${runtime.version} (${runtime.source})`,
      `State ${JSON.stringify(backend.currentState().phase)}`,
      '',
      ...logTail(60),
    ].join('\n')
    clipboard.writeText(report)
  })

  ipcMain.handle(IPC.openExternal, async (_event, url: unknown) => {
    if (typeof url === 'string') await openExternally(url)
  })
}
