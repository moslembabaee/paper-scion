import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_IMPORT_BYTES } from '../src/io/project.ts'
import { BRIDGE_PATH, DEFAULT_BRIDGE_URL } from '../src/mcp/protocol.ts'
import type { AgentRequest, BridgeRegistration, ToolReply } from '../src/mcp/protocol.ts'
import type { ToolArguments } from '../src/mcp/operations.ts'
import { PaperMcpServer } from './server.ts'
import type { PaperToolBackend } from './server.ts'

interface EditorSession extends BridgeRegistration { seen: number; activated: number; queue: AgentRequest[]; poll?: () => void }
interface Pending { clientId: string; timer: ReturnType<typeof setTimeout>; resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host)

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Content-Type must be application/json')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_IMPORT_BYTES) throw new Error('Bridge message exceeds 16 MB')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Requests are pushed to the editor's outstanding HTTP poll, with no polling latency. */
export class PaperBridge implements PaperToolBackend {
  private editors = new Map<string, EditorSession>()
  private pending = new Map<string, Pending>()
  private rpc = new Map<string, { server: PaperMcpServer; seen: number }>()
  private sequence = 0

  async call(name: string, args: ToolArguments): Promise<Record<string, unknown>> {
    if (args.file !== undefined) throw new Error('Live mode uses the active editor. Use --file for offline file edits.')
    const editors = [...this.editors.values()].filter(editor => Date.now() - editor.seen < 40_000)
    const editor = editors.sort((a, b) => b.activated - a.activated)[0]
    if (!editor) throw new Error('No live Paper editor connected. Open Paper and call get_basic_info again.')
    if (this.pending.size >= 100) throw new Error('Paper is busy. Retry when the current agent requests finish.')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        editor.queue = editor.queue.filter(request => request.id !== id)
        reject(new Error('The active editor did not respond. Check its connection before retrying; a mutation may have completed.'))
      }, 10_000)
      this.pending.set(id, { clientId: editor.clientId, timer, resolve, reject })
      editor.queue.push({ id, name, args, expiresAt: Date.now() + 9500 })
      editor.poll?.()
    })
  }

  private remove(clientId: string) {
    const editor = this.editors.get(clientId)
    if (!editor) return
    this.editors.delete(clientId)
    // Complete any outstanding poll without delivering calls for a closed file.
    editor.queue = []
    editor.poll?.()
    for (const [id, pending] of this.pending) if (pending.clientId === clientId) {
      clearTimeout(pending.timer); this.pending.delete(id); pending.reject(new Error('The active Paper project was closed.'))
    }
  }

  close() {
    for (const clientId of this.editors.keys()) this.remove(clientId)
    this.rpc.clear()
  }

  middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const isMcp = url.pathname === '/mcp' || url.pathname === `${BRIDGE_PATH}/mcp`
    if (!isMcp && !url.pathname.startsWith(`${BRIDGE_PATH}/`)) return next()
    void this.handle(request, response, url, isMcp).catch(error => {
      if (!response.headersSent && !response.destroyed) json(response, 400, { error: error instanceof Error ? error.message : 'Invalid bridge request' })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse, url: URL, isMcp: boolean) {
    // Reject DNS rebinding and web origins that cannot be a local Paper editor.
    const host = new URL(`http://${request.headers.host ?? 'invalid'}`).hostname
    if (!loopback(host) || !loopback(request.socket.remoteAddress ?? '')) { json(response, 403, { error: 'The Paper bridge is localhost-only' }); return }
    const origin = request.headers.origin
    if (origin) {
      const parsed = new URL(origin)
      if (!loopback(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol)) { json(response, 403, { error: 'Untrusted editor origin' }); return }
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, MCP-Protocol-Version')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      response.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id')
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    for (const editor of this.editors.values()) if (Date.now() - editor.seen > 40_000) this.remove(editor.clientId)
    for (const [id, session] of this.rpc) if (Date.now() - session.seen > 30 * 60_000) this.rpc.delete(id)
    if (isMcp) {
      const sessionId = request.headers['mcp-session-id']
      if (request.method === 'DELETE' && typeof sessionId === 'string') { this.rpc.delete(sessionId); response.writeHead(204); response.end(); return }
      if (request.method !== 'POST') { json(response, 405, { error: 'Use MCP JSON-RPC POST requests' }); return }
      const message = await body(request)
      let session = typeof sessionId === 'string' ? this.rpc.get(sessionId) : undefined
      if (!session && isRecord(message) && message.method === 'initialize' && !sessionId) {
        if (this.rpc.size >= 100) { json(response, 503, { error: 'Too many MCP sessions' }); return }
        const id = randomUUID()
        session = { server: new PaperMcpServer(this), seen: Date.now() }
        this.rpc.set(id, session)
        response.setHeader('MCP-Session-Id', id)
      }
      if (!session) { json(response, 404, { error: 'Initialize a new MCP session' }); return }
      session.seen = Date.now()
      const reply = await session.server.handle(message)
      if (reply) json(response, 200, reply)
      else { response.writeHead(202); response.end() }
      return
    }
    const route = url.pathname.slice(BRIDGE_PATH.length)
    if (route === '/health' && request.method === 'GET') { json(response, 200, { connected: this.editors.size > 0 }); return }
    if (route === '/connect' && request.method === 'POST') {
      const data = await body(request)
      if (!isRecord(data) || typeof data.clientId !== 'string' || !/^[\w-]{16,100}$/.test(data.clientId) || typeof data.projectId !== 'string' || data.projectId.length > 200 || typeof data.focused !== 'boolean') throw new Error('Invalid editor registration')
      const registration = data as unknown as BridgeRegistration
      const previous = this.editors.get(registration.clientId)
      if (previous && previous.projectId !== registration.projectId) this.remove(registration.clientId)
      if (!previous && this.editors.size >= 100) throw new Error('Too many editor sessions')
      const editor = this.editors.get(registration.clientId)
      const updated = { ...registration, seen: Date.now(), activated: registration.focused ? ++this.sequence : editor?.activated ?? 0 }
      if (editor) Object.assign(editor, updated)
      else this.editors.set(registration.clientId, { ...updated, queue: [] })
      json(response, 200, { connected: true }); return
    }
    const clientId = url.searchParams.get('clientId') ?? ''
    const editor = this.editors.get(clientId)
    if (!editor) { json(response, 404, { error: 'Editor session expired' }); return }
    editor.seen = Date.now()
    if (route === '/disconnect' && request.method === 'POST') { this.remove(clientId); json(response, 200, {}); return }
    if (route === '/events' && request.method === 'GET') {
      if (editor.poll) { json(response, 409, { error: 'An editor poll is already open' }); return }
      let timer: ReturnType<typeof setTimeout>
      const deliver = () => {
        clearTimeout(timer)
        editor.poll = undefined
        if (!response.destroyed) json(response, 200, { requests: editor.queue.splice(0) })
      }
      editor.poll = deliver
      timer = setTimeout(deliver, 25_000)
      response.on('close', () => { clearTimeout(timer); if (editor.poll === deliver) editor.poll = undefined })
      if (editor.queue.length) deliver()
      return
    }
    if (route === '/reply' && request.method === 'POST') {
      const data = await body(request)
      if (!isRecord(data) || typeof data.id !== 'string') throw new Error('Invalid tool reply')
      const pending = this.pending.get(data.id)
      if (pending?.clientId === clientId) {
        const reply = data as ToolReply
        clearTimeout(pending.timer); this.pending.delete(data.id)
        if (typeof reply.error === 'string') pending.reject(new Error(reply.error))
        else if (isRecord(reply.result)) pending.resolve(reply.result)
        else pending.reject(new Error('Invalid editor result'))
      }
      json(response, 200, {}); return
    }
    json(response, 404, { error: 'Unknown bridge endpoint' })
  }
}

