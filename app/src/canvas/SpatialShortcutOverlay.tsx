import { useEffect } from 'react'
import {
  Compass,
  Crosshair,
  Maximize,
  Navigation,
  X,
  Bookmark,
  Layers,
} from 'lucide-react'
import type { Bounds } from './types.ts'
import type { ViewportController } from './ViewportController.ts'

export interface SpatialShortcutOverlayProps {
  open: boolean
  onClose: () => void
  controller?: ViewportController
  contentBounds?: Bounds
  onToggleMinimap?: () => void
  onOpenJumpList?: () => void
}

interface ShortcutItem {
  keys: readonly string[]
  title: string
  description: string
}

interface ShortcutGroup {
  category: string
  items: readonly ShortcutItem[]
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    category: 'Canvas Navigation',
    items: [
      {
        keys: ['Space', 'Drag'],
        title: 'Smooth Pan',
        description: 'Drag canvas freely with spring physics momentum',
      },
      {
        keys: ['Middle Click', 'Drag'],
        title: 'Direct Pan',
        description: 'Instant auxiliary camera pan without pressing Space',
      },
      {
        keys: ['Shift', 'Scroll'],
        title: 'Horizontal Pan',
        description: 'Pan camera along the world X-axis',
      },
      {
        keys: ['Wheel / Pinch'],
        title: 'Continuous Zoom',
        description: 'Smooth kinetic zoom anchored to cursor position',
      },
      {
        keys: ['↑', '↓', '←', '→'],
        title: 'Step Pan',
        description: 'Nudge canvas by 80px increments in world space',
      },
    ],
  },
  {
    category: 'Zoom & Framing',
    items: [
      {
        keys: ['0', 'or', '⌘0'],
        title: 'Zoom to 100%',
        description: 'Reset camera zoom to 1:1 pixel scale',
      },
      {
        keys: ['1', 'or', '⌘1'],
        title: 'Fit Content',
        description: 'Fit all artboards and content within view',
      },
      {
        keys: ['⌘2'],
        title: 'Zoom Selection',
        description: 'Frame active selected elements tightly',
      },
      {
        keys: ['+', '−'],
        title: 'Zoom Stepper',
        description: 'Zoom in or out by 25% increments',
      },
      {
        keys: ['Drag Handles'],
        title: 'Radar Zoom Box',
        description: 'Drag minimap viewport handles to resize frustum',
      },
    ],
  },
  {
    category: 'Radar HUD & Bookmarks',
    items: [
      {
        keys: ['M'],
        title: 'Toggle Radar',
        description: 'Show or hide the spatial canvas radar minimap',
      },
      {
        keys: ['B'],
        title: 'Frame Jump-List',
        description: 'Open spatial frame list and view bookmarks',
      },
      {
        keys: ['1 – 9'],
        title: 'Quick Jump',
        description: 'Instantly jump to corresponding frame or bookmark',
      },
      {
        keys: ['?'],
        title: 'Shortcuts HUD',
        description: 'Toggle this spatial navigation overlay',
      },
      {
        keys: ['Dbl Click'],
        title: 'Minimap Reset',
        description: 'Double click radar minimap to fit all content',
      },
    ],
  },
  {
    category: 'Engineering & Grid',
    items: [
      {
        keys: ["⌘ '"],
        title: 'Engineering Grid',
        description: 'Toggle 120px master grid & 24px sub-grid',
      },
      {
        keys: ['R'],
        title: 'Pixel Rulers',
        description: 'Toggle top and left coordinate rulers',
      },
      {
        keys: ["⌘ ⇧ '"],
        title: 'Pixel Snap',
        description: 'Toggle sub-pixel snapping to integers',
      },
      {
        keys: ['Alt', 'Hover'],
        title: 'Measure Guides',
        description: 'Inspect exact distances between layers',
      },
    ],
  },
  {
    category: 'Auto-Layout & Flex Engine',
    items: [
      {
        keys: ['⇧ A'],
        title: 'Add Auto Layout',
        description: 'Wrap selection in auto-layout flex frame with smart flow',
      },
      {
        keys: ['⌥ ⇧ A'],
        title: 'Remove Auto Layout',
        description: 'Release flex flow and convert child sizing to fixed',
      },
      {
        keys: ['Drag Handles'],
        title: 'On-Canvas Spacing',
        description: 'Visually drag padding and gap handles or gap bands',
      },
      {
        keys: ['Alt', 'Drag'],
        title: 'Symmetric Padding',
        description: 'Drag padding handle to update opposite sides together',
      },
      {
        keys: ['Shift', 'Drag'],
        title: '8px Grid Snapping',
        description: 'Snap dragged padding and gap distances to 8px intervals',
      },
      {
        keys: ['Dbl Click'],
        title: 'Reset Spacing',
        description: 'Reset padding or gap handle to 0px (Alt for twin sides)',
      },
    ],
  },
]

