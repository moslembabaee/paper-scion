import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { SceneElement, TextElement } from '../scene/types.ts'
import { calculateStaggerDelay, evaluateWaveform } from '../scene/glyphDecomposition.ts'
import {
  easingProgress,
  findAdjacentKeyframeTimes,
  isPathProperty,
  isShaderProperty,
  isTypographyProperty,
  sampleTimes,
  trackValue,
} from './model.ts'
import { computeStrokeTrimDash, interpolatePathShapes, SHAPE_PRESETS } from './pathInterpolation.ts'
import type { MotionDocument, MotionProperty } from './types.ts'

interface GlyphRecord {
  readonly element: HTMLElement | SVGElement
  readonly originalTransform: string
  readonly originalFontVariationSettings?: string
  readonly originalAnimation: string
}

interface ModifiedNodeRecord {
  readonly node: HTMLElement
  readonly shaderSurface: HTMLElement | null
  readonly originalTransform: string
  readonly originalOpacity: string
  readonly originalTransformOrigin: string
  readonly textContainer?: HTMLElement | null
  readonly originalFontVariationSettings?: string
  readonly originalFontWeight?: string
  readonly originalFontStretch?: string
  readonly originalLetterSpacing?: string
  readonly originalFontSize?: string
  readonly originalLineHeight?: string
  readonly textPathElement?: SVGTextPathElement | null
  readonly originalStartOffset?: string
  glyphRecords?: GlyphRecord[]
  readonly pathElement?: SVGPathElement | null
  readonly originalPathD?: string
  readonly originalStrokeDasharray?: string
  readonly originalStrokeDashoffset?: string
  readonly originalStrokeWidth?: string
  rectElement?: SVGRectElement | null
  readonly originalRx?: string
  readonly originalRy?: string
  readonly originalBorderRadius?: string
}

