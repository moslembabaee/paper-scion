import { defineConfig } from '@playwright/test'
import config from './playwright.secrets.config'

// Built frontend, real API/session/storage and opaque iframe; no HTTP listener.
export default defineConfig({ ...config,
  testMatch: ['make-data.spec.ts', 'make-secrets.spec.ts', 'make-sharing.spec.ts', 'make-publication.spec.ts', 'make-validation.spec.ts'],
})
