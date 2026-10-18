import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SceneReplica } from '../src/collaboration/model.ts'
import { COLLAB_PATH, PRESENCE_COLORS } from '../src/collaboration/types.ts'
import type { Presence, Register } from '../src/collaboration/types.ts'
import { SceneStore } from '../src/scene/store.ts'
import type { SceneDocument } from '../src/scene/types.ts'

interface Peer { presence: Presence; token: string; seen: number; stream?: ServerResponse }
interface Room { replica: SceneReplica; peers: Map<string, Peer>; seen: number }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const point = (value: unknown) => record(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
const reply = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value))
}
function presence(value: unknown, id: string): Presence {
  if (!record(value) || typeof value.name !== 'string' || !['active', 'idle', 'away'].includes(String(value.status)) || (value.cursor !== null && !point(value.cursor)) || !Array.isArray(value.selection) || value.selection.length > 500 || value.selection.some(id => typeof id !== 'string' || id.length > 200) || !record(value.viewport) || !point(value.viewport.center) || typeof value.viewport.zoom !== 'number' || !Number.isFinite(value.viewport.zoom) || value.viewport.zoom < .02 || value.viewport.zoom > 64 || !record(value.viewport.size) || typeof value.viewport.size.width !== 'number' || typeof value.viewport.size.height !== 'number' || !Number.isFinite(value.viewport.size.width) || !Number.isFinite(value.viewport.size.height) || value.viewport.size.width < 0 || value.viewport.size.height < 0 || (value.following !== null && typeof value.following !== 'string')) throw new Error('Invalid presence')
  const color = PRESENCE_COLORS[parseInt(id.replace(/-/g, '').slice(0, 6), 16) % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0]
  const pointerDown = Boolean(value.pointerDown)
  const activity = typeof value.activity === 'string' ? value.activity.slice(0, 50) : undefined
  const chat = typeof value.chat === 'string' ? value.chat.slice(0, 200) : undefined
  const chatTimestamp = typeof value.chatTimestamp === 'number' && Number.isFinite(value.chatTimestamp) ? value.chatTimestamp : undefined
  const avatar = typeof value.avatar === 'string' && value.avatar.length < 400_000 ? value.avatar : undefined
  const cursorTimestamp = typeof value.cursorTimestamp === 'number' && Number.isFinite(value.cursorTimestamp) ? value.cursorTimestamp : undefined
  return {
    ...value,
    id,
    name: value.name.trim().slice(0, 80) || 'Designer',
    color,
    ...(pointerDown ? { pointerDown: true } : {}),
    ...(activity ? { activity } : {}),
    ...(chat ? { chat, chatTimestamp } : {}),
    ...(avatar ? { avatar } : {}),
    ...(cursorTimestamp ? { cursorTimestamp } : {}),
  } as unknown as Presence
}
async function read(request: IncomingMessage, parsed?: unknown): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON')
  let value = parsed
  if (value === undefined) {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.length
      if (size > 16 * 1024 * 1024) throw new Error('Room message exceeds 16 MB')
      chunks.push(bytes)
    }
    const text = Buffer.concat(chunks).toString()
    try { value = JSON.parse(text) } catch { throw new Error('Invalid JSON') }
  }
  if (!record(value)) throw new Error('Invalid room message')
  if (parsed !== undefined && Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024) throw new Error('Room message exceeds 16 MB')
  return value
}

