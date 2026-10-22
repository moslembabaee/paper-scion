import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'
import {
  createDefaultStateMachine,
  validateStateMachine,
  findStateTransition,
  resolveNextState,
  DEFAULT_INTERACTIVE_STATES,
  DEFAULT_STATE_TRIGGERS,
  normalizeTrigger,
} from '../src/scene/stateMachine.ts'
import { projectSchema, validateSchema } from '../src/mcp/schema.ts'
import { createProject } from '../src/io/project.ts'

function setupButtonMaster() {
  const store = new SceneStore()
  store.add('frame', { id: 'btn', name: 'Button', x: 100, y: 100, width: 200, height: 50 })
  store.add('rectangle', {
    id: 'btn-bg',
    parentId: 'btn',
    name: 'Background',
    x: 0,
    y: 0,
    width: 200,
    height: 50,
    cornerRadius: 6,
    style: { fill: '#3b82f6', stroke: { color: '#1d4ed8', width: 1, dash: [] }, opacity: 1 },
  })
  store.add('text', {
    id: 'btn-label',
    parentId: 'btn',
    name: 'Label',
    text: 'Submit',
    x: 20,
    y: 15,
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 500,
    letterSpacing: 0,
    lineHeight: 1.2,
    style: { fill: '#ffffff', stroke: null, opacity: 1 },
  })
  store.createComponent('btn')
  store.clearHistory()
  return store
}

test('variant state matrix with default, hover, active, focused, disabled states', () => {
  const store = setupButtonMaster()

  // Apply state preset dimension to master component
  store.applyVariantMatrixPreset('btn', 'state')

  const master = store.getSnapshot().elements.btn
  assert.ok(master.component.variantMatrix)
  const stateDim = master.component.variantMatrix.dimensions.find(d => d.name === 'State')
  assert.ok(stateDim)
  assert.deepEqual(stateDim.values, ['default', 'hover', 'pressed', 'active', 'focused', 'disabled'])

  // Check combinations exist for all 5 required states
  for (const requiredState of ['default', 'hover', 'active', 'focused', 'disabled']) {
    const comb = master.component.variantMatrix.combinations.find(c => c.dimensions.State === requiredState)
    assert.ok(comb, `Combination for state '${requiredState}' must exist`)
  }

  // Create an instance and verify state switching through all 5 states
  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })
  const getLayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component.sourceId === sourceId)

  // Default state
  assert.equal(getLayer('btn-bg').style.fill, '#3b82f6')
  assert.equal(getLayer('btn-bg').style.opacity, 1)

  // Hover state (decreased opacity)
  store.setComponentProperty(inst.id, 'State', 'hover')
  assert.ok(getLayer('btn-bg').style.opacity < 1)

  // Active state (accented stroke)
  store.setComponentProperty(inst.id, 'State', 'active')
  assert.equal(getLayer('btn-bg').style.stroke.color, '#81adec')
  assert.equal(getLayer('btn-bg').style.stroke.width, 2)

  // Focused state (focus ring stroke)
  store.setComponentProperty(inst.id, 'State', 'focused')
  assert.equal(getLayer('btn-bg').style.stroke.color, '#81adec')
  assert.deepEqual(getLayer('btn-bg').style.stroke.dash, [2, 2])

  // Disabled state (muted opacity 0.4)
  store.setComponentProperty(inst.id, 'State', 'disabled')
  assert.equal(getLayer('btn-bg').style.opacity, 0.4)
})

test('state machine engine with focus/blur and spring physics transitions', () => {
  const machine = createDefaultStateMachine(['default', 'hover', 'active', 'focused', 'disabled'])
  assert.equal(machine.initial, 'default')
  assert.deepEqual(machine.states, ['default', 'hover', 'active', 'focused', 'disabled'])

  // Focus transitions
  const focusTransition = findStateTransition(machine, 'default', 'on-focus')
  assert.ok(focusTransition)
  assert.equal(focusTransition.targetState, 'focused')
  assert.ok(focusTransition.spring.stiffness > 0)

  const blurTransition = findStateTransition(machine, 'focused', 'on-blur')
  assert.ok(blurTransition)
  assert.equal(blurTransition.targetState, 'default')

  // Hover and click transitions
  const hoverTransition = findStateTransition(machine, 'default', 'on-hover')
  assert.ok(hoverTransition)
  assert.equal(hoverTransition.targetState, 'hover')

  const hoverEndTransition = findStateTransition(machine, 'hover', 'on-hover-end')
  assert.ok(hoverEndTransition)
  assert.equal(hoverEndTransition.targetState, 'default')

  const clickTransition = findStateTransition(machine, 'focused', 'on-click')
  assert.ok(clickTransition)
  assert.equal(clickTransition.targetState, 'active')

  // Triggers normalization
  assert.equal(normalizeTrigger('focus'), 'on-focus')
  assert.equal(normalizeTrigger('blur'), 'on-blur')
  assert.equal(normalizeTrigger('on-focus'), 'on-focus')
  assert.equal(normalizeTrigger('on-blur'), 'on-blur')
})

