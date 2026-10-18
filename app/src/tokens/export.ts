import { resolveTokens } from './library.ts'
import { TOKEN_META, tokenCSSValue, tokenVariable } from './model.ts'
import type { DesignToken, StyleLibrary, TokenInput, TokenType } from './types.ts'
import type { SceneStore } from '../scene/store.ts'

export type TokenExportFormat = 'tailwind-v4' | 'tailwind-v3' | 'css-variables' | 'typescript' | 'dtcg-json'

/**
 * Categorizes tokens by primary design system types: color, typography, spacing, radius, elevation, layout.
 */
export function groupTokensByType(tokens: readonly DesignToken[]): Record<string, DesignToken[]> {
  const groups: Record<string, DesignToken[]> = {
    color: [],
    typography: [],
    spacing: [],
    radius: [],
    elevation: [],
    layout: [],
  }

  const typographyTypes: TokenType[] = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']

  for (const token of tokens) {
    if (token.type === 'color') {
      groups.color.push(token)
    } else if (typographyTypes.includes(token.type)) {
      groups.typography.push(token)
    } else if (token.type === 'spacing') {
      groups.spacing.push(token)
    } else if (token.type === 'radius') {
      groups.radius.push(token)
    } else if (token.type === 'elevation') {
      groups.elevation.push(token)
    } else {
      groups.layout.push(token)
    }
  }

  return groups
}

/**
 * Exports design tokens to Tailwind CSS v4 `@theme` configuration with multi-mode layers.
 */
export function exportToTailwindV4(tokens: readonly DesignToken[], library: StyleLibrary): string {
  const tokenMap = new Map(tokens.map(t => [t.id, t]))
  const groups = groupTokensByType(tokens)

  const formatDecl = (token: DesignToken) => {
    const v = tokenVariable(token)
    const val = token.aliasId && tokenMap.has(token.aliasId)
      ? `var(${tokenVariable(tokenMap.get(token.aliasId)!)})`
      : tokenCSSValue(token)
    return `  ${v}: ${val};`
  }

  const sections: string[] = []

  // Main @theme block
  sections.push('@theme {')
  if (groups.color.length) {
    sections.push('  /* --- Color Variables --- */')
    for (const t of groups.color) sections.push(formatDecl(t))
  }
  if (groups.typography.length) {
    sections.push('\n  /* --- Typography Variables --- */')
    for (const t of groups.typography) sections.push(formatDecl(t))
  }
  if (groups.spacing.length) {
    sections.push('\n  /* --- Spacing Variables --- */')
    for (const t of groups.spacing) sections.push(formatDecl(t))
  }
  if (groups.radius.length) {
    sections.push('\n  /* --- Border Radius Variables --- */')
    for (const t of groups.radius) sections.push(formatDecl(t))
  }
  if (groups.elevation.length) {
    sections.push('\n  /* --- Elevation Variables --- */')
    for (const t of groups.elevation) sections.push(formatDecl(t))
  }
  if (groups.layout.length) {
    sections.push('\n  /* --- Container & Breakpoint Variables --- */')
    for (const t of groups.layout) sections.push(formatDecl(t))
  }
  sections.push('}')

  // Multi-mode theme variant overrides in @layer base
  if (library.themes.length > 0) {
    sections.push('\n@layer base {')
    for (const theme of library.themes) {
      const modeTokens = resolveTokens(tokens, theme.id)
      const overridden = modeTokens.filter(t => {
        const baseVal = tokens.find(b => b.id === t.id)?.value
        const isExplicit = t.themeValues && Object.hasOwn(t.themeValues, theme.id)
        return isExplicit || t.value !== baseVal
      })

      if (overridden.length > 0) {
        const themeSlug = theme.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
        const selector = themeSlug === 'dark'
          ? '[data-theme="dark"], [data-paper-theme="dark"], .dark'
          : themeSlug === 'high-contrast'
            ? '[data-theme="high-contrast"], [data-paper-theme="high-contrast"], .high-contrast'
            : `[data-theme="${themeSlug}"], [data-paper-theme="${themeSlug}"], .theme-${themeSlug}`

        sections.push(`  /* Mode: ${theme.name} */`)
        sections.push(`  ${selector} {`)
        for (const t of overridden) {
          sections.push(`    ${tokenVariable(t)}: ${tokenCSSValue(t)};`)
        }
        sections.push('  }\n')
      }
    }
    sections.push('}')
  }

  return sections.join('\n')
}

