import { useState } from 'react'
import { Component as Diamonds, Layers, PanelLeftClose, Palette } from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController'
import { ComponentLibrary } from '../scene/ComponentPanel'
import { LayerTree } from '../scene/LayerTree'
import type { SceneStore } from '../scene/store'
import { ThemePanel } from './ThemePanel'

export function DocumentSidebar({ store, controller, onHide }: { store: SceneStore; controller: ViewportController; onHide: () => void }) {
  const [tab, setTab] = useState<'layers' | 'components' | 'theme'>('layers')
  const tabs = ['layers', 'components', 'theme'] as const
  const navigate = (event: React.KeyboardEvent, current: typeof tab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'layers' : event.key === 'End' ? 'theme' : tabs[(tabs.indexOf(current) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]
    setTab(next)
    document.getElementById(`${next}-tab`)?.focus()
  }
  return <aside className="layers-panel document-sidebar" aria-label="Document sidebar">
    <div className="sidebar-heading"><div role="tablist" aria-label="Document panels">
      <button role="tab" id="layers-tab" aria-controls="layers-pane" aria-selected={tab === 'layers'} tabIndex={tab === 'layers' ? 0 : -1} onClick={() => setTab('layers')} onKeyDown={event => navigate(event, 'layers')}><Layers size={12} />Layers</button>
      <button role="tab" id="components-tab" aria-controls="components-pane" aria-selected={tab === 'components'} tabIndex={tab === 'components' ? 0 : -1} onClick={() => setTab('components')} onKeyDown={event => navigate(event, 'components')}><Diamonds size={12} />Components</button>
      <button role="tab" aria-label="Theme / Tokens" title="Theme / Tokens" id="theme-tab" aria-controls="theme-pane" aria-selected={tab === 'theme'} tabIndex={tab === 'theme' ? 0 : -1} onClick={() => setTab('theme')} onKeyDown={event => navigate(event, 'theme')}><Palette size={12} />Theme</button>
    </div><button className="quiet-button" aria-label="Hide layers" title="Hide sidebar" onClick={onHide}><PanelLeftClose size={14} /></button></div>
    <div className="sidebar-pane" id="layers-pane" role="tabpanel" aria-labelledby="layers-tab" hidden={tab !== 'layers'}>{tab === 'layers' && <LayerTree store={store} onHide={onHide} embedded />}</div>
    <div className="sidebar-pane" id="components-pane" role="tabpanel" aria-labelledby="components-tab" hidden={tab !== 'components'}>{tab === 'components' && <ComponentLibrary store={store} controller={controller} />}</div>
    <div className="sidebar-pane" id="theme-pane" role="tabpanel" aria-labelledby="theme-tab" hidden={tab !== 'theme'} data-token-ui>{tab === 'theme' && <ThemePanel store={store} />}</div>
  </aside>
}
