import type { MotionDocument } from '../types.ts'
import type { SceneSnapshot } from '../../scene/types.ts'

export type VideoExportFormat = 'mp4' | 'webm' | 'gif'
export type ResolutionScale = 1 | 2 | 4
export type FrameRate = 24 | 30 | 60
export type ExportQuality = 'low' | 'medium' | 'high'

export interface VideoExportOptions {
  readonly format: VideoExportFormat
  readonly scale: ResolutionScale
  readonly fps: FrameRate
  readonly transparent: boolean
  readonly quality: ExportQuality
  readonly scope: 'selection' | 'artboards' | 'canvas'
  readonly durationMs?: number
  readonly loop?: boolean
  readonly backgroundColor?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: VideoExportProgress) => void
}

export type ExportPhase = 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'complete'

export interface VideoExportProgress {
  readonly phase: ExportPhase
  readonly currentFrame: number
  readonly totalFrames: number
  readonly percent: number
  readonly elapsedMs: number
  readonly estimatedRemainingMs: number
  readonly statusMessage: string
}

export interface VideoExportResult {
  readonly blob: Blob
  readonly url: string
  readonly fileName: string
  readonly format: VideoExportFormat
  readonly width: number
  readonly height: number
  readonly fps: FrameRate
  readonly scale: ResolutionScale
  readonly durationMs: number
  readonly fileSizeBytes: number
  readonly frameCount: number
}

export interface HardwareSupportInfo {
  readonly webCodecs: boolean
  readonly h264Hardware: boolean
  readonly vp9Hardware: boolean
  readonly vp9Alpha: boolean
  readonly mediaRecorder: boolean
  readonly mediaRecorderMp4: boolean
  readonly mediaRecorderWebm: boolean
}

export interface RenderFrameContext {
  readonly timeMs: number
  readonly frameIndex: number
  readonly totalFrames: number
  readonly snapshot: SceneSnapshot
  readonly motion: MotionDocument
  readonly width: number
  readonly height: number
  readonly scale: ResolutionScale
  readonly transparent: boolean
  readonly backgroundColor: string
}
