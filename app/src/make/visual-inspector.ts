import ts from 'typescript'
import type { AppProject, PreviewElementTarget } from './types.ts'
import { computeBoundedDiff, type BoundedDiff } from './diff.ts'
import { validateAppProject } from './manifest.ts'

export const ALLOWED_VISUAL_PROPERTIES = Object.freeze([
  'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'letterSpacing', 'textTransform',
  'padding', 'margin', 'gap', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'borderWidth',
] as const)
export type AllowedVisualProperty = (typeof ALLOWED_VISUAL_PROPERTIES)[number]

export interface VisualInspectionResult {
  readonly eligible: boolean
  readonly readOnly: boolean
  readonly reason?: string
  readonly filePath?: string
  readonly tagName?: string
  readonly inlineStyles: Record<string, string>
  readonly currentStyles: Record<string, string>
}
export interface VisualUpdateResult {
  readonly success: boolean
  readonly updatedProject?: AppProject
  readonly diff?: BoundedDiff
  readonly targetFilePath?: string
  readonly error?: string
}

export function validateStyleValue(prop: string, value: string): void {
  if (!ALLOWED_VISUAL_PROPERTIES.includes(prop as AllowedVisualProperty)) throw new Error(`Property "${prop}" is not allowed`)
  if (typeof value !== 'string' || value.length > 128 || /[<>{}"'`\\;\n\r\0]/.test(value)) throw new Error(`Unsafe style value for ${prop}`)
  if (value === '') return
  const v = value.trim()
  let valid = false
  if (['color', 'backgroundColor', 'borderColor'].includes(prop)) {
    // Deliberately small, portable color grammar; no URLs, variables or expressions.
    valid = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v) ||
      /^(?:transparent|currentColor|inherit|black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|rebeccapurple)$/i.test(v)
    const rgb = v.match(/^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i)
    if (rgb) valid = rgb.slice(2, 5).every(n => Number(n) <= 255) && (rgb[1].toLowerCase() === 'rgba' ? rgb[5] !== undefined : rgb[5] === undefined)
  } else if (prop === 'fontWeight') valid = /^(?:[1-9]\d{0,2}|1000|normal|bold|bolder|lighter|inherit)$/.test(v)
  else if (prop === 'textAlign') valid = /^(?:left|right|center|justify|start|end|inherit)$/.test(v)
  else if (prop === 'textTransform') valid = /^(?:none|capitalize|uppercase|lowercase|inherit)$/.test(v)
  else {
    const parts = v.split(/\s+/)
    const maximum = ['padding', 'margin', 'borderRadius', 'borderWidth'].includes(prop) ? 4 : prop === 'gap' ? 2 : 1
    const negative = ['margin', 'letterSpacing'].includes(prop)
    valid = parts.length <= maximum && parts.every(part => {
      if ((prop === 'margin' && part === 'auto') || (['lineHeight', 'letterSpacing', 'gap'].includes(prop) && part === 'normal') || part === 'inherit') return parts.length === 1 || prop === 'margin'
      const dimension = part.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|%|vh|vw|pt)?$/)
      return !!dimension && Number.isFinite(Number(dimension[1])) && Math.abs(Number(dimension[1])) <= 10000 && (negative || Number(dimension[1]) >= 0) &&
        (parts.length === 1 || !!dimension[2] || Number(dimension[1]) === 0)
    })
  }
  if (!valid) throw new Error(`Invalid ${prop} value. Use a supported CSS value.`)
}

interface LocatedElement {
  filePath: string
  sourceFile: ts.SourceFile
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement
  style?: ts.JsxAttribute
  object?: ts.ObjectLiteralExpression
  properties: Map<string, ts.PropertyAssignment>
  inlineStyles: Record<string, string>
  reason?: string
}

function literalSite(initializer: ts.StringLiteral, sourceFile: ts.SourceFile): string {
  if (!initializer.text.includes('&')) return initializer.text
  // JSX entities are decoded by the compiler, unlike ordinary JS strings. Use
  // the same compiler for these uncommon IDs, then read its literal AST only.
  // Generated code is never evaluated to resolve a selection.
  const { outputText } = ts.transpileModule(`<i data-paper-id=${initializer.getText(sourceFile)} />`, {
    fileName: 'identity.tsx', compilerOptions: { jsx: ts.JsxEmit.React },
  })
  const emitted = ts.createSourceFile('identity.js', outputText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let value = ''
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === 'data-paper-id' && ts.isStringLiteral(node.initializer)) value = node.initializer.text
    ts.forEachChild(node, visit)
  }
  visit(emitted)
  return value
}

