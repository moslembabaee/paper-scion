import type { Bounds } from '../../canvas/types'
import type { SceneElement } from '../../scene/types'
import type { ShaderPaint } from '../../shaders/types'

export type CodeExportFormat = 'react' | 'svg' | 'glsl'

export type CodeExportTargetType =
  | 'selection'
  | 'element'
  | 'artboard'
  | 'canvas'
  | 'shader-surface'
  | 'background-shader'

export interface CodeExportTarget {
  readonly id: string
  readonly name: string
  readonly type: CodeExportTargetType
  readonly elementId?: string
  readonly node?: SceneElement
  readonly nodes?: readonly SceneElement[]
  readonly shader?: ShaderPaint
  readonly bounds: Bounds
  readonly childCount?: number
  readonly hasAnimation?: boolean
  readonly hasShader?: boolean
}

export interface ReactExportOptions {
  readonly styling: 'tailwind' | 'inline'
  readonly typescript: boolean
  readonly componentName: string
  readonly includeShader: boolean
  readonly extractSubcomponents: boolean
  readonly responsive: boolean
}

export interface SvgExportOptions {
  readonly mode: 'animated' | 'static'
  readonly animMode: 'both' | 'css' | 'smil'
  readonly loop: boolean
  readonly duration: number
  readonly fps: number
  readonly background: 'transparent' | 'cream' | 'dark'
  readonly pretty: boolean
}

export interface GlslExportOptions {
  readonly activeFile: 'fragment' | 'uniforms-json' | 'uniforms-ts' | 'runner-html' | 'package-json' | 'readme'
  readonly targetShader?: ShaderPaint
}

export interface ExportFileEntry {
  readonly name: string
  readonly content: string
  readonly language: 'typescript' | 'javascript' | 'html' | 'xml' | 'glsl' | 'json' | 'markdown'
  readonly description: string
  readonly isPrimary?: boolean
}

export interface GeneratedCodeBundle {
  readonly format: CodeExportFormat
  readonly target: CodeExportTarget
  readonly primaryFile: ExportFileEntry
  readonly files: readonly ExportFileEntry[]
  readonly stats: {
    readonly lines: number
    readonly chars: number
    readonly fileCount: number
    readonly nodeCount: number
    readonly hasShader: boolean
    readonly hasAnimation: boolean
    readonly summary: string
  }
}
