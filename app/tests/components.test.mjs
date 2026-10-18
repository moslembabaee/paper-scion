import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'
import { parseProject, createProject, serializeProject } from '../src/io/project.ts'

const setup = () => {
  const store = new SceneStore()
  store.add('frame', { id: 'card', name: 'Card', width: 240, height: 120, x: 120, y: 240 })
  store.add('rectangle', { id: 'surface', parentId: 'card', width: 240, height: 120, style: { fill: '#81adec', stroke: { color: '#080808', width: 1, dash: [] } } })
  store.add('text', { id: 'label', parentId: 'card', text: 'Original', x: 24, y: 24 })
  store.createComponent('card')
  const instance = store.createComponentInstance('card', { x: 600, y: 240 })
  const source = id => subtree(store.getSnapshot().elements, instance.id).find(node => node.component.sourceId === id)
  store.clearHistory()
  return { store, instance, source }
}
const assertValid = store => {
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
}

test('frame and primitive masters create independent instance IDs and inherit source properties', () => {
  const { store, instance, source } = setup()
  assert.equal(instance.component.kind, 'instance')
  assert.notEqual(source('surface').id, 'surface')
  assert.equal(source('label').parentId, instance.id)
  store.update('card', 'frame', { x: 300, rotation: 15, width: 480 })
  assert.equal(store.getSnapshot().elements[instance.id].x, 600)
  assert.equal(store.getSnapshot().elements[instance.id].rotation, 0)
  assert.equal(store.getSnapshot().elements[instance.id].width, 480)
  store.add('ellipse', { id: 'dot' })
  store.createComponent('dot')
  const dot = store.createComponentInstance('dot')
  store.update('dot', 'ellipse', { style: { opacity: .4 } })
  assert.equal(store.getSnapshot().elements[dot.id].style.opacity, .4)
  assertValid(store)
})

test('fill, stroke channels, opacity and text overrides survive independent master updates', () => {
  const { store, source } = setup()
  store.update(source('surface').id, 'rectangle', { style: { fill: '#edebe1', stroke: { ...source('surface').style.stroke, color: '#81adec' }, opacity: .5 } })
  store.update(source('label').id, 'text', { text: 'Local copy' })
  store.update('surface', 'rectangle', { cornerRadius: 16, style: { fill: '#222222', stroke: { color: '#edebe1', width: 4, dash: [2, 3] }, opacity: .8 } })
  store.update('label', 'text', { text: 'New master copy', fontSize: 20 })
  assert.equal(source('surface').style.fill, '#edebe1')
  assert.equal(source('surface').style.opacity, .5)
  assert.deepEqual(source('surface').style.stroke, { color: '#81adec', width: 4, dash: [2, 3] })
  assert.equal(source('surface').cornerRadius, 16)
  assert.equal(source('label').text, 'Local copy')
  assert.equal(source('label').fontSize, 20)
  assert.equal(store.getSnapshot().elements.label.text, 'New master copy')
  assertValid(store)
})

test('null paints and zero opacity are valid overrides; reset uses the latest master', () => {
  const { store, instance, source } = setup()
  store.update(source('surface').id, 'rectangle', { style: { fill: null, stroke: null, opacity: 0 } })
  store.update(source('label').id, 'text', { text: '' })
  store.update(instance.id, 'frame', { x: 720, width: 360, rotation: 30 })
  store.update('surface', 'rectangle', { style: { fill: '#222222', opacity: .7 } })
  assert.equal(source('surface').style.fill, null)
  assert.equal(source('surface').style.stroke, null)
  assert.equal(source('surface').style.opacity, 0)
  store.resetComponentOverrides(source('surface').id)
  assert.equal(source('surface').style.fill, '#222222')
  assert.equal(source('label').text, '')
  store.resetComponentOverrides(instance.id)
  assert.equal(source('label').text, 'Original')
  assert.equal(store.getSnapshot().elements[instance.id].x, 720)
  assert.equal(store.getSnapshot().elements[instance.id].rotation, 30)
  assert.equal(store.getSnapshot().elements[instance.id].width, 240)
  assertValid(store)
})

