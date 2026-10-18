import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Run against built artifacts in-process, including in runners without listening sockets.
export default defineConfig({
  ...config,
  webServer: undefined,
  testMatch: 'make-responsive-preview.spec.ts',
  outputDir: '/tmp/paper-responsive-results',
})
