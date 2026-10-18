import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import {
  createDefaultGradient,
  validateGradient,
  freezeGradient,
  gradientToCSS,
  gradientUniforms,
  gradientToShaderPaint,
  interpolateGradientColor,
  addGradientStop,
  removeGradientStop,
  updateGradientStop,
  reverseGradientStops,
  GRADIENT_PRESETS,
} from '../src/shaders/gradient.ts'
import { exportGradientReact, exportShaderSource } from '../src/shaders/shaderExport.ts'
import { createShader, validateShader } from '../src/shaders/catalog.ts'
import {
  getActiveGradientStopId,
  setActiveGradientStopId,
  getActiveGradientHandle,
  setActiveGradientHandle,
  subscribeGradientState,
} from '../src/shaders/gradientState.ts'

test('createDefaultGradient creates valid linear, radial, and angular gradients', () => {
  const linear = createDefaultGradient('linear')
  assert.equal(linear.type, 'linear')
  assert.equal(linear.stops.length, 3)
  assert.equal(linear.angle, 90)
  assert.deepEqual(linear.origin, { x: 0.5, y: 0.5 })
  assert.equal(linear.spread, 1.0)
  assert.equal(linear.focalLength, 0.0)
  validateGradient(linear)

  const radial = createDefaultGradient('radial')
  assert.equal(radial.type, 'radial')
  validateGradient(radial)

  const angular = createDefaultGradient('angular')
  assert.equal(angular.type, 'angular')
  validateGradient(angular)
})

test('validateGradient rejects malformed gradients', () => {
  assert.throws(() => validateGradient(null), /Invalid gradient/)
  assert.throws(() => validateGradient({ type: 'unknown' }), /Invalid gradient type/)
  assert.throws(() => validateGradient({ type: 'linear', stops: [] }), /between 2 and 16/)
  assert.throws(() => validateGradient({
    type: 'linear',
    stops: [{ id: 's1', offset: 0, color: '#fff' }],
  }), /between 2 and 16/)
  assert.throws(() => validateGradient({
    type: 'linear',
    stops: [
      { id: 's1', offset: -0.5, color: '#fff' },
      { id: 's2', offset: 1, color: '#000' },
    ],
    angle: 0,
    origin: { x: 0.5, y: 0.5 },
    focalLength: 0,
    spread: 1,
  }), /offset must be between 0 and 1/)
})

test('freezeGradient guarantees immutability', () => {
  const grad = createDefaultGradient('linear')
  const frozen = freezeGradient(grad)
  assert.ok(Object.isFrozen(frozen))
  assert.ok(Object.isFrozen(frozen.stops))
  assert.ok(Object.isFrozen(frozen.stops[0]))
  assert.ok(Object.isFrozen(frozen.origin))
})

test('gradientToCSS produces standards-compliant linear, radial, and conic gradients', () => {
  const linear = createDefaultGradient('linear')
  const linearCss = gradientToCSS(linear)
  assert.ok(linearCss.startsWith('linear-gradient(90deg,'))
  assert.ok(linearCss.includes('rgba('))

  const radial = { ...linear, type: 'radial' }
  const radialCss = gradientToCSS(radial)
  assert.ok(radialCss.startsWith('radial-gradient('))
  assert.ok(radialCss.includes('at 50.0% 50.0%'))

  const angular = { ...linear, type: 'angular' }
  const angularCss = gradientToCSS(angular)
  assert.ok(angularCss.startsWith('conic-gradient('))
  assert.ok(angularCss.includes('from 90deg at 50.0% 50.0%'))
})

test('gradientUniforms generates 16-slot WebGL shader uniforms', () => {
  const grad = createDefaultGradient('linear')
  const shaderPaint = gradientToShaderPaint(grad)
  assert.equal(shaderPaint.kind, 'multi-stop-gradient')

  validateShader(shaderPaint)
  const uniforms = gradientUniforms(shaderPaint)

  assert.equal(uniforms.u_gradientType, 0.0) // linear
  assert.equal(uniforms.u_stopCount, 3)
  assert.equal(uniforms.u_stopOffsets.length, 16)
  assert.equal(uniforms.u_stopColors.length, 16)
  assert.ok(typeof uniforms.u_angle === 'number')
  assert.deepEqual(uniforms.u_origin, [0.5, 0.5])
  assert.equal(uniforms.u_spread, 1.0)
  assert.equal(uniforms.u_dither, 0.25)
  assert.equal(uniforms.u_smoothness, 0.5)
})