test('structural changes synchronize, retain surviving IDs and discard removed selections', () => {
  const { store, instance, source } = setup()
  const surfaceId = source('surface').id
  store.add('frame', { id: 'nested', parentId: 'card' })
  store.add('ellipse', { id: 'dot', parentId: 'nested' })
  assert.equal(source('dot').parentId, source('nested').id)
  store.reparent('label', 'nested')
  assert.equal(source('label').parentId, source('nested').id)
  store.reorder('nested', 0)
  assert.equal(store.getSnapshot().elements[instance.id].children[0], source('nested').id)
  store.select([source('label').id])
  store.remove('nested')
  assert.equal(source('label'), undefined)
  assert.deepEqual(store.getSnapshot().selection, [])
  assert.equal(source('surface').id, surfaceId)
  assertValid(store)
})

test('instance structure and nested components are guarded atomically', () => {
  const { store, instance, source } = setup()
  const before = store.getSnapshot()
  assert.throws(() => store.add('text', { parentId: instance.id }), /Detach/)
  assert.throws(() => store.remove(source('label').id), /Detach/)
  assert.throws(() => store.reparent(source('label').id, null), /Detach/)
  assert.throws(() => store.reorder(source('label').id, 0), /Detach/)
  assert.throws(() => store.createComponent(source('label').id), /existing component/)
  assert.throws(() => store.reparent(instance.id, 'card'), /Nested/)
  assert.throws(() => store.update(instance.id, 'frame', { component: { kind: 'master' } }), /structural/)
  assert.equal(store.getSnapshot(), before)
})

test('detach retains overridden appearance, breaks links and is one undoable edit', () => {
  const { store, instance, source } = setup()
  const id = source('label').id
  store.update(id, 'text', { text: 'Local' })
  const before = store.getSnapshot()
  store.detachComponentInstance(id)
  for (const node of subtree(store.getSnapshot().elements, instance.id)) assert.equal(node.component, undefined)
  assert.equal(store.getSnapshot().elements[id].text, 'Local')
  assert.equal(store.getHistorySnapshot().undoLabel, 'Detach Card instance')
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  store.update('label', 'text', { text: 'Master changed' })
  assert.equal(store.getSnapshot().elements[id].text, 'Local')
  assertValid(store)
})

test('master deletion detaches surviving instances and undo restores all links', () => {
  const { store, instance, source } = setup()
  const labelId = source('label').id
  store.update(labelId, 'text', { text: 'Retained' })
  const before = store.getSnapshot()
  store.remove('card')
  assert.equal(store.getSnapshot().elements[instance.id].component, undefined)
  assert.equal(store.getSnapshot().elements[labelId].text, 'Retained')
  assertValid(store)
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.update('surface', 'rectangle', { style: { fill: '#222222' } })
  assert.equal(source('surface').style.fill, '#222222')
})

test('propagation and reset are atomic history commands, preserving untouched references', () => {
  const { store, instance, source } = setup()
  store.add('ellipse', { id: 'unrelated' })
  const unrelated = store.getSnapshot().elements.unrelated
  let notifications = 0
  store.subscribe(() => notifications++)
  const before = store.getSnapshot()
  store.update('label', 'text', { text: 'Everywhere' })
  assert.equal(notifications, 1)
  assert.equal(source('label').text, 'Everywhere')
  assert.equal(store.getSnapshot().elements.unrelated, unrelated)
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  store.update(source('label').id, 'text', { text: 'Override' })
  const overridden = store.getSnapshot()
  store.resetComponentOverrides(instance.id)
  store.undo()
  assert.equal(store.getSnapshot(), overridden)
  assert.ok(Object.isFrozen(source('label').component.overrides))
  assert.ok(Object.isFrozen(source('label').component.overrides.properties))
})

test('projects round-trip links and overrides; invalid references reject before replacing state', () => {
  const { store, instance, source } = setup()
  store.update(source('label').id, 'text', { text: 'Persist me' })
  const project = parseProject(serializeProject(createProject(store, 'Components', { x: 0, y: 0, zoom: 1 }, true)))
  assert.deepEqual(project.scene, store.toJSON())
  const restored = new SceneStore()
  restored.load(project.scene)
  restored.update('label', 'text', { text: 'Master after reload' })
  assert.equal(restored.getSnapshot().elements[source('label').id].text, 'Persist me')
  const before = store.getSnapshot()
  for (const mutate of [
    doc => { doc.elements[instance.id].component.masterId = 'missing' },
    doc => { doc.elements[source('label').id].component.sourceId = 'surface' },
    doc => { doc.elements[source('label').id].component.overrides.properties = { text: 10 } },
    doc => { doc.elements[source('label').id].component.overrides.properties = { children: [] } },
    doc => { doc.elements[source('surface').id].component.sourceId = 'label' },
    doc => { delete doc.elements[source('label').id].component },
    doc => { doc.elements[source('label').id].component.overrides.tokenBindings = { text: 'missing' } },
    doc => { doc.elements[source('surface').id].component.overrides.tokenBindings = { fill: 12 } },
  ]) {
    const document = JSON.parse(JSON.stringify(store.toJSON()))
    mutate(document)
    assert.throws(() => store.load(document))
    assert.equal(store.getSnapshot(), before)
  }
})

