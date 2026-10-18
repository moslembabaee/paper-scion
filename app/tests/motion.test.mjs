import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { SceneReplica } from '../src/collaboration/model.ts'
import { CURVES } from '../src/prototype/model.ts'
import { SPRING_PRESETS } from '../src/prototype/spring.ts'
import {
  addKeyframeAtTime,
  computeSpringMetrics,
  createTrack,
  deleteKeyframeFromTrack,
  duplicateKeyframeInTrack,
  DEFAULT_EASING,
  EMPTY_MOTION,
  easingProgress,
  findAdjacentKeyframeTimes,
  formatTime,
  getElementPropertyValue,
  isShaderProperty,
  isTypographyProperty,
  MOTION_BEZIER_PRESETS,
  patchKeyframe,
  PROPERTY_META,
  pruneMotion,
  sampleTimes,
  trackValue,
  validateMotion,
} from '../src/motion/model.ts'
import { exportMotion } from '../src/motion/export.ts'

function fixture() {
  const store = new SceneStore()
  store.add('frame', { id: 'frame1', width: 400, height: 400 })
  store.add('rectangle', { id: 'rect1', parentId: 'frame1', x: 20, y: 20, width: 100, height: 80 })
  store.add('ellipse', { id: 'circle1', parentId: 'frame1', x: 150, y: 150, width: 60, height: 60 })
  store.clearHistory()
  return store
}

test('motion track creation, validation, and keyframe retiming', () => {
  const store = fixture()
  const elements = store.getSnapshot().elements

  const trackX = createTrack('rect1', 'x', 2000)
  assert.equal(trackX.elementId, 'rect1')
  assert.equal(trackX.property, 'x')
  assert.equal(trackX.keyframes.length, 2)
  assert.equal(trackX.keyframes[0].time, 0)
  assert.equal(trackX.keyframes[0].value, PROPERTY_META.x.from)
  assert.equal(trackX.keyframes[1].value, PROPERTY_META.x.to)

  const motionDoc = {
    duration: 2000,
    tracks: [trackX],
  }

  const validated = validateMotion(motionDoc, elements)
  assert.equal(validated.duration, 2000)
  assert.equal(validated.tracks.length, 1)
  assert.equal(Object.isFrozen(validated), true)
  assert.equal(Object.isFrozen(validated.tracks), true)
  assert.equal(Object.isFrozen(validated.tracks[0].keyframes), true)

  // Invalid cases throw
  assert.throws(() => validateMotion({ duration: 50, tracks: [] }, elements)) // < 100ms
  assert.throws(() => validateMotion({ duration: 2000, tracks: [{ ...trackX, elementId: 'nonexistent' }] }, elements))
  assert.throws(() => validateMotion({ duration: 2000, tracks: [{ ...trackX, property: 'invalid' }] }, elements))

  // Out of order keyframes throw
  const badTrack = {
    ...trackX,
    keyframes: [
      { id: 'k1', time: 500, value: 0, easing: DEFAULT_EASING },
      { id: 'k2', time: 200, value: 100, easing: DEFAULT_EASING },
    ],
  }
  assert.throws(() => validateMotion({ duration: 2000, tracks: [badTrack] }, elements))

  // Retiming keyframes with patchKeyframe sorts properly
  const patched = patchKeyframe(trackX, trackX.keyframes[0].id, { time: 100 })
  assert.equal(patched.keyframes[0].time, 100)
})

