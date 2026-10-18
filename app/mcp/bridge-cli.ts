import { createBridgeServer } from './bridge.ts'
const port = Number(process.env.PAPER_BRIDGE_PORT ?? 29979)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PAPER_BRIDGE_PORT')
const server = createBridgeServer()
server.listen(port, '127.0.0.1', () => process.stderr.write(`Paper live bridge: http://127.0.0.1:${port}/mcp\n`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); server.closeAllConnections() })
