import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Standalone assets need no dev server, project code execution or network access.
export default defineConfig({ ...config, webServer: undefined, testMatch: 'app-compiler.spec.ts' })
