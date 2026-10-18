import { memo, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import type { Point } from '../canvas/types'
import type { SceneStore } from '../scene/store'
import { getWorldMatrix } from '../scene/geometry'
import { useScene } from '../scene/useScene'
import { initials } from '../workspace/profile'
import {
  DeadReckoningCursor,
  computeZoomScale,
  formatCursorCoordinates,
  isNearGrid,
  projectEdgePosition,
} from './deadReckoning'
import type { CollaborationSession } from './session'
import './collaboration.css'

export const CollaborationOverlay = memo(function CollaborationOverlay({
  session,
  store,
  controller,
}: {
  session: CollaborationSession
  store: SceneStore
  controller: ViewportController
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const scene = useScene(store, snapshot => snapshot)
  const root = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, Point>())
  const interpolators = useRef(new Map<string, DeadReckoningCursor>())
  const cursors = useRef(new Map<string, HTMLDivElement>())
  const coordElements = useRef(new Map<string, HTMLElement>())
  const selections = useRef(new Map<string, HTMLDivElement>())
  const dimElements = useRef(new Map<string, HTMLElement>())
  const edgeBadges = useRef(new Map<string, HTMLButtonElement>())
  const edgeArrows = useRef(new Map<string, HTMLElement>())
  const edgeCoords = useRef(new Map<string, HTMLElement>())
  const peerViewports = useRef(new Map<string, HTMLDivElement>())
  const peers = useRef(state.peers)
  const repaint = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    peers.current = state.peers
    const activeIds = new Set<string>()
    for (const peer of state.peers) {
      activeIds.add(peer.id)
      if (peer.cursor) {
        let interp = interpolators.current.get(peer.id)
        if (!interp) {
          interp = new DeadReckoningCursor(peer.cursor)
          interpolators.current.set(peer.id, interp)
        } else {
          interp.update(peer.cursor, peer.cursorTimestamp)
        }
      } else {
        interpolators.current.delete(peer.id)
      }
    }
    for (const id of positions.current.keys()) {
      if (!activeIds.has(id) || !state.peers.some(p => p.id === id && p.cursor)) {
        positions.current.delete(id)
        interpolators.current.delete(id)
      }
    }
    repaint.current()
  }, [state.peers, scene])

  useLayoutEffect(() => {
    const viewport = root.current!.closest<HTMLElement>('.canvas-viewport')!
    let frame: number | null = null
    let previousTime = 0
    let geometryDirty = true
    let pointer: Point | null = null
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const paint = (time: number) => {
      frame = null
      const dt = previousTime ? Math.min(64, time - previousTime) : 16.67
      previousTime = time
      const { camera, size } = controller.getSnapshot()
      const sceneSnapshot = store.getSnapshot()
      const zoomScale = computeZoomScale(camera.zoom)
      let moving = false

      for (const peer of peers.current) {
        // Peer cursor dead-reckoning and zoom-aware rendering
        if (peer.cursor) {
          const interp = interpolators.current.get(peer.id)
          let point: Point
          if (interp) {
            const stepResult = interp.step(time, dt, camera.zoom, motion.matches)
            point = stepResult.point
            if (stepResult.moving) moving = true
          } else {
            point = peer.cursor
          }

          positions.current.set(peer.id, point)
          const cursor = cursors.current.get(peer.id)
          if (cursor) {
            cursor.style.transform = `translate3d(${point.x * camera.zoom + camera.x}px, ${point.y * camera.zoom + camera.y}px, 0) scale(${zoomScale})`
            cursor.style.visibility = 'visible'
            if (isNearGrid(point.x, point.y, 120)) {
              cursor.dataset.grid = '120'
            } else {
              delete cursor.dataset.grid
            }
          }

          const coordNode = coordElements.current.get(peer.id)
          if (coordNode) {
            coordNode.textContent = formatCursorCoordinates(point.x, point.y, camera.zoom)
          }
        }

        // Off-screen canvas edge radar
        const peerPos = positions.current.get(peer.id) ?? peer.cursor ?? peer.viewport.center
        const edgeNode = edgeBadges.current.get(peer.id)
        if (edgeNode) {
          if (peerPos && peer.status !== 'away') {
            const proj = projectEdgePosition(peerPos, camera, size, 36)
            if (proj.isOffscreen) {
              edgeNode.style.display = 'inline-flex'
              edgeNode.style.transform = `translate3d(${proj.edgePoint.x}px, ${proj.edgePoint.y}px, 0) scale(${zoomScale})`
              const arrowNode = edgeArrows.current.get(peer.id)
              if (arrowNode) {
                arrowNode.style.transform = `rotate(${proj.angleDeg}deg)`
              }
              const edgeCoordNode = edgeCoords.current.get(peer.id)
              if (edgeCoordNode) {
                edgeCoordNode.textContent = `${Math.round(peerPos.x)}, ${Math.round(peerPos.y)}`
              }
            } else {
              edgeNode.style.display = 'none'
            }
          } else {
            edgeNode.style.display = 'none'
          }
        }

        // Peer viewport bounds when zoomed out (< 0.65)
        const vpNode = peerViewports.current.get(peer.id)
        if (vpNode) {
          if (camera.zoom < 0.65 && peer.viewport && peer.viewport.size.width > 0 && peer.status !== 'away') {
            const vpW = peer.viewport.size.width / peer.viewport.zoom
            const vpH = peer.viewport.size.height / peer.viewport.zoom
            const vpX = peer.viewport.center.x - vpW / 2
            const vpY = peer.viewport.center.y - vpH / 2
            vpNode.style.display = 'block'
            vpNode.style.width = `${vpW * camera.zoom}px`
            vpNode.style.height = `${vpH * camera.zoom}px`
            vpNode.style.transform = `translate3d(${vpX * camera.zoom + camera.x}px, ${vpY * camera.zoom + camera.y}px, 0)`
          } else {
            vpNode.style.display = 'none'
          }
        }

        // Active element selection bounding boxes with zoom-aware handles
        if (geometryDirty) {
          for (const id of peer.selection) {
            const box = selections.current.get(`${peer.id}:${id}`)
            if (!box) continue
            const node = sceneSnapshot.elements[id]
            if (!node || !store.isVisible(id)) {
              box.style.visibility = 'hidden'
              continue
            }
            const [a, b, c, d, e, f] = getWorldMatrix(sceneSnapshot, id)
            box.style.width = `${node.width * camera.zoom}px`
            box.style.height = `${node.height * camera.zoom}px`
            box.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e * camera.zoom + camera.x}, ${f * camera.zoom + camera.y})`
            box.style.visibility = 'visible'

            const dimNode = dimElements.current.get(`${peer.id}:${id}`)
            if (dimNode) {
              dimNode.textContent = `${Math.round(node.width)} × ${Math.round(node.height)}`
            }
          }
        }
      }

      geometryDirty = false
      if (moving) schedule()
      else previousTime = 0
    }

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(paint)
    }

    repaint.current = () => {
      geometryDirty = true
      schedule()
    }

    const unsubscribe = controller.subscribe(() => {
      geometryDirty = true
      schedule()
      if (pointer) session.setCursor(controller.screenToWorld(pointer))
    })

    const cursor = (event: PointerEvent) => {
      if (
        (event.target as Element).closest(
          '.viewport-ui, button, input, textarea, select, [contenteditable="true"]'
        )
      ) {
        pointer = null
        session.setCursor(null)
        return
      }
      const rect = viewport.getBoundingClientRect()
      const inset = viewport.dataset.rulers === 'true' ? 20 : 0
      pointer = { x: event.clientX - rect.left - inset, y: event.clientY - rect.top - inset }
      if (
        pointer.x < 0 ||
        pointer.y < 0 ||
        pointer.x >= rect.width - inset ||
        pointer.y >= rect.height - inset
      ) {
        pointer = null
        session.setCursor(null)
        return
      }
      session.setCursor(controller.screenToWorld(pointer))
    }

    const leave = () => {
      pointer = null
      session.setCursor(null)
    }

    const interrupt = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        !['Escape', ' ', '+', '-', '=', '0', '1'].includes(event.key)
      )
        return
      if (
        event instanceof KeyboardEvent &&
        event.key !== 'Escape' &&
        !pointer &&
        !viewport.contains(document.activeElement)
      )
        return
      if (
        event instanceof KeyboardEvent &&
        event.key !== 'Escape' &&
        (event.target as Element).closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (session.getSnapshot().following) {
        session.follow(null)
        controller.stop()
      }
    }

    const pointerDown = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest(
          '.viewport-ui, button, input, textarea, select, [contenteditable="true"]'
        )
      ) {
        session.setPointerDown(true)
      }
    }

    const pointerUp = () => {
      session.setPointerDown(false)
    }

    viewport.addEventListener('pointermove', cursor, true)
    viewport.addEventListener('pointerleave', leave)
    viewport.addEventListener('pointerdown', interrupt, true)
    viewport.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointerup', pointerUp, true)
    viewport.addEventListener('wheel', interrupt, true)
    document.addEventListener('keydown', interrupt, true)
    window.addEventListener('blur', leave)
    schedule()

    return () => {
      unsubscribe()
      if (frame !== null) cancelAnimationFrame(frame)
      repaint.current = () => {}
      viewport.removeEventListener('pointermove', cursor, true)
      viewport.removeEventListener('pointerleave', leave)
      viewport.removeEventListener('pointerdown', interrupt, true)
      viewport.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerup', pointerUp, true)
      viewport.removeEventListener('wheel', interrupt, true)
      document.removeEventListener('keydown', interrupt, true)
      window.removeEventListener('blur', leave)
    }
  }, [session, store, controller])

  const following = state.peers.find(peer => peer.id === state.following)

  return (
    <>
      <div
        ref={root}
        className="collaboration-overlay"
        aria-hidden="true"
        data-testid="collaboration-overlay"
      >
        {state.peers
          .filter(peer => peer.status !== 'away')
          .map(peer => (
            <div key={peer.id} style={{ '--presence-color': peer.color } as CSSProperties}>
              {/* Peer viewport outline when zoomed out */}
              <div
                ref={node => {
                  if (node) peerViewports.current.set(peer.id, node)
                  else peerViewports.current.delete(peer.id)
                }}
                className="remote-viewport"
                data-testid="remote-viewport"
                data-viewport-peer={peer.id}
              >
                <span className="remote-viewport-label">
                  <span className="remote-viewport-avatar" style={{ background: peer.color }}>
                    {peer.avatar ? (
                      <img src={peer.avatar} alt="" className="remote-avatar-img" />
                    ) : (
                      initials(peer.name)
                    )}
                  </span>
                  <span>{peer.name}</span>
                </span>
              </div>

              {/* Active element selections with zoom-aware handles, avatar badge and dimensions */}
              {peer.selection
                .filter(id => scene.elements[id] && store.isVisible(id))
                .map(id => {
                  const key = `${peer.id}:${id}`
                  const node = scene.elements[id]
                  const peersOnElement = state.peers.filter(
                    p => p.status !== 'away' && p.selection.includes(id)
                  )
                  const peerIndex = peersOnElement.findIndex(p => p.id === peer.id)
                  const badgeOffsetY = peerIndex > 0 ? peerIndex * 22 : 0

                  return (
                    <div
                      key={id}
                      ref={boxNode => {
                        if (boxNode) selections.current.set(key, boxNode)
                        else selections.current.delete(key)
                      }}
                      className="remote-selection"
                      data-selection-key={key}
                      data-remote-element-id={id}
                      style={{ '--presence-color': peer.color } as CSSProperties}
                    >
                      <div className="remote-selection-handle top-left" />
                      <div className="remote-selection-handle top-right" />
                      <div className="remote-selection-handle bottom-left" />
                      <div className="remote-selection-handle bottom-right" />
                      <span
                        className="remote-selection-badge"
                        style={badgeOffsetY ? { transform: `translateY(-${badgeOffsetY}px)` } : undefined}
                      >
                        <span className="remote-selection-avatar" style={{ background: peer.color }}>
                          {peer.avatar ? (
                            <img src={peer.avatar} alt="" className="remote-avatar-img" />
                          ) : (
                            initials(peer.name)
                          )}
                        </span>
                        <span className="remote-selection-name">{peer.name}</span>
                        <span
                          className="remote-selection-dim"
                          ref={dimNode => {
                            if (dimNode) dimElements.current.set(key, dimNode)
                            else dimElements.current.delete(key)
                          }}
                        >
                          {node ? `${Math.round(node.width)} × ${Math.round(node.height)}` : ''}
                        </span>
                      </span>
                    </div>
                  )
                })}

              {/* Peer cursor with live coordinates, avatar and click pulse */}
              {peer.cursor && (
                <div
                  ref={node => {
                    if (node) cursors.current.set(peer.id, node)
                    else cursors.current.delete(peer.id)
                  }}
                  className={`remote-cursor${peer.pointerDown ? ' pointer-down' : ''}`}
                  data-cursor-id={peer.id}
                  data-status={peer.status}
                  data-testid="remote-cursor"
                >
                  <svg width="19" height="24" viewBox="0 0 19 24">
                    <path
                      d="M1.5 1.5v18l4.7-4.1 3.3 7.1 3.4-1.6-3.3-7.1 6.4-.4L1.5 1.5Z"
                      fill={peer.color}
                      stroke="#080808"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {peer.pointerDown && <div className="remote-cursor-click-ring" />}
                  <div className="remote-cursor-badge">
                    <span className="remote-cursor-avatar" style={{ background: peer.color }}>
                      {peer.avatar ? (
                        <img src={peer.avatar} alt="" className="remote-avatar-img" />
                      ) : (
                        initials(peer.name)
                      )}
                    </span>
                    <span className="remote-cursor-name">{peer.name}</span>
                    {peer.activity && (
                      <span className="remote-cursor-activity">• {peer.activity}</span>
                    )}
                    <span
                      className="remote-cursor-coords"
                      data-testid="cursor-coords"
                      ref={node => {
                        if (node) coordElements.current.set(peer.id, node)
                        else coordElements.current.delete(peer.id)
                      }}
                    >
                      {formatCursorCoordinates(peer.cursor.x, peer.cursor.y, 1)}
                    </span>
                  </div>
                  {peer.chat && <div className="remote-cursor-chat">{peer.chat}</div>}
                </div>
              )}

              {/* Off-screen edge radar badge for remote peers */}
              <button
                type="button"
                ref={node => {
                  if (node) edgeBadges.current.set(peer.id, node)
                  else edgeBadges.current.delete(peer.id)
                }}
                className="presence-edge-badge"
                data-testid="presence-edge-avatar"
                data-edge-peer={peer.id}
                style={{ display: 'none' }}
                onClick={() => {
                  const pos =
                    positions.current.get(peer.id) ?? peer.cursor ?? peer.viewport.center
                  const { camera, size } = controller.getSnapshot()
                  controller.setCamera(
                    {
                      x: size.width / 2 - pos.x * camera.zoom,
                      y: size.height / 2 - pos.y * camera.zoom,
                      zoom: camera.zoom,
                    },
                    true
                  )
                }}
                title={`Jump to ${peer.name}`}
              >
                <span
                  className="presence-edge-arrow"
                  ref={node => {
                    if (node) edgeArrows.current.set(peer.id, node)
                    else edgeArrows.current.delete(peer.id)
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <path d="M1 1l6 3-6 3V1z" fill={peer.color} />
                  </svg>
                </span>
                <span
                  className="presence-edge-avatar-circle"
                  style={{ background: peer.color }}
                >
                  {peer.avatar ? (
                    <img src={peer.avatar} alt="" className="remote-avatar-img" />
                  ) : (
                    initials(peer.name)
                  )}
                </span>
                <span className="presence-edge-name">{peer.name}</span>
                <span
                  className="presence-edge-coords"
                  ref={node => {
                    if (node) edgeCoords.current.set(peer.id, node)
                    else edgeCoords.current.delete(peer.id)
                  }}
                />
              </button>
            </div>
          ))}
      </div>
      {following && (
        <div className="follow-banner viewport-ui" role="status">
          <span style={{ background: following.color }} />
          <span>
            Following <strong>{following.name}</strong>
          </span>
          <button onClick={() => session.follow(null)}>
            Stop following <kbd>Esc</kbd>
          </button>
        </div>
      )}
    </>
  )
})
