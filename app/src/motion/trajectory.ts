import type { SceneElement } from '../scene/types.ts'
import { computeSpringMetrics, trackValue } from './model.ts'
import type { MotionDocument, MotionEasing } from './types.ts'

export interface TrajectoryKeyframeNode {
  readonly id: string
  readonly trackIdX?: string
  readonly trackIdY?: string
  readonly keyIdX?: string
  readonly keyIdY?: string
  readonly time: number
  readonly worldX: number
  readonly worldY: number
  readonly offsetX: number
  readonly offsetY: number
  readonly easing: MotionEasing
  readonly isOvershootPeak?: boolean
}

export interface TrajectoryPathData {
  readonly elementId: string
  readonly hasPositionTracks: boolean
  readonly svgPath: string
  readonly samples: readonly { time: number; worldX: number; worldY: number }[]
  readonly keyframeNodes: readonly TrajectoryKeyframeNode[]
  readonly currentPosition: { worldX: number; worldY: number; offsetX: number; offsetY: number }
  readonly overshootPeak?: { worldX: number; worldY: number; time: number; percent: number }
}

export function snapToGrid(value: number, step = 120): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function computeElementTrajectory(
  element: SceneElement,
  motion: MotionDocument,
  currentTimeMs: number,
  samplesCount = 80
): TrajectoryPathData | null {
  const tracks = motion.tracks.filter(t => t.elementId === element.id && t.enabled)
  const trackX = tracks.find(t => t.property === 'x')
  const trackY = tracks.find(t => t.property === 'y')

  if (!trackX && !trackY) return null

  const baseOriginX = element.x
  const baseOriginY = element.y
  const duration = Math.max(100, motion.duration)

  // Collect keyframe timestamps from both tracks
  const keyTimesSet = new Set<number>()
  if (trackX) trackX.keyframes.forEach(k => keyTimesSet.add(k.time))
  if (trackY) trackY.keyframes.forEach(k => keyTimesSet.add(k.time))
  const keyTimes = Array.from(keyTimesSet).sort((a, b) => a - b)

  // Generate uniform sample times plus exact keyframe times
  const step = duration / Math.max(10, samplesCount)
  const allTimesSet = new Set<number>([0, duration, ...keyTimes])
  for (let t = 0; t <= duration; t += step) {
    allTimesSet.add(Math.round(t))
  }
  const sampleTimes = Array.from(allTimesSet).sort((a, b) => a - b)

  const samples = sampleTimes.map(t => {
    const offX = trackX ? trackValue(trackX, t) : 0
    const offY = trackY ? trackValue(trackY, t) : 0
    return {
      time: t,
      worldX: baseOriginX + offX,
      worldY: baseOriginY + offY,
    }
  })

  // Build SVG path data: M x0,y0 L x1,y1 ...
  const svgPath = samples.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.worldX.toFixed(1)} ${pt.worldY.toFixed(1)}`).join(' ')

  // Calculate authored keyframe nodes
  const keyframeNodes: TrajectoryKeyframeNode[] = keyTimes.map(t => {
    const offX = trackX ? trackValue(trackX, t) : 0
    const offY = trackY ? trackValue(trackY, t) : 0
    const kX = trackX?.keyframes.find(k => k.time === t)
    const kY = trackY?.keyframes.find(k => k.time === t)
    const easing = kX?.easing ?? kY?.easing ?? (trackX?.keyframes[0]?.easing ?? trackY?.keyframes[0]?.easing)!

    return {
      id: `${element.id}-${t}`,
      trackIdX: trackX?.id,
      trackIdY: trackY?.id,
      keyIdX: kX?.id,
      keyIdY: kY?.id,
      time: t,
      worldX: baseOriginX + offX,
      worldY: baseOriginY + offY,
      offsetX: offX,
      offsetY: offY,
      easing,
    }
  })

  // Current playhead position
  const currentOffX = trackX ? trackValue(trackX, currentTimeMs) : 0
  const currentOffY = trackY ? trackValue(trackY, currentTimeMs) : 0
  const currentPosition = {
    worldX: baseOriginX + currentOffX,
    worldY: baseOriginY + currentOffY,
    offsetX: currentOffX,
    offsetY: currentOffY,
  }

  // Detect peak overshoot point if any segment is a spring with overshoot
  let overshootPeak: TrajectoryPathData['overshootPeak'] | undefined
  const springKeys = [
    ...(trackX?.keyframes ?? []),
    ...(trackY?.keyframes ?? []),
  ].filter(k => k.easing.kind === 'spring')

  if (springKeys.length > 0) {
    let maxDistFromEndpoints = 0
    let peakSample: (typeof samples)[number] | undefined
    let peakPercent = 0

    for (const key of springKeys) {
      if (key.easing.kind === 'spring') {
        const metrics = computeSpringMetrics(key.easing.spring)
        if (metrics.peakOvershootPercent > 0 && metrics.peakOvershootPercent > peakPercent) {
          peakPercent = metrics.peakOvershootPercent
        }
      }
    }

    if (peakPercent > 0 && samples.length >= 3) {
      const p0 = samples[0]
      const pEnd = samples[samples.length - 1]
      const lineLen = Math.hypot(pEnd.worldX - p0.worldX, pEnd.worldY - p0.worldY)
      if (lineLen > 2) {
        for (const s of samples) {
          const dist = Math.hypot(s.worldX - p0.worldX, s.worldY - p0.worldY)
          if (dist > lineLen && dist > maxDistFromEndpoints) {
            maxDistFromEndpoints = dist
            peakSample = s
          }
        }
      }
      if (peakSample) {
        overshootPeak = {
          worldX: peakSample.worldX,
          worldY: peakSample.worldY,
          time: peakSample.time,
          percent: peakPercent,
        }
      }
    }
  }

  return {
    elementId: element.id,
    hasPositionTracks: true,
    svgPath,
    samples,
    keyframeNodes,
    currentPosition,
    overshootPeak,
  }
}
