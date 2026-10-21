import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'
import { resolveVariantCombinations, findMatchingVariantCombination } from '../src/scene/componentProperties.ts'

function createTestCardMaster() {
  const store = new SceneStore()
  // Master Card
  store.add('frame', { id: 'card-master', name: 'Card', x: 100, y: 100, width: 300, height: 200 })
  store.add('rectangle', { id: 'card-bg', parentId: 'card-master', name: 'Background', x: 0, y: 0, width: 300, height: 200, cornerRadius: 8, style: { fill: '#ffffff', stroke: { color: '#000000', width: 1, dash: [] } } })
  // Nested Header Frame
  store.add('frame', { id: 'card-header', parentId: 'card-master', name: 'Header', x: 16, y: 16, width: 268, height: 40 })
  store.add('text', { id: 'card-title', parentId: 'card-header', name: 'Title', text: 'Card Title', x: 0, y: 8, fontSize: 18, style: { fill: '#111111' } })
  // Nested Badge Frame inside Header
  store.add('frame', { id: 'card-badge', parentId: 'card-header', name: 'Badge', x: 180, y: 4, width: 80, height: 24 })
  store.add('rectangle', { id: 'badge-bg', parentId: 'card-badge', name: 'Badge Background', x: 0, y: 0, width: 80, height: 24, cornerRadius: 4, style: { fill: '#eeeeee' } })
  store.add('text', { id: 'badge-text', parentId: 'card-badge', name: 'Badge Text', text: 'DEFAULT', x: 8, y: 4, fontSize: 10, style: { fill: '#666666' } })
  // Body text
  store.add('text', { id: 'card-body', parentId: 'card-master', name: 'Body', text: 'This is the card body text.', x: 16, y: 70, fontSize: 14, style: { fill: '#333333' } })

  store.createComponent('card-master')
  store.clearHistory()
  return store
}

test('master component creation and multi-instance propagation architecture', () => {
  const store = createTestCardMaster()
  const master = store.getMasterComponent('card-master')
  assert.ok(master)
  assert.equal(master.component.kind, 'master')

  // Create two living instances
  const inst1 = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('card-master', { x: 900, y: 100 })

  const getSublayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  // Verify initial state inheritance
  assert.equal(getSublayer(inst1.id, 'card-title').text, 'Card Title')
  assert.equal(getSublayer(inst2.id, 'card-title').text, 'Card Title')
  assert.equal(getSublayer(inst1.id, 'badge-text').text, 'DEFAULT')
  assert.equal(getSublayer(inst2.id, 'badge-text').text, 'DEFAULT')

  // Update master: change title text, background fill, badge background fill
  store.update('card-title', 'text', { text: 'Universal Card Header' })
  store.update('card-bg', 'rectangle', { style: { fill: '#f8f9fa', stroke: { color: '#000000', width: 2, dash: [] } } })
  store.update('badge-bg', 'rectangle', { style: { fill: '#d4edda' } })

  // Both instances receive master propagation immediately
  assert.equal(getSublayer(inst1.id, 'card-title').text, 'Universal Card Header')
  assert.equal(getSublayer(inst2.id, 'card-title').text, 'Universal Card Header')
  assert.equal(getSublayer(inst1.id, 'card-bg').style.fill, '#f8f9fa')
  assert.equal(getSublayer(inst2.id, 'card-bg').style.fill, '#f8f9fa')
  assert.equal(getSublayer(inst1.id, 'badge-bg').style.fill, '#d4edda')
  assert.equal(getSublayer(inst2.id, 'badge-bg').style.fill, '#d4edda')
})

