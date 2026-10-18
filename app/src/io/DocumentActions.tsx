import { lazy, Suspense, useRef, useState } from 'react'
import { Code2, Download, FolderOpen, Save } from 'lucide-react'
import type { SceneStore } from '../scene/store'
import './io.css'

const ExportPanel = lazy(async () => ({ default: (await import('./ExportPanel')).ExportPanel }))
const CodeExportModal = lazy(async () => ({ default: (await import('./codeExport/CodeExportModal')).CodeExportModal }))

interface Props {
  store: SceneStore
  name: string
  importing: boolean
  onSave: () => void
  onImport: (file: File) => Promise<void>
  onMessage: (message: string) => void
}
export function DocumentActions({ store, name, importing, onSave, onImport, onMessage }: Props) {
  const [open, setOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  return <div className="document-actions">
    <input ref={fileRef} type="file" accept=".json,.svg,.html,.htm,application/json,image/svg+xml,text/html" hidden aria-label="Open or import file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onImport(file) }} />
    <button className="document-action icon-action" aria-label="Open or import file" title="Open Paper JSON / import SVG or HTML. You can also paste SVG from Figma with Copy as SVG." disabled={importing} onClick={() => fileRef.current?.click()}><FolderOpen size={14} /></button>
    <button className="document-action icon-action" aria-label="Save project JSON" title="Save project JSON · ⌘/Ctrl S" onClick={onSave}><Save size={14} /></button>
    <button className="document-action code-export-trigger" aria-label="Production Code Exporter" aria-haspopup="dialog" aria-expanded={codeOpen} onClick={() => setCodeOpen(true)} title="Export production React JSX, standalone SVGs, or raw GLSL shaders"><Code2 size={14} /><span>Code</span></button>
    <button className="document-action export-trigger" aria-label="Export" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Download size={14} /><span>Export</span></button>
    {open && <Suspense fallback={null}><ExportPanel store={store} name={name} onSave={onSave} onMessage={onMessage} onClose={() => setOpen(false)} /></Suspense>}
    {codeOpen && <Suspense fallback={null}><CodeExportModal store={store} name={name} onMessage={onMessage} onClose={() => setCodeOpen(false)} /></Suspense>}
  </div>
}
