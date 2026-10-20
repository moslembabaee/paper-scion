import { ShaderMount } from '@paper-design/shaders-react'
import type { PaperShaderElement, ShaderMountProps } from '@paper-design/shaders-react'
import { useCallback, useEffect, useRef } from 'react'
import type { ShaderPaint } from '../types.ts'
import { materialFragmentShader, materialUniforms } from './materialFragment.ts'

export interface MaterialShaderMountProps {
  readonly paint: Extract<ShaderPaint, { kind: 'shader-material' }>
  readonly common: Omit<ShaderMountProps, 'fragmentShader' | 'uniforms'>
  readonly paused?: boolean
}

export function MaterialShaderMount({ paint, common, paused = false }: MaterialShaderMountProps) {
  const elementRef = useRef<PaperShaderElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const reactivity = paint.params.mouseReactivity ?? 0.5

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (paused || reactivity <= 0.01) return
    const target = containerRef.current
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))

    const mount = elementRef.current?.paperShaderMount
    if (mount) {
      mount.setUniforms({
        u_mouse: [normX, normY],
        u_mouseActive: 1.0,
      })
    }
  }, [paused, reactivity])

  const handlePointerLeave = useCallback(() => {
    const mount = elementRef.current?.paperShaderMount
    if (mount) {
      mount.setUniforms({
        u_mouseActive: 0.0,
      })
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('pointermove', handlePointerMove, { passive: true })
    container.addEventListener('pointerleave', handlePointerLeave, { passive: true })

    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [handlePointerMove, handlePointerLeave])

  const uniforms = materialUniforms(paint)

  useEffect(() => {
    const mount = elementRef.current?.paperShaderMount
    if (mount) {
      mount.setUniforms(uniforms)
    }
  }, [uniforms])

  return (
    <div
      ref={containerRef}
      className="material-shader-mount-container"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <ShaderMount
        ref={elementRef}
        {...common}
        fragmentShader={materialFragmentShader}
        uniforms={uniforms}
      />
    </div>
  )
}
