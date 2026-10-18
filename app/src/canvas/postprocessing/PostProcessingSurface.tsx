import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ShaderPaint } from '../../shaders/types.ts'
import { PostProcessingCompositor } from './Compositor.ts'
import type { CanvasPostProcessingPipeline } from './types.ts'

/** The source remains mounted so Paper owns animation, images and shader uniforms.
 * Only the processed pixels replace it; scene geometry and the engineering grid stay crisp. */
export function PostProcessingSurface({ paint, paused, children }: { paint: ShaderPaint; paused: boolean; children: ReactNode }) {
  const sourceRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLCanvasElement>(null)
  const current = useRef({ paint, paused })
  const invalidate = useRef<(() => void) | null>(null)
  useEffect(() => { current.current = { paint, paused }; invalidate.current?.() }, [paint, paused])
  useEffect(() => {
    const host = sourceRef.current!
    const output = outputRef.current!
    let compositor: PostProcessingCompositor
    try { compositor = new PostProcessingCompositor(output) } catch { return }
    let request = 0
    let extraFrames = 0
    let failed = false
    let pipeline: CanvasPostProcessingPipeline | undefined
    let elapsed = current.current.paint.frame / 1000
    let savedFrame = current.current.paint.frame
    let previous = performance.now()
    const revealSource = () => { host.style.opacity = ''; output.hidden = true; output.dataset.ready = 'false' }
    const lost = (event: Event) => { event.preventDefault(); failed = true; cancelAnimationFrame(request); revealSource() }
    output.addEventListener('webglcontextlost', lost)
    const tick = (now: number) => {
      request = 0
      if (failed) return
      const { paint: next, paused: stopped } = current.current
      const animated = !stopped && next.animated
      if (next.frame !== savedFrame) { elapsed = next.frame / 1000; savedFrame = next.frame }
      if (animated) elapsed += Math.min(100, now - previous) / 1000
      else elapsed = next.frame / 1000
      previous = now
      try {
        if (pipeline !== next.postProcessing) {
          pipeline = next.postProcessing
          if (pipeline) compositor.setPipeline(pipeline)
        }
        const source = host.querySelector('canvas')
        if (source && (source.parentElement as { paperShaderMount?: unknown } | null)?.paperShaderMount && compositor.render(source, elapsed)) {
          output.hidden = false
          output.dataset.ready = 'true'
          host.style.opacity = '0'
        }
      } catch { failed = true; revealSource(); compositor.dispose(); return }
      const isTemporal = next.postProcessing?.passes.some(pass => {
        if (!pass.enabled || pass.opacity === 0) return false
        if (pass.type === 'film-grain' && pass.params.temporal && pass.params.speed > 0 && pass.params.intensity > 0) return true
        if (pass.type === 'procedural-grain' && pass.params.temporal && pass.params.speed > 0 && pass.params.intensity > 0) return true
        if (pass.type === 'frosted-glass' && (pass.params.surfacePattern === 'rippled' || pass.params.surfacePattern === 'frosted') && pass.params.frostIntensity > 0) return true
        return false
      })
      if ((animated && (next.speed !== 0 || isTemporal)) || (!animated && isTemporal) || extraFrames-- > 0) request = requestAnimationFrame(tick)
    }
    const update = () => {
      if (failed) return
      extraFrames = 2
      previous = performance.now()
      if (!request) request = requestAnimationFrame(tick)
    }
    invalidate.current = update
    const mutation = new MutationObserver(update)
    mutation.observe(host, { childList: true, subtree: true })
    const resize = new ResizeObserver(update)
    resize.observe(host)
    update()
    return () => {
      invalidate.current = null
      cancelAnimationFrame(request)
      mutation.disconnect()
      resize.disconnect()
      output.removeEventListener('webglcontextlost', lost)
      revealSource()
      compositor.dispose()
    }
  }, [])
  return <div className="post-processing-surface" data-post-processing="true">
    <div className="post-processing-source" ref={sourceRef}>{children}</div>
    <canvas ref={outputRef} className="post-processing-output" data-post-processing-output="true" hidden aria-hidden="true" />
  </div>
}
