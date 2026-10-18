import type { DesignToken, TokenInput } from './types.ts'
import { tokenVariable } from './model.ts'
import type { SceneStore } from '../scene/store.ts'

/**
 * Foundation token definitions across color, typography, spacing, radius, and elevation.
 * Existing tokens in the document are reused, never overwritten.
 */
export function foundationTokens(
  existing: readonly DesignToken[],
  availableThemeIds?: ReadonlySet<string>
): TokenInput[] {
  const hasDark = availableThemeIds?.has('dark') ?? false
  const hasHC = availableThemeIds?.has('high-contrast') ?? false

  const themeValuesFor = (darkVal?: string | number, hcVal?: string | number) => {
    const vals: Record<string, string | number> = {}
    if (hasDark && darkVal !== undefined) vals.dark = darkVal
    if (hasHC && hcVal !== undefined) vals['high-contrast'] = hcVal
    return Object.keys(vals).length > 0 ? vals : undefined
  }

  const definitions: (TokenInput & { aliasName?: string; modeOverrides?: { dark?: string | number; hc?: string | number } })[] = [
    // Base & Semantic Colors
    {
      type: 'color', name: 'paper', value: '#edebe1', palette: 'Paper',
      modeOverrides: { dark: '#0c0c0c', hc: '#000000' }
    },
    {
      type: 'color', name: 'ink', value: '#080808', palette: 'Paper',
      modeOverrides: { dark: '#f5f4ef', hc: '#ffffff' }
    },
    {
      type: 'color', name: 'blue', value: '#81adec', palette: 'Paper',
      modeOverrides: { dark: '#9ec0f3', hc: '#00e5ff' }
    },
    {
      type: 'color', name: 'charcoal', value: '#222222', palette: 'Paper',
      modeOverrides: { dark: '#181818', hc: '#111111' }
    },
    {
      type: 'color', name: 'border', value: '#d8d5cb', palette: 'Paper',
      modeOverrides: { dark: '#262626', hc: '#ffffff' }
    },
    {
      type: 'color', name: 'muted', value: '#76746e', palette: 'Paper',
      modeOverrides: { dark: '#98968f', hc: '#ffff00' }
    },
    {
      type: 'color', name: 'surface', value: '#edebe1', aliasName: 'paper', palette: 'Semantic'
    },
    {
      type: 'color', name: 'content', value: '#080808', aliasName: 'ink', palette: 'Semantic'
    },
    {
      type: 'color', name: 'action', value: '#81adec', aliasName: 'blue', palette: 'Semantic'
    },

    // Typography
    { type: 'fontFamily', name: 'sans', value: 'Inter, sans-serif' },
    { type: 'fontFamily', name: 'mono', value: 'JetBrains Mono, monospace' },
    ...[
      ['caption', 12],
      ['small', 14],
      ['body', 16],
      ['heading', 24],
      ['display', 48],
    ].map(([name, value]) => ({
      type: 'fontSize' as const,
      name: name as string,
      value: value as number,
    })),
    { type: 'fontWeight', name: 'regular', value: 400 },
    { type: 'fontWeight', name: 'medium', value: 500 },
    { type: 'fontWeight', name: 'bold', value: 700 },
    { type: 'lineHeight', name: 'tight', value: 1.1 },
    { type: 'lineHeight', name: 'heading', value: 1.2 },
    { type: 'lineHeight', name: 'body', value: 1.5 },
    { type: 'letterSpacing', name: 'tight', value: -0.5 },
    { type: 'letterSpacing', name: 'normal', value: 0 },
    { type: 'letterSpacing', name: 'wide', value: 0.5 },

    // Spacing
    { type: 'spacing', name: 'spacing-1', value: 4 },
    { type: 'spacing', name: 'spacing-2', value: 8 },
    { type: 'spacing', name: 'spacing-3', value: 12 },
    { type: 'spacing', name: 'spacing-4', value: 16 },
    { type: 'spacing', name: 'spacing-6', value: 24 },
    { type: 'spacing', name: 'spacing-8', value: 32 },
    { type: 'spacing', name: 'spacing-12', value: 48 },
    { type: 'spacing', name: 'spacing-16', value: 64 },

    // Radius
    { type: 'radius', name: 'radius-none', value: 0 },
    {
      type: 'radius', name: 'radius-sm', value: 4,
      modeOverrides: { hc: 0 }
    },
    {
      type: 'radius', name: 'radius-md', value: 8,
      modeOverrides: { hc: 0 }
    },
    {
      type: 'radius', name: 'radius-lg', value: 16,
      modeOverrides: { hc: 2 }
    },
    { type: 'radius', name: 'radius-full', value: 9999 },

    // Elevation
    { type: 'elevation', name: 'flat', value: 0 },
    { type: 'elevation', name: 'raised', value: 4 },
    { type: 'elevation', name: 'floating', value: 12 },
  ]

  const ids = new Map(existing.map(token => [tokenVariable(token), token.id]))
  const result: TokenInput[] = []

  for (const definition of definitions) {
    const variable = tokenVariable(definition)
    if (ids.has(variable)) continue
    const { aliasName, modeOverrides, ...input } = definition
    const id = crypto.randomUUID()
    ids.set(variable, id)

    const themeValues = modeOverrides ? themeValuesFor(modeOverrides.dark, modeOverrides.hc) : undefined

    result.push({
      ...input,
      id,
      ...(themeValues ? { themeValues } : {}),
      ...(aliasName ? { aliasId: ids.get(tokenVariable({ type: definition.type, name: aliasName })) } : {}),
    } as TokenInput)
  }

  return result
}

