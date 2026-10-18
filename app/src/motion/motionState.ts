import { useSyncExternalStore } from 'react'
import type { MotionEasing } from './types.ts'

export interface MotionPlaybackController {
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (ms: number) => void
  stepFrame: (delta: number) => void
  jumpKeyframe: (direction: 'prev' | 'next') => void
  restore: () => void
  setLooping: (loop: boolean) => void
  setPlaybackRate: (rate: number) => void
}

export interface MotionGlobalState {
  currentTimeMs: number
  playing: boolean
  preview: boolean
  loop: boolean
  playbackRate: number
  activeTrackId: string | null
  activeKeyId: string | null
  activeEasing: MotionEasing | null
  drawerMinimized: boolean
  showTrajectory: boolean
}

let controllerRef: MotionPlaybackController | null = null

let state: MotionGlobalState = {
  currentTimeMs: 0,
  playing: false,
  preview: false,
  loop: false,
  playbackRate: 1,
  activeTrackId: null,
  activeKeyId: null,
  activeEasing: null,
  drawerMinimized: false,
  showTrajectory: true,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getMotionState(): MotionGlobalState {
  return state
}

export function subscribeMotionState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMotionState(): MotionGlobalState {
  return useSyncExternalStore(subscribeMotionState, getMotionState, getMotionState)
}

export function setMotionPlaybackController(controller: MotionPlaybackController | null): void {
  controllerRef = controller
}

export function getMotionPlaybackController(): MotionPlaybackController | null {
  return controllerRef
}

export function updateMotionState(patch: Partial<MotionGlobalState>): void {
  let changed = false
  for (const key of Object.keys(patch) as (keyof MotionGlobalState)[]) {
    if (state[key] !== patch[key]) {
      changed = true
      break
    }
  }
  if (changed) {
    state = { ...state, ...patch }
    emit()
  }
}

export function setMotionTime(timeMs: number): void {
  if (state.currentTimeMs !== timeMs) {
    state = { ...state, currentTimeMs: timeMs }
    emit()
  }
}

export function setMotionPlaying(playing: boolean): void {
  if (state.playing !== playing) {
    state = { ...state, playing }
    emit()
  }
}

export function setMotionPreview(preview: boolean): void {
  if (state.preview !== preview) {
    state = { ...state, preview }
    emit()
  }
}

export function setMotionActiveKey(
  trackId: string | null,
  keyId: string | null,
  easing: MotionEasing | null = null
): void {
  if (state.activeTrackId !== trackId || state.activeKeyId !== keyId || state.activeEasing !== easing) {
    state = { ...state, activeTrackId: trackId, activeKeyId: keyId, activeEasing: easing }
    emit()
  }
}

export function toggleMotionDrawerMinimized(): void {
  state = { ...state, drawerMinimized: !state.drawerMinimized }
  emit()
}

export function setMotionDrawerMinimized(minimized: boolean): void {
  if (state.drawerMinimized !== minimized) {
    state = { ...state, drawerMinimized: minimized }
    emit()
  }
}

export function toggleMotionTrajectory(): void {
  state = { ...state, showTrajectory: !state.showTrajectory }
  emit()
}

// Global action helpers that invoke the registered playback controller
export function motionPlay(): void {
  controllerRef?.play()
}

export function motionPause(): void {
  controllerRef?.pause()
}

export function motionToggle(): void {
  controllerRef?.toggle()
}

export function motionSeek(ms: number): void {
  controllerRef?.seek(ms)
}

export function motionStepFrame(delta: number): void {
  controllerRef?.stepFrame(delta)
}

export function motionJumpKeyframe(direction: 'prev' | 'next'): void {
  controllerRef?.jumpKeyframe(direction)
}

export function motionRestore(): void {
  controllerRef?.restore()
}

export function motionSetLooping(loop: boolean): void {
  controllerRef?.setLooping(loop)
  updateMotionState({ loop })
}

export function motionSetPlaybackRate(rate: number): void {
  controllerRef?.setPlaybackRate(rate)
  updateMotionState({ playbackRate: rate })
}
