import { test, expect } from '@playwright/test'
import { expectZoom, getViewportTransform, waitForCanvasReady } from './helpers'

async function selectRoot(page: import('@playwright/test').Page, name: string, additive = false) {
  await page.getByTestId('layer-tree').getByTitle(name, { exact: true }).click({ modifiers: additive ? ['Shift'] : [] })
}

test.beforeEach(async ({ page }) => { await waitForCanvasReady(page) })

test('arrow nudge, accelerated nudge, resize, held-key undo and editable-field isolation', async ({ page }) => {
  await page.getByTestId('tool-rectangle').click()
  const panel = page.getByTestId('inspector-panel')
  const x = Number(await panel.getByLabel('X', { exact: true }).inputValue())
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByLabel('X', { exact: true })).toHaveValue(String(x + 1))
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Meta+ArrowRight')
  await expect(panel.getByLabel('Width', { exact: true })).toHaveValue('121')
  await page.keyboard.press('Control+Shift+ArrowDown')
  await expect(panel.getByLabel('Height', { exact: true })).toHaveValue('128')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await expect(panel.getByLabel('X', { exact: true })).toHaveValue(String(x + 4))
  await page.keyboard.press('Control+z')
  await expect(panel.getByLabel('X', { exact: true })).toHaveValue(String(x + 1))
  await panel.getByLabel('Layer name').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Alt+a')
  await expect(panel.getByLabel('X', { exact: true })).toHaveValue(String(x + 1))
})

test('alignment buttons and Option letter shortcuts agree; distribution enables for three roots', async ({ page }) => {
  await selectRoot(page, '01 — A little space')
  await expect(page.getByRole('button', { name: 'Distribute horizontally', exact: true })).toBeDisabled()
  await selectRoot(page, '02 — Make room', true)
  await page.keyboard.press('Alt+w')
  const top = (id: string) => page.locator(`[data-element-id="${id}"]`).evaluate(el => (el as HTMLElement).style.top)
  expect(await top('space')).toBe(await top('room'))
  await page.getByRole('button', { name: 'Align left', exact: true }).click()
  const left = (id: string) => page.locator(`[data-element-id="${id}"]`).evaluate(el => (el as HTMLElement).style.left)
  expect(await left('space')).toBe(await left('room'))
  await page.keyboard.press('Control+z')
  await selectRoot(page, '03 — Material studies', true)
  await expect(page.getByRole('button', { name: 'Distribute horizontally', exact: true })).toBeEnabled()
  await page.keyboard.press('Control+Alt+h')
  const positions = await page.locator('.viewport-world > .scene-node').evaluateAll(elements => elements.map(el => ({ id: (el as HTMLElement).dataset.elementId, x: parseFloat((el as HTMLElement).style.left), w: parseFloat((el as HTMLElement).style.width) })))
  const a = positions.find(p => p.id === 'space')!, b = positions.find(p => p.id === 'material')!, c = positions.find(p => p.id === 'room')!
  expect(b.x - a.x - a.w).toBeCloseTo(c.x - b.x - b.w)
})

test('layer order shortcuts move to extremes and step once with a command modifier', async ({ page }) => {
  await selectRoot(page, '01 — A little space')
  const z = () => page.locator('[data-element-id="space"]').evaluate(el => (el as HTMLElement).style.zIndex)
  await page.keyboard.press(']')
  expect(await z()).toBe('2')
  await page.keyboard.press('Control+[')
  expect(await z()).toBe('1')
  await page.keyboard.press('[')
  expect(await z()).toBe('0')
  await page.keyboard.press('Meta+Alt+ArrowUp')
  expect(await z()).toBe('1')
})

test('Alt-hover measures world pixels at multiple zooms and hides on release and UI hover', async ({ page }) => {
  await selectRoot(page, '01 — A little space')
  const hud = page.getByTestId('measurement-hud')
  const hoverRoom = async () => {
    const box = (await page.locator('[data-element-id="room"]').boundingBox())!
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2)
  }
  await hoverRoom()
  await page.keyboard.down('Alt')
  await expect(hud).toHaveAttribute('data-visible', 'true')
  await expect(hud).toHaveAttribute('data-measure-target', 'room')
  await expect(hud.locator('[data-axis="horizontal"]')).toHaveAttribute('data-distance', '120')
  await expect(hud).toContainText('120 px')
  await page.keyboard.up('Alt')
  await expect(hud).toHaveAttribute('data-visible', 'false')
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press('0')
  await expectZoom(page, 1)
  // The right artboard extends past the viewport at 100%; zoom out to a second usable scale.
  await page.keyboard.press('-')
  await page.keyboard.press('-')
  await expectZoom(page, .64)
  await hoverRoom()
  await page.keyboard.down('Alt')
  await expect(hud.locator('[data-axis="horizontal"]')).toHaveAttribute('data-distance', '120')
  await page.mouse.move(10, 10)
  await expect(hud).toHaveAttribute('data-visible', 'false')
  await page.keyboard.up('Alt')
})

test('empty canvas hover shows four boundary distances and empty-selection arrows pan', async ({ page }) => {
  await selectRoot(page, '01 — A little space')
  const viewport = page.getByTestId('canvas-viewport'), box = (await viewport.boundingBox())!
  await page.mouse.move(box.x + 35, box.y + box.height - 90)
  await page.keyboard.down('Alt')
  const hud = page.getByTestId('measurement-hud')
  await expect(hud).toHaveAttribute('data-measure-target', 'canvas')
  await expect(hud.locator('[data-distance]')).toHaveCount(4)
  await page.keyboard.up('Alt')
  await viewport.focus()
  await page.keyboard.press('Escape')
  const before = await getViewportTransform(page)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await getViewportTransform(page)).x).toBeCloseTo(before.x - 8)
})
