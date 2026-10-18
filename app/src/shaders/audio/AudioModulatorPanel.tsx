import { Activity, AudioLines, Mic, Plus, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { audioAnalysis } from './engine'
import { audioSignals, audioSignalLabels as signalLabels } from './types'
import type { AudioAnalysisSettings, AudioFrame } from './types'
import './audio.css'

function AudioMonitor() {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    const meters = root.current?.querySelectorAll<HTMLElement>('[data-audio-meter]')
    let lastReadout = 0
    const draw = (frame: Readonly<AudioFrame>) => {
      const now = performance.now()
      meters?.forEach((meter, index) => {
        const value = frame[audioSignals[index]]
        const bar = meter.querySelector<HTMLElement>('i')
        if (bar) bar.style.transform = `scaleX(${value})`
        if (now - lastReadout > 100) {
          meter.setAttribute('aria-valuenow', String(Math.round(value * 100)))
          const output = meter.querySelector('output')
          if (output) output.textContent = value.toFixed(2)
        }
      })
      if (now - lastReadout > 100) lastReadout = now
      if (!context) return
      context.clearRect(0, 0, 480, 120)
      const spectrum = audioAnalysis.getSpectrum()
      context.fillStyle = '#81adec'
      for (let i = 0; i < 40; i++) {
        const first = Math.max(1, Math.floor(1024 ** (i / 40)))
        const end = Math.max(first + 1, Math.floor(1024 ** ((i + 1) / 40)))
        let db = -90
        for (let bin = first; bin < Math.min(end, spectrum.length); bin++) db = Math.max(db, spectrum[bin])
        const height = Math.max(1, Math.min(100, (db + 90) / 90 * 100))
        context.fillRect(i * 12 + 2, 112 - height, 7, height)
      }
    }
    draw(audioAnalysis.getFrame())
    return audioAnalysis.subscribeFrame(draw)
  }, [])
  return <div ref={root} className="audio-monitor">
    <div className="audio-spectrum"><canvas ref={canvas} width={480} height={120} role="img" aria-label="Live audio frequency spectrum" /><div className="audio-spectrum-axis"><span>20 Hz</span><span>FFT / 2048</span><span>20 kHz</span></div></div>
    <div className="audio-meters">{audioSignals.map(signal => <div key={signal} data-audio-meter role="meter" aria-label={`Audio ${signalLabels[signal]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
      <span>{signalLabels[signal]}</span><output>0.00</output><div className="audio-meter-track"><i /></div>
    </div>)}</div>
  </div>
}

export function AudioModulatorPanel({ onAddRoute }: { onAddRoute: () => void }) {
  const state = useSyncExternalStore(audioAnalysis.subscribe, audioAnalysis.getSnapshot)
  const [settings, setSettings] = useState(audioAnalysis.getSettings)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = state.status === 'starting'
  const change = (key: keyof AudioAnalysisSettings, value: number) => {
    audioAnalysis.configure({ [key]: value })
    setSettings(audioAnalysis.getSettings())
  }
  return <section className="audio-modulator" aria-label="Audio reactive modulation">
    <div className="audio-heading"><span><AudioLines size={13} />AUDIO INPUT</span><span className="audio-status" data-active={state.status === 'running'}><i />{busy ? 'CONNECTING' : state.status === 'running' ? 'LIVE' : 'OFFLINE'}</span></div>
    <p className="audio-description">Let sound shape the material.</p>
    <div className="audio-source-actions">
      <button type="button" disabled={busy} onClick={() => void audioAnalysis.startMicrophone()}><Mic size={12} />Microphone</button>
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={12} />Audio file</button>
      <input ref={fileInput} className="audio-file-input" type="file" accept="audio/*" aria-label="Choose local audio file" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void audioAnalysis.startFile(file); event.currentTarget.value = '' }} />
    </div>
    <div className="audio-source-detail"><span title={state.label}>{state.label}</span>{state.status === 'running' || busy ? <button type="button" aria-label="Stop audio input" onClick={audioAnalysis.stop}><Square size={10} />Stop</button> : <button type="button" onClick={() => void audioAnalysis.startTest()}><Activity size={10} />Test signal</button>}</div>
    {state.error && <p className="audio-error" role="alert">{state.error}</p>}
    <AudioMonitor />
    <div className="audio-settings">
      {([
        ['gain', 'Input gain', 0.1, 8, 0.1, '×'],
        ['attack', 'Attack', 0.001, 0.2, 0.001, 's'],
        ['release', 'Release', 0.02, 2, 0.01, 's'],
        ['threshold', 'Transient threshold', 0.01, 0.5, 0.01, ''],
      ] as const).map(([key, label, min, max, step, unit]) => <label key={key}><span>{label}<output>{Number(settings[key].toFixed(3))}{unit}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={settings[key]} onChange={event => change(key, event.currentTarget.valueAsNumber)} /></label>)}
    </div>
    <button className="audio-add-route" type="button" onClick={onAddRoute}><Plus size={12} />Add audio route</button>
    <p className="audio-note">Audio stays on this device. Microphone is never played back. Test signal is silent. Use Animated mode for live modulation.</p>
  </section>
}
