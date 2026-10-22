import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import {
  subtree,
  getComponentOverrideDiff,
  getComponentOverrideBindings,
  isComponentInstance,
  isMasterComponent,
} from '../src/scene/components.ts'
import { ensureStandardModes, getEffectiveThemeMode } from '../src/tokens/engine.ts'

function createCardMasterWithTokens() {
  const store = new SceneStore()
  ensureStandardModes(store)

  // 1. Color Tokens with Multi-Mode Theme Values
  const colorBg = store.addToken({
    type: 'color',
    name: 'card-bg',
    value: '#ffffff',
    themeValues: {
      dark: '#0f172a',
      'high-contrast': '#000000',
    },
  })

  const colorText = store.addToken({
    type: 'color',
    name: 'text-primary',
    value: '#1e293b',
    themeValues: {
      dark: '#f8fafc',
      'high-contrast': '#ffffff',
    },
  })

  const colorBorder = store.addToken({
    type: 'color',
    name: 'card-border',
    value: '#cbd5e1',
    themeValues: {
      dark: '#334155',
      'high-contrast': '#ffffff',
    },
  })

  const colorBadge = store.addToken({
    type: 'color',
    name: 'badge-bg',
    value: '#3b82f6',
    themeValues: {
      dark: '#60a5fa',
      'high-contrast': '#facc15',
    },
  })

  // 2. Spacing & Dimension Tokens
  const spacingWidth = store.addToken({
    type: 'spacing',
    name: 'card-width',
    value: 360,
    themeValues: {
      dark: 380,
    },
  })

  const spacingHeight = store.addToken({
    type: 'spacing',
    name: 'card-height',
    value: 240,
  })

  const radiusCard = store.addToken({
    type: 'radius',
    name: 'card-radius',
    value: 12,
  })

  const radiusBadge = store.addToken({
    type: 'radius',
    name: 'badge-radius',
    value: 6,
  })

  // 3. Typography Tokens
  const fontBase = store.addToken({
    type: 'fontFamily',
    name: 'font-base',
    value: 'Inter, sans-serif',
  })

  const fontSizeTitle = store.addToken({
    type: 'fontSize',
    name: 'text-title',
    value: 20,
  })

  const fontSizeBody = store.addToken({
    type: 'fontSize',
    name: 'text-body',
    value: 14,
  })

  const fontWeightTitle = store.addToken({
    type: 'fontWeight',
    name: 'weight-bold',
    value: 600,
  })

  const lineHeightBase = store.addToken({
    type: 'lineHeight',
    name: 'leading-normal',
    value: 1.4,
  })

  const letterSpacingBase = store.addToken({
    type: 'letterSpacing',
    name: 'tracking-wide',
    value: 0.2,
  })

  // 4. Construct Master Hierarchy
  // Root Frame: Card
  const card = store.add('frame', {
    id: 'master-card',
    name: 'Card Master',
    x: 100,
    y: 100,
    width: 360,
    height: 240,
    cornerRadius: 12,
    style: {
      fill: '#ffffff',
      stroke: { color: '#cbd5e1', width: 1, dash: [] },
    },
  })
  store.bindToken('master-card', 'fill', colorBg.id)
  store.bindToken('master-card', 'stroke', colorBorder.id)
  store.bindToken('master-card', 'width', spacingWidth.id)
  store.bindToken('master-card', 'height', spacingHeight.id)
  store.bindToken('master-card', 'cornerRadius', radiusCard.id)

  // Header Frame
  const header = store.add('frame', {
    id: 'card-header',
    parentId: card.id,
    name: 'Header Frame',
    x: 16,
    y: 16,
    width: 328,
    height: 40,
  })

  // Title Text
  const title = store.add('text', {
    id: 'card-title',
    parentId: header.id,
    name: 'Card Title',
    text: 'Card Title',
    x: 0,
    y: 8,
    fontFamily: 'Inter, sans-serif',
    fontSize: 20,
    fontWeight: 600,
    style: { fill: '#1e293b' },
  })
  store.bindToken('card-title', 'fill', colorText.id)
  store.bindToken('card-title', 'fontFamily', fontBase.id)
  store.bindToken('card-title', 'fontSize', fontSizeTitle.id)
  store.bindToken('card-title', 'fontWeight', fontWeightTitle.id)

  // Badge Frame
  const badge = store.add('frame', {
    id: 'card-badge',
    parentId: header.id,
    name: 'Badge Frame',
    x: 240,
    y: 4,
    width: 80,
    height: 28,
    cornerRadius: 6,
    style: { fill: '#3b82f6' },
  })
  store.bindToken('card-badge', 'fill', colorBadge.id)
  store.bindToken('card-badge', 'cornerRadius', radiusBadge.id)

  // Badge Text
  const badgeText = store.add('text', {
    id: 'badge-text',
    parentId: badge.id,
    name: 'Badge Text',
    text: 'NEW',
    x: 8,
    y: 4,
    fontSize: 14,
    style: { fill: '#f8fafc' },
  })
  store.bindToken('badge-text', 'fontSize', fontSizeBody.id)

  // Body Text
  const body = store.add('text', {
    id: 'card-body',
    parentId: card.id,
    name: 'Card Body',
    text: 'Detailed description of the card component.',
    x: 16,
    y: 80,
    fontSize: 14,
    lineHeight: 1.4,
    letterSpacing: 0.2,
    style: { fill: '#1e293b' },
  })
  store.bindToken('card-body', 'fill', colorText.id)
  store.bindToken('card-body', 'fontSize', fontSizeBody.id)
  store.bindToken('card-body', 'lineHeight', lineHeightBase.id)
  store.bindToken('card-body', 'letterSpacing', letterSpacingBase.id)

  // Turn into master component
  store.createComponent('master-card')
  store.clearHistory()

  return {
    store,
    tokens: {
      colorBg,
      colorText,
      colorBorder,
      colorBadge,
      spacingWidth,
      spacingHeight,
      radiusCard,
      radiusBadge,
      fontBase,
      fontSizeTitle,
      fontSizeBody,
      fontWeightTitle,
      lineHeightBase,
      letterSpacingBase,
    },
  }
}

