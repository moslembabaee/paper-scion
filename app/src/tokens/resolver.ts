import type { SceneElement } from '../scene/types.ts'
import type { DesignTheme, DesignToken, StyleLibrary, TokenType } from './types.ts'
import { resolveTokens } from './library.ts'
import { STANDARD_THEMES } from './themes.ts'

export type VariableMode = 'light' | 'dark' | 'high-contrast' | (string & {})

export interface ResolvedTokenValue {
  readonly tokenId: string
  readonly name: string
  readonly type: TokenType
  readonly rawValue: string | number
  readonly resolvedValue: string | number
  readonly modeId: string | null
  readonly isOverridden: boolean
  readonly isAliased: boolean
  readonly aliasChain: readonly string[]
}

export interface ElementModeContext {
  readonly elementId: string
  readonly explicitMode: string | null
  readonly inheritedMode: string | null
  readonly effectiveMode: string | null
  readonly sourceElementId: string | null
  readonly isInherited: boolean
  readonly isOverridden: boolean
}

/**
 * Normalizes mode ID string, recognizing standard aliases like 'Dark' -> 'dark'.
 * Returns null for inherit / unset values.
 */
export function normalizeModeId(mode: string | null | undefined): string | null {
  if (!mode || typeof mode !== 'string') return null
  const trimmed = mode.trim()
  if (!trimmed || trimmed.toLowerCase() === 'inherit' || trimmed.toLowerCase() === 'auto') return null
  const lower = trimmed.toLowerCase()
  if (lower === 'light') return 'light'
  if (lower === 'dark') return 'dark'
  if (lower === 'high-contrast' || lower === 'highcontrast' || lower === 'contrast') return 'high-contrast'
  return trimmed
}

/**
 * Returns human-readable display label for a theme mode ID.
 */
export function getModeDisplayName(modeId: string | null | undefined, themes: readonly DesignTheme[] = []): string {
  const normalized = normalizeModeId(modeId)
  if (!normalized) return 'Inherit'
  if (normalized === 'light') return 'Light'
  if (normalized === 'dark') return 'Dark'
  if (normalized === 'high-contrast') return 'High-Contrast'
  const found = themes.find(t => t.id === normalized || t.id.toLowerCase() === normalized.toLowerCase())
  return found ? found.name : normalized
}

/**
 * Extracts explicit themeMode from a SceneElement, checking both direct element property
 * and component instance overrides.
 */
export function getExplicitElementMode(node: SceneElement | null | undefined): string | null {
  if (!node) return null
  if (node.themeMode) {
    const norm = normalizeModeId(node.themeMode)
    if (norm) return norm
  }
  if (node.component?.kind === 'instance' && node.component.overrides?.themeMode) {
    const norm = normalizeModeId(node.component.overrides.themeMode)
    if (norm) return norm
  }
  return null
}

/**
 * Computes the effective variable mode for an element by traversing up the ancestor
 * frame / container hierarchy until an explicit mode override is found.
 * If no ancestor specifies a mode, falls back to the document's active theme (or null).
 */
export function getEffectiveThemeMode(
  elementId: string,
  elements: Readonly<Record<string, SceneElement>>,
  documentThemeId: string | null = null
): string | null {
  const visited = new Set<string>()
  let currentId: string | null | undefined = elementId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node: SceneElement | undefined = elements[currentId]
    if (!node) break

    const explicit = getExplicitElementMode(node)
    if (explicit) return explicit

    currentId = node.parentId
  }

  return normalizeModeId(documentThemeId)
}

/**
 * Returns comprehensive element mode context for inspection, debugging, and UI badges.
 */
export function getElementModeContext(
  elementId: string,
  elements: Readonly<Record<string, SceneElement>>,
  documentThemeId: string | null = null
): ElementModeContext {
  const node = elements[elementId]
  const explicit = getExplicitElementMode(node)
  const normDoc = normalizeModeId(documentThemeId)

  if (explicit) {
    // Find what it would have inherited if not overridden
    let inherited: string | null = normDoc
    let parentId = node?.parentId
    const visited = new Set<string>([elementId])
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = elements[parentId]
      if (!parent) break
      const parentMode = getExplicitElementMode(parent)
      if (parentMode) {
        inherited = parentMode
        break
      }
      parentId = parent.parentId
    }

    return {
      elementId,
      explicitMode: explicit,
      inheritedMode: inherited,
      effectiveMode: explicit,
      sourceElementId: elementId,
      isInherited: false,
      isOverridden: true,
    }
  }

  // Traversal to find inherited source
  let currentId = node?.parentId
  let sourceId: string | null = null
  let inheritedMode: string | null = normDoc
  const visited = new Set<string>([elementId])

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const ancestor = elements[currentId]
    if (!ancestor) break
    const ancestorMode = getExplicitElementMode(ancestor)
    if (ancestorMode) {
      inheritedMode = ancestorMode
      sourceId = currentId
      break
    }
    currentId = ancestor.parentId
  }

  return {
    elementId,
    explicitMode: null,
    inheritedMode,
    effectiveMode: inheritedMode,
    sourceElementId: sourceId,
    isInherited: true,
    isOverridden: false,
  }
}

/**
 * Resolves all tokens for a specific element in the scene based on its inherited variable mode.
 */
export function getEffectiveModeTokens(
  elementId: string,
  elements: Readonly<Record<string, SceneElement>>,
  tokens: readonly DesignToken[],
  documentThemeId: string | null = null
): readonly DesignToken[] {
  const effectiveMode = getEffectiveThemeMode(elementId, elements, documentThemeId)
  return resolveTokens(tokens, effectiveMode)
}

