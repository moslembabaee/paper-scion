export type ExtrusionBevelProfile = 'linear' | 'curved' | 'convex' | 'concave' | 'stepped'

export const extrusionBevelProfiles: readonly ExtrusionBevelProfile[] = [
  'linear',
  'curved',
  'convex',
  'concave',
  'stepped',
] as const

export type ExtrusionViewMode = 'shaded' | 'normal-map' | 'depth' | 'ambient-occlusion' | 'lighting-only'

export const extrusionViewModes: readonly ExtrusionViewMode[] = [
  'shaded',
  'normal-map',
  'depth',
  'ambient-occlusion',
  'lighting-only',
] as const

export interface VectorExtrusionParams {
  /** 3D Extrusion height along the Z-axis (0 to 100). */
  readonly extrusionDepth: number
  /** Depth/height of the bevel slope (0 to 50). */
  readonly bevelDepth: number
  /** Inward width of the bevel boundary region (0 to 50). */
  readonly bevelWidth: number
  /** Bevel curvature profile (linear chamfer, curved fillet, convex dome, concave scoop, stepped terrace). */
  readonly bevelProfile: ExtrusionBevelProfile
  /** Number of discrete stepped terraces when using 'stepped' profile (2 to 16). */
  readonly bevelSegments: number
  /** Directional light horizontal rotation / azimuth angle in degrees (0 to 360). */
  readonly lightAzimuth: number
  /** Directional light altitude / elevation angle in degrees above canvas plane (5 to 90). */
  readonly lightElevation: number
  /** Distance reach / spread factor of light source (0.2 to 2.0). */
  readonly lightDistance: number
  /** Directional key light luminance multiplier (0 to 3.0). */
  readonly lightIntensity: number
  /** Directional light color tint (hex code e.g. #edebe1). */
  readonly lightColor: string
  /** Screen-space / boundary ambient occlusion darkening strength (0 to 1.0). */
  readonly ambientOcclusion: number
  /** Ambient occlusion kernel sampling radius (1 to 30). */
  readonly aoRadius: number
  /** Softness / penumbra blur of directional raymarched shadows (0 to 1.0). */
  readonly shadowSoftness: number
  /** Projection length of cast shadow behind extruded shapes (0 to 2.0). */
  readonly shadowLength: number
  /** Opacity / darkness of cast shadow (0 to 1.0). */
  readonly shadowOpacity: number
  /** Microfacet surface roughness for specular highlight spread (0 to 1.0). */
  readonly roughness: number
  /** Metallic reflectance vs dielectric albedo (0 to 1.0). */
  readonly metallic: number
  /** Top surface front face base color (hex code e.g. #81adec). */
  readonly baseColor: string
  /** Extrusion side wall tint color (hex code e.g. #1e2430). */
  readonly sideColor: string
  /** Specular highlight reflection intensity (0 to 2.0). */
  readonly specularIntensity: number
  /** Normal perturbation scale for surface bevel derivatives (0 to 3.0). */
  readonly normalMapStrength: number
  /** Diagnostic inspection view mode. */
  readonly viewMode: ExtrusionViewMode
}

export interface ShapeGeometry {
  readonly type: 'rectangle' | 'ellipse' | 'path' | 'text' | 'frame' | 'image'
  readonly width: number
  readonly height: number
  readonly cornerRadius?: number
  readonly d?: string
  readonly fillRule?: 'nonzero' | 'evenodd'
  readonly viewBox?: readonly [number, number, number, number]
  readonly textSvg?: string
}

export interface ExtrusionPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly params: VectorExtrusionParams
}
