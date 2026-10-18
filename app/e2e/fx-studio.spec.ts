import { test, expect } from '@playwright/test'
import { expectShaderRendered, waitForCanvasReady } from './helpers'

test.beforeEach(async ({ page }) => { await waitForCanvasReady(page) })

test('new materials render WebGL pixels and update uniforms without replacing the canvas', async ({ page }) => {
  const shape = page.getByLabel('Mesh Gradient study')
  await shape.click()
  for (const [kind, label, uniform, value] of [
    ['perlin-noise', 'Shader Roughness', 'u_persistence', .8],
    ['liquid-distortion', 'Shader Distortion', 'u_distortion', .8],
    ['glass-refraction', 'Shader Refraction strength', 'u_distortion', .8],
  ] as const) {
    await page.getByLabel('Paper shader effect').selectOption(kind)
    await page.getByRole('button', { name: 'Static', exact: true }).click()
    const surface = shape.locator(`.paper-shader-surface[data-shader="${kind}"]`)
    await expectShaderRendered(surface)
    const canvas = surface.locator('canvas')
    const original = await canvas.elementHandle()
    await page.getByRole('spinbutton', { name: label, exact: true }).fill(String(value))
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement, name: string) => {
      const gl = element.getContext('webgl2')!
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram
      const location = gl.getUniformLocation(program, name)
      return location ? gl.getUniform(program, location) as number : null
    }, uniform)).toBeCloseTo(value)
    expect(await canvas.evaluate((element, previous) => element === previous, original)).toBe(true)
    const colors = await canvas.evaluate((element: HTMLCanvasElement) => {
      const host = element.parentElement as HTMLElement & { paperShaderMount: { setFrame: (frame: number) => void } }
      host.paperShaderMount.setFrame(12000)
      const gl = element.getContext('webgl2')!
      const samples = new Set<string>()
      const pixel = new Uint8Array(4)
      for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) {
        gl.readPixels(Math.floor(element.width * x / 5), Math.floor(element.height * y / 5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        samples.add([...pixel].join(','))
      }
      return samples.size
    })
    expect(colors).toBeGreaterThan(2)
  }
})

test('blend and material opacity preserve the base fill and stroke, and undo restores composition', async ({ page }) => {
  await page.getByTestId('tool-rectangle').click()
  const shape = page.locator('.scene-node.is-selected[data-element-type="rectangle"]')
  await page.getByLabel('Toggle stroke').click()
  await page.getByLabel('Paper shader effect').selectOption('liquid-distortion')
  const surface = shape.locator('.paper-shader-surface')
  await expectShaderRendered(surface)
  await page.getByLabel('Shader blend mode').selectOption('multiply')
  await page.getByRole('spinbutton', { name: 'Shader Material opacity %', exact: true }).fill('40')
  await expect(surface).toHaveCSS('mix-blend-mode', 'multiply')
  await expect(surface).toHaveCSS('opacity', '0.4')
  await expect(shape.locator('.shape-shader-wrap')).toHaveCSS('isolation', 'isolate')
  await expect(shape.locator('.shader-base-paint')).toHaveCSS('background-color', 'rgb(129, 173, 236)')
  await expect(shape.locator('.scene-vector rect')).toHaveAttribute('stroke', '#080808')
  await page.getByTestId('history-undo').click()
  await expect(surface).toHaveCSS('opacity', '1')
  await expect(surface).toHaveCSS('mix-blend-mode', 'multiply')
  await page.getByTestId('history-undo').click()
  await expect(surface).toHaveCSS('mix-blend-mode', 'normal')
})

test('studio previews and compares a glass swatch, then applies staged settings', async ({ page }, testInfo) => {
  const shape = page.getByLabel('Mesh Gradient study')
  await shape.click()
  await page.getByRole('button', { name: 'Browse shader library' }).click()
  const studio = page.getByRole('dialog', { name: 'FX studio' })
  await expect(studio).toBeVisible()
  await studio.getByRole('button', { name: 'Glass', exact: true }).click()
  await studio.getByRole('button', { name: 'Preview Glass Refraction', exact: true }).click()
  const preview = studio.getByTestId('shader-library-preview')
  await expectShaderRendered(preview.locator('.paper-shader-surface'))
  await expect(preview).toHaveCSS('background-size', '120px 120px')
  await studio.getByRole('button', { name: 'Ellipse preview' }).click()
  await expect(preview.locator('.shader-preview-material')).toHaveCSS('border-radius', '50%')
  await studio.getByLabel('Shader blend mode').selectOption('screen')
  await studio.getByRole('spinbutton', { name: 'Shader Material opacity %', exact: true }).fill('65')
  await expect(shape.locator('.paper-shader-surface')).toHaveAttribute('data-shader', 'mesh-gradient')
  await studio.getByRole('button', { name: 'Compare base paint' }).click()
  await expect(preview).toContainText('BASE PAINT')
  await expect(preview.locator('.paper-shader-surface')).toHaveCSS('visibility', 'hidden')
  await studio.getByRole('button', { name: 'Compare base paint' }).click()
  await testInfo.attach('FX studio', { body: await page.screenshot(), contentType: 'image/png' })
  await studio.getByRole('button', { name: 'Apply shader' }).click()
  await expect(studio).toHaveCount(0)
  const surface = shape.locator('.paper-shader-surface')
  await expect(surface).toHaveAttribute('data-shader', 'glass-refraction')
  await expectShaderRendered(surface)
  await expect(surface).toHaveCSS('mix-blend-mode', 'screen')
  await expect(surface).toHaveCSS('opacity', '0.65')
  await page.getByTestId('history-undo').click()
  await expect(surface).toHaveAttribute('data-shader', 'mesh-gradient')
})

test('cancelling staged material edits leaves the canvas and undo history unchanged', async ({ page }) => {
  const shape = page.getByLabel('Mesh Gradient study')
  await shape.click()
  await page.getByRole('button', { name: 'Browse shader library' }).click()
  const studio = page.getByRole('dialog', { name: 'FX studio' })
  await studio.getByRole('button', { name: 'Preview Liquid Distortion', exact: true }).click()
  await studio.getByLabel('Shader blend mode').selectOption('difference')
  await studio.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(shape.locator('.paper-shader-surface')).toHaveAttribute('data-shader', 'mesh-gradient')
  await expect(shape.locator('.paper-shader-surface')).toHaveCSS('mix-blend-mode', 'normal')
  await expect(page.getByTestId('history-undo')).toBeDisabled()
})

test('failed glass sources use fallback and recover when the source changes', async ({ page }) => {
  const shape = page.getByLabel('Mesh Gradient study')
  await shape.click()
  await page.getByLabel('Paper shader effect').selectOption('glass-refraction')
  const surface = shape.locator('.paper-shader-surface')
  await expectShaderRendered(surface)
  await page.route('**/fx-missing.png', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.getByLabel('Shader source image').fill('/fx-missing.png')
  await page.getByLabel('Shader source image').press('Enter')
  await expect(surface).toHaveAttribute('data-shader-fallback', 'true')
  await page.getByLabel('Shader source image').fill('/shader-source.svg')
  await page.getByLabel('Shader source image').press('Enter')
  await expectShaderRendered(surface)
})
