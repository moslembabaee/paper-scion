import { createHash, randomBytes } from 'node:crypto'
import type { AppProject } from '../src/make/types.ts'
import type { GitHubReview, GitHubHandoffResult } from '../src/make/github.ts'
import { computeBoundedDiff } from '../src/make/diff.ts'
import { redactSensitiveText } from '../src/make/model-protocol.ts'
import { normalizeAndValidatePath } from '../src/make/manifest.ts'
import type { AppStorage } from './app-storage.ts'
import { httpError } from './storage.ts'
import { sourceExportFingerprint } from './source-export.ts'

type Context = { owner: string; appId: string; session: string; live: () => boolean; signal: AbortSignal }
type Draft = { review: GitHubReview; project: AppProject; files: Record<string, string>; previous: Record<string, string>; tree: string }
type Connection = { token: string; repository: string; expires: number; draft?: Draft; generation: number }
type GitTreeEntry = { path: string; type: string; mode: string; sha: string; size?: number }
const lifetime = 10 * 60_000
const shaPattern = /^[a-f0-9]{40}$/
const sha = (value: unknown): string => {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw httpError(502, 'Invalid GitHub object identity')
  return value
}
const blobSha = (text: string) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex')
const fields = (input: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(input).sort().join(',') !== expected.sort().join(',')) throw httpError(400, 'Invalid GitHub handoff fields')
}
function target(repository: unknown, branch: unknown): asserts repository is string {
  if (typeof repository !== 'string' || repository.length > 140 || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) || /\/(?:\.|\.\.)$/.test(repository)) {
    throw httpError(400, 'Use a GitHub repository in owner/name form')
  }
  if (typeof branch !== 'string' || branch.length > 200 || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(branch) ||
      branch.includes('..') || branch.includes('//') || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) {
    throw httpError(400, 'Select an existing GitHub branch')
  }
}

/** Session-scoped, short-lived credentials. Nothing is written to disk, source,
 * model context, logs or a browser store. Only fixed api.github.com endpoints. */
