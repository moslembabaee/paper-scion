import { effectsCSS } from './effects.ts'
import { tokenCSSValue, tokensToCSS, tokenVariable } from './model.ts'
import { resolveTokens } from './library.ts'
import type { DesignToken, SharedStyle, StyleLibrary } from './types.ts'

export function sharedStyleClass(style: SharedStyle): string { return `paper-style-${style.id.replace(/[^a-zA-Z0-9-]/g, '-')}` }
export function designSystemToCSS(tokens: readonly DesignToken[], library: StyleLibrary, tailwind = false): string {
  const parts = [tokensToCSS(tokens, tailwind)]
  for (const theme of library.themes) {
    const resolved = resolveTokens(tokens, theme.id)
    const declarations = resolved.map(token => `  ${tokenVariable(token)}: ${tokenCSSValue(token)};`).join('\n')
    parts.push(`[data-paper-theme="${theme.id.replace(/["\\]/g, '')}"] {\n${declarations}\n}`)
  }
  for (const style of library.styles) {
    const declarations: string[] = []
    const variable = (id: string) => `var(${tokenVariable(tokens.find(token => token.id === id)!)})`
    if (style.kind === 'color') declarations.push(`--paper-style-color: ${style.tokenId ? variable(style.tokenId) : style.value};`, 'background-color: var(--paper-style-color);')
    if (style.kind === 'typography') {
      const properties = { fontFamily: 'font-family', fontSize: 'font-size', fontWeight: 'font-weight', lineHeight: 'line-height', letterSpacing: 'letter-spacing' } as const
      for (const key of Object.keys(properties) as (keyof typeof properties)[]) declarations.push(`${properties[key]}: ${style.value.tokenBindings?.[key] ? variable(style.value.tokenBindings[key]!) : `${style.value[key]}${key === 'fontSize' || key === 'letterSpacing' ? 'px' : ''}`};`)
      declarations.push(`text-align: ${style.value.textAlign};`)
    }
    if (style.kind === 'effects') {
      const effects = effectsCSS(style.value.map(effect => effect.type !== 'layer-blur' && effect.colorTokenId ? { ...effect, color: variable(effect.colorTokenId) } : effect))
      if (effects.boxShadow) declarations.push(`box-shadow: ${effects.boxShadow};`)
      if (effects.filter) declarations.push(`filter: ${effects.filter};`)
    }
    parts.push(`.${sharedStyleClass(style)} {\n${declarations.map(value => `  ${value}`).join('\n')}\n}`)
  }
  return parts.join('\n\n')
}
