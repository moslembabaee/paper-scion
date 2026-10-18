import type { ParticleSimulationParams } from './types.ts'
import {
  baseVertexShader,
  displayCompositeFragmentShader,
  particleRenderFragmentShader,
  particleRenderVertexShader,
  particleSimFragmentShader,
  particleUniforms,
  trailCompositeFragmentShader,
} from './particleShaders.ts'
import { calculateParticleTextureSize } from './particleSimulation.ts'

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

export class ParticleSimulationEngine {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject

  // Double FBOs for GPGPU particle physics
  private position!: DoubleFBO
  private velocity!: DoubleFBO
  private trails!: DoubleFBO
  private particleRenderFBO!: FBO

  // Shader Programs
  private simProg!: ProgramInfo
  private renderProg!: ProgramInfo
  private trailProg!: ProgramInfo
  private displayProg!: ProgramInfo

  private texWidth = 128
  private texHeight = 128
  private activeParticleCount = 16384

  private cursorX = 0.5
  private cursorY = 0.5
  private prevCursorX = 0.5
  private prevCursorY = 0.5
  private cursorVelX = 0.0
  private cursorVelY = 0.0
  private cursorActive = 0.0
  private cursorPressed = 0.0

  private lastTime = 0
  private disposed = false
  private animFrameId = 0
  private isPaused = false

  constructor(canvas: HTMLCanvasElement, initialParams: ParticleSimulationParams) {
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
      throw new Error('Particle simulation requires WebGL 2 support.')
    }
    this.gl = gl

    // Required WebGL2 extensions for float texture rendering
    gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    const texConfig = calculateParticleTextureSize(initialParams.particleCount)
    this.texWidth = texConfig.width
    this.texHeight = texConfig.height
    this.activeParticleCount = Math.min(initialParams.particleCount, texConfig.count)

