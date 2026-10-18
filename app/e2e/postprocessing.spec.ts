import { test, expect } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

test('GPU passes change pixels, preserve alpha, obey order and produce deterministic grain', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PostProcessingCompositor } = await import('/src/canvas/postprocessing/Compositor.ts')
    const { createPostProcessPass } = await import('/src/canvas/postprocessing/model.ts')
    const input = document.createElement('canvas')
    input.width = 64; input.height = 64
    const ctx = input.getContext('2d')!
    ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(25, 25, 14, 14)
    ctx.clearRect(0, 0, 5, 5)
    const output = document.createElement('canvas')
    const renderer = new PostProcessingCompositor(output)
    const gl = output.getContext('webgl2')!
    const render = (passes: ReturnType<typeof createPostProcessPass>[], time = 0, enabled = true) => {
      renderer.setPipeline({ version: 1, enabled, preset: 'custom', passes })
      renderer.render(input, time)
      const data = new Uint8Array(64 * 64 * 4)
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, data)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU error during post-processing')
      return [...data]
    }
    try {
      const plain = render([])
      const bloom = createPostProcessPass('bloom')
      const glow = render([{ ...bloom, params: { ...bloom.params, intensity: 3, radius: 2, threshold: .5 } }])
      const low = render([{ ...bloom, params: { ...bloom.params, threshold: .05 } }])
      const high = render([{ ...bloom, params: { ...bloom.params, threshold: 1, knee: 0 } }])
      const grain = createPostProcessPass('film-grain')
      const a = render([grain], 1), b = render([grain], 2), fixed = render([grain], 1)
      const chromatic = render([createPostProcessPass('chromatic-aberration')])
      const vignette = createPostProcessPass('vignette')
      const shade = render([vignette])
      const grade = createPostProcessPass('color-grade')
      const graded = render([{ ...grade, params: { ...grade.params, exposure: 1 } }])
      const ordered = render([grain, vignette]), reversed = render([vignette, grain])
      const bypass = render([grain, bloom], 10, false)
      const disabled = render([{ ...grain, enabled: false }, { ...bloom, opacity: 0 }])
      const sample = (pixels: number[], x: number, y: number, c = 0) => pixels[(y * 64 + x) * 4 + c]
      return { changed: [glow, chromatic, shade, graded].map(data => data.some((v, i) => v !== plain[i])),
        bloomBleed: sample(glow, 22, 32) > sample(plain, 22, 32),
        thresholdWorks: low.some((v, i) => v !== high[i]),
        alphaPreserved: [glow, chromatic, shade, a, graded].every(data => data.filter((_, i) => i % 4 === 3).every((v, i) => v === plain[i * 4 + 3])),
        grainAnimated: a.some((v, i) => v !== b[i]), grainDeterministic: a.every((v, i) => v === fixed[i]),
        orderMatters: ordered.some((v, i) => v !== reversed[i]),
        bypassExact: bypass.every((v, i) => v === plain[i]) && disabled.every((v, i) => v === plain[i]) }
    } finally { renderer.dispose() }
  })
  expect(result.changed).toEqual([true, true, true, true])
  for (const [key, value] of Object.entries(result)) if (key !== 'changed') expect(value, key).toBe(true)
})

test('inspector edits the live stack and bypass restores the source canvas', async ({ page }) => {
  await waitForCanvasReady(page)
  await page.getByLabel('Mesh Gradient study', { exact: true }).click()
  await page.getByRole('button', { name: 'Add finishing stack' }).click()
  const surface = page.getByLabel('Mesh Gradient study', { exact: true }).locator('.paper-shader-surface')
  const rendered = surface.locator('[data-post-processing-output]')
  await expect(rendered).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Post-process Threshold', { exact: true }).fill('0.8')
  await expect(page.getByLabel('Post-process Threshold', { exact: true })).toHaveValue('0.8')
  await page.getByLabel('Move Specular Bloom down', { exact: true }).click()
  await expect(page.locator('.post-pass summary').first()).toContainText('Chromatic aberration')
  await page.getByLabel('Add post-process pass', { exact: true }).selectOption('color-grade')
  await expect(page.locator('.post-pass')).toHaveCount(5)
  await expect(rendered).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Enable post-processing', { exact: true }).uncheck()
  await expect(rendered).toHaveCount(0)
  await expect(surface.locator('canvas')).toBeVisible()
  await page.getByLabel('Enable post-processing', { exact: true }).check()
  await expect(rendered).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Remove stack', exact: true }).click()
  await expect(rendered).toHaveCount(0)
})
