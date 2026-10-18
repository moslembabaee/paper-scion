import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  webServer: undefined,
  testMatch: ['make-preview-annotations.spec.ts', 'make-responsive-preview.spec.ts'],
  outputDir: '/tmp/paper-annotations-results',
})
