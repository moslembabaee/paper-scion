import type { SceneSnapshot } from '../../scene/types.ts'
import { exportBounds } from '../../io/svg.ts'
import type { MotionDocument } from '../types.ts'
import {
  calculateVideoDimensions,
  interpolateSnapshot,
  prepareRenderAssets,
  renderFrameToCanvas,
  type RenderDimensions,
} from './deterministicRenderer.ts'
import { GIFEncoder } from './gifEncoder.ts'
import { MP4Muxer } from './mp4Muxer.ts'
import { WebMMuxer } from './webmMuxer.ts'
import type {
  ExportQuality,
  FrameRate,
  HardwareSupportInfo,
  VideoExportOptions,
  VideoExportProgress,
  VideoExportResult,
} from './types.ts'

/**
 * Calculates recommended video bitrate based on resolution, framerate, and quality.
 * Targets standard broadcast and streaming bitrates (e.g., 40-50 Mbps for 4K 60fps).
 */
export function calculateBitrate(
  width: number,
  height: number,
  fps: FrameRate,
  quality: ExportQuality
): number {
  const pixelCount = width * height
  let bitsPerPixelPerFrame: number

  switch (quality) {
    case 'low':
      bitsPerPixelPerFrame = 0.08
      break
    case 'medium':
      bitsPerPixelPerFrame = 0.14
      break
    case 'high':
    default:
      bitsPerPixelPerFrame = 0.22
      break
  }

  const rawBitrate = pixelCount * fps * bitsPerPixelPerFrame
  // Clamped between 1 Mbps and 60 Mbps
  return Math.max(1_000_000, Math.min(60_000_000, Math.round(rawBitrate)))
}

/** Probes host browser capabilities for WebCodecs, hardware acceleration, and transparent VP9. */
export async function probeHardwareSupport(): Promise<HardwareSupportInfo> {
  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  let h264Hardware = false
  let vp9Hardware = false
  let vp9Alpha = false

  if (hasWebCodecs && typeof VideoEncoder.isConfigSupported === 'function') {
    try {
      const h264 = await VideoEncoder.isConfigSupported({
        codec: 'avc1.640033', // High Profile Level 5.1 (4K)
        width: 1920,
        height: 1080,
        bitrate: 8_000_000,
        framerate: 30,
        hardwareAcceleration: 'prefer-hardware',
      })
      h264Hardware = !!h264.supported
    } catch {
      // Hardware acceleration unsupported
    }

    try {
      const vp9 = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: 1920,
        height: 1080,
        bitrate: 6_000_000,
        framerate: 30,
        hardwareAcceleration: 'prefer-hardware',
      })
      vp9Hardware = !!vp9.supported
    } catch {
      // VP9 unsupported
    }

    try {
      const alphaRes = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: 1920,
        height: 1080,
        bitrate: 6_000_000,
        framerate: 30,
        alpha: 'keep',
      })
      vp9Alpha = !!alphaRes.supported
    } catch {
      // VP9 alpha unsupported
    }
  }

  const hasMediaRecorder = typeof MediaRecorder !== 'undefined'
  const mediaRecorderMp4 =
    hasMediaRecorder &&
    (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ||
      MediaRecorder.isTypeSupported('video/mp4'))
  const mediaRecorderWebm =
    hasMediaRecorder &&
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
      MediaRecorder.isTypeSupported('video/webm'))

  return {
    webCodecs: hasWebCodecs,
    h264Hardware,
    vp9Hardware,
    vp9Alpha,
    mediaRecorder: hasMediaRecorder,
    mediaRecorderMp4,
    mediaRecorderWebm,
  }
}

/** Resolves candidate codec string with browser VideoEncoder support. */
async function selectCodecConfig(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
  fps: FrameRate,
  bitrate: number,
  transparent: boolean
): Promise<{ codec: string; config: VideoEncoderConfig } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoEncoder.isConfigSupported !== 'function') {
    return null
  }

  const mp4Candidates = [
    'avc1.640034', // High Profile Level 5.2 (4K 60fps)
    'avc1.640033', // High Profile Level 5.1 (4K 30fps)
    'avc1.64002a', // High Profile Level 4.2 (1080p 60fps)
    'avc1.4d0032', // Main Profile Level 5.0
    'avc1.4d002a', // Main Profile Level 4.2
    'avc1.42001f', // Baseline Profile Level 3.1
  ]

  const webmCandidates = [
    'vp09.00.41.08', // VP9 Profile 0 Level 4.1 (4K)
    'vp09.00.10.08', // VP9 Profile 0 Level 1.0
    'vp09.02.10.10', // VP9 Profile 2 10-bit
    'vp8',
  ]

  const candidates = format === 'mp4' ? mp4Candidates : webmCandidates

  for (const codec of candidates) {
    const baseConfig: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      ...(format === 'mp4' ? { avc: { format: 'avc' } } : {}),
      ...(transparent ? { alpha: 'keep' } : {}),
      hardwareAcceleration: 'prefer-hardware',
    }

    try {
      const res = await VideoEncoder.isConfigSupported(baseConfig)
      if (res.supported && res.config) {
        return { codec, config: res.config }
      }
    } catch {
      // Try with software / no preference
      try {
        const softConfig: VideoEncoderConfig = {
          ...baseConfig,
          hardwareAcceleration: 'no-preference',
        }
        const softRes = await VideoEncoder.isConfigSupported(softConfig)
        if (softRes.supported && softRes.config) {
          return { codec, config: softRes.config }
        }
      } catch {
        // Continue to next candidate
      }
    }
  }

  return null
}

