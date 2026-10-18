import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { serializeCubicContours } from './geometry.ts'
import { interpolateMorph, prepareMorph } from './interpolate.ts'
import {
  buildNormalizedShape,
  cycleCubicContour,
  flipCubicContour,
  parseCubicContours,
  parseMorphTarget,
  reverseCubicContour,
  rotateCubicContour,
} from './normalize.ts'
import { DEFAULT_MORPH_CONFIG, MORPH_PRESETS } from './presets.ts'
import type { MorphConfig, MorphPreset, MorphResult, MorphTarget } from './types.ts'

export function useMorphEngine(initialPreset?: MorphPreset) {
  const preset = initialPreset ?? MORPH_PRESETS[0]

  const [targetA, setTargetA] = useState<MorphTarget>(preset.targetA)
  const [targetB, setTargetB] = useState<MorphTarget>(preset.targetB)
  const [config, setConfig] = useState<MorphConfig>({
    ...DEFAULT_MORPH_CONFIG,
    ...(preset.config ?? {}),
  })

  const [rawProgress, setRawProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const speedRef = useRef(playbackSpeed)
  speedRef.current = playbackSpeed
  const configRef = useRef(config)
  configRef.current = config
  const rawProgressRef = useRef(rawProgress)
  rawProgressRef.current = rawProgress

  const pingPongDirection = useRef<1 | -1>(1)
  const lastTimeRef = useRef<number | null>(null)

  const contoursA = useMemo(() => parseMorphTarget(targetA), [targetA.d, targetA.viewBox])
  const contoursB = useMemo(() => parseMorphTarget(targetB), [targetB.d, targetB.viewBox])
  const { pointCount, equalizationStrategy, alignmentStrategy, manualShiftOffset, autoMatchWinding } = config
  const prepared = useMemo(() => prepareMorph(contoursA, contoursB, {
    ...DEFAULT_MORPH_CONFIG, pointCount, equalizationStrategy, alignmentStrategy, manualShiftOffset, autoMatchWinding,
  }), [contoursA, contoursB, pointCount, equalizationStrategy, alignmentStrategy, manualShiftOffset, autoMatchWinding])
  const morphResult: MorphResult = useMemo(() => interpolateMorph(prepared, rawProgress, config), [prepared, rawProgress, config])
  const validTargets = contoursA.length > 0 && contoursB.length > 0

  // Playback requestAnimationFrame loop
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = null
      return
    }

    let animationFrameId: number

    const tick = (now: number) => {
      if (!isPlayingRef.current) return
      if (lastTimeRef.current === null) {
        lastTimeRef.current = now
      }

      const delta = Math.min(64, now - lastTimeRef.current)
      lastTimeRef.current = now

      const duration = Math.max(1, configRef.current.duration) / Math.max(.01, speedRef.current)
      const deltaProgress = delta / duration

      let nextProgress = rawProgressRef.current

      if (configRef.current.playbackMode === 'pingpong') {
        nextProgress += deltaProgress * pingPongDirection.current
        if (nextProgress >= 1) {
          nextProgress = 1
          pingPongDirection.current = -1
        } else if (nextProgress <= 0) {
          nextProgress = 0
          pingPongDirection.current = 1
        }
      } else if (configRef.current.playbackMode === 'loop') {
        nextProgress += deltaProgress
        if (nextProgress >= 1) {
          nextProgress %= 1
        }
      } else {
        // Once
        nextProgress += deltaProgress
        if (nextProgress >= 1) {
          nextProgress = 1
          setIsPlaying(false)
        }
      }

      rawProgressRef.current = nextProgress
      setRawProgress(nextProgress)

      if (isPlayingRef.current) {
        animationFrameId = requestAnimationFrame(tick)
      }
    }

    animationFrameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrameId)
  }, [isPlaying])

  const play = useCallback(() => {
    if (rawProgressRef.current >= 1) {
      rawProgressRef.current = 0
      setRawProgress(0)
    }
    setIsPlaying(true)
  }, [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const togglePlay = useCallback(() => { if (isPlayingRef.current) pause(); else play() }, [pause, play])

  const scrubTo = useCallback((t: number) => {
    setIsPlaying(false)
    const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
    rawProgressRef.current = clamped
    setRawProgress(clamped)
  }, [])

  const stepForward = useCallback((step = 0.05) => {
    scrubTo(rawProgressRef.current + step)
  }, [scrubTo])

  const stepBackward = useCallback((step = 0.05) => {
    scrubTo(rawProgressRef.current - step)
  }, [scrubTo])

  const reset = useCallback(() => {
    pause()
    pingPongDirection.current = 1
    scrubTo(0)
  }, [pause, scrubTo])

  const updateConfig = useCallback((patch: Partial<MorphConfig>) => {
    setConfig(c => ({ ...c, ...patch }))
  }, [])

  const loadPreset = useCallback((preset: MorphPreset) => {
    setTargetA(preset.targetA)
    setTargetB(preset.targetB)
    setConfig({ ...DEFAULT_MORPH_CONFIG, ...preset.config })
    reset()
  }, [reset])

  const swapTargets = useCallback(() => {
    setTargetA(targetB)
    setTargetB(targetA)
    scrubTo(1 - rawProgress)
  }, [targetA, targetB, rawProgress, scrubTo])

  const rotateTarget = useCallback((targetKey: 'A' | 'B', deg: number) => {
    const isA = targetKey === 'A'
    const current = isA ? targetA : targetB
    const contours = parseCubicContours(current.d)
    const rotated = contours.map(c => rotateCubicContour(c, deg, buildNormalizedShape(contours).centroid))
    const nextD = serializeCubicContours(rotated)
    if (isA) setTargetA(t => ({ ...t, d: nextD }))
    else setTargetB(t => ({ ...t, d: nextD }))
  }, [targetA, targetB])

  const flipTarget = useCallback((targetKey: 'A' | 'B', horiz: boolean, vert: boolean) => {
    const isA = targetKey === 'A'
    const current = isA ? targetA : targetB
    const contours = parseCubicContours(current.d)
    const flipped = contours.map(c => flipCubicContour(c, horiz, vert, buildNormalizedShape(contours).centroid))
    const nextD = serializeCubicContours(flipped)
    if (isA) setTargetA(t => ({ ...t, d: nextD }))
    else setTargetB(t => ({ ...t, d: nextD }))
  }, [targetA, targetB])

  const reverseTargetWinding = useCallback((targetKey: 'A' | 'B') => {
    const isA = targetKey === 'A'
    const current = isA ? targetA : targetB
    const contours = parseCubicContours(current.d)
    const reversed = contours.map(c => reverseCubicContour(c))
    const nextD = serializeCubicContours(reversed)
    if (isA) setTargetA(t => ({ ...t, d: nextD }))
    else setTargetB(t => ({ ...t, d: nextD }))
  }, [targetA, targetB])

  const shiftTargetStart = useCallback((targetKey: 'A' | 'B', offset: number) => {
    const isA = targetKey === 'A'
    const current = isA ? targetA : targetB
    const contours = parseCubicContours(current.d)
    const shifted = contours.map(c => cycleCubicContour(c, offset))
    const nextD = serializeCubicContours(shifted)
    if (isA) setTargetA(t => ({ ...t, d: nextD }))
    else setTargetB(t => ({ ...t, d: nextD }))
  }, [targetA, targetB])

  const setTargetCustomD = useCallback((targetKey: 'A' | 'B', d: string, name?: string) => {
    if (targetKey === 'A') {
      setTargetA(t => ({ ...t, d, ...(name ? { name } : {}) }))
    } else {
      setTargetB(t => ({ ...t, d, ...(name ? { name } : {}) }))
    }
  }, [])

  return {
    validTargets,
    targetA,
    targetB,
    setTargetA,
    setTargetB,
    config,
    updateConfig,
    rawProgress,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    morphResult,
    play,
    pause,
    togglePlay,
    scrubTo,
    stepForward,
    stepBackward,
    reset,
    loadPreset,
    swapTargets,
    rotateTarget,
    flipTarget,
    reverseTargetWinding,
    shiftTargetStart,
    setTargetCustomD,
  }
}
