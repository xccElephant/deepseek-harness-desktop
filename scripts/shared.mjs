import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function manifest() {
  return JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
}

/**
 * The pinned payload versions. Both the Node runtime shipped in the installer
 * and the CI toolchain that compiles the Harness's native modules read this, so
 * the ABI the modules are built against always matches the runtime that loads
 * them.
 */
export function payloadVersions() {
  const { dshDesktop } = manifest()
  if (!dshDesktop?.dshVersion || !dshDesktop?.nodeVersion) {
    throw new Error('package.json is missing the dshDesktop.{dshVersion,nodeVersion} pins')
  }
  return { dsh: dshDesktop.dshVersion, node: dshDesktop.nodeVersion }
}

export function resourcesDir(...segments) {
  return path.join(projectRoot, 'resources', ...segments)
}

export function log(message) {
  process.stdout.write(`${message}\n`)
}

export function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}
