// Host-only formatting: parse text in memory; never read or execute project files.
import ts from 'typescript'
import postcss from 'postcss'
import { APP_PROJECT_LIMITS, AppProjectValidationError, normalizeAndValidatePath } from '../src/make/manifest.ts'

export function formatSourceFile(rawPath: unknown, content: unknown): string {
  const path = normalizeAndValidatePath(rawPath)
  if (typeof content !== 'string' || Buffer.byteLength(content) > APP_PROJECT_LIMITS.MAX_FILE_BYTES) {
    throw new AppProjectValidationError('Source must be a string within the file size limit')
  }
  if (path.endsWith('.css')) {
    try {
      const root = postcss.parse(content, { from: path })
      root.walk(node => {
        let depth = 0
        for (let parent: postcss.Node | undefined = node.parent; parent && parent.type !== 'root'; parent = parent.parent) depth++
        node.raws.before = node === root.first ? '' : `\n${'  '.repeat(depth)}`
        if (node.type === 'decl') node.raws.between = ': '
        if (node.type === 'rule' || node.type === 'atrule' && node.nodes) {
          node.raws.between = ' '
          node.raws.after = `\n${'  '.repeat(depth)}`
          node.raws.semicolon = true
        }
      })
      root.raws.after = '\n'
      return root.toString()
    } catch (error) {
      throw new AppProjectValidationError(error instanceof Error ? error.message : 'Invalid CSS source')
    }
  }
  if (!/\.(?:tsx?|jsx?)$/.test(path)) throw new AppProjectValidationError('Formatting supports TSX, TS, JSX, JS and CSS files')
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, noLib: true }),
    getScriptFileNames: () => [path],
    getScriptVersion: () => '1',
    getScriptSnapshot: name => name === path ? ts.ScriptSnapshot.fromString(content) : undefined,
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => '',
    fileExists: name => name === path,
    readFile: name => name === path ? content : undefined,
  }
  const service = ts.createLanguageService(host)
  try {
    const diagnostic = service.getSyntacticDiagnostics(path)[0]
    if (diagnostic) throw new AppProjectValidationError(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    const edits = service.getFormattingEditsForDocument(path, {
      indentSize: 2, tabSize: 2, convertTabsToSpaces: true, newLineCharacter: '\n',
      insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true,
      insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true,
      insertSpaceBeforeFunctionParenthesis: false, insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
      placeOpenBraceOnNewLineForFunctions: false, placeOpenBraceOnNewLineForControlBlocks: false,
    })
    let formatted = content
    for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) {
      formatted = formatted.slice(0, edit.span.start) + edit.newText + formatted.slice(edit.span.start + edit.span.length)
    }
    return formatted.endsWith('\n') ? formatted : `${formatted}\n`
  } finally {
    service.dispose()
  }
}