    this.initPrograms()
    this.initBuffers()
    this.seedParticles()
  }

  private createProgram(vertexSrc: string, fragmentSrc: string): ProgramInfo {
    const gl = this.gl
    const vShader = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vShader, vertexSrc)
    gl.compileShader(vShader)
    if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(vShader)
      gl.deleteShader(vShader)
      throw new Error(`Vertex shader compilation failed: ${err}`)
    }

    const fShader = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fShader, fragmentSrc)
    gl.compileShader(fShader)
    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(fShader)
      gl.deleteShader(vShader)
      gl.deleteShader(fShader)
      throw new Error(`Fragment shader compilation failed: ${err}`)
    }

    const program = gl.createProgram()!
    gl.attachShader(program, vShader)
    gl.attachShader(program, fShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(program)
      throw new Error(`Program link failed: ${err}`)
    }

    gl.deleteShader(vShader)
    gl.deleteShader(fShader)

    return {
      program,
      uniforms: new Map(),
    }
  }

  private getUniformLocation(prog: ProgramInfo, name: string): WebGLUniformLocation | null {
    if (!prog.uniforms.has(name)) {
      const loc = this.gl.getUniformLocation(prog.program, name)
      prog.uniforms.set(name, loc)
    }
    return prog.uniforms.get(name) ?? null
  }

  private initPrograms() {
    this.simProg = this.createProgram(baseVertexShader, particleSimFragmentShader)
    this.renderProg = this.createProgram(particleRenderVertexShader, particleRenderFragmentShader)
    this.trailProg = this.createProgram(baseVertexShader, trailCompositeFragmentShader)
    this.displayProg = this.createProgram(baseVertexShader, displayCompositeFragmentShader)
  }

  private createFBO(width: number, height: number, internalFormat: number, format: number, type: number): FBO {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null)

    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    return {
      texture,
      framebuffer,
      width,
      height,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      },
    }
  }

  private createDoubleFBO(width: number, height: number, internalFormat: number, format: number, type: number): DoubleFBO {
    let fbo1 = this.createFBO(width, height, internalFormat, format, type)
    let fbo2 = this.createFBO(width, height, internalFormat, format, type)
    return {
      width,
      height,
      get read() {
        return fbo1
      },
      get write() {
        return fbo2
      },
      swap() {
        const tmp = fbo1
        fbo1 = fbo2
        fbo2 = tmp
      },
    }
  }

  private initBuffers() {
    const gl = this.gl
    const w = this.texWidth
    const h = this.texHeight

    // Position and Velocity FBOs use RGBA32F
    this.position = this.createDoubleFBO(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT)
    this.velocity = this.createDoubleFBO(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT)

    const dispWidth = Math.max(128, this.canvas.width || 512)
    const dispHeight = Math.max(128, this.canvas.height || 512)

    this.trails = this.createDoubleFBO(dispWidth, dispHeight, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    this.particleRenderFBO = this.createFBO(dispWidth, dispHeight, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
  }

  private seedParticles() {
    const gl = this.gl
    const w = this.texWidth
    const h = this.texHeight
    const total = w * h

    const posData = new Float32Array(total * 4)
    const velData = new Float32Array(total * 4)

    for (let i = 0; i < total; i++) {
      const idx = i * 4
      // Distributed initial position [0, 1]
      posData[idx + 0] = Math.random()
      posData[idx + 1] = Math.random()
      // Initial life staggered [0, 1]
      posData[idx + 2] = Math.random()
      // Particle mass [0.8, 1.4]
      posData[idx + 3] = 0.8 + Math.random() * 0.6

      // Initial velocity
      velData[idx + 0] = (Math.random() - 0.5) * 0.1
      velData[idx + 1] = (Math.random() - 0.5) * 0.1
      velData[idx + 2] = 0.0 // curl
      velData[idx + 3] = 0.0 // speed
    }

    gl.bindTexture(gl.TEXTURE_2D, this.position.read.texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, posData)

    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, velData)
  }

  setCursor(normX: number, normY: number, active: boolean, pressed: boolean) {
    this.prevCursorX = this.cursorX
    this.prevCursorY = this.cursorY
    this.cursorX = Math.max(0, Math.min(1, normX))
    this.cursorY = Math.max(0, Math.min(1, normY))
    this.cursorVelX = this.cursorX - this.prevCursorX
    this.cursorVelY = this.cursorY - this.prevCursorY
    this.cursorActive = active ? 1.0 : 0.0
    this.cursorPressed = pressed ? 1.0 : 0.0
  }

  triggerPulse(force = 5.0) {
    this.cursorPressed = Math.min(1.0, force / 5.0)
    setTimeout(() => {
      this.cursorPressed = 0.0
    }, 200)
  }

  resize(width: number, height: number) {
    const gl = this.gl
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const targetW = Math.max(128, Math.round(width * dpr))
    const targetH = Math.max(128, Math.round(height * dpr))

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW
      this.canvas.height = targetH

      // Reallocate trail and particle render buffers
      gl.deleteTexture(this.trails.read.texture)
      gl.deleteFramebuffer(this.trails.read.framebuffer)
      gl.deleteTexture(this.trails.write.texture)
      gl.deleteFramebuffer(this.trails.write.framebuffer)
      gl.deleteTexture(this.particleRenderFBO.texture)
      gl.deleteFramebuffer(this.particleRenderFBO.framebuffer)

      this.trails = this.createDoubleFBO(targetW, targetH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
      this.particleRenderFBO = this.createFBO(targetW, targetH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    }
  }

  setParticleCount(count: number) {
    const config = calculateParticleTextureSize(count)
    if (config.width !== this.texWidth || config.height !== this.texHeight) {
      this.texWidth = config.width
      this.texHeight = config.height
      this.activeParticleCount = Math.min(count, config.count)

      const gl = this.gl
      gl.deleteTexture(this.position.read.texture)
      gl.deleteFramebuffer(this.position.read.framebuffer)
      gl.deleteTexture(this.position.write.texture)
      gl.deleteFramebuffer(this.position.write.framebuffer)
      gl.deleteTexture(this.velocity.read.texture)
      gl.deleteFramebuffer(this.velocity.read.framebuffer)
      gl.deleteTexture(this.velocity.write.texture)
      gl.deleteFramebuffer(this.velocity.write.framebuffer)

      this.position = this.createDoubleFBO(this.texWidth, this.texHeight, gl.RGBA32F, gl.RGBA, gl.FLOAT)
      this.velocity = this.createDoubleFBO(this.texWidth, this.texHeight, gl.RGBA32F, gl.RGBA, gl.FLOAT)
      this.seedParticles()
    } else {
      this.activeParticleCount = Math.min(count, config.count)
    }
  }

  step(params: ParticleSimulationParams, currentTimeMs: number) {
    if (this.disposed || this.isPaused) return

    const gl = this.gl
    const dt = Math.min(0.033, this.lastTime > 0 ? (currentTimeMs - this.lastTime) * 0.001 : 0.016)
    this.lastTime = currentTimeMs
    const timeSec = currentTimeMs * 0.001

    if (params.particleCount !== this.activeParticleCount) {
      this.setParticleCount(params.particleCount)
    }

    const u = particleUniforms(params)

    // ==========================================
    // PASS 1: GPGPU Simulation (Update Positions & Velocities)
    // ==========================================
    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, this.texWidth, this.texHeight)
    gl.useProgram(this.simProg.program)

    // Bind inputs
    gl.uniform1i(this.getUniformLocation(this.simProg, 'u_position'), this.position.read.attach(0))
    gl.uniform1i(this.getUniformLocation(this.simProg, 'u_velocity'), this.velocity.read.attach(1))

    gl.uniform2f(this.getUniformLocation(this.simProg, 'u_cursor'), this.cursorX, 1.0 - this.cursorY)
    gl.uniform2f(this.getUniformLocation(this.simProg, 'u_cursorVelocity'), this.cursorVelX, -this.cursorVelY)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_cursorActive'), this.cursorActive)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_cursorPressed'), this.cursorPressed)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_dt'), dt)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_time'), timeSec)
    gl.uniform2f(this.getUniformLocation(this.simProg, 'u_resolution'), this.canvas.width, this.canvas.height)

    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_advectionSpeed'), u.u_advectionSpeed)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_curlStrength'), u.u_curlStrength)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_curlScale'), u.u_curlScale)
    gl.uniform1i(this.getUniformLocation(this.simProg, 'u_curlOctaves'), u.u_curlOctaves)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_velocityDamping'), u.u_velocityDamping)
    gl.uniform1i(this.getUniformLocation(this.simProg, 'u_magneticMode'), u.u_magneticMode)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_magneticForce'), u.u_magneticForce)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_magneticRadius'), u.u_magneticRadius)
    gl.uniform1i(this.getUniformLocation(this.simProg, 'u_magneticPolesCount'), u.u_magneticPolesCount)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_gridAlignment'), u.u_gridAlignment)
    gl.uniform1f(this.getUniformLocation(this.simProg, 'u_jitter'), u.u_jitter)

    // Render to write FBOs using MRT (Multiple Render Targets)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.position.write.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.position.write.texture, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.velocity.write.texture, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])

    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Reset draw buffers and detach attachment 1
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])

    this.position.swap()
    this.velocity.swap()

    // ==========================================
    // PASS 2: Particle Render (Point Sprites into particleRenderFBO)
    // ==========================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleRenderFBO.framebuffer)
    gl.viewport(0, 0, this.particleRenderFBO.width, this.particleRenderFBO.height)
    gl.clearColor(0.0, 0.0, 0.0, 0.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.useProgram(this.renderProg.program)
    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_position'), this.position.read.attach(0))
    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_velocity'), this.velocity.read.attach(1))
    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_texWidth'), this.texWidth)
    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_texHeight'), this.texHeight)
    gl.uniform1f(this.getUniformLocation(this.renderProg, 'u_particleSize'), u.u_particleSize * (window.devicePixelRatio || 1))
    gl.uniform1f(this.getUniformLocation(this.renderProg, 'u_time'), timeSec)
    gl.uniform2f(this.getUniformLocation(this.renderProg, 'u_resolution'), this.canvas.width, this.canvas.height)

    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_colorMode'), u.u_colorMode)
    gl.uniform1f(this.getUniformLocation(this.renderProg, 'u_glowIntensity'), u.u_glowIntensity)
    gl.uniform3fv(this.getUniformLocation(this.renderProg, 'u_palette'), u.u_palette)
    gl.uniform1i(this.getUniformLocation(this.renderProg, 'u_paletteCount'), u.u_paletteCount)

    // Render particles
    gl.drawArrays(gl.POINTS, 0, this.activeParticleCount)

    // ==========================================
    // PASS 3: Trail Persistence Composite (Accumulate with decay)
    // ==========================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trails.write.framebuffer)
    gl.viewport(0, 0, this.trails.write.width, this.trails.write.height)
    gl.disable(gl.BLEND)

    gl.useProgram(this.trailProg.program)
    gl.uniform1i(this.getUniformLocation(this.trailProg, 'u_prevTrail'), this.trails.read.attach(0))
    gl.uniform1i(this.getUniformLocation(this.trailProg, 'u_currentParticles'), this.particleRenderFBO.attach(1))
    gl.uniform1f(this.getUniformLocation(this.trailProg, 'u_trailDecay'), u.u_trailDecay)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.trails.swap()

    // ==========================================
    // PASS 4: Final Screen Display & Diagnostics Composite
    // ==========================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0.0, 0.0, 0.0, 0.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.displayProg.program)
    gl.uniform1i(this.getUniformLocation(this.displayProg, 'u_trails'), this.trails.read.attach(0))
    gl.uniform1i(this.getUniformLocation(this.displayProg, 'u_particles'), this.particleRenderFBO.attach(1))
    gl.uniform2f(this.getUniformLocation(this.displayProg, 'u_resolution'), this.canvas.width, this.canvas.height)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_time'), timeSec)
    gl.uniform1i(this.getUniformLocation(this.displayProg, 'u_viewMode'), u.u_viewMode)
    gl.uniform2f(this.getUniformLocation(this.displayProg, 'u_cursor'), this.cursorX, 1.0 - this.cursorY)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_cursorActive'), this.cursorActive)
    gl.uniform1i(this.getUniformLocation(this.displayProg, 'u_magneticMode'), u.u_magneticMode)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_magneticForce'), u.u_magneticForce)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_magneticRadius'), u.u_magneticRadius)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_curlStrength'), u.u_curlStrength)
    gl.uniform1f(this.getUniformLocation(this.displayProg, 'u_curlScale'), u.u_curlScale)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  setPaused(paused: boolean) {
    this.isPaused = paused
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.animFrameId)

    const gl = this.gl
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)

    const deleteDoubleFBO = (dfbo: DoubleFBO) => {
      gl.deleteTexture(dfbo.read.texture)
      gl.deleteFramebuffer(dfbo.read.framebuffer)
      gl.deleteTexture(dfbo.write.texture)
      gl.deleteFramebuffer(dfbo.write.framebuffer)
    }

    deleteDoubleFBO(this.position)
    deleteDoubleFBO(this.velocity)
    deleteDoubleFBO(this.trails)

    gl.deleteTexture(this.particleRenderFBO.texture)
    gl.deleteFramebuffer(this.particleRenderFBO.framebuffer)

    gl.deleteProgram(this.simProg.program)
    gl.deleteProgram(this.renderProg.program)
    gl.deleteProgram(this.trailProg.program)
    gl.deleteProgram(this.displayProg.program)
  }
}