/**
 * Exports design tokens to Tailwind CSS v3 `tailwind.config.js` theme extension file.
 */
export function exportToTailwindV3(tokens: readonly DesignToken[], _library?: StyleLibrary): string {
  const groups = groupTokensByType(tokens)

  const toJsObj = (items: DesignToken[], valTransform?: (t: DesignToken) => string) => {
    const lines = items.map(t => {
      const key = t.name.includes('-') ? `'${t.name}'` : t.name
      const val = valTransform ? valTransform(t) : `'var(${tokenVariable(t)})'`
      return `        ${key}: ${val},`
    })
    return lines.join('\n')
  }

  const parts: string[] = []
  parts.push(`/** @type {import('tailwindcss').Config} */`)
  parts.push(`module.exports = {`)
  parts.push(`  darkMode: ['class', '[data-theme="dark"]'],`)
  parts.push(`  theme: {`)
  parts.push(`    extend: {`)

  if (groups.color.length) {
    parts.push(`      colors: {\n${toJsObj(groups.color)}\n      },`)
  }

  const fontFamilies = groups.typography.filter(t => t.type === 'fontFamily')
  if (fontFamilies.length) {
    parts.push(`      fontFamily: {\n${toJsObj(fontFamilies, t => `['var(${tokenVariable(t)})', 'sans-serif']`)}\n      },`)
  }

  const fontSizes = groups.typography.filter(t => t.type === 'fontSize')
  if (fontSizes.length) {
    parts.push(`      fontSize: {\n${toJsObj(fontSizes)}\n      },`)
  }

  if (groups.spacing.length) {
    parts.push(`      spacing: {\n${toJsObj(groups.spacing)}\n      },`)
  }

  if (groups.radius.length) {
    parts.push(`      borderRadius: {\n${toJsObj(groups.radius)}\n      },`)
  }

  parts.push(`    },`)
  parts.push(`  },`)
  parts.push(`  plugins: [],`)
  parts.push(`}`)

  return parts.join('\n')
}

/**
 * Exports design tokens to a pure CSS custom properties stylesheet (`:root` and multi-mode theme rules).
 */
export function exportToCSSVariables(tokens: readonly DesignToken[], library: StyleLibrary): string {
  const tokenMap = new Map(tokens.map(t => [t.id, t]))
  const groups = groupTokensByType(tokens)

  const formatDecl = (token: DesignToken) => {
    const v = tokenVariable(token)
    const val = token.aliasId && tokenMap.has(token.aliasId)
      ? `var(${tokenVariable(tokenMap.get(token.aliasId)!)})`
      : tokenCSSValue(token)
    return `  ${v}: ${val};`
  }

  const lines: string[] = []
  lines.push('/* ==========================================================================')
  lines.push('   Paper Design System — Variable Tokens')
  lines.push('   Built with Paper (https://github.com/paper-design/paper)')
  lines.push('   ========================================================================== */\n')

  lines.push(':root {')
  if (groups.color.length) {
    lines.push('  /* --- Colors --- */')
    for (const t of groups.color) lines.push(formatDecl(t))
  }
  if (groups.typography.length) {
    lines.push('\n  /* --- Typography --- */')
    for (const t of groups.typography) lines.push(formatDecl(t))
  }
  if (groups.spacing.length) {
    lines.push('\n  /* --- Spacing --- */')
    for (const t of groups.spacing) lines.push(formatDecl(t))
  }
  if (groups.radius.length) {
    lines.push('\n  /* --- Radius --- */')
    for (const t of groups.radius) lines.push(formatDecl(t))
  }
  if (groups.elevation.length) {
    lines.push('\n  /* --- Elevation --- */')
    for (const t of groups.elevation) lines.push(formatDecl(t))
  }
  if (groups.layout.length) {
    lines.push('\n  /* --- Layout & Breakpoints --- */')
    for (const t of groups.layout) lines.push(formatDecl(t))
  }
  lines.push('}\n')

  // Theme modes
  for (const theme of library.themes) {
    const modeTokens = resolveTokens(tokens, theme.id)
    const overridden = modeTokens.filter(t => {
      const baseVal = tokens.find(b => b.id === t.id)?.value
      const isExplicit = t.themeValues && Object.hasOwn(t.themeValues, theme.id)
      return isExplicit || t.value !== baseVal
    })

    if (overridden.length > 0) {
      const themeSlug = theme.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      lines.push(`/* Mode: ${theme.name} */`)
      lines.push(`[data-theme="${themeSlug}"], [data-paper-theme="${themeSlug}"], .theme-${themeSlug} {`)
      for (const t of overridden) {
        lines.push(`  ${tokenVariable(t)}: ${tokenCSSValue(t)};`)
      }
      lines.push('}\n')
    }
  }

  return lines.join('\n')
}

