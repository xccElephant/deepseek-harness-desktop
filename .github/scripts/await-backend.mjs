/**
 * Waits for a freshly installed app to log a ready backend, then proves the URL
 * actually serves the Harness web UI.
 *
 * usage: node await-backend.mjs <path to desktop.log>
 */

import { readFileSync } from 'node:fs'

const logPath = process.argv[2]
if (!logPath) {
  console.error('error: pass the path to desktop.log')
  process.exit(1)
}

const TIMEOUT_MS = 120_000
const READY = /backend ready at (http:\/\/127\.0\.0\.1:\d+)/g

// The app retries a crashed backend, so a single error line is not conclusive:
// let the timeout decide and dump the whole log when it expires. The last URL is
// the live one; earlier entries belong to backends that have already been retired.
const url = await waitFor('a ready backend', () => {
  const urls = [...read(logPath).matchAll(READY)].map((match) => match[1])
  return urls.at(-1) ?? null
})
console.log(`backend ready at ${url}`)

const body = await waitFor('the web UI', async () => {
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) return null
  return response.text()
})
if (!/<\s*html/i.test(body)) {
  console.error(`error: ${url} did not serve an HTML document`)
  process.exit(1)
}
console.log(`web UI served ${body.length} bytes of HTML`)

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

async function waitFor(what, probe) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== null && result !== undefined) return result
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  console.error(`error: timed out after ${TIMEOUT_MS / 1000}s waiting for ${what}`)
  console.error(`--- ${logPath} ---\n${read(logPath) || '(no log written)'}`)
  process.exit(1)
}
