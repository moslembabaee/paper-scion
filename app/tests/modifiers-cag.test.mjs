import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayerCSG,
  computePathCSG,
  clipPathWithCompound,
  computePolygonClipping,
  generateCompoundClipPath,
  generateCompoundSVGMask,
  generateCompoundHierarchyMarkup,
  generateClippedSVGExport,
  generateCssClipPath,
  calculatePathArea,
} from '../src/scene/csgEngine.ts'
import {
  evaluateModifierStack,
  createDefaultModifier,
  validateModifier,
} from '../src/scene/modifiers.ts'
import { createElement } from '../src/scene/elements.ts'

const close = (actual, expected, epsilon = 1e-4) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} ≈ ${expected} (diff: ${Math.abs(actual - expected)})`
  )
}

test('computeLayerCSG executes boolean operations between two vector elements', () => {
  const rectA = createElement('rectangle', { id: 'r1', name: 'A', x: 0, y: 0, width: 100, height: 100 })
  const rectB = createElement('rectangle', { id: 'r2', name: 'B', x: 50, y: 50, width: 100, height: 100 })

  const union = computeLayerCSG(rectA, rectB, 'union')
  close(calculatePathArea(union.d), 17500)

  const diff = computeLayerCSG(rectA, rectB, 'difference')
  close(calculatePathArea(diff.d), 7500)

  const inter = computeLayerCSG(rectA, rectB, 'intersection')
  close(calculatePathArea(inter.d), 2500)

  const excl = computeLayerCSG(rectA, rectB, 'exclusion')
  close(calculatePathArea(excl.d), 15000)
})

test('computePathCSG operates on raw SVG path strings and respects options', () => {
  const base = 'M 0 0 H 100 V 100 H 0 Z'
  const cutter = 'M 50 50 H 150 V 150 H 50 Z'

  const res = computePathCSG(base, cutter, 'difference', { tolerance: 1e-5 })
  close(calculatePathArea(res.d), 7500)
  assert.equal(res.fillRule, 'nonzero')
  assert.ok(res.viewBox[2] > 0 && res.viewBox[3] > 0)
})

test('clipPathWithCompound clips vector targets with compound shapes', () => {
  const target = createElement('rectangle', { id: 't1', x: 0, y: 0, width: 100, height: 100 })
  const compound = createElement('path', {
    id: 'c1',
    x: 25,
    y: 25,
    width: 50,
    height: 50,
    d: 'M 25 25 H 75 V 75 H 25 Z',
    viewBox: [25, 25, 50, 50],
  })

  const clippedIntersect = clipPathWithCompound(target, compound, 'intersect')
  close(calculatePathArea(clippedIntersect.d), 2500)

  const clippedSubtract = clipPathWithCompound(target, compound, 'subtract')
  close(calculatePathArea(clippedSubtract.d), 7500)
})

test('computePolygonClipping performs Sutherland-Hodgman convex polygon clipping', () => {
  // Subject square from 0,0 to 100,100
  const subject = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  // Convex clipping square from 50,0 to 150,100
  const clip = [
    { x: 50, y: 0 },
    { x: 150, y: 0 },
    { x: 150, y: 100 },
    { x: 50, y: 100 },
  ]

  const clipped = computePolygonClipping(subject, clip)
  assert.equal(clipped.length, 4)
  assert.ok(clipped.every(p => p.x >= 50 - 1e-6 && p.x <= 100 + 1e-6))
  assert.ok(clipped.every(p => p.y >= 0 - 1e-6 && p.y <= 100 + 1e-6))

  // Degenerate inputs return empty
  assert.deepEqual(computePolygonClipping([{ x: 0, y: 0 }], clip), [])
  assert.deepEqual(computePolygonClipping(subject, [{ x: 0, y: 0 }]), [])
})

test('clean SVG export generators produce well-formed SVG and CSS markup', () => {
  const compound = createElement('path', {
    id: 'compound-test',
    name: 'Compound Test',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    d: 'M 0 0 H 100 V 100 H 0 Z',
    viewBox: [0, 0, 100, 100],
    fillRule: 'nonzero',
    boolean: {
      operation: 'union',
      operands: [
        createElement('rectangle', { id: 'r1', name: 'R1', x: 0, y: 0, width: 50, height: 50 }),
        createElement('rectangle', { id: 'r2', name: 'R2', x: 25, y: 25, width: 50, height: 50 }),
      ],
    },
  })

  // 1. generateCompoundClipPath
  const clipXml = generateCompoundClipPath(compound, { clipPathId: 'custom-clip' })
  assert.match(clipXml, /^<clipPath id="custom-clip" clipPathUnits="userSpaceOnUse">/)
  assert.match(clipXml, /clip-rule="nonzero"/)
  assert.match(clipXml, /<\/clipPath>$/)

  // 2. generateCompoundSVGMask
  const maskXml = generateCompoundSVGMask(compound, { maskId: 'custom-mask' })
  assert.match(maskXml, /^<mask id="custom-mask" maskUnits="userSpaceOnUse">/)
  assert.match(maskXml, /fill="#ffffff"/)
  assert.match(maskXml, /<\/mask>$/)

  // 3. generateCompoundHierarchyMarkup
  const hierarchyXml = generateCompoundHierarchyMarkup(compound)
  assert.match(hierarchyXml, /<g id="compound-test" data-type="compound" data-boolean-op="union">/)
  assert.match(hierarchyXml, /<!-- Non-Destructive Source Hierarchy \(2 operands\) -->/)
  assert.match(hierarchyXml, /<g data-role="sources" style="display:none">/)
  assert.match(hierarchyXml, /<path id="r1" data-name="R1"/)
  assert.match(hierarchyXml, /<path id="r2" data-name="R2"/)

  // 4. generateClippedSVGExport
  const clippedStandalone = generateClippedSVGExport(compound)
  assert.match(clippedStandalone, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100"/)
  assert.match(clippedStandalone, /<clipPath id="clip-compound-test"/)
  assert.match(clippedStandalone, /<g clip-path="url\(#clip-compound-test\)">/)

  // 5. generateCssClipPath
  const cssClip = generateCssClipPath(compound)
  assert.match(cssClip, /^path\('M 0 0 H 100 V 100 H 0 Z?'\)$/)
})

test('evaluateModifierStack applies CSG modifiers referencing scene elements', () => {
  const baseRect = createElement('rectangle', { id: 'base-rect', name: 'Base Rect', x: 0, y: 0, width: 100, height: 100 })
  const cutterRect = createElement('rectangle', { id: 'cutter-rect', name: 'Cutter Rect', x: 50, y: 50, width: 100, height: 100 })

  const context = {
    elements: {
      'base-rect': baseRect,
      'cutter-rect': cutterRect,
    },
    currentElementId: 'base-rect',
  }

  const csgMod = {
    ...createDefaultModifier('csg', 'Difference Cutter'),
    enabled: true,
    type: 'csg',
    operation: 'difference',
    targetLayerId: 'cutter-rect',
  }
  validateModifier(csgMod)

  const result = evaluateModifierStack(baseRect, [csgMod], context)
  assert.equal(result.activeModifierCount, 1)
  assert.equal(result.totalModifierCount, 1)
  assert.equal(result.error, undefined)
  // Base 10000 - Overlap 2500 = 7500
  close(calculatePathArea(result.d), 7500)
})

test('evaluateModifierStack handles ellipse cutter and chained modifiers', () => {
  const base = createElement('rectangle', { id: 'base', x: 0, y: 0, width: 100, height: 100 })
  const cutterCircle = createElement('ellipse', { id: 'circle-cut', x: 25, y: 25, width: 50, height: 50 })

  const context = {
    elements: { base, 'circle-cut': cutterCircle },
    currentElementId: 'base',
  }

  // 1. Preserving cubic beziers (adaptiveSubdivision: false)
  const modExact = {
    ...createDefaultModifier('csg'),
    enabled: true,
    type: 'csg',
    operation: 'difference',
    targetLayerId: 'circle-cut',
    adaptiveSubdivision: false,
  }

  const resExact = evaluateModifierStack(base, [modExact], context)
  assert.equal(resExact.activeModifierCount, 1)
  assert.match(resExact.d, / C /)
  // Area = 10000 - pi * 25^2 ≈ 10000 - 1964.045 = 8035.955
  close(calculatePathArea(resExact.d), 10000 - Math.PI * 25 * 25, 2)

  // 2. Adaptive bezier subdivision (adaptiveSubdivision: true)
  const modSubdivided = {
    ...createDefaultModifier('csg'),
    enabled: true,
    type: 'csg',
    operation: 'difference',
    targetLayerId: 'circle-cut',
    adaptiveSubdivision: true,
  }

  const resSub = evaluateModifierStack(base, [modSubdivided], context)
  assert.equal(resSub.activeModifierCount, 1)
  close(calculatePathArea(resSub.d), 8086.13, 1)
})
