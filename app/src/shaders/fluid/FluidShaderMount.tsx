import { useCallback, useEffect, useRef } from 'react'
import type { ShaderPaint } from '../types.ts'
import { FluidSimulationEngine } from './FluidSimulationEngine.ts'

export interface FluidShaderMountProps {
  readonly paint: Extract<ShaderPaint, { kind: 'fluid-simulation' }>
  readonly common: {
    readonly width?: string | number
    readonly height?: string | number
    readonly style?: React.CSSProperties
    readonly speed?: number
    readonly frame?: number
  }
  readonly paused?: boolean
}

export function FluidShaderMount({ paint, common, paused = false }: FluidShaderMountProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<FluidSimulationEngine | null>(null)
  const isPointerDownRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)

  const paintRef = useRef(paint)
  paintRef.current = paint

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (paused) return
    isPointerDownRef.current = true
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    lastPosRef.current = { x: normX, y: normY }

    // Emit initial splash ripple on tap / press
    const engine = engineRef.current
    if (engine) {
      engine.addSplash(
        normX,
        normY,
        paintRef.current.params.splatRadius,
        paintRef.current.params.splatForce,
        paintRef.current.params.dyeColors[0] ?? '#81adec'
      )
    }
  }, [paused])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (paused) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))

    const engine = engineRef.current
    if (!engine) return

    if (lastPosRef.current) {
      const dx = (normX - lastPosRef.current.x) * rect.width
      const dy = (normY - lastPosRef.current.y) * rect.height
      const speed = Math.hypot(dx, dy)

      // When dragging or moving swiftly, emit impulses
      if (speed > 0.5) {
        engine.addPointerImpulse(
          normX,
          normY,
          dx,
          dy,
          paintRef.current.params.dyeColors
        )
      }
    }

    lastPosRef.current = { x: normX, y: normY }
  }, [paused])

  const handlePointerUp = useCallback(() => {
    isPointerDownRef.current = false
    lastPosRef.current = null
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let engine: FluidSimulationEngine | null = null
    try {
      engine = new FluidSimulationEngine(canvas, paintRef.current.params.gridResolution)
      engineRef.current = engine
    } catch {
      // If WebGL2 failed to initialize, gracefully return
      return
    }

    let animId = 0
    let lastTime = performance.now()

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(rect.width * dpr))
      const h = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const renderLoop = (now: number) => {
      const dt = Math.min(0.033, (now - lastTime) / 1000)
      lastTime = now

      if (!paused && engine) {
        engine.step(dt, paintRef.current.params, now * 0.001)
      }

      animId = requestAnimationFrame(renderLoop)
    }

    animId = requestAnimationFrame(renderLoop)

    return () => {
      cancelAnimationFrame(animId)
      observer.disconnect()
      engine?.dispose()
      engineRef.current = null
    }
  }, [paused])

  return (
    <div
      ref={containerRef}
      className="fluid-shader-mount-container"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        ...common.style,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <canvas
        ref={canvasRef}
        className="fluid-simulation-canvas"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  )
}