/** Native paused animations and WebGL shader modulations isolate preview from scene edits, history and autosave. */
export function useMotionPlayback(
  motion: MotionDocument,
  elements: Readonly<Record<string, SceneElement>>,
  stage: RefObject<HTMLElement | null>,
) {
  const [playing, setPlaying] = useState(false)
  const [preview, setPreview] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)

  const time = useRef(0)
  const publishedTime = useRef(0)
  const looping = useRef(!!motion.loop)
  const playbackRateRef = useRef(playbackRate)

  useEffect(() => {
    playbackRateRef.current = playbackRate
  }, [playbackRate])

  useEffect(() => {
    looping.current = !!motion.loop
  }, [motion.loop])

  const animations = useRef<Animation[]>([])
  const modifiedElements = useRef<ModifiedNodeRecord[]>([])

  const root = useRef<HTMLElement>(null)
  const readout = useRef<HTMLOutputElement>(null)
  const scrubber = useRef<HTMLInputElement>(null)

  const duration = motion.duration

  const cleanOverrides = useCallback(() => {
    for (const record of modifiedElements.current) {
      if (record.shaderSurface) {
        record.shaderSurface.style.opacity = record.originalOpacity
        record.shaderSurface.style.transform = record.originalTransform
        record.shaderSurface.style.transformOrigin = record.originalTransformOrigin
      }
      record.node.style.removeProperty('--shader-opacity')
      record.node.style.removeProperty('--shader-scale')
      record.node.style.removeProperty('--shader-rotation')
      record.node.style.removeProperty('--shader-offset-x')
      record.node.style.removeProperty('--shader-offset-y')
      record.node.style.removeProperty('--shader-speed')

      if (record.textContainer) {
        if (record.originalFontVariationSettings !== undefined) {
          record.textContainer.style.fontVariationSettings = record.originalFontVariationSettings
        }
        if (record.originalFontWeight !== undefined) {
          record.textContainer.style.fontWeight = record.originalFontWeight
        }
        if (record.originalFontStretch !== undefined) {
          record.textContainer.style.fontStretch = record.originalFontStretch
        }
        if (record.originalLetterSpacing !== undefined) {
          record.textContainer.style.letterSpacing = record.originalLetterSpacing
        }
        if (record.originalFontSize !== undefined) {
          record.textContainer.style.fontSize = record.originalFontSize
        }
        if (record.originalLineHeight !== undefined) {
          record.textContainer.style.lineHeight = record.originalLineHeight
        }
      }
      if (record.textPathElement && record.originalStartOffset !== undefined) {
        record.textPathElement.setAttribute('startOffset', record.originalStartOffset)
      }
      if (record.glyphRecords) {
        for (const g of record.glyphRecords) {
          g.element.style.transform = g.originalTransform
          if (g.originalFontVariationSettings !== undefined && 'fontVariationSettings' in g.element.style) {
            (g.element as HTMLElement).style.fontVariationSettings = g.originalFontVariationSettings
          }
          g.element.style.animation = g.originalAnimation
        }
      }
      if (record.pathElement) {
        if (record.originalPathD !== undefined) {
          record.pathElement.setAttribute('d', record.originalPathD)
        }
        if (record.originalStrokeDasharray !== undefined) {
          if (record.originalStrokeDasharray) {
            record.pathElement.style.strokeDasharray = record.originalStrokeDasharray
          } else {
            record.pathElement.style.removeProperty('stroke-dasharray')
          }
        }
        if (record.originalStrokeDashoffset !== undefined) {
          if (record.originalStrokeDashoffset) {
            record.pathElement.style.strokeDashoffset = record.originalStrokeDashoffset
          } else {
            record.pathElement.style.removeProperty('stroke-dashoffset')
          }
        }
        if (record.originalStrokeWidth !== undefined) {
          if (record.originalStrokeWidth) {
            record.pathElement.setAttribute('stroke-width', record.originalStrokeWidth)
            record.pathElement.style.strokeWidth = record.originalStrokeWidth
          } else {
            record.pathElement.style.removeProperty('stroke-width')
          }
        }
      }
      record.node.style.removeProperty('--kinetic-phase')
      record.node.style.removeProperty('--cascade-amplitude')
      record.node.style.removeProperty('--cascade-rotation')
      record.node.style.removeProperty('--kinetic-stagger')
      record.node.style.removeProperty('--kinetic-weight-mod')
      record.node.style.removeProperty('--kinetic-slant-mod')
      record.node.style.removeProperty('--kinetic-scale-mod')
    }
    modifiedElements.current = []
  }, [])

  const paint = useCallback(
    (value: number, applyPreview = preview, publish = true) => {
      time.current = Math.max(0, Math.min(duration, value))
      // Keep the playhead at display refresh rate; React telemetry needs only 20 Hz.
      if (publish || Math.abs(time.current - publishedTime.current) >= 50) {
        publishedTime.current = time.current
        setCurrentTimeMs(time.current)
      }

      // Update Web Animations API animations
      animations.current.forEach(animation => {
        animation.currentTime = time.current
      })

      // Update shader properties directly on canvas elements
      const shaderTracks = motion.tracks.filter(t => t.enabled && isShaderProperty(t.property))
      if (applyPreview && shaderTracks.length > 0 && stage.current) {
        const shaderElementIds = new Set(shaderTracks.map(t => t.elementId))
        for (const id of shaderElementIds) {
          const node = stage.current.querySelector<HTMLElement>(
            `.viewport-world .scene-node[data-element-id="${CSS.escape(id)}"]`
          )
          if (!node) continue

          const shaderSurface = node.querySelector<HTMLElement>('.paper-shader-surface')
          const existing = modifiedElements.current.find(m => m.node === node)
          if (!existing) {
            modifiedElements.current.push({
              node,
              shaderSurface,
              originalTransform: shaderSurface?.style.transform ?? '',
              originalOpacity: shaderSurface?.style.opacity ?? '',
              originalTransformOrigin: shaderSurface?.style.transformOrigin ?? '',
            })
          }

          const elemTracks = shaderTracks.filter(t => t.elementId === id)
          const values: Partial<Record<MotionProperty, number>> = {}
          for (const t of elemTracks) {
            values[t.property] = trackValue(t, time.current)
          }

          if (values.shaderOpacity !== undefined) {
            if (shaderSurface) shaderSurface.style.opacity = String(values.shaderOpacity)
            node.style.setProperty('--shader-opacity', String(values.shaderOpacity))
          }
          if (values.shaderSpeed !== undefined) {
            node.style.setProperty('--shader-speed', String(values.shaderSpeed))
          }

          const scale = values.shaderScale
          const rot = values.shaderRotation
          const offX = values.shaderOffsetX
          const offY = values.shaderOffsetY

          if (scale !== undefined || rot !== undefined || offX !== undefined || offY !== undefined) {
            const transforms: string[] = []
            if (offX !== undefined || offY !== undefined) {
              transforms.push(`translate(${(offX ?? 0) * 100}%, ${(offY ?? 0) * 100}%)`)
            }
            if (rot !== undefined) transforms.push(`rotate(${rot}deg)`)
            if (scale !== undefined) transforms.push(`scale(${scale})`)

            if (shaderSurface) {
              shaderSurface.style.transformOrigin = 'center center'
              shaderSurface.style.transform = transforms.join(' ')
            }
            if (scale !== undefined) node.style.setProperty('--shader-scale', String(scale))
            if (rot !== undefined) node.style.setProperty('--shader-rotation', `${rot}deg`)
            if (offX !== undefined) node.style.setProperty('--shader-offset-x', `${offX * 100}%`)
            if (offY !== undefined) node.style.setProperty('--shader-offset-y', `${offY * 100}%`)
          }
        }
      }

      // Update variable font axes and kinetic typography properties directly on canvas elements
      const typoTracks = motion.tracks.filter(t => t.enabled && isTypographyProperty(t.property))
      if (applyPreview && stage.current) {
        const typoElementIds = new Set([
          ...typoTracks.map(t => t.elementId),
          ...Object.keys(elements).filter(id => {
            const e = elements[id]
            return e?.type === 'text' && (e as TextElement).kinetic?.enabled
          }),
        ])
        for (const id of typoElementIds) {
          const elem = elements[id]
          if (elem?.type !== 'text') continue
          const node = stage.current.querySelector<HTMLElement>(
            `.viewport-world .scene-node[data-element-id="${CSS.escape(id)}"]`
          )
          if (!node) continue

          const textContainer =
            node.querySelector<HTMLElement>('.scene-text') ??
            node.querySelector<HTMLElement>('.scene-text-on-path')
          const textPathElement = node.querySelector<SVGTextPathElement>('textPath')

          let record = modifiedElements.current.find(m => m.node === node)
          if (!record) {
            record = {
              node,
              shaderSurface: null,
              originalTransform: '',
              originalOpacity: '',
              originalTransformOrigin: '',
              textContainer,
              originalFontVariationSettings: textContainer?.style.fontVariationSettings ?? '',
              originalFontWeight: textContainer?.style.fontWeight ?? '',
              originalFontStretch: textContainer?.style.fontStretch ?? '',
              originalLetterSpacing: textContainer?.style.letterSpacing ?? '',
              originalFontSize: textContainer?.style.fontSize ?? '',
              originalLineHeight: textContainer?.style.lineHeight ?? '',
              textPathElement,
              originalStartOffset: textPathElement?.getAttribute('startOffset') ?? '',
            }
            modifiedElements.current.push(record)
          }

          const elemTracks = typoTracks.filter(t => t.elementId === id)
          const values: Partial<Record<MotionProperty, number>> = {}
          for (const t of elemTracks) {
            values[t.property] = trackValue(t, time.current)
          }

          const currentAxes = elem.variableAxes ?? {}
          const wght = values.fontWeight ?? currentAxes.wght ?? elem.fontWeight
          const wdth = values.fontWidth ?? currentAxes.wdth
          const slnt = values.fontSlant ?? currentAxes.slnt
          const opsz = values.fontOpticalSize ?? currentAxes.opsz

          const variationParts: string[] = []
          if (wght !== undefined && Number.isFinite(wght)) variationParts.push(`'wght' ${Number(wght.toFixed(2))}`)
          if (wdth !== undefined && Number.isFinite(wdth)) variationParts.push(`'wdth' ${Number(wdth.toFixed(2))}`)
          if (slnt !== undefined && Number.isFinite(slnt)) variationParts.push(`'slnt' ${Number(slnt.toFixed(2))}`)
          if (opsz !== undefined && Number.isFinite(opsz)) variationParts.push(`'opsz' ${Number(opsz.toFixed(1))}`)

          if (textContainer) {
            if (variationParts.length > 0) {
              textContainer.style.fontVariationSettings = variationParts.join(', ')
            }
            if (values.fontWeight !== undefined) {
              textContainer.style.fontWeight = String(Math.round(values.fontWeight))
            }
            if (values.fontWidth !== undefined) {
              textContainer.style.fontStretch = `${values.fontWidth}%`
            }
            if (values.fontSize !== undefined) {
              textContainer.style.fontSize = `${values.fontSize}px`
            }
            if (values.letterSpacing !== undefined) {
              textContainer.style.letterSpacing = `${values.letterSpacing}px`
            }
            if (values.lineHeight !== undefined) {
              textContainer.style.lineHeight = String(values.lineHeight)
            }
          }

          if (textPathElement && values.textPathOffset !== undefined) {
            textPathElement.setAttribute('startOffset', `${values.textPathOffset}%`)
          }

          const k = elem.kinetic
          const hasKineticTracks = elemTracks.some(t => t.property.startsWith('kinetic'))
          const isKinetic = !!(k?.enabled || hasKineticTracks)

          if (isKinetic) {
            const durationMs = Math.max(100, (k?.duration ?? 2.4) * 1000)
            const effectivePhase = values.kineticPhase !== undefined
              ? values.kineticPhase
              : k?.playing
                ? (((k?.phase ?? 0) + time.current / durationMs) % 1 + 1) % 1
                : (k?.phase ?? 0)

            const amplitude = values.kineticAmplitude ?? k?.amplitude ?? 18
            const rotation = values.kineticRotation ?? k?.rotation ?? 8
            const stagger = values.kineticStagger ?? k?.stagger ?? 70
            const weightMod = values.kineticWeightModulation ?? k?.weightModulation ?? 0
            const slantMod = values.kineticSlantModulation ?? k?.slantModulation ?? 0
            const scaleMod = values.kineticScaleModulation ?? k?.scaleModulation ?? 0
            const horizAmp = k?.horizontalAmplitude ?? 0
            const widthMod = k?.widthModulation ?? 0
            const opticalMod = k?.opticalSizeModulation ?? 0
            const staggerMode = k?.staggerMode ?? 'cascade'
            const waveShape = k?.waveShape ?? 'triangle'

            const charElements = Array.from(node.querySelectorAll<HTMLElement>('.kinetic-glyph-char'))
            const svgGlyphElements = Array.from(node.querySelectorAll<SVGElement>('.kinetic-glyph'))

            if (!record.glyphRecords) {
              record.glyphRecords = [
                ...charElements.map(el => ({
                  element: el,
                  originalTransform: el.style.transform,
                  originalFontVariationSettings: el.style.fontVariationSettings,
                  originalAnimation: el.style.animation,
                })),
                ...svgGlyphElements.map(el => ({
                  element: el,
                  originalTransform: el.style.transform,
                  originalAnimation: el.style.animation,
                })),
              ]
            }

            if (charElements.length > 0) {
              charElements.forEach((charEl, idx) => {
                const delay = calculateStaggerDelay(staggerMode, idx, charElements.length, stagger)
                const cycle = ((effectivePhase + delay / durationMs) % 1 + 1) % 1
                const wave = evaluateWaveform(cycle, waveShape)

                const dx = wave * horizAmp
                const dy = wave * amplitude
                const rot = wave * rotation
                const scale = scaleMod ? Math.max(0.05, 1 + wave * scaleMod) : 1

                charEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)${scale !== 1 ? ` scale(${scale})` : ''}`
                charEl.style.animation = 'none'

                if (weightMod !== 0 || slantMod !== 0 || widthMod !== 0 || opticalMod !== 0) {
                  const glyphWght = Math.max(1, Math.min(1000, (wght ?? 400) + wave * weightMod))
                  const glyphWdth = Math.max(25, Math.min(200, (wdth ?? 100) + wave * widthMod))
                  const glyphSlnt = Math.max(-90, Math.min(90, (slnt ?? 0) + wave * slantMod))
                  const glyphOpsz = Math.max(6, Math.min(144, (opsz ?? elem.fontSize) + wave * opticalMod))
                  charEl.style.fontVariationSettings = `'wght' ${glyphWght.toFixed(1)}, 'wdth' ${glyphWdth.toFixed(1)}, 'slnt' ${glyphSlnt.toFixed(1)}, 'opsz' ${glyphOpsz.toFixed(1)}`
                } else if (variationParts.length > 0) {
                  charEl.style.fontVariationSettings = variationParts.join(', ')
                }
              })
            }

            if (svgGlyphElements.length > 0) {
              svgGlyphElements.forEach((svgEl, idx) => {
                const delay = calculateStaggerDelay(staggerMode, idx, svgGlyphElements.length, stagger)
                const cycle = ((effectivePhase + delay / durationMs) % 1 + 1) % 1
                const wave = evaluateWaveform(cycle, waveShape)

                const dx = wave * horizAmp
                const dy = wave * amplitude
                const rot = wave * rotation
                const scale = scaleMod ? Math.max(0.05, 1 + wave * scaleMod) : 1

                svgEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)${scale !== 1 ? ` scale(${scale})` : ''}`
                svgEl.style.animation = 'none'
              })
            }

            node.style.setProperty('--kinetic-phase', String(effectivePhase))
            node.style.setProperty('--cascade-amplitude', `${amplitude}px`)
            node.style.setProperty('--cascade-rotation', `${rotation}deg`)
            node.style.setProperty('--kinetic-stagger', `${stagger}ms`)
            if (weightMod !== 0) node.style.setProperty('--kinetic-weight-mod', String(weightMod))
            if (slantMod !== 0) node.style.setProperty('--kinetic-slant-mod', `${slantMod}deg`)
            if (scaleMod !== 0) node.style.setProperty('--kinetic-scale-mod', String(scaleMod))
          }
        }
      }

      // Update vector path shapes and stroke properties directly on canvas elements
      const pathTracks = motion.tracks.filter(t => t.enabled && isPathProperty(t.property))
      if (applyPreview && pathTracks.length > 0 && stage.current) {
        const pathElementIds = new Set(pathTracks.map(t => t.elementId))
        for (const id of pathElementIds) {
          const elem = elements[id]
          if (!elem) continue
          const node = stage.current.querySelector<HTMLElement>(
            `.viewport-world .scene-node[data-element-id="${CSS.escape(id)}"]`
          )
          if (!node) continue

          const pathElement = node.querySelector<SVGPathElement>('svg.scene-vector path')
          if (!pathElement) continue

          let record = modifiedElements.current.find(m => m.node === node)
          if (!record) {
            record = {
              node,
              shaderSurface: null,
              originalTransform: '',
              originalOpacity: '',
              originalTransformOrigin: '',
              pathElement,
              originalPathD: pathElement.getAttribute('d') ?? (elem.type === 'path' ? elem.d : ''),
              originalStrokeDasharray: pathElement.style.strokeDasharray || pathElement.getAttribute('stroke-dasharray') || '',
              originalStrokeDashoffset: pathElement.style.strokeDashoffset || pathElement.getAttribute('stroke-dashoffset') || '',
              originalStrokeWidth: pathElement.style.strokeWidth || pathElement.getAttribute('stroke-width') || '',
            }
            modifiedElements.current.push(record)
          }

          const elemTracks = pathTracks.filter(t => t.elementId === id)

          // Handle pathShape track (morphing between keyframe pathData)
          const shapeTrack = elemTracks.find(t => t.property === 'pathShape')
          if (shapeTrack && shapeTrack.keyframes.length >= 2) {
            const keys = shapeTrack.keyframes
            let targetD = ''
            if (time.current <= keys[0].time) {
              targetD = keys[0].pathData ?? (elem.type === 'path' ? elem.d : '')
            } else {
              const nextIdx = keys.findIndex(k => k.time > time.current)
              if (nextIdx < 0) {
                targetD = keys.at(-1)?.pathData ?? (elem.type === 'path' ? elem.d : '')
              } else {
                const kA = keys[nextIdx - 1]
                const kB = keys[nextIdx]
                const segProgress = (time.current - kA.time) / (kB.time - kA.time)
                const easedProgress = easingProgress(segProgress, kA.easing)
                const dA = kA.pathData || (elem.type === 'path' ? elem.d : '')
                const dB = kB.pathData || SHAPE_PRESETS.star5.d
                targetD = interpolatePathShapes(dA, dB, easedProgress)
              }
            }
            if (targetD) {
              pathElement.setAttribute('d', targetD)
            }
          }

          // Handle pathMorphProgress (0..100% morph against target shape)
          const morphTrack = elemTracks.find(t => t.property === 'pathMorphProgress')
          if (morphTrack && elem.type === 'path') {
            const morphProgress = trackValue(morphTrack, time.current) / 100
            const baseD = record.originalPathD || elem.d
            const targetPresetD = SHAPE_PRESETS.star5.d
            const morphedD = interpolatePathShapes(baseD, targetPresetD, morphProgress)
            if (morphedD) {
              pathElement.setAttribute('d', morphedD)
            }
          }

          // Handle trim paths (pathTrimStart, pathTrimEnd, pathTrimOffset)
          const trimStartTrack = elemTracks.find(t => t.property === 'pathTrimStart')
          const trimEndTrack = elemTracks.find(t => t.property === 'pathTrimEnd')
          const trimOffsetTrack = elemTracks.find(t => t.property === 'pathTrimOffset')
          if (trimStartTrack || trimEndTrack || trimOffsetTrack) {
            const trimStart = trimStartTrack ? trackValue(trimStartTrack, time.current) : 0
            const trimEnd = trimEndTrack ? trackValue(trimEndTrack, time.current) : 100
            const trimOffset = trimOffsetTrack ? trackValue(trimOffsetTrack, time.current) : 0
            let totalLength = 500
            try {
              totalLength = pathElement.getTotalLength() || 500
            } catch {
              totalLength = 500
            }
            const { strokeDasharray, strokeDashoffset } = computeStrokeTrimDash(totalLength, trimStart, trimEnd, trimOffset)
            pathElement.style.strokeDasharray = strokeDasharray
            pathElement.style.strokeDashoffset = strokeDashoffset
          }

          // Handle stroke width
          const strokeWidthTrack = elemTracks.find(t => t.property === 'pathStrokeWidth')
          if (strokeWidthTrack) {
            const sw = trackValue(strokeWidthTrack, time.current)
            pathElement.setAttribute('stroke-width', String(sw))
            pathElement.style.strokeWidth = `${sw}px`
          }

          // Handle dash offset
          const dashOffsetTrack = elemTracks.find(t => t.property === 'pathDashOffset')
          if (dashOffsetTrack && !trimStartTrack && !trimEndTrack) {
            const dOff = trackValue(dashOffsetTrack, time.current)
            pathElement.style.strokeDashoffset = `${dOff}px`
          }
        }
      }

      root.current?.style.setProperty('--motion-progress', `${(time.current / duration) * 100}%`)
      if (readout.current) readout.current.value = `${(time.current / 1000).toFixed(2)} s`
      if (scrubber.current) scrubber.current.value = String(time.current)
    },
    [duration, motion.tracks, stage, preview, elements]
  )

  // Construct Web Animations when preview starts or tracks change
  useEffect(() => {
    if (!preview) {
      cleanOverrides()
      return
    }

    const tracks = motion.tracks.filter(track => track.enabled)
    const nodes = new Map(
      Array.from(
        stage.current?.querySelectorAll<HTMLElement>('.viewport-world .scene-node[data-element-id]') ?? []
      ).map(node => [node.dataset.elementId!, node])
    )

    const created: Animation[] = []
    const transformProperties = new Set<MotionProperty>([
      'x',
      'y',
      'rotation',
      'scale',
      'scaleX',
      'scaleY',
      'skewX',
      'skewY',
      'opacity',
      'cornerRadius',
    ])

    for (const id of new Set(tracks.map(track => track.elementId))) {
      const node = nodes.get(id)
      if (!node || !elements[id]) continue

      const group = tracks.filter(track => track.elementId === id && transformProperties.has(track.property))
      if (!group.length) continue

      const times = sampleTimes(motion, group)
      const frames = times.map(t => {
        const values = Object.fromEntries(group.map(track => [track.property, trackValue(track, t)]))
        const transformParts: string[] = []
        if ('x' in values || 'y' in values) {
          transformParts.push(`translate(${values.x ?? 0}px, ${values.y ?? 0}px)`)
        }
        if ('rotation' in values) {
          transformParts.push(`rotate(${values.rotation}deg)`)
        }
        if ('scale' in values) {
          transformParts.push(`scale(${values.scale})`)
        }
        if ('scaleX' in values || 'scaleY' in values) {
          transformParts.push(`scale(${values.scaleX ?? 1}, ${values.scaleY ?? 1})`)
        }
        if ('skewX' in values || 'skewY' in values) {
          transformParts.push(`skew(${values.skewX ?? 0}deg, ${values.skewY ?? 0}deg)`)
        }

        const frame: Record<string, string | number> = {
          offset: t / duration,
        }
        if (transformParts.length > 0) {
          frame.transform = transformParts.join(' ')
        }
        if ('cornerRadius' in values) {
          frame.borderRadius = `${values.cornerRadius}px`
        }
        return frame
      })

      if (group.some(track => track.property !== 'opacity')) {
        created.push(node.animate(frames, { duration, fill: 'both', easing: 'linear' }))
      }

      const opacity = group.find(track => track.property === 'opacity')
      const content = node.querySelector<HTMLElement>(':scope > .scene-content')
      if (opacity && content) {
        created.push(
          content.animate(
            times.map(t => ({ offset: t / duration, opacity: trackValue(opacity, t) })),
            { duration, fill: 'both', easing: 'linear' }
          )
        )
      }
    }

    animations.current = created
    created.forEach(animation => animation.pause())
    paint(time.current)

    return () => {
      created.forEach(animation => animation.cancel())
      animations.current = []
      cleanOverrides()
    }
  }, [motion, elements, stage, preview, duration, paint, cleanOverrides])

  // Playback animation frame loop
  useEffect(() => {
    paint(time.current)
    if (!playing) return

    let frame = 0
    let previous: number | undefined

    const tick = (now: number) => {
      const delta = (previous === undefined ? 0 : now - previous) * playbackRateRef.current
      const next = time.current + delta
      previous = now

      if (next >= duration) {
        if (!looping.current) {
          paint(duration)
          setPlaying(false)
          return
        }
        paint(next % duration, true, false)
      } else {
        paint(next, true, false)
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    const visibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', visibility)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [playing, duration, paint])

  const seek = useCallback(
    (value: number) => {
      setPlaying(false)
      setPreview(true)
      paint(value)
    },
    [paint]
  )

  const toggle = useCallback(() => {
    setPreview(true)
    if (time.current >= duration) paint(0)
    setPlaying(value => !value)
  }, [duration, paint])

  const play = useCallback(() => {
    setPreview(true)
    if (time.current >= duration) paint(0)
    setPlaying(true)
  }, [duration, paint])

  const pause = useCallback(() => {
    setPlaying(false)
    paint(time.current)
  }, [paint])

  const restore = useCallback(() => {
    setPlaying(false)
    setPreview(false)
    cleanOverrides()
    paint(0, false)
  }, [paint, cleanOverrides])

  const stepFrame = useCallback(
    (deltaFrames: number, fps = 60) => {
      const frameDuration = 1000 / fps
      const target = Math.max(0, Math.min(duration, time.current + deltaFrames * frameDuration))
      seek(target)
    },
    [duration, seek]
  )

  const jumpKeyframe = useCallback(
    (direction: 'prev' | 'next') => {
      const { prev, next } = findAdjacentKeyframeTimes(motion, time.current)
      const target = direction === 'prev' ? prev : next
      if (target !== null) {
        seek(target)
      }
    },
    [motion, seek]
  )

  const setLooping = useCallback((loop: boolean) => {
    looping.current = loop
  }, [])

  return {
    playing,
    preview,
    time,
    currentTimeMs,
    playbackRate,
    setPlaybackRate,
    root,
    readout,
    scrubber,
    looping,
    setLooping,
    seek,
    toggle,
    play,
    pause,
    restore,
    stepFrame,
    jumpKeyframe,
  }
}
