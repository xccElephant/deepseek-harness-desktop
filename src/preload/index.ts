/**
 * Preload for the shell's own status surface. It exposes four actions and one
 * subscription — no filesystem, no shell, no arbitrary IPC — so the bridge stays
 * safe even though the same preload is attached to the window that later hosts
 * the Harness UI.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BackendState, type EnvironmentInfo } from '../shared/contract'

const api = {
  getState: (): Promise<BackendState> => ipcRenderer.invoke(IPC.getState) as Promise<BackendState>,
  getEnvironment: (): Promise<EnvironmentInfo> =>
    ipcRenderer.invoke(IPC.getEnvironment) as Promise<EnvironmentInfo>,
  restartBackend: (): Promise<void> => ipcRenderer.invoke(IPC.restartBackend) as Promise<void>,
  openLogFolder: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFolder) as Promise<void>,
  copyDiagnostics: (): Promise<void> => ipcRenderer.invoke(IPC.copyDiagnostics) as Promise<void>,
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openExternal, url) as Promise<void>,
  onStateChanged: (listener: (state: BackendState) => void): void => {
    ipcRenderer.on(IPC.stateChanged, (_event, state: BackendState) => {
      listener(state)
    })
  },
}

contextBridge.exposeInMainWorld('harnessDesktop', api)

export type HarnessDesktopApi = typeof api
