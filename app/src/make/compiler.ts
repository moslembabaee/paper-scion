import { exportAppPackage, createFontFacesCss, type AppAssetExportRecord } from './assets.ts'
// Host-only compiler. Generated modules are transformed as text and never executed here.
import ts from 'typescript'
import postcss from 'postcss'
import { DEFAULT_ALLOWED_PACKAGES, getPreviewRuntime } from './compiler-runtime.ts'
export { DEFAULT_ALLOWED_PACKAGES } from './compiler-runtime.ts'
import type { AppProject } from './types.ts'
import { APP_PROJECT_LIMITS, normalizeAndValidatePath } from './manifest.ts'
import { generatePreviewHtml } from './preview-sandbox.ts'

export type CompileDiagnosticSeverity = 'error' | 'warning'

export type CompileDiagnosticCode =
  | 'DENIED_IMPORT'
  | 'DYNAMIC_IMPORT_FORBIDDEN'
  | 'FORBIDDEN_CALL'
  | 'SYNTAX_ERROR'
  | 'OVERSIZED_SOURCE'
  | 'MISSING_ENTRY_POINT'
  | 'MODULE_NOT_FOUND'
  | 'FORBIDDEN_CSS_IMPORT'
  | 'INVALID_INPUT'
  | 'RUNTIME_ERROR'
  | 'VISUAL_ERROR'
  | 'VALIDATION_BLOCKED'

export interface CompileDiagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly message: string
  readonly severity: CompileDiagnosticSeverity
  readonly code: CompileDiagnosticCode
}

export interface CompiledModule {
  readonly path: string
  readonly code: string
  readonly imports: readonly string[]
  readonly isCss?: boolean
}

export interface CompileStats {
  readonly moduleCount: number
  readonly totalInputBytes: number
  readonly totalOutputBytes: number
  readonly durationMs: number
}

export interface CompilePreviewAssets {
  readonly entryPoint: string
  readonly js: string
  readonly css: string
  readonly html: string
}

export interface CompileResult {
  readonly success: boolean
  readonly entryPoint: string
  readonly diagnostics: readonly CompileDiagnostic[]
  readonly assets: CompilePreviewAssets | null
  readonly modules: Record<string, CompiledModule>
  readonly stats: CompileStats
}

export interface CompileOptions {
  readonly entryPoint?: string
  readonly allowlist?: readonly string[]
  readonly maxFileBytes?: number
  readonly maxTotalBytes?: number
}

export const APP_COMPILER_LIMITS = Object.freeze({
  MAX_FILE_BYTES: APP_PROJECT_LIMITS.MAX_FILE_BYTES, // 512 KiB
  MAX_TOTAL_FILES_BYTES: APP_PROJECT_LIMITS.MAX_TOTAL_FILES_BYTES, // 2 MiB
  MAX_FILES_COUNT: APP_PROJECT_LIMITS.MAX_FILES_COUNT, // 100 files
  MAX_RECURSION_DEPTH: 128,
})

function isAllowedPackage(specifier: string, allowlist: readonly string[] = DEFAULT_ALLOWED_PACKAGES): boolean {
  return allowlist.includes(specifier)
}

function normalizePosixPath(rawPath: string): string {
  const parts = rawPath.replace(/\\/g, '/').split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop()
      } else {
        resolved.push('..')
      }
    } else {
      resolved.push(part)
    }
  }
  return resolved.join('/')
}

function getDirectoryName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  availablePaths: Set<string>
): { resolvedPath?: string; error?: string } {
  const dir = getDirectoryName(fromFile)
  const combined = dir ? `${dir}/${specifier}` : specifier
  const normalized = normalizePosixPath(combined)

  if (normalized.startsWith('../') || normalized === '..') {
    return { error: `Import "${specifier}" attempts path traversal outside project root` }
  }

  // Exact match
  if (availablePaths.has(normalized)) {
    return { resolvedPath: normalized }
  }

  // File extension candidates
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json']
  for (const ext of extensions) {
    const candidate = `${normalized}${ext}`
    if (availablePaths.has(candidate)) {
      return { resolvedPath: candidate }
    }
  }

  // Directory index candidates
  for (const ext of extensions) {
    const candidate = `${normalized}/index${ext}`
    if (availablePaths.has(candidate)) {
      return { resolvedPath: candidate }
    }
  }

  return {}
}

