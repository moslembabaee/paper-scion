import type { ToolArguments } from './operations.ts'

export const BRIDGE_PATH = '/api/paper'
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:29979'
export interface AgentRequest { id: string; name: string; args: ToolArguments; expiresAt: number }
export interface AgentActivity { ids: readonly string[]; tool: string; until: number }
export interface BridgeRegistration { clientId: string; projectId: string; focused: boolean }
export interface ToolReply { result?: Record<string, unknown>; error?: string }
