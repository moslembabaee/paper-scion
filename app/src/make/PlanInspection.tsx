import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, CheckCircle2, AlertTriangle, Sparkles, RefreshCw, X, ArrowRight, FileCode2, Zap, ShieldAlert } from 'lucide-react'
import type { AppPlan } from './types.ts'
import { isPlanStale } from './plan.ts'

export interface PlanInspectionProps {
  plan: AppPlan | null
  currentRevision: number
  planStatus: 'idle' | 'generating' | 'approving' | 'approved' | 'generating_app' | 'stale'
  planError: string
  onApprove: () => void
  onGenerate?: () => void
  onRevise: (newPrompt: string) => void
  onDismiss: () => void
  busy?: boolean
  applied?: boolean
}

export function PlanInspection({
  plan,
  currentRevision,
  planStatus,
  planError,
  onApprove,
  onGenerate,
  onRevise,
  onDismiss,
  busy = false,
  applied = false,
}: PlanInspectionProps) {
  const [revising, setRevising] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [revisionNotes, setRevisionNotes] = useState('')
  const card = useRef<HTMLElement>(null)
  const reviseButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { card.current?.focus() }, [plan?.planId])

  if (!plan) return null

  const stale = planStatus === 'stale' || (!applied && isPlanStale(plan, currentRevision))
  const approved = !stale && (plan.status === 'approved' || planStatus === 'approved')
  const compact = applied && !expanded

  function handleReviseSubmit(e: FormEvent) {
    e.preventDefault()
    if (!revisionNotes.trim() || busy) return
    onRevise(revisionNotes.trim())
    setRevisionNotes('')
    setRevising(false)
  }

  return (
    <section
      className={`make-plan-card${compact ? " make-plan-applied" : ""}`}
      data-testid="make-plan-card"
      aria-label="App plan"
      role="region"
      ref={card}
      tabIndex={-1}
      aria-busy={busy}
    >
      <header className="make-plan-header">
        <div className="make-plan-header-title">
          <span className="make-plan-badge">
            <Sparkles size={11} className="make-plan-sparkle" />
            <span>App Plan · Rev {plan.baseRevision}</span>
          </span>
          {approved ? (
            <span className="make-plan-status-pill approved" role="status">
              <CheckCircle2 size={12} />
              <span>Approved</span>
            </span>
          ) : stale ? (
            <span className="make-plan-status-pill stale" role="alert">
              <AlertTriangle size={12} />
              <span>Needs a new plan · Rev {currentRevision}</span>
            </span>
          ) : (
            <span className="make-plan-status-pill draft">
              <span>Ready for Review</span>
            </span>
          )}
        </div>
        <button
          className="make-plan-close-btn"
          aria-label="Dismiss plan"
          onClick={onDismiss}
          disabled={busy}
        >
          <X size={14} />
        </button>
      </header>

      <div className="make-plan-summary-block">
        <h3 className="make-plan-summary">{plan.summary}</h3>
        <p className="make-plan-prompt-quote" title={plan.prompt}>
          “{plan.prompt}”
        </p>
      </div>

      {planError ? (
        <div className="make-plan-alert" role="alert">
          <AlertTriangle size={14} />
          <span>{planError}</span>
        </div>
      ) : null}

      {stale && !planError ? (
        <div className="make-plan-alert stale" role="alert">
          <AlertTriangle size={14} />
          <span>This plan was generated for Rev {plan.baseRevision}, but the app is now at Rev {currentRevision}. Please revise or regenerate the plan.</span>
        </div>
      ) : null}

      <div className="make-plan-sections" hidden={compact}>
        {/* Files section */}
        <div className="make-plan-section" aria-label="Planned files">
          <div className="make-plan-section-header">
            <FileCode2 size={13} />
            <h4>Files ({plan.files.length})</h4>
          </div>
          <ul className="make-plan-file-list" aria-label="Planned files list">
            {plan.files.map((file, idx) => (
              <li key={idx} className="make-plan-file-item">
                <div className="make-plan-file-path-row">
                  <code>{file.path}</code>
                  {file.action ? (
                    <span className={`make-plan-action-tag ${file.action}`}>
                      {file.action}
                    </span>
                  ) : null}
                </div>
                <p className="make-plan-file-desc">{file.description}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Interactions section */}
        <div className="make-plan-section" aria-label="Planned interactions">
          <div className="make-plan-section-header">
            <Zap size={13} />
            <h4>Interactions ({plan.interactions.length})</h4>
          </div>
          <ul className="make-plan-bullet-list" aria-label="Planned interactions list">
            {plan.interactions.map((interaction, idx) => (
              <li key={idx} className="make-plan-bullet-item">
                <ArrowRight size={11} className="make-plan-bullet-arrow" />
                <span>{interaction}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Risks & Constraints section */}
          <div className="make-plan-section" aria-label="Planned risks and constraints">
            <div className="make-plan-section-header">
              <ShieldAlert size={13} />
              <h4>Risks & Constraints ({plan.risks.length})</h4>
            </div>
            <ul className="make-plan-bullet-list" aria-label="Planned risks list">
              {plan.risks.map((risk, idx) => (
                <li key={idx} className="make-plan-bullet-item risk">
                  <span className="make-plan-risk-dot" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
            {plan.risks.length === 0 ? <p className="make-plan-file-desc">No risks identified. Review the proposed behavior before approving.</p> : null}
          </div>
      </div>

      {applied ? <button type="button" className="make-button make-plan-inspect" onClick={() => setExpanded(value => !value)}>{compact ? 'Inspect approved plan' : 'Collapse approved plan'}</button> : null}
      {applied ? null : revising ? (
        <form className="make-plan-revise-form" onSubmit={handleReviseSubmit}>
          <label htmlFor="plan-revise-input" className="make-sr-only">
            Revise plan instructions
          </label>
          <input
            id="plan-revise-input"
            type="text"
            className="make-plan-revise-input"
            placeholder="Add changes or feedback (e.g. Also add an undo button)…"
            value={revisionNotes}
            onChange={e => setRevisionNotes(e.target.value)}
            disabled={busy}
            autoFocus
            maxLength={64 * 1024}
          />
          <div className="make-plan-revise-actions">
            <button
              type="button"
              className="make-button"
              onClick={() => {
                setRevising(false)
                setRevisionNotes('')
                requestAnimationFrame(() => reviseButton.current?.focus())
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="make-button make-primary"
              disabled={busy || !revisionNotes.trim()}
            >
              Update plan
            </button>
          </div>
        </form>
      ) : (
        <footer className="make-plan-footer">
          <button
            type="button"
            className="make-button"
            onClick={() => setRevising(true)}
            disabled={busy || approved}
            aria-label="Revise plan"
            ref={reviseButton}
          >
            <RefreshCw size={13} />
            <span>Revise plan</span>
          </button>

          <button
            type="button"
            className={`make-button ${approved ? '' : 'make-primary'}`}
            onClick={onApprove}
            disabled={busy || approved || stale}
            aria-label="Approve plan"
          >
            <Check size={13} />
            <span>{approved ? 'Approved' : 'Approve plan'}</span>
          </button>

          {approved && onGenerate ? (
            <button
              type="button"
              className="make-button make-primary make-generate-btn"
              onClick={onGenerate}
              disabled={busy || stale || isPlanStale(plan, currentRevision)}
              aria-label={planStatus === 'generating_app' ? 'Generating app in progress' : 'Generate app'}
            >
              {planStatus === 'generating_app' ? <span className="make-loader-inline" /> : <Sparkles size={13} />}
              <span>{planStatus === 'generating_app' ? 'Generating…' : 'Generate app'}</span>
            </button>
          ) : null}
        </footer>
      )}
      <p className="make-plan-note">{planStatus === 'generating_app' ? 'Generating your app into versioned files…' : approved ? applied ? `Approved plan applied to Rev ${currentRevision}.` : 'Plan approved. Ready to generate your app.' : 'Planning and approval keep your source files and revision unchanged.'}</p>
    </section>
  )
}