function validateCss(filePath: string, cssContent: string): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = []
  try {
    const root = postcss.parse(cssContent, { from: filePath })
    const decode = (text: string) => text.replace(/\\([a-f0-9]{1,6}\s?|.)/gi, (_match, escape: string) =>
      /^[a-f0-9]/i.test(escape) ? String.fromCodePoint(parseInt(escape.trim(), 16) || 0xfffd) : escape)
    root.walkAtRules(rule => {
      if (decode(rule.name).toLowerCase() === 'import') {
        diagnostics.push({ file: filePath, line: rule.source?.start?.line ?? 1, column: rule.source?.start?.column ?? 1,
          message: 'CSS @import is forbidden; import local CSS from a source module instead', severity: 'error', code: 'FORBIDDEN_CSS_IMPORT' })
      }
    })
  } catch (error) {
    const err = error as { line?: number; column?: number; reason?: string }
    diagnostics.push({ file: filePath, line: err.line ?? 1, column: err.column ?? 1,
      message: err.reason ?? 'Invalid CSS', severity: 'error', code: 'SYNTAX_ERROR' })
  }
  return diagnostics
}

interface AnalyzedFile {
  readonly path: string
  readonly source: string
  readonly isCss: boolean
  readonly isJson: boolean
  readonly imports: readonly {
    readonly specifier: string
    readonly line: number
    readonly column: number
  }[]
  readonly resolvedImports: Record<string, string>
}

