#!/usr/bin/env node
try {
  const { main } = await import('../dist/mcp/cli.js')
  await main()
} catch (error) {
  process.stderr.write(`Paper MCP: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
