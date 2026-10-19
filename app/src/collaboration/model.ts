import { equalValue } from '../scene/history.ts'
import type { SceneDocument, SceneElement } from '../scene/types.ts'
import type { Register } from './types.ts'
import { VectorClock, LWWRegister } from './crdt/index.ts'

const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const key = (path: readonly string[]) => JSON.stringify(path)
const newer = (a: Register, b: Register) => a.clock > b.clock || (a.clock === b.clock && a.actor > b.actor)

function flatten(document: SceneDocument, changedIds?: ReadonlySet<string>, includeComments = true): Map<string, { path: string[]; value: unknown }> {
  const fields = new Map<string, { path: string[]; value: unknown }>()
  const visit = (value: unknown, path: string[]) => {
    if (record(value) && Object.keys(value).length) {
      for (const [name, child] of Object.entries(value)) visit(child, [...path, name])
    } else if (value !== undefined) fields.set(key(path), { path, value })
  }
  // Complex collections are atomic registers; element properties and paints merge independently.
  for (const name of ['tokens', 'styleLibrary', 'motion', 'prototype', 'backgroundShader', 'backgroundLayers'] as const) {
    if (document[name] !== undefined) fields.set(key([name]), { path: [name], value: document[name] })
  }
  // Independent message registers preserve concurrent replies to the same thread.
  for (const [id, thread] of Object.entries(includeComments ? document.comments ?? {} : {})) {
    fields.set(key(['comments', id, '$alive']), { path: ['comments', id, '$alive'], value: true })
    for (const name of ['id', 'anchor', 'createdAt', 'status'] as const) {
      const path = ['comments', id, name]
      fields.set(key(path), { path, value: thread[name] })
    }
    for (const [messageId, message] of Object.entries(thread.messages)) {
      const path = ['comments', id, 'messages', messageId]
      fields.set(key(path), { path, value: message })
    }
  }
  for (const [id, node] of Object.entries(document.elements)) {
    if (changedIds && !changedIds.has(id)) continue
    fields.set(key(['elements', id, '$alive']), { path: ['elements', id, '$alive'], value: true })
    for (const [name, value] of Object.entries(node)) if (name !== 'children') visit(value, ['elements', id, name])
  }
  return fields
}

/** Rebuild paint order from node registers so concurrent insertion cannot drop a sibling. */
export function normalizeHierarchy(document: SceneDocument): SceneDocument {
  const elements: Record<string, SceneElement> = { ...document.elements }
  const ids = Object.keys(elements).sort()
  for (const id of ids) {
    const node = elements[id]
    if (node.parentId !== null && (!elements[node.parentId] || elements[node.parentId].type !== 'frame')) elements[id] = { ...node, parentId: null }
  }
  for (const id of ids) {
    const path: string[] = []
    let current: string | null = id
    while (current !== null) {
      const index = path.indexOf(current)
      if (index >= 0) {
        const root = path.slice(index).sort()[0]
        elements[root] = { ...elements[root], parentId: null }
        break
      }
      path.push(current); current = elements[current].parentId
    }
  }
  const siblings = new Map<string | null, string[]>()
  for (const id of ids) {
    const parent = elements[id].parentId
    siblings.set(parent, [...(siblings.get(parent) ?? []), id])
  }
  for (const list of siblings.values()) {
    list.sort((a, b) => elements[a].zIndex - elements[b].zIndex || a.localeCompare(b, 'en'))
    list.forEach((id, zIndex) => { if (elements[id].zIndex !== zIndex) elements[id] = { ...elements[id], zIndex } })
  }
  for (const id of ids) {
    const node = elements[id]
    if (node.type === 'frame' && !equalValue(node.children, siblings.get(id) ?? [])) elements[id] = { ...node, children: siblings.get(id) ?? [] }
  }
  return { ...document, elements, rootIds: siblings.get(null) ?? [] }
}

/** Lookup an arbitrary nested value in a document using a collaboration path. */
export function getValueAtPath(doc: unknown, path: readonly string[]): unknown {
  if (!doc || typeof doc !== 'object') return undefined
  let target = doc as Record<string, unknown>
  for (let i = 0; i < path.length; i++) {
    const part = path[i]
    if (part === '$alive') {
      return target !== undefined && target !== null
    }
    if (target === undefined || target === null || typeof target !== 'object') return undefined
    if (i === path.length - 1) return target[part]
    target = target[part] as Record<string, unknown>
  }
  return undefined
}

