import { test, expect, type Page } from '@playwright/test'
import { mockStudioSession } from './studio-session'
import { MAKE_FIXTURES } from '../src/make/workspace-model.ts'
import { compileAppProject } from '../src/make/compiler.ts'
import { createAppProject, validateAppProject } from '../src/make/manifest.ts'

const saved = createAppProject({ id: 'saved-counter', name: 'Saved Counter', files: MAKE_FIXTURES.counter.files })

async function services(page: Page) {
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => {
    expect(route.request().headers()['x-paper-account']).toBe('studio-test')
    return route.fulfill({ json: { budget: {
      usedTurns: 5, remainingTurns: 45, limitTurns: 50,
      usedTokens: 1200, remainingTokens: 198800, limitTokens: 200000,
    } } })
  })
  const projects = new Map([[saved.id, saved]])
  await page.route('**/api/apps', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-paper-account']).toBe('studio-test')
      const project = validateAppProject(route.request().postDataJSON().project)
      projects.set(project.id, project)
      await route.fulfill({ status: 201, json: project })
    } else await route.fulfill({ json: { apps: [...projects.values()] } })
  })
  await page.route('**/api/apps/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({ status: projects.has(id) ? 200 : 404, json: projects.get(id) ?? { error: 'Not found' } })
  })
  await page.route('**/api/apps/compile', async route => {
    expect(route.request().headers()['x-paper-account']).toBe('studio-test')
    expect(route.request().headers()['x-paper-client']).toBe('web')
    await route.fulfill({ json: await compileAppProject(route.request().postDataJSON().project) })
  })
  await page.goto('/')
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
}

test('saved app runs interactively, stops, and preserves scene state and undo across workspace switches', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await services(page)
  await page.getByTestId('tool-rectangle').click()
  const id = await page.locator('.scene-node.is-selected').getAttribute('data-element-id')
  const camera = await page.getByTestId('viewport-world').getAttribute('style')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(saved.id)
  await expect(page.getByRole('heading', { name: 'Saved Counter', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  await expect(preview.getByRole('heading', { name: 'Counter Prototype' })).toBeVisible()
  await preview.getByRole('button', { name: 'Increment' }).click()
  await expect(preview.locator('.value')).toHaveText('1')
  await preview.getByRole('textbox', { name: 'Note' }).fill('Hello from Make')
  await expect(preview.locator('.note-preview')).toHaveText('Hello from Make')
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
  await page.screenshot({ path: '/tmp/paper-make-desktop.png' })
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Design workspace', exact: true }).click()
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await expect(page.locator(`.scene-node[data-element-id="${id}"]`)).toHaveClass(/is-selected/)
  await expect(page.getByTestId('viewport-world')).toHaveAttribute('style', camera!)
  await page.getByTestId('history-undo').click()
  await expect(page.locator(`.scene-node[data-element-id="${id}"]`)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('account budget loads for an unsaved draft and remains readable on mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await services(page)
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  const badge = page.getByTestId('make-budget-badge')
  await expect(badge).toHaveText('45 turns')
  await expect(badge).toHaveAttribute('title', 'Turns: 45/50 remaining')
  await page.getByRole('button', { name: 'New app', exact: true }).click()
  await expect(badge).toHaveText('45 turns')
  await page.screenshot({ path: '/tmp/paper-make-budget-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(badge).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/paper-make-budget-mobile.png' })
  expect(errors).toEqual([])
})

test('malformed app shows file, line, fix guidance and retry without a blank iframe', async ({ page }) => {
  await services(page)
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption('fixture-malformed')
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not compile')
  await expect(page.getByTestId('make-diagnostics')).toContainText('Syntax Error')
  await expect(page.getByTestId('make-diagnostics')).toContainText(/src\/App.tsx:\d+:\d+/)
  await expect(page.getByTestId('make-diagnostics')).toContainText('unmatched tags')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry preview' }).click()
  await expect(page.getByRole('alert')).toContainText('could not compile')
  await page.screenshot({ path: '/tmp/paper-make-error.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Retry preview' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/paper-make-mobile.png' })
})

test('loading can be stopped and a failed compile request can be retried', async ({ page }) => {
  await services(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/apps/compile', async route => {
    await pending
    await route.fulfill({ status: 503, json: { error: 'Compiler temporarily unavailable' } })
  })
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Loading')
  await expect(page.getByText('Compiling your app…')).toBeVisible()
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click()
  release()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Stopped')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Compiler temporarily unavailable')
  await page.unroute('**/api/apps/compile')
  await page.route('**/api/apps/compile', async route => route.fulfill({ json: await compileAppProject(route.request().postDataJSON().project) }))
  await page.getByRole('button', { name: 'Retry preview' }).click()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
})

test('save a copy survives reload and runtime failures show a retryable error', async ({ page }) => {
  await services(page)
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Save a copy' }).click()
  await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
  const savedId = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
  expect(savedId).not.toBe('fixture-counter')
  await page.reload()
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(savedId)
  await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
  const broken = await compileAppProject(createAppProject({ files: { 'src/App.tsx': 'export default function App() { throw new Error("Broken render in App") }' } }))
  expect(broken.success).toBe(true)
  await page.route('**/api/apps/compile', route => route.fulfill({ json: broken }))
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Broken render in App')
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry preview' })).toBeVisible()
})
