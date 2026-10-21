import { useMemo } from 'react'
import { Sun, Moon, Contrast, RotateCcw } from 'lucide-react'
import type { SceneStore } from '../scene/store.ts'
import type { SceneElement } from '../scene/types.ts'
import { useScene } from '../scene/useScene.ts'
import { getModeDisplayName } from './resolver.ts'

export function VariableModeInspector({
  store,
  node,
}: {
  store: SceneStore
  node: SceneElement
}) {
  const snapshot = useScene(store, state => state)
  const isFrame = node.type === 'frame'
  const isInstance = node.component?.kind === 'instance'

  const context = useMemo(() => {
    return store.getElementThemeModeContext(node.id)
  }, [store, node.id, snapshot.elements, snapshot.styleLibrary.activeThemeId])

  const resolver = useMemo(() => {
    return store.getMultiThemeResolver()
  }, [store, snapshot.tokens, snapshot.styleLibrary])

  const availableModes = useMemo(() => {
    return resolver.getAvailableModes()
  }, [resolver])

  const sourceNode = context.sourceElementId ? snapshot.elements[context.sourceElementId] : undefined
  const sourceName = sourceNode ? sourceNode.name : 'Document'
  const inheritedName = getModeDisplayName(context.inheritedMode, availableModes)
  const effectiveName = getModeDisplayName(context.effectiveMode, availableModes)

  const handleModeChange = (newMode: string | null) => {
    store.setElementThemeMode(node.id, newMode)
  }

  return (
    <div className="inspector-section variable-mode-inspector" data-testid="variable-mode-inspector">
      <div className="variable-mode-header">
        <span className="section-caption">
          {isFrame ? 'FRAME VARIABLE MODE' : isInstance ? 'INSTANCE VARIABLE MODE' : 'VARIABLE MODE'}
        </span>
        {context.isOverridden && (
          <button
            className="quiet-button variable-mode-reset"
            aria-label="Reset mode to inherit"
            title="Reset to inherited mode"
            onClick={() => handleModeChange(null)}
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        )}
      </div>

      <div className="variable-mode-controls">
        <div className="variable-mode-quick-buttons" role="group" aria-label="Quick theme mode switch">
          <button
            type="button"
            className={`variable-mode-btn ${context.effectiveMode === 'light' ? 'is-active' : ''} ${context.explicitMode === 'light' ? 'is-explicit' : ''}`}
            aria-label="Light mode"
            aria-pressed={context.effectiveMode === 'light'}
            title={`Light mode${context.explicitMode === 'light' ? ' (Explicit override)' : ' (Inherited)'}`}
            onClick={() => handleModeChange(context.explicitMode === 'light' ? null : 'light')}
          >
            <Sun size={13} />
            <span>Light</span>
          </button>

          <button
            type="button"
            className={`variable-mode-btn ${context.effectiveMode === 'dark' ? 'is-active' : ''} ${context.explicitMode === 'dark' ? 'is-explicit' : ''}`}
            aria-label="Dark mode"
            aria-pressed={context.effectiveMode === 'dark'}
            title={`Dark mode${context.explicitMode === 'dark' ? ' (Explicit override)' : ' (Inherited)'}`}
            onClick={() => handleModeChange(context.explicitMode === 'dark' ? null : 'dark')}
          >
            <Moon size={13} />
            <span>Dark</span>
          </button>

          <button
            type="button"
            className={`variable-mode-btn ${context.effectiveMode === 'high-contrast' ? 'is-active' : ''} ${context.explicitMode === 'high-contrast' ? 'is-explicit' : ''}`}
            aria-label="High-Contrast mode"
            aria-pressed={context.effectiveMode === 'high-contrast'}
            title={`High-Contrast mode${context.explicitMode === 'high-contrast' ? ' (Explicit override)' : ' (Inherited)'}`}
            onClick={() => handleModeChange(context.explicitMode === 'high-contrast' ? null : 'high-contrast')}
          >
            <Contrast size={13} />
            <span>Contrast</span>
          </button>
        </div>

        <label className="property-select variable-mode-dropdown-label">
          <span>Mode override</span>
          <select
            aria-label="Variable mode"
            value={context.explicitMode ?? ''}
            onChange={e => handleModeChange(e.currentTarget.value || null)}
          >
            <option value="">Inherit ({inheritedName})</option>
            {availableModes.map(theme => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="variable-mode-status">
        <span className={`variable-mode-badge ${context.isOverridden ? 'badge-override' : 'badge-inherited'}`}>
          <span className="badge-dot" />
          {context.isOverridden ? `Override: ${effectiveName}` : `Inherited: ${effectiveName}`}
        </span>
        <span className="variable-mode-hint">
          {context.isOverridden
            ? `Descendant layers inherit ${effectiveName}.`
            : `Inheriting from ${sourceName}.`}
        </span>
      </div>
    </div>
  )
}
