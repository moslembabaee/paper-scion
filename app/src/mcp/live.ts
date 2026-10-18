import { MAX_IMPORT_BYTES, parseProject } from '../io/project.ts'
import type { PaperProject } from '../io/project.ts'
import { equalValue } from '../scene/history.ts'
import type { SceneStore } from '../scene/store.ts'
import { basicInfo, executeTransaction, exportCanvas, IdempotencyCache, mutateCanvas, readCanvas, searchLayers, selectionContext, validateTransaction } from './operations.ts'
import type { ToolArguments } from './operations.ts'
import type { AgentActivity } from './protocol.ts'
import { paperTools, validateSchema } from './schema.ts'

interface Stamp { clock: number; source: string }
interface SyncMessage {
  kind: 'hello' | 'document' | 'activity' | 'settings'; projectId: string; source: string
  project?: PaperProject; stamp?: Stamp; activity?: AgentActivity | null
  settings?: { name: string; grid: boolean }
}
export interface LiveCanvasOptions {
  projectId: string; store: SceneStore; getProject: () => PaperProject
  onSettings: (project: PaperProject) => void
  onActivity: (activity: AgentActivity | null) => void
  /** The multiplayer room owns document merging; retain tab metadata and agent activity. */
  documentSync?: boolean
}
const newer = (a: Stamp, b: Stamp) => a.clock > b.clock || (a.clock === b.clock && a.source > b.source)

/** Browser-authoritative tools and deterministic, project-scoped tab synchronization. */
export class LiveCanvas {
  readonly clientId = crypto.randomUUID()
  private stamp: Stamp = { clock: 0, source: this.clientId }
  private channel?: BroadcastChannel
  private unsubscribe?: () => void
  private applying = false
  private synchronized = false
  private lastScene: ReturnType<SceneStore['getSnapshot']>
  private metadata: { name: string; grid: boolean }
  private timer?: ReturnType<typeof setTimeout>
  private activityTimer?: ReturnType<typeof setTimeout>
  private deferred?: SyncMessage
  private activity: AgentActivity | null = null
  private idempotency = new IdempotencyCache()

  private readonly options: LiveCanvasOptions
  constructor(options: LiveCanvasOptions) {
    this.options = options
    this.lastScene = options.store.getSnapshot()
    const { name, grid } = options.getProject()
    this.metadata = { name, grid }
  }
  get revision() { return `${this.stamp.clock}:${this.stamp.source}` }

