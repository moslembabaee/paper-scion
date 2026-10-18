import type { ModelGatewayLimits } from './types.ts'

export const MODEL_GATEWAY_LIMITS: ModelGatewayLimits = {
  MAX_PROMPT_BYTES: 64 * 1024,
  MAX_REQUEST_BYTES: 128 * 1024,
  MAX_OUTPUT_TOKENS: 8192,
  MAX_OUTPUT_BYTES: 256 * 1024,
  DEFAULT_TIMEOUT_MS: 30_000,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 20,
  DEFAULT_ACCOUNT_TURN_BUDGET: 50,
  DEFAULT_ACCOUNT_TOKEN_BUDGET: 200_000,
}

export function redactSensitiveText(text: string, additionalSecrets: readonly string[] = []): string {
  if (!text) return ''
  let sanitized = text

  for (const secret of additionalSecrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      sanitized = sanitized.replaceAll(secret, '[REDACTED]')
    }
  }

  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
  sanitized = sanitized.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{30,40}/g, '[REDACTED]')
  sanitized = sanitized.replace(
    /(api[_-]?key|secret|token|password|authorization)([\s:=]+["']?)([A-Za-z0-9\-._~+/]{8,})(["']?)/gi,
    '$1$2[REDACTED]$4'
  )

  return sanitized
}

export function redactSensitiveObject<T>(value: T, additionalSecrets: readonly string[] = []): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return redactSensitiveText(value, additionalSecrets) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveObject(item, additionalSecrets)) as unknown as T
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (/key|secret|token|password|authorization/i.test(k) && typeof v === 'string') {
        result[k] = '[REDACTED]'
      } else {
        result[k] = redactSensitiveObject(v, additionalSecrets)
      }
    }
    return result as T
  }
  return value
}

