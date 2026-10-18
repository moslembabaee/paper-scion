import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'
import {
  createDefaultStateMachine,
  validateStateMachine,
  findStateTransition,
  findDelayedTransition,
  normalizeTrigger,
  resolveNextState,
  getEffectiveStateMachine,
} from '../src/scene/stateMachine.ts'
import { projectSchema, validateSchema } from '../src/mcp/schema.ts'
import { createProject } from '../src/io/project.ts'

function setupButtonComponent() {
  const store = new SceneStore()
  store.add('frame', { id: 'btn', width: 200, height: 60, style: { fill: '#080808' } })
  store.add('text', { id: 'btn-label', parentId: 'btn', text: 'Click me' })
  store.createComponent('btn')
  return { store }
}

test('createDefaultStateMachine creates valid states and spring transitions', () => {
  const machine = createDefaultStateMachine(['default', 'hover', 'pressed', 'active'])
  assert.equal(machine.initial, 'default')
  assert.deepEqual(machine.states, ['default', 'hover', 'pressed', 'active'])
  assert.ok(machine.transitions.length >= 4)

  // Verify transition triggers and target states
  const hoverTrans = findStateTransition(machine, 'default', 'on-hover')
  assert.ok(hoverTrans)
  assert.equal(hoverTrans.targetState, 'hover')
  assert.equal(hoverTrans.spring.stiffness, 220)
  assert.equal(hoverTrans.spring.damping, 24)
  assert.equal(hoverTrans.spring.mass, 1)

  const pressTrans = findStateTransition(machine, 'hover', 'while-pressed')
  assert.ok(pressTrans)
  assert.equal(pressTrans.targetState, 'pressed')
  assert.equal(pressTrans.spring.stiffness, 350)

  const clickTrans = findStateTransition(machine, 'pressed', 'on-click')
  assert.ok(clickTrans)
  assert.equal(clickTrans.targetState, 'active')

  const resetTrans = findStateTransition(machine, 'active', 'on-click')
  assert.ok(resetTrans)
  assert.equal(resetTrans.targetState, 'default')
})

test('validateStateMachine validates and rejects malformed machines', () => {
  const valid = createDefaultStateMachine()
  assert.doesNotThrow(() => validateStateMachine(valid))

  // Missing initial or invalid initial
  assert.throws(() => validateStateMachine({ ...valid, initial: 'nonexistent' }))
  // Empty states
  assert.throws(() => validateStateMachine({ ...valid, states: [] }))
  // Duplicate state names
  assert.throws(() => validateStateMachine({ ...valid, states: ['default', 'default'] }))
  // Invalid trigger
  assert.throws(() =>
    validateStateMachine({
      ...valid,
      transitions: [{ id: 't1', fromState: 'default', trigger: 'invalid-trigger', targetState: 'hover', spring: { stiffness: 100, damping: 10, mass: 1 } }],
    })
  )
  // Invalid spring physics
  assert.throws(() =>
    validateStateMachine({
      ...valid,
      transitions: [{ id: 't1', fromState: 'default', trigger: 'on-hover', targetState: 'hover', spring: { stiffness: -10, damping: 10, mass: 1 } }],
    })
  )
  // State not in allowed list
  assert.throws(() => validateStateMachine(valid, ['default', 'hover']))
})

test('resolveNextState advances state along defined transitions', () => {
  const machine = createDefaultStateMachine()
  const step1 = resolveNextState(machine, 'default', 'on-hover')
  assert.equal(step1?.targetState, 'hover')

  const step2 = resolveNextState(machine, 'hover', 'while-pressed')
  assert.equal(step2?.targetState, 'pressed')

  const step3 = resolveNextState(machine, 'pressed', 'on-click')
  assert.equal(step3?.targetState, 'active')

  const step4 = resolveNextState(machine, 'active', 'on-click')
  assert.equal(step4?.targetState, 'default')

  // Unhandled trigger returns null
  assert.equal(resolveNextState(machine, 'default', 'while-pressed'), null)
})

test('generateInteractiveStates configures master component with variants and state machine', () => {
  const { store } = setupButtonComponent()
  store.generateInteractiveStates('btn')

  const master = store.getSnapshot().elements.btn
  assert.equal(master.component?.kind, 'master')
  assert.ok(master.component.stateMachine)
  assert.deepEqual(master.component.stateMachine.states, ['default', 'hover', 'pressed', 'active'])

  const stateProp = master.component.properties?.find(p => p.kind === 'variant' && p.name === 'State')
  assert.ok(stateProp && stateProp.kind === 'variant')
  assert.equal(stateProp.options.length, 4)
  assert.deepEqual(stateProp.options.map(o => o.value), ['default', 'hover', 'pressed', 'active'])

  // Create an instance
  const instance = store.createComponentInstance('btn')
  const layer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(node => node.component.sourceId === sourceId)

  // Default state: fill is initial master fill
  assert.equal(layer('btn').style.fill, '#080808')

  // Switch to active state
  store.setComponentActiveState(instance.id, 'active')
  assert.equal(store.getSnapshot().elements[instance.id].component.activeState, 'active')
  // Active state adds stroke #81adec
  assert.equal(layer('btn').style.stroke?.color, '#81adec')

  // Switch to hover state
  store.setComponentActiveState(instance.id, 'hover')
  assert.equal(store.getSnapshot().elements[instance.id].component.activeState, 'hover')
  assert.ok(layer('btn').style.opacity !== undefined)

  // Reset to default
  store.setComponentActiveState(instance.id, null)
  assert.equal(store.getSnapshot().elements[instance.id].component.activeState, undefined)

  // Roundtrip persistence
  const json = JSON.parse(JSON.stringify(store.toJSON()))
  const restored = new SceneStore()
  restored.load(json)
  assert.deepEqual(restored.toJSON(), store.toJSON())
})

