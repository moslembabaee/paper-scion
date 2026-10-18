import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Code2, Crosshair, Monitor, Play, Plus, RotateCcw, Save, Square, Sparkles } from 'lucide-react'
import type { AppSceneReference } from './types'
import { PreviewFrame, type PreviewFrameStatus } from './PreviewFrame'
import { createMakeWorkspaceStore, formatDiagnostic } from './workspace-model'
import { PlanInspection } from './PlanInspection'
import { DiffInspection } from './DiffInspection'
import { AssetPanel } from './AssetPanel'
import { AnnotationPanel } from './AnnotationPanel'
import { SourceEditor } from './SourceEditor'
import { VersionHistory } from './VersionHistory'
import { SourceExport } from './SourceExport'
import { GitHubHandoff } from './GitHubHandoff'
import { Publication } from './Publication'
import { Sharing, SharedProjectReview } from './Sharing'
import { SecretHandles } from './SecretHandles'
import { DataCapabilities } from './DataCapabilities'
import type { SharedAppSummary } from './sharing'
import { api } from '../cloud/api'
import { PREVIEW_VIEWPORTS, formatViewportDimensions, getViewportConfig, isValidDeviceViewport } from './breakpoints'
import './make.css'

const VisualInspector = lazy(() => import('./VisualInspector'))

