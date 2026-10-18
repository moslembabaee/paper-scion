import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Tests route the built frontend and real API in process; no HTTP listener required.
export default defineConfig({ ...config, webServer: undefined,
  testMatch: ['make-secrets.spec.ts', 'make-sharing.spec.ts', 'make-publication.spec.ts', 'make-validation.spec.ts'] })
