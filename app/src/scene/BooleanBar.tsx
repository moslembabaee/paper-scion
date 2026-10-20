import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code,
  Copy,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  PenTool,
  RotateCcw,
  Scissors,
  Trash2,
  Unlink,
} from 'lucide-react'
import type { BooleanOperation, PathElement, VectorElement } from './types'
import { vectorPathData } from './booleanGeometry'
import { parsePath, pathBounds } from './pathGeometry'
import { buildShapeTree, flattenShapeTree } from './shapeTree'
import { unionBounds } from '../canvas/math'
import { downloadFile } from '../io/project'
import {
  extractCAGMetrics,
  cleanSvgPathGeometry,
  exportCleanSVGGeometry,
  generateCompoundClipPath,
} from './cagEngine'
import type { SceneStore } from './store'
import { useScene } from './useScene'
import './boolean.css'

const ACTIONS: readonly {
  operation: BooleanOperation
  label: string
  hint: string
  symbol: string
  mathFormula: string
}[] = [
  {
    operation: 'union',
    label: 'Union',
    hint: 'Merge all filled vector areas (A ∪ B)',
    symbol: '∪',
    mathFormula: 'A ∪ B',
  },
  {
    operation: 'subtract',
    label: 'Subtract',
    hint: 'Subtract subsequent cutting shapes from base (A \\ B)',
    symbol: '∖',
    mathFormula: 'A \\ B',
  },
  {
    operation: 'intersect',
    label: 'Intersect',
    hint: 'Retain only overlapping volume common to all shapes (A ∩ B)',
    symbol: '∩',
    mathFormula: 'A ∩ B',
  },
  {
    operation: 'exclude',
    label: 'Exclude',
    hint: 'Retain non-overlapping regions; exclude even overlaps (A ⊕ B)',
    symbol: '⊕',
    mathFormula: 'A ⊕ B',
  },
]

