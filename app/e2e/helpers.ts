import { expect, type Locator, type Page } from '@playwright/test'
import { mockStudioSession } from './studio-session'

/**
 * Utility helpers for Paper E2E tests.
 */

export interface CameraTransform {
  x: number
  y: number
  zoom: number
}

/**
 * Wait for canvas viewport, grid, rulers, and world elements to be mounted and ready.
 */
export async function waitForCanvasReady(page: Page, resetStorage = true) {
  await mockStudioSession(page)
  // Clear any persisted localStorage to guarantee clean seed state
  if (resetStorage) await page.addInitScript(() => {
    localStorage.clear()
  })

  await page.goto('/')
  const viewport = page.getByTestId('canvas-viewport')
  await expect(viewport).toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('viewport-world')).toBeAttached()
  await expect(page.getByTestId('viewport-grid')).toBeVisible()

  // Wait for seed artboards to mount
  await expect(page.locator('[data-element-id="space"]')).toBeVisible()
  await expect(page.locator('[data-element-id="room"]')).toBeVisible()
  await expect(page.locator('[data-element-id="material"]')).toBeVisible()

  await expect(page.getByTestId('viewport-world')).toHaveAttribute('style', /translate3d.*scale/)
  await waitForViewportSettled(page)
}

/**
 * Retrieve the current viewport world transform (x, y, zoom).
 */
export async function getViewportTransform(page: Page): Promise<CameraTransform> {
  return page.getByTestId('viewport-world').evaluate(element => {
    const transform = getComputedStyle(element).transform
    if (transform === 'none') throw new Error('The viewport camera has not mounted')
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.m11 }
  })
}

/** Wait for the demand-driven camera to finish writing its animated transform. */
export async function waitForViewportSettled(page: Page): Promise<void> {
  let previous: string | null = null
  let stableSamples = 0
  await expect.poll(async () => {
    const current = await page.getByTestId('viewport-world').getAttribute('style')
    stableSamples = current !== null && current === previous ? stableSamples + 1 : 0
    previous = current
    return stableSamples
  }, { message: 'Viewport camera should settle', intervals: [50, 100, 150] }).toBeGreaterThanOrEqual(2)
}

/** Check the actual camera zoom, then wait until its screen-space position settles. */
export async function expectZoom(page: Page, zoom: number): Promise<void> {
  await expect.poll(async () => (await getViewportTransform(page)).zoom,
    { message: `Canvas should reach ${Math.round(zoom * 100)}% zoom` }
  ).toBeCloseTo(zoom, 4)
  await waitForViewportSettled(page)
  await expect(page.getByTestId('zoom-value')).toHaveText(`${Math.round(zoom * 100)}%`)
}

/** Create actual pen geometry rather than relying on the old placeholder path. */
export async function drawVectorPath(page: Page) {
  await page.getByTestId('zoom-value').click()
  await page.getByTestId('zoom-menu').getByRole('button', { name: '100%', exact: true }).click()
  await expectZoom(page, 1)
  const bounds = (await page.getByTestId('canvas-viewport').boundingBox())!
  const x = bounds.x + 160, y = bounds.y + 200
  await page.getByTestId('tool-path').click()
  await page.mouse.click(x, y + 120)
  await page.mouse.click(x + 60, y)
  await page.mouse.click(x + 120, y + 120)
  await page.locator('.pen-anchor[data-anchor="0"]').click()
  await expect(page.getByTestId('pen-overlay')).toHaveCount(0)
}

/** A CSS fallback alone must not make a shader rendering test pass. */
export async function expectShaderRendered(surface: Locator): Promise<void> {
  await expect(surface).toBeVisible()
  const canvas = surface.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext('webgl2')
    if (!gl || gl.isContextLost() || element.width <= 0 || element.height <= 0) return false
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    return program !== null && gl.getProgramParameter(program, gl.LINK_STATUS) === true
  }), { message: 'Paper shader should have a linked WebGL program', timeout: 10000 }).toBe(true)
  await expect(surface).not.toHaveAttribute('data-shader-fallback', 'true')
}

/**
 * Perform a mouse drag gesture with intermediate steps.
 */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { steps?: number; button?: 'left' | 'middle' | 'right' }
) {
  const steps = options?.steps ?? 5
  const button = options?.button ?? 'left'

  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button })

  for (let i = 1; i <= steps; i++) {
    const curX = from.x + ((to.x - from.x) * i) / steps
    const curY = from.y + ((to.y - from.y) * i) / steps
    await page.mouse.move(curX, curY)
    await page.waitForTimeout(16)
  }

  await page.mouse.up({ button })
  await waitForViewportSettled(page)
}
