// Responsive preview breakpoints and device framing for Paper Make.
// Provides mobile, tablet, desktop, and fluid responsive presets.

export type PreviewDeviceViewport = 'responsive' | 'desktop' | 'tablet' | 'mobile'

export interface ViewportBreakpointConfig {
  readonly id: PreviewDeviceViewport
  readonly label: string
  readonly width: number | '100%'
  readonly height: number | '100%'
  readonly minWidth?: number
  readonly maxWidth?: number
  readonly description: string
}

export const PREVIEW_VIEWPORTS: Record<PreviewDeviceViewport, ViewportBreakpointConfig> = Object.freeze({
  responsive: {
    id: 'responsive',
    label: 'Responsive',
    width: '100%',
    height: '100%',
    description: 'Fluid preview expanding to fit canvas',
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    width: 1280,
    height: 800,
    description: 'Desktop widescreen breakpoint (1280px)',
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    width: 768,
    height: 1024,
    description: 'Tablet portrait breakpoint (768px)',
  },
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    width: 390,
    height: 844,
    description: 'Mobile device breakpoint (390px)',
  },
})

export function isValidDeviceViewport(viewport: unknown): viewport is PreviewDeviceViewport {
  return typeof viewport === 'string' && (viewport === 'responsive' || viewport === 'desktop' || viewport === 'tablet' || viewport === 'mobile')
}

export function getViewportConfig(viewport: PreviewDeviceViewport): ViewportBreakpointConfig {
  return PREVIEW_VIEWPORTS[viewport] ?? PREVIEW_VIEWPORTS.responsive
}

export function formatViewportDimensions(viewport: PreviewDeviceViewport): string {
  const config = getViewportConfig(viewport)
  if (config.id === 'responsive') return 'Fluid'
  return `${config.width} × ${config.height} px`
}

export interface ViewportOverflowCheck {
  readonly fitsInContainer: boolean
  readonly requiresHorizontalScroll: boolean
  readonly containerWidth: number
  readonly frameWidth: number
}

export function checkViewportOverflow(viewport: PreviewDeviceViewport, containerWidth: number): ViewportOverflowCheck {
  const config = getViewportConfig(viewport)
  const frameWidth = typeof config.width === 'number' ? config.width : containerWidth
  const fitsInContainer = containerWidth >= frameWidth
  return {
    fitsInContainer,
    requiresHorizontalScroll: !fitsInContainer,
    containerWidth,
    frameWidth,
  }
}
