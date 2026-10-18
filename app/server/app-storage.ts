import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import {
  migrateAppProject, parseAppProject, parseJsonStrict, serializeAppProject,
  validateAppProject, normalizeAndValidatePath, APP_PROJECT_LIMITS,
} from '../src/make/manifest.ts'
import type { AppCheckpointMetadata, AppProject, AppProjectSummary, AppRevisionRecord, AppSourceFile } from '../src/make/types.ts'
import { computeBoundedDiff } from '../src/make/diff.ts'
import {
  APP_ASSET_LIMITS,
  type AppAsset,
  type AppAssetExportRecord,
  type AppProjectPackage,
  validateAssetBuffer,
  validateAssetId,
  generateAssetId,
  exportAppPackage,
  decodeAssetBase64,
  AppAssetValidationError,
} from '../src/make/assets.ts'
import { httpError, safeId, hash } from './storage.ts'
import type { AppPublication } from '../src/make/types.ts'
import type { AppAccessGrant, SharedApp, SharedAppSummary } from '../src/make/sharing.ts'

interface PublicationState {
  stamp: string
  generation: string
  current: AppPublication | null
  versions: AppPublication[]
}

interface StoredAppAccessGrant extends AppAccessGrant { hash: string }

// Like scene storage, one service process owns the volume. Share locks across
// store instances in that process; reads use immutable snapshots without locks.
const pending = new Map<string, Promise<unknown>>()
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

function checkpointMetadata(input: unknown, baseRevision: number, status: number): AppCheckpointMetadata {
  const invalid = () => httpError(status, 'Invalid checkpoint metadata')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid()
  const record = input as Record<string, unknown>
  if (Object.keys(record).some(key => !['source', 'turnId', 'restoredFromRevision'].includes(key))) throw invalid()
  const { source, turnId, restoredFromRevision } = record
  if (!['initial', 'chat', 'manual', 'inspector', 'assets', 'restore', 'legacy'].includes(source as string) ||
      (source === 'initial' && baseRevision !== 0) ||
      (turnId !== undefined && (source !== 'chat' || typeof turnId !== 'string' || !turnId || turnId.length > 200)) ||
      (source === 'restore'
        ? !Number.isSafeInteger(restoredFromRevision) || Number(restoredFromRevision) < 1 || Number(restoredFromRevision) >= baseRevision
        : restoredFromRevision !== undefined)) throw invalid()
  return { source: source as AppCheckpointMetadata['source'], baseRevision,
    ...(turnId !== undefined ? { turnId: turnId as string } : {}),
    ...(restoredFromRevision !== undefined ? { restoredFromRevision: restoredFromRevision as number } : {}) }
}

export class AppStorage {
  readonly root: string

  constructor(root: string) { this.root = resolve(root) }

  /** Serialize private server artifacts with source deletion/recreation. Never exposed through exports. */
  async withOwnerAppDirectory<T>(owner: string, id: string, operation: (directory: string) => Promise<T>): Promise<T> {
    safeId(owner, 'owner ID'); safeId(id, 'app ID')
    return this.locked(owner, id, async () => {
      if (!await this.read(owner, id)) throw httpError(404, 'App project not found')
      return operation(await this.appDirectory(owner, id))
    })
  }

  private async permissionState(owner: string, id: string): Promise<StoredAppAccessGrant[]> {
    if (!await this.read(owner, id)) throw httpError(404, 'App project not found')
    try {
      const value: unknown = JSON.parse(await this.readText(join(await this.appDirectory(owner, id), 'permissions.json'), 64 * 1024))
      if (!Array.isArray(value) || value.length > 100 || value.some(g => !g || typeof g !== 'object' ||
        typeof g.accountId !== 'string' || !/^[a-f0-9]{64}$/.test(g.accountId) ||
        !['viewer', 'editor'].includes(g.role) || !Number.isSafeInteger(g.revision) || g.revision < 1 ||
        typeof g.hash !== 'string' || !/^[a-f0-9]{64}$/.test(g.hash))) throw httpError(500, 'Invalid stored permissions')
      return value as StoredAppAccessGrant[]
    } catch (error) { if (missing(error)) return []; throw error }
  }

  async permissions(owner: string, id: string): Promise<AppAccessGrant[]> {
    return (await this.permissionState(owner, id)).map(({ hash: _hash, ...grant }) => grant)
  }

