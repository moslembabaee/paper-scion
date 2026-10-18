import type { SceneElement, ElementType } from '../scene/types.ts'
import type { SceneStore } from '../scene/store.ts'
import { resolveTokens } from './library.ts'
import { tokenVariable, validateToken, TOKEN_META } from './model.ts'
import type { DesignTheme, DesignToken, StyleLibrary, TokenInput, TokenProperty, TokenType } from './types.ts'

export interface TokenMatrixCell {
  readonly value: string | number
  readonly isOverridden: boolean
  readonly isInherited: boolean
  readonly isAliased: boolean
}

export interface TokenMatrixRow {
  readonly token: DesignToken
  readonly baseValue: string | number
  readonly modeValues: Record<string, TokenMatrixCell>
  readonly aliasTarget?: DesignToken
  readonly boundNodes: readonly SceneElement[]
  readonly boundCount: number
}

export const STANDARD_THEMES: readonly DesignTheme[] = Object.freeze([
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'high-contrast', name: 'High-Contrast' },
])

/**
 * Returns all configured document theme modes, ensuring consistent ordering.
 */
export function getAvailableModes(library: StyleLibrary): readonly DesignTheme[] {
  return library.themes
}

/**
 * Switches active document theme mode, automatically propagating new resolved
 * variable values to all bound canvas elements with zero frame drops.
 */
export function switchThemeMode(store: SceneStore, themeId: string | null): void {
  store.setActiveTheme(themeId)
}

/**
 * Ensures standard design system modes (Light, Dark, High-Contrast) exist in the document.
 */
export function ensureStandardModes(store: SceneStore): void {
  const snapshot = store.getSnapshot()
  const existingIds = new Set(snapshot.styleLibrary.themes.map(t => t.id))

  for (const standard of STANDARD_THEMES) {
    if (!existingIds.has(standard.id)) {
      store.addTheme(standard.name)
    }
  }
}

/**
 * Computes a comprehensive multi-mode matrix for all tokens across all active and defined modes.
 */
export function buildTokenModeMatrix(
  tokens: readonly DesignToken[],
  library: StyleLibrary,
  elements: Readonly<Record<string, SceneElement>>
): TokenMatrixRow[] {
  const tokenMap = new Map(tokens.map(t => [t.id, t]))

  // Index bound elements by token ID
  const usageMap = new Map<string, SceneElement[]>()
  for (const node of Object.values(elements)) {
    if (!node.tokenBindings) continue
    for (const tokenId of Object.values(node.tokenBindings)) {
      if (!tokenId) continue
      const list = usageMap.get(tokenId) ?? []
      list.push(node)
      usageMap.set(tokenId, list)
    }
  }

  // Pre-resolve tokens per theme
  const resolvedPerTheme = new Map<string, Map<string, DesignToken>>()
  for (const theme of library.themes) {
    const resolvedList = resolveTokens(tokens, theme.id)
    resolvedPerTheme.set(theme.id, new Map(resolvedList.map(t => [t.id, t])))
  }
  const baseResolvedList = resolveTokens(tokens, null)
  const baseResolvedMap = new Map(baseResolvedList.map(t => [t.id, t]))

  return tokens.map(token => {
    const baseResolved = baseResolvedMap.get(token.id) ?? token
    const aliasTarget = token.aliasId ? tokenMap.get(token.aliasId) : undefined
    const boundNodes = usageMap.get(token.id) ?? []

    const modeValues: Record<string, TokenMatrixCell> = {}

    for (const theme of library.themes) {
      const modeResolved = resolvedPerTheme.get(theme.id)?.get(token.id) ?? token
      const isExplicitOverride = Boolean(token.themeValues && Object.hasOwn(token.themeValues, theme.id))
      const isAliased = Boolean(token.aliasId)
      const isInherited = !isExplicitOverride && !isAliased

      modeValues[theme.id] = {
        value: modeResolved.value,
        isOverridden: isExplicitOverride,
        isInherited,
        isAliased,
      }
    }

    return {
      token,
      baseValue: baseResolved.value,
      modeValues,
      aliasTarget,
      boundNodes,
      boundCount: boundNodes.length,
    }
  })
}

/**
 * Scans canvas nodes for literal styles matching existing design tokens, and
 * automatically binds those canvas properties to the matching variable tokens.
 */
