import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, CloudCheck, File, Pencil, Plus, Search, X } from 'lucide-react'
import { Dialog } from './Dialog'
import type { ProjectSummary } from './types'

interface Props {
  name: string
  activeId: string
  projects: ProjectSummary[]
  workspaceName: string
  persistent: boolean
  disabled: boolean
  open: boolean
  onToggle: (open: boolean) => void
  onNameChange: (name: string) => void
  onSwitch: (id: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  sync?: ReactNode
}

export function ProjectSwitcher(props: Props) {
  const { name, onNameChange, open, onToggle, sync } = props
  return <div className="document-name">
    <span className="document-divider" />
    <input className="document-title" aria-label="Project name" value={name} maxLength={200} disabled={props.disabled} onChange={event => onNameChange(event.target.value)} onBlur={() => onNameChange(name.trim() || 'Untitled')} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    <button className="project-switch-trigger" aria-label="Switch project" aria-haspopup="dialog" aria-expanded={open} disabled={props.disabled} title="Your projects" onClick={() => onToggle(true)}><ChevronDown size={13} /></button>
    {sync}
    {open && <ProjectsDialog {...props} />}
  </div>
}

function ProjectsDialog({ activeId, projects, workspaceName, persistent, disabled, onToggle, onSwitch, onCreate, onRename }: Props) {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ id: string | null; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filtered = projects.filter(project => project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  async function run(action: () => Promise<void>, close: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action(); if (close) onToggle(false); else setForm(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this project.') }
    finally { setBusy(false) }
  }

  return <Dialog className="projects-dialog workspace-surface" labelledBy="projects-title" onClose={() => onToggle(false)} busy={busy}>
    <div className="workspace-dialog-heading"><div><span className="workspace-eyebrow">A PLACE FOR EVERY IDEA</span><h2 id="projects-title">Your projects</h2><p>{workspaceName}</p></div><button className="quiet-button" aria-label="Close projects" disabled={busy} onClick={() => onToggle(false)}><X size={17} /></button></div>
    <label className="project-search"><Search size={14} /><input aria-label="Search projects" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>{projects.length}</kbd></label>
    <div className="project-list" aria-label="Saved projects" aria-busy={busy}>
      {filtered.map(project => <div key={project.id} className={`project-item ${project.id === activeId ? 'current' : ''}`}>
        <button className="project-open" disabled={busy || disabled || !persistent} aria-current={project.id === activeId ? 'true' : undefined} onClick={() => { if (project.id === activeId) onToggle(false); else void run(() => onSwitch(project.id), true) }}><span className="project-file-icon"><File size={18} /></span><span><strong>{project.name}</strong><small>{project.id === activeId ? 'Currently open' : `Edited ${new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</small></span>{project.id === activeId && <Check size={14} />}</button>
        <button className="quiet-button project-rename" aria-label={`Rename ${project.name}`} title="Rename project" disabled={busy || disabled || !persistent} onClick={() => { setForm({ id: project.id, name: project.name }); setError('') }}><Pencil size={13} /></button>
      </div>)}
      {!filtered.length && <p className="project-empty">No projects match “{query}”.<span>Make room for a new idea.</span></p>}
    </div>
    {form ? <form className="project-name-form" onSubmit={event => {
      event.preventDefault()
      const next = form.name.trim()
      if (!next) { setError('Give your project a name.'); return }
      void run(() => form.id ? onRename(form.id, next) : onCreate(next), !form.id)
    }}><label className="workspace-field">{form.id ? 'Rename project' : 'New project name'}<input aria-label={form.id ? 'Rename project' : 'New project name'} autoFocus required maxLength={200} value={form.name} disabled={busy || disabled} placeholder="Untitled exploration" onChange={event => setForm({ ...form, name: event.target.value })} /></label><div><button type="button" className="workspace-secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="workspace-primary" disabled={busy || disabled}>{busy ? 'Saving…' : form.id ? 'Save name' : 'Create project'}</button></div></form> : <button className="project-create" disabled={busy || disabled || !persistent} onClick={() => { setForm({ id: null, name: '' }); setError('') }}><Plus size={15} />New project<span>Start with a blank canvas</span></button>}
    {error && <p className="workspace-error project-error" role="alert">{error}</p>}
    <div className="projects-sync-note"><CloudCheck size={12} /><span>{persistent ? 'Projects save automatically to your account' : 'Storage unavailable · Export JSON to keep your work'}</span></div>
  </Dialog>
}
