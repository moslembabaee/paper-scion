import type { AppProject } from './types.ts'

export type AppAccessRole = 'owner' | 'editor' | 'viewer'
export interface AppAccessGrant {
  accountId: string
  role: Exclude<AppAccessRole, 'owner'>
  revision: number
}
export interface AppPermissions { role: 'owner'; grants: AppAccessGrant[] }
export interface SharedApp { ownerId: string; role: AppAccessGrant['role']; project: AppProject }
export interface SharedAppSummary { ownerId: string; id: string; name: string; role: AppAccessGrant['role']; revision: number }
