import { useState, useMemo } from 'react'
import {
  Grid,
  Plus,
  Trash2,
  RotateCcw,
  Sparkles,
  Upload,
  LayoutGrid,
  Check,
  Layers,
} from 'lucide-react'
import type { SceneStore } from './store.ts'
import type { VariantDimension, SceneElement } from './types.ts'

export function ComponentVariantMatrixEditor({
  store,
  master,
  disabled,
}: {
  store: SceneStore
  master: SceneElement
  disabled: boolean
}) {
  const [addingDim, setAddingDim] = useState(false)
  const [newDimName, setNewDimName] = useState('')
  const [newDimValues, setNewDimValues] = useState('sm, md, lg')
  const [error, setError] = useState('')

  if (master.component?.kind !== 'master') return null

  const matrix = master.component.variantMatrix
  const dimensions = matrix?.dimensions ?? []
  const combinations = matrix?.combinations ?? []
  const instances = Object.values(store.getSnapshot().elements).filter(
    layer => layer.component?.kind === 'instance' && layer.component.masterId === master.id && layer.component.instanceId === layer.id
  ).length

  const perform = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update variant matrix')
    }
  }

  // Compute all potential combinations across current dimensions (Cartesian product)
  const allCombinations = useMemo(() => {
    if (!dimensions.length) return []
    let result: Record<string, string>[] = [{}]
    for (const dim of dimensions) {
      const next: Record<string, string>[] = []
      for (const current of result) {
        for (const val of dim.values) {
          next.push({ ...current, [dim.name]: val })
        }
      }
      result = next
    }
    return result
  }, [dimensions])

  const handleAddDimension = () => {
    perform(() => {
      const values = newDimValues
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
      if (!values.length) throw new Error('Enter at least one dimension value')
      store.addVariantDimension(master.id, {
        name: newDimName,
        values,
      })
      setAddingDim(false)
      setNewDimName('')
      setNewDimValues('')
    })
  }

  const handleAddValueToDim = (dim: VariantDimension, newVal: string) => {
    const trimmed = newVal.trim()
    if (!trimmed || dim.values.includes(trimmed)) return
    perform(() => {
      store.updateVariantDimension(master.id, dim.id, {
        values: [...dim.values, trimmed],
      })
    })
  }

  const handleRemoveDim = (dimId: string) => {
    perform(() => {
      store.removeVariantDimension(master.id, dimId)
    })
  }

  const handleCaptureCombination = (combDims: Record<string, string>) => {
    perform(() => {
      store.captureVariantCombination(master.id, combDims)
    })
  }

  const handleClearCombination = (combId: string) => {
    perform(() => {
      store.clearVariantCombination(master.id, combId)
    })
  }

  const handleApplyPreset = (preset: 'size' | 'state' | 'theme' | 'full-matrix') => {
    perform(() => {
      store.applyVariantMatrixPreset(master.id, preset)
    })
  }

  const handleGenerateOnCanvas = () => {
    perform(() => {
      store.generateVariantMatrixOnCanvas(master.id)
    })
  }

  return (
    <div className="component-variant-matrix-section" data-testid="component-variant-matrix-editor">
      <div className="component-section-heading">
        <div className="variant-matrix-heading-left">
          <Grid size={13} />
          <span className="section-caption">VARIANT MATRIX</span>
          {dimensions.length > 0 && (
            <span className="matrix-count-badge">
              {dimensions.length}D · {allCombinations.length} combinations
            </span>
          )}
        </div>
        <div className="component-heading-actions">
          {dimensions.length > 0 && (
            <button
              className="quiet-button matrix-generate-btn"
              disabled={disabled}
              title="Generate 2D matrix grid of instances on canvas (aligned to 120px grid)"
              aria-label="Generate matrix on canvas"
              onClick={handleGenerateOnCanvas}
            >
              <LayoutGrid size={13} />
              <span>Canvas Grid</span>
            </button>
          )}
          <button
            className="quiet-button"
            disabled={disabled}
            title="Add variant dimension"
            aria-label="Add variant dimension"
            onClick={() => setAddingDim(v => !v)}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Preset Dimensions Quick Launcher */}
      <div className="variant-matrix-presets">
        <span className="presets-label">Presets:</span>
        <button
          className="preset-btn"
          disabled={disabled}
          title="Add Size dimension (sm, md, lg)"
          onClick={() => handleApplyPreset('size')}
        >
          + Size
        </button>
        <button
          className="preset-btn"
          disabled={disabled}
          title="Add State dimension (default, hover, pressed, active, disabled)"
          onClick={() => handleApplyPreset('state')}
        >
          + State
        </button>
        <button
          className="preset-btn"
          disabled={disabled}
          title="Add Theme dimension (paper, dark, accent, contrast)"
          onClick={() => handleApplyPreset('theme')}
        >
          + Theme
        </button>
        <button
          className="preset-btn primary-preset"
          disabled={disabled}
          title="Generate Full 3×3 Matrix (Size × State × Theme)"
          onClick={() => handleApplyPreset('full-matrix')}
        >
          <Sparkles size={10} />
          <span>Full Matrix</span>
        </button>
      </div>

      {dimensions.length === 0 && (
        <div className="variant-matrix-empty">
          <p>
            Master component has no multi-dimensional variants defined.
            Add dimensions like <strong>Size</strong>, <strong>State</strong>, or <strong>Theme</strong> to generate a multi-variant design matrix.
          </p>
        </div>
      )}

      {/* Dimensions List */}
      {dimensions.length > 0 && (
        <div className="variant-dimensions-list">
          {dimensions.map(dim => (
            <div key={dim.id} className="variant-dimension-card">
              <div className="variant-dimension-header">
                <span className="dimension-name">
                  <strong>{dim.name}</strong>
                  <span className="dimension-count">({dim.values.length})</span>
                </span>
                <div className="dimension-actions">
                  <span className="dimension-default-hint">default: {dim.defaultValue}</span>
                  <button
                    className="quiet-button"
                    disabled={disabled}
                    aria-label={`Remove ${dim.name} dimension`}
                    title={`Remove ${dim.name} dimension`}
                    onClick={() => handleRemoveDim(dim.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Values Chips */}
              <div className="dimension-values-row">
                {dim.values.map(val => {
                  const isDefault = val === dim.defaultValue
                  return (
                    <span
                      key={val}
                      className={`dimension-val-chip ${isDefault ? 'is-default' : ''}`}
                      title={isDefault ? 'Default value' : `Value: ${val}`}
                    >
                      {isDefault && <Check size={9} />}
                      <span>{val}</span>
                    </span>
                  )
                })}
                <input
                  className="add-dim-val-input"
                  placeholder="+ val"
                  aria-label={`Add value to ${dim.name}`}
                  disabled={disabled}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddValueToDim(dim, e.currentTarget.value)
                      e.currentTarget.value = ''
                    }
                  }}
                  onBlur={e => {
                    if (e.currentTarget.value.trim()) {
                      handleAddValueToDim(dim, e.currentTarget.value)
                      e.currentTarget.value = ''
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Dimension Form */}
      {addingDim && (
        <form
          className="component-property-form variant-add-dim-form"
          onSubmit={e => {
            e.preventDefault()
            handleAddDimension()
          }}
        >
          <input
            className="property-input"
            autoFocus
            aria-label="Dimension name"
            placeholder="Dimension name (e.g. Size, State, Theme, Orientation)"
            required
            value={newDimName}
            onChange={e => setNewDimName(e.currentTarget.value)}
          />
          <input
            className="property-input"
            aria-label="Dimension values"
            placeholder="Comma-separated values (e.g. sm, md, lg)"
            required
            value={newDimValues}
            onChange={e => setNewDimValues(e.currentTarget.value)}
          />
          <div className="add-dim-form-actions">
            <button className="component-action primary" disabled={disabled} type="submit">
              <Plus size={12} />
              Add Dimension
            </button>
            <button
              className="component-action"
              type="button"
              onClick={() => setAddingDim(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Combinations Matrix Grid & Live Capture Table */}
      {dimensions.length > 0 && (
        <div className="variant-combinations-table-container">
          <div className="combinations-header">
            <span className="combinations-title">
              <Layers size={11} />
              <span>COMBINATION CELLS</span>
            </span>
            <span className="combinations-stat">
              {combinations.length} of {allCombinations.length} customized
            </span>
          </div>

          <div className="combinations-scroll-list">
            {allCombinations.slice(0, 36).map((combDims, index) => {
              const matchedComb = combinations.find(c =>
                Object.keys(combDims).every(k => c.dimensions[k] === combDims[k])
              )
              const isCaptured = Boolean(matchedComb && Object.keys(matchedComb.layers).length > 0)
              const capturedCount = matchedComb ? Object.keys(matchedComb.layers).length : 0
              const combKey = Object.entries(combDims).map(([k, v]) => `${k}:${v}`).join('·')

              return (
                <div
                  key={combKey}
                  className={`combination-row ${isCaptured ? 'is-captured' : ''}`}
                >
                  <div className="combination-dims-cell">
                    <span className="combination-index">#{index + 1}</span>
                    <div className="combination-dim-tags">
                      {Object.entries(combDims).map(([dimName, dimVal]) => (
                        <span key={dimName} className="comb-tag">
                          <span className="tag-dim">{dimName}:</span>
                          <span className="tag-val">{dimVal}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="combination-status-cell">
                    {isCaptured ? (
                      <span className="status-badge captured" title={`${capturedCount} layers captured`}>
                        <span className="status-dot" />
                        {capturedCount}L
                      </span>
                    ) : (
                      <span className="status-badge master" title="Inherits live master component">
                        Master
                      </span>
                    )}
                  </div>

                  <div className="combination-actions-cell">
                    <button
                      className="quiet-button capture-btn"
                      disabled={disabled}
                      title="Snapshot master canvas appearance into this variant cell"
                      aria-label={`Capture ${combKey}`}
                      onClick={() => handleCaptureCombination(combDims)}
                    >
                      <Upload size={11} />
                      <span>{isCaptured ? 'Update' : 'Capture'}</span>
                    </button>
                    {isCaptured && matchedComb && (
                      <button
                        className="quiet-button clear-btn"
                        disabled={disabled}
                        title="Reset to live master inheritance"
                        aria-label={`Clear ${combKey}`}
                        onClick={() => handleClearCombination(matchedComb.id)}
                      >
                        <RotateCcw size={11} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {allCombinations.length > 36 && (
              <div className="combinations-overflow-hint">
                + {allCombinations.length - 36} more combinations in matrix
              </div>
            )}
          </div>

          <div className="variant-matrix-footer">
            <span>{instances} instances linked in document — changes propagate live</span>
          </div>
        </div>
      )}

      {error && (
        <p className="component-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
