import { tokenVariable } from '../tokens/model.ts'
import type { DesignToken, TokenBindings } from '../tokens/types.ts'
import type { Point } from '../canvas/types.ts'
import { unionBounds } from '../canvas/math.ts'
import { getWorldBounds } from '../scene/geometry.ts'
import { SceneStore } from '../scene/store.ts'
import type { SceneDocument, SceneElement } from '../scene/types.ts'
import { importEditableSVG } from './svgImport.ts'
import { importFigmaClipboard } from './figma.ts'
import type { ImportedDocument } from './figma.ts'
import { MAX_IMPORT_BYTES } from './project.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const svgTags = new Set('svg g defs title desc rect circle ellipse path line polyline polygon text tspan textPath use symbol image linearGradient radialGradient stop clipPath mask pattern filter feGaussianBlur feOffset feBlend feColorMatrix feComponentTransfer feFuncR feFuncG feFuncB feFuncA feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap feDropShadow'.split(' '))
const svgAttrs = new Set('id class xmlns xmlns:xlink x y x1 y1 x2 y2 dx dy width height viewBox preserveAspectRatio transform gradientTransform patternTransform d points cx cy r rx ry fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity clip-path clip-rule mask filter color font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing textLength lengthAdjust xml:space href xlink:href offset stop-color stop-opacity gradientUnits spreadMethod fx fy fr patternUnits patternContentUnits clipPathUnits maskUnits maskContentUnits filterUnits primitiveUnits in in2 result stdDeviation type values operator k1 k2 k3 k4 mode flood-color flood-opacity color-interpolation-filters baseFrequency numOctaves seed stitchTiles scale xChannelSelector yChannelSelector radius slope intercept amplitude exponent tableValues overflow'.split(' '))
const badCSS = /@|\\|expression\s*\(|(?:java|vb)script\s*:/i
const safePaint = (value: string) => !badCSS.test(value) && !/[<>]/.test(value) && [...value.matchAll(/url\s*\(([^)]*)\)/gi)].every(match => /^#[A-Za-z_][\w:.-]*$/.test(match[1].trim().replace(/^["']|["']$/g, '')))

export interface SanitizedSVG { source: string; width: number; height: number }

/** An allowlist removes active content and external dependencies before rendering. */
export function sanitizeSVG(source: string, nesting = 0): SanitizedSVG {
  if (nesting > 5) throw new Error('This SVG contains too many nested image documents.')
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('SVG files must be smaller than 16 MB.')
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG documents with external entities are not supported.')
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = parsed.documentElement
  if (parsed.querySelector('parsererror') || root.localName !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NS)) throw new Error('This is not a valid SVG document.')
  let count = 0
  const clean = (node: Element, depth: number) => {
    if (++count > 10_000 || depth > 100) throw new Error('This SVG is too complex to import.')
    for (const child of [...node.children]) {
      if (child.localName === 'style') {
        // CSS is isolated inside an image. Retain ordinary Figma class rules,
        // but remove imports, escaped URLs, and external resource references.
        if (!safePaint(child.textContent ?? '')) child.remove()
        else for (const attr of [...child.attributes]) child.removeAttribute(attr.name)
      } else if (!svgTags.has(child.localName) || (child.namespaceURI && child.namespaceURI !== SVG_NS)) child.remove()
      else clean(child, depth + 1)
    }
    for (const attr of [...node.attributes]) {
      const { name, value } = attr
      if (name === 'style') {
        if (!safePaint(value)) node.removeAttribute(name)
      } else if (name === 'href' || name === 'xlink:href') {
        const local = /^#[A-Za-z_][\w:.-]*$/.test(value)
        const raster = node.localName === 'image' && /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)
        if (node.localName === 'image' && /^data:image\/svg\+xml(?:;[^,]*)?,/i.test(value)) {
          try {
            const comma = value.indexOf(',')
            const header = value.slice(0, comma)
            const body = value.slice(comma + 1)
            const decoded = /;base64$/i.test(header) ? new TextDecoder().decode(Uint8Array.from(atob(body), char => char.charCodeAt(0))) : decodeURIComponent(body)
            const nested = sanitizeSVG(decoded, nesting + 1)
            node.setAttribute(name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nested.source)}`)
          } catch { node.removeAttribute(name) }
        } else if (!local && !raster) node.removeAttribute(name)
      } else if (!svgAttrs.has(name) || !safePaint(value)) node.removeAttribute(name)
    }
  }
  clean(root, 0)
  root.setAttribute('xmlns', SVG_NS)
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
  const dimension = (name: string, fallback: number) => {
    const value = root.getAttribute(name) ?? ''
    const number = /^\d*\.?\d+(?:px)?$/.test(value.trim()) ? parseFloat(value) : fallback
    return Number.isFinite(number) && number > 0 ? number : fallback
  }
  const width = dimension('width', hasBox ? box[2] : 300), height = dimension('height', hasBox ? box[3] : 150)
  if (width > 16384 || height > 16384) throw new Error('SVG dimensions must be no larger than 16,384 px per side.')
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  if (!hasBox) root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return { source: new XMLSerializer().serializeToString(root), width, height }
}

export function importSVG(source: string, name = 'Pasted SVG'): SceneDocument {
  const svg = sanitizeSVG(source)
  const editable = importEditableSVG(svg.source, svg.width, svg.height, name)
  if (editable) return editable
  const store = new SceneStore()
  // Vector-backed image layers preserve paths, transforms, gradients and masks
  // from Figma without flattening the artwork to pixels.
  store.add('image', { name, width: svg.width, height: svg.height, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.source)}`, alt: name, fit: 'fill', style: { fill: null } })
  return store.toJSON()
}

const htmlTags = new Set('div span p h1 h2 h3 h4 h5 h6 section article header footer main aside nav ul ol li a button strong b em i small label img br'.split(' '))
const htmlStyles = new Set('display position left top right bottom width height min-width min-height max-width max-height padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left gap row-gap column-gap flex flex-direction flex-wrap align-items justify-content grid-template-columns grid-template-rows grid-column grid-row background background-color color border border-width border-style border-color border-radius opacity overflow font-family font-size font-weight font-style line-height letter-spacing text-align white-space box-sizing object-fit visibility'.split(' '))

/** Lay out an inert, sanitized fragment, then translate boxes into editable layers. */
export async function importHTML(source: string): Promise<SceneDocument> {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('HTML fragments must be smaller than 16 MB.')
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const svg = parsed.querySelector('svg')
  if (svg && parsed.body.children.length === 1 && parsed.body.firstElementChild === svg) return importSVG(new XMLSerializer().serializeToString(svg))
  const sandbox = document.createElement('iframe')
  sandbox.setAttribute('sandbox', 'allow-same-origin')
  sandbox.setAttribute('aria-hidden', 'true')
  sandbox.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:1200px;visibility:hidden;border:0;pointer-events:none;'
  document.body.append(sandbox)
  try {
    const doc = sandbox.contentDocument
    if (!doc) throw new Error('Could not measure the pasted HTML.')
    const reset = doc.createElement('style')
    reset.textContent = 'html,body{margin:0;background:transparent}*{box-sizing:border-box}body{font:16px Arial,sans-serif;color:#080808}#paper-import{display:flow-root;width:720px;padding:0;overflow:hidden}img{max-width:100%}'
    doc.head.append(reset)
    const container = doc.createElement('div')
    container.id = 'paper-import'
    let count = 0
    const clone = (node: Node, depth: number): Node | null => {
      if (++count > 2000 || depth > 40) throw new Error('This HTML fragment is too complex to import.')
      if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
      if (!(node instanceof Element)) return null
      if (node.localName === 'svg') return doc.importNode(new DOMParser().parseFromString(sanitizeSVG(new XMLSerializer().serializeToString(node)).source, 'image/svg+xml').documentElement, true)
      if (!htmlTags.has(node.localName)) return null
      const element = doc.createElement(node.localName)
      for (const attr of ['layer-name', 'data-paper-locked', 'hidden']) { if (node.hasAttribute(attr)) element.setAttribute(attr, node.getAttribute(attr) ?? '') }
      const original = node as HTMLElement
      for (const property of original.style) {
        const value = original.style.getPropertyValue(property)
        if (htmlStyles.has(property) && safePaint(value)) element.style.setProperty(property, value)
      }
      if (element.style.position === 'fixed' || element.style.position === 'sticky') element.style.position = 'absolute'
      if (node.localName === 'img') {
        const src = node.getAttribute('src') ?? ''
        if (/^(?:https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(src)) element.setAttribute('src', src)
        element.setAttribute('alt', node.getAttribute('alt') ?? '')
        for (const attr of ['width', 'height']) { const value = node.getAttribute(attr); if (value && /^\d+$/.test(value)) element.setAttribute(attr, value) }
      }
      for (const child of [...node.childNodes]) { const result = clone(child, depth + 1); if (result) element.append(result) }
      return element
    }
    for (const node of [...parsed.body.childNodes]) { const result = clone(node, 0); if (result) container.append(result) }
    if (!container.childNodes.length) throw new Error('No supported HTML elements found. Paste HTML markup or copy an SVG from Figma.')
    doc.body.append(container)
    await Promise.all([...container.querySelectorAll('img')].map(img => Promise.race([img.decode().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 2500))])))
    const origin = container.getBoundingClientRect()
    const store = new SceneStore()
    const frame = store.add('frame', { name: 'Pasted HTML', width: Math.max(1, Math.min(16384, origin.width)), height: Math.max(1, Math.min(16384, container.scrollHeight)), clipContent: true, style: { fill: null } })
    const view = doc.defaultView!
    const transparent = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
    const visit = (element: HTMLElement, parentId: string, parentBox: DOMRect) => {
      const style = view.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      const geometry = { parentId, x: box.x - parentBox.x, y: box.y - parentBox.y, width: Math.max(1, box.width || parseFloat(style.width) || 1), height: Math.max(1, box.height || parseFloat(style.height) || 1) }
      const radius = parseFloat(style.borderRadius) || 0
      const borderWidth = parseFloat(style.borderTopWidth) || 0
      const opacity = Math.max(0, Math.min(1, parseFloat(style.opacity) || 0))
      const paint = { fill: transparent(style.backgroundColor) ? null : style.backgroundColor, opacity, stroke: borderWidth > 0 ? { color: style.borderTopColor, width: borderWidth, dash: style.borderTopStyle === 'dashed' ? [borderWidth * 3, borderWidth * 3] : [] } : null }
      const name = element.getAttribute('layer-name')?.trim() || element.localName
      const flags = { visible: style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden'), locked: element.hasAttribute('data-paper-locked') }
      if (element.localName === 'img') {
        if (element.getAttribute('src')) store.add('image', { ...geometry, ...flags, name, src: element.getAttribute('src')!, alt: element.getAttribute('alt') ?? '', fit: style.objectFit === 'cover' ? 'cover' : 'contain', cornerRadius: radius, style: { ...paint, fill: null } })
        return
      }
      if (element.localName === 'svg') {
        const document = importSVG(new XMLSerializer().serializeToString(element), name)
        const copy = (id: string, parentId: string, root: boolean) => {
          const node = document.elements[id]
          const { id: oldId, type, parentId: oldParent, zIndex, ...input } = node
          void oldId; void oldParent; void zIndex
          if ('children' in input) delete (input as { children?: readonly string[] }).children
          const next = store.add(type, { ...input, parentId, ...(root ? { ...geometry, parentId, ...flags, name } : {}) })
          if (node.type === 'frame') for (const child of node.children) copy(child, next.id, false)
        }
        for (const rootId of document.rootIds) copy(rootId, parentId, true)
        return
      }
      const containerNode = store.add('frame', { ...geometry, ...flags, name, clipContent: style.overflow === 'hidden' || style.overflow === 'clip', cornerRadius: radius, style: paint })
      for (const child of [...element.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          const range = doc.createRange()
          range.selectNodeContents(child)
          const rect = range.getBoundingClientRect()
          const size = parseFloat(style.fontSize) || 16
          const lineHeight = style.lineHeight === 'normal' ? 1.2 : (parseFloat(style.lineHeight) || size * 1.2) / size
          store.add('text', { parentId: containerNode.id, name: child.textContent.trim().slice(0, 40), x: rect.x - box.x, y: rect.y - box.y - Math.max(0, (size * lineHeight - rect.height) / 2), width: Math.max(1, rect.width + 1), height: Math.max(rect.height, size * lineHeight), text: style.whiteSpace.startsWith('pre') ? child.textContent : child.textContent.replace(/\s+/g, ' ').trim(), fontFamily: style.fontFamily, fontSize: size, fontWeight: parseInt(style.fontWeight) || 400, lineHeight, letterSpacing: parseFloat(style.letterSpacing) || 0, textAlign: style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left', style: { fill: style.color } })
        } else if (child.nodeType === Node.ELEMENT_NODE) visit(child as HTMLElement, containerNode.id, box)
      }
    }
    for (const child of [...container.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) visit(child as HTMLElement, frame.id, origin)
      else if (child.textContent?.trim()) {
        const wrapper = doc.createElement('span'); child.replaceWith(wrapper); wrapper.append(child); visit(wrapper, frame.id, origin)
      }
    }
    if (store.getChildren(frame.id).length === 0) throw new Error('The pasted HTML has no visible content.')
    return store.toJSON()
  } finally { sandbox.remove() }
}

/** Atomic insertion, with fresh IDs and one notification for an entire paste. */
export function insertImportedScene(store: SceneStore, document: SceneDocument, center: Point): readonly string[] {
  const imported = new SceneStore()
  imported.load(document)
  const state = imported.getSnapshot()
  const bounds = unionBounds(state.rootIds.map(id => getWorldBounds(state, id)))
  const ids = new Map(Object.keys(state.elements).map(id => [id, crypto.randomUUID()]))
  const current = store.toJSON()
  const tokens = [...(current.tokens ?? [])]
  const tokenIds = new Map<string, string>()
  const names = new Set(tokens.map(tokenVariable))
  for (const token of state.tokens) {
    let name = token.name, index = 2
    while (names.has(tokenVariable({ ...token, name }))) name = `${token.name}-${index++}`
    const next = { ...token, id: crypto.randomUUID(), name } as DesignToken
    tokenIds.set(token.id, next.id)
    names.add(tokenVariable(next)); tokens.push(next)
  }
  const elements: Record<string, SceneElement> = { ...current.elements }
  for (const [id, node] of Object.entries(state.elements)) {
    const root = node.parentId === null
    const tokenBindings = Object.fromEntries(Object.entries(node.tokenBindings ?? {}).filter(([property]) => !root || !['x', 'y'].includes(property)).map(([property, tokenId]) => [property, tokenIds.get(tokenId)!])) as TokenBindings
    const updated = { ...node, ...(node.tokenBindings ? { tokenBindings } : {}), id: ids.get(id)!, parentId: root ? null : ids.get(node.parentId!)!, x: node.x + (root ? center.x - bounds.x - bounds.width / 2 : 0), y: node.y + (root ? center.y - bounds.y - bounds.height / 2 : 0), zIndex: node.zIndex + (root ? current.rootIds.length : 0), ...(node.type === 'frame' ? { children: node.children.map(child => ids.get(child)!) } : {}) } as SceneElement
    elements[updated.id] = updated
  }
  const roots = state.rootIds.map(id => ids.get(id)!)
  store.batch(() => { store.load({ ...current, tokens, elements, rootIds: [...current.rootIds, ...roots] }); store.select(roots) }, 'Import artwork')
  return roots
}

export async function importClipboard(data: { svg?: string; html?: string; text?: string; figma?: string }): Promise<ImportedDocument | null> {
  for (const value of Object.values(data)) if (value && new TextEncoder().encode(value).length > MAX_IMPORT_BYTES) throw new Error('Clipboard content must be smaller than 16 MB.')
  const text = data.svg || data.text?.trim() || ''
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return importSVG(text)
  let figmaError: Error | null = null
  if (data.figma || (data.html && /data-buffer|<!--\(figma\)/i.test(data.html))) {
    try { return await importFigmaClipboard(data.figma || data.html!) }
    catch (error) { figmaError = error instanceof Error ? error : new Error('Could not decode the Figma clipboard.') }
  }
  if (data.html) {
    const parsed = new DOMParser().parseFromString(data.html, 'text/html')
    if (figmaError) {
      // SVG fallback is used only when the native clipboard cannot be translated.
      const svg = parsed.querySelector('svg')
      if (svg) return { ...importSVG(new XMLSerializer().serializeToString(svg), 'Figma SVG'), warnings: [figmaError.message] }
      if (!parsed.body.textContent?.trim()) throw figmaError
      parsed.querySelectorAll('[data-buffer], [data-metadata]').forEach(element => element.remove())
    }
    return importHTML(parsed.body.innerHTML)
  }
  if (figmaError) throw figmaError
  if (/^<[a-z][\s\S]*>/i.test(text)) return importHTML(text)
  if (/^[[{]/.test(text)) {
    try { const value = JSON.parse(text); if (value?.nodes || value?.nodeChanges || value?.document || Array.isArray(value)) return importFigmaClipboard(text) } catch { /* Ordinary text is retained as text. */ }
  }
  if (text) {
    const store = new SceneStore()
    store.add('text', { name: 'Pasted text', text, width: 320, height: Math.max(40, text.split('\n').length * 24), fontSize: 20, letterSpacing: 0 })
    return store.toJSON()
  }
  return null
}
