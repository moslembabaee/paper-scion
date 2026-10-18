import type { PaperProject } from '../io/project.ts'

export interface CloudUser {
  id: string
  email: string
  name: string
  avatar: string
  provider?: 'google' | 'github' | 'local'
  createdAt: number
  hasMcpToken: boolean
  tokenRotatedAt?: number
}
export interface CloudProject {
  id: string
  document: PaperProject
  revision: string
  updatedAt: number
  createdAt: number
  activity?: { ids: string[]; tool: string; until: number }
}
/** Stable serialization makes revisions independent of JSON property insertion order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
export function newer(a: Pick<CloudProject, 'updatedAt' | 'revision'>, b: Pick<CloudProject, 'updatedAt' | 'revision'>): boolean {
  return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.revision > b.revision)
}
