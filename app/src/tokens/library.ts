import type { SceneElement, VectorElement } from '../scene/types.ts'
import { equalValue } from '../scene/history.ts'
import { indexTokens, propertyTokenTypes, resolveTokenBindings, validateToken } from './model.ts'
import type { DesignToken, LayerEffect, SharedStyle, SharedStyleBindings, StyleLibrary, TokenProperty } from './types.ts'

export const EMPTY_LIBRARY: StyleLibrary = Object.freeze({ themes: Object.freeze([]), activeThemeId: null, styles: Object.freeze([]) })
const typographyKeys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') { for (const [key, child] of Object.entries(value)) { if (child === undefined) delete (value as Record<string, unknown>)[key]; else freezeTree(child) } Object.freeze(value) }
  return value
}

/** Resolve each dependency once. Aliases inherit the target's active theme value. */
const tokenCache = new WeakMap<readonly DesignToken[], Map<string | null, readonly DesignToken[]>>()
export function resolveTokens(tokens: readonly DesignToken[], themeId: string | null = null): readonly DesignToken[] {
  const cached = tokenCache.get(tokens)?.get(themeId)
  if (cached) return cached
  const source = new Map(tokens.map(token => [token.id, token])), resolved = new Map<string, DesignToken>(), visiting = new Set<string>()
  function visit(token: DesignToken): DesignToken {
    const cached = resolved.get(token.id)
    if (cached) return cached
    if (visiting.has(token.id)) throw new Error('Token aliases cannot form a cycle.')
    visiting.add(token.id)
    let value: string | number
    const hasThemeOverride = Boolean(themeId && token.themeValues && Object.hasOwn(token.themeValues, themeId))
    const themeAlias = themeId && token.themeAliases ? token.themeAliases[themeId] : undefined
    const activeAliasId = themeAlias ?? token.aliasId

    if (hasThemeOverride) {
      value = token.themeValues![themeId!]
    } else if (activeAliasId !== undefined) {
      const target = source.get(activeAliasId)
      if (!target || target.type !== token.type) throw new Error('An alias needs an existing token of the same type.')
      value = visit(target).value
    } else {
      value = token.value
    }
    const next = value === token.value ? token : Object.freeze({ ...token, value }) as DesignToken
    visiting.delete(token.id); resolved.set(token.id, next)
    return next
  }
  const result = Object.freeze(tokens.map(visit))
  if (Object.isFrozen(tokens)) {
    const cache = tokenCache.get(tokens) ?? new Map<string | null, readonly DesignToken[]>()
    cache.set(themeId, result); tokenCache.set(tokens, cache)
  }
  return result
}

const styleIndexes = new WeakMap<StyleLibrary, ReadonlyMap<string, SharedStyle>>()
function indexStyles(library: StyleLibrary): ReadonlyMap<string, SharedStyle> {
  const cached = styleIndexes.get(library)
  if (cached) return cached
  const index = new Map(library.styles.map(style => [style.id, style]))
  if (Object.isFrozen(library) && Object.isFrozen(library.styles)) styleIndexes.set(library, index)
  return index
}

/** Resolve previews and editor drafts using the same active values as the canvas. */
export function resolveSharedStyle(style: SharedStyle, tokens: readonly DesignToken[]): SharedStyle {
  const index = indexTokens(tokens)
  if (style.kind === 'color') {
    const token = style.tokenId ? index.get(style.tokenId) : undefined
    return token?.type === 'color' ? { ...style, value: token.value } : style
  }
  if (style.kind === 'typography') {
    const value = { ...style.value }
    for (const key of typographyKeys) {
      const id = style.value.tokenBindings?.[key], token = id ? index.get(id) : undefined
      if (token?.type === key) Object.assign(value, { [key]: token.value })
    }
    return { ...style, value }
  }
  return { ...style, value: style.value.map(effect => {
    if (effect.type === 'layer-blur' || !effect.colorTokenId) return effect
    const token = index.get(effect.colorTokenId)
    return token?.type === 'color' ? { ...effect, color: token.value } : effect
  }) }
}

