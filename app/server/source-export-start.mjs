// Local-only static host. Never execute source, serve arbitrary files or bind publicly.
import { createServer } from 'node:http'
import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
export async function createAppServer() {
  const directory = new URL('../dist', import.meta.url)
  const entry = new URL('../dist/index.html', import.meta.url)
  const output = await lstat(directory)
  if (output.isSymbolicLink()) throw new Error('Output symlinks are forbidden')
  if (!output.isDirectory()) throw new Error('Build output must be a directory containing a regular file')
  const existing = await lstat(entry)
  if (existing.isSymbolicLink()) throw new Error('Output symlinks are forbidden')
  if (!existing.isFile()) throw new Error('Build output must be a regular file')
  // Match the build boundary when starting an extracted app. Check the opened
  // file as well, and never follow a replacement symlink at the final component.
  const file = await open(entry, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  let html
  try {
    if (!(await file.stat()).isFile()) throw new Error('Build output must be a regular file')
    html = await file.readFile()
  } finally { await file.close() }
  return createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method) || !['/', '/index.html'].includes(req.url)) {
      res.writeHead(404); res.end(); return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : html)
  })
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = await createAppServer()
  server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => console.log(`Paper app: http://127.0.0.1:${server.address().port}`))
}