function analyzeSourceFile(
  filePath: string,
  content: string,
  availablePaths: Set<string>,
  allowlist: readonly string[]
): { analyzed?: AnalyzedFile; diagnostics: CompileDiagnostic[] } {
  const diagnostics: CompileDiagnostic[] = []

  if (filePath.endsWith('.css')) {
    diagnostics.push(...validateCss(filePath, content))
    return {
      analyzed: {
        path: filePath,
        source: content,
        isCss: true,
        isJson: false,
        imports: [],
        resolvedImports: {},
      },
      diagnostics,
    }
  }

  if (filePath.endsWith('.json')) {
    try {
      JSON.parse(content)
      return {
        analyzed: {
          path: filePath,
          source: content,
          isCss: false,
          isJson: true,
          imports: [],
          resolvedImports: {},
        },
        diagnostics: [],
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON'
      diagnostics.push({
        file: filePath,
        line: 1,
        column: 1,
        message: `JSON syntax error: ${msg}`,
        severity: 'error',
        code: 'SYNTAX_ERROR',
      })
      return { diagnostics }
    }
  }

  // TS / TSX / JS analysis using TypeScript AST
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : filePath.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS

  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)

  // Report syntax / parse diagnostics from TypeScript
  const parseDiags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics || []
  for (const diag of parseDiags) {
    const start = diag.start ?? 0
    const { line, character } = sf.getLineAndCharacterOfPosition(start)
    const msg = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText
    diagnostics.push({
      file: filePath,
      line: line + 1,
      column: character + 1,
      message: msg,
      severity: 'error',
      code: 'SYNTAX_ERROR',
    })
  }

  const pragma = /@jsx(?:ImportSource|Runtime|Frag)?\b/.exec(content)
  if (pragma) {
    const position = sf.getLineAndCharacterOfPosition(pragma.index)
    diagnostics.push({ file: filePath, line: position.line + 1, column: position.character + 1,
      message: 'JSX runtime overrides are forbidden; Paper supplies the React runtime', severity: 'error', code: 'DENIED_IMPORT' })
  }

  const rawImports: {
    specifier: string
    line: number
    column: number
  }[] = []

  function visit(node: ts.Node, depth = 0): void {
    if (depth > APP_COMPILER_LIMITS.MAX_RECURSION_DEPTH) throw new Error('Source nesting exceeds compiler limit')
    if (ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) || ts.isMetaProperty(node)) {
      const position = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      diagnostics.push({ file: filePath, line: position.line + 1, column: position.character + 1,
        message: 'Only static ES module import/export declarations are supported', severity: 'error', code: 'DENIED_IMPORT' })
    }
    // Check static import declarations: import ... from '...'
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        const { line, character } = sf.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sf))
        rawImports.push({
          specifier,
          line: line + 1,
          column: character + 1,
        })
      }
    }

    // Check static export declarations: export ... from '...'
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        const { line, character } = sf.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sf))
        rawImports.push({
          specifier,
          line: line + 1,
          column: character + 1,
        })
      }
    }

    // Check call expressions: dynamic import(), eval(), Function(), require()
    if (ts.isCallExpression(node)) {
      // Dynamic import: import(...)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message: 'Dynamic imports are not permitted in sandboxed preview',
          severity: 'error',
          code: 'DYNAMIC_IMPORT_FORBIDDEN',
        })
      }

      // Forbidden dynamic code execution: eval(...)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message: 'eval() is forbidden in sandboxed preview',
          severity: 'error',
          code: 'FORBIDDEN_CALL',
        })
      }

      // Forbidden constructor: Function(...)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message: 'Function constructor is forbidden in sandboxed preview',
          severity: 'error',
          code: 'FORBIDDEN_CALL',
        })
      }

      // Forbidden require(...)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message: 'require() calls are forbidden in static modules',
          severity: 'error',
          code: 'FORBIDDEN_CALL',
        })
      }
    }

    // Check new Function(...)
    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message: 'new Function() is forbidden in sandboxed preview',
          severity: 'error',
          code: 'FORBIDDEN_CALL',
        })
      }
    }

    ts.forEachChild(node, child => visit(child, depth + 1))
  }

  visit(sf)

  const resolvedImports: Record<string, string> = {}

  // Validate imports against allowlist and project paths
  for (const imp of rawImports) {
    if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
      const { resolvedPath, error } = resolveRelativeImport(filePath, imp.specifier, availablePaths)
      if (error) {
        diagnostics.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          message: error,
          severity: 'error',
          code: 'MODULE_NOT_FOUND',
        })
      } else if (!resolvedPath) {
        diagnostics.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          message: `Cannot resolve import "${imp.specifier}" from "${filePath}"`,
          severity: 'error',
          code: 'MODULE_NOT_FOUND',
        })
      } else {
        resolvedImports[imp.specifier] = resolvedPath
      }
    } else {
      // Third-party package import
      if (!isAllowedPackage(imp.specifier, allowlist)) {
        diagnostics.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          message: `Package import "${imp.specifier}" is not allowed. Allowed packages: ${allowlist.join(', ')}`,
          severity: 'error',
          code: 'DENIED_IMPORT',
        })
      }
    }
  }

  return {
    analyzed: {
      path: filePath,
      source: content,
      isCss: false,
      isJson: false,
      imports: rawImports,
      resolvedImports,
    },
    diagnostics,
  }
}

