import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff, KeyRound, RefreshCw, ShieldAlert, Terminal } from 'lucide-react'
import type { useCloudAccount } from './useCloudAccount'

export type CloudAccountState = ReturnType<typeof useCloudAccount>

const MCP_ENDPOINT = 'https://paper.141.11.32.213.nip.io/mcp'
const authorization = 'Bearer <YOUR_PAPER_TOKEN>'
const agentConfigs = {
  'Claude Code': {
    file: '.mcp.json',
    snippet: JSON.stringify({ mcpServers: { paper: { type: 'http', url: MCP_ENDPOINT, headers: { Authorization: authorization } } } }, null, 2),
  },
  Codex: {
    file: '~/.codex/config.toml',
    snippet: `[mcp_servers.paper]\nurl = "${MCP_ENDPOINT}"\nhttp_headers = { Authorization = "${authorization}" }`,
  },
  Cursor: {
    file: '.cursor/mcp.json',
    snippet: JSON.stringify({ mcpServers: { paper: { url: MCP_ENDPOINT, headers: { Authorization: authorization } } } }, null, 2),
  },
}
type AgentClient = keyof typeof agentConfigs
type TokenAction = 'reveal' | 'copy' | 'rotate' | 'revoke' | 'generate'

export function AiAgentAccess({ account, disabled = false }: { account: CloudAccountState; disabled?: boolean }) {
  const [token, setToken] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [activeAction, setActiveAction] = useState<TokenAction | null>(null)
  const [client, setClient] = useState<AgentClient>('Claude Code')
  const [error, setError] = useState('')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const snippetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)
  const busy = activeAction !== null
  const hasToken = !!account.user?.hasMcpToken
  const config = agentConfigs[client]

  useEffect(() => () => {
    clearTimeout(copyTimer.current)
    clearTimeout(snippetTimer.current)
  }, [])

  async function action(kind: TokenAction, work: () => Promise<void>) {
    if (pending.current || disabled) return
    pending.current = true
    setActiveAction(kind)
    setError('')
    try { await work() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update agent access. Please try again.') }
    finally { pending.current = false; setActiveAction(null) }
  }

  function resetCopy() {
    clearTimeout(copyTimer.current)
    setCopied(false)
  }

  async function reveal() {
    await action('reveal', async () => {
      if (revealed) { setToken(''); setRevealed(false) }
      else { setToken(await account.revealToken()); setRevealed(true) }
    })
  }

  async function copyToken() {
    await action('copy', async () => {
      const secret = await account.revealToken()
      try { await navigator.clipboard.writeText(secret) }
      catch { throw new Error('Clipboard unavailable. Reveal the token to copy it manually.') }
      resetCopy()
      setCopied(true)
      copyTimer.current = setTimeout(() => setCopied(false), 2500)
    })
  }

  async function generateOrRotate() {
    await action(hasToken ? 'rotate' : 'generate', async () => {
      const next = await (hasToken ? account.rotate() : account.regenerate())
      setToken(next)
      setRevealed(true)
      resetCopy()
    })
  }

  async function revoke() {
    await action('revoke', async () => {
      await account.revoke()
      setToken('')
      setRevealed(false)
      resetCopy()
    })
  }

  async function copySnippet() {
    setError('')
    try {
      await navigator.clipboard.writeText(config.snippet)
      clearTimeout(snippetTimer.current)
      setSnippetCopied(true)
      snippetTimer.current = setTimeout(() => setSnippetCopied(false), 2500)
    } catch { setError('Clipboard unavailable. Select the configuration below to copy it manually.') }
  }

  return <section className="cloud-account" aria-labelledby="agent-access-title">
    <div className="profile-section-title">
      <KeyRound size={14} />
      <h3 id="agent-access-title">AI Agent Access (Model Context Protocol)</h3>
      <span className="mcp-token-status" data-active={hasToken}>{hasToken ? 'Active' : 'Inactive'}</span>
    </div>
    <p className="profile-note">Connect Claude Code, Codex, or Cursor to read and edit your projects, even when Paper is closed.</p>
    <div className="mcp-endpoint"><span>Server</span><code>{MCP_ENDPOINT}</code></div>
    {account.user ? <>
      <label className="workspace-field token-field">
        Cloud MCP Token
        <div>
          <input aria-label="Cloud MCP Token" readOnly type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false}
            value={hasToken ? revealed ? token : '••••••••••••••••••••••••••••••••' : ''}
            placeholder="Generate a token to connect an agent" />
          <button type="button" className="quiet-button mcp-token-control" disabled={busy || disabled || !hasToken}
            aria-label={revealed ? 'Hide token' : 'Reveal token'} onClick={() => void reveal()}>
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}<span>{activeAction === 'reveal' ? 'Loading…' : revealed ? 'Hide' : 'Reveal'}</span>
          </button>
          <button type="button" className="quiet-button mcp-token-control" aria-label="Copy token" disabled={busy || disabled || !hasToken} onClick={() => void copyToken()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}<span>{activeAction === 'copy' ? 'Copying…' : copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </label>
      <div className="token-actions">
        <button type="button" className={hasToken ? 'workspace-secondary' : 'workspace-primary'} disabled={busy || disabled} onClick={() => void generateOrRotate()}
          title={hasToken ? 'Replace the current token and disconnect existing agents' : 'Create a server-authenticated token'}>
          {hasToken ? <RefreshCw size={13} /> : <KeyRound size={13} />}
          {activeAction === 'rotate' ? 'Rotating…' : activeAction === 'generate' ? 'Generating…' : hasToken ? 'Rotate token' : 'Generate MCP token'}
        </button>
        {hasToken && <button type="button" className="workspace-danger-button" disabled={busy || disabled} onClick={() => void revoke()} title="Disconnect agents and remove token access">
          <ShieldAlert size={13} />{activeAction === 'revoke' ? 'Revoking…' : 'Revoke token'}
        </button>}
        <span role="status">{copied ? 'Copied to clipboard' : busy ? 'Updating agent access…' : hasToken ? 'Token active' : 'No active token'}</span>
      </div>
      <p className="profile-note mcp-action-note">Token changes apply immediately. Rotating or revoking disconnects agents using the previous token.</p>
    </> : <p className="profile-note">Sign in to generate and manage your MCP token.</p>}
    <details className="mcp-config-guide">
      <summary><Terminal size={13} /><span>Connect your AI agent</span><ChevronDown size={13} /></summary>
      <div className="mcp-snippet-header">
        <div className="mcp-client-picker" role="group" aria-label="Agent client">
          {(Object.keys(agentConfigs) as AgentClient[]).map(value => <button type="button" key={value} aria-pressed={client === value} onClick={() => {
            setClient(value); clearTimeout(snippetTimer.current); setSnippetCopied(false)
          }}>{value}</button>)}
        </div>
        <button type="button" className="quiet-button mcp-copy-button" aria-label="Copy configuration snippet" disabled={disabled} onClick={() => void copySnippet()}>
          {snippetCopied ? <Check size={13} /> : <Copy size={13} />}<span>{snippetCopied ? 'Copied' : 'Copy snippet'}</span>
        </button>
      </div>
      <p className="mcp-config-instruction">Add to <code>{config.file}</code> and replace <code>&lt;YOUR_PAPER_TOKEN&gt;</code> with your copied token.</p>
      <pre aria-label={`${client} configuration`}>{config.snippet}</pre>
      <span className="mcp-copy-status" role="status">{snippetCopied ? `${client} configuration copied` : ''}</span>
    </details>
    {(error || account.authNotice) && <p className="workspace-error" role="alert">{error || account.authNotice}</p>}
  </section>
}
