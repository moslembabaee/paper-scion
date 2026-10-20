import { useState, useMemo } from 'react'
import {
  ArrowRight,
  Check,
  Code,
  Copy,
  Download,
  FileCode,
  Layers,
  Palette,
  Plus,
  Search,
  Trash2,
  Upload,
  Variable,
  Wand2,
  X,
} from 'lucide-react'
import { Dialog } from '../workspace/Dialog'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import type { SceneElement } from '../scene/types'
import {
  TOKEN_META,
  tokenCSSValue,
  tokenVariable,
} from './model'
import {
  buildTokenModeMatrix,
  ensureStandardModes,
  autoBindMatchingNodes,
  createTokenFromNode,
} from './engine'
import {
  exportToTailwindV4,
  exportToTailwindV3,
  exportToCSSVariables,
  exportToDTCGJson,
  exportToTypeScript,
  importTokensFromCode,
  downloadTokenFile,
  copyTokensToClipboard,
  type TokenExportFormat,
} from './export'
import type { TokenInput, TokenType } from './types'
import './tokenManagerModal.css'

export interface TokenManagerModalProps {
  store: SceneStore
  onClose: () => void
  initialTab?: 'matrix' | 'tokens' | 'assistant' | 'export'
}

type TabKey = 'matrix' | 'tokens' | 'assistant' | 'export'
type FilterChip = 'all' | 'color' | 'typography' | 'spacing' | 'radius' | 'elevation' | 'layout'

const CHIP_TYPES: Record<FilterChip, TokenType[] | null> = {
  all: null,
  color: ['color'],
  typography: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'],
  spacing: ['spacing'],
  radius: ['radius'],
  elevation: ['elevation'],
  layout: ['container', 'breakpoint'],
}

function TokenPreviewSwatch({ token, size = 20 }: { token: { type: TokenType; value: string | number }; size?: number }) {
  if (token.type === 'color') {
    return (
      <div
        className="token-matrix-swatch"
        style={{
          width: size,
          height: size,
          backgroundColor: String(token.value),
          border: '1px solid var(--paper-border-strong)',
          borderRadius: 4,
          flexShrink: 0,
        }}
        title={`Color: ${token.value}`}
      />
    )
  }
  if (token.type === 'radius') {
    const r = Math.min(Number(token.value) || 0, size / 2)
    return (
      <div
        className="token-matrix-swatch"
        style={{
          width: size,
          height: size,
          border: '1.5px solid var(--paper-text)',
          borderRadius: `${r}px`,
          background: 'var(--paper-hover)',
          flexShrink: 0,
        }}
        title={`Corner radius: ${token.value}px`}
      />
    )
  }
  if (token.type === 'elevation') {
    const elev = Number(token.value) || 0
    return (
      <div
        className="token-matrix-swatch"
        style={{
          width: size,
          height: size,
          background: 'var(--paper-surface)',
          borderRadius: 3,
          boxShadow: elev === 0 ? 'none' : `0 ${Math.min(elev, 5)}px ${Math.min(elev * 2, 10)}px rgba(0,0,0,0.3)`,
          border: '1px solid var(--paper-border)',
          flexShrink: 0,
        }}
        title={`Elevation shadow: ${token.value}px`}
      />
    )
  }
  if (token.type === 'spacing') {
    return (
      <div
        className="token-matrix-swatch"
        style={{
          width: size,
          height: size,
          background: 'var(--paper-input)',
          border: '1px solid var(--paper-border)',
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          color: 'var(--paper-text-muted)',
          flexShrink: 0,
        }}
        title={`Spacing: ${token.value}px`}
      >
        <span>{token.value}</span>
      </div>
    )
  }
  return (
    <div
      className="token-matrix-swatch"
      style={{
        width: size,
        height: size,
        background: 'var(--paper-input)',
        border: '1px solid var(--paper-border)',
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: token.type === 'fontSize' ? 10 : 9,
        fontWeight: token.type === 'fontWeight' ? (Number(token.value) || 600) : 600,
        fontFamily: token.type === 'fontFamily' ? String(token.value) : 'var(--font-mono)',
        color: 'var(--paper-text)',
        flexShrink: 0,
      }}
      title={`${token.type}: ${token.value}`}
    >
      <span>{['fontSize', 'fontFamily', 'fontWeight'].includes(token.type) ? 'Ag' : TOKEN_META[token.type].namespace.slice(0, 3)}</span>
    </div>
  )
}

