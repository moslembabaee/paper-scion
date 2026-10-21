import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import {
  computeGeometryDiff,
  computeLayoutDiff,
  computeMorphTrajectories,
  computeScreenDiff,
  computeStyleDiff,
  elementToCubicContours,
  elementToSvgPath,
  ellipseToCubicPath,
  evaluateSmartMatrix,
  interpolateColor,
  interpolateSmartPath,
  isSpringSettled,
  rectToCubicPath,
  smartTransitionProgress,
  springMicroInteractionStep,
  springPhysicsMetrics,
} from '../src/prototype/smartAnimate.ts'
import {
  DEFAULT_SPRING,
  SPRING_PRESETS,
  springDuration,
  springProgress,
  springState,
} from '../src/prototype/spring.ts'
import { DEFAULT_TRANSITION } from '../src/prototype/model.ts'

function createTestStore() {
  const store = new SceneStore()
  store.add('frame', { id: 'screen-a', name: 'Screen A', width: 390, height: 844 })
  store.add('frame', { id: 'screen-b', name: 'Screen B', x: 500, width: 390, height: 844 })

  // Matched rectangle morphing to rounded card
  store.add('rectangle', {
    id: 'box-a',
    parentId: 'screen-a',
    name: 'CardBox',
    x: 20,
    y: 40,
    width: 100,
    height: 100,
    cornerRadius: 0,
    style: { opacity: 1, fill: '#ff0000' },
  })
  store.add('rectangle', {
    id: 'box-b',
    parentId: 'screen-b',
    name: 'CardBox',
    x: 40,
    y: 120,
    width: 200,
    height: 150,
    cornerRadius: 16,
    rotation: 45,
    style: { opacity: 0.8, fill: '#00ff00' },
  })

  // Matched vector shape: circle morphing to ellipse
  store.add('ellipse', {
    id: 'circle-a',
    parentId: 'screen-a',
    name: 'HeroIcon',
    x: 50,
    y: 200,
    width: 60,
    height: 60,
    style: { opacity: 1, fill: '#0000ff' },
  })
  store.add('rectangle', {
    id: 'circle-b',
    parentId: 'screen-b',
    name: 'HeroIcon',
    x: 80,
    y: 350,
    width: 120,
    height: 60,
    cornerRadius: 8,
    style: { opacity: 1, fill: '#ffff00' },
  })

  // Exiting element (only in A)
  store.add('rectangle', {
    id: 'exiting-item',
    parentId: 'screen-a',
    name: 'Banner',
    x: 10,
    y: 500,
    width: 370,
    height: 80,
  })

  // Entering element (only in B)
  store.add('rectangle', {
    id: 'entering-item',
    parentId: 'screen-b',
    name: 'ModalSheet',
    x: 20,
    y: 600,
    width: 350,
    height: 120,
  })

  store.clearHistory()
  return store
}

test('computeLayoutDiff calculates position, dimension, rotation and corner differences with shortest angular delta', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements
  const boxA = elements['box-a']
  const boxB = elements['box-b']

  const diff = computeLayoutDiff(boxA, boxB)
  assert.equal(diff.dx, 20)
  assert.equal(diff.dy, 80)
  assert.equal(diff.dWidth, 100)
  assert.equal(diff.dHeight, 50)
  assert.equal(diff.dRotation, 45)
  assert.equal(diff.dCornerRadius, 16)
  assert.ok(Math.abs(diff.dOpacity - (-0.2)) < 1e-6)
  assert.equal(diff.hasLayoutChanged, true)

  // Shortest angular path test: from 10° to 350° should be -20°, not +340°
  const rotFrom = { ...boxA, rotation: 10 }
  const rotTo = { ...boxA, rotation: 350 }
  const rotDiff = computeLayoutDiff(rotFrom, rotTo)
  assert.equal(rotDiff.dRotation, -20)
  assert.equal(rotDiff.hasLayoutChanged, true)

  // Identical layout should report hasLayoutChanged: false
  const noDiff = computeLayoutDiff(boxA, { ...boxA })
  assert.equal(noDiff.hasLayoutChanged, false)
})

test('computeStyleDiff detects fill and stroke variations', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements
  const boxA = elements['box-a']
  const boxB = elements['box-b']

  const diff = computeStyleDiff(boxA, boxB)
  assert.equal(diff.fromFill, '#ff0000')
  assert.equal(diff.toFill, '#00ff00')
  assert.equal(diff.hasStyleChanged, true)

  const noDiff = computeStyleDiff(boxA, { ...boxA })
  assert.equal(noDiff.hasStyleChanged, false)
})

test('rectToCubicPath and ellipseToCubicPath produce closed cubic SVG paths', () => {
  const sharpRect = rectToCubicPath(100, 50, 0)
  assert.ok(sharpRect.startsWith('M 0 0'))
  assert.ok(sharpRect.endsWith('Z'))

  const roundedRect = rectToCubicPath(100, 50, 10)
  assert.ok(roundedRect.includes('C'))
  assert.ok(roundedRect.endsWith('Z'))

  const ellipsePath = ellipseToCubicPath(80, 60)
  assert.ok(ellipsePath.startsWith('M 40 0'))
  assert.ok(ellipsePath.includes('C'))
  assert.ok(ellipsePath.endsWith('Z'))
})