/** Idempotent, order-independent field registers, including deletion tombstones. */
export class SceneReplica {
  private fields = new Map<string, Register>()
  private clock = 0
  private vectorClock = new VectorClock()
  readonly actor: string
  constructor(actor = 'local', registers: readonly Register[] = []) { this.actor = actor; this.merge(registers) }
  getClock(): number { return this.clock }
  nextClock(): number { return ++this.clock }
  getVectorClock(): VectorClock { return this.vectorClock.clone() }
  getRegister(path: readonly string[]): Register | undefined { return this.fields.get(key(path)) }
  getLWWRegister<T = unknown>(path: readonly string[]): LWWRegister<T> | undefined {
    const reg = this.fields.get(key(path))
    return reg ? LWWRegister.fromRegister<T>(reg) : undefined
  }
  export(): Register[] { return [...this.fields.values()] }
  merge(registers: readonly Register[]): void {
    for (const entry of registers) {
      if (!Array.isArray(entry.path) || !entry.path.length || entry.path.length > 20 || entry.path.some(part => typeof part !== 'string' || reserved.has(part)) || !Number.isSafeInteger(entry.clock) || entry.clock < 0 || typeof entry.actor !== 'string') throw new Error('Invalid collaboration register')
      const name = key(entry.path), previous = this.fields.get(name)
      if (!previous || newer(entry, previous)) this.fields.set(name, structuredClone(entry))
      this.clock = Math.max(this.clock, entry.clock)
      this.vectorClock.merge({ [entry.actor]: entry.clock })
    }
  }
  change(before: SceneDocument, after: SceneDocument): Register[] {
    if (before.elements === after.elements && ['comments', 'tokens', 'styleLibrary', 'motion', 'prototype', 'backgroundShader', 'backgroundLayers'].every(name => before[name as keyof SceneDocument] === after[name as keyof SceneDocument])) return []
    const changedIds = new Set([...Object.keys(before.elements), ...Object.keys(after.elements)].filter(id => before.elements[id] !== after.elements[id]))
    const commentsChanged = before.comments !== after.comments
    const old = flatten(before, changedIds, commentsChanged), next = flatten(after, changedIds, commentsChanged), changes: Register[] = []
    const clock = ++this.clock
    this.vectorClock.tick(this.actor)
    for (const name of new Set([...old.keys(), ...next.keys()])) {
      const previous = old.get(name), value = next.get(name)
      if (previous && value && equalValue(previous.value, value.value)) continue
      // A tombstone keeps the entity's properties for undo, without resurrecting on late edits.
      if (!value && previous?.path[0] === 'elements' && previous.path[2] !== '$alive' && !after.elements[previous.path[1]]) continue
      if (!value && previous?.path[0] === 'comments' && previous.path[2] !== '$alive' && !after.comments?.[previous.path[1]]) continue
      changes.push({ path: (value ?? previous)!.path, value: value?.value ?? null, deleted: !value, clock, actor: this.actor })
    }
    this.merge(changes)
    return changes
  }
  seed(document: SceneDocument): void { this.change({ version: 1, elements: {}, rootIds: [] }, document) }
  document(): SceneDocument {
    const result: Record<string, unknown> = { version: 1, elements: {}, rootIds: [] }
    const alive = new Set(this.export().filter(field => field.path[0] === 'elements' && field.path[2] === '$alive' && !field.deleted).map(field => field.path[1]))
    const aliveThreads = new Set(this.export().filter(field => field.path[0] === 'comments' && field.path[2] === '$alive' && !field.deleted).map(field => field.path[1]))
    if (this.export().some(field => field.path[0] === 'comments')) result.comments = {}
    // Parents are written first; newer leaf values replace an earlier null/atomic value.
    const entries = this.export().filter(field => !field.deleted).sort((a, b) => a.clock - b.clock || a.actor.localeCompare(b.actor) || a.path.length - b.path.length)
    for (const field of entries) {
      if (field.path[0] === 'elements' && (!alive.has(field.path[1]) || field.path[2] === '$alive')) continue
      if (field.path[0] === 'comments' && (!aliveThreads.has(field.path[1]) || field.path[2] === '$alive')) continue
      let target = result
      field.path.slice(0, -1).forEach(part => {
        if (!record(target[part])) target[part] = {}
        target = target[part] as Record<string, unknown>
      })
      target[field.path.at(-1)!] = structuredClone(field.value)
    }
    return normalizeHierarchy(result as unknown as SceneDocument)
  }
}
