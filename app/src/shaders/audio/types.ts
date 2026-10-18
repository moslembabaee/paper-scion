export const audioSignals = ['bass', 'mid', 'treble', 'volume', 'peak', 'transient'] as const
export type AudioSignal = typeof audioSignals[number]
export const audioSignalLabels: Readonly<Record<AudioSignal, string>> = { bass: 'Bass', mid: 'Mid', treble: 'Treble', volume: 'Volume', peak: 'Peak', transient: 'Transient' }

/** Normalized signals; transient is a decaying onset envelope, peak a held sample peak. */
export interface AudioFrame {
  bass: number
  mid: number
  treble: number
  volume: number
  peak: number
  transient: number
}

export const SILENT_AUDIO: Readonly<AudioFrame> = Object.freeze({ bass: 0, mid: 0, treble: 0, volume: 0, peak: 0, transient: 0 })

export interface AudioAnalysisSettings {
  gain: number
  attack: number
  release: number
  threshold: number
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioAnalysisSettings> = Object.freeze({ gain: 1, attack: 0.015, release: 0.24, threshold: 0.08 })
