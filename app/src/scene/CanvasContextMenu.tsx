import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Boxes,
  CircleDot,
  Combine,
  Copy,
  Scissors,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  LockKeyhole,
  UnlockKeyhole,
  Eye,
  EyeOff,
  Code2,
  FileCode,
  Frame,
  MinusCircle,
  Square,
  Circle,
  Split,
  Type,
  Unlink,
  Maximize,
  ZoomIn,
  LayoutGrid,
  Ungroup,
  Component as Diamonds,
  Diamond,
  Sparkles,
  RotateCcw,
  ArrowUpRight,
  Plus,
  PenTool,
} from 'lucide-react'
import type { ViewportController } from '../canvas'
import type { Point } from '../canvas/types'
import { alignSelection, createAutoLayoutSelection, deleteSelection, duplicateSelection, groupSelection, orderSelection, removeAutoLayoutSelection, ungroupSelection } from './arrange'
import type { Alignment, LayerOrder } from './arrange'
import { selectionRoots } from './selectionGeometry'
import type { SceneStore } from './store'
import type { BooleanOperation, ElementType } from './types'
import { cleanSvgPathGeometry } from './cagEngine'
import { sceneToSVG } from '../io/svg'
import { buildReactComponent } from '../tokens/codegen'
import { importClipboard, insertImportedScene } from '../io/import'
import { componentRoot } from './components'
import { getWorldBounds } from './geometry'
import './contextMenu.css'

interface ContextMenuPosition {
  x: number
  y: number
  worldPos: Point
}

interface CanvasContextMenuProps {
  store: SceneStore
  controller: ViewportController
  position: ContextMenuPosition
  onClose: () => void
  onEditPath?: (id: string, operandId?: string) => void
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none'
    document.body.append(field)
    field.select()
    const success = document.execCommand('copy')
    field.remove()
    return success
  } catch {
    return false
  }
}

