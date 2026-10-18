import { designSystemToCSS } from '../tokens/libraryCodegen'
import { buildCSSProps, buildTailwindClasses, buildReactComponent, elementToComponentName } from '../tokens/codegen'
import type { CSSProp } from '../tokens/codegen'
import type { DesignToken } from '../tokens/types'
import { lazy, Suspense, useMemo, useState } from 'react'
import { ChevronRight, Download, X } from 'lucide-react'
import { HandoffCopyButton as CopyButton } from './HandoffCopyButton'
import { resolveTokens } from '../tokens/library'

import type { SceneStore } from './store'
import type { SceneElement } from './types'
import { useScene } from './useScene'
import { getWorldBounds } from './geometry'

const ExportPanel = lazy(async () => ({ default: (await import('../io/ExportPanel')).ExportPanel }))

// ─── Sub-components ──────────────────────────────────────────────────────────

function TokenBadge({ token }: { token: string }) {
  return <span className="dev-token-badge">{token}</span>
}

function CSSBlock({ props, references, onReferencesChange }: { props: CSSProp[]; references: boolean; onReferencesChange: () => void }) {
  const displayed = props.map(prop => ({ ...prop, value: references ? prop.value : prop.resolvedValue ?? prop.value }))
  const text = displayed.map(p => `${p.property}: ${p.value};`).join('\n')
  return (
    <div className="dev-code-block">
      <div className="dev-code-header">
        <span>Computed CSS</span>
        <button className="dev-reference-toggle" aria-label="Use token references" aria-pressed={references} onClick={onReferencesChange}>Tokens {references ? 'on' : 'off'}</button>
        <CopyButton text={text} label="CSS" />
      </div>
      <pre className="dev-code-pre">
        {displayed.map((p, i) => (
          <div key={i} className="dev-code-line">
            <span className="dev-css-prop">{p.property}</span>
            <span className="dev-css-colon">: </span>
            <span className="dev-css-val">{p.value}</span>
            <span className="dev-css-semi">;</span>
            {p.token && <span title={`Computed: ${p.resolvedValue}`}><TokenBadge token={p.token} /></span>}
          </div>
        ))}
      </pre>
    </div>
  )
}

function TailwindBlock({ node, tokens, parent }: { node: SceneElement; tokens: readonly DesignToken[]; parent?: SceneElement }) {
  const classes = buildTailwindClasses(node, tokens, parent)
  return (
    <div className="dev-code-block">
      <div className="dev-code-header">
        <span>Tailwind CSS</span>
        <CopyButton text={classes} label="Tailwind classes" />
      </div>
      <pre className="dev-code-pre dev-tailwind-classes">
        {classes.split(' ').map((cls, i) => (
          <span key={i} className="dev-tw-class">{cls}</span>
        ))}
      </pre>
    </div>
  )
}

function ReactBlock({ node, tokens, parent, elements }: { node: SceneElement; tokens: readonly DesignToken[]; parent?: SceneElement; elements: Readonly<Record<string, SceneElement>> }) {
  const code = useMemo(() => buildReactComponent(node, tokens, parent, elements), [node, tokens, parent, elements])
  return (
    <div className="dev-code-block">
      <div className="dev-code-header">
        <span>React / JSX</span>
        <CopyButton text={code} label="React component" />
      </div>
      <pre className="dev-code-pre dev-code-jsx">{code}</pre>
    </div>
  )
}

