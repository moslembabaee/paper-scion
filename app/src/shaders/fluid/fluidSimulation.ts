import type { FluidColorMode, FluidSimulationParams, FluidViewMode } from './types.ts'

export interface FluidGrid2D {
  readonly width: number
  readonly height: number
  readonly u: Float32Array // Velocity X
  readonly v: Float32Array // Velocity Y
  readonly p: Float32Array // Pressure
  readonly div: Float32Array // Divergence
  readonly curl: Float32Array // Vorticity / Curl
  readonly dyeR: Float32Array // Dye Red channel [0, 1]
  readonly dyeG: Float32Array // Dye Green channel [0, 1]
  readonly dyeB: Float32Array // Dye Blue channel [0, 1]
}

export function createFluidGrid(width: number, height: number): FluidGrid2D {
  const size = width * height
  return {
    width,
    height,
    u: new Float32Array(size),
    v: new Float32Array(size),
    p: new Float32Array(size),
    div: new Float32Array(size),
    curl: new Float32Array(size),
    dyeR: new Float32Array(size),
    dyeG: new Float32Array(size),
    dyeB: new Float32Array(size),
  }
}

/**
 * Bilinear sampling of a 2D scalar field with boundary clamping.
 */
export function sampleBilinear(
  field: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const cx = Math.max(0, Math.min(width - 1, x))
  const cy = Math.max(0, Math.min(height - 1, y))

  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)

  const s = cx - x0
  const t = cy - y0

  const f00 = field[y0 * width + x0]
  const f10 = field[y0 * width + x1]
  const f01 = field[y1 * width + x0]
  const f11 = field[y1 * width + x1]

  const top = f00 * (1 - s) + f10 * s
  const bottom = f01 * (1 - s) + f11 * s
  return top * (1 - t) + bottom * t
}

/**
 * Semi-Lagrangian advection step for a 2D scalar or vector field.
 * Traces backwards along velocity vector: q(x, t + dt) = q(x - u*dt, t).
 */
export function advectField2D(
  targetField: Float32Array,
  sourceField: Float32Array,
  u: Float32Array,
  v: Float32Array,
  width: number,
  height: number,
  dt: number,
  dissipation = 1.0
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const velX = u[idx]
      const velY = v[idx]

      // Backtrace position
      const backX = x - velX * dt
      const backY = y - velY * dt

      targetField[idx] = sampleBilinear(sourceField, backX, backY, width, height) * dissipation
    }
  }
}

/**
 * Computes velocity divergence: div(u) = 0.5 * (u(x+1) - u(x-1) + v(y+1) - v(y-1)).
 */
export function computeDivergence2D(
  div: Float32Array,
  u: Float32Array,
  v: Float32Array,
  width: number,
  height: number
): void {
  for (let y = 0; y < height; y++) {
    const yT = y > 0 ? y - 1 : 0
    const yB = y < height - 1 ? y + 1 : height - 1

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      const uR = u[y * width + xR]
      const uL = u[y * width + xL]
      const vB = v[yB * width + x]
      const vT = v[yT * width + x]

      div[y * width + x] = 0.5 * (uR - uL + vB - vT)
    }
  }
}

/**
 * Jacobi iteration step for solving the pressure Poisson equation:
 * nabla^2 p = div(u)
 * p_new(x, y) = 0.25 * (p(x+1, y) + p(x-1, y) + p(x, y+1) + p(x, y-1) - div(x, y))
 */
export function solvePressurePoissonIteration2D(
  pNext: Float32Array,
  pCurrent: Float32Array,
  div: Float32Array,
  width: number,
  height: number
): void {
  for (let y = 0; y < height; y++) {
    const yT = y > 0 ? y - 1 : 0
    const yB = y < height - 1 ? y + 1 : height - 1

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      const pL = pCurrent[y * width + xL]
      const pR = pCurrent[y * width + xR]
      const pT = pCurrent[yT * width + x]
      const pB = pCurrent[yB * width + x]
      const d = div[y * width + x]

      pNext[y * width + x] = (pL + pR + pT + pB - d) * 0.25
    }
  }
}

