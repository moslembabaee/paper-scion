import { test, expect } from '@playwright/test'
import { drag, waitForCanvasReady } from './helpers'

test('draws Bezier curves, undoes draft points, and commits one reversible path', async ({ page }) => {
  await waitForCanvasReady(page)
  const count = await page.locator('.scene-node[data-element-type="path"]').count()
  const initialLayers = await page.getByTestId('layer-tree').getByRole('treeitem').count()
  const bounds = (await page.getByTestId('canvas-viewport').boundingBox())!
  const x = bounds.x + 140, y = bounds.y + 260
  await page.getByTestId('tool-path').click()
  await page.mouse.click(x, y)
  await drag(page, { x: x + 80, y: y - 80 }, { x: x + 110, y: y - 80 })
  await page.mouse.click(x + 160, y)
  await expect(page.locator('.pen-anchor')).toHaveCount(3)
  await expect(page.getByTestId('pen-preview')).toHaveAttribute('d', /C/)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.pen-anchor')).toHaveCount(2)
  await expect(page.getByTestId('layer-tree').getByRole('treeitem')).toHaveCount(initialLayers)
  await page.getByRole('button', { name: 'Redo pen point' }).click()
  await expect(page.locator('.pen-anchor')).toHaveCount(3)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pen-overlay')).toHaveCount(0)
  await expect(page.locator('.scene-node[data-element-type="path"]')).toHaveCount(count + 1)
  const path = page.locator('.scene-node.is-selected[data-element-type="path"]')
  await expect(path.locator('path')).toHaveAttribute('d', /C/)
  await expect(path.locator('path')).toHaveAttribute('fill', 'none')
  await page.getByTestId('history-undo').click()
  await expect(page.locator('.scene-node[data-element-type="path"]')).toHaveCount(count)
  await page.getByTestId('history-redo').click()
  await expect(page.locator('.scene-node[data-element-type="path"]')).toHaveCount(count + 1)
})

test('Escape cancels the first draft gesture and leaves the pen ready to draw', async ({ page }) => {
  await waitForCanvasReady(page)
  const bounds = (await page.getByTestId('canvas-viewport').boundingBox())!
  const x = bounds.x + 140, y = bounds.y + 260
  await page.getByTestId('tool-path').click()
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 30, y + 20, { steps: 5 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.locator('.pen-anchor')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo pen point' })).toBeDisabled()
  await page.mouse.click(x, y)
  await page.mouse.click(x + 100, y + 50)
  await page.keyboard.press('Enter')
  await expect(page.locator('.scene-node.is-selected[data-element-type="path"]')).toHaveCount(1)
})
