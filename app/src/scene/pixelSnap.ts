type Listener = (enabled: boolean) => void

const STORAGE_KEY = 'paper.pixelSnap'
const storage = typeof window !== 'undefined' ? window.localStorage : null

let pixelSnapEnabled = true
try {
  const saved = storage ? storage.getItem(STORAGE_KEY) : null
  if (saved !== null) pixelSnapEnabled = saved === 'true'
} catch { /* Storage unavailable or restricted */ }

const listeners = new Set<Listener>()

export function getPixelSnap(): boolean {
  return pixelSnapEnabled
}

export function setPixelSnap(enabled: boolean): void {
  if (pixelSnapEnabled === enabled) return
  pixelSnapEnabled = enabled
  try {
    if (storage) storage.setItem(STORAGE_KEY, String(enabled))
  } catch { /* Storage unavailable or restricted */ }
  for (const listener of [...listeners]) listener(pixelSnapEnabled)
}

export function togglePixelSnap(): boolean {
  setPixelSnap(!pixelSnapEnabled)
  return pixelSnapEnabled
}

export function subscribePixelSnap(listener: Listener): () => void {
  listeners.add(listener)
  listener(pixelSnapEnabled)
  return () => { listeners.delete(listener) }
}
