import type { DesignTheme } from './types.ts'

/**
 * Standard design-system theme modes shared by the token engine, resolver,
 * and CSS injector.
 *
 * Kept in a dedicated module so that server-side (Node) code can import the
 * theme list without pulling in React-dependent modules such as
 * `injector.ts`. The cloud API image does not ship React, so any React
 * import reachable from `scene/store.ts` crashes the API on boot.
 */
export const STANDARD_THEMES: readonly DesignTheme[] = Object.freeze([
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'high-contrast', name: 'High-Contrast' },
])