export function CanvasContextMenu({ store, controller, position, onClose, onEditPath }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: position.y, left: position.x })
  const state = store.getSnapshot()
  const selection = state.selection
  const selectedRoots = selectionRoots(state, selection)
  const hasSelection = selectedRoots.length > 0
  const isSingle = selectedRoots.length === 1
  const firstNode = isSingle ? state.elements[selectedRoots[0]] : null
  const anyLocked = selectedRoots.some(id => store.isLocked(id))
  const anyVisible = selectedRoots.some(id => store.isVisible(id))
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const modKey = isMac ? '⌘' : 'Ctrl+'

  // Smart viewport clamping to avoid clipping outside screen
  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const padding = 10
    let left = position.x
    let top = position.y

    if (left + rect.width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - rect.width - padding)
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = Math.max(padding, window.innerHeight - rect.height - padding)
    }
    setCoords({ top, left })
  }, [position.x, position.y])

  // Dismiss on click outside or escape
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleDuplicate = () => {
    duplicateSelection(store)
    onClose()
  }

  const handleDelete = () => {
    deleteSelection(store)
    onClose()
  }

  const handleCopy = async () => {
    if (!hasSelection) return
    try {
      const svg = sceneToSVG(state, { scope: 'selection', scale: 1, background: 'transparent' })
      await copyToClipboard(svg)
    } catch (e) {
      console.error('Failed to copy selection to SVG:', e)
    }
    onClose()
  }

  const handleCut = async () => {
    await handleCopy()
    deleteSelection(store)
    onClose()
  }

  const handlePaste = async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) {
          const doc = await importClipboard({ text, svg: text.includes('<svg') ? text : undefined })
          if (doc) {
            insertImportedScene(store, doc, position.worldPos)
          }
        }
      }
    } catch (e) {
      console.error('Failed to paste clipboard content:', e)
    }
    onClose()
  }

  const handleOrder = (order: LayerOrder) => {
    orderSelection(store, order)
    onClose()
  }

  const handleAlign = (alignment: Alignment) => {
    alignSelection(store, alignment, controller.getSnapshot().visibleBounds)
    onClose()
  }

  const handleToggleLock = () => {
    store.batch(() => {
      for (const id of selectedRoots) {
        store.setLocked(id, !anyLocked)
      }
    }, anyLocked ? 'Unlock elements' : 'Lock elements')
    onClose()
  }

  const handleToggleVisibility = () => {
    store.batch(() => {
      for (const id of selectedRoots) {
        store.setVisible(id, !anyVisible)
      }
    }, anyVisible ? 'Hide elements' : 'Show elements')
    onClose()
  }

  const handleCopySVG = async () => {
    if (!hasSelection) return
    try {
      const svg = sceneToSVG(state, { scope: 'selection', scale: 1, background: 'transparent' })
      await copyToClipboard(svg)
    } catch (e) {
      console.error('Failed to copy SVG:', e)
    }
    onClose()
  }

  const handleCopyReact = async () => {
    if (!firstNode) return
    try {
      const parentNode = firstNode.parentId ? state.elements[firstNode.parentId] : undefined
      const code = buildReactComponent(firstNode, state.tokens, parentNode, state.elements)
      await copyToClipboard(code)
    } catch (e) {
      console.error('Failed to generate React component:', e)
    }
    onClose()
  }

  const handleAddAutoLayout = () => {
    createAutoLayoutSelection(store)
    onClose()
  }

  const handleRemoveAutoLayout = () => {
    removeAutoLayoutSelection(store)
    onClose()
  }

  const handleUngroup = () => {
    ungroupSelection(store)
    onClose()
  }

  const handleGroupInFrame = () => {
    groupSelection(store)
    onClose()
  }

  const compRoot = isSingle && firstNode ? componentRoot(state.elements, firstNode.id) : undefined
  const isMaster = firstNode?.component?.kind === 'master'
  const isInstance = compRoot?.component?.kind === 'instance'
  const canMakeComponent = selectedRoots.length > 0 && !store.selectionComponentCreationReason(selectedRoots)

  const handleCreateComponent = () => {
    if (canMakeComponent) {
      store.createComponentFromSelection(selectedRoots)
    }
    onClose()
  }

  const handleInsertInstance = () => {
    if (firstNode && isMaster) {
      const inst = store.createComponentInstance(firstNode.id)
      store.select([inst.id])
    }
    onClose()
  }

  const handleAutoExpose = () => {
    if (firstNode && isMaster) {
      store.autoExposeComponentProperties(firstNode.id)
    }
    onClose()
  }

  const handlePushOverrides = () => {
    if (firstNode && isInstance) {
      store.pushOverridesToMaster(firstNode.id)
    }
    onClose()
  }

  const handleResetOverrides = () => {
    if (firstNode && isInstance) {
      store.resetComponentOverrides(firstNode.id)
    }
    onClose()
  }

  const handleDetachInstance = () => {
    if (firstNode && isInstance) {
      store.detachComponentInstance(firstNode.id)
    }
    onClose()
  }

  const handleGoToMaster = () => {
    if (firstNode && isInstance && compRoot?.component?.kind === 'instance') {
      const masterId = compRoot.component.masterId
      store.select([masterId])
      controller.fit(getWorldBounds(store.getSnapshot(), masterId))
    }
    onClose()
  }

  const handleInsertPreset = (presetKey: string) => {
    const { instance } = store.insertPresetMasterSymbol(presetKey, {
      x: position.worldPos.x,
      y: position.worldPos.y,
    })
    store.select([instance.id])
    onClose()
  }

  const isCompound = isSingle && firstNode?.type === 'path' && !!firstNode.boolean
  const canBoolean = selectedRoots.length >= 2 && !store.booleanSelectionReason(selectedRoots)

  const handleBoolean = (operation: BooleanOperation) => {
    try {
      store.booleanSelection(operation, false, selectedRoots)
    } catch (e) {
      console.error('Failed to perform boolean operation:', e)
    }
    onClose()
  }

  const handleFlattenCompound = () => {
    if (firstNode && isCompound) {
      try {
        store.flattenBoolean(firstNode.id)
      } catch (e) {
        console.error('Failed to flatten compound:', e)
      }
    }
    onClose()
  }

  const handleReleaseCompound = () => {
    if (firstNode && isCompound) {
      try {
        store.releaseBoolean(firstNode.id)
      } catch (e) {
        console.error('Failed to release compound sources:', e)
      }
    }
    onClose()
  }

  const handleCopyCleanPath = async () => {
    if (firstNode && firstNode.type === 'path') {
      try {
        const cleanD = cleanSvgPathGeometry(firstNode.d, { precision: 4 })
        await copyToClipboard(cleanD)
      } catch (e) {
        console.error('Failed to copy clean SVG path:', e)
      }
    }
    onClose()
  }

  const handleAddElement = (type: ElementType) => {
    const w = type === 'frame' ? 720 : type === 'text' ? 240 : 120
    const h = type === 'frame' ? 480 : type === 'text' ? 48 : 120
    const node = store.add(type, {
      x: position.worldPos.x - w / 2,
      y: position.worldPos.y - h / 2,
    })
    store.select([node.id])
    onClose()
  }

  const handleSelectAll = () => {
    const unlockedVisible = state.rootIds.filter(id => store.isVisible(id) && !store.isLocked(id))
    store.select(unlockedVisible)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
      role="menu"
      aria-label="Canvas context menu"
      data-testid="canvas-context-menu"
    >
      {hasSelection ? (
        <>
          <div className="context-menu-header">
            {isSingle ? firstNode?.name : `${selectedRoots.length} elements selected`}
          </div>

          <MenuItem icon={<CopyPlus size={14} />} label="Duplicate" shortcut={`${modKey}D`} onClick={handleDuplicate} />
          <MenuItem icon={<Copy size={14} />} label="Copy" shortcut={`${modKey}C`} onClick={handleCopy} />
          <MenuItem icon={<Scissors size={14} />} label="Cut" shortcut={`${modKey}X`} onClick={handleCut} />
          <MenuItem icon={<ClipboardPaste size={14} />} label="Paste" shortcut={`${modKey}V`} onClick={handlePaste} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" shortcut="Del" danger onClick={handleDelete} />

          <div className="context-menu-separator" />

          <MenuItem icon={<ChevronsUp size={14} />} label="Bring to Front" shortcut="]" onClick={() => handleOrder('front')} />
          <MenuItem icon={<ArrowUp size={14} />} label="Bring Forward" shortcut={`${modKey}]`} onClick={() => handleOrder('forward')} />
          <MenuItem icon={<ArrowDown size={14} />} label="Send Backward" shortcut={`${modKey}[`} onClick={() => handleOrder('backward')} />
          <MenuItem icon={<ChevronsDown size={14} />} label="Send to Back" shortcut="[" onClick={() => handleOrder('back')} />

          <div className="context-menu-separator" />

          {/* Quick Alignment Grid */}
          <div className="context-menu-grid" title="Align selection">
            <button className="context-menu-grid-btn" title="Align left (Alt+A)" onClick={() => handleAlign('left')}><AlignStartVertical size={13} /></button>
            <button className="context-menu-grid-btn" title="Align horizontal center (Alt+H)" onClick={() => handleAlign('horizontal-center')}><AlignCenterVertical size={13} /></button>
            <button className="context-menu-grid-btn" title="Align right (Alt+D)" onClick={() => handleAlign('right')}><AlignEndVertical size={13} /></button>
            <button className="context-menu-grid-btn" title="Align top (Alt+W)" onClick={() => handleAlign('top')}><AlignStartHorizontal size={13} /></button>
            <button className="context-menu-grid-btn" title="Align vertical center (Alt+V)" onClick={() => handleAlign('vertical-center')}><AlignCenterHorizontal size={13} /></button>
            <button className="context-menu-grid-btn" title="Align bottom (Alt+S)" onClick={() => handleAlign('bottom')}><AlignEndHorizontal size={13} /></button>
          </div>

          <div className="context-menu-separator" />

          <MenuItem
            icon={anyLocked ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}
            label={anyLocked ? 'Unlock' : 'Lock'}
            onClick={handleToggleLock}
          />
          <MenuItem
            icon={anyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            label={anyVisible ? 'Hide' : 'Show'}
            onClick={handleToggleVisibility}
          />
          {isSingle && firstNode?.type === 'path' && (
            <MenuItem
              icon={<PenTool size={14} />}
              label={firstNode.boolean ? 'Edit Sub-Path Anchors' : 'Edit Vector Path'}
              shortcut="Enter"
              onClick={() => {
                const selectedOp = store.getSelectedCompoundOperand()
                const opId = selectedOp?.compoundId === firstNode.id ? selectedOp.operandId : firstNode.boolean?.operands[0]?.id
                onEditPath?.(firstNode.id, opId)
                onClose()
              }}
            />
          )}
          {isSingle && firstNode?.type === 'frame' && !!firstNode.layout ? (
            <MenuItem icon={<LayoutGrid size={14} />} label="Remove Auto Layout" shortcut="Alt+Shift+A" onClick={handleRemoveAutoLayout} />
          ) : (
            <MenuItem icon={<LayoutGrid size={14} />} label="Add Auto Layout" shortcut="Shift+A" onClick={handleAddAutoLayout} />
          )}
          <MenuItem icon={<Frame size={14} />} label="Group Selection" shortcut={`${modKey}G`} onClick={handleGroupInFrame} />
          {selectedRoots.some(id => state.elements[id]?.type === 'frame') && (
            <MenuItem icon={<Ungroup size={14} />} label="Ungroup" shortcut={`${modKey}Shift+G`} onClick={handleUngroup} />
          )}

          {(canMakeComponent || isMaster || isInstance) && (
            <>
              <div className="context-menu-separator" />
              <div className="context-menu-header">Component</div>
              {canMakeComponent && (
                <MenuItem
                  icon={<Diamonds size={14} />}
                  label={selectedRoots.length > 1 ? `Create Component (${selectedRoots.length} layers)` : 'Create Component'}
                  shortcut="Alt+Cmd+K"
                  onClick={handleCreateComponent}
                />
              )}
              {isMaster && (
                <>
                  <MenuItem icon={<Plus size={14} />} label="Insert Instance" onClick={handleInsertInstance} />
                  <MenuItem icon={<Sparkles size={14} />} label="Auto-Expose Properties" onClick={handleAutoExpose} />
                </>
              )}
              {isInstance && (
                <>
                  <MenuItem icon={<ArrowUpRight size={14} />} label="Push Overrides to Master" onClick={handlePushOverrides} />
                  <MenuItem icon={<RotateCcw size={14} />} label="Reset Overrides" onClick={handleResetOverrides} />
                  <MenuItem icon={<Unlink size={14} />} label="Detach Instance" shortcut="Alt+Cmd+B" onClick={handleDetachInstance} />
                  <MenuItem icon={<Diamond size={14} />} label="Go to Master Component" onClick={handleGoToMaster} />
                </>
              )}
            </>
          )}

          {canBoolean && (
            <>
              <div className="context-menu-separator" />
              <div className="context-menu-header">Boolean (CAG)</div>
              <MenuItem icon={<Combine size={14} />} label="Union (∪)" onClick={() => handleBoolean('union')} />
              <MenuItem icon={<MinusCircle size={14} />} label="Subtract (∖)" onClick={() => handleBoolean('subtract')} />
              <MenuItem icon={<Boxes size={14} />} label="Intersect (∩)" onClick={() => handleBoolean('intersect')} />
              <MenuItem icon={<CircleDot size={14} />} label="Exclude (⊕)" onClick={() => handleBoolean('exclude')} />
            </>
          )}

          {isCompound && (
            <>
              <div className="context-menu-separator" />
              <div className="context-menu-header">Compound Shape</div>
              <MenuItem icon={<Copy size={14} />} label="Copy Clean SVG Path" onClick={handleCopyCleanPath} />
              <MenuItem icon={<Split size={14} />} label="Flatten Compound Path" onClick={handleFlattenCompound} />
              <MenuItem icon={<Unlink size={14} />} label="Release Compound Sources" onClick={handleReleaseCompound} />
            </>
          )}

          <div className="context-menu-separator" />

          <MenuItem icon={<FileCode size={14} />} label="Copy as SVG" onClick={handleCopySVG} />
          {isSingle && (
            <MenuItem icon={<Code2 size={14} />} label="Copy as React / Tailwind" onClick={handleCopyReact} />
          )}
        </>
      ) : (
        <>
          <div className="context-menu-header">Canvas</div>

          <MenuItem icon={<ClipboardPaste size={14} />} label="Paste" shortcut={`${modKey}V`} onClick={handlePaste} />
          <MenuItem icon={<Copy size={14} />} label="Select All" shortcut={`${modKey}A`} onClick={handleSelectAll} />

          <div className="context-menu-separator" />

          <MenuItem icon={<Frame size={14} />} label="New Frame" shortcut="F" onClick={() => handleAddElement('frame')} />
          <MenuItem icon={<Square size={14} />} label="New Rectangle" shortcut="R" onClick={() => handleAddElement('rectangle')} />
          <MenuItem icon={<Circle size={14} />} label="New Ellipse" shortcut="O" onClick={() => handleAddElement('ellipse')} />
          <MenuItem icon={<Type size={14} />} label="New Text" shortcut="T" onClick={() => handleAddElement('text')} />

          <div className="context-menu-separator" />
          <div className="context-menu-header">Insert Master Symbol</div>
          <MenuItem icon={<Sparkles size={14} />} label="Interactive Spring Button" onClick={() => handleInsertPreset('button')} />
          <MenuItem icon={<Sparkles size={14} />} label="Kinetic Wave Header" onClick={() => handleInsertPreset('kinetic-wave-header')} />
          <MenuItem icon={<Sparkles size={14} />} label="Procedural Simplex Mesh" onClick={() => handleInsertPreset('shader-procedural-grain')} />
          <MenuItem icon={<Sparkles size={14} />} label="Neuro Noise Hero" onClick={() => handleInsertPreset('shader-neuro-hero')} />

          <div className="context-menu-separator" />

          <MenuItem icon={<ZoomIn size={14} />} label="Zoom to 100%" shortcut="0" onClick={() => { controller.zoomTo(1); onClose() }} />
          <MenuItem icon={<Maximize size={14} />} label="Fit to Screen" shortcut="1" onClick={() => { controller.fit(controller.getSnapshot().visibleBounds); onClose() }} />
        </>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  shortcut,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`context-menu-item ${danger ? 'context-menu-danger' : ''}`}
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      <div className="context-menu-item-content">
        {icon}
        <span>{label}</span>
      </div>
      {shortcut && <span className="context-menu-shortcut">{shortcut}</span>}
    </button>
  )
}