test('elementToSvgPath and elementToCubicContours handle rect, ellipse, path and frame elements', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements

  // Rectangle
  const rectSvg = elementToSvgPath(elements['box-a'])
  assert.ok(rectSvg !== null)
  assert.deepEqual(rectSvg.viewBox, [0, 0, 100, 100])

  // Ellipse
  const ellipseSvg = elementToSvgPath(elements['circle-a'])
  assert.ok(ellipseSvg !== null)
  assert.deepEqual(ellipseSvg.viewBox, [0, 0, 60, 60])

  // Frame
  const frameSvg = elementToSvgPath(elements['screen-a'])
  assert.ok(frameSvg !== null)
  assert.deepEqual(frameSvg.viewBox, [0, 0, 390, 844])

  // Contours parsing
  const rectContours = elementToCubicContours(elements['box-a'])
  assert.ok(Array.isArray(rectContours) && rectContours.length > 0)
  assert.ok(rectContours[0].segments.length > 0)

  const ellipseContours = elementToCubicContours(elements['circle-a'])
  assert.ok(Array.isArray(ellipseContours) && ellipseContours.length > 0)
  assert.ok(ellipseContours[0].segments.length >= 4)
})

test('computeGeometryDiff prepares morph between different shapes with equalized segment counts', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements
  const circleA = elements['circle-a'] // Ellipse 60x60
  const circleB = elements['circle-b'] // Rounded Rect 120x60

  const geoDiff = computeGeometryDiff(circleA, circleB)
  assert.equal(geoDiff.isVector, true)
  assert.equal(geoDiff.isMorphable, true)
  assert.equal(geoDiff.hasGeometryChanged, true)
  assert.ok(geoDiff.preparedMorph !== null)
  assert.ok(geoDiff.segmentCount > 0)

  // Test Bézier path interpolation at progress 0, 0.5, and 1
  const pathAt0 = interpolateSmartPath(geoDiff.preparedMorph, 0)
  const pathAtHalf = interpolateSmartPath(geoDiff.preparedMorph, 0.5)
  const pathAt1 = interpolateSmartPath(geoDiff.preparedMorph, 1)

  assert.ok(typeof pathAt0 === 'string' && pathAt0.length > 0)
  assert.ok(typeof pathAtHalf === 'string' && pathAtHalf.length > 0)
  assert.ok(typeof pathAt1 === 'string' && pathAt1.length > 0)
  assert.notEqual(pathAt0, pathAt1)
  assert.notEqual(pathAtHalf, pathAt0)
  assert.notEqual(pathAtHalf, pathAt1)
})

test('computeScreenDiff matches layers, classifies entering/exiting, and produces summary metrics', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements

  const screenDiff = computeScreenDiff(elements, 'screen-a', 'screen-b')
  assert.equal(screenDiff.fromFrameId, 'screen-a')
  assert.equal(screenDiff.toFrameId, 'screen-b')

  // Screen A and Screen B match, CardBox matches CardBox, HeroIcon matches HeroIcon
  assert.equal(screenDiff.summary.totalMatched, 3)
  assert.ok(screenDiff.summary.layoutDiffCount >= 2)
  assert.ok(screenDiff.summary.morphablePathCount >= 1)

  // Entering & exiting identification
  assert.equal(screenDiff.summary.exitingCount, 1)
  assert.equal(screenDiff.exiting[0].id, 'exiting-item')

  assert.equal(screenDiff.summary.enteringCount, 1)
  assert.equal(screenDiff.entering[0].id, 'entering-item')
})

test('evaluateSmartMatrix preserves scale and center-origin rotation and supports spring overshoot', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements
  const boxA = elements['box-a']
  const boxB = elements['box-b']

  // At t = 0
  const m0 = evaluateSmartMatrix(boxA, boxB, 0)
  assert.ok(m0.startsWith('matrix('))

  // At t = 1
  const m1 = evaluateSmartMatrix(boxA, boxB, 1)
  assert.ok(m1.startsWith('matrix('))
  assert.notEqual(m0, m1)

  // At spring overshoot t = 1.15
  const mOvershoot = evaluateSmartMatrix(boxA, boxB, 1.15)
  assert.ok(mOvershoot.startsWith('matrix('))

  // Test 180° rotation matrix does not collapse with TRS decomposition
  const fromRot = { ...boxA, rotation: 0, width: 100, height: 100 }
  const toRot = { ...boxA, rotation: 180, width: 100, height: 100 }
  const mHalf = evaluateSmartMatrix(fromRot, toRot, 0.5)
  const nums = mHalf.slice(7, -1).split(',').map(Number)
  // At 90° halfway through 180°, scale must not collapse to 0
  const scaleX = Math.hypot(nums[0], nums[1])
  const scaleY = Math.hypot(nums[2], nums[3])
  assert.ok(Math.abs(scaleX - 1) < 0.05, `scaleX should be ~1, got ${scaleX}`)
  assert.ok(Math.abs(scaleY - 1) < 0.05, `scaleY should be ~1, got ${scaleY}`)
})

