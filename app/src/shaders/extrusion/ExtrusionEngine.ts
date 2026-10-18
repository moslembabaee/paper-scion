import { extrusionFragmentShader, extrusionUniforms, extrusionVertexShader } from './extrusionShaders.ts'
import type { ShapeGeometry, VectorExtrusionParams } from './types.ts'

/**
 * 2D Euclidean Distance Transform (separable O(W*H) algorithm).
 * Computes exact pixel distance from every interior pixel to the nearest boundary.
 */
function computeEuclideanDistanceTransform(
  mask: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const INF = 1e9
  const dist = new Float32Array(width * height)

  // Initialize: 0 for boundary/outside, INF for inside
  for (let i = 0; i < mask.length; i += 4) {
    const idx = i >> 2
    // Inside if alpha > 128
    dist[idx] = mask[i + 3] > 128 ? INF : 0
  }

  // Column pass (vertical 1D distance transform)
  for (let x = 0; x < width; x++) {
    // Top-down scan
    let d = INF
    for (let y = 0; y < height; y++) {
      const idx = y * width + x
      if (dist[idx] === 0) {
        d = 0
      } else if (d < INF) {
        d++
        dist[idx] = d * d
      }
    }
    // Bottom-up scan
    d = INF
    for (let y = height - 1; y >= 0; y--) {
      const idx = y * width + x
      if (dist[idx] === 0) {
        d = 0
      } else if (d < INF) {
        d++
        const dsq = d * d
        if (dsq < dist[idx]) {
          dist[idx] = dsq
        }
      }
    }
  }

  // Row pass (horizontal 1D squared distance transform using parabolic lower envelope)
  const f = new Float32Array(width)
  const v = new Int32Array(width)
  const z = new Float32Array(width + 1)
  const result = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      f[x] = dist[rowOffset + x]
    }

    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF

    for (let q = 1; q < width; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }

    k = 0
    for (let q = 0; q < width; q++) {
      while (z[k + 1] < q) {
        k++
      }
      const dx = q - v[k]
      const dsq = dx * dx + f[v[k]]
      result[rowOffset + q] = Math.sqrt(dsq)
    }
  }

  return result
}

