import type { FontKerningMode, OpenTypeFeatures, TextOnPath, TextTransform, VariableFontAxes } from '../scene/types.ts'

export type TokenType = 'color' | 'elevation' | 'radius' | 'spacing' | 'container' | 'breakpoint' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing'
export type DesignToken = {
  [T in TokenType]: Readonly<{ id: string; name: string; type: T; value: T extends 'color' | 'fontFamily' ? string : number; aliasId?: string; themeValues?: Readonly<Record<string, T extends 'color' | 'fontFamily' ? string : number>>; themeAliases?: Readonly<Record<string, string>>; palette?: string }>
}[TokenType]
export type TokenInput = DesignToken extends infer T ? T extends DesignToken ? Omit<T, 'id'> & { readonly id?: string } : never : never
export type TokenProperty = 'fill' | 'stroke' | 'shadow' | 'cornerRadius' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'x' | 'y' | 'width' | 'height'
export type TokenBindings = Readonly<Partial<Record<TokenProperty, string>>>

export interface DesignTheme { readonly id: string; readonly name: string }
export type LayerEffect = Readonly<{ id: string; enabled: boolean; type: 'drop-shadow' | 'inner-shadow'; color: string; colorTokenId?: string; x: number; y: number; blur: number; spread: number }> | Readonly<{ id: string; enabled: boolean; type: 'layer-blur'; blur: number }>
export interface TypographyPreset {
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: number
  readonly lineHeight: number
  readonly letterSpacing: number
  readonly textAlign: 'left' | 'center' | 'right'
  readonly variableAxes?: VariableFontAxes
  readonly openTypeFeatures?: OpenTypeFeatures
  readonly fontKerning?: FontKerningMode
  readonly opticalKerning?: number
  readonly textTransform?: TextTransform
  readonly textOnPath?: TextOnPath
  readonly tokenBindings?: TokenBindings
}
export type SharedStyle = Readonly<{ id: string; name: string }> & (
  { readonly kind: 'color'; readonly value: string; readonly tokenId?: string } |
  { readonly kind: 'typography'; readonly value: TypographyPreset } |
  { readonly kind: 'effects'; readonly value: readonly LayerEffect[] }
)
export type SharedStyleInput = SharedStyle extends infer T ? T extends SharedStyle ? Omit<T, 'id'> & { readonly id?: string } : never : never
export type SharedStyleKind = SharedStyle['kind']
export type SharedStyleBindings = Readonly<Partial<Record<SharedStyleKind, string>>>
export interface StyleLibrary {
  readonly themes: readonly DesignTheme[]
  readonly activeThemeId: string | null
  readonly styles: readonly SharedStyle[]
}
