import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { resolveTokens } from '../src/tokens/library.ts'
import {
  MultiThemeTokenResolver,
  createMultiThemeTokenResolver,
  getEffectiveThemeMode,
  getElementModeContext,
  getModeDisplayName,
  normalizeModeId,
  resolveTokenAliasChain,
} from '../src/tokens/resolver.ts'
import {
  THEME_STYLE_TAG_ID,
  generateThemeTokensCSS,
  injectThemeTokensCSS,
} from '../src/tokens/injector.ts'
import { ensureStandardModes } from '../src/tokens/engine.ts'

function createTestScene() {
  const store = new SceneStore()
  ensureStandardModes(store)

  // 1. Primitive tokens
  const blue500 = store.addToken({ type: 'color', name: 'blue-500', value: '#3b82f6' })
  const blue400 = store.addToken({ type: 'color', name: 'blue-400', value: '#60a5fa' })
  const blue300 = store.addToken({ type: 'color', name: 'blue-300', value: '#93c5fd' })
  const yellow400 = store.addToken({ type: 'color', name: 'yellow-400', value: '#facc15' })

  const slate900 = store.addToken({ type: 'color', name: 'slate-900', value: '#0f172a' })
  const slate100 = store.addToken({ type: 'color', name: 'slate-100', value: '#f1f5f9' })
  const white = store.addToken({ type: 'color', name: 'white', value: '#ffffff' })
  const black = store.addToken({ type: 'color', name: 'black', value: '#000000' })

  // 2. Semantic tokens with multi-mode overrides and aliases
  // bg-canvas: Light=#ffffff, Dark=#0f172a, High-Contrast=#000000
  const bgCanvas = store.addToken({ type: 'color', name: 'bg-canvas', value: '#ffffff' })
  store.setTokenThemeValue(bgCanvas.id, 'dark', '#0f172a')
  store.setTokenThemeValue(bgCanvas.id, 'high-contrast', '#000000')

  // text-primary: Light=#0f172a, Dark=#f1f5f9, High-Contrast=#ffffff
  const textPrimary = store.addToken({ type: 'color', name: 'text-primary', value: '#0f172a' })
  store.setTokenThemeValue(textPrimary.id, 'dark', '#f1f5f9')
  store.setTokenThemeValue(textPrimary.id, 'high-contrast', '#ffffff')

  // brand-interactive: Aliased to blue-500 in Light, blue-400 in Dark, yellow-400 in High-Contrast
  const brandInteractive = store.addToken({
    type: 'color',
    name: 'brand-interactive',
    value: '#000000',
    aliasId: blue500.id,
  })
  store.setTokenThemeAlias(brandInteractive.id, 'dark', blue400.id)
  store.setTokenThemeAlias(brandInteractive.id, 'high-contrast', yellow400.id)

  // surface-accent: Aliased to brand-interactive (chain: surface-accent -> brand-interactive -> blue)
  const surfaceAccent = store.addToken({
    type: 'color',
    name: 'surface-accent',
    value: '#000000',
    aliasId: brandInteractive.id,
  })

  // Numeric tokens with mode overrides
  const cardRadius = store.addToken({ type: 'radius', name: 'card-radius', value: 8 })
  store.setTokenThemeValue(cardRadius.id, 'dark', 12)
  store.setTokenThemeValue(cardRadius.id, 'high-contrast', 0)

  return {
    store,
    tokens: {
      blue500,
      blue400,
      blue300,
      yellow400,
      slate900,
      slate100,
      white,
      black,
      bgCanvas,
      textPrimary,
      brandInteractive,
      surfaceAccent,
      cardRadius,
    },
  }
}

