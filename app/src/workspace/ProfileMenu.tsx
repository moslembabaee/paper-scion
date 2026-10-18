import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, FolderOpen, HardDrive, LogOut, Settings2, Upload, UserRound, X } from 'lucide-react'
import { getTheme, setTheme } from '../design-system/theme'
import type { StudioTheme } from '../design-system/tokens'
import { Dialog } from './Dialog'
import { initials, readAvatar, saveProfile } from './profile'
import { AiAgentAccess } from '../cloud/CloudAccount'
import type { CloudAccountState } from '../cloud/CloudAccount'
import type { CloudUser } from '../cloud/model'
import type { UserProfile } from './types'

export function Avatar({ profile, user, large = false }: { profile: UserProfile; user?: CloudUser | null; large?: boolean }) {
  const avatar = user ? user.avatar : profile.avatar
  const name = user ? user.name : profile.name
  return <span className={`account-avatar ${large ? 'large' : ''}`} aria-hidden="true">{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initials(name)}</span>
}

export function ProfileMenu({ profile, onSave, onOpenProjects, account }: {
  profile: UserProfile; onSave: (profile: UserProfile) => void; onOpenProjects: () => void; account: CloudAccountState
}) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const logoutPending = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => { if (account.authNotice) setSettings(true) }, [account.authNotice])
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  return <div className="account-control" ref={root}>
    <button ref={trigger} className="account-trigger" aria-label="User profile menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'profile-menu' : undefined} title={account.user?.name ?? profile.name} onClick={() => setOpen(!open)}><Avatar profile={profile} user={account.user} />{account.user && <span className="account-header-name">{account.user.name}</span>}</button>
    {open && <div id="profile-menu" className="account-menu workspace-surface" role="menu" aria-label="Your account" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      <div className="account-menu-identity"><Avatar profile={profile} user={account.user} /><div><strong>{account.user?.name ?? profile.name}</strong><span>{account.user?.email ?? 'Your Paper workspace'}</span></div></div>
      <button role="menuitem" onClick={() => { close(); setSettings(true) }}><UserRound size={15} />Profile & account<Settings2 size={13} /></button>
      <button role="menuitem" onClick={() => { close(); onOpenProjects() }}><FolderOpen size={15} />Projects<ArrowUpRight size={13} /></button>
      {account.user && <button role="menuitem" disabled={signingOut} onClick={async () => {
        if (logoutPending.current) return
        logoutPending.current = true
        setSigningOut(true)
        setSignOutError('')
        try { await account.logout() }
        catch { setSignOutError('Could not sign out. Please try again.') }
        finally { logoutPending.current = false; setSigningOut(false) }
      }}><LogOut size={15} />{signingOut ? 'Signing out…' : 'Sign out'}</button>}
      {signOutError && <p className="account-signout-error" role="alert">{signOutError}</p>}
      <div className="account-menu-footer"><HardDrive size={12} /><span>{profile.workspaceName}</span><i /></div>
    </div>}
    {settings && <ProfileDialog key={account.user?.id ?? 'guest'} profile={profile} onSave={onSave} account={account} onClose={() => { setSettings(false); trigger.current?.focus() }} />}
  </div>
}

function ProfileDialog({ profile, onSave, onClose, account }: { profile: UserProfile; onSave: (profile: UserProfile) => void; onClose: () => void; account: CloudAccountState }) {
  const [draft, setDraft] = useState(() => ({
    ...profile,
    name: account.user ? account.user.name : profile.name,
    avatar: account.user ? account.user.avatar : profile.avatar,
  }))
  const [theme, setDraftTheme] = useState<StudioTheme>(getTheme)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const busy = uploading || saving
  const file = useRef<HTMLInputElement>(null)
  const field = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => setDraft(current => ({ ...current, [key]: value }))

  async function upload(avatar: File) {
    setUploading(true)
    setError('')
    try { field('avatar', await readAvatar(avatar)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this image.') }
    finally { setUploading(false) }
  }

  async function submit() {
    if (busy) return
    if (!draft.name.trim() || !draft.workspaceName.trim()) { setError('Enter your name and a workspace name.'); return }
    setSaving(true)
    setError('')
    try {
      const next = { ...draft, name: draft.name.trim(), workspaceName: draft.workspaceName.trim() }
      if (account.user && (next.name !== account.user.name || next.avatar !== account.user.avatar)) {
        await account.updateProfile({
          name: next.name,
          avatar: next.avatar,
        })
      }
      const local = account.user ? { ...next, name: profile.name, avatar: profile.avatar } : next
      saveProfile(local)
      setTheme(theme)
      onSave(local)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Account settings could not be saved. Browser storage may be full or unavailable.') }
    finally { setSaving(false) }
  }

  return <Dialog className="profile-dialog workspace-surface" labelledBy="profile-title" onClose={onClose} busy={busy}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="workspace-dialog-heading"><div><span className="workspace-eyebrow">YOUR PAPER STUDIO</span><h2 id="profile-title">Profile & account</h2><p>Your profile, studio preferences, and AI agent access.</p></div><button type="button" className="quiet-button" aria-label="Close account settings" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <div className="profile-body">
        <div className="profile-identity"><Avatar profile={draft} user={account.user ? { ...account.user, name: draft.name, avatar: draft.avatar } : null} large /><div><strong>Your profile picture</strong><span>PNG, JPEG or WebP · up to 5 MB</span><div className="avatar-actions"><button type="button" className="workspace-secondary" disabled={busy} onClick={() => file.current?.click()}><Upload size={12} />{uploading ? 'Preparing…' : 'Upload image'}</button>{draft.avatar && <button type="button" className="workspace-text-button" disabled={busy} onClick={() => field('avatar', '')}>Remove</button>}</div></div><input ref={file} hidden type="file" aria-label="Upload profile image" accept="image/png,image/jpeg,image/webp" onChange={event => { const avatar = event.target.files?.[0]; event.target.value = ''; if (avatar) void upload(avatar) }} /></div>
        <label className="workspace-field">Display name<input required maxLength={80} value={draft.name} autoComplete="name" onChange={event => field('name', event.target.value)} /></label>
        {account.user && <div className="profile-account-details"><span>Email</span><strong>{account.user.email}</strong><span className="profile-provider">{account.user.provider === 'google' ? 'Signed in with Google' : account.user.provider === 'github' ? 'Signed in with GitHub' : 'Signed in to Paper'}</span></div>}
        <div className="profile-section-title"><Settings2 size={14} /><h3>Studio preferences</h3></div>
        <label className="workspace-field">Workspace name<input required maxLength={80} value={draft.workspaceName} onChange={event => field('workspaceName', event.target.value)} /></label>
        <div className="profile-preference"><div><strong>Studio appearance</strong><span>Choose the space you work best in.</span></div><div className="profile-theme" role="group" aria-label="Preferred studio appearance">{(['dark', 'light'] as const).map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setDraftTheme(value)}>{value === 'dark' ? 'Dark' : 'Light'}</button>)}</div></div>
        <label className="profile-preference"><span><strong>Engineering grid</strong><span>Show the 120 px grid in new projects.</span></span><input className="profile-checkbox" type="checkbox" checked={draft.defaultGrid} onChange={event => field('defaultGrid', event.target.checked)} /></label>
        <AiAgentAccess account={account} disabled={busy} />
        {error && <p className="workspace-error" role="alert">{error}</p>}
      </div>
      <div className="workspace-dialog-footer"><span>Make yourself at home.</span><div><button type="button" className="workspace-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="workspace-primary" type="submit" disabled={busy}>{saving ? "Saving…" : "Save changes"}</button></div></div>
    </form>
  </Dialog>
}