test('spring physics and cubic Bézier curve evaluation with property bounds', () => {
  // Spring evaluation
  const springEasing = { kind: 'spring', spring: SPRING_PRESETS.bouncy.spring }
  const startVal = easingProgress(0, springEasing)
  assert.equal(startVal, 0)
  const endVal = easingProgress(1, springEasing)
  assert.ok(Math.abs(endVal - 1) < 0.05)

  // Bouncy spring exhibits overshoot (> 1.0) mid-flight
  const samples = Array.from({ length: 50 }, (_, i) => easingProgress(i / 50, springEasing))
  const maxSample = Math.max(...samples)
  assert.ok(maxSample > 1.0, `Expected bouncy spring overshoot > 1.0, got ${maxSample}`)

  // Spring physics metrics telemetry computation
  const bouncyMetrics = computeSpringMetrics(SPRING_PRESETS.bouncy.spring)
  assert.equal(bouncyMetrics.classification, 'underdamped')
  assert.ok(bouncyMetrics.dampingRatio < 1.0)
  assert.ok(bouncyMetrics.peakOvershootPercent > 0)
  assert.ok(bouncyMetrics.settleTimeMs > 0)

  const overdampedSpring = { stiffness: 100, damping: 50, mass: 1 }
  const overdampedMetrics = computeSpringMetrics(overdampedSpring)
  assert.equal(overdampedMetrics.classification, 'overdamped')
  assert.ok(overdampedMetrics.dampingRatio > 1.0)
  assert.equal(overdampedMetrics.peakOvershootPercent, 0)

  // Verify all extended spring presets are structurally sound
  for (const [presetKey, preset] of Object.entries(SPRING_PRESETS)) {
    assert.ok(preset.spring.stiffness >= 20 && preset.spring.stiffness <= 1000)
    assert.ok(preset.spring.damping >= 1 && preset.spring.damping <= 100)
    assert.ok(preset.spring.mass >= 0.1 && preset.spring.mass <= 10)
    const m = computeSpringMetrics(preset.spring)
    assert.ok(m.settleTimeMs >= 100)
  }

  // Cubic Bézier evaluation
  const bezierEasing = { kind: 'bezier', curve: CURVES['ease-out'] }
  assert.equal(easingProgress(0, bezierEasing), 0)
  assert.equal(easingProgress(1, bezierEasing), 1)
  assert.ok(easingProgress(0.5, bezierEasing) > 0.5) // Ease-out is ahead of linear at midpoint

  // Track value interpolation
  const track = {
    id: 't1',
    elementId: 'rect1',
    property: 'opacity',
    enabled: true,
    keyframes: [
      { id: 'k1', time: 0, value: 0.2, easing: { kind: 'bezier', curve: [0, 0, 1, 1] } },
      { id: 'k2', time: 1000, value: 0.8, easing: DEFAULT_EASING },
    ],
  }

  // Linear progression from 0.2 to 0.8 over 1000ms
  assert.equal(trackValue(track, 0), 0.2)
  assert.ok(Math.abs(trackValue(track, 500) - 0.5) < 0.01)
  assert.equal(trackValue(track, 1000), 0.8)
  assert.equal(trackValue(track, 1500), 0.8) // Clamps past last keyframe
  assert.equal(trackValue(track, -100), 0.2) // Clamps before first keyframe

  // Sample times includes boundary and keyframe timestamps
  const motionDoc = { duration: 1000, tracks: [track] }
  const times = sampleTimes(motionDoc)
  assert.equal(times[0], 0)
  assert.equal(times.at(-1), 1000)
  assert.ok(times.includes(0))
  assert.ok(times.includes(1000))
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] > times[i - 1], 'Sample times must be strictly increasing')
  }
})

