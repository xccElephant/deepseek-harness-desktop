/**
 * Installs the pinned `@deepseek-ai/dsh` release into `resources/dsh`, which
 * electron-builder then ships outside the asar archive so the runtime can spawn
 * it as a real file tree.
 *
 * This runs `npm install` natively rather than cross-installing, because the
 * Harness depends on `node-pty` (compiled) and `sharp` (per-platform binaries).
 * Each installer is therefore built on a runner of its own platform.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fail, log, payloadVersions, resourcesDir } from './shared.mjs'

const argv = process.argv.slice(2)
const { dsh: wanted, node: pinnedNode } = payloadVersions()
const root = resourcesDir('dsh')
const installed = installedVersion()

warnOnRuntimeMismatch(pinnedNode)

if (installed === wanted && !argv.includes('--force')) {
  log(`harness payload already at ${wanted}: ${root}`)
  process.exit(0)
}

if (installed !== null) {
  log(`replacing harness payload ${installed} with ${wanted}`)
  rmSync(root, { recursive: true, force: true })
}

mkdirSync(root, { recursive: true })
writeFileSync(
  path.join(root, 'package.json'),
  `${JSON.stringify({ name: 'dsh-payload', private: true, version: '0.0.0' }, null, 2)}\n`,
  'utf8',
)

log(`installing @deepseek-ai/dsh@${wanted} (this compiles native modules and takes a few minutes)`)
const npm = npmInvocation()
const install = spawnSync(
  npm.command,
  [
    ...npm.prefixArgs,
    'install',
    `@deepseek-ai/dsh@${wanted}`,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ],
  { cwd: root, stdio: 'inherit' },
)
if (install.error) fail(`could not run npm (${npm.command}): ${install.error.message}`)
if (install.status !== 0) fail(`npm install of the harness payload exited with ${install.status}`)

const entry = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(entry)) fail(`installed payload has no CLI entry at ${entry}`)
log(`harness payload ready: ${entry}`)

/**
 * Node refuses to spawn `.cmd` shims without a shell, so on Windows we drive
 * npm's own JS entry point with the current interpreter instead.
 */
function npmInvocation() {
  const execpath = process.env.npm_execpath
  if (execpath?.endsWith('.js') && existsSync(execpath)) {
    return { command: process.execPath, prefixArgs: [execpath] }
  }
  if (process.platform !== 'win32') return { command: 'npm', prefixArgs: [] }

  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(cli)) return { command: process.execPath, prefixArgs: [cli] }
  fail('could not locate npm-cli.js next to the Node runtime; run this script through `npm run`')
}

function installedVersion() {
  const manifest = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null
  } catch {
    return null
  }
}

function warnOnRuntimeMismatch(pinned) {
  const current = process.versions.node
  if (current.split('.')[0] !== pinned.split('.')[0]) {
    process.stderr.write(
      `warning: installing with Node v${current} while the bundled runtime is v${pinned}.\n` +
        '  Native modules are built for the installing ABI, so a release build must use the pinned major.\n',
    )
  }
}