export function validateEffects(effects: readonly LayerEffect[], tokens?: readonly DesignToken[]): void {
  if (!Array.isArray(effects) || effects.length > 32) throw new Error('Use up to 32 effects per style.')
  const ids = new Set<string>()
  for (const effect of effects) {
    if (!effect || typeof effect.id !== 'string' || !effect.id || ids.has(effect.id) || typeof effect.enabled !== 'boolean' || !['drop-shadow', 'inner-shadow', 'layer-blur'].includes(effect.type) || !Number.isFinite(effect.blur) || effect.blur < 0 || effect.blur > 500) throw new Error('Invalid layer effect.')
    ids.add(effect.id)
    if (effect.type !== 'layer-blur') {
      validateToken({ id: 'effect', name: 'effect', type: 'color', value: effect.color })
      if (![effect.x, effect.y, effect.spread].every(Number.isFinite) || Math.max(Math.abs(effect.x), Math.abs(effect.y), Math.abs(effect.spread)) > 10000) throw new Error('Invalid shadow geometry.')
      if (effect.colorTokenId !== undefined && (typeof effect.colorTokenId !== 'string' || (tokens && !tokens.some(token => token.id === effect.colorTokenId && token.type === 'color')))) throw new Error('Missing shadow color token.')
    }
  }
}

export function validateLibrary(input: StyleLibrary | undefined, tokens: readonly DesignToken[]): StyleLibrary {
  const library = input ?? EMPTY_LIBRARY
  if (!library || !Array.isArray(library.themes) || !Array.isArray(library.styles)) throw new Error('Invalid style library.')
  const themeIds = new Set<string>(), styleIds = new Set<string>()
  for (const theme of library.themes) {
    if (!theme || typeof theme.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(theme.id) || typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 100 || themeIds.has(theme.id)) throw new Error('Invalid or duplicate theme.')
    themeIds.add(theme.id)
  }
  if (library.activeThemeId !== null && !themeIds.has(library.activeThemeId)) throw new Error('Unknown active theme.')
  for (const token of tokens) {
    if (token.palette !== undefined && (typeof token.palette !== 'string' || token.palette.length > 100)) throw new Error('Invalid palette name.')
    if (token.themeValues !== undefined) {
      if (!token.themeValues || typeof token.themeValues !== 'object' || Array.isArray(token.themeValues)) throw new Error('Invalid theme values.')
      for (const [id, value] of Object.entries(token.themeValues)) {
        if (!themeIds.has(id)) throw new Error('Token references an unknown theme.')
        validateToken({ ...token, value } as DesignToken)
      }
    }
    if (token.themeAliases !== undefined) {
      if (!token.themeAliases || typeof token.themeAliases !== 'object' || Array.isArray(token.themeAliases)) throw new Error('Invalid theme aliases.')
      for (const [id, aliasTargetId] of Object.entries(token.themeAliases)) {
        if (!themeIds.has(id)) throw new Error('Token references an unknown theme.')
        if (typeof aliasTargetId !== 'string' || !tokens.some(t => t.id === aliasTargetId && t.type === token.type)) throw new Error('Invalid theme alias target.')
      }
    }
  }
  resolveTokens(tokens)
  for (const id of themeIds) resolveTokens(tokens, id)
  for (const style of library.styles) {
    if (!style || typeof style.id !== 'string' || !style.id || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 100 || styleIds.has(style.id)) throw new Error('Invalid or duplicate shared style.')
    styleIds.add(style.id)
    if (style.kind === 'color') {
      validateToken({ id: 'style', name: 'style', type: 'color', value: style.value })
      if (style.tokenId !== undefined && !tokens.some(token => token.id === style.tokenId && token.type === 'color')) throw new Error('Missing shared color token.')
    } else if (style.kind === 'typography') {
      if (!style.value || !['left', 'center', 'right'].includes(style.value.textAlign)) throw new Error('Invalid typography preset.')
      for (const key of typographyKeys) validateToken({ id: key, name: 'preset', type: key, value: style.value[key] } as DesignToken)
      if (style.value.tokenBindings !== undefined && (!style.value.tokenBindings || typeof style.value.tokenBindings !== 'object' || Array.isArray(style.value.tokenBindings))) throw new Error('Invalid typography token bindings.')
      for (const [key, id] of Object.entries(style.value.tokenBindings ?? {})) if (!typographyKeys.includes(key as typeof typographyKeys[number]) || !tokens.some(token => token.id === id && propertyTokenTypes(key as TokenProperty).includes(token.type))) throw new Error('Invalid typography token binding.')
    } else if (style.kind === 'effects') validateEffects(style.value, tokens)
    else throw new Error('Unknown shared style kind.')
  }
  return freezeTree(structuredClone(library))
}

