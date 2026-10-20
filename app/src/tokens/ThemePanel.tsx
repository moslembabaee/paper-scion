import { foundationTokens } from './foundation'
import { DocumentThemes } from './DocumentThemes'
import { StyleLibraryPanel } from './StyleLibraryPanel'
import { resolveTokens } from './library'
import { designSystemToCSS } from './libraryCodegen'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Plus, Search, Trash2, Variable, X } from 'lucide-react'
import { Dialog } from '../workspace/Dialog'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { TOKEN_META, tokenCSSValue, tokensToCSS, tokenVariable, validateToken } from './model'
import type { DesignToken, TokenInput, TokenType } from './types'
import { TokenManagerModal } from './TokenManagerModal'
import './tokens.css'

const groups: { label: string; types: TokenType[] }[] = [
  { label: 'Color', types: ['color'] }, { label: 'Radius', types: ['radius'] },
  { label: 'Elevation', types: ['elevation'] },
  { label: 'Spacing', types: ['spacing'] },
  { label: 'Typography', types: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] },
  { label: 'Layout', types: ['container', 'breakpoint'] },
]

function TokenEditor({ store, token, initialType, onClose }: { store: SceneStore; token?: DesignToken; initialType: TokenType; onClose: () => void }) {
  const snapshot = useScene(store, state => state)
  const themeId = snapshot.styleLibrary.activeThemeId
  const currentToken = snapshot.tokens.find(value => value.id === token?.id)
  const resolved = token ? resolveTokens(snapshot.tokens, themeId).find(value => value.id === token.id) : undefined
  const [inheritTheme, setInheritTheme] = useState(false)
  const [aliasId, setAliasId] = useState(token?.aliasId ?? '')
  const [palette, setPalette] = useState(token?.palette ?? '')
  const [type, setType] = useState<TokenType>(token?.type ?? initialType)
  const uniqueName = (nextType: TokenType) => {
    const base = TOKEN_META[nextType].namespace
    let index = 1
    while (store.getSnapshot().tokens.some(value => tokenVariable(value) === tokenVariable({ type: nextType, name: `${base}-${index}` }))) index++
    return `${base}-${index}`
  }
  const [name, setName] = useState(token?.name ?? uniqueName(initialType))
  const [value, setValue] = useState(String(resolved?.value ?? token?.value ?? TOKEN_META[initialType].defaultValue))
  const [error, setError] = useState('')
  const id = useRef(token?.id ?? crypto.randomUUID())
  const persisted = useRef(!!token)
  const [isPersisted, setIsPersisted] = useState(!!token)
  const stringValue = type === 'color' || type === 'fontFamily'
  function save(close = false, nextValue = value) {
    try {
      if (!stringValue && !nextValue.trim()) throw new Error('Enter a numeric value.')
      const draft = { id: id.current, type, name: name.trim(), value: stringValue ? nextValue.trim() : Number(nextValue) } as DesignToken
      validateToken(draft)
      const metadata = { name: draft.name, aliasId: aliasId || undefined, palette: palette.trim() || undefined }
      if (persisted.current) {
        const previous = store.getSnapshot().tokens.find(token => token.id === id.current)!
        const themeValues: Record<string, string | number> = { ...(previous.themeValues as Record<string, string | number> | undefined) }
        if (themeId) { if (inheritTheme) delete themeValues[themeId]; else themeValues[themeId] = draft.value }
        store.updateToken(id.current, { ...metadata, ...(themeId ? { themeValues } : { value: draft.value }) })
      } else { store.addToken({ ...draft, ...metadata, ...(themeId ? { themeValues: { [themeId]: draft.value } } : {}) } as TokenInput); persisted.current = true; setIsPersisted(true) }
      setError('')
      if (close) onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save token') }
  }
  return <Dialog className="token-dialog" labelledBy="token-editor-title" onClose={() => save(true)}>
    <form onSubmit={event => { event.preventDefault(); save(true) }}>
      <div className="token-dialog-heading"><div><span className="section-caption">THEME / TOKENS</span><h2 id="token-editor-title">{token ? 'Edit token' : 'New token'}</h2></div><button type="button" className="quiet-button" aria-label="Save and close token" onClick={() => save(true)}><X size={16} /></button></div>
      <label className="property-label">Type<select className="property-input" aria-label="Token type" value={type} disabled={isPersisted} onChange={event => { const next = event.currentTarget.value as TokenType; setType(next); setAliasId(''); setPalette(''); setName(uniqueName(next)); setValue(String(TOKEN_META[next].defaultValue)); setError('') }}>{(Object.keys(TOKEN_META) as TokenType[]).map(key => <option key={key} value={key}>{TOKEN_META[key].label}</option>)}</select></label>
      <label className="property-label">Name<input autoFocus className="property-input property-mono" aria-label="Token name" value={name} placeholder="brand-blue" spellCheck={false} onChange={event => setName(event.currentTarget.value)} onBlur={() => { if (persisted.current) save() }} /></label>
      {type === 'color' && <label className="property-label">Palette<input className="property-input" aria-label="Color palette" placeholder="e.g. Brand, Neutrals" value={palette} onChange={event => setPalette(event.currentTarget.value)} /></label>}
      <label className="property-label">Alias<select className="property-input" aria-label="Token alias" value={aliasId} onChange={event => { const id = event.currentTarget.value; const source = resolveTokens(snapshot.tokens, themeId).find(candidate => candidate.id === (id || token?.id)); if (source) setValue(String(source.value)); setAliasId(id) }}><option value="">Own value</option>{snapshot.tokens.filter(candidate => candidate.type === type && candidate.id !== token?.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {aliasId && <p className="token-alias-note">Follows the referenced token in every theme.</p>}
      <label className="property-label">{themeId ? `${snapshot.styleLibrary.themes.find(theme => theme.id === themeId)?.name} value` : 'Value'}<span className="token-value-input">{type === 'color' && <input aria-label="Token color picker" disabled={!!aliasId} type="color" value={/^#[\da-f]{6}$/i.test(value) ? value : '#81adec'} onChange={event => { const next = event.currentTarget.value; setInheritTheme(false); setValue(next); if (persisted.current) save(false, next) }} />}<input className="property-input property-mono" aria-label="Token value" disabled={!!aliasId} type={stringValue ? 'text' : 'number'} step="any" value={value} spellCheck={false} onChange={event => { setInheritTheme(false); setValue(event.currentTarget.value) }} onBlur={() => { if (persisted.current) save() }} />{TOKEN_META[type].unit && <span>{TOKEN_META[type].unit}</span>}</span></label>
      {themeId && !aliasId && currentToken?.themeValues && Object.hasOwn(currentToken.themeValues, themeId) && <button type="button" className="text-action" onClick={() => { store.setTokenThemeValue(id.current, themeId, undefined); setInheritTheme(true); setValue(String(resolveTokens(store.getSnapshot().tokens, themeId).find(value => value.id === id.current)!.value)); }}>Reset to base value</button>}
      <code className="token-variable-preview">{tokenVariable({ type, name } as DesignToken)}</code>
      {error && <p className="token-error" role="alert">{error}</p>}
      <div className="token-dialog-footer"><span>Saves when you click away.</span><button type="button" className="token-cancel" onClick={onClose}>Cancel</button><button type="submit" className="token-primary"><Check size={13} />Done</button></div>
    </form>
  </Dialog>
}

export function ThemePanel({ store }: { store: SceneStore }) {
  const snapshot = useScene(store, snapshot => snapshot)
  const tokens = useMemo(() => resolveTokens(snapshot.tokens, snapshot.styleLibrary.activeThemeId), [snapshot.tokens, snapshot.styleLibrary.activeThemeId])
  const elements = useScene(store, snapshot => snapshot.elements)
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of Object.values(elements)) {
      for (const id of new Set(Object.values(node.tokenBindings ?? {}))) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [elements])
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ token?: DesignToken; type: TokenType } | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const shown = tokens.filter(token => `${token.name} ${token.palette ?? ''} ${TOKEN_META[token.type].label}`.toLowerCase().includes(search.toLowerCase()))
  const chosen = (id?: string) => tokens.filter(token => selected.includes(token.id) || (!selected.length && token.id === id))
  function copy(id?: string) {
    const values = chosen(id)
    if (!values.length) return
    navigator.clipboard.writeText(tokensToCSS(values)).then(() => setNotice(`Copied ${values.length} token${values.length === 1 ? '' : 's'}.`)).catch(() => setNotice('Clipboard unavailable. Use Dev Mode to select and copy the CSS.'))
    setMenu(null)
  }
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.token-context-menu')) setMenu(null) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])
  return <div className="theme-panel" ref={panel} data-testid="theme-panel" tabIndex={0} aria-label="Design tokens" onKeyDown={event => {
    if ((event.target as Element).closest('input, textarea, select')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); setSelected(shown.map(token => token.id)) }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy() }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); store.removeTokens(selected); setSelected([]); setMenu(null) }
    if (event.key === 'Escape') { setMenu(null); setSelected([]) }
  }}>
    <div className="theme-intro">
      <span className="section-caption">DESIGN SYSTEM</span>
      <h3>One value. Everywhere.</h3>
      <p>A shared language for your canvas and code.</p>
      <button
        type="button"
        className="token-modal-toggle"
        data-testid="theme-panel-token-manager-btn"
        style={{ marginTop: 8 }}
        onClick={() => setManagerOpen(true)}
      >
        <Variable size={13} />
        <span>Open Token Studio</span>
      </button>
    </div>
    <div className="token-foundations"><button className="text-action" onClick={() => { try { const missing = foundationTokens(snapshot.tokens); if (missing.length) store.addTokens(missing); setNotice(missing.length ? `Added ${missing.length} foundation tokens.` : 'Foundation tokens are already in this document.') } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to add tokens') } }}>Add foundation tokens <Plus size={12} /></button><p>Semantic colors, a type scale, and elevation.</p></div>
    <DocumentThemes store={store} />
    <div className="theme-tools"><label className="token-search"><Search size={12} /><input aria-label="Search tokens" placeholder="Find a token…" value={search} onChange={event => setSearch(event.currentTarget.value)} /></label><button className="quiet-button" aria-label="Add token" title="Add token" onClick={() => setEditor({ type: 'color' })}><Plus size={15} /></button></div>
    <div className="token-groups">{groups.map(group => {
      const values = shown.filter(token => group.types.includes(token.type))
      return <section className="token-group" key={group.label}><div className="token-group-heading"><span>{group.label}</span><span>{values.length}</span><button className="quiet-button" aria-label={`Add ${group.label.toLowerCase()} token`} onClick={() => setEditor({ type: group.types[0] })}><Plus size={12} /></button></div>
        {!values.length ? <span className="token-group-empty">{search ? 'No matching tokens' : `Add ${group.label.toLowerCase()} tokens`}</span> : values.map(token => {
          const uses = usage.get(token.id) ?? 0
          return <div key={token.id} className={`token-item ${selected.includes(token.id) ? 'selected' : ''}`} onContextMenu={event => { event.preventDefault(); if (!selected.includes(token.id)) setSelected([token.id]); setMenu(token.id) }}>
            <button className="token-item-button" title={`${tokenVariable(token)} · ${uses} bound layer${uses === 1 ? '' : 's'}`} onClick={event => {
              if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelected(ids => ids.includes(token.id) ? ids.filter(id => id !== token.id) : [...ids, token.id]); return }
              setSelected([token.id]); setEditor({ token: snapshot.tokens.find(value => value.id === token.id), type: token.type })
            }}>
              <span className={`token-preview token-preview-${token.type}`} style={token.type === 'color' ? { background: token.value } : token.type === 'radius' ? { borderRadius: Math.min(token.value, 10) } : token.type === 'elevation' ? { background: '#edebe1', boxShadow: `0 ${token.value / 2}px ${token.value}px #08080826` } : token.type === 'fontFamily' ? { fontFamily: token.value } : undefined}>{token.type === 'color' || token.type === 'radius' ? '' : group.label === 'Typography' ? 'Aa' : '↔'}</span>
              <span className="token-item-content"><strong>{token.name}</strong><code>{token.aliasId ? `↗ ${tokens.find(value => value.id === token.aliasId)?.name}` : tokenCSSValue(token)}{token.palette ? ` · ${token.palette}` : ''}</code></span>{uses > 0 && <span className="token-usage">{uses}</span>}
            </button>
            {menu === token.id && <div className="token-context-menu" role="menu" aria-label="Token actions"><button role="menuitem" onClick={() => { const duplicate = store.duplicateToken(token.id); setEditor({ token: duplicate, type: duplicate.type }); setMenu(null) }}><Copy size={12} />Duplicate</button><button role="menuitem" onClick={() => copy(token.id)}><Copy size={12} />Copy{selected.length > 1 ? ` ${selected.length} tokens` : ''}</button><button role="menuitem" onClick={() => { store.removeTokens(chosen(token.id).map(value => value.id)); setSelected([]); setMenu(null) }}><Trash2 size={12} />Delete{selected.length > 1 ? ` ${selected.length} tokens` : ''}</button></div>}
          </div>
        })}
      </section>
    })}<StyleLibraryPanel store={store} search={search} /></div>
    {notice && <div className="token-notice" role="status">{notice}<button className="quiet-button" aria-label="Dismiss token message" onClick={() => setNotice('')}><X size={12} /></button></div>}
    <div className="theme-footer"><span>{tokens.length} tokens · Saved with this file</span><button className="text-action" disabled={!tokens.length && !snapshot.styleLibrary.styles.length} onClick={() => { setSelected(tokens.map(token => token.id)); navigator.clipboard.writeText(designSystemToCSS(snapshot.tokens, snapshot.styleLibrary)).then(() => setNotice('Theme CSS copied.')).catch(() => setNotice('Clipboard unavailable.')) }}>Copy theme CSS <Copy size={12} /></button></div>
    {editor && <TokenEditor store={store} token={editor.token} initialType={editor.type} onClose={() => setEditor(null)} />}
    {managerOpen && <TokenManagerModal store={store} onClose={() => setManagerOpen(false)} />}
  </div>
}