/** Stdio agents use the same HTTP endpoint as native MCP HTTP clients. */
export class LivePaperClient implements PaperToolBackend {
  private sessionId?: string
  private id = 0
  private readonly endpoint: string
  constructor(endpoint = DEFAULT_BRIDGE_URL) { this.endpoint = endpoint }
  private async rpc(method: string, params: Record<string, unknown> = {}, notification = false) {
    let response: Response
    try {
      response = await fetch(`${this.endpoint.replace(/\/$/, '')}/mcp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.sessionId ? { 'MCP-Session-Id': this.sessionId } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++this.id }), method, params }), signal: AbortSignal.timeout(12_000),
      })
    } catch {
      throw new Error(`Cannot reach the Paper bridge at ${this.endpoint}. Start Paper or npm run bridge. If an edit timed out, read the canvas before retrying.`)
    }
    if (!response.ok) {
      if (response.status === 404) this.sessionId = undefined
      throw new Error(`Paper bridge returned ${response.status}. Start Paper or npm run bridge, then retry.`)
    }
    this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId
    if (notification) return
    const value = await response.json() as { result?: Record<string, unknown>; error?: { message: string } }
    if (value.error) throw new Error(value.error.message)
    return value.result
  }
  async call(name: string, args: ToolArguments) {
    if (!this.sessionId) {
      await this.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'paper-stdio-bridge', version: '0.1.0' } })
      await this.rpc('notifications/initialized', {}, true)
    }
    const reply = await this.rpc('tools/call', { name, arguments: args })
    if (reply?.isError) throw new Error((reply.content as { text: string }[])[0].text)
    return reply?.structuredContent as Record<string, unknown>
  }
}

export function createBridgeServer(bridge = new PaperBridge()) {
  const server = createServer((request, response) => bridge.middleware(request, response, () => json(response, 404, { error: 'Unknown endpoint' })))
  server.on('close', () => bridge.close())
  return server
}
