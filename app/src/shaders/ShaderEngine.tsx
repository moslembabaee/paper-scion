import { Dithering, DotOrbit, FlutedGlass, GrainGradient, HalftoneCmyk, MeshGradient, Metaballs, NeuroNoise, PerlinNoise, ShaderMount, Warp } from '@paper-design/shaders-react'
import type { FlutedGlassProps, HalftoneCmykProps, PaperShaderElement, ShaderMountProps } from '@paper-design/shaders-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ShaderPaint } from './types'
import { meshUniforms } from './mesh'
import { meshFragmentShader } from './meshFragment'
import { gradientUniforms } from './gradient'
import { gradientFragmentShader } from './gradientFragment'
import { proceduralNoiseFragmentShader, proceduralNoiseUniforms } from './noise/noiseFragment'
import { createMultiPassUniformUpdater, multiPassFragmentShader, multiPassUniforms } from './pipeline/multiPassFragment'
import { glassmorphismFragmentShader, glassmorphismUniforms } from './refractive/glassmorphismFragment'
import { liquidChromeFragmentShader, liquidChromeUniforms } from './refractive/liquidChromeFragment'
import type { GlassmorphismPaint, LiquidChromePaint } from './refractive/types'
import { MaterialShaderMount } from './materials/MaterialShaderMount'
import { FluidShaderMount } from './fluid/FluidShaderMount'
import { ParticleShaderMount } from './particle/ParticleShaderMount'
import { ExtrusionShaderMount } from './extrusion/ExtrusionShaderMount'
import { audioAnalysis } from './audio/engine'
import { PostProcessingSurface } from '../canvas/postprocessing/PostProcessingSurface'
import '../canvas/postprocessing/postprocessing.css'

function useSourceImage(source: string, onError: () => void) {
  const [loaded, setLoaded] = useState<{ source: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    let active = true
    const image = new Image()
    const url = new URL(source, document.baseURI)
    if (/^https?:$/.test(url.protocol) && url.origin !== window.location.origin) image.crossOrigin = 'anonymous'
    image.onload = () => { if (active) setLoaded({ source, image }) }
    image.onerror = () => { if (active) onError() }
    image.src = url.href
    return () => { active = false; image.onload = null; image.onerror = null }
  }, [source, onError])
  return loaded?.source === source ? loaded.image : null
}

