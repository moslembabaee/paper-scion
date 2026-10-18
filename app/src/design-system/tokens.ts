export type StudioTheme = 'dark' | 'light'

// One palette for CSS chrome and rasterized canvas UI. Document paints are independent.
export const themePalettes = {
  dark: {
    canvas: '#0c0c0e', background: '#121215', surface: '#18181b', raised: '#202024',
    border: '#27272a', 'border-strong': '#3f3f46',
    text: '#fafafa', 'text-secondary': '#a1a1aa', 'text-muted': '#85858f', 'text-disabled': '#52525b',
    accent: '#3b82f6', 'accent-hover': '#2563eb', 'accent-text': '#60a5fa', 'on-accent': '#ffffff',
    'accent-soft': 'rgba(59,130,246,0.14)', 'accent-border': 'rgba(96,165,250,0.35)',
    hover: 'rgba(255,255,255,0.05)', input: '#121215', success: '#34d399', danger: '#f87171',
    'danger-soft': 'rgba(248,113,113,0.10)',
    'grid-major': 'rgba(255,255,255,0.085)', 'grid-minor': 'rgba(255,255,255,0.035)',
    'grid-axis': 'rgba(96,165,250,0.30)', 'ruler-tick': '#52525b', 'ruler-label': '#a1a1aa',
    'shadow-sm': '0 1px 2px rgba(0,0,0,0.25)',
    'shadow-md': '0 4px 16px rgba(0,0,0,0.30)',
    'shadow-panel': '0 12px 40px rgba(0,0,0,0.40)',
    backdrop: 'rgba(0,0,0,0.60)',
  },
  light: {
    canvas: '#f8fafc', background: '#f8fafc', surface: '#ffffff', raised: '#f1f5f9',
    border: '#e2e8f0', 'border-strong': '#cbd5e1',
    text: '#0f172a', 'text-secondary': '#475569', 'text-muted': '#64748b', 'text-disabled': '#94a3b8',
    accent: '#3b82f6', 'accent-hover': '#2563eb', 'accent-text': '#2563eb', 'on-accent': '#ffffff',
    'accent-soft': 'rgba(59,130,246,0.09)', 'accent-border': 'rgba(59,130,246,0.30)',
    hover: 'rgba(15,23,42,0.04)', input: '#f8fafc', success: '#059669', danger: '#b91c1c',
    'danger-soft': 'rgba(185,28,28,0.07)',
    'grid-major': 'rgba(15,23,42,0.085)', 'grid-minor': 'rgba(15,23,42,0.035)',
    'grid-axis': 'rgba(59,130,246,0.30)', 'ruler-tick': '#94a3b8', 'ruler-label': '#64748b',
    'shadow-sm': '0 1px 2px rgba(15,23,42,0.05)',
    'shadow-md': '0 4px 16px rgba(15,23,42,0.08)',
    'shadow-panel': '0 12px 40px rgba(15,23,42,0.14)',
    backdrop: 'rgba(15,23,42,0.28)',
  },
} as const satisfies Record<StudioTheme, Record<string, string>>

export type ThemeColor = keyof typeof themePalettes.dark

export const tokens = {
  color: {
    canvas: themePalettes.dark.canvas,
    ink: themePalettes.dark.text,
    blue: themePalettes.dark['accent-text'],
    blueDeep: themePalettes.dark.accent,
    charcoal: themePalettes.dark['text-secondary'],
    surface: themePalettes.dark.surface,
    border: themePalettes.dark.border,
    borderStrong: themePalettes.dark['border-strong'],
  },
  grid: {
    tick: 120,
    sub: 24,
  },
  font: {
    sans: '"Inter", "Matter", ui-sans-serif, system-ui, sans-serif',
    mono: 'ui-monospace, "Fira Code", monospace',
  },
  radius: {
    sm: 2,
    md: 4,
    lg: 8,
    xl: 12,
  },
  ease: {
    paper: 'cubic-bezier(0.16, 1, 0.3, 1)',
    snap: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  duration: {
    snap: 120,
    smooth: 240,
    slow: 400,
  },
} as const

export type PaperColor = keyof typeof tokens.color