export function TokenManagerModal({ store, onClose, initialTab = 'matrix' }: TokenManagerModalProps) {
  const snapshot = useScene(store, state => state)
  const { tokens, styleLibrary, elements, selection } = snapshot
  const activeThemeId = styleLibrary.activeThemeId

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [filterChip, setFilterChip] = useState<FilterChip>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Multi-Mode Matrix calculation
  const matrixRows = useMemo(() => {
    return buildTokenModeMatrix(tokens, styleLibrary, elements)
  }, [tokens, styleLibrary, elements])

  // Filtered rows
  const filteredMatrix = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const allowedTypes = CHIP_TYPES[filterChip]

    return matrixRows.filter(row => {
      if (allowedTypes && !allowedTypes.includes(row.token.type)) return false
      if (!q) return true
      const nameMatch = row.token.name.toLowerCase().includes(q)
      const varMatch = tokenVariable(row.token).toLowerCase().includes(q)
      const typeMatch = row.token.type.toLowerCase().includes(q)
      const valMatch = String(row.token.value).toLowerCase().includes(q)
      return nameMatch || varMatch || typeMatch || valMatch
    })
  }, [matrixRows, filterChip, searchQuery])

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<FilterChip, number> = {
      all: tokens.length,
      color: 0,
      typography: 0,
      spacing: 0,
      radius: 0,
      elevation: 0,
      layout: 0,
    }
    for (const t of tokens) {
      if (t.type === 'color') counts.color++
      else if (['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].includes(t.type)) counts.typography++
      else if (t.type === 'spacing') counts.spacing++
      else if (t.type === 'radius') counts.radius++
      else if (t.type === 'elevation') counts.elevation++
      else counts.layout++
    }
    return counts
  }, [tokens])

  // Inline token creation state
  const [newTokenType, setNewTokenType] = useState<TokenType>('color')
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenValue, setNewTokenValue] = useState('')
  const [creationError, setCreationError] = useState('')

  const handleCreateToken = (e: React.FormEvent) => {
    e.preventDefault()
    setCreationError('')
    const name = newTokenName.trim()
    if (!name) {
      setCreationError('Enter a token name (e.g. brand-primary)')
      return
    }

    try {
      const isString = newTokenType === 'color' || newTokenType === 'fontFamily'
      const val = isString ? (newTokenValue.trim() || (TOKEN_META[newTokenType].defaultValue as string)) : (parseFloat(newTokenValue) || (TOKEN_META[newTokenType].defaultValue as number))

      const draft = {
        type: newTokenType,
        name,
        value: val,
      } as unknown as TokenInput

      store.addToken(draft)
      setNewTokenName('')
      setNewTokenValue('')
      showToast(`Created token ${tokenVariable({ type: newTokenType, name })}`)
    } catch (err) {
      setCreationError(err instanceof Error ? err.message : String(err))
    }
  }

  // Quick theme creation
  const [isAddingMode, setIsAddingMode] = useState(false)
  const [newModeName, setNewModeName] = useState('')
  const handleAddMode = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newModeName.trim()
    if (!name) return
    const id = store.addTheme(name)
    store.setActiveTheme(id)
    setIsAddingMode(false)
    setNewModeName('')
    showToast(`Added theme mode: ${name}`)
  }

  // Auto-bind action
  const handleAutoBind = () => {
    const { boundCount, matchedTokens } = autoBindMatchingNodes(store)
    if (boundCount > 0) {
      showToast(`Auto-bound ${boundCount} properties (${matchedTokens.slice(0, 3).join(', ')}${matchedTokens.length > 3 ? '...' : ''})`)
    } else {
      showToast('No matching unbound styles found on canvas.')
    }
  }

  // Selected canvas element for assistant
  const selectedElement: SceneElement | undefined = selection.length === 1 ? elements[selection[0]] : undefined

  // Export formats
  const [exportFormat, setExportFormat] = useState<TokenExportFormat>('tailwind-v4')
  const [importCode, setImportCode] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [showImportBox, setShowImportBox] = useState(false)

  const exportedCode = useMemo(() => {
    switch (exportFormat) {
      case 'tailwind-v4': return exportToTailwindV4(tokens, styleLibrary)
      case 'tailwind-v3': return exportToTailwindV3(tokens, styleLibrary)
      case 'css-variables': return exportToCSSVariables(tokens, styleLibrary)
      case 'dtcg-json': return exportToDTCGJson(tokens, styleLibrary)
      case 'typescript': return exportToTypeScript(tokens, styleLibrary)
    }
  }, [exportFormat, tokens, styleLibrary])

  const handleCopyExport = async () => {
    const success = await copyTokensToClipboard(exportedCode)
    if (success) {
      showToast('Copied token definitions to clipboard!')
    } else {
      showToast('Failed to copy to clipboard.')
    }
  }

  const handleDownloadExport = () => {
    const extension = exportFormat === 'dtcg-json' ? 'json' : exportFormat === 'typescript' ? 'ts' : exportFormat === 'tailwind-v3' ? 'js' : 'css'
    const filename = `paper-tokens.${extension}`
    downloadTokenFile(filename, exportedCode)
    showToast(`Downloaded ${filename}`)
  }

  const handleImport = () => {
    setImportError(null)
    if (!importCode.trim()) return
    const result = importTokensFromCode(store, importCode)
    if (result.errors.length > 0) {
      setImportError(result.errors.join('; '))
    } else {
      showToast(`Imported ${result.importedCount} new tokens, updated ${result.updatedCount}`)
      setImportCode('')
      setShowImportBox(false)
    }
  }

  return (
    <Dialog className="token-manager-dialog" labelledBy="token-manager-title" onClose={onClose}>
      {/* Header */}
      <header className="token-modal-header">
        <div className="token-modal-title-area">
          <h2 id="token-manager-title" className="token-modal-title">
            <Variable size={16} />
            <span>Design Tokens & Themes</span>
            <span className="token-badge">{tokens.length} variables</span>
          </h2>

          {/* Document Theme Modes Bar */}
          <div className="token-modes-bar" role="group" aria-label="Document theme mode">
            <button
              type="button"
              className={`token-mode-pill ${activeThemeId === null ? 'active' : ''}`}
              onClick={() => store.setActiveTheme(null)}
              title="Base default theme values"
            >
              <span className="mode-indicator-dot" />
              <span>Base</span>
            </button>

            {styleLibrary.themes.map(theme => (
              <button
                key={theme.id}
                type="button"
                className={`token-mode-pill ${activeThemeId === theme.id ? 'active' : ''}`}
                onClick={() => store.setActiveTheme(theme.id)}
                title={`Switch active canvas theme to ${theme.name}`}
              >
                <span className="mode-indicator-dot" />
                <span>{theme.name}</span>
              </button>
            ))}

            {isAddingMode ? (
              <form onSubmit={handleAddMode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Mode name (e.g. OLED Dark)"
                  value={newModeName}
                  onChange={e => setNewModeName(e.target.value)}
                  style={{
                    background: 'var(--paper-surface)',
                    border: '1px solid var(--paper-border-strong)',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 11,
                    color: 'var(--paper-text)',
                    width: 140,
                  }}
                />
                <button
                  type="submit"
                  style={{
                    border: 'none',
                    background: 'var(--paper-accent)',
                    color: 'var(--paper-on-accent)',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingMode(false)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--paper-text-muted)', cursor: 'pointer' }}
                >
                  <X size={12} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="token-add-mode-btn"
                onClick={() => {
                  if (styleLibrary.themes.length === 0) {
                    ensureStandardModes(store)
                    showToast('Populated standard Light, Dark, High-Contrast modes!')
                  } else {
                    setIsAddingMode(true)
                  }
                }}
                title={styleLibrary.themes.length === 0 ? 'Initialize Light, Dark, High-Contrast modes' : 'Add custom theme mode'}
              >
                <Plus size={11} />
                <span>{styleLibrary.themes.length === 0 ? 'Standard Modes' : 'Mode'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="token-modal-actions">
          <button
            type="button"
            className="token-row-btn"
            aria-label="Close token manager"
            title="Close modal (Esc)"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Sub-nav bar: Tabs & Search */}
      <div className="token-subnav">
        <nav className="token-nav-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matrix'}
            className={`token-nav-tab ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <Layers size={13} />
            <span>Multi-Mode Matrix</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tokens'}
            className={`token-nav-tab ${activeTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            <Palette size={13} />
            <span>Tokens List</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'assistant'}
            className={`token-nav-tab ${activeTab === 'assistant' ? 'active' : ''}`}
            onClick={() => setActiveTab('assistant')}
          >
            <Wand2 size={13} />
            <span>Binding Assistant</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'export'}
            className={`token-nav-tab ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            <FileCode size={13} />
            <span>Export & Code</span>
          </button>
        </nav>

        <div className="token-subnav-tools">
          <div className="token-modal-search">
            <Search size={12} style={{ color: 'var(--paper-text-muted)' }} />
            <input
              type="text"
              placeholder="Search tokens or variables..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter chips (shown in Matrix & Tokens views) */}
      {(activeTab === 'matrix' || activeTab === 'tokens') && (
        <div className="token-type-chips">
          {(['all', 'color', 'typography', 'spacing', 'radius', 'elevation', 'layout'] as FilterChip[]).map(chip => (
            <button
              key={chip}
              type="button"
              className={`token-type-chip ${filterChip === chip ? 'active' : ''}`}
              onClick={() => setFilterChip(chip)}
            >
              <span style={{ textTransform: 'capitalize' }}>{chip}</span>
              <span className="chip-count">{categoryCounts[chip]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Inline Quick Token Creator Banner */}
      {(activeTab === 'matrix' || activeTab === 'tokens') && (
        <div className="token-creator-banner">
          <form onSubmit={handleCreateToken}>
            <select
              className="token-creator-input"
              value={newTokenType}
              onChange={e => setNewTokenType(e.target.value as TokenType)}
              aria-label="Token Type"
            >
              <option value="color">Color</option>
              <option value="radius">Radius</option>
              <option value="spacing">Spacing</option>
              <option value="fontSize">Font Size</option>
              <option value="fontFamily">Font Family</option>
              <option value="fontWeight">Font Weight</option>
              <option value="lineHeight">Line Height</option>
              <option value="letterSpacing">Letter Spacing</option>
              <option value="elevation">Elevation</option>
              <option value="container">Container</option>
              <option value="breakpoint">Breakpoint</option>
            </select>

            <input
              type="text"
              className="token-creator-input mono"
              placeholder="name (e.g. brand-accent)"
              value={newTokenName}
              onChange={e => setNewTokenName(e.target.value)}
              style={{ width: 170 }}
            />

            <input
              type="text"
              className="token-creator-input mono"
              placeholder={`value (${TOKEN_META[newTokenType].defaultValue})`}
              value={newTokenValue}
              onChange={e => setNewTokenValue(e.target.value)}
              style={{ width: 150 }}
            />

            <button
              type="submit"
              className="token-row-btn"
              style={{
                background: 'var(--paper-accent)',
                color: 'var(--paper-on-accent)',
                padding: '5px 12px',
                borderRadius: 5,
                fontWeight: 500,
              }}
            >
              <Plus size={13} />
              <span>Add Variable</span>
            </button>

            {creationError && (
              <span style={{ color: 'var(--paper-error, #c64b3f)', fontSize: 11, marginLeft: 8 }}>
                {creationError}
              </span>
            )}
          </form>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="token-row-btn"
              onClick={handleAutoBind}
              title="Automatically match canvas shapes to existing tokens and bind them"
              style={{
                border: '1px solid var(--paper-border-strong)',
                background: 'var(--paper-surface)',
                padding: '4px 10px',
                borderRadius: 5,
                fontSize: 11,
              }}
            >
              <Wand2 size={12} style={{ marginRight: 5 }} />
              <span>Auto-Bind Canvas</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      <div className="token-modal-content">
        {/* Tab 1: Multi-Mode Matrix View */}
        {activeTab === 'matrix' && (
          <div className="token-matrix-container">
            <table className="token-matrix-table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Variable</th>
                  <th style={{ width: 90 }}>Type</th>
                  <th style={{ width: 150 }}>Base Value</th>
                  <th style={{ width: 160 }}>Alias Target</th>
                  {styleLibrary.themes.map(theme => (
                    <th key={theme.id} style={{ minWidth: 140 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{theme.name}</span>
                        {activeThemeId === theme.id && (
                          <span style={{ fontSize: 9, color: 'var(--paper-accent-text)', textTransform: 'none' }}>(Active)</span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th style={{ width: 80, textAlign: 'center' }}>Bound</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMatrix.length === 0 ? (
                  <tr>
                    <td colSpan={6 + styleLibrary.themes.length} style={{ textAlign: 'center', padding: 40, color: 'var(--paper-text-muted)' }}>
                      No tokens found matching filter criteria. Create one using the form above!
                    </td>
                  </tr>
                ) : (
                  filteredMatrix.map(row => {
                    const { token, modeValues, boundCount } = row
                    const isColor = token.type === 'color'

                    return (
                      <tr key={token.id} className="token-matrix-row">
                        {/* Token name & variable code */}
                        <td>
                          <div className="token-matrix-name-cell">
                            <TokenPreviewSwatch token={token} size={20} />
                            <div className="token-matrix-name-info">
                              <span className="token-name-label">{token.name}</span>
                              <span className="token-variable-code">{tokenVariable(token)}</span>
                            </div>
                          </div>
                        </td>

                        {/* Type badge */}
                        <td>
                          <span className="token-type-badge">{token.type}</span>
                        </td>

                        {/* Base Value */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="mode-val-text">{tokenCSSValue(token)}</span>
                          </div>
                        </td>

                        {/* Alias Picker */}
                        <td>
                          <div className="token-alias-cell">
                            <select
                              className="token-alias-select"
                              value={token.aliasId ?? ''}
                              onChange={e => {
                                const targetId = e.target.value || undefined
                                store.updateToken(token.id, { aliasId: targetId })
                                showToast(targetId ? `Aliased ${token.name}` : `Detached alias for ${token.name}`)
                              }}
                              aria-label={`Alias for ${token.name}`}
                            >
                              <option value="">No alias (direct)</option>
                              {tokens
                                .filter(t => t.id !== token.id && t.type === token.type)
                                .map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </td>

                        {/* Per-Theme Mode Columns */}
                        {styleLibrary.themes.map(theme => {
                          const cell = modeValues[theme.id]
                          const themeOverride = token.themeValues?.[theme.id]
                          const themeAlias = token.themeAliases?.[theme.id]
                          const aliasTargetName = themeAlias ? tokens.find(t => t.id === themeAlias)?.name : undefined

                          return (
                            <td key={theme.id} className="mode-value-cell">
                              <div className="mode-value-content">
                                {isColor && (
                                  <div
                                    className="mode-color-dot"
                                    style={{ backgroundColor: String(cell?.value ?? token.value) }}
                                  />
                                )}
                                <span className="mode-val-text">
                                  {cell ? `${cell.value}${TOKEN_META[token.type].unit}` : tokenCSSValue(token)}
                                </span>

                                {cell?.isOverridden && (
                                  <span className="mode-override-indicator" title={aliasTargetName ? `Aliased to ${aliasTargetName}` : 'Explicit override for this mode'}>
                                    {aliasTargetName ? `-> ${aliasTargetName}` : 'Override'}
                                  </span>
                                )}
                                {cell?.isInherited && (
                                  <span className="mode-inherited-indicator" title="Inherits from base value">
                                    Inherited
                                  </span>
                                )}

                                {/* Edit mode override inline button */}
                                <button
                                  type="button"
                                  className="mode-cell-edit-btn"
                                  title={`Edit override in ${theme.name}`}
                                  onClick={() => {
                                    const currentVal = themeOverride ?? cell?.value ?? token.value
                                    const next = prompt(`Override value for ${token.name} in ${theme.name}:`, String(currentVal))
                                    if (next !== null) {
                                      if (next.trim() === '') {
                                        store.setTokenThemeValue(token.id, theme.id, undefined)
                                        showToast(`Reset ${token.name} to inherit in ${theme.name}`)
                                      } else {
                                        const parsed = token.type === 'color' || token.type === 'fontFamily' ? next.trim() : parseFloat(next)
                                        store.setTokenThemeValue(token.id, theme.id, parsed as any)
                                        showToast(`Updated ${token.name} in ${theme.name}`)
                                      }
                                    }
                                  }}
                                >
                                  <Code size={11} />
                                </button>
                              </div>
                            </td>
                          )
                        })}

                        {/* Bound nodes count */}
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`token-bound-count ${boundCount > 0 ? 'active' : ''}`}
                            title={`${boundCount} canvas element properties bound to this token`}
                          >
                            {boundCount}
                          </span>
                        </td>

                        {/* Row Actions */}
                        <td>
                          <div className="token-row-actions">
                            <button
                              type="button"
                              className="token-row-btn"
                              title="Duplicate token"
                              aria-label={`Duplicate ${token.name}`}
                              onClick={() => {
                                const dup = store.duplicateToken(token.id)
                                showToast(`Duplicated as ${dup.name}`)
                              }}
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              className="token-row-btn danger"
                              title="Delete token"
                              aria-label={`Delete ${token.name}`}
                              onClick={() => {
                                store.removeTokens([token.id])
                                showToast(`Deleted ${token.name}`)
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Tokens List View */}
        {activeTab === 'tokens' && (
          <div style={{ padding: 20, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {filteredMatrix.map(row => {
                const { token, boundCount } = row

                return (
                  <div
                    key={token.id}
                    style={{
                      background: 'var(--paper-hover)',
                      border: '1px solid var(--paper-border)',
                      borderRadius: 8,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TokenPreviewSwatch token={token} size={24} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{token.name}</div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--paper-text-muted)' }}>
                            {tokenVariable(token)}
                          </div>
                        </div>
                      </div>

                      <span className="token-type-badge">{token.type}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--paper-text-muted)' }}>Base Value:</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {tokenCSSValue(token)}
                      </span>
                    </div>

                    {token.aliasId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ color: 'var(--paper-text-muted)' }}>Alias:</span>
                        <span className="token-alias-tag">
                          <ArrowRight size={10} />
                          {tokens.find(t => t.id === token.aliasId)?.name ?? token.aliasId}
                        </span>
                      </div>
                    )}

                    {token.themeValues && Object.keys(token.themeValues).length > 0 && (
                      <div style={{ fontSize: 11, background: 'var(--paper-surface)', padding: '6px 8px', borderRadius: 5 }}>
                        <div style={{ color: 'var(--paper-text-muted)', marginBottom: 4, fontWeight: 500 }}>Mode Overrides:</div>
                        {Object.entries(token.themeValues).map(([tId, val]) => {
                          const themeName = styleLibrary.themes.find(t => t.id === tId)?.name ?? tId
                          return (
                            <div key={tId} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                              <span>{themeName}:</span>
                              <span>{val}{TOKEN_META[token.type].unit}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--paper-border)' }}>
                      <span className={`token-bound-count ${boundCount > 0 ? 'active' : ''}`}>
                        {boundCount} bound elements
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="token-row-btn"
                          title="Duplicate"
                          onClick={() => store.duplicateToken(token.id)}
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          type="button"
                          className="token-row-btn danger"
                          title="Delete"
                          onClick={() => store.removeTokens([token.id])}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Binding Assistant View */}
        {activeTab === 'assistant' && (
          <div className="token-inspector-view">
            {/* Auto-Bind Card */}
            <div className="binding-assistant-card">
              <div className="binding-assistant-header">
                <div className="binding-assistant-title">
                  <Wand2 size={15} style={{ color: 'var(--paper-accent-text)' }} />
                  <span>Automatic Canvas Node Style Binding</span>
                </div>
                <button
                  type="button"
                  onClick={handleAutoBind}
                  className="token-row-btn"
                  style={{
                    background: 'var(--paper-accent)',
                    color: 'var(--paper-on-accent)',
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontWeight: 500,
                    fontSize: 12,
                  }}
                >
                  <Wand2 size={13} style={{ marginRight: 6 }} />
                  Scan & Auto-Bind
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--paper-text-muted)', lineHeight: 1.5 }}>
                Scans all shapes, text layers, and frames across the canvas. When an element's literal fill, stroke,
                corner radius, font family, or font size matches an existing design variable token, Paper automatically
                creates the binding so the element updates with theme modes.
              </p>
            </div>

            {/* Selected Element Card */}
            {selectedElement ? (
              <div className="binding-assistant-card">
                <div className="binding-assistant-header">
                  <div className="binding-assistant-title">
                    <Layers size={15} />
                    <span>Selected Element: <strong>{selectedElement.name}</strong> ({selectedElement.type})</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Fill binding */}
                  {selectedElement.style?.fill && (
                    <div className="binding-prop-row">
                      <div className="binding-prop-name">Fill Color</div>
                      <div className="binding-prop-current">
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: selectedElement.style.fill }} />
                        <span>{selectedElement.style.fill}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          className="token-alias-select"
                          value={selectedElement.tokenBindings?.fill ?? ''}
                          onChange={e => {
                            if (e.target.value) store.bindToken(selectedElement.id, 'fill', e.target.value)
                            else store.detachToken(selectedElement.id, 'fill')
                          }}
                        >
                          <option value="">{selectedElement.tokenBindings?.fill ? 'Bound (choose to change)' : 'Unbound'}</option>
                          {tokens.filter(t => t.type === 'color').map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.value})</option>
                          ))}
                        </select>
                        {!selectedElement.tokenBindings?.fill && (
                          <button
                            type="button"
                            className="token-row-btn"
                            title="Extract as new color token"
                            onClick={() => {
                              const created = createTokenFromNode(store, selectedElement, 'fill')
                              if (created) showToast(`Created and bound token: ${created.name}`)
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stroke binding */}
                  {selectedElement.style?.stroke && (
                    <div className="binding-prop-row">
                      <div className="binding-prop-name">Stroke Color</div>
                      <div className="binding-prop-current">
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: selectedElement.style.stroke.color }} />
                        <span>{selectedElement.style.stroke.color}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          className="token-alias-select"
                          value={selectedElement.tokenBindings?.stroke ?? ''}
                          onChange={e => {
                            if (e.target.value) store.bindToken(selectedElement.id, 'stroke', e.target.value)
                            else store.detachToken(selectedElement.id, 'stroke')
                          }}
                        >
                          <option value="">{selectedElement.tokenBindings?.stroke ? 'Bound' : 'Unbound'}</option>
                          {tokens.filter(t => t.type === 'color').map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.value})</option>
                          ))}
                        </select>
                        {!selectedElement.tokenBindings?.stroke && (
                          <button
                            type="button"
                            className="token-row-btn"
                            title="Extract as new stroke token"
                            onClick={() => {
                              const created = createTokenFromNode(store, selectedElement, 'stroke')
                              if (created) showToast(`Created and bound token: ${created.name}`)
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Corner radius binding */}
                  {'cornerRadius' in selectedElement && typeof selectedElement.cornerRadius === 'number' && (
                    <div className="binding-prop-row">
                      <div className="binding-prop-name">Corner Radius</div>
                      <div className="binding-prop-current">{selectedElement.cornerRadius}px</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          className="token-alias-select"
                          value={selectedElement.tokenBindings?.cornerRadius ?? ''}
                          onChange={e => {
                            if (e.target.value) store.bindToken(selectedElement.id, 'cornerRadius', e.target.value)
                            else store.detachToken(selectedElement.id, 'cornerRadius')
                          }}
                        >
                          <option value="">{selectedElement.tokenBindings?.cornerRadius ? 'Bound' : 'Unbound'}</option>
                          {tokens.filter(t => t.type === 'radius').map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.value}px)</option>
                          ))}
                        </select>
                        {!selectedElement.tokenBindings?.cornerRadius && (
                          <button
                            type="button"
                            className="token-row-btn"
                            title="Extract as new radius token"
                            onClick={() => {
                              const created = createTokenFromNode(store, selectedElement, 'cornerRadius')
                              if (created) showToast(`Created and bound token: ${created.name}`)
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Elevation Shadow binding */}
                  <div className="binding-prop-row">
                    <div className="binding-prop-name">Elevation Shadow</div>
                    <div className="binding-prop-current">
                      {selectedElement.tokenBindings?.shadow
                        ? `${tokens.find(t => t.id === selectedElement.tokenBindings?.shadow)?.name ?? 'Bound'} (${selectedElement.style?.shadow?.y ?? 0}px)`
                        : selectedElement.style?.shadow
                          ? `${selectedElement.style.shadow.y}px (blur ${selectedElement.style.shadow.blur}px)`
                          : 'None'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select
                        className="token-alias-select"
                        value={selectedElement.tokenBindings?.shadow ?? ''}
                        onChange={e => {
                          if (e.target.value) store.bindToken(selectedElement.id, 'shadow', e.target.value)
                          else store.detachToken(selectedElement.id, 'shadow')
                        }}
                      >
                        <option value="">{selectedElement.tokenBindings?.shadow ? 'Bound (choose to change)' : 'Unbound'}</option>
                        {tokens.filter(t => t.type === 'elevation').map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.value}px)</option>
                        ))}
                      </select>
                      {!selectedElement.tokenBindings?.shadow && selectedElement.style?.shadow && (
                        <button
                          type="button"
                          className="token-row-btn"
                          title="Extract as new elevation token"
                          onClick={() => {
                            const val = selectedElement.style?.shadow?.y ?? 4
                            let name = 'elevation-custom'
                            let index = 1
                            while (tokens.some(t => t.type === 'elevation' && t.name === name)) name = `elevation-custom-${index++}`
                            const added = store.addToken({ type: 'elevation', name, value: val })
                            store.bindToken(selectedElement.id, 'shadow', added.id)
                            showToast(`Created and bound elevation token: ${added.name}`)
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Typography for text elements */}
                  {selectedElement.type === 'text' && (
                    <>
                      <div className="binding-prop-row">
                        <div className="binding-prop-name">Font Size</div>
                        <div className="binding-prop-current">{selectedElement.fontSize}px</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="token-alias-select"
                            value={selectedElement.tokenBindings?.fontSize ?? ''}
                            onChange={e => {
                              if (e.target.value) store.bindToken(selectedElement.id, 'fontSize', e.target.value)
                              else store.detachToken(selectedElement.id, 'fontSize')
                            }}
                          >
                            <option value="">{selectedElement.tokenBindings?.fontSize ? 'Bound' : 'Unbound'}</option>
                            {tokens.filter(t => t.type === 'fontSize').map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.value}px)</option>
                            ))}
                          </select>
                          {!selectedElement.tokenBindings?.fontSize && (
                            <button
                              type="button"
                              className="token-row-btn"
                              title="Extract as new fontSize token"
                              onClick={() => {
                                const created = createTokenFromNode(store, selectedElement, 'fontSize')
                                if (created) showToast(`Created and bound token: ${created.name}`)
                              }}
                            >
                              <Plus size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="binding-prop-row">
                        <div className="binding-prop-name">Font Family</div>
                        <div className="binding-prop-current">{selectedElement.fontFamily}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="token-alias-select"
                            value={selectedElement.tokenBindings?.fontFamily ?? ''}
                            onChange={e => {
                              if (e.target.value) store.bindToken(selectedElement.id, 'fontFamily', e.target.value)
                              else store.detachToken(selectedElement.id, 'fontFamily')
                            }}
                          >
                            <option value="">{selectedElement.tokenBindings?.fontFamily ? 'Bound' : 'Unbound'}</option>
                            {tokens.filter(t => t.type === 'fontFamily').map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="binding-prop-row">
                        <div className="binding-prop-name">Font Weight</div>
                        <div className="binding-prop-current">{selectedElement.fontWeight}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="token-alias-select"
                            value={selectedElement.tokenBindings?.fontWeight ?? ''}
                            onChange={e => {
                              if (e.target.value) store.bindToken(selectedElement.id, 'fontWeight', e.target.value)
                              else store.detachToken(selectedElement.id, 'fontWeight')
                            }}
                          >
                            <option value="">{selectedElement.tokenBindings?.fontWeight ? 'Bound' : 'Unbound'}</option>
                            {tokens.filter(t => t.type === 'fontWeight').map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.value})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="binding-prop-row">
                        <div className="binding-prop-name">Line Height</div>
                        <div className="binding-prop-current">{selectedElement.lineHeight}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="token-alias-select"
                            value={selectedElement.tokenBindings?.lineHeight ?? ''}
                            onChange={e => {
                              if (e.target.value) store.bindToken(selectedElement.id, 'lineHeight', e.target.value)
                              else store.detachToken(selectedElement.id, 'lineHeight')
                            }}
                          >
                            <option value="">{selectedElement.tokenBindings?.lineHeight ? 'Bound' : 'Unbound'}</option>
                            {tokens.filter(t => t.type === 'lineHeight').map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.value})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="binding-prop-row">
                        <div className="binding-prop-name">Letter Spacing</div>
                        <div className="binding-prop-current">{selectedElement.letterSpacing}px</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="token-alias-select"
                            value={selectedElement.tokenBindings?.letterSpacing ?? ''}
                            onChange={e => {
                              if (e.target.value) store.bindToken(selectedElement.id, 'letterSpacing', e.target.value)
                              else store.detachToken(selectedElement.id, 'letterSpacing')
                            }}
                          >
                            <option value="">{selectedElement.tokenBindings?.letterSpacing ? 'Bound' : 'Unbound'}</option>
                            {tokens.filter(t => t.type === 'letterSpacing').map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.value}px)</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--paper-text-muted)', fontSize: 13 }}>
                Select an element on the canvas to inspect and manage its variable token bindings directly.
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Export & Code View */}
        {activeTab === 'export' && (
          <div className="token-export-view">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div className="export-format-selector">
                <button
                  type="button"
                  className={`export-format-btn ${exportFormat === 'tailwind-v4' ? 'active' : ''}`}
                  onClick={() => setExportFormat('tailwind-v4')}
                >
                  <span>Tailwind CSS v4 (@theme)</span>
                </button>
                <button
                  type="button"
                  className={`export-format-btn ${exportFormat === 'tailwind-v3' ? 'active' : ''}`}
                  onClick={() => setExportFormat('tailwind-v3')}
                >
                  <span>Tailwind v3 (config)</span>
                </button>
                <button
                  type="button"
                  className={`export-format-btn ${exportFormat === 'css-variables' ? 'active' : ''}`}
                  onClick={() => setExportFormat('css-variables')}
                >
                  <span>CSS Custom Properties</span>
                </button>
                <button
                  type="button"
                  className={`export-format-btn ${exportFormat === 'dtcg-json' ? 'active' : ''}`}
                  onClick={() => setExportFormat('dtcg-json')}
                >
                  <span>DTCG JSON</span>
                </button>
                <button
                  type="button"
                  className={`export-format-btn ${exportFormat === 'typescript' ? 'active' : ''}`}
                  onClick={() => setExportFormat('typescript')}
                >
                  <span>TypeScript</span>
                </button>
              </div>

              <button
                type="button"
                className="token-row-btn"
                onClick={() => setShowImportBox(!showImportBox)}
                style={{
                  border: '1px solid var(--paper-border)',
                  background: 'var(--paper-surface)',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Upload size={12} />
                <span>{showImportBox ? 'Hide Import' : 'Import Tokens'}</span>
              </button>
            </div>

            {showImportBox && (
              <div style={{ background: 'var(--paper-hover)', padding: 14, borderRadius: 8, border: '1px solid var(--paper-border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Import Tokens from CSS (:root / @theme) or DTCG JSON:
                </div>
                <textarea
                  value={importCode}
                  onChange={e => setImportCode(e.target.value)}
                  placeholder="Paste CSS variables (e.g. :root { --color-primary: #81adec; }) or DTCG JSON..."
                  style={{
                    width: '100%',
                    height: 100,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    padding: 8,
                    background: 'var(--paper-input)',
                    color: 'var(--paper-text)',
                    border: '1px solid var(--paper-border)',
                    borderRadius: 5,
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  {importError && <span style={{ color: 'var(--paper-error)', fontSize: 11 }}>{importError}</span>}
                  <button
                    type="button"
                    onClick={handleImport}
                    style={{
                      padding: '5px 12px',
                      background: 'var(--paper-accent)',
                      color: 'var(--paper-on-accent)',
                      border: 'none',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Parse & Import
                  </button>
                </div>
              </div>
            )}

            <pre className="export-code-box">
              <code>{exportedCode}</code>
            </pre>

            <div className="export-actions-bar">
              <button
                type="button"
                className="token-row-btn"
                onClick={handleCopyExport}
                style={{
                  background: 'var(--paper-surface)',
                  border: '1px solid var(--paper-border-strong)',
                  padding: '7px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Copy size={13} />
                <span>Copy Code</span>
              </button>

              <button
                type="button"
                className="token-row-btn"
                onClick={handleDownloadExport}
                style={{
                  background: 'var(--paper-accent)',
                  color: 'var(--paper-on-accent)',
                  padding: '7px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Download size={13} />
                <span>Download File</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="token-modal-toast" role="status">
          <Check size={14} />
          <span>{toastMessage}</span>
        </div>
      )}
    </Dialog>
  )
}

// Re-export with both naming conventions
export const TokenManagementModal = TokenManagerModal
