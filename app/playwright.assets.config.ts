import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Build first. Browser requests route to local artifacts and the real service in
// process so upload/preview/export tests need no listening socket or OAuth keys.
export default defineConfig({ ...config, webServer: undefined, testMatch: 'make-assets.spec.ts' })
