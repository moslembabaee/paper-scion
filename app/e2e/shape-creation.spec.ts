import { test, expect } from '@playwright/test'
import { drawVectorPath, waitForCanvasReady } from './helpers'

test.describe('Shape & Element Creation', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
  })

  test('creates a new rectangle element with default styling and selection', async ({ page }) => {
    const rectCountBefore = await page.locator('.scene-node[data-element-type="rectangle"]').count()

    // Click "Add rectangle" in toolbar
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    // Verify element count increased
    const rects = page.locator('.scene-node[data-element-type="rectangle"]')
    await expect(rects).toHaveCount(rectCountBefore + 1)

    // Latest rectangle should be selected
    const selectedRect = page.locator('.scene-node[data-element-type="rectangle"].is-selected')
    await expect(selectedRect).toBeVisible()

    // Verify SVG rect is rendered inside
    const svgRect = selectedRect.locator('svg rect')
    await expect(svgRect).toBeVisible()

    // Selection bounding box is present
    await expect(page.getByTestId('selection-box')).toBeVisible()

    // Inspector reflects selected rectangle
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('Rectangle')
    await expect(inspector.getByLabel('Width', { exact: true })).toHaveValue('120')
    await expect(inspector.getByLabel('Height', { exact: true })).toHaveValue('120')
  })

  test('creates a new ellipse element and verifies inspector controls', async ({ page }) => {
    const ellipseCountBefore = await page.locator('.scene-node[data-element-type="ellipse"]').count()

    // Click "Add ellipse" in toolbar
    await page.getByTestId('tool-ellipse').click()
    await page.waitForTimeout(100)

    const ellipses = page.locator('.scene-node[data-element-type="ellipse"]')
    await expect(ellipses).toHaveCount(ellipseCountBefore + 1)

    const selectedEllipse = page.locator('.scene-node[data-element-type="ellipse"].is-selected')
    await expect(selectedEllipse).toBeVisible()

    // Verify SVG ellipse is rendered
    const svgEllipse = selectedEllipse.locator('svg ellipse')
    await expect(svgEllipse).toBeVisible()

    // Inspector reflects selected ellipse
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('Ellipse')
  })

  test('creates a new frame container (artboard) with dimensions and label', async ({ page }) => {
    const frameCountBefore = await page.locator('.scene-node[data-element-type="frame"]').count()

    // Click "Add frame"
    await page.getByTestId('tool-frame').click()
    await page.waitForTimeout(100)

    const frames = page.locator('.scene-node[data-element-type="frame"]')
    await expect(frames).toHaveCount(frameCountBefore + 1)

    const selectedFrame = page.locator('.scene-node[data-element-type="frame"].is-selected')
    await expect(selectedFrame).toBeVisible()

    // Check default artboard size (720x480)
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('Frame')
    await expect(inspector.getByLabel('Width', { exact: true })).toHaveValue('720')
    await expect(inspector.getByLabel('Height', { exact: true })).toHaveValue('480')
  })

  test('creates a new editable text element with typography properties', async ({ page }) => {
    const textCountBefore = await page.locator('.scene-node[data-element-type="text"]').count()

    // Click "Add text"
    await page.getByTestId('tool-text').click()
    await page.waitForTimeout(100)

    const texts = page.locator('.scene-node[data-element-type="text"]')
    await expect(texts).toHaveCount(textCountBefore + 1)

    const selectedText = page.locator('.scene-node[data-element-type="text"].is-selected')
    await expect(selectedText).toBeVisible()

    // Inspector has typography section
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('TYPOGRAPHY')
    await expect(inspector.getByLabel('Text content')).toBeVisible()
    await expect(inspector.getByLabel('Font size')).toBeVisible()
  })

  test('creates a new vector path element with SVG path data inspector', async ({ page }) => {
    const pathCountBefore = await page.locator('.scene-node[data-element-type="path"]').count()

    await drawVectorPath(page)

    const paths = page.locator('.scene-node[data-element-type="path"]')
    await expect(paths).toHaveCount(pathCountBefore + 1)

    const selectedPath = page.locator('.scene-node[data-element-type="path"].is-selected')
    await expect(selectedPath).toBeVisible()

    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('VECTOR PATH')
    await expect(inspector.getByLabel('SVG path data')).toBeVisible()
  })

  test('nests child shapes inside selected frame containers', async ({ page }) => {
    // Select the "01 — A little space" frame
    const frame = page.locator('[data-element-id="space"]')
    await frame.click({ position: { x: 50, y: 15 } })
    await page.waitForTimeout(100)

    // Add rectangle while frame is selected
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    // The newly created rectangle should be nested inside frame.scene-content
    const nestedRect = frame.locator('.scene-node[data-element-type="rectangle"].is-selected')
    await expect(nestedRect).toBeVisible()
  })

  test('synchronizes layer hierarchy in LayerTree upon creation', async ({ page }) => {
    const layerTree = page.getByTestId('layer-tree')
    const initialRows = await layerTree.locator('[role="treeitem"]').count()

    // Add a new rectangle
    await page.getByTestId('tool-rectangle').click()
    await page.waitForTimeout(100)

    const newRows = await layerTree.locator('[role="treeitem"]').count()
    expect(newRows).toBeGreaterThan(initialRows)
  })
})
