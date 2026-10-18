import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createService } from './service.ts'
import { APP_PROJECT_LIMITS } from '../src/make/manifest.ts'
import { MODEL_GATEWAY_LIMITS } from '../src/make/model-protocol.ts'
import { APP_SECRET_LIMITS } from '../src/make/secrets.ts'
import { APP_DATA_LIMITS } from '../src/make/data.ts'

const provider = (name: string) => {
  const clientId = process.env[`${name}_CLIENT_ID`]
  const clientSecret = process.env[`${name}_CLIENT_SECRET`]
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}
const service = await createService({ root: process.env.PAPER_DATA_DIR ?? '/data', secret: process.env.PAPER_SESSION_SECRET ?? '', origin: process.env.PAPER_PUBLIC_URL ?? 'http://localhost:3000', releaseOrigin: process.env.PAPER_RELEASE_ORIGIN, google: provider('GOOGLE'), github: provider('GITHUB') })
// Reverse-proxy only the isolated publication hostname to this listener.
// It never dispatches editor/auth/API routes, even with a Paper session cookie.
const releases = process.env.PAPER_RELEASE_ORIGIN ? createServer(service.publicHandler) : undefined
if (releases) await new Promise<void>((resolve, reject) => {
  releases.once('error', reject)
  releases.listen(Number(process.env.PAPER_RELEASE_PORT ?? 3002), '0.0.0.0', resolve)
})
// The HTTP handler is shared with integration tests; Fastify owns production connections and body limits.
const moduleName = 'fastify'
const { default: fastify } = await import(moduleName)
const app = fastify({ logger: true, bodyLimit: 17 * 1024 * 1024 })
const relay = async (request: { raw: IncomingMessage; body: unknown }, reply: { raw: ServerResponse; hijack: () => void }) => {
  reply.hijack()
  await service.handler(request.raw, reply.raw, request.body)
}
// App JSON must retain duplicate keys until strict validation. Limit the wire
// body before buffering it; scene and MCP routes keep their existing parsers.
app.register(async (scope: typeof app) => {
  scope.removeContentTypeParser('application/json')
  scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES },
    (_request: unknown, text: string, done: (error: Error | null, value: string) => void) => done(null, text))
  for (const path of ['/api/apps', '/api/apps/*', '/api/app-projects', '/api/app-projects/*', '/api/shared-apps', '/api/shared-apps/*']) {
    scope.all(path, { bodyLimit: APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES }, relay)
  }
  for (const path of ['/api/apps/:id/generate', '/api/app-projects/:id/generate']) {
    scope.all(path, { bodyLimit: MODEL_GATEWAY_LIMITS.MAX_REQUEST_BYTES }, relay)
  }
  for (const prefix of ['/api/apps', '/api/app-projects']) {
    for (const suffix of ['/secrets', '/secrets/:handle', '/capabilities/:handle']) {
      scope.all(`${prefix}/:id${suffix}`, { bodyLimit: APP_SECRET_LIMITS.MAX_REQUEST_BYTES }, relay)
    }
    for (const suffix of ['/data', '/data/:handle']) {
      scope.all(`${prefix}/:id${suffix}`, { bodyLimit: APP_DATA_LIMITS.MAX_REQUEST_BYTES }, relay)
    }
  }
})
app.all('/api/model/*', { bodyLimit: MODEL_GATEWAY_LIMITS.MAX_REQUEST_BYTES }, relay)
app.all('/*', relay)
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { releases?.close(); service.close(); void app.close() })
await app.listen({ host: '0.0.0.0', port: Number(process.env.PAPER_API_PORT ?? 3001) })
