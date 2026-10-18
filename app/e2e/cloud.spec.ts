import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CloudUser } from '../src/cloud/model'

const user: CloudUser = { provider: 'github', id: 'test-account', name: 'Cloud Designer', email: 'designer@paper.test', avatar: '', createdAt: 1, hasMcpToken: false }
const providers = { google: true, github: true }
async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'User profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Profile & account' }).click()
  return page.getByRole('dialog', { name: 'Profile & account', exact: true })
}
async function localRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('paper.workspaces', 1); request.onsuccess = () => resolve(request.result) })
    const projects = await new Promise<{ id: string; document: unknown; cloud?: { owner: string; projectId: string; revision: string; dirty: boolean } }[]>(resolve => { const request = db.transaction('projects').objectStore('projects').getAll(); request.onsuccess = () => resolve(request.result) })
    db.close(); return projects
  })
}

test('a host without auth fails closed with a retryable login gate', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ contentType: 'text/html', body: '<html>Static host</html>' }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Paper — Space to think.' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('couldn’t connect')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
})

test('silent cloud saves, edits, headless pulls and remote token rotation work in the browser', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let remote: { id: string; document: unknown; revision: string; updatedAt: number; createdAt: number; activity?: { ids: string[]; tool: string; until: number } } | undefined
  let generated = false
  let tokenNumber = 0
  await page.route('**/cloud.json', route => route.fulfill({ json: { cloud: true } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { ...user, hasMcpToken: generated }, providers: { google: true, github: true } } }))
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }))
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: remote ? [{ id: remote.id, revision: remote.revision }] : [] } }))
  await page.route('**/api/projects/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      if (input.expectedRevision !== (remote?.revision ?? null)) { await route.fulfill({ status: 409, json: { current: remote } }); return }
      remote = { id, document: input.document, revision: `browser-${++tokenNumber}`, updatedAt: input.updatedAt, createdAt: remote?.createdAt ?? Date.now() }
      await route.fulfill({ json: remote }); return
    }
    await route.fulfill({ status: remote ? 200 : 404, json: remote ?? { error: 'Not found' } })
  })
  await page.route('**/api/auth/token/regenerate', async route => { generated = true; await route.fulfill({ json: { token: `paper_remote-token-${++tokenNumber}`, user: { ...user, hasMcpToken: true, tokenRotatedAt: Date.now() } } }) })
  await page.route('**/api/auth/token', route => route.fulfill({ json: { token: `paper_remote-token-${tokenNumber}` } }))
  await page.goto('/')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => !!remote).toBe(true)
  await expect(page.locator('.cloud-status')).toHaveText('Saved to Cloud')
  const local = await localRecords(page)
  expect(local[0].cloud?.owner).toBe(user.id)
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Synced study')
  await expect.poll(() => (remote?.document as { name: string })?.name).toBe('Synced study')
  // Change the server copy without a browser edit, then reload as a returning user.
  remote = { ...remote!, document: { ...(remote!.document as object), name: 'Edited while closed' }, revision: 'headless-revision', updatedAt: Date.now() + 1000 }
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Edited while closed')
  const settings = await openProfile(page)
  await expect(settings.getByText(user.email)).toBeVisible()
  await settings.getByRole('button', { name: 'Generate MCP token' }).click()
  const field = settings.getByLabel('Cloud MCP Token')
  await expect(field).toHaveValue(/paper_remote-token-/)
  const first = await field.inputValue()
  await settings.getByRole('button', { name: 'Rotate token' }).click()
  await expect(field).not.toHaveValue(first)
  expect(errors).toEqual([])
})

test('signed-out visitors see the login gate with configured providers', async ({ page }) => {
  const projectRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/projects')) projectRequests.push(request.url())
  })
  await page.route('**/cloud.json', route => route.fulfill({ json: { cloud: true } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, providers: { google: true, github: true } } }))
  await page.goto('/')
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Paper — Space to think.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google')
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute('href', '/api/auth/github')
  expect(projectRequests).toEqual([])
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).not.toContain('paper.workspaces')
})

