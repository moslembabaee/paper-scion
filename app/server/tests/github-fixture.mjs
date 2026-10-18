import { createHash } from 'node:crypto'

export const githubToken = 'github_pat_TEST_ONLY_012345678901234567890123456789'
export const blobSha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex')
export function githubFixture() {
  const state = { head: 'a'.repeat(40), branch: 'main', revoked: false, push: true, files: {}, calls: [], before: undefined }
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method ?? 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    state.calls.push({ path, method, body })
    await state.before?.(path, method)
    if (state.revoked) return json({ message: githubToken }, 401)
    if (options.headers.Authorization !== `Bearer ${githubToken}`) return json({}, 401)
    if (path === '/repos/owner/demo') return json({ full_name: 'owner/demo', permissions: { push: state.push } })
    if (path.endsWith('/git/ref/heads/main')) return json({ ref: `refs/heads/${state.branch}`, object: { type: 'commit', sha: state.head } })
    if (method === 'GET' && path.includes('/git/commits/')) return json({ sha: state.head, tree: { sha: 'b'.repeat(40) } })
    if (method === 'GET' && path.includes('/git/trees/')) return json({ truncated: false, tree: Object.entries(state.files).map(([path, text]) => ({ path, type: 'blob', mode: '100644', sha: blobSha(text), size: Buffer.byteLength(text) })) })
    if (method === 'GET' && path.includes('/git/blobs/')) {
      const text = Object.values(state.files).find(text => path.endsWith(blobSha(text)))
      return text === undefined ? json({}, 404) : json({ encoding: 'base64', content: Buffer.from(text).toString('base64') })
    }
    if (method === 'POST' && path.endsWith('/git/trees')) return json({ sha: 'c'.repeat(40) }, 201)
    if (method === 'POST' && path.endsWith('/git/commits')) return json({ sha: 'd'.repeat(40) }, 201)
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      if (state.patchStatus && state.patchStatus !== 200) return json({ message: 'Branch update rejected' }, state.patchStatus)
      return json({ ref: 'refs/heads/main', object: { sha: body.sha } })
    }
    return json({}, 404)
  }
  return { state, fetch, writes: () => state.calls.filter(call => call.method !== 'GET') }
}
