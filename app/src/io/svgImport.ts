import { SceneStore } from '../scene/store.ts'
import type { SceneDocument } from '../scene/types.ts'
import { parsePath, pathBounds, serializePath } from '../scene/pathGeometry.ts'
import type { PathContour } from '../scene/pathGeometry.ts'

const k = .5522847498307936
const n = (element: Element, key: string, fallback = 0) => { const value = parseFloat(element.getAttribute(key) ?? ''); return Number.isFinite(value) ? value : fallback }
const pointPath = (element: Element, close: boolean) => {
  const points = (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
  if (!points.length || points.length % 2 || !points.every(Number.isFinite)) throw new Error('Invalid SVG points.')
  return `M ${points.slice(0, 2).join(' ')} ${points.slice(2).map((value, i) => i % 2 ? `${value}` : `L ${value}`).join(' ')}${close ? ' Z' : ''}`
}
const shapePath = (e: Element): string => {
  if (e.localName === 'path') return e.getAttribute('d') ?? ''
  if (e.localName === 'line') return `M ${n(e, 'x1')} ${n(e, 'y1')} L ${n(e, 'x2')} ${n(e, 'y2')}`
  if (e.localName === 'polygon' || e.localName === 'polyline') return pointPath(e, e.localName === 'polygon')
  if (e.localName === 'rect') {
    const x = n(e, 'x'), y = n(e, 'y'), w = n(e, 'width'), h = n(e, 'height'), rx = Math.min(w / 2, n(e, 'rx', n(e, 'ry'))), ry = Math.min(h / 2, n(e, 'ry', rx))
    if (w <= 0 || h <= 0) return ''
    if (!rx || !ry) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
    return `M ${x + rx} ${y} H ${x + w - rx} C ${x + w - rx + rx * k} ${y} ${x + w} ${y + ry - ry * k} ${x + w} ${y + ry} V ${y + h - ry} C ${x + w} ${y + h - ry + ry * k} ${x + w - rx + rx * k} ${y + h} ${x + w - rx} ${y + h} H ${x + rx} C ${x + rx - rx * k} ${y + h} ${x} ${y + h - ry + ry * k} ${x} ${y + h - ry} V ${y + ry} C ${x} ${y + ry - ry * k} ${x + rx - rx * k} ${y} ${x + rx} ${y} Z`
  }
  const x = n(e, 'cx'), y = n(e, 'cy'), rx = n(e, 'r', n(e, 'rx')), ry = n(e, 'r', n(e, 'ry'))
  if (rx <= 0 || ry <= 0) return ''
  return `M ${x + rx} ${y} C ${x + rx} ${y + ry * k} ${x + rx * k} ${y + ry} ${x} ${y + ry} C ${x - rx * k} ${y + ry} ${x - rx} ${y + ry * k} ${x - rx} ${y} C ${x - rx} ${y - ry * k} ${x - rx * k} ${y - ry} ${x} ${y - ry} C ${x + rx * k} ${y - ry} ${x + rx} ${y - ry * k} ${x + rx} ${y} Z`
}

/** Editable primitives when lossless scene translation is possible; complex SVGs
 * retain their original sanitized vector image rather than losing visual content. */
export function importEditableSVG(source: string, width: number, height: number, name: string): SceneDocument | null {
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
  const editableTags = new Set(['svg', 'g', 'title', 'desc', 'path', 'rect', 'ellipse', 'circle', 'line', 'polyline', 'polygon'])
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!editableTags.has(element.localName) || element.hasAttribute('class') || [...element.attributes].some(attribute => /url\s*\(/i.test(attribute.value) || ['filter', 'clip-path', 'mask', 'stroke-dashoffset', 'vector-effect'].includes(attribute.name))) return null
    const style = (element as SVGElement).style
    if (style && [...style].some(property => !['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'display', 'visibility'].includes(property))) return null
    if (element.hasAttribute('stroke-linecap') && element.getAttribute('stroke-linecap') !== 'butt') return null
    if (element.hasAttribute('stroke-linejoin') && element.getAttribute('stroke-linejoin') !== 'round') return null
  }
  const viewBox = (root.getAttribute('viewBox') ?? `0 0 ${width} ${height}`).split(/[\s,]+/).map(Number)
  // Native scene paths stretch; preserve nonuniform SVG aspect fitting as an image.
  if (Math.abs(width / viewBox[2] - height / viewBox[3]) > .0001 && root.getAttribute('preserveAspectRatio') !== 'none') return null
  const store = new SceneStore(), frame = store.add('frame', { name, width, height, clipContent: false, style: { fill: null } })
  interface Paint { fill: string | null; stroke: string | null; width: number; opacity: number; fillOpacity: number; strokeOpacity: number; fillRule: 'evenodd' | 'nonzero' }
  const alpha = (paint: string, opacity: number) => opacity >= 1 ? paint : `color-mix(in srgb, ${paint} ${opacity * 100}%, transparent)`
  const visit = (element: Element, parentMatrix: DOMMatrix, inherited: Paint) => {
    if (element.localName === 'title' || element.localName === 'desc') return
    const read = (property: string) => (element as SVGElement).style?.getPropertyValue(property) || element.getAttribute(property)
    if (read('display') === 'none' || read('visibility') === 'hidden') return
    const paint: Paint = { ...inherited }
    for (const key of ['fill', 'stroke'] as const) { const value = read(key); if (value) paint[key] = value === 'none' ? null : value }
    if (read('stroke-width')) paint.width = Math.max(0, parseFloat(read('stroke-width')!) || 0)
    if (read('opacity')) paint.opacity *= Math.max(0, Math.min(1, parseFloat(read('opacity')!) || 0))
    if (read('fill-opacity')) paint.fillOpacity = Math.max(0, Math.min(1, parseFloat(read('fill-opacity')!) || 0))
    if (read('stroke-opacity')) paint.strokeOpacity = Math.max(0, Math.min(1, parseFloat(read('stroke-opacity')!) || 0))
    if (read('fill-rule')) paint.fillRule = read('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero'
    const transform = (element as SVGGraphicsElement).transform?.baseVal.consolidate()?.matrix
    const matrix = transform ? parentMatrix.multiply(new DOMMatrix([transform.a, transform.b, transform.c, transform.d, transform.e, transform.f])) : parentMatrix
    const sx = Math.hypot(matrix.a, matrix.b), sy = Math.hypot(matrix.c, matrix.d)
    if (paint.stroke && (Math.abs(sx - sy) > .0001 || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > .0001)) throw new Error('SVG stroke transform cannot be represented.')
    if (element.localName === 'svg' || element.localName === 'g') { for (const child of [...element.children]) visit(child, matrix, paint); return }
    const d = shapePath(element)
    if (!d.trim()) return
    const contours: PathContour[] = parsePath(d).map(contour => ({ ...contour, anchors: contour.anchors.map(anchor => ({ ...matrix.transformPoint(anchor), x: matrix.transformPoint(anchor).x, y: matrix.transformPoint(anchor).y, in: anchor.in ? { x: matrix.transformPoint(anchor.in).x, y: matrix.transformPoint(anchor.in).y } : undefined, out: anchor.out ? { x: matrix.transformPoint(anchor.out).x, y: matrix.transformPoint(anchor.out).y } : undefined })) }))
    const bounds = pathBounds(contours, paint.stroke ? paint.width * sx / 2 : 0)
    const dash = (element.getAttribute('stroke-dasharray') ?? '').split(/[\s,]+/).map(Number).filter(value => Number.isFinite(value) && value >= 0).map(value => value * sx)
    store.add('path', { parentId: frame.id, name: element.getAttribute('id') || element.localName, ...bounds, d: serializePath(contours), viewBox: [bounds.x, bounds.y, bounds.width, bounds.height], fillRule: paint.fillRule, style: { fill: paint.fill ? alpha(paint.fill, paint.fillOpacity) : null, stroke: paint.stroke ? { color: alpha(paint.stroke, paint.strokeOpacity), width: paint.width * sx, dash } : null, opacity: paint.opacity } })
  }
  try {
    const matrix = new DOMMatrix().scale(width / viewBox[2], height / viewBox[3]).translate(-viewBox[0], -viewBox[1])
    visit(root, matrix, { fill: '#080808', stroke: null, width: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1, fillRule: 'nonzero' })
  } catch { return null }
  return store.getChildren(frame.id).length ? store.toJSON() : null
}
