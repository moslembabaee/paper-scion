import type { Bounds } from '../../canvas/types.ts'
import type { SceneElement, SceneSnapshot, TextElement } from '../../scene/types.ts'
import { exportBounds, sceneToSVG, type ExportAssets, type ExportOptions } from '../../io/svg.ts'
import { isShaderProperty, isTypographyProperty, trackValue } from '../model.ts'
import type { MotionDocument } from '../types.ts'
import type { ResolutionScale, VideoExportOptions } from './types.ts'

export interface RenderDimensions {
  readonly width: number
  readonly height: number
  readonly bounds: Bounds
  readonly scale: ResolutionScale
}

export function calculateVideoDimensions(
  bounds: Bounds,
  scale: ResolutionScale
): RenderDimensions {
  const rawWidth = Math.ceil(bounds.width * scale)
  const rawHeight = Math.ceil(bounds.height * scale)
  // Standard video encoders (H.264, VP9) require even pixel dimensions
  const width = rawWidth % 2 === 0 ? rawWidth : rawWidth + 1
  const height = rawHeight % 2 === 0 ? rawHeight : rawHeight + 1

  return {
    width: Math.max(2, width),
    height: Math.max(2, height),
    bounds,
    scale,
  }
}

/** Pure snapshot interpolation at exact millisecond timestamp. */
export function interpolateSnapshot(
  baseSnapshot: SceneSnapshot,
  motion: MotionDocument,
  timeMs: number
): SceneSnapshot {
  const tracks = motion.tracks.filter(t => t.enabled && baseSnapshot.elements[t.elementId])
  if (tracks.length === 0) {
    return baseSnapshot
  }

  const elements: Record<string, SceneElement> = { ...baseSnapshot.elements }
  const tracksByElement = new Map<string, typeof tracks>()

  for (const track of tracks) {
    const list = tracksByElement.get(track.elementId) ?? []
    list.push(track)
    tracksByElement.set(track.elementId, list)
  }

  for (const [elementId, elemTracks] of tracksByElement.entries()) {
    const baseElem = baseSnapshot.elements[elementId]
    if (!baseElem) continue

    let updated: SceneElement = { ...baseElem }
    let posX = baseElem.x
    let posY = baseElem.y
    let posRot = baseElem.rotation
    let scaleMultiplier = 1
    let opacity = baseElem.style.opacity ?? 1

    let shader = baseElem.style.shader ? { ...baseElem.style.shader } : null
    let shaderSpeed = shader?.speed ?? 1

    let textElem = updated.type === 'text' ? ({ ...updated } as TextElement) : null

    for (const track of elemTracks) {
      const val = trackValue(track, timeMs)

      if (track.property === 'x') {
        posX = baseElem.x + val
      } else if (track.property === 'y') {
        posY = baseElem.y + val
      } else if (track.property === 'rotation') {
        posRot = baseElem.rotation + val
      } else if (track.property === 'scale') {
        scaleMultiplier = Math.max(0.001, val)
      } else if (track.property === 'opacity') {
        opacity = Math.max(0, Math.min(1, val))
      } else if (isShaderProperty(track.property) && shader) {
        if (track.property === 'shaderSpeed') {
          shaderSpeed = val
          shader.speed = val
        } else if (track.property === 'shaderScale') {
          shader.scale = val
        } else if (track.property === 'shaderRotation') {
          shader.rotation = val
        } else if (track.property === 'shaderOffsetX') {
          shader.offsetX = val
        } else if (track.property === 'shaderOffsetY') {
          shader.offsetY = val
        } else if (track.property === 'shaderOpacity') {
          shader.composite = {
            ...(shader.composite ?? { blendMode: 'normal', opacity: 1 }),
            opacity: Math.max(0, Math.min(1, val)),
          }
        }
      } else if (isTypographyProperty(track.property) && textElem) {
        const textMut = textElem as any
        const axes = { ...(textElem.variableAxes ?? {}) }
        if (track.property === 'fontWeight') {
          textMut.fontWeight = Math.round(val)
          axes.wght = val
        } else if (track.property === 'fontWidth') {
          axes.wdth = val
        } else if (track.property === 'fontSlant') {
          axes.slnt = val
        } else if (track.property === 'fontOpticalSize') {
          axes.opsz = val
        } else if (track.property === 'fontSize') {
          textMut.fontSize = Math.max(1, val)
        } else if (track.property === 'letterSpacing') {
          textMut.letterSpacing = val
        } else if (track.property === 'lineHeight') {
          textMut.lineHeight = Math.max(0.1, val)
        } else if (track.property === 'textPathOffset' && textElem.textOnPath) {
          textMut.textOnPath = { ...textElem.textOnPath, offset: val }
        } else if (track.property === 'kineticPhase') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', amplitude: 18, wavelength: 320, stagger: 70, rotation: 8 }), phase: val }
        } else if (track.property === 'kineticAmplitude') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, stagger: 70, rotation: 8 }), amplitude: val }
        } else if (track.property === 'kineticRotation') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, stagger: 70, amplitude: 18 }), rotation: val }
        } else if (track.property === 'kineticStagger') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, rotation: 8, amplitude: 18 }), stagger: val }
        } else if (track.property === 'kineticWeightModulation') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, rotation: 8, amplitude: 18 }), weightModulation: val }
        } else if (track.property === 'kineticSlantModulation') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, rotation: 8, amplitude: 18 }), slantModulation: val }
        } else if (track.property === 'kineticScaleModulation') {
          textMut.kinetic = { ...(textElem.kinetic ?? { enabled: true, style: 'wave', phase: 0, wavelength: 320, rotation: 8, amplitude: 18 }), scaleModulation: val }
        }
        textMut.variableAxes = axes
      }
    }

    // Apply scale around element center
    if (scaleMultiplier !== 1) {
      const baseW = baseElem.width
      const baseH = baseElem.height
      const newW = baseW * scaleMultiplier
      const newH = baseH * scaleMultiplier
      posX += (baseW - newW) / 2
      posY += (baseH - newH) / 2
      updated = {
        ...updated,
        width: newW,
        height: newH,
      }
    }

    if (shader) {
      // Deterministically advance shader frame uniform across timeline
      const baseFrame = shader.frame ?? 0
      shader.frame = baseFrame + (timeMs * shaderSpeed)
    }

    updated = {
      ...(textElem ?? updated),
      x: posX,
      y: posY,
      rotation: posRot,
      style: {
        ...updated.style,
        opacity,
        ...(shader ? { shader } : {}),
      },
    }

    elements[elementId] = updated
  }

  // Advance background shader if present
  let backgroundShader = baseSnapshot.backgroundShader
  if (backgroundShader) {
    const bgSpeed = backgroundShader.speed ?? 1
    const baseFrame = backgroundShader.frame ?? 0
    backgroundShader = {
      ...backgroundShader,
      frame: baseFrame + (timeMs * bgSpeed),
    }
  }

  return {
    ...baseSnapshot,
    elements,
    backgroundShader,
  }
}