test('profile settings reveal, hide, copy, rotate and revoke server tokens without storing credentials locally', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let profile = { ...user, avatar: 'https://paper.test/avatar.png' }
  let token = ''
  let generation = 0
  let copied = ''
  let rejectRotation = false
  const authorizationAccounts: string[] = []
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: async (text: string) => { (window as unknown as { copiedToken: string }).copiedToken = text } })
    localStorage.setItem('paper.profile.v1', JSON.stringify({ version: 1, name: 'Local Designer', avatar: '', workspaceName: 'Studio', defaultGrid: true, mcpToken: 'obsolete-client-token' }))
  })
  await page.route('https://paper.test/avatar.png', route => route.fulfill({ status: 204 }))
  await page.route('**/cloud.json', route => route.fulfill({ json: { cloud: true } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: profile, providers: { google: true, github: true } } }))
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }))
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [] } }))
  await page.route('**/api/auth/token/regenerate', async route => {
    authorizationAccounts.push(route.request().headers()['x-paper-account'])
    if (rejectRotation) { await route.fulfill({ status: 503, json: { error: 'Please try again.' } }); return }
    token = `paper_${String(++generation).padStart(43, 'a')}`
    profile = { ...profile, hasMcpToken: true }
    await route.fulfill({ json: { token, user: profile } })
  })
  await page.route('**/api/auth/token', async route => {
    authorizationAccounts.push(route.request().headers()['x-paper-account'])
    if (route.request().method() === 'DELETE') {
      token = ''; profile = { ...profile, hasMcpToken: false }
      await route.fulfill({ json: { ok: true, user: profile } }); return
    }
    await route.fulfill({ json: { token } })
  })
  await page.route('**/api/auth/profile', async route => {
    profile = { ...profile, ...route.request().postDataJSON() }
    await route.fulfill({ json: { user: profile } })
  })
  await page.goto('/')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  let settings = await openProfile(page)
  await expect(settings.getByRole('textbox', { name: 'Display name' })).toHaveValue(user.name)
  await expect(settings.getByText(user.email, { exact: true })).toBeVisible()
  await expect(settings.getByText('Signed in with GitHub')).toBeVisible()
  await expect(settings.locator('.profile-identity img')).toHaveAttribute('src', profile.avatar)
  await expect(settings.getByRole('heading', { name: 'Studio preferences' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'AI Agent Access (Model Context Protocol)', exact: true })).toBeVisible()
  await expect(settings).not.toContainText(/Local MCP|Self-host preferences|Only on this device|LOCAL|Remote MCP/)
  await settings.getByRole('button', { name: 'Generate MCP token' }).click()
  const input = settings.getByLabel('Cloud MCP Token')
  await expect(input).toHaveValue(/^paper_/)
  const first = await input.inputValue()
  await settings.getByRole('button', { name: 'Hide token' }).click()
  await expect(input).not.toHaveValue(first)
  await settings.locator('.mcp-config-guide summary').click()
  const snippet = settings.locator('.mcp-config-guide pre')
  await expect(snippet).not.toContainText(first)
  for (const client of ['Claude Code', 'Codex', 'Cursor']) {
    await settings.getByRole('button', { name: client, exact: true }).click()
    await expect(snippet).toContainText('https://paper.141.11.32.213.nip.io/mcp')
    await expect(snippet).toContainText('<YOUR_PAPER_TOKEN>')
    await settings.getByRole('button', { name: 'Copy configuration snippet' }).click()
    const config = await page.evaluate(() => (window as unknown as { copiedToken: string }).copiedToken)
    expect(config).toBe(await snippet.textContent())
    expect(config).not.toContain(first)
    if (client === 'Codex') {
      expect(config).toContain('[mcp_servers.paper]')
      expect(config).toContain('http_headers')
    } else {
      const server = JSON.parse(config).mcpServers.paper
      expect(server.headers.Authorization).toBe('Bearer <YOUR_PAPER_TOKEN>')
      if (client === 'Claude Code') expect(server.type).toBe('http')
    }
  }
  await settings.getByRole('button', { name: 'Copy token' }).click()
  copied = await page.evaluate(() => (window as unknown as { copiedToken: string }).copiedToken)
  expect(copied).toBe(first)
  await expect(settings.getByText('Copied to clipboard')).toBeVisible()
  await settings.getByRole('button', { name: 'Reveal token' }).click()
  await expect(input).toHaveValue(first)
  rejectRotation = true
  await settings.getByRole('button', { name: 'Rotate token' }).click()
  await expect(settings.getByRole('alert')).toHaveText('Please try again.')
  await expect(input).toHaveValue(first)
  await expect(settings.getByRole('button', { name: 'Rotate token' })).toBeEnabled()
  rejectRotation = false
  await settings.getByRole('button', { name: 'Rotate token' }).click()
  await expect(input).not.toHaveValue(first)
  await settings.getByRole('button', { name: 'Revoke token' }).click()
  await expect(input).toBeEmpty()
  await expect(settings.getByRole('button', { name: 'Reveal token' })).toBeDisabled()
  await expect(settings.getByRole('button', { name: 'Copy token' })).toBeDisabled()
  await expect(settings.getByRole('button', { name: 'Generate MCP token' })).toBeVisible()
  expect(authorizationAccounts.every(id => id === user.id)).toBe(true)
  await settings.getByRole('textbox', { name: 'Display name' }).fill('My Studio')
  await settings.getByRole('button', { name: 'Remove', exact: true }).click()
  await settings.getByRole('button', { name: 'Save changes' }).click()
  await expect(settings).toHaveCount(0)
  expect(profile.name).toBe('My Studio')
  expect(profile.avatar).toBe('')
  const local = await page.evaluate(() => localStorage.getItem('paper.profile.v1'))
  expect(local).toContain('Local Designer')
  expect(local).not.toContain(first)
  expect(local).not.toContain('mcpToken')
  expect(local).not.toContain('obsolete-client-token')
  settings = await openProfile(page)
  await expect(settings.getByRole('textbox', { name: 'Display name' })).toHaveValue('My Studio')
  await expect(settings.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('OAuth callback errors appear on the login gate and are decoded only once', async ({ page }) => {
  await page.route('**/cloud.json', route => route.fulfill({ json: { cloud: true } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, providers: { google: true, github: true } } }))
  await page.goto('/?auth_error=Sign-in%20failed%20%28100%25%29')
  await expect(page.getByRole('heading', { name: 'Paper — Space to think.' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Sign-in failed (100%)')
  await expect(page).not.toHaveURL(/auth_error/)
})

test('switching accounts restores only that account’s cached projects', async ({ page }) => {
  let account = { ...user }
  const projects = new Map<string, Map<string, { id: string; document: { name: string }; revision: string; updatedAt: number; createdAt: number }>>()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: account, providers } }))
  await page.route('**/api/events?*', route => route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }))
  const owned = (id: string) => {
    if (!projects.has(id)) projects.set(id, new Map())
    return projects.get(id)!
  }
  await page.route('**/api/projects', route => {
    const records = owned(route.request().headers()['x-paper-account'])
    return route.fulfill({ json: { projects: [...records.values()].map(({ id, revision }) => ({ id, revision })) } })
  })
  await page.route('**/api/projects/*', route => {
    const records = owned(route.request().headers()['x-paper-account'])
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!)
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      records.set(id, { id, document: input.document, revision: `${id}-${input.updatedAt}`, updatedAt: input.updatedAt, createdAt: 1 })
    }
    return route.fulfill({ json: records.get(id) })
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('First account’s study')
  await expect(page.getByTestId('sync-status')).toHaveText('Saved to Cloud')
  const firstId = (await localRecords(page))[0].id
  account = { ...user, id: 'second-account', name: 'Second Designer' }
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Untitled')
  await expect(page.getByTestId('sync-status')).toHaveText('Saved to Cloud')
  await page.getByRole('button', { name: 'Switch project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Your projects' })
  await expect(dialog.getByText('First account’s study')).toHaveCount(0)
  await expect(dialog.locator('.project-item')).toHaveCount(1)
  expect(owned('second-account').has(firstId)).toBe(false)
  expect((await localRecords(page)).find(record => record.id === firstId)?.cloud?.owner).toBe(user.id)
  account = { ...user }
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('First account’s study')
  await expect(page.getByTestId('sync-status')).toHaveText('Saved to Cloud')
  expect(errors).toEqual([])
})