test('interpolateColor handles hex, rgba, and smooth transparent fading', () => {
  // Hex interpolation
  const redToGreen = interpolateColor('#ff0000', '#00ff00', 0.5)
  assert.ok(redToGreen.startsWith('rgba('))
  assert.equal(interpolateColor('#ff0000', '#00ff00', 0), 'rgba(255, 0, 0, 1)')
  assert.equal(interpolateColor('#ff0000', '#00ff00', 1), 'rgba(0, 255, 0, 1)')

  // Fade to transparent preserves color channel
  const fadeOut = interpolateColor('#ff0000', 'transparent', 0.5)
  assert.equal(fadeOut, 'rgba(255, 0, 0, 0.5)')

  // Both transparent
  assert.equal(interpolateColor('transparent', 'transparent', 0.5), 'transparent')
  assert.equal(interpolateColor(null, undefined, 0.5), 'transparent')
})

test('springPhysicsMetrics accurately computes frequency, damping ratio, settling time and overshoot', () => {
  // Bouncy preset (underdamped, zeta < 1)
  const bouncyMetrics = springPhysicsMetrics(SPRING_PRESETS.bouncy.spring)
  assert.ok(bouncyMetrics.isUnderdamped)
  assert.ok(bouncyMetrics.dampingRatio < 1)
  assert.ok(bouncyMetrics.overshootPercent > 5)
  assert.ok(bouncyMetrics.duration > 0 && bouncyMetrics.duration <= 10000)
  assert.ok(bouncyMetrics.undampedFrequency > 0)
  assert.ok(bouncyMetrics.dampedFrequency > 0)

  // Overdamped / stiff spring
  const overdampedSpring = { stiffness: 100, damping: 50, mass: 1 }
  const stiffMetrics = springPhysicsMetrics(overdampedSpring)
  assert.equal(stiffMetrics.isUnderdamped, false)
  assert.ok(stiffMetrics.dampingRatio >= 1)
  assert.equal(stiffMetrics.overshootPercent, 0)
})

test('smartTransitionProgress reflects spring oscillations and overshoot', () => {
  const transition = {
    ...DEFAULT_TRANSITION,
    kind: 'smart',
    easing: 'spring',
    spring: SPRING_PRESETS.bouncy.spring,
  }
  const duration = springDuration(transition.spring)

  assert.equal(smartTransitionProgress(0, transition, duration), 0)
  assert.equal(smartTransitionProgress(1, transition, duration), 1)

  // Bouncy spring overshoots 1.0 at intermediate time
  let maxProgress = 0
  for (let t = 0; t <= 1; t += 0.02) {
    const p = smartTransitionProgress(t, transition, duration)
    if (p > maxProgress) maxProgress = p
  }
  assert.ok(maxProgress > 1.05, `Bouncy spring should overshoot, max was ${maxProgress}`)
})

test('computeMorphTrajectories returns valid mapped trajectory vectors', () => {
  const store = createTestStore()
  const elements = store.getSnapshot().elements
  const diff = computeScreenDiff(elements, 'screen-a', 'screen-b')
  const morphPair = diff.matched.find(p => p.geometryDiff.isMorphable && p.geometryDiff.preparedMorph)
  assert.ok(morphPair !== undefined)

  const trajectories = computeMorphTrajectories(morphPair, 6)
  assert.ok(trajectories.length > 0)
  for (const traj of trajectories) {
    assert.ok(Number.isFinite(traj.fromPoint.x))
    assert.ok(Number.isFinite(traj.fromPoint.y))
    assert.ok(Number.isFinite(traj.toPoint.x))
    assert.ok(Number.isFinite(traj.toPoint.y))
    assert.ok(traj.path.startsWith('M '))
    assert.ok(traj.path.includes(' L '))
  }
})

test('springMicroInteractionStep and isSpringSettled simulate stable physical restitution', () => {
  const spring = DEFAULT_SPRING
  let state = { position: 100, velocity: 0 }
  const target = 0

  assert.equal(isSpringSettled(state, target), false)

  // Simulate 120 steps (2 seconds at 60Hz)
  for (let i = 0; i < 120; i++) {
    state = springMicroInteractionStep(state, target, spring, 1 / 60)
    assert.ok(Number.isFinite(state.position))
    assert.ok(Number.isFinite(state.velocity))
  }

  // After 2 seconds, DEFAULT_SPRING settles close to target
  assert.ok(Math.abs(state.position - target) < 1)
  assert.ok(Math.abs(state.velocity) < 2)

  // Once quiet, isSpringSettled returns true
  assert.equal(isSpringSettled({ position: 0.0001, velocity: 0.001 }, target), true)
  assert.equal(isSpringSettled({ position: 5, velocity: 0 }, target), false)
})
