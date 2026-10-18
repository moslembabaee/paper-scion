import { useMemo, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { MakeWorkspaceState, MakeWorkspaceStore } from './workspace-model'
import type { AppProject } from './types'
import { applyVisualPropertyUpdate, inspectElementEligibility, type AllowedVisualProperty, type VisualUpdateResult } from './visual-inspector'

const GROUPS: { title: string; fields: [AllowedVisualProperty, string][] }[] = [
  { title: 'Typography', fields: [['fontSize', 'Font size'], ['fontWeight', 'Font weight'], ['lineHeight', 'Line height'], ['letterSpacing', 'Letter spacing'], ['textAlign', 'Text align'], ['textTransform', 'Text transform']] },
  { title: 'Spacing', fields: [['padding', 'Padding'], ['margin', 'Margin'], ['gap', 'Gap']] },
  { title: 'Color & border', fields: [['color', 'Text color'], ['backgroundColor', 'Background color'], ['borderColor', 'Border color'], ['borderWidth', 'Border width'], ['borderRadius', 'Corner radius']] },
]

export default function VisualInspector({ store, state, disabled }: { store: MakeWorkspaceStore; state: MakeWorkspaceState; disabled: boolean }) {
  const project = state.activeProject
  const target = state.selectedElement!
  const inspection = useMemo(() => inspectElementEligibility(project, target), [project, target])
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [review, setReview] = useState<{ result: VisualUpdateResult; project: AppProject; changes: Record<string, string> } | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const dirty = Object.keys(changes).length > 0

  async function reviewChanges() {
    const generation = ++sequence.current
    setError('')
    try {
      const result = await applyVisualPropertyUpdate(project, target, changes)
      if (generation === sequence.current) setReview({ result, project, changes: { ...changes } })
    } catch (cause) {
      if (generation === sequence.current) { setReview(null); setError(cause instanceof Error ? cause.message : 'Could not review changes') }
    }
  }

  return <section className="make-visual-inspector" role="region" aria-label="Visual properties" aria-busy={disabled}>
    <h2><SlidersHorizontal size={14} />Visual properties<span>{inspection.readOnly ? 'READ-ONLY' : `REV ${project.revision}`}</span></h2>
    <div className="make-visual-target"><code>&lt;{target.tagName}&gt;</code><span>{target.previewText || target.elementId}</span></div>
    {inspection.readOnly ? <>
      <p className="make-visual-help" role="status">Read-only · {inspection.reason}</p>
      <dl className="make-visual-readonly">{Object.entries(inspection.currentStyles).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    </> : <>
      <p className="make-visual-help">Overrides · {inspection.filePath}<br />Repeated instances share these source styles.</p>
      <form onSubmit={event => { event.preventDefault(); void reviewChanges() }}>
        {GROUPS.map(group => <fieldset key={group.title} disabled={disabled}>
          <legend>{group.title}</legend>
          <div className="make-visual-fields">{group.fields.map(([key, label]) => <label key={key}>
            <span>{label}</span>
            <input type="text" aria-label={label} maxLength={128} spellCheck={false} autoComplete="off"
              value={changes[key] ?? inspection.inlineStyles[key] ?? ''} placeholder={inspection.currentStyles[key] || 'Default'}
              onChange={event => {
                sequence.current++
                setChanges(previous => ({ ...previous, [key]: event.target.value }))
                setReview(null); setError('')
              }} />
          </label>)}</div>
        </fieldset>)}
        <p className="make-visual-help">Use px, rem, hex or rgb. Clear an override to inherit.</p>
        <div className="make-visual-actions">
          <button className="make-button" type="submit" disabled={disabled || !dirty}>Review changes</button>
          {dirty ? <button className="make-button" type="button" disabled={disabled} onClick={() => { sequence.current++; setChanges({}); setReview(null); setError('') }}>Discard</button> : null}
        </div>
      </form>
      {review?.result.diff ? <section className="make-visual-review" role="region" aria-label="Proposed visual changes">
        <p>Proposed · Rev {review.result.diff.baseRevision} → {review.result.diff.targetRevision}</p>
        {review.result.diff.files.map(file => <div key={file.path}>
          <code>{file.path}</code>
          <pre aria-label={`Proposed diff for ${file.path}`}>{file.lines.map((line, index) => <span key={index} className={`make-diff-line make-diff-${line.type}`}>{line.type === 'add' ? '+' : line.type === 'delete' ? '−' : ' '}{line.text}{'\n'}</span>)}</pre>
        </div>)}
        {review.result.diff.truncated ? <p className="make-visual-help">Diff excerpt · the complete source change exceeds the preview limit.</p> : null}
        <button className="make-button make-primary" disabled={disabled} onClick={() => {
          setError('')
          void store.applyVisualProperties(target.elementId, review.changes, review.project.revision, review.project).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not apply visual changes'))
        }}>{disabled ? 'Validating…' : 'Apply visual changes'}</button>
      </section> : null}
    </>}
    {error ? <p className="make-asset-error" role="alert">{error}</p> : null}
  </section>
}