export function autoBindMatchingNodes(store: SceneStore): { boundCount: number; matchedTokens: string[] } {
  const snapshot = store.getSnapshot()
  const { tokens, elements } = snapshot
  if (!tokens.length) return { boundCount: 0, matchedTokens: [] }

  const colors = tokens.filter(t => t.type === 'color')
  const radii = tokens.filter(t => t.type === 'radius')
  const fontSizes = tokens.filter(t => t.type === 'fontSize')
  const fontFamilies = tokens.filter(t => t.type === 'fontFamily')
  const fontWeights = tokens.filter(t => t.type === 'fontWeight')

  let boundCount = 0
  const matchedTokens = new Set<string>()

  store.batch(() => {
    for (const node of Object.values(elements)) {
      const bindings = { ...(node.tokenBindings ?? {}) }
      let updated = false

      // 1. Fill color
      if (!bindings.fill && node.style.fill) {
        const match = colors.find(c => c.value.toLowerCase() === node.style.fill?.toLowerCase())
        if (match) {
          bindings.fill = match.id
          matchedTokens.add(match.name)
          updated = true
          boundCount++
        }
      }

      // 2. Stroke color
      if (!bindings.stroke && node.style.stroke?.color) {
        const match = colors.find(c => c.value.toLowerCase() === node.style.stroke?.color.toLowerCase())
        if (match) {
          bindings.stroke = match.id
          matchedTokens.add(match.name)
          updated = true
          boundCount++
        }
      }

      // 3. Corner radius
      if (!bindings.cornerRadius && 'cornerRadius' in node && typeof node.cornerRadius === 'number') {
        const match = radii.find(r => r.value === node.cornerRadius)
        if (match) {
          bindings.cornerRadius = match.id
          matchedTokens.add(match.name)
          updated = true
          boundCount++
        }
      }

      // 4. Text typography properties
      if (node.type === 'text') {
        if (!bindings.fontSize && typeof node.fontSize === 'number') {
          const match = fontSizes.find(f => f.value === node.fontSize)
          if (match) {
            bindings.fontSize = match.id
            matchedTokens.add(match.name)
            updated = true
            boundCount++
          }
        }
        if (!bindings.fontFamily && node.fontFamily) {
          const match = fontFamilies.find(f => f.value.toLowerCase() === node.fontFamily.toLowerCase())
          if (match) {
            bindings.fontFamily = match.id
            matchedTokens.add(match.name)
            updated = true
            boundCount++
          }
        }
        if (!bindings.fontWeight && typeof node.fontWeight === 'number') {
          const match = fontWeights.find(f => f.value === node.fontWeight)
          if (match) {
            bindings.fontWeight = match.id
            matchedTokens.add(match.name)
            updated = true
            boundCount++
          }
        }
      }

      if (updated) {
        store.update(node.id, node.type as ElementType, { tokenBindings: bindings } as any)
      }
    }
  })

  return { boundCount, matchedTokens: Array.from(matchedTokens) }
}

/**
 * Extracts a style property from a canvas node, creates a new variable token,
 * and immediately binds the canvas node to the newly created token.
 */
export function createTokenFromNode(
  store: SceneStore,
  node: SceneElement,
  property: TokenProperty,
  suggestedName?: string
): DesignToken | null {
  let type: TokenType = 'color'
  let rawValue: string | number = ''

  if (property === 'fill') {
    type = 'color'
    rawValue = node.style.fill ?? '#81adec'
  } else if (property === 'stroke') {
    type = 'color'
    rawValue = node.style.stroke?.color ?? '#080808'
  } else if (property === 'cornerRadius') {
    type = 'radius'
    rawValue = 'cornerRadius' in node ? node.cornerRadius : 8
  } else if (property === 'fontSize' && node.type === 'text') {
    type = 'fontSize'
    rawValue = node.fontSize
  } else if (property === 'fontFamily' && node.type === 'text') {
    type = 'fontFamily'
    rawValue = node.fontFamily
  } else if (property === 'fontWeight' && node.type === 'text') {
    type = 'fontWeight'
    rawValue = node.fontWeight
  } else if (property === 'width' || property === 'height' || property === 'x' || property === 'y') {
    type = 'spacing'
    rawValue = node[property]
  } else {
    return null
  }

  // Derive unique name
  const baseName = suggestedName?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || `${TOKEN_META[type].namespace}-${node.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`
  let candidateName = baseName
  let counter = 1
  const existing = store.getSnapshot().tokens
  while (existing.some(t => tokenVariable(t) === tokenVariable({ type, name: candidateName }))) {
    candidateName = `${baseName}-${counter++}`
  }

  const tokenInput: TokenInput = {
    type,
    name: candidateName,
    value: rawValue as any,
  }

  validateToken({ ...tokenInput, id: 'temp' } as DesignToken)

  const created = store.addToken(tokenInput)
  store.bindToken(node.id, property, created.id)
  return created
}

/**
 * Returns all nodes bound to a specific token ID.
 */
export function getNodesBoundToToken(
  elements: Readonly<Record<string, SceneElement>>,
  tokenId: string
): SceneElement[] {
  const result: SceneElement[] = []
  for (const node of Object.values(elements)) {
    if (node.tokenBindings && Object.values(node.tokenBindings).includes(tokenId)) {
      result.push(node)
    }
  }
  return result
}
