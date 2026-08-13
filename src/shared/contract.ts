/**
 * The single source of truth for what crosses the main <-> renderer boundary.
 * The splash/error surface is the only renderer this shell owns; once the
 * backend is ready the window navigates to the Harness UI, which knows nothing
 * about these channels.
 */

export const IPC = {
  stateChanged: 'dsh:state-changed',
  getState: 'dsh:get-state',
  getEnvironment: 'dsh:get-environment',
  restartBackend: 'dsh:restart-backend',
  openLogFolder: 'dsh:open-log-folder',
  copyDiagnostics: 'dsh:copy-diagnostics',
  openExternal: 'dsh:open-external',
} as const

/** Lifecycle of the `dsh web` child process, as the window needs to see it. */
export type BackendState =
  | { phase: 'starting'; attempt: number; message: string }
  | { phase: 'ready'; url: string }
  | { phase: 'restarting'; message: string }
  | { phase: 'failed'; message: string; hint?: string; logTail: string[] }

/** Static facts the error surface shows so a bug report needs no follow-up. */
export interface EnvironmentInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  platform: string
  arch: string
  nodeRuntime: { path: string; version: string; source: 'bundled' | 'environment' | 'system' } | null
  dshVersion: string | null
  logFile: string
}
