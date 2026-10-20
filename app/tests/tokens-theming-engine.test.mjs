import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { resolveTokens } from '../src/tokens/library.ts'
import { tokenCSSValue, tokenVariable } from '../src/tokens/model.ts'
import {
  STANDARD_THEMES,
  ensureStandardModes,
  switchThemeMode,
  buildTokenModeMatrix,
  autoBindMatchingNodes,
  createTokenFromNode,
  getNodesBoundToToken,
} from '../src/tokens/engine.ts'
import {
  exportToTailwindV4,
  exportToTailwindV3,
  exportToCSSVariables,
  exportToDTCGJson,
  exportToTypeScript,
  importTokensFromCode,
} from '../src/tokens/export.ts'

function createTestScene() {
  const store = new SceneStore()
  store.add('rectangle', { id: 'card', width: 320, height: 200, cornerRadius: 8, style: { fill: '#ffffff', stroke: { color: '#e2e8f0', width: 1, dash: [] } } })
  store.add('text', { id: 'heading', fontSize: 24, fontFamily: 'Inter, sans-serif', fontWeight: 700, style: { fill: '#0f172a' } })
  store.add('text', { id: 'body', fontSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: 400, style: { fill: '#64748b' } })
  return store
}

test('multi-mode engine initializes standard modes and switches active themes seamlessly', () => {
  const store = createTestScene()
  assert.equal(store.getSnapshot().styleLibrary.themes.length, 0)

  // 1. Ensure standard modes (Light, Dark, High-Contrast)
  const modes = ensureStandardModes(store)
  assert.equal(modes.length, 3)
  assert.deepEqual(modes.map(m => m.id), ['light', 'dark', 'high-contrast'])
  assert.deepEqual(modes.map(m => m.name), ['Light', 'Dark', 'High-Contrast'])

  // Calling it again is idempotent
  ensureStandardModes(store)
  assert.equal(store.getSnapshot().styleLibrary.themes.length, 3)

  // 2. Add tokens with multi-mode overrides
  const bg = store.addToken({ type: 'color', name: 'bg-canvas', value: '#ffffff' })
  const text = store.addToken({ type: 'color', name: 'text-primary', value: '#0f172a' })

  store.setTokenThemeValue(bg.id, 'dark', '#090d16')
  store.setTokenThemeValue(text.id, 'dark', '#f8fafc')

  store.setTokenThemeValue(bg.id, 'high-contrast', '#000000')
  store.setTokenThemeValue(text.id, 'high-contrast', '#ffffff')

  // Bind to scene nodes
  store.bindToken('card', 'fill', bg.id)
  store.bindToken('heading', 'fill', text.id)

  // Initial (base) mode values
  assert.equal(store.getSnapshot().elements.card.style.fill, '#ffffff')
  assert.equal(store.getSnapshot().elements.heading.style.fill, '#0f172a')

  // Switch to Dark mode
  switchThemeMode(store, 'dark')
  assert.equal(store.getSnapshot().styleLibrary.activeThemeId, 'dark')
  assert.equal(store.getSnapshot().elements.card.style.fill, '#090d16')
  assert.equal(store.getSnapshot().elements.heading.style.fill, '#f8fafc')

  // Switch to High-Contrast mode
  switchThemeMode(store, 'high-contrast')
  assert.equal(store.getSnapshot().styleLibrary.activeThemeId, 'high-contrast')
  assert.equal(store.getSnapshot().elements.card.style.fill, '#000000')
  assert.equal(store.getSnapshot().elements.heading.style.fill, '#ffffff')

  // Switch back to Base mode (null)
  switchThemeMode(store, null)
  assert.equal(store.getSnapshot().styleLibrary.activeThemeId, null)
  assert.equal(store.getSnapshot().elements.card.style.fill, '#ffffff')
  assert.equal(store.getSnapshot().elements.heading.style.fill, '#0f172a')
})

