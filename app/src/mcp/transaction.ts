import { canonical } from '../cloud/model.ts'
import { parseProject } from '../io/project.ts'
import type { PaperProject } from '../io/project.ts'
import { equalValue } from '../scene/history.ts'
import { SceneStore } from '../scene/store.ts'
import type { AutoLayout, ComponentProperty, ComponentPropertyValue, ElementInput, ElementPatch, ElementType, SceneElement } from '../scene/types.ts'
import type { TokenInput, TokenProperty } from '../tokens/types.ts'
import { mutateCanvas } from './operations.ts'
import { operationSchema, paperTools, patchSchema, validateSchema } from './schema.ts'

export type ApplyChangesOperation = Record<string, unknown> & { action: string }
export interface ActionResult { step: number; action: string; status: 'ok'; id?: string; type?: string; details?: Record<string, unknown> }
interface ChangeIdentity { id: string; name?: string; type: string }
export interface CompactChangeSummary {
  totalOperations: number; createdCount: number; updatedCount: number; deletedCount: number
  changedIds: string[]; created: ChangeIdentity[]; updated: ChangeIdentity[]; deleted: ChangeIdentity[]
  reparented: { id: string; from: string | null; to: string | null }[]
  tokenBindings: { elementId: string; property: string; tokenId: string | null }[]
  before: Record<string, unknown>; after: Record<string, unknown>; truncated: boolean; omittedCount: number
}
export interface ApplyChangesResult {
  changedIds: string[]; summary: CompactChangeSummary; warnings: string[]; actionResults: ActionResult[]; project: PaperProject
}
export const MAX_OPERATIONS_LIMIT = 100
export const MAX_PAYLOAD_BYTES = 512 * 1024
const MAX_SUMMARY_BYTES = 32 * 1024
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/** Check before cache lookup or touching storage; backend entrypoints also enforce the contract. */
export function validateTransaction(args: Record<string, unknown>): void {
  if (bytes(args) > MAX_PAYLOAD_BYTES) throw new Error(`Batch payload size exceeds limit of ${MAX_PAYLOAD_BYTES} bytes`)
  validateSchema(args, paperTools.find(tool => tool.name === 'apply_changes')!.inputSchema)
  if (args.idempotency_key !== undefined && args.idempotencyKey !== undefined && args.idempotency_key !== args.idempotencyKey) throw new Error('Conflicting idempotency keys')
  for (const [step, operation] of (args.operations as ApplyChangesOperation[]).entries()) {
    const aliases = [['element_id', 'id'], ['master_id', 'masterId'], ['token_id', 'tokenId'], ['property_id', 'propertyId']]
    if (operation.action === 'update_token') aliases.push(['token_id', 'id'])
    for (const [left, right] of aliases) {
      if (operation[left] !== undefined && operation[right] !== undefined && operation[left] !== operation[right]) {
        throw new Error(`Operation ${step}: conflicting ${left}/${right} aliases`)
      }
    }
  }
}

/** Shared by sessions, scoped by the resolved project identity, and bounded in time and memory. */
export class IdempotencyCache {
  private cache = new Map<string, { plan: string; result: Record<string, unknown>; timestamp: number; size: number }>()
  private size = 0
  private remove(key: string) {
    const entry = this.cache.get(key)
    if (entry) { this.size -= entry.size; this.cache.delete(key) }
  }
  private key(scope: string, args: Record<string, unknown>) {
    const key = args.idempotency_key ?? args.idempotencyKey
    return !args.dry_run && typeof key === 'string' ? JSON.stringify([scope, key]) : undefined
  }
  private plan(args: Record<string, unknown>) { return canonical({ expected_revision: args.expected_revision, operations: args.operations }) }
  get(scope: string, args: Record<string, unknown>): Record<string, unknown> | undefined {
    const key = this.key(scope, args)
    if (!key) return
    const entry = this.cache.get(key)
    if (!entry) return
    if (Date.now() - entry.timestamp >= 10 * 60_000) { this.remove(key); return }
    if (entry.plan !== this.plan(args)) throw new Error('Idempotency key already used for a different plan; use a new key')
    return structuredClone(entry.result)
  }
  set(scope: string, args: Record<string, unknown>, result: Record<string, unknown>): void {
    const key = this.key(scope, args)
    if (!key) return
    const plan = this.plan(args), size = bytes(result) + new TextEncoder().encode(plan).length
    this.remove(key)
    for (const [oldKey, entry] of this.cache) if (Date.now() - entry.timestamp >= 10 * 60_000) this.remove(oldKey)
    while (this.cache.size && (this.cache.size >= 200 || this.size + size > 8 * 1024 * 1024)) this.remove(this.cache.keys().next().value!)
    if (size > 8 * 1024 * 1024) return
    this.cache.set(key, { plan, result: structuredClone(result), timestamp: Date.now(), size })
    this.size += size
  }
}

