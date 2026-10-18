import type { SceneStore } from '../scene/store.ts'
import { TOKEN_META, tokenVariable, validateToken } from './model.ts'
import type { DesignToken, TokenType } from './types.ts'

const namespaces = (Object.keys(TOKEN_META) as TokenType[]).sort((a, b) => TOKEN_META[b].namespace.length - TOKEN_META[a].namespace.length)

/** CSS is the interchange format for both codebases and other Paper files. */
export function pasteTokenCSS(store: SceneStore, source: string): number {
  // Import the base declarations only; document-theme scopes and shared-style
  // rules must not become duplicate base tokens when pasting a full library.
  const block = /^\s*(?::root|@theme(?:\s+static)?)\s*\{([^{}]*)\}/.exec(source)
  if (!block) return 0
  const names = new Set(store.getSnapshot().tokens.map(tokenVariable))
  const imported: DesignToken[] = []
  const aliases = new Map<string, string>()
  const originals = new Map<string, DesignToken>()
  for (const [, variable, raw] of block[1].matchAll(/--([a-z][a-z0-9-]*)\s*:\s*([^;{}]*);/g)) {
    const type = namespaces.find(key => variable.startsWith(`${TOKEN_META[key].namespace}-`))
    if (!type) continue
    if (!raw.trim()) throw new Error('Enter a token value.')
    const originalName = variable.slice(TOKEN_META[type].namespace.length + 1)
    let name = originalName, index = 2
    const alias = /^var\(\s*(--[a-z][a-z0-9-]*)\s*\)$/.exec(raw.trim())
    const value = alias ? TOKEN_META[type].defaultValue : type === 'color' || type === 'fontFamily' ? raw.trim() : Number(raw.trim().replace(/px$/, ''))
    const draft = { id: crypto.randomUUID(), type, name, value } as DesignToken
    validateToken(draft)
    while (names.has(tokenVariable({ ...draft, name }))) name = `${originalName}-${index++}`
    const token = { ...draft, name }
    names.add(tokenVariable(token))
    imported.push(token)
    originals.set(`--${variable}`, token)
    if (alias) aliases.set(token.id, alias[1])
  }
  const existing = new Map(store.getSnapshot().tokens.map(token => [tokenVariable(token), token]))
  store.addTokens(imported.map(token => {
    const variable = aliases.get(token.id)
    if (!variable) return token
    const target = originals.get(variable) ?? existing.get(variable)
    if (!target || target.type !== token.type) throw new Error('An alias needs an existing token of the same type.')
    return { ...token, aliasId: target.id }
  }))
  return imported.length
}