test('MultiThemeTokenResolver resolves deep token aliasing chains across modes', () => {
  const { store, tokens } = createTestScene()
  const snapshot = store.getSnapshot()
  const resolver = createMultiThemeTokenResolver(snapshot.tokens, snapshot.styleLibrary)

  // Available modes include standard Light, Dark, High-Contrast
  const modes = resolver.getAvailableModes()
  assert.equal(modes.length, 3)
  assert.deepEqual(modes.map(m => m.id), ['light', 'dark', 'high-contrast'])

  // 1. Base / Light mode resolution
  assert.equal(resolver.resolveTokenValue(tokens.surfaceAccent.id, 'light'), '#3b82f6')
  const lightChain = resolveTokenAliasChain(tokens.surfaceAccent.id, snapshot.tokens, 'light')
  assert.equal(lightChain.isAliased, true)
  assert.deepEqual(lightChain.chain, [tokens.surfaceAccent.id, tokens.brandInteractive.id, tokens.blue500.id])

  // 2. Dark mode resolution (surfaceAccent -> brandInteractive -> blue400)
  assert.equal(resolver.resolveTokenValue(tokens.surfaceAccent.id, 'dark'), '#60a5fa')
  const darkChain = resolveTokenAliasChain(tokens.surfaceAccent.id, snapshot.tokens, 'dark')
  assert.equal(darkChain.isAliased, true)
  assert.deepEqual(darkChain.chain, [tokens.surfaceAccent.id, tokens.brandInteractive.id, tokens.blue400.id])

  // 3. High-Contrast mode resolution (surfaceAccent -> brandInteractive -> yellow400)
  assert.equal(resolver.resolveTokenValue(tokens.surfaceAccent.id, 'high-contrast'), '#facc15')
  const hcChain = resolveTokenAliasChain(tokens.surfaceAccent.id, snapshot.tokens, 'high-contrast')
  assert.equal(hcChain.isAliased, true)
  assert.deepEqual(hcChain.chain, [tokens.surfaceAccent.id, tokens.brandInteractive.id, tokens.yellow400.id])

  // 4. Token detail diagnostics
  const detail = resolver.resolveTokenDetail(tokens.surfaceAccent.id, 'dark')
  assert.ok(detail)
  assert.equal(detail.name, 'surface-accent')
  assert.equal(detail.resolvedValue, '#60a5fa')
  assert.equal(detail.modeId, 'dark')
  assert.equal(detail.isAliased, true)
})

test('Canvas frames bind properties to design tokens with dynamic mode inheritance', () => {
  const { store, tokens } = createTestScene()

  // Create Dark Mode Frame
  const darkFrame = store.add('frame', {
    id: 'dark-frame',
    name: 'Dark Artboard',
    width: 400,
    height: 600,
    themeMode: 'dark',
    style: { fill: '#ffffff' },
  })

  // Create child rectangle inside dark frame bound to bg-canvas and card-radius
  const card = store.add('rectangle', {
    id: 'card-1',
    parentId: darkFrame.id,
    name: 'Card Layer',
    width: 320,
    height: 200,
    cornerRadius: 4,
    style: { fill: '#ffffff' },
  })

  store.bindToken('card-1', 'fill', tokens.bgCanvas.id)
  store.bindToken('card-1', 'cornerRadius', tokens.cardRadius.id)

  // Child rectangle inherits 'dark' mode from parent frame!
  assert.equal(store.getElementEffectiveThemeMode('card-1'), 'dark')
  assert.equal(store.getSnapshot().elements['card-1'].style.fill, '#0f172a') // Dark mode bgCanvas
  assert.equal(store.getSnapshot().elements['card-1'].cornerRadius, 12) // Dark mode cardRadius

  // Create nested Light Mode Frame inside the Dark frame
  const nestedLightFrame = store.add('frame', {
    id: 'nested-light-frame',
    parentId: darkFrame.id,
    name: 'Nested Light Container',
    width: 280,
    height: 150,
    themeMode: 'light',
  })

  // Child inside nested light frame inherits 'light' mode
  const badge = store.add('rectangle', {
    id: 'badge-1',
    parentId: nestedLightFrame.id,
    name: 'Light Badge',
    width: 80,
    height: 32,
    style: { fill: '#000000' },
  })
  store.bindToken('badge-1', 'fill', tokens.bgCanvas.id)
  store.bindToken('badge-1', 'cornerRadius', tokens.cardRadius.id)

  assert.equal(store.getElementEffectiveThemeMode('badge-1'), 'light')
  assert.equal(store.getSnapshot().elements['badge-1'].style.fill, '#ffffff') // Light mode bgCanvas
  assert.equal(store.getSnapshot().elements['badge-1'].cornerRadius, 8) // Light mode cardRadius

  // Now dynamically switch darkFrame mode to High-Contrast via store.setElementThemeMode
  store.setElementThemeMode(darkFrame.id, 'high-contrast')

  // card-1 automatically re-resolves to High-Contrast!
  assert.equal(store.getElementEffectiveThemeMode('card-1'), 'high-contrast')
  assert.equal(store.getSnapshot().elements['card-1'].style.fill, '#000000') // High-Contrast bgCanvas
  assert.equal(store.getSnapshot().elements['card-1'].cornerRadius, 0) // High-Contrast radius

  // badge-1 retains its explicit 'light' override from nestedLightFrame
  assert.equal(store.getElementEffectiveThemeMode('badge-1'), 'light')
  assert.equal(store.getSnapshot().elements['badge-1'].style.fill, '#ffffff')
  assert.equal(store.getSnapshot().elements['badge-1'].cornerRadius, 8)

  // Reset darkFrame mode back to inherit (null)
  store.setElementThemeMode(darkFrame.id, null)
  assert.equal(store.getElementEffectiveThemeMode('card-1'), null)
  assert.equal(store.getSnapshot().elements['card-1'].style.fill, '#ffffff') // Base / Document mode
  assert.equal(store.getSnapshot().elements['card-1'].cornerRadius, 8)
})

