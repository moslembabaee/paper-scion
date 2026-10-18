// Public capability contract. Secret values belong only to owner provisioning requests.
export interface AppSecretHandle {
  readonly handle: string
  readonly capability: 'hmac-sha256'
  readonly version: number
  readonly status: 'active' | 'revoked'
}

export interface AppCapabilityRequest {
  readonly operation: 'hmac-sha256'
  readonly message: string
}
export interface AppCapabilityResult { readonly signature: string }
export interface AppCapabilities {
  invoke(handle: string, input: AppCapabilityRequest): Promise<AppCapabilityResult>
}
declare global {
  interface Window { readonly paperCapabilities?: AppCapabilities }
}

export const APP_SECRET_LIMITS = Object.freeze({ MAX_HANDLES: 64, MAX_VALUE_BYTES: 4096, MAX_MESSAGE_BYTES: 4096, MAX_REQUEST_BYTES: 16 * 1024 })
export const isSecretHandle = (value: unknown): value is string => typeof value === 'string' && /^sec_[A-Za-z0-9_-]{32}$/.test(value)

export function isCapabilityRequest(value: unknown): value is AppCapabilityRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return Object.keys(input).sort().join(',') === 'message,operation' && input.operation === 'hmac-sha256' &&
    typeof input.message === 'string' && new TextEncoder().encode(input.message).length <= APP_SECRET_LIMITS.MAX_MESSAGE_BYTES
}
