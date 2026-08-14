/**
 * Tests for the update checker, run inside Electron because the code under test
 * needs `app` and `dialog` to exist.
 *
 * The behavioural cases stub `fetch`, so they neither need the network nor go
 * stale when a new release is published. One case does reach GitHub, to catch a
 * change in how `/releases/latest` answers; it reports and moves on when the
 * network is unavailable rather than failing the suite.
 *
 * usage: electron test/updates.test.cjs
 */

const path = require('node:path')
const os = require('node:os')
const { existsSync, readFileSync, rmSync } = require('node:fs')
const { app, dialog } = require('electron')

const dist = path.join(__dirname, '..', 'dist', 'main')
const userData = path.join(os.tmpdir(), 'dsh-desktop-update-test')

rmSync(userData, { recursive: true, force: true })
app.setPath('userData', userData)

let shown = []
let choice = 1

dialog.showMessageBox = (...args) => {
  const options = args.length > 1 ? args[1] : args[0]
  shown.push({ message: options.message, buttons: options.buttons ?? [] })
  return Promise.resolve({ response: choice, checkboxChecked: false })
}

/** Answers every request the way GitHub answers `/releases/latest`. */
function serveTag(tag) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: `https://github.com/o/r/releases/tag/${tag}` },
      }),
    )
}

function serveStatus(status) {
  globalThis.fetch = () => Promise.resolve(new Response(null, { status }))
}

function serveFailure() {
  globalThis.fetch = () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'))
}

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok    ${label}`)
    return
  }
  failures += 1
  console.log(`FAIL  ${label}${detail === undefined ? '' : ` — got ${detail}`}`)
}

function settingsPath() {
  return path.join(userData, 'settings.json')
}

function skipped() {
  if (!existsSync(settingsPath())) return undefined
  return JSON.parse(readFileSync(settingsPath(), 'utf8')).skippedVersion
}

app.whenReady().then(async () => {
  require(path.join(dist, 'logger.js')).initLogger()
  const { checkForUpdates, compareVersions, latestRelease } = require(path.join(dist, 'updates.js'))
  const { flushSettings } = require(path.join(dist, 'settings.js'))

  const realFetch = globalThis.fetch

  // Ordering, including the case a string comparison gets wrong.
  check('0.10.0 outranks 0.9.0', compareVersions('0.10.0', '0.9.0') === 1)
  check('equal versions tie', compareVersions('1.2.3', '1.2.3') === 0)
  check('patch versions order', compareVersions('1.2.3', '1.2.4') === -1)
  // An unreadable version must never be treated as newer, or every launch would
  // prompt.
  check('unparseable versions tie', compareVersions('nightly', '1.2.3') === 0)
  check('a prerelease suffix is ignored', compareVersions('1.2.3-rc.1', '1.2.3') === 0)

  // The tag is the version, with the `v` removed.
  serveTag('v2.5.1')
  check('the redirect target is the version', (await latestRelease())?.version === '2.5.1')
  serveStatus(200)
  check('a repository with no release yields nothing', (await latestRelease()) === null)

  app.getVersion = () => '1.0.0'

  serveTag('v1.0.0')
  shown = []
  await checkForUpdates(true)
  check('a current app is silent in the background', shown.length === 0, JSON.stringify(shown))

  shown = []
  await checkForUpdates(false)
  check('a current app confirms when asked', /up to date/.test(shown[0]?.message ?? ''), shown[0]?.message)

  // An older release must never prompt, in case `latest` is ever moved back.
  serveTag('v0.9.0')
  shown = []
  await checkForUpdates(true)
  check('an older release does not prompt', shown.length === 0, JSON.stringify(shown))

  serveTag('v1.1.0')
  choice = 1 // Later
  shown = []
  await checkForUpdates(true)
  check('a newer release prompts', shown.length === 1, JSON.stringify(shown))
  check('the prompt offers a download', shown[0]?.buttons?.[0] === 'Download', JSON.stringify(shown[0]?.buttons))
  check('a background prompt can be skipped', shown[0]?.buttons?.includes('Skip This Version') === true)
  check('choosing Later stores nothing', skipped() === undefined, String(skipped()))

  choice = 2 // Skip This Version
  shown = []
  await checkForUpdates(true)
  flushSettings()
  check('skipping persists the version', skipped() === '1.1.0', String(skipped()))

  shown = []
  await checkForUpdates(true)
  check('a skipped version stays quiet', shown.length === 0, JSON.stringify(shown))

  choice = 1 // Close
  shown = []
  await checkForUpdates(false)
  check('an explicit check ignores the skip', shown.length === 1, JSON.stringify(shown))
  check(
    'an explicit check cannot skip',
    shown[0]?.buttons?.includes('Skip This Version') === false,
    JSON.stringify(shown[0]?.buttons),
  )

  // A newer release than the skipped one must be announced again.
  serveTag('v1.2.0')
  shown = []
  await checkForUpdates(true)
  check('a later release breaks through a skip', shown.length === 1, JSON.stringify(shown))

  serveFailure()
  shown = []
  await checkForUpdates(true)
  check('an unreachable GitHub is silent in the background', shown.length === 0, JSON.stringify(shown))

  shown = []
  await checkForUpdates(false)
  check(
    'an unreachable GitHub explains itself when asked',
    /[Cc]ould not check/.test(shown[0]?.message ?? ''),
    shown[0]?.message,
  )

  // The one case that leaves the machine: proves GitHub still redirects
  // `/releases/latest` to a tag this code can read.
  globalThis.fetch = realFetch
  try {
    const live = await latestRelease()
    check(
      'GitHub still redirects to a readable tag',
      live !== null && /^\d+\.\d+\.\d+/.test(live.version),
      JSON.stringify(live),
    )
  } catch (error) {
    console.log(`skip  GitHub was unreachable: ${String(error)}`)
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
  rmSync(userData, { recursive: true, force: true })
  app.exit(failures === 0 ? 0 : 1)
})
