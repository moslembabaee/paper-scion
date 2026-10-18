import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { CollaborationServer } from './server.ts'

export function collaborationPlugin(): Plugin {
  const configure = (server: ViteDevServer | PreviewServer) => {
    const collaboration = new CollaborationServer()
    server.middlewares.use(collaboration.middleware)
    server.httpServer?.on('close', () => collaboration.close())
  }
  return { name: 'paper-collaboration', configureServer: configure, configurePreviewServer: configure }
}