export default function MakeWorkspace({ accountId, onDesign, designSelection }: { accountId?: string; onDesign: () => void; designSelection?: { reference: AppSceneReference; name: string } | null }) {
  const [store] = useState(() => createMakeWorkspaceStore({ accountId }))
  useEffect(() => { store.setDesignReference(designSelection?.reference ?? null) }, [store, designSelection])
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [frameStatus, setFrameStatus] = useState<PreviewFrameStatus>('idle')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [sharedProjects, setSharedProjects] = useState<SharedAppSummary[]>([])
  const [review, setReview] = useState<SharedAppSummary | null>(null)
  const [sharingError, setSharingError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setSharedProjects([]); setReview(null); setSharingError('')
    const load = () => {
      if (!accountId) return
      void api<{ apps: SharedAppSummary[] }>('/shared-apps', { signal: controller.signal, headers: { 'X-Paper-Account': accountId } })
        .then(value => { if (!controller.signal.aborted) { setSharedProjects(value.apps); setSharingError('') } })
        .catch(cause => { if (!controller.signal.aborted) setSharingError(cause instanceof Error ? cause.message : 'Could not load shared projects') })
    }
    load(); window.addEventListener('focus', load)
    return () => { controller.abort(); window.removeEventListener('focus', load) }
  }, [accountId])
  const promptInput = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    void store.loadProjects()
    void store.loadBudget()
    return () => store.suspend()
  }, [store])
  const busy = state.projectStatus !== 'idle'
  const planBusy = state.planStatus === 'generating' || state.planStatus === 'approving' || state.planStatus === 'generating_app'
  const running = state.previewStatus === 'ready' && frameStatus === 'ready'
  const loading = state.previewStatus === 'loading' || (state.assets !== null && !running)
  const status = state.previewStatus === 'error' ? 'Error' : running ? 'Running' : loading ? 'Loading' : 'Stopped'
  const active = state.activeProject
  const viewport = getViewportConfig(state.deviceViewport)
  const savedIds = new Set(state.savedProjects.map(project => project.id))

  function choose(id: string) {
    const shared = sharedProjects.find(project => `shared:${project.ownerId}:${project.id}` === id)
    if (shared) { setReview(shared); return }
    setOpeningId(id)
    if (savedIds.has(id)) void store.openSavedProject(id)
    else store.selectProjectById(id)
  }

  if (review) return <SharedProjectReview key={`${accountId}:${review.ownerId}:${review.id}`} item={review} accountId={accountId} onClose={() => setReview(null)} />

  return <div className="make-workspace" data-testid="make-workspace">
    <header className="make-header">
      <button className="make-button make-back" aria-label="Design workspace" onClick={onDesign}><ArrowLeft size={14} /><span>Design</span></button>
      <div className="make-brand"><Sparkles size={17} /><span>paper <strong>make</strong></span><span className="make-alpha">alpha</span></div>
      <label className="make-chooser"><span className="make-sr-only">Make project</span>
        <select value={active.id} onChange={event => choose(event.target.value)} disabled={state.projectStatus === 'saving'}>
          <optgroup label="Saved apps">{state.savedProjects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</optgroup>
          {sharedProjects.length ? <optgroup label="Shared with you">{sharedProjects.map(project => <option value={`shared:${project.ownerId}:${project.id}`} key={`${project.ownerId}:${project.id}`}>{project.name} · {project.role} · r{project.revision}</option>)}</optgroup> : null}
          <optgroup label="Examples & drafts">{state.projects.filter(project => !savedIds.has(project.id)).map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</optgroup>
        </select>
      </label>
      <div className="make-header-actions">
        {state.budget ? (
          <div
            className="make-budget-badge"
            data-testid="make-budget-badge"
            title={`Turns: ${state.budget.remainingTurns}/${state.budget.limitTurns} remaining`}
          >
            <Sparkles size={11} className="make-budget-icon" />
            <span>{state.budget.remainingTurns} turns</span>
          </div>
        ) : null}
        <button className="make-button" disabled={busy} onClick={() => store.createNewProject()}><Plus size={14} /><span>New app</span></button>
        <button className="make-button" disabled={busy} onClick={() => { setOpeningId(null); void store.saveCopy() }}><Save size={14} /><span>{state.projectStatus === 'saving' ? 'Saving…' : 'Save a copy'}</span></button>
      </div>
    </header>
    <div className="make-layout">
      <aside className="make-sidebar" aria-label="App project details">
        <div className="make-project-meta"><span className="make-eyebrow">APP PROJECT / REV {active.revision}</span><h1>{active.name}</h1><p>{active.description ?? 'An interactive React app. Run the preview to bring it to life.'}</p>
          <span className="make-storage-note">{savedIds.has(active.id) ? 'Saved to your account' : 'Example or unsaved draft'}</span>
        </div>
        {state.listStatus === 'loading' ? <p className="make-notice" role="status">Loading saved apps…</p> : null}
        {state.listError ? <div className="make-notice" role="alert"><p>Could not load saved apps: {state.listError}</p><button className="make-button" onClick={() => { void store.loadProjects() }}>Retry project list</button></div> : null}
        {sharingError ? <p className="make-notice" role="alert">Could not load shared apps: {sharingError}</p> : null}
        {state.projectError ? <div className="make-notice" role="alert"><p>{state.projectError}</p><button className="make-button" onClick={() => state.annotationDirty && savedIds.has(active.id) ? void store.saveAnnotations() : state.projectError && openingId ? choose(openingId) : void store.saveCopy()}>Retry project request</button></div> : null}
        {state.selectedElement ? <Suspense fallback={<p className="make-notice" role="status">Loading visual properties…</p>}>
          <VisualInspector key={`${active.id}:${active.revision}:${active.updatedAt}:${state.selectedElement.elementId}`} store={store} state={state} disabled={busy || planBusy} />
        </Suspense> : null}
        <AnnotationPanel store={store} state={state} saved={savedIds.has(active.id)} disabled={busy || planBusy} />
        {state.currentDiff ? <DiffInspection diff={state.currentDiff} rollbackRevision={state.rollbackPoint?.revision} busy={busy || planBusy} onRollback={() => { void store.rollback().catch(() => {}) }} /> : null}
        <AssetPanel project={active} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy} onChange={store.acceptAssetProject} />
        <SourceEditor store={store} state={state} disabled={busy} planBusy={planBusy} />
        <SourceExport key={`${accountId}:${active.id}:${active.revision}`} project={active} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy || state.annotationDirty} />
        <GitHubHandoff key={`github:${accountId}:${active.id}:${active.revision}`} project={active} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy || state.annotationDirty} />
        <Publication key={`publication:${accountId}:${active.id}:${active.revision}`} project={active} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy || state.annotationDirty} />
        <Sharing key={`sharing:${accountId}:${active.id}:${active.revision}`} project={active} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy || state.annotationDirty} />
        <SecretHandles key={`secrets:${accountId}:${active.id}:${savedIds.has(active.id)}`} appId={active.id} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy} />
        <DataCapabilities key={`data:${accountId}:${active.id}:${savedIds.has(active.id)}`} appId={active.id} accountId={accountId} saved={savedIds.has(active.id)} disabled={busy || planBusy} />
        <VersionHistory store={store} state={state} saved={savedIds.has(active.id)} disabled={busy || planBusy} />
        <section className="make-diagnostics" data-testid="make-diagnostics" aria-label="Compiler diagnostics">
          <h2>Diagnostics<span>{state.diagnostics.length.toString().padStart(2, '0')}</span></h2>
          {state.diagnostics.length ? state.diagnostics.map((diagnostic, index) => {
            const item = formatDiagnostic(diagnostic)
            const source = active.files[item.file]?.content.split('\n')
            return <article className="make-diagnostic" key={index}><strong>{item.title}</strong><code>{item.location}</code><p>{item.message}</p><p className="make-diagnostic-hint">{item.actionableHint}</p>
              {source ? <pre aria-label={`Source near line ${item.line}`}>{source.slice(Math.max(0, item.line - 2), item.line + 1).map((line, offset) => `${Math.max(1, item.line - 1) + offset}  ${line}`).join('\n')}</pre> : null}
            </article>
          }) : <p className="make-diagnostics-empty">{running ? 'Compiled successfully. Review interactions in the preview.' : 'Compiler details appear here after a run.'}</p>}
        </section>
        {state.validation || state.planStatus === 'generating_app' ? <section className="make-validation" aria-label="Agent validation" data-testid="make-validation" aria-live="polite" data-status={state.validation?.status ?? 'checking'}>
          <h2>Agent validation <span>{state.validation ? `${state.validation.attempts.length} / ${state.validation.maxAttempts}` : 'Checking…'}</span></h2>
          <p>{state.validation?.message ?? 'Building and checking desktop + mobile. At most one repair attempt.'}</p>
          {state.validation?.attempts.map(attempt => <details key={attempt.attempt}>
            <summary>Candidate {attempt.attempt} · {attempt.status}</summary>
            {attempt.viewports.map(view => <p key={view.viewport}>{view.viewport} · {view.width} × {view.height} · Capture checked</p>)}
            {attempt.diagnostics.map((diagnostic, index) => <p key={index}>{diagnostic.message}</p>)}
          </details>)}
          <small>Only this app is captured. Repair images are sent to your configured model provider; image bytes stay out of history and logs.</small>
        </section> : null}
      </aside>
      <main className="make-stage" aria-label="Make preview">
        <div className="make-preview-toolbar"><div className="make-preview-label"><span className="make-status-dot" data-status={status} /><span>Preview</span><span className="make-preview-status" data-testid="make-preview-status" role="status">{status}</span></div>
          <div className="make-preview-actions">
          <button className={`make-button ${state.inspectMode ? 'make-inspecting' : ''}`} aria-pressed={state.inspectMode} disabled={!running || busy || planBusy} onClick={() => store.setInspectMode(!state.inspectMode)}><Crosshair size={13} />Select element</button>
          <button className="make-button" disabled={!running || busy || planBusy} onClick={store.rerunInteraction} title="Resets the preview app state at the selected size. Source and saved layout stay unchanged."><RotateCcw size={13} />Rerun interactions</button>
          {state.assets || state.previewStatus === 'loading' ? <button className="make-button" onClick={store.stopPreview}><Square size={12} fill="currentColor" />Stop preview</button> : state.previewStatus !== 'error' ? <button className="make-button make-primary" disabled={busy} onClick={() => { void store.runPreview() }}><Play size={13} fill="currentColor" />Run preview</button> : null}
          </div>
        </div>
        <div className="make-viewport-toolbar">
          <label className="make-viewport-picker"><Monitor size={13} aria-hidden="true" /><span className="make-sr-only">Preview size</span>
            <select value={state.deviceViewport} onChange={event => { if (isValidDeviceViewport(event.target.value)) store.setDeviceViewport(event.target.value) }}>
              {Object.values(PREVIEW_VIEWPORTS).map(size => <option key={size.id} value={size.id}>{size.label}</option>)}
            </select>
          </label>
          <output className="make-viewport-dimensions" data-testid="make-viewport-dimensions" aria-live="polite">{formatViewportDimensions(state.deviceViewport)}</output>
          <span className="make-viewport-note">Resize keeps state · Rerun resets preview state.</span>
        </div>
        <div className="make-prompt-bar" role="region" aria-label="Prompt planner">
          <form
            className="make-prompt-form"
            onSubmit={e => {
              e.preventDefault()
              void store.generatePlan()
            }}
            aria-label="App plan prompt"
            aria-busy={planBusy}
          >
            <Sparkles size={14} className="make-prompt-icon" />
            <textarea
              rows={2}
              ref={promptInput}
              className="make-prompt-input"
              data-testid="make-prompt-input"
              placeholder="Prompt an app or feature to inspect the plan (files, interactions, risks)…"
              value={state.planPrompt}
              onChange={e => store.setPlanPrompt(e.target.value)}
              aria-label="Prompt for app planning"
              aria-describedby="make-planning-status"
              maxLength={64 * 1024}
              disabled={planBusy || busy}
            />
            <button
              type="submit"
              className="make-button make-primary make-plan-submit"
              data-testid="make-plan-submit"
              disabled={!state.planPrompt.trim() || planBusy || busy}
              aria-label={state.planStatus === 'generating' ? 'Planning in progress' : 'Generate plan'}
            >
              {state.planStatus === 'generating' ? <span className="make-loader-inline" /> : <Sparkles size={13} />}
              <span>{state.planStatus === 'generating' ? 'Planning…' : 'Plan'}</span>
            </button>
            {state.planStatus === 'generating_app' ? <button type="button" className="make-button" onClick={store.cancelAppGeneration}>Cancel generation</button> : null}
            {state.planStatus === 'generating' ? <button type="button" className="make-button" onClick={() => { store.cancelPlanning(); requestAnimationFrame(() => promptInput.current?.focus()) }}>Cancel planning</button> : null}
          </form>
          <div className="make-design-context">
            {designSelection ? <label><input type="checkbox" aria-label="Use selected frame" checked={state.designReference !== null} disabled={planBusy || busy}
              onChange={event => store.setDesignReference(event.target.checked ? designSelection.reference : null)} /><span>Use selected frame · <strong>{designSelection.name}</strong></span></label>
              : <span>Select one frame in a synced Design workspace to attach its layout, tokens and assets.</span>}
            {state.currentPlan?.designContext ? <span className="make-context-detail">Snapshot · {state.currentPlan.designContext.elements.length} layers · {state.currentPlan.designContext.tokens.length} tokens · {state.currentPlan.designContext.assets.length} assets{state.currentPlan.designContext.truncated ? ' · Partial snapshot' : ''}</span> : null}
          </div>
          <p id="make-planning-status" className="make-planning-status" role="status">{state.planStatus === 'generating' ? 'Planning your app…' : state.planStatus === 'approving' ? 'Approving plan…' : state.planStatus === 'generating_app' ? 'Generating your app…' : 'Plan only · Review before making changes.'}</p>
          {state.planError && !state.currentPlan ? <p className="make-plan-alert" role="alert">{state.planError}</p> : null}
        </div>
        {state.errorMessage && state.assets ? <p className="make-generation-error" role="alert">{state.errorMessage} Showing your last usable preview.</p> : null}
        <div className="make-preview-canvas" aria-busy={loading || state.projectStatus === 'loading'}>
          {state.currentPlan ? (
            <PlanInspection
              key={state.currentPlan.planId}
              plan={state.currentPlan}
              currentRevision={active.revision}
              planStatus={state.planStatus}
              applied={state.planStatus === 'approved' && state.currentPlan.baseRevision + 1 === active.revision}
              planError={state.planError}
              onApprove={() => { void store.approveCurrentPlan().catch(() => {}) }}
              onGenerate={() => { void store.generateFromApprovedPlan().catch(() => {}) }}
              onRevise={newPrompt => {
                void store.reviseCurrentPlan(newPrompt)
              }}
              onDismiss={() => { store.clearPlan(); promptInput.current?.focus() }}
              busy={planBusy || busy}
            />
          ) : null}
          {state.assets ? <div className="make-preview-viewport" role="region" aria-label="Preview viewport" tabIndex={0}>
            <div className="make-preview-device" data-viewport={state.deviceViewport} style={{ width: viewport.width, height: viewport.height }}>
              <PreviewFrame assets={state.assets} sessionKey={state.previewSessionKey} capabilityScope={accountId && savedIds.has(active.id) ? { appId: active.id, accountId } : undefined} inspectMode={state.inspectMode && !busy && !planBusy} selectedElementId={state.selectedElement?.elementId} onElementSelect={store.selectElement} onStatusChange={setFrameStatus} onError={store.reportRuntimeError} />
            </div>
          </div> : null}
          {state.projectStatus === 'loading' || loading ? <div className="make-empty make-loading" role="status"><span className="make-loader" /><h2>{state.projectStatus === 'loading' ? 'Opening app…' : state.assets ? 'Starting preview…' : 'Compiling your app…'}</h2><p>{state.projectStatus === 'loading' ? 'Reading the saved revision.' : 'Preparing an interactive preview.'}</p></div> : null}
          {!state.assets && !loading && state.projectStatus !== 'loading' ? <div className="make-empty">
            {state.previewStatus === 'error' ? <><span className="make-empty-icon"><Code2 size={24} /></span><h2>Let’s get this running.</h2><p role="alert">{state.errorMessage}</p>{state.diagnostics.length ? <p>Check the file locations and fix guidance in Diagnostics.</p> : <p>Check your app source or connection, then try again.</p>}<button className="make-button make-primary" disabled={busy} onClick={() => { void store.retryPreview() }}><RotateCcw size={14} />Retry preview</button></> : <><span className="make-empty-icon"><Sparkles size={24} /></span><span className="make-eyebrow">FROM SOURCE TO SOMETHING REAL</span><h2>A space to make it work.</h2><p>Choose a saved app or try an example.<br />Your interactive preview starts here.</p><button className="make-button make-primary" disabled={busy} onClick={() => { void store.runPreview() }}><Play size={13} fill="currentColor" />Start preview</button></>}
          </div> : null}
        </div>
        <footer className="make-footer"><span>React / {active.preview.entryPoint}</span><span>120 px grid · Paper Make</span></footer>
      </main>
    </div>
  </div>
}