test('token aliasing resolves chains and mode-specific alias redirects', () => {
  const store = createTestScene()
  ensureStandardModes(store)

  // Primitive color tokens
  const blue500 = store.addToken({ type: 'color', name: 'blue-500', value: '#3b82f6' })
  const blue400 = store.addToken({ type: 'color', name: 'blue-400', value: '#60a5fa' })
  const yellow400 = store.addToken({ type: 'color', name: 'yellow-400', value: '#facc15' })

  // Semantic token aliased to blue-500 by default
  const brandPrimary = store.addToken({ type: 'color', name: 'brand-primary', value: '#000000', aliasId: blue500.id })

  // In dark mode, alias to blue-400; in high-contrast, alias to yellow-400
  store.setTokenThemeAlias(brandPrimary.id, 'dark', blue400.id)
  store.setTokenThemeAlias(brandPrimary.id, 'high-contrast', yellow400.id)

  // Higher-level component token aliased to brand-primary (chain: btnBg -> brandPrimary -> blue500)
  const buttonBg = store.addToken({ type: 'color', name: 'button-bg', value: '#000000', aliasId: brandPrimary.id })

  store.bindToken('card', 'fill', buttonBg.id)

  // Base mode
  assert.equal(store.getSnapshot().elements.card.style.fill, '#3b82f6')

  // Dark mode (btnBg -> brandPrimary -> blue-400)
  switchThemeMode(store, 'dark')
  assert.equal(store.getSnapshot().elements.card.style.fill, '#60a5fa')

  // High-contrast mode (btnBg -> brandPrimary -> yellow-400)
  switchThemeMode(store, 'high-contrast')
  assert.equal(store.getSnapshot().elements.card.style.fill, '#facc15')

  // Reset theme
  switchThemeMode(store, null)
  assert.equal(store.getSnapshot().elements.card.style.fill, '#3b82f6')
})

test('token aliasing cycle detection prevents recursive loops', () => {
  const store = createTestScene()
  const a = store.addToken({ type: 'color', name: 'token-a', value: '#111111' })
  const b = store.addToken({ type: 'color', name: 'token-b', value: '#222222', aliasId: a.id })

  // Direct cycle: a -> b while b -> a
  assert.throws(
    () => store.updateToken(a.id, { aliasId: b.id }),
    /cycle/i
  )

  // Self-referencing cycle: a -> a
  assert.throws(
    () => store.updateToken(a.id, { aliasId: a.id }),
    /cycle/i
  )

  // Incompatible types: color aliased to radius
  const radius = store.addToken({ type: 'radius', name: 'card-radius', value: 8 })
  assert.throws(
    () => store.updateToken(a.id, { aliasId: radius.id }),
    /same type/i
  )
})

test('theme management: renameTheme, removeTheme with cleanup, and token deletion safety', () => {
  const store = createTestScene()
  const customId = store.addTheme('Brand Theme', 'brand-theme')
  assert.equal(customId, 'brand-theme')

  // Rename theme
  store.renameTheme('brand-theme', 'Corporate Brand')
  assert.equal(store.getSnapshot().styleLibrary.themes.find(t => t.id === 'brand-theme')?.name, 'Corporate Brand')

  const baseToken = store.addToken({ type: 'color', name: 'brand-accent', value: '#2563eb' })
  const targetToken = store.addToken({ type: 'color', name: 'brand-highlight', value: '#f59e0b' })

  store.setTokenThemeValue(baseToken.id, 'brand-theme', '#1d4ed8')
  store.setTokenThemeAlias(baseToken.id, 'brand-theme', targetToken.id)

  assert.equal(store.getSnapshot().tokens.find(t => t.id === baseToken.id)?.themeValues?.['brand-theme'], '#1d4ed8')
  assert.equal(store.getSnapshot().tokens.find(t => t.id === baseToken.id)?.themeAliases?.['brand-theme'], targetToken.id)

  // Remove theme cleans up themeValues and themeAliases without errors
  store.removeTheme('brand-theme')
  const afterRemoveTheme = store.getSnapshot().tokens.find(t => t.id === baseToken.id)
  assert.equal(afterRemoveTheme?.themeValues?.['brand-theme'], undefined)
  assert.equal(afterRemoveTheme?.themeAliases?.['brand-theme'], undefined)

  // Deleting alias target safely cleans up references
  const main = store.addToken({ type: 'color', name: 'main-color', value: '#111111' })
  const sub = store.addToken({ type: 'color', name: 'sub-color', value: '#222222', aliasId: main.id })
  assert.equal(store.getSnapshot().tokens.find(t => t.id === sub.id)?.aliasId, main.id)

  store.removeTokens([main.id])
  const subAfter = store.getSnapshot().tokens.find(t => t.id === sub.id)
  assert.equal(subAfter?.aliasId, undefined)
  assert.equal(subAfter?.value, '#111111') // Retains materialized value
})