  private async writePermissions(owner: string, id: string, grants: StoredAppAccessGrant[]) {
    const directory = await this.appDirectory(owner, id)
    const temporary = join(directory, `.permissions_${randomUUID()}`)
    try {
      await this.writeText(temporary, JSON.stringify(grants))
      await fs.rename(temporary, join(directory, 'permissions.json'))
      await this.syncDirectory(directory)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }

  async setPermission(owner: string, id: string, accountId: string, grant: { role: AppAccessGrant['role']; revision?: number } | null) {
    return this.locked(owner, id, async () => {
      const grants = await this.permissionState(owner, id)
      if (owner === accountId) throw httpError(400, 'The owner role cannot be changed')
      let updated: StoredAppAccessGrant | undefined
      if (grant) {
        if (grant.revision === undefined) {
          const existing = grants.find(item => item.accountId === accountId)
          if (!existing) throw httpError(400, 'Choose an existing saved revision')
          // Role changes retain both the snapshot and its integrity binding.
          // Resolve under the writer lock so concurrent edits cannot advance it.
          updated = { ...existing, role: grant.role }
        } else {
          const record = await this.readRevision(owner, id, grant.revision)
          if (!record) throw httpError(400, 'Choose an existing saved revision')
          updated = { accountId, role: grant.role, revision: grant.revision, hash: record.hash }
        }
      }
      const next = grants.filter(item => item.accountId !== accountId)
      if (updated) next.push(updated)
      if (next.length > 100) throw httpError(413, 'A project supports up to 100 reviewers')
      await this.writePermissions(owner, id, next)
      return next.map(({ hash: _hash, ...value }) => value)
    })
  }

  private async sharedSnapshot(owner: string, id: string, accountId: string): Promise<SharedApp> {
    const grant = (await this.permissionState(owner, id)).find(item => item.accountId === accountId)
    if (!grant) throw httpError(404, 'Shared app not found')
    const record = await this.readRevision(owner, id, grant.revision)
    if (!record || record.hash !== grant.hash) throw httpError(404, 'Shared revision not found')
    return { ownerId: owner, role: grant.role, project: record.project }
  }

  // Serialize authorization, byte resolution and responses with revocation and
  // source writers. A revoked request cannot finish a later asset/compile read.
  async withShared<T>(owner: string, id: string, accountId: string, read: (shared: SharedApp) => Promise<T>): Promise<T> {
    return this.locked(owner, id, async () => read(await this.sharedSnapshot(owner, id, accountId)))
  }

  async listShared(accountId: string): Promise<SharedAppSummary[]> {
    await this.userDirectory(accountId)
    const result: SharedAppSummary[] = []
    for (const owner of await fs.readdir(join(this.root, 'apps'), { withFileTypes: true })) {
      if (!owner.isDirectory() || !/^[a-f0-9]{64}$/.test(owner.name) || owner.name === accountId) continue
      for (const app of await fs.readdir(await this.userDirectory(owner.name), { withFileTypes: true })) {
        if (!app.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(app.name)) continue
        try {
          await this.withShared(owner.name, app.name, accountId, async ({ role, project }) => {
            result.push({ ownerId: owner.name, id: project.id, name: project.name, role, revision: project.revision })
          })
        } catch (error) { if ((error as { status?: number }).status !== 404 && !missing(error)) throw error }
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.ownerId.localeCompare(b.ownerId))
  }

  async editShared(owner: string, id: string, accountId: string, input: unknown, expected: unknown,
    validate: (project: AppProject) => Promise<void>): Promise<SharedApp> {
    return this.locked(owner, id, async () => {
      const shared = await this.sharedSnapshot(owner, id, accountId)
      if (shared.role !== 'editor') throw httpError(403, 'Viewer access is read-only')
      const current = await this.read(owner, id)
      if (expected !== shared.project.revision || current?.revision !== expected) throw httpError(409, 'The owner must share the latest saved revision before you can edit')
      const project = validateAppProject(input)
      const candidate = validateAppProject({ ...shared.project, files: project.files, name: project.name,
        ...(project.description !== undefined ? { description: project.description } : {}) })
      if (serializeAppProject(project) !== serializeAppProject(candidate)) throw httpError(400, 'Editors may change source, name and description only')
      // Do not let a guessed asset ID in editor source resolve private bytes.
      await validate(candidate)
      const grants = await this.permissionState(owner, id)
      const timestamp = new Date().toISOString()
      const next = validateAppProject({ ...candidate, revision: current.revision + 1, updatedAt: timestamp })
      const checkpoint: AppCheckpointMetadata = { source: 'manual', baseRevision: current.revision }
      const nextHash = hash(serializeAppProject(next) + JSON.stringify(checkpoint))
      // Install the next grant before publishing under this same lock. An
      // interrupted write fails closed; failed source writes restore the grant.
      await this.writePermissions(owner, id, grants.map(g => g.accountId === accountId ? { ...g, revision: next.revision, hash: nextHash } : g))
      try {
        const saved = await this.publish(owner, id, candidate, current.revision, undefined, timestamp)
        return { ...shared, project: saved }
      } catch (error) { await this.writePermissions(owner, id, grants); throw error }
    })
  }

  private async publicationState(user: string, id: string): Promise<PublicationState | null> {
    try {
      const directory = await this.appDirectory(user, id)
      if (!await this.head(directory, id)) return null
      return JSON.parse(await this.readText(join(directory, 'publication.json'), 64 * 1024)) as PublicationState
    } catch (error) { if (missing(error)) return null; throw error }
  }

  async publication(user: string, id: string): Promise<AppPublication | null> {
    return (await this.publicationState(user, id))?.current ?? null
  }

  async publicationStamp(user: string, id: string): Promise<string | null> {
    return (await this.publicationState(user, id))?.stamp ?? null
  }

  // Shares the source writer lock: a validation result can only publish its
  // exact saved revision. Publication never modifies source or revision history.
  async setPublication(user: string, id: string, expectedRevision: number, origin: string, html: string | null,
    cancelled: () => boolean = () => false, expectedStamp?: string | null, expectedProject?: AppProject): Promise<AppPublication | null> {
    const expectedManifest = expectedProject ? serializeAppProject(expectedProject) : undefined
    return this.locked(user, id, async () => {
      const project = await this.read(user, id)
      if (!project) throw httpError(404, 'App project not found')
      // Revision numbers can repeat after deletion/recreation. Require the full
      // validated snapshot too, while holding the same lock as source writers.
      if (project.revision !== expectedRevision || (expectedManifest !== undefined && serializeAppProject(project) !== expectedManifest)) {
        throw httpError(409, 'App revision changed. Review and retry publication.')
      }
      if (cancelled()) throw httpError(422, 'Publication cancelled')
      const directory = await this.appDirectory(user, id)
      const path = join(directory, 'publication.json')
      const previous = await this.publicationState(user, id)
      if (expectedStamp !== undefined && (previous?.stamp ?? null) !== expectedStamp) {
        throw httpError(409, 'Publication changed during validation. Review and retry.')
      }
      if (html === null) {
        // Keep a tombstone so an in-flight first publication cannot resurrect
        // the app after an explicit unpublish (including the null -> null case).
        const tombstone = join(directory, `.publication_${randomUUID()}`)
        try {
          await this.writeText(tombstone, JSON.stringify({ stamp: randomUUID(), generation: '', current: null, versions: [] }))
          await fs.rename(tombstone, path)
          await this.syncDirectory(directory)
        } finally { await fs.rm(tombstone, { force: true }).catch(() => {}) }
        for (const name of await fs.readdir(directory)) {
          if (/^release-[a-f0-9-]{36}-[a-f0-9]{64}\.html$/.test(name)) await fs.rm(join(directory, name), { force: true }).catch(() => {})
        }
        return null
      }
      const version = hash(`${expectedRevision}\n${html}`)
      const generation = previous?.current ? previous.generation : randomUUID()
      const current: AppPublication = { revision: expectedRevision, version,
        url: `${origin}/r/${user}/${id}/${generation}/${version}/`, publishedAt: new Date().toISOString() }
      if (previous?.current?.version === version) return previous.current
      if ((previous?.versions.length ?? 0) >= 20) throw httpError(413, 'Release history is full. Unpublish before publishing again.')
      if (Buffer.byteLength(html) > 16 * 1024 * 1024) throw httpError(413, 'Published app is too large')
      const artifact = join(directory, `release-${generation}-${version}.html`)
      const staging = join(directory, `.publication_${randomUUID()}`)
      let installed = false
      try {
        // Immutable bytes are made durable before the single activation point.
        try { await this.writeText(artifact, html) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          if (await this.readText(artifact, 16 * 1024 * 1024) !== html) throw httpError(500, 'Release integrity check failed') }
        const state: PublicationState = { stamp: randomUUID(), generation, current, versions: [...(previous?.versions ?? []).filter(v => v.version !== version), current] }
        await this.writeText(staging, JSON.stringify(state))
        await this.syncDirectory(directory)
        if (cancelled()) throw httpError(422, 'Publication cancelled')
        await fs.rename(staging, path)
        installed = true
        await this.syncDirectory(directory)
      } catch (error) {
        if (installed) {
          if (previous) {
            await this.writeText(staging, JSON.stringify(previous))
            await fs.rename(staging, path)
          } else await fs.unlink(path)
          await this.syncDirectory(directory)
          installed = false
        }
        throw error
      } finally {
        await fs.rm(staging, { force: true }).catch(() => {})
        if (!installed && !previous?.versions.some(v => v.version === version)) {
          await fs.rm(artifact, { force: true }).catch(() => {})
        }
      }
      return current
    })
  }

  async publicPublication(user: string, id: string, generation: string, version: string): Promise<string | null> {
    const state = await this.publicationState(user, id)
    if (!state || state.generation !== generation || !state.versions.some(v => v.version === version)) return null
    const directory = await this.appDirectory(user, id)
    const html = await this.readText(join(directory, `release-${generation}-${version}.html`), 16 * 1024 * 1024)
    const metadata = state.versions.find(v => v.version === version)!
    if (hash(`${metadata.revision}\n${html}`) !== version) throw httpError(500, 'Release integrity check failed')
    // Recheck revocation after reading the immutable bytes.
    if ((await this.publicationState(user, id))?.generation !== generation) return null
    return html
  }

  private async locked<T>(user: string, id: string, fn: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([this.root, user, id])
    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(fn)
    pending.set(key, next)
    try { return await next }
    finally { if (pending.get(key) === next) pending.delete(key) }
  }

  private async directory(path: string, create = false): Promise<string> {
    let created = false
    if (create) {
      try { await fs.mkdir(path, { mode: 0o700 }); created = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const info = await fs.lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw httpError(403, 'Artifact directory must not be a symlink')
    if (created) await this.syncDirectory(dirname(path))
    return path
  }

  private async userDirectory(user: string): Promise<string> {
    safeId(user, 'user ID')
    // Only the configured volume's ancestors are trusted. Check every managed
    // directory before creating or reading any descendant.
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    await this.directory(this.root)
    const apps = await this.directory(join(this.root, 'apps'), true)
    return this.directory(join(apps, user), true)
  }

  private async appDirectory(user: string, id: string, create = false): Promise<string> {
    safeId(id, 'app ID')
    return this.directory(join(await this.userDirectory(user), id), create)
  }

  private async readText(path: string, maxBytes: number): Promise<string> {
    try {
      const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await handle.stat()
        if (!info.isFile()) throw httpError(403, 'Artifact must be a regular file')
        if (info.size > maxBytes) throw httpError(413, 'Artifact too large')
        // Bound the read itself too, even if a local writer changes file size.
        const buffer = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1))
        let offset = 0
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
          if (!bytesRead) break
          offset += bytesRead
        }
        if (offset > maxBytes || offset > info.size) throw httpError(413, 'Artifact changed size during read')
        return buffer.subarray(0, offset).toString('utf8')
      } finally { await handle.close() }
    } catch (error) {
      if (['ELOOP', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw httpError(403, 'Artifact must not be a symlink')
      }
      throw error
    }
  }

  private async head(appDir: string, id: string): Promise<AppProject | null> {
    let text: string
    try { text = await this.readText(join(appDir, 'manifest.json'), APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES) }
    catch (error) { if (missing(error)) return null; throw error }
    const project = parseAppProject(text)
    if (project.id !== id) throw httpError(500, 'Stored app ID mismatch')
    return project
  }

  async read(user: string, id: string): Promise<AppProject | null> {
    let appDir: string
    try { appDir = await this.appDirectory(user, id) }
    catch (error) { if (missing(error)) return null; throw error }
    return this.head(appDir, id)
  }

  private async revisionDirectory(appDir: string, revision: number): Promise<string> {
    const revisions = await this.directory(join(appDir, 'revisions'))
    return this.directory(join(revisions, String(revision)))
  }

  async readFile(user: string, id: string, filePath: string): Promise<AppSourceFile | null> {
    const path = normalizeAndValidatePath(filePath)
    let appDir: string
    try { appDir = await this.appDirectory(user, id) }
    catch (error) { if (missing(error)) return null; throw error }
    const head = await this.head(appDir, id)
    if (!head || !Object.hasOwn(head.files, path)) return null
    const snapshot = await this.revisionDirectory(appDir, head.revision)
    let directory = await this.directory(join(snapshot, 'files'))
    const segments = path.split('/')
    for (const segment of segments.slice(0, -1)) directory = await this.directory(join(directory, segment))
    const content = await this.readText(join(directory, segments.at(-1)!), APP_PROJECT_LIMITS.MAX_FILE_BYTES)
    if (content !== head.files[path].content) throw httpError(500, 'Stored source does not match manifest')
    return { path, content }
  }

  private async revision(appDir: string, id: string, revision: number): Promise<AppRevisionRecord> {
    const snapshot = await this.revisionDirectory(appDir, revision)
    // The envelope adds only bounded metadata to an already bounded manifest.
    const raw = parseJsonStrict(await this.readText(join(snapshot, 'record.json'), APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(500, 'Invalid stored revision')
    const record = raw as Record<string, unknown>
    const project = validateAppProject(record.project)
    const checkpoint = record.checkpoint as AppCheckpointMetadata | undefined
    if (checkpoint !== undefined) {
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) || checkpoint.baseRevision !== revision - 1) {
        throw httpError(500, 'Invalid stored checkpoint metadata')
      }
      const { baseRevision, ...metadata } = checkpoint
      checkpointMetadata(metadata, baseRevision, 500)
    }
    if (Object.keys(record).sort().join(',') !== (checkpoint ? 'checkpoint,hash,project,revision,timestamp' : 'hash,project,revision,timestamp') ||
        record.revision !== revision || project.revision !== revision || project.id !== id ||
        record.timestamp !== project.updatedAt || record.hash !== hash(serializeAppProject(project) + (checkpoint ? JSON.stringify(checkpoint) : ''))) {
      throw httpError(500, 'Stored revision integrity check failed')
    }
    return { revision, hash: record.hash as string, timestamp: project.updatedAt, project,
      checkpoint: checkpoint ?? { source: 'legacy', baseRevision: revision - 1 } }
  }

  async readRevision(user: string, id: string, revision: number): Promise<AppRevisionRecord | null> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw httpError(400, 'Invalid revision number')
    let appDir: string
    try { appDir = await this.appDirectory(user, id) }
    catch (error) { if (missing(error)) return null; throw error }
    const head = await this.head(appDir, id)
    if (!head || revision > head.revision) return null
    const record = await this.revision(appDir, id, revision)
    const previous = revision > 1 ? await this.revision(appDir, id, revision - 1) : null
    return { ...record, diff: computeBoundedDiff(previous?.project.files ?? {}, record.project.files,
      { baseRevision: revision - 1, targetRevision: revision }) }
  }

