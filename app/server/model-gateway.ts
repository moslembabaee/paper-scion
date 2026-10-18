import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppGenerationRecord, ModelBudget, ModelRequest, ModelResponse, ModelTurnRecord, ModelTurnUsage } from '../src/make/types.ts'
import { MODEL_GATEWAY_LIMITS, redactSensitiveText } from '../src/make/model-protocol.ts'
import { httpError, safeId } from './storage.ts'
import type { AppStorage } from './app-storage.ts'

interface AdapterResult { content: string; usage?: Partial<ModelTurnUsage>; model?: string }
// Only diagnostics authored by this gateway may enter responses or its ledger.
// Provider exceptions can echo prompts, generated source, or unknown secrets.
class ProviderResponseError extends Error {}

export type ModelAdapterFn = (
  request: ModelRequest,
  context: { signal: AbortSignal; apiKey?: string; model: string; provider: string }
) => Promise<AdapterResult>

export interface ModelGatewayConfig {
  provider?: string
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  timeoutMs?: number
  rateLimitPerMinute?: number
  turnBudget?: number
  tokenBudget?: number
  customAdapter?: ModelAdapterFn
  fetch?: typeof fetch
}

const positiveInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid model gateway ${name}`)
  return value
}

export class ServerModelGateway {
  private readonly provider: string
  private readonly apiKey: string
  private readonly baseUrl?: string
  private readonly defaultModel: string
  private readonly timeoutMs: number
  private readonly rateLimitPerMinute: number
  private readonly initialTurnBudget: number
  private readonly initialTokenBudget: number
  private readonly customAdapter?: ModelAdapterFn
  private readonly requestFetch: typeof fetch
  private readonly budgets = new Map<string, { usedTurns: number; usedTokens: number }>()
  private readonly rateLimits = new Map<string, { count: number; windowStart: number }>()
  private readonly turns = new Map<string, ModelTurnRecord[]>()
  private readonly inFlight = new Map<string, AbortController>()
  private ledgerPath?: string
  private writes: Promise<void> = Promise.resolve()

  constructor(config: ModelGatewayConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.PAPER_MODEL_URL
    this.provider = config.provider ?? process.env.PAPER_MODEL_PROVIDER ?? (this.baseUrl ? 'http' : 'disabled')
    this.apiKey = config.apiKey ?? process.env.PAPER_MODEL_API_KEY ?? ''
    this.defaultModel = config.defaultModel ?? process.env.PAPER_MODEL_NAME ?? (this.provider === 'mock' ? 'paper-mock-v1' : 'default-model')
    this.timeoutMs = positiveInteger(config.timeoutMs ?? MODEL_GATEWAY_LIMITS.DEFAULT_TIMEOUT_MS, 'timeout')
    this.rateLimitPerMinute = positiveInteger(config.rateLimitPerMinute ?? MODEL_GATEWAY_LIMITS.DEFAULT_RATE_LIMIT_PER_MINUTE, 'rate limit')
    this.initialTurnBudget = positiveInteger(config.turnBudget ?? MODEL_GATEWAY_LIMITS.DEFAULT_ACCOUNT_TURN_BUDGET, 'turn budget')
    this.initialTokenBudget = positiveInteger(config.tokenBudget ?? MODEL_GATEWAY_LIMITS.DEFAULT_ACCOUNT_TOKEN_BUDGET, 'token budget')
    this.customAdapter = config.customAdapter
    this.requestFetch = config.fetch ?? fetch
  }

  // One API process owns the data volume, as with app storage. Save reservations
  // before provider dispatch so a restart cannot replenish a spent budget.
  async initialize(root: string): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    this.ledgerPath = join(root, 'model-usage.json')
    try {
      const ledger = JSON.parse(await readFile(this.ledgerPath, 'utf8')) as {
        budgets: [string, { usedTurns: number; usedTokens: number }][]
        turns: [string, ModelTurnRecord[]][]
      }
      for (const [user, budget] of ledger.budgets) {
        safeId(user, 'user ID')
        if (![budget.usedTurns, budget.usedTokens].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error('Invalid model usage ledger')
        this.budgets.set(user, budget)
      }
      for (const [user, turns] of ledger.turns) this.turns.set(user, turns.slice(0, 100).map(turn => turn.status === 'pending'
        ? { ...turn, status: 'cancelled', errorMessage: 'Gateway restarted before completion' }
        : turn))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private persist(): Promise<void> {
    if (!this.ledgerPath) return Promise.resolve()
    const path = this.ledgerPath
    const snapshot = JSON.stringify({ budgets: [...this.budgets], turns: [...this.turns] })
    const write = this.writes.then(async () => {
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    })
    // A failed write blocks later dispatches; do not silently reset accounting.
    this.writes = write
    return write
  }

  getBudget(userId: string): ModelBudget {
    const usage = this.budgets.get(userId) ?? { usedTurns: 0, usedTokens: 0 }
    return {
      ...usage,
      remainingTurns: Math.max(0, this.initialTurnBudget - usage.usedTurns), limitTurns: this.initialTurnBudget,
      remainingTokens: Math.max(0, this.initialTokenBudget - usage.usedTokens), limitTokens: this.initialTokenBudget,
    }
  }

  sanitizeFeedback(text: string): string {
    return redactSensitiveText(text, [this.apiKey])
  }

  listTurns(userId: string, appId?: string): ModelTurnRecord[] {
    return structuredClone((this.turns.get(userId) ?? []).filter(turn => !appId || turn.appId === appId))
  }

  async recordGeneration(userId: string, turnId: string, generation: AppGenerationRecord): Promise<void> {
    const turn = this.turns.get(userId)?.find(item => item.turnId === turnId)
    if (!turn) throw httpError(409, 'Generation turn is no longer available')
    this.recordTurn(userId, { ...turn, generation: structuredClone(generation) })
    await this.persist()
  }

  cancelTurn(userId: string, turnId: string): boolean {
    const controller = this.inFlight.get(`${userId}:${turnId}`)
    if (!controller || controller.signal.aborted) return false
    controller.abort(new Error('Request cancelled'))
    return true
  }

  close(): void {
    for (const controller of this.inFlight.values()) controller.abort(new Error('Gateway closed'))
  }

  private recordTurn(userId: string, record: ModelTurnRecord): void {
    this.turns.set(userId, [record, ...(this.turns.get(userId) ?? []).filter(turn => turn.turnId !== record.turnId)].slice(0, 100))
  }

  async executeTurn(params: { userId: string; request: ModelRequest; signal?: AbortSignal; appStorage?: AppStorage }): Promise<ModelResponse> {
    const { userId, signal, appStorage } = params
    let { request } = params
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw httpError(400, 'Expected request object')
    if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw httpError(400, 'Prompt is required')
    const promptBytes = Buffer.byteLength(request.prompt)
    if (promptBytes > MODEL_GATEWAY_LIMITS.MAX_PROMPT_BYTES) throw httpError(413, 'Prompt exceeds maximum allowed size')
    const requestBytes = Buffer.byteLength(JSON.stringify(request))
    if (requestBytes > MODEL_GATEWAY_LIMITS.MAX_REQUEST_BYTES) throw httpError(413, 'Model request payload too large')
    const fields = new Set(['prompt', 'systemPrompt', 'model', 'appId', 'expectedRevision', 'temperature', 'maxTokens', 'context'])
    if (Object.keys(request).some(key => !fields.has(key))) throw httpError(400, 'Unknown model request field')
    if (request.systemPrompt !== undefined && typeof request.systemPrompt !== 'string') throw httpError(400, 'Invalid system prompt')
    if (request.context !== undefined && (!request.context || typeof request.context !== 'object' || Array.isArray(request.context))) throw httpError(400, 'Invalid context')
    if (request.model !== undefined && request.model !== this.defaultModel) throw httpError(400, 'Model is not permitted')
    if (request.maxTokens !== undefined && (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1)) throw httpError(400, 'Invalid output token limit')
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw httpError(400, 'Invalid temperature')
    if (request.expectedRevision !== undefined && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1)) throw httpError(400, 'Invalid expected revision')
    if (request.appId !== undefined) {
      safeId(request.appId, 'app ID')
      if (!appStorage) throw httpError(404, 'App project not found')
      const existing = await appStorage.read(userId, request.appId)
      if (!existing) throw httpError(404, 'App project not found')
      if (request.expectedRevision !== undefined && request.expectedRevision !== existing.revision) {
        throw Object.assign(httpError(409, 'Revision mismatch'), { current: existing.revision })
      }
    }
    if (signal?.aborted) throw httpError(499, 'Request cancelled')
    if (!this.customAdapter && this.provider !== 'mock' && (!this.baseUrl || !this.apiKey)) throw httpError(503, 'Model provider is not configured')

    const turnId = 'turn_' + randomUUID()
    const base = { turnId, userId, appId: request.appId, provider: this.provider, model: this.defaultModel, promptBytes, createdAt: new Date().toISOString() }
    const rejected = async (status: 'rate_limited' | 'budget_exceeded', message: string): Promise<never> => {
      this.recordTurn(userId, { ...base, status, outputBytes: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }, errorMessage: message })
      await this.persist()
      throw httpError(429, message)
    }
    const now = Date.now()
    const rate = this.rateLimits.get(userId)
    if (rate && now - rate.windowStart < 60_000) {
      if (rate.count >= this.rateLimitPerMinute) return rejected('rate_limited', 'Too many model requests. Please wait a moment.')
      rate.count++
    } else this.rateLimits.set(userId, { count: 1, windowStart: now })

    const budget = this.getBudget(userId)
    // UTF-8 bytes provide a conservative input-token allowance, including context
    // and system instructions. Reserve output too before any asynchronous work.
    const inputAllowance = requestBytes
    const maxTokens = Math.min(request.maxTokens ?? MODEL_GATEWAY_LIMITS.MAX_OUTPUT_TOKENS, MODEL_GATEWAY_LIMITS.MAX_OUTPUT_TOKENS, budget.remainingTokens - inputAllowance)
    if (budget.remainingTurns < 1 || maxTokens < 1) return rejected('budget_exceeded', 'Model generation budget exceeded')
    request = { ...request, model: this.defaultModel, maxTokens }
    const reservation = inputAllowance + maxTokens
    const account = this.budgets.get(userId) ?? { usedTurns: 0, usedTokens: 0 }
    account.usedTurns++
    account.usedTokens += reservation
    this.budgets.set(userId, account)

    const controller = new AbortController()
    const key = `${userId}:${turnId}`
    this.inFlight.set(key, controller)
    let timedOut = false
    const onClientAbort = () => controller.abort(new Error('Request cancelled'))
    signal?.addEventListener('abort', onClientAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Model provider timed out')) }, this.timeoutMs)
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    void aborted.catch(() => {})
    const start = performance.now()
    let usage: ModelTurnUsage = { promptTokens: inputAllowance, completionTokens: maxTokens, totalTokens: reservation, durationMs: 0 }
    let outputBytes = 0
    this.recordTurn(userId, { ...base, status: 'pending', usage, outputBytes })
    try {
      await this.persist()
      if (signal?.aborted) onClientAbort()
      if (controller.signal.aborted) throw controller.signal.reason
      const result = await Promise.race([
        Promise.resolve().then(() => this.customAdapter
          ? this.customAdapter(request, { signal: controller.signal, apiKey: this.apiKey, model: this.defaultModel, provider: this.provider })
          : this.provider === 'mock' ? this.mockGenerate(request) : this.remoteHttpGenerate(request, controller.signal)),
        aborted,
      ])
      if (controller.signal.aborted) throw controller.signal.reason
      if (typeof result?.content !== 'string') throw new ProviderResponseError('Invalid model response')
      outputBytes = Buffer.byteLength(result.content)
      if (outputBytes > MODEL_GATEWAY_LIMITS.MAX_OUTPUT_BYTES) throw new ProviderResponseError('Model response exceeded output byte limit')
      const promptTokens = result.usage?.promptTokens ?? inputAllowance
      // Output length is not a tokenizer. Without authoritative usage, retain
      // the output reservation so an omitted report cannot replenish budgets.
      const completionTokens = result.usage?.completionTokens ?? maxTokens
      if (![promptTokens, completionTokens].every(v => Number.isSafeInteger(v) && v >= 0) || completionTokens > maxTokens || promptTokens + completionTokens > reservation) {
        throw new ProviderResponseError('Model response exceeded token limit or reported invalid usage')
      }
      usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, durationMs: Math.round(performance.now() - start) }
      account.usedTokens -= reservation - usage.totalTokens
      const content = redactSensitiveText(result.content, [this.apiKey])
      this.recordTurn(userId, { ...base, status: 'success', usage, outputBytes })
      await this.persist()
      if (controller.signal.aborted) throw controller.signal.reason
      return { turnId, provider: this.provider, model: this.defaultModel, content, usage, budget: this.getBudget(userId), timestamp: base.createdAt }
    } catch (error) {
      usage = { ...usage, durationMs: Math.round(performance.now() - start) }
      const cancelled = controller.signal.aborted
      const message = timedOut ? 'Model provider timed out' : cancelled ? 'Request cancelled' : error instanceof ProviderResponseError ? error.message : 'Provider request failed'
      // Failed/aborted providers may have billed tokens: retain the reservation
      // unless a validated usage report was received. No source writes occur.
      this.recordTurn(userId, { ...base, status: cancelled ? 'cancelled' : 'error', usage, outputBytes, errorMessage: message })
      await this.persist()
      throw httpError(timedOut ? 504 : cancelled ? 499 : 502, cancelled ? message : `Model provider error: ${message}`)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onClientAbort)
      controller.signal.removeEventListener('abort', onAbort)
      this.inFlight.delete(key)
    }
  }

  private async mockGenerate(request: ModelRequest): Promise<AdapterResult> {
    let content: string
    if (request.systemPrompt?.includes('Paper Make App Planner') || request.context?.mode === 'plan') {
      content = JSON.stringify({
        summary: `Plan: ${request.prompt.slice(0, 80)}`,
        files: [
          { path: 'src/App.tsx', description: 'Application UI and state logic', action: 'modify' },
          { path: 'src/styles.css', description: 'Component styling and layout rules', action: 'modify' },
        ],
        interactions: [
          `Interactive state updates responding to prompt: "${request.prompt.slice(0, 50)}"`,
          'User visual feedback rendered with CSS transitions',
        ],
        risks: [
          'State resets on preview reload unless saved to account storage',
          'Only pre-approved modules from allowlist can be imported',
        ],
      })
    } else if (request.systemPrompt?.includes('Paper Make App Generator') || request.context?.mode === 'generate') {
      const planned = Array.isArray(request.context?.plannedFiles)
        ? (request.context.plannedFiles as string[])
        : null
      const defaultApp = `import React, { useState } from 'react'
