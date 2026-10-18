import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({ ...config, webServer: undefined,
  testMatch: ['make-github-handoff.spec.ts'] })