test('Component instances support independent variable mode overrides on the same canvas', () => {
  const { store, tokens } = createTestScene()

  // Create a Master Component button
  const masterFrame = store.add('frame', {
    id: 'master-button',
    name: 'Button Master',
    width: 140,
    height: 48,
    cornerRadius: 8,
    style: { fill: '#ffffff' },
  })
  const label = store.add('text', {
    id: 'master-label',
    parentId: masterFrame.id,
    name: 'Button Label',
    text: 'Click Me',
    fontSize: 16,
    fontFamily: 'Inter, sans-serif',
    style: { fill: '#000000' },
  })

  store.bindToken('master-button', 'fill', tokens.brandInteractive.id)
  store.bindToken('master-label', 'fill', tokens.textPrimary.id)

  store.createComponent(masterFrame.id)
  assert.equal(store.getSnapshot().elements['master-button'].component?.kind, 'master')

  // Instantiate Instance 1: Default / Inherit
  const instance1 = store.createComponentInstance(masterFrame.id, { x: 0, y: 0 })
  assert.ok(instance1)

  // Instantiate Instance 2: Override to 'dark'
  const instance2 = store.createComponentInstance(masterFrame.id, { x: 160, y: 0 })
  assert.ok(instance2)
  store.setElementThemeMode(instance2.id, 'dark')

  // Instantiate Instance 3: Override to 'high-contrast'
  const instance3 = store.createComponentInstance(masterFrame.id, { x: 320, y: 0 })
  assert.ok(instance3)
  store.setElementThemeMode(instance3.id, 'high-contrast')

  const snapshot = store.getSnapshot()

  // Instance 1 resolves to Light / Default values
  assert.equal(snapshot.elements[instance1.id].style.fill, '#3b82f6') // blue-500
  const inst1LabelId = snapshot.elements[instance1.id].children[0]
  assert.equal(snapshot.elements[inst1LabelId].style.fill, '#0f172a') // text-primary light

  // Instance 2 resolves to Dark mode values
  assert.equal(snapshot.elements[instance2.id].style.fill, '#60a5fa') // blue-400 in dark
  const inst2LabelId = snapshot.elements[instance2.id].children[0]
  assert.equal(snapshot.elements[inst2LabelId].style.fill, '#f1f5f9') // text-primary dark

  // Instance 3 resolves to High-Contrast mode values
  assert.equal(snapshot.elements[instance3.id].style.fill, '#facc15') // yellow-400 in HC
  const inst3LabelId = snapshot.elements[instance3.id].children[0]
  assert.equal(snapshot.elements[inst3LabelId].style.fill, '#ffffff') // text-primary HC

  // All 3 instances coexist simultaneously with distinct theme mode appearances!
  assert.notEqual(snapshot.elements[instance1.id].style.fill, snapshot.elements[instance2.id].style.fill)
  assert.notEqual(snapshot.elements[instance2.id].style.fill, snapshot.elements[instance3.id].style.fill)
})

