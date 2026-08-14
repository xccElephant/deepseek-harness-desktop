/**
 * The native application menu. Beyond the platform standards, it exposes the
 * three things only the shell can do — restart the backend, reach the logs, and
 * hand the running session to a browser — plus the Harness home directory,
 * which is where every config file the user may need to edit actually lives.
 */

import os from 'node:os'
import path from 'node:path'
import { Menu, app, clipboard, dialog, shell, type MenuItemConstructorOptions } from 'electron'
import { logFolder } from './logger'
import { checkForUpdates } from './updates'
import { applyZoom, createWindow, focusedWindow, openExternally, reloadHarness } from './windows'
import type { Backend } from './backend'

const UPSTREAM_URL = 'https://github.com/deepseek-ai/deepseek-harness'
const DOCS_URL = 'https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart'
const PROJECT_URL = 'https://github.com/xccElephant/deepseek-harness-desktop'

export function installMenu(backend: Backend): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template(backend)))
}

function template(backend: Backend): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.getName(),
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []

  return [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            createWindow(backend.currentState())
          },
        },
        { type: 'separator' },
        {
          label: 'Open Harness Home',
          click: () => {
            void shell.openPath(harnessHome())
          },
        },
        {
          label: 'Open Log Folder',
          click: () => {
            void shell.openPath(logFolder())
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Interface',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            reloadHarness()
          },
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            applyZoom(0.5)
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            applyZoom(-0.5)
          },
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            applyZoom('reset')
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Backend',
      submenu: [
        {
          label: 'Restart Backend',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            void backend.restart()
          },
        },
        {
          label: 'Copy Server URL',
          enabled: backend.url() !== null,
          click: () => {
            const url = backend.url()
            if (url !== null) clipboard.writeText(url)
          },
        },
        {
          label: 'Open in Browser',
          enabled: backend.url() !== null,
          click: () => {
            const url = backend.url()
            if (url !== null) void openExternally(url)
          },
        },
        { type: 'separator' },
        {
          label: 'Backend Status\u2026',
          click: () => {
            void showStatusDialog(backend)
          },
        },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Harness Documentation',
          click: () => {
            void openExternally(DOCS_URL)
          },
        },
        {
          label: 'Upstream Project (deepseek-ai/deepseek-harness)',
          click: () => {
            void openExternally(UPSTREAM_URL)
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates\u2026',
          click: () => {
            void checkForUpdates(false)
          },
        },
        {
          label: 'Desktop Releases',
          click: () => {
            void openExternally(`${PROJECT_URL}/releases`)
          },
        },
        {
          label: 'Report a Desktop Issue',
          click: () => {
            void openExternally(`${PROJECT_URL}/issues`)
          },
        },
      ],
    },
  ]
}

function harnessHome(): string {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
}

async function showStatusDialog(backend: Backend): Promise<void> {
  const state = backend.currentState()
  const runtime = backend.nodeRuntime()
  const detail = [
    `State: ${state.phase}`,
    state.phase === 'ready' ? `Address: ${state.url}` : null,
    state.phase === 'failed' ? `Reason: ${state.message}` : null,
    runtime === null ? null : `Node: ${runtime.version} (${runtime.source})`,
    `App: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const window = focusedWindow()
  const options = {
    type: 'info' as const,
    message: 'Harness backend',
    detail,
    buttons: ['Close', 'Copy Details', 'Open Log Folder'],
    defaultId: 0,
    cancelId: 0,
  }
  const result =
    window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options)
  if (result.response === 1) clipboard.writeText(detail)
  if (result.response === 2) void shell.openPath(logFolder())
}