/**
 * Exports design tokens to W3C Design Tokens Community Group (DTCG) standard JSON format.
 */
export function exportToDTCGJson(tokens: readonly DesignToken[], library: StyleLibrary): string {
  const tokenMap = new Map(tokens.map(t => [t.id, t]))

  const dtcgType = (type: TokenType): string => {
    switch (type) {
      case 'color': return 'color'
      case 'fontFamily': return 'fontFamily'
      case 'fontSize': return 'dimension'
      case 'fontWeight': return 'fontWeight'
      case 'lineHeight': return 'number'
      case 'letterSpacing': return 'dimension'
      case 'radius': return 'dimension'
      case 'spacing': return 'dimension'
      case 'elevation': return 'dimension'
      case 'container': return 'dimension'
      case 'breakpoint': return 'dimension'
    }
  }

  const dtcgValue = (token: DesignToken): string | number => {
    if (token.aliasId && tokenMap.has(token.aliasId)) {
      const target = tokenMap.get(token.aliasId)!
      return `{${TOKEN_META[target.type].namespace}.${target.name}}`
    }
    return token.type === 'color' || token.type === 'fontFamily'
      ? token.value
      : tokenCSSValue(token)
  }

  const root: Record<string, any> = {
    $schema: 'https://design-tokens.github.io/community-group/format/',
    name: 'Paper Design System Variables',
  }

  for (const token of tokens) {
    const ns = TOKEN_META[token.type].namespace
    root[ns] ??= {}
    root[ns][token.name] = {
      $type: dtcgType(token.type),
      $value: dtcgValue(token),
      ...(token.palette ? { $description: `Palette: ${token.palette}` } : {}),
    }
  }

  // Include mode overrides
  if (library.themes.length > 0) {
    root.$modes = {}
    for (const theme of library.themes) {
      const modeTokens = resolveTokens(tokens, theme.id)
      const overrides: Record<string, any> = {}
      for (const t of modeTokens) {
        if (t.themeValues && Object.hasOwn(t.themeValues, theme.id)) {
          const ns = TOKEN_META[t.type].namespace
          overrides[ns] ??= {}
          overrides[ns][t.name] = t.type === 'color' || t.type === 'fontFamily' ? t.value : tokenCSSValue(t)
        }
      }
      if (Object.keys(overrides).length > 0) {
        root.$modes[theme.id] = {
          name: theme.name,
          overrides,
        }
      }
    }
  }

  return JSON.stringify(root, null, 2)
}

/**
 * Exports design tokens to TypeScript definitions with const assertions and utility types.
 */
