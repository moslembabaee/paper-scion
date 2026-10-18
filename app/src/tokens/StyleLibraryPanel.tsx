import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Plus, Trash2, Unlink, X } from 'lucide-react'
import { Dialog } from '../workspace/Dialog'
import { useScene } from '../scene/useScene'
import type { SceneStore } from '../scene/store'
import type { SceneElement } from '../scene/types'
import type { LayerEffect, SharedStyle, SharedStyleKind, TypographyPreset } from './types'
import { effectsCSS } from './effects'
import { resolveSharedStyle, resolveTokens } from './library'

const defaultTypography: TypographyPreset = { fontFamily: 'Inter, sans-serif', fontSize: 32, fontWeight: 500, lineHeight: 1.2, letterSpacing: -.5, textAlign: 'left' }
function newEffect(type: LayerEffect['type']): LayerEffect {
  const id = crypto.randomUUID()
  return type === 'layer-blur' ? { id, type, enabled: true, blur: 8 } : { id, type, enabled: true, color: '#08080826', x: 0, y: type === 'inner-shadow' ? 2 : 8, blur: 16, spread: 0 }
}

export function EffectStackEditor({ effects, tokens, onChange }: { effects: readonly LayerEffect[]; tokens: ReturnType<SceneStore['getSnapshot']>['tokens']; onChange: (effects: readonly LayerEffect[]) => void }) {
  const update = (index: number, patch: Partial<LayerEffect>) => onChange(effects.map((effect, i) => i === index ? { ...effect, ...patch } as LayerEffect : effect))
  const move = (index: number, direction: number) => { const next = [...effects]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next) }
  return <div className="effect-stack">
    {effects.map((effect, index) => <div className={`effect-card ${effect.enabled ? '' : 'is-disabled'}`} key={effect.id}>
      <div className="effect-card-heading"><input type="checkbox" aria-label={`Enable effect ${index + 1}`} checked={effect.enabled} onChange={event => update(index, { enabled: event.currentTarget.checked })} /><span>{effect.type === 'drop-shadow' ? 'Drop shadow' : effect.type === 'inner-shadow' ? 'Inner shadow' : 'Layer blur'}</span><button type="button" className="quiet-button" aria-label={`Move effect ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button type="button" className="quiet-button" aria-label={`Move effect ${index + 1} down`} disabled={index === effects.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button type="button" className="quiet-button" aria-label={`Remove effect ${index + 1}`} onClick={() => onChange(effects.filter((_, i) => i !== index))}><Trash2 size={12} /></button></div>
      <div className="effect-fields">{(effect.type === 'layer-blur' ? ['blur'] as const : ['x', 'y', 'blur', 'spread'] as const).map(key => <label className="property-label" key={key}>{key === 'blur' ? 'Blur' : key === 'spread' ? 'Spread' : key.toUpperCase()}<input type="number" className="property-input" aria-label={`Effect ${index + 1} ${key}`} min={key === 'blur' ? 0 : undefined} max={key === 'blur' ? 500 : undefined} step="any" value={effect[key as keyof typeof effect] as number} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && (key !== 'blur' || (value >= 0 && value <= 500)) && (key === 'blur' || Math.abs(value) <= 10000)) update(index, { [key]: value }) }} /></label>)}</div>
      {effect.type !== 'layer-blur' && <><label className="property-label">Color<input className="property-input property-mono" aria-label={`Effect ${index + 1} color`} key={effect.id + effect.color} defaultValue={effect.color} disabled={!!effect.colorTokenId} onBlur={event => { const color = event.currentTarget.value.trim(); if (CSS.supports('color', color)) update(index, { color }); else event.currentTarget.value = effect.color }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label><select className="property-input" aria-label={`Effect ${index + 1} color token`} value={effect.colorTokenId ?? ''} onChange={event => { const colorTokenId = event.currentTarget.value; const token = tokens.find(token => token.id === colorTokenId && token.type === 'color'); update(index, { colorTokenId: colorTokenId || undefined, color: token?.value as string ?? effect.color }) }}><option value="">Custom color</option>{tokens.filter(token => token.type === 'color').map(token => <option key={token.id} value={token.id}>{token.name}</option>)}</select></>}
    </div>)}
    <div className="effect-add-row">{(['drop-shadow', 'inner-shadow', 'layer-blur'] as const).map(type => <button type="button" className="text-action" key={type} disabled={effects.length >= 32} onClick={() => onChange([...effects, newEffect(type)])}><Plus size={11} />{type === 'drop-shadow' ? 'Drop' : type === 'inner-shadow' ? 'Inner' : 'Blur'}</button>)}</div>
  </div>
}

function StyleEditor({ store, initial, onClose }: { store: SceneStore; initial: SharedStyle; onClose: () => void }) {
  const [draft, setDraft] = useState(initial), [error, setError] = useState('')
  const snapshot = useScene(store, state => state)
  const tokens = useMemo(() => resolveTokens(snapshot.tokens, snapshot.styleLibrary.activeThemeId), [snapshot.tokens, snapshot.styleLibrary.activeThemeId])
  const resolvedDraft = resolveSharedStyle(draft, tokens)
  const exists = store.getSnapshot().styleLibrary.styles.some(style => style.id === initial.id)
  function save() {
    try { if (exists) store.updateSharedStyle(draft); else store.addSharedStyle(draft); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save style.') }
  }
  return <Dialog className="token-dialog shared-style-dialog" labelledBy="shared-style-title" onClose={onClose}><form onSubmit={event => { event.preventDefault(); save() }}>
    <div className="token-dialog-heading"><div><span className="section-caption">SHARED LIBRARY / {draft.kind.toUpperCase()}</span><h2 id="shared-style-title">{exists ? 'Edit shared style' : 'New shared style'}</h2></div><button type="button" className="quiet-button" aria-label="Close style editor" onClick={onClose}><X size={16} /></button></div>
    <label className="property-label">Name<input autoFocus className="property-input" aria-label="Shared style name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
    {draft.kind === 'color' && <><label className="property-label">Color<input className="property-input property-mono" aria-label="Shared color value" disabled={!!draft.tokenId} value={resolvedDraft.kind === 'color' ? resolvedDraft.value : draft.value} onChange={event => setDraft({ ...draft, value: event.currentTarget.value })} /></label><label className="property-label">Color token<select className="property-input" aria-label="Shared color token" value={draft.tokenId ?? ''} onChange={event => setDraft({ ...draft, value: resolvedDraft.kind === 'color' ? resolvedDraft.value : draft.value, tokenId: event.currentTarget.value || undefined })}><option value="">Custom color</option>{tokens.filter(token => token.type === 'color').map(token => <option key={token.id} value={token.id}>{token.name}</option>)}</select></label></>}
    {draft.kind === 'typography' && <><div className="typography-style-preview" style={resolvedDraft.kind === 'typography' ? { fontFamily: resolvedDraft.value.fontFamily, fontWeight: resolvedDraft.value.fontWeight } : undefined}>Aa<span>The shape of a thought.</span></div>{(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const).map(key => <label className="property-label" key={key}>{({ fontFamily: 'Font family', fontSize: 'Font size', fontWeight: 'Weight', lineHeight: 'Line height', letterSpacing: 'Tracking' })[key]}<div className="preset-field"><input className="property-input" aria-label={`Preset ${key}`} disabled={!!draft.value.tokenBindings?.[key]} type={key === 'fontFamily' ? 'text' : 'number'} step="any" value={resolvedDraft.kind === 'typography' ? resolvedDraft.value[key] : draft.value[key]} onChange={event => setDraft({ ...draft, value: { ...draft.value, [key]: key === 'fontFamily' ? event.currentTarget.value : event.currentTarget.valueAsNumber } })} /><select className="property-input" aria-label={`Preset ${key} token`} value={draft.value.tokenBindings?.[key] ?? ''} onChange={event => { const tokenBindings = { ...draft.value.tokenBindings }; if (event.currentTarget.value) tokenBindings[key] = event.currentTarget.value; else delete tokenBindings[key]; setDraft({ ...draft, value: { ...(resolvedDraft.kind === 'typography' ? resolvedDraft.value : draft.value), tokenBindings } }) }}><option value="">Custom</option>{tokens.filter(token => token.type === key).map(token => <option value={token.id} key={token.id}>{token.name}</option>)}</select></div></label>)}<label className="property-label">Alignment<select className="property-input" aria-label="Preset alignment" value={draft.value.textAlign} onChange={event => setDraft({ ...draft, value: { ...draft.value, textAlign: event.currentTarget.value as TypographyPreset['textAlign'] } })}>{['left', 'center', 'right'].map(value => <option key={value}>{value}</option>)}</select></label></>}
    {draft.kind === 'effects' && <EffectStackEditor effects={resolvedDraft.kind === 'effects' ? resolvedDraft.value : draft.value} tokens={tokens} onChange={value => setDraft({ ...draft, value })} />}
    {error && <p className="token-error" role="alert">{error}</p>}
    <div className="token-dialog-footer"><span>Updates every bound layer.</span><button type="button" className="token-cancel" onClick={onClose}>Cancel</button><button className="token-primary" type="submit"><Check size={13} />Save style</button></div>
  </form></Dialog>
}

function captureStyle(store: SceneStore, kind: SharedStyleKind): SharedStyle {
  const state = store.getSnapshot(), node = state.elements[state.selection[0]], id = crypto.randomUUID()
  if (kind === 'color') return { id, kind, name: 'Brand / Accent', value: node?.style.fill ?? '#81adec', tokenId: node?.tokenBindings?.fill }
  if (kind === 'effects') return { id, kind, name: 'Elevation / Soft', value: node?.style.effects ?? [newEffect('drop-shadow')] }
  const value: TypographyPreset = node?.type === 'text' ? { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight, lineHeight: node.lineHeight, letterSpacing: node.letterSpacing, textAlign: node.textAlign, tokenBindings: Object.fromEntries(Object.entries(node.tokenBindings ?? {}).filter(([key]) => ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].includes(key))) } : defaultTypography
  return { id, kind, name: 'Type / Heading', value }
}

export function StyleLibraryPanel({ store, search }: { store: SceneStore; search: string }) {
  const state = useScene(store, state => state)
  const [draft, setDraft] = useState<SharedStyle | null>(null), [error, setError] = useState('')
  const node = state.elements[state.selection[0]]
  const tokens = useMemo(() => resolveTokens(state.tokens, state.styleLibrary.activeThemeId), [state.tokens, state.styleLibrary.activeThemeId])
  const styles = useMemo(() => state.styleLibrary.styles.map(style => resolveSharedStyle(style, tokens)), [state.styleLibrary.styles, tokens])
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const layer of Object.values(state.elements)) for (const id of Object.values(layer.sharedStyleBindings ?? {})) counts.set(id, (counts.get(id) ?? 0) + 1)
    return counts
  }, [state.elements])
  return <div className="shared-library" data-testid="shared-style-library"><div className="library-heading"><span className="section-caption">SHARED STYLES</span><span>{state.styleLibrary.styles.length}</span></div><p className="library-description">Save a look. Keep every layer in sync.</p>
    {(['color', 'typography', 'effects'] as const).map(kind => <section className="token-group" key={kind}><div className="token-group-heading"><span>{kind === 'color' ? 'Color styles' : kind === 'typography' ? 'Typography presets' : 'Effect stacks'}</span><button className="quiet-button" aria-label={`Add shared ${kind} style`} onClick={() => setDraft(captureStyle(store, kind))}><Plus size={12} /></button></div>
      {styles.filter(style => style.kind === kind && style.name.toLowerCase().includes(search.toLowerCase())).map(style => <div className="shared-style-row" key={style.id}><button className="token-item-button" onClick={() => setDraft(state.styleLibrary.styles.find(source => source.id === style.id)!)} aria-label={`Edit style ${style.name}`}><span className={`token-preview shared-preview-${kind}`} style={style.kind === 'color' ? { background: style.value } : style.kind === 'effects' ? effectsCSS(style.value) : { fontFamily: style.value.fontFamily }}>{kind === 'typography' ? 'Aa' : kind === 'effects' ? '◻' : ''}</span><span className="token-item-content"><strong>{style.name}</strong><code>{usage.get(style.id) ?? 0} bound layers</code></span></button><button className="quiet-button" aria-label={`Apply style ${style.name}`} title="Apply to selection" disabled={!state.selection.length || state.selection.some(id => kind === 'typography' && state.elements[id].type !== 'text')} onClick={() => { try { store.batch(() => state.selection.forEach(id => store.bindSharedStyle(id, kind, style.id)), `Apply ${style.name}`); setError('') } catch (cause) { setError(String(cause)) } }}><Check size={12} /></button><button className="quiet-button" aria-label={`Delete style ${style.name}`} onClick={() => store.removeSharedStyle(style.id)}><Trash2 size={12} /></button></div>)}
      {!state.styleLibrary.styles.some(style => style.kind === kind) && <span className="token-group-empty">{kind === 'typography' && node?.type === 'text' ? 'Create a preset from the selected text' : 'Create your first shared style'}</span>}
    </section>)}
    {error && <p className="token-error" role="alert">{error}</p>}
    {draft && <StyleEditor store={store} initial={draft} onClose={() => setDraft(null)} />}
  </div>
}

export function SharedStyleInspector({ store, node }: { store: SceneStore; node: SceneElement }) {
  const library = useScene(store, state => state.styleLibrary)
  const [error, setError] = useState('')
  if (!library.styles.length) return null
  return <div className="inspector-section"><span className="section-caption">SHARED STYLES</span>{(['color', 'typography', 'effects'] as const).filter(kind => kind !== 'typography' || node.type === 'text').map(kind => <label className="property-label" key={kind}>{kind === 'color' ? 'Color' : kind === 'typography' ? 'Typography' : 'Effects'}<div className="shared-binding"><select className="property-input" aria-label={`Shared ${kind} style`} value={node.sharedStyleBindings?.[kind] ?? ''} onChange={event => { try { if (event.currentTarget.value) store.bindSharedStyle(node.id, kind, event.currentTarget.value); else store.detachSharedStyle(node.id, kind); setError('') } catch (cause) { setError(String(cause)) } }}><option value="">Custom</option>{library.styles.filter(style => style.kind === kind).map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select>{node.sharedStyleBindings?.[kind] && <button className="quiet-button" aria-label={`Detach shared ${kind} style`} title="Detach · keep appearance" onClick={() => store.detachSharedStyle(node.id, kind)}><Unlink size={12} /></button>}</div></label>)}{error && <p className="token-error" role="alert">{error}</p>}</div>
}
