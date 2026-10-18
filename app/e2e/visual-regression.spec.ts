import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { waitForCanvasReady, waitForViewportSettled, expectShaderRendered } from './helpers'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function capturePng(target: Page | Locator, name: string, testInfo: TestInfo, minBytes = 1000) {
  const screenshotPath = testInfo.outputPath(name)
  const buffer = await target.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide' })
  expect(buffer.length).toBeGreaterThan(minBytes)
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

test.describe('Visual Verification & Regression Prevention', () => {
  // Paper's WebGL shaders honor reduced motion and render their deterministic frame.
  test.use({ reducedMotion: 'reduce' })

  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
    await page.evaluate(() => document.fonts.ready)
    await expectShaderRendered(page.locator('.paper-shader-surface[data-shader="mesh-gradient"]'))
    await expect(page.locator('.local-status')).toHaveText('Saved locally')
  })

  test('captures full canvas overview screenshot matching Paper aesthetic', async ({ page }, testInfo) => {
    const app = page.locator('.paper-app')
    const appBg = await app.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(appBg).toBe('rgb(24, 24, 27)')

    const viewport = page.getByTestId('canvas-viewport')
    const viewportBg = await viewport.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(viewportBg).toBe('rgb(12, 12, 14)')

    await capturePng(page, 'canvas-overview.png', testInfo)
  })

  test('captures engineering grid and rulers screenshot', async ({ page }, testInfo) => {
    await expect(page.getByTestId('viewport-grid')).toBeVisible()
    await expect(page.getByTestId('viewport-ruler-h')).toBeVisible()
    await expect(page.getByTestId('viewport-ruler-v')).toBeVisible()
    await capturePng(page.getByTestId('canvas-viewport'), 'engineering-grid-rulers.png', testInfo)
  })

  test('captures selection bounding box with 8 resize handles and rotate handle', async ({ page }, testInfo) => {
    const frame = page.locator('[data-element-id="space"]')
    await frame.click({ position: { x: 40, y: 15 } })

    const selBox = page.getByTestId('selection-box')
    await expect(selBox).toBeVisible()
    await expect(selBox.locator('.sel-handle')).toHaveCount(8)
    await expect(selBox.locator('[data-handle="rotate"]')).toBeVisible()

    // Capture the viewport so handles outside the selection bounds are not clipped.
    await capturePng(page.getByTestId('canvas-viewport'), 'selection-box-handles.png', testInfo)
  })

  test('captures active shader surface rendering', async ({ page }, testInfo) => {
    const shaderSurface = page.locator('.paper-shader-surface[data-shader="mesh-gradient"]')
    await capturePng(shaderSurface, 'shader-surface-render.png', testInfo, 500)
  })

  test('captures Dev Mode inspector with generated React and Tailwind code', async ({ page }, testInfo) => {
    const frame = page.locator('[data-element-id="space"]')
    await frame.click({ position: { x: 40, y: 15 } })
    await expect(page.getByTestId('selection-box')).toBeVisible()

    await page.getByTestId('dev-mode-toggle').click()
    const devPanel = page.getByTestId('dev-mode-panel')
    await expect(devPanel).toBeVisible()
    await expect(devPanel).toContainText('DEV MODE')
    await expect(devPanel).toContainText('DIMENSIONS')

    // Exact matching excludes the separate "View generated code" action.
    await devPanel.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(devPanel).toContainText('Tailwind CSS')
    await expect(devPanel).toContainText('React')
    await expect(devPanel.locator('.dev-code-jsx')).toContainText('export function')
    await expect(devPanel.locator('.dev-tailwind-classes')).toContainText('absolute')
    await waitForViewportSettled(page)
    await capturePng(devPanel, 'dev-mode-handoff.png', testInfo)

    await devPanel.getByLabel('Exit dev mode').click()
    await expect(devPanel).toBeHidden()
  })

  test('captures material studies artboard frame details', async ({ page }, testInfo) => {
    const materialFrame = page.locator('[data-element-id="material"]')
    await expect(materialFrame).toBeVisible()
    await capturePng(materialFrame, 'material-artboard.png', testInfo)
  })
})