test('scene store motion document persistence, undo/redo, and pruning on element removal', () => {
  const store = fixture()
  const track1 = createTrack('rect1', 'x', 2000)
  const track2 = createTrack('circle1', 'y', 2000)
  const initialMotion = { duration: 2000, tracks: [track1, track2] }

  // Set motion on store
  store.setMotion(initialMotion, 'Add motion tracks')
  const snap = store.getSnapshot()
  assert.ok(snap.motion)
  assert.equal(snap.motion.tracks.length, 2)

  // Undo restores previous motion state
  store.undo()
  assert.equal(store.getSnapshot().motion, undefined)

  // Redo re-applies motion state
  store.redo()
  assert.equal(store.getSnapshot().motion?.tracks.length, 2)

  // Project serialization & round trip
  const json = store.toJSON()
  assert.ok(json.motion)
  assert.equal(json.motion.tracks.length, 2)

  const restoredStore = new SceneStore()
  restoredStore.load(json)
  assert.deepEqual(restoredStore.getSnapshot().motion, snap.motion)

  // Removing an element prunes associated motion tracks automatically
  store.remove('rect1')
  const afterRemove = store.getSnapshot()
  assert.equal(afterRemove.motion?.tracks.length, 1)
  assert.equal(afterRemove.motion?.tracks[0].elementId, 'circle1')

  // Pruning function directly
  const pruned = pruneMotion(initialMotion, { circle1: store.getSnapshot().elements.circle1 })
  assert.equal(pruned.tracks.length, 1)
  assert.equal(pruned.tracks[0].elementId, 'circle1')
})

test('collaboration replica tracks and synchronizes motion changes', () => {
  const store = fixture()
  const replica = new SceneReplica()
  const before = store.getSnapshot()

  const track = createTrack('rect1', 'rotation', 1500)
  store.setMotion({ duration: 1500, tracks: [track] })
  const after = store.getSnapshot()

  const changes = replica.change(before, after)
  assert.ok(changes.some(c => c.path[0] === 'motion'))
})

test('motion code export for Framer Motion, CSS keyframes, WAAPI and JSON', () => {
  const store = fixture()
  const elements = store.getSnapshot().elements
  const trackX = createTrack('rect1', 'x', 2000)
  const trackScale = createTrack('rect1', 'scale', 2000)
  const motionDoc = { duration: 2000, tracks: [trackX, trackScale], loop: true }

  // Empty state handling
  assert.ok(exportMotion(EMPTY_MOTION, elements, 'framer').includes('// Add an enabled motion track'))
  assert.ok(exportMotion(EMPTY_MOTION, elements, 'css').includes('/* Add an enabled motion track'))
  assert.ok(exportMotion(EMPTY_MOTION, elements, 'waapi').includes('// Add an enabled motion track'))

  // Framer Motion export
  const framerCode = exportMotion(motionDoc, elements, 'framer')
  assert.ok(framerCode.includes('import { motion } from "framer-motion";'))
  assert.ok(framerCode.includes('export function MotionLayer1()'))
  assert.ok(framerCode.includes('initial='))
  assert.ok(framerCode.includes('animate='))
  assert.ok(framerCode.includes('transition='))
  assert.ok(framerCode.includes('"ease":"linear"'))
  assert.ok(framerCode.includes('"repeat":Infinity'))

  // CSS keyframes export
  const cssCode = exportMotion(motionDoc, elements, 'css')
  assert.ok(cssCode.includes('.paper-motion-1'))
  assert.ok(cssCode.includes('@keyframes paper-motion-1'))
  assert.ok(cssCode.includes('translate:'))
  assert.ok(cssCode.includes('scale:'))
  assert.ok(cssCode.includes('Spring { stiffness: 170, damping: 20, mass: 1 }'))
  assert.ok(cssCode.includes('@media (prefers-reduced-motion: reduce)'))
  assert.ok(cssCode.includes('0% {'))
  assert.ok(cssCode.includes('100% {'))
  assert.ok(cssCode.includes('infinite'))

  // WAAPI export
  const waapiCode = exportMotion(motionDoc, elements, 'waapi')
  assert.ok(waapiCode.includes('export function animateLayer1(element: HTMLElement)'))
  assert.ok(waapiCode.includes('element.animate('))
  assert.ok(waapiCode.includes('duration: 2000'))
  assert.ok(waapiCode.includes('iterations: Infinity'))

  // JSON export
  const jsonCode = exportMotion(motionDoc, elements, 'json')
  const parsed = JSON.parse(jsonCode)
  assert.equal(parsed.duration, 2000)
  assert.equal(parsed.tracks.length, 2)
  assert.equal(parsed.loop, true)
})