test('multi-axis variant matrix with multi-property combinations and cascading specificity resolution', () => {
  const store = createTestCardMaster()

  // Define 3 variant dimensions: Size (sm, md, lg), State (default, hover), Theme (light, dark)
  store.addVariantDimension('card-master', { name: 'Size', values: ['sm', 'md', 'lg'], defaultValue: 'md' })
  store.addVariantDimension('card-master', { name: 'State', values: ['default', 'hover'], defaultValue: 'default' })
  store.addVariantDimension('card-master', { name: 'Theme', values: ['light', 'dark'], defaultValue: 'light' })

  // Add 1-dimension combination: Theme: 'dark'
  store.setVariantCombination('card-master', {
    id: 'comb-theme-dark',
    dimensions: { Theme: 'dark' },
    layers: {
      'card-bg': { style: { fill: '#1a1a1a' } },
      'card-title': { style: { fill: '#ffffff' } },
      'card-body': { style: { fill: '#cccccc' } },
    },
  })

  // Add 2-dimension combination: Theme: 'dark', Size: 'lg'
  store.setVariantCombination('card-master', {
    id: 'comb-dark-lg',
    dimensions: { Theme: 'dark', Size: 'lg' },
    layers: {
      'card-title': { properties: { fontSize: 24 } },
      'card-body': { properties: { fontSize: 16 } },
    },
  })

  // Add 3-dimension combination: Theme: 'dark', Size: 'lg', State: 'hover'
  store.setVariantCombination('card-master', {
    id: 'comb-dark-lg-hover',
    dimensions: { Theme: 'dark', Size: 'lg', State: 'hover' },
    layers: {
      'card-bg': { style: { stroke: { color: '#81adec', width: 3, dash: [] } } },
    },
  })

  const master = store.getMasterComponent('card-master')
  assert.equal(master.component.variantMatrix.dimensions.length, 3)
  assert.equal(master.component.variantMatrix.combinations.length, 3)

  // Test resolveVariantCombinations specificity ordering
  const activeDims = { Theme: 'dark', Size: 'lg', State: 'hover' }
  const matches = resolveVariantCombinations(master.component.variantMatrix, activeDims)
  assert.equal(matches.length, 3)
  // Specificity ordering: 1-dim score first, 3-dim score last
  assert.equal(matches[0].id, 'comb-theme-dark')
  assert.equal(matches[1].id, 'comb-dark-lg')
  assert.equal(matches[2].id, 'comb-dark-lg-hover')

  const topMatch = findMatchingVariantCombination(master.component.variantMatrix, activeDims)
  assert.equal(topMatch.id, 'comb-dark-lg-hover')

  // Instantiate and verify cascading resolution on live instance
  const instance = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, instance.id).find(n => n.component?.sourceId === sourceId)

  // Default theme is 'light', so card-bg fill is '#ffffff'
  assert.equal(getSublayer('card-bg').style.fill, '#ffffff')

  // Set Theme = 'dark' (matches comb-theme-dark)
  store.setComponentProperty(instance.id, 'Theme', 'dark')
  assert.equal(getSublayer('card-bg').style.fill, '#1a1a1a')
  assert.equal(getSublayer('card-title').style.fill, '#ffffff')
  assert.equal(getSublayer('card-title').fontSize, 18) // not lg yet

  // Set Size = 'lg' (now matches both comb-theme-dark AND comb-dark-lg)
  store.setComponentProperty(instance.id, 'Size', 'lg')
  assert.equal(getSublayer('card-bg').style.fill, '#1a1a1a') // from 1st comb
  assert.equal(getSublayer('card-title').fontSize, 24) // from 2nd comb
  assert.equal(getSublayer('card-body').fontSize, 16) // from 2nd comb

  // Set State = 'hover' (now matches all 3 combinations)
  store.setComponentProperty(instance.id, 'State', 'hover')
  assert.equal(getSublayer('card-bg').style.fill, '#1a1a1a')
  assert.equal(getSublayer('card-title').fontSize, 24)
  assert.deepEqual(getSublayer('card-bg').style.stroke, { color: '#81adec', width: 3, dash: [] })

  // Verify getActiveVariantCombination helper
  const activeComb = store.getActiveVariantCombination(instance.id)
  assert.equal(activeComb.id, 'comb-dark-lg-hover')

  // Verify setVariantCombinationOverrides directly updates combination
  store.setVariantCombinationOverrides('card-master', 'comb-dark-lg-hover', {
    'card-bg': { style: { stroke: { color: '#ff0000', width: 4, dash: [] } } },
  })
  assert.deepEqual(getSublayer('card-bg').style.stroke, { color: '#ff0000', width: 4, dash: [] })
})

