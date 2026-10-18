import { test, expect } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

test.beforeEach(async ({ page }) => { await waitForCanvasReady(page) })

test('Inspect switches layers without changing the batch selection and opens export', async ({ page }) => {
  await page.locator('[data-layer-id="space"] .layer-select').click()
  await page.locator('[data-layer-id="room"] .layer-select').click({ modifiers: ['Shift'] })
  await page.getByTestId('dev-mode-toggle').click()
  const panel = page.getByTestId('dev-mode-panel')
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0)
  await expect(panel).toContainText('2 SELECTED LAYERS')
  await panel.getByRole('button', { name: 'Inspect 02 — Make room' }).click()
  await expect(panel.locator('.dev-element-name')).toHaveText('02 — Make room')
  await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Export 2 layers' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Export scope')).toHaveValue('layers')
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog).toContainText('2 assets · ZIP archive')
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: 'Export 2 layers' })).toBeFocused()
  await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
})

test('copy handles denied clipboard and HTTP fallback without unhandled errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByTestId('tool-text').click()
  await page.getByTestId('dev-mode-toggle').click()
  const panel = page.getByTestId('dev-mode-panel')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } })
    document.execCommand = () => false
  })
  await panel.getByRole('button', { name: 'Copy CSS', exact: true }).click()
  await expect(panel).toContainText('Select and copy the snippet.')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = () => true
  })
  await panel.getByRole('button', { name: 'Copy CSS', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copy CSS', exact: true })).toContainText('Copied')
  await expect(panel.getByRole('button', { name: 'Copy CSS', exact: true })).toBeFocused()
  await expect(page.locator('textarea[aria-label="Copy code"]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Inspect remains available on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('tool-rectangle').click()
  await page.getByTestId('dev-mode-toggle').click()
  const panel = page.getByTestId('dev-mode-panel')
  await expect(panel).toBeVisible()
  const bounds = await panel.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await panel.getByRole('button', { name: 'Export selected layer' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
