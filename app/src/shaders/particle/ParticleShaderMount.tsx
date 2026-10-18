import { useCallback, useEffect, useRef } from 'react'
import type { ShaderPaint } from '../types.ts'
import { ParticleSimulationEngine } from './ParticleSimulationEngine.ts'

export interface ParticleShaderMountProps {
  readonly paint: Extract<ShaderPaint, { kind: 'particle-simulation' }>
  readonly common: {
    readonly width?: string | number
    readonly height?: string | number
    readonly style?: React.CSSProperties
    readonly speed?: number
    readonly frame?: number
  }
  readonly paused?: boolean
}

export function ParticleShaderMount({ paint, common, paused = false }: ParticleShaderMountProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<ParticleSimulationEngine | null>(null)
  const isPointerDownRef = useRef(false)

  const paintRef = useRef(paint)
  paintRef.current = paint

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (paused) return
    isPointerDownRef.current = true
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))

    const engine = engineRef.current
    if (engine) {
      engine.setCursor(normX, normY, true, true)
      engine.triggerPulse(paintRef.current.params.magneticForce * 1.5)
    }
  }, [paused])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (paused) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))

    const engine = engineRef.current
    if (engine) {
      engine.setCursor(normX, normY, true, isPointerDownRef.current)
    }
  }, [paused])

  const handlePointerUp = useCallback(() => {
    isPointerDownRef.current = false
    const engine = engineRef.current
    if (engine) {
      engine.setCursor(0.5, 0.5, false, false)
    }
  }, [])

  const handlePointerLeave = useCallback(() => {
    isPointerDownRef.current = false
    const engine = engineRef.current
    if (engine) {
      engine.setCursor(0.5, 0.5, false, false)
    }
  }, [])

  // Initialize WebGL2 Particle Simulation Engine
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const engine = new ParticleSimulationEngine(canvas, paintRef.current.params)
      engineRef.current = engine

      const container = containerRef.current
      if (container) {
        const rect = container.getBoundingClientRect()
        engine.resize(rect.width || 512, rect.height || 512)
      }

      return () => {
        engine.dispose()
        engineRef.current = null
      }
    } catch (err) {
      console.warn('ParticleSimulationEngine initialization failed:', err)
    }
  }, [])

  // Handle Container Resizing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          engineRef.current?.resize(width, height)
        }
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Animation Frame Loop
  useEffect(() => {
    let animId = 0

    const loop = (now: number) => {
      const engine = engineRef.current
      if (engine) {
        engine.setPaused(paused)
        if (!paused) {
          const speedFactor = (paintRef.current.speed ?? 1)
          const adjustedTime = now * speedFactor
          engine.step(paintRef.current.params, adjustedTime)
        }
      }
      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [paused])

  return (
    <div
      ref={containerRef}
      className="particle-shader-mount-container"
      style={{
        position: 'absolute',
        inset: 0,
        width: common.width ?? '100%',
        height: common.height ?? '100%',
        overflow: 'hidden',
        pointerEvents: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        ...common.style,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas
        ref={canvasRef}
        className="particle-simulation-canvas"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
