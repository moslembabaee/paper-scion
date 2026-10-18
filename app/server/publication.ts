import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppStorage } from './app-storage.ts'
import { PREVIEW_CSP_HEADER } from '../src/make/preview-sandbox.ts'

export function publicationOrigin(value: string | undefined, editorOrigin: string): string | undefined {
  if (!value) return undefined
  const url = new URL(value), editor = new URL(editorOrigin)
  // Absolute DNS names resolve to the same host with or without the final dot.
  // Keep the configured origin for exact Host routing, but compare DNS names
  // canonically so spelling/port changes cannot stand in for host isolation.
  const hostname = url.hostname.replace(/\.$/, '')
  const editorHostname = editor.hostname.replace(/\.$/, '')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || hostname === editorHostname) {
    throw new Error('PAPER_RELEASE_ORIGIN requires a separate hostname and HTTPS (HTTP is allowed on loopback).')
  }
  return url.origin
}

// No editor messaging bridge. Generated code runs only in a credentialless,
// opaque child; it cannot read cookies, storage or its trusted parent.
export function publicationDocument(html: string): string {
  const literal = JSON.stringify(html).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Paper app</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block;background:#080808}</style></head><body><iframe title="Published app" sandbox="allow-scripts" credentialless referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'"></iframe><script>document.querySelector('iframe').srcdoc=${literal};</script></body></html>`
}

export function createPublicHandler(storage: AppStorage, origin: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `${PREVIEW_CSP_HEADER}; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()' }
    try {
      // Dedicated listener, exact Host, no forwarding headers, auth or CORS.
      const match = (req.url ?? '').match(/^\/r\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-f0-9-]{36})\/([a-f0-9]{64})\/$/)
      if (origin && req.headers.host === new URL(origin).host && ['GET', 'HEAD'].includes(req.method ?? '') && match) {
        const html = await storage.publicPublication(match[1], match[2], match[3], match[4])
        if (html !== null) {
          res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8',
            // Every navigation revalidates so unpublish also revokes cached URLs.
            'Cache-Control': 'public, max-age=0, must-revalidate', 'Content-Length': Buffer.byteLength(html) })
          res.end(req.method === 'HEAD' ? undefined : html)
          return
        }
      }
      res.writeHead(404, headers); res.end(req.method === 'HEAD' ? undefined : 'Not found')
    } catch {
      res.writeHead(404, headers); res.end(req.method === 'HEAD' ? undefined : 'Not found')
    }
  }
}
