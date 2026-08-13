/**
 * Rasterizes build/icon.svg to the 1024px PNG electron-builder converts into
 * .icns and .ico. The PNG is committed so a release build never depends on this
 * script or on sharp being installable.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { log, projectRoot } from './shared.mjs'

const source = path.join(projectRoot, 'build', 'icon.svg')
const target = path.join(projectRoot, 'build', 'icon.png')

const png = await sharp(readFileSync(source), { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toBuffer()

writeFileSync(target, png)
log(`wrote ${path.relative(projectRoot, target)} (${(png.length / 1024).toFixed(1)} KiB)`)
