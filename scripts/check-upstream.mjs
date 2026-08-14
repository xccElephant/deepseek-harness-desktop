/**
 * Compares the pinned Harness version against the one npm currently serves as
 * `latest`, and optionally rewrites the pin.
 *
 * Output is `key=value` lines so a workflow can append it straight to
 * `$GITHUB_OUTPUT`; nothing else may be written to stdout.
 *
 * usage: node check-upstream.mjs [--pin]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fail, payloadVersions, projectRoot } from './shared.mjs'

const PACKAGE = '@deepseek-ai/dsh'
const REGISTRY = `https://registry.npmjs.org/${PACKAGE.replace('/', '%2f')}`

const pinned = payloadVersions().dsh
const latest = await latestRelease()
const outdated = latest !== pinned

process.stdout.write(`pinned=${pinned}\nlatest=${latest}\noutdated=${String(outdated)}\n`)

if (outdated && process.argv.includes('--pin')) {
  pin(latest)
}

async function latestRelease() {
  const response = await fetch(REGISTRY, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    fail(`could not reach the npm registry: ${String(error)}`)
  })

  if (!response.ok) fail(`the npm registry answered ${response.status} for ${PACKAGE}`)

  const version = (await response.json())['dist-tags']?.latest
  if (typeof version !== 'string' || version === '') {
    fail(`${PACKAGE} has no \`latest\` dist-tag`)
  }
  return version
}

/**
 * Rewrites the one field instead of re-serialising the manifest, so key order
 * and formatting survive untouched.
 */
function pin(version) {
  const file = path.join(projectRoot, 'package.json')
  const before = readFileSync(file, 'utf8')
  const after = before.replace(/("dshVersion":\s*)"[^"]*"/, `$1"${version}"`)
  if (after === before) fail('could not find dshVersion in package.json')
  writeFileSync(file, after, 'utf8')

  // The edit above is textual, so read it back to prove the file is still valid
  // JSON and carries the new pin.
  const written = JSON.parse(readFileSync(file, 'utf8')).dshDesktop?.dshVersion
  if (written !== version) fail(`package.json still pins ${String(written)} after the rewrite`)
}