test('color stop operations: add, update, remove, reverse, interpolate', () => {
  let grad = createDefaultGradient('linear')
  assert.equal(grad.stops.length, 3)

  // Add stop
  const { gradient: addedGrad, newStopId } = addGradientStop(grad, 0.25)
  assert.equal(addedGrad.stops.length, 4)
  assert.ok(addedGrad.stops.some(s => s.id === newStopId))
  assert.ok(Object.isFrozen(addedGrad))

  // Update stop
  const updatedGrad = updateGradientStop(addedGrad, newStopId, { color: '#ff0000', opacity: 0.8 })
  const updatedStop = updatedGrad.stops.find(s => s.id === newStopId)
  assert.equal(updatedStop?.color, '#ff0000')
  assert.equal(updatedStop?.opacity, 0.8)

  // Remove stop
  const removedGrad = removeGradientStop(updatedGrad, newStopId)
  assert.equal(removedGrad.stops.length, 3)
  assert.ok(!removedGrad.stops.some(s => s.id === newStopId))

  // Reversing stops
  const reversed = reverseGradientStops(grad)
  assert.equal(reversed.stops[0].offset, 0)
  assert.equal(reversed.stops[reversed.stops.length - 1].offset, 1)

  // Interpolation check
  const midColor = interpolateGradientColor(grad.stops, 0.5)
  assert.equal(typeof midColor, 'string')
  assert.ok(midColor.startsWith('#'))
})

test('GRADIENT_PRESETS are valid and complete', () => {
  assert.ok(GRADIENT_PRESETS.length >= 6)
  for (const preset of GRADIENT_PRESETS) {
    assert.ok(preset.id)
    assert.ok(preset.name)
    assert.ok(['linear', 'radial', 'angular'].includes(preset.type))
    assert.ok(preset.stops.length >= 2)
  }
})

test('exportGradientReact outputs valid WebGL Shader component code', () => {
  const grad = createDefaultGradient('radial')
  const shaderPaint = gradientToShaderPaint(grad)
  const code = exportShaderSource(shaderPaint)
  assert.ok(code.includes("import { ShaderMount } from '@paper-design/shaders-react'"))
  assert.ok(code.includes('u_gradientType'))
  assert.ok(code.includes('u_stopOffsets'))
  assert.ok(code.includes('export default function Material()'))
})

test('SceneStore integrates multi-stop gradient with transactional undo/redo', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'rect1', width: 200, height: 120 })

  const grad = createDefaultGradient('linear')
  store.beginTransaction('Apply gradient')
  store.update('rect1', 'rectangle', {
    style: {
      ...store.getSnapshot().elements.rect1.style,
      gradient: grad,
    },
  })
  store.endTransaction()

  let el = store.getSnapshot().elements.rect1
  assert.ok(el.style.gradient)
  assert.equal(el.style.gradient.type, 'linear')

  // Undo
  store.undo()
  el = store.getSnapshot().elements.rect1
  assert.equal(el.style.gradient, undefined)

  // Redo
  store.redo()
  el = store.getSnapshot().elements.rect1
  assert.ok(el.style.gradient)
  assert.equal(el.style.gradient.type, 'linear')
})

test('gradientState reactive store notifies subscribers', () => {
  let callCount = 0
  const unsubscribe = subscribeGradientState(() => {
    callCount++
  })

  setActiveGradientStopId('stop-test-1')
  assert.equal(getActiveGradientStopId(), 'stop-test-1')
  assert.ok(callCount >= 1)

  setActiveGradientHandle('angle')
  assert.equal(getActiveGradientHandle(), 'angle')
  assert.ok(callCount >= 2)

  setActiveGradientStopId(null)
  setActiveGradientHandle(null)

  unsubscribe()
  const prevCount = callCount
  setActiveGradientStopId('stop-test-2')
  assert.equal(callCount, prevCount)
})
