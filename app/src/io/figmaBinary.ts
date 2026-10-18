import { MAX_IMPORT_BYTES } from './project.ts'

interface Field { name: string; type: number; array: boolean; id: number }
interface Definition { name: string; kind: number; fields: Field[]; byId: Map<number, Field> }

/** A bounded interpreter for the bundled Kiwi schema. Never evaluates clipboard code.
 * Wire format: https://github.com/evanw/kiwi (schema and primitive encodings).
 * Clipboard archive: fig-kiwi header + version + length-prefixed raw-deflate blocks.
 */
class BinaryReader {
  offset = 0
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) { this.bytes = bytes }
  byte(): number {
    if (this.offset >= this.bytes.length) throw new Error('Truncated Figma clipboard data.')
    return this.bytes[this.offset++]
  }
  uint(): number {
    let result = 0
    for (let i = 0; i < 5; i++) {
      const byte = this.byte()
      if (i === 4 && byte > 15) throw new Error('Invalid Figma integer.')
      result += (byte & 127) * 2 ** (i * 7)
      if (byte < 128) return result
    }
    throw new Error('Invalid Figma integer.')
  }
  int(): number { const n = this.uint(); return n % 2 ? -(n + 1) / 2 : n / 2 }
  float(): number {
    const first = this.byte()
    if (!first) return 0
    const encoded = (first | this.byte() << 8 | this.byte() << 16 | this.byte() << 24) >>> 0
    const buffer = new ArrayBuffer(4), view = new DataView(buffer)
    view.setUint32(0, ((encoded << 23) | (encoded >>> 9)) >>> 0, true)
    return view.getFloat32(0, true)
  }
  wide(signed: boolean): string {
    let value = 0n
    for (let i = 0; i < 9; i++) {
      const byte = this.byte()
      value |= BigInt(i === 8 ? byte : byte & 127) << BigInt(7 * i)
      if (byte < 128 || i === 8) return (signed ? value & 1n ? -(value + 1n) / 2n : value / 2n : value).toString()
    }
    throw new Error('Invalid Figma integer.')
  }
  string(): string {
    const start = this.offset
    while (this.byte()) { /* UTF-8 strings are null terminated. */ }
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(start, this.offset - 1))
  }
  block(size: number): Uint8Array {
    if (size > this.bytes.length - this.offset) throw new Error('Truncated Figma clipboard block.')
    const block = this.bytes.subarray(this.offset, this.offset + size); this.offset += size; return block
  }
}

export function decodeKiwi(schemaBytes: Uint8Array, messageBytes: Uint8Array): Record<string, unknown> {
  const schema = new BinaryReader(schemaBytes), count = schema.uint(), definitions: Definition[] = []
  if (count > 4096) throw new Error('Figma schema is too large.')
  let fieldsRead = 0
  for (let i = 0; i < count; i++) {
    const name = schema.string(), kind = schema.byte(), fieldCount = schema.uint(), fields: Field[] = []
    if (kind > 2 || (fieldsRead += fieldCount) > 65536) throw new Error('Invalid Figma schema.')
    for (let f = 0; f < fieldCount; f++) fields.push({ name: schema.string(), type: schema.int(), array: !!(schema.byte() & 1), id: schema.uint() })
    definitions.push({ name, kind, fields, byId: new Map(fields.map(field => [field.id, field])) })
  }
  const reader = new BinaryReader(messageBytes)
  let valuesRead = 0
  const read = (type: number, depth: number): unknown => {
    if (++valuesRead > 1_000_000 || depth > 100) throw new Error('Figma clipboard is too complex.')
    if (type < 0) {
      switch (type) {
        case -1: return !!reader.byte()
        case -2: return reader.byte()
        case -3: return reader.int()
        case -4: return reader.uint()
        case -5: return reader.float()
        case -6: return reader.string()
        case -7: return reader.wide(true)
        case -8: return reader.wide(false)
        default: throw new Error('Unknown Figma primitive type.')
      }
    }
    const definition = definitions[type]
    if (!definition) throw new Error('Unknown Figma schema type.')
    if (definition.kind === 0) {
      const id = reader.uint(), field = definition.byId.get(id)
      if (!field) throw new Error('Unknown Figma enum value.')
      return field.name
    }
    const result: Record<string, unknown> = Object.create(null)
    const fieldValue = (field: Field) => {
      if (!field.array) return read(field.type, depth + 1)
      const length = reader.uint()
      if (field.type === -2) return reader.block(length)
      if (length > 100_000 || length + valuesRead > 1_000_000) throw new Error('Figma array is too large.')
      return Array.from({ length }, () => read(field.type, depth + 1))
    }
    if (definition.kind === 1) for (const field of definition.fields) result[field.name] = fieldValue(field)
    else {
      while (true) {
        const id = reader.uint()
        if (!id) break
        const field = definition.byId.get(id)
        if (!field) throw new Error('Unknown Figma message field.')
        result[field.name] = fieldValue(field)
      }
    }
    return result
  }
  const root = definitions.findIndex(definition => definition.name === 'Message')
  if (root < 0) throw new Error('Figma clipboard has no Message schema.')
  return read(root, 0) as Record<string, unknown>
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMPORT_BYTES) throw new Error('Expanded Figma clipboard exceeds 16 MB.')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

export async function decodeFigmaArchive(bytes: Uint8Array): Promise<Record<string, unknown>> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('Figma clipboard exceeds 16 MB.')
  const reader = new BinaryReader(bytes)
  if (new TextDecoder().decode(reader.block(8)) !== 'fig-kiwi') throw new Error('Unsupported Figma clipboard format. Try Copy as SVG in Figma.')
  reader.block(4) // Archive version; the bundled schema supplies field definitions.
  const block = () => { const sizeBytes = reader.block(4); return reader.block(new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 4).getUint32(0, true)) }
  const schemaBlock = block(), messageBlock = block()
  const [schema, message] = await Promise.all([inflate(schemaBlock), inflate(messageBlock)])
  return decodeKiwi(schema, message)
}
