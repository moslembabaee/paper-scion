import { useEffect, useMemo } from 'react'
import type { SceneStore } from '../scene/store.ts'
import { useScene } from '../scene/useScene.ts'
import { resolveTokens } from './library.ts'
import { tokenCSSValue, tokenVariable, tokensToCSS } from './model.ts'
import type { DesignToken, StyleLibrary } from './types.ts'
import { STANDARD_THEMES } from './themes.ts'
import { sharedStyleClass } from './libraryCodegen.ts'
import { effectsCSS } from './effects.ts'

export const THEME_STYLE_TAG_ID = 'paper-theme-tokens'

/**
 * Generates real-time CSS stylesheet for design tokens across all variable modes
 * (Light, Dark, High-Contrast, and document-specific themes).
 */
export function generateThemeTokensCSS(
  tokens: readonly DesignToken[],
  library: StyleLibrary
): string {
  const parts: string[] = []

  // 1. Root variables (defaults or active theme)
  const activeTokens = resolveTokens(tokens, library.activeThemeId)
  parts.push(tokensToCSS(activeTokens))

  // Collect all themes to generate (standard + document themes)
  const allThemes = [...STANDARD_THEMES]
  const existingIds = new Set(allThemes.map(t => t.id.toLowerCase()))
  for (const theme of library.themes) {
    if (!existingIds.has(theme.id.toLowerCase())) {
      allThemes.push(theme)
      existingIds.add(theme.id.toLowerCase())
    }
  }

  // 2. Mode-specific scoped selectors for frames and instances
  for (const theme of allThemes) {
    const safeId = theme.id.replace(/["\\]/g, '')
    const resolved = resolveTokens(tokens, theme.id)
    const declarations = resolved.map(token => {
      // If token is aliased in this theme, output var() if target exists, else literal
      const themeAlias = token.themeAliases ? token.themeAliases[theme.id] : undefined
      const aliasId = themeAlias ?? token.aliasId
      const target = aliasId ? tokens.find(t => t.id === aliasId) : undefined
      if (target && !token.themeValues?.[theme.id]) {
        return `  ${tokenVariable(token)}: var(${tokenVariable(target)});`
      }
      return `  ${tokenVariable(token)}: ${tokenCSSValue(token)};`
    }).join('\n')

    // Scoped selectors: frame data attributes and class names
    parts.push(
      `[data-theme-mode="${safeId}"],\n[data-paper-theme="${safeId}"],\n.theme-${safeId} {\n${declarations}\n}`
    )
  }

  // 3. Shared styles classes
  for (const style of library.styles) {
    const declarations: string[] = []
    const variable = (id: string) => `var(${tokenVariable(tokens.find(token => token.id === id)!)})`
    if (style.kind === 'color') {
      declarations.push(
        `--paper-style-color: ${style.tokenId ? variable(style.tokenId) : style.value};`,
        'background-color: var(--paper-style-color);'
      )
    } else if (style.kind === 'typography') {
      const properties = {
        fontFamily: 'font-family',
        fontSize: 'font-size',
        fontWeight: 'font-weight',
        lineHeight: 'line-height',
        letterSpacing: 'letter-spacing',
      } as const
      for (const key of Object.keys(properties) as (keyof typeof properties)[]) {
        declarations.push(
          `${properties[key]}: ${
            style.value.tokenBindings?.[key]
              ? variable(style.value.tokenBindings[key]!)
              : `${style.value[key]}${key === 'fontSize' || key === 'letterSpacing' ? 'px' : ''}`
          };`
        )
      }
      declarations.push(`text-align: ${style.value.textAlign};`)
    } else if (style.kind === 'effects') {
      const effects = effectsCSS(
        style.value.map(effect =>
          effect.type !== 'layer-blur' && effect.colorTokenId
            ? { ...effect, color: variable(effect.colorTokenId) }
            : effect
        )
      )
      if (effects.boxShadow) declarations.push(`box-shadow: ${effects.boxShadow};`)
      if (effects.filter) declarations.push(`filter: ${effects.filter};`)
    }
    parts.push(`.${sharedStyleClass(style)} {\n${declarations.map(value => `  ${value}`).join('\n')}\n}`)
  }

  return parts.join('\n\n')
}

/**
 * Injects or updates real-time CSS stylesheet in the target DOM document head.
 * Safe to execute in Node/headless test environments.
 */
export function injectThemeTokensCSS(
  tokens: readonly DesignToken[],
  library: StyleLibrary,
  targetDoc?: Document
): () => void {
  const doc = targetDoc ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc || !doc.head) return () => {}

  const css = generateThemeTokensCSS(tokens, library)
  let styleTag = doc.getElementById(THEME_STYLE_TAG_ID) as HTMLStyleElement | null

  if (!styleTag) {
    styleTag = doc.createElement('style')
    styleTag.id = THEME_STYLE_TAG_ID
    styleTag.setAttribute('data-paper-generated', 'tokens')
    doc.head.appendChild(styleTag)
  }

  if (styleTag.textContent !== css) {
    styleTag.textContent = css
  }

  return () => {
    if (styleTag && styleTag.parentNode) {
      styleTag.parentNode.removeChild(styleTag)
    }
  }
}

/**
 * React hook that injects and maintains real-time CSS custom properties in document head.
 */
export function useThemeTokenInjector(store: SceneStore): string {
  const snapshot = useScene(store, state => ({
    tokens: state.tokens,
    styleLibrary: state.styleLibrary,
  }))

  const css = useMemo(() => {
    return generateThemeTokensCSS(snapshot.tokens, snapshot.styleLibrary)
  }, [snapshot.tokens, snapshot.styleLibrary])

  useEffect(() => {
    return injectThemeTokensCSS(snapshot.tokens, snapshot.styleLibrary)
  }, [snapshot.tokens, snapshot.styleLibrary])

  return css
}
