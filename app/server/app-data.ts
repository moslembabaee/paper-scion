import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import type { AppStorage } from './app-storage.ts'
import { atomicFile, httpError } from './storage.ts'
import { parseJsonStrict } from '../src/make/manifest.ts'
import { APP_DATA_LIMITS as L, isAppDataDefinition, isAppDataRequest, isDataHandle, matchesAppDataSchema,
  type AppDataDefinition, type AppDataCollection, type AppDataRecord, type AppDataResult } from '../src/make/data.ts'

type Collection = AppDataDefinition & { handle: string; version: number; status: 'active' | 'revoked'; revision: number;
  records: AppDataRecord[]; rate: { start: number; count: number } }
const bytes = (records: readonly AppDataRecord[]) => records.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0)
const metadata = ({ records, rate: _rate, ...collection }: Collection): AppDataCollection => ({ ...collection,
  usage: { records: records.length, bytes: bytes(records) } })
const definition = ({ name, schema, operations, quotas }: Collection) => ({ name, schema, operations, quotas })

/** Fixed CRUD over bounded JSON. No SQL, expression evaluation, network or generated server code. */
export class AppData {
  constructor(private readonly apps: AppStorage) {}
  private async read(directory: string): Promise<Collection[]> {
    try {
      const file = await open(join(directory, 'data.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let state: unknown
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Invalid data')
        state = parseJsonStrict(await file.readFile('utf8'), 2 * 1024 * 1024)
      } finally { await file.close() }
      if (!Array.isArray(state) || state.length > L.MAX_COLLECTIONS || state.some(c => {
        if (!c || typeof c !== 'object' || Object.keys(c).sort().join(',') !== 'handle,name,operations,quotas,rate,records,revision,schema,status,version' ||
          !isAppDataDefinition(definition(c)) || !isDataHandle(c.handle) || !Number.isSafeInteger(c.version) || c.version < 1 ||
          !['active', 'revoked'].includes(c.status) || !Number.isSafeInteger(c.revision) || c.revision < 0 ||
          !c.rate || typeof c.rate !== 'object' || Object.keys(c.rate).sort().join(',') !== 'count,start' ||
          !Number.isSafeInteger(c.rate.start) || c.rate.start < 0 || !Number.isSafeInteger(c.rate.count) || c.rate.count < 0 || c.rate.count > c.quotas.operationsPerMinute ||
          !Array.isArray(c.records) || c.records.length > c.quotas.maxRecords || bytes(c.records) > c.quotas.maxBytes ||
          (c.status === 'revoked' && c.records.length !== 0)) return true
        return c.records.some((r: AppDataRecord) => !r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== 'id,value' ||
          !isAppDataRequest({ operation: 'update', expectedRevision: 0, id: r.id, value: r.value }) || !matchesAppDataSchema(r.value, c.schema)) ||
          new Set(c.records.map((r: AppDataRecord) => r.id)).size !== c.records.length
      }) || new Set(state.map(c => c.handle)).size !== state.length ||
        state.reduce((sum, c) => sum + bytes(c.records), 0) > L.MAX_APP_BYTES) throw new Error('Invalid data')
      return state as Collection[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw httpError(500, 'App data storage is unavailable')
    }
  }
  private async write(directory: string, state: Collection[]) {
    try {
      await atomicFile(join(directory, 'data.json'), state)
      const file = await open(directory, 'r')
      try { await file.sync() } finally { await file.close() }
    } catch { throw httpError(500, 'App data storage is unavailable') }
  }
  async list(owner: string, appId: string) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => (await this.read(directory)).map(metadata))
  }
  async create(owner: string, appId: string, input: unknown) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (!isAppDataDefinition(input)) throw httpError(400, 'Choose a valid data schema, allowed operations and quotas')
      const state = await this.read(directory)
      if (state.length >= L.MAX_COLLECTIONS) throw httpError(409, 'App data capability limit reached')
      if (state.some(c => c.name === input.name && c.status === 'active')) throw httpError(409, 'An active collection already uses this name')
      const collection: Collection = { ...input, handle: `dat_${randomBytes(24).toString('base64url')}`, version: 1, status: 'active', revision: 0, records: [], rate: { start: 0, count: 0 } }
      await this.write(directory, [...state, collection])
      return metadata(collection)
    })
  }
  private find(state: Collection[], handle: string) {
    const c = state.find(c => c.handle === handle)
    if (!c) throw httpError(404, 'App data capability not found')
    if (c.status !== 'active') throw httpError(403, 'App data capability is revoked')
    return c
  }
  async revoke(owner: string, appId: string, handle: string, input: Record<string, unknown>) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (Object.keys(input).join(',') !== 'expectedVersion' || !Number.isSafeInteger(input.expectedVersion)) throw httpError(400, 'A current expectedVersion is required')
      const state = await this.read(directory), c = this.find(state, handle)
      if (c.version !== input.expectedVersion) throw httpError(409, 'Data capability version changed. Refresh and retry.')
      c.version++; c.status = 'revoked'; c.records = []
      await this.write(directory, state)
      return metadata(c)
    })
  }
  async invoke(owner: string, appId: string, handle: string, input: unknown): Promise<AppDataResult> {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (!isAppDataRequest(input)) throw httpError(400, 'Invalid app data operation')
      const state = await this.read(directory), c = this.find(state, handle)
      if (!c.operations.includes(input.operation)) throw httpError(403, 'This data operation is not allowed')
      const now = Date.now()
      if (now >= c.rate.start + 60_000) c.rate = { start: now, count: 0 }
      if (c.rate.count >= c.quotas.operationsPerMinute) throw httpError(429, 'App data operation quota reached')
      let records: AppDataRecord[], nextOffset: number | undefined
      if (input.operation === 'list') {
        const offset = input.offset ?? 0
        records = c.records.slice(offset, offset + L.PAGE_SIZE)
        if (offset + records.length < c.records.length) nextOffset = offset + records.length
      } else if (input.operation === 'get') {
        const row = c.records.find(r => r.id === input.id)
        if (!row) throw httpError(404, 'App data record not found')
        records = [row]
      } else {
        if (input.expectedRevision !== c.revision) throw httpError(409, 'App data revision changed. Read the collection and retry.')
        if (c.revision >= Number.MAX_SAFE_INTEGER) throw httpError(409, 'App data revision limit reached')
        if (input.operation !== 'delete' && !matchesAppDataSchema(input.value, c.schema)) throw httpError(400, 'Record does not match the app data schema')
        if (input.operation === 'create') {
          const row = { id: `row_${randomBytes(24).toString('base64url')}`, value: input.value }
          c.records.push(row); records = [row]
        } else {
          const index = c.records.findIndex(r => r.id === input.id)
          if (index < 0) throw httpError(404, 'App data record not found')
          if (input.operation === 'delete') { c.records.splice(index, 1); records = [] }
          else { c.records[index] = { id: input.id, value: input.value }; records = [c.records[index]] }
        }
        if (c.records.length > c.quotas.maxRecords || bytes(c.records) > c.quotas.maxBytes ||
            state.reduce((sum, item) => sum + bytes(item.records), 0) > L.MAX_APP_BYTES) throw httpError(409, 'App data storage quota reached')
        c.revision++
      }
      c.rate.count++
      // Readers and writers share the app lock; denied or failed writes never publish in-memory state.
      await this.write(directory, state)
      return { revision: c.revision, records, ...(nextOffset === undefined ? {} : { nextOffset }) }
    })
  }
}
