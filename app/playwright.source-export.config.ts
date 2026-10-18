import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Build first; Paper UI/API requests use local artifacts in process. The source
// archive acceptance test still starts the exported app on a real local socket.
export default defineConfig({ ...config, webServer: undefined, testMatch: ['make-source-export.spec.ts', 'make-validation.spec.ts'] })
