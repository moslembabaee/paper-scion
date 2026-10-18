import test from 'node:test'
import assert from 'node:assert/strict'
import { FrequencyAnalysis, bandEnergy } from '../src/shaders/audio/analysis.ts'
import { DEFAULT_AUDIO_SETTINGS, SILENT_AUDIO, audioSignals } from '../src/shaders/audio/types.ts'
import { AudioAnalysisEngine } from '../src/shaders/audio/engine.ts'
import { createShader, validateShader } from '../src/shaders/catalog.ts'
import { createMultiPassUniformUpdater, multiPassUniforms, computeModulatedValue, pipelineModulationUniforms } from '../src/shaders/pipeline/multiPassFragment.ts'
import { addPipelinePass, validatePipeline } from '../src/shaders/pipeline/pipelineOps.ts'
import { exportPipelineReact, exportPipelineUniforms } from '../src/shaders/pipeline/pipelineExport.ts'
import { shaderSchema, validateSchema } from '../src/mcp/schema.ts'
import { SceneStore } from '../src/scene/store.ts'

const spectrum = () => new Float32Array(1024).fill(-Infinity)
const wave = amplitude => new Float32Array(2048).fill(amplitude)
const routed = source => {
  const paint = createShader('multi-pass')
  const pass = paint.pipeline.passes.find(pass => pass.type === 'liquid-distortion')
  return { ...paint, pipeline: { ...paint.pipeline, modulators: [{ id: 'audio-test', name: 'Audio', targetPassId: pass.id, targetParam: 'distortion', waveform: 'sine', source, frequency: 1, offset: 0, amplitude: 0.8, enabled: true }] } }
}

test('FFT bands isolate tones at 44.1k, 48k and 96k sample rates', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const [frequency, target] of [[110, 0], [1000, 1], [8000, 2]]) {
      const bins = spectrum()
      bins[Math.round(frequency * 2048 / sampleRate)] = -6
      const bands = [[20, 250], [250, 4000], [4000, 20000]].map(([low, high]) => bandEnergy(bins, sampleRate, 2048, low, high))
      assert.ok(bands[target] > 0.49)
      assert.equal(bands.filter((_, i) => i !== target).reduce((sum, n) => sum + n, 0), 0)
    }
  }
})

test('silence stays zero and NaN bins and samples do not poison uniforms', () => {
  const engine = new FrequencyAnalysis()
  const bins = spectrum()
  bins[3] = NaN
  const waveform = wave(0)
  waveform[4] = NaN
  assert.deepEqual(engine.process(bins, waveform, 48000, 2048, 1 / 60), SILENT_AUDIO)
})

test('RMS attack and release are independent of render refresh rate', () => {
  const envelopes = [30, 60, 144].map(fps => {
    const engine = new FrequencyAnalysis()
    for (let i = 0; i < fps; i++) engine.process(spectrum(), wave(0.5), 48000, 2048, 1 / fps)
    const attack = engine.frame.volume
    for (let i = 0; i < fps; i++) engine.process(spectrum(), wave(0), 48000, 2048, 1 / fps)
    return [attack, engine.frame.volume]
  })
  for (const envelope of envelopes) {
    assert.ok(Math.abs(envelope[0] - 0.5) < 0.001)
    assert.ok(Math.abs(envelope[1] - envelopes[0][1]) < 0.00001)
    assert.ok(envelope[1] < 0.01)
  }
})

test('transients detect attacks, decay on sustained tones, and retrigger after silence', () => {
  const engine = new FrequencyAnalysis()
  const bins = spectrum()
  engine.process(bins, wave(0.7), 48000, 2048, 1 / 60)
  assert.equal(engine.frame.transient, 1)
  const first = engine.frame.transient
  engine.process(bins, wave(0.7), 48000, 2048, 1 / 60)
  assert.ok(engine.frame.transient < first)
  for (let i = 0; i < 180; i++) engine.process(bins, wave(0.7), 48000, 2048, 1 / 60)
  assert.ok(engine.frame.transient < 0.001)
  for (let i = 0; i < 180; i++) engine.process(bins, wave(0), 48000, 2048, 1 / 60)
  engine.process(bins, wave(0.7), 48000, 2048, 1 / 60)
  assert.equal(engine.frame.transient, 1)
  engine.reset()
  assert.deepEqual(engine.frame, SILENT_AUDIO)
})

