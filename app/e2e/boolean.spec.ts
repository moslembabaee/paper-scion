import { test, expect, type Page } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

async function shapes(page: Page) {
  const inspector = page.getByTestId('inspector-panel')
  const field = (name: string) => inspector.getByLabel(name, { exact: true })
  const set = async (name: string, value: string) => { await field(name).fill(value); await field(name).press('Enter') }
  await page.getByTestId('tool-rectangle').click()
  await set('Layer name', 'Base')
  await set('Width', '100'); await set('Height', '100')
  const x = Number(await field('X').inputValue()), y = Number(await field('Y').inputValue())
  await page.getByTestId('tool-rectangle').click()
  await set('Layer name', 'Cutter')
  await set('Width', '100'); await set('Height', '100')
  await set('X', String(x + 50)); await set('Y', String(y + 50))
  await page.getByTestId('layer-tree').getByTitle('Base', { exact: true }).click({ modifiers: ['Shift'] })
  return { x, y }
}

test.beforeEach(async ({ page }) => { await waitForCanvasReady(page) })

test('hover and focus preview on canvas without committing; Escape and edits dismiss it', async ({ page }) => {
  await shapes(page)
  const union = page.getByRole('button', { name: 'Union', exact: true })
  const subtract = page.getByRole('button', { name: 'Subtract', exact: true })
  const preview = page.getByTestId('boolean-canvas-preview')
  await union.hover()
  await expect(preview).toHaveAttribute('data-operation', 'union')
  await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
  await expect(page.locator('.scene-node[data-boolean-operation]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
  await subtract.hover()
  await union.hover()
  await expect(preview).toHaveAttribute('data-operation', 'union')
  const unionD = await preview.locator('path').getAttribute('d')
  await subtract.hover()
  await expect(preview).toHaveAttribute('data-operation', 'subtract')
  await expect(preview.locator('path')).not.toHaveAttribute('d', unionD!)
  await page.locator('.boolean-heading').hover()
  await expect(preview).toHaveCount(0)
  await union.focus()
  await expect(preview).toHaveAttribute('data-operation', 'union')
  await union.press('Escape')
  await expect(preview).toHaveCount(0)
  await union.click()
  await expect(page.locator('.scene-node[data-boolean-operation="union"]')).toHaveCount(1)
  await expect(preview).toHaveCount(0)
  await subtract.hover()
  await expect(preview).toHaveAttribute('data-operation', 'subtract')
  await expect(page.locator('.scene-node[data-boolean-operation="union"]')).toHaveCount(1)
  await subtract.click()
  await expect(preview).toHaveCount(0)
  await expect(page.locator('.scene-node[data-boolean-operation="subtract"]')).toHaveCount(1)
  await page.getByTestId('history-undo').click()
  await expect(page.locator('.scene-node[data-boolean-operation="union"]')).toHaveCount(1)
  await expect(preview).toHaveCount(0)
})

test('all four toolbar actions render real merged paths and undo restores sources', async ({ page }) => {
  const { x, y } = await shapes(page)
  for (const [operation, expected] of [
    ['Union', [true, true, true]], ['Subtract', [true, false, false]],
    ['Intersect', [false, true, false]], ['Exclude', [true, false, true]],
  ] as const) {
    await page.getByRole('button', { name: operation, exact: true }).click()
    const compound = page.locator(`.scene-node[data-boolean-operation="${operation.toLowerCase()}"]`)
    await expect(compound).toHaveCount(1)
    await expect(page.getByRole('button', { name: operation, exact: true })).toHaveAttribute('aria-pressed', 'true')
    const d = await compound.locator('path').getAttribute('d')
    const coverage = await page.evaluate(({ d, x, y }) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      const path = new Path2D(d!)
      return [[10, 10], [75, 75], [140, 140]].map(([dx, dy]) => ctx.isPointInPath(path, x + dx, y + dy))
    }, { d, x, y })
    expect(coverage).toEqual(expected)
    await expect(page.getByLabel('SVG path data', { exact: true })).toHaveAttribute('readonly', '')
    await page.getByTestId('history-undo').click()
    await expect(compound).toHaveCount(0)
    await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
  }
})

test('editable sources recompute the compound; flatten and release work with undo', async ({ page }) => {
  const { x } = await shapes(page)
  await page.getByRole('button', { name: 'Union', exact: true }).click()
  const compound = page.locator('.scene-node[data-boolean-operation]')
  const before = await compound.locator('path').getAttribute('d')
  await page.locator('.boolean-source summary').filter({ hasText: 'Cutter' }).click()
  const sourceX = page.getByLabel('Cutter source X', { exact: true })
  await sourceX.fill(String(x + 75)); await sourceX.press('Enter')
  await expect(compound.locator('path')).not.toHaveAttribute('d', before!)
  await page.getByTestId('history-undo').click()
  await expect(compound.locator('path')).toHaveAttribute('d', before!)
  await page.getByRole('button', { name: 'Flatten path', exact: true }).click()
  await expect(page.getByTestId('boolean-section')).toHaveCount(0)
  await expect(page.getByLabel('SVG path data', { exact: true })).not.toHaveAttribute('readonly', '')
  await page.getByTestId('history-undo').click()
  await page.getByRole('button', { name: 'Release sources', exact: true }).click()
  await expect(compound).toHaveCount(0)
  await expect(page.locator('.scene-node.is-selected')).toHaveCount(2)
  await page.getByTestId('history-undo').click()
  await page.getByRole('button', { name: 'Lock selected element', exact: true }).click()
  await expect(page.getByTestId('boolean-section')).toHaveCount(0)
  await expect(compound).not.toHaveClass(/is-selected/)
  await page.getByTestId('history-undo').click()
  await expect(page.getByRole('button', { name: 'Release sources', exact: true })).toBeEnabled()
})

test('destructive mode creates an editable path; mixed element types disable operations', async ({ page }) => {
  await shapes(page)
  await page.getByLabel('Flatten result', { exact: true }).check()
  await page.getByRole('button', { name: 'Exclude', exact: true }).click()
  await expect(page.locator('.scene-node.is-selected[data-element-type="path"]')).toHaveCount(1)
  await expect(page.getByTestId('boolean-section')).toHaveCount(0)
  await expect(page.getByLabel('SVG path data', { exact: true })).not.toHaveAttribute('readonly', '')
  await page.getByTestId('history-undo').click()
  await page.getByTestId('tool-text').click()
  await page.getByTestId('layer-tree').getByTitle('Base', { exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.getByRole('button', { name: 'Union', exact: true })).toBeDisabled()
  await expect(page.getByTestId('boolean-section')).toContainText('Select rectangles, ellipses, or vector paths.')
})

test('curve intersections, loops and holes agree with native browser SVG filling', async ({ page }) => {
  const failures = await page.evaluate(async () => {
    const geometryUrl = '/src/scene/booleanGeometry.ts', elementsUrl = '/src/scene/elements.ts'
    const { computeBoolean } = await import(geometryUrl)
    const { createElement } = await import(elementsUrl)
    const fixtures = [
      ['M0 0C120 120 -60 120 60 0Z', 'M10 10H80V80H10Z', 'nonzero'],
      ['M0 50C0 0 100 0 100 50C100 100 0 100 0 50Z', 'M0 50C0 25 25 12.5 50 12.5C75 12.5 100 25 100 50C100 100 0 100 0 50Z', 'nonzero'],
      ['M0 0H100V100H0Z M25 25H75V75H25Z', 'M40 40H90V90H40Z', 'evenodd'],
      ['M0 50A50 50 0 01100 50A50 50 0 010 50Z', 'M40 0H90V100H40Z', 'nonzero'],
      ['M0 0H10V10ZL100 100L100 0Z', 'M25 25H75V75H25Z', 'nonzero'],
      ['M0 0C0 0 100 0 100 0V100H0Z', 'M25 0H75V100H25Z', 'nonzero'],
    ]
    const ctx = document.createElement('canvas').getContext('2d')!
    // SVG elliptical arcs are normalized to cubics. Compare interiors away
    // from their subpixel approximation and the browser's boundary tolerance.
    ctx.lineWidth = .1
    const failures: string[] = []
    let seed = 42
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (const [a, b, fillRule] of fixtures) {
      const operands = [a, b].map(d => createElement('path', { d, width: 100, height: 100, viewBox: [0, 0, 100, 100], fillRule }))
      for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
        const result = new Path2D(computeBoolean(operands, operation).d)
        const sources = [new Path2D(a), new Path2D(b)]
        for (let i = 0; i < 1000; i++) {
          const x = random() * 130 - 15, y = random() * 130 - 15
          if (sources.some(source => ctx.isPointInStroke(source, x, y)) || ctx.isPointInStroke(result, x, y)) continue
          const [insideA, insideB] = sources.map(source => ctx.isPointInPath(source, x, y, fillRule as CanvasFillRule))
          const expected = operation === 'union' ? insideA || insideB : operation === 'subtract' ? insideA && !insideB : operation === 'intersect' ? insideA && insideB : insideA !== insideB
          if (ctx.isPointInPath(result, x, y) !== expected) failures.push(`${operation} at ${x},${y} for ${a}`)
        }
      }
    }
    return failures
  })
  expect(failures).toEqual([])
})
