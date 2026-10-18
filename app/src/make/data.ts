/** Owner-provisioned data capabilities. Handles identify grants; they are not credentials. */
export type AppDataOperation = 'list' | 'get' | 'create' | 'update' | 'delete'
export type AppDataValue = Readonly<Record<string, string | number | boolean>>
export interface AppDataField {
  readonly type: 'string' | 'number' | 'boolean'
  readonly required?: boolean
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
}
export interface AppDataDefinition {
  readonly name: string
  readonly schema: Readonly<Record<string, AppDataField>>
  readonly operations: readonly AppDataOperation[]
  readonly quotas: { readonly maxRecords: number; readonly maxBytes: number; readonly operationsPerMinute: number }
}
export interface AppDataCollection extends AppDataDefinition {
  readonly handle: string
  readonly version: number
  readonly status: 'active' | 'revoked'
  readonly revision: number
  readonly usage: { readonly records: number; readonly bytes: number }
}
export type AppDataRequest =
  | { readonly operation: 'list'; readonly offset?: number }
  | { readonly operation: 'get'; readonly id: string }
  | { readonly operation: 'create'; readonly expectedRevision: number; readonly value: AppDataValue }
  | { readonly operation: 'update'; readonly expectedRevision: number; readonly id: string; readonly value: AppDataValue }
  | { readonly operation: 'delete'; readonly expectedRevision: number; readonly id: string }
export interface AppDataRecord { readonly id: string; readonly value: AppDataValue }
export interface AppDataResult {
  readonly revision: number
  readonly records: readonly AppDataRecord[]
  readonly nextOffset?: number
}
export interface AppDataAPI { invoke(handle: string, input: AppDataRequest): Promise<AppDataResult> }
declare global { interface Window { readonly paperData?: AppDataAPI } }
export const APP_DATA_LIMITS = Object.freeze({ MAX_COLLECTIONS: 16, MAX_FIELDS: 16, MAX_RECORDS: 1000,
  MAX_COLLECTION_BYTES: 256 * 1024, MAX_APP_BYTES: 1024 * 1024, MAX_RECORD_BYTES: 4096,
  MAX_REQUEST_BYTES: 16 * 1024, MAX_OPERATIONS_PER_MINUTE: 120, PAGE_SIZE: 8 })
export const isDataHandle = (value: unknown): value is string => typeof value === 'string' && /^dat_[A-Za-z0-9_-]{32}$/.test(value)
export const isDataName = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value)

// Serialize the whole closure so production minification cannot leave references
// to host-only bundle symbols in the opaque iframe's copy of these validators.
export function createAppDataValidators() {
  function isAppDataRequest(value: unknown): value is AppDataRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const p = value as Record<string, unknown>, keys = Object.keys(p).sort().join(',')
    if (p.operation === 'list') return (keys === 'operation' || keys === 'offset,operation') &&
      (p.offset === undefined || Number.isSafeInteger(p.offset) && Number(p.offset) >= 0 && Number(p.offset) <= 1000)
    const id = typeof p.id === 'string' && /^row_[A-Za-z0-9_-]{32}$/.test(p.id)
    if (p.operation === 'get') return keys === 'id,operation' && id
    if (!Number.isSafeInteger(p.expectedRevision) || Number(p.expectedRevision) < 0) return false
    if (p.operation === 'delete') return keys === 'expectedRevision,id,operation' && id
    if (p.operation !== 'create' && p.operation !== 'update') return false
    if (keys !== (p.operation === 'create' ? 'expectedRevision,operation,value' : 'expectedRevision,id,operation,value') || (p.operation === 'update' && !id)) return false
    if (!p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return false
    const fields = Object.entries(p.value)
    return fields.length <= 16 && fields.every(([key, v]) => /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key) &&
      !['constructor', 'prototype', '__proto__'].includes(key) &&
      (typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && new TextEncoder().encode(v).length <= 4096)) &&
      new TextEncoder().encode(JSON.stringify(p.value)).length <= 4096
  }
  function isAppDataResult(value: unknown): value is AppDataResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const p = value as Record<string, unknown>
    return Object.keys(p).every(key => ['revision', 'records', 'nextOffset'].includes(key)) &&
      Number.isSafeInteger(p.revision) && Number(p.revision) >= 0 &&
      (p.nextOffset === undefined || Number.isSafeInteger(p.nextOffset) && Number(p.nextOffset) > 0 && Number(p.nextOffset) <= 1000) &&
      Array.isArray(p.records) && p.records.length <= 8 && p.records.every(r => r && typeof r === 'object' &&
        Object.keys(r).sort().join(',') === 'id,value' && typeof r.id === 'string' && /^row_[A-Za-z0-9_-]{32}$/.test(r.id) &&
        isAppDataRequest({ operation: 'update', id: r.id, expectedRevision: 0, value: r.value }))
  }

  return { isAppDataRequest, isAppDataResult }
}
export const { isAppDataRequest, isAppDataResult } = createAppDataValidators()