test('exported loops use numeric infinity and retain authored segment timing', () => {
  const store = fixture()
  const elements = store.getSnapshot().elements
  const track = createTrack('rect1', 'x', 2000)
  const middle = addKeyframeAtTime(track, 731, 65)
  assert.ok(middle)

  for (const loop of [true, false]) {
    const motion = { duration: 2000, tracks: [middle.track], loop }
    for (const format of ['framer', 'waapi']) {
      const source = exportMotion(motion, elements, format)
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
        fileName: 'motion-export.tsx',
      })
      const exported = {}
      vm.runInNewContext(outputText, {
        exports: exported,
        require: name => {
          if (name === 'framer-motion') return { motion: { div: 'div' } }
          if (name === 'react/jsx-runtime') return { jsx: (_type, props) => props }
          throw new Error(`Unexpected import: ${name}`)
        },
      })
      if (format === 'framer') {
        const props = exported.MotionLayer1()
        assert.equal(props.transition.repeat, loop ? Infinity : undefined)
        const index = props.transition.times.indexOf(731 / 2000)
        assert.ok(index >= 0, 'Export must preserve the exact authored timestamp')
        assert.equal(props.animate.x[index], 65)
      } else {
        exported.animateLayer1({ animate: (frames, options) => {
          assert.equal(options.iterations, loop ? Infinity : 1)
          assert.ok(frames.some(frame => frame.offset === 731 / 2000))
        } })
      }
    }
  }
})

test('shader parameter motion tracks creation, validation, and interpolation', () => {
  const store = fixture()
  // Add shader to rect1
  store.update('rect1', 'rectangle', {
    style: {
      fill: null,
      shader: {
        kind: 'neuro-noise',
        animated: true,
        speed: 1.5,
        frame: 0,
        scale: 1.2,
        rotation: 45,
        offsetX: 0.1,
        offsetY: 0.2,
        composite: { blendMode: 'normal', opacity: 0.85 },
        params: { colorFront: '#edebe1', colorMid: '#81adec', colorBack: '#080808', brightness: 1, contrast: 1 },
      },
    },
  })
  const elements = store.getSnapshot().elements
  const rect = elements.rect1

  // Test isShaderProperty
  assert.equal(isShaderProperty('shaderSpeed'), true)
  assert.equal(isShaderProperty('shaderScale'), true)
  assert.equal(isShaderProperty('shaderRotation'), true)
  assert.equal(isShaderProperty('shaderOffsetX'), true)
  assert.equal(isShaderProperty('shaderOffsetY'), true)
  assert.equal(isShaderProperty('shaderOpacity'), true)
  assert.equal(isShaderProperty('x'), false)
  assert.equal(isShaderProperty('scale'), false)

  // Create shader tracks with element initial design values
  const trackSpeed = createTrack('rect1', 'shaderSpeed', 3000, rect)
  assert.equal(trackSpeed.elementId, 'rect1')
  assert.equal(trackSpeed.property, 'shaderSpeed')
  assert.equal(trackSpeed.keyframes[0].value, 1.5) // Picked up from rect.style.shader.speed!
  assert.ok(trackSpeed.keyframes[1].value > 1.5)

  const trackScale = createTrack('rect1', 'shaderScale', 3000, rect)
  assert.equal(trackScale.keyframes[0].value, 1.2) // Picked up from rect.style.shader.scale!

  const trackRot = createTrack('rect1', 'shaderRotation', 3000, rect)
  assert.equal(trackRot.keyframes[0].value, 45) // Picked up from rect.style.shader.rotation!

  const trackOffX = createTrack('rect1', 'shaderOffsetX', 3000, rect)
  assert.equal(trackOffX.keyframes[0].value, 0.1)

  const trackOffY = createTrack('rect1', 'shaderOffsetY', 3000, rect)
  assert.equal(trackOffY.keyframes[0].value, 0.2)

  const trackOpac = createTrack('rect1', 'shaderOpacity', 3000, rect)
  assert.equal(trackOpac.keyframes[0].value, 0.85) // Picked up from composite.opacity!

  // Validate motion document with all shader tracks
  const doc = {
    duration: 3000,
    tracks: [trackSpeed, trackScale, trackRot, trackOffX, trackOffY, trackOpac],
  }
  const validated = validateMotion(doc, elements)
  assert.equal(validated.tracks.length, 6)

  // Interpolation along timeline
  assert.equal(trackValue(trackSpeed, 0), 1.5)
  assert.ok(trackValue(trackSpeed, 1500) > 1.5)
  assert.equal(trackValue(trackSpeed, 3000), trackSpeed.keyframes[1].value)

  // Clamping at extremes
  assert.equal(trackValue(trackSpeed, -500), 1.5)
  assert.equal(trackValue(trackSpeed, 9999), trackSpeed.keyframes[1].value)

  // Export with shader properties
  const css = exportMotion(doc, elements, 'css')
  assert.ok(css.includes('--shader-speed:'))
  assert.ok(css.includes('--shader-scale:'))
  assert.ok(css.includes('--shader-rotation:'))
  assert.ok(css.includes('--shader-offset-x:'))
  assert.ok(css.includes('--shader-offset-y:'))
  assert.ok(css.includes('--shader-opacity:'))

  const framer = exportMotion(doc, elements, 'framer')
  assert.ok(framer.includes('"--shader-speed"'))
  assert.ok(framer.includes('"--shader-scale"'))
  assert.ok(framer.includes('"--shader-rotation"'))

  const waapi = exportMotion(doc, elements, 'waapi')
  assert.ok(waapi.includes('"--shader-speed"'))
  assert.ok(waapi.includes('"--shader-scale"'))

  // Read initial property values via helper
  assert.equal(getElementPropertyValue(rect, 'shaderSpeed'), 1.5)
  assert.equal(getElementPropertyValue(rect, 'shaderScale'), 1.2)
  assert.equal(getElementPropertyValue(rect, 'shaderRotation'), 45)
  assert.equal(getElementPropertyValue(rect, 'shaderOpacity'), 0.85)
  assert.equal(getElementPropertyValue(rect, 'scale'), 1)
})

