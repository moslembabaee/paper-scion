import { memo, useState, useSyncExternalStore } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Combine,
  Copy,
  Diamond,
  Component as Diamonds,
  Eye,
  EyeOff,
  Frame,
  Image,
  Layers,
  LockKeyhole,
  PanelLeftClose,
  PenTool,
  Scan,
  ScanLine,
  Square,
  Trash2,
  Type,
  UnlockKeyhole,
} from 'lucide-react'
import type { SceneStore } from './store'
import type { BooleanOperation, ElementType, VectorElement } from './types'
import { useScene } from './useScene'

const elementIcons = {
  frame: Frame,
  rectangle: Square,
  ellipse: Circle,
  path: PenTool,
  text: Type,
  image: Image,
} satisfies Record<ElementType, typeof Square>

interface BooleanOperandRowProps {
  store: SceneStore
  compoundId: string
  source: VectorElement
  index: number
  totalCount: number
  parentOperation: BooleanOperation
  depth: number
  compoundLocked: boolean
  compoundVisible: boolean
  muted: boolean
}

const BooleanOperandRow = memo(function BooleanOperandRow({
  store,
  compoundId,
  source,
  index,
  totalCount,
  parentOperation,
  depth,
  compoundLocked,
  compoundVisible,
  muted,
}: BooleanOperandRowProps) {
  const [expanded, setExpanded] = useState(false)
  const selectedOperand = useSyncExternalStore(
    store.subscribeSelectedCompoundOperand,
    store.getSelectedCompoundOperand,
    store.getSelectedCompoundOperand
  )
  const isSelected =
    selectedOperand?.compoundId === compoundId && selectedOperand?.operandId === source.id
  const isCompound = source.type === 'path' && !!source.boolean
  const hasChildren = isCompound && (source.boolean?.operands.length ?? 0) > 0

  const SourceIcon = isCompound ? Combine : elementIcons[source.type]

  const badgeText =
    parentOperation === 'subtract'
      ? index === 0
        ? 'BASE'
        : 'CUT'
      : parentOperation.toUpperCase()

  return (
    <div role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`scene-layer-row boolean-layer-source ${isSelected ? 'selected' : ''} ${muted ? 'is-muted' : ''}`}
        data-operand-id={source.id}
        style={{ paddingLeft: 12 + depth * 12 }}
        onPointerEnter={() => store.highlightBooleanSource(source.id)}
        onPointerLeave={() => store.highlightBooleanSource(null)}
      >
        <button
          className="layer-disclosure quiet-button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${source.name}`}
          disabled={!hasChildren}
          onClick={() => setExpanded(!expanded)}
        >
          {hasChildren ? expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : <span />}
        </button>
        <button
          className="layer-select"
          disabled={compoundLocked || !compoundVisible}
          title={`Select ${source.name} operand in compound`}
          onClick={() => {
            store.select([compoundId])
            store.setSelectedCompoundOperand({ compoundId, operandId: source.id })
            store.highlightBooleanSource(source.id)
          }}
        >
          <SourceIcon size={12} />
          <span>{source.name}</span>
          <span
            className={`boolean-layer-badge ${
              parentOperation === 'subtract' && index === 0
                ? 'is-base'
                : parentOperation === 'subtract'
                  ? 'is-cutter'
                  : isCompound
                    ? 'is-compound'
                    : ''
            }`}
          >
            {isCompound ? `⊞ ${source.boolean!.operation.toUpperCase()}` : badgeText}
          </span>
          {muted && <span className="boolean-layer-badge is-muted-badge">MUTED</span>}
        </button>
        <button
          className="layer-control quiet-button"
          aria-label={`${muted ? 'Include' : 'Mute'} ${source.name} operand`}
          aria-pressed={!muted}
          title={
            muted
              ? 'Include in compound boolean calculation'
              : 'Mute operand (bypass in boolean calculation)'
          }
          disabled={compoundLocked}
          onClick={e => {
            e.stopPropagation()
            store.toggleBooleanOperandMute(compoundId, source.id)
          }}
        >
          {muted ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <button
          className="layer-control quiet-button"
          aria-label={`Duplicate ${source.name}`}
          title="Duplicate operand"
          disabled={compoundLocked}
          onClick={e => {
            e.stopPropagation()
            store.duplicateBooleanOperand(compoundId, source.id)
          }}
        >
          <Copy size={11} />
        </button>
        {totalCount > 2 && (
          <button
            className="layer-control quiet-button layer-delete-control"
            aria-label={`Remove ${source.name}`}
            title="Remove operand from compound"
            disabled={compoundLocked}
            onClick={e => {
              e.stopPropagation()
              store.removeBooleanOperand(compoundId, source.id)
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {expanded && isCompound && source.boolean && (
        <div role="group">
          {[...source.boolean.operands].reverse().map((subSource, subIdx, all) => {
            const actualIndex = all.length - 1 - subIdx
            const subMuted = source.boolean!.mutedOperandIds?.includes(subSource.id) ?? false
            return (
              <BooleanOperandRow
                key={subSource.id}
                store={store}
                compoundId={compoundId}
                source={subSource}
                index={actualIndex}
                totalCount={all.length}
                parentOperation={source.boolean!.operation}
                depth={depth + 1}
                compoundLocked={compoundLocked}
                compoundVisible={compoundVisible}
                muted={subMuted}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

const LayerRow = memo(function LayerRow({ store, id, depth }: { store: SceneStore; id: string; depth: number }) {
  const node = useScene(store, state => state.elements[id])
  const selected = useScene(store, state => state.selection.includes(id))
  const locked = useScene(store, () => store.isLocked(id))
  const visible = useScene(store, () => store.isVisible(id))
  const active = useScene(store, () => store.getHistorySnapshot().active)
  const [expanded, setExpanded] = useState(false)
  if (!node) return null
  const Icon = node.mask
    ? Scan
    : node.component?.kind === 'master'
      ? Diamonds
      : node.component?.kind === 'instance' && node.component.instanceId === id
        ? Diamond
        : node.type === 'path' && node.boolean
          ? Combine
          : elementIcons[node.type]
  const overridden =
    node.component?.kind === 'instance' &&
    (Object.values(node.component.overrides).some(value => value && Object.keys(value).length) ||
      (node.id === node.component.instanceId && Object.keys(node.component.propertyValues ?? {}).length > 0))
  const isCompound = node.type === 'path' && !!node.boolean
  const hasChildren = (node.type === 'frame' && node.children.length > 0) || isCompound
  return (
    <div role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`scene-layer-row ${selected ? 'selected' : ''} ${node.mask ? 'is-mask' : ''} ${!visible ? 'is-hidden' : ''} ${node.component ? 'is-component' : ''} ${node.component?.kind === 'master' ? 'is-master' : ''}`}
        data-layer-id={id}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          className="layer-disclosure quiet-button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
          disabled={!hasChildren}
          onClick={() => setExpanded(!expanded)}
        >
          {hasChildren ? expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : <span />}
        </button>
        <button
          className="layer-select"
          disabled={locked || !visible}
          onClick={event => {
            const ids = store.getSnapshot().selection
            store.select(
              event.shiftKey
                ? ids.includes(id)
                  ? ids.filter(value => value !== id)
                  : [...ids, id]
                : [id]
            )
          }}
          title={locked ? `${node.name} is locked` : node.name}
        >
          <Icon size={12} />
          <span>{node.name.replace(/^\d+ — /, '')}</span>
          {isCompound && (
            <span className="boolean-layer-badge is-compound">
              {node.boolean!.operation.toUpperCase()}
            </span>
          )}
          {node.mask && (
            <small className={`layer-mask-label ${node.mask.enabled ? '' : 'is-disabled'}`}>
              MASK
            </small>
          )}
          {overridden && <i className="layer-instance-dot" title="Local property overrides" />}
        </button>
        {node.mask && (
          <button
            className="layer-control layer-mask-control quiet-button"
            disabled={active || locked || node.component?.kind === 'instance'}
            aria-label={`${node.mask.enabled ? 'Disable' : 'Enable'} ${node.name} mask`}
            aria-pressed={node.mask.enabled}
            title="Toggle vector clipping"
            onClick={() => store.setMask(id, !node.mask!.enabled)}
          >
            <Scan size={11} />
          </button>
        )}
        {node.mask && (
          <button
            className="layer-control layer-mask-control quiet-button"
            disabled={active || node.component?.kind === 'instance'}
            aria-label={`${node.mask.showOutline ? 'Hide' : 'Show'} ${node.name} mask outline`}
            aria-pressed={node.mask.showOutline}
            title="Toggle mask outline"
            onClick={() => store.setMaskOutline(id, !node.mask!.showOutline)}
          >
            <ScanLine size={11} />
          </button>
        )}
        <button
          className="layer-control quiet-button"
          aria-label={`${node.visible ? 'Hide' : 'Show'} ${node.name}`}
          aria-pressed={!node.visible}
          onClick={() => store.setVisible(id, !node.visible)}
        >
          {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <button
          className={`layer-control quiet-button ${node.locked ? 'is-locked' : ''}`}
          aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`}
          aria-pressed={node.locked}
          onClick={() => store.setLocked(id, !node.locked)}
        >
          {node.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
        </button>
      </div>
      {expanded && node.type === 'frame' && (
        <div role="group">
          {[...node.children].reverse().map(child => (
            <LayerRow key={child} store={store} id={child} depth={depth + 1} />
          ))}
        </div>
      )}
      {expanded && isCompound && (
        <div role="group">
          {[...node.boolean!.operands].reverse().map((source, reverseIdx, all) => {
            const actualIndex = all.length - 1 - reverseIdx
            const isMuted = node.boolean!.mutedOperandIds?.includes(source.id) ?? false
            return (
              <BooleanOperandRow
                key={source.id}
                store={store}
                compoundId={id}
                source={source}
                index={actualIndex}
                totalCount={all.length}
                parentOperation={node.boolean!.operation}
                depth={depth + 1}
                compoundLocked={locked}
                compoundVisible={visible}
                muted={isMuted}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

export function LayerTree({ store, onHide, embedded = false }: { store: SceneStore; onHide: () => void; embedded?: boolean }) {
  const rootIds = useScene(store, state => state.rootIds)
  const count = useScene(store, state => Object.keys(state.elements).length)
  return (
    <aside className={embedded ? 'layers-content' : 'layers-panel'} data-testid="layer-tree" aria-label="Document layers">
      {!embedded && (
        <div className="panel-heading">
          <span>Layers</span>
          <button className="quiet-button" aria-label="Hide layers" onClick={onHide}>
            <PanelLeftClose size={14} />
          </button>
        </div>
      )}
      <div className="page-row">
        <Layers size={13} />
        <span>Explorations</span>
        <span className="page-count">01</span>
      </div>
      <div className="layer-section-heading">
        SCENE <span>{count} layers</span>
      </div>
      <div className="scene-layer-tree" role="tree" aria-label="Scene hierarchy">
        {[...rootIds].reverse().map(id => (
          <LayerRow key={id} store={store} id={id} depth={0} />
        ))}
      </div>
      <div className="layers-bottom">
        <span className="workspace-label">YOUR WORKSPACE</span>
        <p>Room for your next idea.</p>
        <span>Infinite by design.</span>
      </div>
    </aside>
  )
}
