import { Check, Circle, Eye, Search, SlidersHorizontal, Sparkles, Square, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Dialog } from '../workspace/Dialog'
import { useScene } from '../scene/useScene'
import type { SceneStore } from '../scene/store'
import { createShader, shaderCatalog, shaderKinds } from './catalog'
import { ShaderInspector } from './ShaderInspector'
import { ShaderSurface } from './ShaderSurface'
import type { ShaderKind, ShaderPaint } from './types'
import './shaders.css'

const thumbnails = Object.fromEntries(shaderKinds.map(kind => [kind, { ...createShader(kind), animated: false }])) as Record<ShaderKind, ShaderPaint>
const categories: Record<ShaderKind, 'Color' | 'Texture' | 'Organic' | 'Glass'> = { 'mesh-gradient': 'Color', 'multi-stop-gradient': 'Color', 'grain-gradient': 'Texture', 'halftone-cmyk': 'Texture', dithering: 'Texture', 'dot-orbit': 'Organic', 'neuro-noise': 'Organic', gooey: 'Organic', 'perlin-noise': 'Texture', 'liquid-distortion': 'Organic', 'glass-refraction': 'Glass', 'multi-pass': 'Organic', 'procedural-noise': 'Texture', glassmorphism: 'Glass', 'liquid-chrome': 'Glass', 'shader-material': 'Glass', 'fluid-simulation': 'Organic', 'particle-simulation': 'Organic', 'vector-extrusion': 'Texture', 'generative-material': 'Organic' }
const filters = ['All', 'Color', 'Texture', 'Organic', 'Glass'] as const

