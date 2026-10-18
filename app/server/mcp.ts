import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PaperMcpServer } from '../mcp/server.ts'
import type { PaperToolBackend } from '../mcp/server.ts'
import { basicInfo, executeTransaction, exportCanvas, IdempotencyCache, mutateCanvas, readCanvas, searchLayers, selectionContext, validateTransaction } from '../src/mcp/operations.ts'
import type { ToolArguments } from '../src/mcp/operations.ts'
import { paperTools } from '../src/mcp/schema.ts'
import type { PaperTool } from '../src/mcp/schema.ts'
import { createProject } from '../src/io/project.ts'
import { SceneStore } from '../src/scene/store.ts'
import type { CloudProject } from '../src/cloud/model.ts'
import type { Auth } from './auth.ts'
import { hash, httpError, safeId, Storage } from './storage.ts'

const versions = ['2025-11-25', '2025-06-18', '2025-03-26']
const sessionLifetime = 30 * 60_000
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const remoteTools: readonly PaperTool[] = [
  { name: 'list_projects', description: 'List persisted projects in your account.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  ...paperTools.map(tool => {
    const properties = { ...tool.inputSchema.properties }
    delete properties.file
    delete properties.output
    return {
      ...tool,
      description: tool.name === 'export_selection'
        ? 'Export project artwork as JSON or SVG inline. Shader SVG needs browser-captured shader_snapshots; JSON preserves native paints.'
        : tool.description.replace('currently open file', 'persisted project').replace('active file', 'persisted project').replace('Creation is atomic and undoable.', 'Creation is atomic.'),
      inputSchema: { ...tool.inputSchema, properties: { ...properties, project_id: { type: 'string' as const, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$', description: 'Project ID from list_projects. A new ID with create_frame starts a project.' } }, required: [...tool.inputSchema.required ?? [], 'project_id'] },
    }
  }),
]

/** No caller-controlled paths: every operation uses the authenticated account directory. */
class RemoteWorkspace implements PaperToolBackend {
  constructor(private readonly storage: Storage, private readonly idempotency: IdempotencyCache, private readonly userId: string, private readonly authorized: () => boolean, private readonly changed: (user: string, project: CloudProject) => void) {}

  async call(name: string, args: ToolArguments): Promise<Record<string, unknown>> {
    if (!this.authorized()) throw httpError(401, 'Token revoked or MCP session expired')
    if (name === 'list_projects') return { projects: await this.storage.list(this.userId) }
    const id = safeId(args.project_id)
    const { project_id: _id, ...input } = args
    if (name === 'apply_changes') validateTransaction(input)
    const receiptScope = `${this.userId}/${id}`
    return this.storage.locked(receiptScope, async () => {
      if (!this.authorized()) throw httpError(401, 'Token revoked or MCP session expired')
      if (name === 'apply_changes') {
        const cached = this.idempotency.get(receiptScope, input)
        if (cached) return cached
      }
      let saved = await this.storage.read(this.userId, id)
      if (!saved && name !== 'create_frame') throw httpError(404, 'Project not found. Use create_frame to start a project.')
      if (input.expected_revision !== undefined && input.expected_revision !== saved?.revision) throw httpError(409, 'Revision conflict; read the project again')
      const project = saved?.document ?? createProject(new SceneStore(), String(input.project_name ?? 'Untitled'), { x: 0, y: 0, zoom: 1 }, true)
      let output: Record<string, unknown>
      if (name === 'get_basic_info') output = basicInfo(project)
      else if (name === 'get_selection_context') output = selectionContext(project, (input.element_ids as string[] | undefined) ?? [], { projectId: id, project_id: id, revision: saved!.revision })
      else if (name === 'search_layers') output = searchLayers(project, input, { projectId: id, project_id: id, revision: saved!.revision })
      else if (name === 'get_canvas_elements') output = readCanvas(project, input.element_ids as string[] | undefined)
      else if (name === 'list_tokens') output = { tokens: (project.scene.tokens ?? []).filter(token => !input.type || token.type === input.type) }
      else if (name === 'export_selection') output = exportCanvas(project, input)
      else if (name === 'apply_changes') {
        if (input.expected_revision !== saved?.revision) throw httpError(409, 'Revision conflict; read the project again')
        if (input.dry_run) {
          const result = executeTransaction(project, input)
          return {
            project_id: id,
            revision: saved!.revision,
            dry_run: true,
            changedIds: result.changedIds,
            summary: result.summary,
            warnings: result.warnings,
            actionResults: result.actionResults,
          }
        }
        const result = executeTransaction(project, input)
        if (!this.authorized()) throw httpError(401, 'Token revoked or MCP session expired')
        const activity = { ids: [...result.changedIds], tool: name, until: Date.now() + 4000 }
        saved = await this.storage.write(this.userId, id, result.project, Math.max(Date.now(), (saved?.updatedAt ?? 0) + 1), saved, activity)
        this.changed(this.userId, saved)
        const response = {
          project_id: id,
          revision: saved?.revision,
          applied: true,
          changedIds: result.changedIds,
          summary: result.summary,
          warnings: result.warnings,
          actionResults: result.actionResults,
        }
        this.idempotency.set(receiptScope, input, response)
        return response
      } else {
        const mutated = mutateCanvas(project, name, input)
        if (!this.authorized()) throw httpError(401, 'Token revoked or MCP session expired')
        const activity = { ids: mutated.element ? [mutated.element.id] : [], tool: name, until: Date.now() + 4000 }
        saved = await this.storage.write(this.userId, id, mutated.project, Math.max(Date.now(), (saved?.updatedAt ?? 0) + 1), saved, activity)
        this.changed(this.userId, saved)
        output = mutated.element ? { element: mutated.element } : { token: mutated.token }
      }
      return { ...output, project_id: id, revision: saved?.revision }
    })
  }
}

interface Session {
  userId: string
  tokenHash: string
  server: PaperMcpServer
  authorized: () => boolean
  version: string
  ready: boolean
  lastSeen: number
  stream?: ServerResponse
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
function sse(res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
}
function accepts(header: string | undefined, type: string) {
  const entry = header?.split(',').map(part => part.trim().split(';').map(value => value.trim())).find(parts => parts[0].toLowerCase() === type)
  if (!entry) return 0
  const q = entry.slice(1).find(part => part.startsWith('q='))
  const weight = q ? Number(q.slice(2)) : 1
  return Number.isFinite(weight) && weight > 0 && weight <= 1 ? weight : 0
}

/** Streamable HTTP sessions are bound to both the account and the token generation. */
export class RemoteMcpGateway {
  private readonly idempotency = new IdempotencyCache()
  private readonly sessions = new Map<string, Session>()
  private readonly heartbeat: ReturnType<typeof setInterval>
  constructor(private readonly auth: Auth, private readonly storage: Storage, private readonly changed: (user: string, project: CloudProject) => void) {
    this.heartbeat = setInterval(() => {
      this.sweep()
      for (const session of this.sessions.values()) if (session.stream && !session.stream.write(': heartbeat\n\n')) this.endStream(session)
    }, 20_000)
    this.heartbeat.unref()
  }
  private endStream(session: Session) { session.stream?.end(); session.stream = undefined }
  private remove(id: string, session: Session) { this.sessions.delete(id); this.endStream(session) }
  private sweep() {
    for (const [id, session] of this.sessions) if (!session.authorized()) this.remove(id, session)
  }
  revokeUser(userId: string) {
    for (const [id, session] of this.sessions) if (session.userId === userId) this.remove(id, session)
  }
  close() {
    clearInterval(this.heartbeat)
    for (const [id, session] of this.sessions) this.remove(id, session)
  }
  notify(userId: string, project: CloudProject) {
    this.sweep()
    const message = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/paper/project_changed', params: { project_id: project.id, revision: project.revision } })}\n\n`
    // Each session owns at most one stream; a notification is delivered once per session.
    for (const session of this.sessions.values()) if (session.userId === userId && session.ready && session.stream && !session.stream.write(message)) this.endStream(session)
  }

  async handle(req: IncomingMessage, res: ServerResponse, readBody: () => Promise<Record<string, unknown>>) {
    const token = req.headers.authorization?.match(/^Bearer\s+(paper_[A-Za-z0-9_-]{43})$/i)?.[1]
    const agent = this.auth.bearer(token)
    if (!agent) { res.setHeader('WWW-Authenticate', 'Bearer realm="Paper"'); throw httpError(401, 'Invalid MCP token') }
    this.sweep()
    const protocol = req.headers['mcp-protocol-version']
    if (protocol !== undefined && (typeof protocol !== 'string' || !versions.includes(protocol))) throw httpError(400, 'Unsupported MCP protocol version')
    if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
      res.setHeader('Allow', 'POST, GET, DELETE')
      throw httpError(405, 'Use MCP POST, GET or DELETE')
    }
    const sessionId = req.headers['mcp-session-id']
    const session = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
    if (sessionId !== undefined && (!session || session.userId !== agent.id || session.tokenHash !== hash(token!))) throw httpError(404, 'Initialize a new MCP session')
    if (session && protocol && protocol !== session.version) throw httpError(400, 'MCP protocol version differs from the initialized session')
    if (req.method === 'DELETE') {
      if (!session) throw httpError(400, 'Missing MCP-Session-Id')
      this.remove(sessionId as string, session)
      res.writeHead(204); res.end(); return
    }
    if (req.method === 'GET') {
      if (!accepts(req.headers.accept, 'text/event-stream')) throw httpError(406, 'Accept text/event-stream')
      if (!session) throw httpError(400, 'Missing MCP-Session-Id')
      if (!session.ready) throw httpError(400, 'Send notifications/initialized before opening an MCP stream')
      if (session.stream) throw httpError(409, 'This MCP session already has an SSE stream')
      session.lastSeen = Date.now()
      session.stream = res
      res.on('close', () => { if (session.stream === res) session.stream = undefined })
      sse(res); res.write(': connected\n\n'); return
    }
    const jsonWeight = accepts(req.headers.accept, 'application/json')
    const sseWeight = accepts(req.headers.accept, 'text/event-stream')
    if (!jsonWeight || !sseWeight) throw httpError(406, 'Accept application/json and text/event-stream')
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json')
    const message = await readBody()
    const validId = !Object.hasOwn(message, 'id') || typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id))
    if (message.jsonrpc !== '2.0' || !validId || (message.params !== undefined && !record(message.params)) || (typeof message.method !== 'string' && !(Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || record(message.error))))) {
      json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }); return
    }
    if (!session) {
      if (message.method !== 'initialize' || message.id === undefined) throw httpError(400, 'Initialize first, then include MCP-Session-Id')
      if (this.sessions.size >= 1000 || [...this.sessions.values()].filter(entry => entry.userId === agent.id).length >= 20) throw httpError(429, 'Too many MCP sessions; close unused sessions with DELETE')
      const id = randomUUID()
      const params = record(message.params) ? message.params : {}
      const version = versions.find(version => version === params.protocolVersion) ?? versions[0]
      const newSession: Session = {
        userId: agent.id, tokenHash: hash(token!), version, ready: false, lastSeen: Date.now(),
        authorized: () => this.sessions.get(id) === newSession && Date.now() - newSession.lastSeen < sessionLifetime && this.auth.bearer(token)?.id === agent.id,
        server: new PaperMcpServer(new RemoteWorkspace(this.storage, this.idempotency, agent.id, () => newSession.authorized(), this.changed), {
          tools: remoteTools, protocolVersions: versions, serverInfo: { name: 'paper-cloud', version: '1.0.0' }, experimental: { 'paper/project-changed': {} },
          instructions: 'Call list_projects, then pass project_id to each tool. Start with get_basic_info, then search_layers and get_selection_context with explicit element_ids (headless mode has no human selection). These bounded reads publish input/output schemas in tools/list; inspect truncation and continue using nextCursor with identical filters. Edits work with the browser closed. Pass the opaque revision from targeted context/search as expected_revision to guard against stale edits; restart reads after conflicts. Use apply_changes for ordered multi-step edits: preview with dry_run:true, inspect summary/warnings, then apply with the same required expected_revision. Include a unique idempotency_key; retry the identical plan and original revision after an uncertain reply while the receipt is retained. Coordinates are relative to the parent frame; the grid is 120px. Read paper://schema and paper://shaders for the design contract. Exports return inline; filesystem paths are never accepted. GET /mcp can deliver optional notifications/paper/project_changed events; reconcile with list_projects after reconnecting.',
        }),
      }
      const reply = await newSession.server.handle(message)
      if (reply?.error) { json(res, 400, reply); return }
      this.sessions.set(id, newSession)
      res.setHeader('MCP-Session-Id', id)
      this.respond(res, reply, sseWeight > jsonWeight || (sseWeight === jsonWeight && req.headers.accept?.trim().startsWith('text/event-stream') === true))
      return
    }
    session.lastSeen = Date.now()
    if (typeof message.method !== 'string') { res.writeHead(202); res.end(); return }
    const reply = await session.server.handle(message)
    if (message.method === 'notifications/initialized' && message.id === undefined) session.ready = true
    this.respond(res, reply, sseWeight > jsonWeight || (sseWeight === jsonWeight && req.headers.accept?.trim().startsWith('text/event-stream') === true))
  }
  private respond(res: ServerResponse, reply: unknown, stream: boolean) {
    if (!reply) { res.writeHead(202); res.end(); return }
    if (stream) { sse(res); res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`) }
    else json(res, 200, reply)
  }
}
