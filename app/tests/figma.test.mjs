import test from 'node:test'
import assert from 'node:assert/strict'
import { decodePathBlob, importFigmaNodes } from '../src/io/figma.ts'
import { decodeKiwi } from '../src/io/figmaBinary.ts'

test('figma: decodePathBlob extracts binary command streams into SVG path strings', () => {
  // Commands: 1 = Move (2 floats), 2 = Line (2 floats), 3 = Quad (4 floats), 4 = Cubic (6 floats), 0 = Close (0 floats)
  const buffer = new ArrayBuffer(1 + 8 + 1 + 8 + 1)
  const view = new DataView(buffer)
  let offset = 0
  view.setUint8(offset++, 1) // Move
  view.setFloat32(offset, 10, true); offset += 4
  view.setFloat32(offset, 20, true); offset += 4
  view.setUint8(offset++, 2) // Line
  view.setFloat32(offset, 30, true); offset += 4
  view.setFloat32(offset, 40, true); offset += 4
  view.setUint8(offset++, 0) // Close

  const path = decodePathBlob(new Uint8Array(buffer))
  assert.equal(path, 'M 10 20 L 30 40 Z')
})

test('figma: decodePathBlob throws on corrupted or truncated blobs', () => {
  // Truncated buffer
  const truncated = new Uint8Array([1, 0, 0, 0])
  assert.throws(() => decodePathBlob(truncated), /Invalid Figma vector geometry/)

  // Invalid command code
  const invalidCode = new Uint8Array([9, 0, 0, 0, 0])
  assert.throws(() => decodePathBlob(invalidCode), /Invalid Figma vector geometry/)
})

test('figma: importFigmaNodes converts frames, text, rectangles, lines, and ellipses into SceneElements', () => {
  const result = importFigmaNodes({
    nodes: [
      {
        id: 'frame-1',
        type: 'FRAME',
        name: 'Artboard',
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        fills: [{ type: 'SOLID', color: { r: 0.93, g: 0.92, b: 0.88, a: 1 } }],
        children: [
          {
            id: 'rect-1',
            type: 'RECTANGLE',
            name: 'Button',
            x: 20,
            y: 20,
            width: 160,
            height: 48,
            cornerRadius: 8,
            fills: [{ type: 'SOLID', color: { r: 0.51, g: 0.68, b: 0.93, a: 1 } }]
          },
          {
            id: 'text-1',
            type: 'TEXT',
            name: 'Label',
            x: 40,
            y: 32,
            characters: 'Click Me',
            fontSize: 16,
            fontName: { family: 'Inter', style: 'Bold' },
            fills: [{ type: 'SOLID', color: { r: 0.03, g: 0.03, b: 0.03, a: 1 } }]
          },
          {
            id: 'ellipse-1',
            type: 'ELLIPSE',
            name: 'Dot',
            x: 200,
            y: 20,
            width: 48,
            height: 48,
            fills: [{ type: 'SOLID', color: { r: 0.13, g: 0.13, b: 0.13, a: 1 } }]
          },
          {
            id: 'line-1',
            type: 'LINE',
            name: 'Divider',
            x: 20,
            y: 100,
            width: 200,
            height: 0,
            strokeWeight: 2,
            strokes: [{ type: 'SOLID', color: { r: 0.03, g: 0.03, b: 0.03, a: 1 } }]
          }
        ]
      }
    ]
  })

  assert.equal(result.rootIds.length, 1)
  const rootId = result.rootIds[0]
  const frame = result.elements[rootId]
  assert.equal(frame.type, 'frame')
  assert.equal(frame.name, 'Artboard')
  assert.equal(frame.children.length, 4)

  const children = frame.children.map(id => result.elements[id])
  const [rect, text, ellipse, line] = children

  assert.equal(rect.type, 'rectangle')
  assert.equal(rect.width, 160)
  assert.equal(rect.cornerRadius, 8)

  assert.equal(text.type, 'text')
  assert.equal(text.text, 'Click Me')
  assert.equal(text.fontSize, 16)

  assert.equal(ellipse.type, 'ellipse')
  assert.equal(ellipse.width, 48)

  assert.equal(line.type, 'path')
})

test('figma: importFigmaNodes detects cycles and rejects corrupted hierarchy', () => {
  const cyclical = [
    { id: '1', type: 'FRAME', name: 'A', children: [{ id: '2', type: 'FRAME', name: 'B', children: [{ id: '1', type: 'FRAME', name: 'A' }] }] }
  ]
  assert.throws(() => importFigmaNodes(cyclical), /duplicate node IDs/)
})

test('figma: decodeKiwi parses valid message schemas and structures', () => {
  // Build a minimal schema: 1 definition named "Message" (kind 1 = STRUCT) with field "val" (type = -3 = INT, id 1)
  // Writer helper
  const schemaBytes = []
  const writeUint = (n) => {
    while (n >= 128) { schemaBytes.push((n & 127) | 128); n >>>= 7 }
    schemaBytes.push(n)
  }
  const writeString = (s) => {
    for (const c of s) schemaBytes.push(c.charCodeAt(0))
    schemaBytes.push(0)
  }
  const writeInt = (n) => writeUint(n < 0 ? -n * 2 - 1 : n * 2)

  // Count = 1 definition
  writeUint(1)
  // Name = Message
  writeString('Message')
  // Kind = 1 (STRUCT)
  schemaBytes.push(1)
  // Field count = 1
  writeUint(1)
  // Field 0: name = "val", type = -3 (int), array = 0, id = 1
  writeString('val')
  writeInt(-3)
  schemaBytes.push(0) // not array
  writeUint(1)

  // Message payload: STRUCT field value (int 42)
  const messageBytes = []
  const writeMsgUint = (n) => {
    while (n >= 128) { messageBytes.push((n & 127) | 128); n >>>= 7 }
    messageBytes.push(n)
  }
  const writeMsgInt = (n) => writeMsgUint(n < 0 ? -n * 2 - 1 : n * 2)
  writeMsgInt(42)

  const parsed = decodeKiwi(new Uint8Array(schemaBytes), new Uint8Array(messageBytes))
  assert.equal(parsed.val, 42)
})
