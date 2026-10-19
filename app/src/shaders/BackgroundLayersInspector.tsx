import { ArrowDown, ArrowUp, Copy, Layers, Plus, Trash2, Waves } from 'lucide-react'
import { useState } from 'react'
import type { SceneStore } from '../scene/store'
import type { ShaderPaint, ShaderBlendMode } from './types'
import { shaderBlendModes } from './types'
import { createShader, shaderCatalog } from './catalog'
import { ShaderInspector } from './ShaderInspector'
import './shaders.css'

export function BackgroundLayersInspector({
  store,
  onGestureStart,
  onGestureEnd,
  onBrowse,
}: {
  store: SceneStore
  onGestureStart?: () => boolean | void
  onGestureEnd?: (cancel: boolean) => void
  onBrowse?: () => void
}) {
  const snapshot = store.getSnapshot()
  const backgroundShader = snapshot.backgroundShader
  const backgroundLayers = snapshot.backgroundLayers
  const layers: readonly ShaderPaint[] = (backgroundLayers && backgroundLayers.length > 0)
    ? backgroundLayers
    : (backgroundShader ? [backgroundShader] : [])

  const [activeLayerIndex, setActiveLayerIndex] = useState(0)
  const safeActiveIndex = Math.min(Math.max(0, activeLayerIndex), Math.max(0, layers.length - 1))
  const activeLayer = layers[safeActiveIndex] ?? null

  const handleUpdateActiveLayer = (updated: ShaderPaint | null) => {
    if (updated === null) {
      if (layers.length <= 1) {
        store.setBackgroundShader(null)
      } else {
        store.removeBackgroundLayer(safeActiveIndex)
      }
    } else {
      if (layers.length <= 1 && (!backgroundLayers || backgroundLayers.length === 0)) {
        store.setBackgroundShader(updated)
      } else {
        store.updateBackgroundLayer(safeActiveIndex, updated)
      }
    }
  }

  const handleAddLayer = (kind: 'mesh-gradient' | 'procedural-noise' | string) => {
    const newPaint = createShader(kind as any)
    store.addBackgroundLayer(newPaint)
    setActiveLayerIndex(layers.length)
  }

  const handleDuplicateLayer = (index: number) => {
    const target = layers[index]
    if (!target) return
    const duplicated = JSON.parse(JSON.stringify(target)) as ShaderPaint
    store.addBackgroundLayer(duplicated)
    setActiveLayerIndex(layers.length)
  }

  const handleRemoveLayer = (index: number) => {
    if (layers.length <= 1) {
      store.setBackgroundShader(null)
    } else {
      store.removeBackgroundLayer(index)
      setActiveLayerIndex(Math.max(0, index - 1))
    }
  }

  const handleMoveUp = (index: number) => {
    if (index <= 0) return
    store.reorderBackgroundLayer(index, index - 1)
    setActiveLayerIndex(index - 1)
  }

  const handleMoveDown = (index: number) => {
    if (index >= layers.length - 1) return
    store.reorderBackgroundLayer(index, index + 1)
    setActiveLayerIndex(index + 1)
  }

  const handleLayerBlendMode = (index: number, blendMode: ShaderBlendMode) => {
    const target = layers[index]
    if (!target) return
    const next: ShaderPaint = {
      ...target,
      composite: {
        blendMode,
        opacity: target.composite?.opacity ?? 1,
      },
    }
    store.updateBackgroundLayer(index, next)
  }

  const handleLayerOpacity = (index: number, opacity: number) => {
    const target = layers[index]
    if (!target) return
    const next: ShaderPaint = {
      ...target,
      composite: {
        blendMode: target.composite?.blendMode ?? 'normal',
        opacity: Math.max(0, Math.min(1, opacity)),
      },
    }
    store.updateBackgroundLayer(index, next)
  }

  return (
    <div className="background-layers-inspector" role="region" aria-label="Canvas Background Layers">
      <div className="inspector-section shader-section">
        <div className="shader-heading">
          <span className="section-caption">CANVAS BACKGROUND LAYERS</span>
          <span className="shader-engine-mark">{layers.length} LAYER{layers.length !== 1 ? 'S' : ''}</span>
        </div>

        {/* Layer Stack Items */}
        {layers.length > 0 ? (
          <div className="bg-layers-list" role="list" aria-label="Background layer stack">
            {layers.map((layer, index) => {
              const isActive = index === safeActiveIndex
              const def = shaderCatalog[layer.kind]
              const blendMode = layer.composite?.blendMode ?? 'normal'
              const opacity = layer.composite?.opacity ?? 1

              return (
                <div
                  key={`bg-layer-item-${index}`}
                  className={`bg-layer-card ${isActive ? 'active' : ''}`}
                  role="listitem"
                  onClick={() => setActiveLayerIndex(index)}
                >
                  <div className="bg-layer-header">
                    <button
                      type="button"
                      className="bg-layer-select-btn"
                      aria-pressed={isActive}
                      onClick={() => setActiveLayerIndex(index)}
                    >
                      <Layers size={12} />
                      <span className="bg-layer-title">
                        {def?.label ?? layer.kind}
                      </span>
                    </button>
                    <div className="bg-layer-actions">
                      <button
                        type="button"
                        className="quiet-button"
                        title="Move layer backward (down in stack)"
                        aria-label={`Move layer ${index + 1} backward`}
                        disabled={index === 0}
                        onClick={e => {
                          e.stopPropagation()
                          handleMoveUp(index)
                        }}
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        title="Move layer forward (up in stack)"
                        aria-label={`Move layer ${index + 1} forward`}
                        disabled={index === layers.length - 1}
                        onClick={e => {
                          e.stopPropagation()
                          handleMoveDown(index)
                        }}
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        title="Duplicate layer"
                        aria-label={`Duplicate layer ${index + 1}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleDuplicateLayer(index)
                        }}
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        title="Remove layer"
                        aria-label={`Remove layer ${index + 1}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleRemoveLayer(index)
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Inline Blend Mode & Opacity for each Layer */}
                  <div className="bg-layer-compositing-row" onClick={e => e.stopPropagation()}>
                    <select
                      className="bg-layer-blend-select"
                      aria-label={`Layer ${index + 1} blend mode`}
                      value={blendMode}
                      onChange={e => handleLayerBlendMode(index, e.target.value as ShaderBlendMode)}
                    >
                      {shaderBlendModes.map(m => (
                        <option key={m} value={m}>
                          {m.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())}
                        </option>
                      ))}
                    </select>
                    <div className="bg-layer-opacity-control">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        aria-label={`Layer ${index + 1} opacity`}
                        value={Math.round(opacity * 100)}
                        onChange={e => handleLayerOpacity(index, e.target.valueAsNumber / 100)}
                      />
                      <span className="bg-layer-opacity-val">{Math.round(opacity * 100)}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="shader-description">No background layers yet. Add a mesh gradient or procedural noise layer.</p>
        )}

        {/* Add Layer Quick Actions */}
        <div className="bg-layers-add-row" role="group" aria-label="Add background layer">
          <button
            type="button"
            className="mesh-tool-btn"
            title="Add interactive multi-stop mesh gradient layer"
            aria-label="Add mesh gradient layer"
            onClick={() => handleAddLayer('mesh-gradient')}
          >
            <Plus size={11} />
            <span>Mesh Gradient</span>
          </button>
          <button
            type="button"
            className="mesh-tool-btn"
            title="Add GPU multi-octave procedural noise layer"
            aria-label="Add procedural noise layer"
            onClick={() => handleAddLayer('procedural-noise')}
          >
            <Waves size={11} />
            <span>Procedural Noise</span>
          </button>
        </div>
      </div>

      {/* Active Layer Detailed Inspector */}
      {activeLayer && (
        <div className="bg-active-layer-inspector">
          <ShaderInspector
            paint={activeLayer}
            onChange={handleUpdateActiveLayer}
            target={`Canvas background · Layer ${safeActiveIndex + 1}`}
            showPicker={true}
            allowRemove={true}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
            onBrowse={onBrowse}
            onBindTarget={mode => {
              if (mode === 'selection' && snapshot.selection.length > 0) {
                store.beginTransaction('Bind background layer to selection')
                for (const id of snapshot.selection) {
                  const el = snapshot.elements[id]
                  if (el) store.update(id, el.type, { style: { shader: activeLayer } })
                }
                store.endTransaction()
              } else if (mode === 'new-card') {
                const cam = (store as any).controller?.getSnapshot?.()?.camera ?? { x: 0, y: 0, zoom: 1 }
                const newNode = store.add('rectangle', {
                  x: -cam.x / cam.zoom + 120,
                  y: -cam.y / cam.zoom + 120,
                  width: 240,
                  height: 240,
                  cornerRadius: 12,
                  style: { fill: null, shader: activeLayer },
                })
                store.select([newNode.id])
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
