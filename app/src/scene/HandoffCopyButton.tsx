import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** The fallback also supports self-hosted instances served over plain HTTP. */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch { /* Try the browser's legacy copy path when clipboard permission is denied. */ }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('aria-label', 'Copy code')
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'
  document.body.append(field)
  try {
    field.select()
    if (!document.execCommand('copy')) throw new Error('Select the snippet and copy it manually.')
  } finally { field.remove(); previous?.focus({ preventScroll: true }) }
}

export function HandoffCopyButton({ text, label = 'snippet' }: { text: string; label?: string }) {
  const [feedback, setFeedback] = useState<{ text: string; status: 'idle' | 'copied' | 'error' }>({ text, status: 'idle' })
  const status = feedback.text === text ? feedback.status : 'idle'
  const operation = useRef({ revision: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined })
  useEffect(() => {
    const current = operation.current
    current.revision++
    return () => { current.revision++; clearTimeout(current.timer) }
  }, [text])
  async function copy() {
    const current = operation.current, revision = ++current.revision
    clearTimeout(current.timer)
    try { await copyText(text); if (revision === current.revision) setFeedback({ text, status: 'copied' }) }
    catch { if (revision === current.revision) setFeedback({ text, status: 'error' }) }
    if (revision === current.revision) current.timer = setTimeout(() => setFeedback({ text, status: 'idle' }), 2400)
  }
  return <span className="dev-copy-control">
    <button className="dev-copy-btn" aria-label={`Copy ${label}`} onClick={() => void copy()}>
      {status === 'copied' ? <Check size={11} /> : <Copy size={11} />}
      {status === 'copied' ? 'Copied' : 'Copy'}
    </button>
    <span className={status === 'error' ? 'dev-copy-error' : 'sr-only'} role="status">
      {status === 'error' ? 'Select and copy the snippet.' : status === 'copied' ? `${label} copied` : ''}
    </span>
  </span>
}