test('tokens on masters propagate while instance token overrides remain independent', () => {
  const { store, instance, source } = setup()
  const brand = store.addToken({ name: 'brand', type: 'color', value: '#81adec' })
  const local = store.addToken({ name: 'local', type: 'color', value: '#edebe1' })
  store.bindToken('surface', 'fill', brand.id)
  store.bindToken(source('surface').id, 'fill', local.id)
  store.updateToken(brand.id, { value: '#222222' })
  assert.equal(source('surface').style.fill, '#edebe1')
  store.updateToken(local.id, { value: '#080808' })
  assert.equal(source('surface').style.fill, '#080808')
  store.update(source('surface').id, 'rectangle', { style: { fill: '#edebe1' } })
  assert.equal(source('surface').style.fill, '#edebe1')
  store.resetComponentOverrides(instance.id)
  assert.equal(source('surface').style.fill, '#222222')
  store.update(source('surface').id, 'rectangle', { style: { fill: '#edebe1' } })
  store.updateToken(brand.id, { value: '#080808' })
  assert.equal(source('surface').style.fill, '#edebe1')
  assertValid(store)
})

test('auto layout and text sizing reflow independently in instances', () => {
  const { store, instance, source } = setup()
  store.update('card', 'frame', { layout: { direction: 'vertical', gap: 12, padding: { top: 24, bottom: 24, left: 24, right: 24 }, align: 'start', justify: 'start' } })
  store.update('surface', 'rectangle', { height: 24 })
  assert.equal(source('label').y, 60)
  store.update('card', 'frame', { layout: { ...store.getSnapshot().elements.card.layout, gap: 24 } })
  assert.equal(source('label').y, 72)
  store.update(source('label').id, 'text', { text: 'Longer local content', sizing: { width: 'hug', height: 'hug' } })
  assert.equal(store.getSnapshot().elements.label.text, 'Original')
  assertValid(store)
  store.resetComponentOverrides(instance.id)
  assert.equal(source('label').text, 'Original')
})

test('direct instance resizing overrides inherited hug sizing and reset restores it', () => {
  const { store, source } = setup()
  store.update('label', 'text', { sizing: { width: 'hug', height: 'hug' } })
  const id = source('label').id
  store.update(id, 'text', { width: 360 })
  assert.equal(source('label').width, 360)
  assert.equal(source('label').sizing.width, 'fixed')
  store.update('label', 'text', { text: 'Master content changes' })
  assert.equal(source('label').width, 360)
  assertValid(store)
  store.resetComponentOverrides(id)
  assert.equal(source('label').sizing.width, 'hug')
  assert.equal(source('label').width, store.getSnapshot().elements.label.width)
})

test('local token bindings leave unrelated master bindings synchronized', () => {
  const { store, source } = setup()
  const local = store.addToken({ name: 'local', type: 'color', value: '#edebe1' })
  const radius = store.addToken({ name: 'radius', type: 'radius', value: 12 })
  store.bindToken(source('surface').id, 'fill', local.id)
  store.bindToken('surface', 'cornerRadius', radius.id)
  assert.equal(source('surface').cornerRadius, 12)
  assert.equal(source('surface').tokenBindings.cornerRadius, radius.id)
  assert.equal(source('surface').style.fill, '#edebe1')
  assert.deepEqual(source('surface').component.overrides.tokenBindings, { fill: local.id })
  store.updateToken(radius.id, { value: 24 })
  assert.equal(source('surface').cornerRadius, 24)
  assertValid(store)
})

