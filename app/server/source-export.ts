import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { normalizeAndValidatePath, validateAppProject } from '../src/make/manifest.ts'
import { exportAppPackage, type AppAssetExportRecord } from '../src/make/assets.ts'
import type { AppProject } from '../src/make/types.ts'

// This kit is produced from Paper's trusted build, never from app source or packages.
export interface SourceExportKit { files: Record<string, string> }
let kit: Promise<SourceExportKit> | undefined
function exportKit(): Promise<SourceExportKit> {
  return kit ??= readFile(new URL('./source-export-kit.json', import.meta.url), 'utf8')
    .catch(error => {
      if (error.code !== 'ENOENT') throw error
      // Source-level browser tests use the same release artifact.
      return readFile(new URL('./dist/server/source-export-kit.json', import.meta.url), 'utf8')
    }).then(text => JSON.parse(text) as SourceExportKit).catch(error => { kit = undefined; throw error })
}

export function sourceExportFingerprint(project: AppProject): string {
  return createHash('sha256').update(JSON.stringify(validateAppProject(project))).digest('hex')
}

// ZIP STORE, fixed DOS epoch, UTF-8 names, regular files only. No shell/archive
// process, host paths, symlinks, generated config, or timestamps enter the ZIP.
export function createSourceZip(entries: ReadonlyMap<string, Uint8Array>): Buffer {
  const local: Buffer[] = [], directory: Buffer[] = []
  let offset = 0
  const paths = [...entries.keys()].sort()
  const seen = new Set<string>()
  for (const path of paths) {
    if (normalizeAndValidatePath(path) !== path) throw new Error('Non-canonical archive path')
    if (/[\ud800-\udfff]/.test(path) || Buffer.from(path, 'utf8').toString('utf8') !== path) {
      throw new Error('Invalid UTF-8 in archive path')
    }
    const folded = path.normalize('NFC').toLowerCase()
    if (seen.has(folded) || paths.some(other => {
      const otherFolded = other.normalize('NFC').toLowerCase()
      return other !== path && otherFolded.startsWith(folded + '/')
    })) throw new Error('Conflicting archive path')
    seen.add(folded)
    const name = Buffer.from(path), bytes = Buffer.from(entries.get(path)!)
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, bytes)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    directory.push(central, name); offset += header.length + name.length + bytes.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10)
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, central, end])
}

export async function exportRunnableSource(input: AppProject, records: readonly AppAssetExportRecord[]): Promise<Buffer> {
  const project = validateAppProject(input)
  exportAppPackage(project, records) // Fail closed on missing, extra or invalid local assets.
  const entries = new Map<string, Uint8Array>()
  const add = (path: string, text: string) => entries.set(path, Buffer.from(text))
  for (const [path, content] of Object.entries((await exportKit()).files)) add(path, content)
  // Generated files are always data below source/, never root build configuration.
  for (const file of Object.values(project.files)) add(`source/${file.path}`, file.content)
  const sortedRecords = [...records].sort((a, b) => a.id.localeCompare(b.id))
  const assets = sortedRecords.map(({ dataBase64, ...record }) => {
    const path = `assets/${record.id}${record.name.slice(record.name.lastIndexOf('.')).toLowerCase()}`
    entries.set(path, Buffer.from(dataBase64, 'base64'))
    return { ...record, localPath: path }
  })
  add('paper-app.json', JSON.stringify({ ...project, annotations: [] }, null, 2) + '\n')
  add('assets.json', JSON.stringify(assets, null, 2) + '\n')
  add('README.md', `# ${project.name.replace(/[\r\n]/g, ' ')}\n\nExported from Paper Make, revision ${project.revision}.\n\nRequires Node.js 22 or newer. Run:\n\n\`\`\`sh\nnpm ci --ignore-scripts\nnpm run build\nnpm start\n\`\`\`\n\nOpen http://127.0.0.1:3000. Edit files in source/ and rebuild. The source list and entry point are in paper-app.json. Local image/font bytes are in assets/.\n\nBuilds use Paper's static compiler and frozen React, React DOM, Lucide and Paper Shaders runtime. TypeScript, PostCSS and their reviewed transitive dependencies are bundled at fixed versions with integrity metadata; installation needs no network. Generated package manifests, scripts and configs remain inert source data. No generated code runs during the build. The built app keeps the preview network restrictions.\n\nThis archive contains app source and assets; account credentials and chat history are excluded.\n`)
  return createSourceZip(entries)
}
