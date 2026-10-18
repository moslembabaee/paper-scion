import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import type { AppStorage } from './app-storage.ts'
import { atomicFile, httpError } from './storage.ts'
import { APP_SECRET_LIMITS, isCapabilityRequest, isSecretHandle, type AppSecretHandle } from '../src/make/secrets.ts'

type StoredSecret = { -readonly [K in keyof AppSecretHandle]: AppSecretHandle[K] } & { encrypted?: string }
const metadata = ({ handle, capability, version, status }: StoredSecret): AppSecretHandle => ({ handle, capability, version, status })

/** No reveal API, adapters, fetch, user-selected algorithms, or generated server code. */
export class AppSecrets {
  private readonly key: Buffer
  constructor(private readonly apps: AppStorage, masterKey: string) {
    this.key = Buffer.from(hkdfSync('sha256', masterKey, 'paper-app-secrets-v1', 'aes-256-gcm', 32))
  }

  private async read(directory: string): Promise<StoredSecret[]> {
    try {
      const file = await open(join(directory, 'secrets.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let state: unknown
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 512 * 1024) throw new Error('Invalid vault')
        state = JSON.parse(await file.readFile('utf8'))
      } finally { await file.close() }
      if (!Array.isArray(state) || state.length > APP_SECRET_LIMITS.MAX_HANDLES || state.some(record =>
        !record || typeof record !== 'object' || Object.keys(record).some(key => !['handle', 'capability', 'version', 'status', 'encrypted'].includes(key)) ||
        !isSecretHandle(record.handle) || record.capability !== 'hmac-sha256' || !Number.isSafeInteger(record.version) || record.version < 1 ||
        (record.status === 'active' ? typeof record.encrypted !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.encrypted)
          : record.status !== 'revoked' || record.encrypted !== undefined)) ||
        new Set(state.map(record => record.handle)).size !== state.length) throw new Error('Invalid vault')
      return state as StoredSecret[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw httpError(500, 'Secret storage is unavailable')
    }
  }

  private async write(directory: string, records: StoredSecret[]) {
    await atomicFile(join(directory, 'secrets.json'), records)
    const file = await open(directory, 'r')
    try { await file.sync() } finally { await file.close() }
  }

  private aad(owner: string, appId: string, record: AppSecretHandle): Buffer {
    return Buffer.from(JSON.stringify(['paper-app-secret-v1', owner, appId, record.handle, record.capability, record.version]))
  }
  private encrypt(owner: string, appId: string, record: AppSecretHandle, value: unknown): string {
    if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > APP_SECRET_LIMITS.MAX_VALUE_BYTES) {
      throw httpError(400, 'Secret must contain 32–4096 UTF-8 bytes')
    }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(this.aad(owner, appId, record))
    const bytes = Buffer.from(value)
    try {
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
      return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.')
    } finally { bytes.fill(0) }
  }

  async list(owner: string, appId: string) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => (await this.read(directory)).map(metadata))
  }
  async create(owner: string, appId: string, input: Record<string, unknown>) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (Object.keys(input).sort().join(',') !== 'capability,value' || input.capability !== 'hmac-sha256') throw httpError(400, 'Choose the hmac-sha256 capability and a secret value')
      const records = await this.read(directory)
      if (records.length >= APP_SECRET_LIMITS.MAX_HANDLES) throw httpError(409, 'App secret handle limit reached')
      const record: StoredSecret = { handle: `sec_${randomBytes(24).toString('base64url')}`, capability: 'hmac-sha256', version: 1, status: 'active' }
      record.encrypted = this.encrypt(owner, appId, record, input.value)
      await this.write(directory, [...records, record])
      return metadata(record)
    })
  }
  async change(owner: string, appId: string, handle: string, input: Record<string, unknown>, revoke: boolean) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (Object.keys(input).sort().join(',') !== (revoke ? 'expectedVersion' : 'expectedVersion,value') ||
          !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw httpError(400, 'A current expectedVersion is required')
      const records = await this.read(directory)
      const record = this.active(records, handle)
      if (record.version !== input.expectedVersion) throw httpError(409, 'Secret version changed. Refresh handles and retry.')
      record.version++
      if (revoke) { record.status = 'revoked'; delete record.encrypted }
      else record.encrypted = this.encrypt(owner, appId, record, input.value)
      await this.write(directory, records)
      return metadata(record)
    })
  }
  private active(records: StoredSecret[], handle: string): StoredSecret {
    const record = records.find(item => item.handle === handle)
    if (!record) throw httpError(404, 'Secret handle not found')
    if (record.status !== 'active') throw httpError(403, 'Secret handle is revoked')
    return record
  }
  async invoke(owner: string, appId: string, handle: string, input: Record<string, unknown>) {
    return this.apps.withOwnerAppDirectory(owner, appId, async directory => {
      if (!isCapabilityRequest(input)) throw httpError(400, 'Only hmac-sha256 with a message of at most 4096 UTF-8 bytes is allowed')
      const record = this.active(await this.read(directory), handle)
      let key: Buffer
      try {
        const [iv, tag, encrypted] = record.encrypted!.split('.').map(part => Buffer.from(part, 'base64url'))
        const cipher = createDecipheriv('aes-256-gcm', this.key, iv)
        cipher.setAAD(this.aad(owner, appId, record)); cipher.setAuthTag(tag)
        key = Buffer.concat([cipher.update(encrypted), cipher.final()])
      } catch { throw httpError(500, 'Secret capability is unavailable') }
      try {
        // Domain separation prevents this capability from signing arbitrary provider credentials.
        return { signature: createHmac('sha256', key).update(JSON.stringify(['paper-app-hmac-v1', owner, appId, input.message])).digest('hex') }
      } finally { key.fill(0) }
    })
  }
}