test('setComponentActiveState with recordHistory=false updates state without history pollution', () => {
  const { store } = setupButtonComponent()
  store.generateInteractiveStates('btn')
  const instance = store.createComponentInstance('btn')
  store.clearHistory()

  // Preview interactive state (canvas hover/press simulation)
  store.setComponentActiveState(instance.id, 'hover', false)
  assert.equal(store.getSnapshot().elements[instance.id].component.activeState, 'hover')
  // History should remain empty
  assert.equal(store.history.getSnapshot().canUndo, false)

  // Restore
  store.setComponentActiveState(instance.id, null, false)
  assert.equal(store.getSnapshot().elements[instance.id].component.activeState, undefined)
  assert.equal(store.history.getSnapshot().canUndo, false)
})

test('component state machine satisfies published MCP project schema', () => {
  const { store } = setupButtonComponent()
  store.generateInteractiveStates('btn')
  const instance = store.createComponentInstance('btn')
  store.setComponentActiveState(instance.id, 'hover')

  const project = createProject(store, 'State Machine Test', { x: 0, y: 0, zoom: 1 }, true)
  assert.doesNotThrow(() => validateSchema(project, projectSchema))
})

test('normalizeTrigger maps various trigger formats safely', () => {
  assert.equal(normalizeTrigger('click'), 'on-click')
  assert.equal(normalizeTrigger('on-click'), 'on-click')
  assert.equal(normalizeTrigger('hover'), 'on-hover')
  assert.equal(normalizeTrigger('pointerdown'), 'on-pointerdown')
  assert.equal(normalizeTrigger('on-pointerdown'), 'on-pointerdown')
  assert.equal(normalizeTrigger('pointerup'), 'on-pointerup')
  assert.equal(normalizeTrigger('hover-end'), 'on-hover-end')
  assert.equal(normalizeTrigger('leave'), 'on-hover-end')
  assert.equal(normalizeTrigger('delay'), 'after-delay')
  assert.equal(normalizeTrigger('after-delay'), 'after-delay')
  assert.equal(normalizeTrigger('unknown-trigger'), undefined)
})

test('transitions support delay parameter and after-delay triggers', () => {
  const machine = validateStateMachine({
    initial: 'default',
    states: ['default', 'hover', 'active'],
    transitions: [
      {
        id: 't-hover',
        fromState: 'default',
        trigger: 'on-hover',
        targetState: 'hover',
        spring: { stiffness: 200, damping: 20, mass: 1 },
      },
      {
        id: 't-delay',
        fromState: 'hover',
        trigger: 'after-delay',
        targetState: 'active',
        delay: 500,
        spring: { stiffness: 180, damping: 18, mass: 1 },
      },
    ],
  })

  const delayed = findDelayedTransition(machine, 'hover')
  assert.ok(delayed)
  assert.equal(delayed.targetState, 'active')
  assert.equal(delayed.delay, 500)

  // Non-delayed state returns undefined
  assert.equal(findDelayedTransition(machine, 'default'), undefined)

  // Rejects negative or non-number delays
  assert.throws(() =>
    validateStateMachine({
      initial: 'default',
      states: ['default', 'hover'],
      transitions: [
        {
          id: 't-invalid-delay',
          fromState: 'default',
          trigger: 'after-delay',
          targetState: 'hover',
          delay: -100,
          spring: { stiffness: 200, damping: 20, mass: 1 },
        },
      ],
    })
  )
})

test('resolveNextState supports on-pointerdown and while-pressed fallback', () => {
  const machine = createDefaultStateMachine()
  // By default, createDefaultStateMachine defines while-pressed from hover to pressed
  const stepPointerDown = resolveNextState(machine, 'hover', 'on-pointerdown')
  assert.ok(stepPointerDown)
  assert.equal(stepPointerDown.targetState, 'pressed')

  const stepWhilePressed = resolveNextState(machine, 'hover', 'while-pressed')
  assert.ok(stepWhilePressed)
  assert.equal(stepWhilePressed.targetState, 'pressed')
})

