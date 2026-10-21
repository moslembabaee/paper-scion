import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
  Plus,
  RotateCcw,
  Sliders,
  Sparkles,
  Spline,
  Trash2,
  Type,
  Unlink,
  Upload,
  Waves,
} from 'lucide-react'
import type { SceneStore } from './store.ts'
import type {
  FontKerningMode,
  OpenTypeFeatures,
  TextElement,
  TextPathPreset,
  VariableFontAxes,
  VectorElement,
} from './types.ts'
import { isVector } from './booleanGeometry.ts'
import {
  OPENTYPE_CATALOG,
  OPENTYPE_RECIPES,
  PRIMARY_OPENTYPE_TAGS,
  VARIABLE_AXES_META,
  VARIABLE_AXIS_PRESETS,
  compileTypographyStyles,
  compileFontFeatureSettings,
  compileFontVariationSettings,
  computeTextOpticalMetrics,
  generatePathPreset,
  textPathOffset,
} from './typography.ts'
import { parsePath } from './pathGeometry'
import { TextPathEditor } from './TextPathEditor'
import { KineticInspector } from './KineticInspector'
import { useOutlineFont } from './useOutlineFont'
import { useRangeHistory } from './useRangeHistory'
import { useScene } from './useScene'
import './typography.css'

interface TypographyStudioProps {
  readonly store: SceneStore
  readonly node: TextElement
  readonly binding?: (property: 'fontSize' | 'fontFamily' | 'fontWeight' | 'lineHeight' | 'letterSpacing', label: string) => ReactNode
}

type StudioTab = 'type' | 'axes' | 'opentype' | 'kerning' | 'path' | 'motion'