/**
 * Inspects a token's alias resolution chain in a given mode.
 * Returns the final resolved token, intermediate alias hops, and whether it was aliased.
 */
export function resolveTokenAliasChain(
  tokenId: string,
  tokens: readonly DesignToken[],
  modeId: string | null = null
): { resolvedToken: DesignToken; chain: string[]; isAliased: boolean } {
  const tokenMap = new Map(tokens.map(t => [t.id, t]))
  const start = tokenMap.get(tokenId)
  if (!start) throw new Error(`Token ${tokenId} not found.`)

  const chain: string[] = [start.id]
  const visited = new Set<string>([start.id])
  let current = start
  let isAliased = false

  while (true) {
    const hasOverride = Boolean(modeId && current.themeValues && Object.hasOwn(current.themeValues, modeId))
    if (hasOverride) {
      break
    }

    const themeAlias = modeId && current.themeAliases ? current.themeAliases[modeId] : undefined
    const nextAliasId = themeAlias ?? current.aliasId

    if (!nextAliasId) {
      break
    }

    isAliased = true
    if (visited.has(nextAliasId)) {
      throw new Error('Token aliases cannot form a cycle.')
    }

    const nextToken = tokenMap.get(nextAliasId)
    if (!nextToken) {
      throw new Error(`Target alias token ${nextAliasId} not found.`)
    }
    if (nextToken.type !== current.type) {
      throw new Error('An alias needs an existing token of the same type.')
    }

    visited.add(nextAliasId)
    chain.push(nextAliasId)
    current = nextToken
  }

  const resolvedList = resolveTokens(tokens, modeId)
  const resolvedToken = resolvedList.find(t => t.id === tokenId) ?? start

  return {
    resolvedToken,
    chain,
    isAliased,
  }
}

/**
 * High-performance Multi-Theme Token Resolver instance with caching.
 */
export class MultiThemeTokenResolver {
  private readonly tokens: readonly DesignToken[]
  private readonly library: StyleLibrary
  private readonly cache = new Map<string | null, readonly DesignToken[]>()
  private readonly tokenMap: Map<string, DesignToken>

  constructor(tokens: readonly DesignToken[], library: StyleLibrary) {
    this.tokens = tokens
    this.library = library
    this.tokenMap = new Map(tokens.map(t => [t.id, t]))
  }

  /**
   * Returns all available modes (standard + document themes).
   */
  getAvailableModes(): readonly DesignTheme[] {
    const modes: DesignTheme[] = [...STANDARD_THEMES]
    const existing = new Set(modes.map(m => m.id.toLowerCase()))
    for (const theme of this.library.themes) {
      if (!existing.has(theme.id.toLowerCase())) {
        modes.push(theme)
        existing.add(theme.id.toLowerCase())
      }
    }
    return Object.freeze(modes)
  }

  /**
   * Resolves all design tokens in a given theme mode.
   */
  resolveForMode(modeId: string | null = null): readonly DesignToken[] {
    const normalized = normalizeModeId(modeId)
    const cached = this.cache.get(normalized)
    if (cached) return cached
    const result = resolveTokens(this.tokens, normalized)
    this.cache.set(normalized, result)
    return result
  }

  /**
   * Resolves design tokens for a specific canvas element by resolving its inherited mode.
   */
  resolveForElement(
    elementId: string,
    elements: Readonly<Record<string, SceneElement>>
  ): readonly DesignToken[] {
    const effectiveMode = getEffectiveThemeMode(elementId, elements, this.library.activeThemeId)
    return this.resolveForMode(effectiveMode)
  }

  /**
   * Gets effective mode for an element.
   */
  getEffectiveMode(
    elementId: string,
    elements: Readonly<Record<string, SceneElement>>
  ): string | null {
    return getEffectiveThemeMode(elementId, elements, this.library.activeThemeId)
  }

  /**
   * Gets rich mode diagnostics for an element.
   */
  getModeContext(
    elementId: string,
    elements: Readonly<Record<string, SceneElement>>
  ): ElementModeContext {
    return getElementModeContext(elementId, elements, this.library.activeThemeId)
  }

  /**
   * Resolves a single token's value in a given mode.
   */
  resolveTokenValue(tokenId: string, modeId: string | null = null): string | number | undefined {
    const resolved = this.resolveForMode(modeId)
    const token = resolved.find(t => t.id === tokenId)
    return token?.value
  }

  /**
   * Returns full resolved details for a token in a mode.
   */
  resolveTokenDetail(tokenId: string, modeId: string | null = null): ResolvedTokenValue | undefined {
    const base = this.tokenMap.get(tokenId)
    if (!base) return undefined
    const { resolvedToken, chain, isAliased } = resolveTokenAliasChain(tokenId, this.tokens, modeId)
    const isOverridden = Boolean(modeId && base.themeValues && Object.hasOwn(base.themeValues, modeId))

    return {
      tokenId: base.id,
      name: base.name,
      type: base.type,
      rawValue: base.value,
      resolvedValue: resolvedToken.value,
      modeId: normalizeModeId(modeId),
      isOverridden,
      isAliased,
      aliasChain: chain,
    }
  }
}

/**
 * Factory for creating MultiThemeTokenResolver.
 */
export function createMultiThemeTokenResolver(
  tokens: readonly DesignToken[],
  library: StyleLibrary
): MultiThemeTokenResolver {
  return new MultiThemeTokenResolver(tokens, library)
}
