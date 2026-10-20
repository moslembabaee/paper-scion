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

test('automated change propagation: master modifications propagate immediately to variant instances across multiple dimensions', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  // Create two instances with different variant sizes
  const instSm = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instSm.id, 'Size', 'sm')

  const instLg = store.createComponentInstance('btn', { x: 740, y: 120 })
  store.setComponentProperty(instLg.id, 'Size', 'lg')

  const getSmLayer = sourceId => subtree(store.getSnapshot().elements, instSm.id).find(n => n.component.sourceId === sourceId)
  const getLgLayer = sourceId => subtree(store.getSnapshot().elements, instLg.id).find(n => n.component.sourceId === sourceId)

  // Verify initial size scaling
  assert.ok(getSmLayer('btn-bg').width < 240)
  assert.ok(getLgLayer('btn-bg').width > 240)

  // Initial fill and text match master
  assert.equal(getSmLayer('btn-bg').style.fill, '#edebe1')
  assert.equal(getLgLayer('btn-bg').style.fill, '#edebe1')
  assert.equal(getSmLayer('btn-text').text, 'Button Text')
  assert.equal(getLgLayer('btn-text').text, 'Button Text')

  // 1. Update master text -> must propagate to both variant instances automatically!
  store.update('btn-text', 'text', { text: 'Automated Master Text' })
  assert.equal(getSmLayer('btn-text').text, 'Automated Master Text')
  assert.equal(getLgLayer('btn-text').text, 'Automated Master Text')

  // 2. Update master background fill -> must propagate to both variant instances automatically!
  store.update('btn-bg', 'rectangle', { style: { fill: '#ff4400', stroke: { color: '#000000', width: 2, dash: [] } } })
  assert.equal(getSmLayer('btn-bg').style.fill, '#ff4400')
  assert.equal(getLgLayer('btn-bg').style.fill, '#ff4400')
  assert.equal(getSmLayer('btn-bg').style.stroke.color, '#000000')
  assert.equal(getLgLayer('btn-bg').style.stroke.color, '#000000')

  // Size scaling remains active and correct!
  assert.ok(getSmLayer('btn-bg').width < 240)
  assert.ok(getLgLayer('btn-bg').width > 240)
})

test('pushComponentPropertyToMaster pushes variant dimension override to master defaultValue and clears instance propertyValues', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'Size', 'lg')

  let instNode = store.getSnapshot().elements[instance.id]
  assert.equal(instNode.component.propertyValues.Size, 'lg')

  let master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions[0].defaultValue, 'md')

  // Push Size dimension override to master
  store.pushComponentPropertyToMaster(instance.id, 'Size')

  master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions[0].defaultValue, 'lg')

  // Instance propertyValues is now cleared, inheriting the new master default
  instNode = store.getSnapshot().elements[instance.id]
  assert.equal(instNode.component.propertyValues?.Size, undefined)

  // Another new instance created inherits 'lg' as default
  const instance2 = store.createComponentInstance('btn', { x: 740, y: 120 })
  const getSublayer2 = sourceId => subtree(store.getSnapshot().elements, instance2.id).find(n => n.component.sourceId === sourceId)
  assert.ok(getSublayer2('btn-bg').width > 240)
})

test('pushOverridesToMaster pushes variant dimension overrides and visual overrides together', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'Size', 'sm')

  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)
  store.update(getSublayer('btn-text').id, 'text', { text: 'Global New Default Text' })

  // Push all overrides from instance to master
  store.pushOverridesToMaster(instance.id)

  const master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions[0].defaultValue, 'sm')
  const masterText = store.getSnapshot().elements['btn-text']
  assert.equal(masterText.text, 'Global New Default Text')

  // Instance overrides and property values are cleanly reset
  const instNode = store.getSnapshot().elements[instance.id]
  assert.equal(instNode.component.propertyValues?.Size, undefined)
  const instText = getSublayer('btn-text')
  assert.equal(instText.component.overrides.properties?.text, undefined)
})

