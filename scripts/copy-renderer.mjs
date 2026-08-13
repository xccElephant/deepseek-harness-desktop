/**
 * Copies the status surface into `dist/renderer`. It is plain HTML, CSS, and a
 * script, so it needs no bundler; keeping it unbuilt means the failure screen
 * cannot itself fail to build.
 */

import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { log, projectRoot } from './shared.mjs'

const source = path.join(projectRoot, 'src', 'renderer')
const destination = path.join(projectRoot, 'dist', 'renderer')

mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
log(`renderer assets copied to ${path.relative(projectRoot, destination)}`)