test('keyframe manipulation helpers: add, delete, duplicate, retime, and formatTime', () => {
  const track = createTrack('rect1', 'scale', 2000)
  assert.equal(track.keyframes.length, 2)
  assert.equal(track.keyframes[0].time, 0)

  // Add keyframe at 1000ms
  const added = addKeyframeAtTime(track, 1000, 1.75)
  assert.ok(added)
  assert.equal(added.track.keyframes.length, 3)
  const midKey = added.track.keyframes.find(k => k.id === added.keyframeId)
  assert.ok(midKey)
  assert.equal(midKey.time, 1000)
  assert.equal(midKey.value, 1.75)

  // Cannot add duplicate keyframe at the exact same timestamp
  const dupAdd = addKeyframeAtTime(added.track, 1000)
  assert.equal(dupAdd, null)

  // Duplicate keyframe
  const dup = duplicateKeyframeInTrack(added.track, midKey.id, 2000, 200)
  assert.ok(dup)
  assert.equal(dup.track.keyframes.length, 4)
  const dupKey = dup.track.keyframes.find(k => k.id === dup.newKeyId)
  assert.ok(dupKey)
  assert.equal(dupKey.time, 1200)
  assert.equal(dupKey.value, 1.75)

  // Delete keyframe
  const afterDelete = deleteKeyframeFromTrack(dup.track, dupKey.id)
  assert.ok(afterDelete)
  assert.equal(afterDelete.keyframes.length, 3)

  // Refuses to delete if keyframe count <= 2
  const twoKeyTrack = track
  assert.equal(deleteKeyframeFromTrack(twoKeyTrack, twoKeyTrack.keyframes[0].id), null)

  // Adjacent keyframe navigation
  const doc = { duration: 2000, tracks: [afterDelete] }
  const adj1 = findAdjacentKeyframeTimes(doc, 500)
  assert.equal(adj1.prev, 0)
  assert.equal(adj1.next, 1000)

  const adj2 = findAdjacentKeyframeTimes(doc, 1000)
  assert.equal(adj2.prev, 0)
  assert.ok(adj2.next !== null && adj2.next > 1000)

  // formatTime helper
  const formatted = formatTime(1500, 60)
  assert.equal(formatted.seconds, '1.50s')
  assert.equal(formatted.frames, 'F90')
  assert.equal(formatted.full, '1.50s (90f)')
})

