import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, expectShaderRendered, waitForCanvasReady } from './helpers'

async function openMesh(page: Page) {
  await waitForCanvasReady(page)
  await page.getByTestId('tool-rectangle').click()
  await page.getByLabel('Paper shader effect').selectOption('mesh-gradient')
  const preview = page.locator('.mesh-editor-preview')
  await preview.scrollIntoViewIfNeeded()
  await expectShaderRendered(preview.locator('.shader-surface'))
  return preview
}

async function uniform(canvas: Locator, name: string) {
  return canvas.evaluate((element: HTMLCanvasElement, key) => {
    const gl = element.getContext('webgl2')!
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram
    const value = gl.getUniform(program, gl.getUniformLocation(program, key)!)
    return typeof value === 'number' ? value : Array.from(value as Float32Array)
  }, name)
}

test('mesh sends valid uniforms and draws a multicolor field on the GPU', async ({ page }) => {
  const preview = await openMesh(page)
  const canvas = preview.locator('canvas')
  await expect.poll(() => uniform(canvas, 'u_count')).toBe(4)
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext('webgl2')!
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return [.2, .5, .8].map(position => {
      const rgba = new Uint8Array(4)
      gl.readPixels(Math.floor(element.width * position), Math.floor(element.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      return Array.from(rgba)
    })
  })
  expect(pixels.every(pixel => pixel[3] === 255)).toBe(true)
  expect(new Set(pixels.map(pixel => pixel.join(','))).size).toBeGreaterThan(1)
  await page.getByLabel('Mesh grain blending').selectOption('screen')
  await expect.poll(() => uniform(canvas, 'u_grainBlend')).toBe(3)
  for (const [label, key, value] of [
    ['Mesh Turbulence', 'u_turbulence', '.7'],
    ['Mesh Noise frequency', 'u_frequency', '8'],
    ['Mesh Chromatic aberration', 'u_chromatic', '.65'],
    ['Mesh Grain mixer', 'u_grainMixer', '.2'],
    ['Mesh Grain overlay', 'u_grainOverlay', '.35'],
  ]) {
    await page.getByRole('slider', { name: label, exact: true }).fill(value)
    await expect.poll(() => uniform(canvas, key)).toBeCloseTo(Number(value), 4)
  }
})

test('preview and canvas anchor drags update one undo checkpoint without moving the layer', async ({ page }) => {
  const preview = await openMesh(page)
  const x = page.getByLabel('Mesh anchor X percent')
  const y = page.getByLabel('Mesh anchor Y percent')
  const rect = (await preview.boundingBox())!
  const anchor = (await preview.getByRole('button', { name: 'Mesh anchor 1', exact: true }).boundingBox())!
  await drag(page, { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }, { x: rect.x + rect.width * .75, y: rect.y + rect.height * .6 }, { steps: 12 })
  expect(Number(await x.inputValue())).toBeCloseTo(75, 0)
  expect(Number(await y.inputValue())).toBeCloseTo(60, 0)
  const moved = await x.inputValue()
  await page.getByTestId('history-undo').click()
  await expect(x).toHaveValue('50')
  await expect(y).toHaveValue('16')
  await page.getByTestId('history-redo').click()
  await expect(x).toHaveValue(moved)

  const node = page.locator('.scene-node.is-selected')
  const transform = await node.getAttribute('style')
  const handle = (await page.getByTestId('mesh-canvas-overlay').getByRole('button', { name: 'Mesh anchor 1', exact: true }).boundingBox())!
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 - 12, y: handle.y + handle.height / 2 + 6 })
  expect(Number(await x.inputValue())).toBeLessThan(Number(moved))
  await expect(node).toHaveAttribute('style', transform!)
  await page.getByTestId('history-undo').click()
  await expect(x).toHaveValue(moved)
})