export class ExtrusionEngine {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private shapeTexture: WebGLTexture | null = null
  private offscreenCanvas: HTMLCanvasElement | null = null
  private offscreenCtx: CanvasRenderingContext2D | null = null
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private disposed = false
  private currentShapeKey = ''

  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!gl) {
      throw new Error('WebGL 3D Extrusion requires WebGL 2 support')
    }
    this.gl = gl
    this.initProgram()
  }

  private initProgram() {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(`Extrusion shader compilation error: ${info}`)
      }
      return shader
    }

    const vs = compile(gl.VERTEX_SHADER, extrusionVertexShader)
    const fs = compile(gl.FRAGMENT_SHADER, extrusionFragmentShader)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Extrusion program link error: ${info}`)
    }

    gl.deleteShader(vs)
    gl.deleteShader(fs)

    this.program = program
    this.vao = gl.createVertexArray()!

    // Cache uniform locations
    const uniformNames = [
      'u_resolution',
      'u_hasShapeTexture',
      'u_shapeType',
      'u_shapeBounds',
      'u_cornerRadius',
      'u_extrusionDepth',
      'u_bevelDepth',
      'u_bevelWidth',
      'u_bevelProfile',
      'u_bevelSegments',
      'u_lightAzimuth',
      'u_lightElevation',
      'u_lightDistance',
      'u_lightIntensity',
      'u_lightColor',
      'u_ambientOcclusion',
      'u_aoRadius',
      'u_shadowSoftness',
      'u_shadowLength',
      'u_shadowOpacity',
      'u_roughness',
      'u_metallic',
      'u_baseColor',
      'u_sideColor',
      'u_specularIntensity',
      'u_normalMapStrength',
      'u_viewMode',
      'u_shapeTexture',
    ]

    for (const name of uniformNames) {
      this.uniforms.set(name, gl.getUniformLocation(program, name))
    }

    this.shapeTexture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.shapeTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Rasterize vector path / shape and upload Euclidean Distance Field into shapeTexture.
   */
  updateShapeGeometry(shape?: ShapeGeometry | null) {
    if (this.disposed || !this.gl || !this.shapeTexture) return
    const key = shape
      ? `${shape.type}-${shape.width}x${shape.height}-${shape.cornerRadius ?? 0}-${shape.d ?? ''}-${shape.textSvg ?? ''}`
      : 'none'

    if (key === this.currentShapeKey) return
    this.currentShapeKey = key

    if (!shape) {
      return
    }

    const texWidth = 256
    const texHeight = 256

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas')
      this.offscreenCanvas.width = texWidth
      this.offscreenCanvas.height = texHeight
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })
    }

    const ctx = this.offscreenCtx
    if (!ctx) return

    ctx.clearRect(0, 0, texWidth, texHeight)
    ctx.save()

    // Draw shape with white fill on transparent canvas
    ctx.fillStyle = '#ffffff'
    const scaleX = texWidth / Math.max(1, shape.width)
    const scaleY = texHeight / Math.max(1, shape.height)
    ctx.scale(scaleX, scaleY)

    if (shape.type === 'rectangle') {
      const cr = Math.min(shape.cornerRadius ?? 0, Math.min(shape.width, shape.height) / 2)
      if (cr > 0 && typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(0, 0, shape.width, shape.height, cr)
        ctx.fill()
      } else {
        ctx.fillRect(0, 0, shape.width, shape.height)
      }
    } else if (shape.type === 'ellipse') {
      ctx.beginPath()
      ctx.ellipse(shape.width / 2, shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (shape.type === 'path' && shape.d) {
      const path = new Path2D(shape.d)
      ctx.fill(path, shape.fillRule ?? 'nonzero')
    } else if (shape.type === 'text' && shape.textSvg) {
      // For text elements, render high-contrast glyph rasterization
      ctx.font = 'bold 64px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('PAPER', shape.width / 2, shape.height / 2)
    } else {
      ctx.fillRect(0, 0, shape.width, shape.height)
    }

    ctx.restore()

    // Compute EDT
    const imgData = ctx.getImageData(0, 0, texWidth, texHeight)
    const edt = computeEuclideanDistanceTransform(imgData.data, texWidth, texHeight)

    // Normalize EDT into [0..1] range
    let maxDist = 0
    for (let i = 0; i < edt.length; i++) {
      if (edt[i] > maxDist) maxDist = edt[i]
    }
    const invMax = maxDist > 0 ? 1 / maxDist : 1

    const packed = new Uint8Array(texWidth * texHeight * 4)
    for (let i = 0; i < edt.length; i++) {
      const pIdx = i * 4
      const alpha = imgData.data[pIdx + 3]
      const distNorm = Math.min(1.0, edt[i] * invMax)
      packed[pIdx] = Math.round(distNorm * 255) // R: distance field
      packed[pIdx + 1] = alpha // G: shape alpha
      packed[pIdx + 2] = alpha > 10 ? 255 : 0 // B: edge flag
      packed[pIdx + 3] = 255
    }

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.shapeTexture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      texWidth,
      texHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      packed
    )
  }

  render(params: VectorExtrusionParams, shape?: ShapeGeometry | null) {
    if (this.disposed || !this.gl || !this.program) return

    const gl = this.gl
    const width = this.canvas.width
    const height = this.canvas.height
    if (width <= 0 || height <= 0) return

    gl.viewport(0, 0, width, height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    const shapeType = shape?.type === 'ellipse' ? 1 : shape?.type === 'path' ? 2 : 0
    const cornerRadius = shape?.cornerRadius ?? 12
    const hasTexture = !!shape

    if (hasTexture) {
      this.updateShapeGeometry(shape)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.shapeTexture)
      const texLoc = this.uniforms.get('u_shapeTexture')
      if (texLoc !== undefined && texLoc !== null) {
        gl.uniform1i(texLoc, 0)
      }
    }

    const uniforms = extrusionUniforms(params, width, height, hasTexture, shapeType, cornerRadius)
    for (const [key, value] of Object.entries(uniforms)) {
      const loc = this.uniforms.get(key)
      if (loc === undefined || loc === null) continue
      if (typeof value === 'number') {
        gl.uniform1f(loc, value)
      } else if (typeof value === 'boolean') {
        gl.uniform1i(loc, value ? 1 : 0)
      } else if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(loc, value[0], value[1])
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2])
        else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3])
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    if (this.program) gl.deleteProgram(this.program)
    if (this.shapeTexture) gl.deleteTexture(this.shapeTexture)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.program = null
    this.shapeTexture = null
    this.vao = null
    this.offscreenCanvas = null
    this.offscreenCtx = null
  }
}