function transpileFile(analyzed: AnalyzedFile): { code: string; diagnostics: CompileDiagnostic[] } {
  const diagnostics: CompileDiagnostic[] = []

  if (analyzed.isCss) {
    // CSS module returns empty exports in JS
    const code = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {};
`
    return { code, diagnostics: [] }
  }

  if (analyzed.isJson) {
    try {
      const json = JSON.stringify(JSON.parse(analyzed.source))
      const code = `module.exports = JSON.parse(${JSON.stringify(json)});`
      return { code, diagnostics: [] }
    } catch {
      return { code: '', diagnostics }
    }
  }

  // Transpile TSX/TS/JS using TypeScript transpileModule
  const result = ts.transpileModule(analyzed.source, {
    fileName: analyzed.path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: false,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: 'react',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    reportDiagnostics: true,
    transformers: { before: [context => sourceFile => {
      // A source-site ID includes the whole module path, not just its basename.
      let fileHash = 2166136261
      for (const char of analyzed.path) fileHash = Math.imul(fileHash ^ char.charCodeAt(0), 16777619)
      const fileSlug = `p-${(fileHash >>> 0).toString(36)}`
      let elementCounter = 0

      const visit: ts.Visitor = node => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = analyzed.resolvedImports[node.moduleSpecifier.text]
          if (resolved) return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, context.factory.createStringLiteral(resolved), node.attributes)
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = analyzed.resolvedImports[node.moduleSpecifier.text]
          if (resolved) return context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, context.factory.createStringLiteral(resolved), node.attributes)
        }
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
          const site = ++elementCounter
          const hasPaperId = node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'data-paper-id')
          if (!hasPaperId) {
            const idAttr = context.factory.createJsxAttribute(
              context.factory.createIdentifier('data-paper-id'),
              context.factory.createStringLiteral(`${fileSlug}-${node.tagName.text}-${site}`),
            )
            const attributes = context.factory.updateJsxAttributes(node.attributes, [...node.attributes.properties, idAttr])
            const updated = ts.isJsxOpeningElement(node)
              ? context.factory.updateJsxOpeningElement(node, node.tagName, node.typeArguments, attributes)
              : context.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, attributes)
            return ts.visitEachChild(updated, visit, context)
          }
        }
        return ts.visitEachChild(node, visit, context)
      }
      return ts.visitNode(sourceFile, visit) as ts.SourceFile
    }] },
  })
  for (const diag of result.diagnostics ?? []) {
    if (diag.category !== ts.DiagnosticCategory.Error) continue
    const position = diag.file?.getLineAndCharacterOfPosition(diag.start ?? 0)
    diagnostics.push({ file: analyzed.path, line: (position?.line ?? 0) + 1, column: (position?.character ?? 0) + 1,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'), severity: 'error', code: 'SYNTAX_ERROR' })
  }
  const transpiledCode = result.outputText

  return { code: transpiledCode, diagnostics }
}

function buildBundle(
  modules: Record<string, CompiledModule>,
  entryPoint: string,
  cssBundle: string,
  runtime: string
): CompilePreviewAssets {
  const serializedModules = Object.entries(modules)
    .map(([path, mod]) => {
      return `${JSON.stringify(path)}: function(exports, require, module) {\n${mod.code}\n}`
    })
    .join(',\n')

  const js = runtime + `\n(function() {
  const __root = typeof window !== 'undefined' ? window : globalThis;
  const __installedModules = Object.create(null);

  const __modules = {
${serializedModules}
  };

  function __paperRequire(id) {
    if (__installedModules[id]) {
      return __installedModules[id].exports;
    }

    if (Object.prototype.hasOwnProperty.call(__root.__paperPreviewPackages, id)) {
      return __root.__paperPreviewPackages[id];
    }

    const mod = Object.prototype.hasOwnProperty.call(__modules, id) ? __modules[id] : null;
    if (!mod) {
      throw new Error('Module not found in preview bundle: "' + id + '"');
    }

    const moduleObj = { exports: {} };
    __installedModules[id] = moduleObj;
    mod(moduleObj.exports, __paperRequire, moduleObj);
    return moduleObj.exports;
  }

  try {
    const entryExport = __paperRequire(${JSON.stringify(entryPoint)});
    const Component = entryExport.default || entryExport;

    if (typeof __root.document !== 'undefined') {
      const mountNode = __root.document.getElementById('root');
      const ReactDOM = __paperRequire('react-dom/client');
      const React = __paperRequire('react');

      if (mountNode && ReactDOM && typeof ReactDOM.createRoot === 'function' && React) {
        const rootInstance = __root.__paperPreviewRoot || (__root.__paperPreviewRoot = ReactDOM.createRoot(mountNode));
        rootInstance.render(React.createElement(Component));
      }
    }

    __root.__paperApp = {
      ready: true,
      entryPoint: ${JSON.stringify(entryPoint)},
      modules: Object.keys(__modules),
      require: __paperRequire,
    };
    if (typeof __root.__paperNotifyReady === 'function') {
      __root.__paperNotifyReady(${JSON.stringify(entryPoint)});
    }
  } catch (err) {
    if (typeof __root.document !== 'undefined') {
      const mountNode = __root.document.getElementById('root');
      if (mountNode) {
        mountNode.textContent = 'Runtime Render Error: ' + (err && err.message ? err.message : String(err));
      }
    }
    __root.__paperApp = {
      ready: false,
      error: err && err.message ? err.message : String(err),
    };
    if (typeof __root.__paperNotifyError === 'function') {
      __root.__paperNotifyError(err);
    }
  }
})();
`

  const html = generatePreviewHtml({
    js,
    css: cssBundle,
    entryPoint,
  })

  return {
    entryPoint,
    js,
    css: cssBundle,
    html,
  }
}

/** Async, host-only. No generated scripts, configuration, dependency installs or code evaluation. */
export async function compileSourceFiles(
  rawFiles: unknown,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const startTime = Date.now()
  const diagnostics: CompileDiagnostic[] = []
  let totalInputBytes = 0
  let currentFile = ''
  let entryPoint = 'src/App.tsx'
  const fail = (): CompileResult => ({ success: false, entryPoint, diagnostics, assets: null, modules: {},
    stats: { moduleCount: 0, totalInputBytes, totalOutputBytes: 0, durationMs: Date.now() - startTime } })
  const error = (code: CompileDiagnosticCode, message: string, file = currentFile) => {
    diagnostics.push({ file, line: 1, column: 1, code, message, severity: 'error' })
  }
  try {
    if (!options || typeof options !== 'object') throw new Error('Invalid compiler options')
    entryPoint = normalizeAndValidatePath(options.entryPoint ?? entryPoint)
    const boundedLimit = (value: number | undefined, maximum: number) => {
      if (value === undefined) return maximum
      if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error('Compiler limits may only narrow the fixed policy')
      return value
    }
    const maxFileBytes = boundedLimit(options.maxFileBytes, APP_COMPILER_LIMITS.MAX_FILE_BYTES)
    const maxTotalBytes = boundedLimit(options.maxTotalBytes, APP_COMPILER_LIMITS.MAX_TOTAL_FILES_BYTES)
    const allowlist = options.allowlist ?? DEFAULT_ALLOWED_PACKAGES
    if (!Array.isArray(allowlist) || allowlist.some(name => !DEFAULT_ALLOWED_PACKAGES.includes(name))) throw new Error('Allowlist may only narrow the fixed package policy')
    // Accessors are not source data. Inspect descriptors before reading values.
    const plain = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected a plain data object')
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (!('value' in descriptor)) throw new Error('Accessors are forbidden in compiler inputs')
      }
      return value as Record<string, unknown>
    }
    const entries: [unknown, unknown][] = []
    if (Array.isArray(rawFiles)) {
      if (rawFiles.length > APP_COMPILER_LIMITS.MAX_FILES_COUNT) { error('OVERSIZED_SOURCE', 'Too many source files'); return fail() }
      for (let i = 0; i < rawFiles.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(rawFiles, String(i))
        if (!descriptor || !('value' in descriptor)) throw new Error('Expected a dense file array without accessors')
        const file = plain(descriptor.value)
        entries.push([file.path, file.content])
      }
    } else {
      for (const [path, value] of Object.entries(plain(rawFiles))) {
        if (typeof value === 'string') entries.push([path, value])
        else {
          const file = plain(value)
          if (normalizeAndValidatePath(file.path) !== normalizeAndValidatePath(path)) throw new Error('File key and path must match')
          entries.push([path, file.content])
        }
      }
    }
    if (entries.length > APP_COMPILER_LIMITS.MAX_FILES_COUNT) { error('OVERSIZED_SOURCE', 'Too many source files'); return fail() }
    const fileMap = new Map<string, string>()
    for (const [path, content] of entries) {
      currentFile = typeof path === 'string' ? path : ''
      const normalized = normalizeAndValidatePath(path)
      if (fileMap.has(normalized)) throw new Error('Duplicate normalized source path')
      if (typeof content !== 'string') throw new Error('File content must be a string')
      // Check length before allocating a UTF-8 buffer.
      if (content.length > maxFileBytes) { error('OVERSIZED_SOURCE', 'Source file exceeds byte budget'); continue }
      const bytes = new TextEncoder().encode(content).length
      totalInputBytes += bytes
      if (bytes > maxFileBytes) error('OVERSIZED_SOURCE', 'Source file exceeds byte budget')
      if (totalInputBytes > maxTotalBytes) { error('OVERSIZED_SOURCE', 'Total source exceeds byte budget'); break }
      fileMap.set(normalized, content)
    }
    const supported = (path: string) => /\.(tsx?|jsx?|css|json)$/.test(path) && !path.endsWith('.d.ts') &&
      !/^(?:package(?:-lock)?\.json|tsconfig(?:\.[^/]+)?\.json|(?:vite|postcss|tailwind)\.config\.[^/]+)$/.test(path)
    const availablePaths = new Set([...fileMap.keys()].filter(supported))
    if (!availablePaths.has(entryPoint) || !/\.(tsx?|jsx?)$/.test(entryPoint)) error('MISSING_ENTRY_POINT', 'A JavaScript or TSX entry point is required', entryPoint)
    if (diagnostics.length) return fail()
    const analyzed: AnalyzedFile[] = []
    for (const [path, content] of fileMap) {
      if (!supported(path)) continue
      currentFile = path
      const analysis = analyzeSourceFile(path, content, availablePaths, allowlist)
      diagnostics.push(...analysis.diagnostics)
      if (analysis.analyzed) analyzed.push(analysis.analyzed)
    }
    if (diagnostics.length) return fail()
    const modules: Record<string, CompiledModule> = {}
    for (const file of analyzed) {
      currentFile = file.path
      const result = transpileFile(file)
      diagnostics.push(...result.diagnostics)
      modules[file.path] = { path: file.path, code: result.code, imports: file.imports.map(imp => imp.specifier), isCss: file.isCss }
    }
    if (diagnostics.length) return fail()
    // Include styles from the entry graph only, in dependency order. Cycles are visited once.
    const seen = new Set<string>()
    const css: string[] = []
    const byPath = new Map(analyzed.map(file => [file.path, file]))
    const collect = (path: string) => {
      if (seen.has(path)) return
      seen.add(path)
      const file = byPath.get(path)!
      for (const target of Object.values(file.resolvedImports)) collect(target)
      if (file.isCss) css.push(file.source)
    }
    collect(entryPoint)
    const runtime = await getPreviewRuntime()
    const assets = buildBundle(modules, entryPoint, css.join('\n\n'), runtime)
    return { success: true, entryPoint, diagnostics, assets, modules,
      stats: { moduleCount: Object.keys(modules).length, totalInputBytes,
        totalOutputBytes: new TextEncoder().encode(assets.js + assets.css + assets.html).length, durationMs: Date.now() - startTime } }
  } catch (err) {
    error('INVALID_INPUT', err instanceof Error ? err.message : 'Invalid compiler input')
    return fail()
  }
}

export async function compileAppProject(project: AppProject, options: CompileOptions = {}, assetRecords: readonly AppAssetExportRecord[] = []): Promise<CompileResult> {
  const result = await compileSourceFiles(project?.files, { ...options, entryPoint: options.entryPoint ?? project?.preview?.entryPoint })
  if (!result.success || !result.assets) return result
  try {
    if (project.assetIds.length || assetRecords.length) exportAppPackage(project, assetRecords)
    const records = new Map(assetRecords.map(asset => [asset.id, asset]))
    const resolve = (source: string) => source.replace(/paper-asset:([a-zA-Z0-9_-]+)/g, (_match, id: string) => {
      const asset = records.get(id)
      if (!asset) throw new Error(`Unknown private asset: ${id}`)
      return `data:${asset.mimeType};base64,${asset.dataBase64}`
    })
    const js = resolve(result.assets.js)
    const css = [createFontFacesCss(assetRecords), resolve(result.assets.css)].filter(Boolean).join('\n')
    const assets = { ...result.assets, js, css, html: generatePreviewHtml({ js, css, entryPoint: result.entryPoint }) }
    return { ...result, assets, stats: { ...result.stats, totalOutputBytes: new TextEncoder().encode(js + css + assets.html).length } }
  } catch (error) {
    return { ...result, success: false, assets: null, modules: {}, diagnostics: [...result.diagnostics,
      { file: result.entryPoint, line: 1, column: 1, severity: 'error', code: 'INVALID_INPUT', message: error instanceof Error ? error.message : 'Invalid assets' }] }
  }
}
