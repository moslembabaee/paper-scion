/**
 * Visual Shader Graph Node Editor Types
 * High-craft procedural shader creation with live WebGL compilation.
 */

export type ShaderPortType = 'float' | 'vec2' | 'vec3' | 'vec4'

export interface ShaderPort {
  readonly id: string
  readonly label: string
  readonly type: ShaderPortType
  readonly defaultValue?: number | number[] | string
  readonly description?: string
}

export type ShaderNodeCategory = 'uv' | 'noise' | 'color' | 'math' | 'output'

export interface ShaderNodeDefinition {
  readonly type: string
  readonly label: string
  readonly category: ShaderNodeCategory
  readonly description: string
  readonly inputs: readonly ShaderPort[]
  readonly outputs: readonly ShaderPort[]
  readonly defaultParams: Record<string, number | string | number[]>
  readonly icon?: string
}

export interface ShaderNode {
  readonly id: string
  readonly type: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly params: Record<string, number | string | number[]>
  readonly collapsed?: boolean
}

export interface ShaderConnection {
  readonly id: string
  readonly fromNodeId: string
  readonly fromPortId: string
  readonly toNodeId: string
  readonly toPortId: string
}

export interface ShaderGraphViewport {
  readonly panX: number
  readonly panY: number
  readonly zoom: number
}

export interface ShaderGraph {
  readonly version: 1
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly nodes: readonly ShaderNode[]
  readonly connections: readonly ShaderConnection[]
  readonly outputNodeId: string
  readonly viewport: ShaderGraphViewport
}

export interface ShaderGraphParams {
  readonly preset: string
  readonly graph: ShaderGraph
  readonly glsl?: string
}

export interface ShaderGraphCompilation {
  readonly glsl: string
  readonly uniforms: Record<string, number | number[] | string>
  readonly isValid: boolean
  readonly errors: readonly string[]
  readonly executionOrder: readonly string[]
}
