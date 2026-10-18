import { AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, AlignStartHorizontal, AlignEndHorizontal, AlignStartVertical, AlignEndVertical, AlignCenterHorizontal, AlignCenterVertical } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { ViewportController } from '../canvas'
import { alignSelection, arrangeableIds, distributeSelection } from './arrange'
import type { Alignment } from './arrange'
import type { SceneStore } from './store'
import { useScene } from './useScene'
import './arrange.css'

const ALIGNMENTS = [
  { action: 'left', label: 'Align left', key: 'A', Icon: AlignStartVertical },
  { action: 'horizontal-center', label: 'Align horizontal center', key: 'H', Icon: AlignCenterVertical },
  { action: 'right', label: 'Align right', key: 'D', Icon: AlignEndVertical },
  { action: 'top', label: 'Align top', key: 'W', Icon: AlignStartHorizontal },
  { action: 'vertical-center', label: 'Align vertical center', key: 'V', Icon: AlignCenterHorizontal },
  { action: 'bottom', label: 'Align bottom', key: 'S', Icon: AlignEndHorizontal },
] as const satisfies readonly { action: Alignment; label: string; key: string; Icon: typeof AlignStartVertical }[]

export function ArrangeBar({ store, controller }: { store: SceneStore; controller: ViewportController }) {
  const state = useScene(store, snapshot => snapshot)
  const count = arrangeableIds(store).length
  const { active } = useSyncExternalStore(store.subscribe, store.getHistorySnapshot, store.getHistorySnapshot)
  const option = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+'
  if (!state.selection.length) return null
  return <div className="inspector-section arrange-section">
    <div className="arrange-heading"><span className="section-caption">ARRANGE</span><span>{count > 1 ? `${count} layers` : state.elements[state.selection[0]].parentId ? 'In frame' : 'In canvas'}</span></div>
    <div className="arrange-bar" role="toolbar" aria-label="Alignment and distribution" data-testid="arrange-bar">
      {ALIGNMENTS.map(({ action, label, key, Icon }) => <button key={action} aria-label={label} aria-keyshortcuts={`Alt+${key}`} title={`${label} · ${option}${key}`} disabled={!count || active} onClick={() => alignSelection(store, action, controller.getSnapshot().visibleBounds)}><Icon size={15} strokeWidth={1.5} /></button>)}
      <span className="arrange-divider" />
      <button aria-label="Distribute horizontally" aria-keyshortcuts="Control+Alt+H" title={`Distribute horizontally · Ctrl+${option}H · Select 3 or more layers`} disabled={count < 3 || active} onClick={() => distributeSelection(store, 'horizontal')}><AlignHorizontalDistributeCenter size={15} strokeWidth={1.5} /></button>
      <button aria-label="Distribute vertically" aria-keyshortcuts="Control+Alt+V" title={`Distribute vertically · Ctrl+${option}V · Select 3 or more layers`} disabled={count < 3 || active} onClick={() => distributeSelection(store, 'vertical')}><AlignVerticalDistributeCenter size={15} strokeWidth={1.5} /></button>
    </div>
    <div className="arrange-hint"><span>Measure distances</span><kbd>Hold {option === '⌥' ? '⌥' : 'Alt'}</kbd></div>
  </div>
}
