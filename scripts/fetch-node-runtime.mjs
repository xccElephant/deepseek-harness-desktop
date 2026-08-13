/**
 * Downloads the pinned Node runtime and keeps only the executable.
 *
 * The installer ships this binary so a user needs nothing preinstalled, and the
 * version is pinned because the Harness's native modules (`node-pty`, `sharp`)
 * are compiled against one ABI: the runtime here and the Node that runs
 * `prepare-dsh` must be the same major.
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fail, log, payloadVersions, resourcesDir } from './shared.mjs'

const TARGETS = {
  'darwin-arm64': { slug: 'darwin-arm64', archive: 'tar.gz', binary: 'bin/node', out: 'node' },
  'darwin-x64': { slug: 'darwin-x64', archive: 'tar.gz', binary: 'bin/node', out: 'node' },
  'linux-x64': { slug: 'linux-x64', archive: 'tar.gz', binary: 'bin/node', out: 'node' },
  'linux-arm64': { slug: 'linux-arm64', archive: 'tar.gz', binary: 'bin/node', out: 'node' },
  'win32-x64': { slug: 'win-x64', archive: 'zip', binary: 'node.exe', out: 'node.exe' },
  'win32-arm64': { slug: 'win-arm64', archive: 'zip', binary: 'node.exe', out: 'node.exe' },
}

const argv = process.argv.slice(2)
const platform = readFlag('--platform') ?? process.platform
const arch = readFlag('--arch') ?? process.arch
const key = `${platform}-${arch}`
const target = TARGETS[key]
if (!target) fail(`unsupported target ${key}; supported: ${Object.keys(TARGETS).join(', ')}`)

const version = payloadVersions().node
const destination = resourcesDir('runtime')
const binaryPath = path.join(destination, target.out)

if (!argv.includes('--force') && isCurrent(binaryPath, version)) {
  log(`node runtime already at v${version}: ${binaryPath}`)
  process.exit(0)
}

const base = `https://nodejs.org/dist/v${version}`
const archiveName = `node-v${version}-${target.slug}.${target.archive}`
const staging = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-node-'))

try {
  log(`fetching ${archiveName}`)
  const archive = await download(`${base}/${archiveName}`)
  const expected = await expectedChecksum(`${base}/SHASUMS256.txt`, archiveName)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) {
    fail(`checksum mismatch for ${archiveName}\n  expected ${expected}\n  actual   ${actual}`)
  }
  log('checksum verified')

  const archivePath = path.join(staging, archiveName)
  writeFileSync(archivePath, archive)

  // bsdtar reads both tarballs and zips, and ships with macOS, Linux, and
  // Windows 10+, so extraction needs no dependency of its own.
  const member = `node-v${version}-${target.slug}/${target.binary}`
  const extract = spawnSync('tar', ['-xf', archivePath, '-C', staging, member], {
    stdio: 'inherit',
  })
  if (extract.status !== 0) fail(`could not extract ${member} from ${archiveName}`)

  mkdirSync(destination, { recursive: true })
  copyFileSync(path.join(staging, member), binaryPath)
  if (platform !== 'win32') chmodSync(binaryPath, 0o755)
  writeFileSync(
    path.join(destination, 'VERSION'),
    `v${version} ${target.slug}\n`,
    'utf8',
  )
  log(`node runtime ready: ${binaryPath}`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}

function readFlag(name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function isCurrent(binary, wanted) {
  if (!existsSync(binary)) return false
  const probe = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  return probe.status === 0 && probe.stdout.trim() === `v${wanted}`
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`GET ${url} responded ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function expectedChecksum(url, name) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`GET ${url} responded ${response.status}`)
  for (const line of (await response.text()).split('\n')) {
    const [hash, file] = line.trim().split(/\s+/)
    if (file === name) return hash
  }
  fail(`${name} is not listed in SHASUMS256.txt`)
}
