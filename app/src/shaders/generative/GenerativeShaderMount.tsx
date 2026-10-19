import { ShaderMount } from '@paper-design/shaders-react'
import type { PaperShaderElement, ShaderMountProps } from '@paper-design/shaders-react'
import { useCallback, useEffect, useRef } from 'react'
import type { ShaderPaint } from '../types.ts'
import { generativeFragmentShader, generativeUniforms } from './generativeFragment.ts'

export interface GenerativeShaderMountProps {
  readonly paint: Extract<ShaderPaint, { kind: 'generative-material' }>
  readonly common: Omit<ShaderMountProps, 'fragmentShader' | 'uniforms'>
  readonly paused?: boolean
}

export function GenerativeShaderMount({ paint, common, paused = false }: GenerativeShaderMountProps) {
  const elementRef = useRef<PaperShaderElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (paused) return
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
  }, [paused])

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

  const uniforms = generativeUniforms(paint)

  return (
    <div
      ref={containerRef}
      className="generative-shader-mount-container"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <ShaderMount
        ref={elementRef}
        {...common}
        fragmentShader={generativeFragmentShader}
        uniforms={uniforms}
      />
    </div>
  )
}