test('Bézier presets and spring curve evaluation', () => {
  // Check that all presets exist and have valid cubic bezier coordinate bounds
  for (const [name, preset] of Object.entries(MOTION_BEZIER_PRESETS)) {
    assert.ok(preset.label, `Preset ${name} must have a label`)
    assert.equal(preset.curve.length, 4, `Preset ${name} must have 4 control numbers`)
    assert.ok(preset.curve[0] >= 0 && preset.curve[0] <= 1, `${name} x1 in [0, 1]`)
    assert.ok(preset.curve[2] >= 0 && preset.curve[2] <= 1, `${name} x2 in [0, 1]`)
  }

  // Overshoot preset should exceed 1.0 at some point
  const overshoot = MOTION_BEZIER_PRESETS.overshoot
  const overshootValues = Array.from({ length: 40 }, (_, i) =>
    easingProgress(i / 40, { kind: 'bezier', curve: overshoot.curve })
  )
  assert.ok(Math.max(...overshootValues) > 1.05, 'Overshoot preset must overshoot 1.0')

  // Anticipate preset should drop below 0.0 initially
  const anticipate = MOTION_BEZIER_PRESETS.anticipate
  const anticipateValues = Array.from({ length: 20 }, (_, i) =>
    easingProgress(i / 20, { kind: 'bezier', curve: anticipate.curve })
  )
  assert.ok(Math.min(...anticipateValues) < -0.01, 'Anticipate preset must drop below 0.0')

  // Bounce preset exhibits oscillation
  const bounce = MOTION_BEZIER_PRESETS.bounce
  assert.ok(bounce.curve[1] < 0 || bounce.curve[3] > 1)
})