test('generateInteractiveStates creates 5-state matrix with micro-interactions', () => {
  const store = setupButtonMaster()
  store.generateInteractiveStates('btn', ['default', 'hover', 'active', 'focused', 'disabled'])

  const master = store.getSnapshot().elements.btn
  assert.ok(master.component.stateMachine)
  assert.deepEqual(master.component.stateMachine.states, ['default', 'hover', 'active', 'focused', 'disabled'])

  const stateProp = master.component.properties.find(p => p.kind === 'variant' && p.name === 'State')
  assert.ok(stateProp)
  assert.equal(stateProp.options.length, 5)
  assert.deepEqual(stateProp.options.map(o => o.value), ['default', 'hover', 'active', 'focused', 'disabled'])

  // Test instance activeState transition without history pollution
  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })
  store.clearHistory()

  store.setComponentActiveState(inst.id, 'focused', false)
  assert.equal(store.getSnapshot().elements[inst.id].component.activeState, 'focused')
  assert.equal(store.history.getSnapshot().canUndo, false)

  store.setComponentActiveState(inst.id, null, false)
  assert.equal(store.getSnapshot().elements[inst.id].component.activeState, undefined)
  assert.equal(store.history.getSnapshot().canUndo, false)
})

test('visual property overrides (fills, strokes, typography, opacity, nested layer visibility) on instance', () => {
  const store = setupButtonMaster()
  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })

  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)

  const instBg = getSublayer('btn-bg')
  const instLabel = getSublayer('btn-label')

  // 1. Fill override
  store.update(instBg.id, 'rectangle', { style: { fill: '#10b981' } })
  assert.equal(getSublayer('btn-bg').style.fill, '#10b981')

  // 2. Stroke override (color, width, dash)
  store.update(instBg.id, 'rectangle', {
    style: { stroke: { color: '#047857', width: 3, dash: [4, 4] } },
  })
  assert.equal(getSublayer('btn-bg').style.stroke.color, '#047857')
  assert.equal(getSublayer('btn-bg').style.stroke.width, 3)
  assert.deepEqual(getSublayer('btn-bg').style.stroke.dash, [4, 4])

  // 3. Opacity override
  store.update(instBg.id, 'rectangle', { style: { opacity: 0.85 } })
  assert.equal(getSublayer('btn-bg').style.opacity, 0.85)

  // 4. Typography overrides (fontFamily, fontSize, fontWeight, letterSpacing, text)
  store.update(instLabel.id, 'text', {
    text: 'Click Here Now',
    fontFamily: 'JetBrains Mono',
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: 1.5,
  })
  const updatedLabel = getSublayer('btn-label')
  assert.equal(updatedLabel.text, 'Click Here Now')
  assert.equal(updatedLabel.fontFamily, 'JetBrains Mono')
  assert.equal(updatedLabel.fontSize, 20)
  assert.equal(updatedLabel.fontWeight, 700)
  assert.equal(updatedLabel.letterSpacing, 1.5)

  // 5. Nested layer visibility override (hide label without deleting layer)
  store.setVisible(instLabel.id, false)
  assert.equal(getSublayer('btn-label').visible, false)
  assert.equal(store.isVisible(instLabel.id), false)

  // Verify sync status tracks all modified channels
  const syncStatus = store.getInstanceSyncStatus(inst.id)
  assert.equal(syncStatus.isSynced, false)
  assert.ok(syncStatus.overrideCount >= 5)
  assert.ok(syncStatus.modifiedChannels.includes('style.fill'))
  assert.ok(syncStatus.modifiedChannels.includes('style.stroke'))
  assert.ok(syncStatus.modifiedChannels.includes('style.opacity'))
  assert.ok(syncStatus.modifiedChannels.includes('properties.text'))
  assert.ok(syncStatus.modifiedChannels.includes('properties.fontSize'))
  assert.ok(syncStatus.modifiedChannels.includes('properties.visible'))

  // Reset visibility override restores layer to visible
  store.resetPropertyOverride(instLabel.id, 'visible')
  assert.equal(getSublayer('btn-label').visible, true)

  // Reset fill override restores master fill
  store.resetPropertyOverride(instBg.id, 'style.fill')
  assert.equal(getSublayer('btn-bg').style.fill, '#3b82f6') // restored to master fill!
  assert.equal(getSublayer('btn-bg').style.stroke.color, '#047857') // stroke still overridden!
})