test('nested text and fill overrides across deep component hierarchy with granular inspection and reset', () => {
  const store = createTestCardMaster()
  const instance = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, instance.id).find(n => n.component?.sourceId === sourceId)

  // Apply deep nested overrides
  const badgeTextNode = getSublayer('badge-text')
  const badgeBgNode = getSublayer('badge-bg')
  const cardTitleNode = getSublayer('card-title')

  // Override nested text
  store.update(badgeTextNode.id, 'text', { text: 'FEATURED' })
  // Override nested fill
  store.update(badgeBgNode.id, 'rectangle', { style: { fill: '#ffc107' } })
  // Override title text and color
  store.update(cardTitleNode.id, 'text', { text: 'Customized Title', style: { fill: '#007bff' } })

  // Verify overrides applied on instance
  assert.equal(getSublayer('badge-text').text, 'FEATURED')
  assert.equal(getSublayer('badge-bg').style.fill, '#ffc107')
  assert.equal(getSublayer('card-title').text, 'Customized Title')
  assert.equal(getSublayer('card-title').style.fill, '#007bff')

  // Verify master untouched
  assert.equal(store.getSnapshot().elements['badge-text'].text, 'DEFAULT')
  assert.equal(store.getSnapshot().elements['badge-bg'].style.fill, '#eeeeee')

  // Inspect nested overrides via getInstanceNestedOverrides
  const nestedOverrides = store.getInstanceNestedOverrides(instance.id)
  assert.ok(nestedOverrides.length >= 3)
  const badgeTextOverride = nestedOverrides.find(o => o.sourceId === 'badge-text')
  assert.ok(badgeTextOverride)
  assert.equal(badgeTextOverride.overrides.properties.text, 'FEATURED')

  // Update master: change untargeted channels and verify instance inherits
  store.update('card-title', 'text', { fontSize: 26 })
  store.update('badge-text', 'text', { fontSize: 12 })
  store.update('card-body', 'text', { text: 'Brand new body from master' })

  // Instance preserves its overridden text and fill, but inherits master's new font size and body text!
  assert.equal(getSublayer('badge-text').text, 'FEATURED')
  assert.equal(getSublayer('badge-text').fontSize, 12) // inherited!
  assert.equal(getSublayer('badge-bg').style.fill, '#ffc107')
  assert.equal(getSublayer('card-title').text, 'Customized Title')
  assert.equal(getSublayer('card-title').fontSize, 26) // inherited!
  assert.equal(getSublayer('card-body').text, 'Brand new body from master') // inherited!

  // Reset a specific nested layer override
  store.resetNestedLayerOverrides(instance.id, 'badge-bg')
  assert.equal(getSublayer('badge-bg').style.fill, '#eeeeee') // restored to master default
  assert.equal(getSublayer('badge-text').text, 'FEATURED') // still overridden!
})

