import { useState, useSyncExternalStore } from 'react'
import { Scan, ScanLine, Eye, Sun, Sparkles, Scissors } from 'lucide-react'
import type { SceneStore } from './store'
import { useScene } from './useScene'
import { canMask, isCompoundMask } from './maskGeometry'
import type { BooleanOperation, MaskClipMode } from './types'
import './mask.css'

const MASK_MODES: readonly { mode: MaskClipMode; label: string; icon: typeof Scan; desc: string }[] = [
  { mode: 'vector', label: 'Vector', icon: Scissors, desc: 'Crisp vector clipping outline' },
  { mode: 'alpha', label: 'Alpha', icon: Sparkles, desc: 'Alpha channel & transparency mask' },
  { mode: 'luminance', label: 'Luminance', icon: Sun, desc: 'Brightness & gradient luminance mask' },
]

const COMPOUND_OPS: readonly { op: BooleanOperation; label: string }[] = [
  { op: 'subtract', label: 'Subtract' },
  { op: 'union', label: 'Union' },
  { op: 'intersect', label: 'Intersect' },
  { op: 'exclude', label: 'Exclude' },
]

const THRESHOLD_PRESETS = [0.1, 0.25, 0.5, 0.75, 0.9]

export function MaskInspector({ store }: { store: SceneStore }) {
  const state = useScene(store, snapshot => snapshot)
  const { active } = useSyncExternalStore(store.subscribe, store.getHistorySnapshot, store.getHistorySnapshot)
  const [error, setError] = useState('')
  const node = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const source = node?.mask ? node : node?.type === 'frame' ? node.children.map(id => state.elements[id]).find(child => child?.mask) : undefined
  const reason = state.selection.length > 1 ? store.maskSelectionReason() : null
  const compoundReason = state.selection.length > 1 ? store.compoundMaskSelectionReason() : null

  if (state.selection.length < 2 && !source && (!node || !canMask(node))) return null

  const run = (work: () => unknown) => {
    try {
      work()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the mask.')
    }
  }

  const disabled = active || !!(source?.component?.kind === 'instance') || !!(source && store.isLocked(source.id))
  const currentMode: MaskClipMode = source?.mask?.mode ?? 'vector'
  const isIsolated = Boolean(source?.mask?.isolated)
  const threshold = source?.mask?.luminanceThreshold ?? 0.5
  const isCompound = source && canMask(source) ? isCompoundMask(source) : false
  const compoundOp = source?.type === 'path' && source.boolean ? source.boolean.operation : 'subtract'

  return (
    <div className="inspector-section mask-section" data-testid="mask-section">
      <div className="mask-heading">
        <span className="section-caption">COMPOUND & ALPHA/LUMINANCE MASK</span>
        <Scan size={13} />
      </div>

      {source ? (
        <>
          <button className="mask-source-select" onClick={() => store.select([source.id])} title="Select mask source shape">
            <ScanLine size={13} />
            <span>{source.name}</span>
            <span>{isCompound ? `${compoundOp.toUpperCase()} COMPOUND` : 'SOURCE'}</span>
          </button>

          {/* Mask Clip Mode Selector */}
          <div className="setting-group">
            <div className="setting-row">
              <span className="setting-label">Clipping mode</span>
              <div className="mask-mode-pills" role="radiogroup" aria-label="Mask mode">
                {MASK_MODES.map(({ mode, label, icon: Icon, desc }) => (
                  <button
                    key={mode}
                    type="button"
                    className={`mask-mode-pill ${currentMode === mode ? 'active' : ''}`}
                    disabled={disabled}
                    onClick={() => run(() => store.setMaskMode(source.id, mode))}
                    title={desc}
                    role="radio"
                    aria-checked={currentMode === mode}
                  >
                    <Icon size={11} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Invert Mask Toggle */}
          <div className="setting-row">
            <span>Invert mask</span>
            <button
              className={`grid-switch ${source.mask!.inverted ? 'on' : ''}`}
              role="switch"
              aria-label="Invert mask"
              aria-checked={Boolean(source.mask!.inverted)}
              disabled={disabled}
              onClick={() => run(() => store.setMaskInverted(source.id, !source.mask!.inverted))}
            >
              <span />
            </button>
          </div>

          {/* Luminance Threshold Controls (for luminance mode) */}
          {currentMode === 'luminance' && (
            <div className="mask-luminance-panel">
              <div className="setting-row">
                <span className="setting-label">Threshold</span>
                <span className="setting-val-mono">{Math.round(threshold * 100)}%</span>
              </div>
              <div className="mask-slider-row">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  className="mask-range-slider"
                  value={threshold}
                  disabled={disabled}
                  onChange={e => run(() => store.setMaskLuminanceThreshold(source.id, parseFloat(e.target.value)))}
                />
              </div>
              <div className="mask-preset-chips">
                {THRESHOLD_PRESETS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`mask-chip ${Math.abs(threshold - p) < 0.02 ? 'active' : ''}`}
                    disabled={disabled}
                    onClick={() => run(() => store.setMaskLuminanceThreshold(source.id, p))}
                  >
                    {Math.round(p * 100)}%
                  </button>
                ))}
              </div>
              <p className="mask-hint">
                {source.style.gradient?.stops && source.style.gradient.stops.length >= 2
                  ? 'Multi-stop gradient provides smooth continuous luminance falloff.'
                  : 'White = visible, Black = clipped. Threshold controls cutoff.'}
              </p>
            </div>
          )}

          {/* Compound Mask Boolean Operations */}
          {isCompound && (
            <div className="mask-compound-panel">
              <div className="setting-row">
                <span className="setting-label">Compound operation</span>
                <div className="compound-btn-group" role="group" aria-label="Compound operation">
                  {COMPOUND_OPS.map(({ op, label }) => (
                    <button
                      key={op}
                      type="button"
                      className={`compound-btn ${compoundOp === op ? 'active' : ''}`}
                      disabled={disabled}
                      onClick={() => run(() => store.setCompoundMaskOperation(source.id, op))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Interactive On-Canvas Mask Isolation Button */}
          <button
            type="button"
            className={`mask-action isolation-btn ${isIsolated ? 'is-isolated' : ''}`}
            disabled={disabled}
            onClick={() => run(() => store.setMaskIsolated(source.id, !isIsolated))}
            title={isIsolated ? 'Exit mask isolation view' : 'Isolate mask stencil on canvas'}
          >
            <Eye size={12} />
            <span>{isIsolated ? 'Exit Mask Isolation' : 'Isolate Mask on Canvas'}</span>
            {isIsolated && <span className="mask-isolated-badge">Active</span>}
          </button>

          {/* Standard Switches */}
          <div className="setting-row">
            <span>Clip nested layers</span>
            <button
              className={`grid-switch ${source.mask!.enabled ? 'on' : ''}`}
              role="switch"
              aria-label="Enable vector mask"
              aria-checked={source.mask!.enabled}
              disabled={disabled}
              onClick={() => run(() => store.setMask(source.id, !source.mask!.enabled))}
            >
              <span />
            </button>
          </div>

          <div className="setting-row">
            <span>Show mask outline</span>
            <button
              className={`grid-switch ${source.mask!.showOutline ? 'on' : ''}`}
              role="switch"
              aria-label="Show mask outline"
              aria-checked={source.mask!.showOutline}
              disabled={disabled}
              onClick={() => run(() => store.setMaskOutline(source.id, !source.mask!.showOutline))}
            >
              <span />
            </button>
          </div>

          <p className="mask-hint">
            {source.component?.kind === 'instance'
              ? 'Detach the instance to change its mask.'
              : isIsolated
              ? 'Mask stencil is isolated on canvas. Adjust geometry or gradient directly.'
              : 'Edit the source shape to update the non-destructive clip.'}
          </p>

          <button className="mask-action" disabled={disabled} onClick={() => run(() => store.setMask(source.id, null))}>
            Release mask
          </button>
        </>
      ) : (
        <>
          <button
            className="mask-action"
            disabled={active || !!reason || !!(node && (store.isLocked(node.id) || node.component?.kind === 'instance'))}
            onClick={() => run(() => (state.selection.length > 1 ? store.maskSelection() : node && store.setMask(node.id, true)))}
          >
            <Scan size={13} />
            {state.selection.length > 1 ? 'Use top layer as mask' : 'Use as mask'}
          </button>

          {state.selection.length > 1 && !compoundReason && (
            <div className="compound-creation-group">
              <span className="compound-creation-label">Create compound mask:</span>
              <div className="compound-btn-group">
                <button
                  type="button"
                  className="compound-btn"
                  onClick={() => run(() => store.createCompoundMask('subtract'))}
                  title="Subtract top shapes from base mask shape"
                >
                  Subtract
                </button>
                <button
                  type="button"
                  className="compound-btn"
                  onClick={() => run(() => store.createCompoundMask('union'))}
                  title="Combine shapes into compound union mask"
                >
                  Union
                </button>
                <button
                  type="button"
                  className="compound-btn"
                  onClick={() => run(() => store.createCompoundMask('intersect'))}
                  title="Intersect shapes for compound mask"
                >
                  Intersect
                </button>
                <button
                  type="button"
                  className="compound-btn"
                  onClick={() => store.createCompoundMask('exclude')}
                  title="Exclude overlapping shapes for compound mask"
                >
                  Exclude
                </button>
              </div>
            </div>
          )}

          <p className="mask-hint">
            {reason ??
              (state.selection.length > 1
                ? 'Group selected layers and clip them non-destructively with the top shape.'
                : node?.parentId
                ? 'Clip sibling layers with this shape or frame.'
                : 'Assign a mask role, then place inside a frame to clip its layers.')}
          </p>
        </>
      )}

      {error && (
        <p className="mask-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
