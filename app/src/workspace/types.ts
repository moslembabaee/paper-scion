import type { PaperProject } from '../io/project'

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface LocalProject extends ProjectSummary {
  document: PaperProject
  cloud?: { owner: string; projectId: string; revision: string | null; syncedAt: number; dirty: boolean }
}

export interface UserProfile {
  version: 1
  name: string
  avatar: string
  workspaceName: string
  defaultGrid: boolean
}
