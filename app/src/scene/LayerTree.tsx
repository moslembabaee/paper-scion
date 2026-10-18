import { memo, useState } from 'react'
import { ChevronDown, ChevronRight, Circle, Combine, Diamond, Component as Diamonds, Eye, EyeOff, Frame, Image, Layers, LockKeyhole, PanelLeftClose, PenTool, Scan, ScanLine, Square, Type, UnlockKeyhole } from 'lucide-react'
import type { SceneStore } from './store'
import type { ElementType } from './types'
import { useScene } from './useScene'

const elementIcons = { frame: Frame, rectangle: Square, ellipse: Circle, path: PenTool, text: Type, image: Image } satisfies Record<ElementType, typeof Square>

const LayerRow = memo(function LayerRow({ store, id, depth }: { store: SceneStore; id: string; depth: number }) {
  const node = useScene(store, state => state.elements[id])
  const selected = useScene(store, state => state.selection.includes(id))
  const locked = useScene(store, () => store.isLocked(id))
  const visible = useScene(store, () => store.isVisible(id))
  const active = useScene(store, () => store.getHistorySnapshot().active)
  const [expanded, setExpanded] = useState(false)
  if (!node) return null
  const Icon = node.mask ? Scan : node.component?.kind === 'master' ? Diamonds : node.component?.kind === 'instance' && node.component.instanceId === id ? Diamond : node.type === 'path' && node.boolean ? Combine : elementIcons[node.type]
  const overridden = node.component?.kind === 'instance' && (Object.values(node.component.overrides).some(value => value && Object.keys(value).length) || (node.id === node.component.instanceId && Object.keys(node.component.propertyValues ?? {}).length > 0))
  const hasChildren = (node.type === 'frame' && node.children.length > 0) || (node.type === 'path' && !!node.boolean)
  return <div role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined}>
    <div className={`scene-layer-row ${selected ? 'selected' : ''} ${node.mask ? 'is-mask' : ''} ${!visible ? 'is-hidden' : ''} ${node.component ? 'is-component' : ''} ${node.component?.kind === 'master' ? 'is-master' : ''}`} data-layer-id={id} style={{ paddingLeft: 8 + depth * 12 }}>
      <button className="layer-disclosure quiet-button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`} disabled={!hasChildren} onClick={() => setExpanded(!expanded)}>{hasChildren ? expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : <span />}</button>
      <button className="layer-select" disabled={locked || !visible} onClick={(event) => { const ids = store.getSnapshot().selection; store.select(event.shiftKey ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id]) }} title={locked ? `${node.name} is locked` : node.name}>
        <Icon size={12} /><span>{node.name.replace(/^\d+ — /, '')}</span>{node.mask && <small className={`layer-mask-label ${node.mask.enabled ? '' : 'is-disabled'}`}>MASK</small>}{overridden && <i className="layer-instance-dot" title="Local property overrides" />}
      </button>
      {node.mask && <button className="layer-control layer-mask-control quiet-button" disabled={active || locked || node.component?.kind === 'instance'} aria-label={`${node.mask.enabled ? 'Disable' : 'Enable'} ${node.name} mask`} aria-pressed={node.mask.enabled} title="Toggle vector clipping" onClick={() => store.setMask(id, !node.mask!.enabled)}><Scan size={11} /></button>}
      {node.mask && <button className="layer-control layer-mask-control quiet-button" disabled={active || node.component?.kind === 'instance'} aria-label={`${node.mask.showOutline ? 'Hide' : 'Show'} ${node.name} mask outline`} aria-pressed={node.mask.showOutline} title="Toggle mask outline" onClick={() => store.setMaskOutline(id, !node.mask!.showOutline)}><ScanLine size={11} /></button>}
      <button className="layer-control quiet-button" aria-label={`${node.visible ? 'Hide' : 'Show'} ${node.name}`} aria-pressed={!node.visible} onClick={() => store.setVisible(id, !node.visible)}>{node.visible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
      <button className={`layer-control quiet-button ${node.locked ? 'is-locked' : ''}`} aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`} aria-pressed={node.locked} onClick={() => store.setLocked(id, !node.locked)}>{node.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}</button>
    </div>
    {expanded && node.type === 'frame' && <div role="group">{[...node.children].reverse().map(child => <LayerRow key={child} store={store} id={child} depth={depth + 1} />)}</div>}
    {expanded && node.type === 'path' && node.boolean && <div role="group">{[...node.boolean.operands].reverse().map(source => {
      const SourceIcon = source.type === 'path' && source.boolean ? Combine : elementIcons[source.type]
      return <div key={source.id} role="treeitem" className="scene-layer-row boolean-layer-source" style={{ paddingLeft: 32 + depth * 12 }}><button className="layer-select" disabled={locked || !visible} title={`Edit ${source.name} in the boolean source inspector`} onClick={() => store.select([id])}><SourceIcon size={12} /><span>{source.name}</span><small className="boolean-layer-label">SOURCE</small></button></div>
    })}</div>}
  </div>
})

export function LayerTree({ store, onHide, embedded = false }: { store: SceneStore; onHide: () => void; embedded?: boolean }) {
  const rootIds = useScene(store, state => state.rootIds)
  const count = useScene(store, state => Object.keys(state.elements).length)
  return <aside className={embedded ? 'layers-content' : 'layers-panel'} data-testid="layer-tree" aria-label="Document layers">
    {!embedded && <div className="panel-heading"><span>Layers</span><button className="quiet-button" aria-label="Hide layers" onClick={onHide}><PanelLeftClose size={14} /></button></div>}
    <div className="page-row"><Layers size={13} /><span>Explorations</span><span className="page-count">01</span></div>
    <div className="layer-section-heading">SCENE <span>{count} layers</span></div>
    <div className="scene-layer-tree" role="tree" aria-label="Scene hierarchy">{[...rootIds].reverse().map(id => <LayerRow key={id} store={store} id={id} depth={0} />)}</div>
    <div className="layers-bottom"><span className="workspace-label">YOUR WORKSPACE</span><p>Room for your next idea.</p><span>Infinite by design.</span></div>
  </aside>
}
