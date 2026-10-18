import { useRef, useState, type KeyboardEvent } from 'react'
import { AlignLeft, Code2, FileCode2, Save, RotateCcw } from 'lucide-react'
import { formatDiagnostic, type MakeWorkspaceState, type MakeWorkspaceStore } from './workspace-model'

interface SourceEditorProps {
  store: MakeWorkspaceStore
  state: MakeWorkspaceState
  disabled: boolean
  planBusy: boolean
}
interface SourceDraft {
  content: string
  baseContent: string
  baseRevision: number
}

export function SourceEditor({ store, state, disabled, planBusy }: SourceEditorProps) {
  const project = state.activeProject
  const files = project.files
  const activePath = state.activeFilePath
  // Buffers never enter the project until compilation and revision validation pass.
  const [drafts, setDrafts] = useState<Record<string, SourceDraft>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [operation, setOperation] = useState<'save' | 'format' | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const key = `${project.id}:${activePath}`
  const draft = drafts[key]
  const content = draft?.content ?? files[activePath]?.content ?? ''
  const dirty = !!draft && content !== files[activePath]?.content
  const stale = !!draft && draft.baseRevision !== project.revision
  const error = errors[key] ?? ''
  const busy = disabled || planBusy || operation !== null
  const filePaths = Object.keys(files).sort()
  const diagnostics = state.diagnostics.filter(d => d.file === activePath)
  const saved = state.savedProjects.some(item => item.id === project.id)

  function edit(value: string) {
    setDrafts(previous => {
      const next = { ...previous }
      const baseRevision = previous[key]?.baseRevision ?? project.revision
      if (value === files[activePath]?.content && baseRevision === project.revision) delete next[key]
      else next[key] = { content: value, baseContent: previous[key]?.baseContent ?? files[activePath]?.content ?? '', baseRevision }
      return next
    })
    setErrors(previous => ({ ...previous, [key]: '' }))
  }

  async function save() {
    if (!draft || !dirty || busy || stale) return
    setOperation('save')
    setErrors(previous => ({ ...previous, [key]: '' }))
    try {
      await store.saveSourceFile(activePath, draft.content, draft.baseRevision)
      const committed = store.getState().activeProject
      setDrafts(previous => {
        const next = { ...previous }
        delete next[key]
        // Only our own successful commit can advance untouched sibling buffers.
        for (const path of Object.keys(files)) {
          const siblingKey = `${project.id}:${path}`
          const sibling = next[siblingKey]
          if (sibling && sibling.baseRevision === project.revision &&
            sibling.baseContent === files[path].content && committed.files[path]?.content === files[path].content) {
            next[siblingKey] = { ...sibling, baseRevision: committed.revision }
          }
        }
        return next
      })
      textAreaRef.current?.focus()
    } catch (cause) {
      setErrors(previous => ({ ...previous, [key]: cause instanceof Error ? cause.message : 'Could not save source file' }))
    } finally {
      setOperation(null)
    }
  }

  async function format() {
    if (busy) return
    // Capture a draft before awaiting so concurrent model changes cannot rebase it.
    const base = draft ?? { content, baseContent: content, baseRevision: project.revision }
    setOperation('format')
    setErrors(previous => ({ ...previous, [key]: '' }))
    try {
      const formatted = await store.formatSourceFile(activePath, content)
      setDrafts(previous => {
        const next = { ...previous }
        if (formatted === base.baseContent && !draft) delete next[key]
        else next[key] = { ...base, content: formatted }
        return next
      })
    } catch (cause) {
      setErrors(previous => ({ ...previous, [key]: cause instanceof Error ? cause.message : 'Could not format source file' }))
    } finally {
      setOperation(null)
    }
  }

  function discard() {
    setDrafts(previous => { const next = { ...previous }; delete next[key]; return next })
    setErrors(previous => ({ ...previous, [key]: '' }))
    textAreaRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      const { selectionStart: start, selectionEnd: end } = event.currentTarget
      edit(content.slice(0, start) + '  ' + content.slice(end))
      requestAnimationFrame(() => textAreaRef.current?.setSelectionRange(start + 2, start + 2))
    }
  }

  function goToLine(line: number, column: number) {
    const lines = content.split('\n')
    const offset = lines.slice(0, Math.max(0, line - 1)).reduce((sum, value) => sum + value.length + 1, 0) + Math.max(0, column - 1)
    textAreaRef.current?.focus()
    textAreaRef.current?.setSelectionRange(offset, offset)
  }

  return <section className="make-source-editor" aria-label="Source files">
    <h2><FileCode2 size={14} />Source files<span>{filePaths.length}</span></h2>
    <nav className="make-source-tree" aria-label="Source file tree">
      {filePaths.map(path => {
        const fileDraft = drafts[`${project.id}:${path}`]
        const hasErrors = state.diagnostics.some(d => d.file === path && d.severity === 'error')
        return <button key={path} type="button" aria-label={path} aria-current={path === activePath ? 'true' : undefined}
          className={`make-source-tab${path === activePath ? ' active' : ''}${hasErrors ? ' has-errors' : ''}`}
          disabled={busy} onClick={() => store.setActiveFile(path)} title={path}
          style={{ paddingLeft: 10 + (path.split('/').length - 1) * 10 }}>
          <Code2 size={12} aria-hidden="true" /><span>{path}</span>
          {fileDraft && fileDraft.content !== files[path].content ? <small aria-label="Unsaved changes">●</small> : null}
          {path === project.preview.entryPoint ? <small className="make-source-entry-badge">entry</small> : null}
          {hasErrors ? <span className="make-source-error-dot" aria-label="Compiler errors" /> : null}
        </button>
      })}
    </nav>
    <div className="make-source-header">
      <span className="make-source-path">{activePath}</span>
      <span className="make-source-meta">{dirty ? 'Unsaved · ' : ''}{content.split('\n').length} lines</span>
    </div>
    <textarea ref={textAreaRef} className="make-source-textarea" value={content}
      onChange={event => edit(event.target.value)} onKeyDown={onKeyDown}
      spellCheck={false} autoComplete="off" autoCapitalize="off" wrap="off" disabled={busy || !files[activePath]}
      aria-label={`Editing ${activePath}`} aria-describedby="make-source-shortcut" />
    <div className="make-source-toolbar">
      <div className="make-source-toolbar-actions">
        <button className="make-button make-primary" disabled={!dirty || busy || stale} onClick={() => void save()} aria-label="Save source">
          <Save size={12} /><span>{operation === 'save' ? 'Saving…' : 'Save & rebuild'}</span>
        </button>
        <button className="make-button" disabled={busy || !files[activePath]} onClick={() => void format()} aria-label="Format source">
          <AlignLeft size={12} /><span>{operation === 'format' ? 'Formatting…' : 'Format'}</span>
        </button>
        <button className="make-button" disabled={!draft || busy} onClick={discard} aria-label="Discard changes"><RotateCcw size={12} />Discard</button>
      </div>
      <span id="make-source-shortcut" className="make-source-shortcut">⌘ / Ctrl+S to save · Tab to indent</span>
    </div>
    {diagnostics.length ? <div className="make-source-diagnostics" aria-label="File diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const item = formatDiagnostic(diagnostic)
        return <div className="make-source-diagnostic" key={index}>
          <button className="make-source-diag-location" onClick={() => goToLine(item.line, item.column)}>{item.location}</button>
          <span className="make-source-diag-code">{item.code}</span><span className="make-source-diag-msg">{item.message}</span>
          <span className="make-source-diag-msg">{item.actionableHint}</span>
        </div>
      })}
    </div> : null}
    {stale || error ? <div className="make-source-error" role="alert">
      <p>{stale ? `Revision conflict: this draft started at revision ${draft.baseRevision}; the project is now revision ${project.revision}. Your draft is preserved. Review the latest source before discarding or merging your changes.` : error}</p>
      {saved && (stale || /conflict|revision/i.test(error)) ? <button className="make-button" disabled={busy} onClick={() => void store.openSavedProject(project.id)} aria-label="Reload latest source">Reload latest source</button> : null}
      {stale ? <>
        <details className="make-source-latest"><summary>Compare latest source · REV {project.revision}</summary><pre>{files[activePath]?.content ?? 'This file was removed in the latest revision.'}</pre></details>
        <p>Merge the latest source into your draft above, then mark it resolved.</p>
        <button className="make-button" disabled={busy || !files[activePath]} onClick={() => {
          setDrafts(previous => ({ ...previous, [key]: { ...draft, baseContent: files[activePath].content, baseRevision: project.revision } }))
          setErrors(previous => ({ ...previous, [key]: '' }))
        }}>Mark conflict resolved</button>
      </> : null}
    </div> : null}
  </section>
}