/**
 * Full pressure Poisson solver running N Jacobi iterations.
 */
export function solvePressurePoisson2D(
  p: Float32Array,
  div: Float32Array,
  width: number,
  height: number,
  iterations = 24
): void {
  const tempP = new Float32Array(width * height)
  let current: Float32Array<ArrayBufferLike> = p
  let next: Float32Array<ArrayBufferLike> = tempP

  for (let it = 0; it < iterations; it++) {
    solvePressurePoissonIteration2D(next, current, div, width, height)
    // Swap buffers
    const swap = current
    current = next
    next = swap
  }

  // If final result is in tempP, copy back to p
  if (current !== p) {
    p.set(tempP)
  }
}

/**
 * Subtracts the pressure gradient from velocity to enforce incompressibility (nabla . u = 0):
 * u_new = u - 0.5 * (p(x+1) - p(x-1))
 * v_new = v - 0.5 * (p(y+1) - p(y-1))
 */
export function subtractPressureGradient2D(
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  width: number,
  height: number
): void {
  for (let y = 0; y < height; y++) {
    const yT = y > 0 ? y - 1 : 0
    const yB = y < height - 1 ? y + 1 : height - 1

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      const pL = p[y * width + xL]
      const pR = p[y * width + xR]
      const pT = p[yT * width + x]
      const pB = p[yB * width + x]

      const idx = y * width + x
      u[idx] -= 0.5 * (pR - pL)
      v[idx] -= 0.5 * (pB - pT)
    }
  }
}

/**
 * Computes 2D vorticity / curl:
 * curl = 0.5 * (dv/dx - du/dy)
 */
export function computeVorticity2D(
  curl: Float32Array,
  u: Float32Array,
  v: Float32Array,
  width: number,
  height: number
): void {
  for (let y = 0; y < height; y++) {
    const yT = y > 0 ? y - 1 : 0
    const yB = y < height - 1 ? y + 1 : height - 1

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      const dv_dx = 0.5 * (v[y * width + xR] - v[y * width + xL])
      const du_dy = 0.5 * (u[yB * width + x] - u[yT * width + x])

      curl[y * width + x] = dv_dx - du_dy
    }
  }
}

/**
 * Applies vorticity confinement force to preserve small turbulent swirls.
 */
export function applyVorticityConfinement2D(
  u: Float32Array,
  v: Float32Array,
  curl: Float32Array,
  width: number,
  height: number,
  curlStrength: number,
  dt: number
): void {
  if (curlStrength <= 0) return

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const cL = Math.abs(curl[y * width + (x - 1)])
      const cR = Math.abs(curl[y * width + (x + 1)])
      const cT = Math.abs(curl[(y - 1) * width + x])
      const cB = Math.abs(curl[(y + 1) * width + x])

      // Gradient of |curl|
      const dx = 0.5 * (cR - cL)
      const dy = 0.5 * (cB - cT)
      const len = Math.hypot(dx, dy) + 1e-5

      // Normalized vector N = (dx, dy) / len
      const Nx = dx / len
      const Ny = dy / len

      const omega = curl[y * width + x]
      // Force F = curlStrength * (N x omega * z_hat) = (Ny * omega, -Nx * omega)
      const fx = Ny * omega * curlStrength
      const fy = -Nx * omega * curlStrength

      const idx = y * width + x
      u[idx] += fx * dt
      v[idx] += fy * dt
    }
  }
}

/**
 * Injects a radial Gaussian impulse of velocity and dye at normalized position (normX, normY).
 */
