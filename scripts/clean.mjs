import { rmSync } from 'node:fs'
import path from 'node:path'
import { log, projectRoot } from './shared.mjs'

for (const target of ['dist', 'release']) {
  rmSync(path.join(projectRoot, target), { recursive: true, force: true })
  log(`removed ${target}/`)
}
