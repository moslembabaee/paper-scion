import { test, expect } from '@playwright/test'
import { waitForCanvasReady, getViewportTransform, drag, expectZoom, waitForViewportSettled } from './helpers'

test.describe('Pan & Zoom Responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
  })

  test('zooms in and out responsively via zoom buttons', async ({ page }) => {
    const zoomIn = page.getByTestId('zoom-in')
    const zoomOut = page.getByTestId('zoom-out')
    const zoomValue = page.getByTestId('zoom-value')

    const initial = await getViewportTransform(page)

    // Click Zoom In (+)
    await zoomIn.click()
    await expectZoom(page, initial.zoom * 1.25)

    const afterZoomIn = await getViewportTransform(page)
    expect(afterZoomIn.zoom).toBeGreaterThan(initial.zoom)
    await expect(zoomValue).toContainText(`${Math.round(afterZoomIn.zoom * 100)}%`)

    // Click Zoom Out (-)
    await zoomOut.click()
    await expectZoom(page, initial.zoom)

    const afterZoomOut = await getViewportTransform(page)
    expect(afterZoomOut.zoom).toBeLessThan(afterZoomIn.zoom)
    expect(Math.abs(afterZoomOut.zoom - initial.zoom)).toBeLessThan(0.05)
  })

  test('zooms to presets via zoom menu', async ({ page }) => {
    const zoomValue = page.getByTestId('zoom-value')
    await zoomValue.click()

    const menu = page.getByTestId('zoom-menu')
    await expect(menu).toBeVisible()

    // Select 50% preset
    const preset50 = menu.getByRole('button', { name: '50%', exact: true })
    await preset50.click()
    await expectZoom(page, 0.5)

    const transform50 = await getViewportTransform(page)
    expect(Math.round(transform50.zoom * 100)).toBe(50)
    await expect(zoomValue).toContainText('50%')

    // Select 200% preset
    await zoomValue.click()
    const preset200 = menu.getByRole('button', { name: '200%', exact: true })
    await preset200.click()
    await expectZoom(page, 2)

    const transform200 = await getViewportTransform(page)
    expect(Math.round(transform200.zoom * 100)).toBe(200)
    await expect(zoomValue).toContainText('200%')
  })

  test('zooms responsively using keyboard shortcuts (+, -, 0)', async ({ page }) => {
    const viewport = page.getByTestId('canvas-viewport')
    await viewport.focus()
    await expect(viewport).toBeFocused()

    const initial = await getViewportTransform(page)

    // Send the physical '+' chord and wait for the camera, rather than a fixed delay.
    await page.keyboard.press('Shift+Equal')
    await expectZoom(page, initial.zoom * 1.25)
    const afterPlus = await getViewportTransform(page)
    expect(afterPlus.zoom).toBeGreaterThan(initial.zoom)

    // Press '-' to zoom out
    await page.keyboard.press('Minus')
    await expectZoom(page, initial.zoom)
    const afterMinus = await getViewportTransform(page)
    expect(afterMinus.zoom).toBeLessThan(afterPlus.zoom)

    // Press '0' to reset to 100%
    await page.keyboard.press('Digit0')
    await expectZoom(page, 1)
    const afterZero = await getViewportTransform(page)
    expect(Math.round(afterZero.zoom * 100)).toBe(100)
  })

  test('zooms responsively via mouse wheel events', async ({ page }) => {
    const viewport = page.getByTestId('canvas-viewport')
    const box = (await viewport.boundingBox())!
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    const initial = await getViewportTransform(page)

    // Move to center of canvas and scroll wheel down (zoom out)
    await page.mouse.move(centerX, centerY)
    await page.mouse.wheel(0, 100)
    await expect.poll(async () => (await getViewportTransform(page)).zoom).toBeLessThan(initial.zoom)
    await waitForViewportSettled(page)

    const afterScrollDown = await getViewportTransform(page)
    expect(afterScrollDown.zoom).toBeLessThan(initial.zoom)

    // Scroll wheel up (zoom in)
    await page.mouse.wheel(0, -200)
    await expect.poll(async () => (await getViewportTransform(page)).zoom).toBeGreaterThan(afterScrollDown.zoom)
    await waitForViewportSettled(page)

    const afterScrollUp = await getViewportTransform(page)
    expect(afterScrollUp.zoom).toBeGreaterThan(afterScrollDown.zoom)
  })

  test('pans smoothly using dedicated Hand/Pan tool', async ({ page }) => {
    const handTool = page.getByTestId('tool-hand')
    const selectTool = page.getByTestId('tool-select')

    // Activate Hand tool
    await handTool.click()
    await expect(handTool).toHaveAttribute('aria-pressed', 'true')
    await expect(selectTool).toHaveAttribute('aria-pressed', 'false')

    const beforePan = await getViewportTransform(page)

    // Drag on canvas
    await drag(page, { x: 600, y: 400 }, { x: 450, y: 300 }, { steps: 8 })

    const afterPan = await getViewportTransform(page)
    expect(afterPan.x).toBeLessThan(beforePan.x)
    expect(afterPan.y).toBeLessThan(beforePan.y)

    // Switch back to select tool
    await selectTool.click()
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true')
    await expect(handTool).toHaveAttribute('aria-pressed', 'false')
  })

  test('pans responsively using Spacebar + drag gesture', async ({ page }) => {
    const viewport = page.getByTestId('canvas-viewport')
    await viewport.hover({ position: { x: 500, y: 400 } })

    const beforePan = await getViewportTransform(page)

    // Hold Space key and drag
    await page.keyboard.down('Space')
    await expect(viewport).toHaveAttribute('data-space', 'true')

    await drag(page, { x: 500, y: 400 }, { x: 650, y: 520 }, { steps: 8 })

    await page.keyboard.up('Space')
    await expect(viewport).toHaveAttribute('data-space', 'false')

    const afterPan = await getViewportTransform(page)
    expect(afterPan.x).toBeGreaterThan(beforePan.x)
    expect(afterPan.y).toBeGreaterThan(beforePan.y)
  })

  test('navigates viewport camera via navigator minimap click', async ({ page }) => {
    const minimapCanvas = page.getByTestId('minimap-canvas')
    const box = (await minimapCanvas.boundingBox())!

    const before = await getViewportTransform(page)

    // Click near bottom-right of minimap
    await minimapCanvas.click({
      position: { x: box.width * 0.8, y: box.height * 0.8 },
    })
    await expect.poll(async () => {
      const current = await getViewportTransform(page)
      return current.x !== before.x || current.y !== before.y
    }).toBe(true)
    await waitForViewportSettled(page)

    const after = await getViewportTransform(page)
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
  })
})
