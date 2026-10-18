import { defineConfig, devices } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  timeout: 60000,
  webServer: undefined,
  use: {
    ...config.use,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  testMatch: ['make-visual-inspector.spec.ts', 'make-preview-annotations.spec.ts', 'make-responsive-preview.spec.ts'],
  outputDir: '/tmp/paper-visual-results',
})