test('input gain, peak hold and normalized bounds survive large samples', () => {
  const engine = new FrequencyAnalysis()
  const bins = new Float32Array(1024).fill(0)
  engine.process(bins, wave(10), 48000, 2048, 1 / 60, { ...DEFAULT_AUDIO_SETTINGS, gain: 8 })
  for (const signal of audioSignals) assert.ok(engine.frame[signal] >= 0 && engine.frame[signal] <= 1)
  assert.equal(engine.frame.peak, 1)
  engine.process(spectrum(), wave(0), 48000, 2048, 1 / 60)
  assert.ok(engine.frame.peak > 0.9)
})

test('all audio signals modulate independently of LFO time and restore neutral on stop', () => {
  for (const signal of audioSignals) {
    const paint = routed(signal)
    const update = createMultiPassUniformUpdater({ ...paint, speed: 0 })
    const base = multiPassUniforms(paint).u_liquid_distortion
    const frame = { ...SILENT_AUDIO, [signal]: 0.7 }
    const live = update(5000, frame)
    assert.ok(live.u_liquid_distortion > base)
    assert.equal(live[`u_audio_${signal}`], 0.7)
    const expected = multiPassUniforms(paint, 5000, frame)
    assert.equal(live.u_liquid_distortion, expected.u_liquid_distortion)
    const sameBuffer = update(9000, SILENT_AUDIO)
    assert.equal(live, sameBuffer)
    assert.equal(sameBuffer.u_liquid_distortion, base)
  }
})

test('LFO and audio routes sum before clamping, disabled routes stay neutral', () => {
  const paint = routed('bass')
  const mod = paint.pipeline.modulators[0]
  const lfo = { ...mod, id: 'lfo', source: 'lfo', waveform: 'pulse', amplitude: 0.2 }
  const value = computeModulatedValue(0.1, [mod, lfo], mod.targetPassId, mod.targetParam, 0, 1, 1, { ...SILENT_AUDIO, bass: 0.5 })
  assert.ok(Math.abs(value - 0.7) < 0.00001)
  assert.equal(computeModulatedValue(0.1, [{ ...mod, enabled: false }], mod.targetPassId, mod.targetParam, 0, 1, 1, { ...SILENT_AUDIO, bass: 1 }), 0.1)
})

test('every advertised pass parameter is routed consistently by live and snapshot uniform builders', () => {
  const paint = addPipelinePass(createShader('multi-pass'), 'custom-glsl')
  for (const pass of paint.pipeline.passes) {
    for (const [param, [uniform]] of Object.entries(pipelineModulationUniforms[pass.type] ?? {})) {
      const mod = { ...routed('volume').pipeline.modulators[0], targetPassId: pass.id, targetParam: param }
      const routedPaint = { ...paint, pipeline: { ...paint.pipeline, modulators: [mod] } }
      const frame = { ...SILENT_AUDIO, volume: 0.6 }
      assert.equal(createMultiPassUniformUpdater(routedPaint)(100, frame)[uniform], multiPassUniforms(routedPaint, 100, frame)[uniform], `${pass.type}.${param}`)
    }
  }
})

