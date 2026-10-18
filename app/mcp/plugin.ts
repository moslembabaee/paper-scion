import type { Plugin, ViteDevServer, PreviewServer } from 'vite'
import { createBridgeServer, PaperBridge } from './bridge.ts'

export function paperBridgePlugin(): Plugin {
  const configure = (server: ViteDevServer | PreviewServer) => {
    const bridge = new PaperBridge()
    server.middlewares.use(bridge.middleware)
    const local = createBridgeServer(bridge)
    local.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') console.error('Paper bridge:', error.message)
      else console.warn('Paper bridge port 29979 is already in use. Connect agents to this Vite server URL with --live <url>.')
    })
    local.listen(29979, '127.0.0.1')
    server.httpServer?.on('close', () => { bridge.close(); local.close(); local.closeAllConnections() })
  }
  return { name: 'paper-live-bridge', configureServer: configure, configurePreviewServer: configure }
}