export function isAppDataDefinition(value: unknown): value is AppDataDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  if (Object.keys(p).sort().join(',') !== 'name,operations,quotas,schema' || !isDataName(p.name) ||
    !Array.isArray(p.operations) || !p.operations.length || p.operations.length > 5 || new Set(p.operations).size !== p.operations.length ||
    !p.operations.every(op => ['list', 'get', 'create', 'update', 'delete'].includes(op)) ||
    !p.schema || typeof p.schema !== 'object' || Array.isArray(p.schema) || !p.quotas || typeof p.quotas !== 'object' || Array.isArray(p.quotas)) return false
  const q = p.quotas as Record<string, unknown>
  if (Object.keys(q).sort().join(',') !== 'maxBytes,maxRecords,operationsPerMinute' ||
    ![['maxRecords', 1000], ['maxBytes', 256 * 1024], ['operationsPerMinute', 120]].every(([key, max]) =>
      Number.isSafeInteger(q[key]) && Number(q[key]) >= 1 && Number(q[key]) <= Number(max))) return false
  const fields = Object.entries(p.schema)
  return fields.length > 0 && fields.length <= 16 && fields.every(([key, field]) => {
    if (!isDataName(key) || !field || typeof field !== 'object' || Array.isArray(field)) return false
    const f = field as Record<string, unknown>
    if (f.required !== undefined && typeof f.required !== 'boolean') return false
    if (f.type === 'string') return Object.keys(f).every(k => ['type', 'required', 'maxLength'].includes(k)) &&
      Number.isSafeInteger(f.maxLength) && Number(f.maxLength) >= 1 && Number(f.maxLength) <= 4096
    if (f.type === 'boolean') return Object.keys(f).every(k => ['type', 'required'].includes(k))
    if (f.type === 'number') return Object.keys(f).every(k => ['type', 'required', 'minimum', 'maximum'].includes(k)) &&
      [f.minimum, f.maximum].every(v => v === undefined || typeof v === 'number' && Number.isFinite(v)) &&
      (f.minimum === undefined || f.maximum === undefined || Number(f.minimum) <= Number(f.maximum))
    return false
  })
}

export function matchesAppDataSchema(value: AppDataValue, schema: AppDataDefinition['schema']): boolean {
  return Object.keys(value).every(key => Object.hasOwn(schema, key)) && Object.entries(schema).every(([key, field]) => {
    if (!Object.hasOwn(value, key)) return !field.required
    const v = value[key]
    if (typeof v !== field.type) return false
    if (typeof v === 'string') return new TextEncoder().encode(v).length <= field.maxLength!
    if (typeof v === 'number') return Number.isFinite(v) && (field.minimum === undefined || v >= field.minimum) && (field.maximum === undefined || v <= field.maximum)
    return true
  })
}
