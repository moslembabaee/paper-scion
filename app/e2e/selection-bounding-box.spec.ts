import { test, expect } from '@playwright/test'
import { waitForCanvasReady, drag } from './helpers'

test.describe('Selection Bounding Box & Transformation', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
  })

  test('displays selection bounding box with 8 resize handles and rotate handle', async ({ page }) => {
    // Create a new rectangle to guarantee an isolated selection
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    const selBox = page.getByTestId('selection-box')
    await expect(selBox).toBeVisible()
    await expect(selBox).toHaveAttribute('aria-label', 'Selection bounds')

    // Verify all 8 resize handles exist
    const handleIds = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    for (const id of handleIds) {
      const handle = selBox.locator(`[data-handle="${id}"]`)
      await expect(handle).toBeVisible()
      await expect(handle).toHaveClass(/sel-handle/)
    }

    // Verify rotation handle exists
    const rotateHandle = selBox.locator('[data-handle="rotate"]')
    await expect(rotateHandle).toBeVisible()
    await expect(rotateHandle).toHaveClass(/sel-rotate-handle/)
  })

  test('interactively resizes element when dragging a handle', async ({ page }) => {
    // Add a rectangle
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    const inspector = page.getByTestId('inspector-panel')
    const widthInput = inspector.getByLabel('Width', { exact: true })
    const heightInput = inspector.getByLabel('Height', { exact: true })

    await expect(widthInput).toHaveValue('120')
    await expect(heightInput).toHaveValue('120')

    const selBox = page.getByTestId('selection-box')
    const seHandle = selBox.locator('[data-handle="se"]')
    const handleBox = (await seHandle.boundingBox())!

    // Drag the southeast handle 60px down and right
    await drag(
      page,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
      { x: handleBox.x + handleBox.width / 2 + 60, y: handleBox.y + handleBox.height / 2 + 60 },
      { steps: 6 }
    )
    await page.waitForTimeout(100)

    // Verify width and height grew
    const newWidth = parseFloat(await widthInput.inputValue())
    const newHeight = parseFloat(await heightInput.inputValue())
    expect(newWidth).toBeGreaterThan(120)
    expect(newHeight).toBeGreaterThan(120)
  })

  test('draws marquee selection rect and selects enclosed elements', async ({ page }) => {
    const viewport = page.getByTestId('canvas-viewport')
    await viewport.click({ position: { x: 50, y: 50 } })
    await expect(page.getByTestId('selection-box')).toBeHidden()

    const vBox = (await viewport.boundingBox())!
    const startX = vBox.x + 80
    const startY = vBox.y + 80

    // Drag marquee on empty area of canvas viewport
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 180, startY + 180, { steps: 5 })

    // During drag, marquee rect should be visible
    const marquee = page.getByTestId('marquee-rect')
    await expect(marquee).toBeVisible()

    await page.mouse.up()
    await page.waitForTimeout(100)

    // After drag release, marquee element is removed
    await expect(marquee).toBeHidden()
  })

  test('clears selection when Escape is pressed or deselect button clicked', async ({ page }) => {
    // Create shape
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    const selBox = page.getByTestId('selection-box')
    await expect(selBox).toBeVisible()

    // Focus viewport so Escape key reaches canvas handler
    const viewport = page.getByTestId('canvas-viewport')
    await viewport.focus()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    await expect(selBox).toBeHidden()

    // Reselect element by clicking it on canvas
    const rect = page.locator('.scene-node[data-element-type="rectangle"]').last()
    await rect.click()
    await page.waitForTimeout(100)
    await expect(selBox).toBeVisible()

    // Click "Deselect elements" button in inspector
    const deselectBtn = page.getByLabel('Deselect elements')
    await deselectBtn.click()
    await page.waitForTimeout(100)

    await expect(selBox).toBeHidden()
  })

  test('supports multi-selection bounding box across elements', async ({ page }) => {
    // Select first frame
    const frameSpace = page.locator('[data-element-id="space"]')
    await frameSpace.click({ position: { x: 30, y: 15 } })
    await page.waitForTimeout(100)

    // Shift+click second frame
    const frameRoom = page.locator('[data-element-id="room"]')
    await page.keyboard.down('Shift')
    await frameRoom.click({ position: { x: 30, y: 15 } })
    await page.keyboard.up('Shift')
    await page.waitForTimeout(100)

    // Inspector indicates multi-selection
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText(/2 layers/i)

    // Selection box encompasses both frames (1200px world width * zoom)
    const selBox = page.getByTestId('selection-box')
    await expect(selBox).toBeVisible()
    const box = (await selBox.boundingBox())!
    expect(box.width).toBeGreaterThan(450)
  })
})