  async listRevisions(user: string, id: string): Promise<Array<Omit<AppRevisionRecord, 'project'>>> {
    let appDir: string
    try { appDir = await this.appDirectory(user, id) }
    catch (error) { if (missing(error)) return []; throw error }
    const head = await this.head(appDir, id)
    if (!head) return []
    const directory = await this.directory(join(appDir, 'revisions'))
    const entries = await fs.readdir(directory)
    const revisions = entries.filter(name => /^[1-9]\d*$/.test(name))
      .map(Number).filter(revision => Number.isSafeInteger(revision) && revision <= head.revision)
      .sort((a, b) => a - b)
    const records: Array<Omit<AppRevisionRecord, 'project'>> = []
    let previous: AppProject | undefined
    for (const revision of revisions) {
      const { project, ...record } = await this.revision(appDir, id, revision)
      records.push({ ...record, diff: computeBoundedDiff(previous?.files ?? {}, project.files,
        { baseRevision: revision - 1, targetRevision: revision, maxTotalDiffLines: 0 }) })
      previous = project
    }
    return records
  }

  async list(user: string): Promise<AppProjectSummary[]> {
    const userDir = await this.userDirectory(user)
    const entries = await fs.readdir(userDir, { withFileTypes: true })
    const summaries: AppProjectSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const project = await this.read(user, entry.name)
      if (project) {
        const { id, name, description, revision, release, preview, createdAt, updatedAt } = project
        summaries.push({ id, name, ...(description !== undefined ? { description } : {}), revision, release, preview, createdAt, updatedAt })
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }

  private async writeText(path: string, text: string): Promise<void> {
    const handle = await fs.open(path, 'wx', 0o600)
    try { await handle.writeFile(text, 'utf8'); await handle.sync() }
    finally { await handle.close() }
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await handle.sync() } finally { await handle.close() }
  }