test('instance swapping between master components preserves position, sizing, and compatible overrides', () => {
  const store = createTestCardMaster()

  // Create a second Master Component: Banner
  store.add('frame', { id: 'banner-master', name: 'Banner', x: 100, y: 400, width: 320, height: 180 })
  store.add('rectangle', { id: 'banner-bg', parentId: 'banner-master', name: 'Background', x: 0, y: 0, width: 320, height: 180, cornerRadius: 12, style: { fill: '#e9ecef' } })
  store.add('text', { id: 'banner-title', parentId: 'banner-master', name: 'Title', text: 'Banner Headline', x: 20, y: 20, fontSize: 22, style: { fill: '#212529' } })
  store.add('text', { id: 'banner-body', parentId: 'banner-master', name: 'Body', text: 'Banner subtitle text.', x: 20, y: 60, fontSize: 15, style: { fill: '#495057' } })
  store.add('ellipse', { id: 'banner-badge', parentId: 'banner-master', name: 'Accent Dot', x: 280, y: 20, width: 16, height: 16, style: { fill: '#28a745' } })
  store.createComponent('banner-master')

  // Create an instance of Card
  const instance = store.createComponentInstance('card-master', { x: 600, y: 250 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, instance.id).find(n => n.component?.sourceId === sourceId)

  // Apply overrides to Card instance: Title text, Background fill
  const titleNode = getSublayer('card-title')
  const bgNode = getSublayer('card-bg')
  store.update(titleNode.id, 'text', { text: 'Customized Special Offer' })
  store.update(bgNode.id, 'rectangle', { style: { fill: '#ffebee' } })

  // Verify swap validation
  assert.equal(store.canSwapComponentInstance(instance.id, 'banner-master'), true)
  assert.equal(store.canSwapComponentInstance(instance.id, 'non-existent'), false)

  // Swap instance from Card to Banner
  const swapped = store.swapComponentInstance(instance.id, 'banner-master')
  assert.equal(swapped.id, instance.id)
  assert.equal(swapped.component.masterId, 'banner-master')
  assert.equal(swapped.x, 600)
  assert.equal(swapped.y, 250)

  const getSwappedSublayer = name =>
    subtree(store.getSnapshot().elements, swapped.id).find(n => n.name === name)

  // Verify compatible overrides preserved by matching layer name
  const swappedTitle = getSwappedSublayer('Title')
  assert.ok(swappedTitle)
  assert.equal(swappedTitle.text, 'Customized Special Offer')

  const swappedBg = getSwappedSublayer('Background')
  assert.ok(swappedBg)
  assert.equal(swappedBg.style.fill, '#ffebee')

  // Newly materialized layer from Banner exists
  const accentDot = getSwappedSublayer('Accent Dot')
  assert.ok(accentDot)
  assert.equal(accentDot.style.fill, '#28a745')

  // Undo restores Card instance completely
  store.undo()
  const restored = store.getSnapshot().elements[instance.id]
  assert.equal(restored.component.masterId, 'card-master')
  assert.equal(getSublayer('card-title').text, 'Customized Special Offer')
  assert.equal(getSublayer('card-bg').style.fill, '#ffebee')
})

test('instance swapping with preserveOverrides: false creates clean master instance', () => {
  const store = createTestCardMaster()

  store.add('frame', { id: 'alt-master', name: 'Alt', x: 100, y: 400, width: 200, height: 100 })
  store.add('rectangle', { id: 'alt-bg', parentId: 'alt-master', name: 'Background', x: 0, y: 0, width: 200, height: 100, style: { fill: '#123456' } })
  store.createComponent('alt-master')

  const instance = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, instance.id).find(n => n.component?.sourceId === sourceId)

  // Local override
  store.update(getSublayer('card-bg').id, 'rectangle', { style: { fill: '#ff00ff' } })

  // Swap with preserveOverrides: false
  const swapped = store.swapComponentInstance(instance.id, 'alt-master', { preserveOverrides: false })
  assert.equal(swapped.component.masterId, 'alt-master')

  const swappedBg = subtree(store.getSnapshot().elements, swapped.id).find(n => n.name === 'Background')
  // Clean master fill is inherited, local override is dropped
  assert.equal(swappedBg.style.fill, '#123456')
})

