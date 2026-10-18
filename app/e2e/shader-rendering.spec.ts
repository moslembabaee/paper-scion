import { test, expect } from '@playwright/test'
import { waitForCanvasReady, expectShaderRendered } from './helpers'

test.describe('Paper Shaders Rendering & Inspector', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page)
  })

  test('renders seed shader element with Mesh Gradient effect in Material artboard', async ({ page }) => {
    // Locate the seed mesh gradient ellipse in the material frame
    const shaderSurface = page.locator('.paper-shader-surface[data-shader="mesh-gradient"]')
    await expect(shaderSurface).toBeVisible({ timeout: 5000 })

    // Verify it is inside the material frame
    const materialFrame = page.locator('[data-element-id="material"]')
    await expect(materialFrame.locator('.paper-shader-surface')).toBeVisible()

    // Check the fallback paint and the actual WebGL engine separately.
    const style = await shaderSurface.getAttribute('style')
    expect(style).toContain('linear-gradient')
    await expectShaderRendered(shaderSurface)
  })

  test('displays ShaderInspector controls when a shader shape is selected', async ({ page }) => {
    // Select the mesh gradient shape
    const shape = page.getByLabel('Mesh Gradient study')
    await shape.click()

    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toContainText('PAPER SHADERS')
    await expect(inspector.getByRole('button', { name: 'Browse shader library' })).toBeVisible()

    const effectSelect = page.getByLabel('Paper shader effect')
    await expect(effectSelect).toHaveValue('mesh-gradient')

    // Motion and playback controls exist
    const playbackGroup = page.getByRole('group', { name: 'Shader playback' })
    await expect(playbackGroup).toBeVisible()
    await expect(playbackGroup.getByRole('button', { name: /animated/i })).toBeVisible()
    await expect(playbackGroup.getByRole('button', { name: /static/i })).toBeVisible()
  })

  test('dynamically switches shader effect types in the inspector', async ({ page }) => {
    // Select the mesh gradient shape
    const shape = page.getByLabel('Mesh Gradient study')
    await shape.click()

    const effectSelect = page.getByLabel('Paper shader effect')

    // Values match the public effect options, including Neuro Noise's full identifier.
    for (const kind of ['dot-orbit', 'neuro-noise', 'grain-gradient', 'halftone-cmyk']) {
      await effectSelect.selectOption(kind)
      await expect(effectSelect).toHaveValue(kind)
      await expectShaderRendered(shape.locator(`.paper-shader-surface[data-shader="${kind}"]`))
    }
  })

  test('toggles playback between animated and static modes', async ({ page }) => {
    const shape = page.getByLabel('Mesh Gradient study')
    await shape.click()

    const playbackGroup = page.getByRole('group', { name: 'Shader playback' })
    const staticBtn = playbackGroup.getByRole('button', { name: /static/i })
    const animatedBtn = playbackGroup.getByRole('button', { name: /animated/i })

    // Switch to Static
    await staticBtn.click()
    await expect(staticBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(animatedBtn).toHaveAttribute('aria-pressed', 'false')

    // Switch back to Animated
    await animatedBtn.click()
    await expect(animatedBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(staticBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('applies and removes shader effect on a newly created shape', async ({ page }) => {
    // Create new rectangle
    await page.getByTestId('tool-rectangle').click()

    const selectedRect = page.locator('.scene-node[data-element-type="rectangle"].is-selected')
    await expect(selectedRect).toBeVisible()

    // Apply Mesh Gradient shader via Inspector
    const effectSelect = page.getByLabel('Paper shader effect')
    await effectSelect.selectOption('mesh-gradient')

    // Verify shader surface was mounted on the rectangle
    const rectShader = selectedRect.locator('.paper-shader-surface[data-shader="mesh-gradient"]')
    await expectShaderRendered(rectShader)

    // Remove effect
    const removeBtn = page.getByRole('button', { name: 'Remove effect' })
    await removeBtn.click()

    // Verify shader surface is removed
    await expect(selectedRect.locator('.paper-shader-surface')).toBeHidden()
  })
})