export function SpatialShortcutOverlay({
  open,
  onClose,
  controller,
  contentBounds,
  onToggleMinimap,
  onOpenJumpList,
}: SpatialShortcutOverlayProps) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="spatial-shortcuts-backdrop"
      data-testid="spatial-shortcuts-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Spatial Canvas Shortcuts & Radar HUD"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="spatial-shortcuts-card">
        {/* Header */}
        <div className="spatial-shortcuts-header">
          <div className="spatial-shortcuts-brand">
            <div className="spatial-radar-icon-pip" aria-hidden="true">
              <Compass size={16} />
            </div>
            <div>
              <div className="spatial-shortcuts-title">
                SPATIAL CANVAS SHORTCUTS & RADAR HUD
              </div>
              <div className="spatial-shortcuts-subtitle">
                Precision camera navigation, zoom manipulation & spatial HUD reference
              </div>
            </div>
          </div>
          <button
            className="quiet-button spatial-shortcuts-close"
            onClick={onClose}
            aria-label="Close shortcuts overlay"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcut Categories Grid */}
        <div className="spatial-shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category} className="spatial-shortcut-category">
              <div className="spatial-category-title">{group.category}</div>
              <div className="spatial-category-list">
                {group.items.map((item) => (
                  <div key={item.title} className="spatial-shortcut-row">
                    <div className="spatial-shortcut-info">
                      <div className="spatial-shortcut-name">{item.title}</div>
                      <div className="spatial-shortcut-desc">
                        {item.description}
                      </div>
                    </div>
                    <div className="spatial-shortcut-keys">
                      {item.keys.map((key, i) =>
                        key === 'or' ? (
                          <span key={i} className="spatial-key-or">
                            or
                          </span>
                        ) : (
                          <kbd key={i} className="spatial-kbd">
                            {key}
                          </kbd>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Action Dock */}
        <div className="spatial-shortcuts-footer">
          <div className="spatial-footer-label">QUICK SPATIAL ACTIONS:</div>
          <div className="spatial-action-buttons">
            {controller && contentBounds && (
              <button
                className="spatial-action-btn"
                onClick={() => {
                  controller.fit(contentBounds)
                  onClose()
                }}
              >
                <Maximize size={12} />
                <span>Fit All (1)</span>
              </button>
            )}
            {controller && (
              <button
                className="spatial-action-btn"
                onClick={() => {
                  controller.zoomTo(1)
                  onClose()
                }}
              >
                <Crosshair size={12} />
                <span>100% Zoom (0)</span>
              </button>
            )}
            {controller && (
              <button
                className="spatial-action-btn"
                onClick={() => {
                  controller.centerOn({ x: 0, y: 0 })
                  onClose()
                }}
              >
                <Navigation size={12} />
                <span>Origin (0,0)</span>
              </button>
            )}
            {onOpenJumpList && (
              <button
                className="spatial-action-btn"
                onClick={() => {
                  onClose()
                  onOpenJumpList()
                }}
              >
                <Bookmark size={12} />
                <span>Jump-List (B)</span>
              </button>
            )}
            {onToggleMinimap && (
              <button
                className="spatial-action-btn"
                onClick={() => {
                  onToggleMinimap()
                }}
              >
                <Layers size={12} />
                <span>Minimap (M)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
