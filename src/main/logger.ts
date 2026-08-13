/**
 * One log file plus an in-memory tail. The tail exists because a backend that
 * fails to start has to explain itself inside the window: a user should never
 * have to open a terminal to learn why the app is blank.
 */

import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 2 * 1024 * 1024
const TAIL_LINES = 400

let stream: WriteStream | null = null
let logPath = ''
const tail: string[] = []

export function initLogger(): void {
  const dir = path.join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logPath = path.join(dir, 'desktop.log')
  try {
    if (statSync(logPath).size > MAX_BYTES) renameSync(logPath, `${logPath}.1`)
  } catch {
    // No previous log, or a rotation race; either way the fresh stream is fine.
  }
  stream = createWriteStream(logPath, { flags: 'a' })
  write('info', `--- session start ${new Date().toISOString()} ---`)
}

export function logFilePath(): string {
  return logPath
}

export function logFolder(): string {
  return path.dirname(logPath)
}

/** The last lines seen, oldest first, for the in-window diagnostics view. */
export function logTail(count = 40): string[] {
  return tail.slice(-count)
}

export function logInfo(message: string): void {
  write('info', message)
}

export function logWarn(message: string): void {
  write('warn', message)
}

export function logError(message: string): void {
  write('error', message)
}

/** Forward a raw chunk from the backend, split into whole lines. */
export function logBackend(source: 'stdout' | 'stderr', chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim() !== '') write(source === 'stderr' ? 'backend!' : 'backend', line)
  }
}

function write(level: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${level}: ${message}`
  tail.push(line)
  if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES)
  stream?.write(`${line}\n`)
  if (!app.isPackaged) console.log(line)
}
