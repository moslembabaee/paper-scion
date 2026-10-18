import { test, expect, type Page } from '@playwright/test'
import { mockStudioSession } from './studio-session'
import { MAKE_FIXTURES } from '../src/make/workspace-model'
import { createAppPlan } from '../src/make/plan'

async function setup(page: Page, saved = false) {
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ json: { budget: { remainingTurns: 40 } } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: saved ? [MAKE_FIXTURES.counter] : [] } }))
  await page.route('**/api/apps/fixture-counter', route => route.fulfill({ json: MAKE_FIXTURES.counter }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  if (saved) {
    await page.getByRole('combobox', { name: 'Make project' }).selectOption('fixture-counter')
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
  }
}

function response(prompt: string, saved = false) {
  return { plan: createAppPlan({
    appId: saved ? 'fixture-counter' : undefined, baseRevision: saved ? 1 : 0, prompt,
    summary: `Plan for ${prompt}`, files: [{ path: 'src/App.tsx', description: 'Add a keyboard accessible reset button', action: 'modify' }],
    interactions: ['Reset clears the counter'], risks: ['Counter state resets on reload'],
  }) }
}

test('keyboard prompt, inspect, revise and approve leaves source and scene unchanged at desktop and mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.getByRole('button', { name: 'Design workspace', exact: true }).click()
  await page.getByTestId('tool-rectangle').click()
  const elementId = await page.locator('.scene-node.is-selected').getAttribute('data-element-id')
  const camera = await page.getByTestId('viewport-world').getAttribute('style')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  const source = await page.getByRole('region', { name: 'Source files' }).textContent()
  let writes = 0
  page.on('request', req => { if (['POST', 'PUT', 'DELETE'].includes(req.method()) && /\/api\/apps(?:\/|$)/.test(req.url())) writes++ })
  await page.route('**/api/model/plan', route => route.fulfill({ json: response(route.request().postDataJSON().prompt) }))
  const input = page.getByRole('textbox', { name: 'Prompt for app planning' })
  await expect(page.getByRole('button', { name: 'Generate plan', exact: true })).toBeDisabled()
  await input.fill('Add reset')
  await input.press('Enter')
  const card = page.getByRole('region', { name: 'App plan', exact: true })
  await expect(card).toBeFocused()
  await expect(card.getByRole('list', { name: 'Planned files list' })).toContainText('src/App.tsx')
  await expect(card.getByRole('list', { name: 'Planned interactions list' })).toContainText('Reset clears')
  await expect(card.getByRole('list', { name: 'Planned risks list' })).toContainText('reload')
  await page.screenshot({ path: '/tmp/paper-plan-desktop.png' })
  await page.getByRole('button', { name: 'Revise plan', exact: true }).click()
  const revision = page.getByRole('textbox', { name: 'Revise plan instructions' })
  await expect(revision).toBeFocused()
  await expect(page.getByRole('button', { name: 'Update plan', exact: true })).toBeDisabled()
  await revision.fill('Add reset with confirmation')
  await revision.press('Enter')
  await expect(card).toContainText('Plan for Add reset with confirmation')
  await expect(card).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Approve plan', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/paper-plan-mobile.png' })
  await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Approved')
  await expect(page.getByRole('button', { name: 'Approve plan', exact: true })).toBeDisabled()
  expect(await page.getByRole('region', { name: 'Source files' }).textContent()).toBe(source)
  expect(writes).toBe(0)
  await page.getByRole('button', { name: 'Dismiss plan' }).click()
  await expect(input).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'Design workspace', exact: true }).click()
  await expect(page.locator(`.scene-node[data-element-id="${elementId}"]`)).toHaveClass(/is-selected/)
  await expect(page.getByTestId('viewport-world')).toHaveAttribute('style', camera!)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('malformed plan displays an accessible recoverable error without an approval control', async ({ page }) => {
  await setup(page)
  await page.route('**/api/model/plan', route => route.fulfill({ json: { plan: { summary: 'Incomplete' } } }))
  const input = page.getByRole('textbox', { name: 'Prompt for app planning' })
  await input.fill('Add reset')
  await input.press('Enter')
  await expect(page.getByRole('alert')).toContainText(/plan/i)
  await expect(page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate plan', exact: true })).toBeEnabled()
})

test('planning announces progress, supports cancellation and ignores a late response', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/model/plan', async route => { await pending; await route.fulfill({ json: response('Reset') }).catch(() => {}) })
  await page.getByRole('textbox', { name: 'Prompt for app planning' }).fill('Reset')
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Planning your app' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel planning', exact: true }).click()
  release()
  await expect(page.getByRole('textbox', { name: 'Prompt for app planning' })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'App plan', exact: true })).toHaveCount(0)
})

test('saved approval waits for the server and reports stale rejection without showing Approved', async ({ page }) => {
  await setup(page, true)
  await page.route('**/api/apps/fixture-counter/plan', route => route.fulfill({ json: response(route.request().postDataJSON().prompt, true) }))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/apps/fixture-counter/plan/approve', async route => { await pending; await route.fulfill({ status: 409, json: { error: 'Stale plan approval: revision changed' } }) })
  await page.getByRole('textbox', { name: 'Prompt for app planning' }).fill('Reset')
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve plan', exact: true })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'Approving' })).toBeVisible()
  release()
  await expect(page.getByRole('alert').filter({ hasText: 'Stale plan approval' })).toBeVisible()
  await expect(page.getByText('Approved', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve plan', exact: true })).toBeDisabled()
})
