import type { ViewportController } from '../canvas/ViewportController.ts'
import type { Point } from '../canvas/types.ts'
import type { SceneStore } from '../scene/store.ts'
import { equalValue } from '../scene/history.ts'
import { SceneReplica, getValueAtPath } from './model.ts'
import { COLLAB_PATH, PRESENCE_COLORS } from './types.ts'
import type { ConnectionStatus, Presence, Register, RoomState } from './types.ts'
import { CollaborativeUndoManager, type CRDTOperation } from './crdt/index.ts'

export const BACKOFF_INITIAL_MS = 2000
export const BACKOFF_MAX_MS = 30000
export const MAX_RETRY_ATTEMPTS = 5

export function isTerminalStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501
}

export function terminalErrorMessage(status: number): string {
  if (status === 404) return 'Collaboration service not found (404).'
  if (status === 405) return 'Collaboration endpoint not supported by server (405).'
  if (status === 501) return 'Collaboration feature not implemented on server (501).'
  return `Collaboration service unavailable (${status}).`
}

export function getBackoffDelay(attempt: number): number {
  return Math.min(BACKOFF_INITIAL_MS * Math.pow(2, attempt), BACKOFF_MAX_MS)
}

export interface CollaborationSnapshot {
  status: ConnectionStatus
  peers: readonly Presence[]
  following: string | null
  error: string
}