/**
 * Initializes the full multi-mode theming system in a store:
 * 1. Creates standard themes: 'light', 'dark', 'high-contrast'.
 * 2. Adds all foundation tokens across color, typography, spacing, radius, and elevation
 *    with pre-configured multi-mode theme values!
 */
export function setupFoundationDesignSystem(store: SceneStore): { addedCount: number; themesCreated: number } {
  const snapshot = store.getSnapshot()
  const existingThemes = new Set(snapshot.styleLibrary.themes.map(t => t.id))
  let themesCreated = 0

  const requiredModes = [
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
    { id: 'high-contrast', name: 'High-Contrast' },
  ]

  for (const mode of requiredModes) {
    if (!existingThemes.has(mode.id)) {
      store.addTheme(mode.name)
      themesCreated++
    }
  }

  const updatedSnapshot = store.getSnapshot()
  const themeIds = new Set(updatedSnapshot.styleLibrary.themes.map(t => t.id))
  const missingTokens = foundationTokens(updatedSnapshot.tokens, themeIds)

  if (missingTokens.length > 0) {
    store.addTokens(missingTokens)
  }

  // Also populate themeValues for existing tokens that match foundation names if they don't have them
  const currentTokens = store.getSnapshot().tokens
  for (const token of currentTokens) {
    let darkVal: string | number | undefined
    let hcVal: string | number | undefined

    if (token.type === 'color') {
      if (token.name === 'paper') { darkVal = '#0c0c0c'; hcVal = '#000000' }
      else if (token.name === 'ink') { darkVal = '#f5f4ef'; hcVal = '#ffffff' }
      else if (token.name === 'blue') { darkVal = '#9ec0f3'; hcVal = '#00e5ff' }
      else if (token.name === 'charcoal') { darkVal = '#181818'; hcVal = '#111111' }
      else if (token.name === 'border') { darkVal = '#262626'; hcVal = '#ffffff' }
      else if (token.name === 'muted') { darkVal = '#98968f'; hcVal = '#ffff00' }
    } else if (token.type === 'radius') {
      if (token.name === 'radius-sm' || token.name === 'radius-md') { hcVal = 0 }
      else if (token.name === 'radius-lg') { hcVal = 2 }
    }

    if (darkVal !== undefined || hcVal !== undefined) {
      const themeValues = { ...(token.themeValues ?? {}) }
      let changed = false
      if (darkVal !== undefined && themeIds.has('dark') && !Object.hasOwn(themeValues, 'dark')) {
        themeValues.dark = darkVal
        changed = true
      }
      if (hcVal !== undefined && themeIds.has('high-contrast') && !Object.hasOwn(themeValues, 'high-contrast')) {
        themeValues['high-contrast'] = hcVal
        changed = true
      }
      if (changed) {
        store.updateToken(token.id, { themeValues })
      }
    }
  }

  return { addedCount: missingTokens.length, themesCreated }
}
