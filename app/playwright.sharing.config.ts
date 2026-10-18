import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({ ...config, webServer: undefined,
  testMatch: ['make-sharing.spec.ts', 'make-publication.spec.ts', 'make-validation.spec.ts'] })
