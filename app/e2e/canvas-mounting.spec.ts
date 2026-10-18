import { test, expect } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

test.describe('Canvas Mounting & Infrastructure', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
  })

  test('mounts main application layout and Paper header branding', async ({ page }) => {
    await expect(page).toHaveTitle(/Paper/)

    const app = page.locator('.paper-app')
    await expect(app).toBeVisible()

    // Header branding and document title
    const brand = page.locator('.app-brand')
    await expect(brand).toContainText('paper')
    await expect(brand).toContainText('alpha')

    const titleInput = page.locator('input.document-title')
    await expect(titleInput).toHaveValue('Space to think')

    const statusBadge = page.locator('.local-status')
    await expect(statusBadge).toBeVisible()
    await expect(statusBadge).toContainText(/local/i)
  })

  test('mounts canvas viewport with correct accessibility roles and attributes', async ({ page }) => {
    const viewport = page.getByTestId('canvas-viewport')
    await expect(viewport).toBeVisible()
    await expect(viewport).toHaveAttribute('role', 'region')
    await expect(viewport).toHaveAttribute('aria-label', 'Infinite design canvas')

    // Hint instructions
    const instructions = page.getByTestId('canvas-instructions')
    await expect(instructions).toBeVisible()
    await expect(instructions).toContainText('Scroll to zoom')
    await expect(instructions).toContainText('Space + drag to pan')
  })

  test('mounts engineering grid and toggles visibility via toolbar', async ({ page }) => {
    const grid = page.getByTestId('viewport-grid')
    await expect(grid).toBeVisible()

    // Verify grid button is active
    const gridToggle = page.getByTestId('tool-grid')
    await expect(gridToggle).toHaveAttribute('aria-pressed', 'true')

    // Toggle grid off
    await gridToggle.click()
    await expect(grid).toBeHidden()
    await expect(gridToggle).toHaveAttribute('aria-pressed', 'false')

    // Toggle grid back on
    await gridToggle.click()
    await expect(grid).toBeVisible()
    await expect(gridToggle).toHaveAttribute('aria-pressed', 'true')
  })

  test('mounts horizontal and vertical engineering rulers with origin corner', async ({ page }) => {
    const hRuler = page.getByTestId('viewport-ruler-h')
    const vRuler = page.getByTestId('viewport-ruler-v')
    const corner = page.getByTestId('viewport-ruler-corner')

    await expect(hRuler).toBeVisible()
    await expect(vRuler).toBeVisible()
    await expect(corner).toBeVisible()

    const origin = page.getByTestId('viewport-origin')
    await expect(origin).toBeVisible()
    await expect(origin).toContainText('WORLD')
  })

  test('renders seed artboards and scene hierarchy correctly', async ({ page }) => {
    // 3 primary artboard frames
    const frameSpace = page.locator('[data-element-id="space"]')
    const frameRoom = page.locator('[data-element-id="room"]')
    const frameMaterial = page.locator('[data-element-id="material"]')

    await expect(frameSpace).toBeVisible()
    await expect(frameRoom).toBeVisible()
    await expect(frameMaterial).toBeVisible()

    await expect(frameSpace).toHaveAttribute('data-element-type', 'frame')
    await expect(frameRoom).toHaveAttribute('data-element-type', 'frame')
    await expect(frameMaterial).toHaveAttribute('data-element-type', 'frame')

    // Check artboard labels
    await expect(frameSpace.locator('.artboard-label')).toContainText('01 — A little space')
    await expect(frameRoom.locator('.artboard-label')).toContainText('02 — Make room')
    await expect(frameMaterial.locator('.artboard-label')).toContainText('03 — Material studies')

    // Layer tree panel lists layers
    const layerTree = page.getByTestId('layer-tree')
    await expect(layerTree).toBeVisible()
    await expect(layerTree).toContainText('SCENE')
  })

  test('mounts navigator minimap and zoom controls', async ({ page }) => {
    const minimap = page.getByTestId('viewport-minimap')
    await expect(minimap).toBeVisible()
    await expect(minimap).toContainText('Navigator')

    const minimapCanvas = page.getByTestId('minimap-canvas')
    await expect(minimapCanvas).toBeVisible()

    const zoomControls = page.getByTestId('zoom-controls')
    await expect(zoomControls).toBeVisible()

    const zoomValue = page.getByTestId('zoom-value')
    await expect(zoomValue).toHaveText(/\d+%/)

    await expect(page.getByTestId('zoom-in')).toBeVisible()
    await expect(page.getByTestId('zoom-out')).toBeVisible()
    await expect(page.getByTestId('zoom-fit')).toBeVisible()
  })

  test('applies Paper design system color tokens and typography', async ({ page }) => {
    // Dark Studio uses matte panels, a deep canvas, and electric blue tools.
    const app = page.locator('.paper-app')
    const appBg = await app.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(appBg).toMatch(/rgb\(24,\s*24,\s*27\)/)

    // Canvas background
    const viewport = page.getByTestId('canvas-viewport')
    const viewportBg = await viewport.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(viewportBg).toMatch(/rgb\(12,\s*12,\s*14\)/)

    // Active tool accent
    const activeTool = page.locator('.tool-button.active')
    const activeToolBg = await activeTool.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(activeToolBg).toMatch(/rgb\(59,\s*130,\s*246\)/)

    // Check header style
    const header = page.locator('.app-header')
    await expect(header).toBeVisible()

    // Check footer style and 120px grid mention
    const footer = page.locator('.app-footer')
    await expect(footer).toContainText('120 px grid')
    await expect(footer).toContainText('Paper / Infinite canvas')
  })
})
