import type { CloudProject, CloudUser } from './model.ts'

export interface CloudSession { user: CloudUser | null; providers: { google: boolean; github: boolean } }
export class ApiError extends Error {
  status: number
  current?: CloudProject | null
  constructor(status: number, message: string, current?: CloudProject | null) { super(message); this.status = status; this.current = current }
}
export async function api<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10_000, ...init } = options
  const response = await fetch(`/api${path}`, {
    ...init, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Paper-Client': 'web', ...options.headers },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError(503, 'Cloud is unavailable on this host')
  const value = await response.json()
  if (!response.ok) throw new ApiError(response.status, value.error ?? 'Cloud request failed', value.current)
  return value as T
}