test('Reparenting elements across mode boundaries dynamically re-evaluates bound tokens', () => {
  const { store, tokens } = createTestScene()

  const lightFrame = store.add('frame', {
    id: 'frame-light',
    name: 'Light Frame',
    width: 300,
    height: 300,
    themeMode: 'light',
  })

  const darkFrame = store.add('frame', {
    id: 'frame-dark',
    name: 'Dark Frame',
    width: 300,
    height: 300,
    themeMode: 'dark',
  })

  // Add rectangle in light frame
  const element = store.add('rectangle', {
    id: 'movable-rect',
    parentId: lightFrame.id,
    width: 100,
    height: 100,
    style: { fill: '#ffffff' },
  })
  store.bindToken('movable-rect', 'fill', tokens.bgCanvas.id)

  // Initially in light frame
  assert.equal(store.getSnapshot().elements['movable-rect'].style.fill, '#ffffff')

  // Reparent to dark frame
  store.reparent('movable-rect', darkFrame.id)
  assert.equal(store.getSnapshot().elements['movable-rect'].parentId, darkFrame.id)
  assert.equal(store.getElementEffectiveThemeMode('movable-rect'), 'dark')
  assert.equal(store.getSnapshot().elements['movable-rect'].style.fill, '#0f172a') // Auto-switched to dark!

  // Reparent to root canvas
  store.reparent('movable-rect', null)
  assert.equal(store.getSnapshot().elements['movable-rect'].parentId, null)
  assert.equal(store.getElementEffectiveThemeMode('movable-rect'), null)
  assert.equal(store.getSnapshot().elements['movable-rect'].style.fill, '#ffffff') // Reverted to default!
})

test('Real-time CSS custom property injection compiles scoped selectors and aliases', () => {
  const { store } = createTestScene()
  const snapshot = store.getSnapshot()

  const css = generateThemeTokensCSS(snapshot.tokens, snapshot.styleLibrary)

  // Contains :root
  assert.ok(css.includes(':root {'))

  // Contains scoped mode selectors
  assert.ok(css.includes('[data-theme-mode="light"]'))
  assert.ok(css.includes('[data-paper-theme="light"]'))
  assert.ok(css.includes('.theme-light'))

  assert.ok(css.includes('[data-theme-mode="dark"]'))
  assert.ok(css.includes('[data-paper-theme="dark"]'))
  assert.ok(css.includes('.theme-dark'))

  assert.ok(css.includes('[data-theme-mode="high-contrast"]'))
  assert.ok(css.includes('[data-paper-theme="high-contrast"]'))
  assert.ok(css.includes('.theme-high-contrast'))

  // Contains aliased variables in dark mode
  assert.ok(css.includes('--color-brand-interactive: var(--color-blue-400);'))

  // In headless test environment, injectThemeTokensCSS runs safely without crashing
  const cleanup = injectThemeTokensCSS(snapshot.tokens, snapshot.styleLibrary)
  assert.equal(typeof cleanup, 'function')
  cleanup()
})

test('ElementModeContext diagnostics report accurate inheritance sources and overrides', () => {
  const { store } = createTestScene()

  const rootFrame = store.add('frame', {
    id: 'root-f',
    name: 'Root Artboard',
    width: 500,
    height: 500,
    themeMode: 'dark',
  })

  const childFrame = store.add('frame', {
    id: 'child-f',
    parentId: rootFrame.id,
    name: 'Child Container',
    width: 300,
    height: 300,
  })

  const leafElement = store.add('rectangle', {
    id: 'leaf-el',
    parentId: childFrame.id,
    name: 'Leaf Node',
    width: 100,
    height: 100,
  })

  // Diagnostics on leafElement
  const leafContext = store.getElementThemeModeContext('leaf-el')
  assert.equal(leafContext.effectiveMode, 'dark')
  assert.equal(leafContext.isInherited, true)
  assert.equal(leafContext.isOverridden, false)
  assert.equal(leafContext.sourceElementId, 'root-f')

  // Override childFrame to 'light'
  store.setElementThemeMode('child-f', 'light')

  const updatedLeafContext = store.getElementThemeModeContext('leaf-el')
  assert.equal(updatedLeafContext.effectiveMode, 'light')
  assert.equal(updatedLeafContext.isInherited, true)
  assert.equal(updatedLeafContext.sourceElementId, 'child-f')

  const childContext = store.getElementThemeModeContext('child-f')
  assert.equal(childContext.effectiveMode, 'light')
  assert.equal(childContext.isInherited, false)
  assert.equal(childContext.isOverridden, true)
  assert.equal(childContext.inheritedMode, 'dark')

  // Helper utility functions
  assert.equal(normalizeModeId('Dark'), 'dark')
  assert.equal(normalizeModeId('  LIGHT  '), 'light')
  assert.equal(normalizeModeId('high-contrast'), 'high-contrast')
  assert.equal(normalizeModeId('inherit'), null)
  assert.equal(normalizeModeId(''), null)
  assert.equal(getModeDisplayName('dark'), 'Dark')
  assert.equal(getModeDisplayName(null), 'Inherit')
})

