/**
 * Copies the two payloads into the packaged app's resources directory.
 *
 * This is a hook rather than an `extraResources` entry because electron-builder
 * unconditionally skips `node_modules` when copying extra resources — a `filter`
 * of `**\/*` does not override it — which shipped an empty Harness payload. The
 * directory must keep the `node_modules` name, since the Harness resolves its own
 * packages by bare specifier, so copying it here is the way to keep both facts
 * true at once.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAYLOADS = ['runtime', 'dsh']

export default async function afterPack(context) {
  const resourcesDir = resolveResourcesDir(context)

  for (const payload of PAYLOADS) {
    const from = path.join(projectRoot, 'resources', payload)
    if (!existsSync(from)) {
      throw new Error(
        `missing payload resources/${payload}. Run \`npm run prepare:payload\` before packaging.`,
      )
    }
    const to = path.join(resourcesDir, payload)
    cpSync(from, to, { recursive: true, force: true, dereference: true })
    console.log(`  • payload copied  ${payload} -> ${path.relative(context.appOutDir, to)}`)
  }

  const entry = path.join(
    resourcesDir,
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  )
  if (!existsSync(entry)) {
    throw new Error(`packaged app has no Harness entry point at ${entry}`)
  }
  const runtimeEntries = readdirSync(path.join(resourcesDir, 'runtime'))
  if (!runtimeEntries.some((name) => name === 'node' || name === 'node.exe')) {
    throw new Error('packaged app has no bundled Node binary')
  }
}

function resolveResourcesDir(context) {
  if (typeof context.packager.getResourcesDir === 'function') {
    return context.packager.getResourcesDir(context.appOutDir)
  }
  return context.electronPlatformName === 'darwin'
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources',
      )
    : path.join(context.appOutDir, 'resources')
}