export function ShaderBrowser({ store, onClose }: { store: SceneStore; onClose: () => void }) {
  const state = useScene(store, value => value)
  const targets = state.selection.map(id => state.elements[id]).filter(node => node && store.isVisible(node.id) && !store.isLocked(node.id))
  const initial = targets.length === 1 ? targets[0].style.shader : state.selection.length === 0 ? state.backgroundShader : null
  const [paint, setPaint] = useState<ShaderPaint>(() => initial ?? createShader('mesh-gradient'))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<typeof filters[number]>('All')
  const [previewShape, setPreviewShape] = useState<'rectangle' | 'ellipse'>(() => targets.length === 1 && targets[0].type === 'ellipse' ? 'ellipse' : 'rectangle')
  const [compare, setCompare] = useState(false)
  const visible = useMemo(() => shaderKinds.filter(kind => (filter === 'All' || categories[kind] === filter) && `${shaderCatalog[kind].label} ${shaderCatalog[kind].description} ${categories[kind]}`.toLowerCase().includes(query.toLowerCase().trim())), [query, filter])
  const target = state.selection.length === 0 ? 'Canvas background' : targets.length === 1 ? targets[0].name : `${targets.length} selected layers`
  const disabled = state.selection.length > 0 && targets.length === 0
  const choose = (kind: ShaderKind) => setPaint(createShader(kind, targets.length === 1 && targets[0].type === 'image' ? targets[0].src : undefined))
  const apply = () => {
    if (disabled) return
    store.batch(() => {
      if (!state.selection.length) store.setBackgroundShader(paint)
      else for (const node of targets) store.update(node.id, node.type, { style: { shader: paint } })
    }, `Apply ${shaderCatalog[paint.kind].label}`)
    onClose()
  }
  return <Dialog className="shader-browser" labelledBy="shader-browser-title" onClose={onClose}>
    <header className="shader-browser-header"><div><span className="section-caption">PAPER / MATERIAL LIBRARY</span><h2 id="shader-browser-title"><Sparkles size={19} />FX studio</h2><p>Procedural materials. A canvas for light, texture and motion.</p></div><button className="quiet-button" aria-label="Close shaders library" onClick={onClose}><X size={18} /></button></header>
    <div className="shader-browser-body">
      <section className="shader-browser-catalog" aria-label="Shader catalog"><label className="shader-search"><Search size={14} /><input autoFocus type="search" aria-label="Search shaders" placeholder="Find a material…" value={query} onChange={event => setQuery(event.currentTarget.value)} /><kbd>S</kbd></label>
        <div className="shader-filters" role="group" aria-label="Shader categories">{filters.map(category => <button key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category}</button>)}</div>
        <div className="shader-library-grid">{visible.map((kind, index) => <button className="shader-library-card" key={kind} aria-pressed={paint.kind === kind} aria-label={`Preview ${shaderCatalog[kind].label}`} onClick={() => choose(kind)}>
          <div className="shader-card-art"><ShaderSurface paint={thumbnails[kind]} /><span className="shader-card-number">{String(shaderKinds.indexOf(kind) + 1).padStart(2, '0')}</span>{paint.kind === kind && <span className="shader-card-selected"><Check size={12} /></span>}</div><div className="shader-card-title"><span>{shaderCatalog[kind].label}</span><span>{categories[kind]}</span></div><p>{shaderCatalog[kind].description}</p><span className="sr-only">Material {index + 1} of {visible.length}</span>
        </button>)}</div>
        {!visible.length && <div className="shader-library-empty"><Search size={22} /><p>No materials match “{query}”.</p><button onClick={() => { setQuery(''); setFilter('All') }}>Show all shaders</button></div>}
        <p className="shader-library-note">{shaderKinds.length} materials · Powered by @paper-design/shaders-react</p>
      </section>
      <section className="shader-browser-detail" aria-label="Live shader preview and parameters">
        <div className="shader-live-preview" data-testid="shader-library-preview">
          <div className={`shader-preview-material ${previewShape}`} style={{ background: targets.length === 1 ? targets[0].style.fill ?? 'transparent' : '#edebe1' }}>
            {targets.length === 1 && targets[0].type === 'image' && <img className="shader-preview-image" src={targets[0].src} alt="" style={{ objectFit: targets[0].fit }} />}
            <ShaderSurface paint={paint} style={{ visibility: compare ? 'hidden' : 'visible' }} />
          </div>
          <span><i />{compare ? 'BASE PAINT' : paint.animated ? 'LIVE PREVIEW' : 'STATIC FRAME'}</span>
        </div>
        <div className="shader-preview-toolbar"><div role="group" aria-label="Preview shape">
          <button aria-label="Rectangle preview" aria-pressed={previewShape === 'rectangle'} onClick={() => setPreviewShape('rectangle')}><Square size={12} /></button>
          <button aria-label="Ellipse preview" aria-pressed={previewShape === 'ellipse'} onClick={() => setPreviewShape('ellipse')}><Circle size={12} /></button>
        </div><button aria-label="Compare base paint" aria-pressed={compare} onClick={() => setCompare(value => !value)}><Eye size={12} />Compare</button></div>
        <div className="shader-detail-caption"><SlidersHorizontal size={12} /><span>Fine-tune your material</span></div><div className="shader-library-controls"><ShaderInspector
          paint={paint}
          onChange={next => { if (next) setPaint(next) }}
          target={target}
          showPicker={false}
          allowRemove={false}
          onBindTarget={mode => {
            if (mode === 'background') {
              store.setBackgroundShader(paint)
            } else if (mode === 'selection' && targets.length > 0) {
              store.batch(() => {
                for (const node of targets) store.update(node.id, node.type, { style: { shader: paint } })
              }, 'Bind mesh to selection')
            } else if (mode === 'new-card') {
              const newNode = store.add('rectangle', {
                x: 120,
                y: 120,
                width: 240,
                height: 240,
                cornerRadius: 12,
                style: { fill: null, shader: paint },
              })
              store.select([newNode.id])
              onClose()
            }
          }}
        /></div>
      </section>
    </div>
    <footer className="shader-browser-footer"><span>Apply to <strong>{target}</strong>{disabled ? ' · Unlock a layer to apply' : ''}</span><div><button className="shader-browser-cancel" onClick={onClose}>Cancel</button><button className="shader-browser-apply" disabled={disabled} onClick={apply}>Apply shader <Check size={13} /></button></div></footer>
  </Dialog>
}
