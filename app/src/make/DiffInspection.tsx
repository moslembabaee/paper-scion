import type { BoundedDiff } from './diff'

export function DiffInspection({ diff, rollbackRevision, busy, onRollback }: {
  diff: BoundedDiff
  rollbackRevision?: number
  busy: boolean
  onRollback: () => void
}) {
  return <section className="make-changes" aria-label="Applied changes">
    <h2>Changes<span>REV {diff.baseRevision} → {diff.targetRevision}</span></h2>
    <p className="make-change-summary" role="status">Validated and applied · {diff.changedFilesCount} {diff.changedFilesCount === 1 ? 'file' : 'files'}</p>
    <p className="make-change-totals"><span>+{diff.totalAdditions} added</span><span>−{diff.totalDeletions} removed</span></p>
    {diff.files.map(file => <details key={file.path} className="make-file-diff">
      <summary><span>{file.path}</span><small>{file.action}</small></summary>
      <pre aria-label={`Diff for ${file.path}`}>{file.lines.map((line, i) => <span className={`make-diff-line make-diff-${line.type}`} key={i}>
        <span className="make-diff-number" aria-hidden="true">{line.oldLineNumber ?? '·'} {line.newLineNumber ?? '·'}</span>{line.type === 'add' ? '+' : line.type === 'delete' ? '−' : ' '}{line.text}{'\n'}
      </span>)}</pre>
      {file.truncated ? <p className="make-change-note">Diff excerpt · open Source files for complete content.</p> : null}
    </details>)}
    {rollbackRevision !== undefined ? <div className="make-rollback"><p>Rollback point · Rev {rollbackRevision}</p><button className="make-button" disabled={busy} onClick={onRollback}>Undo last edit</button></div> : null}
  </section>
}
