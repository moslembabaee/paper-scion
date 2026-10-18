import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const user = { id: 'login-designer', name: 'Paper Designer', email: 'designer@paper.test', avatar: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%2381adec"/%3E%3C/svg%3E', createdAt: 1, hasMcpToken: false }
const providers = { google: true, github: true }
const gate = (page: Page) => page.getByRole('heading', { name: 'Paper — Space to think.' })

async function studioServices(page: Page) {
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [] } }))
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }))
}

test('pending sessions show only a loader, then the login gate without initializing a workspace', async ({ page }) => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/auth/session', async route => { await waiting; await route.fulfill({ json: { user: null, providers } }) })
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Opening Paper…')
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
  await expect(gate(page)).toHaveCount(0)
  release()
  await expect(gate(page)).toBeVisible()
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('paper.workspaces')
})

test('theme preview persists through reload and fits a mobile viewport', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, providers } }))
  await page.goto('/')
  await expect(gate(page)).toBeVisible()
  await page.screenshot({ path: '/tmp/paper-login-dark.png' })
  await page.getByRole('button', { name: 'Light studio appearance' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Light studio appearance' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: '/tmp/paper-login-light.png' })
  await page.reload()
  await expect(gate(page)).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/paper-login-mobile.png', fullPage: true })
})

test('a provider callback opens the studio with identity, and sign out returns to the gate', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await studioServices(page)
  let signedIn = false
  let signouts = 0
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: signedIn ? user : null, providers } }))
  await page.route('**/api/auth/github', async route => {
    signedIn = true
    await route.fulfill({ status: 302, headers: { Location: '/?auth=success' } })
  })
  await page.route('**/api/auth/logout', async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['x-paper-account']).toBe(user.id)
    signouts++
    signedIn = false
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click()
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await expect(page).not.toHaveURL(/auth=success/)
  const indicator = page.getByRole('button', { name: 'User profile menu' })
  await expect(indicator).toContainText(user.name)
  await expect(indicator.locator('img')).toBeVisible()
  const name = page.getByRole('textbox', { name: 'Project name', exact: true })
  await name.fill('Saved before sign out')
  await page.screenshot({ path: '/tmp/paper-authenticated-studio.png' })
  await indicator.click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await expect(gate(page)).toBeVisible()
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
  expect(signouts).toBe(1)
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('paper.workspaces', 1); req.onsuccess = () => resolve(req.result) })
    const rows = await new Promise<{ name: string }[]>(resolve => { const req = db.transaction('projects').objectStore('projects').getAll(); req.onsuccess = () => resolve(req.result) })
    db.close()
    return rows.map(row => row.name)
  })).toContain('Saved before sign out')
  await page.reload()
  await expect(gate(page)).toBeVisible()
  expect(errors).toEqual([])
})

test('failed and timed-out session requests offer retry without exposing the canvas', async ({ page }) => {
  let fail = true
  await page.route('**/api/auth/session', async route => {
    if (fail) { await new Promise(resolve => setTimeout(resolve, 5000)); await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return }
    await route.fulfill({ json: { user: null, providers } })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('couldn’t connect', { timeout: 7000 })
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(gate(page)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('aria-disabled', 'false')
})

test('unconfigured providers are explained and cannot navigate', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, providers: { google: false, github: false } } }))
  await page.goto('/')
  await expect(gate(page)).toBeVisible()
  await expect(page.getByText('Sign-in is not configured yet.', { exact: false })).toBeVisible()
  const google = page.getByRole('link', { name: 'Sign in with Google' })
  await expect(google).toHaveAttribute('aria-disabled', 'true')
  await google.click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/')
})

test('malformed session responses show a retryable gate without opening the studio', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 'incomplete' }, providers } }))
  await page.goto('/')
  await expect(gate(page)).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('couldn’t connect')
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('aria-disabled', 'true')
})

test('failed sign out keeps the studio and offers a retry in the header menu', async ({ page }) => {
  await studioServices(page)
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user, providers } }))
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'User profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not sign out')
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeEnabled()
})