function BoxModel({ node }: { node: SceneElement }) {
  const margin = 0
  const border = node.style.stroke?.width ?? 0
  const p = node.type === 'frame' ? node.layout?.padding : null
  const padding = p ? `${p.top} / ${p.right} / ${p.bottom} / ${p.left}` : '0'
  const { width, height } = node

  return (
    <div className="dev-box-model">
      <div className="dev-bm-label">Box model</div>
      <div className="dev-bm-outer" title="Margin (always 0 — use parent gap)">
        <span className="dev-bm-dim">{margin}</span>
        <div className="dev-bm-border" title={`Border: ${border}px`}>
          <span className="dev-bm-dim">{border > 0 ? border : '—'}</span>
          <div className="dev-bm-padding" title={`Padding, top / right / bottom / left: ${padding}`}>
            <span className="dev-bm-dim">{padding}</span>
            <div className="dev-bm-content">
              <span className="dev-bm-size">{Math.round(width)} × {Math.round(height)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DevModeInspector({ store, name, onSave, onMessage, onExit }: { store: SceneStore; name: string; onSave: () => void; onMessage: (message: string) => void; onExit: () => void }) {
  const state = useScene(store, s => s)
  const [activeId, setActiveId] = useState('')
  const [references, setReferences] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const selectedNodes = state.selection.map(id => state.elements[id]).filter(Boolean)
  const node = selectedNodes.find(node => node.id === activeId) ?? selectedNodes[0]
  const tokens = useMemo(() => resolveTokens(state.tokens, state.styleLibrary.activeThemeId), [state.tokens, state.styleLibrary.activeThemeId])
  const [tab, setTab] = useState<'inspect' | 'code'>('inspect')

  const parent = node?.parentId ? state.elements[node.parentId] : undefined
  const cssProps = node ? buildCSSProps(node, tokens, parent) : []
  const themeCSS = designSystemToCSS(state.tokens, state.styleLibrary, tab === 'code')
  const worldBounds = (() => {
    try { return node ? getWorldBounds(state, node.id) : null } catch { return null }
  })()

  return (
    <aside className="inspector-panel dev-mode-panel" data-testid="dev-mode-panel" aria-label="Dev mode properties">
      <div className="panel-heading dev-mode-heading">
        <div className="dev-mode-badge">
          <span className="dev-mode-dot" />
          <span>Dev</span>
        </div>
        <div className="dev-mode-tabs">
          <button
            className={`dev-tab ${tab === 'inspect' ? 'active' : ''}`} aria-pressed={tab === 'inspect'}
            onClick={() => setTab('inspect')}
          >Inspect</button>
          <button
            className={`dev-tab ${tab === 'code' ? 'active' : ''}`} aria-pressed={tab === 'code'}
            onClick={() => setTab('code')}
          >Code</button>
        </div>
        <button className="quiet-button" aria-label="Exit dev mode" onClick={onExit}>
          <X size={14} />
        </button>
      </div>

      {selectedNodes.length > 1 && <div className="inspector-section dev-selection-section">
        <span className="section-caption">{selectedNodes.length} SELECTED LAYERS</span>
        <div className="dev-selection-list" aria-label="Inspect selected layers">{selectedNodes.map(selected => <button key={selected.id} aria-label={`Inspect ${selected.name}`} aria-pressed={node?.id === selected.id} onClick={() => setActiveId(selected.id)}><span>{selected.name}</span><small>{selected.type}</small></button>)}</div>
      </div>}
      {!node ? (
        <div className="inspector-section">
          <span className="section-caption">DEV MODE</span>
          <h3>Select a layer</h3>
          <p>Click any element on the canvas to inspect its CSS properties and generate React and Tailwind snippets. Export your selection in the formats your team needs.</p>
          <div className="dev-hint-list">
            <div className="dev-hint-row"><span className="dev-hint-icon">⌘</span><span>Click to select</span></div>
            <div className="dev-hint-row"><span className="dev-hint-icon">⇧</span><span>Multi-select layers</span></div>
          </div>
        </div>
      ) : tab === 'inspect' ? (
        <>
          <div className="inspector-section">
            <span className="section-caption">ELEMENT</span>
            <div className="dev-element-name">{node.name}</div>
            <div className="dev-element-type">{node.type.toUpperCase()}</div>
          </div>

          <div className="inspector-section">
            <span className="section-caption">DIMENSIONS</span>
            <div className="dev-dims-grid">
              <div className="dev-dim-cell">
                <span className="dev-dim-label">W</span>
                <span className="dev-dim-val">{Math.round(node.width)}</span>
              </div>
              <div className="dev-dim-cell">
                <span className="dev-dim-label">H</span>
                <span className="dev-dim-val">{Math.round(node.height)}</span>
              </div>
              <div className="dev-dim-cell">
                <span className="dev-dim-label">X</span>
                <span className="dev-dim-val">{Math.round(node.x)}</span>
              </div>
              <div className="dev-dim-cell">
                <span className="dev-dim-label">Y</span>
                <span className="dev-dim-val">{Math.round(node.y)}</span>
              </div>
              {node.rotation !== 0 && (
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">°</span>
                  <span className="dev-dim-val">{Math.round(node.rotation)}</span>
                </div>
              )}
              {node.style.opacity !== 1 && (
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">Op</span>
                  <span className="dev-dim-val">{Math.round(node.style.opacity * 100)}%</span>
                </div>
              )}
            </div>
            {worldBounds && (
              <div className="dev-world-bounds">
                <span className="dev-dim-label">World</span>
                <span className="dev-dim-val">{Math.round(worldBounds.x)}, {Math.round(worldBounds.y)}</span>
              </div>
            )}
          </div>

          <div className="inspector-section">
            <BoxModel node={node} />
          </div>

          {node.style.fill !== null && (
            <div className="inspector-section">
              <span className="section-caption">FILL</span>
              <div className="dev-color-row">
                <span className="dev-color-swatch" style={{ background: node.style.fill }} />
                <span className="dev-color-hex">{node.style.fill}</span>
                <CopyButton text={node.style.fill} label="fill color" />
              </div>
              {cssProps.find(p => p.token && (p.property === 'background-color' || p.property === 'color')) && (
                <TokenBadge token={cssProps.find(p => p.token && (p.property === 'background-color' || p.property === 'color'))!.token!} />
              )}
            </div>
          )}

          {node.style.stroke && (
            <div className="inspector-section">
              <span className="section-caption">STROKE</span>
              <div className="dev-color-row">
                <span className="dev-color-swatch" style={{ background: node.style.stroke.color }} />
                <span className="dev-color-hex">{node.style.stroke.color}</span>
                <span className="dev-color-meta">{node.style.stroke.width}px</span>
                <CopyButton text={node.style.stroke.color} label="stroke color" />
              </div>
              {cssProps.find(prop => prop.token && ['border', 'stroke', '-webkit-text-stroke'].includes(prop.property))?.token && <TokenBadge token={cssProps.find(prop => prop.token && ['border', 'stroke', '-webkit-text-stroke'].includes(prop.property))!.token!} />}
            </div>
          )}

          {node.style.shadow && (
            <div className="inspector-section">
              <span className="section-caption">SHADOW</span>
              <div className="dev-color-row">
                <span className="dev-color-swatch" style={{ background: node.style.shadow.color }} />
                <span className="dev-color-hex">{node.style.shadow.color}</span>
              </div>
              <div className="dev-dims-grid" style={{ marginTop: 8 }}>
                <div className="dev-dim-cell"><span className="dev-dim-label">X</span><span className="dev-dim-val">{node.style.shadow.x}</span></div>
                <div className="dev-dim-cell"><span className="dev-dim-label">Y</span><span className="dev-dim-val">{node.style.shadow.y}</span></div>
                <div className="dev-dim-cell"><span className="dev-dim-label">Blur</span><span className="dev-dim-val">{node.style.shadow.blur}</span></div>
              </div>
            </div>
          )}

          {node.type === 'text' && (
            <div className="inspector-section">
              <span className="section-caption">TYPOGRAPHY</span>
              <div className="dev-dims-grid">
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">Size</span>
                  <span className="dev-dim-val">{node.fontSize}px</span>
                </div>
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">Weight</span>
                  <span className="dev-dim-val">{node.fontWeight}</span>
                </div>
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">Line</span>
                  <span className="dev-dim-val">{node.lineHeight}</span>
                </div>
                <div className="dev-dim-cell">
                  <span className="dev-dim-label">Track</span>
                  <span className="dev-dim-val">{node.letterSpacing}px</span>
                </div>
              </div>
            </div>
          )}

          <div className="inspector-section">
            <CSSBlock props={cssProps} references={references} onReferencesChange={() => setReferences(value => !value)} />
          </div>

          <button className="text-action dev-go-code" onClick={() => setTab('code')}>
            View generated code <ChevronRight size={12} />
          </button>
        </>
      ) : (
        <>
          <div className="inspector-section">
            <span className="section-caption">COMPONENT</span>
            <div className="dev-element-name">{elementToComponentName(node)}</div>
          </div>
          <div className="inspector-section">
            <TailwindBlock node={node} tokens={tokens} parent={parent} />
          </div>
          <div className="inspector-section">
            <ReactBlock node={node} tokens={tokens} parent={parent} elements={state.elements} />
          </div>
        </>
      )}

      {(state.tokens.length > 0 || state.styleLibrary.styles.length > 0) && <div className="inspector-section"><span className="section-caption">THEME / TOKENS</span><div className="dev-code-block"><div className="dev-code-header"><span>{tab === 'code' ? 'Tailwind theme' : 'CSS variables'}</span><CopyButton text={themeCSS} label="theme CSS" /></div><pre className="dev-code-pre">{themeCSS}</pre></div></div>}
      {selectedNodes.length > 0 && <div className="inspector-section dev-export-section">
        <span className="section-caption">ASSET HANDOFF</span>
        <p>SVG · PNG · WebP · PDF<br />1×, 2×, 3× · separate files in one ZIP</p>
        <button className="dev-export-button" aria-haspopup="dialog" aria-expanded={exportOpen} onClick={() => setExportOpen(true)}><Download size={13} />Export {selectedNodes.length > 1 ? `${selectedNodes.length} layers` : 'selected layer'}</button>
      </div>}
      {exportOpen && <Suspense fallback={<p role="status" className="inspector-section">Opening export…</p>}><ExportPanel store={store} name={name} initialScope="layers" onSave={onSave} onMessage={onMessage} onClose={() => setExportOpen(false)} /></Suspense>}
      <div className="inspector-bottom">
        <p>Copy any snippet.<br />Paste into your codebase.</p>
        <span>DEV MODE · PAPER HANDOFF</span>
      </div>
    </aside>
  )
}
