import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, readdir, lstat, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { canonical } from '../src/cloud/model.ts'
import type { CloudProject } from '../src/cloud/model.ts'
import { parseProject } from '../src/io/project.ts'

import { AppStorage } from './app-storage.ts'

export function httpError(status: number, message: string) { return Object.assign(new Error(message), { status }) }
export function safeId(id: unknown, label = 'project ID'): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(id)) throw httpError(400, `Invalid ${label}`)
  return id
}
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
export async function atomicFile(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
    await handle.close()
    await rename(temp, path)
  } finally {
    await handle.close().catch(() => {})
    await unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}
export { AppStorage }
/** A single service owns the volume. Serialize read/compare/write, including MCP edits. */
export class Storage {
  private pending = new Map<string, Promise<unknown>>()
  readonly root: string
  readonly apps: AppStorage
  constructor(root: string) {
    this.root = resolve(root)
    this.apps = new AppStorage(this.root)
  }
  async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(fn)
    this.pending.set(key, next)
    try { return await next } finally { if (this.pending.get(key) === next) this.pending.delete(key) }
  }
  private async directory(user: string) {
    const projects = join(this.root, 'projects')
    const path = join(projects, safeId(user))
    await mkdir(projects, { recursive: true, mode: 0o700 })
    const parent = await lstat(projects)
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw httpError(403, 'Project directory must not be a symlink')
    await mkdir(path, { recursive: true, mode: 0o700 })
    const account = await lstat(path)
    if (!account.isDirectory() || account.isSymbolicLink()) throw httpError(403, 'Account directory must not be a symlink')
    return path
  }
  async read(user: string, id: string): Promise<CloudProject | null> {
    const path = join(await this.directory(user), `${safeId(id)}.paper.json`)
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await handle.stat()
        if (!info.isFile()) throw httpError(403, 'Project must be a regular file')
        if (info.size > 17 * 1024 * 1024) throw httpError(413, 'Project too large')
        return JSON.parse(await handle.readFile('utf8')) as CloudProject
      } finally { await handle.close() }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async list(user: string) {
    const directory = await this.directory(user)
    const ids = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.paper.json')).map(entry => entry.name.slice(0, -11))
    return Promise.all(ids.map(async id => {
      const record = (await this.read(user, id))!
      return { id, name: record.document.name, revision: record.revision, updatedAt: record.updatedAt, createdAt: record.createdAt }
    }))
  }
  async put(user: string, id: string, document: unknown, expected: unknown, updatedAt: unknown, activity?: CloudProject['activity']): Promise<CloudProject> {
    return this.locked(`${user}/${id}`, async () => {
      const current = await this.read(user, id)
      if (expected !== (current?.revision ?? null)) throw Object.assign(httpError(409, 'Revision conflict'), { current })
      return this.write(user, id, document, updatedAt, current, activity)
    })
  }
  async write(user: string, id: string, value: unknown, updatedAt: unknown, current: CloudProject | null, activity?: CloudProject['activity']) {
    if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || updatedAt > Date.now() + 60_000) throw httpError(400, 'Invalid update timestamp')
    let document
    try { document = parseProject(JSON.stringify(value)) } catch (error) { throw httpError(400, error instanceof Error ? error.message : 'Invalid project') }
    const record: CloudProject = { id: safeId(id), document, revision: hash(canonical(document)), updatedAt, createdAt: current?.createdAt ?? Date.now(), ...(activity ? { activity } : {}) }
    await atomicFile(join(await this.directory(user), `${id}.paper.json`), record)
    return record
  }
}
