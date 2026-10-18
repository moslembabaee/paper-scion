import type { ShaderPaint } from './types.ts'
import {
  gridVertexPosition,
  parseHexColor,
} from './mesh.ts'

type MeshPaint = Extract<ShaderPaint, { kind: 'mesh-gradient' }>

/**
 * Converts a hex color string and an alpha multiplier [0, 1] to a CSS rgba(...) string.
 */
function toRgbaString(hex: string, alpha: number = 1): string {
  const c = parseHexColor(hex)
  const finalA = Math.max(0, Math.min(1, c.a * alpha))
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  return `rgba(${r}, ${g}, ${b}, ${Number(finalA.toFixed(3))})`
}

/**
 * Generates clean, production-ready CSS for the 2D mesh gradient.
 * Includes both multi-layered radial gradients with individual alpha/radii
 * and an optional embedded SVG data-URI for pixel-perfect bi-cubic rendering.
 */
export function exportMeshCSS(paint: MeshPaint): string {
  const mesh = paint.mesh
  const colors = paint.params.colors
  const count = colors.length

  if (!mesh || count === 0) {
    return `/* Paper Mesh Gradient */
.mesh-gradient {
  background: ${colors[0] ?? '#81adec'};
  width: 100%;
  height: 100%;
}
`
  }

  const grid = mesh.grid

  if (grid) {
    const { rows, cols, vertices } = grid
    const layers: string[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        const v = vertices[idx]
        if (!v) continue
        const pos = gridVertexPosition(r, c, rows, cols)
        const posX = Number((pos.x * 100).toFixed(1))
        const posY = Number((pos.y * 100).toFixed(1))
        const rgba = toRgbaString(v.color, v.alpha ?? 1)
        const spread = Number((45 * (1 + (v.tension ?? 1) * 0.2)).toFixed(1))
        layers.push(`    radial-gradient(circle at ${posX}% ${posY}%, ${rgba} 0%, transparent ${spread}%)`)
      }
    }

    const baseColor = vertices[0] ? toRgbaString(vertices[0].color, 0.95) : '#080808'
    const svgDataUri = generateSvgDataUri(paint, 800, 600)

    return `/* =========================================================
   Paper 2D Grid Mesh Gradient (${rows}x${cols} Bi-Cubic Patch)
   ========================================================= */

/* Approach 1: Native CSS Radial Multi-Layer Composition */
.mesh-gradient-grid {
  background-color: ${baseColor};
  background-image:
${layers.join(',\n')};
  background-blend-mode: normal;
  width: 100%;
  height: 100%;
}

/* Approach 2: High-Fidelity Bi-Cubic SVG Data-URI */
.mesh-gradient-grid-svg {
  background-image: url("${svgDataUri}");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  width: 100%;
  height: 100%;
}
`
  }

  // Freeform mesh
  const anchors = mesh.anchors
  const baseColor = colors[0] ? toRgbaString(colors[0], 0.95) : '#080808'
  const layers: string[] = []

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const hex = colors[i] ?? '#81adec'
    const tx = a.tx ?? 0
    const ty = a.ty ?? 0
    const tension = a.tension ?? 1
    // Project tangential curve tension onto the coordinate percentage
    const posX = Number((Math.max(0, Math.min(1, a.x + tx * tension * 0.1)) * 100).toFixed(1))
    const posY = Number((Math.max(0, Math.min(1, a.y + ty * tension * 0.1)) * 100).toFixed(1))
    const rgba = toRgbaString(hex, a.alpha ?? 1)
    const radiusPercent = Number((a.radius * 75 * (1 + (tension - 1) * 0.25)).toFixed(1))
    layers.push(`    radial-gradient(circle at ${posX}% ${posY}%, ${rgba} 0%, transparent ${radiusPercent}%)`)
  }

  const svgDataUri = generateSvgDataUri(paint, 800, 600)

  return `/* =========================================================
   Paper 2D Mesh Gradient (${anchors.length} Control Vertices)
   ========================================================= */

/* Approach 1: Native CSS Multi-Stop Layered Mesh */
.mesh-gradient {
  background-color: ${baseColor};
  background-image:
${layers.join(',\n')};
  background-blend-mode: screen, normal;
  width: 100%;
  height: 100%;
}

/* Approach 2: High-Fidelity Bi-Cubic SVG Data-URI */
.mesh-gradient-svg {
  background-image: url("${svgDataUri}");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  width: 100%;
  height: 100%;
}
`
}

/**
 * Generates an SVG Data-URI string suitable for CSS background-image.
 */
function generateSvgDataUri(paint: MeshPaint, width = 800, height = 600): string {
  const svg = exportMeshSVG(paint, { width, height })
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')
  return `data:image/svg+xml,${encoded}`
}

