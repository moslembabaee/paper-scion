import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'

const secret = 'a-persistent-secret-for-apps-api-tests-12345'

export async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-apps-api-'))
  let service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
  const responses = []
  t.after(async () => {
    service.close()
    for (const response of responses) response.emit('close')
    await rm(root, { recursive: true, force: true })
  })

  const open = async (path, options = {}) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.url = path
    req.method = options.method ?? 'GET'
    req.headers = Object.fromEntries(
      Object.entries({ 'Content-Type': 'application/json', ...options.headers }).map(([k, v]) => [k.toLowerCase(), v])
    )
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    responses.push(res)
    let text = ''
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => { text += String(chunk); return write(chunk) }
    res.end = chunk => { if (chunk) text += String(chunk); return end(chunk) }
    if (options.rawBody) {
      req.push(options.body ?? '')
      req.push(null)
    }
    await service.handler(req, res, Object.hasOwn(options, 'parsedBody') ? options.parsedBody : options.rawBody ? undefined : options.body ? JSON.parse(options.body) : {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return { status: res.statusCode, headers, res, text: () => text }
  }

  const request = async (path, options = {}) => {
    const response = await open(path, options)
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(response.text()) : response.text(),
    }
  }

  const login = async sub => {
    const { user, session } = await service.auth.login('github', {
      sub,
      email: `${sub}@test.local`,
      name: sub,
      avatar: '',
    })
    return {
      user,
      session,
      headers: { Cookie: `paper_session=${session}`, 'X-Paper-Client': 'web' },
    }
  }

  return { ...service, root, open, request, login, restart: async () => {
    service.close()
    service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
  } }
}