export function applyImpulse2D(
  grid: FluidGrid2D,
  normX: number,
  normY: number,
  forceX: number,
  forceY: number,
  radius: number,
  dyeColor: { r: number; g: number; b: number }
): void {
  const { width, height, u, v, dyeR, dyeG, dyeB } = grid
  const centerX = normX * width
  const centerY = normY * height
  const pixelRadius = Math.max(1, radius * Math.min(width, height))
  const radiusSq = pixelRadius * pixelRadius

  const minX = Math.max(0, Math.floor(centerX - pixelRadius * 2))
  const maxX = Math.min(width - 1, Math.ceil(centerX + pixelRadius * 2))
  const minY = Math.max(0, Math.floor(centerY - pixelRadius * 2))
  const maxY = Math.min(height - 1, Math.ceil(centerY + pixelRadius * 2))

  for (let y = minY; y <= maxY; y++) {
    const dy = y - centerY
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX
      const distSq = dx * dx + dy * dy
      if (distSq > radiusSq * 4) continue

      const falloff = Math.exp(-distSq / radiusSq)
      const idx = y * width + x

      u[idx] += forceX * falloff
      v[idx] += forceY * falloff

      dyeR[idx] = Math.min(1.0, dyeR[idx] + dyeColor.r * falloff)
      dyeG[idx] = Math.min(1.0, dyeG[idx] + dyeColor.g * falloff)
      dyeB[idx] = Math.min(1.0, dyeB[idx] + dyeColor.b * falloff)
    }
  }
}

/**
 * Computes surface normal gradient at (x, y) based on dye concentration or wave height.
 * Returns normalized 3D normal vector [nx, ny, nz].
 */
export function computeSurfaceNormal2D(
  heightField: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number,
  bumpStrength = 1.0
): [number, number, number] {
  const xL = Math.max(0, x - 1)
  const xR = Math.min(width - 1, x + 1)
  const yT = Math.max(0, y - 1)
  const yB = Math.min(height - 1, y + 1)

  const hL = heightField[y * width + xL]
  const hR = heightField[y * width + xR]
  const hT = heightField[yT * width + x]
  const hB = heightField[yB * width + x]

  const dhdx = (hR - hL) * 0.5 * bumpStrength
  const dhdy = (hB - hT) * 0.5 * bumpStrength

  const nx = -dhdx
  const ny = -dhdy
  const nz = 1.0

  const len = Math.hypot(nx, ny, nz) || 1.0
  return [nx / len, ny / len, nz / len]
}

/**
 * Computes optical refraction ray offset and chromatic dispersion based on Snell's law.
 */
export function computeRefractionOffset(
  normal: [number, number, number],
  ior: number,
  dispersion: number
): {
  offsetR: [number, number]
  offsetG: [number, number]
  offsetB: [number, number]
} {
  const [nx, ny] = normal
  const refrScale = (ior - 1.0) * 0.25

  // Dispersion shifts IOR for red vs green vs blue
  const iorR = Math.max(1.0, ior - dispersion * 0.05)
  const iorG = ior
  const iorB = ior + dispersion * 0.05

  const scaleR = ((iorR - 1.0) / (iorG || 1.0)) * refrScale
  const scaleG = refrScale
  const scaleB = ((iorB - 1.0) / (iorG || 1.0)) * refrScale

  return {
    offsetR: [nx * scaleR, ny * scaleR],
    offsetG: [nx * scaleG, ny * scaleG],
    offsetB: [nx * scaleB, ny * scaleB],
  }
}

/**
 * Runs a complete discrete step of the 2D incompressible Navier-Stokes equations on CPU.
 */
