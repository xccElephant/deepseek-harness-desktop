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

import { cpSync, existsSync, readdirSync, readlinkSync } from 'node:fs'
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
    // npm's `node_modules/.bin` entries are relative symlinks. Copying them
    // verbatim keeps them that way; resolving them instead rewrites each one to
    // an absolute path on the build machine, which both dangles on the user's
    // disk and makes codesign reject the bundle.
    cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true })
    const escaped = symlinksEscaping(to)
    if (escaped.length > 0) {
      throw new Error(
        `payload ${payload} has symlinks pointing outside the bundle, which codesign rejects:\n` +
          escaped.map((entry) => `  ${entry}`).join('\n'),
      )
    }
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

/** Lists symlinks under `root` whose target resolves outside of `root`. */
function symlinksEscaping(root) {
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const current = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(current)
      } else if (entry.isSymbolicLink()) {
        const target = path.resolve(path.dirname(current), readlinkSync(current))
        if (path.relative(root, target).startsWith('..')) {
          offenders.push(`${path.relative(root, current)} -> ${readlinkSync(current)}`)
        }
      }
    }
  }
  walk(root)
  return offenders
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
