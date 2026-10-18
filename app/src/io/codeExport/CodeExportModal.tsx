import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Code2,
  Download,
  Copy,
  Check,
  Sparkles,
  Layers,
  Frame,
  Cpu,
  FileCode,
  Package,
  X,
  FileText,
  Grid2X2,
} from 'lucide-react'
import type { SceneStore } from '../../scene/store'
import { useScene } from '../../scene/useScene'
import { Dialog } from '../../workspace/Dialog'
import { downloadFile } from '../project'
import { createZIP, type ArchiveFile } from '../zip'
import { exportSVG } from '../svg'
import { ShaderSurface } from '../../shaders/ShaderSurface'
import {
  resolveExportTargets,
  generateCodeExportBundle,
  type CodeExportFormat,
  type ReactExportOptions,
  type SvgExportOptions,
  type GlslExportOptions,
  type ExportFileEntry,
} from './index'
import './codeExport.css'

interface Props {
  readonly store: SceneStore
  readonly name: string
  readonly initialFormat?: CodeExportFormat
  readonly onClose: () => void
  readonly onMessage: (message: string) => void
}

/**
 * Lightweight syntax highlighter for JSX, GLSL, XML/SVG, and JSON.
 */
function highlightCode(code: string, language: string): string {
  if (!code) return ''

  // XML / SVG
  if (language === 'xml' || language === 'html') {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/(&lt;\/?)([a-zA-Z0-9:-]+)/g, '$1<span class="hl-tag">$2</span>')
      .replace(/([a-zA-Z0-9:-]+)=(".*?")/g, '<span class="hl-attr">$1</span>=<span class="hl-str">$2</span>')
      .replace(/(&lt;!--.*?--&gt;)/g, '<span class="hl-comment">$1</span>')
  }

  // JSON
  if (language === 'json') {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/(".*?")(\s*:)/g, '<span class="hl-attr">$1</span>$2')
      .replace(/:\s*(".*?")/g, ': <span class="hl-str">$1</span>')
      .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="hl-num">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="hl-kw">$1</span>')
  }

  // GLSL / TSX / JSX
  let res = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Strings
  res = res.replace(/(".*?"|'.*?'|`.*?`)/g, '<span class="hl-str">$1</span>')

  // Comments
  res = res.replace(/(\/\/.*$)/gm, '<span class="hl-comment">$1</span>')
  res = res.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')

  // Keywords
  const keywords = [
    'import', 'export', 'default', 'function', 'return', 'const', 'let', 'var',
    'interface', 'type', 'readonly', 'void', 'main', 'in', 'out', 'uniform',
    'precision', 'highp', 'mediump', 'lowp', 'layout', 'location', 'attribute',
  ]
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')
  res = res.replace(kwRegex, '<span class="hl-kw">$1</span>')

  // GLSL types
  const types = ['vec2', 'vec3', 'vec4', 'mat3', 'mat4', 'float', 'int', 'sampler2D']
  const typeRegex = new RegExp(`\\b(${types.join('|')})\\b`, 'g')
  res = res.replace(typeRegex, '<span class="hl-type">$1</span>')

  return res
}