import { Sparkles, Plus, Minus, RotateCcw } from 'lucide-react'
import './styles.css'

export default function App() {
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(false)

  return (
    <main className="make-app-shell">
      <div className="card">
        <header className="card-header">
          <Sparkles size={18} className="icon" />
          <h1>Generated Prototype</h1>
        </header>
        <p className="description">
          Functional app generated from approved plan.
        </p>
        <div className="counter-row">
          <span className="count-label">Count: {count}</span>
          <div className="btn-group">
            <button className="btn" aria-label="Decrement" onClick={() => setCount(c => c - 1)}>
              <Minus size={14} />
            </button>
            <button className="btn" aria-label="Increment" onClick={() => setCount(c => c + 1)}>
              <Plus size={14} />
            </button>
            <button className="btn" aria-label="Reset" onClick={() => { setCount(0); setActive(false) }}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        <button
          className={"toggle-btn " + (active ? 'active' : '')}
          onClick={() => setActive(!active)}
        >
          {active ? '✨ Active' : 'Click to activate'}
        </button>
      </div>
    </main>
  )
}
`
      const defaultCss = `.make-app-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background-color: #080808;
  color: #edebe1;
  background-image: linear-gradient(#222222 1px, transparent 1px), linear-gradient(90deg, #222222 1px, transparent 1px);
  background-size: 120px 120px;
}
.card {
  max-width: 440px;
  width: 100%;
  background: #111111;
  border: 1px solid #222222;
  border-radius: 8px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-header h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: #edebe1;
}
.icon {
  color: #81adec;
}
.description {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #888888;
}
.counter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: #080808;
  border: 1px solid #222222;
  border-radius: 6px;
}
.count-label {
  font-size: 15px;
  font-weight: 600;
  color: #edebe1;
}
.btn-group {
  display: flex;
  gap: 6px;
}
.btn {
  background: #181818;
  color: #edebe1;
  border: 1px solid #333333;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover {
  border-color: #81adec;
  background: #222222;
}
.toggle-btn {
  background: #222222;
  color: #edebe1;
  border: 1px solid #333333;
  padding: 10px 18px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.toggle-btn:hover {
  border-color: #81adec;
}
.toggle-btn.active {
  background: #81adec;
  color: #080808;
  border-color: #81adec;
}
`
      const allFiles = [
        { path: 'src/App.tsx', content: defaultApp },
        { path: 'src/styles.css', content: defaultCss },
      ]
      const files = planned
        ? allFiles.filter(f => planned.includes(f.path))
        : allFiles
      if (files.length === 0 && planned && planned.length > 0) {
        for (const p of planned) {
          files.push({ path: p, content: p.endsWith('.css') ? defaultCss : defaultApp })
        }
      }
      content = JSON.stringify({
        summary: `Generated functional prototype for: ${request.prompt.slice(0, 60)}`,
        files,
      })
    } else {
      content = JSON.stringify({ message: `Generated response for: ${request.prompt.slice(0, 100)}` })
    }
    return {
      content,
      usage: {
        promptTokens: Math.ceil(Buffer.byteLength(request.prompt) / 4),
        completionTokens: Math.ceil(Buffer.byteLength(content) / 4),
      },
    }
  }

  private async remoteHttpGenerate(request: ModelRequest, signal: AbortSignal): Promise<AdapterResult> {
    const response = await this.requestFetch(this.baseUrl!, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.defaultModel, prompt: request.prompt, system: request.systemPrompt, context: request.context, temperature: request.temperature, max_tokens: request.maxTokens }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ProviderResponseError(`Upstream returned HTTP ${response.status}`)
    }
    if (!response.body) throw new ProviderResponseError('Empty model response')
    const reader = response.body.getReader()
    // Also release the body when a transport fails to honor its fetch signal.
    // Cancelling the reader settles a pending read and frees its connection.
    const cancelBody = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', cancelBody, { once: true })
    if (signal.aborted) cancelBody()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        size += value.byteLength
        if (size > MODEL_GATEWAY_LIMITS.MAX_OUTPUT_BYTES + 64 * 1024) throw new ProviderResponseError('Model response exceeded output byte limit')
        chunks.push(value)
      }
    } finally {
      signal.removeEventListener('abort', cancelBody)
      await reader.cancel()
      reader.releaseLock()
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderResponseError('Invalid model response')
    const result = data as { content?: string; text?: string; usage?: Partial<ModelTurnUsage> }
    return { content: result.content ?? result.text!, usage: result.usage }
  }
}