export function exportToTypeScript(tokens: readonly DesignToken[], library: StyleLibrary): string {
  const groups = groupTokensByType(tokens)
  const tokenMap = new Map(tokens.map(t => [t.id, t]))

  const lines: string[] = []
  lines.push('/**')
  lines.push(' * Paper Design System — Design Tokens & Types')
  lines.push(' * Generated with Paper Design Token Studio')
  lines.push(' */\n')

  lines.push('export const tokens = {')
  if (groups.color.length) {
    lines.push('  color: {')
    for (const t of groups.color) {
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': '${t.value}',${aliasComment}`)
    }
    lines.push('  },')
  }
  if (groups.spacing.length) {
    lines.push('  spacing: {')
    for (const t of groups.spacing) {
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': ${t.value},${aliasComment}`)
    }
    lines.push('  },')
  }
  if (groups.radius.length) {
    lines.push('  radius: {')
    for (const t of groups.radius) {
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': ${t.value},${aliasComment}`)
    }
    lines.push('  },')
  }
  if (groups.elevation.length) {
    lines.push('  elevation: {')
    for (const t of groups.elevation) {
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': ${t.value},${aliasComment}`)
    }
    lines.push('  },')
  }
  if (groups.typography.length) {
    lines.push('  typography: {')
    for (const t of groups.typography) {
      const val = typeof t.value === 'string' ? `'${t.value}'` : t.value
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': ${val},${aliasComment}`)
    }
    lines.push('  },')
  }
  if (groups.layout.length) {
    lines.push('  layout: {')
    for (const t of groups.layout) {
      const aliasTarget = t.aliasId ? tokenMap.get(t.aliasId) : undefined
      const aliasComment = aliasTarget ? ` /* alias -> ${aliasTarget.name} */` : ''
      lines.push(`    '${t.name}': ${t.value},${aliasComment}`)
    }
    lines.push('  },')
  }
  lines.push('} as const\n')

  if (library.themes.length > 0) {
    lines.push('export const themeOverrides = {')
    for (const theme of library.themes) {
      const modeTokens = resolveTokens(tokens, theme.id)
      const overridden = modeTokens.filter(t => t.themeValues && Object.hasOwn(t.themeValues, theme.id))
      lines.push(`  '${theme.id}': {`)
      for (const t of overridden) {
        const val = typeof t.value === 'string' ? `'${t.value}'` : t.value
        lines.push(`    '${t.type}.${t.name}': ${val},`)
      }
      lines.push('  },')
    }
    lines.push('} as const\n')
  }

  lines.push('export type ColorToken = keyof typeof tokens.color')
  lines.push('export type SpacingToken = keyof typeof tokens.spacing')
  lines.push('export type RadiusToken = keyof typeof tokens.radius')
  lines.push('export type ElevationToken = keyof typeof tokens.elevation')
  lines.push('export type TypographyToken = keyof typeof tokens.typography')
  lines.push('export type LayoutToken = keyof typeof tokens.layout')
  lines.push('export type ThemeModeId = ' + (library.themes.length > 0 ? library.themes.map(t => `'${t.id}'`).join(' | ') : 'string'))
  lines.push('export type DesignTokenTree = typeof tokens\n')

  lines.push('/** Returns CSS variable name for a token, e.g. "--color-brand" */')
  lines.push('export function tokenVariable(type: keyof typeof tokens, name: string): string {')
  lines.push('  const prefixes: Record<string, string> = {')
  lines.push("    color: 'color',")
  lines.push("    spacing: 'spacing',")
  lines.push("    radius: 'radius',")
  lines.push("    elevation: 'elevation',")
  lines.push("    typography: 'text',")
  lines.push("    layout: 'layout',")
  lines.push('  }')
  lines.push('  return `--${prefixes[type] ?? type}-${name}`')
  lines.push('}\n')

  lines.push('/** Returns CSS var() declaration for a token */')
  lines.push('export function tokenVar(type: keyof typeof tokens, name: string): string {')
  lines.push('  return `var(${tokenVariable(type, name)})`')
  lines.push('}')

  return lines.join('\n')
}

const NAMESPACES_DESC = (Object.keys(TOKEN_META) as TokenType[]).sort((a, b) => TOKEN_META[b].namespace.length - TOKEN_META[a].namespace.length)

function inferTokenTypeAndName(variable: string): { type: TokenType; name: string } | null {
  for (const t of NAMESPACES_DESC) {
    const ns = TOKEN_META[t].namespace
    if (variable === ns) return { type: t, name: 'default' }
    if (variable.startsWith(`${ns}-`)) {
      return { type: t, name: variable.slice(ns.length + 1) }
    }
  }
  // Fallback heuristics
  if (variable.startsWith('bg-') || variable.startsWith('border-') || variable.startsWith('text-color-')) {
    return { type: 'color', name: variable.replace(/^(?:bg|border|text-color)-/, '') }
  }
  return null
}

function parseTokenRawValue(type: TokenType, raw: string): string | number {
  const clean = raw.trim().replace(/;$/, '').trim()
  if (type === 'color' || type === 'fontFamily') {
    return clean
  }
  // Strip px, rem, etc.
  const num = parseFloat(clean.replace(/px|rem|em|pt/, ''))
  return Number.isNaN(num) ? (TOKEN_META[type].defaultValue as number) : num
}

/**
 * Bi-directional code import: parses CSS (:root, @theme, theme selectors) or DTCG JSON
 * and creates or updates tokens with their theme overrides in the store.
 */
