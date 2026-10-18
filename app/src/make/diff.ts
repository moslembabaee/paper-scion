import type { AppSourceFile } from './types.ts'

export type DiffLineType = 'add' | 'delete' | 'context'

export interface DiffLine {
  readonly type: DiffLineType
  readonly text: string
  readonly oldLineNumber?: number
  readonly newLineNumber?: number
}

export type FileDiffAction = 'modify' | 'create' | 'delete'

export interface FileDiff {
  readonly path: string
  readonly action: FileDiffAction
  readonly additions: number
  readonly deletions: number
  readonly lines: readonly DiffLine[]
  readonly truncated?: boolean
}

export interface BoundedDiff {
  readonly baseRevision: number
  readonly targetRevision?: number
  readonly files: readonly FileDiff[]
  readonly totalAdditions: number
  readonly totalDeletions: number
  readonly changedFilesCount: number
  readonly truncated?: boolean
}

export interface DiffOptions {
  readonly maxDiffLinesPerFile?: number
  readonly maxTotalDiffLines?: number
  readonly maxDiffBytes?: number
  readonly contextLines?: number
}

export const DIFF_LIMITS = Object.freeze({
  MAX_FILE_DIFF_LINES: 500,
  MAX_TOTAL_DIFF_LINES: 2000,
  MAX_DIFF_BYTES: 64 * 1024, // 64 KiB
  DEFAULT_CONTEXT_LINES: 3,
})

const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).byteLength
const limit = (value: number | undefined, maximum: number) =>
  value === undefined || !Number.isFinite(value) ? maximum : Math.max(0, Math.min(maximum, Math.floor(value)))

function extractContent(file: AppSourceFile | string | undefined): string | undefined {
  return typeof file === 'string' ? file : file?.content
}

// Bound LCS work independently of display limits. Large replacements use a
// linear script, including the zero-length side case.
function* editScript(a: string[], b: string[], offset: number): Generator<DiffLine> {
  if (!a.length || !b.length || a.length * b.length > 250_000) {
    for (let i = 0; i < a.length; i++) yield { type: 'delete', text: a[i], oldLineNumber: offset + i + 1 }
    for (let i = 0; i < b.length; i++) yield { type: 'add', text: b[i], newLineNumber: offset + i + 1 }
    return
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    dp[i + 1][j + 1] = a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i][j + 1], dp[i + 1][j])
  }
  const script: DiffLine[] = []
  let i = a.length, j = b.length
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1]) {
      script.push({ type: 'context', text: a[i - 1], oldLineNumber: offset + i, newLineNumber: offset + j })
      i--; j--
    } else if (j && (!i || dp[i][j - 1] >= dp[i - 1][j])) {
      script.push({ type: 'add', text: b[j - 1], newLineNumber: offset + j-- })
    } else {
      script.push({ type: 'delete', text: a[i - 1], oldLineNumber: offset + i-- })
    }
  }
  yield* script.reverse()
}

/** Display is bounded; totals describe the complete edit, even if clipped. */
export function computeFileDiff(
  path: string, oldContent?: string, newContent?: string, options: DiffOptions = {},
): FileDiff | null {
  if (oldContent === newContent) return null
  const a = oldContent === undefined ? [] : oldContent.split(/\r?\n/)
  const b = newContent === undefined ? [] : newContent.split(/\r?\n/)
  let start = 0, aEnd = a.length, bEnd = b.length
  while (start < aEnd && start < bEnd && a[start] === b[start]) start++
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd-- }
  const context = limit(options.contextLines, DIFF_LIMITS.DEFAULT_CONTEXT_LINES)
  const maxLines = limit(options.maxDiffLinesPerFile, DIFF_LIMITS.MAX_FILE_DIFF_LINES)
  const maxBytes = limit(options.maxDiffBytes, DIFF_LIMITS.MAX_DIFF_BYTES)
  const lines: DiffLine[] = []
  let additions = 0, deletions = 0, size = 0, truncated = false
  const emit = (line: DiffLine) => {
    if (line.type === 'add') additions++
    if (line.type === 'delete') deletions++
    if (truncated) return
    const cost = bytes(line.text + '\n')
    if (lines.length >= maxLines || size + cost > maxBytes) { truncated = true; return }
    lines.push(line)
    size += cost
  }
  for (let i = Math.max(0, start - context); i < start; i++) {
    emit({ type: 'context', text: a[i], oldLineNumber: i + 1, newLineNumber: i + 1 })
  }
  for (const line of editScript(a.slice(start, aEnd), b.slice(start, bEnd), start)) emit(line)
  for (let i = aEnd; i < Math.min(a.length, aEnd + context); i++) {
    emit({ type: 'context', text: a[i], oldLineNumber: i + 1, newLineNumber: bEnd + i - aEnd + 1 })
  }
  return { path, action: oldContent === undefined ? 'create' : newContent === undefined ? 'delete' : 'modify', additions, deletions, lines, truncated }
}

export function computeBoundedDiff(
  oldFiles: Record<string, AppSourceFile | string>, newFiles: Record<string, AppSourceFile | string>,
  options: DiffOptions & { baseRevision?: number; targetRevision?: number } = {},
): BoundedDiff {
  const maxLines = limit(options.maxTotalDiffLines, DIFF_LIMITS.MAX_TOTAL_DIFF_LINES)
  const maxBytes = limit(options.maxDiffBytes, DIFF_LIMITS.MAX_DIFF_BYTES)
  const files: FileDiff[] = []
  let totalAdditions = 0, totalDeletions = 0, lineCount = 0, size = 0, truncated = false
  for (const path of [...new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)])].sort()) {
    const diff = computeFileDiff(path, extractContent(oldFiles[path]), extractContent(newFiles[path]), {
      ...options,
      maxDiffLinesPerFile: Math.min(limit(options.maxDiffLinesPerFile, DIFF_LIMITS.MAX_FILE_DIFF_LINES), maxLines - lineCount),
      maxDiffBytes: maxBytes - size,
    })
    if (!diff) continue
    files.push(diff)
    totalAdditions += diff.additions
    totalDeletions += diff.deletions
    lineCount += diff.lines.length
    size += diff.lines.reduce((n, line) => n + bytes(line.text + '\n'), 0)
    truncated ||= !!diff.truncated
  }
  return { baseRevision: options.baseRevision ?? 0, targetRevision: options.targetRevision, files,
    totalAdditions, totalDeletions, changedFilesCount: files.length, truncated }
}

/**
 * Formats a FileDiff or BoundedDiff as unified diff text.
 */
export function formatUnifiedDiff(diff: BoundedDiff | FileDiff): string {
  if ('files' in diff) {
    return diff.files.map(f => formatUnifiedDiff(f)).join('\n\n')
  }

  const header = `--- a/${diff.path}\n+++ b/${diff.path}`
  const body = diff.lines.map(line => {
    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '
    return `${prefix}${line.text}`
  }).join('\n')

  return `${header}\n${body}`
}
