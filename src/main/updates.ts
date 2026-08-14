/**
 * Tells the user when a newer desktop build exists.
 *
 * It stops at telling. Installing an update automatically would mean executing a
 * downloaded binary with no developer certificate to validate it against, so the
 * app opens the release page and lets the user decide.
 */

import { app, dialog } from 'electron'
import { logInfo, logWarn } from './logger'
import { settings, updateSettings } from './settings'
import { focusedWindow, openExternally } from './windows'

const REPO = 'xccElephant/deepseek-harness-desktop'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const TIMEOUT_MS = 8_000

/** How long after startup the background check runs, to stay out of its way. */
const STARTUP_DELAY_MS = 6_000

interface Release {
  version: string
  url: string
}

/**
 * @param silent When true, say nothing unless there is an update the user has
 *   not already dismissed. The menu item passes false and reports either way.
 */
export async function checkForUpdates(silent: boolean): Promise<void> {
  let release: Release | null
  try {
    release = await latestRelease()
  } catch (error) {
    logWarn(`update check failed: ${String(error)}`)
    if (!silent) {
      await notify('Could not check for updates', 'GitHub could not be reached just now.')
    }
    return
  }

  const current = app.getVersion()
  if (release === null || compareVersions(release.version, current) <= 0) {
    logInfo(`update check: ${current} is current`)
    if (!silent) {
      await notify(`${app.getName()} ${current} is up to date`, 'No newer release is published.')
    }
    return
  }

  logInfo(`update check: ${release.version} is available (running ${current})`)
  if (silent && settings().skippedVersion === release.version) return

  await offer(release, current, silent)
}

async function offer(release: Release, current: string, silent: boolean): Promise<void> {
  // Skipping is only offered to a check the user did not ask for; when they went
  // looking for updates themselves, suppressing this one forever is not useful.
  const buttons = silent
    ? ['Download', 'Later', 'Skip This Version']
    : ['Download', 'Close']

  const result = await ask({
    type: 'info',
    message: `${app.getName()} ${release.version} is available`,
    detail: `You are running ${current}. Updating means downloading the new installer; the app cannot replace itself.`,
    buttons,
    defaultId: 0,
    cancelId: 1,
  })

  if (result === 0) void openExternally(release.url)
  if (result === 2) {
    updateSettings({ skippedVersion: release.version })
    logInfo(`skipping notifications for ${release.version}`)
  }
}

/**
 * Two ways to ask, because neither is sufficient alone.
 *
 * The REST API is authoritative but allows 60 unauthenticated calls an hour per
 * address, which a user behind a shared or carrier-grade NAT can find already
 * spent. The web redirect has no such budget, but is served from a cache that
 * was observed lagging minutes behind a publish. So: ask the API, and fall back
 * to the redirect only when it will not answer.
 */
export async function latestRelease(): Promise<Release | null> {
  try {
    return await latestFromApi()
  } catch (error) {
    logInfo(`the releases API did not answer (${String(error)}); reading the redirect instead`)
    return await latestFromRedirect()
  }
}

async function latestFromApi(): Promise<Release | null> {
  const response = await get(LATEST_API, { accept: 'application/vnd.github+json' })
  // 404 is a real answer: the repository has no published release.
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)

  const tag: unknown = ((await response.json()) as { tag_name?: unknown }).tag_name
  if (typeof tag !== 'string' || tag === '') throw new Error('the release carried no tag')
  return release(tag)
}

async function latestFromRedirect(): Promise<Release | null> {
  const response = await get(RELEASES_PAGE, {}, 'manual')
  const location = response.headers.get('location')
  if (location === null) {
    // A repository with no published release answers 200 and stays put.
    if (response.status === 200) return null
    throw new Error(`GitHub answered ${response.status} without a redirect`)
  }

  const tag = /\/releases\/tag\/(.+)$/.exec(location)?.[1]
  if (tag === undefined || tag === '') return null
  return release(tag)
}

function release(tag: string): Release {
  return { version: decodeURIComponent(tag).replace(/^v/, ''), url: RELEASES_PAGE }
}

function get(
  url: string,
  headers: Record<string, string>,
  redirect: RequestRedirect = 'follow',
): Promise<Response> {
  return fetch(url, {
    method: redirect === 'manual' ? 'HEAD' : 'GET',
    redirect,
    // A stale answer is worse than none here, and one request per launch is not
    // worth caching.
    cache: 'no-store',
    headers: {
      // GitHub refuses API requests that do not identify themselves.
      'user-agent': `${app.getName()}/${app.getVersion()}`,
      ...headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/**
 * Compares `major.minor.patch`, ignoring anything after them. Returns 0 when
 * either side is unparseable, so a version scheme this does not understand can
 * never produce a false update prompt.
 */
export function compareVersions(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  if (left === null || right === null) return 0
  const [leftMajor, leftMinor, leftPatch] = left
  const [rightMajor, rightMinor, rightPatch] = right
  if (leftMajor !== rightMajor) return leftMajor < rightMajor ? -1 : 1
  if (leftMinor !== rightMinor) return leftMinor < rightMinor ? -1 : 1
  if (leftPatch !== rightPatch) return leftPatch < rightPatch ? -1 : 1
  return 0
}

function parts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function notify(message: string, detail: string): Promise<number> {
  return ask({ type: 'info', message, detail, buttons: ['Close'], defaultId: 0, cancelId: 0 })
}

async function ask(options: Electron.MessageBoxOptions): Promise<number> {
  const window = focusedWindow()
  const result =
    window === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options)
  return result.response
}

/** Runs one check well after startup, and never blocks it. */
export function scheduleUpdateCheck(): void {
  const timer = setTimeout(() => {
    void checkForUpdates(true)
  }, STARTUP_DELAY_MS)
  timer.unref()
}
