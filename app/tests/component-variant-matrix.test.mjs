import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'

function setupButtonMaster() {
  const store = new SceneStore()
  store.add('frame', { id: 'btn', name: 'Button', x: 120, y: 120, width: 240, height: 60 })
  store.add('rectangle', { id: 'btn-bg', parentId: 'btn', name: 'Background', x: 0, y: 0, width: 240, height: 60, cornerRadius: 8, style: { fill: '#edebe1', stroke: { color: '#080808', width: 1, dash: [] } } })
  store.add('text', { id: 'btn-text', parentId: 'btn', name: 'Label', text: 'Button Text', x: 24, y: 18, fontSize: 16, style: { fill: '#080808' } })
  store.createComponent('btn')
  store.clearHistory()
  return store
}

test('multi-dimensional variant dimensions can be added, updated, and removed on master', () => {
  const store = setupButtonMaster()
  const master = store.getSnapshot().elements.btn

  assert.equal(master.component.variantMatrix, undefined)

  // Add Size dimension
  store.addVariantDimension('btn', {
    name: 'Size',
    values: ['sm', 'md', 'lg'],
    defaultValue: 'md',
  })

  let updated = store.getSnapshot().elements.btn
  assert.equal(updated.component.variantMatrix.dimensions.length, 1)
  assert.equal(updated.component.variantMatrix.dimensions[0].name, 'Size')
  assert.deepEqual(updated.component.variantMatrix.dimensions[0].values, ['sm', 'md', 'lg'])
  assert.equal(updated.component.variantMatrix.dimensions[0].defaultValue, 'md')

  // Add Theme dimension
  store.addVariantDimension('btn', {
    name: 'Theme',
    values: ['paper', 'dark', 'accent'],
    defaultValue: 'paper',
  })

  updated = store.getSnapshot().elements.btn
  assert.equal(updated.component.variantMatrix.dimensions.length, 2)
  assert.equal(updated.component.variantMatrix.dimensions[1].name, 'Theme')

  // Update dimension
  const sizeDimId = updated.component.variantMatrix.dimensions[0].id
  store.updateVariantDimension('btn', sizeDimId, { defaultValue: 'lg' })
  updated = store.getSnapshot().elements.btn
  assert.equal(updated.component.variantMatrix.dimensions[0].defaultValue, 'lg')

  // Remove dimension
  store.removeVariantDimension('btn', sizeDimId)
  updated = store.getSnapshot().elements.btn
  assert.equal(updated.component.variantMatrix.dimensions.length, 1)
  assert.equal(updated.component.variantMatrix.dimensions[0].name, 'Theme')
})

test('variant presets (size, state, theme, full-matrix) populate matrix with pre-configured combinations', () => {
  const store = setupButtonMaster()

  // Apply Size preset
  store.applyVariantMatrixPreset('btn', 'size')
  let master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions.length, 1)
  assert.equal(master.component.variantMatrix.dimensions[0].name, 'Size')
  assert.equal(master.component.variantMatrix.combinations.length, 3)

  // Combination sm should have scaled dimensions
  const smComb = master.component.variantMatrix.combinations.find(c => c.dimensions.Size === 'sm')
  assert.ok(smComb)
  assert.ok(smComb.layers['btn-bg'].properties.width < 240)

  // Apply Theme preset
  store.applyVariantMatrixPreset('btn', 'theme')
  master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions[0].name, 'Theme')
  const darkComb = master.component.variantMatrix.combinations.find(c => c.dimensions.Theme === 'dark')
  assert.ok(darkComb)
  assert.equal(darkComb.layers['btn-bg'].style.fill, '#080808')

  // Apply Full Matrix preset
  store.applyVariantMatrixPreset('btn', 'full-matrix')
  master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions.length, 3)
  assert.equal(master.component.variantMatrix.combinations.length, 27) // 3 sizes × 3 states × 3 themes
})

test('instance resolves compound multi-dimensional variants and inherits variant styles', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'theme')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)

  // By default Theme is 'paper', so fill is '#edebe1'
  assert.equal(getSublayer('btn-bg').style.fill, '#edebe1')

  // Switch instance Theme to 'dark'
  store.setComponentProperty(instance.id, 'Theme', 'dark')
  assert.equal(getSublayer('btn-bg').style.fill, '#080808')
  assert.equal(getSublayer('btn-text').style.fill, '#edebe1')

  // Switch instance Theme to 'accent'
  store.setComponentProperty(instance.id, 'Theme', 'accent')
  assert.equal(getSublayer('btn-bg').style.fill, '#81adec')

  // Reset Theme property restores master default
  store.setComponentProperty(instance.id, 'Theme', null)
  assert.equal(getSublayer('btn-bg').style.fill, '#edebe1')
})

