import type { Point } from '../canvas/types.ts'
import { parsePath } from '../scene/pathGeometry.ts'
import type { PathAnchor } from '../scene/pathGeometry.ts'

const number = (n: number) => String(n).replace(/^(-?)0\./, '$1.')
const values = (ns: readonly number[]) => ns.map(number).join(' ').replace(/ -/g, '-')
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/** Lossless export-only compaction. Keep editor nodes and cached outlines intact. */
export function optimizeSVGPath(d: string): string {
  let contours
  try { contours = parsePath(d) } catch { return d }
  const tokens = d.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[a-z]/gi) ?? []
  const compact = tokens.join(' ').replace(/\s*([a-df-z])\s*/gi, '$1').replace(/ -/g, '-')
  // Keep analytical arcs/quadratics and their original parameterization. The
  // editor parser converts these to cubics, which would make export lossy.
  if (/[aqt]/i.test(d)) return compact
  let output = '', cursor: Point = { x: 0, y: 0 }, previous = '', control: Point | null = null
  const emit = (command: string, points: readonly Point[]) => {
    const absolute = points.flatMap(p => [p.x, p.y])
    const coords = command === 'H' ? [points[0].x] : command === 'V' ? [points[0].y] : absolute
    const spelling = (op: string, ns: readonly number[]) => (op === previous && op.toUpperCase() !== 'M' ? ' ' : op) + values(ns)
    const candidates = [{ command, text: spelling(command, coords) }]
    const relative = points.map(p => ({ x: p.x - cursor.x, y: p.y - cursor.y }))
    // Relative subtraction may round in IEEE-754. Only use it if adding the
    // delta back recovers every original coordinate exactly.
    if (relative.every((p, i) => p.x + cursor.x === points[i].x && p.y + cursor.y === points[i].y)) {
      const ns = command === 'H' ? [relative[0].x] : command === 'V' ? [relative[0].y] : relative.flatMap(p => [p.x, p.y])
      candidates.push({ command: command.toLowerCase(), text: spelling(command.toLowerCase(), ns) })
    }
    const best = candidates.reduce((a, b) => b.text.length < a.text.length ? b : a)
    output += best.text; previous = best.command; cursor = points.at(-1)!
  }
  const segment = (a: PathAnchor, b: PathAnchor) => {
    if (a.out || b.in) {
      const out = a.out ?? a, incoming = b.in ?? b
      const reflected = control ? { x: 2 * a.x - control.x, y: 2 * a.y - control.y } : a
      const smooth = /[cs]/i.test(previous) && same(out, reflected)
      emit(smooth ? 'S' : 'C', smooth ? [incoming, b] : [out, incoming, b])
      control = incoming
    } else {
      emit(a.y === b.y ? 'H' : a.x === b.x ? 'V' : 'L', [b]); control = null
    }
  }
  for (const { anchors, closed } of contours) {
    if (!anchors.length) continue
    emit('M', [anchors[0]]); control = null
    for (let i = 1; i < anchors.length; i++) segment(anchors[i - 1], anchors[i])
    if (closed) {
      if (anchors.at(-1)!.out || anchors[0].in) segment(anchors.at(-1)!, anchors[0])
      output += 'Z'; previous = 'Z'; cursor = anchors[0]; control = null
    }
  }
  return output.length < compact.length ? output : compact
}