test('auto-bind matching nodes scans and links canvas shapes to existing tokens', () => {
  const store = createTestScene()

  // Existing tokens
  const white = store.addToken({ type: 'color', name: 'white', value: '#ffffff' })
  const slateBorder = store.addToken({ type: 'color', name: 'border-slate', value: '#e2e8f0' })
  const radiusSm = store.addToken({ type: 'radius', name: 'radius-sm', value: 8 })
  const titleSize = store.addToken({ type: 'fontSize', name: 'text-2xl', value: 24 })
  const bodySize = store.addToken({ type: 'fontSize', name: 'text-base', value: 16 })
  const inter = store.addToken({ type: 'fontFamily', name: 'font-inter', value: 'Inter, sans-serif' })
  const bold = store.addToken({ type: 'fontWeight', name: 'font-bold', value: 700 })

  // Nodes are initially unbound
  assert.equal(store.getSnapshot().elements.card.tokenBindings, undefined)
  assert.equal(store.getSnapshot().elements.heading.tokenBindings, undefined)

  // Run auto-binding
  const result = autoBindMatchingNodes(store)
  assert.ok(result.boundCount >= 6, `Expected at least 6 bindings, got ${result.boundCount}`)
  assert.ok(result.matchedTokens.includes('white'))
  assert.ok(result.matchedTokens.includes('border-slate'))
  assert.ok(result.matchedTokens.includes('radius-sm'))
  assert.ok(result.matchedTokens.includes('text-2xl'))

  // Verify node bindings
  const card = store.getSnapshot().elements.card
  assert.equal(card.tokenBindings.fill, white.id)
  assert.equal(card.tokenBindings.stroke, slateBorder.id)
  assert.equal(card.tokenBindings.cornerRadius, radiusSm.id)

  const heading = store.getSnapshot().elements.heading
  assert.equal(heading.tokenBindings.fontSize, titleSize.id)
  assert.equal(heading.tokenBindings.fontFamily, inter.id)
  assert.equal(heading.tokenBindings.fontWeight, bold.id)
})

test('createTokenFromNode extracts styles and binds nodes directly', () => {
  const store = createTestScene()
  const heading = store.getSnapshot().elements.heading

  // Extract color
  const colorToken = createTokenFromNode(store, heading, 'fill', 'text-headline')
  assert.ok(colorToken)
  assert.equal(colorToken.type, 'color')
  assert.equal(colorToken.name, 'text-headline')
  assert.equal(colorToken.value, '#0f172a')

  // Verify node was immediately bound
  assert.equal(store.getSnapshot().elements.heading.tokenBindings?.fill, colorToken.id)

  // Extract corner radius from card
  const card = store.getSnapshot().elements.card
  const radiusToken = createTokenFromNode(store, card, 'cornerRadius', 'card-roundness')
  assert.ok(radiusToken)
  assert.equal(radiusToken.type, 'radius')
  assert.equal(radiusToken.name, 'card-roundness')
  assert.equal(radiusToken.value, 8)
  assert.equal(store.getSnapshot().elements.card.tokenBindings?.cornerRadius, radiusToken.id)
})

test('buildTokenModeMatrix computes multi-mode rows, inheritance flags, and bound usage counts', () => {
  const store = createTestScene()
  ensureStandardModes(store)

  const primary = store.addToken({ type: 'color', name: 'primary', value: '#2563eb' })
  store.setTokenThemeValue(primary.id, 'dark', '#3b82f6')
  store.bindToken('card', 'fill', primary.id)

  const matrix = buildTokenModeMatrix(store.getSnapshot().tokens, store.getSnapshot().styleLibrary, store.getSnapshot().elements)
  const primaryRow = matrix.find(r => r.token.id === primary.id)

  assert.ok(primaryRow)
  assert.equal(primaryRow.baseValue, '#2563eb')
  assert.equal(primaryRow.boundCount, 1)
  assert.equal(primaryRow.modeValues['dark'].value, '#3b82f6')
  assert.equal(primaryRow.modeValues['dark'].isOverridden, true)
  assert.equal(primaryRow.modeValues['light'].isInherited, true)

  const boundNodes = getNodesBoundToToken(store.getSnapshot().elements, primary.id)
  assert.equal(boundNodes.length, 1)
  assert.equal(boundNodes[0].id, 'card')
})