/** Prepares persistent assets (fonts, images, base shaders) once before frame loop. */
export async function prepareRenderAssets(
  snapshot: SceneSnapshot,
  _options: VideoExportOptions,
  signal?: AbortSignal
): Promise<ExportAssets> {
  const images = new Map<string, string>()
  const shaders = new Map<string, string>()

  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready
  }
  signal?.throwIfAborted()

  // Pre-load images if any
  for (const elem of Object.values(snapshot.elements)) {
    if (elem.type === 'image' && elem.src) {
      try {
        const { embedImage } = await import('../../io/export.ts')
        const dataUrl = await embedImage(elem.src, signal)
        images.set(elem.id, dataUrl)
      } catch {
        // Fallback or skip failed images gracefully
      }
    }
  }

  // Pre-capture background shader if present
  if (snapshot.backgroundShader) {
    try {
      const { captureShader } = await import('../../io/captureShader.tsx')
      const bounds = exportBounds(snapshot, _options.scope === 'artboards' ? 'canvas' : _options.scope)
      if (bounds) {
        const dataUrl = await captureShader(
          snapshot.backgroundShader,
          bounds.width,
          bounds.height,
          _options.scale,
          signal
        )
        shaders.set('paper:background', dataUrl)
      }
    } catch {
      // Graceful fallback if WebGL shader capture is unavailable in current context
    }
  }

  return { images, shaders }
}

/** Deterministically renders one frame to a given CanvasRenderingContext2D. */
export async function renderFrameToCanvas(
  targetCanvas: HTMLCanvasElement,
  frameSnapshot: SceneSnapshot,
  assets: ExportAssets,
  dimensions: RenderDimensions,
  options: VideoExportOptions,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()

  const ctx = targetCanvas.getContext('2d', {
    alpha: options.transparent,
    willReadFrequently: options.format === 'gif',
  })
  if (!ctx) throw new Error('Could not acquire 2D rendering context for export.')

  const { width, height } = dimensions

  if (options.transparent) {
    ctx.clearRect(0, 0, width, height)
  } else {
    ctx.fillStyle = options.backgroundColor || '#edebe1'
    ctx.fillRect(0, 0, width, height)
  }

  const exportOpts: ExportOptions = {
    scope: options.scope === 'artboards' ? 'canvas' : options.scope,
    scale: 1,
    background: options.transparent ? 'transparent' : 'cream',
  }

  let scopeToUse = exportOpts.scope
  if (scopeToUse === 'selection' && (!frameSnapshot.selection || frameSnapshot.selection.length === 0)) {
    scopeToUse = 'canvas'
  }

  const svgString = sceneToSVG(
    frameSnapshot,
    { ...exportOpts, scope: scopeToUse },
    assets,
    { width, height }
  )
  signal?.throwIfAborted()

  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL === 'undefined') {
    return
  }

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const img = new Image()
    img.src = url
    if ('decode' in img && typeof img.decode === 'function') {
      await img.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load rendered frame SVG.'))
      })
    }
    signal?.throwIfAborted()
    ctx.drawImage(img, 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}