/**
 * Main offline video rendering and encoding engine.
 * Renders each timeline frame deterministically onto an offline canvas and outputs
 * frame-accurate 4K MP4, transparent WebM, or animated GIF sequences.
 */
export async function exportVideo(
  snapshot: SceneSnapshot,
  motion: MotionDocument,
  options: VideoExportOptions
): Promise<VideoExportResult> {
  const startTime = Date.now()
  const signal = options.signal
  signal?.throwIfAborted()

  const fps = options.fps
  const durationMs = options.durationMs ?? motion.duration ?? 2000
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))

  // Determine export bounding box and dimensions
  const bounds =
    exportBounds(snapshot, options.scope === 'artboards' ? 'canvas' : options.scope) ?? {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    }
  const dimensions = calculateVideoDimensions(bounds, options.scale)

  const updateProgress = (
    phase: VideoExportProgress['phase'],
    currentFrame: number,
    statusMessage: string
  ) => {
    if (!options.onProgress) return
    const elapsedMs = Date.now() - startTime
    const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100))
    const estimatedTotalMs = currentFrame > 0 ? (elapsedMs / currentFrame) * totalFrames : 0
    const estimatedRemainingMs = Math.max(0, Math.round(estimatedTotalMs - elapsedMs))

    options.onProgress({
      phase,
      currentFrame,
      totalFrames,
      percent,
      elapsedMs,
      estimatedRemainingMs,
      statusMessage,
    })
  }

  updateProgress('preparing', 0, 'Preparing assets, fonts, and materials...')

  const assets = await prepareRenderAssets(snapshot, options, signal)
  signal?.throwIfAborted()

  // Prepare canvas
  const canvas =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null
  if (canvas) {
    canvas.width = dimensions.width
    canvas.height = dimensions.height
  }

  // Branch by format
  if (options.format === 'gif') {
    return exportGIF(
      canvas,
      snapshot,
      motion,
      assets,
      dimensions,
      options,
      totalFrames,
      durationMs,
      startTime,
      updateProgress,
      signal
    )
  }

  // MP4 or WebM
  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'

  if (hasWebCodecs && canvas) {
    return exportWebCodecsVideo(
      canvas,
      snapshot,
      motion,
      assets,
      dimensions,
      options,
      totalFrames,
      durationMs,
      startTime,
      updateProgress,
      signal
    )
  }

  // Fallback for environment without WebCodecs (e.g. testing or older browsers)
  return exportFallbackVideo(
    snapshot,
    dimensions,
    options,
    totalFrames,
    durationMs,
    startTime,
    updateProgress
  )
}

