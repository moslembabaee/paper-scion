import { useCallback, useEffect, useRef, useState } from 'react'
import type { useWorkspace } from '../workspace/useWorkspace'
import { listLocalProjects, readProject, subscribeProjectChanges } from '../workspace/database'
import type { LocalProject } from '../workspace/types'
import type { useProjectIO } from '../io/useProjectIO'
import type { CloudProject, CloudUser } from './model'
import { canonical, newer } from './model'
import { api, ApiError } from './api'
import type { AgentActivity } from '../mcp/protocol'

export type SyncState = 'pending' | 'syncing' | 'synced' | 'offline' | 'auth-required' | 'error'
const labels: Record<SyncState, string> = {
  pending: 'Saving…', syncing: 'Saving…', synced: 'Saved to Cloud',
  offline: 'Offline · saved locally', 'auth-required': 'Sign in to sync', error: 'Sync needs attention',
}

/** IndexedDB acts strictly as a transparent offline-first cache; canvas edits never await a network. */
export function useCloudSync(manager: ReturnType<typeof useWorkspace>, io: ReturnType<typeof useProjectIO>, user: CloudUser | null, onSettings: (record: CloudProject) => void) {
  const [state, setState] = useState<SyncState>(user ? 'pending' : 'auth-required')
  const [activity, setActivity] = useState<AgentActivity | null>(null)
  const [error, setError] = useState('')
  const current = useRef({ manager, io, user, onSettings })
  current.current = { manager, io, user, onSettings }
  const kick = useRef<() => void>(() => {})
  const activeId = manager.active?.record.id

  useEffect(() => {
    if (!user) { setState('auth-required'); setError(''); return }
    if (!manager.persistent) { setState('error'); setError('The offline cache is unavailable. Export a JSON copy to keep your edits.'); return }
    setState(navigator.onLine ? 'pending' : 'offline')
    let stopped = false, running = false, again = false, authPaused = false, failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    const owner = user.id
    const valid = () => !stopped && current.current.user?.id === owner
    const changed = (local: LocalProject, version: number) => local.id === current.current.manager.active?.record.id &&
      (current.current.io.getEditVersion() !== version || current.current.io.hasPendingEdits())
    const revision = async (record: LocalProject) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(record.document))))).map(v => v.toString(16).padStart(2, '0')).join('')
    const showActivity = (remote: CloudProject) => {
      if (valid() && remote.activity && remote.activity.until > Date.now()) setActivity(remote.activity)
    }
    const apply = async (local: LocalProject | undefined, remote: CloudProject, version: number) => {
      if (!valid()) return
      // Both the persisted compare-and-swap and the live edit version must still match.
      if (local && changed(local, version)) { again = true; return }
      const differs = !!local && canonical(local.document) !== canonical(remote.document)
      const record: LocalProject = {
        id: local?.id ?? `${owner}_${remote.id}`, name: remote.document.name, document: remote.document,
        createdAt: remote.createdAt, updatedAt: remote.updatedAt,
        cloud: { owner, projectId: remote.id, revision: remote.revision, syncedAt: remote.updatedAt, dirty: false },
      }
      // A losing offline edit is kept as a recovery project in the same transaction.
      if (!await current.current.manager.acceptCloud(record, local?.document, differs && !!local?.cloud?.dirty)) { again = true; return }
      if (!valid()) return
      if (local && changed(local, version)) { again = true; return }
      if (record.id === current.current.manager.active?.record.id) {
        if (canonical(current.current.io.getProject()) !== canonical(remote.document)) {
          if (!current.current.io.applyRemoteProject(remote.document, version)) { again = true; return }
          current.current.onSettings(remote)
        }
        showActivity(remote)
      }
    }
    const advanceRevision = async (local: LocalProject, remote: CloudProject | null) => {
      if (!valid()) return
      await current.current.manager.acceptCloud({ ...local, cloud: { ...local.cloud!, revision: remote?.revision ?? null, dirty: true } }, local.document)
      again = true
    }
    const schedule = (delay = 350) => {
      if (!valid() || authPaused || !navigator.onLine) return
      if (running) { again = true; return }
      // Keep the first flush so continuous edits cannot starve syncing.
      if (timer) return
      timer = setTimeout(() => { timer = undefined; void run() }, delay)
    }
    const run = async () => {
      if (!valid() || authPaused) return
      if (!navigator.onLine) { setState('offline'); return }
      if (running) { again = true; return }
      running = true; again = false
      request = new AbortController()
      const options = { headers: { 'X-Paper-Account': owner }, signal: request.signal }
      try {
        await current.current.io.persistProject()
        if (!valid()) return
        const version = current.current.io.getEditVersion()
        const locals = await listLocalProjects()
        if (!valid()) return
        // Silently claim legacy unowned projects; another account's cache is never adopted.
        for (const record of locals) {
          if (!valid()) return
          if (!record.cloud) {
            const adopted: LocalProject = {
              ...record,
              cloud: { owner, projectId: record.id, revision: null, syncedAt: 0, dirty: true },
            }
            if (!await current.current.manager.acceptCloud(adopted, record.document)) again = true
          }
        }
        if (!valid()) return
        const updatedLocals = await listLocalProjects()
        // A clean tab follows durable changes from another tab, including offline edits.
        const active = updatedLocals.find(record => record.id === current.current.manager.active?.record.id)
        if (active?.cloud?.owner === owner && !changed(active, version) && canonical(current.current.io.getProject()) !== canonical(active.document)) {
          if (!current.current.io.applyRemoteProject(active.document, version)) again = true
        }
        const known = updatedLocals.filter(record => record.cloud?.owner === owner)
        if (known.some(record => record.cloud?.dirty)) setState('syncing')
        const { projects: remoteList } = await api<{ projects: Pick<CloudProject, 'id' | 'revision'>[] }>('/projects', options)
        if (!valid()) return
        for (const entry of remoteList) {
          if (!valid()) return
          const local = known.find(record => record.cloud?.projectId === entry.id)
          if (local?.cloud?.revision === entry.revision) continue
          setState('syncing')
          const remote = await api<CloudProject>(`/projects/${encodeURIComponent(entry.id)}`, options)
          if (!valid()) return
          const fresh = local ? await readProject(local.id) : undefined
          if (!fresh?.cloud?.dirty || !newer({ updatedAt: fresh.updatedAt, revision: await revision(fresh) }, remote)) await apply(fresh, remote, version)
          else await advanceRevision(fresh, remote)
        }
        for (const snapshot of await listLocalProjects()) {
          if (!valid()) return
          if (snapshot.cloud?.owner !== owner || !snapshot.cloud.dirty) continue
          setState('syncing')
          try {
            const remote = await api<CloudProject>(`/projects/${encodeURIComponent(snapshot.cloud.projectId)}`, {
              ...options, method: 'PUT', body: JSON.stringify({ document: snapshot.document, updatedAt: snapshot.updatedAt, expectedRevision: snapshot.cloud.revision }),
            })
            if (!valid()) return
            const latest = await readProject(snapshot.id)
            if (canonical(latest.document) === canonical(snapshot.document) && !changed(latest, version)) await apply(latest, remote, version)
            else {
              // Acknowledge just the uploaded version; edits made during the PUT stay dirty.
              const dirty = canonical(latest.document) !== canonical(remote.document) || changed(latest, version)
              await current.current.manager.acceptCloud({ ...latest, cloud: { ...latest.cloud!, revision: remote.revision, syncedAt: remote.updatedAt, dirty } }, latest.document)
              again = true
            }
          } catch (failure) {
            if (!valid()) return
            if (!(failure instanceof ApiError) || failure.status !== 409) throw failure
            const fresh = await readProject(snapshot.id)
            if (!failure.current || newer({ updatedAt: fresh.updatedAt, revision: await revision(fresh) }, failure.current)) await advanceRevision(fresh, failure.current ?? null)
            else await apply(fresh, failure.current, version)
          }
        }
        if (!valid()) return
        const owned = (await listLocalProjects()).filter(record => record.cloud?.owner === owner)
        const open = owned.find(record => record.id === current.current.manager.active?.record.id)
        const pending = owned.some(record => record.cloud?.dirty) || (!!open && current.current.io.hasPendingEdits())
        setState(!open || pending ? 'pending' : 'synced')
        setError(''); failures = 0
        if (pending) again = true
      } catch (failure) {
        if (!valid()) return
        failures++
        if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
          authPaused = true; setState('auth-required')
          setError('Your account session changed. Sign in again to resume syncing. Your edits stay on this device.')
        } else if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
          authPaused = true; setState('error'); setError(failure.message)
        } else {
          setState('offline')
          setError('Cloud is unavailable. Local changes will sync when the connection returns.')
        }
      } finally {
        running = false; request = undefined
        if (valid() && !authPaused) {
          if (failures) schedule(Math.min(60_000, 2000 * 2 ** Math.min(failures - 1, 5)))
          else if (again) schedule()
        }
      }
    }
    const retry = () => { authPaused = false; failures = 0; clearTimeout(timer); timer = undefined; void run() }
    kick.current = retry
    const unsubscribe = subscribeProjectChanges(change => {
      if ((change.source !== 'local' && !change.external) || !valid()) return
      if (!running && !authPaused) setState(navigator.onLine ? 'pending' : 'offline')
      schedule()
    })
    let events: EventSource | undefined
    const connect = () => {
      if (!navigator.onLine || events || !valid() || authPaused) return
      events = new EventSource(`/api/events?account=${encodeURIComponent(owner)}`)
      events.addEventListener('project', () => schedule())
      events.onopen = () => schedule()
    }
    const online = () => { connect(); retry() }
    const offline = () => { request?.abort(); events?.close(); events = undefined; clearTimeout(timer); timer = undefined; setState('offline') }
    const focus = () => { if (!authPaused && !document.hidden) { connect(); schedule(0) } }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const poll = setInterval(() => { if (!document.hidden) schedule(0) }, 15_000)
    connect(); void run()
    return () => {
      stopped = true; request?.abort(); events?.close(); unsubscribe(); clearTimeout(timer); clearInterval(poll); kick.current = () => {}
      window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [user?.id, activeId, manager.persistent])

  useEffect(() => { if (!activity) return; const timeout = setTimeout(() => setActivity(null), Math.max(0, activity.until - Date.now())); return () => clearTimeout(timeout) }, [activity])
  const retry = useCallback(() => kick.current(), [])
  return { state, status: labels[state], retry, activity, error }
}