  start() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('paper.live.v1')
      this.channel.onmessage = event => this.receive(event.data)
      this.channel.postMessage({ kind: 'hello', projectId: this.options.projectId, source: this.clientId })
    }
    this.unsubscribe = this.options.store.subscribe(() => {
      const next = this.options.store.getSnapshot()
      const previous = this.lastScene
      this.lastScene = next
      const changed = next.elements !== previous.elements || next.rootIds !== previous.rootIds || next.tokens !== previous.tokens || next.styleLibrary !== previous.styleLibrary || next.backgroundShader !== previous.backgroundShader
      if (!this.applying && changed) {
        this.synchronized = true
        this.stamp = { clock: this.stamp.clock + 1, source: this.clientId }
        this.schedule()
      }
      if (!this.options.store.getHistorySnapshot().active && this.deferred) {
        const deferred = this.deferred
        this.deferred = undefined
        this.receive(deferred)
      }
    })
  }

  metadataChanged() {
    const { name, grid } = this.options.getProject()
    if (name === this.metadata.name && grid === this.metadata.grid) return
    this.metadata = { name, grid }
    this.synchronized = true
    this.stamp = { clock: this.stamp.clock + 1, source: this.clientId }
    this.schedule()
  }
  private schedule() {
    clearTimeout(this.timer)
    // Serialize once after the gesture, never on every animation frame.
    this.timer = setTimeout(() => {
      if (this.options.store.getHistorySnapshot().active) this.schedule()
      else this.broadcast()
    }, 100)
  }
  private broadcast() {
    clearTimeout(this.timer)
    if (this.options.documentSync === false) {
      this.channel?.postMessage({ kind: 'settings', projectId: this.options.projectId, source: this.clientId, stamp: this.stamp, settings: this.metadata, activity: this.activity } satisfies SyncMessage)
      return
    }
    this.channel?.postMessage({ kind: 'document', projectId: this.options.projectId, source: this.clientId, stamp: this.stamp, project: this.options.getProject(), activity: this.activity } satisfies SyncMessage)
  }
  private broadcastActivity() {
    this.channel?.postMessage({ kind: 'activity', projectId: this.options.projectId, source: this.clientId, activity: this.activity } satisfies SyncMessage)
  }
  private showActivity(activity: AgentActivity | null) {
    clearTimeout(this.activityTimer)
    this.activity = activity && activity.until > Date.now() ? activity : null
    this.options.onActivity(this.activity)
    if (this.activity) this.activityTimer = setTimeout(() => { this.activity = null; this.options.onActivity(null) }, Math.max(0, this.activity.until - Date.now()))
  }
  private highlight(ids: readonly string[], tool: string) {
    // Keep recently touched layers lit as an agent works through a sequence.
    const previous = this.activity && this.activity.until > Date.now() ? this.activity.ids : []
    this.showActivity({ ids: [...new Set([...previous, ...ids])].slice(-100), tool, until: Date.now() + 2600 })
  }
  private receive(message: SyncMessage) {
    if (!message || message.projectId !== this.options.projectId || typeof message.source !== 'string' || message.source === this.clientId) return
    if (message.activity && (!Array.isArray(message.activity.ids) || !message.activity.ids.every(id => typeof id === 'string') || typeof message.activity.tool !== 'string' || !Number.isFinite(message.activity.until))) return
    if (message.kind === 'activity') { this.showActivity(message.activity ?? null); return }
    if (message.kind === 'hello') { if (!this.options.store.getHistorySnapshot().active) this.broadcast(); return }
    if (message.kind === 'settings' && message.settings && message.stamp && Number.isSafeInteger(message.stamp.clock) && typeof message.stamp.source === 'string' && typeof message.settings.name === 'string' && typeof message.settings.grid === 'boolean') {
      if (this.synchronized && !newer(message.stamp, this.stamp)) return
      this.stamp = message.stamp; this.synchronized = true; this.metadata = message.settings
      this.options.onSettings({ ...this.options.getProject(), ...message.settings })
      this.showActivity(message.activity ?? null)
      return
    }
    if (message.kind !== 'document' || !message.project || !message.stamp || !Number.isSafeInteger(message.stamp.clock) || message.stamp.clock < 0 || typeof message.stamp.source !== 'string') return
    if (this.options.documentSync === false) return
    if (this.synchronized && !newer(message.stamp, this.stamp)) return
    if (this.options.store.getHistorySnapshot().active) {
      if (!this.deferred?.stamp || newer(message.stamp, this.deferred.stamp)) this.deferred = message
      return
    }
    try {
      const project = parseProject(JSON.stringify(message.project))
      this.applying = true
      this.options.store.batch(() => {
        const selection = this.options.store.getSnapshot().selection
        this.options.store.load(project.scene)
        this.options.store.select(selection)
      }, message.activity ? `Agent: ${message.activity.tool}` : 'Sync from another tab')
      this.stamp = message.stamp
      this.synchronized = true
      this.metadata = { name: project.name, grid: project.grid }
      this.options.onSettings(project)
      this.showActivity(message.activity ?? null)
    } catch { /* An invalid peer document never replaces the active scene. */ }
    finally { this.applying = false }
  }

  call(name: string, args: ToolArguments): Record<string, unknown> {
    const tool = paperTools.find(tool => tool.name === name)
    if (!tool) throw new Error(`Unknown Paper tool: ${name}`)
    validateSchema(args, tool.inputSchema)
    if (args.file !== undefined) throw new Error('Live tools operate on the active editor; omit file.')
    const { store, getProject, projectId } = this.options
    const project = getProject()
    const context = () => ({ file: projectId, projectId, revision: this.revision, live: true })
    if (name === 'get_basic_info') return { ...context(), ...basicInfo(project, store.getSnapshot().selection) }
    if (name === 'get_selection_context') {
      const ids = args.element_ids !== undefined ? (args.element_ids as string[]) : store.getSnapshot().selection
      const result = selectionContext(project, ids, context())
      if (result.elements.length > 0) {
        this.highlight(result.elements.map(node => node.id), name)
        this.broadcastActivity()
      }
      return { ...context(), ...result }
    }
    if (name === 'search_layers') {
      const result = searchLayers(project, args, context())
      if (result.results.length > 0) {
        this.highlight(result.results.map(node => node.id), name)
        this.broadcastActivity()
      }
      return { ...context(), ...result }
    }
    if (name === 'get_canvas_elements') {
      const result = readCanvas(project, args.element_ids as string[] | undefined)
      if (args.element_ids) { this.highlight(result.elements.map(node => node.id), name); this.broadcastActivity() }
      return { ...context(), ...result }
    }
    if (name === 'list_tokens') return { ...context(), tokens: (project.scene.tokens ?? []).filter(token => !args.type || token.type === args.type) }
    if (name === 'export_selection') {
      if (args.output !== undefined) throw new Error('Live exports return content inline. Omit output, or use offline --file mode to write disk files.')
      const result = exportCanvas(project, args)
      this.highlight(result.elementIds, name)
      this.broadcastActivity()
      return { ...context(), ...result }
    }
    if (name === 'apply_changes') {
      validateTransaction(args)
      const cached = this.idempotency.get(projectId, args)
      if (cached) return cached
      if (store.getHistorySnapshot().active) throw new Error('A canvas gesture is in progress. Retry after it finishes.')
      if (args.expected_revision !== this.revision) throw new Error('Revision mismatch. Read the live canvas and retry.')

      if (args.dry_run) {
        const result = executeTransaction(project, args)
        return {
          ...context(),
          dry_run: true,
          changedIds: result.changedIds,
          summary: result.summary,
          warnings: result.warnings,
          actionResults: result.actionResults,
        }
      }

      const result = executeTransaction(project, args)
      const source = JSON.stringify(result.project)
      if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('The edited project exceeds 16 MB')
      const before = store.getSnapshot()
      const changed = !equalValue(project.scene, result.project.scene)
      if (changed) store.batch(() => { store.load(result.project.scene); store.select(before.selection) }, 'Agent: apply_changes')
      if (changed && !this.unsubscribe) this.stamp = { clock: this.stamp.clock + 1, source: this.clientId }
      this.highlight(result.changedIds, name)
      if (changed) this.broadcast()
      else this.broadcastActivity()
      const response = {
        ...context(),
        applied: true,
        changedIds: result.changedIds,
        summary: result.summary,
        warnings: result.warnings,
        actionResults: result.actionResults,
      }
      this.idempotency.set(projectId, args, response)
      return response
    }
    if (store.getHistorySnapshot().active) throw new Error('A canvas gesture is in progress. Retry after it finishes.')
    if (args.expected_revision !== undefined && args.expected_revision !== this.revision) throw new Error('Revision mismatch. Read the live canvas and retry.')
    // Disposable validation prevents partially applied structural or shader edits.
    const result = mutateCanvas(project, name, args)
    const source = JSON.stringify(result.project)
    if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('The edited project exceeds 16 MB')
    const before = store.getSnapshot()
    const ids = Object.keys(result.project.scene.elements).filter(id => !equalValue(before.elements[id], result.project.scene.elements[id]))
    const changed = !equalValue(project.scene, result.project.scene)
    if (changed) store.batch(() => { store.load(result.project.scene); store.select(before.selection) }, `Agent: ${name}`)
    // Also advance the revision when used without a running BroadcastChannel lifecycle.
    if (changed && !this.unsubscribe) this.stamp = { clock: this.stamp.clock + 1, source: this.clientId }
    this.highlight(ids.length ? ids : result.element ? [result.element.id] : [], name)
    if (changed) this.broadcast()
    else this.broadcastActivity()
    return { ...context(), ...(result.element ? { element: result.element } : { token: result.token }) }
  }

  close() {
    this.unsubscribe?.(); this.unsubscribe = undefined
    this.channel?.close()
    clearTimeout(this.timer); clearTimeout(this.activityTimer)
  }
}
