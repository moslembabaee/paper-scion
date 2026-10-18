import { useState } from 'react'
import { Crosshair, MessageSquare, Trash2, X } from 'lucide-react'
import type { MakeWorkspaceStore, MakeWorkspaceState } from './workspace-model'

function AnnotationForm({ target, saved, disabled, store, count }: {
  target: NonNullable<MakeWorkspaceState['selectedElement']>
  saved: boolean
  disabled: boolean
  store: MakeWorkspaceStore
  count: number
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  return (
    <form onSubmit={event => {
      event.preventDefault()
      try {
        const { bounds: _bounds, styles: _styles, ...metadata } = target
        store.addAnnotation({ ...metadata, text })
        setText('')
        setError('')
        if (saved) void store.saveAnnotations()
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save annotation') }
    }}>
      <div className="make-annotation-target" data-testid="make-selected-target" data-element-id={target.elementId}>
        <Crosshair size={13} /><code>&lt;{target.tagName}&gt;</code>
        <button type="button" className="make-annotation-clear" aria-label="Clear selected element" onClick={() => store.selectElement(null)}><X size={12} /></button>
        <span>{target.elementId}</span>
      </div>
      {target.previewText ? <p className="make-annotation-excerpt">{target.previewText}</p> : null}
      <label className="make-sr-only" htmlFor="make-annotation-text">Annotation text</label>
      <textarea id="make-annotation-text" value={text} onChange={event => setText(event.target.value)} maxLength={2048} rows={3}
        placeholder="What should change here?" disabled={disabled} />
      <button className="make-button" type="submit" disabled={disabled || !text.trim() || count >= 200}>Save annotation</button>
      {error ? <p className="make-asset-error" role="alert">{error}</p> : null}
    </form>
  )
}

export function AnnotationPanel({ store, state, saved, disabled }: {
  store: MakeWorkspaceStore
  state: MakeWorkspaceState
  saved: boolean
  disabled: boolean
}) {
  const [actionError, setActionError] = useState('')
  const target = state.selectedElement
  const annotations = state.activeProject.annotations ?? []

  return <section className="make-annotations" aria-label="Preview annotations">
    <h2><MessageSquare size={14} />Annotations<span>{annotations.length.toString().padStart(2, '0')}</span></h2>
    {target ? (
      <AnnotationForm
        key={`${state.activeProject.id}:${target.elementId}`}
        target={target}
        saved={saved}
        disabled={disabled}
        store={store}
        count={annotations.length}
      />
    ) : (
      <p className="make-annotation-help">{state.inspectMode ? 'Click an element in the preview to leave a note.' : 'Choose Select element in the preview toolbar to target a change.'}</p>
    )}
    {actionError ? <p className="make-asset-error" role="alert">{actionError}</p> : null}
    {annotations.map(annotation => <article className="make-annotation" key={annotation.id}>
      <button className="make-annotation-link" disabled={disabled} onClick={() => {
        store.selectElement({ elementId: annotation.elementId, tagName: annotation.tagName, previewText: annotation.previewText })
        store.setInspectMode(true)
      }} title={`Select ${annotation.elementId}`}><Crosshair size={12} /><code>&lt;{annotation.tagName}&gt;</code><span>{annotation.elementId}</span></button>
      <p>{annotation.text}</p>
      <div className="make-annotation-actions">
        <button className="make-button" disabled={disabled} onClick={() => {
          try { store.attachAnnotationToPrompt(annotation.id); setActionError('') }
          catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not include annotation') }
        }}>Include in prompt</button>
        <button className="make-button" aria-label="Delete annotation" disabled={disabled} onClick={() => {
          store.deleteAnnotation(annotation.id)
          if (saved) void store.saveAnnotations()
        }}><Trash2 size={12} /></button>
      </div>
    </article>)}
    {annotations.length || state.annotationDirty ? <div className="make-annotation-save" role="status">
      <span>{state.projectStatus === 'saving' ? 'Saving annotations…' : state.annotationDirty ? saved ? 'Annotations have unsaved changes' : 'Save a copy to keep these annotations' : saved ? 'All annotations saved' : 'Save a copy to keep these annotations'}</span>
      {saved && state.annotationDirty ? <button className="make-button" disabled={disabled} onClick={() => { void store.saveAnnotations() }}>Save annotations</button> : null}
    </div> : null}
  </section>
}
