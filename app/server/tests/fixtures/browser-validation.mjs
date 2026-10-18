// Scripted process boundary for API orchestration tests. The real browser runner
// is exercised separately by e2e/make-validation.spec.ts, without this fixture.
export const viewports = [{ viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 4 }, { viewport: 'mobile', width: 390, height: 844, screenshotBytes: 4 }]
export const screenshots = viewports.map(v => ({ viewport: v.viewport, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }))
export const browserPass = async () => ({ status: 'passed', diagnostics: [], viewports, screenshots })
export const runtimeFailure = async () => ({ status: 'failed', diagnostics: [{ file: 'src/App.tsx', line: 1, column: 1, code: 'RUNTIME_ERROR', severity: 'error', message: 'runtime fixture crash' }], viewports, screenshots })
