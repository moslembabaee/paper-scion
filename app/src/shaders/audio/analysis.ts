import { DEFAULT_AUDIO_SETTINGS, SILENT_AUDIO } from './types.ts'
import type { AudioAnalysisSettings, AudioFrame } from './types.ts'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const follow = (current: number, target: number, delta: number, attack: number, release: number) =>
  current + (target - current) * (1 - Math.exp(-delta / Math.max(0.001, target > current ? attack : release)))

/** Converts actual FFT bin frequencies to disjoint, sample-rate-aware bands. */
export function bandEnergy(spectrum: Float32Array, sampleRate: number, fftSize: number, low: number, high: number): number {
  const first = Math.max(1, Math.ceil(low * fftSize / sampleRate))
  const end = Math.min(spectrum.length, Math.ceil(high * fftSize / sampleRate))
  let power = 0
  for (let i = first; i < end; i++) {
    const db = spectrum[i]
    if (Number.isFinite(db) && db > -90) power += 10 ** (db / 10)
  }
  return clamp(Math.sqrt(power))
}

/** Reuses its frame and input buffers; no allocations in the analysis loop. */
export class FrequencyAnalysis {
  readonly frame: AudioFrame = { ...SILENT_AUDIO }
  private previousVolume = 0
  private baseline = 0
  private cooldown = 0

  reset() {
    Object.assign(this.frame, SILENT_AUDIO)
    this.previousVolume = this.baseline = this.cooldown = 0
  }

  process(spectrum: Float32Array, waveform: Float32Array, sampleRate: number, fftSize: number, deltaSeconds: number, settings: Readonly<AudioAnalysisSettings> = DEFAULT_AUDIO_SETTINGS): Readonly<AudioFrame> {
    const dt = Math.max(0, Math.min(0.1, deltaSeconds))
    const gain = settings.gain
    const frame = this.frame
    const bass = clamp(bandEnergy(spectrum, sampleRate, fftSize, 20, 250) * gain)
    const mid = clamp(bandEnergy(spectrum, sampleRate, fftSize, 250, 4000) * gain)
    const treble = clamp(bandEnergy(spectrum, sampleRate, fftSize, 4000, 20000) * gain)
    let squareSum = 0
    let peak = 0
    for (let i = 0; i < waveform.length; i++) {
      const sample = Number.isFinite(waveform[i]) ? waveform[i] : 0
      squareSum += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }
    const rms = clamp(Math.sqrt(squareSum / Math.max(1, waveform.length)) * gain)
    frame.bass = follow(frame.bass, bass, dt, settings.attack, settings.release)
    frame.mid = follow(frame.mid, mid, dt, settings.attack, settings.release)
    frame.treble = follow(frame.treble, treble, dt, settings.attack, settings.release)
    frame.volume = follow(frame.volume, rms, dt, settings.attack, settings.release)
    frame.peak = Math.max(clamp(peak * gain), frame.peak * Math.exp(-dt / 0.35))
    this.cooldown = Math.max(0, this.cooldown - dt)
    // A rising edge above an adaptive noise floor, with a 120ms refractory period.
    const onset = rms - this.baseline
    if (this.cooldown === 0 && onset > settings.threshold && rms - this.previousVolume > settings.threshold * 0.25) {
      frame.transient = clamp(onset / Math.max(0.01, settings.threshold * 2))
      this.cooldown = 0.12
    } else frame.transient *= Math.exp(-dt / 0.16)
    this.baseline = follow(this.baseline, rms, dt, 0.3, 0.5)
    this.previousVolume = rms
    return frame
  }
}