test('master component creation and deep instance hierarchy with color, spacing, and typography token bindings', () => {
  const { store } = createCardMasterWithTokens()
  const master = store.getMasterComponent('master-card')
  assert.ok(master)
  assert.ok(isMasterComponent(master))

  // Create 3 instances on canvas
  const inst1 = store.createComponentInstance('master-card', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('master-card', { x: 900, y: 100 })
  const inst3 = store.createComponentInstance('master-card', { x: 1300, y: 100 })

  // Configure distinct variable modes
  store.setElementThemeMode(inst2.id, 'dark')
  store.setElementThemeMode(inst3.id, 'high-contrast')

  const getLayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  // Instance 1: Document / Light Mode
  const inst1Root = store.getSnapshot().elements[inst1.id]
  const inst1Title = getLayer(inst1.id, 'card-title')
  const inst1Badge = getLayer(inst1.id, 'card-badge')
  const inst1Body = getLayer(inst1.id, 'card-body')

  assert.equal(inst1Root.style.fill, '#ffffff')
  assert.equal(inst1Root.style.stroke?.color, '#cbd5e1')
  assert.equal(inst1Root.width, 360)
  assert.equal(inst1Root.height, 240)
  assert.equal(inst1Root.cornerRadius, 12)
  assert.equal(inst1Title.style.fill, '#1e293b')
  assert.equal(inst1Title.fontSize, 20)
  assert.equal(inst1Title.fontWeight, 600)
  assert.equal(inst1Badge.style.fill, '#3b82f6')
  assert.equal(inst1Body.style.fill, '#1e293b')
  assert.equal(inst1Body.fontSize, 14)
  assert.equal(inst1Body.lineHeight, 1.4)
  assert.equal(inst1Body.letterSpacing, 0.2)

  // Instance 2: Scoped Dark Mode
  const inst2Root = store.getSnapshot().elements[inst2.id]
  const inst2Title = getLayer(inst2.id, 'card-title')
  const inst2Badge = getLayer(inst2.id, 'card-badge')

  assert.equal(inst2Root.style.fill, '#0f172a') // Dark bg
  assert.equal(inst2Root.style.stroke?.color, '#334155') // Dark border
  assert.equal(inst2Root.width, 380) // Dark spacing override
  assert.equal(inst2Title.style.fill, '#f8fafc') // Dark text
  assert.equal(inst2Badge.style.fill, '#60a5fa') // Dark badge

  // Instance 3: Scoped High-Contrast Mode
  const inst3Root = store.getSnapshot().elements[inst3.id]
  const inst3Title = getLayer(inst3.id, 'card-title')
  const inst3Badge = getLayer(inst3.id, 'card-badge')

  assert.equal(inst3Root.style.fill, '#000000') // HC bg
  assert.equal(inst3Root.style.stroke?.color, '#ffffff') // HC border
  assert.equal(inst3Title.style.fill, '#ffffff') // HC text
  assert.equal(inst3Badge.style.fill, '#facc15') // HC badge
})

test('scoped design token variable updates propagate in real time across all canvas instances', () => {
  const { store, tokens } = createCardMasterWithTokens()

  const inst1 = store.createComponentInstance('master-card', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('master-card', { x: 900, y: 100 })
  store.setElementThemeMode(inst2.id, 'dark')

  const getLayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  // 1. Update token base value (affects Light mode and un-overridden modes)
  store.updateToken(tokens.colorBg.id, { value: '#f1f5f9' })
  store.updateToken(tokens.fontSizeTitle.id, { value: 24 })

  let snap = store.getSnapshot()
  assert.equal(snap.elements['master-card'].style.fill, '#f1f5f9')
  assert.equal(snap.elements[inst1.id].style.fill, '#f1f5f9')
  assert.equal(getLayer(inst1.id, 'card-title').fontSize, 24)

  // Instance 2 (Dark mode) keeps its dark bg override, but receives the updated title font size
  assert.equal(snap.elements[inst2.id].style.fill, '#0f172a')
  assert.equal(getLayer(inst2.id, 'card-title').fontSize, 24)

  // 2. Update token dark theme values
  store.setTokenThemeValue(tokens.colorBg.id, 'dark', '#020617')
  store.setTokenThemeValue(tokens.spacingWidth.id, 'dark', 420)
  store.setTokenThemeValue(tokens.colorBadge.id, 'dark', '#93c5fd')

  snap = store.getSnapshot()
  // Instance 1 remains Light
  assert.equal(snap.elements[inst1.id].style.fill, '#f1f5f9')
  assert.equal(snap.elements[inst1.id].width, 360)

  // Instance 2 updates to new dark token values
  assert.equal(snap.elements[inst2.id].style.fill, '#020617')
  assert.equal(snap.elements[inst2.id].width, 420)
  assert.equal(getLayer(inst2.id, 'card-badge').style.fill, '#93c5fd')
})

test('granular property override preservation across color, spacing, and typography channels', () => {
  const { store, tokens } = createCardMasterWithTokens()

  const inst1 = store.createComponentInstance('master-card', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('master-card', { x: 900, y: 100 })

  const getLayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  const inst1Title = getLayer(inst1.id, 'card-title')
  const inst1Body = getLayer(inst1.id, 'card-body')

  // Apply overrides on Instance 1:
  // 1. Color override on root fill
  store.update(inst1.id, 'frame', { style: { fill: '#ff00ff' } })
  // 2. Typography override on Title: text and fontSize
  store.update(inst1Title.id, 'text', { text: 'Custom Heading', fontSize: 32 })
  // 3. Spacing override on cornerRadius
  store.update(inst1.id, 'frame', { cornerRadius: 28 })

  // Verify overrides on Instance 1
  assert.equal(store.getSnapshot().elements[inst1.id].style.fill, '#ff00ff')
  assert.equal(store.getSnapshot().elements[inst1.id].cornerRadius, 28)
  assert.equal(getLayer(inst1.id, 'card-title').text, 'Custom Heading')
  assert.equal(getLayer(inst1.id, 'card-title').fontSize, 32)

  // Verify Instance 2 is completely untouched
  assert.equal(store.getSnapshot().elements[inst2.id].style.fill, '#ffffff')
  assert.equal(store.getSnapshot().elements[inst2.id].cornerRadius, 12)
  assert.equal(getLayer(inst2.id, 'card-title').text, 'Card Title')
  assert.equal(getLayer(inst2.id, 'card-title').fontSize, 20)

  // Now update Master Component on both overridden and un-overridden channels:
  // Master updates un-overridden stroke and height
  store.update('master-card', 'frame', { height: 300, style: { stroke: { color: '#ef4444', width: 3, dash: [] } } })
  // Master updates Title text (overridden on Inst 1, un-overridden on Inst 2)
  store.update('card-title', 'text', { text: 'Universal Header' })
  // Master updates Body text
  store.update('card-body', 'text', { text: 'New universal body content.' })

  // Verify Instance 1 preserves all overrides:
  const post1Root = store.getSnapshot().elements[inst1.id]
  const post1Title = getLayer(inst1.id, 'card-title')
  const post1Body = getLayer(inst1.id, 'card-body')

  assert.equal(post1Root.style.fill, '#ff00ff', 'Root fill override must be preserved')
  assert.equal(post1Root.cornerRadius, 28, 'Corner radius override must be preserved')
  assert.equal(post1Title.text, 'Custom Heading', 'Title text override must be preserved')
  assert.equal(post1Title.fontSize, 32, 'Title font size override must be preserved')

  // But Instance 1 receives un-overridden master updates:
  assert.equal(post1Root.height, 300, 'Un-overridden height must update from master')
  assert.equal(post1Root.style.stroke?.color, '#ef4444', 'Un-overridden stroke color must update from master')
  assert.equal(post1Root.style.stroke?.width, 3, 'Un-overridden stroke width must update from master')
  assert.equal(post1Body.text, 'New universal body content.', 'Un-overridden body text must update from master')

  // Verify Instance 2 receives all master updates:
  const post2Root = store.getSnapshot().elements[inst2.id]
  const post2Title = getLayer(inst2.id, 'card-title')
  assert.equal(post2Root.height, 300)
  assert.equal(post2Title.text, 'Universal Header')
})

test('variant matrix state switching with scoped tokens and override preservation', () => {
  const store = new SceneStore()
  ensureStandardModes(store)

  const tokenPrimary = store.addToken({
    type: 'color',
    name: 'btn-primary',
    value: '#3b82f6',
    themeValues: { dark: '#60a5fa' },
  })

  const tokenDanger = store.addToken({
    type: 'color',
    name: 'btn-danger',
    value: '#ef4444',
    themeValues: { dark: '#f87171' },
  })

  // Create Master Button
  store.add('frame', { id: 'btn-master', name: 'Button Master', x: 100, y: 100, width: 140, height: 44, cornerRadius: 8, style: { fill: '#3b82f6' } })
  store.add('text', { id: 'btn-label', parentId: 'btn-master', name: 'Button Label', text: 'Action', x: 20, y: 12, fontSize: 16, style: { fill: '#ffffff' } })
  store.bindToken('btn-master', 'fill', tokenPrimary.id)
  store.createComponent('btn-master')

  // Define Variant Matrix with Size and Intent dimensions
  store.setVariantMatrix('btn-master', {
    dimensions: [
      { id: 'dim-size', name: 'Size', values: ['sm', 'md', 'lg'], defaultValue: 'md' },
      { id: 'dim-intent', name: 'Intent', values: ['primary', 'danger'], defaultValue: 'primary' },
    ],
    combinations: [
      // Size sm
      {
        id: 'comb-sm',
        dimensions: { Size: 'sm' },
        layers: {
          'btn-master': { properties: { width: 100, height: 32 } },
          'btn-label': { properties: { fontSize: 12 } },
        },
      },
      // Size lg
      {
        id: 'comb-lg',
        dimensions: { Size: 'lg' },
        layers: {
          'btn-master': { properties: { width: 180, height: 56 } },
          'btn-label': { properties: { fontSize: 20 } },
        },
      },
      // Danger intent
      {
        id: 'comb-danger',
        dimensions: { Intent: 'danger' },
        layers: {
          'btn-master': { tokenBindings: { fill: tokenDanger.id } },
        },
      },
    ],
  })

  // Create Instance in Dark mode
  const inst = store.createComponentInstance('btn-master', { x: 400, y: 100 })
  store.setElementThemeMode(inst.id, 'dark')

  const getSublayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  // Local override on label text
  store.update(getSublayer(inst.id, 'btn-label').id, 'text', { text: 'Delete File' })

  // Initial MD / Primary in Dark mode:
  assert.equal(store.getSnapshot().elements[inst.id].style.fill, '#60a5fa') // Dark primary
  assert.equal(store.getSnapshot().elements[inst.id].width, 140)
  assert.equal(getSublayer(inst.id, 'btn-label').text, 'Delete File')
  assert.equal(getSublayer(inst.id, 'btn-label').fontSize, 16)

  // Switch Size to 'lg'
  store.setComponentProperty(inst.id, 'Size', 'lg')
  assert.equal(store.getSnapshot().elements[inst.id].width, 180)
  assert.equal(getSublayer(inst.id, 'btn-label').fontSize, 20)
  assert.equal(getSublayer(inst.id, 'btn-label').text, 'Delete File', 'Local label override must be preserved across size switch')

  // Switch Intent to 'danger'
  store.setComponentProperty(inst.id, 'Intent', 'danger')
  assert.equal(store.getSnapshot().elements[inst.id].style.fill, '#f87171', 'Danger token in dark mode must be resolved')
  assert.equal(store.getSnapshot().elements[inst.id].width, 180, 'Size lg dimensions must be preserved')
  assert.equal(getSublayer(inst.id, 'btn-label').text, 'Delete File', 'Local label override must be preserved across intent switch')

  // Switch Size to 'sm'
  store.setComponentProperty(inst.id, 'Size', 'sm')
  assert.equal(store.getSnapshot().elements[inst.id].width, 100)
  assert.equal(getSublayer(inst.id, 'btn-label').fontSize, 12)
  assert.equal(store.getSnapshot().elements[inst.id].style.fill, '#f87171')
  assert.equal(getSublayer(inst.id, 'btn-label').text, 'Delete File')
})

test('nested scoped theme mode inheritance and token propagation within instance hierarchy', () => {
  const { store, tokens } = createCardMasterWithTokens()

  const inst = store.createComponentInstance('master-card', { x: 500, y: 100 })

  const getLayer = (instanceId, sourceId) =>
    subtree(store.getSnapshot().elements, instanceId).find(n => n.component?.sourceId === sourceId)

  const instHeader = getLayer(inst.id, 'card-header')
  const instTitle = getLayer(inst.id, 'card-title')
  const instBody = getLayer(inst.id, 'card-body')

  // Instance is in Light mode. Set Header Frame inside Instance to 'dark'
  store.setElementThemeMode(instHeader.id, 'dark')

  // Header Title inherits Dark mode from Header Frame:
  assert.equal(store.getElementEffectiveThemeMode(instHeader.id), 'dark')
  assert.equal(store.getElementEffectiveThemeMode(instTitle.id), 'dark')
  assert.equal(store.getSnapshot().elements[instTitle.id].style.fill, '#f8fafc', 'Title in dark header must resolve dark text token')

  // Outer Card and Card Body remain in Light mode:
  assert.equal(store.getElementEffectiveThemeMode(inst.id), null)
  assert.equal(store.getElementEffectiveThemeMode(instBody.id), null)
  assert.equal(store.getSnapshot().elements[inst.id].style.fill, '#ffffff', 'Card root must remain in light mode')
  assert.equal(store.getSnapshot().elements[instBody.id].style.fill, '#1e293b', 'Card body must remain in light mode')

  // Update token values for both Light and Dark
  store.updateToken(tokens.colorText.id, { value: '#334155' })
  store.setTokenThemeValue(tokens.colorText.id, 'dark', '#ffffff')

  // Propagates accurately to each scoped layer:
  assert.equal(store.getSnapshot().elements[instTitle.id].style.fill, '#ffffff', 'Dark header title must update to new dark text token')
  assert.equal(store.getSnapshot().elements[instBody.id].style.fill, '#334155', 'Light body text must update to new light text token')
})

test('bidirectional master sync: push local token and themeMode overrides back to master', () => {
  const { store, tokens } = createCardMasterWithTokens()

  const inst1 = store.createComponentInstance('master-card', { x: 500, y: 100 })
  const inst2 = store.createComponentInstance('master-card', { x: 900, y: 100 })

  // Override themeMode and bind a different token on inst1
  store.setElementThemeMode(inst1.id, 'dark')
  store.bindToken(inst1.id, 'fill', tokens.colorBadge.id)

  // Verify override diff reports themeMode and token binding
  const diffs = getComponentOverrideDiff(
    store.getSnapshot().elements[inst1.id],
    store.getSnapshot().elements['master-card'],
    store.getSnapshot().tokens,
    store.getSnapshot().styleLibrary,
    store.getSnapshot().elements
  )

  assert.ok(diffs.some(d => d.channel === 'themeMode' && d.overrideValue === 'dark'))
  assert.ok(diffs.some(d => d.channel === 'tokenBindings.fill' && d.overrideValue === tokens.colorBadge.id))

  // Push overrides to master
  store.pushOverridesToMaster(inst1.id)

  const masterPost = store.getSnapshot().elements['master-card']
  assert.equal(masterPost.themeMode, 'dark', 'Master must adopt pushed theme mode')
  assert.equal(masterPost.tokenBindings?.fill, tokens.colorBadge.id, 'Master must adopt pushed token binding')

  // Instance 1 overrides are cleared
  assert.deepEqual(store.getSnapshot().elements[inst1.id].component?.overrides, {})

  // Sibling Instance 2 automatically inherits the new master token binding!
  assert.equal(store.getSnapshot().elements[inst2.id].tokenBindings?.fill, tokens.colorBadge.id)
})
