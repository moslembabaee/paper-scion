import type { FluidSimulationParams } from './types.ts'
import {
  advectionFragmentShader,
  baseVertexShader,
  displayFragmentShader,
  divergenceFragmentShader,
  gradientSubtractFragmentShader,
  jacobiPressureFragmentShader,
  splatFragmentShader,
  vorticityForceFragmentShader,
  vorticityFragmentShader,
} from './fluidShaders.ts'
import { parseColorToRgb } from './fluidSimulation.ts'

interface FBO {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
  attach: (id: number) => number
}

interface DoubleFBO {
  width: number
  height: number
  read: FBO
  write: FBO
  swap: () => void
}

interface ProgramInfo {
  program: WebGLProgram
  uniforms: Map<string, WebGLUniformLocation | null>
}

export class FluidSimulationEngine {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject

  // Double FBOs for simulation
  private density!: DoubleFBO
  private velocity!: DoubleFBO
  private pressure!: DoubleFBO
  private divergence!: FBO
  private curl!: FBO

  // Shader Programs
  private advectionProg!: ProgramInfo
  private divergenceProg!: ProgramInfo
  private jacobiProg!: ProgramInfo
  private gradientSubtractProg!: ProgramInfo
  private vorticityProg!: ProgramInfo
  private vorticityForceProg!: ProgramInfo
  private splatProg!: ProgramInfo
  private displayProg!: ProgramInfo

  private simWidth = 128
  private simHeight = 128
  private dyeWidth = 256
  private dyeHeight = 256

  private disposed = false
  private splatQueue: Array<{
    x: number
    y: number
    dx: number
    dy: number
    color: { r: number; g: number; b: number }
  }> = []

  private colorCycleIndex = 0

  constructor(canvas: HTMLCanvasElement, initialResolution = 128) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    if (!gl) {
      throw new Error('Fluid simulation requires WebGL 2 support.')
    }
    this.gl = gl

    // Check float texture support
    gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    this.simWidth = initialResolution
    this.simHeight = initialResolution
    this.dyeWidth = initialResolution * 2
    this.dyeHeight = initialResolution * 2

