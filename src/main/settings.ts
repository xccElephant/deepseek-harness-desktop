/**
 * A small JSON file in the app's user-data directory. Deliberately not a
 * dependency: the shell only remembers window geometry and two backend knobs,
 * and every real preference already lives inside the Harness's own settings.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logWarn } from './logger'

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export interface DesktopSettings {
  /** Listen port for `dsh web`; 0 lets the OS choose (the default). */
  port: number
  /** Extra arguments appended to `dsh web`. */
  extraArgs: string[]
  window: WindowBounds
  zoomLevel: number
  /**
   * The login shell's `PATH`, cached from the previous launch. Resolving it
   * costs seconds, and the backend cannot start without it, so a cold start
   * reuses the last known value and refreshes it in the background.
   */
  shellPath?: string
}

const DEFAULTS: DesktopSettings = {
  port: 0,
  extraArgs: [],
  window: { width: 1440, height: 900, maximized: false },
  zoomLevel: 0,
}

let cache: DesktopSettings | null = null
let writeTimer: NodeJS.Timeout | null = null

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function settings(): DesktopSettings {
  if (cache !== null) return cache
  cache = { ...DEFAULTS, window: { ...DEFAULTS.window } }
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<DesktopSettings>
    if (typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port >= 0) {
      cache.port = parsed.port
    }
    if (Array.isArray(parsed.extraArgs)) {
      cache.extraArgs = parsed.extraArgs.filter((value): value is string => typeof value === 'string')
    }
    if (typeof parsed.zoomLevel === 'number' && Number.isFinite(parsed.zoomLevel)) {
      cache.zoomLevel = Math.max(-5, Math.min(5, parsed.zoomLevel))
    }
    if (typeof parsed.shellPath === 'string' && parsed.shellPath.trim() !== '') {
      cache.shellPath = parsed.shellPath
    }
    if (parsed.window) cache.window = normalizeBounds(parsed.window)
  } catch {
    // First run, or a file someone hand-edited into invalid JSON. Defaults are
    // always a valid answer here, so a broken file must not block startup.
  }
  return cache
}

export function updateSettings(patch: Partial<DesktopSettings>): void {
  cache = { ...settings(), ...patch }
  scheduleWrite()
}

export function rememberWindow(bounds: WindowBounds): void {
  cache = { ...settings(), window: normalizeBounds(bounds) }
  scheduleWrite()
}

export function flushSettings(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (cache === null) return
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  } catch (error) {
    logWarn(`could not persist settings: ${String(error)}`)
  }
}

function scheduleWrite(): void {
  if (writeTimer !== null) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushSettings, 400)
}

function normalizeBounds(bounds: Partial<WindowBounds>): WindowBounds {
  return {
    width: clampSize(bounds.width, DEFAULTS.window.width),
    height: clampSize(bounds.height, DEFAULTS.window.height),
    ...(typeof bounds.x === 'number' && Number.isFinite(bounds.x) ? { x: Math.round(bounds.x) } : {}),
    ...(typeof bounds.y === 'number' && Number.isFinite(bounds.y) ? { y: Math.round(bounds.y) } : {}),
    maximized: bounds.maximized === true,
  }
}

function clampSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(600, Math.round(value))
}
