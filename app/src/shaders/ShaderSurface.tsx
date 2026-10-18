import { Component, lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ShaderPaint } from './types'
import './shaders.css'

const ShaderEngine = lazy(() => import('./ShaderEngine'))
let supported: boolean | undefined
function hasWebGL() {
  if (supported === undefined) {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    supported = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return supported
}

class ShaderBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

function fallbackPaint(paint: ShaderPaint): string {
  if ('colors' in paint.params) return `linear-gradient(135deg, ${paint.params.colors.join(', ')})`
  if ('colorMid' in paint.params) return `linear-gradient(135deg, ${(paint.params as any).colorBack}, ${(paint.params as any).colorMid}, ${(paint.params as any).colorFront})`
  if ('colorBack' in paint.params) return (paint.params as any).colorBack
  if ('tintColor' in paint.params) return (paint.params as any).tintColor
  if ('baseColor' in paint.params) return (paint.params as any).baseColor
  if ('dyeColors' in paint.params && Array.isArray((paint.params as any).dyeColors)) return `linear-gradient(135deg, ${((paint.params as any).dyeColors as string[]).join(', ')})`
  if ('particleColors' in paint.params && Array.isArray((paint.params as any).particleColors)) return `linear-gradient(135deg, ${((paint.params as any).particleColors as string[]).join(', ')})`
  return '#edebe1'
}

/** Culling releases WebGL contexts. Hidden tabs and reduced motion use a static frame. */
export const ShaderSurface = memo(function ShaderSurface({ paint, style, className = '' }: { paint: ShaderPaint; style?: CSSProperties; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [paused, setPaused] = useState(true)
  const resource = 'image' in paint.params ? `${paint.kind}:${paint.params.image}` : paint.kind
  const [failedResource, setFailedResource] = useState<string | null>(null)
  const fail = useCallback(() => setFailedResource(resource), [resource])
  useEffect(() => {
    const root = ref.current!
    const viewport = root.closest('.canvas-viewport')
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { root: viewport, threshold: 0 })
    observer.observe(root)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => setPaused(document.hidden || media.matches)
    const lost = (event: Event) => {
      // The finishing compositor can fall back to its source without discarding it.
      if (event.target instanceof HTMLCanvasElement && event.target.hasAttribute('data-post-processing-output')) return
      fail()
    }
    motion()
    document.addEventListener('visibilitychange', motion)
    media.addEventListener('change', motion)
    root.addEventListener('webglcontextlost', lost, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', motion)
      media.removeEventListener('change', motion)
      root.removeEventListener('webglcontextlost', lost, true)
    }
  }, [fail])
  const render = visible && failedResource !== resource && hasWebGL()
  return <div ref={ref} className={`paper-shader-surface shader-surface ${className}`} data-shader={paint.kind} data-shader-fallback={visible && !render ? 'true' : undefined} style={{ background: render ? undefined : fallbackPaint(paint), mixBlendMode: paint.composite?.blendMode ?? 'normal', opacity: paint.composite?.opacity ?? 1, ...style }} aria-hidden="true">
    {render && <ShaderBoundary key={paint.kind} onError={fail}><Suspense fallback={null}><ShaderEngine key={`${paint.kind}:${paint.animated && !paused}`} paint={paint} paused={paused} onError={fail} /></Suspense></ShaderBoundary>}
  </div>
})