test('pushInstanceOverridesToVariant captures all layer overrides into variant combination and clears localized overrides', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'Size', 'lg')

  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)
  const txtNode = getSublayer('btn-text')
  const bgNode = getSublayer('btn-bg')

  store.update(txtNode.id, 'text', { text: 'Large Size CTA' })
  store.update(bgNode.id, 'rectangle', { style: { ...bgNode.style, fill: '#81adec' } })

  assert.equal(getSublayer('btn-text').component.overrides.properties.text, 'Large Size CTA')
  assert.equal(getSublayer('btn-bg').component.overrides.style.fill, '#81adec')

  // Push all instance overrides to active variant combination (Size=lg)
  store.pushInstanceOverridesToVariant(instance.id)

  // Local overrides on instance are cleared, but instance stays on Size=lg
  assert.equal(getSublayer('btn-text').component.overrides.properties?.text, undefined)
  assert.equal(getSublayer('btn-bg').component.overrides.style?.fill, undefined)
  assert.equal(store.getSnapshot().elements[instance.id].component.propertyValues.Size, 'lg')

  // Instance still renders the pushed text and fill because it inherits them from the Size=lg combination!
  assert.equal(getSublayer('btn-text').text, 'Large Size CTA')
  assert.equal(getSublayer('btn-bg').style.fill, '#81adec')

  // A new instance switching to Size=lg also receives the pushed styles!
  const instance2 = store.createComponentInstance('btn', { x: 740, y: 120 })
  store.setComponentProperty(instance2.id, 'Size', 'lg')
  const getSublayer2 = sourceId => subtree(store.getSnapshot().elements, instance2.id).find(n => n.component.sourceId === sourceId)
  assert.equal(getSublayer2('btn-text').text, 'Large Size CTA')
  assert.equal(getSublayer2('btn-bg').style.fill, '#81adec')
})

test('populateVariantMatrixCombinations generates complete Cartesian combinations with smart semantics', () => {
  const store = setupButtonMaster()
  store.addVariantDimension('btn', { name: 'Size', values: ['sm', 'md', 'lg'], defaultValue: 'md' })
  store.addVariantDimension('btn', { name: 'Theme', values: ['paper', 'dark'], defaultValue: 'paper' })

  let master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.combinations.length, 0)

  // Auto-populate 3 sizes × 2 themes = 6 combinations
  store.populateVariantMatrixCombinations('btn')
  master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.combinations.length, 6)

  const smDark = master.component.variantMatrix.combinations.find(c => c.dimensions.Size === 'sm' && c.dimensions.Theme === 'dark')
  assert.ok(smDark)
  assert.ok(smDark.layers['btn-bg'].properties.width < 240)
  assert.equal(smDark.layers['btn-bg'].style.fill, '#080808')
})

test('subchannel override pushing: pushPropertyOverrideToVariant isolates nested style and properties', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'Size', 'sm')
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)

  const bg = getSublayer('btn-bg')
  // Update stroke with custom color and custom width
  store.update(bg.id, 'rectangle', { style: { ...bg.style, stroke: { color: '#81adec', width: 4, dash: [] } } })

  // Push only the stroke color to variant combination
  store.pushPropertyOverrideToVariant(bg.id, 'style.stroke.color', { Size: 'sm' })

  // The stroke color override was cleared on the instance, but stroke width (4) remains local!
  const bgAfter = getSublayer('btn-bg')
  assert.equal(bgAfter.component.overrides.style.stroke?.color, undefined)
  assert.equal(bgAfter.component.overrides.style.stroke?.width, 4)

  // Master variant combination for Size=sm contains stroke color #81adec
  const master = store.getSnapshot().elements.btn
  const smComb = master.component.variantMatrix.combinations.find(c => c.dimensions.Size === 'sm')
  assert.equal(smComb.layers['btn-bg'].style.stroke.color, '#81adec')
})

test('updateVariantDimension renames dimension keys in combinations consistently', () => {
  const store = setupButtonMaster()
  store.applyVariantMatrixPreset('btn', 'size')

  let master = store.getSnapshot().elements.btn
  const sizeDim = master.component.variantMatrix.dimensions[0]
  assert.equal(sizeDim.name, 'Size')
  assert.ok(master.component.variantMatrix.combinations.every(c => Object.hasOwn(c.dimensions, 'Size')))

  // Rename dimension 'Size' to 'ComponentSize'
  store.updateVariantDimension('btn', sizeDim.id, { name: 'ComponentSize' })

  master = store.getSnapshot().elements.btn
  assert.equal(master.component.variantMatrix.dimensions[0].name, 'ComponentSize')
  assert.ok(master.component.variantMatrix.combinations.every(c => Object.hasOwn(c.dimensions, 'ComponentSize')))
  assert.ok(master.component.variantMatrix.combinations.every(c => !Object.hasOwn(c.dimensions, 'Size')))

  // Instances can resolve with the new dimension name
  const instance = store.createComponentInstance('btn', { x: 480, y: 120 })
  store.setComponentProperty(instance.id, 'ComponentSize', 'sm')
  const getSublayer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(n => n.component.sourceId === sourceId)
  assert.ok(getSublayer('btn-bg').width < 240)
})