test('audio routes validate, round trip through documents and MCP, and preserve legacy LFOs', () => {
  const store = new SceneStore()
  const paint = routed('transient')
  validateShader(paint)
  validateSchema(paint, shaderSchema)
  store.setBackgroundShader(paint)
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.equal(restored.getSnapshot().backgroundShader.pipeline.modulators[0].source, 'transient')
  const invalid = { ...paint.pipeline, modulators: [{ ...paint.pipeline.modulators[0], source: 'unknown' }] }
  assert.throws(() => validatePipeline(invalid), /source/)
  assert.throws(() => validateSchema({ ...paint, pipeline: invalid }, shaderSchema))
  validateShader(createShader('multi-pass'))
})

test('handoff contains live callback routing and deterministic silent uniform snapshots', () => {
  const paint = routed('bass')
  const code = exportPipelineReact(paint)
  assert.match(code, /getAudioFrame/)
  assert.match(code, /setUniforms\(next\)/)
  assert.match(code, /"source": "bass"/)
  assert.match(code, /cancelAnimationFrame/)
  const uniforms = JSON.parse(exportPipelineUniforms(paint))
  for (const signal of audioSignals) assert.equal(uniforms[`u_audio_${signal}`], 0)
})

function installAudioEnvironment(t, getUserMedia) {
  const contexts = []
  const makeNode = () => ({ connect() { return this }, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0 }, start() {}, stop() {} })
  class Context {
    state = 'running'
    currentTime = 0
    sampleRate = 48000
    closed = false
    constructor() { contexts.push(this) }
    resume() { return Promise.resolve() }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve() }
    createAnalyser() { return { ...makeNode(), fftSize: 2048, getFloatFrequencyData() {}, getFloatTimeDomainData() {} } }
    createMediaStreamSource() { return makeNode() }
    createOscillator() { return makeNode() }
    createGain() { return makeNode() }
    createBuffer() { return { getChannelData: () => new Float32Array(this.sampleRate) } }
    createBufferSource() { return makeNode() }
  }
  const globals = { window: { AudioContext: Context }, navigator: { mediaDevices: { getUserMedia } }, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] })
  }
  return contexts
}

test('stopping during microphone permission releases a late stream without restarting', async t => {
  let resolvePermission
  let stopped = 0
  const contexts = installAudioEnvironment(t, () => new Promise(resolve => { resolvePermission = resolve }))
  const engine = new AudioAnalysisEngine()
  const start = engine.startMicrophone()
  assert.equal(engine.getSnapshot().status, 'starting')
  engine.stop()
  resolvePermission({ getTracks: () => [{ stop: () => stopped++ }] })
  await start
  assert.equal(engine.getSnapshot().status, 'idle')
  assert.equal(stopped, 1)
  assert.equal(contexts[0].closed, true)
  assert.deepEqual(engine.getFrame(), SILENT_AUDIO)
})

test('a stale microphone request cannot overwrite a newer source', async t => {
  let rejectPermission
  const contexts = installAudioEnvironment(t, () => new Promise((_, reject) => { rejectPermission = reject }))
  const engine = new AudioAnalysisEngine()
  const old = engine.startMicrophone()
  await engine.startTest()
  rejectPermission(new DOMException('Denied', 'NotAllowedError'))
  await old
  assert.equal(engine.getSnapshot().status, 'running')
  assert.equal(engine.getSnapshot().source, 'test')
  assert.equal(contexts[0].closed, true)
  engine.stop()
  assert.equal(contexts[1].closed, true)
})

test('permission failures close resources and expose actionable status', async t => {
  const contexts = installAudioEnvironment(t, async () => { throw new DOMException('Denied', 'NotAllowedError') })
  const engine = new AudioAnalysisEngine()
  await engine.startMicrophone()
  assert.equal(engine.getSnapshot().status, 'error')
  assert.match(engine.getSnapshot().error, /permission was denied/)
  assert.equal(contexts[0].closed, true)
  engine.configure({ gain: NaN, attack: Infinity, release: -10, threshold: 10 })
  assert.equal(engine.getSettings().gain, 1)
  assert.equal(engine.getSettings().release, 0.02)
  assert.equal(engine.getSettings().threshold, 0.5)
})
