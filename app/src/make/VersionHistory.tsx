import { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import type { AppCheckpointSource } from './types'
import type { MakeWorkspaceState, MakeWorkspaceStore } from './workspace-model'
import { formatUnifiedDiff } from './diff'

const labels: Record<AppCheckpointSource, string> = {
  initial: 'Initial app', chat: 'Chat edit', manual: 'Manual edit', inspector: 'Inspector edit',
  assets: 'Asset change', restore: 'Restore', legacy: 'Earlier checkpoint',
}

export function VersionHistory({ store, state, saved, disabled }: {
  store: MakeWorkspaceStore; state: MakeWorkspaceState; saved: boolean; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = state.activeProject
  useEffect(() => {
    if (open) void store.loadHistory()
  }, [store, open, active.id, active.revision, saved])
  const selected = state.selectedRevision
  return <section className="make-history" aria-label="Version history">
    <button className="make-history-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><History size={14} />Version history</span><span>{open ? '−' : '+'}</span>
    </button>
    {open ? <div className="make-history-body">
      <p className="make-history-note">Restore adds a revision. Every earlier checkpoint stays available.</p>
      {!saved ? <p className="make-history-note">Draft history lasts for this session. Save a copy to start durable history.</p> : null}
      <button className="make-button" disabled={disabled || state.historyStatus === 'loading'} onClick={() => { void store.loadHistory() }}>Refresh history</button>
      {state.historyStatus === 'loading' ? <p role="status">Loading checkpoints…</p> : null}
      {state.historyError ? <p className="make-notice" role="alert">{state.historyError}</p> : null}
      <ol className="make-history-list">
        {[...state.history].reverse().map(record => <li key={record.revision}>
          <button className="make-history-checkpoint" aria-label={`Inspect revision ${record.revision}`} aria-pressed={selected?.revision === record.revision} disabled={state.revisionStatus === 'loading' || disabled} onClick={() => { void store.inspectRevision(record.revision) }}>
            <span><strong>Rev {record.revision}</strong><span>{labels[record.checkpoint?.source ?? 'legacy']}</span>{record.revision === active.revision ? <small>Current</small> : null}</span>
            <time dateTime={record.timestamp}>{new Date(record.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
            <span className="make-history-count">{record.diff?.changedFilesCount ?? 0} files · +{record.diff?.totalAdditions ?? 0} / −{record.diff?.totalDeletions ?? 0}</span>
          </button>
        </li>)}
      </ol>
      {state.revisionStatus === 'loading' ? <p role="status">Reading checkpoint…</p> : null}
      {state.revisionError ? <p className="make-notice" role="alert">{state.revisionError}</p> : null}
      {selected ? <div className="make-history-detail" aria-label={`Revision ${selected.revision} details`}>
        <h3>Rev {selected.revision} <span>{labels[selected.checkpoint?.source ?? 'legacy']}</span></h3>
        <p className="make-history-note">From rev {selected.checkpoint?.baseRevision ?? selected.revision - 1}{selected.checkpoint?.restoredFromRevision ? ` · Restored rev ${selected.checkpoint.restoredFromRevision}` : ''} · {selected.project.assetIds.length} assets</p>
        {selected.checkpoint?.turnId ? <code className="make-history-note">Turn {selected.checkpoint.turnId}</code> : null}
        {selected.diff ? <details className="make-file-diff"><summary>Checkpoint diff</summary><pre aria-label="Checkpoint diff">{formatUnifiedDiff(selected.diff) || 'No source changes.'}</pre>{selected.diff.truncated ? <p className="make-history-note">Diff excerpt. Full source is available below.</p> : null}</details> : null}
        <details className="make-file-diff"><summary>Checkpoint source</summary>{Object.values(selected.project.files).map(file => <div key={file.path}><code>{file.path}</code><pre aria-label={`Revision ${selected.revision} source ${file.path}`}>{file.content}</pre></div>)}</details>
        <button className="make-button" disabled={disabled || selected.revision >= active.revision || state.annotationDirty} onClick={() => { void store.restoreRevision(selected.revision).catch(() => {}) }}><RotateCcw size={12} />Restore revision {selected.revision}</button>
        {state.annotationDirty ? <p className="make-history-note">Save annotations before restoring.</p> : null}
      </div> : null}
    </div> : null}
  </section>
}