test('real-time propagation of un-overridden structural updates: adding layers to master', () => {
  const store = setupButtonMaster()

  // Create two instances of the Button component
  const inst1 = store.createComponentInstance('btn', { x: 400, y: 100 })
  const inst2 = store.createComponentInstance('btn', { x: 700, y: 100 })

  const getSublayer1 = sourceId =>
    subtree(store.getSnapshot().elements, inst1.id).find(n => n.component?.sourceId === sourceId)
  const getSublayer2 = sourceId =>
    subtree(store.getSnapshot().elements, inst2.id).find(n => n.component?.sourceId === sourceId)

  // Instance 1 overrides background fill; Instance 2 overrides label text
  store.update(getSublayer1('btn-bg').id, 'rectangle', { style: { fill: '#ec4899' } })
  store.update(getSublayer2('btn-label').id, 'text', { text: 'Custom Text 2' })

  // Now, structurally add a new child layer (an Icon) to the master component frame
  const newIcon = store.add('ellipse', {
    id: 'btn-icon',
    parentId: 'btn',
    name: 'Icon',
    x: 160,
    y: 15,
    width: 20,
    height: 20,
    style: { fill: '#ffffff', stroke: null, opacity: 1 },
  })

  // The new layer must propagate IMMEDIATELY in real time to both instances!
  const inst1Icon = getSublayer1('btn-icon')
  const inst2Icon = getSublayer2('btn-icon')

  assert.ok(inst1Icon, 'Instance 1 must have received new child layer from master')
  assert.ok(inst2Icon, 'Instance 2 must have received new child layer from master')
  assert.equal(inst1Icon.type, 'ellipse')
  assert.equal(inst1Icon.width, 20)
  assert.equal(inst1Icon.height, 20)
  assert.equal(inst1Icon.style.fill, '#ffffff')
  assert.equal(inst2Icon.style.fill, '#ffffff')

  // Both instances must have their parent frame children array updated
  const inst1Root = store.getSnapshot().elements[inst1.id]
  const inst2Root = store.getSnapshot().elements[inst2.id]
  assert.ok(inst1Root.children.includes(inst1Icon.id))
  assert.ok(inst2Root.children.includes(inst2Icon.id))

  // And the local overrides on other layers remain intact!
  assert.equal(getSublayer1('btn-bg').style.fill, '#ec4899') // preserved override!
  assert.equal(getSublayer2('btn-label').text, 'Custom Text 2') // preserved override!
})

test('real-time propagation of un-overridden structural updates: deleting layers from master', () => {
  const store = setupButtonMaster()

  // Add an extra indicator badge layer to master
  store.add('rectangle', {
    id: 'btn-badge',
    parentId: 'btn',
    name: 'Badge',
    x: 170,
    y: 5,
    width: 12,
    height: 12,
    style: { fill: '#ef4444' },
  })

  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)

  assert.ok(getSublayer('btn-badge'), 'Instance should initially have badge')

  // Override background fill on instance
  store.update(getSublayer('btn-bg').id, 'rectangle', { style: { fill: '#8b5cf6' } })

  // Delete the badge from master component
  store.remove('btn-badge')

  // The badge layer must be deleted from the instance automatically
  assert.equal(getSublayer('btn-badge'), undefined, 'Badge must be removed from instance')
  const instRoot = store.getSnapshot().elements[inst.id]
  assert.equal(instRoot.children.length, 2) // bg and label remain

  // The background fill override is preserved
  assert.equal(getSublayer('btn-bg').style.fill, '#8b5cf6')
})

