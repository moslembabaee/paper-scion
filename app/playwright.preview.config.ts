import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({ ...config, testMatch: 'app-preview-iframe.spec.ts' })
