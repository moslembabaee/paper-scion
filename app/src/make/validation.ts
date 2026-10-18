import type { CompileDiagnostic, CompilePreviewAssets } from './compiler.ts'
import type { AppValidationAttempt, AppValidationReport } from './types.ts'

export const VALIDATION_LIMITS = Object.freeze({
  maxAttempts: 2,
  timeoutMs: 15_000,
  maxDiagnostics: 8,
  maxMessageChars: 500,
  maxScreenshotBytes: 12_000,
})

export interface ValidationScreenshot {
  viewport: 'desktop' | 'mobile'
  dataUrl: string
}

export interface BrowserValidation {
  status: AppValidationAttempt['status']
  diagnostics: CompileDiagnostic[]
  viewports: AppValidationAttempt['viewports']
  screenshots: ValidationScreenshot[]
}

export type AppBrowserValidator = (assets: CompilePreviewAssets, signal: AbortSignal) => Promise<BrowserValidation>

export function boundedDiagnostics(
  diagnostics: readonly CompileDiagnostic[],
  sanitize: (text: string) => string = text => text
): CompileDiagnostic[] {
  const scrub = (text: string, limit: number) => sanitize(text)
    .replace(/data:image\/[^\s"'<>]+/gi, '[image omitted]').slice(0, limit)
  return diagnostics.slice(0, VALIDATION_LIMITS.maxDiagnostics).map(d => ({
    file: scrub(d.file, 256),
    line: d.line,
    column: d.column,
    code: d.code,
    severity: d.severity,
    message: scrub(d.message, VALIDATION_LIMITS.maxMessageChars),
  }))
}

export function createValidationReport(
  attempts: readonly AppValidationAttempt[],
  status: AppValidationReport['status'] = 'passed',
  options?: { message?: string }
): AppValidationReport {
  const defaultMessage =
    status === 'passed'
      ? (attempts.length > 1
          ? 'Build and desktop/mobile render checks passed after repair. Interaction behavior still needs review.'
          : 'Build and desktop/mobile render checks passed. Interaction behavior still needs review.')
      : status === 'blocked'
        ? 'Validation blocked. The previous revision is unchanged.'
        : attempts.length >= VALIDATION_LIMITS.maxAttempts
          ? 'Validation failed after 2 candidates. Repair budget exhausted. The previous revision is unchanged.'
          : 'Validation failed. One repair attempt remains.'

  return {
    status,
    maxAttempts: VALIDATION_LIMITS.maxAttempts,
    attempts,
    message: options?.message ?? defaultMessage,
  }
}

export function formatValidationSummary(report: AppValidationReport): string {
  const current = report.attempts.length
  const max = report.maxAttempts
  if (report.status === 'passed') {
    return current > 1 ? `Repaired · ${current}/${max}` : `Validated · ${current}/${max}`
  }
  if (report.status === 'blocked') {
    return `Blocked · ${current}/${max}`
  }
  return `Failed · ${current}/${max}`
}

export function isValidationPassing(report?: AppValidationReport | null): boolean {
  return report?.status === 'passed'
}
