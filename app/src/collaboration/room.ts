export function roomFromHash(hash: string): string | null {
  const room = new URLSearchParams(hash.replace(/^#/, '')).get('room')
  return room && /^[a-f0-9-]{36}$/.test(room) ? room : null
}