export function importTokensFromCode(
  store: SceneStore,
  code: string
): { importedCount: number; updatedCount: number; errors: string[] } {
  const errors: string[] = []
  let importedCount = 0
  let updatedCount = 0

  const snapshot = store.getSnapshot()
  const currentTokens = snapshot.tokens
  const tokenByVar = new Map<string, DesignToken>()
  const tokenById = new Map<string, DesignToken>()
  for (const t of currentTokens) {
    tokenByVar.set(tokenVariable(t), t)
    tokenById.set(t.id, t)
  }

  const existingThemes = new Map(snapshot.styleLibrary.themes.map(t => [t.id.toLowerCase(), t.id]))

  const ensureTheme = (themeName: string): string => {
    const slug = themeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    if (existingThemes.has(slug)) return existingThemes.get(slug)!
    const newId = store.addTheme(themeName)
    existingThemes.set(slug, newId)
    return newId
  }

  const trimmed = code.trim()

  // 1. Try DTCG JSON format
  if (trimmed.startsWith('{') && (trimmed.includes('$value') || trimmed.includes('$type') || trimmed.includes('$schema'))) {
    try {
      const parsed = JSON.parse(trimmed)
      const pendingTokens: TokenInput[] = []
      const modeOverrides = new Map<string, Record<string, string | number>>() // themeId -> { tokenName -> val }

      // Traverse top-level groups
      for (const [groupKey, groupVal] of Object.entries(parsed)) {
        if (groupKey.startsWith('$')) continue
        if (typeof groupVal !== 'object' || groupVal === null) continue

        // Check if groupKey matches a known namespace
        const groupType = (Object.keys(TOKEN_META) as TokenType[]).find(t => TOKEN_META[t].namespace === groupKey || t === groupKey) ?? 'color'

        for (const [tokenName, tokenObj] of Object.entries(groupVal as Record<string, any>)) {
          if (typeof tokenObj !== 'object' || tokenObj === null) continue
          const rawVal = tokenObj.$value
          if (rawVal === undefined) continue

          const valStr = String(rawVal)
          const isAlias = valStr.startsWith('{') && valStr.endsWith('}')
          const parsedVal = isAlias ? TOKEN_META[groupType].defaultValue : parseTokenRawValue(groupType, valStr)

          const draft = {
            type: groupType,
            name: tokenName,
            value: parsedVal,
            palette: tokenObj.$description?.replace(/^Palette:\s*/, '') || undefined,
          } as unknown as TokenInput

          pendingTokens.push(draft)
        }
      }

      // Check $modes in DTCG
      if (parsed.$modes && typeof parsed.$modes === 'object') {
        for (const [themeId, themeData] of Object.entries(parsed.$modes as Record<string, any>)) {
          const actualThemeId = ensureTheme(themeData.name || themeId)
          const overrides: Record<string, string | number> = {}
          if (themeData.overrides) {
            for (const [, catObj] of Object.entries(themeData.overrides as Record<string, any>)) {
              if (typeof catObj === 'object') {
                for (const [tName, tVal] of Object.entries(catObj)) {
                  overrides[tName] = tVal as string | number
                }
              }
            }
          }
          modeOverrides.set(actualThemeId, overrides)
        }
      }

      if (pendingTokens.length > 0) {
        store.batch(() => {
          for (const pending of pendingTokens) {
            const vKey = tokenVariable(pending as DesignToken)
            const existing = tokenByVar.get(vKey)
            if (existing) {
              store.updateToken(existing.id, { value: pending.value })
              updatedCount++
            } else {
              const added = store.addToken(pending)
              tokenByVar.set(vKey, added)
              tokenById.set(added.id, added)
              importedCount++
            }
          }

          // Apply theme overrides
          for (const [tId, overrides] of modeOverrides.entries()) {
            for (const [tName, val] of Object.entries(overrides)) {
              const token = store.getSnapshot().tokens.find(t => t.name === tName)
              if (token) {
                store.setTokenThemeValue(token.id, tId, val as any)
              }
            }
          }
        })
      }

      return { importedCount, updatedCount, errors }
    } catch (cause) {
      errors.push(`DTCG JSON parse error: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  // 2. CSS / Tailwind v4 block parsing
  // Matches selectors and their body: selector { declarations }
  const blockRegex = /([^{}]+)\{([^{}]+)\}/g
  let match: RegExpExecArray | null
  let matchedBlocks = false

  const themeOverridesMap = new Map<string, Map<string, string>>() // themeId -> Map(tokenVar -> rawVal)
  const baseDeclarations = new Map<string, { raw: string; aliasVar?: string }>()

  while ((match = blockRegex.exec(code)) !== null) {
    matchedBlocks = true
    const selector = match[1].trim()
    const body = match[2]

    // Determine target theme (if any)
    let themeId: string | null = null
    const themeMatch = selector.match(/\[data-theme=["']?([a-z0-9_-]+)["']?\]|\[data-paper-theme=["']?([a-z0-9_-]+)["']?\]|\.theme-([a-z0-9_-]+)|\.([a-z0-9_-]+)/i)
    if (themeMatch) {
      const candidate = (themeMatch[1] || themeMatch[2] || themeMatch[3] || themeMatch[4]).toLowerCase()
      if (candidate === 'dark') themeId = ensureTheme('Dark')
      else if (candidate === 'high-contrast') themeId = ensureTheme('High-Contrast')
      else if (candidate === 'light') themeId = null // Base theme
      else if (candidate !== 'root' && candidate !== 'theme' && !candidate.startsWith('layer')) {
        themeId = ensureTheme(candidate.charAt(0).toUpperCase() + candidate.slice(1))
      }
    }

    // Parse variable declarations within body
    const varRegex = /--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi
    let varMatch: RegExpExecArray | null
    while ((varMatch = varRegex.exec(body)) !== null) {
      const varName = `--${varMatch[1].trim()}`
      const rawVal = varMatch[2].trim()

      const aliasMatch = rawVal.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i)
      const aliasVar = aliasMatch ? aliasMatch[1] : undefined

      if (themeId) {
        let themeMap = themeOverridesMap.get(themeId)
        if (!themeMap) {
          themeMap = new Map()
          themeOverridesMap.set(themeId, themeMap)
        }
        themeMap.set(varName, rawVal)
      } else {
        baseDeclarations.set(varName, { raw: rawVal, aliasVar })
      }
    }
  }

  // If no blocks were matched, parse top-level CSS variable declarations
  if (!matchedBlocks) {
    const varRegex = /--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi
    let varMatch: RegExpExecArray | null
    while ((varMatch = varRegex.exec(code)) !== null) {
      const varName = `--${varMatch[1].trim()}`
      const rawVal = varMatch[2].trim()
      const aliasMatch = rawVal.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i)
      baseDeclarations.set(varName, { raw: rawVal, aliasVar: aliasMatch ? aliasMatch[1] : undefined })
    }
  }

  // Process base declarations into store
  store.batch(() => {
    const aliasQueue: { tokenId: string; targetVar: string }[] = []

    for (const [vName, { raw, aliasVar }] of baseDeclarations.entries()) {
      const varStripped = vName.replace(/^--/, '')
      const inferred = inferTokenTypeAndName(varStripped)
      if (!inferred) continue

      const { type, name } = inferred
      const parsedVal = aliasVar ? TOKEN_META[type].defaultValue : parseTokenRawValue(type, raw)

      const existing = tokenByVar.get(vName) ?? store.getSnapshot().tokens.find(t => t.type === type && t.name === name)

      if (existing) {
        store.updateToken(existing.id, { value: parsedVal })
        updatedCount++
        if (aliasVar) aliasQueue.push({ tokenId: existing.id, targetVar: aliasVar })
      } else {
        try {
          const added = store.addToken({
            type,
            name,
            value: parsedVal,
          } as unknown as TokenInput)
          tokenByVar.set(vName, added)
          tokenById.set(added.id, added)
          importedCount++
          if (aliasVar) aliasQueue.push({ tokenId: added.id, targetVar: aliasVar })
        } catch (e) {
          errors.push(`Token ${vName}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    // Resolve aliases
    const allTokens = store.getSnapshot().tokens
    const currentVarLookup = new Map(allTokens.map(t => [tokenVariable(t), t]))
    for (const { tokenId, targetVar } of aliasQueue) {
      const target = currentVarLookup.get(targetVar)
      if (target) {
        store.updateToken(tokenId, { aliasId: target.id })
      }
    }

    // Apply theme overrides
    for (const [tId, overrides] of themeOverridesMap.entries()) {
      for (const [vName, rawVal] of overrides.entries()) {
        const token = currentVarLookup.get(vName)
        if (token) {
          const parsed = parseTokenRawValue(token.type, rawVal)
          store.setTokenThemeValue(token.id, tId, parsed as any)
        }
      }
    }
  })

  return { importedCount, updatedCount, errors }
}

/**
 * Triggers a client-side file download for exported design tokens.
 */
export function downloadTokenFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Copies text content to clipboard with fallback.
 */
export async function copyTokensToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(textarea)
    return successful
  } catch {
    return false
  }
}