test('localized property overrides are preserved when switching variant dimensions', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)

  // Apply a local override to the label text on the instance
  const labelNode = getSublayer('btn-text')
  store.update(labelNode.id, 'text', { text: 'Custom Action' })

  // Also apply a local style override (e.g. custom stroke)
  const bgNode = getSublayer('btn-bg')
  store.update(bgNode.id, 'rectangle', { style: { ...bgNode.style, stroke: { color: '#81adec', width: 3, dash: [] } } })

  assert.equal(getSublayer('btn-text').text, 'Custom Action')
  assert.equal(getSublayer('btn-bg').style.stroke.color, '#81adec')

  // Switch variant dimension to 'sm'
  store.setComponentProperty(instance.id, 'Size', 'sm')

  // Background size updated according to 'sm' variant
  assert.ok(getSublayer('btn-bg').width < 240)
  // But localized overrides are strictly PRESERVED!
  assert.equal(getSublayer('btn-text').text, 'Custom Action')
  assert.equal(getSublayer('btn-bg').style.stroke.color, '#81adec')

  // Switch to 'lg'
  store.setComponentProperty(instance.id, 'Size', 'lg')
  assert.ok(getSublayer('btn-bg').width > 240)
  assert.equal(getSublayer('btn-text').text, 'Custom Action')
  assert.equal(getSublayer('btn-bg').style.stroke.color, '#81adec')
})

test('localized overrides survive master component structural and visual updates', () => {
  const store = setupButtonMaster()
  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)

  // Local override on instance text
  store.update(getSublayer('btn-text').id, 'text', { text: 'Localized Text' })

  // Update master background fill and corner radius
  store.update('btn-bg', 'rectangle', { cornerRadius: 20, style: { fill: '#222222', stroke: { color: '#81adec', width: 2, dash: [] } } })

  // Instance inherits master's new fill and radius, but keeps its localized text override
  assert.equal(getSublayer('btn-bg').cornerRadius, 20)
  assert.equal(getSublayer('btn-bg').style.fill, '#222222')
  assert.equal(getSublayer('btn-text').text, 'Localized Text')
})

test('granular override diff calculation and pushing overrides to variant combination or master', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'theme')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)

  // Switch instance to 'dark' theme
  store.setComponentProperty(instance.id, 'Theme', 'dark')

  // Add local override to label text
  const label = getSublayer('btn-text')
  store.update(label.id, 'text', { text: 'Dark Mode Text' })

  // Check override diffs
  const diffs = store.getOverrideDiff(label.id)
  assert.ok(diffs.length > 0)
  const textDiff = diffs.find(d => d.channel === 'properties.text')
  assert.ok(textDiff)
  assert.equal(textDiff.overrideValue, 'Dark Mode Text')

  // Push property override to active variant combination
  store.pushPropertyOverrideToVariant(label.id, 'properties.text', { Theme: 'dark' })

  // The local override on the instance is cleared (now inherited from variant)
  assert.equal(label.component.overrides.properties?.text, undefined)

  // Check master variant matrix combination for Theme=dark now contains the captured text
  const master = store.getSnapshot().elements.btn
  const darkComb = master.component.variantMatrix.combinations.find(c => c.dimensions.Theme === 'dark')
  assert.equal(darkComb.layers['btn-text'].properties.text, 'Dark Mode Text')

  // Another instance with Theme=dark also receives the updated text automatically!
  const instance2 = store.createComponentInstance('btn', { x: 720, y: 120 })
  store.setComponentProperty(instance2.id, 'Theme', 'dark')
  const inst2Sublayer = sourceId => subtree(store.getSnapshot().elements, instance2.id).find(n => n.component.sourceId === sourceId)
  assert.equal(inst2Sublayer('btn-text').text, 'Dark Mode Text')
})

test('generateVariantMatrixOnCanvas produces an on-canvas 2D grid aligned to 120px grid', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  // Add State dimension so we have 2 dimensions (Size × State)
  store.addVariantDimension('btn', {
    name: 'State',
    values: ['default', 'hover', 'active'],
    defaultValue: 'default',
  })

  // Generate on canvas
  const container = store.generateVariantMatrixOnCanvas('btn')
  assert.ok(container)
  assert.equal(container.type, 'frame')
  assert.ok(container.name.includes('Matrix: Button'))

  // Verify elements inside container
  const children = Object.values(store.getSnapshot().elements).filter(e => e.parentId === container.id)
  assert.ok(children.length > 0)

  // Should contain column headers, row headers, and instances
  const textLabels = children.filter(c => c.type === 'text')
  assert.ok(textLabels.length >= 3) // Col labels
  const instances = children.filter(c => c.component?.kind === 'instance')
  assert.equal(instances.length, 9) // 3 sizes × 3 states

  // Grid coordinates should be aligned to grid steps
  assert.ok(container.x % 120 === 0)
  assert.ok(container.y % 120 === 0)
})

test('variant matrix and instance property overrides roundtrip serialize and deserialize losslessly', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'full-matrix')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'Size', 'lg')
  store.setComponentProperty(instance.id, 'Theme', 'dark')

  const json = JSON.parse(JSON.stringify(store.toJSON()))
  const restored = new SceneStore()
  restored.load(json)

  assert.deepEqual(restored.toJSON(), store.toJSON())
  const restoredMaster = restored.getSnapshot().elements.btn
  assert.equal(restoredMaster.component.variantMatrix.dimensions.length, 3)
  assert.equal(restoredMaster.component.variantMatrix.combinations.length, 27)

  const restoredInstance = restored.getSnapshot().elements[instance.id]
  assert.equal(restoredInstance.component.propertyValues.Size, 'lg')
  assert.equal(restoredInstance.component.propertyValues.Theme, 'dark')
})