test('setElementThemeMode supports full undo and redo lifecycle', () => {
  const { store, tokens } = createTestScene()

  const frame = store.add('frame', {
    id: 'f-undo',
    name: 'Undo Frame',
    width: 400,
    height: 400,
  })

  const rect = store.add('rectangle', {
    id: 'rect-undo',
    parentId: frame.id,
    width: 200,
    height: 200,
    style: { fill: '#ffffff' },
  })
  store.bindToken('rect-undo', 'fill', tokens.bgCanvas.id)

  // Initial state: default / light (#ffffff)
  assert.equal(store.getSnapshot().elements['rect-undo'].style.fill, '#ffffff')
  assert.equal(store.getElementEffectiveThemeMode(frame.id), null)

  // Switch frame to 'dark'
  store.setElementThemeMode(frame.id, 'dark')
  assert.equal(store.getElementEffectiveThemeMode(frame.id), 'dark')
  assert.equal(store.getSnapshot().elements['rect-undo'].style.fill, '#0f172a')

  // Undo -> reverts to null / light (#ffffff)
  store.undo()
  assert.equal(store.getElementEffectiveThemeMode(frame.id), null)
  assert.equal(store.getSnapshot().elements['rect-undo'].style.fill, '#ffffff')

  // Redo -> updates back to 'dark' (#0f172a)
  store.redo()
  assert.equal(store.getElementEffectiveThemeMode(frame.id), 'dark')
  assert.equal(store.getSnapshot().elements['rect-undo'].style.fill, '#0f172a')
})

test('setElementThemeMode enforces validation and locking boundaries', () => {
  const { store } = createTestScene()

  const frame = store.add('frame', {
    id: 'locked-f',
    name: 'Locked Frame',
    width: 200,
    height: 200,
  })

  // Invalid theme mode values
  assert.throws(() => store.setElementThemeMode(frame.id, '   '), /invalid theme mode/i)
  assert.throws(() => store.setElementThemeMode(frame.id, 'x'.repeat(250)), /invalid theme mode/i)

  // Locked element
  store.setLocked(frame.id, true)
  assert.throws(() => store.setElementThemeMode(frame.id, 'dark'), /locked/i)
})

test('nested component instance inside dark frame inherits mode unless explicitly overridden', () => {
  const { store, tokens } = createTestScene()

  // Master component
  const master = store.add('frame', {
    id: 'badge-master',
    name: 'Badge Master',
    width: 100,
    height: 36,
    style: { fill: '#ffffff' },
  })
  const text = store.add('text', {
    id: 'badge-text',
    parentId: master.id,
    name: 'Badge Text',
    text: 'Active',
    style: { fill: '#000000' },
  })
  store.bindToken(master.id, 'fill', tokens.bgCanvas.id)
  store.bindToken(text.id, 'fill', tokens.textPrimary.id)
  store.createComponent(master.id)

  // Dark frame container
  const darkFrame = store.add('frame', {
    id: 'dark-canvas-frame',
    name: 'Dark Canvas Frame',
    width: 600,
    height: 400,
    themeMode: 'dark',
  })

  // Instance A: inside dark frame without override -> inherits dark!
  const instanceA = store.createComponentInstance(master.id, { x: 20, y: 20 })
  store.reparent(instanceA.id, darkFrame.id)
  assert.equal(store.getElementEffectiveThemeMode(instanceA.id), 'dark')
  assert.equal(store.getSnapshot().elements[instanceA.id].style.fill, '#0f172a') // dark bgCanvas

  // Instance B: inside dark frame WITH explicit override to 'high-contrast'
  const instanceB = store.createComponentInstance(master.id, { x: 140, y: 20 })
  store.reparent(instanceB.id, darkFrame.id)
  store.setElementThemeMode(instanceB.id, 'high-contrast')
  assert.equal(store.getElementEffectiveThemeMode(instanceB.id), 'high-contrast')
  assert.equal(store.getSnapshot().elements[instanceB.id].style.fill, '#000000') // HC bgCanvas
})