// Mirror the compiler's preorder source-site numbering. Runtime occurrence IDs
// identify mounted instances; edits deliberately apply to their shared JSX site.
function findElement(project: AppProject, target: PreviewElementTarget): LocatedElement | null {
  const site = target.elementId.replace(/~[1-9]\d*$/, '')
  const matches: LocatedElement[] = []
  let uncertainIdentity = false
  for (const file of Object.values(project.files)) {
    if (!/\.(tsx|jsx|js)$/.test(file.path)) continue
    const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : file.path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS)
    let hash = 2166136261, counter = 0
    for (const char of file.path) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
        const automaticId = `p-${(hash >>> 0).toString(36)}-${node.tagName.text}-${++counter}`
        const attrs = node.attributes.properties
        const paperIds = attrs.filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sourceFile) === 'data-paper-id')
        const explicit = paperIds[0]?.initializer
        const actualSite = explicit && ts.isStringLiteral(explicit) ? literalSite(explicit, sourceFile) : paperIds.length ? null : automaticId
        // An explicit identity that is dynamic, empty (uses DOM fallback), or
        // overridden by a spread may impersonate any static site at runtime.
        // Without a provable mapping, keep this project's selections read-only.
        if (paperIds.length && (!actualSite || paperIds.length > 1 || attrs.some(ts.isJsxSpreadAttribute))) uncertainIdentity = true
        // The guest sanitizes and truncates source IDs before adding the runtime
        // occurrence suffix. Compare that same identity across every module so
        // a literal ID cannot alias another source site after normalization.
        const runtimeSite = actualSite?.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100)
        if (runtimeSite === site) {
          const styles = attrs.filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sourceFile) === 'style')
          const found: LocatedElement = { filePath: file.path, sourceFile, node, style: styles[0], properties: new Map(), inlineStyles: {} }
          if (node.tagName.text !== target.tagName) found.reason = 'Selected tag does not match the source element.'
          if (attrs.some(ts.isJsxSpreadAttribute) || paperIds.length > 1 || styles.length > 1) found.reason = 'Spread or duplicate attributes are read-only.'
          if (styles.length) {
            const init = styles[0].initializer
            if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isObjectLiteralExpression(init.expression)) found.reason = 'Dynamic style expressions are read-only.'
            else {
              found.object = init.expression
              for (const prop of init.expression.properties) {
                if (!ts.isPropertyAssignment(prop) || (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))) {
                  found.reason = 'Dynamic, computed or spread styles are read-only.'
                  continue
                }
                const name = prop.name.text, value = prop.initializer
                if (found.properties.has(name)) found.reason = 'Duplicate style properties are read-only.'
                found.properties.set(name, prop)
                if (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) found.inlineStyles[name] = value.text
                else if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) found.inlineStyles[name] = `-${value.operand.text}`
                else found.reason = 'Dynamic style values are read-only.'
              }
            }
          }
          matches.push(found)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  if (matches.length !== 1) return null
  if (uncertainIdentity) matches[0].reason = 'Dynamic or overridden source IDs make this selection ambiguous; read-only.'
  return matches[0]
}

export function inspectElementEligibility(project: AppProject, target: PreviewElementTarget): VisualInspectionResult {
  const found = findElement(project, target)
  const reason = found ? found.reason : 'Element is not found or its source ID is ambiguous; read-only.'
  return { eligible: !!found && !reason, readOnly: !found || !!reason, reason, filePath: found?.filePath,
    tagName: target.tagName, inlineStyles: found?.inlineStyles ?? {}, currentStyles: { ...target.styles, ...found?.inlineStyles } }
}

function valueSource(value: string): string {
  // React interprets numeric lengths as pixels and numeric line-height as a ratio.
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? String(Number(value)) : JSON.stringify(value)
}

/** AST offsets select exact syntax ranges. No search/replace on generated text. */
export async function applyVisualPropertyUpdate(project: AppProject, target: PreviewElementTarget, updates: Record<string, string>): Promise<VisualUpdateResult> {
  validateAppProject(project)
  for (const [key, value] of Object.entries(updates)) validateStyleValue(key, value)
  let found = findElement(project, target)
  if (!found || found.reason) throw new Error(`Cannot update read-only element: ${found?.reason ?? 'unsupported element or not found'}`)
  const filePath = found.filePath
  let content = project.files[filePath].content
  // Reparse only this bounded file after each changed property, preserving all
  // untouched bytes, numeric types, comments, custom properties and other files.
  for (const key of Object.keys(updates).sort()) {
    const value = updates[key].trim()
    found = findElement({ ...project, files: { [filePath]: { path: filePath, content } } }, target)!
    const prop = found.properties.get(key)
    if (prop) {
      if (value === '') {
        const object = found.object!
        const index = object.properties.indexOf(prop)
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, content)
        scanner.setTextPos(prop.end)
        const trailingComma = scanner.scan() === ts.SyntaxKind.CommaToken ? scanner.getTokenPos() : null
        if (trailingComma !== null) content = content.slice(0, prop.getStart(found.sourceFile)) + content.slice(prop.end, trailingComma) + content.slice(trailingComma + 1)
        else {
          const start = prop.getStart(found.sourceFile)
          if (index > 0) {
            scanner.setTextPos(object.properties[index - 1].end)
            if (scanner.scan() === ts.SyntaxKind.CommaToken) {
              const comma = scanner.getTokenPos()
              content = content.slice(0, comma) + content.slice(comma + 1, start) + content.slice(prop.end)
              continue
            }
          }
          content = content.slice(0, start) + content.slice(prop.end)
        }
      } else {
        content = content.slice(0, prop.initializer.getStart(found.sourceFile)) + valueSource(value) + content.slice(prop.initializer.end)
      }
    } else if (value !== '') {
      if (found.object) {
        const object = found.object
        const separator = object.properties.length && !object.properties.hasTrailingComma ? ',' : ''
        const pos = object.end - 1
        content = content.slice(0, pos) + `${separator} ${key}: ${valueSource(value)} ` + content.slice(pos)
      } else {
        const pos = found.node.attributes.end
        content = content.slice(0, pos) + ` style={{ ${key}: ${valueSource(value)} }}` + content.slice(pos)
      }
    }
  }
  if (content === project.files[filePath].content) throw new Error('No visual properties changed.')
  const updatedProject = validateAppProject({ ...project, revision: project.revision + 1,
    files: { ...project.files, [filePath]: { path: filePath, content } }, updatedAt: new Date().toISOString() })
  // Compilation happens once in the workspace, with the real entry point and
  // account asset resolver, before persistence or replacement of working assets.
  return { success: true, updatedProject, targetFilePath: filePath,
    diff: computeBoundedDiff(project.files, updatedProject.files, { baseRevision: project.revision, targetRevision: updatedProject.revision }) }
}
