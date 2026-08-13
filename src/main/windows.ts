/**
 * Window lifecycle. Every window shows the shell's own status surface until the
 * backend is ready, then navigates to the Harness UI; a backend failure sends it
 * back so the explanation appears where the user is already looking.
 *
 * Navigation is fenced to the backend origin. The Harness renders model output,
 * and model output contains links; those belong in the user's browser, not in a
 * window that holds a privileged loopback session.
 */

import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import type { BackendState } from '../shared/contract'
import { IPC } from '../shared/contract'
import { rendererFile } from './paths'
import { logInfo, logWarn } from './logger'
import { rememberWindow, settings, updateSettings } from './settings'

const windows = new Set<BrowserWindow>()
let shuttingDown = false

/** Suppresses the crash-recovery paths once a quit is underway. */
export function beginShutdown(): void {
  shuttingDown = true
}

export function allWindows(): BrowserWindow[] {
  return [...windows]
}

export function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? windows.values().next().value ?? null
}

export function createWindow(state: BackendState): BrowserWindow {
  const stored = settings().window
  const isFirst = windows.size === 0
  const window = new BrowserWindow({
    width: stored.width,
    height: stored.height,
    ...(isFirst && typeof stored.x === 'number' ? { x: stored.x } : {}),
    ...(isFirst && typeof stored.y === 'number' ? { y: stored.y } : {}),
    minWidth: 720,
    minHeight: 520,
    show: false,
    // Matches the Harness UI's own dark surface, so a cold start does not flash
    // white before the first paint.
    backgroundColor: '#0d1117',
    title: 'DeepSeek Harness',
    // The window frame stays native: the page it hosts is the upstream Harness
    // UI, which lays itself out from y=0 and would slide under an inset title
    // bar's traffic lights.
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  windows.add(window)
  if (isFirst && stored.maximized) window.maximize()

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.setZoomLevel(settings().zoomLevel)

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternally(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isBackendOrigin(url) || url.startsWith('file://')) return
    event.preventDefault()
    void openExternally(url)
  })

  // A preload that throws leaves the status surface inert with no visible sign,
  // so the failure is logged loudly rather than diagnosed by guesswork.
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logWarn(`preload failed (${preloadPath}): ${error.message}`)
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    // Only an actual crash earns a reload. During shutdown the renderer is
    // *supposed* to go away, and reloading it there spawns a fresh renderer that
    // cancels the quit the user just asked for.
    if (shuttingDown || window.isDestroyed() || details.reason === 'clean-exit') {
      logInfo(`renderer exited (${details.reason})`)
      return
    }
    logWarn(`renderer gone (${details.reason}); reloading the window`)
    window.reload()
  })

  const persist = (): void => {
    if (window.isDestroyed() || !windows.has(window)) return
    if (window !== firstWindow()) return
    const bounds = window.getNormalBounds()
    rememberWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized(),
    })
  }
  window.on('resized', persist)
  window.on('moved', persist)
  window.on('maximize', persist)
  window.on('unmaximize', persist)

  window.on('closed', () => {
    windows.delete(window)
  })

  void showStateIn(window, state)
  return window
}

/** Route a window to the right surface for the current backend state. */
export async function showStateIn(window: BrowserWindow, state: BackendState): Promise<void> {
  if (window.isDestroyed()) return
  if (state.phase === 'ready') {
    if (isBackendOrigin(window.webContents.getURL(), state.url)) return
    logInfo(`loading Harness UI at ${state.url}`)
    try {
      await window.loadURL(state.url)
    } catch (error) {
      logWarn(`could not load ${state.url}: ${String(error)}`)
    }
    return
  }
  if (window.webContents.getURL().startsWith('file://')) {
    window.webContents.send(IPC.stateChanged, state)
    return
  }
  await window.loadFile(rendererFile('status.html'))
  window.webContents.send(IPC.stateChanged, state)
}

export function broadcastState(state: BackendState): void {
  for (const window of windows) void showStateIn(window, state)
}

export function reloadHarness(): void {
  const window = focusedWindow()
  if (window === null) return
  window.webContents.reloadIgnoringCache()
}

export function applyZoom(delta: number | 'reset'): void {
  const window = focusedWindow()
  if (window === null) return
  const level = delta === 'reset' ? 0 : clampZoom(window.webContents.getZoomLevel() + delta)
  for (const target of windows) target.webContents.setZoomLevel(level)
  if (settings().zoomLevel !== level) updateSettings({ zoomLevel: level })
}

function clampZoom(level: number): number {
  return Math.max(-5, Math.min(5, Math.round(level * 10) / 10))
}

function firstWindow(): BrowserWindow | null {
  return windows.values().next().value ?? null
}

let backendOrigin: string | null = null

export function setBackendOrigin(url: string | null): void {
  backendOrigin = url === null ? null : safeOrigin(url)
}

function isBackendOrigin(candidate: string, override?: string): boolean {
  const expected = override === undefined ? backendOrigin : safeOrigin(override)
  if (expected === null) return false
  return safeOrigin(candidate) === expected
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export async function openExternally(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url) && !url.startsWith('mailto:')) {
    logWarn(`refusing to open non-web URL externally: ${url}`)
    return
  }
  await shell.openExternal(url)
}
