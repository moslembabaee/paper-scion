import { ArrowRight, GitBranch, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { ACTIONS, DEFAULT_TRANSITION, easingCurve, EASINGS, EMPTY_PROTOTYPE, frameFor, isDescendant, TRANSITIONS, TRIGGERS } from './model'
import type { BezierCurve, DeviceFrame, Easing, InteractionTrigger, NavigationAction, PrototypeTransition, SlideDirection, TransitionKind } from './types'
import { SpringControls } from './SpringControls'
import { computeScreenDiff } from './smartAnimate'
import type { SceneDocument } from '../scene/types'
import { useMemo } from 'react'

export function PrototypeInspector({ store, selectedId, onSelect, onPresent }: {
  store: SceneStore; selectedId: string | null; onSelect: (id: string | null) => void; onPresent: () => void
}) {
  const state = useScene(store, value => value), prototype = state.prototype ?? EMPTY_PROTOTYPE
  const selected = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const frames = Object.values(state.elements).filter(node => node.type === 'frame' && store.isVisible(node.id))
  const sourceFrameId = selected ? frameFor(state.elements, selected.id) : null
  const outgoing = prototype.interactions.filter(item => item.sourceId === selected?.id)
  const interaction = outgoing.find(item => item.id === selectedId) ?? outgoing[0]
  const t = interaction?.transition ?? DEFAULT_TRANSITION, curve = easingCurve(t)
  const updateTransition = (patch: Partial<PrototypeTransition>) => { if (interaction) store.updateInteraction(interaction.id, { transition: { ...t, ...patch } }) }
  const availableTargets = interaction?.action === 'scroll'
    ? Object.values(state.elements).filter(node => sourceFrameId && isDescendant(state.elements, node.id, sourceFrameId) && store.isVisible(node.id))
    : frames
  return <aside className="inspector-panel prototype-inspector" aria-label="Prototype properties" data-testid="prototype-inspector">
    <div className="panel-heading"><span>Prototype</span><GitBranch size={14} /></div>
    <div className="inspector-section prototype-intro"><span className="section-caption">FROM STATIC TO SOMETHING</span><h3>Give your ideas motion.</h3><p>Select a frame or layer, then drag its blue connector to another frame.</p></div>
    <div className="inspector-section">
      <span className="section-caption">PRESENTATION</span>
      <label className="prototype-field">Starting frame<select aria-label="Starting frame" value={prototype.startFrameId ?? ''} onChange={event => store.setPrototype({ ...prototype, startFrameId: event.target.value || null })}><option value="">First visible frame</option>{frames.map(frame => <option key={frame.id} value={frame.id}>{frame.name}</option>)}</select></label>
      <label className="prototype-field">Device<select aria-label="Presentation device" value={prototype.device} onChange={event => store.setPrototype({ ...prototype, device: event.target.value as DeviceFrame })}><option value="none">Canvas · No device</option><option value="phone">Phone · 390 × 844</option><option value="tablet">Tablet · 820 × 1180</option><option value="desktop">Desktop · 1440 × 900</option></select></label>
      <button className="prototype-primary" data-testid="open-preview-modal" disabled={!frames.length} onClick={onPresent}><Play size={12} fill="currentColor" />Play prototype</button>
    </div>
    <div className="inspector-section">
      <div className="prototype-section-heading"><span className="section-caption">INTERACTIONS</span><span className="prototype-count">{outgoing.length.toString().padStart(2, '0')}</span></div>
      <p className="prototype-source">{selected?.name ?? 'Select a layer to begin'}</p>
      {outgoing.map(item => <button key={item.id} className={`prototype-interaction ${interaction?.id === item.id ? 'active' : ''}`} onClick={() => onSelect(item.id)}><span>{TRIGGERS[item.trigger]}<small>{state.elements[item.targetId]?.name}</small></span><ArrowRight size={13} /></button>)}
      <button data-testid="add-interaction" className="prototype-add" disabled={!sourceFrameId || frames.length < 1 || store.getHistorySnapshot().active} onClick={() => {
        const target = frames.find(frame => frame.id !== sourceFrameId) ?? frames[0]
        if (selected && target) onSelect(store.connectPrototype(selected.id, target.id).id)
      }}><Plus size={12} />Add interaction</button>
    </div>
    {interaction && <>
      <div className="inspector-section">
        <div className="prototype-section-heading"><span className="section-caption">BEHAVIOR</span><button className="quiet-button" aria-label="Remove interaction" onClick={() => { store.removeInteraction(interaction.id); onSelect(null) }}><Trash2 size={12} /></button></div>
        <label className="prototype-field">Trigger<select aria-label="Interaction trigger" value={interaction.trigger} onChange={event => store.updateInteraction(interaction.id, { trigger: event.target.value as InteractionTrigger })}>{Object.entries(TRIGGERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {interaction.trigger === 'delay' && <Milliseconds label="Delay" value={interaction.delay} max={60000} onChange={delay => store.updateInteraction(interaction.id, { delay })} />}
        <label className="prototype-field">Action<select aria-label="Interaction action" value={interaction.action} onChange={event => {
          const action = event.target.value as NavigationAction
          const targetId = action === 'scroll' ? selected!.id : state.elements[interaction.targetId]?.type === 'frame' ? interaction.targetId : frames[0]?.id
          if (targetId) store.updateInteraction(interaction.id, { action, targetId, ...(action === 'scroll' ? { transition: { ...t, kind: t.kind === 'instant' ? 'instant' : 'dissolve' } } : {}) })
        }}>{Object.entries(ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="prototype-field">Destination<select aria-label="Interaction destination" value={interaction.targetId} onChange={event => store.updateInteraction(interaction.id, { targetId: event.target.value })}>{availableTargets.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
      </div>
      <div className="inspector-section">
        <span className="section-caption">TRANSITION</span>
        <label className="prototype-field">Animation<select aria-label="Transition animation" value={t.kind} onChange={event => updateTransition({ kind: event.target.value as TransitionKind })}>{Object.entries(interaction.action === 'scroll' ? { instant: 'Instant', dissolve: 'Smooth scroll' } : TRANSITIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {t.kind !== 'instant' && <>
          {t.easing !== 'spring' && <Milliseconds label="Duration" value={t.duration} max={10000} onChange={duration => updateTransition({ duration })} />}
          <label className="prototype-field">Easing<select aria-label="Transition easing" value={t.easing} onChange={event => updateTransition({ easing: event.target.value as Easing })}>{Object.entries(EASINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {t.easing === 'spring' ? <SpringControls value={t.spring} onChange={spring => updateTransition({ spring })} /> : <div className="prototype-curve"><svg viewBox="0 0 180 100" role="img" aria-label={`Easing curve ${curve.join(', ')}`}><path className="curve-grid" d="M10 10H170M10 50H170M10 90H170M10 10V90M90 10V90M170 10V90" /><path className="curve-control" d={`M10 90L${10 + curve[0] * 160} ${90 - curve[1] * 80}M170 10L${10 + curve[2] * 160} ${90 - curve[3] * 80}`} /><path className="curve-line" d={`M10 90C${10 + curve[0] * 160} ${90 - curve[1] * 80},${10 + curve[2] * 160} ${90 - curve[3] * 80},170 10`} /><circle cx="10" cy="90" r="3" /><circle cx="170" cy="10" r="3" /></svg><span>{curve.map(n => n.toFixed(2)).join(' / ')}</span></div>}
          {t.easing === 'custom' && <div className="prototype-bezier">{t.curve.map((value, index) => <label key={index}>{['X₁', 'Y₁', 'X₂', 'Y₂'][index]}<input type="number" aria-label={`Bezier ${['x1', 'y1', 'x2', 'y2'][index]}`} value={value} step="0.05" min={index % 2 === 0 ? 0 : -5} max={index % 2 === 0 ? 1 : 5} onChange={event => {
            const next = event.currentTarget.valueAsNumber
            if (!Number.isFinite(next) || next < (index % 2 === 0 ? 0 : -5) || next > (index % 2 === 0 ? 1 : 5)) return
            updateTransition({ curve: t.curve.map((n, i) => i === index ? next : n) as unknown as BezierCurve })
          }} /></label>)}</div>}
          {(t.kind === 'slide-in' || t.kind === 'slide-out' || t.kind === 'slide' || t.kind === 'push') && <label className="prototype-field">Direction<select aria-label="Slide direction" value={t.direction} onChange={event => updateTransition({ direction: event.target.value as SlideDirection })}>{['left', 'right', 'up', 'down'].map(direction => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></label>}
          {t.kind === 'smart' && sourceFrameId && interaction.targetId && (
            <SmartAnimateDiffSummary
              elements={state.elements}
              sourceFrameId={sourceFrameId}
              targetFrameId={interaction.targetId}
              onPresent={onPresent}
            />
          )}
          {t.kind === 'push' && <p>The incoming frame pushes the outgoing frame out with synchronized physics motion.</p>}
        </>}
      </div>
    </>}
    <div className="prototype-footnote"><GitBranch size={12} /><span>{prototype.interactions.length} connections in this document<br />Saved locally with your design.</span></div>
  </aside>
}

function SmartAnimateDiffSummary({
  elements,
  sourceFrameId,
  targetFrameId,
  onPresent,
}: {
  elements: SceneDocument['elements']
  sourceFrameId: string
  targetFrameId: string
  onPresent: () => void
}) {
  const diff = useMemo(() => {
    return computeScreenDiff(elements, sourceFrameId, targetFrameId)
  }, [elements, sourceFrameId, targetFrameId])

  return (
    <div className="prototype-smart-diff-card" data-testid="smart-animate-diff-summary">
      <div className="prototype-smart-diff-header">
        <Sparkles size={12} />
        <span>Smart Animate Morphing Engine</span>
      </div>
      <div className="prototype-smart-diff-pills">
        <span className="smart-badge matched">{diff.summary.totalMatched} matched</span>
        {diff.summary.morphablePathCount > 0 && (
          <span className="smart-badge morphs">{diff.summary.morphablePathCount} Bézier morphs</span>
        )}
        <span className="smart-badge layouts">{diff.summary.layoutDiffCount} layout diffs</span>
      </div>
      <p>Interpolates Bézier paths and transforms using spring physics curves.</p>
      <button
        type="button"
        className="prototype-smart-preview-btn"
        onClick={onPresent}
        aria-label="Inspect morph in presentation player"
      >
        <Play size={11} fill="currentColor" />
        <span>Inspect in Presentation Player</span>
      </button>
    </div>
  )
}

function Milliseconds({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <label className="prototype-field">{label}<div className="prototype-number"><input type="number" aria-label={`${label} milliseconds`} value={value} min={0} max={max} step={50} onChange={event => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next) && next >= 0 && next <= max) onChange(next) }} /><span>ms</span></div></label>
}
