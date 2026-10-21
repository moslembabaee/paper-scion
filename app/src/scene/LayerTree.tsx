import { memo, useState, useSyncExternalStore } from 'react'
import {
  ArrowDown,
  ArrowUp,
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
  Scissors,
  Sparkles,
  Sun,
  CornerDownRight,
} from 'lucide-react'
import type { SceneStore } from './store'
import type { BooleanOperation, ElementType, VectorElement } from './types'
import { getMaskHierarchy } from './maskGeometry'
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
          aria-label={`Move ${source.name} up`}
          title="Move operand later (higher in stack)"
          disabled={compoundLocked || index === totalCount - 1}
          onClick={e => {
            e.stopPropagation()
            store.moveBooleanOperand(compoundId, source.id, 1)
          }}
        >
          <ArrowUp size={11} />
        </button>
        <button
          className="layer-control quiet-button"
          aria-label={`Move ${source.name} down`}
          title="Move operand earlier (lower in stack / subtraction base)"
          disabled={compoundLocked || index === 0}
          onClick={e => {
            e.stopPropagation()
            store.moveBooleanOperand(compoundId, source.id, -1)
          }}
        >
          <ArrowDown size={11} />
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
  const maskInfo = useScene(store, state => getMaskHierarchy(state.elements, id))
  const [expanded, setExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState<'before' | 'after' | 'inside' | null>(null)
  if (!node) return null

  const MaskModeIcon = node.mask
    ? node.mask.mode === 'alpha'
      ? Sparkles
      : node.mask.mode === 'luminance'
        ? Sun
        : Scissors
    : Scan

  const Icon = node.mask
    ? MaskModeIcon
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
        className={`scene-layer-row ${selected ? 'selected' : ''} ${node.mask ? 'is-mask' : ''} ${maskInfo.isMaskGroup ? 'is-mask-group' : ''} ${maskInfo.isMasked ? 'is-masked-target' : ''} ${!visible ? 'is-hidden' : ''} ${node.component ? 'is-component' : ''} ${node.component?.kind === 'master' ? 'is-master' : ''} ${isDragging ? 'is-dragging' : ''} ${dragPosition === 'before' ? 'drop-before' : dragPosition === 'after' ? 'drop-after' : dragPosition === 'inside' ? 'drop-inside' : ''}`}
        data-layer-id={id}
        data-mask-role={maskInfo.role}
        data-mask-source={node.mask ? 'true' : undefined}
        data-mask-group={maskInfo.isMaskGroup ? 'true' : undefined}
        data-masked-by={maskInfo.isMasked ? maskInfo.maskSource?.id : undefined}
        data-mask-mode={maskInfo.role !== 'none' ? maskInfo.mode : undefined}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={!locked && !active}
        onDragStart={e => {
          if (locked || active) return
          e.dataTransfer.setData('text/plain', id)
          e.dataTransfer.effectAllowed = 'move'
          setIsDragging(true)
        }}
        onDragEnd={() => {
          setIsDragging(false)
          setDragPosition(null)
        }}
        onDragOver={e => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          const relY = e.clientY - rect.top
          if (node.type === 'frame' && relY >= rect.height * 0.25 && relY <= rect.height * 0.75) {
            setDragPosition('inside')
          } else if (relY < rect.height * 0.5) {
            setDragPosition('before')
          } else {
            setDragPosition('after')
          }
        }}
        onDragLeave={() => {
          setDragPosition(null)
        }}
        onDrop={e => {
          e.preventDefault()
          e.stopPropagation()
          const sourceId = e.dataTransfer.getData('text/plain')
          const pos = dragPosition
          setDragPosition(null)
          if (!sourceId || sourceId === id) return
          if (store.isLocked(sourceId) || store.isLocked(id)) return

          if (pos === 'inside' && node.type === 'frame') {
            store.reparent(sourceId, node.id, node.children.length)
          } else {
            const targetParentId = node.parentId
            const siblings = store.getChildren(targetParentId)
            const targetIdx = siblings.indexOf(id)
            const insertIdx = pos === 'after' ? targetIdx + 1 : targetIdx
            const sourceNode = store.getSnapshot().elements[sourceId]
            if (sourceNode?.parentId === targetParentId) {
              store.reorder(sourceId, insertIdx)
            } else {
              store.reparent(sourceId, targetParentId, insertIdx)
            }
          }
        }}
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
          {maskInfo.isMasked && (
            <span title={`Masked by ${maskInfo.maskSource?.name ?? 'mask'}`}>
              <CornerDownRight size={10} className="layer-clip-indicator" />
            </span>
          )}
          <Icon size={12} />
          <span>{node.name.replace(/^\d+ — /, '')}</span>
          {isCompound && (
            <span className="boolean-layer-badge is-compound">
              {node.boolean!.operation.toUpperCase()}
            </span>
          )}
          {maskInfo.isMaskGroup && (
            <span className="mask-group-badge" title={`Mask group with ${maskInfo.maskedElements?.length ?? 0} clipped layers (${maskInfo.mode} mask)`}>
              MASK GROUP
            </span>
          )}
          {maskInfo.isMasked && (
            <span className="layer-clipped-badge" title={`Clipped by ${maskInfo.maskSource?.name ?? 'mask'} (${maskInfo.mode})`}>
              CLIPPED
            </span>
          )}
          {node.mask && (
            <button
              type="button"
              className={`layer-mask-label is-mode-${node.mask.mode ?? 'vector'} ${node.mask.enabled ? '' : 'is-disabled'}`}
              title={`Mask mode: ${node.mask.mode ?? 'vector'}${node.mask.inverted ? ' (inverted)' : ''}. Click to cycle mode.`}
              onClick={e => {
                e.stopPropagation()
                store.cycleMaskMode(id)
              }}
            >
              {node.mask.mode === 'alpha'
                ? 'ALPHA MASK'
                : node.mask.mode === 'luminance'
                  ? `LUM ${Math.round((node.mask.luminanceThreshold ?? 0.5) * 100)}%`
                  : 'MASK'}
              {node.mask.inverted ? ' [INV]' : ''}
            </button>
          )}
          {overridden && <i className="layer-instance-dot" title="Local property overrides" />}
        </button>
        {node.mask && (
          <button
            className={`layer-control layer-mask-control quiet-button ${node.mask.isolated ? 'is-isolated' : ''}`}
            disabled={active || node.component?.kind === 'instance'}
            aria-label={`${node.mask.isolated ? 'Exit' : 'Isolate'} ${node.name} mask on canvas`}
            aria-pressed={node.mask.isolated}
            title={node.mask.isolated ? 'Exit mask canvas isolation' : 'Isolate mask on canvas'}
            onClick={() => store.setMaskIsolated(id, !node.mask!.isolated)}
          >
            <Eye size={11} />
          </button>
        )}
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
