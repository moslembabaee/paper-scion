import { FrequencyAnalysis } from './analysis.ts'
import { DEFAULT_AUDIO_SETTINGS } from './types.ts'
import type { AudioAnalysisSettings, AudioFrame } from './types.ts'

export interface AudioInputState {
  readonly status: 'idle' | 'starting' | 'running' | 'error'
  readonly source: 'microphone' | 'file' | 'test' | null
  readonly label: string
  readonly error: string | null
}

type FrameListener = (frame: Readonly<AudioFrame>) => void

/** One user-activated audio graph and FFT shared by every visible material. */
export class AudioAnalysisEngine {
  private analysis = new FrequencyAnalysis()
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private nodes: AudioNode[] = []
  private stream: MediaStream | null = null
  private bufferSource: AudioBufferSourceNode | null = null
  private spectrum = new Float32Array(1024).fill(-Infinity)
  private waveform = new Float32Array(2048)
  private frameListeners = new Set<FrameListener>()
  private stateListeners = new Set<() => void>()
  private request = 0
  private lastTime = 0
  private generation = 0
  private state: AudioInputState = { status: 'idle', source: null, label: 'No audio input', error: null }
  private settings: AudioAnalysisSettings = { ...DEFAULT_AUDIO_SETTINGS }

  getSnapshot = () => this.state
  getFrame = () => this.analysis.frame as Readonly<AudioFrame>
  getSpectrum = () => this.spectrum as Readonly<Float32Array>
  getSettings = () => this.settings as Readonly<AudioAnalysisSettings>
  subscribe = (listener: () => void) => { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener) } }
  subscribeFrame = (listener: FrameListener) => { this.frameListeners.add(listener); return () => { this.frameListeners.delete(listener) } }

  configure(changes: Partial<AudioAnalysisSettings>) {
    const next = { ...this.settings }
    const ranges = { gain: [0.1, 8], attack: [0.001, 0.2], release: [0.02, 2], threshold: [0.01, 0.5] } as const
    for (const key of Object.keys(ranges) as (keyof AudioAnalysisSettings)[]) {
      const value = changes[key]
      if (typeof value === 'number' && Number.isFinite(value)) next[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], value))
    }
    this.settings = next
  }

  private setState(state: AudioInputState) {
    this.state = state
    for (const listener of this.stateListeners) listener()
  }

  private emitFrame() { for (const listener of this.frameListeners) listener(this.analysis.frame) }

  private tick = (now: number) => {
    this.request = 0
    if (!this.analyser || !this.context || this.state.status !== 'running') return
    if (this.context.state === 'running') {
      this.analyser.getFloatFrequencyData(this.spectrum)
      this.analyser.getFloatTimeDomainData(this.waveform)
      this.analysis.process(this.spectrum, this.waveform, this.context.sampleRate, this.analyser.fftSize, this.lastTime ? (now - this.lastTime) / 1000 : 1 / 60, this.settings)
    } else this.analysis.reset()
    this.lastTime = now
    this.emitFrame()
    this.request = requestAnimationFrame(this.tick)
  }

  private visibility = () => {
    cancelAnimationFrame(this.request)
    this.request = this.lastTime = 0
    this.analysis.reset()
    this.emitFrame()
    if (!document.hidden && this.state.status === 'running') this.request = requestAnimationFrame(this.tick)
  }

  stop = () => {
    this.generation++ // Invalidates pending permission prompts, decoding, and resume promises.
    cancelAnimationFrame(this.request)
    this.request = this.lastTime = 0
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility)
    if (this.bufferSource) { this.bufferSource.onended = null; try { this.bufferSource.stop() } catch { /* already ended */ } }
    this.bufferSource = null
    for (const node of this.nodes) node.disconnect()
    this.nodes = []
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    const context = this.context
    this.context = this.analyser = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    this.spectrum.fill(-Infinity)
    this.waveform.fill(0)
    this.analysis.reset()
    this.emitFrame()
    this.setState({ status: 'idle', source: null, label: 'No audio input', error: null })
  }

  private async start(source: NonNullable<AudioInputState['source']>, file?: File) {
    this.stop()
    const generation = this.generation
    this.setState({ status: 'starting', source, label: source === 'file' ? file?.name ?? 'Audio file' : source === 'test' ? 'Test signal · 110 Hz' : 'Microphone', error: null })
    try {
      if (typeof window === 'undefined' || !window.AudioContext) throw new Error('Web Audio is unavailable in this browser.')
      if (source === 'microphone' && !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost and a supported browser.')
      const context = new window.AudioContext()
      this.context = context
      const resume = context.resume()
      // Handle rejection immediately while permission or decoding is pending.
      void resume.catch(() => {})
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0 // Our time-based envelope is refresh-rate independent.
      this.analyser = analyser
      this.nodes.push(analyser)

      if (source === 'microphone') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return }
        this.stream = stream
        const input = context.createMediaStreamSource(stream)
        input.connect(analyser) // No destination connection: never monitor a microphone.
        this.nodes.push(input)
        for (const track of stream.getAudioTracks()) track.addEventListener('ended', this.stop, { once: true })
      } else if (source === 'file') {
        if (!file) throw new Error('Choose an audio file.')
        const data = await file.arrayBuffer()
        if (generation !== this.generation) return
        const buffer = await context.decodeAudioData(data)
        if (generation !== this.generation) return
        const input = context.createBufferSource()
        input.buffer = buffer
        input.connect(analyser)
        analyser.connect(context.destination)
        this.nodes.push(input)
        this.bufferSource = input
        input.onended = () => { if (generation === this.generation) this.stop() }
      } else {
        // A looping, silently analysed tone: useful for routing without a microphone.
        const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
        const samples = buffer.getChannelData(0)
        for (let i = 0; i < samples.length; i++) {
          const time = i / context.sampleRate
          const beat = time % 0.5
          samples[i] = Math.sin(2 * Math.PI * 110 * time) * Math.min(1, beat / 0.015) * Math.exp(-beat / 0.1) * 0.75
        }
        const input = context.createBufferSource()
        input.buffer = buffer
        input.loop = true
        const mute = context.createGain()
        mute.gain.value = 0
        input.connect(analyser).connect(mute).connect(context.destination)
        this.nodes.push(input, mute)
        this.bufferSource = input
      }
      await resume
      if (generation !== this.generation) return
      this.bufferSource?.start()
      this.setState({ ...this.state, status: 'running' })
      document.addEventListener('visibilitychange', this.visibility)
      if (!document.hidden) this.request = requestAnimationFrame(this.tick)
    } catch (error) {
      if (generation !== this.generation) return
      this.stop()
      const message = source === 'microphone' && error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow access in your browser or choose an audio file.'
        : error instanceof Error ? error.message : 'Could not start audio input.'
      this.setState({ status: 'error', source: null, label: 'Audio unavailable', error: message })
    }
  }

  startMicrophone = () => this.start('microphone')
  startFile = (file: File) => this.start('file', file)
  startTest = () => this.start('test')
}

export const audioAnalysis = new AudioAnalysisEngine()