const CURATED_FONTS = [
  { label: 'Inter (Variable)', value: 'Inter, Matter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Roboto Flex (Variable)', value: '"Roboto Flex", sans-serif' },
  { label: 'Recursive (Variable)', value: 'Recursive, monospace, sans-serif' },
  { label: 'Space Grotesk (Variable)', value: '"Space Grotesk", sans-serif' },
  { label: 'Playfair Display (Variable)', value: '"Playfair Display", Georgia, serif' },
  { label: 'Fira Code (Ligatures)', value: '"Fira Code", ui-monospace, monospace' },
  { label: 'System UI', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Monospace Code', value: 'ui-monospace, "Cascadia Code", monospace' },
  { label: 'Serif Classic', value: 'Georgia, Cambria, "Times New Roman", serif' },
]

const PATH_PRESETS: readonly { id: TextPathPreset; label: string; icon: string }[] = [
  { id: 'wave', label: 'Wave', icon: '〰' },
  { id: 'arc', label: 'Arc', icon: '⌒' },
  { id: 'circle', label: 'Circle', icon: '○' },
  { id: 'scurve', label: 'S-Curve', icon: '∿' },
  { id: 'spiral', label: 'Spiral', icon: '◎' },
  { id: 'banner', label: 'Banner', icon: '⌢' },
  { id: 'zigzag', label: 'Zigzag', icon: '⋀' },
  { id: 'custom', label: 'Custom', icon: '✎' },
]

export function TypographyStudio({ store, node, binding }: TypographyStudioProps) {
  const rangeHistory = useRangeHistory(store)
  const fontInfo = useOutlineFont(node.fontSource)
  const [fontError, setFontError] = useState('')
  const [fontLoading, setFontLoading] = useState(false)
  const [pathError, setPathError] = useState('')
  const [tab, setTab] = useState<StudioTab>('type')
  const [customFont, setCustomFont] = useState(false)
  const [sampleText, setSampleText] = useState('0 1/2 fi fl $1,420 -> !=')
  const [showExtendedAxes, setShowExtendedAxes] = useState(false)
  const [newAxisTag, setNewAxisTag] = useState('')
  const [newAxisVal, setNewAxisVal] = useState(0)

  const opticalMetrics = useMemo(() => computeTextOpticalMetrics(node), [node])

  const isInstance = node.component?.kind === 'instance'
  const masterId = isInstance ? node.component.masterId : undefined
  const isMasterLocked = masterId ? store.isLocked(masterId) : false
  const overrides = isInstance ? (node.component.overrides.properties ?? {}) : {}
  const hasFontFamilyOverride = isInstance && Object.hasOwn(overrides, 'fontFamily')
  const hasFontSizeOverride = isInstance && Object.hasOwn(overrides, 'fontSize')
  const hasFontWeightOverride = isInstance && Object.hasOwn(overrides, 'fontWeight')
  const hasLineHeightOverride = isInstance && Object.hasOwn(overrides, 'lineHeight')
  const hasLetterSpacingOverride = isInstance && Object.hasOwn(overrides, 'letterSpacing')
  const hasVariableAxesOverride = isInstance && Object.hasOwn(overrides, 'variableAxes')

  const renderOverrideControls = (label: string, channel: string) => (
    <div className="override-inline-controls">
      <span className="property-override-badge mini" title={`${label} overridden from master`}>
        <span className="property-override-dot" />
        Override
      </span>
      <button
        type="button"
        className="quiet-button override-inline-push"
        disabled={isMasterLocked}
        aria-label={`Push ${label.toLowerCase()} to master`}
        title={`Push ${label.toLowerCase()} override to master`}
        onClick={() => store.pushPropertyOverrideToMaster(node.id, channel)}
      >
        <Upload size={10} />
      </button>
      <button
        type="button"
        className="quiet-button override-inline-reset"
        aria-label={`Reset ${label.toLowerCase()} override`}
        title={`Reset ${label.toLowerCase()} override to master`}
        onClick={() => store.resetPropertyOverride(node.id, channel)}
      >
        <RotateCcw size={10} />
      </button>
    </div>
  )

  const update = (patch: Partial<TextElement>) => {
    const supported = fontInfo?.font?.variationAxes
    if (supported && patch.variableAxes) {
      const variableAxes = Object.fromEntries(Object.entries(patch.variableAxes).filter(([tag]) => supported[tag]).map(([tag, value]) => [tag, Math.max(supported[tag].min, Math.min(supported[tag].max, value!))]))
      patch = { ...patch, variableAxes, ...(variableAxes.wght === undefined ? {} : { fontWeight: variableAxes.wght }) }
    }
    store.update(node.id, 'text', patch)
  }

  // Active variable axes
  const axes: VariableFontAxes = {
    wght: node.fontWeight,
    wdth: 100,
    slnt: 0,
    opsz: node.fontSize,
    ...(node.variableAxes ?? {}),
  }

  const updateAxis = (axis: string, value: number) => {
    if (!Number.isFinite(value)) return
    const meta = fontInfo?.font?.variationAxes[axis] ?? VARIABLE_AXES_META[axis]
    if (meta) value = Math.max(meta.min, Math.min(meta.max, value))
    // Display defaults must not become explicit overrides for unrelated axes.
    // In particular, changing weight should preserve automatic optical sizing.
    const nextAxes = { ...node.variableAxes, [axis]: value }
    update({
      variableAxes: nextAxes,
      ...(axis === 'wght' ? { fontWeight: Math.round(value) } : {}),
    })
  }

  const handleScrubHeader = (
    event: React.PointerEvent<HTMLDivElement>,
    axis: string,
    currentVal: number,
    min: number,
    max: number,
    step: number
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const initialVal = currentVal
    store.beginTransaction(`Scrub variable font ${axis.toUpperCase()}`)

    const onPointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX
      const speed = e.shiftKey ? 0.2 : e.altKey ? 3.5 : 1
      const factor = step < 0.1 ? 0.008 : step < 1 ? 0.05 : max - min > 500 ? 1.5 : 0.6
      const nextVal = Math.max(min, Math.min(max, initialVal + deltaX * factor * speed))
      const rounded = step < 1 ? Number(nextVal.toFixed(2)) : Math.round(nextVal)
      updateAxis(axis, rounded)
    }

    const onPointerUp = (e: PointerEvent) => {
      try {
        target.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      store.endTransaction()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const removeAxis = (axis: string) => {
    const nextAxes = { ...node.variableAxes }
    delete nextAxes[axis]
    update({ variableAxes: nextAxes })
  }

  // OpenType features
  const otFeatures: OpenTypeFeatures = node.openTypeFeatures ?? { liga: true }
  const activeOtCount = Object.values(otFeatures).filter(Boolean).length

  const toggleOtFeature = (tag: string) => {
    const current = otFeatures[tag] ?? false
    const nextFeatures = { ...otFeatures, [tag]: !current }
    update({ openTypeFeatures: nextFeatures })
  }

  const resetOtFeatures = () => {
    update({ openTypeFeatures: { liga: true } })
  }

  // Kerning
  const currentKerning: FontKerningMode = node.fontKerning ?? 'auto'

  // Text-on-Path
  const top = node.textOnPath ?? {
    enabled: false,
    preset: 'wave',
    side: 'left',
    align: 'start',
    spacing: 0,
  }

  // Available vector layers on canvas for linking (path, rectangle, ellipse)
  const canvasVectorLayers = useScene(store, state =>
    Object.values(state.elements).filter(
      (el): el is VectorElement => isVector(el) && el.id !== node.id
    )
  )

  return (
    <div className="inspector-section typography-studio" onPointerDown={rangeHistory}>
      <div className="property-heading">
        <span className="section-caption">VARIABLE TYPOGRAPHY STUDIO</span>
        {top.enabled && <span className="axis-tag-badge">Path Active</span>}
        {node.kinetic?.enabled && <span className="axis-tag-badge">Kinetic</span>}
      </div>

      {/* Tabs */}
      <div className="typography-tabs" role="group" aria-label="Typography controls">
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'type' ? 'is-active' : ''}`}
          aria-pressed={tab === 'type'}
          onClick={() => setTab('type')}
          title="Typeface, Content & Alignment"
        >
          <Type size={11} />
          <span>Type</span>
        </button>
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'axes' ? 'is-active' : ''}`}
          aria-pressed={tab === 'axes'}
          onClick={() => setTab('axes')}
          title="Variable Font Axes"
        >
          <Sliders size={11} />
          <span>Axes</span>
        </button>
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'opentype' ? 'is-active' : ''}`}
          aria-pressed={tab === 'opentype'}
          onClick={() => setTab('opentype')}
          title="OpenType Features"
        >
          <Sparkles size={11} />
          <span>OT{activeOtCount > 0 ? ` (${activeOtCount})` : ''}</span>
        </button>
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'kerning' ? 'is-active' : ''}`}
          aria-pressed={tab === 'kerning'}
          onClick={() => setTab('kerning')}
          title="Optical Kerning & Tracking"
        >
          <span>Kern</span>
        </button>
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'path' ? 'is-active' : ''}`}
          aria-pressed={tab === 'path'}
          onClick={() => setTab('path')}
          title="Text-on-Vector Path Deformation"
        >
          <Spline size={11} />
          <span>Path</span>
        </button>
        <button
          type="button"
          className={`typography-tab-btn ${tab === 'motion' ? 'is-active' : ''}`}
          aria-pressed={tab === 'motion'}
          onClick={() => setTab('motion')}
          title="Kinetic Typography & SVG Outlines"
        >
          <Waves size={11} />
          <span>Motion{node.kinetic?.enabled ? ' (Active)' : ''}</span>
        </button>
      </div>
      {tab === 'motion' && <KineticInspector store={store} node={node} />}

      {/* Tab 1: Typeface & Core Settings */}
      {tab === 'type' && (
        <div className="typography-tab-pane">
          <textarea
            className="property-textarea"
            key={node.id + node.text}
            aria-label="Text content"
            defaultValue={node.text}
            placeholder="Type your copy here..."
            onBlur={event => update({ text: event.currentTarget.value })}
          />

          <label className="property-label">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Font family</span>
              {hasFontFamilyOverride && renderOverrideControls('Font family', 'properties.fontFamily')}
            </div>
            {!customFont ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <select
                  className="property-input"
                  aria-label="Font family selector"
                  value={CURATED_FONTS.some(f => f.value === node.fontFamily) ? node.fontFamily : 'custom'}
                  onChange={event => {
                    if (event.currentTarget.value === 'custom') {
                      setCustomFont(true)
                    } else {
                      update({ fontFamily: event.currentTarget.value, fontSource: undefined })
                    }
                  }}
                >
                  {CURATED_FONTS.map(font => (
                    <option key={font.value} value={font.value}>{font.label}</option>
                  ))}
                  <option value="custom">{node.fontSource ? 'Embedded local font' : 'Custom Font Name…'}</option>
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input
                  className="property-input"
                  aria-label="Custom font family"
                  defaultValue={node.fontFamily}
                  onBlur={event => {
                    const next = event.currentTarget.value.trim()
                    if (next) update({ fontFamily: next, fontSource: undefined })
                  }}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                />
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setCustomFont(false)}
                  title="Choose from presets"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            )}
          </label>
          {binding?.('fontFamily', 'Font family')}
          <label className="typo-font-import">
            <Upload size={12} /> {fontLoading ? 'Loading font…' : node.fontSource ? 'Replace embedded font' : 'Import local font'}
            <input type="file" aria-label="Import local font" accept=".woff2,.woff,.ttf,.otf" disabled={fontLoading} onChange={async event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              if (file.size > 3_000_000) { setFontError('Choose a font smaller than 3 MB.'); return }
              const ext = file.name.split('.').at(-1)?.toLowerCase()
              if (!ext || !['woff2', 'woff', 'ttf', 'otf'].includes(ext)) { setFontError('Choose a WOFF, WOFF2, TTF or OTF font.'); return }
              setFontLoading(true)
              try {
                const family = `PaperFont-${crypto.randomUUID()}`
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(String(reader.result).split(',')[1])
                  reader.onerror = () => reject(new Error('Could not read font'))
                  reader.readAsDataURL(file)
                })
                const source = `data:font/${ext};base64,${data}`
                const face = new FontFace(family, `url("${source}")`, { weight: '1 1000', stretch: '25% 200%' })
                await face.load()
                update({ fontFamily: family, fontSource: source, variableAxes: undefined })
                setFontError('')
              } catch { setFontError('This font could not be loaded. Choose a valid font file.') }
              finally { setFontLoading(false) }
            }} />
          </label>
          {fontError && <p className="typo-hint" role="alert">{fontError}</p>}
          {node.fontSource && <p className="typo-hint">Font embedded in this document · available offline</p>}
          <button type="button" className="typo-chip" disabled={fontLoading} onClick={async () => {
            setFontLoading(true); setFontError('')
            try {
              const response = await fetch(`${import.meta.env.BASE_URL}fonts/InterVariable-latin.ttf`)
              if (!response.ok) throw new Error('Bundled font is unavailable')
              const bytes = new Uint8Array(await response.arrayBuffer())
              let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
              const source = `data:font/ttf;base64,${btoa(binary)}`
              const face = new FontFace('PaperInter', `url("${source}")`, { weight: '100 900' })
              await face.load()
              document.fonts?.add(face)
              store.update(node.id, 'text', { fontFamily: 'PaperInter', fontSource: source, fontWeight: 400, variableAxes: { wght: 400 } })
            } catch { setFontError('Could not load bundled Inter.') }
            finally { setFontLoading(false) }
          }}>Use bundled Inter · variable weight</button>


          <div className="property-pair">
            <div className="token-number-field" style={{ flex: 1 }}>
              <label className="property-number">
                <span>Size</span>
                <input
                  type="number"
                  aria-label="Font size"
                  value={node.fontSize}
                  min={1}
                  onChange={event => {
                    const next = event.currentTarget.valueAsNumber
                    if (Number.isFinite(next) && next >= 1) update({ fontSize: next })
                  }}
                />
              </label>
              {hasFontSizeOverride ? renderOverrideControls('Size', 'properties.fontSize') : binding?.('fontSize', 'Font size')}
            </div>
            <div className="token-number-field" style={{ flex: 1 }}>
              <label className="property-number">
                <span>Weight</span>
                <input
                  type="number"
                  aria-label="Font weight"
                  value={axes.wght ?? node.fontWeight}
                  min={1}
                  max={1000}
                  step={50}
                  onChange={event => {
                    const next = event.currentTarget.valueAsNumber
                    if (Number.isFinite(next) && next >= 1 && next <= 1000) updateAxis('wght', next)
                  }}
                />
              </label>
              {hasFontWeightOverride ? renderOverrideControls('Weight', 'properties.fontWeight') : binding?.('fontWeight', 'Weight')}
            </div>
          </div>

          <div className="property-pair">
            <div className="token-number-field" style={{ flex: 1 }}>
              <label className="property-number">
                <span>Leading</span>
                <input
                  type="number"
                  aria-label="Line height"
                  value={node.lineHeight}
                  min={0.1}
                  step={0.1}
                  onChange={event => {
                    const next = event.currentTarget.valueAsNumber
                    if (Number.isFinite(next) && next >= 0.1) update({ lineHeight: next })
                  }}
                />
              </label>
              {hasLineHeightOverride ? renderOverrideControls('Leading', 'properties.lineHeight') : binding?.('lineHeight', 'Line height')}
            </div>
            <div className="token-number-field" style={{ flex: 1 }}>
              <label className="property-number">
                <span>Tracking</span>
                <input
                  type="number"
                  aria-label="Letter spacing"
                  value={node.letterSpacing}
                  step={0.5}
                  onChange={event => {
                    const next = event.currentTarget.valueAsNumber
                    if (Number.isFinite(next)) update({ letterSpacing: next })
                  }}
                />
              </label>
              {hasLetterSpacingOverride ? renderOverrideControls('Tracking', 'properties.letterSpacing') : binding?.('letterSpacing', 'Tracking')}
            </div>
          </div>

          {/* Alignment & Transform */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="kerning-mode-group" style={{ flex: 1 }}>
              <button
                type="button"
                className={`kerning-mode-btn ${node.textAlign === 'left' ? 'is-active' : ''}`}
                onClick={() => update({ textAlign: 'left' })}
                title="Left Align"
                aria-label="Align left"
              >
                <AlignLeft size={12} style={{ margin: '0 auto' }} />
              </button>
              <button
                type="button"
                className={`kerning-mode-btn ${node.textAlign === 'center' ? 'is-active' : ''}`}
                onClick={() => update({ textAlign: 'center' })}
                title="Center Align"
                aria-label="Align center"
              >
                <AlignCenter size={12} style={{ margin: '0 auto' }} />
              </button>
              <button
                type="button"
                className={`kerning-mode-btn ${node.textAlign === 'right' ? 'is-active' : ''}`}
                onClick={() => update({ textAlign: 'right' })}
                title="Right Align"
                aria-label="Align right"
              >
                <AlignRight size={12} style={{ margin: '0 auto' }} />
              </button>
            </div>

            <div className="text-transform-group" style={{ flex: 1 }}>
              {(['none', 'uppercase', 'lowercase', 'capitalize'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`text-transform-btn ${(node.textTransform ?? 'none') === mode ? 'is-active' : ''}`}
                  onClick={() => update({ textTransform: mode })}
                  title={`Transform: ${mode}`}
                >
                  {mode === 'none' ? '—' : mode === 'uppercase' ? 'AA' : mode === 'lowercase' ? 'aa' : 'Aa'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Variable Font Axis Sliders */}
      {tab === 'axes' && (
        <div className="typography-tab-pane">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--paper-text-secondary)' }}>Variable Font Axes</span>
            {hasVariableAxesOverride && renderOverrideControls('Axes', 'properties.variableAxes')}
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                update({
                  variableAxes: { wght: 400, wdth: 100, slnt: 0, opsz: node.fontSize },
                  fontWeight: 400,
                })
              }}
              title="Reset axes to defaults"
              style={{ fontSize: 10 }}
            >
              <RotateCcw size={10} style={{ marginRight: 3 }} />
              Reset
            </button>
          </div>

          <div className="typo-chips-scroll" role="toolbar" aria-label="Variable Axis Presets">
            {VARIABLE_AXIS_PRESETS.map(preset => {
              const matches = preset.axes.wght === axes.wght && preset.axes.wdth === axes.wdth && preset.axes.slnt === axes.slnt
              return (
                <button
                  key={preset.name}
                  type="button"
                  className={`typo-chip ${matches ? 'is-active' : ''}`}
                  onClick={() => {
                    update({
                      variableAxes: { ...preset.axes },
                      fontWeight: preset.axes.wght ?? node.fontWeight,
                    })
                  }}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              )
            })}
          </div>

          <p className="typo-hint">{fontInfo?.font ? `${fontInfo.font.familyName} · ${Object.keys(fontInfo.font.variationAxes).join(', ') || 'static font'}. Ranges read from the font.` : 'Axes require a variable font installed on this device, or an imported font. Each typeface supports its own ranges.'}</p>
          {fontInfo?.error && <p className="typo-hint" role="alert">{fontInfo.error}</p>}
          {(['wght', 'wdth', 'slnt', 'opsz'] as const).map(tag => {
            const supported = fontInfo?.font?.variationAxes[tag]
            const disabled = !!fontInfo?.font && !supported
            const meta = { ...VARIABLE_AXES_META[tag], ...supported }
            const value = axes[tag] ?? meta.default
            return <div className="axis-slider-row" key={tag}>
              <div
                className={`axis-slider-header ${disabled ? '' : 'is-scrubbable'}`}
                onPointerDown={disabled ? undefined : e => handleScrubHeader(e, tag, value, meta.min, meta.max, meta.step)}
                title={disabled ? undefined : `Drag horizontally to scrub ${meta.label} (${meta.min}..${meta.max}${meta.unit ?? ''}). Shift for fine, Alt for coarse.`}
              >
                <span className="axis-label-name">{meta.label}{disabled ? ' · unavailable' : ''}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="axis-tag-badge">{meta.tag}</span>
                  <span className="axis-val-display">{meta.step < 1 ? Number(value.toFixed(2)) : Math.round(value)}{meta.unit ?? ''}</span>
                </div>
              </div>
              <div className="axis-slider-track">
                <input type="range" className="axis-slider-input" disabled={disabled} aria-label={`Variable ${meta.label.toLowerCase()} axis`} min={meta.min} max={meta.max} step={meta.step} value={value} onChange={event => updateAxis(tag, event.currentTarget.valueAsNumber)} />
                <input type="number" className="axis-num-input" disabled={disabled} aria-label={`${meta.label} value`} min={meta.min} max={meta.max} step={meta.step} value={value} onChange={event => updateAxis(tag, event.currentTarget.valueAsNumber)} />
              </div>
              {tag === 'opsz' && <div className="axis-optical-actions">
                <button type="button" className="quiet-button" aria-pressed={node.variableAxes?.opsz === undefined} onClick={() => removeAxis('opsz')}>Automatic optical size</button>
                <button type="button" className="quiet-button" onClick={() => updateAxis('opsz', node.fontSize)}>Match size</button>
              </div>}
            </div>
          })}
          <div className="opentype-preview-box">
            <span className="opentype-preview-label">Live specimen</span>
            <div
              className="opentype-preview-text"
              style={{
                fontFamily: node.fontFamily,
                fontVariationSettings: compileFontVariationSettings(node.variableAxes, node.fontWeight),
                fontOpticalSizing: node.variableAxes?.opsz === undefined ? 'auto' : 'none',
                fontStretch: node.variableAxes?.wdth && node.variableAxes.wdth !== 100 ? `${node.variableAxes.wdth}%` : undefined,
              }}
            >
              {node.text || 'Aa / 012345'}
            </div>
          </div>

          {/* Extended & Custom Variable Axes */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button
              type="button"
              className="quiet-button"
              style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setShowExtendedAxes(!showExtendedAxes)}
            >
              <span>{showExtendedAxes ? 'Hide Extended & Custom Axes' : 'Show Extended & Custom Axes (GRAD, CASL, CRSV, etc.)'}</span>
            </button>
          </div>

          {showExtendedAxes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {/* Quick Add registered axes chips */}
              <div className="typo-chips-scroll" role="toolbar" aria-label="Quick add registered axes">
                {[
                  { tag: 'grad', label: '+ Grade' },
                  { tag: 'casl', label: '+ Casual' },
                  { tag: 'crsv', label: '+ Cursive' },
                  { tag: 'ital', label: '+ Italic' },
                  { tag: 'soft', label: '+ Softness' },
                  { tag: 'fill', label: '+ Fill' },
                  { tag: 'xtra', label: '+ Counter' },
                ].map(item => {
                  const isActive = node.variableAxes && (node.variableAxes[item.tag] !== undefined || node.variableAxes[item.tag.toUpperCase()] !== undefined)
                  return (
                    <button
                      key={item.tag}
                      type="button"
                      disabled={isActive}
                      className={`typo-chip ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        const meta = VARIABLE_AXES_META[item.tag]
                        if (meta) updateAxis(item.tag, meta.default)
                      }}
                      title={isActive ? `${item.label} is already active` : `Add ${item.label} axis`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>

              {/* Render all active non-core axes dynamically */}
              {Object.entries(axes)
                .filter(([tag]) => !['wght', 'wdth', 'slnt', 'opsz'].includes(tag.toLowerCase()))
                .map(([tag, val]) => {
                  const meta = VARIABLE_AXES_META[tag] ?? VARIABLE_AXES_META[tag.toLowerCase()] ?? {
                    tag: tag.toUpperCase(),
                    label: tag.toUpperCase(),
                    min: 0,
                    max: 1000,
                    step: 1,
                    default: 0,
                    unit: '',
                  }
                  const numVal = val ?? meta.default
                  return (
                    <div key={tag} className="axis-slider-row">
                      <div
                        className="axis-slider-header is-scrubbable"
                        onPointerDown={e => handleScrubHeader(e, tag, numVal, meta.min, meta.max, meta.step)}
                        title={`Drag horizontally to scrub ${meta.label} (${meta.min}..${meta.max}${meta.unit ?? ''}). Shift for fine, Alt for coarse.`}
                      >
                        <span className="axis-label-name">{meta.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="axis-tag-badge">{meta.tag}</span>
                          <span className="axis-val-display">
                            {meta.step < 1 ? Number(numVal.toFixed(2)) : Math.round(numVal)}{meta.unit ?? ''}
                          </span>
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={e => {
                              e.stopPropagation()
                              removeAxis(tag)
                            }}
                            title={`Remove axis ${tag}`}
                            aria-label={`Remove axis ${tag}`}
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                      <div className="axis-slider-track">
                        <input
                          type="range"
                          className="axis-slider-input"
                          aria-label={`Variable ${meta.label.toLowerCase()} axis`}
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          value={numVal}
                          onChange={event => updateAxis(tag, event.currentTarget.valueAsNumber)}
                        />
                        <input
                          type="number"
                          className="axis-num-input"
                          aria-label={`${meta.label} value`}
                          value={meta.step < 1 ? Number(numVal.toFixed(2)) : Math.round(numVal)}
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          onChange={event => {
                            const val = event.currentTarget.valueAsNumber
                            if (Number.isFinite(val)) updateAxis(tag, val)
                          }}
                        />
                      </div>
                    </div>
                  )
                })}

              {/* Add Custom Axis Input */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                <input
                  type="text"
                  className="property-input"
                  style={{ width: 60, textTransform: 'uppercase', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                  maxLength={4}
                  placeholder="TAG"
                  aria-label="Custom axis tag"
                  value={newAxisTag}
                  onChange={event => setNewAxisTag(event.currentTarget.value.toUpperCase())}
                />
                <input
                  type="number"
                  className="property-input"
                  style={{ flex: 1, fontSize: 10 }}
                  placeholder="Value"
                  aria-label="Custom axis initial value"
                  value={newAxisVal}
                  onChange={event => setNewAxisVal(event.currentTarget.valueAsNumber || 0)}
                />
                <button
                  type="button"
                  className="quiet-button"
                  disabled={!/^[A-Z0-9_ ]{4}$/.test(newAxisTag)}
                  onClick={() => {
                    if (/^[A-Z0-9_ ]{4}$/.test(newAxisTag)) {
                      updateAxis(newAxisTag, newAxisVal)
                      setNewAxisTag('')
                      setNewAxisVal(0)
                    }
                  }}
                  title="Add custom 4-character OpenType axis tag"
                >
                  <Plus size={11} style={{ marginRight: 2 }} />
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: OpenType Feature Toggles */}
      {tab === 'opentype' && (
        <div className="typography-tab-pane">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--paper-text-secondary)' }}>
              {activeOtCount} active feature{activeOtCount === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={resetOtFeatures}
              title="Reset to standard ligatures"
              style={{ fontSize: 10 }}
            >
              <RotateCcw size={10} style={{ marginRight: 3 }} />
              Reset
            </button>
          </div>

          {/* Quick Recipes Toolbar */}
          <div className="typo-chips-scroll" role="toolbar" aria-label="OpenType Recipes">
            {OPENTYPE_RECIPES.map(recipe => (
              <button
                key={recipe.id}
                type="button"
                className="typo-chip"
                onClick={() => update({ openTypeFeatures: { ...recipe.features } })}
                title={recipe.description}
              >
                {recipe.name}
              </button>
            ))}
          </div>

          {/* Primary OpenType Features: liga, calt, frac, tnum */}
          <div className="core-opentype-section">
            <span className="opentype-section-title">Essential Typography Features</span>
            <div className="opentype-grid" role="group" aria-label="Essential OpenType Features">
              {[
                { tag: 'liga', name: 'Standard Ligatures', sample: 'fi fl ffi', desc: 'Combines adjacent glyphs to prevent collisions' },
                { tag: 'calt', name: 'Contextual Alternates', sample: '-> => !=', desc: 'Context-sensitive programming arrows & glyph connections' },
                { tag: 'frac', name: 'Fractions', sample: '1/2 3/4 7/8', desc: 'Converts numbers into true diagonal fractions' },
                { tag: 'tnum', name: 'Tabular Figures', sample: '$1,420.00', desc: 'Uniform digit widths for aligned numerical tables' },
              ].map(feat => {
                const active = otFeatures[feat.tag] ?? (feat.tag === 'liga' ? true : false)
                return (
                  <div
                    key={feat.tag}
                    className={`opentype-toggle-card ${active ? 'is-active' : ''}`}
                    onClick={() => toggleOtFeature(feat.tag)}
                    title={`${feat.name}: ${feat.desc}`}
                    role="checkbox"
                    aria-checked={active}
                    tabIndex={0}
                    data-testid={`ot-feature-${feat.tag}`}
                    onKeyDown={event => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault()
                        toggleOtFeature(feat.tag)
                      }
                    }}
                  >
                    <div className="opentype-toggle-left">
                      <span className="opentype-tag">{feat.tag}</span>
                      <span className="opentype-name">{feat.name}</span>
                      <span className="opentype-sample">{feat.sample}</span>
                    </div>
                    <div className="opentype-switch">
                      {active && <Check size={10} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Extended Feature Catalog */}
          <div className="core-opentype-section" style={{ marginTop: 4 }}>
            <span className="opentype-section-title">Extended Catalog</span>
            <div className="opentype-grid" role="group" aria-label="Extended OpenType Feature Toggles">
              {OPENTYPE_CATALOG.filter(f => !PRIMARY_OPENTYPE_TAGS.includes(f.tag as typeof PRIMARY_OPENTYPE_TAGS[number])).map(feat => {
                const active = otFeatures[feat.tag] ?? false
                return (
                  <div
                    key={feat.tag}
                    className={`opentype-toggle-card ${active ? 'is-active' : ''}`}
                    onClick={() => toggleOtFeature(feat.tag)}
                    title={`${feat.name}: ${feat.description}`}
                    role="checkbox"
                    aria-checked={active}
                    tabIndex={0}
                    data-testid={`ot-feature-${feat.tag}`}
                    onKeyDown={event => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault()
                        toggleOtFeature(feat.tag)
                      }
                    }}
                  >
                    <div className="opentype-toggle-left">
                      <span className="opentype-tag">{feat.tag}</span>
                      <span className="opentype-name">{feat.name}</span>
                      <span className="opentype-sample">{feat.sample}</span>
                    </div>
                    <div className="opentype-switch">
                      {active && <Check size={10} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Interactive OpenType Preview Sandbox */}
          <div className="opentype-preview-box">
            <span className="opentype-preview-label">Live OpenType Sandbox</span>
            <div
              className="opentype-preview-text"
              style={{
                fontFamily: node.fontFamily,
                fontVariationSettings: compileFontVariationSettings(axes, node.fontWeight),
                fontFeatureSettings: compileFontFeatureSettings(otFeatures),
              }}
            >
              {sampleText}
            </div>
            <input
              type="text"
              className="property-input"
              style={{ padding: '3px 6px', fontSize: 10, marginTop: 4 }}
              value={sampleText}
              onChange={event => setSampleText(event.currentTarget.value)}
              placeholder="Test glyphs..."
            />
          </div>
        </div>
      )}

      {/* Tab 4: Optical Kerning & Tracking */}
      {tab === 'kerning' && (
        <div className="typography-tab-pane">
          <label className="property-label">
            Kerning Mode
            <div className="kerning-mode-group" style={{ marginTop: 4 }}>
              {(['auto', 'normal', 'optical', 'none'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`kerning-mode-btn ${currentKerning === mode ? 'is-active' : ''}`}
                  onClick={() => update({ fontKerning: mode })}
                >
                  {mode === 'auto' ? 'Auto' : mode === 'normal' ? 'Metric' : mode === 'optical' ? 'Optical' : 'None'}
                </button>
              ))}
            </div>
          </label>

          {currentKerning === 'optical' && (
            <div className="axis-slider-row">
              <div className="axis-slider-header">
                <span className="axis-label-name">Optical Adjustment</span>
                <span className="axis-val-display">{(node.opticalKerning ?? 0).toFixed(0)}</span>
              </div>
              <div className="axis-slider-track">
                <input
                  type="range"
                  className="axis-slider-input"
                  min={-50}
                  max={50}
                  step={1}
                  value={node.opticalKerning ?? 0}
                  onChange={event => update({ opticalKerning: event.currentTarget.valueAsNumber })}
                />
              </div>
            </div>
          )}

          <div className="axis-slider-row">
            <div className="axis-slider-header">
              <span className="axis-label-name">Letter Spacing (Tracking)</span>
              <span className="axis-val-display">{node.letterSpacing.toFixed(1)}px</span>
            </div>
            <div className="axis-slider-track">
              <input
                type="range"
                className="axis-slider-input"
                min={-10}
                max={30}
                step={0.5}
                value={node.letterSpacing}
                onChange={event => update({ letterSpacing: event.currentTarget.valueAsNumber })}
              />
            </div>
          </div>

          {/* On-Canvas Optical Guides Toggle */}
          <div className="setting-row">
            <span>On-canvas optical metrics guides</span>
            <button
              type="button"
              className={`grid-switch ${node.showOpticalMetrics ? 'on' : ''}`}
              role="switch"
              aria-checked={Boolean(node.showOpticalMetrics)}
              aria-label="Toggle on-canvas optical metrics guides"
              onClick={() => update({ showOpticalMetrics: !node.showOpticalMetrics })}
            >
              <span />
            </button>
          </div>

          {/* Optical Margin Alignment Toggle */}
          <div className="setting-row">
            <span>Optical margin alignment</span>
            <button
              type="button"
              className={`grid-switch ${node.opticalMarginAlignment ? 'on' : ''}`}
              role="switch"
              aria-checked={Boolean(node.opticalMarginAlignment)}
              aria-label="Toggle optical margin alignment"
              onClick={() => update({ opticalMarginAlignment: !node.opticalMarginAlignment })}
            >
              <span />
            </button>
          </div>

          {/* Glyph-Level Optical Metrics HUD Card */}
          <div className="optical-metrics-hud" data-testid="optical-metrics-hud">
            <div className="optical-hud-header">
              <span className="optical-hud-title">Glyph Optical Metrics</span>
              <span className="axis-tag-badge">{opticalMetrics.characterCount} Chars · {opticalMetrics.glyphCount} Glyphs</span>
            </div>
            <div className="optical-hud-grid">
              <div className="optical-hud-cell" title="Cap Height: height of flat capital letters">
                <span className="optical-hud-label">Cap H</span>
                <span className="optical-hud-val">{opticalMetrics.capHeight}px</span>
              </div>
              <div className="optical-hud-cell" title="X-Height: height of lowercase letter x">
                <span className="optical-hud-label">x-H</span>
                <span className="optical-hud-val">{opticalMetrics.xHeight}px</span>
              </div>
              <div className="optical-hud-cell" title="Baseline: baseline coordinate">
                <span className="optical-hud-label">Base</span>
                <span className="optical-hud-val">{opticalMetrics.baseline}px</span>
              </div>
              <div className="optical-hud-cell" title="Descent: descender depth">
                <span className="optical-hud-label">Desc</span>
                <span className="optical-hud-val">{opticalMetrics.descent}px</span>
              </div>
            </div>
            <div className="optical-hud-grid">
              <div className="optical-hud-cell" title="Kerning Pairs count">
                <span className="optical-hud-label">Pairs</span>
                <span className="optical-hud-val">{opticalMetrics.kerningPairCount}</span>
              </div>
              <div className="optical-hud-cell" title="Average optical kerning adjustment">
                <span className="optical-hud-label">Avg Kern</span>
                <span className="optical-hud-val">{opticalMetrics.averageKerningDelta}px</span>
              </div>
              <div className="optical-hud-cell" title="Width stretch percentage">
                <span className="optical-hud-label">Width</span>
                <span className="optical-hud-val">{(opticalMetrics.widthStretchRatio * 100).toFixed(0)}%</span>
              </div>
              <div className="optical-hud-cell" title="Slant angle in degrees">
                <span className="optical-hud-label">Slant</span>
                <span className="optical-hud-val">{opticalMetrics.slantAngle}°</span>
              </div>
            </div>
          </div>

          <div className="opentype-preview-box">
            <span className="opentype-preview-label">Pairwise Kerning Preview</span>
            <div
              className="opentype-preview-text"
              style={{
                ...compileTypographyStyles(node),
                fontSize: 15,
              }}
            >
              AV WA To Ly 1984
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Dynamic Text-on-Vector Path Deformation */}
      {tab === 'path' && (
        <div className="typography-tab-pane">
          <div className="path-deformation-toggle">
            <span>Flow Text along Vector Path</span>
            <button
              type="button"
              className={`grid-switch ${top.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={top.enabled}
              aria-label="Toggle text-on-path deformation"
              onClick={() => {
                update({
                  textOnPath: {
                    ...top,
                    enabled: !top.enabled,
                  },
                })
              }}
            >
              <span />
            </button>
          </div>

          {top.enabled && (
            <>
              {/* Curve Presets */}
              <TextPathEditor key={`${node.id}:${top.pathId ?? 'local'}`} store={store} node={node} />
              <label className="property-label">
                Curve Presets
                <div className="path-presets-grid" style={{ marginTop: 4 }}>
                  {PATH_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      aria-label={preset.label}
                      aria-pressed={top.preset === preset.id && !top.pathId}
                      type="button"
                      className={`path-preset-btn ${top.preset === preset.id && !top.pathId ? 'is-active' : ''}`}
                      onClick={() => {
                        update({
                          textOnPath: {
                            ...top,
                            preset: preset.id,
                            pathId: null,
                            pathData: preset.id === 'custom' ? top.pathData : undefined,
                          },
                        })
                      }}
                    >
                      {preset.id === 'custom' ? <span aria-hidden="true">{preset.icon}</span> : <svg viewBox="-3 -3 102 46" aria-hidden="true"><path d={generatePathPreset(preset.id, 96, 40)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </label>

              {/* Attach to Canvas Vector layer (Path, Rectangle, Ellipse) */}
              {(canvasVectorLayers.length > 0 || top.pathId) && (
                <label className="property-label">
                  Link Canvas Vector Node
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <select
                      className="property-input"
                      aria-label="Target canvas vector node"
                      value={top.pathId ?? ''}
                      onChange={event => {
                        const targetId = event.currentTarget.value || null
                        update({
                          textOnPath: {
                            ...top,
                            pathId: targetId,
                          },
                        })
                      }}
                    >
                      <option value="">None (Use Preset Curve)</option>
                      {canvasVectorLayers.map(layer => (
                        <option key={layer.id} value={layer.id}>
                          {layer.type === 'rectangle' ? '▭' : layer.type === 'ellipse' ? '○' : '◇'} {layer.name} ({layer.type})
                        </option>
                      ))}
                    </select>
                    {top.pathId && (
                      <button
                        type="button"
                        className="quiet-button"
                        title="Detach from vector layer"
                        onClick={() => {
                          update({
                            textOnPath: {
                              ...top,
                              pathId: null,
                            },
                          })
                        }}
                      >
                        <Unlink size={12} />
                      </button>
                    )}
                  </div>
                </label>
              )}

              {top.preset === 'custom' && !top.pathId && <label className="property-label">Bézier path data
                <textarea key={node.id + top.pathData} className="property-textarea property-mono" aria-label="Custom text path data" defaultValue={top.pathData ?? ''} placeholder="M 0 120 C 80 0 240 240 360 120" onBlur={event => {
                  const d = event.currentTarget.value.trim()
                  try {
                    if (d && !parsePath(d).some(contour => contour.anchors.length > 1)) throw new Error('Add at least two anchors.')
                    update({ textOnPath: { ...top, pathData: d } })
                    setPathError('')
                  } catch { setPathError('Enter a valid SVG path with at least two anchors.') }
                }} />
              </label>}
              {pathError && <p className="typo-hint" role="alert">{pathError}</p>}
              {top.pathId && !canvasVectorLayers.some(layer => layer.id === top.pathId) && <p className="typo-hint">Linked vector node is unavailable. Showing the fallback curve.</p>}
              {/* Path Tracking */}
              <div className="axis-slider-row">
                <div className="axis-slider-header">
                  <span className="axis-label-name">Path Tracking</span>
                  <span className="axis-val-display">{(top.spacing ?? 0).toFixed(1)}px</span>
                </div>
                <div className="axis-slider-track">
                  <input
                    type="range"
                    className="axis-slider-input"
                    aria-label="Path letter spacing slider"
                    min={-10}
                    max={40}
                    step={0.5}
                    value={top.spacing ?? 0}
                    onChange={event => {
                      const spacing = event.currentTarget.valueAsNumber
                      if (Number.isFinite(spacing)) update({ textOnPath: { ...top, spacing } })
                    }}
                  />
                  <input
                    type="number"
                    className="axis-num-input"
                    aria-label="Path letter spacing value"
                    value={top.spacing ?? 0}
                    step={0.5}
                    onChange={event => {
                      const spacing = event.currentTarget.valueAsNumber
                      if (Number.isFinite(spacing)) update({ textOnPath: { ...top, spacing } })
                    }}
                  />
                </div>
              </div>

              {/* Start Offset Slider & Mode Selector */}
              <div className="axis-slider-row">
                <div className="axis-slider-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="axis-label-name">Start Offset</span>
                    <div className="kerning-mode-group" style={{ height: 18 }}>
                      <button
                        type="button"
                        className={`kerning-mode-btn ${(top.offsetMode ?? 'percent') === 'percent' ? 'is-active' : ''}`}
                        style={{ padding: '0 4px', fontSize: 9 }}
                        onClick={() => update({ textOnPath: { ...top, offsetMode: 'percent' } })}
                        title="Offset in percentage"
                      >
                        %
                      </button>
                      <button
                        type="button"
                        className={`kerning-mode-btn ${top.offsetMode === 'pixels' ? 'is-active' : ''}`}
                        style={{ padding: '0 4px', fontSize: 9 }}
                        onClick={() => update({ textOnPath: { ...top, offsetMode: 'pixels' } })}
                        title="Offset in pixels"
                      >
                        px
                      </button>
                    </div>
                  </div>
                  <span className="axis-val-display">
                    {top.offsetMode === 'pixels'
                      ? `${Math.round(top.offset ?? 0)}px`
                      : `${Math.round(textPathOffset(node))}%`}
                  </span>
                </div>
                <div className="axis-slider-track">
                  <input
                    type="range"
                    className="axis-slider-input"
                    aria-label="Text on path start offset"
                    min={top.offsetMode === 'pixels' ? -200 : 0}
                    max={top.offsetMode === 'pixels' ? 800 : 100}
                    step={1}
                    value={top.offsetMode === 'pixels' ? (top.offset ?? 0) : textPathOffset(node)}
                    onChange={event => {
                      update({
                        textOnPath: {
                          ...top,
                          offset: event.currentTarget.valueAsNumber,
                        },
                      })
                    }}
                  />
                  <input
                    type="number"
                    className="axis-num-input"
                    aria-label="Start offset value"
                    value={top.offsetMode === 'pixels' ? Math.round(top.offset ?? 0) : Math.round(textPathOffset(node))}
                    step={1}
                    onChange={event => {
                      const val = event.currentTarget.valueAsNumber
                      if (Number.isFinite(val)) {
                        update({
                          textOnPath: {
                            ...top,
                            offset: val,
                          },
                        })
                      }
                    }}
                  />
                </div>
              </div>

              {/* Baseline Shift Slider (Normal Offset) */}
              <div className="axis-slider-row">
                <div className="axis-slider-header">
                  <span className="axis-label-name">Baseline Shift (Normal)</span>
                  <span className="axis-val-display">{Math.round(top.baselineShift ?? 0)}px</span>
                </div>
                <div className="axis-slider-track">
                  <input
                    type="range"
                    className="axis-slider-input"
                    aria-label="Text on path baseline shift"
                    min={-60}
                    max={60}
                    step={1}
                    value={top.baselineShift ?? 0}
                    onChange={event => {
                      update({
                        textOnPath: {
                          ...top,
                          baselineShift: event.currentTarget.valueAsNumber,
                        },
                      })
                    }}
                  />
                  <input
                    type="number"
                    className="axis-num-input"
                    aria-label="Baseline shift value"
                    value={Math.round(top.baselineShift ?? 0)}
                    min={-100}
                    max={100}
                    step={1}
                    onChange={event => {
                      const val = event.currentTarget.valueAsNumber
                      if (Number.isFinite(val)) {
                        update({
                          textOnPath: {
                            ...top,
                            baselineShift: val,
                          },
                        })
                      }
                    }}
                  />
                </div>
              </div>

              {/* Side & Direction */}
              <div style={{ display: 'flex', gap: 6 }}>
                <div className="kerning-mode-group" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`kerning-mode-btn ${(top.side ?? 'left') === 'left' ? 'is-active' : ''}`}
                    onClick={() => update({ textOnPath: { ...top, side: 'left' } })}
                    title="Normal side"
                  >
                    Top Side
                  </button>
                  <button
                    type="button"
                    className={`kerning-mode-btn ${top.side === 'right' ? 'is-active' : ''}`}
                    onClick={() => update({ textOnPath: { ...top, side: 'right' } })}
                    title="Invert to bottom side"
                  >
                    Bottom Side
                  </button>
                </div>

                <button
                  type="button"
                  className={`text-transform-btn ${top.reverse ? 'is-active' : ''}`}
                  style={{ flex: '0 0 auto', padding: '0 8px' }}
                  onClick={() => update({ textOnPath: { ...top, reverse: !top.reverse } })}
                  title="Reverse path trajectory"
                >
                  Reverse
                </button>
              </div>

              {/* Path Alignment */}
              <div className="kerning-mode-group">
                <button
                  type="button"
                  className={`kerning-mode-btn ${(top.align ?? 'start') === 'start' ? 'is-active' : ''}`}
                  onClick={() => update({ textOnPath: { ...top, align: 'start', offset: 0 } })}
                >
                  Start
                </button>
                <button
                  type="button"
                  className={`kerning-mode-btn ${top.align === 'center' ? 'is-active' : ''}`}
                  onClick={() => update({ textOnPath: { ...top, align: 'center', offset: 50 } })}
                >
                  Center
                </button>
                <button
                  type="button"
                  className={`kerning-mode-btn ${top.align === 'end' ? 'is-active' : ''}`}
                  onClick={() => update({ textOnPath: { ...top, align: 'end', offset: 100 } })}
                >
                  End
                </button>
                <button
                  type="button"
                  className={`kerning-mode-btn ${top.align === 'justify' ? 'is-active' : ''}`}
                  onClick={() => update({ textOnPath: { ...top, align: 'justify', offset: 0 } })}
                >
                  Justify
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