  // Only a writer holding this app's lock may reclaim an interrupted write.
  // Readers never delete staging, snapshots, or a previous committed revision.
  private async cleanUncommitted(appDir: string, revision: number): Promise<void> {
    for (const entry of await fs.readdir(appDir)) {
      if (/^\.(staging|rollback)_[a-f0-9-]+$/.test(entry)) {
        await fs.rm(join(appDir, entry), { recursive: true, force: true })
      }
    }
    const revisions = await this.directory(join(appDir, 'revisions'), true)
    for (const name of await fs.readdir(revisions)) {
      if (/^[1-9]\d*$/.test(name) && Number(name) > revision) {
        await fs.rm(join(revisions, name), { recursive: true, force: true })
      }
    }
  }

  async put(user: string, id: string, input: unknown, expectedRevision: number | null,
    checkpoint?: Omit<AppCheckpointMetadata, 'baseRevision'>): Promise<AppProject> {
    safeId(user, 'user ID'); safeId(id, 'app ID')
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw httpError(400, 'Invalid expected revision')
    }
    // Validation must see the original descriptors/fields before any spread or
    // normalization. A malformed v1 manifest never falls back to a legacy draft.
    const inputProject = migrateAppProject(input)
    // Snapshot and validate provenance before yielding to a queued writer.
    const metadata = checkpoint === undefined ? undefined : checkpointMetadata(checkpoint, expectedRevision ?? 0, 400)
    return this.locked(user, id, () => this.publish(user, id, inputProject, expectedRevision, metadata))
  }

  private async publish(user: string, id: string, inputProject: AppProject, expectedRevision: number | null,
    metadata?: Omit<AppCheckpointMetadata, 'baseRevision'>, timestamp?: string): Promise<AppProject> {
      const current = await this.read(user, id)
      if (expectedRevision !== (current?.revision ?? null)) {
        throw Object.assign(httpError(409, 'Revision conflict'), { current })
      }
      const now = timestamp ?? new Date().toISOString()
      const candidate = validateAppProject({ ...inputProject, id, revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? now, updatedAt: now })
      // Private IDs may only refer to bytes already stored in this account/app.
      for (const assetId of candidate.assetIds) {
        if (assetId.startsWith('ast_')) await this.assetRecord(user, id, assetId)
      }
      const manifest = serializeAppProject(candidate)
      const checkpoint: AppCheckpointMetadata = { source: current ? 'manual' : 'initial', ...metadata, baseRevision: current?.revision ?? 0 }
      const record: AppRevisionRecord = { revision: candidate.revision, hash: hash(manifest + JSON.stringify(checkpoint)), timestamp: now, project: candidate, checkpoint }
      // Keep the revision envelope under the same strict JSON parser's cap.
      const recordText = JSON.stringify(record)
      if (Buffer.byteLength(recordText) > APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES) throw httpError(413, 'Revision too large')
      const appDir = await this.appDirectory(user, id, true)
      await this.cleanUncommitted(appDir, current?.revision ?? 0)
      const revisions = await this.directory(join(appDir, 'revisions'))
      const snapshot = join(revisions, String(candidate.revision))
      const staging = join(appDir, `.staging_${randomUUID()}`)
      const rollback = join(appDir, `.rollback_${randomUUID()}`)
      let installed = false
      let published = false
      try {
        await this.directory(staging, true)
        const files = await this.directory(join(staging, 'files'), true)
        const directories = new Set([files])
        for (const file of Object.values(candidate.files)) {
          const path = join(files, file.path)
          let directory = files
          for (const segment of file.path.split('/').slice(0, -1)) {
            directory = join(directory, segment)
            await this.directory(directory, true)
            directories.add(directory)
          }
          await this.writeText(path, file.content)
        }
        await this.writeText(join(staging, 'record.json'), recordText)
        await this.writeText(join(staging, 'manifest.json'), manifest)
        for (const directory of [...directories].sort((a, b) => b.length - a.length)) await this.syncDirectory(directory)
        await this.syncDirectory(staging)
        if (current) await this.writeText(rollback, serializeAppProject(current))
        await fs.rename(staging, snapshot)
        installed = true
        await this.syncDirectory(revisions)
        await this.syncDirectory(appDir)
        // The only publication point. Files and history are already durable;
        // replacing a regular manifest never removes the live app directory.
        await fs.rename(join(snapshot, 'manifest.json'), join(appDir, 'manifest.json'))
        published = true
        await this.syncDirectory(snapshot)
        await this.syncDirectory(appDir)
      } catch (error) {
        if (published) {
          // A post-rename directory-sync error is still a failed write. Restore
          // the prior head before reclaiming the unpublished candidate.
          try {
            if (current) await fs.rename(rollback, join(appDir, 'manifest.json'))
            else await fs.unlink(join(appDir, 'manifest.json'))
            published = false
            await this.syncDirectory(appDir)
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Artifact publication and rollback failed')
          }
        }
        throw error
      } finally {
        // Cleanup failure cannot turn a committed write into a false failure.
        // Abandoned paths are invisible and retried by the next locked writer.
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        await fs.rm(rollback, { force: true }).catch(() => {})
        if (installed && !published) await fs.rm(snapshot, { recursive: true, force: true }).catch(() => {})
      }
      return candidate
  }

  private async assetRecord(user: string, id: string, assetId: string): Promise<AppAssetExportRecord> {
    validateAssetId(assetId)
    try {
      const appDir = await this.appDirectory(user, id)
      const assetsDir = await this.directory(join(appDir, 'assets'))
      const raw = parseJsonStrict(await this.readText(join(assetsDir, `${assetId}.json`), 3 * 1024 * 1024)) as AppAssetExportRecord
      const bytes = decodeAssetBase64(raw.dataBase64)
      const sniffed = validateAssetBuffer(bytes, raw.name)
      if (raw.id !== assetId || raw.byteSize !== bytes.length || raw.sha256 !== createHash('sha256').update(bytes).digest('hex') ||
          raw.mimeType !== sniffed.mimeType || raw.type !== sniffed.type) throw httpError(500, 'Stored asset integrity check failed')
      return raw
    } catch (error) {
      if (missing(error)) throw httpError(404, 'App asset not found')
      throw error
    }
  }

  async resolveAssets(user: string, project: AppProject): Promise<AppAssetExportRecord[]> {
    if (!project.assetIds.length) return []
    if (!await this.read(user, project.id)) throw httpError(404, 'App project not found')
    const records: AppAssetExportRecord[] = []
    for (const id of project.assetIds) records.push(await this.assetRecord(user, project.id, id))
    return records
  }

  async listAssets(user: string, id: string): Promise<AppAsset[]> {
    const project = await this.read(user, id)
    if (!project) throw httpError(404, 'App project not found')
    return (await this.resolveAssets(user, project)).map(({ dataBase64: _data, ...asset }) => ({ ...asset, appId: id }))
  }

  async readAsset(user: string, id: string, assetId: string): Promise<AppAssetExportRecord> {
    validateAssetId(assetId)
    const project = await this.read(user, id)
    if (!project || !project.assetIds.includes(assetId)) throw httpError(404, 'App asset not found')
    return this.assetRecord(user, id, assetId)
  }

  async uploadAsset(user: string, id: string, name: string, bytes: Uint8Array, expectedRevision?: number): Promise<{ asset: AppAsset; project: AppProject }> {
    const sniffed = validateAssetBuffer(bytes, name)
    return this.locked(user, id, async () => {
      const current = await this.read(user, id)
      if (!current) throw httpError(404, 'App project not found')
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw httpError(409, 'Revision conflict')
      const directory = await this.directory(join(await this.appDirectory(user, id), 'assets'), true)
      // Detached assets remain available to immutable revisions and count toward quota.
      const names = (await fs.readdir(directory)).filter(name => /^ast_[a-zA-Z0-9_-]+\.json$/.test(name))
      if (names.length >= APP_ASSET_LIMITS.MAX_ASSETS_COUNT) throw httpError(413, 'App asset count quota exceeded')
      let total = bytes.length
      for (const filename of names) total += (await this.assetRecord(user, id, filename.slice(0, -5))).byteSize
      if (total > APP_ASSET_LIMITS.MAX_TOTAL_ASSETS_BYTES) throw httpError(413, 'App asset byte quota exceeded')
      const record: AppAssetExportRecord = { id: generateAssetId(), name, ...sniffed, byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), dataBase64: Buffer.from(bytes).toString('base64'), createdAt: new Date().toISOString() }
      const path = join(directory, `${record.id}.json`)
      const staging = join(directory, `.upload_${randomUUID()}`)
      try {
        await this.writeText(staging, JSON.stringify(record))
        await fs.rename(staging, path)
        await this.syncDirectory(directory)
        const project = await this.publish(user, id, { ...current, assetIds: [...current.assetIds, record.id] }, current.revision, { source: 'assets' })
        const { dataBase64: _data, ...metadata } = record
        return { asset: { ...metadata, appId: id }, project }
      } catch (error) {
        await fs.rm(path, { force: true }).catch(() => {})
        throw error
      } finally { await fs.rm(staging, { force: true }).catch(() => {}) }
    })
  }

  async detachAsset(user: string, id: string, assetId: string, expectedRevision?: number): Promise<AppProject> {
    validateAssetId(assetId)
    return this.locked(user, id, async () => {
      const current = await this.read(user, id)
      if (!current || !current.assetIds.includes(assetId)) throw httpError(404, 'App asset not found')
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw httpError(409, 'Revision conflict')
      return this.publish(user, id, { ...current, assetIds: current.assetIds.filter(value => value !== assetId) }, current.revision, { source: 'assets' })
    })
  }

  async copyWithAssets(user: string, sourceId: string, project: AppProject): Promise<AppProject> {
    const source = await this.read(user, sourceId)
    if (!source) throw httpError(404, 'App project not found')
    if (project.id === sourceId) throw httpError(400, 'Copy requires a new app ID')
    const records: AppAssetExportRecord[] = []
    for (const assetId of project.assetIds) {
      if (!source.assetIds.includes(assetId)) throw httpError(404, 'App asset not found')
      records.push(await this.assetRecord(user, sourceId, assetId))
    }
    return this.locked(user, project.id, async () => {
      if (await this.read(user, project.id)) throw httpError(409, 'App project already exists')
      const appDir = await this.appDirectory(user, project.id, true)
      try {
        const directory = await this.directory(join(appDir, 'assets'), true)
        for (const record of records) await this.writeText(join(directory, `${record.id}.json`), JSON.stringify(record))
        await this.syncDirectory(directory)
        return await this.publish(user, project.id, project, null)
      } catch (error) {
        if (!await this.head(appDir, project.id)) await fs.rm(appDir, { recursive: true, force: true })
        throw error
      }
    })
  }

  async exportPackage(user: string, id: string): Promise<AppProjectPackage> {
    const project = await this.read(user, id)
    if (!project) throw httpError(404, 'App project not found')
    try { return exportAppPackage(project, await this.resolveAssets(user, project)) }
    catch (error) { if (error instanceof AppAssetValidationError) throw httpError(400, error.message); throw error }
  }

  async delete(user: string, id: string): Promise<boolean> {
    safeId(user, 'user ID'); safeId(id, 'app ID')
    return this.locked(user, id, async () => {
      let appDir: string
      try { appDir = await this.appDirectory(user, id) }
      catch (error) { if (missing(error)) return false; throw error }
      const head = await this.head(appDir, id)
      if (!head) return false
      await fs.unlink(join(appDir, 'manifest.json'))
      await fs.rm(appDir, { recursive: true, force: true })
      await this.syncDirectory(dirname(appDir))
      return true
    })
  }
}