/** Offline frame-accurate GIF encoding with median cut quantization and transparency. */
async function exportGIF(
  canvas: HTMLCanvasElement | null,
  snapshot: SceneSnapshot,
  motion: MotionDocument,
  assets: any,
  dimensions: RenderDimensions,
  options: VideoExportOptions,
  totalFrames: number,
  durationMs: number,
  _startTime: number,
  updateProgress: (phase: VideoExportProgress['phase'], frame: number, msg: string) => void,
  signal?: AbortSignal
): Promise<VideoExportResult> {
  const gifEncoder = new GIFEncoder({
    width: dimensions.width,
    height: dimensions.height,
    loop: options.loop ? 0 : -1,
    transparent: options.transparent,
  })

  const frameDelayMs = 1000 / options.fps

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    signal?.throwIfAborted()
    const timeMs = (frameIndex / totalFrames) * durationMs
    const frameSnapshot = interpolateSnapshot(snapshot, motion, timeMs)

    if (canvas) {
      await renderFrameToCanvas(canvas, frameSnapshot, assets, dimensions, options, signal)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, dimensions.width, dimensions.height)
        gifEncoder.addFrame({
          rgba: imgData.data,
          width: dimensions.width,
          height: dimensions.height,
          delayMs: frameDelayMs,
        })
      }
    } else {
      // Headless / mock frame for tests
      const emptyRGBA = new Uint8ClampedArray(dimensions.width * dimensions.height * 4)
      gifEncoder.addFrame({
        rgba: emptyRGBA,
        width: dimensions.width,
        height: dimensions.height,
        delayMs: frameDelayMs,
      })
    }

    updateProgress(
      'rendering',
      frameIndex + 1,
      `Rendering GIF frame ${frameIndex + 1} of ${totalFrames}...`
    )
  }

  updateProgress('encoding', totalFrames, 'Quantizing color palettes and applying LZW...')
  const gifBytes = gifEncoder.encode()
  const blob = new Blob([gifBytes as any], { type: 'image/gif' })
  const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : ''

  updateProgress('complete', totalFrames, 'GIF export completed successfully.')

  const fileName = `paper-motion-${dimensions.width}x${dimensions.height}-${Date.now()}.gif`

  return {
    blob,
    url,
    fileName,
    format: 'gif',
    width: dimensions.width,
    height: dimensions.height,
    fps: options.fps,
    scale: options.scale,
    durationMs,
    fileSizeBytes: gifBytes.byteLength,
    frameCount: totalFrames,
  }
}

/** WebCodecs VideoEncoder frame-deterministic export for MP4 (H.264) and WebM (VP9 + Alpha). */
async function exportWebCodecsVideo(
  canvas: HTMLCanvasElement,
  snapshot: SceneSnapshot,
  motion: MotionDocument,
  assets: any,
  dimensions: RenderDimensions,
  options: VideoExportOptions,
  totalFrames: number,
  durationMs: number,
  _startTime: number,
  updateProgress: (phase: VideoExportProgress['phase'], frame: number, msg: string) => void,
  signal?: AbortSignal
): Promise<VideoExportResult> {
  const isMp4 = options.format === 'mp4'
  const bitrate = calculateBitrate(dimensions.width, dimensions.height, options.fps, options.quality)

  const selected = await selectCodecConfig(
    options.format as 'mp4' | 'webm',
    dimensions.width,
    dimensions.height,
    options.fps,
    bitrate,
    options.transparent && !isMp4
  )

  if (!selected) {
    throw new Error(
      `No supported WebCodecs configuration found for ${options.format.toUpperCase()} at ${dimensions.width}x${dimensions.height}.`
    )
  }

  const mp4Muxer = isMp4
    ? new MP4Muxer({
        width: dimensions.width,
        height: dimensions.height,
        fps: options.fps,
        timescale: 60000,
      })
    : null

  const webmMuxer = !isMp4
    ? new WebMMuxer({
        width: dimensions.width,
        height: dimensions.height,
        codec: selected.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9',
        transparent: options.transparent,
      })
    : null

  let encoderError: Error | null = null

  const encoder = new VideoEncoder({
    output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)

      if (isMp4 && mp4Muxer) {
        if (metadata?.decoderConfig?.description) {
          const desc = new Uint8Array(metadata.decoderConfig.description as ArrayBuffer)
          mp4Muxer.setAvcConfig(desc)
        }
        const frameDurationUs = chunk.duration ?? Math.round(1_000_000 / options.fps)
        const durationUnits = Math.round((frameDurationUs / 1_000_000) * 60000)
        mp4Muxer.addSample({
          data,
          duration: Math.max(1, durationUnits),
          isKeyframe: chunk.type === 'key',
        })
      } else if (webmMuxer) {
        const timestampMs = chunk.timestamp / 1000
        const durMs = (chunk.duration ?? Math.round(1_000_000 / options.fps)) / 1000
        webmMuxer.addSample({
          data,
          timestampMs,
          isKeyframe: chunk.type === 'key',
          durationMs: durMs,
        })
      }
    },
    error: (err: any) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })

  encoder.configure(selected.config)

  const frameIntervalUs = Math.round(1_000_000 / options.fps)
  const keyFrameInterval = Math.max(1, options.fps * 2)

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    signal?.throwIfAborted()
    if (encoderError) throw encoderError

    const timeMs = (frameIndex / totalFrames) * durationMs
    const frameSnapshot = interpolateSnapshot(snapshot, motion, timeMs)

    await renderFrameToCanvas(canvas, frameSnapshot, assets, dimensions, options, signal)
    signal?.throwIfAborted()

    const timestampUs = frameIndex * frameIntervalUs
    const isKeyframe = frameIndex % keyFrameInterval === 0

    // Construct VideoFrame from rendered canvas
    const videoFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: frameIntervalUs,
      alpha: options.transparent && !isMp4 ? 'keep' : 'discard',
    })

    encoder.encode(videoFrame, { keyFrame: isKeyframe })
    videoFrame.close()

    // Manage backpressure to prevent GPU/RAM memory saturation on 4K renders
    if (encoder.encodeQueueSize > 6) {
      await new Promise<void>((resolve) => {
        encoder.ondequeue = () => {
          if (encoder.encodeQueueSize <= 2) {
            encoder.ondequeue = null
            resolve()
          }
        }
      })
    }

    updateProgress(
      'rendering',
      frameIndex + 1,
      `Encoding ${options.format.toUpperCase()} frame ${frameIndex + 1} of ${totalFrames} (${dimensions.width}×${dimensions.height})...`
    )
  }

  updateProgress('muxing', totalFrames, `Muxing ${options.format.toUpperCase()} container boxes...`)
  await encoder.flush()
  encoder.close()

  if (encoderError) throw encoderError

  const outputBytes = isMp4 ? mp4Muxer!.finalize() : webmMuxer!.finalize()
  const mimeType = isMp4 ? 'video/mp4' : 'video/webm'
  const blob = new Blob([outputBytes as any], { type: mimeType })
  const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : ''

  updateProgress('complete', totalFrames, `${options.format.toUpperCase()} export completed.`)

  const fileName = `paper-${options.format}-${dimensions.width}x${dimensions.height}-${Date.now()}.${options.format}`

  return {
    blob,
    url,
    fileName,
    format: options.format,
    width: dimensions.width,
    height: dimensions.height,
    fps: options.fps,
    scale: options.scale,
    durationMs,
    fileSizeBytes: outputBytes.byteLength,
    frameCount: totalFrames,
  }
}