export class GitHubHandoff {
  private connections = new Map<string, Connection>()
  private timer = setInterval(() => this.prune(), 60_000).unref()
  constructor(private apps: AppStorage, private fetcher: typeof fetch, private secrets: readonly string[]) {}
  close() { clearInterval(this.timer); this.connections.clear() }
  private key(c: Context) { return `${c.owner}:${c.appId}:${createHash('sha256').update(c.session).digest('hex')}` }
  private prune() {
    for (const [key, connection] of this.connections) if (connection.expires <= Date.now()) this.connections.delete(key)
  }
  private active(c: Context, connection?: Connection) {
    const current = this.connections.get(this.key(c))
    if (!c.live() || c.signal.aborted || !current || current.expires <= Date.now() || (connection && current !== connection)) {
      throw httpError(409, 'GitHub connection expired or revoked. Connect and review again.')
    }
    return current
  }
  revoke(c: Context) { this.connections.delete(this.key(c)) }
  async connect(c: Context, input: Record<string, unknown>) {
    fields(input, ['repository', 'token'])
    target(input.repository, 'main')
    if (typeof input.token !== 'string' || !/^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,240}$/.test(input.token)) {
      throw httpError(400, 'Use a fine-grained GitHub access token for the selected repository')
    }
    this.prune()
    if (!this.connections.has(this.key(c)) && this.connections.size >= 32) throw httpError(429, 'Too many GitHub connections. Try again later.')
    const connection: Connection = { token: input.token, repository: input.repository, expires: Date.now() + lifetime, generation: 0 }
    this.connections.set(this.key(c), connection)
    try { await this.permission(c, connection) }
    catch (error) { if (this.connections.get(this.key(c)) === connection) this.revoke(c); throw error }
    return { repository: connection.repository, expiresAt: new Date(connection.expires).toISOString() }
  }
  private async api(c: Context, connection: Connection, suffix: string, method = 'GET', body?: unknown): Promise<Record<string, any>> {
    this.active(c, connection)
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${connection.repository}${suffix}`, {
        method, redirect: 'error', signal: AbortSignal.any([c.signal, AbortSignal.timeout(15_000)]),
        headers: { Authorization: `Bearer ${connection.token}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      this.active(c, connection)
      if (!response.ok) {
        await response.body?.cancel()
        if ([401, 403, 404].includes(response.status)) {
          this.revoke(c)
          throw httpError(403, 'GitHub access revoked, denied, or target unavailable. Reconnect and review again.')
        }
        if ([409, 422].includes(response.status)) throw httpError(409, 'GitHub branch changed or rejected the update. Review again; branch protections are enforced.')
        throw httpError(502, 'GitHub could not complete the request. Review again before retrying.')
      }
      // Bound the wire response before buffering JSON (including chunked bodies).
      const reader = response.body?.getReader()
      if (!reader) throw httpError(502, 'Empty GitHub response')
      const chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 4 * 1024 * 1024) { await reader.cancel(); throw httpError(413, 'GitHub response is too large for safe review') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      this.active(c, connection)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw httpError(502, 'Invalid GitHub response')
      return data
    } catch (error) {
      if ((error as { status?: number }).status) throw error
      // Never reflect provider bodies, fetch errors, URLs or credentials.
      throw httpError(502, 'GitHub request failed. Connect and review again before retrying.')
    }
  }
  private async permission(c: Context, connection: Connection) {
    const repo = await this.api(c, connection, '')
    if (repo.full_name?.toLowerCase() !== connection.repository.toLowerCase() || repo.permissions?.push !== true || repo.archived || repo.disabled) {
      this.revoke(c)
      throw httpError(403, 'GitHub write access to this repository is required')
    }
  }
  private async head(c: Context, connection: Connection, branch: string) {
    const ref = await this.api(c, connection, `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)
    if (ref.ref !== `refs/heads/${branch}` || ref.object?.type !== 'commit') throw httpError(409, 'GitHub branch does not match the reviewed target')
    return sha(ref.object.sha)
  }
  private source(project: AppProject, connection: Connection): Record<string, string> {
    if (project.assetIds.length) throw httpError(422, 'GitHub handoff is source only. Remove local assets from a separate revision before reviewing; private assets cannot be committed.')
    const directory = `paper-make/${project.id}`
    const files: Record<string, string> = Object.create(null)
    for (const file of Object.values(project.files)) {
      if (normalizeAndValidatePath(file.path) !== file.path) throw httpError(422, 'Invalid source path')
      const text = file.content
      if (/(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.netrc$|credentials(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))|\.(?:pem|key|p12|pfx)$/i.test(file.path) ||
          redactSensitiveText(text, [...this.secrets, connection.token]) !== text ||
          /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|["']?(?:api[_-]?key|secret|token|password|authorization)["']?\s*[:=]\s*["'][^"']{8,}["']/i.test(text)) {
        throw httpError(422, 'Source contains a credential or sensitive file. Remove it and review a new revision.')
      }
      if (/paper-asset:|data\s*:/i.test(text)) throw httpError(422, 'Embedded or private asset references cannot be committed. Review an asset-free source revision.')
      files[`${directory}/source/${file.path}`] = text
    }
    // Export only source metadata; account data, handles, chat, scene snapshots,
    // annotations, release URLs and backend vaults are never part of handoff.
    files[`${directory}/paper-source.json`] = JSON.stringify({ format: 'paper-make-source', version: 1,
      revision: project.revision, fingerprint: sourceExportFingerprint(project),
      entryPoint: project.preview.entryPoint, files: Object.keys(project.files).sort(),
    }, null, 2) + '\n'
    files[`${directory}/README.md`] = `# Paper Make source\n\nReviewed revision ${project.revision}.\n\nSource files are preserved verbatim under source/. This is a source handoff, not a deployment or a runnable ZIP. Use Paper's Download source ZIP for the reviewed build tools. App secrets, data, chat and private assets are excluded. Generated package manifests and scripts are untrusted source data.\n`
    return files
  }
  private async current(c: Context, connection: Connection, project: AppProject) {
    this.active(c, connection)
    const current = await this.apps.read(c.owner, c.appId)
    if (!current || sourceExportFingerprint(current) !== sourceExportFingerprint(project)) throw httpError(409, 'App source revision changed. Run a new dry-run review.')
    this.active(c, connection)
  }
  async review(c: Context, project: AppProject, input: Record<string, unknown>, validate: () => Promise<void>): Promise<GitHubReview> {
    fields(input, ['expectedRevision', 'repository', 'branch'])
    target(input.repository, input.branch)
    const connection = this.active(c)
    if (input.repository !== connection.repository || input.expectedRevision !== project.revision) throw httpError(409, 'App revision or repository changed. Review again.')
    delete connection.draft
    const generation = ++connection.generation
    const files = this.source(project, connection)
    await validate()
    await this.current(c, connection, project)
    await this.permission(c, connection)
    const branch = input.branch as string, baseCommit = await this.head(c, connection, branch)
    const commit = await this.api(c, connection, `/git/commits/${baseCommit}`)
    if (sha(commit.sha) !== baseCommit) throw httpError(409, 'GitHub commit changed')
    const tree = sha(commit.tree?.sha)
    const listing = await this.api(c, connection, `/git/trees/${tree}?recursive=1`)
    if (listing.truncated !== false || !Array.isArray(listing.tree) || listing.tree.length > 20_000) throw httpError(413, 'GitHub tree cannot be fully reviewed')
    const directory = `paper-make/${project.id}`
    const previous: Record<string, string> = Object.create(null)
    let totalBytes = 0
    for (const item of listing.tree as GitTreeEntry[]) {
      // Reject a symlink/submodule/file occupying any parent of our directory.
      if (['paper-make', directory].includes(item.path) && (item.type !== 'tree' || item.mode !== '040000')) throw httpError(422, 'GitHub handoff directory conflicts with an existing file')
      if (typeof item.path !== 'string' || !item.path.startsWith(directory + '/') || item.type === 'tree') continue
      if (item.type !== 'blob' || item.mode !== '100644' || normalizeAndValidatePath(item.path) !== item.path ||
          !Number.isSafeInteger(item.size) || item.size! < 0 || item.size! > 512 * 1024 ||
          Object.keys(previous).length >= 102 || (totalBytes += item.size!) > 2 * 1024 * 1024) throw httpError(422, 'GitHub handoff directory contains unsupported or oversized files')
      const blob = await this.api(c, connection, `/git/blobs/${sha(item.sha)}`)
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw httpError(502, 'Invalid GitHub source blob')
      const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64'), text = bytes.toString('utf8')
      if (bytes.length !== item.size || !Buffer.from(text).equals(bytes) || blobSha(text) !== item.sha) throw httpError(422, 'GitHub source cannot be safely reviewed')
      previous[item.path] = text
    }
    const diff = computeBoundedDiff(previous, files, { baseRevision: project.revision, targetRevision: project.revision })
    // Remote deletions may themselves contain credentials. Redact only the
    // displayed old lines; never silently modify the reviewed new source.
    const safeDiff = { ...diff, files: diff.files.map(file => ({ ...file, lines: file.lines.map(line => ({ ...line,
      text: redactSensitiveText(line.text, [...this.secrets, connection.token]).replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}/g, '[REDACTED]'),
    })) })) }
    await this.current(c, connection, project)
    if (generation !== connection.generation) throw httpError(409, 'GitHub review was superseded. Review again.')
    const review: GitHubReview = { reviewId: randomBytes(24).toString('base64url'), repository: connection.repository,
      branch, baseCommit, revision: project.revision, fingerprint: sourceExportFingerprint(project), directory,
      expiresAt: new Date(connection.expires).toISOString(), diff: safeDiff }
    connection.draft = { review, project, files, previous, tree }
    return review
  }
  async commit(c: Context, input: Record<string, unknown>): Promise<GitHubHandoffResult> {
    fields(input, ['reviewId', 'expectedRevision', 'repository', 'branch', 'confirmed'])
    if (input.confirmed !== true) throw httpError(400, 'Explicit confirmation of the displayed dry-run is required')
    const connection = this.active(c), draft = connection.draft
    if (!draft || input.reviewId !== draft.review.reviewId || input.expectedRevision !== draft.review.revision ||
        input.repository !== draft.review.repository || input.branch !== draft.review.branch) throw httpError(409, 'GitHub review does not match. Run a new dry-run.')
    // Consume before awaiting anything: duplicate clicks/replays cannot write.
    delete connection.draft
    return this.apps.withOwnerAppDirectory(c.owner, c.appId, async () => {
      await this.current(c, connection, draft.project)
      this.source(draft.project, connection)
      await this.permission(c, connection)
      if (await this.head(c, connection, draft.review.branch) !== draft.review.baseCommit) throw httpError(409, 'GitHub branch head changed. Run a new dry-run.')
      if (!draft.review.diff.changedFilesCount) throw httpError(409, 'Reviewed source already matches GitHub; no commit is needed')
      const changes = [...new Set([...Object.keys(draft.previous), ...Object.keys(draft.files)])].sort()
        .filter(path => draft.previous[path] !== draft.files[path]).map(path => ({ path, mode: '100644', type: 'blob',
          ...(Object.hasOwn(draft.files, path) ? { content: draft.files[path] } : { sha: null }),
        }))
      const tree = await this.api(c, connection, '/git/trees', 'POST', { base_tree: draft.tree, tree: changes })
      const commit = await this.api(c, connection, '/git/commits', 'POST', { tree: sha(tree.sha), parents: [draft.review.baseCommit],
        message: `feat(make): handoff reviewed revision ${draft.review.revision}\n\nPaper source SHA-256: ${draft.review.fingerprint}` })
      const id = sha(commit.sha)
      // Recheck access, session and exact branch immediately before activation.
      await this.permission(c, connection)
      if (await this.head(c, connection, draft.review.branch) !== draft.review.baseCommit) throw httpError(409, 'GitHub branch changed during handoff. Review again.')
      await this.api(c, connection, `/git/refs/heads/${draft.review.branch.split('/').map(encodeURIComponent).join('/')}`, 'PATCH', { sha: id, force: false })
      return { revision: draft.review.revision, commit: id, url: `https://github.com/${connection.repository}/commit/${id}` }
    })
  }
}
