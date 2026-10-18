import { useRef, useState } from 'react'
import { ArrowUp, AtSign } from 'lucide-react'
import { COMMENT_LIMIT } from './model'
import type { CommentAuthor } from './types'

export function CommentComposer({ label, users, onSubmit, onCancel }: { label: string; users: readonly CommentAuthor[]; onSubmit: (body: string) => void; onCancel?: () => void }) {
  const [body, setBody] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const suggestions = query === null ? [] : users.filter(user => user.username.startsWith(query.toLowerCase())).slice(0, 5)
  function updateQuery(value: string, caret: number) {
    setQuery(value.slice(0, caret).match(/(?:^|\s)@([a-z0-9_]{0,40})$/i)?.[1] ?? null)
  }
  function insertMention(username: string) {
    const element = textarea.current!, caret = element.selectionStart
    const prefix = body.slice(0, caret).replace(/@[a-z0-9_]*$/i, `@${username} `)
    setBody(prefix + body.slice(caret)); setQuery(null)
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(prefix.length, prefix.length) })
  }
  function submit() {
    if (!body.trim()) return
    try { onSubmit(body); setBody(''); setQuery(null); setError('') } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not post this comment.') }
  }
  return <form className="comment-composer" onSubmit={event => { event.preventDefault(); submit() }}>
    <textarea ref={textarea} aria-label={label} placeholder={label === 'Write a comment' ? 'Leave a thought at this point…' : 'Add to the conversation…'} value={body} maxLength={COMMENT_LIMIT} autoFocus={label === 'Write a comment'} onChange={event => { setBody(event.target.value); setSuggestionIndex(0); updateQuery(event.target.value, event.target.selectionStart); setError('') }} onKeyUp={event => { if (event.key !== 'Escape') updateQuery(event.currentTarget.value, event.currentTarget.selectionStart) }} onClick={event => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); return }
      if (suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setSuggestionIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length) }
      if (suggestions.length && event.key === 'Enter') { event.preventDefault(); insertMention(suggestions[suggestionIndex % suggestions.length].username) }
      if (event.key === 'Escape' && query !== null) { event.preventDefault(); event.stopPropagation(); setQuery(null) }
    }} />
    {suggestions.length > 0 && <div className="comment-mention-menu" aria-label="Mention suggestions">{suggestions.map((user, index) => <button type="button" key={user.username} data-active={index === suggestionIndex % suggestions.length} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(user.username)}><AtSign size={12} /><span>{user.name}</span><small>@{user.username}</small></button>)}</div>}
    <div className="comment-composer-actions"><span>@ mention <span>·</span> ⌘/Ctrl ↵</span>{onCancel && <button type="button" className="comment-text-button" onClick={onCancel}>Cancel</button>}<button type="submit" className="comment-send" aria-label={label === 'Write a comment' ? 'Post comment' : 'Post reply'} disabled={!body.trim()}><ArrowUp size={15} /></button></div>
    {error && <p className="comment-error" role="alert">{error}</p>}
  </form>
}
