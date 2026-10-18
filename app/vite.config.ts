import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paperBridgePlugin } from './mcp/plugin.ts'
import { collaborationPlugin } from './collaboration/plugin.ts'

export default defineConfig({
  server: process.env.PAPER_API_URL ? {
    proxy: Object.fromEntries(['/api/auth', '/api/projects', '/api/apps', '/api/app-projects', '/api/model', '/api/events', '/mcp'].map(path => [path, { target: process.env.PAPER_API_URL, changeOrigin: false }])),
  } : undefined,
  base: process.env.BASE_URL || './',
  plugins: [
    {
      name: 'paper-cloud-capability',
      configureServer(server) {
        if (!process.env.PAPER_API_URL) return
        server.middlewares.use('/cloud.json', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"cloud":true}') })
      },
    },
    collaborationPlugin(),
    paperBridgePlugin(),
    tailwindcss(),
    react(),
  ],
})