test('one-click Tailwind CSS v4 export outputs @theme and @layer base multi-mode rules', () => {
  const store = createTestScene()
  ensureStandardModes(store)

  const bg = store.addToken({ type: 'color', name: 'surface', value: '#ffffff' })
  const border = store.addToken({ type: 'color', name: 'border', value: '#e2e8f0', aliasId: bg.id })
  const radius = store.addToken({ type: 'radius', name: 'card', value: 12 })
  const fontSize = store.addToken({ type: 'fontSize', name: 'title', value: 20 })

  store.setTokenThemeValue(bg.id, 'dark', '#0f172a')
  store.setTokenThemeValue(bg.id, 'high-contrast', '#000000')

  const twV4 = exportToTailwindV4(store.getSnapshot().tokens, store.getSnapshot().styleLibrary)

  assert.ok(twV4.includes('@theme {'))
  assert.ok(twV4.includes('--color-surface: #ffffff;'))
  assert.ok(twV4.includes('--color-border: var(--color-surface);'))
  assert.ok(twV4.includes('--radius-card: 12px;'))
  assert.ok(twV4.includes('--text-title: 20px;'))

  assert.ok(twV4.includes('@layer base {'))
  assert.ok(twV4.includes('[data-theme="dark"], [data-paper-theme="dark"], .dark {'))
  assert.ok(twV4.includes('--color-surface: #0f172a;'))
  assert.ok(twV4.includes('[data-theme="high-contrast"], [data-paper-theme="high-contrast"], .high-contrast {'))
  assert.ok(twV4.includes('--color-surface: #000000;'))
})

test('one-click CSS custom properties export outputs :root and multi-mode theme selectors', () => {
  const store = createTestScene()
  ensureStandardModes(store)

  const brand = store.addToken({ type: 'color', name: 'brand-accent', value: '#81adec' })
  store.setTokenThemeValue(brand.id, 'dark', '#2563eb')

  const css = exportToCSSVariables(store.getSnapshot().tokens, store.getSnapshot().styleLibrary)

  assert.ok(css.includes(':root {'))
  assert.ok(css.includes('--color-brand-accent: #81adec;'))
  assert.ok(css.includes('[data-theme="dark"], [data-paper-theme="dark"], .dark {'))
  assert.ok(css.includes('--color-brand-accent: #2563eb;'))
})

test('one-click DTCG JSON and TypeScript exporters produce valid structured definitions', () => {
  const store = createTestScene()
  ensureStandardModes(store)

  const primary = store.addToken({ type: 'color', name: 'primary', value: '#2563eb' })
  const spacing = store.addToken({ type: 'spacing', name: 'padding-lg', value: 24 })
  store.setTokenThemeValue(primary.id, 'dark', '#60a5fa')

  // DTCG JSON
  const jsonStr = exportToDTCGJson(store.getSnapshot().tokens, store.getSnapshot().styleLibrary)
  const dtcg = JSON.parse(jsonStr)
  assert.equal(dtcg.name, 'Paper Design System Variables')
  assert.equal(dtcg.color.primary.$type, 'color')
  assert.equal(dtcg.color.primary.$value, '#2563eb')
  assert.equal(dtcg.spacing['padding-lg'].$type, 'dimension')
  assert.equal(dtcg.$modes.dark.overrides.color.primary, '#60a5fa')

  // TypeScript
  const tsCode = exportToTypeScript(store.getSnapshot().tokens, store.getSnapshot().styleLibrary)
  assert.ok(tsCode.includes('export const tokens = {'))
  assert.ok(tsCode.includes("'primary': '#2563eb'"))
  assert.ok(tsCode.includes("'padding-lg': 24"))
  assert.ok(tsCode.includes("export const themeOverrides = {"))
  assert.ok(tsCode.includes("export type ColorToken = keyof typeof tokens.color"))
  assert.ok(tsCode.includes("export function tokenVariable(type: keyof typeof tokens, name: string): string"))
})

test('bi-directional token import parses CSS variables with theme modes into store', () => {
  const store = new SceneStore()

  const cssCode = `
    :root {
      --color-primary: #3b82f6;
      --color-accent: var(--color-primary);
      --radius-badge: 6px;
      --spacing-gap: 16px;
    }

    [data-theme="dark"] {
      --color-primary: #60a5fa;
    }
  `

  const result = importTokensFromCode(store, cssCode)
  assert.equal(result.errors.length, 0)
  assert.equal(result.importedCount, 4)

  const tokens = store.getSnapshot().tokens
  const primary = tokens.find(t => t.name === 'primary')
  const accent = tokens.find(t => t.name === 'accent')
  const radius = tokens.find(t => t.name === 'badge')
  const spacing = tokens.find(t => t.name === 'gap')

  assert.ok(primary)
  assert.equal(primary.value, '#3b82f6')
  assert.ok(accent)
  assert.equal(accent.aliasId, primary.id)
  assert.ok(radius)
  assert.equal(radius.value, 6)
  assert.ok(spacing)
  assert.equal(spacing.value, 16)

  // Verify dark mode override was captured
  assert.equal(primary.themeValues?.['dark'], '#60a5fa')
})
