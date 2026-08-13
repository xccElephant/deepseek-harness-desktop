/**
 * Where the two build-time payloads live. A packaged app finds them beside the
 * app bundle (`process.resourcesPath`); a checkout finds them in `resources/`,
 * which is exactly where the prepare scripts write them, so dev and production
 * resolve the same layout.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export function resourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
}

/** Path to the bundled Node binary, or null when this build has no payload. */
export function bundledNodeBinary(): string | null {
  const binary = path.join(
    resourcesRoot(),
    'runtime',
    process.platform === 'win32' ? 'node.exe' : 'node',
  )
  return existsSync(binary) ? binary : null
}

/** Path to the bundled `dsh` CLI entry point, or null when absent. */
export function dshEntryPoint(): string | null {
  const entry = path.join(
    resourcesRoot(),
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  )
  return existsSync(entry) ? entry : null
}

/** Version of the bundled `dsh`, read from the payload's own manifest. */
export function dshPayloadVersion(): string | null {
  const manifest = path.join(
    resourcesRoot(),
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'package.json',
  )
  if (!existsSync(manifest)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

export function rendererFile(name: string): string {
  return path.join(app.getAppPath(), 'dist', 'renderer', name)
}
