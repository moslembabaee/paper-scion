import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CloudUser } from '../src/cloud/model.ts'
import { atomicFile, hash, httpError, Storage } from './storage.ts'

interface User extends CloudUser { tokenHash?: string; tokenEncrypted?: string; profileEdited?: boolean }
interface AuthData { users: User[]; sessions: Record<string, { userId: string; expiresAt: number }> }
export class Auth {
  private data: AuthData = { users: [], sessions: {} }
  private lock = new Storage('')
  private key: Buffer
  private path: string
  constructor(root: string, secret: string) {
    if (secret.length < 32) throw new Error('PAPER_SESSION_SECRET must have at least 32 characters')
    this.key = Buffer.from(hash(secret), 'hex')
    this.path = join(root, 'auth.json')
  }
  async initialize(root: string) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    try { this.data = JSON.parse(await readFile(this.path, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  /** Publish changes only after the atomic file write succeeds. */
  private async commit(data: AuthData) { await atomicFile(this.path, data); this.data = data }
  private requireUser(data: AuthData, id: string) {
    const user = data.users.find(user => user.id === id)
    if (!user) throw httpError(404, 'Account not found')
    return user
  }
  async login(provider: 'google' | 'github', identity: { sub: string; email: string; name: string; avatar: string }) {
    return this.lock.locked('auth', async () => {
      const data = structuredClone(this.data)
      const id = hash(`${provider}:${identity.sub}`)
      let user = data.users.find(user => user.id === id)
      if (!user) { user = { id, email: identity.email, name: identity.name, avatar: identity.avatar, provider, createdAt: Date.now(), hasMcpToken: false }; data.users.push(user) }
      else {
        user.email = identity.email
        if (!user.profileEdited) Object.assign(user, { name: identity.name, avatar: identity.avatar })
      }
      const session = randomBytes(32).toString('base64url')
      const now = Date.now()
      for (const [key, entry] of Object.entries(data.sessions)) if (entry.expiresAt < now) delete data.sessions[key]
      data.sessions[hash(session)] = { userId: id, expiresAt: now + 30 * 86400_000 }
      await this.commit(data)
      return { session, user: this.profile(user) }
    })
  }
  profile(user: User): CloudUser { const { id, email, name, avatar, provider, createdAt, hasMcpToken, tokenRotatedAt } = user; return { id, email, name, avatar, provider, createdAt, hasMcpToken, tokenRotatedAt } }
  hasAccount(id: string): boolean { return this.data.users.some(user => user.id === id) }
  session(raw: string | undefined) {
    const session = raw && this.data.sessions[hash(raw)]
    return session && session.expiresAt > Date.now() ? this.data.users.find(user => user.id === session.userId) : undefined
  }
  bearer(raw: string | undefined) { return raw && /^paper_[A-Za-z0-9_-]{43}$/.test(raw) ? this.data.users.find(user => user.tokenHash === hash(raw)) : undefined }
  async logout(raw: string) { return this.lock.locked('auth', async () => { const data = structuredClone(this.data); delete data.sessions[hash(raw)]; await this.commit(data) }) }
  async regenerate(id: string) {
    return this.lock.locked('auth', async () => {
      const data = structuredClone(this.data)
      const user = this.requireUser(data, id)
      const token = `paper_${randomBytes(32).toString('base64url')}`
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, iv)
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
      Object.assign(user, { tokenHash: hash(token), tokenEncrypted: [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.'), hasMcpToken: true, tokenRotatedAt: Date.now() })
      await this.commit(data)
      return token
    })
  }
  reveal(id: string) {
    const user = this.requireUser(this.data, id)
    if (!user.tokenEncrypted) throw httpError(404, 'Generate a token first')
    const [iv, tag, value] = user.tokenEncrypted.split('.').map(v => Buffer.from(v, 'base64url'))
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv)
    cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8')
  }
  async revoke(id: string) {
    return this.lock.locked('auth', async () => {
      const data = structuredClone(this.data)
      const user = this.requireUser(data, id)
      delete user.tokenHash
      delete user.tokenEncrypted
      delete user.tokenRotatedAt
      user.hasMcpToken = false
      await this.commit(data)
      return this.profile(user)
    })
  }
  async updateProfile(id: string, updates: { name?: unknown; avatar?: unknown }) {
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.trim().length > 80)) throw httpError(400, 'Enter a display name between 1 and 80 characters')
    if (updates.avatar !== undefined && (typeof updates.avatar !== 'string' || updates.avatar.length >= 400_000 || (updates.avatar !== '' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(updates.avatar) && !/^https:\/\/[^\s]+$/.test(updates.avatar)))) throw httpError(400, 'Choose a PNG, JPEG, WebP image or an HTTPS avatar URL')
    return this.lock.locked('auth', async () => {
      const data = structuredClone(this.data)
      const user = this.requireUser(data, id)
      if (typeof updates.name === 'string') user.name = updates.name.trim()
      if (typeof updates.avatar === 'string') user.avatar = updates.avatar
      if (updates.name !== undefined || updates.avatar !== undefined) user.profileEdited = true
      await this.commit(data)
      return this.profile(user)
    })
  }
}
