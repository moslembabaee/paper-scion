import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'

export function DocumentThemes({ store }: { store: SceneStore }) {
  const library = useScene(store, state => state.styleLibrary)
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [error, setError] = useState('')
  return <div className="document-themes"><label className="section-caption" htmlFor="document-theme">DOCUMENT THEME</label><div className="document-theme-controls"><select id="document-theme" className="property-input" aria-label="Document theme" value={library.activeThemeId ?? ''} onChange={event => { try { store.setActiveTheme(event.currentTarget.value || null); setError('') } catch (cause) { setError(String(cause)) } }}><option value="">Base</option>{library.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select><button className="quiet-button" aria-label="Add document theme" onClick={() => setAdding(!adding)}><Plus size={14} /></button>{library.activeThemeId && <button className="quiet-button" aria-label="Delete active document theme" title="Remove theme overrides" onClick={() => store.removeTheme(library.activeThemeId!)}><Trash2 size={12} /></button>}</div>
    {adding && <form className="theme-create-form" onSubmit={event => { event.preventDefault(); try { const id = store.addTheme(name.trim()); store.setActiveTheme(id); setAdding(false); setName(''); setError('') } catch (cause) { setError(String(cause)) } }}><input autoFocus className="property-input" aria-label="New theme name" placeholder="e.g. Dark" value={name} onChange={event => setName(event.currentTarget.value)} /><button className="token-primary" type="submit" disabled={!name.trim()}>Add</button></form>}
    <p>Edit a token to set its value in this theme.</p>{error && <span className="token-error" role="alert">{error}</span>}
  </div>
}