/** Same-origin HTTP + SSE relay. Room IDs are unguessable invitation capabilities. */
export class CollaborationServer {
  private rooms = new Map<string, Room>()
  private timer: ReturnType<typeof setInterval>
  private readonly origin?: string
  // Production checks the configured public origin; Vite checks the request host.
  constructor(origin?: string) {
    this.origin = origin === undefined ? undefined : new URL(origin).origin
    this.timer = setInterval(() => {
      for (const [id, room] of this.rooms) {
        for (const [peerId, peer] of room.peers) {
          if (peer.stream && !peer.stream.destroyed && !peer.stream.writableEnded) { peer.stream.write(': heartbeat\n\n'); peer.seen = Date.now(); room.seen = Date.now() }
          else if (Date.now() - peer.seen > 30_000) { room.peers.delete(peerId); this.broadcast(room, 'peers', this.peers(room)) }
        }
        if (!room.peers.size && Date.now() - room.seen > 30 * 60_000) this.rooms.delete(id)
      }
    }, 10_000)
    this.timer.unref()
  }
  close() {
    clearInterval(this.timer)
    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) peer.stream?.end()
      room.peers.clear()
    }
    this.rooms.clear()
  }
  private peers(room: Room) { return [...room.peers.values()].map(peer => peer.presence) }
  private broadcast(room: Room, event: string, data: unknown) {
    const packet = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const peer of room.peers.values()) if (peer.stream && !peer.stream.destroyed && !peer.stream.writableEnded) {
      if (peer.stream.writableLength > 2 * 1024 * 1024) peer.stream.destroy()
      else peer.stream.write(packet)
    }
  }
  handle = async (request: IncomingMessage, response: ServerResponse, parsed?: unknown): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== COLLAB_PATH && !url.pathname.startsWith(`${COLLAB_PATH}/`)) return false
    try {
      await this.dispatch(request, response, url, parsed)
    } catch (error) {
      if (!response.headersSent) reply(response, 400, { error: error instanceof Error ? error.message : 'Invalid collaboration request' })
    }
    return true
  }
  middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== COLLAB_PATH && !url.pathname.startsWith(`${COLLAB_PATH}/`)) return next()
    void this.handle(request, response)
  }
  private async dispatch(request: IncomingMessage, response: ServerResponse, url: URL, parsed?: unknown) {
    const origin = request.headers.origin
    if (origin && (this.origin ? origin !== this.origin : new URL(origin).host !== request.headers.host)) {
      reply(response, 403, { error: 'Collaboration requires the same origin' }); return
    }
    const [, , roomId, route] = url.pathname.split('/')
    if (!/^[a-f0-9-]{36}$/.test(roomId ?? '')) throw new Error('Invalid room ID')
    let room = this.rooms.get(roomId)
    if (route === 'join' && request.method === 'POST') {
      const data = await read(request, parsed)
      if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) throw new Error('Invalid session ID')
      const user = presence(data.presence, data.id)
      if (!room) {
        if (this.rooms.size >= 100) throw new Error('This server has reached its room limit')
        const validator = new SceneStore(); validator.load(data.document as SceneDocument)
        const replica = new SceneReplica('seed'); replica.seed(validator.toJSON())
        room = { replica, peers: new Map(), seen: Date.now() }; this.rooms.set(roomId, room)
      }
      if (room.peers.size >= 50 && !room.peers.has(data.id)) throw new Error('This room is full')
      const existing = room.peers.get(data.id)
      if (existing && data.token !== existing.token) throw new Error('Session token required')
      const token = existing?.token ?? (typeof data.token === 'string' && /^[a-f0-9-]{36}$/.test(data.token) ? data.token : randomUUID())
      room.peers.set(data.id, { presence: user, token, seen: Date.now(), stream: existing?.stream })
      room.seen = Date.now()
      reply(response, 200, { token, registers: room.replica.export(), peers: this.peers(room) })
      this.broadcast(room, 'peers', this.peers(room)); return
    }
    const id = url.searchParams.get('id') ?? '', peer = room?.peers.get(id)
    if (!room || !peer || peer.token !== url.searchParams.get('token')) { reply(response, 401, { error: 'Join the room again' }); return }
    peer.seen = room.seen = Date.now()
    if (route === 'events' && request.method === 'GET') {
      peer.stream?.end()
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })
      peer.stream = response
      // A full snapshot closes the join-to-stream race and repairs missed messages.
      response.write(`event: state\ndata: ${JSON.stringify({ registers: room.replica.export(), peers: this.peers(room) })}\n\n`)
      response.on('close', () => { if (peer.stream === response) { peer.stream = undefined; peer.presence = { ...peer.presence, status: 'away', cursor: null }; this.broadcast(room!, 'peers', this.peers(room!)) } })
      return
    }
    if (route === 'leave' && request.method === 'POST') {
      room.peers.delete(id); peer.stream?.end(); this.broadcast(room, 'peers', this.peers(room)); reply(response, 200, {}); return
    }
    if (route === 'update' && request.method === 'POST') {
      const data = await read(request, parsed)
      const nextPresence = data.presence ? presence(data.presence, id) : peer.presence
      if (data.changes !== undefined) {
        if (!Array.isArray(data.changes) || data.changes.length > 100_000) throw new Error('Invalid changes')
        const changes = data.changes as Register[]
        if (changes.some(change => change.actor !== id || !Array.isArray(change.path) || (change.path[0] === 'elements' ? change.path.length < 3 : change.path[0] === 'comments' ? !((change.path.length === 3 && ['id', 'anchor', 'createdAt', 'status', '$alive'].includes(change.path[2])) || (change.path.length === 4 && change.path[2] === 'messages')) : change.path.length !== 1 || !['tokens', 'styleLibrary', 'motion', 'prototype', 'backgroundShader'].includes(change.path[0])))) throw new Error('Invalid change actor or document field')
        const candidate = new SceneReplica('server', room.replica.export()); candidate.merge(changes)
        try { const validator = new SceneStore(); validator.load(candidate.document()) }
        catch (error) { reply(response, 409, { error: `Shared edit rejected: ${error instanceof Error ? error.message : 'invalid document'}`, registers: room.replica.export() }); return }
        room.replica = candidate
        this.broadcast(room, 'changes', changes)
      }
      peer.presence = nextPresence
      if (data.presence) this.broadcast(room, 'peers', this.peers(room))
      reply(response, 200, {}); return
    }
    reply(response, 404, { error: 'Unknown collaboration endpoint' })
  }
}
