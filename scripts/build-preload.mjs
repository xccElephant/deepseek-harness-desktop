/**
 * Bundles the preload into one file.
 *
 * The window runs with `sandbox: true`, and a sandboxed preload cannot `require`
 * its own relative modules — only a small allowlist including `electron`. Left
 * unbundled, the preload's import of the shared IPC contract would throw and the
 * bridge would silently never appear. Bundling keeps that contract as the single
 * source of truth while shipping the preload as one self-contained script.
 */

import { build } from 'esbuild'
import path from 'node:path'
import { log, projectRoot } from './shared.mjs'

const outfile = path.join(projectRoot, 'dist', 'preload', 'index.js')

await build({
  entryPoints: [path.join(projectRoot, 'src', 'preload', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'browser',
  target: 'chrome130',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
})

log(`preload bundled to ${path.relative(projectRoot, outfile)}`)
