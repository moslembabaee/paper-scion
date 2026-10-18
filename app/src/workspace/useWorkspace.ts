import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewportController } from '../canvas/ViewportController'
import type { Camera } from '../canvas/types'
import { createProject, parseProject } from '../io/project'
import type { PaperProject } from '../io/project'
import { createWorkspace } from '../io/useProjectIO'
import { SceneStore } from '../scene/store'
import { activateProject, initializeProjects, listLocalProjects, localProject, projectSummary, readProject, subscribeProjectChanges, updateLocalProject, writeProject } from './database'
import type { LocalProject, ProjectSummary } from './types'
import { canonical } from '../cloud/model'
import { roomFromHash } from '../collaboration/room'

interface EditorWorkspace {
  record: LocalProject
  project: PaperProject
  store: SceneStore
  controller: ViewportController
  initialCamera?: Camera
}

function editorWorkspace(record: LocalProject): EditorWorkspace {
  const project = parseProject(JSON.stringify(record.document))
  const store = new SceneStore()
  store.load(project.scene)
  store.clearHistory()
  return { record, project, store, controller: new ViewportController(project.viewport), initialCamera: project.viewport }
}

export function useWorkspace(owner?: string) {
  const [initial] = useState(createWorkspace)
  const [active, setActive] = useState<EditorWorkspace | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [error, setError] = useState('')
  const [persistent, setPersistent] = useState(true)
  const initialization = useRef<ReturnType<typeof initializeProjects> | null>(null)
  const records = useRef(new Map<string, LocalProject>())
  const updateSummary = useCallback((summary: ProjectSummary) => {
    setProjects(current => {
      const previous = current.find(project => project.id === summary.id)
      if (previous?.name === summary.name && previous.updatedAt === summary.updatedAt) return current
      return [...current.filter(project => project.id !== summary.id), summary].sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])

  useEffect(() => subscribeProjectChanges(() => {
    void listLocalProjects().then(records => setProjects(records.filter(record => !owner || record.cloud?.owner === owner).map(projectSummary).sort((a, b) => b.updatedAt - a.updatedAt))).catch(() => {})
  }), [owner])

  useEffect(() => {
    let cancelled = false
    const seed = initial.project ?? createProject(initial.store, 'Space to think', initial.controller.getSnapshot().camera, true)
    initialization.current ??= initializeProjects(seed, owner)
    void initialization.current.then(async restored => {
      const room = roomFromHash(window.location.hash)
      if (room && room !== restored.active.id && room !== restored.active.cloud?.projectId) {
        let shared: LocalProject
        try {
          try { shared = await readProject(owner ? `${owner}_${room}` : room) }
          catch { shared = await readProject(room) }
          if (owner && shared.cloud?.owner !== owner) throw new Error('This canvas belongs to another account.')
        }
        catch {
          const document = createProject(new SceneStore(), 'Shared canvas', { x: 0, y: 0, zoom: 1 }, true)
          shared = { ...localProject(document), id: owner ? `${owner}_${room}` : room }
          if (owner) shared.cloud = { owner, projectId: room, revision: null, syncedAt: 0, dirty: true }
          await writeProject(shared)
        }
        if (cancelled) return
        await activateProject(shared.id, owner)
        restored = { ...restored, active: shared, created: false, projects: [...restored.projects.filter(project => project.id !== shared.id), projectSummary(shared)] }
      }
      if (cancelled) return
      const workspace = restored.created && !initial.project && canonical(restored.active.document) === canonical(seed)
        ? { record: restored.active, project: seed, store: initial.store, controller: initial.controller, initialCamera: undefined }
        : editorWorkspace(restored.active)
      records.current.set(restored.active.id, restored.active)
      setProjects(restored.projects)
      setActive(workspace)
      setError(initial.restoreError)
    }).catch(reason => {
      if (cancelled) return
      setPersistent(false)
      const record = localProject(seed)
      // Keep the demo's initial fit when storage is unavailable.
      setActive({ record, ...initial, project: seed, initialCamera: initial.project?.viewport })
      setProjects([projectSummary(record)])
      setError(`${reason instanceof Error ? reason.message : 'IndexedDB is unavailable.'} Changes are in memory; save a JSON copy before closing Paper.`)
    })
    return () => { cancelled = true }
  }, [initial, owner])

  const save = useCallback(async (id: string, document: PaperProject) => {
    if (!persistent) throw new Error('Local storage is unavailable. Save a JSON copy before closing Paper.')
    let changed = false
    const record = await updateLocalProject(id, previous => {
      if (!previous) throw new Error('The open project could not be found.')
      if (owner && previous.cloud?.owner !== owner) throw new Error('This project belongs to another account.')
      changed = canonical(previous.document) !== canonical(document)
      if (!changed) return previous
      return { ...previous, document, name: document.name, updatedAt: Date.now(), ...(previous.cloud ? { cloud: { ...previous.cloud, dirty: true } } : {}) }
    })
    if (!record) return
    records.current.set(id, record)
    if (changed) updateSummary(projectSummary(record))
  }, [persistent, updateSummary, owner])

  const open = useCallback(async (id: string) => {
    const record = await readProject(id)
    if (owner && record.cloud?.owner !== owner) throw new Error('This project belongs to another account.')
    const workspace = editorWorkspace(record)
    await activateProject(id, owner)
    records.current.set(id, record)
    setActive(workspace)
  }, [owner])

  const create = useCallback(async (name: string, grid: boolean, cloudOwner?: string) => {
    const document = createProject(new SceneStore(), name, { x: 0, y: 0, zoom: 1 }, grid)
    const record = localProject(document)
    const account = owner ?? cloudOwner
    if (account) record.cloud = { owner: account, projectId: record.id, revision: null, syncedAt: 0, dirty: true }
    await writeProject(record, true)
    records.current.set(record.id, record)
    updateSummary(projectSummary(record))
    setActive(editorWorkspace(record))
  }, [updateSummary, owner])

  const rename = useCallback(async (id: string, name: string) => {
    const record = await updateLocalProject(id, previous => {
      if (!previous) throw new Error('This project could not be found.')
      if (owner && previous.cloud?.owner !== owner) throw new Error('This project belongs to another account.')
      return { ...previous, name, updatedAt: Date.now(), document: { ...previous.document, name }, ...(previous.cloud ? { cloud: { ...previous.cloud, dirty: true } } : {}) }
    })
    if (!record) return
    records.current.set(id, record)
    updateSummary(projectSummary(record))
  }, [updateSummary, owner])

  const acceptCloud = useCallback(async (record: LocalProject, expected?: PaperProject, preserveConflict = false) => {
    const accepted = await updateLocalProject(record.id, previous => {
      if (owner && (record.cloud?.owner !== owner || (previous?.cloud && previous.cloud.owner !== owner))) return undefined
      if (expected && (!previous || canonical(previous.document) !== canonical(expected))) return undefined
      return record
    }, 'cloud', preserveConflict)
    if (!accepted) return false
    records.current.set(record.id, accepted)
    updateSummary(projectSummary(accepted))
    return true
  }, [updateSummary, owner])

  return { active, projects, persistent, error, save, open, create, rename, acceptCloud }
}