function BooleanIcon({ operation }: { operation: BooleanOperation }) {
  const parts: Record<BooleanOperation, string> = {
    union: 'M3 3H13V7H17V17H7V13H3Z',
    subtract: 'M3 3H13V7H7V13H3Z',
    intersect: 'M7 7H13V13H7Z',
    exclude: 'M3 3H13V7H7V13H3Z M13 7H17V17H7V13H13Z',
  }
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 3H13V13H3Z M7 7H17V17H7Z" stroke="currentColor" strokeWidth="1" opacity=".35" />
      <path
        d={parts[operation]}
        fill="currentColor"
        fillOpacity=".22"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CompoundPreview({
  compound,
  highlightedId,
  store,
}: {
  compound: PathElement
  highlightedId: string | null
  store?: SceneStore
}) {
  const [viewMode, setViewMode] = useState<'visual' | 'tree' | 'code' | 'clip'>('visual')
  const [copied, setCopied] = useState<string | null>(null)

  const sources = useMemo(
    () => compound.boolean!.operands.map(source => ({ id: source.id, d: vectorPathData(source) })),
    [compound.boolean]
  )

  const bounds = useMemo(
    () => unionBounds(sources.map(source => pathBounds(parsePath(source.d)))),
    [sources]
  )

  const metrics = useMemo(() => extractCAGMetrics(compound.d), [compound.d])

  const cleanD = useMemo(
    () => cleanSvgPathGeometry(compound.d, { precision: 4 }),
    [compound.d]
  )

  const cleanMarkup = useMemo(
    () =>
      exportCleanSVGGeometry(compound, {
        standalone: false,
        precision: 4,
        fill: '#81adec',
      }),
    [compound]
  )

  const clipMarkup = useMemo(
    () => generateCompoundClipPath(compound, { precision: 4 }),
    [compound]
  )

  const handleCopy = async (text: string, label: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(label)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      // Ignore clipboard write errors
    }
  }

  const handleDownloadSvg = () => {
    try {
      const svgMarkup = exportCleanSVGGeometry(compound, {
        standalone: true,
        precision: 4,
      })
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
      downloadFile(blob, `${compound.name || 'compound-shape'}.svg`)
    } catch {
      // Ignore download errors
    }
  }

  if (!bounds) return null
  const padding = Math.max(bounds.width, bounds.height) * 0.12

  return (
    <div className="boolean-preview-container">
      <div className="boolean-preview-header">
        <div className="cag-view-tabs" role="tablist" aria-label="CAG preview mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'visual'}
            className={`cag-tab-btn ${viewMode === 'visual' ? 'active' : ''}`}
            onClick={() => setViewMode('visual')}
            title="Interactive Visual Preview with Source Outlines"
          >
            <Eye size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
            PREVIEW
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'tree'}
            className={`cag-tab-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
            title="Reversible Shape Tree Hierarchy"
          >
            <GitBranch size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
            TREE
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'code'}
            className={`cag-tab-btn ${viewMode === 'code' ? 'active' : ''}`}
            onClick={() => setViewMode('code')}
            title="Clean Exported SVG Geometry Code"
          >
            <Code size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
            SVG CODE
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'clip'}
            className={`cag-tab-btn ${viewMode === 'clip' ? 'active' : ''}`}
            onClick={() => setViewMode('clip')}
            title="Generated SVG ClipPath Definition"
          >
            <Scissors size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
            CLIP PATH
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {viewMode === 'clip' ? (
            <button
              type="button"
              className="cag-copy-btn"
              onClick={() => handleCopy(clipMarkup, 'clip')}
              title="Copy SVG <clipPath> definition to clipboard"
              aria-label="Copy SVG clip path"
            >
              {copied === 'clip' ? <Check size={10} color="#81adec" /> : <Copy size={10} />}
              <span>{copied === 'clip' ? 'COPIED' : 'COPY CLIP'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="cag-copy-btn"
              onClick={() => handleCopy(cleanD, 'path')}
              title="Copy clean, optimized SVG path data (d) to clipboard"
              aria-label="Copy clean SVG path data"
            >
              {copied === 'path' ? <Check size={10} color="#81adec" /> : <Copy size={10} />}
              <span>{copied === 'path' ? 'COPIED' : 'COPY PATH'}</span>
            </button>
          )}
          <button
            type="button"
            className="cag-copy-btn"
            onClick={handleDownloadSvg}
            title="Download clean standalone SVG file"
            aria-label="Download clean SVG file"
          >
            <Download size={10} />
            <span>EXPORT SVG</span>
          </button>
        </div>
      </div>

      {viewMode === 'visual' ? (
        <figure className="boolean-preview" aria-label="Live compound preview">
          <svg
            viewBox={`${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`}
            role="img"
            aria-label={`${compound.boolean!.operation} result with editable source outlines`}
          >
            <path
              className="boolean-preview-result"
              data-testid="boolean-preview-result"
              d={compound.d}
              fillRule={compound.fillRule}
            />
            {sources.map(source => (
              <path
                key={source.id}
                className={`boolean-preview-source ${source.id === highlightedId ? 'is-highlighted' : ''}`}
                d={source.d}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <figcaption>
            <span>
              <i />
              LIVE COMPOUND
            </span>
            <span>SVG / {compound.boolean!.operands.length} SOURCES</span>
          </figcaption>
        </figure>
      ) : viewMode === 'tree' ? (
        <div className="cag-tree-view" tabIndex={0} aria-label="Reversible Shape Tree Hierarchy">
          <div className="shape-tree-list">
            {flattenShapeTree(buildShapeTree(compound)).map(node => (
              <div
                key={node.id}
                className={`shape-tree-node depth-${node.depth} ${node.id === highlightedId ? 'is-highlighted' : ''}`}
                style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
              >
                <span className="shape-tree-type-badge">{node.type}</span>
                <span className="shape-tree-name">{node.name}</span>
                {node.operation && (
                  <span className={`shape-tree-op-badge is-${node.operation}`}>
                    {node.operation}
                  </span>
                )}
                <div className="shape-tree-actions">
                  {node.type === 'compound' && store && (
                    <button
                      type="button"
                      className="shape-tree-btn"
                      title="Invert operation"
                      onClick={() => store.invertBooleanOperation(compound.id, node.id)}
                    >
                      <RotateCcw size={9} />
                    </button>
                  )}
                  {node.type === 'compound' && node.id !== compound.id && store && (
                    <button
                      type="button"
                      className="shape-tree-btn"
                      title="Dissolve group into parent"
                      onClick={() => store.dissolveCompound(compound.id, node.id)}
                    >
                      <Unlink size={9} />
                    </button>
                  )}
                  {node.type !== 'compound' && store && (
                    <button
                      type="button"
                      className={`shape-tree-btn ${node.muted ? 'is-muted' : ''}`}
                      title={node.muted ? 'Unmute shape' : 'Mute shape'}
                      onClick={() => store.toggleBooleanOperandMute(compound.id, node.id)}
                    >
                      {node.muted ? <EyeOff size={9} /> : <Eye size={9} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : viewMode === 'clip' ? (
        <pre className="cag-code-view" tabIndex={0} aria-label="SVG ClipPath Definition">
          <code>{clipMarkup}</code>
        </pre>
      ) : (
        <pre className="cag-code-view" tabIndex={0} aria-label="Clean SVG Path Geometry">
          <code>{cleanMarkup}</code>
        </pre>
      )}

      {/* CAG Geometry Metrics */}
      <div className="cag-metrics-bar" role="region" aria-label="CAG geometry metrics">
        <div className="cag-metric-item">
          <span className="cag-metric-label">AREA</span>
          <span className="cag-metric-value">{Math.round(metrics.area).toLocaleString()} px²</span>
        </div>
        <div className="cag-metric-item">
          <span className="cag-metric-label">PERIMETER</span>
          <span className="cag-metric-value">{Math.round(metrics.perimeter).toLocaleString()} px</span>
        </div>
        <div className="cag-metric-item">
          <span className="cag-metric-label">CONTOURS</span>
          <span className="cag-metric-value">{metrics.contourCount}</span>
        </div>
        <div className="cag-metric-item">
          <span className="cag-metric-label">RULE</span>
          <span className="cag-metric-value">{compound.fillRule}</span>
        </div>
      </div>
    </div>
  )
}

function SourceEditor({
  source,
  index,
  count,
  subtract,
  disabled,
  isSelected,
  muted,
  onChange,
  onMove,
  onHighlight,
  onSelect,
  onToggleMute,
  onDuplicate,
  onExtract,
  onRemove,
  onUnwrap,
  onChangeNestedOp,
  onEditAnchors,
}: {
  source: VectorElement
  index: number
  count: number
  subtract: boolean
  disabled: boolean
  isSelected: boolean
  muted: boolean
  onChange: (patch: Parameters<SceneStore['updateBooleanOperand']>[2]) => boolean
  onMove: (direction: -1 | 1) => void
  onHighlight: (id: string | null) => void
  onSelect: () => void
  onToggleMute: () => void
  onDuplicate: () => void
  onExtract: () => void
  onRemove: () => void
  onUnwrap?: () => void
  onChangeNestedOp?: (op: BooleanOperation) => void
  onEditAnchors?: () => void
}) {
  const fields = [
    ['x', 'X'],
    ['y', 'Y'],
    ['width', 'Width'],
    ['height', 'Height'],
    ['rotation', 'Rotation'],
  ] as const

  const isCompound = source.type === 'path' && !!source.boolean

  return (
    <details
      className={`boolean-source ${isSelected ? 'is-selected' : ''}`}
      open={isSelected ? true : undefined}
      onPointerEnter={() => onHighlight(source.id)}
      onPointerLeave={() => onHighlight(null)}
      onFocus={() => {
        onHighlight(source.id)
        onSelect()
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null)
      }}
    >
      <summary onClick={onSelect}>
        <span className="boolean-source-mark">
          {source.type === 'ellipse' ? '○' : source.type === 'rectangle' ? '□' : isCompound ? '⊞' : '◇'}
        </span>
        <span>{source.name}</span>
        {muted && <span className="boolean-layer-badge is-muted-badge">MUTED</span>}
        <span
          className={`boolean-source-kind ${subtract ? (index === 0 ? 'is-base' : 'is-cutter') : isCompound ? 'is-compound' : ''}`}
        >
          {subtract
            ? index === 0
              ? 'BASE'
              : 'CUT'
            : isCompound
              ? `compound (${source.boolean!.operation})`
              : source.type}
        </span>
      </summary>

      {/* Direct Operand Action Bar */}
      <div className="boolean-source-toolbar">
        <button
          type="button"
          className={`boolean-source-btn ${muted ? 'is-muted' : ''}`}
          disabled={disabled}
          title={muted ? 'Include operand in boolean calculation' : 'Mute operand'}
          onClick={e => {
            e.stopPropagation()
            onToggleMute()
          }}
        >
          {muted ? <EyeOff size={11} /> : <Eye size={11} />}
          <span>{muted ? 'MUTED' : 'ACTIVE'}</span>
        </button>
        {onEditAnchors && (
          <button
            type="button"
            className="boolean-source-btn"
            disabled={disabled}
            title="Edit sub-path anchors of this operand on canvas"
            onClick={e => {
              e.stopPropagation()
              onEditAnchors()
            }}
          >
            <PenTool size={11} />
            <span>ANCHORS</span>
          </button>
        )}
        <button
          type="button"
          className="boolean-source-btn"
          disabled={disabled}
          title="Duplicate this operand in compound"
          onClick={e => {
            e.stopPropagation()
            onDuplicate()
          }}
        >
          <Copy size={11} />
          <span>DUPLICATE</span>
        </button>
        <button
          type="button"
          className="boolean-source-btn"
          disabled={disabled}
          title="Extract operand as a separate canvas layer"
          onClick={e => {
            e.stopPropagation()
            onExtract()
          }}
        >
          <Unlink size={11} />
          <span>EXTRACT</span>
        </button>
        {isCompound && onUnwrap && (
          <button
            type="button"
            className="boolean-source-btn"
            disabled={disabled}
            title="Unwrap nested compound into parent operands"
            onClick={e => {
              e.stopPropagation()
              onUnwrap()
            }}
          >
            <Layers size={11} />
            <span>UNWRAP</span>
          </button>
        )}
        {count > 2 && (
          <button
            type="button"
            className="boolean-source-btn is-delete"
            disabled={disabled}
            title="Remove operand from compound"
            onClick={e => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* If source is itself a nested compound, show operator switcher and child structure */}
      {isCompound && (
        <>
          {onChangeNestedOp && source.boolean && (
            <div className="boolean-nested-op-row">
              <span className="section-caption">NESTED OP</span>
              <div className="boolean-nested-op-buttons">
                {(['union', 'subtract', 'intersect', 'exclude'] as const).map(op => (
                  <button
                    key={op}
                    type="button"
                    className={`cag-tab-btn ${source.boolean!.operation === op ? 'active' : ''}`}
                    disabled={disabled}
                    onClick={() => onChangeNestedOp(op)}
                  >
                    {op.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="boolean-nested-list" aria-label="Nested compound operands">
            <span className="section-caption">
              NESTED {source.boolean!.operation.toUpperCase()} ({source.boolean!.operands.length} OPERANDS)
            </span>
            {source.boolean!.operands.map((sub, subIdx) => (
              <div key={sub.id} className="boolean-nested-row">
                <span>{sub.type === 'ellipse' ? '○' : sub.type === 'rectangle' ? '□' : '◇'}</span>
                <span>{sub.name}</span>
                <span className="boolean-nested-badge">
                  #{subIdx + 1} {sub.type}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="boolean-source-order">
        <span>
          Source {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
        </span>
        <button
          disabled={disabled || index === 0}
          aria-label={`Move ${source.name} source earlier`}
          title="Move earlier · First source is the subtraction base"
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          disabled={disabled || index === count - 1}
          aria-label={`Move ${source.name} source later`}
          title="Move later in source order"
          onClick={() => onMove(1)}
        >
          <ArrowDown size={12} />
        </button>
      </div>

      <div className="boolean-source-fields">
        {fields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              key={source[key]}
              aria-label={`${source.name} source ${label}`}
              disabled={disabled}
              type="number"
              step="any"
              min={key === 'width' || key === 'height' ? 0.01 : undefined}
              defaultValue={Number(source[key].toFixed(4))}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              onBlur={event => {
                const value = event.currentTarget.valueAsNumber
                if (
                  !Number.isFinite(value) ||
                  ((key === 'width' || key === 'height') && value <= 0)
                ) {
                  event.currentTarget.value = String(source[key])
                } else if (value !== source[key] && !onChange({ [key]: value })) {
                  event.currentTarget.value = String(source[key])
                }
              }}
            />
          </label>
        ))}
        {source.type === 'rectangle' && (
          <label>
            <span>Radius</span>
            <input
              key={source.cornerRadius}
              aria-label={`${source.name} source Radius`}
              disabled={disabled}
              type="number"
              min="0"
              step="any"
              defaultValue={source.cornerRadius}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              onBlur={event => {
                const value = event.currentTarget.valueAsNumber
                if (
                  !Number.isFinite(value) ||
                  value < 0 ||
                  !onChange({ cornerRadius: value })
                ) {
                  event.currentTarget.value = String(source.cornerRadius)
                }
              }}
            />
          </label>
        )}
      </div>

      {source.type === 'path' && !source.boolean && (
        <textarea
          key={source.d}
          aria-label={`${source.name} source SVG path data`}
          className="property-textarea property-mono"
          disabled={disabled}
          spellCheck={false}
          defaultValue={source.d}
          onBlur={event => {
            if (
              event.currentTarget.value !== source.d &&
              !onChange({ d: event.currentTarget.value })
            ) {
              event.currentTarget.value = source.d
            }
          }}
        />
      )}
    </details>
  )
}

export function BooleanBar({ store }: { store: SceneStore }) {
  const state = useScene(store, snapshot => snapshot)
  const { active } = useSyncExternalStore(
    store.subscribe,
    store.getHistorySnapshot,
    store.getHistorySnapshot
  )
  const [destructive, setDestructive] = useState(false)
  const [error, setError] = useState('')
  const storeHighlightedId = useSyncExternalStore(
    store.subscribeHighlightedBooleanSource,
    store.getHighlightedBooleanSource,
    store.getHighlightedBooleanSource
  )
  const selectedOperandInfo = useSyncExternalStore(
    store.subscribeSelectedCompoundOperand,
    store.getSelectedCompoundOperand,
    store.getSelectedCompoundOperand
  )
  const highlightedId = storeHighlightedId
  const setHighlightedId = (id: string | null) => store.highlightBooleanSource(id)
  const preview = useSyncExternalStore(
    store.subscribeBooleanPreview,
    store.getBooleanPreview,
    store.getBooleanPreview
  )
  const previewFrame = useRef<number | null>(null)

  const clearPreview = () => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null
    store.previewBoolean(null)
  }

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!store.getBooleanPreview() && previewFrame.current === null)) {
        return
      }
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
      previewFrame.current = null
      store.previewBoolean(null)
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', dismiss, true)
    return () => {
      window.removeEventListener('keydown', dismiss, true)
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
      store.previewBoolean(null)
    }
  }, [store])

  const selected =
    state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const compound = selected?.type === 'path' && selected.boolean ? selected : undefined

  if (state.selection.length < 2 && !compound) return null

  const reason = compound
    ? compound.component?.kind === 'instance'
      ? 'Detach the instance to edit its boolean sources.'
      : store.isLocked(compound.id)
        ? 'Unlock the compound to edit its sources.'
        : null
    : store.booleanSelectionReason()

  const disabled = !!reason || active

  const run = (work: () => unknown) => {
    try {
      work()
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The shapes could not be combined.')
      return false
    }
  }

  const showPreview = (operation: BooleanOperation) => {
    clearPreview()
    if (disabled) return
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null
      run(() => store.previewBoolean(operation))
    })
  }

  return (
    <div className="inspector-section boolean-section" data-testid="boolean-section">
      <div className="cag-badge-row">
        <span className="cag-engine-title">CAG GEOMETRY ENGINE</span>
        <span className="cag-engine-badge">{compound ? 'COMPOUND HIERARCHY' : 'LIVE 60FPS'}</span>
      </div>

      <div className="boolean-heading">
        <span className="section-caption">BOOLEAN</span>
        <span>{compound ? `${compound.boolean!.operands.length} sources` : 'Shape operations'}</span>
      </div>

      <div
        className="boolean-toolbar"
        role="toolbar"
        aria-label="Boolean path operations"
        onPointerLeave={clearPreview}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) clearPreview()
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            clearPreview()
            event.stopPropagation()
          }
        }}
      >
        {ACTIONS.map(({ operation, label, hint, symbol }) => (
          <button
            key={operation}
            aria-label={label}
            aria-pressed={compound ? compound.boolean!.operation === operation : undefined}
            data-preview={preview?.operation === operation || undefined}
            title={reason ?? `${label} (${symbol}) · ${hint}`}
            disabled={disabled}
            onPointerEnter={() => showPreview(operation)}
            onFocus={() => showPreview(operation)}
            onClick={() => {
              clearPreview()
              run(() =>
                compound
                  ? store.setBooleanOperation(compound.id, operation)
                  : store.booleanSelection(operation, destructive)
              )
            }}
          >
            <span className="boolean-symbol-badge">{symbol}</span>
            <BooleanIcon operation={operation} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {preview && (
        <p className="boolean-hover-hint" role="status">
          {ACTIONS.find(action => action.operation === preview.operation)!.label} preview{' '}
          <span>Click to apply · Esc to dismiss</span>
        </p>
      )}

      {compound ? (
        <>
          <CompoundPreview compound={compound} highlightedId={highlightedId} store={store} />
          <p className="boolean-hint">
            {reason ??
              `${ACTIONS.find(action => action.operation === compound.boolean!.operation)!.hint}. Sources remain editable.`}
          </p>

          <div className="boolean-sources" aria-label="Boolean source shapes">
            {compound.boolean!.operands.map((source, index, sources) => {
              const isSelected =
                selectedOperandInfo?.compoundId === compound.id &&
                selectedOperandInfo?.operandId === source.id
              const isMuted = compound.boolean!.mutedOperandIds?.includes(source.id) ?? false
              return (
                <SourceEditor
                  key={source.id}
                  source={source}
                  index={index}
                  count={sources.length}
                  subtract={compound.boolean!.operation === 'subtract'}
                  disabled={disabled}
                  isSelected={isSelected}
                  muted={isMuted}
                  onHighlight={setHighlightedId}
                  onSelect={() => {
                    store.setSelectedCompoundOperand({ compoundId: compound.id, operandId: source.id })
                    store.highlightBooleanSource(source.id)
                  }}
                  onToggleMute={() => run(() => store.toggleBooleanOperandMute(compound.id, source.id))}
                  onDuplicate={() => run(() => store.duplicateBooleanOperand(compound.id, source.id))}
                  onExtract={() => run(() => store.extractBooleanOperand(compound.id, source.id))}
                  onRemove={() => run(() => store.removeBooleanOperand(compound.id, source.id))}
                  onEditAnchors={() => {
                    store.setSelectedCompoundOperand({ compoundId: compound.id, operandId: source.id })
                    store.setPathEditingTarget({ id: compound.id, operandId: source.id })
                  }}
                  onUnwrap={
                    source.type === 'path' && source.boolean
                      ? () => run(() => store.unwrapNestedBoolean(compound.id, source.id))
                      : undefined
                  }
                  onChangeNestedOp={
                    source.type === 'path' && source.boolean
                      ? op => run(() => store.setNestedBooleanOperation(compound.id, source.id, op))
                      : undefined
                  }
                  onChange={patch => run(() => store.updateBooleanOperand(compound.id, source.id, patch))}
                  onMove={direction =>
                    run(() => {
                      const order = sources.map(operand => operand.id)
                      const target = index + direction
                      if (target < 0 || target >= order.length) return
                      ;[order[index], order[target]] = [order[target], order[index]]
                      store.reorderBooleanOperands(compound.id, order)
                    })
                  }
                />
              )
            })}
          </div>

          <div className="boolean-footer">
            <button
              disabled={disabled || !!compound.mask}
              title={
                compound.mask
                  ? 'Release the mask before restoring its source layers'
                  : 'Restore editable source layers at the compound’s current transform'
              }
              onClick={() => run(() => store.releaseBoolean(compound.id))}
            >
              Release sources
            </button>
            <button
              disabled={disabled}
              title="Replace this compound with its merged vector outline"
              onClick={() => run(() => store.flattenBoolean(compound.id))}
            >
              Flatten path
            </button>
            <button
              disabled={disabled}
              title="Invert the boolean operation (e.g. Union <-> Exclude, or swap base/cutter for Subtract)"
              onClick={() => run(() => store.invertBooleanOperation(compound.id))}
            >
              Invert op
            </button>
            <button
              disabled={disabled}
              title="Revert all nested compound operations back to original independent leaf shapes"
              onClick={() => run(() => store.revertCompound(compound.id))}
            >
              Revert tree
            </button>
          </div>

          {!compound.d && (
            <p className="boolean-hint">The result is empty. Edit a source or change the operation.</p>
          )}

          {selected && (selected.style.stroke?.width ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="boolean-source-btn"
                style={{ width: '100%', justifyContent: 'center', padding: '6px 8px' }}
                title="Expand stroke into a filled outline vector path"
                onClick={() => run(() => store.expandOutline(selected.id))}
              >
                <PenTool size={11} />
                <span>Expand Stroke Outline</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="boolean-mode">
            <input
              type="checkbox"
              aria-label="Flatten result"
              checked={destructive}
              onChange={event => setDestructive(event.currentTarget.checked)}
            />
            <span>Flatten result</span>
            <span>{destructive ? 'Merged path' : 'Editable compound'}</span>
          </label>
          <p className="boolean-hint">
            {reason ??
              (destructive
                ? 'Replace selected shapes with a single vector path.'
                : 'Keep source shapes editable inside a compound.')}
          </p>
          {selected && !compound && (selected.style.stroke?.width ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="boolean-source-btn"
                style={{ width: '100%', justifyContent: 'center', padding: '6px 8px' }}
                title="Expand stroke into a filled outline vector path"
                onClick={() => run(() => store.expandOutline(selected.id))}
              >
                <PenTool size={11} />
                <span>Expand Stroke Outline</span>
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="boolean-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