test('bidirectional master-sync: push instance overrides back to master component and propagate to all instances', () => {
  const store = createTestCardMaster()

  // Two instances of Card
  const inst1 = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('card-master', { x: 900, y: 100 })

  const getSublayer1 = sourceId =>
    subtree(store.getSnapshot().elements, inst1.id).find(n => n.component?.sourceId === sourceId)
  const getSublayer2 = sourceId =>
    subtree(store.getSnapshot().elements, inst2.id).find(n => n.component?.sourceId === sourceId)

  // Instance 1 overrides nested Title text and Badge Background fill
  store.update(getSublayer1('card-title').id, 'text', { text: 'Executive Overview' })
  store.update(getSublayer1('badge-bg').id, 'rectangle', { style: { fill: '#ff4444' } })

  assert.equal(store.isInstanceInSync(inst1.id), false)
  assert.equal(store.isInstanceInSync(inst2.id), true)

  // Push overrides from Instance 1 back to Master!
  store.pushOverridesToMaster(inst1.id)

  // Master component now has the new text and fill
  const masterTitle = store.getSnapshot().elements['card-title']
  const masterBadgeBg = store.getSnapshot().elements['badge-bg']
  assert.equal(masterTitle.text, 'Executive Overview')
  assert.equal(masterBadgeBg.style.fill, '#ff4444')

  // Instance 1's local overrides are cleared, so it is now in sync with master
  assert.equal(store.isInstanceInSync(inst1.id), true)

  // Instance 2 also automatically receives the new master values!
  assert.equal(getSublayer2('card-title').text, 'Executive Overview')
  assert.equal(getSublayer2('badge-bg').style.fill, '#ff4444')
})

test('bidirectional master-sync: pull from master and selective channel sync', () => {
  const store = createTestCardMaster()
  const instance = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const getSublayer = sourceId =>
    subtree(store.getSnapshot().elements, instance.id).find(n => n.component?.sourceId === sourceId)

  // Apply overrides on Title text, Title fill, and Card Background fill
  store.update(getSublayer('card-title').id, 'text', { text: 'Local Title', style: { fill: '#e91e63' } })
  store.update(getSublayer('card-bg').id, 'rectangle', { style: { fill: '#00bcd4' } })

  let status = store.getInstanceSyncStatus(instance.id)
  assert.equal(status.isSynced, false)
  assert.ok(status.overrideCount >= 3)

  // Selective pull/sync of single channel 'properties.text'
  store.syncInstanceWithMaster(instance.id, { channels: ['properties.text'] })
  assert.equal(getSublayer('card-title').text, 'Card Title') // Restored to master
  assert.equal(getSublayer('card-title').style.fill, '#e91e63') // Still overridden
  assert.equal(getSublayer('card-bg').style.fill, '#00bcd4') // Still overridden

  // Pull with resetOverrides: true
  store.pullFromMaster(instance.id, { resetOverrides: true })
  assert.equal(getSublayer('card-title').style.fill, '#111111') // Restored
  assert.equal(getSublayer('card-bg').style.fill, '#ffffff') // Restored
  assert.equal(store.isInstanceInSync(instance.id), true)
})

test('global syncAllInstancesWithMaster brings all instances into synchronization', () => {
  const store = createTestCardMaster()
  const inst1 = store.createComponentInstance('card-master', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('card-master', { x: 900, y: 100 })

  const getSublayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  // Local overrides on both instances
  store.update(getSublayer(inst1.id, 'card-title').id, 'text', { text: 'Title 1' })
  store.update(getSublayer(inst2.id, 'card-title').id, 'text', { text: 'Title 2' })
  assert.equal(store.isInstanceInSync(inst1.id), false)
  assert.equal(store.isInstanceInSync(inst2.id), false)

  // Global sync
  store.syncAllInstancesWithMaster('card-master', { resetOverrides: true })
  assert.equal(store.isInstanceInSync(inst1.id), true)
  assert.equal(store.isInstanceInSync(inst2.id), true)
  assert.equal(getSublayer(inst1.id, 'card-title').text, 'Card Title')
  assert.equal(getSublayer(inst2.id, 'card-title').text, 'Card Title')
})