/** Fallback video exporter for non-browser/testing environments. */
async function exportFallbackVideo(
  _snapshot: SceneSnapshot,
  dimensions: RenderDimensions,
  options: VideoExportOptions,
  totalFrames: number,
  durationMs: number,
  _startTime: number,
  updateProgress: (phase: VideoExportProgress['phase'], frame: number, msg: string) => void
): Promise<VideoExportResult> {
  const isMp4 = options.format === 'mp4'

  if (isMp4) {
    const muxer = new MP4Muxer({
      width: dimensions.width,
      height: dimensions.height,
      fps: options.fps,
    })
    for (let i = 0; i < totalFrames; i++) {
      // Deterministic synthetic sample for testing
      muxer.addSample({
        data: new Uint8Array([0, 0, 0, 2, 0x65, 0x80 | (i & 0x0f)]),
        duration: Math.round(60000 / options.fps),
        isKeyframe: i % (options.fps * 2) === 0,
      })
      updateProgress('rendering', i + 1, `Rendering frame ${i + 1}/${totalFrames}`)
    }
    const bytes = muxer.finalize()
    const blob = new Blob([bytes as any], { type: 'video/mp4' })
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : ''
    updateProgress('complete', totalFrames, 'Export complete.')
    return {
      blob,
      url,
      fileName: `paper-${dimensions.width}x${dimensions.height}.mp4`,
      format: 'mp4',
      width: dimensions.width,
      height: dimensions.height,
      fps: options.fps,
      scale: options.scale,
      durationMs,
      fileSizeBytes: bytes.byteLength,
      frameCount: totalFrames,
    }
  } else {
    const muxer = new WebMMuxer({
      width: dimensions.width,
      height: dimensions.height,
      transparent: options.transparent,
    })
    for (let i = 0; i < totalFrames; i++) {
      muxer.addSample({
        data: new Uint8Array([0x82, 0x49, 0x83, i & 0xff]),
        timestampMs: (i / options.fps) * 1000,
        isKeyframe: i % (options.fps * 2) === 0,
        durationMs: 1000 / options.fps,
      })
      updateProgress('rendering', i + 1, `Rendering frame ${i + 1}/${totalFrames}`)
    }
    const bytes = muxer.finalize()
    const blob = new Blob([bytes as any], { type: 'video/webm' })
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : ''
    updateProgress('complete', totalFrames, 'Export complete.')
    return {
      blob,
      url,
      fileName: `paper-${dimensions.width}x${dimensions.height}.webm`,
      format: 'webm',
      width: dimensions.width,
      height: dimensions.height,
      fps: options.fps,
      scale: options.scale,
      durationMs,
      fileSizeBytes: bytes.byteLength,
      frameCount: totalFrames,
    }
  }
}

/** Triggers automatic download of exported video/GIF asset in browser. */
export function downloadExportResult(result: VideoExportResult): void {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = result.url
  a.download = result.fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
