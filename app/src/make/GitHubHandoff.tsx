import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, GitBranch } from 'lucide-react'
import { api } from '../cloud/api'
import type { AppProject } from './types'
import type { GitHubReview, GitHubHandoffResult } from './github'

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

export function GitHubHandoff({ project, accountId, saved, disabled }: {
  project: AppProject; accountId?: string; saved: boolean; disabled: boolean
}) {
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('main')
  const [connected, setConnected] = useState(false)
  const [review, setReview] = useState<GitHubReview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<GitHubHandoffResult | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const token = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const available = saved && !!accountId && !disabled
  const path = `/apps/${encodeURIComponent(project.id)}/github`
  useEffect(() => () => { request.current?.abort() }, [])
  useEffect(() => { if (disabled) request.current?.abort() }, [disabled])

  async function action(kind: 'connect' | 'review' | 'commit' | 'revoke') {
    if (!available || request.current) return
    const credential = token.current?.value ?? ''
    if (token.current) token.current.value = ''
    const draft = review
    if (kind === 'commit' && (!draft || !confirmed)) return
    const controller = new AbortController(); request.current = controller
    setBusy(kind); setError(''); setResult(null); setConfirmed(false)
    if (kind !== 'commit') setReview(null)
    try {
      const options = { signal: controller.signal, headers: { 'X-Paper-Account': accountId ?? '' }, timeoutMs: 90_000 }
      if (kind === 'connect') {
        setConnected(false)
        await api(path + '/connection', { ...options, method: 'POST', body: JSON.stringify({ repository, token: credential }) })
        if (!controller.signal.aborted) setConnected(true)
      } else if (kind === 'revoke') {
        await api(path + '/connection', { ...options, method: 'DELETE', body: '{}' })
        if (!controller.signal.aborted) setConnected(false)
      } else if (kind === 'review') {
        const next = await api<GitHubReview>(path + '/dry-run', { ...options, method: 'POST', body: JSON.stringify({ repository, branch, expectedRevision: project.revision }) })
        if (!controller.signal.aborted) setReview(next)
      } else if (draft) {
        setReview(null)
        const next = await api<GitHubHandoffResult>(path + '/commit', { ...options, method: 'POST', body: JSON.stringify({
          reviewId: draft.reviewId, repository: draft.repository, branch: draft.branch, expectedRevision: draft.revision, confirmed: true,
        }) })
        if (!controller.signal.aborted) setResult(next)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setReview(null)
        setError(cause instanceof Error ? cause.message : 'GitHub handoff could not complete. Review again.')
      }
    } finally {
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setBusy('')
    }
  }

  return <section className="make-github" aria-label="GitHub handoff" aria-busy={!!busy}>
    <h2><GithubIcon size={14} />GitHub handoff<span>SOURCE</span></h2>
    <p>Review a diff, then commit saved revision {project.revision} to your repository. Local assets and secrets must be removed before handoff.</p>
    <details>
      <summary>Choose repository & branch</summary>
      <form autoComplete="off" onSubmit={event => { event.preventDefault(); void action('connect') }}>
        <fieldset disabled={!available || !!busy}>
          <label>Repository<input aria-label="GitHub repository" value={repository} placeholder="owner/repository" maxLength={140} spellCheck={false} required onChange={event => {
            setRepository(event.target.value); setConnected(false); setReview(null); setConfirmed(false); setResult(null)
          }} /></label>
          <label>Existing branch<input aria-label="GitHub branch" value={branch} maxLength={200} spellCheck={false} required onChange={event => {
            setBranch(event.target.value); setReview(null); setConfirmed(false); setResult(null)
          }} /></label>
          <label>Repository access token<input ref={token} aria-label="GitHub access token" type="password" autoComplete="new-password" maxLength={260} spellCheck={false} required placeholder="github_pat_…" /></label>
          <p>Use a fine-grained token limited to this repository with Contents read and write. Kept on your server for 10 minutes in this session.</p>
          <button className="make-button" type="submit">{busy === 'connect' ? 'Connecting…' : 'Connect for review'}</button>
        </fieldset>
      </form>
    </details>
    <div className="make-github-actions">
      <button className="make-button" disabled={!available || !connected || !!busy} onClick={() => void action('review')}><GitBranch size={12} />{busy === 'review' ? 'Validating & comparing…' : 'Show dry-run diff'}</button>
      {connected ? <button className="make-button" disabled={!available || !!busy} onClick={() => void action('revoke')}>Disconnect & revoke review</button> : null}
    </div>
    {review ? <div className="make-github-review" aria-label="GitHub dry-run diff">
      <div className="make-github-revision"><span>REVIEWED REVISION {review.revision}</span><strong>{review.repository}</strong><span>{review.branch} · {review.baseCommit.slice(0, 8)}</span></div>
      <p><code>{review.directory}/</code><br />{review.diff.changedFilesCount} files · +{review.diff.totalAdditions} / −{review.diff.totalDeletions}</p>
      {review.diff.files.map(file => <details key={file.path} className="make-file-diff">
        <summary><span>{file.path.slice(review.directory.length + 1)}</span><small>{file.action}</small></summary>
        <pre aria-label={`GitHub diff for ${file.path}`}>{file.lines.map((line, i) => <span key={i} className={`make-diff-line make-diff-${line.type}`}>{line.type === 'add' ? '+' : line.type === 'delete' ? '−' : ' '}{line.text}{'\n'}</span>)}</pre>
      </details>)}
      {review.diff.truncated ? <p>Diff excerpt. Inspect the complete saved source in Source files before confirming.</p> : null}
      <p>Review expires at {new Date(review.expiresAt).toLocaleTimeString()}. A new source revision or branch head requires another review.</p>
      <label className="make-github-consent"><input type="checkbox" checked={confirmed} disabled={!available || !!busy} onChange={event => setConfirmed(event.target.checked)} />I reviewed this diff and authorize committing revision {review.revision} to {review.repository} on {review.branch}.</label>
      <button className="make-button make-github-commit" disabled={!available || !!busy || !confirmed || !review.diff.changedFilesCount} onClick={() => void action('commit')}>Confirm & commit revision {review.revision}<ArrowUpRight size={12} /></button>
    </div> : null}
    <p role="status" aria-live="polite">{!saved ? 'Save an app to hand off its source.' : busy === 'commit' ? 'Committing the reviewed source…' : busy === 'revoke' ? 'Revoking connection…' : result ? `Revision ${result.revision} committed · ${result.commit.slice(0, 8)}` : connected ? 'Connected · Review first, confirm second.' : 'Owner only · No writes before confirmation'}</p>
    {result ? <a className="make-github-link" href={result.url} target="_blank" rel="noreferrer">View commit on GitHub<ArrowUpRight size={12} /></a> : null}
    {error ? <p role="alert" className="make-asset-error">{error}</p> : null}
  </section>
}