export function resolveSharedStyles(node: SceneElement, library: StyleLibrary, tokens: readonly DesignToken[]): SceneElement {
  const styles = indexStyles(library), tokenIndex = indexTokens(tokens)
  let next = node
  if (node.type === 'path' && node.boolean) {
    const operands = node.boolean.operands.map(source => resolveSharedStyles(source, library, tokens) as VectorElement)
    if (operands.some((source, i) => source !== node.boolean!.operands[i])) next = { ...node, boolean: { ...node.boolean, operands } }
  }
  if (node.sharedStyleBindings === undefined) return next
  if (!node.sharedStyleBindings || typeof node.sharedStyleBindings !== 'object' || Array.isArray(node.sharedStyleBindings)) throw new Error('Invalid shared style bindings.')
  for (const [kind, id] of Object.entries(node.sharedStyleBindings)) {
    const style = styles.get(id)
    if (!style || style.kind !== kind) throw new Error('Missing or incompatible shared style.')
    if (style.kind === 'color') {
      const value = style.tokenId ? tokenIndex.get(style.tokenId)!.value as string : style.value
      if (next.style.fill !== value) next = { ...next, style: { ...next.style, fill: value } }
    } else if (style.kind === 'typography') {
      if (next.type !== 'text') throw new Error('Typography styles require a text layer.')
      const { tokenBindings, ...value } = style.value
      const resolved = resolveTokenBindings({ ...next, ...value, tokenBindings }, tokens)
      const materialized = { ...resolved, tokenBindings: next.tokenBindings } as SceneElement
      if (!equalValue(next, materialized)) next = materialized
    } else {
      const effects = style.value.map(effect => effect.type !== 'layer-blur' && effect.colorTokenId ? { ...effect, color: tokenIndex.get(effect.colorTokenId)!.value as string } : effect)
      if (!equalValue(next.style.effects, effects) || next.style.shadow !== null) next = { ...next, style: { ...next.style, effects, shadow: null } }
    }
  }
  return next
}

/** Direct edits release the affected preset, retaining other preset bindings. */
export function detachEditedSharedStyles(bindings: SharedStyleBindings | undefined, patch: Record<string, unknown>): SharedStyleBindings | undefined {
  if (!bindings) return undefined
  const next = { ...bindings }, style = patch.style as Record<string, unknown> | undefined
  if (style && Object.hasOwn(style, 'fill')) delete next.color
  if (typographyKeys.some(key => Object.hasOwn(patch, key)) || ['textAlign', 'fontSource', 'variableAxes', 'openTypeFeatures', 'fontKerning', 'opticalKerning', 'opticalMarginAlignment', 'showOpticalMetrics', 'textOnPath', 'textTransform', 'renderMode', 'renderOutlines', 'outlinePathD'].some(key => Object.hasOwn(patch, key))) delete next.typography
  if (style && (Object.hasOwn(style, 'effects') || Object.hasOwn(style, 'shadow'))) delete next.effects
  return next
}
