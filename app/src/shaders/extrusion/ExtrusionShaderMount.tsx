import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { ShaderPaint } from '../types.ts'
import { ExtrusionEngine } from './ExtrusionEngine.ts'
import type { ShapeGeometry, VectorExtrusionParams } from './types.ts'

interface ExtrusionShaderMountProps {
  readonly paint: Extract<ShaderPaint, { kind: 'vector-extrusion' }> | { params: VectorExtrusionParams; animated?: boolean; speed?: number; frame?: number }
  readonly common?: {
    readonly width?: string | number
    readonly height?: string | number
    readonly style?: CSSProperties
    readonly speed?: number
    readonly frame?: number
    readonly minPixelRatio?: number
    readonly maxPixelCount?: number
  }
  readonly shapeGeometry?: ShapeGeometry | null
  readonly paused?: boolean
}

export const ExtrusionShaderMount = memo(function ExtrusionShaderMount({
  paint,
  common,
  shapeGeometry,
  paused = false,
}: ExtrusionShaderMountProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<ExtrusionEngine | null>(null)
  const animFrameRef = useRef<number>(0)

  const params: VectorExtrusionParams = paint.params as VectorExtrusionParams
  const animated = 'animated' in paint ? paint.animated : true
  const speed = 'speed' in paint ? paint.speed : (common?.speed ?? 0.35)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let engine: ExtrusionEngine | null = null
    try {
      engine = new ExtrusionEngine(canvas)
      engineRef.current = engine
    } catch (e) {
      console.warn('Failed to initialize ExtrusionEngine:', e)
      return
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, common?.minPixelRatio ?? 2)
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      engine?.render(params, shapeGeometry)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    return () => {
      observer.disconnect()
      if (engine) {
        engine.dispose()
        engineRef.current = null
      }
    }
  }, [shapeGeometry])

  // Animation / Render loop
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return

    const effectiveSpeed = speed ?? 1
    const tick = (time: number) => {
      let currentParams = params
      if (animated && !paused && effectiveSpeed > 0) {
        // Subtle dynamic light orbiting if animated
        const dynamicAzimuth = (params.lightAzimuth + (time * 0.02 * effectiveSpeed)) % 360
        currentParams = { ...params, lightAzimuth: dynamicAzimuth }
      }
      engine.render(currentParams, shapeGeometry)
      if (animated && !paused && effectiveSpeed > 0) {
        animFrameRef.current = requestAnimationFrame(tick)
      }
    }

    if (animated && !paused && effectiveSpeed > 0) {
      animFrameRef.current = requestAnimationFrame(tick)
    } else {
      engine.render(params, shapeGeometry)
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [params, shapeGeometry, animated, paused, speed])

  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    ...common?.style,
  }

  return (
    <canvas
      ref={canvasRef}
      className="paper-extrusion-canvas"
      data-testid="extrusion-canvas"
      style={style}
    />
  )
})
