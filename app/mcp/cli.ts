import { resolve } from 'node:path'
import { LivePaperClient } from './bridge.ts'
import { PaperFiles } from './files.ts'
import { PaperMcpServer, serveStdio, SERVER_VERSION } from './server.ts'

export async function main(args = process.argv.slice(2)): Promise<void> {
  let workspace = process.env.PAPER_WORKSPACE ?? process.cwd()
  let file = process.env.PAPER_FILE
  let live = process.env.PAPER_BRIDGE_URL
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      process.stderr.write('Paper MCP server\n\nUsage: paper-mcp [--workspace <directory>] [--file <project.paper.json>] [--live <http://127.0.0.1:29979>]\n\nNode.js 22+ · stdio MCP · live canvas or offline files\nWorkspace defaults to cwd or PAPER_WORKSPACE. File defaults to PAPER_FILE.\nWithout --file, connect to the active browser via the localhost bridge.\nOnly create_frame creates a missing project. Parent directories must exist.\n')
      return
    }
    if (arg === '--version') { process.stderr.write(`paper-mcp ${SERVER_VERSION}\n`); return }
    if (arg !== '--workspace' && arg !== '--file' && arg !== '--live') throw new Error(`Unknown option: ${arg}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    if (arg === '--workspace') workspace = value
    else if (arg === '--file') file = value
    else live = value
  }
  if (live && file) throw new Error('Use either --live or --file')
  if (!file) {
    await serveStdio(new PaperMcpServer(new LivePaperClient(live)), process.stdin, process.stdout)
    return
  }
  const files = await PaperFiles.create({ workspace: resolve(workspace), file })
  await serveStdio(new PaperMcpServer(files), process.stdin, process.stdout)
}
