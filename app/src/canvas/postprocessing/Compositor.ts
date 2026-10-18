import { fragments, vertexShader } from './shaders.ts'
import { validatePostProcessing } from './model.ts'
import type { CanvasPostProcessingPipeline, PostProcessPass } from './types.ts'

type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
type ProgramName = keyof typeof fragments

/** Reusable ping-pong compositor. Bloom uses two half-resolution separable blur passes.
 * No readPixels, shader compilation, framebuffer allocation or React updates per frame. */
export class PostProcessingCompositor {
  private gl: WebGL2RenderingContext
  private programs = new Map<ProgramName, Program>()
  private targets: Target[] = []
  private input: WebGLTexture
  private vao: WebGLVertexArrayObject
  private disposed = false
  private pipeline: CanvasPostProcessingPipeline = { version: 1, enabled: false, preset: 'custom', passes: [] }
  private maxPixels: number
  private maxTextureSize: number
  private inputWidth = 0
  private inputHeight = 0
  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, maxPixels = 1_500_000) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    if (!gl) throw new Error('Post-processing requires WebGL 2')
    this.gl = gl
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.maxPixels = maxPixels
    this.input = gl.createTexture()!
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    this.configureTexture(this.input)
    try { this.getProgram('copy') } catch (error) { this.dispose(); throw error }
  }

  setPipeline(pipeline: CanvasPostProcessingPipeline) {
    validatePostProcessing(pipeline)
    this.pipeline = pipeline
    for (const pass of pipeline.passes) {
      if (!pass.enabled) continue
      this.getProgram(pass.type)
      if (pass.type === 'bloom') { this.getProgram('threshold'); this.getProgram('blur') }
    }
  }

  private getProgram(name: ProgramName): Program {
    const existing = this.programs.get(name)
    if (existing) return existing
    const gl = this.gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(`Post-processing ${name}: ${message}`)
      }
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, vertexShader)
    let fragment: WebGLShader | undefined
    const program = gl.createProgram()!
    try {
      fragment = compile(gl.FRAGMENT_SHADER, fragments[name])
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Post-processing ${name}: ${gl.getProgramInfoLog(program)}`)
    } catch (error) { gl.deleteProgram(program); throw error }
    finally { gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment) }
    const result = { program, uniforms: new Map<string, WebGLUniformLocation | null>() }
    for (const key of ['source', 'aux', 'resolution', 'params', 'extra', 'params2', 'params3', 'color', 'color2', 'time', 'opacity', 'blend']) result.uniforms.set(key, gl.getUniformLocation(program, `u_${key}`))
    this.programs.set(name, result)
    return result
  }

  private configureTexture(texture: WebGLTexture) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private resize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height && this.targets.length) return
    this.releaseTargets()
    this.canvas.width = width
    this.canvas.height = height
    const gl = this.gl
    try {
      for (let i = 0; i < 4; i++) {
        const w = i < 2 ? width : Math.max(1, Math.ceil(width / 2))
        const h = i < 2 ? height : Math.max(1, Math.ceil(height / 2))
        const texture = gl.createTexture()!
        const framebuffer = gl.createFramebuffer()!
        this.targets.push({ texture, framebuffer, width: w, height: h })
        this.configureTexture(texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Post-processing framebuffer unavailable')
      }
    } catch (error) { this.releaseTargets(); throw error }
  }

  private draw(
    name: ProgramName,
    source: WebGLTexture,
    target: Target | null,
    params: readonly number[] = [0, 0, 0, 0],
    pass?: PostProcessPass,
    time = 0,
    aux?: WebGLTexture,
    extra: readonly number[] = [0, 0, 0, 0],
    params2: readonly number[] = [0, 0, 0, 0],
    colorHex?: string,
  ) {
    const gl = this.gl
    const p = this.getProgram(name)
    const uniform = (key: string) => p.uniforms.get(key) ?? null
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
    gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height)
    gl.useProgram(p.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source)
    gl.uniform1i(uniform('source'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, aux ?? source)
    gl.uniform1i(uniform('aux'), 1)
    gl.uniform2f(uniform('resolution'), target?.width ?? this.canvas.width, target?.height ?? this.canvas.height)
    gl.uniform4f(uniform('params'), params[0], params[1], params[2], params[3])
    gl.uniform4f(uniform('extra'), extra[0], extra[1], extra[2], extra[3])
    gl.uniform4f(uniform('params2'), params2[0], params2[1], params2[2], params2[3])
    gl.uniform1f(uniform('time'), time)
    gl.uniform1f(uniform('opacity'), pass?.opacity ?? 1)
    gl.uniform1i(uniform('blend'), ['normal', 'screen', 'multiply', 'overlay'].indexOf(pass?.blendMode ?? 'normal'))
    if (pass?.type === 'film-grain') gl.uniform4f(uniform('extra'), Number(pass.params.temporal), Number(pass.params.monochrome), 0, 0)
    if (colorHex) {
      gl.uniform3f(uniform('color'), parseInt(colorHex.slice(1, 3), 16) / 255, parseInt(colorHex.slice(3, 5), 16) / 255, parseInt(colorHex.slice(5, 7), 16) / 255)
    } else if (pass?.type === 'vignette' || pass?.type === 'color-grade') {
      const color = pass.type === 'vignette' ? pass.params.color : pass.params.tint
      gl.uniform3f(uniform('color'), parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Source is a preserved canvas; time is seconds, fixed for static/export frames. */
  render(source: HTMLCanvasElement, time = 0) {
    if (this.disposed || this.gl.isContextLost() || source.width < 1 || source.height < 1) return false
    if (source.width > this.maxTextureSize || source.height > this.maxTextureSize) throw new Error('Post-processing source exceeds the GPU texture size limit')
    const factor = Math.min(1, Math.sqrt(this.maxPixels / (source.width * source.height)))
    this.resize(Math.max(1, Math.floor(source.width * factor)), Math.max(1, Math.floor(source.height * factor)))
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.input)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    if (this.inputWidth !== source.width || this.inputHeight !== source.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      this.inputWidth = source.width
      this.inputHeight = source.height
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
    let input = this.input
    let index = 0
    if (this.pipeline.enabled) for (const pass of this.pipeline.passes) {
      if (!pass.enabled || pass.opacity === 0) continue
      const target = this.targets[index % 2]
      switch (pass.type) {
        case 'bloom': {
          const p = pass.params
          this.draw('threshold', input, this.targets[2], [p.threshold, p.knee, 0, 0])
          this.draw('blur', this.targets[2].texture, this.targets[3], [p.radius * 4, 0, 0, 0])
          this.draw('blur', this.targets[3].texture, this.targets[2], [0, p.radius * 4, 0, 0])
          this.draw('bloom', input, target, [p.intensity, 0, 0, 0], pass, time, this.targets[2].texture)
          break
        }
        case 'chromatic-aberration': this.draw(pass.type, input, target, [pass.params.intensity, pass.params.spread, Number(pass.params.radial), pass.params.angle * Math.PI / 180], pass, time); break
        case 'film-grain': this.draw(pass.type, input, target, [pass.params.intensity, pass.params.size, pass.params.speed, 0], pass, time); break
        case 'vignette': this.draw(pass.type, input, target, [pass.params.intensity, pass.params.radius, pass.params.smoothness, pass.params.roundness], pass, time); break
        case 'color-grade': this.draw(pass.type, input, target, [pass.params.contrast, pass.params.brightness, pass.params.saturation, pass.params.exposure], pass, time); break
        case 'frosted-glass': {
          const p = pass.params
          const patternMap = { smooth: 0, frosted: 1, fluted: 2, rippled: 3, faceted: 4 }
          this.draw(
            pass.type,
            input,
            target,
            [p.refractionIndex, p.dispersion, p.roughness, p.blurRadius],
            pass,
            time,
            undefined,
            [p.frostIntensity, p.patternScale, patternMap[p.surfacePattern] ?? 1, p.bevelWidth],
            [p.tintOpacity, p.specularStrength, (p.lightAngle * Math.PI) / 180, 0],
            p.tintColor,
          )
          break
        }
        case 'procedural-grain': {
          const p = pass.params
          const noiseMap = { simplex: 0, perlin: 1, worley: 2, hash: 3 }
          this.draw(
            pass.type,
            input,
            target,
            [p.intensity, p.size, p.speed, p.frequency],
            pass,
            time,
            undefined,
            [Number(p.temporal), Number(p.monochrome), noiseMap[p.noiseType] ?? 0, p.turbulence],
            [p.octaves, 0, 0, 0],
          )
          break
        }
        case 'ambient-occlusion': {
          const p = pass.params
          this.draw(
            pass.type,
            input,
            target,
            [p.intensity, p.radius, p.bias, p.power],
            pass,
            time,
            undefined,
            undefined,
            undefined,
            p.color,
          )
          break
        }
      }
      input = target.texture
      index++
    }
    this.draw('copy', input, null)
    return true
  }

  private releaseTargets() {
    for (const target of this.targets) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer) }
    this.targets = []
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.releaseTargets()
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program)
    this.programs.clear()
    this.gl.deleteTexture(this.input)
    this.gl.deleteVertexArray(this.vao)
  }
}
