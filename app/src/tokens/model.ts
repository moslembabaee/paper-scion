import { resolveTokens, validateEffects } from './library.ts'
import { equalValue } from '../scene/history.ts'
import type { Shadow, PathElement, SceneElement, VectorElement } from '../scene/types.ts'
import { refreshBooleanElement, sameVectorGeometry } from '../scene/booleanGeometry.ts'
import type { DesignToken, TokenBindings, TokenProperty, TokenType } from './types.ts'

export const TOKEN_META = {
  color: { label: 'Color', namespace: 'color', defaultValue: '#81adec', unit: '' },
  elevation: { label: 'Elevation', namespace: 'elevation', defaultValue: 4, unit: 'px' },
  radius: { label: 'Radius', namespace: 'radius', defaultValue: 8, unit: 'px' },
  spacing: { label: 'Spacing', namespace: 'spacing', defaultValue: 24, unit: 'px' },
  fontFamily: { label: 'Font family', namespace: 'font', defaultValue: 'Inter, sans-serif', unit: '' },
  fontSize: { label: 'Font size', namespace: 'text', defaultValue: 16, unit: 'px' },
  fontWeight: { label: 'Font weight', namespace: 'font-weight', defaultValue: 400, unit: '' },
  lineHeight: { label: 'Line height', namespace: 'leading', defaultValue: 1.2, unit: '' },
  letterSpacing: { label: 'Letter spacing', namespace: 'tracking', defaultValue: 0, unit: 'px' },
  container: { label: 'Container', namespace: 'container', defaultValue: 1200, unit: 'px' },
  breakpoint: { label: 'Breakpoint', namespace: 'breakpoint', defaultValue: 768, unit: 'px' },
} as const satisfies Record<TokenType, { label: string; namespace: string; defaultValue: string | number; unit: string }>

export function tokenVariable(token: Pick<DesignToken, 'type' | 'name'>): string { return `--${TOKEN_META[token.type].namespace}-${token.name}` }
export function tokenCSSValue(token: DesignToken): string { return `${token.value}${TOKEN_META[token.type].unit}` }
const tokenIndexes = new WeakMap<readonly DesignToken[], ReadonlyMap<string, DesignToken>>()
/** Store snapshots are immutable, so every layer can reuse the same index. */
export function indexTokens(tokens: readonly DesignToken[] | ReadonlyMap<string, DesignToken>): ReadonlyMap<string, DesignToken> {
  if (!Array.isArray(tokens)) return tokens as ReadonlyMap<string, DesignToken>
  const cached = tokenIndexes.get(tokens)
  if (cached) return cached
  const index = new Map(tokens.map(token => [token.id, token]))
  if (Object.isFrozen(tokens)) tokenIndexes.set(tokens, index)
  return index
}
export function tokensToCSS(tokens: readonly DesignToken[], tailwind = false): string {
  return `${tailwind ? '@theme static' : ':root'} {\n${tokens.map(token => `  ${tokenVariable(token)}: ${token.aliasId && tokens.some(target => target.id === token.aliasId) ? `var(${tokenVariable(tokens.find(target => target.id === token.aliasId)!)})` : tokenCSSValue(token)};`).join('\n')}\n}`
}