/** Every edit uses the UI store on a disposable document; only a complete valid result is published. */
export function executeTransaction(project: PaperProject, args: Record<string, unknown>): ApplyChangesResult {
  validateTransaction(args)
  const operations = args.operations as ApplyChangesOperation[]
  const store = new SceneStore()
  store.load(project.scene)
  store.clearHistory()
  const before = store.toJSON()
  const created = new Map<number, string>()
  const namedTokens = new Map<string, string>()
  const warnings: string[] = [], actionResults: ActionResult[] = []
  const resolve = (value: unknown, step: number): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Operation ${step}: missing ID`)
    const match = value.match(/^[$@](\d+)(?:\.id)?$/)
    if (match || value === '$prev' || value === '$last') {
      const referenced = match ? Number(match[1]) : step - 1
      const id = created.get(referenced)
      if (!id || referenced >= step) throw new Error(`Operation ${step}: reference ${value} must refer to an earlier create result`)
      return id
    }
    return value
  }
  const tokenId = (value: unknown, step: number): string => {
    const id = resolve(value, step)
    return store.getSnapshot().tokens.some(token => token.id === id) ? id : namedTokens.get(id) ?? store.getSnapshot().tokens.find(token => token.name === id)?.id ?? id
  }
  const node = (id: string): SceneElement => {
    if (!Object.hasOwn(store.getSnapshot().elements, id)) throw new Error(`Unknown element: ${id}`)
    return store.getSnapshot().elements[id]
  }
  const resolveBindings = (input: Record<string, unknown>, step: number) => input.tokenBindings ? {
    ...input, tokenBindings: Object.fromEntries(Object.entries(input.tokenBindings as Record<string, unknown>).map(([property, id]) => [property, tokenId(id, step)])),
  } : input

  store.batch(() => operations.forEach((operation, step) => {
    validateSchema(operation, operationSchema, `operations[${step}]`)
    const action = operation.action
    const target = () => resolve(operation.element_id ?? operation.id, step)
    const parent = () => operation.parentId === null ? null : resolve(operation.parentId, step)
    const master = () => resolve(operation.master_id ?? operation.masterId, step)
    let id: string | undefined, type: string | undefined
    try {
      switch (action) {
        case 'create': case 'create_element': case 'create_frame': {
          const elementType = (action === 'create_frame' ? 'frame' : operation.type) as ElementType
          const { action: _action, type: _type, index, ...fields } = operation
          // Explicit IDs are literal; only references to existing objects are resolved.
          if (fields.parentId !== undefined) fields.parentId = parent()
          const input = resolveBindings(fields, step) as ElementInput<typeof elementType>
          const element = store.add(elementType, elementType === 'frame' ? { ...input, style: { fill: '#edebe1', ...input.style } } : input, index as number | undefined)
          id = element.id; type = element.type; created.set(step, id)
          break
        }
        case 'add_shader_shape': {
          const { action: _action, index, ...fields } = operation
          if (fields.parentId !== undefined) fields.parentId = parent()
          const result = mutateCanvas({ ...project, scene: store.toJSON() }, action, fields)
          store.load(result.project.scene)
          id = result.element!.id; type = result.element!.type; created.set(step, id)
          if (index !== undefined) store.reorder(id, index as number)
          break
        }
        case 'update': case 'update_element': {
          id = target(); const element = node(id); type = element.type
          const { action: _action, element_id: _elementId, id: _id, parentId: _parent, index, patch: explicitPatch, ...fields } = operation
          const patch = { ...fields, ...(explicitPatch as Record<string, unknown> | undefined) }
          validateSchema(patch, patchSchema(element.type), `operations[${step}].patch`)
          if (patch.locked === false) { store.setLocked(id, false); if (element.locked) warnings.push(`Unlocked layer ${id}`) }
          if (operation.parentId !== undefined) store.reparent(id, parent(), index as number | undefined)
          else if (index !== undefined) store.reorder(id, index as number)
          const { locked, visible, ...content } = patch
          if (Object.keys(content).length) store.update(id, element.type, content as ElementPatch<typeof element.type>)
          if (typeof visible === 'boolean') store.setVisible(id, visible)
          if (locked === true) store.setLocked(id, true)
          break
        }
        case 'reparent': case 'reparent_element': id = target(); store.reparent(id, parent(), operation.index as number | undefined); break
        case 'reorder': case 'reorder_element': id = target(); store.reorder(id, operation.index as number); break
        case 'delete': case 'delete_element': case 'remove': case 'remove_element': id = target(); store.remove(id); break
        case 'create_token': case 'add_token': {
          const { action: _action, ...fields } = operation
          if (fields.aliasId !== undefined) fields.aliasId = tokenId(fields.aliasId, step)
          const token = store.addToken(fields as TokenInput)
          id = token.id; type = 'token'; created.set(step, id); namedTokens.set(token.name, id)
          break
        }
        case 'update_token': {
          id = tokenId(operation.token_id ?? operation.id, step)
          const { action: _action, token_id: _token, id: _id, patch: explicitPatch, ...fields } = operation
          const patch = { ...fields, ...(explicitPatch as Record<string, unknown> | undefined) }
          if (patch.aliasId !== undefined) patch.aliasId = tokenId(patch.aliasId, step)
          store.updateToken(id, patch as Parameters<SceneStore['updateToken']>[1]); type = 'token'
          break
        }
        case 'bind_token': id = target(); store.bindToken(id, operation.property as TokenProperty, tokenId(operation.token_id ?? operation.tokenId, step)); break
        case 'unbind_token': case 'detach_token': id = target(); store.detachToken(id, operation.property as TokenProperty); break
        case 'create_component': id = store.createComponent(target()).id; break
        case 'create_instance': case 'create_component_instance': {
          const placement = { ...(operation.x !== undefined ? { x: operation.x as number } : {}), ...(operation.y !== undefined ? { y: operation.y as number } : {}), ...(operation.parentId !== undefined ? { parentId: parent() } : {}) }
          id = store.createComponentInstance(master(), placement).id; created.set(step, id); break
        }
        case 'set_component_properties': {
          id = master()
          const properties = (operation.properties as ComponentProperty[]).map(property => property.kind === 'variant' ? {
            ...property, options: property.options.map(option => ({ ...option, layers: Object.fromEntries(Object.entries(option.layers).map(([source, overrides]) => [resolve(source, step), overrides])) })),
          } : { ...property, sourceId: resolve(property.sourceId, step) })
          store.setComponentProperties(id, properties); break
        }
        case 'set_component_property': id = target(); store.setComponentProperty(id, (operation.property_id ?? operation.propertyId) as string, operation.value as ComponentPropertyValue | null); break
        case 'detach_instance': case 'detach_component_instance': id = target(); store.detachComponentInstance(id); break
        case 'reset_component_overrides': id = target(); store.resetComponentOverrides(id); break
        case 'set_layout': case 'update_layout': {
          id = target()
          if (node(id).type !== 'frame') throw new Error('Layout is only supported on frames')
          store.update(id, 'frame', { layout: operation.layout as AutoLayout | null }); break
        }
        default: throw new Error(`Unsupported action: ${action}`)
      }
    } catch (error) { throw new Error(`Operation ${step} (${action}): ${error instanceof Error ? error.message : 'Invalid edit'}`) }
    actionResults.push({ step, action, status: 'ok', ...(id ? { id } : {}), ...(type ? { type } : {}) })
  }))

  // The same importer validates graph, component, token and project-size invariants in every mode.
  const updatedProject = parseProject(JSON.stringify({ ...project, scene: store.toJSON() }))
  const after = updatedProject.scene
  // Keep layer and token namespaces separate even when their explicit IDs coincide.
  const createdElements = Object.keys(after.elements).filter(id => !Object.hasOwn(before.elements, id))
  const deletedElements = Object.keys(before.elements).filter(id => !Object.hasOwn(after.elements, id))
  const updatedElements = Object.keys(after.elements).filter(id => Object.hasOwn(before.elements, id) && !equalValue(before.elements[id], after.elements[id]))
  const beforeTokens = new Map((before.tokens ?? []).map(token => [token.id, token]))
  const afterTokens = new Map((after.tokens ?? []).map(token => [token.id, token]))
  const createdTokens = [...afterTokens.keys()].filter(id => !beforeTokens.has(id))
  const deletedTokens = [...beforeTokens.keys()].filter(id => !afterTokens.has(id))
  const updatedTokens = [...afterTokens.keys()].filter(id => beforeTokens.has(id) && !equalValue(beforeTokens.get(id), afterTokens.get(id)))
  const changedIds = [...new Set([...createdElements, ...updatedElements, ...deletedElements, ...createdTokens, ...updatedTokens, ...deletedTokens])]
  let previewTruncated = false
  const preview = (value: unknown, depth = 0): unknown => {
    if (typeof value === 'string' && value.length > 256) { previewTruncated = true; return `${value.slice(0, 255)}…` }
    if (value && typeof value === 'object') {
      if (depth > 5) { previewTruncated = true; return '[preview omitted]' }
      if (Array.isArray(value)) { if (value.length > 20) previewTruncated = true; return value.slice(0, 20).map(entry => preview(entry, depth + 1)) }
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, preview(entry, depth + 1)]))
    }
    return value
  }
  const summary: CompactChangeSummary = {
    totalOperations: operations.length, createdCount: createdElements.length + createdTokens.length, updatedCount: updatedElements.length + updatedTokens.length, deletedCount: deletedElements.length + deletedTokens.length,
    changedIds: [], created: [], updated: [], deleted: [], reparented: [], tokenBindings: [], before: Object.create(null), after: Object.create(null), truncated: false, omittedCount: 0,
  }
  const identity = (id: string, name: string, type: string): ChangeIdentity => {
    if (name.length > 160) previewTruncated = true
    return { id, name: name.slice(0, 160), type }
  }
  const describe = (id: string, elements: typeof before.elements, tokens: typeof beforeTokens) => {
    const element = Object.hasOwn(elements, id) ? elements[id] : undefined
    const token = tokens.get(id)
    return preview(element && token ? { element, token } : element ?? token ?? null)
  }
  const groups = [
    { ids: new Set(createdElements), category: 'created' as const, objects: after.elements },
    { ids: new Set(updatedElements), category: 'updated' as const, objects: after.elements },
    { ids: new Set(deletedElements), category: 'deleted' as const, objects: before.elements },
  ]
  const tokenGroups = [
    { ids: new Set(createdTokens), category: 'created' as const, objects: afterTokens },
    { ids: new Set(updatedTokens), category: 'updated' as const, objects: afterTokens },
    { ids: new Set(deletedTokens), category: 'deleted' as const, objects: beforeTokens },
  ]
  for (const [position, id] of changedIds.entries()) {
    const trial: CompactChangeSummary = structuredClone(summary)
    trial.changedIds.push(id)
    for (const group of groups) if (group.ids.has(id)) trial[group.category].push(identity(id, group.objects[id].name, group.objects[id].type))
    for (const group of tokenGroups) if (group.ids.has(id)) trial[group.category].push(identity(id, group.objects.get(id)!.name, 'token'))
    trial.before[id] = describe(id, before.elements, beforeTokens)
    trial.after[id] = describe(id, after.elements, afterTokens)
    const b = Object.hasOwn(before.elements, id) ? before.elements[id] : undefined
    const a = Object.hasOwn(after.elements, id) ? after.elements[id] : undefined
    if (a && b && a.parentId !== b.parentId) trial.reparented.push({ id, from: b.parentId, to: a.parentId })
    for (const property of new Set([...Object.keys(a?.tokenBindings ?? {}), ...Object.keys(b?.tokenBindings ?? {})])) {
      const p = property as TokenProperty
      if (a?.tokenBindings?.[p] !== b?.tokenBindings?.[p]) trial.tokenBindings.push({ elementId: id, property, tokenId: a?.tokenBindings?.[p] ?? null })
    }
    // Leave room for the truncation counters and warnings. Never silently drop a changed object.
    if (bytes(trial) > MAX_SUMMARY_BYTES - 256) { summary.omittedCount = changedIds.length - position; summary.truncated = true; break }
    Object.assign(summary, trial)
  }
  summary.truncated ||= previewTruncated
  if (summary.truncated) warnings.push(`Summary uses abbreviated previews; ${summary.omittedCount} changed IDs omitted from the summary. Counts and the top-level changedIds report the full edit. Inspect targeted context after application.`)
  if (!changedIds.length) warnings.push('This plan makes no document changes.')
  return { changedIds, summary, warnings, actionResults, project: updatedProject }
}
