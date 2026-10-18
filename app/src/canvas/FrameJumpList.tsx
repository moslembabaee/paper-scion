import { useState, useMemo, useEffect } from 'react'
import {
  Bookmark,
  Compass,
  Layout,
  Plus,
  Search,
  Trash2,
  X,
  Crosshair,
} from 'lucide-react'
import type { MinimapItem, SpatialBookmark } from './types.ts'
import type { ViewportController } from './ViewportController.ts'

export interface FrameJumpListProps {
  items: readonly MinimapItem[]
  controller: ViewportController
  bookmarks: readonly SpatialBookmark[]
  onAddBookmark: (name: string) => void
  onDeleteBookmark: (id: string) => void
  onSelectFrame?: (id: string) => void
  onClose: () => void
}

export function FrameJumpList({
  items,
  controller,
  bookmarks,
  onAddBookmark,
  onDeleteBookmark,
  onSelectFrame,
  onClose,
}: FrameJumpListProps) {
  const [query, setQuery] = useState('')
  const [isAddingBookmark, setIsAddingBookmark] = useState(false)
  const [newBookmarkName, setNewBookmarkName] = useState('')

  // Identify frame items or prominent root containers
  const frames = useMemo(() => {
    const list = items.filter(
      (item) => item.isFrame || item.type === 'frame' || (item.width >= 100 && item.height >= 100)
    )
    return list.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
  }, [items])

  // Filtered frames based on search query
  const filteredFrames = useMemo(() => {
    if (!query.trim()) return frames
    const q = query.toLowerCase()
    return frames.filter(
      (f) =>
        (f.name && f.name.toLowerCase().includes(q)) ||
        (f.type && f.type.toLowerCase().includes(q)) ||
        f.id.toLowerCase().includes(q)
    )
  }, [frames, query])

  // Filtered bookmarks
  const filteredBookmarks = useMemo(() => {
    if (!query.trim()) return bookmarks
    const q = query.toLowerCase()
    return bookmarks.filter((b) => b.name.toLowerCase().includes(q))
  }, [bookmarks, query])

  // Key navigation (Esc, 1..9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      // If user presses number 1..9 while not typing in an input, jump to that frame
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (!isInput && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key, 10) - 1
        if (filteredFrames[index]) {
          e.preventDefault()
          jumpToFrame(filteredFrames[index])
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredFrames, onClose])

  function jumpToFrame(frame: MinimapItem) {
    controller.fit(
      {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      },
      60,
      true
    )
    if (onSelectFrame) {
      onSelectFrame(frame.id)
    }
  }

  function jumpToBookmark(bookmark: SpatialBookmark) {
    controller.setCamera(bookmark.camera, true)
  }

  function handleSaveBookmark() {
    const name = newBookmarkName.trim()
    if (!name) {
      const snap = controller.getSnapshot()
      const fallbackName = `View ${bookmarks.length + 1} (${Math.round(snap.camera.zoom * 100)}%)`
      onAddBookmark(fallbackName)
    } else {
      onAddBookmark(name)
    }
    setNewBookmarkName('')
    setIsAddingBookmark(false)
  }

  return (
    <div
      className="radar-jump-drawer"
      data-testid="frame-jump-list"
      role="dialog"
      aria-label="Spatial Frame & Bookmark Jump List"
    >
      {/* Header */}
      <div className="radar-jump-header">
        <div className="radar-jump-title">
          <Compass size={14} className="radar-jump-icon" />
          <span>SPATIAL JUMP LIST</span>
          <span className="radar-jump-badge">
            {frames.length} {frames.length === 1 ? 'Frame' : 'Frames'}
          </span>
        </div>
        <button
          className="quiet-button radar-jump-close"
          onClick={onClose}
          aria-label="Close jump list"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search Input */}
      <div className="radar-jump-search-wrap">
        <Search size={13} className="radar-jump-search-icon" />
        <input
          type="text"
          className="radar-jump-search"
          placeholder="Filter frames & bookmarks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && (
          <button
            className="quiet-button radar-jump-clear"
            onClick={() => setQuery('')}
            aria-label="Clear filter"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Frame List Container */}
      <div className="radar-jump-scrollable">
        {/* Frames Section */}
        <div className="radar-jump-section">
          <div className="radar-jump-section-header">
            <span>CANVAS FRAMES</span>
            <span className="radar-jump-hint">1–9 Quick Jump</span>
          </div>

          {filteredFrames.length === 0 ? (
            <div className="radar-jump-empty">
              {query ? 'No matching frames' : 'No frames on canvas'}
            </div>
          ) : (
            <div className="radar-jump-items">
              {filteredFrames.map((frame, index) => {
                const hotkey = index < 9 ? `${index + 1}` : null
                return (
                  <button
                    key={frame.id}
                    className="radar-jump-row"
                    data-testid={`jump-frame-${frame.id}`}
                    onClick={() => jumpToFrame(frame)}
                    title={`Jump to "${frame.name || 'Frame'}" (Fits canvas)`}
                  >
                    <div className="radar-jump-row-left">
                      <div className="radar-jump-thumb">
                        <Layout size={12} />
                      </div>
                      <div className="radar-jump-details">
                        <div className="radar-jump-name">
                          {frame.name || `Frame ${index + 1}`}
                        </div>
                        <div className="radar-jump-meta">
                          {Math.round(frame.width)} × {Math.round(frame.height)}
                          <span className="radar-jump-dot">·</span>
                          X: {Math.round(frame.x)} Y: {Math.round(frame.y)}
                        </div>
                      </div>
                    </div>
                    {hotkey && <kbd className="radar-jump-kbd">{hotkey}</kbd>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Spatial Bookmarks Section */}
        <div className="radar-jump-section">
          <div className="radar-jump-section-header">
            <span>SAVED VIEWPORTS</span>
            {!isAddingBookmark && (
              <button
                className="quiet-button radar-jump-add-btn"
                onClick={() => setIsAddingBookmark(true)}
                title="Save current viewport as bookmark"
              >
                <Plus size={11} />
                <span>Bookmark View</span>
              </button>
            )}
          </div>

          {/* New Bookmark Input Field */}
          {isAddingBookmark && (
            <div className="radar-jump-add-box">
              <input
                type="text"
                className="radar-jump-add-input"
                placeholder="Bookmark name (e.g. Header Section)"
                value={newBookmarkName}
                onChange={(e) => setNewBookmarkName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveBookmark()
                  if (e.key === 'Escape') setIsAddingBookmark(false)
                }}
                autoFocus
              />
              <div className="radar-jump-add-actions">
                <button
                  className="radar-jump-save-btn"
                  onClick={handleSaveBookmark}
                >
                  Save
                </button>
                <button
                  className="quiet-button"
                  onClick={() => setIsAddingBookmark(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {filteredBookmarks.length === 0 ? (
            <div className="radar-jump-empty">
              No saved viewports. Click "Bookmark View" to pin camera positions.
            </div>
          ) : (
            <div className="radar-jump-items">
              {filteredBookmarks.map((bm) => (
                <div key={bm.id} className="radar-jump-bookmark-row">
                  <button
                    className="radar-jump-bookmark-main"
                    onClick={() => jumpToBookmark(bm)}
                    title={`Jump to saved view "${bm.name}"`}
                  >
                    <Bookmark size={12} className="radar-bookmark-icon" />
                    <div className="radar-jump-details">
                      <div className="radar-jump-name">{bm.name}</div>
                      <div className="radar-jump-meta">
                        {Math.round(bm.camera.zoom * 100)}%
                        <span className="radar-jump-dot">·</span>
                        X: {Math.round(-bm.camera.x / bm.camera.zoom)} Y:{' '}
                        {Math.round(-bm.camera.y / bm.camera.zoom)}
                      </div>
                    </div>
                  </button>
                  <button
                    className="quiet-button radar-jump-delete"
                    onClick={() => onDeleteBookmark(bm.id)}
                    aria-label={`Delete bookmark ${bm.name}`}
                    title="Delete bookmark"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div className="radar-jump-footer">
        <Crosshair size={11} />
        <span>Click frame to focus with spring easing</span>
      </div>
    </div>
  )
}