test('Escape cancels anchor dragging and keyboard adjustments preserve the redo branch', async ({ page }) => {
  const preview = await openMesh(page)
  const anchor = preview.getByRole('button', { name: 'Mesh anchor 1', exact: true })
  const x = page.getByLabel('Mesh anchor X percent')
  await anchor.press('ArrowRight')
  await expect(x).toHaveValue('51')
  await page.getByTestId('history-undo').click()
  await expect(x).toHaveValue('50')
  await anchor.scrollIntoViewIfNeeded()
  const bounds = (await anchor.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 45, bounds.y + 40, { steps: 5 })
  await expect(x).not.toHaveValue('50')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(x).toHaveValue('50')
  await expect(page.getByTestId('history-redo')).toBeEnabled()
  await page.getByTestId('history-redo').click()
  await expect(x).toHaveValue('51')
  await anchor.press('Shift+ArrowDown')
  await expect(page.getByLabel('Mesh anchor Y percent')).toHaveValue('26')
})

test('color stops, alpha, grain blending, and React export retain the edited material', async ({ page, context }) => {
  const preview = await openMesh(page)
  await page.getByRole('button', { name: 'Add stop', exact: true }).click()
  await expect(preview.getByRole('button', { name: /^Mesh anchor/ })).toHaveCount(5)
  const hex = page.getByLabel('Mesh stop 5 hex', { exact: true })
  await hex.fill('#81adec80')
  await hex.press('Enter')
  await expect.poll(async () => (await uniform(preview.locator('canvas'), 'u_colors[4]') as number[])[3]).toBeCloseTo(128 / 255)
  await expect(preview.locator('.shader-surface')).toHaveCSS('background-image', 'none')
  await expect(preview.locator('.shader-surface')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await hex.fill('invalid')
  await hex.press('Enter')
  await expect(hex).toHaveValue('#81ADEC80')
  await page.getByLabel('Mesh grain blending').selectOption('multiply')
  await page.getByRole('group', { name: 'Shader playback' }).getByRole('button', { name: 'Static', exact: true }).click()
  await page.locator('.mesh-code summary').click()
  const source = await page.getByLabel('React shader source').innerText()
  expect(source).toContain("import { ShaderMount } from '@paper-design/shaders-react'")
  expect(source).toContain('"u_count": 5')
  expect(source).toContain('"u_grainBlend": 2')
  expect(source).toContain('speed={0}')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy React', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download React shader' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('PaperMaterial.tsx')
  await page.getByRole('button', { name: 'Remove mesh stop 5', exact: true }).click()
  await expect(preview.getByRole('button', { name: /^Mesh anchor/ })).toHaveCount(4)
})

test('background anchors track the material inside the rulers after viewport resizing', async ({ page }) => {
  await waitForCanvasReady(page)
  await page.keyboard.press('Escape')
  await page.getByLabel('Paper shader effect').selectOption('mesh-gradient')
  const overlay = page.getByTestId('mesh-canvas-overlay')
  const handle = overlay.getByRole('button', { name: 'Mesh anchor 1', exact: true })
  const assertPosition = async () => {
    await expect.poll(async () => {
      const surface = (await overlay.boundingBox())!
      const anchor = (await handle.boundingBox())!
      return Math.hypot(anchor.x + anchor.width / 2 - surface.x - surface.width * .5, anchor.y + anchor.height / 2 - surface.y - surface.height * .16)
    }).toBeLessThan(1)
  }
  await assertPosition()
  await page.setViewportSize({ width: 1200, height: 800 })
  await assertPosition()

  const surface = (await overlay.boundingBox())!
  const anchor = (await handle.boundingBox())!
  await drag(page, { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }, { x: surface.x + surface.width * .8, y: surface.y + surface.height * .3 })
  expect(Number(await page.getByLabel('Mesh anchor X percent').inputValue())).toBeCloseTo(80, 0)
  expect(Number(await page.getByLabel('Mesh anchor Y percent').inputValue())).toBeCloseTo(30, 0)
  await page.getByTestId('history-undo').click()
  await assertPosition()
})