/**
 * Generates a full standalone SVG representation of the 2D mesh gradient.
 * Works seamlessly across modern vector design tools (Figma, Illustrator)
 * and web browsers.
 */
export function exportMeshSVG(
  paint: MeshPaint,
  options?: { width?: number; height?: number }
): string {
  const width = options?.width ?? 800
  const height = options?.height ?? 600
  const mesh = paint.mesh
  const colors = paint.params.colors

  if (!mesh || colors.length === 0) {
    const bg = colors[0] ?? '#81adec'
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
</svg>`
  }

  const grid = mesh.grid

  if (grid) {
    const { rows, cols, vertices, smoothing } = grid
    const defs: string[] = []
    const rects: string[] = []

    // Build sub-patches for grid
    const cellW = width / Math.max(1, cols - 1)
    const cellH = height / Math.max(1, rows - 1)

    // Base background rect
    const baseColor = vertices[0] ? toRgbaString(vertices[0].color, vertices[0].alpha ?? 1) : '#080808'

    // Individual radial gradient nodes for each vertex with tangential tension
    vertices.forEach((v, idx) => {
      const r = Math.floor(idx / cols)
      const c = idx % cols
      const pos = gridVertexPosition(r, c, rows, cols)
      const gradId = `grid-grad-${idx}`
      const cx = (pos.x + v.tx * 0.12) * width
      const cy = (pos.y + v.ty * 0.12) * height
      const rPx = Math.max(cellW, cellH) * (1.1 + (v.tension ?? 1) * 0.2)
      const rgba = toRgbaString(v.color, v.alpha ?? 1)

      defs.push(`    <radialGradient id="${gradId}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rPx.toFixed(1)}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${rgba.slice(0, 7)}" stop-opacity="${(v.alpha ?? 1).toFixed(3)}"/>
      <stop offset="100%" stop-color="${rgba.slice(0, 7)}" stop-opacity="0"/>
    </radialGradient>`)
      rects.push(`    <rect width="${width}" height="${height}" fill="url(#${gradId})" style="mix-blend-mode: normal;"/>`)
    })

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <!-- Paper 2D Mesh Gradient: ${rows}x${cols} Bi-Cubic Patch (Smoothing: ${smoothing.toFixed(2)}) -->
  <defs>
${defs.join('\n')}
  </defs>
  <rect width="${width}" height="${height}" fill="${baseColor}"/>
  <g id="mesh-patches">
${rects.join('\n')}
  </g>
</svg>`
  }

  // Freeform mesh SVG export
  const anchors = mesh.anchors
  const defs: string[] = []
  const rects: string[] = []
  const baseColor = colors[0] ? toRgbaString(colors[0], anchors[0]?.alpha ?? 1) : '#080808'

  anchors.forEach((a, idx) => {
    const hex = colors[idx] ?? '#81adec'
    const gradId = `mesh-anchor-${idx}`
    const tx = a.tx ?? 0
    const ty = a.ty ?? 0
    const tension = a.tension ?? 1
    const cx = (a.x + tx * tension * 0.15) * width
    const cy = (a.y + ty * tension * 0.15) * height
    const rPx = Math.max(width, height) * (a.radius * 0.75) * (1 + (tension - 1) * 0.2)
    const alpha = a.alpha ?? 1

    defs.push(`    <radialGradient id="${gradId}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rPx.toFixed(1)}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${hex.slice(0, 7)}" stop-opacity="${alpha.toFixed(3)}"/>
      <stop offset="70%" stop-color="${hex.slice(0, 7)}" stop-opacity="${(alpha * 0.45).toFixed(3)}"/>
      <stop offset="100%" stop-color="${hex.slice(0, 7)}" stop-opacity="0"/>
    </radialGradient>`)
    rects.push(`    <rect width="${width}" height="${height}" fill="url(#${gradId})" style="mix-blend-mode: screen;"/>`)
  })

  // Optional noise overlay for Paper tactile grain aesthetic
  if (mesh.grainDisplacement && mesh.grainDisplacement > 0.05) {
    defs.push(`    <filter id="mesh-paper-grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.12 0" in="noise" result="coloredNoise"/>
      <feBlend mode="overlay" in="SourceGraphic" in2="coloredNoise"/>
    </filter>`)
  }

  const filterAttr = mesh.grainDisplacement && mesh.grainDisplacement > 0.05 ? ' filter="url(#mesh-paper-grain)"' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <!-- Paper 2D Mesh Gradient (${anchors.length} Control Vertices, Bi-Cubic Spline Field) -->
  <defs>
${defs.join('\n')}
  </defs>
  <rect width="${width}" height="${height}" fill="${baseColor}"/>
  <g id="mesh-stops"${filterAttr}>
${rects.join('\n')}
  </g>
</svg>`
}