test('real-time propagation of un-overridden property changes alongside local overrides', () => {
  const store = setupButtonMaster()
  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })

  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)

  // Instance overrides ONLY the fill of btn-bg, but NOT its stroke or cornerRadius
  store.update(getSublayer('btn-bg').id, 'rectangle', { style: { fill: '#fbbf24' } })

  // Instance overrides text of btn-label, but NOT its fontSize, fontWeight, or font
  store.update(getSublayer('btn-label').id, 'text', { text: 'Custom Label' })

  // Now master updates stroke width on btn-bg and fontSize on btn-label
  store.update('btn-bg', 'rectangle', {
    cornerRadius: 16,
    style: { stroke: { color: '#000000', width: 4, dash: [2, 2] } },
  })
  store.update('btn-label', 'text', {
    fontSize: 24,
    fontWeight: 900,
  })

  // Verify real-time propagation to instance:
  const updatedBg = getSublayer('btn-bg')
  const updatedLabel = getSublayer('btn-label')

  // Overridden properties stay intact:
  assert.equal(updatedBg.style.fill, '#fbbf24', 'Overridden fill must not be overwritten by master')
  assert.equal(updatedLabel.text, 'Custom Label', 'Overridden text must not be overwritten by master')

  // Un-overridden properties reflect master changes in real time:
  assert.equal(updatedBg.cornerRadius, 16, 'Corner radius must propagate from master')
  assert.equal(updatedBg.style.stroke.width, 4, 'Stroke width must propagate from master')
  assert.equal(updatedBg.style.stroke.color, '#000000', 'Stroke color must propagate from master')
  assert.deepEqual(updatedBg.style.stroke.dash, [2, 2], 'Stroke dash must propagate from master')

  assert.equal(updatedLabel.fontSize, 24, 'Font size must propagate from master')
  assert.equal(updatedLabel.fontWeight, 900, 'Font weight must propagate from master')
})

test('nested layer visibility override persists across master updates and restores cleanly', () => {
  const store = setupButtonMaster()
  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })

  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)

  // Hide the label layer in the instance
  store.setVisible(getSublayer('btn-label').id, false)
  assert.equal(getSublayer('btn-label').visible, false)

  // Master updates label text and background fill
  store.update('btn-label', 'text', { text: 'Updated Master Text' })
  store.update('btn-bg', 'rectangle', { style: { fill: '#1e293b' } })

  // Instance label is STILL hidden (override preserved!), but has received the text update
  const hiddenLabel = getSublayer('btn-label')
  assert.equal(hiddenLabel.visible, false, 'Visibility override must be preserved')
  assert.equal(hiddenLabel.text, 'Updated Master Text', 'Un-overridden text must still update')
  assert.equal(getSublayer('btn-bg').style.fill, '#1e293b', 'Background fill must propagate')

  // Restoring visibility through setVisible
  store.setVisible(hiddenLabel.id, true)
  assert.equal(getSublayer('btn-label').visible, true)
})

test('variant state matrix and instance overrides roundtrip through project serialization', () => {
  const store = setupButtonMaster()
  store.generateInteractiveStates('btn', ['default', 'hover', 'active', 'focused', 'disabled'])
  store.applyVariantMatrixPreset('btn', 'state')

  const inst = store.createComponentInstance('btn', { x: 400, y: 100 })
  store.setComponentProperty(inst.id, 'State', 'focused')

  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)
  store.update(getSublayer('btn-label').id, 'text', { text: 'Serialized Override' })
  store.update(getSublayer('btn-bg').id, 'rectangle', { style: { fill: '#ec4899' } })

  // Serialize to project schema and validate
  const project = createProject(store, 'Variant Matrix & Overrides', { x: 0, y: 0, zoom: 1 }, true)
  assert.doesNotThrow(() => validateSchema(project, projectSchema))

  // Restore into a new store
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(project.scene)))

  const restoredMaster = restored.getSnapshot().elements.btn
  assert.ok(restoredMaster.component.stateMachine)
  assert.deepEqual(restoredMaster.component.stateMachine.states, [
    'default',
    'hover',
    'active',
    'focused',
    'disabled',
  ])
  assert.ok(restoredMaster.component.variantMatrix)

  const restoredInst = restored.getSnapshot().elements[inst.id]
  assert.ok(restoredInst)
  const stateProp = restoredMaster.component.properties?.find(p => p.name === 'State')
  const stateVal = restoredInst.component.propertyValues[stateProp ? stateProp.id : 'State'] ?? restoredInst.component.propertyValues.State
  assert.equal(stateVal, 'focused')

  const restoredGetSublayer = sourceId =>
    subtree(restored.getSnapshot().elements, inst.id).find(n => n.component?.sourceId === sourceId)
  assert.equal(restoredGetSublayer('btn-label').text, 'Serialized Override')
  assert.equal(restoredGetSublayer('btn-bg').style.fill, '#ec4899')
})