const NAMED_COLORS = new Set('transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' '))

export function validateToken(token: DesignToken): void {
  if (!token || typeof token.id !== 'string' || !token.id || token.id.length > 200 || typeof token.name !== 'string' || token.name.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token.name) || !Object.hasOwn(TOKEN_META, token.type)) throw new Error('Use a token name like brand-blue or body-size.')
  if (token.themeValues !== undefined && (!token.themeValues || typeof token.themeValues !== 'object' || Array.isArray(token.themeValues))) throw new Error('Invalid theme values.')
  if (token.themeAliases !== undefined && (!token.themeAliases || typeof token.themeAliases !== 'object' || Array.isArray(token.themeAliases))) throw new Error('Invalid theme aliases.')
  if (token.palette !== undefined && (typeof token.palette !== 'string' || token.palette.length > 100)) throw new Error('Invalid palette name.')
  if (token.aliasId !== undefined && (typeof token.aliasId !== 'string' || !token.aliasId)) throw new Error('Invalid token alias.')
  if (token.type === 'color') {
    const value = token.value
    // No unresolved variables: the scene and standalone exports must agree.
    if (typeof value !== 'string' || value.length > 200 || /[;{}]|var\(|currentcolor|inherit|initial|unset|revert/i.test(value) || !(typeof CSS !== 'undefined' ? CSS.supports('color', value) : NAMED_COLORS.has(value.toLowerCase()) || /^(#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^;{}]+\))$/i.test(value))) throw new Error('Enter a valid CSS color.')
  } else if (token.type === 'fontFamily') {
    if (typeof token.value !== 'string' || !token.value.trim() || token.value.length > 300 || /[;{}\n]|var\(/i.test(token.value) || (typeof CSS !== 'undefined' && !CSS.supports('font-family', token.value))) throw new Error('Enter a valid font family or font stack.')
  } else {
    if (typeof token.value !== 'number' || !Number.isFinite(token.value) || (token.type !== 'letterSpacing' && token.value < 0) || (['fontSize', 'lineHeight', 'container', 'breakpoint'].includes(token.type) && token.value <= 0) || (token.type === 'fontWeight' && (token.value < 1 || token.value > 1000))) throw new Error('Enter a valid numeric token value.')
  }
}

export function validateTokens(tokens: readonly DesignToken[]): readonly DesignToken[] {
  if (!Array.isArray(tokens)) throw new Error('Invalid tokens collection')
  const ids = new Set<string>(), names = new Set<string>()
  for (const token of tokens) {
    validateToken(token)
    const variable = tokenVariable(token)
    if (ids.has(token.id) || names.has(variable)) throw new Error('Token names must be unique within their type.')
    ids.add(token.id); names.add(variable)
  }
  resolveTokens(tokens)
  return Object.freeze(tokens.map(token => Object.freeze({ ...Object.fromEntries(Object.entries(token).filter(([, value]) => value !== undefined)), ...(token.themeValues ? { themeValues: Object.freeze({ ...token.themeValues }) } : {}), ...(token.themeAliases ? { themeAliases: Object.freeze({ ...token.themeAliases }) } : {}) }) as DesignToken))
}

export function elevationShadow(distance: number): Shadow | null {
  return distance === 0 ? null : { color: '#08080826', x: 0, y: distance, blur: distance * 2 }
}

export function propertyTokenTypes(property: TokenProperty): readonly TokenType[] {
  if (property === 'fill' || property === 'stroke') return ['color']
  if (property === 'shadow') return ['elevation']
  if (property === 'cornerRadius') return ['radius']
  if (property === 'width') return ['spacing', 'container']
  if (['x', 'y', 'height'].includes(property)) return ['spacing']
  return [property as TokenType]
}

export function supportsTokenProperty(node: SceneElement, property: string): property is TokenProperty {
  return property === 'shadow' || property === 'fill' || property === 'stroke' || ['x', 'y', 'width', 'height'].includes(property) || (property === 'cornerRadius' && 'cornerRadius' in node) || (node.type === 'text' && ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing'].includes(property))
}

/** Materialize bound values at the store boundary, preserving every unbound node's identity. */
export function resolveTokenBindings(node: SceneElement, tokens: readonly DesignToken[] | ReadonlyMap<string, DesignToken>): SceneElement {
  const tokenIndex = indexTokens(tokens)
  let next = node
  if (node.style.effects?.length) {
    validateEffects(node.style.effects)
    const effects = node.style.effects.map(effect => {
      if (effect.type === 'layer-blur' || !effect.colorTokenId) return effect
      const token = tokenIndex.get(effect.colorTokenId)
      if (!token || token.type !== 'color') throw new Error('Missing shadow color token.')
      return effect.color === token.value ? effect : { ...effect, color: token.value }
    })
    if (effects.some((effect, index) => effect !== node.style.effects![index])) next = { ...node, style: { ...node.style, effects } }
  }
  if (node.type === 'path' && node.boolean) {
    const operands = node.boolean.operands.map(source => resolveTokenBindings(source, tokens) as VectorElement)
    if (operands.some((source, index) => source !== node.boolean!.operands[index])) {
      const compound = { ...node.boolean, operands }
      // Paint-only changes do not invalidate the cached outline.
      const geometryChanged = operands.some((source, index) => !sameVectorGeometry(source, node.boolean!.operands[index]))
      next = geometryChanged ? refreshBooleanElement(next as PathElement, compound) : { ...(next as PathElement), boolean: compound }
    }
  }
  if (node.tokenBindings === undefined) return next
  if (!node.tokenBindings || typeof node.tokenBindings !== 'object' || Array.isArray(node.tokenBindings)) throw new Error('Invalid token bindings')
  if (!Object.keys(node.tokenBindings).length) return next
  for (const [property, id] of Object.entries(node.tokenBindings)) {
    const token = tokenIndex.get(id)
    if (!supportsTokenProperty(node, property) || !token || !propertyTokenTypes(property).includes(token.type)) throw new Error('Missing or incompatible token binding')
    if (property === 'fill') {
      if (next.style.fill !== token.value) next = { ...next, style: { ...next.style, fill: token.value as string } }
    } else if (property === 'stroke') {
      if (!next.style.stroke) throw new Error('A stroke binding requires a stroke')
      if (next.style.stroke.color !== token.value) next = { ...next, style: { ...next.style, stroke: { ...next.style.stroke, color: token.value as string } } }
    } else if (property === 'shadow') {
      const shadow = elevationShadow(token.value as number)
      if (!equalValue(next.style.shadow, shadow) || next.style.effects?.length) next = { ...next, style: { ...next.style, shadow, effects: [] } }
    } else if (next[property as keyof SceneElement] !== token.value) next = { ...next, [property]: token.value } as SceneElement
  }
  return next
}

/** Detach deleted tokens from retained boolean sources as well as visible layers. */
export function detachRemovedTokenBindings(node: SceneElement, removed: ReadonlySet<string>): SceneElement {
  let next = node
  if (node.type === 'path' && node.boolean) {
    const operands = node.boolean.operands.map(source => detachRemovedTokenBindings(source, removed) as VectorElement)
    if (operands.some((source, index) => source !== node.boolean!.operands[index])) next = { ...node, boolean: { ...node.boolean, operands } }
  }
  if (next.style.effects?.some(effect => effect.type !== 'layer-blur' && effect.colorTokenId && removed.has(effect.colorTokenId))) {
    next = { ...next, style: { ...next.style, effects: next.style.effects.map(effect => {
      if (effect.type === 'layer-blur' || !effect.colorTokenId || !removed.has(effect.colorTokenId)) return effect
      const { colorTokenId, ...literal } = effect; void colorTokenId; return literal
    }) } }
  }
  if (Object.values(node.tokenBindings ?? {}).some(id => removed.has(id))) {
    const tokenBindings = { ...node.tokenBindings }
    for (const property of Object.keys(tokenBindings) as TokenProperty[]) if (removed.has(tokenBindings[property]!)) delete tokenBindings[property]
    next = { ...next, tokenBindings }
  }
  return next
}

/** Direct property edits release that property's binding, without affecting other bindings. */
export function detachEditedBindings(bindings: TokenBindings | undefined, patch: Record<string, unknown>, previous: SceneElement): TokenBindings | undefined {
  if (!bindings) return undefined
  const next = { ...bindings }
  const style = patch.style as Record<string, unknown> | undefined
  for (const property of Object.keys(bindings) as TokenProperty[]) {
    if (property === 'fill') {
      if (style && Object.hasOwn(style, 'fill')) delete next.fill
    } else if (property === 'stroke') {
      if (!style || !Object.hasOwn(style, 'stroke')) continue
      const stroke = style.stroke as { color?: string } | null
      if (stroke === null || (stroke && Object.hasOwn(stroke, 'color') && stroke.color !== previous.style.stroke?.color)) delete next.stroke
    } else if (property === 'shadow') {
      if (style && (Object.hasOwn(style, 'shadow') || Object.hasOwn(style, 'effects'))) delete next.shadow
    } else if (Object.hasOwn(patch, property)) delete next[property]
  }
  return next
}

export function boundToken(node: SceneElement, property: TokenProperty, tokens: readonly DesignToken[]): DesignToken | undefined {
  const id = node.tokenBindings?.[property]
  return id ? tokens.find(token => token.id === id) : undefined
}
export function tokenClass(token: DesignToken, property: TokenProperty, text = false, tokens: readonly DesignToken[] = []): string {
  const prefix: Record<TokenProperty, string> = { fill: text ? 'text' : 'bg', stroke: 'border', shadow: 'shadow', cornerRadius: 'rounded', fontSize: 'text', fontFamily: 'font', fontWeight: 'font', lineHeight: 'leading', letterSpacing: 'tracking', x: 'left', y: 'top', width: 'w', height: 'h' }
  if (property === 'shadow') return `shadow-[0px_var(${tokenVariable(token)})_calc(var(${tokenVariable(token)})*2)_#08080826]`
  // These built-in color utilities bypass theme variables entirely.
  if (token.type === 'color' && ['inherit', 'current', 'transparent'].includes(token.name)) return `${prefix[property]}-[color:var(${tokenVariable(token)})]`
  // Tailwind resolves text-* colors before sizes and font-* families before weights.
  // Use a typed variable when another namespace would shadow this token's utility.
  if (property === 'fontSize' && (['inherit', 'current', 'transparent', 'black', 'white'].includes(token.name) || tokens.some(other => other.type === 'color' && other.name === token.name))) return `text-[length:var(${tokenVariable(token)})]`
  if (property === 'fontWeight' && (['sans', 'serif', 'mono'].includes(token.name) || tokens.some(other => other.type === 'fontFamily' && other.name === token.name))) return `font-[number:var(${tokenVariable(token)})]`
  // Container tokens map to max-w utilities; a width binding needs an explicit variable.
  return token.type === 'container' ? `w-[var(${tokenVariable(token)})]` : `${prefix[property]}-${token.name}`
}
