import type { BoundedDiff } from './diff.ts'

export interface GitHubReview {
  reviewId: string
  repository: string
  branch: string
  baseCommit: string
  revision: number
  fingerprint: string
  directory: string
  expiresAt: string
  diff: BoundedDiff
}

export interface GitHubHandoffResult {
  revision: number
  commit: string
  url: string
}
