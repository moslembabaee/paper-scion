import type { PaperProject } from '../io/project'
import type { LocalProject, ProjectSummary } from './types'

export const WORKSPACE_DATABASE = 'paper.workspaces'
let connection: Promise<IDBDatabase> | undefined

export interface ProjectChange { id: string; source: 'local' | 'cloud'; external?: boolean }
const listeners = new Set<(change: ProjectChange) => void>()
let channel: BroadcastChannel | undefined

/** Notify only after a durable commit. Cloud acknowledgements never enqueue themselves. */
export function subscribeProjectChanges(listener: (change: ProjectChange) => void): () => void {
  listeners.add(listener)
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('paper.workspace.changes')
    channel.onmessage = event => {
      const change = event.data as ProjectChange
      if (typeof change?.id === 'string' && ['local', 'cloud'].includes(change.source)) {
        for (const notify of listeners) notify({ id: change.id, source: change.source, external: true })
      }
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { channel?.close(); channel = undefined }
  }
}

function notifyChange(id: string, source: ProjectChange['source']) {
  const change = { id, source }
  for (const notify of listeners) notify(change)
  channel?.postMessage(change)
}

function database(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(WORKSPACE_DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' })
      request.result.createObjectStore('settings')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Close other Paper tabs to open the local workspace.')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
  }).catch(error => { connection = undefined; throw error })
  return connection
}

function completed(transaction: IDBTransaction): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Local project storage was interrupted.'))
    transaction.onerror = () => reject(transaction.error)
  })
  // Read requests can fail before the caller reaches its await of the commit.
  // Keep that rejection handled; awaiting this promise still reports the failure.
  void promise.catch(() => {})
  return promise
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function projectSummary({ id, name, createdAt, updatedAt }: LocalProject): ProjectSummary {
  return { id, name, createdAt, updatedAt }
}

export function localProject(document: PaperProject): LocalProject {
  const now = Date.now()
  return { id: crypto.randomUUID(), name: document.name, createdAt: now, updatedAt: now, document }
}

/** Restore the account's cache and claim legacy unowned records atomically, including in Strict Mode. */
export async function initializeProjects(seed: PaperProject, owner?: string): Promise<{ projects: ProjectSummary[]; active: LocalProject; created: boolean }> {
  const db = await database()
  const transaction = db.transaction(['projects', 'settings'], 'readwrite')
  const done = completed(transaction)
  const projects = transaction.objectStore('projects')
  const settings = transaction.objectStore('settings')
  const activeKey = owner ? `activeProject:${owner}` : 'activeProject'
  const [cached, activeId, legacyActiveId] = await Promise.all([
    result(projects.getAll() as IDBRequest<LocalProject[]>),
    result(settings.get(activeKey) as IDBRequest<string | undefined>),
    result(settings.get('activeProject') as IDBRequest<string | undefined>),
  ])
  const records = cached.filter(record => !owner || !record.cloud || record.cloud.owner === owner)
  if (owner) {
    for (const record of records) {
      if (record.cloud) continue
      record.cloud = { owner, projectId: record.id, revision: null, syncedAt: 0, dirty: true }
      projects.put(record)
    }
  }
  const created = !records.length
  if (created) {
    // A different account gets a blank canvas, never the previous account's legacy seed.
    const document: PaperProject = cached.length ? { ...seed, name: 'Untitled', scene: { version: 1, elements: {}, rootIds: [] }, viewport: { x: 0, y: 0, zoom: 1 } } : seed
    const first = localProject(document)
    if (owner) first.cloud = { owner, projectId: first.id, revision: null, syncedAt: 0, dirty: true }
    projects.put(first)
    records.push(first)
  }
  records.sort((a, b) => b.updatedAt - a.updatedAt)
  const active = records.find(record => record.id === (activeId ?? legacyActiveId)) ?? records[0]
  settings.put(active.id, activeKey)
  await done
  return { projects: records.map(projectSummary), active, created }
}

export async function readProject(id: string): Promise<LocalProject> {
  const db = await database()
  const record = await result(db.transaction('projects').objectStore('projects').get(id) as IDBRequest<LocalProject | undefined>)
  if (!record) throw new Error('This project could not be found. Reload Paper to refresh the project list.')
  return record
}

export async function writeProject(record: LocalProject, activate = false): Promise<void> {
  const db = await database()
  const transaction = db.transaction(activate ? ['projects', 'settings'] : ['projects'], 'readwrite')
  const done = completed(transaction)
  transaction.objectStore('projects').put(record)
  if (activate) transaction.objectStore('settings').put(record.id, record.cloud ? `activeProject:${record.cloud.owner}` : 'activeProject')
  await done
  notifyChange(record.id, 'local')
}

export async function activateProject(id: string, owner?: string): Promise<void> {
  const db = await database()
  const transaction = db.transaction('settings', 'readwrite')
  const done = completed(transaction)
  transaction.objectStore('settings').put(id, owner ? `activeProject:${owner}` : 'activeProject')
  await done
}

export async function renameProject(id: string, name: string): Promise<ProjectSummary> {
  const db = await database()
  const transaction = db.transaction('projects', 'readwrite')
  const done = completed(transaction)
  const projects = transaction.objectStore('projects')
  const record = await result(projects.get(id) as IDBRequest<LocalProject | undefined>)
  if (!record) { await done; throw new Error('This project could not be found.') }
  const renamed = { ...record, name, updatedAt: Date.now(), document: { ...record.document, name }, ...(record.cloud ? { cloud: { ...record.cloud, dirty: true } } : {}) }
  projects.put(renamed)
  await done
  notifyChange(id, 'local')
  return projectSummary(renamed)
}

export async function listLocalProjects(): Promise<LocalProject[]> {
  const db = await database()
  return result(db.transaction('projects').objectStore('projects').getAll() as IDBRequest<LocalProject[]>)
}

/** Read/modify/write in one IndexedDB transaction, shared with other open tabs. */
export async function updateLocalProject(id: string, update: (current: LocalProject | undefined) => LocalProject | undefined, source: ProjectChange['source'] = 'local', preserveConflict = false): Promise<LocalProject | undefined> {
  const db = await database()
  const transaction = db.transaction('projects', 'readwrite')
  const done = completed(transaction)
  const store = transaction.objectStore('projects')
  let changed = false
  const record = await new Promise<LocalProject | undefined>((resolve, reject) => {
    const request = store.get(id) as IDBRequest<LocalProject | undefined>
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      try {
        const next = update(request.result)
        changed = !!next && next !== request.result
        if (changed && next) {
          if (preserveConflict && request.result) {
            const previous = request.result
            const name = `${previous.name.slice(0, 175)} (conflict copy)`
            const recovery = localProject({ ...previous.document, name })
            if (previous.cloud) recovery.cloud = { owner: previous.cloud.owner, projectId: recovery.id, revision: null, syncedAt: 0, dirty: true }
            store.put(recovery)
          }
          store.put(next)
        }
        resolve(next)
      } catch (error) { transaction.abort(); reject(error) }
    }
  })
  await done
  if (changed) notifyChange(id, source)
  return record
}
