import { ComponentPropertiesPanel } from './ComponentPropertiesPanel'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeftRight, ArrowUpRight, Copy, Diamond, Component as Diamonds, Plus, RefreshCw, RotateCcw, Search, Sparkles, Unlink, Upload, Layers } from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController'
import type { ComponentOverrides, SceneElement } from './types'
import type { SceneStore } from './store'
import { componentRoot, subtree } from './components'
import { getWorldBounds } from './geometry'
import { useScene } from './useScene'
import './components.css'

function overrideCount(overrides: ComponentOverrides): number {
  const stroke = overrides.style?.stroke
  return Object.keys(overrides.properties ?? {}).length + Object.keys(overrides.style ?? {}).length + (stroke ? Math.max(0, Object.keys(stroke).length - 1) : 0) + Object.keys(overrides.tokenBindings ?? {}).length + Object.keys(overrides.sharedStyleBindings ?? {}).length
}

export interface OverrideDetail {
  key: string
  label: string
  value?: string
}

export function overrideDetails(node: SceneElement): OverrideDetail[] {
  if (node.component?.kind !== 'instance') return []
  const { properties = {}, style = {}, tokenBindings, sharedStyleBindings } = node.component.overrides
  const details: OverrideDetail[] = []

  const styleNames: Record<string, string> = {
    fill: 'Fill',
    stroke: 'Stroke',
    opacity: 'Opacity',
    shadow: 'Shadow',
    shader: 'Shader FX',
  }

  for (const [key, val] of Object.entries(style)) {
    let valStr: string | undefined
    if (key === 'fill') valStr = String(val)
    else if (key === 'opacity') valStr = `${Math.round(Number(val) * 100)}%`
    else if (key === 'stroke' && val && typeof val === 'object') {
      valStr = (val as any).color ?? 'Stroke'
    }
    details.push({
      key: `style.${key}`,
      label: styleNames[key] ?? key[0].toUpperCase() + key.slice(1),
      value: valStr,
    })
  }

  const propNames: Record<string, string> = {
    text: 'Text',
    name: 'Name',
    fontFamily: 'Font',
    fontSize: 'Text size',
    fontWeight: 'Weight',
    lineHeight: 'Leading',
    letterSpacing: 'Tracking',
    textAlign: 'Alignment',
    textTransform: 'Transform',
    cornerRadius: 'Radius',
    width: 'Width',
    height: 'Height',
    x: 'X',
    y: 'Y',
    rotation: 'Rotation',
    kinetic: 'Kinetic Motion',
    variableAxes: 'Variable Axes',
    openTypeFeatures: 'OpenType',
    clipContent: 'Clip Content',
    d: 'Vector Path',
  }

  for (const [key, val] of Object.entries(properties)) {
    let valStr: string | undefined
    if (['fontSize', 'cornerRadius', 'width', 'height', 'x', 'y'].includes(key)) {
      valStr = `${val}px`
    } else if (key === 'letterSpacing') {
      valStr = `${val}px`
    } else if (key === 'lineHeight') {
      valStr = `${val}`
    } else if (key === 'rotation') {
      valStr = `${val}°`
    } else if (key === 'text') {
      valStr = String(val).slice(0, 15)
    } else if (key === 'kinetic' && typeof val === 'object' && val) {
      valStr = `${Object.keys(val).length} props`
    } else if (key === 'variableAxes' && typeof val === 'object' && val) {
      valStr = `${Object.keys(val).length} axes`
    }
    details.push({
      key: `properties.${key}`,
      label: propNames[key] ?? key[0].toUpperCase() + key.slice(1),
      value: valStr,
    })
  }

  if (tokenBindings && Object.keys(tokenBindings).length) {
    details.push({ key: 'tokenBindings', label: 'Tokens' })
  }
  if (sharedStyleBindings && Object.keys(sharedStyleBindings).length) {
    details.push({ key: 'sharedStyleBindings', label: 'Styles' })
  }

  return details
}

export function overrideLabels(node: SceneElement): string[] {
  return overrideDetails(node).map(d => d.label)
}