/** Image filters have no u_time; drive one uniform directly without React renders. */
function useFilterMotion(ref: RefObject<PaperShaderElement | null>, ready: boolean, speed: number, frame: number, value: number, glass: boolean) {
  useEffect(() => {
    if (!ready || speed === 0) return
    let request = 0
    const start = performance.now()
    const tick = (now: number) => {
      const mount = ref.current?.paperShaderMount
      if (mount) {
        const time = frame + (now - start) * speed
        mount.setUniforms(glass
          ? { u_shift: Math.max(-1, Math.min(1, value + Math.sin(time * .0002) * .08)) }
          : { u_rotation: (value + Math.sin(time * .0002) * 3) * Math.PI / 180 })
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [ref, ready, speed, frame, value, glass])
}

function ImageHalftone({ source, onError, ...props }: Omit<HalftoneCmykProps, 'image'> & { source: string; onError: () => void }) {
  const ref = useRef<PaperShaderElement>(null)
  const image = useSourceImage(source, onError)
  useFilterMotion(ref, !!image, props.speed ?? 0, props.frame ?? 0, props.rotation ?? 0, false)
  const rotation = (props.rotation ?? 0) + Math.sin((props.frame ?? 0) * .0002) * 3
  return image ? <HalftoneCmyk {...props} ref={ref} rotation={rotation} speed={0} image={image} /> : null
}

function ImageGlass({ source, onError, ...props }: Omit<FlutedGlassProps, 'image'> & { source: string; onError: () => void }) {
  const ref = useRef<PaperShaderElement>(null)
  const image = useSourceImage(source, onError)
  useFilterMotion(ref, !!image, props.speed ?? 0, props.frame ?? 0, props.shift ?? 0, true)
  const shift = Math.max(-1, Math.min(1, (props.shift ?? 0) + Math.sin((props.frame ?? 0) * .0002) * .08))
  return image ? <FlutedGlass {...props} ref={ref} shift={shift} speed={0} image={image} /> : null
}

function useMultiPassModulator(
  ref: RefObject<PaperShaderElement | null>,
  paint: Extract<ShaderPaint, { kind: 'multi-pass' }>,
  paused: boolean
) {
  useEffect(() => {
    if (paused || !paint.animated) return
    const hasLfo = paint.speed !== 0 && paint.pipeline?.modulators?.some(m => m.enabled && (!m.source || m.source === 'lfo'))
    const hasAudio = paint.pipeline?.modulators?.some(m => m.enabled && m.source && m.source !== 'lfo')
    if (!hasLfo && !hasAudio) return
    const update = createMultiPassUniformUpdater(paint)
    let request = 0
    const start = performance.now()
    const tick = (now: number) => {
      const mount = ref.current?.paperShaderMount
      if (mount) {
        const elapsed = (now - start) * paint.speed
        mount.setUniforms(update(elapsed, hasAudio ? audioAnalysis.getFrame() : undefined))
      }
      if (hasLfo) request = requestAnimationFrame(tick)
    }
    if (hasLfo) request = requestAnimationFrame(tick)
    const unsubscribe = hasAudio ? audioAnalysis.subscribeFrame(() => {
      // The analyser already owns the frame clock for audio-only materials.
      if (!hasLfo) tick(performance.now())
    }) : undefined
    return () => { cancelAnimationFrame(request); unsubscribe?.() }
  }, [ref, paint, paused])
}

function MultiPassShaderMount({
  paint,
  common,
  paused,
}: {
  paint: Extract<ShaderPaint, { kind: 'multi-pass' }>
  common: Omit<ShaderMountProps, 'fragmentShader' | 'uniforms'>
  paused: boolean
}) {
  const ref = useRef<PaperShaderElement>(null)
  useMultiPassModulator(ref, paint, paused)
  return <ShaderMount ref={ref} {...common} fragmentShader={multiPassFragmentShader} uniforms={multiPassUniforms(paint, 0)} />
}

/** Uniform updates stay inside Paper's WebGL engine, outside React's frame loop. */
type ShaderEngineProps = { paint: ShaderPaint; paused: boolean; onError: () => void; captureScale?: number; capturePixelCount?: number }
export default function ShaderEngine(props: ShaderEngineProps) {
  const active = props.paint.postProcessing?.enabled && props.paint.postProcessing.passes.some(pass => pass.enabled && pass.opacity > 0)
  const source = <ShaderSource {...props} />
  return active && !props.captureScale ? <PostProcessingSurface paint={props.paint} paused={props.paused}>{source}</PostProcessingSurface> : source
}

function ShaderSource({ paint, paused, onError, captureScale, capturePixelCount }: ShaderEngineProps) {
  const common = {
    width: '100%', height: '100%', style: { position: 'absolute' as const, inset: 0 },
    minPixelRatio: captureScale ?? 1, maxPixelCount: capturePixelCount ?? (captureScale ? 64_000_000 : 1_500_000),
    speed: paused || !paint.animated ? 0 : paint.speed,
    frame: paint.frame,
    webGlContextAttributes: { alpha: true, antialias: false, powerPreference: 'high-performance' as const, preserveDrawingBuffer: !!captureScale || !!paint.postProcessing?.enabled },
  }
  const placement = { scale: paint.scale, rotation: paint.rotation, offsetX: paint.offsetX, offsetY: paint.offsetY }
  switch (paint.kind) {
    case 'mesh-gradient': return paint.mesh ? <ShaderMount {...common} fragmentShader={meshFragmentShader} uniforms={meshUniforms(paint)} /> : <MeshGradient {...common} {...placement} {...paint.params} colors={[...paint.params.colors]} />
    case 'dot-orbit': return <DotOrbit {...common} {...placement} {...paint.params} colors={[...paint.params.colors]} />
    case 'grain-gradient': return <GrainGradient {...common} {...placement} {...paint.params} colors={[...paint.params.colors]} />
    case 'halftone-cmyk': return <ImageHalftone {...common} {...placement} {...paint.params} source={paint.params.image} onError={onError} fit="cover" />
    case 'neuro-noise': return <NeuroNoise {...common} {...placement} {...paint.params} />
    case 'gooey': return <Metaballs {...common} {...placement} {...paint.params} colors={[...paint.params.colors]} />
    case 'dithering': return <Dithering {...common} {...placement} {...paint.params} />
    case 'perlin-noise': return <PerlinNoise {...common} {...placement} {...paint.params} />
    case 'liquid-distortion': return <Warp {...common} {...placement} {...paint.params} colors={[...paint.params.colors]} />
    case 'glass-refraction': return <ImageGlass {...common} {...placement} {...paint.params} source={paint.params.image} onError={onError} fit="cover" />
    case 'multi-pass': return <MultiPassShaderMount paint={paint} common={common} paused={paused} />
    case 'procedural-noise': return <ShaderMount {...common} {...placement} fragmentShader={proceduralNoiseFragmentShader} uniforms={proceduralNoiseUniforms(paint)} />
    case 'multi-stop-gradient': return <ShaderMount {...common} {...placement} fragmentShader={gradientFragmentShader} uniforms={gradientUniforms(paint)} />
    case 'glassmorphism': return <ShaderMount {...common} {...placement} fragmentShader={glassmorphismFragmentShader} uniforms={glassmorphismUniforms(paint as GlassmorphismPaint)} />
    case 'liquid-chrome': return <ShaderMount {...common} {...placement} fragmentShader={liquidChromeFragmentShader} uniforms={liquidChromeUniforms(paint as LiquidChromePaint)} />
    case 'shader-material': return <MaterialShaderMount paint={paint} common={{ ...common, ...placement }} paused={paused} />
    case 'fluid-simulation': return <FluidShaderMount paint={paint} common={{ ...common, ...placement }} paused={paused} />
    case 'particle-simulation': return <ParticleShaderMount paint={paint} common={{ ...common, ...placement }} paused={paused} />
    case 'vector-extrusion': return <ExtrusionShaderMount paint={paint} common={{ ...common, ...placement }} paused={paused} />
  }
}
