export interface ArchiveFile { readonly name: string; readonly blob: Blob }
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function blobChecksum(blob: Blob, signal?: AbortSignal): Promise<number> {
  const reader = blob.stream().getReader()
  let crc = 0xffffffff, processed = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      for (const byte of value) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
      processed += value.length
      if (processed >= 1_000_000) { processed = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)) }
    }
    return (crc ^ 0xffffffff) >>> 0
  } finally { await reader.cancel(); reader.releaseLock() }
}

/** ZIP STORE: images are already compressed; avoid recompressing them on the UI thread. */
export async function createZIP(files: readonly ArchiveFile[], signal?: AbortSignal): Promise<Blob> {
  if (!files.length || files.length > 1000) throw new Error('Choose between 1 and 1,000 assets per export.')
  const parts: BlobPart[] = [], directory: BlobPart[] = []
  let offset = 0, directorySize = 0
  for (const file of files) {
    signal?.throwIfAborted()
    const name = new TextEncoder().encode(file.name)
    if (!name.length || name.length > 65535 || /[/\\]/.test(file.name) || file.name === '..') throw new Error('Invalid archive filename.')
    if (offset + file.blob.size + name.length + 30 > MAX_ARCHIVE_BYTES) throw new Error('This batch exceeds 512 MB. Export fewer assets at a time.')
    const crc = await blobChecksum(file.blob, signal)
    signal?.throwIfAborted()
    const local = new Uint8Array(30), header = new DataView(local.buffer)
    header.setUint32(0, 0x04034b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 0x0800, true) // UTF-8 filenames
    header.setUint16(12, 0x0021, true) // 1980-01-01, deterministic ZIP timestamp
    header.setUint32(14, crc, true)
    header.setUint32(18, file.blob.size, true)
    header.setUint32(22, file.blob.size, true)
    header.setUint16(26, name.length, true)
    parts.push(local, name, file.blob)
    const central = new Uint8Array(46), entry = new DataView(central.buffer)
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(14, 0x0021, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, file.blob.size, true)
    entry.setUint32(24, file.blob.size, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    directory.push(central, name)
    directorySize += central.length + name.length
    offset += local.length + name.length + file.blob.size
  }
  const end = new Uint8Array(22), footer = new DataView(end.buffer)
  footer.setUint32(0, 0x06054b50, true)
  footer.setUint16(8, files.length, true)
  footer.setUint16(10, files.length, true)
  footer.setUint32(12, directorySize, true)
  footer.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end], { type: 'application/zip' })
}