test('variable font and kinetic typography motion tracks with spring physics', () => {
  const store = fixture()
  store.add('text', {
    id: 'text1',
    parentId: 'frame1',
    text: 'Variable Kinetic Motion',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 300,
    variableAxes: { wght: 300, wdth: 85, slnt: -5, opsz: 36 },
    letterSpacing: 2,
    lineHeight: 1.3,
    textOnPath: { enabled: true, preset: 'wave', offset: 10 },
    kinetic: {
      enabled: true,
      playing: true,
      amplitude: 24,
      rotation: 12,
      duration: 2.0,
      stagger: 60,
      phase: 0.15,
      weightModulation: 120,
      slantModulation: 8,
      scaleModulation: 0.2,
    },
  })

  const elements = store.getSnapshot().elements
  const textElem = elements.text1

  // 1. isTypographyProperty tests
  assert.equal(isTypographyProperty('fontWeight'), true)
  assert.equal(isTypographyProperty('fontWidth'), true)
  assert.equal(isTypographyProperty('fontSlant'), true)
  assert.equal(isTypographyProperty('fontOpticalSize'), true)
  assert.equal(isTypographyProperty('fontSize'), true)
  assert.equal(isTypographyProperty('letterSpacing'), true)
  assert.equal(isTypographyProperty('lineHeight'), true)
  assert.equal(isTypographyProperty('textPathOffset'), true)
  assert.equal(isTypographyProperty('kineticPhase'), true)
  assert.equal(isTypographyProperty('kineticAmplitude'), true)
  assert.equal(isTypographyProperty('kineticRotation'), true)
  assert.equal(isTypographyProperty('kineticStagger'), true)
  assert.equal(isTypographyProperty('kineticWeightModulation'), true)
  assert.equal(isTypographyProperty('kineticSlantModulation'), true)
  assert.equal(isTypographyProperty('kineticScaleModulation'), true)
  assert.equal(isTypographyProperty('x'), false)
  assert.equal(isTypographyProperty('shaderSpeed'), false)

  // 2. getElementPropertyValue reads variable axes & typography state
  assert.equal(getElementPropertyValue(textElem, 'fontWeight'), 300)
  assert.equal(getElementPropertyValue(textElem, 'fontWidth'), 85)
  assert.equal(getElementPropertyValue(textElem, 'fontSlant'), -5)
  assert.equal(getElementPropertyValue(textElem, 'fontOpticalSize'), 36)
  assert.equal(getElementPropertyValue(textElem, 'fontSize'), 48)
  assert.equal(getElementPropertyValue(textElem, 'letterSpacing'), 2)
  assert.equal(getElementPropertyValue(textElem, 'lineHeight'), 1.3)
  assert.equal(getElementPropertyValue(textElem, 'textPathOffset'), 10)
  assert.equal(getElementPropertyValue(textElem, 'kineticPhase'), 0.15)
  assert.equal(getElementPropertyValue(textElem, 'kineticAmplitude'), 24)
  assert.equal(getElementPropertyValue(textElem, 'kineticWeightModulation'), 120)

  // 3. createTrack with initial element properties
  const trackWght = createTrack('text1', 'fontWeight', 2000, textElem)
  assert.equal(trackWght.keyframes[0].value, 300)
  assert.equal(trackWght.keyframes[1].value, 800)

  const trackWdth = createTrack('text1', 'fontWidth', 2000, textElem)
  assert.equal(trackWdth.keyframes[0].value, 85)

  const trackPhase = createTrack('text1', 'kineticPhase', 2000, textElem)
  assert.equal(trackPhase.keyframes[0].value, 0)
  assert.equal(trackPhase.keyframes[1].value, 1)

  // 4. Spring physics integration with variable font weight track
  const springEasing = { kind: 'spring', spring: SPRING_PRESETS.bouncy.spring }
  const springTrack = {
    ...trackWght,
    keyframes: [
      { id: 'k1', time: 0, value: 300, easing: springEasing },
      { id: 'k2', time: 1000, value: 800, easing: springEasing },
    ],
  }

  // Spring overshoot: value should overshoot target 800 before settling
  const sampleTimesList = Array.from({ length: 41 }, (_, i) => i * 25)
  const springValues = sampleTimesList.map(t => trackValue(springTrack, t))
  const maxVal = Math.max(...springValues)
  assert.ok(maxVal > 800, `Spring physics on variable font weight must produce overshoot (got ${maxVal} > 800)`)

  // 5. Validation of motion doc with typography tracks
  const doc = {
    duration: 2000,
    tracks: [springTrack, trackWdth, trackPhase],
  }
  const validated = validateMotion(doc, elements)
  assert.equal(validated.tracks.length, 3)

  // 6. Code export for variable typography
  const css = exportMotion(doc, elements, 'css')
  assert.ok(css.includes('font-weight:'))
  assert.ok(css.includes('font-stretch:'))
  assert.ok(css.includes('--kinetic-phase:'))
  assert.ok(css.includes('Spring { stiffness:'))

  const framer = exportMotion(doc, elements, 'framer')
  assert.ok(framer.includes('"fontWeight":'))
  assert.ok(framer.includes('"fontWidth":'))
  assert.ok(framer.includes('"--kinetic-phase":'))

  const waapi = exportMotion(doc, elements, 'waapi')
  assert.ok(waapi.includes('fontWeight'))
  assert.ok(waapi.includes('fontStretch'))
  assert.ok(waapi.includes('--kinetic-phase'))
})