export function stepFluidSimulationCPU(
  grid: FluidGrid2D,
  params: FluidSimulationParams,
  dt: number = 1 / 60
): void {
  const { width, height, u, v, p, div, curl, dyeR, dyeG, dyeB } = grid
  const tempU = new Float32Array(width * height)
  const tempV = new Float32Array(width * height)
  const tempDyeR = new Float32Array(width * height)
  const tempDyeG = new Float32Array(width * height)
  const tempDyeB = new Float32Array(width * height)

  // 1. Vorticity Confinement
  if (params.curlStrength > 0) {
    computeVorticity2D(curl, u, v, width, height)
    applyVorticityConfinement2D(u, v, curl, width, height, params.curlStrength, dt)
  }

  // 2. Velocity Advection (Semi-Lagrangian)
  advectField2D(tempU, u, u, v, width, height, dt, params.velocityDissipation)
  advectField2D(tempV, v, u, v, width, height, dt, params.velocityDissipation)
  u.set(tempU)
  v.set(tempV)

  // 3. Compute Divergence
  computeDivergence2D(div, u, v, width, height)

  // 4. Pressure Poisson Solver (Jacobi iterations)
  solvePressurePoisson2D(p, div, width, height, params.pressureIterations)

  // 5. Subtract Pressure Gradient (Projection to divergence-free field)
  subtractPressureGradient2D(u, v, p, width, height)

  // 6. Dye Advection & Dissipation
  advectField2D(tempDyeR, dyeR, u, v, width, height, dt, params.densityDissipation)
  advectField2D(tempDyeG, dyeG, u, v, width, height, dt, params.densityDissipation)
  advectField2D(tempDyeB, dyeB, u, v, width, height, dt, params.densityDissipation)
  dyeR.set(tempDyeR)
  dyeG.set(tempDyeG)
  dyeB.set(tempDyeB)
}

/**
 * Parses hex color '#rrggbb' into normalized RGB floats [0, 1].
 */
export function parseColorToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) / 255,
      g: parseInt(clean[1] + clean[1], 16) / 255,
      b: parseInt(clean[2] + clean[2], 16) / 255,
    }
  }
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  }
}

/**
 * Validates fluid simulation parameters.
 */
export function validateFluidParams(params: unknown): asserts params is FluidSimulationParams {
  if (!params || typeof params !== 'object') {
    throw new Error('Fluid parameters must be an object')
  }
  const p = params as Record<string, unknown>

  const checkNum = (key: string, min: number, max: number) => {
    const val = p[key]
    if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
      throw new Error(`Invalid fluid parameter ${key}: expected number between ${min} and ${max}`)
    }
  }

  checkNum('densityDissipation', 0.5, 1.0)
  checkNum('velocityDissipation', 0.5, 1.0)
  checkNum('pressureIterations', 4, 64)
  checkNum('viscosity', 0, 1)
  checkNum('curlStrength', 0, 50)
  checkNum('splatRadius', 0.005, 0.2)
  checkNum('splatForce', 10, 20000)
  checkNum('ambientFlow', 0, 2)
  checkNum('refractionIndex', 1.0, 2.5)
  checkNum('dispersion', 0, 1)
  checkNum('surfaceTension', 0, 1)
  checkNum('normalPerturbation', 0, 1)
  checkNum('specularStrength', 0, 2)
  checkNum('lightAngle', 0, 360)
  checkNum('gridResolution', 32, 512)

  if (!Array.isArray(p.dyeColors) || p.dyeColors.length < 1 || p.dyeColors.length > 16) {
    throw new Error('Fluid dyeColors must be an array of 1 to 16 hex colors')
  }
  for (const c of p.dyeColors) {
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/i.test(c)) {
      throw new Error(`Invalid dye color: ${String(c)}`)
    }
  }

  const validColorModes: FluidColorMode[] = ['palette', 'rainbow', 'monochrome', 'fire', 'velocity']
  if (typeof p.colorMode !== 'string' || !validColorModes.includes(p.colorMode as FluidColorMode)) {
    throw new Error(`Invalid fluid colorMode: ${String(p.colorMode)}`)
  }

  const validViewModes: FluidViewMode[] = [
    'fluid-composite',
    'dye-only',
    'velocity',
    'pressure',
    'normal-map',
    'refraction-only',
  ]
  if (typeof p.viewMode !== 'string' || !validViewModes.includes(p.viewMode as FluidViewMode)) {
    throw new Error(`Invalid fluid viewMode: ${String(p.viewMode)}`)
  }
}