export function ComponentInspector({ store, controller, node }: { store: SceneStore; controller: ViewportController; node: SceneElement }) {
  const state = useScene(store, snapshot => snapshot)
  const { active } = useSyncExternalStore(store.subscribe, store.getHistorySnapshot)
  const root = componentRoot(state.elements, node.id)
  const reason = store.componentCreationReason(node.id)
  const [error, setError] = useState('')
  const perform = (action: () => void) => { try { action(); setError('') } catch (error) { setError((error as Error).message) } }
  const focus = (id: string) => { store.select([id]); controller.fit(getWorldBounds(store.getSnapshot(), id)) }
  if (!root?.component) return <div className="inspector-section component-section">
    <span className="section-caption">REUSABLE DESIGN</span>
    <button className="component-action" disabled={!!reason} title={reason ?? 'Turn this layer and its children into a reusable master'} onClick={() => perform(() => { store.createComponent(node.id); store.autoExposeComponentProperties(node.id) })}><Diamonds size={14} />Create component<Plus size={12} /></button>
    {!reason && <p>One master. Every detail in sync.</p>}
    {error && <p role="alert" className="component-error">{error}</p>}
  </div>
  const instance = root.component.kind === 'instance'
  const masterId = root.component.kind === 'instance' ? root.component.masterId : root.id
  const master = state.elements[masterId]
  const instances = Object.values(state.elements).filter(layer => layer.component?.kind === 'instance' && layer.component.masterId === masterId && layer.component.instanceId === layer.id).length
  const layers = node.id === root.id ? subtree(state.elements, root.id) : [node]
  const count = Object.keys(node.id === root.id && root.component.kind === 'instance' ? root.component.propertyValues ?? {} : {}).length + layers.reduce((total, layer) => total + (layer.component?.kind === 'instance' ? overrideCount(layer.component.overrides) : 0), 0)
  const dynamicOverrides = node.id === root.id && root.component.kind === 'instance' && root.component.propertyValues
    ? Object.entries(root.component.propertyValues).map(([propId, val]) => {
        const prop = master?.component?.kind === 'master' ? master.component.properties?.find(p => p.id === propId) : undefined
        return { id: propId, name: prop?.name ?? propId, value: String(val) }
      })
    : []
  const hasVariantMatrix = Boolean(master?.component?.kind === 'master' && master.component.variantMatrix)
  const allMasters = useMemo(() => Object.values(state.elements).filter(n => n.component?.kind === 'master'), [state.elements])

  return <div className="inspector-section component-section" data-testid="component-inspector">
    <div className="component-section-heading"><span className="section-caption">{instance ? 'COMPONENT INSTANCE' : 'MASTER COMPONENT'}</span>{instance ? <Diamond size={13} /> : <Diamonds size={13} />}</div>
    <div className="component-identity"><span className={`component-mark ${instance ? '' : 'is-master'}`}><Diamond size={18} /></span><div><strong>{master?.name}</strong><span>{instance ? count ? `${count} local override${count === 1 ? '' : 's'}` : 'Synced with master' : `${instances} instance${instances === 1 ? '' : 's'} in this document`}</span></div></div>
    {master && <ComponentPropertiesPanel key={root.id} store={store} master={master} root={root} disabled={active || store.isLocked(root.id) || (!instance && store.isLocked(masterId))} />}
    {instance ? <>
      <div className="component-heading-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <button className="text-action" disabled={active || !store.isVisible(masterId) || store.isLocked(masterId)} onClick={() => focus(masterId)}>Go to master<ArrowUpRight size={12} /></button>
        {allMasters.length > 1 && (
          <div className="component-swap-row" style={{ margin: 0, padding: '2px 6px', flex: 1, maxWidth: '180px' }} title="Swap this instance to another master component">
            <div className="component-swap-label">
              <ArrowLeftRight size={10} />
              <span>Swap:</span>
            </div>
            <select
              className="property-input component-swap-select"
              aria-label="Swap component master"
              disabled={active || store.isLocked(root.id)}
              value={masterId}
              onChange={event => perform(() => store.swapComponentInstance(root.id, event.currentTarget.value))}
            >
              {allMasters.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {count > 0 && (
        <div className="component-override-list" aria-label="Property overrides">
          {dynamicOverrides.length > 0 && (
            <div className="component-override-group">
              <div className="component-override-group-header">
                <span className="component-override-group-title">Dynamic Properties</span>
                <span className="component-override-count-badge">{dynamicOverrides.length}</span>
              </div>
              <div className="component-override-chips">
                {dynamicOverrides.map(prop => (
                  <div key={prop.id} className="component-override-chip-wrapper">
                    <span className="component-override-chip is-interactive" title={`${prop.name}: ${prop.value}`}>
                      <span className="property-override-dot" />
                      <span className="override-chip-label">{prop.name}</span>
                      <span className="override-chip-val">{prop.value}</span>
                    </span>
                    <button
                      className="chip-action-btn"
                      disabled={active || store.isLocked(masterId)}
                      title={`Push ${prop.name} to master`}
                      aria-label={`Push ${prop.name} to master`}
                      onClick={() => perform(() => store.pushComponentPropertyToMaster(root.id, prop.id))}
                    >
                      <Upload size={10} />
                    </button>
                    <button
                      className="chip-action-btn"
                      disabled={active}
                      title={`Reset ${prop.name}`}
                      aria-label={`Reset ${prop.name}`}
                      onClick={() => perform(() => store.setComponentProperty(root.id, prop.id, null))}
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {layers.filter(layer => overrideDetails(layer).length > 0).map(layer => {
            const diffs = store.getOverrideDiff(layer.id)
            return (
              <div key={layer.id} className="component-override-group">
                <div className="component-override-group-header">
                  <span className="component-override-group-title">{layer.name}</span>
                  <div className="component-override-group-actions">
                    {hasVariantMatrix && (
                      <button
                        className="quiet-button override-header-action"
                        disabled={active || store.isLocked(masterId)}
                        title={`Push ${layer.name} overrides to variant matrix`}
                        aria-label={`Push ${layer.name} to variant`}
                        onClick={() => perform(() => store.pushLayerOverridesToVariant(layer.id))}
                      >
                        <Layers size={11} />
                      </button>
                    )}
                    <button
                      className="quiet-button override-header-action"
                      disabled={active || store.isLocked(masterId)}
                      title={`Push ${layer.name} overrides to master`}
                      aria-label={`Push ${layer.name} to master`}
                      onClick={() => perform(() => store.pushLayerOverridesToMaster(layer.id))}
                    >
                      <Upload size={11} />
                    </button>
                    <button
                      className="quiet-button override-header-action"
                      disabled={active}
                      title={`Reset ${layer.name} overrides`}
                      aria-label={`Reset ${layer.name}`}
                      onClick={() => perform(() => store.resetComponentOverrides(layer.id))}
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                </div>
                <div className="component-override-chips">
                  {overrideDetails(layer).map(item => {
                    const matchingDiff = diffs.find(d => d.channel === item.key)
                    const hasDiffVal = matchingDiff && matchingDiff.masterValue !== 'default' && matchingDiff.masterValue !== 'none'
                    return (
                      <div key={item.key} className="component-override-chip-wrapper">
                        <span className="component-override-chip" title={`${item.label}${item.value ? `: ${item.value}` : ''}`}>
                          <span className="property-override-dot" />
                          <span className="override-chip-label">{item.label}</span>
                          {hasDiffVal ? (
                            <span className="override-diff-info">
                              <span className="override-master-val" title={`Master: ${matchingDiff.masterValue}`}>{matchingDiff.masterValue}</span>
                              <span className="override-diff-arrow">→</span>
                              <span className="override-local-val" title={`Override: ${matchingDiff.overrideValue}`}>{matchingDiff.overrideValue}</span>
                            </span>
                          ) : (
                            item.value && <span className="override-chip-val">{item.value}</span>
                          )}
                        </span>
                        {hasVariantMatrix && (
                          <button
                            className="chip-action-btn"
                            disabled={active || store.isLocked(masterId)}
                            title={`Push ${item.label} to variant combination`}
                            aria-label={`Push ${item.label} to variant`}
                            onClick={() => perform(() => store.pushPropertyOverrideToVariant(layer.id, item.key))}
                          >
                            <Layers size={10} />
                          </button>
                        )}
                        <button
                          className="chip-action-btn"
                          disabled={active || store.isLocked(masterId)}
                          title={`Push ${item.label} to master`}
                          aria-label={`Push ${item.label} to master`}
                          onClick={() => perform(() => store.pushPropertyOverrideToMaster(layer.id, item.key))}
                        >
                          <Upload size={10} />
                        </button>
                        <button
                          className="chip-action-btn"
                          disabled={active}
                          title={`Reset ${item.label}`}
                          aria-label={`Reset ${item.label}`}
                          onClick={() => perform(() => store.resetPropertyOverride(layer.id, item.key))}
                        >
                          <RotateCcw size={10} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="component-actions">
        {count > 0 && hasVariantMatrix && (
          <button
            className="component-action primary"
            disabled={active || store.isLocked(masterId)}
            title="Push local overrides to active variant combination in matrix"
            onClick={() => perform(() => store.pushInstanceOverridesToVariant(node.id))}
          >
            <Layers size={12} />Push overrides to variant matrix
          </button>
        )}
        {count > 0 && (
          <button
            className={`component-action ${!hasVariantMatrix ? 'primary' : ''}`}
            disabled={active || store.isLocked(masterId)}
            title="Push local overrides back to master symbol for all instances"
            onClick={() => perform(() => store.pushOverridesToMaster(node.id))}
          >
            <Upload size={12} />Push overrides to master
          </button>
        )}
        <button
          className="component-action"
          disabled={active || !master}
          title="Pull latest master changes and synchronize instance"
          aria-label="Sync with master"
          onClick={() => perform(() => store.syncInstanceWithMaster(node.id))}
        >
          <RefreshCw size={12} />Sync with master
        </button>
        <button className="component-action" disabled={!count || active} onClick={() => perform(() => store.resetAllComponentOverrides(node.id))}><RotateCcw size={12} />Reset overrides</button>
        <button className="component-action" disabled={active} onClick={() => perform(() => store.detachComponentInstance(node.id))}><Unlink size={12} />Detach instance</button>
      </div>
      <p>{node.id === root.id ? 'Edit any layer to override it. Reset restores the master’s current values.' : 'Overrides belong to this layer. Detach releases the whole instance.'}</p>
    </> : <>
      <button className="component-action primary" disabled={active} onClick={() => perform(() => { const instance = store.createComponentInstance(masterId); focus(instance.id) })}><Plus size={13} />Insert instance<ArrowUpRight size={12} /></button>
      <button className="component-action" disabled={active || store.isLocked(masterId)} title="Duplicate master component on 120px grid" onClick={() => perform(() => { const copy = store.duplicateComponent(masterId); focus(copy.id) })}><Copy size={12} />Duplicate master</button>
      {instances > 0 && (
        <button className="component-action" disabled={active || store.isLocked(masterId)} title="Sync all instances in document with this master" aria-label="Sync all instances" onClick={() => perform(() => store.syncAllInstancesWithMaster(masterId))}><RefreshCw size={12} />Sync all instances ({instances})</button>
      )}
      <button className="component-action" disabled={active || store.isLocked(masterId)} title="Auto-expose detected properties" onClick={() => perform(() => store.autoExposeComponentProperties(masterId))}><Sparkles size={12} />Auto-expose properties</button>
      <p>Changes to this master flow to every linked instance.</p>
    </>}
    {error && <p role="alert" className="component-error">{error}</p>}
  </div>
}

export function ComponentLibrary({ store, controller }: { store: SceneStore; controller: ViewportController }) {
  const state = useScene(store, snapshot => snapshot)
  const { active } = useSyncExternalStore(store.subscribe, store.getHistorySnapshot)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const masters = useMemo(() => Object.values(state.elements).filter(node => node.component?.kind === 'master'), [state.elements])
  const instanceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of Object.values(state.elements)) if (node.component?.kind === 'instance' && node.component.instanceId === node.id) counts.set(node.component.masterId, (counts.get(node.component.masterId) ?? 0) + 1)
    return counts
  }, [state.elements])
  const filtered = masters.filter(node => node.name.toLowerCase().includes(query.toLowerCase()))
  const selected = state.selection.length === 1 ? state.selection[0] : undefined
  const reason = selected ? store.componentCreationReason(selected) : 'Select one layer or frame to create a component.'
  const perform = (action: () => void) => { try { action(); setError('') } catch (error) { setError((error as Error).message) } }
  const focus = (id: string) => { store.select([id]); controller.fit(getWorldBounds(store.getSnapshot(), id)) }
  return <div className="component-library" data-testid="component-library">
    <div className="component-library-intro"><span className="section-caption">DOCUMENT COMPONENTS</span><h3>Design once. Make it yours.</h3><p>Reusable layers, connected by a master.</p></div>
    <label className="component-search"><Search size={12} /><input aria-label="Search components" placeholder="Find a component…" value={query} onChange={event => setQuery(event.currentTarget.value)} /><span>{masters.length}</span></label>
    <div className="component-library-list">
      {!filtered.length && <div className="component-empty"><div className="component-empty-art" aria-hidden="true"><Diamonds size={30} strokeWidth={1} /></div><strong>{query ? 'No matching components' : 'A place for your building blocks.'}</strong><p>{query ? 'Try a different name.' : 'Select a layer or a frame, then create your first component.'}</p></div>}
      {filtered.map(master => {
        const count = instanceCounts.get(master.id) ?? 0
        const layerCount = subtree(state.elements, master.id).length
        return <div className="component-library-card" key={master.id} data-testid="component-card">
          <button className="component-card-master" aria-label={`Go to master ${master.name}`} disabled={active || !store.isVisible(master.id) || store.isLocked(master.id)} onClick={() => focus(master.id)}><span className="component-card-swatch" style={{ backgroundColor: master.style.fill ?? 'transparent' }}><Diamonds size={20} strokeWidth={1.5} /></span><span><strong>{master.name}</strong><small>{count} instance{count === 1 ? '' : 's'} · {layerCount} layer{layerCount === 1 ? '' : 's'}</small></span></button>
          <button className="component-card-insert" aria-label={`Insert ${master.name} instance`} title="Insert instance" disabled={active} onClick={() => perform(() => { const instance = store.createComponentInstance(master.id); focus(instance.id) })}><Plus size={14} /></button>
        </div>
      })}
    </div>
    <div className="component-library-footer"><button className="component-action" disabled={!!reason} title={reason ?? 'Create a reusable master from the selection'} onClick={() => perform(() => { if (selected) store.createComponent(selected) })}><Diamonds size={13} />Create from selection<Plus size={12} /></button><p>Fill, stroke, opacity and text can be overridden in each instance.</p>{error && <p role="alert" className="component-error">{error}</p>}</div>
  </div>
}
