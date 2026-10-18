import type { UserProfile } from './types'

export const PROFILE_STORAGE_KEY = 'paper.profile.v1'
export const defaultProfile: UserProfile = {
  version: 1, name: 'Paper Designer', avatar: '', workspaceName: 'Personal workspace', defaultGrid: true,
}

export function readProfile(): UserProfile {
  try {
    const record = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null') as Partial<UserProfile> | null
    if (!record || record.version !== 1) return { ...defaultProfile }
    const profile: UserProfile = {
      version: 1,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : defaultProfile.name,
      avatar: typeof record.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(record.avatar) && record.avatar.length < 400_000 ? record.avatar : '',
      workspaceName: typeof record.workspaceName === 'string' && record.workspaceName.trim() ? record.workspaceName.trim().slice(0, 80) : defaultProfile.workspaceName,
      defaultGrid: typeof record.defaultGrid === 'boolean' ? record.defaultGrid : true,
    }
    // Migrate old profiles without retaining the obsolete browser-only credential.
    if (Object.hasOwn(record, 'mcpToken')) {
      try { saveProfile(profile) } catch { /* Preferences still load when storage is unavailable. */ }
    }
    return profile
  } catch { return { ...defaultProfile } }
}

export function saveProfile(profile: UserProfile): void {
  const { version, name, avatar, workspaceName, defaultGrid } = profile
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ version, name, avatar, workspaceName, defaultGrid }))
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase() || 'P'
}

/** Keep the avatar local and small enough to persist alongside account settings. */
export async function readAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 192
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not process this image.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192)
    return canvas.toDataURL('image/png')
  } finally { bitmap.close() }
}