export function CodeExportModal({ store, name, initialFormat = 'react', onClose, onMessage }: Props) {
  const state = useScene(store, snapshot => snapshot)
  const targets = useMemo(() => resolveExportTargets(state), [state])

  // Active target selection
  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => targets[0]?.id ?? 'canvas')
  const activeTarget = useMemo(
    () => targets.find(t => t.id === selectedTargetId) ?? targets[0] ?? {
      id: 'target-canvas',
      name: 'Whole Canvas',
      type: 'canvas' as const,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
    [targets, selectedTargetId],
  )

  // Format selection
  const [format, setFormat] = useState<CodeExportFormat>(() => {
    if (activeTarget.type === 'shader-surface' || activeTarget.type === 'background-shader') return 'glsl'
    return initialFormat
  })

  // React Options
  const [reactOptions, setReactOptions] = useState<ReactExportOptions>({
    styling: 'tailwind',
    typescript: true,
    componentName: activeTarget.name || 'Artwork',
    includeShader: true,
    extractSubcomponents: false,
    responsive: true,
  })

  // SVG Options
  const [svgOptions, setSvgOptions] = useState<SvgExportOptions>({
    mode: activeTarget.hasAnimation ? 'animated' : 'static',
    animMode: 'both',
    loop: true,
    duration: 2.4,
    fps: 60,
    background: 'transparent',
    pretty: true,
  })

  // GLSL Options
  const [glslOptions, setGlslOptions] = useState<GlslExportOptions>({
    activeFile: 'fragment',
    targetShader: activeTarget.shader,
  })

  // Active package file selection (for GLSL or multi-file exports)
  const [activeFileIndex, setActiveFileIndex] = useState(0)

  // UI status
  const [copied, setCopied] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  // Update target component name when target changes
  useEffect(() => {
    setReactOptions(prev => ({
      ...prev,
      componentName: activeTarget.name || 'Artwork',
    }))
    if (activeTarget.shader) {
      setGlslOptions(prev => ({ ...prev, targetShader: activeTarget.shader }))
    }
  }, [activeTarget])

  // Generate code bundle
  const bundle = useMemo(() => {
    return generateCodeExportBundle(format, state, activeTarget, {
      react: reactOptions,
      svg: svgOptions,
      glsl: glslOptions,
    })
  }, [format, state, activeTarget, reactOptions, svgOptions, glslOptions])

  // Current file to display in editor
  const currentFile: ExportFileEntry = bundle.files[activeFileIndex] ?? bundle.primaryFile

  // Visual SVG Preview data
  const previewSvg = useMemo(() => {
    if (format === 'glsl' && activeTarget.shader) return null
    try {
      return exportSVG(state, {
        scope: activeTarget.type === 'canvas' ? 'canvas' : 'selection',
        scale: 1,
        background: svgOptions.background === 'cream' ? 'cream' : 'transparent',
      })
    } catch {
      return null
    }
  }, [state, activeTarget, format, svgOptions.background])

  // Copy code handler
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentFile.content)
      setCopied(true)
      onMessage(`Copied ${currentFile.name} to clipboard`)
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      onMessage('Failed to copy to clipboard')
    }
  }

  // Single file download
  function handleDownloadFile() {
    const mimeMap: Record<string, string> = {
      typescript: 'text/typescript',
      javascript: 'text/javascript',
      xml: 'image/svg+xml',
      html: 'text/html',
      glsl: 'text/plain',
      json: 'application/json',
      markdown: 'text/markdown',
    }
    const blob = new Blob([currentFile.content], { type: mimeMap[currentFile.language] || 'text/plain' })
    downloadFile(blob, currentFile.name)
    onMessage(`Downloaded ${currentFile.name}`)
  }

  // Complete ZIP package download
  async function handleDownloadZip() {
    if (downloadingZip) return
    setDownloadingZip(true)
    try {
      const archiveFiles: ArchiveFile[] = bundle.files.map(f => ({
        name: f.name,
        blob: new Blob([f.content], { type: 'text/plain;charset=utf-8' }),
      }))

      const zipBlob = await createZIP(archiveFiles)
      const zipName = `${(activeTarget.name || name).toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${format}-package.zip`
      downloadFile(zipBlob, zipName)
      onMessage(`Downloaded ${zipName} (${bundle.files.length} files)`)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Failed to create ZIP package')
    } finally {
      setDownloadingZip(false)
    }
  }

  // Keyboard shortcut listener (Esc to close, 1/2/3 for tabs, Cmd+C for copy)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return

      if (e.key === '1') {
        e.preventDefault()
        setFormat('react')
        setActiveFileIndex(0)
      } else if (e.key === '2') {
        e.preventDefault()
        setFormat('svg')
        setActiveFileIndex(0)
      } else if (e.key === '3') {
        e.preventDefault()
        setFormat('glsl')
        setActiveFileIndex(0)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault()
        void handleCopy()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentFile])

  const targetIcon =
    activeTarget.type === 'shader-surface' || activeTarget.type === 'background-shader' ? (
      <Sparkles size={13} className="text-[#81adec]" />
    ) : activeTarget.type === 'artboard' ? (
      <Frame size={13} className="text-[#81adec]" />
    ) : activeTarget.type === 'canvas' ? (
      <Grid2X2 size={13} className="text-[#81adec]" />
    ) : (
      <Layers size={13} className="text-[#81adec]" />
    )

  return (
    <Dialog className="code-export-dialog" labelledBy="code-export-title" onClose={onClose}>
      {/* Header */}
      <header className="code-export-header">
        <div className="code-export-title-group">
          <span className="code-export-eyebrow">
            <i /> PAPER / ENGINEERING HANDOFF
          </span>
          <h2 id="code-export-title">Production Code Exporter</h2>
        </div>

        <div className="code-export-header-actions">
          <div className="code-export-target-select" title="Target Canvas Node or Shader Surface">
            {targetIcon}
            <select
              aria-label="Export Target"
              value={selectedTargetId}
              onChange={e => {
                setSelectedTargetId(e.target.value)
                setActiveFileIndex(0)
              }}
            >
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({Math.round(t.bounds.width)}×{Math.round(t.bounds.height)})
                </option>
              ))}
            </select>
          </div>

          <button
            className="code-export-close-btn"
            onClick={onClose}
            aria-label="Close Code Exporter (Esc)"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Format Tabs Bar */}
      <div className="code-export-tabs-bar">
        <div className="code-export-format-tabs" role="tablist" aria-label="Code format">
          <button
            role="tab"
            aria-selected={format === 'react'}
            className={`code-export-tab-btn ${format === 'react' ? 'active' : ''}`}
            onClick={() => {
              setFormat('react')
              setActiveFileIndex(0)
            }}
          >
            <Code2 size={14} />
            <span>React JSX</span>
            <span className="code-export-tab-badge">Tailwind</span>
          </button>

          <button
            role="tab"
            aria-selected={format === 'svg'}
            className={`code-export-tab-btn ${format === 'svg' ? 'active' : ''}`}
            onClick={() => {
              setFormat('svg')
              setActiveFileIndex(0)
            }}
          >
            <FileCode size={14} />
            <span>Animated SVG</span>
            <span className="code-export-tab-badge">Standalone</span>
          </button>

          <button
            role="tab"
            aria-selected={format === 'glsl'}
            className={`code-export-tab-btn ${format === 'glsl' ? 'active' : ''}`}
            onClick={() => {
              setFormat('glsl')
              setActiveFileIndex(0)
            }}
          >
            <Cpu size={14} />
            <span>Raw GLSL</span>
            <span className="code-export-tab-badge">WebGL Package</span>
          </button>
        </div>

        {/* Package Files Selector (when multiple files exist) */}
        {bundle.files.length > 1 && (
          <div className="code-export-package-tabs" aria-label="Package files">
            {bundle.files.map((file, idx) => (
              <button
                key={file.name}
                className={`code-export-pkg-file-btn ${activeFileIndex === idx ? 'active' : ''}`}
                onClick={() => setActiveFileIndex(idx)}
                title={file.description}
              >
                {file.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Options Toolbar */}
      <div className="code-export-options-bar">
        {format === 'react' && (
          <div className="code-export-controls-group">
            <label className="code-export-control-item">
              <span>Styling</span>
              <select
                value={reactOptions.styling}
                onChange={e => setReactOptions(prev => ({ ...prev, styling: e.target.value as 'tailwind' | 'inline' }))}
              >
                <option value="tailwind">Tailwind CSS v4 (Classes)</option>
                <option value="inline">React Inline Styles (CSS)</option>
              </select>
            </label>

            <label className="code-export-control-item">
              <span>Language</span>
              <select
                value={reactOptions.typescript ? 'ts' : 'js'}
                onChange={e => setReactOptions(prev => ({ ...prev, typescript: e.target.value === 'ts' }))}
              >
                <option value="ts">TypeScript (.tsx)</option>
                <option value="js">JavaScript (.jsx)</option>
              </select>
            </label>

            <label className="code-export-control-item">
              <span>Component</span>
              <input
                type="text"
                value={reactOptions.componentName}
                onChange={e => setReactOptions(prev => ({ ...prev, componentName: e.target.value }))}
                placeholder="Component Name"
                style={{ width: '130px' }}
              />
            </label>

            {activeTarget.hasShader && (
              <button
                className="code-export-toggle-btn"
                aria-pressed={reactOptions.includeShader}
                onClick={() => setReactOptions(prev => ({ ...prev, includeShader: !prev.includeShader }))}
                title="Embed ShaderMount subcomponent inside JSX"
              >
                Include Shaders: {reactOptions.includeShader ? 'On' : 'Off'}
              </button>
            )}
          </div>
        )}

        {format === 'svg' && (
          <div className="code-export-controls-group">
            <label className="code-export-control-item">
              <span>Mode</span>
              <select
                value={svgOptions.mode}
                onChange={e => setSvgOptions(prev => ({ ...prev, mode: e.target.value as 'animated' | 'static' }))}
              >
                <option value="animated">60fps Animated Vector</option>
                <option value="static">Static Production Vector</option>
              </select>
            </label>

            {svgOptions.mode === 'animated' && (
              <>
                <label className="code-export-control-item">
                  <span>Engine</span>
                  <select
                    value={svgOptions.animMode}
                    onChange={e => setSvgOptions(prev => ({ ...prev, animMode: e.target.value as 'both' | 'css' | 'smil' }))}
                  >
                    <option value="both">CSS Keyframes + SMIL</option>
                    <option value="css">CSS Keyframes Only</option>
                    <option value="smil">SMIL &lt;animate&gt; Only</option>
                  </select>
                </label>

                <label className="code-export-control-item">
                  <span>FPS</span>
                  <select
                    value={svgOptions.fps}
                    onChange={e => setSvgOptions(prev => ({ ...prev, fps: Number(e.target.value) }))}
                  >
                    <option value={60}>60 fps (Fluid)</option>
                    <option value={30}>30 fps (Compact)</option>
                  </select>
                </label>

                <button
                  className="code-export-toggle-btn"
                  aria-pressed={svgOptions.loop}
                  onClick={() => setSvgOptions(prev => ({ ...prev, loop: !prev.loop }))}
                >
                  Loop: {svgOptions.loop ? 'Infinite' : 'Once'}
                </button>
              </>
            )}

            <label className="code-export-control-item">
              <span>Background</span>
              <select
                value={svgOptions.background}
                onChange={e => setSvgOptions(prev => ({ ...prev, background: e.target.value as any }))}
              >
                <option value="transparent">Transparent</option>
                <option value="cream">Paper Cream (#edebe1)</option>
                <option value="dark">Ink Dark (#080808)</option>
              </select>
            </label>
          </div>
        )}

        {format === 'glsl' && (
          <div className="code-export-controls-group">
            <span style={{ color: '#888882', font: '10px var(--font-mono)' }}>
              Package files: <b>shader.frag</b> · <b>uniforms.json</b> · <b>index.html</b> (WebGL2) · <b>package.json</b>
            </span>
          </div>
        )}

        <div className="code-export-editor-actions">
          <button
            className="code-btn-secondary"
            onClick={handleDownloadZip}
            disabled={downloadingZip}
            title="Download full package as a ZIP archive"
          >
            <Package size={13} />
            <span>{downloadingZip ? 'Packaging…' : 'Download ZIP'}</span>
          </button>

          <button
            className="code-btn-secondary"
            onClick={handleDownloadFile}
            title={`Download ${currentFile.name}`}
          >
            <Download size={13} />
            <span>Download {currentFile.name.split('.').pop()?.toUpperCase()}</span>
          </button>

          <button
            className="code-btn-primary"
            onClick={() => void handleCopy()}
            title="Copy code to clipboard (⌘C)"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>
      </div>

      {/* Main Split View: Visual Preview + Code Editor */}
      <div className="code-export-main-view">
        {/* Left Pane: Preview & Architecture */}
        <aside className="code-export-preview-pane">
          <div
            className={`code-export-stage-container ${
              svgOptions.background === 'cream' ? 'with-cream' : svgOptions.background === 'dark' ? 'with-dark' : ''
            }`}
          >
            <div className="code-export-preview-content">
              {format === 'glsl' && activeTarget.shader ? (
                <div style={{ width: '240px', height: '180px', borderRadius: '4px', overflow: 'hidden' }}>
                  <ShaderSurface paint={activeTarget.shader} />
                </div>
              ) : previewSvg ? (
                <div
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                />
              ) : (
                <div style={{ color: '#888882', fontSize: '11px', textAlign: 'center' }}>
                  <span>{activeTarget.name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Architecture Card */}
          <div className="code-export-stats-section">
            <div className="code-export-card">
              <span className="code-export-card-title">Artwork Architecture</span>
              <div className="code-export-card-row">
                <span>Target</span>
                <span>{activeTarget.name}</span>
              </div>
              <div className="code-export-card-row">
                <span>Dimensions</span>
                <span>
                  {Math.round(activeTarget.bounds.width)} × {Math.round(activeTarget.bounds.height)} px
                </span>
              </div>
              <div className="code-export-card-row">
                <span>Node Count</span>
                <span>{bundle.stats.nodeCount} elements</span>
              </div>
              {activeTarget.shader && (
                <div className="code-export-card-row">
                  <span>Shader Surface</span>
                  <span style={{ color: '#81adec' }}>{activeTarget.shader.kind}</span>
                </div>
              )}
              {bundle.stats.hasAnimation && (
                <div className="code-export-card-row">
                  <span>Motion</span>
                  <span style={{ color: '#a8d5a2' }}>60 fps active</span>
                </div>
              )}
            </div>

            <div className="code-export-card">
              <span className="code-export-card-title">Code Metrics</span>
              <div className="code-export-card-row">
                <span>File</span>
                <span>{currentFile.name}</span>
              </div>
              <div className="code-export-card-row">
                <span>Total Lines</span>
                <span>{currentFile.content.split('\n').length.toLocaleString()} lines</span>
              </div>
              <div className="code-export-card-row">
                <span>Bundle Size</span>
                <span>{(currentFile.content.length / 1024).toFixed(1)} KB</span>
              </div>
              <div className="code-export-card-row">
                <span>Package Files</span>
                <span>{bundle.files.length} ready</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Pane: Code Editor */}
        <section className="code-export-editor-pane">
          <div className="code-export-editor-top">
            <div className="code-export-file-info">
              <FileText size={13} className="text-[#81adec]" />
              <b>{currentFile.name}</b>
              <span>({currentFile.description})</span>
            </div>

            <div style={{ color: '#666660', font: '9px var(--font-mono)' }}>
              {currentFile.content.split('\n').length} lines · {(currentFile.content.length / 1024).toFixed(1)} KB
            </div>
          </div>

          <div className="code-export-code-wrapper">
            <pre className="code-export-pre">
              {currentFile.content.split('\n').map((line, idx) => (
                <div key={idx} className="code-export-line">
                  <span className="code-export-line-num">{idx + 1}</span>
                  <span
                    className="code-export-line-code"
                    dangerouslySetInnerHTML={{ __html: highlightCode(line, currentFile.language) }}
                  />
                </div>
              ))}
            </pre>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="code-export-footer">
        <span>{bundle.stats.summary}</span>

        <div className="code-export-footer-right">
          <span>
            Press <kbd>1</kbd> React · <kbd>2</kbd> SVG · <kbd>3</kbd> GLSL
          </span>
          <span>
            Press <kbd>⌘C</kbd> Copy · <kbd>Esc</kbd> Close
          </span>
        </div>
      </footer>
    </Dialog>
  )
}