/** Canvas edits are synchronous. Network writes coalesce at 30 Hz; presence is ephemeral. */
export class CollaborationSession {
  readonly id = crypto.randomUUID()
  readonly room: string
  private store: SceneStore
  private controller: ViewportController
  private replica: SceneReplica
  private previous: ReturnType<SceneStore['toJSON']>
  private pending = new Map<string, Register>()
  private listeners = new Set<() => void>()
  private snapshot: CollaborationSnapshot = { status: 'connecting', peers: [], following: null, error: '' }
  private own: Presence
  private applying = false
  private stopped = true
  // Retain a client-generated credential even when the first join response is lost.
  private token: string = crypto.randomUUID()
  private source: EventSource | null = null
  private abort = new AbortController()
  private cleanup: (() => void)[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryAttempts = 0
  private connection = 0
  private joining: AbortController | null = null
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private dirtyPresence = true
  private sending = false
  private lastActivity = Date.now()
  private lastFollow = ''

  readonly undoManager: CollaborativeUndoManager

  constructor(room: string, store: SceneStore, controller: ViewportController, name: string, avatar?: string) {
    this.room = room; this.store = store; this.controller = controller
    this.undoManager = new CollaborativeUndoManager(this.id)
    this.previous = store.toJSON(); this.replica = new SceneReplica(this.id); this.replica.seed(this.previous)
    const { camera, size } = controller.getSnapshot()
    this.own = {
      id: this.id,
      name,
      color: PRESENCE_COLORS[parseInt(this.id.slice(0, 6), 16) % PRESENCE_COLORS.length],
      status: 'active',
      cursor: null,
      selection: store.getSnapshot().selection,
      viewport: { center: controller.screenToWorld({ x: size.width / 2, y: size.height / 2 }), zoom: camera.zoom, size },
      following: null,
      ...(avatar ? { avatar } : {}),
    }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<CollaborationSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener() }
  private endpoint(route: string) { return `${(import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')}${COLLAB_PATH}/${this.room}/${route}?id=${this.id}&token=${encodeURIComponent(this.token)}` }
  private async post(route: string, data: unknown, signal = this.abort.signal) {
    return fetch(this.endpoint(route), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.any([this.abort.signal, signal, AbortSignal.timeout(8000)]) })
  }
  retry = () => {
    if (this.stopped) return
    this.retryAttempts = 0
    this.update({ status: 'connecting', error: '' })
    void this.connect()
  }
  private markUnavailable(error: string) {
    if (this.stopped) return
    ++this.connection
    this.joining?.abort(); this.joining = null
    this.source?.close(); this.source = null
    if (this.snapshot.following) this.controller.stop()
    this.lastFollow = ''
    this.own.following = null
    clearTimeout(this.timer); this.timer = undefined
    clearTimeout(this.retryTimer); this.retryTimer = undefined
    this.update({ status: 'unavailable', peers: [], following: null, error })
  }
  start() {
    if (!this.stopped || this.abort.signal.aborted) return
    this.stopped = false
    this.retryAttempts = 0
    this.cleanup.push(this.store.subscribe(() => {
      if (this.applying) return
      const next = this.store.toJSON()
      const changes = this.replica.change(this.previous, next)
      if (changes.length) {
        this.lastActivity = Date.now()
        this.own.status = 'active'
        const ops: CRDTOperation[] = []
        for (const change of changes) {
          const beforeVal = getValueAtPath(this.previous, change.path)
          ops.push({
            path: change.path,
            beforeValue: beforeVal,
            afterValue: change.value,
            beforeDeleted: beforeVal === undefined,
            afterDeleted: Boolean(change.deleted),
            clock: change.clock,
          })
        }
        this.undoManager.recordOperations(ops)
      }
      for (const change of changes) this.pending.set(JSON.stringify(change.path), change)
      this.previous = next
      this.own.selection = this.store.getSnapshot().selection
      this.dirtyPresence = true; this.schedule()
    }))
    this.cleanup.push(this.controller.subscribe(({ camera, size }) => {
      this.own.viewport = { center: this.controller.screenToWorld({ x: size.width / 2, y: size.height / 2 }), zoom: camera.zoom, size }
      this.dirtyPresence = true; this.schedule()
    }))
    const visibility = () => {
      this.own.status = document.hidden ? 'away' : 'active'
      if (!document.hidden) this.lastActivity = Date.now()
      if (document.hidden) this.own.cursor = null
      this.dirtyPresence = true; this.schedule()
    }
    const online = () => { if (this.snapshot.status !== 'live') { this.retryAttempts = 0; void this.connect() } }
    const offline = () => this.disconnected()
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visibility)
    this.cleanup.push(() => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visibility) })
    this.heartbeat = setInterval(() => {
      this.own.status = document.hidden ? 'away' : Date.now() - this.lastActivity > 60_000 ? 'idle' : 'active'
      this.dirtyPresence = true; this.schedule()
    }, 10_000)
    void this.connect()
  }
  private async connect() {
    if (this.stopped) return
    const connection = ++this.connection
    this.joining?.abort()
    const joining = new AbortController(); this.joining = joining
    clearTimeout(this.retryTimer); this.retryTimer = undefined
    clearTimeout(this.timer); this.timer = undefined
    this.source?.close(); this.source = null
    try {
      const response = await this.post('join', { id: this.id, token: this.token, presence: this.own, document: this.previous }, joining.signal)
      if (this.stopped || connection !== this.connection) return
      if (isTerminalStatus(response.status)) {
        this.markUnavailable(terminalErrorMessage(response.status))
        return
      }
      if (!response.ok) throw new Error(`Room service unavailable (${response.status})`)
      const state = await response.json() as RoomState & { token: string }
      if (this.stopped || connection !== this.connection) return
      this.token = state.token
      this.retryAttempts = 0
      this.receiveState(state)
      const source = new EventSource(this.endpoint('events')); this.source = source
      source.addEventListener('state', event => {
        if (this.stopped || connection !== this.connection) return
        try {
          this.receiveState(JSON.parse((event as MessageEvent<string>).data) as RoomState)
          this.retryAttempts = 0
          this.update({ status: 'live', error: '' }); this.dirtyPresence = true; this.schedule()
        } catch { this.disconnected() }
      })
      source.addEventListener('changes', event => {
        if (this.stopped || connection !== this.connection) return
        try {
          const incoming = JSON.parse((event as MessageEvent<string>).data) as Register[]
          this.replica.merge(incoming)
          this.undoManager.rebase(incoming)
          this.apply()
        }
        catch { this.disconnected() }
      })
      source.addEventListener('peers', event => {
        if (this.stopped || connection !== this.connection) return
        try { this.receivePeers(JSON.parse((event as MessageEvent<string>).data) as Presence[]) } catch { this.disconnected() }
      })
      source.onerror = () => { if (connection === this.connection) this.disconnected() }
    } catch { if (!this.stopped && connection === this.connection) this.disconnected() }
  }
  private receiveState(state: RoomState) {
    this.replica = new SceneReplica(this.id, state.registers)
    this.replica.merge([...this.pending.values()])
    this.undoManager.rebase(state.registers)
    this.apply(); this.receivePeers(state.peers)
  }
  private receivePeers(peers: Presence[]) {
    const remote = peers.filter(peer => peer.id !== this.id)
    const following = remote.find(peer => peer.id === this.snapshot.following)
    const nextFollowing = following && following.status !== 'away' && !following.following ? following.id : null
    if (this.snapshot.following && !nextFollowing) { this.controller.stop(); this.lastFollow = ''; this.dirtyPresence = true; this.schedule() }
    this.update({ peers: remote, following: nextFollowing })
    this.own.following = this.snapshot.following
    this.followCamera()
  }
  private apply() {
    const document = this.replica.document()
    if (equalValue(document, this.previous)) return
    this.applying = true
    try {
      this.store.applyRemote(document); this.previous = this.store.toJSON()
      const selection = this.store.getSnapshot().selection
      if (!equalValue(this.own.selection, selection)) { this.own.selection = selection; this.dirtyPresence = true; this.schedule() }
    }
    finally { this.applying = false }
  }
  private disconnected() {
    if (this.stopped) return
    ++this.connection; this.joining?.abort(); this.joining = null
    this.source?.close(); this.source = null
    if (this.snapshot.following) this.controller.stop()
    this.lastFollow = ''
    this.own.following = null
    clearTimeout(this.timer); this.timer = undefined
    clearTimeout(this.retryTimer); this.retryTimer = undefined

    if (this.retryAttempts >= MAX_RETRY_ATTEMPTS) {
      this.update({
        status: 'unavailable',
        peers: [],
        following: null,
        error: 'Collaboration connection paused after repeated failures. Click Retry to reconnect.',
      })
      return
    }

    const delay = getBackoffDelay(this.retryAttempts)
    this.retryAttempts++

    this.update({ status: navigator.onLine ? 'reconnecting' : 'offline', peers: [], following: null, error: '' })
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.connect() }, delay)
  }
  private schedule() {
    if (this.stopped || this.timer || this.snapshot.status !== 'live') return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 33)
  }
  private async flush() {
    if (this.sending || this.stopped || this.snapshot.status !== 'live') return
    const changes = [...this.pending.values()]
    const sendPresence = this.dirtyPresence
    if (!changes.length && !sendPresence) return
    this.sending = true; this.dirtyPresence = false
    const connection = this.connection
    try {
      const response = await this.post('update', { ...(changes.length ? { changes } : {}), ...(sendPresence ? { presence: this.own } : {}) })
      if (connection !== this.connection || this.stopped) return
      if (isTerminalStatus(response.status)) {
        this.dirtyPresence = true
        this.markUnavailable(terminalErrorMessage(response.status))
        return
      }
      if (response.status === 409) {
        const rejected = await response.json() as { error: string; registers: Register[] }
        if (connection !== this.connection || this.stopped) return
        for (const change of changes) if (this.pending.get(JSON.stringify(change.path)) === change) this.pending.delete(JSON.stringify(change.path))
        this.replica = new SceneReplica(this.id, rejected.registers); this.replica.merge([...this.pending.values()]); this.apply()
        this.update({ error: rejected.error })
      } else if (!response.ok) throw new Error('Connection interrupted')
      else for (const change of changes) if (this.pending.get(JSON.stringify(change.path)) === change) this.pending.delete(JSON.stringify(change.path))
    } catch { this.dirtyPresence = true; if (connection === this.connection) this.disconnected() }
    finally { this.sending = false; if (this.pending.size || this.dirtyPresence) this.schedule() }
  }
  setName(name: string) { this.own.name = name; this.dirtyPresence = true; this.schedule() }
  setAvatar(avatar?: string) {
    if (this.own.avatar !== avatar) {
      this.own.avatar = avatar
      this.dirtyPresence = true
      this.schedule()
    }
  }
  setPointerDown(pointerDown: boolean) {
    if (this.own.pointerDown !== pointerDown) {
      this.own.pointerDown = pointerDown
      this.dirtyPresence = true
      this.schedule()
    }
  }
  setActivity(activity?: string) {
    if (this.own.activity !== activity) {
      this.own.activity = activity
      this.dirtyPresence = true
      this.schedule()
    }
  }
  setChat(chat: string | null) {
    this.own.chat = chat
    this.own.chatTimestamp = chat ? Date.now() : undefined
    this.dirtyPresence = true
    this.schedule()
  }
  undo = (): boolean => {
    const inverse = this.undoManager.undo(() => this.replica.nextClock())
    if (!inverse.length) return false
    this.replica.merge(inverse)
    for (const reg of inverse) this.pending.set(JSON.stringify(reg.path), reg)
    this.apply()
    this.dirtyPresence = true
    this.schedule()
    return true
  }
  redo = (): boolean => {
    const forward = this.undoManager.redo(() => this.replica.nextClock())
    if (!forward.length) return false
    this.replica.merge(forward)
    for (const reg of forward) this.pending.set(JSON.stringify(reg.path), reg)
    this.apply()
    this.dirtyPresence = true
    this.schedule()
    return true
  }
  setCursor(cursor: Point | null) {
    this.own.cursor = cursor
    if (cursor) {
      this.lastActivity = Date.now()
      this.own.status = 'active'
      this.own.cursorTimestamp = this.lastActivity
    } else {
      this.own.cursorTimestamp = undefined
    }
    this.dirtyPresence = true; this.schedule()
  }
  follow(id: string | null) {
    const peer = this.snapshot.peers.find(peer => peer.id === id)
    const following = peer && peer.status !== 'away' && !peer.following ? peer.id : null
    if (this.snapshot.following && !following) this.controller.stop()
    this.lastFollow = ''
    this.update({ following }); this.own.following = following
    this.dirtyPresence = true; this.schedule(); this.followCamera()
  }
  private followCamera() {
    const peer = this.snapshot.peers.find(peer => peer.id === this.snapshot.following)
    if (!peer) return
    const { center, zoom } = peer.viewport, { size } = this.controller.getSnapshot()
    const signature = `${peer.id}:${center.x}:${center.y}:${zoom}:${size.width}:${size.height}`
    if (signature === this.lastFollow) return
    this.lastFollow = signature
    this.controller.setCamera({ x: size.width / 2 - center.x * zoom, y: size.height / 2 - center.y * zoom, zoom })
  }
  stop() {
    if (this.stopped) return
    this.stopped = true; this.source?.close(); this.source = null; this.abort.abort()
    ++this.connection; this.joining?.abort(); this.joining = null
    if (this.snapshot.following) this.controller.stop()
    clearTimeout(this.timer); clearTimeout(this.retryTimer); clearInterval(this.heartbeat)
    for (const cleanup of this.cleanup) cleanup()
    this.cleanup = []
    this.retryAttempts = 0
    if (this.token) void fetch(this.endpoint('leave'), { method: 'POST', keepalive: true }).catch(() => {})
  }
}
