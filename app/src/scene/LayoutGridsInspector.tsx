import { memo } from 'react'
import { Columns, Eye, EyeOff, Grid, Plus, Rows, Trash2 } from 'lucide-react'
import type { FrameElement, FrameLayoutGrid, LayoutGridAlignment, LayoutGridType } from './types'
import type { SceneStore } from './store'
import './constraints.css'

interface Props {
  node: FrameElement
  store: SceneStore
}

export const LayoutGridsInspector = memo(function LayoutGridsInspector({ node, store }: Props) {
  const grids = node.layoutGrids ?? []

  const addGrid = () => {
    store.addFrameLayoutGrid(node.id, 'columns')
  }

  const updateGrid = (gridId: string, patch: Partial<FrameLayoutGrid>) => {
    store.updateFrameLayoutGrid(node.id, gridId, patch)
  }

  const removeGrid = (gridId: string) => {
    store.removeFrameLayoutGrid(node.id, gridId)
  }

  const toggleVisibility = (gridId: string) => {
    store.toggleFrameLayoutGridVisibility(node.id, gridId)
  }

  return (
    <div className="inspector-section layout-grids-section" data-testid="layout-grids-inspector">
      <div className="property-heading">
        <span className="property-heading-title">Layout Grids</span>
        <div className="property-heading-actions">
          <button
            type="button"
            className="quiet-button paint-toggle"
            aria-label="Add layout grid"
            title="Add column, row, or modular layout grid"
            onClick={addGrid}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {grids.length === 0 ? (
        <p className="layout-hint">Add columns, rows, or modular grid snapping to this frame.</p>
      ) : (
        grids.map(grid => (
          <div key={grid.id} className="layout-grid-item" data-testid={`layout-grid-item-${grid.id}`}>
            {/* Header */}
            <div className="layout-grid-item-header">
              {grid.type === 'columns' ? (
                <Columns size={13} style={{ color: '#81adec', flexShrink: 0 }} />
              ) : grid.type === 'rows' ? (
                <Rows size={13} style={{ color: '#81adec', flexShrink: 0 }} />
              ) : (
                <Grid size={13} style={{ color: '#81adec', flexShrink: 0 }} />
              )}

              <select
                aria-label="Layout grid type"
                value={grid.type}
                onChange={event => {
                  const nextType = event.currentTarget.value as LayoutGridType
                  if (nextType === 'columns') {
                    updateGrid(grid.id, {
                      type: 'columns',
                      count: grid.count ?? 12,
                      gutter: grid.gutter ?? 20,
                      margin: grid.margin ?? 32,
                      alignment: 'stretch',
                    })
                  } else if (nextType === 'rows') {
                    updateGrid(grid.id, {
                      type: 'rows',
                      count: grid.count ?? 8,
                      gutter: grid.gutter ?? 20,
                      margin: grid.margin ?? 24,
                      alignment: 'stretch',
                    })
                  } else if (nextType === 'grid') {
                    updateGrid(grid.id, {
                      type: 'grid',
                      sectionSize: grid.sectionSize ?? 120,
                    })
                  }
                }}
              >
                <option value="columns">Columns</option>
                <option value="rows">Rows</option>
                <option value="grid">Grid</option>
              </select>

              <div className="layout-grid-item-actions">
                <button
                  type="button"
                  className="quiet-button"
                  aria-label={grid.visible ? 'Hide layout grid' : 'Show layout grid'}
                  title={grid.visible ? 'Hide layout grid' : 'Show layout grid'}
                  onClick={() => toggleVisibility(grid.id)}
                >
                  {grid.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  aria-label="Remove layout grid"
                  title="Remove layout grid"
                  onClick={() => removeGrid(grid.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Parameters */}
            <div className="layout-grid-params">
              {grid.type === 'columns' && (
                <>
                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Count</span>
                      <input
                        type="number"
                        aria-label="Column count"
                        min={1}
                        max={144}
                        defaultValue={grid.count ?? 12}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 1) updateGrid(grid.id, { count: Math.floor(val) })
                        }}
                      />
                    </label>
                    <label className="layout-grid-field">
                      <span>Color</span>
                      <input
                        type="color"
                        aria-label="Column grid color"
                        defaultValue={grid.color.startsWith('#') ? grid.color : '#81adec'}
                        onChange={event => updateGrid(grid.id, { color: event.currentTarget.value + '22' })}
                      />
                    </label>
                  </div>

                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Align</span>
                      <select
                        aria-label="Column alignment"
                        value={grid.alignment ?? 'stretch'}
                        onChange={event => updateGrid(grid.id, { alignment: event.currentTarget.value as LayoutGridAlignment })}
                      >
                        <option value="stretch">Stretch</option>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label className="layout-grid-field">
                      <span>Gutter</span>
                      <input
                        type="number"
                        aria-label="Column gutter"
                        min={0}
                        defaultValue={grid.gutter ?? 20}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 0) updateGrid(grid.id, { gutter: val })
                        }}
                      />
                    </label>
                  </div>

                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Margin</span>
                      <input
                        type="number"
                        aria-label="Column margin"
                        min={0}
                        defaultValue={grid.margin ?? 32}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 0) updateGrid(grid.id, { margin: val })
                        }}
                      />
                    </label>
                    {grid.alignment !== 'stretch' && (
                      <label className="layout-grid-field">
                        <span>Width</span>
                        <input
                          type="number"
                          aria-label="Column width"
                          min={1}
                          defaultValue={grid.size ?? 60}
                          onBlur={event => {
                            const val = event.currentTarget.valueAsNumber
                            if (Number.isFinite(val) && val >= 1) updateGrid(grid.id, { size: val })
                          }}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}

              {grid.type === 'rows' && (
                <>
                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Count</span>
                      <input
                        type="number"
                        aria-label="Row count"
                        min={1}
                        max={144}
                        defaultValue={grid.count ?? 8}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 1) updateGrid(grid.id, { count: Math.floor(val) })
                        }}
                      />
                    </label>
                    <label className="layout-grid-field">
                      <span>Color</span>
                      <input
                        type="color"
                        aria-label="Row grid color"
                        defaultValue={grid.color.startsWith('#') ? grid.color : '#81adec'}
                        onChange={event => updateGrid(grid.id, { color: event.currentTarget.value + '22' })}
                      />
                    </label>
                  </div>

                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Align</span>
                      <select
                        aria-label="Row alignment"
                        value={grid.alignment ?? 'stretch'}
                        onChange={event => updateGrid(grid.id, { alignment: event.currentTarget.value as LayoutGridAlignment })}
                      >
                        <option value="stretch">Stretch</option>
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>
                    <label className="layout-grid-field">
                      <span>Gutter</span>
                      <input
                        type="number"
                        aria-label="Row gutter"
                        min={0}
                        defaultValue={grid.gutter ?? 20}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 0) updateGrid(grid.id, { gutter: val })
                        }}
                      />
                    </label>
                  </div>

                  <div className="layout-grid-row">
                    <label className="layout-grid-field">
                      <span>Margin</span>
                      <input
                        type="number"
                        aria-label="Row margin"
                        min={0}
                        defaultValue={grid.margin ?? 24}
                        onBlur={event => {
                          const val = event.currentTarget.valueAsNumber
                          if (Number.isFinite(val) && val >= 0) updateGrid(grid.id, { margin: val })
                        }}
                      />
                    </label>
                    {grid.alignment !== 'stretch' && (
                      <label className="layout-grid-field">
                        <span>Height</span>
                        <input
                          type="number"
                          aria-label="Row height"
                          min={1}
                          defaultValue={grid.size ?? 60}
                          onBlur={event => {
                            const val = event.currentTarget.valueAsNumber
                            if (Number.isFinite(val) && val >= 1) updateGrid(grid.id, { size: val })
                          }}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}

              {grid.type === 'grid' && (
                <div className="layout-grid-row">
                  <label className="layout-grid-field">
                    <span>Size</span>
                    <input
                      type="number"
                      aria-label="Grid section size"
                      min={8}
                      step={8}
                      defaultValue={grid.sectionSize ?? 120}
                      onBlur={event => {
                        const val = event.currentTarget.valueAsNumber
                        if (Number.isFinite(val) && val >= 8) updateGrid(grid.id, { sectionSize: val })
                      }}
                    />
                  </label>
                  <label className="layout-grid-field">
                    <span>Color</span>
                    <input
                      type="color"
                      aria-label="Grid color"
                      defaultValue={grid.color.startsWith('#') ? grid.color : '#81adec'}
                      onChange={event => updateGrid(grid.id, { color: event.currentTarget.value + '22' })}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
})