    this.initPrograms()
    this.initFramebuffers()
  }

  private createProgram(fragmentSource: string): ProgramInfo {
    const gl = this.gl
    const vertex = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vertex, baseVertexShader)
    gl.compileShader(vertex)
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(vertex)
      gl.deleteShader(vertex)
      throw new Error(`Fluid vertex compile error: ${err}`)
    }

    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fragment, fragmentSource)
    gl.compileShader(fragment)
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(fragment)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      throw new Error(`Fluid fragment compile error: ${err}`)
    }

    const program = gl.createProgram()!
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)

    gl.deleteShader(vertex)
    gl.deleteShader(fragment)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Fluid program link error: ${err}`)
    }

    return {
      program,
      uniforms: new Map(),
    }
  }

  private getUniform(info: ProgramInfo, name: string): WebGLUniformLocation | null {
    if (!info.uniforms.has(name)) {
      info.uniforms.set(name, this.gl.getUniformLocation(info.program, name))
    }
    return info.uniforms.get(name) ?? null
  }

  private initPrograms() {
    this.advectionProg = this.createProgram(advectionFragmentShader)
    this.divergenceProg = this.createProgram(divergenceFragmentShader)
    this.jacobiProg = this.createProgram(jacobiPressureFragmentShader)
    this.gradientSubtractProg = this.createProgram(gradientSubtractFragmentShader)
    this.vorticityProg = this.createProgram(vorticityFragmentShader)
    this.vorticityForceProg = this.createProgram(vorticityForceFragmentShader)
    this.splatProg = this.createProgram(splatFragmentShader)
    this.displayProg = this.createProgram(displayFragmentShader)
  }

  private createFBO(w: number, h: number, internalFormat = this.gl.RGBA16F, format = this.gl.RGBA, type = this.gl.HALF_FLOAT, filter = this.gl.LINEAR): FBO {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

    return {
      texture,
      framebuffer,
      width: w,
      height: h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      },
    }
  }

  private createDoubleFBO(w: number, h: number, internalFormat = this.gl.RGBA16F, format = this.gl.RGBA, type = this.gl.HALF_FLOAT, filter = this.gl.LINEAR): DoubleFBO {
    let fbo1 = this.createFBO(w, h, internalFormat, format, type, filter)
    let fbo2 = this.createFBO(w, h, internalFormat, format, type, filter)
    return {
      width: w,
      height: h,
      get read() { return fbo1 },
      set read(value) { fbo1 = value },
      get write() { return fbo2 },
      set write(value) { fbo2 = value },
      swap: () => {
        const temp = fbo1
        fbo1 = fbo2
        fbo2 = temp
      },
    }
  }

  private initFramebuffers() {
    this.density = this.createDoubleFBO(this.dyeWidth, this.dyeHeight)
    this.velocity = this.createDoubleFBO(this.simWidth, this.simHeight)
    this.pressure = this.createDoubleFBO(this.simWidth, this.simHeight)
    this.divergence = this.createFBO(this.simWidth, this.simHeight)
    this.curl = this.createFBO(this.simWidth, this.simHeight)
  }

  public addPointerImpulse(
    normX: number,
    normY: number,
    deltaX: number,
    deltaY: number,
    palette: readonly string[]
  ) {
    if (this.disposed) return
    const colors = palette.length > 0 ? palette : ['#81adec', '#edebe1', '#516b94', '#080808']
    const hex = colors[this.colorCycleIndex % colors.length]
    this.colorCycleIndex++
    const dyeColor = parseColorToRgb(hex)

    this.splatQueue.push({
      x: normX,
      y: normY,
      dx: deltaX,
      dy: deltaY,
      color: dyeColor,
    })
  }

  public addSplash(normX: number, normY: number, radius = 0.03, force = 3500, hexColor = '#81adec') {
    if (this.disposed) return
    const dyeColor = parseColorToRgb(hexColor)
    // Emit 4 radial impulses around the point
    const count = 6
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      this.splatQueue.push({
        x: normX + Math.cos(angle) * (radius * 0.4),
        y: normY + Math.sin(angle) * (radius * 0.4),
        dx: Math.cos(angle) * (force * 0.01),
        dy: Math.sin(angle) * (force * 0.01),
        color: dyeColor,
      })
    }
  }

  public clear() {
    if (this.disposed) return
    const gl = this.gl
    const clearFBO = (fbo: FBO) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer)
      gl.viewport(0, 0, fbo.width, fbo.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    clearFBO(this.density.read)
    clearFBO(this.density.write)
    clearFBO(this.velocity.read)
    clearFBO(this.velocity.write)
    clearFBO(this.pressure.read)
    clearFBO(this.pressure.write)
    clearFBO(this.divergence)
    clearFBO(this.curl)
  }

  private blit(target: FBO | null) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null)
    gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  public step(dt: number, params: FluidSimulationParams, time = 0) {
    if (this.disposed || this.gl.isContextLost()) return
    const gl = this.gl
    const clampedDt = Math.max(0.001, Math.min(0.033, dt))

    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)

    // 1. Vorticity Confinement
    if (params.curlStrength > 0) {
      gl.useProgram(this.vorticityProg.program)
      gl.uniform1i(this.getUniform(this.vorticityProg, 'u_velocity'), this.velocity.read.attach(0))
      gl.uniform2f(this.getUniform(this.vorticityProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)
      this.blit(this.curl)

      gl.useProgram(this.vorticityForceProg.program)
      gl.uniform1i(this.getUniform(this.vorticityForceProg, 'u_velocity'), this.velocity.read.attach(0))
      gl.uniform1i(this.getUniform(this.vorticityForceProg, 'u_curl'), this.curl.attach(1))
      gl.uniform2f(this.getUniform(this.vorticityForceProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)
      gl.uniform1f(this.getUniform(this.vorticityForceProg, 'u_curlStrength'), params.curlStrength)
      gl.uniform1f(this.getUniform(this.vorticityForceProg, 'u_dt'), clampedDt)
      this.blit(this.velocity.write)
      this.velocity.swap()
    }

    // 2. Velocity Advection (Semi-Lagrangian)
    gl.useProgram(this.advectionProg.program)
    gl.uniform1i(this.getUniform(this.advectionProg, 'u_velocity'), this.velocity.read.attach(0))
    gl.uniform1i(this.getUniform(this.advectionProg, 'u_source'), this.velocity.read.attach(0))
    gl.uniform2f(this.getUniform(this.advectionProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)
    gl.uniform1f(this.getUniform(this.advectionProg, 'u_dt'), clampedDt)
    gl.uniform1f(this.getUniform(this.advectionProg, 'u_dissipation'), params.velocityDissipation)
    this.blit(this.velocity.write)
    this.velocity.swap()

    // 3. Pointer Impulses & Splats
    // Also inject subtle ambient drift if idle
    if (this.splatQueue.length === 0 && params.ambientFlow > 0.01) {
      const ambX = 0.5 + Math.cos(time * 0.7) * 0.35
      const ambY = 0.5 + Math.sin(time * 0.9) * 0.35
      const forceX = -Math.sin(time * 0.9) * 80 * params.ambientFlow
      const forceY = Math.cos(time * 0.7) * 80 * params.ambientFlow
      const c = parseColorToRgb(params.dyeColors[0] ?? '#81adec')
      this.splatQueue.push({ x: ambX, y: ambY, dx: forceX, dy: forceY, color: c })
    }

    while (this.splatQueue.length > 0) {
      const splat = this.splatQueue.shift()!
      const aspect = this.canvas.width / Math.max(1, this.canvas.height)

      // Inject velocity impulse
      gl.useProgram(this.splatProg.program)
      gl.uniform1i(this.getUniform(this.splatProg, 'u_target'), this.velocity.read.attach(0))
      gl.uniform2f(this.getUniform(this.splatProg, 'u_point'), splat.x, splat.y)
      gl.uniform3f(this.getUniform(this.splatProg, 'u_color'), splat.dx * (params.splatForce * 0.001), splat.dy * (params.splatForce * 0.001), 0.0)
      gl.uniform1f(this.getUniform(this.splatProg, 'u_radius'), params.splatRadius)
      gl.uniform1f(this.getUniform(this.splatProg, 'u_aspect'), aspect)
      this.blit(this.velocity.write)
      this.velocity.swap()

      // Inject dye impulse
      gl.uniform1i(this.getUniform(this.splatProg, 'u_target'), this.density.read.attach(0))
      gl.uniform3f(this.getUniform(this.splatProg, 'u_color'), splat.color.r * 1.5, splat.color.g * 1.5, splat.color.b * 1.5)
      this.blit(this.density.write)
      this.density.swap()
    }

    // 4. Velocity Divergence
    gl.useProgram(this.divergenceProg.program)
    gl.uniform1i(this.getUniform(this.divergenceProg, 'u_velocity'), this.velocity.read.attach(0))
    gl.uniform2f(this.getUniform(this.divergenceProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)
    this.blit(this.divergence)

    // 5. Pressure Poisson Solver (Jacobi Iterations)
    gl.useProgram(this.jacobiProg.program)
    gl.uniform1i(this.getUniform(this.jacobiProg, 'u_divergence'), this.divergence.attach(1))
    gl.uniform2f(this.getUniform(this.jacobiProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)

    const iters = Math.max(4, Math.min(64, params.pressureIterations))
    for (let i = 0; i < iters; i++) {
      gl.uniform1i(this.getUniform(this.jacobiProg, 'u_pressure'), this.pressure.read.attach(0))
      this.blit(this.pressure.write)
      this.pressure.swap()
    }

    // 6. Divergence-Free Projection (Subtract Pressure Gradient)
    gl.useProgram(this.gradientSubtractProg.program)
    gl.uniform1i(this.getUniform(this.gradientSubtractProg, 'u_pressure'), this.pressure.read.attach(0))
    gl.uniform1i(this.getUniform(this.gradientSubtractProg, 'u_velocity'), this.velocity.read.attach(1))
    gl.uniform2f(this.getUniform(this.gradientSubtractProg, 'u_texelSize'), 1 / this.simWidth, 1 / this.simHeight)
    this.blit(this.velocity.write)
    this.velocity.swap()

    // 7. Dye Advection & Dissipation
    gl.useProgram(this.advectionProg.program)
    gl.uniform1i(this.getUniform(this.advectionProg, 'u_velocity'), this.velocity.read.attach(0))
    gl.uniform1i(this.getUniform(this.advectionProg, 'u_source'), this.density.read.attach(1))
    gl.uniform2f(this.getUniform(this.advectionProg, 'u_texelSize'), 1 / this.dyeWidth, 1 / this.dyeHeight)
    gl.uniform1f(this.getUniform(this.advectionProg, 'u_dt'), clampedDt)
    gl.uniform1f(this.getUniform(this.advectionProg, 'u_dissipation'), params.densityDissipation)
    this.blit(this.density.write)
    this.density.swap()

    // 8. Display Pass to Screen
    gl.useProgram(this.displayProg.program)
    gl.uniform1i(this.getUniform(this.displayProg, 'u_dye'), this.density.read.attach(0))
    gl.uniform1i(this.getUniform(this.displayProg, 'u_velocity'), this.velocity.read.attach(1))
    gl.uniform1i(this.getUniform(this.displayProg, 'u_pressure'), this.pressure.read.attach(2))
    gl.uniform2f(this.getUniform(this.displayProg, 'u_resolution'), this.canvas.width, this.canvas.height)
    gl.uniform2f(this.getUniform(this.displayProg, 'u_texelSize'), 1 / this.dyeWidth, 1 / this.dyeHeight)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_time'), time)

    gl.uniform1f(this.getUniform(this.displayProg, 'u_refractionIndex'), params.refractionIndex)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_dispersion'), params.dispersion)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_surfaceTension'), params.surfaceTension)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_normalPerturbation'), params.normalPerturbation)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_specularStrength'), params.specularStrength)
    gl.uniform1f(this.getUniform(this.displayProg, 'u_lightAngle'), params.lightAngle)

    const viewModeMap = {
      'fluid-composite': 0,
      'dye-only': 1,
      velocity: 2,
      pressure: 3,
      'normal-map': 4,
      'refraction-only': 5,
    }
    gl.uniform1i(this.getUniform(this.displayProg, 'u_viewMode'), viewModeMap[params.viewMode] ?? 0)

    const c1 = parseColorToRgb(params.dyeColors[0] ?? '#080808')
    const c2 = parseColorToRgb(params.dyeColors[1] ?? '#222222')
    const c3 = parseColorToRgb(params.dyeColors[2] ?? '#516b94')
    const c4 = parseColorToRgb(params.dyeColors[3] ?? '#81adec')
    gl.uniform3f(this.getUniform(this.displayProg, 'u_colorDye1'), c1.r, c1.g, c1.b)
    gl.uniform3f(this.getUniform(this.displayProg, 'u_colorDye2'), c2.r, c2.g, c2.b)
    gl.uniform3f(this.getUniform(this.displayProg, 'u_colorDye3'), c3.r, c3.g, c3.b)
    gl.uniform3f(this.getUniform(this.displayProg, 'u_colorDye4'), c4.r, c4.g, c4.b)

    this.blit(null)
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl

    const deleteFBO = (fbo: FBO) => {
      gl.deleteTexture(fbo.texture)
      gl.deleteFramebuffer(fbo.framebuffer)
    }

    deleteFBO(this.density.read)
    deleteFBO(this.density.write)
    deleteFBO(this.velocity.read)
    deleteFBO(this.velocity.write)
    deleteFBO(this.pressure.read)
    deleteFBO(this.pressure.write)
    deleteFBO(this.divergence)
    deleteFBO(this.curl)

    const progs = [
      this.advectionProg,
      this.divergenceProg,
      this.jacobiProg,
      this.gradientSubtractProg,
      this.vorticityProg,
      this.vorticityForceProg,
      this.splatProg,
      this.displayProg,
    ]
    for (const p of progs) {
      if (p?.program) gl.deleteProgram(p.program)
    }

    if (this.vao) gl.deleteVertexArray(this.vao)
  }
}