test('detaching or deleting a local token retains its current value until reset', () => {
  for (const remove of [false, true]) {
    const { store, source } = setup()
    const master = store.addToken({ name: 'master', type: 'color', value: '#222222' })
    const local = store.addToken({ name: 'local', type: 'color', value: '#edebe1' })
    store.bindToken('surface', 'fill', master.id)
    const id = source('surface').id
    store.bindToken(id, 'fill', local.id)
    if (remove) store.removeTokens([local.id])
    else store.detachToken(id, 'fill')
    assert.equal(source('surface').style.fill, '#edebe1')
    assert.equal(source('surface').tokenBindings.fill, undefined)
    store.updateToken(master.id, { value: '#080808' })
    assert.equal(source('surface').style.fill, '#edebe1')
    assertValid(store)
    store.resetComponentOverrides(id)
    assert.equal(source('surface').style.fill, '#080808')
    assert.equal(source('surface').tokenBindings.fill, master.id)
  }
})

test('an explicit stroke override stays local when a master token temporarily matches it', () => {
  const { store, source } = setup()
  const stroke = store.addToken({ name: 'stroke', type: 'color', value: '#222222' })
  store.bindToken('surface', 'stroke', stroke.id)
  store.update(source('surface').id, 'rectangle', { style: { stroke: { ...source('surface').style.stroke, color: '#edebe1' } } })
  store.updateToken(stroke.id, { value: '#edebe1' })
  assert.equal(source('surface').tokenBindings.stroke, undefined)
  store.updateToken(stroke.id, { value: '#080808' })
  assert.equal(source('surface').style.stroke.color, '#edebe1')
  assertValid(store)
})

test('editing raw path data clears an earlier anchor override', () => {
  const store = new SceneStore()
  store.add('path', { id: 'path' })
  store.createComponent('path')
  const instance = store.createComponentInstance('path')
  const nodes = [{ closed: false, anchors: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }]
  store.update(instance.id, 'path', { nodes })
  store.update(instance.id, 'path', { d: 'M 0 0 L 100 0' })
  const node = store.getSnapshot().elements[instance.id]
  assert.equal(node.nodes, undefined)
  assert.equal(node.d, 'M 0 0 L 100 0')
  assert.equal(node.component.overrides.properties.nodes, undefined)
  assertValid(store)
})

test('boolean source edits on linked instances reject atomically until detached', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a' })
  store.add('rectangle', { id: 'b', x: 60 })
  const master = store.booleanSelection('union', false, ['a', 'b'])
  store.createComponent(master.id)
  const instance = store.createComponentInstance(master.id)
  const before = store.getSnapshot()
  for (const action of [
    () => store.setBooleanOperation(instance.id, 'subtract'),
    () => store.updateBooleanOperand(instance.id, 'a', { x: 24 }),
    () => store.releaseBoolean(instance.id),
    () => store.flattenBoolean(instance.id),
  ]) {
    assert.throws(action, /Detach/)
    assert.equal(store.getSnapshot(), before)
  }
  store.setBooleanOperation(master.id, 'subtract')
  assert.equal(store.getSnapshot().elements[instance.id].boolean.operation, 'subtract')
  store.detachComponentInstance(instance.id)
  store.releaseBoolean(instance.id)
  assertValid(store)
})

test('a local stroke token keeps a stroke enabled after the master removes it', () => {
  const { store, source } = setup()
  const local = store.addToken({ name: 'local-stroke', type: 'color', value: '#edebe1' })
  const id = source('surface').id
  store.bindToken(id, 'stroke', local.id)
  store.update('surface', 'rectangle', { style: { stroke: null } })
  assert.equal(source('surface').style.stroke.color, '#edebe1')
  store.updateToken(local.id, { value: '#81adec' })
  assert.equal(source('surface').style.stroke.color, '#81adec')
  assertValid(store)
  store.resetComponentOverrides(id)
  assert.equal(source('surface').style.stroke, null)
})

test('repeated inserts use available space in 120px steps and explicit placement is respected', () => {
  const { store, instance } = setup()
  const next = store.createComponentInstance('card')
  assert.ok(next.x >= instance.x + instance.width)
  assert.equal((next.x - store.getSnapshot().elements.card.x) % 120, 0)
  const placed = store.createComponentInstance('card', { x: 17, y: 29 })
  assert.equal(placed.x, 17)
  assert.equal(placed.y, 29)
  assertValid(store)
})
