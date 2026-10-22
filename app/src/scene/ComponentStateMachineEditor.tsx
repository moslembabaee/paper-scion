import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
  Plus,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { SceneStore } from './store.ts'
import type {
  ComponentStateMachine,
  ComponentStateTransition,
  ComponentStateTrigger,
  SceneElement,
} from './types.ts'
import { SpringControls } from '../prototype/SpringControls.tsx'
import { DEFAULT_SPRING, springDuration } from '../prototype/spring.ts'
import {
  DEFAULT_INTERACTIVE_STATES,
  DEFAULT_STATE_TRIGGERS,
  STATE_TRIGGER_LABELS,
  findDelayedTransition,
  getEffectiveStateMachine,
  resolveNextState,
} from './stateMachine.ts'

export function ComponentStateMachineEditor({
  store,
  master,
  disabled,
}: {
  store: SceneStore
  master: SceneElement
  disabled: boolean
}) {
  const machine = getEffectiveStateMachine(master)
  const [expandedTransitionId, setExpandedTransitionId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [fromState, setFromState] = useState<string>('default')
  const [trigger, setTrigger] = useState<ComponentStateTrigger>('on-hover')
  const [targetState, setTargetState] = useState<string>('hover')
  const [delay, setDelay] = useState<number>(300)
  const [sandboxState, setSandboxState] = useState<string>('default')
  const [error, setError] = useState('')

  if (master.component?.kind !== 'master') return null

  // All available states from variant property options or the state machine
  const variantProp = master.component.properties?.find(p => p.kind === 'variant')
  const availableStates: readonly string[] = machine?.states ??
    (variantProp && variantProp.kind === 'variant'
      ? variantProp.options.map(o => o.value)
      : DEFAULT_INTERACTIVE_STATES)

  // Auto-advance sandbox state when entering a state with an after-delay transition
  useEffect(() => {
    if (!machine) return
    const delayed = findDelayedTransition(machine, sandboxState)
    if (!delayed) return
    const timeout = setTimeout(() => {
      setSandboxState(delayed.targetState)
    }, delayed.delay ?? 300)
    return () => clearTimeout(timeout)
  }, [machine, sandboxState])

  const perform = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update state machine')
    }
  }

  const updateMachine = (next: ComponentStateMachine | null) => {
    perform(() => {
      store.setComponentStateMachine(master.id, next)
      // Also sync variant property if it exists
      if (variantProp && variantProp.kind === 'variant') {
        const nextProp = { ...variantProp, stateMachine: next ?? undefined }
        const nextProperties = (master.component?.kind === 'master' ? master.component.properties ?? [] : []).map(p =>
          p.id === variantProp.id ? nextProp : p
        )
        store.setComponentProperties(master.id, nextProperties)
      }
    })
  }

  const handleSetup = () => {
    perform(() => {
      store.generateInteractiveStates(master.id)
    })
  }

  const handleAddTransition = () => {
    if (!machine) return
    perform(() => {
      const newTransition: ComponentStateTransition = {
        id: crypto.randomUUID(),
        fromState,
        trigger,
        targetState,
        spring: DEFAULT_SPRING,
        ...(trigger === 'after-delay' ? { delay: Math.max(0, Math.min(60000, delay || 300)) } : {}),
      }
      updateMachine({
        ...machine,
        transitions: [...machine.transitions, newTransition],
      })
      setAdding(false)
    })
  }

  const handleDeleteTransition = (id: string) => {
    if (!machine) return
    perform(() => {
      updateMachine({
        ...machine,
        transitions: machine.transitions.filter(t => t.id !== id),
      })
      if (expandedTransitionId === id) setExpandedTransitionId(null)
    })
  }

  const handleUpdateTransition = (updated: ComponentStateTransition) => {
    if (!machine) return
    perform(() => {
      updateMachine({
        ...machine,
        transitions: machine.transitions.map(t => (t.id === updated.id ? updated : t)),
      })
    })
  }

  // Interactive sandbox trigger handler
  const handleSandboxTrigger = (eventTrigger: ComponentStateTrigger) => {
    if (!machine) return
    const resolved = resolveNextState(machine, sandboxState, eventTrigger)
    if (resolved) {
      setSandboxState(resolved.targetState)
    }
  }

  const handleSandboxLeave = () => {
    if (!machine) return
    const exit = resolveNextState(machine, sandboxState, 'on-hover-end')
    if (exit) {
      setSandboxState(exit.targetState)
    } else if (sandboxState === 'hover' || sandboxState === 'pressed') {
      setSandboxState(machine.initial)
    }
  }

  return (
    <div className="component-state-machine-section" data-testid="component-state-machine">
      <div className="component-section-heading">
        <span className="section-caption">STATE MACHINE & MICRO-INTERACTIONS</span>
        {machine && (
          <button
            className="quiet-button"
            title="Add state transition"
            aria-label="Add state transition"
            disabled={disabled}
            onClick={() => {
              setFromState(availableStates[0] ?? 'default')
              setTargetState(availableStates[1] ?? availableStates[0] ?? 'hover')
              setAdding(v => !v)
            }}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {!machine ? (
        <div className="state-machine-empty">
          <div className="state-machine-empty-icon">
            <Sparkles size={20} strokeWidth={1.5} />
          </div>
          <p className="state-machine-empty-text">
            Add prototyping states (default, hover, active, focused, disabled) with spring physics micro-interactions.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="component-action primary"
              disabled={disabled}
              onClick={handleSetup}
            >
              <Sparkles size={13} />
              Setup interactive states
            </button>
            <button
              type="button"
              className="component-action"
              disabled={disabled}
              title="Generate state matrix with default, hover, active, focused, disabled"
              onClick={() => {
                perform(() => {
                  store.generateInteractiveStates(master.id, ['default', 'hover', 'active', 'focused', 'disabled'])
                })
              }}
            >
              <Sliders size={13} />
              5-State Matrix
            </button>
          </div>
        </div>
      ) : (
        <div className="state-machine-content">
          {/* Interactive States Chips */}
          <div className="state-machine-states-bar">
            <span className="state-bar-label">States</span>
            <div className="state-chips">
              {machine.states.map(stateName => (
                <button
                  key={stateName}
                  type="button"
                  className={`state-chip ${sandboxState === stateName ? 'is-active' : ''}`}
                  title={`Preview state: ${stateName}`}
                  onClick={() => setSandboxState(stateName)}
                >
                  {stateName === machine.initial && <span className="initial-dot" title="Initial state" />}
                  {stateName}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Sandbox Testbed */}
          <div className="state-machine-sandbox">
            <div className="sandbox-header">
              <span>Interactive Testbed</span>
              <div className="sandbox-badge">
                <span className="sandbox-live-dot" />
                <span>{sandboxState}</span>
              </div>
              <button
                type="button"
                className="quiet-button"
                title="Reset to initial state"
                aria-label="Reset sandbox"
                onClick={() => setSandboxState(machine.initial)}
              >
                <RotateCcw size={11} />
              </button>
            </div>
            <div
              className="sandbox-stage"
              tabIndex={0}
              onMouseEnter={() => handleSandboxTrigger('on-hover')}
              onMouseLeave={handleSandboxLeave}
              onFocus={() => handleSandboxTrigger('on-focus')}
              onBlur={() => handleSandboxTrigger('on-blur')}
              onMouseDown={() => handleSandboxTrigger('on-pointerdown')}
              onMouseUp={() => {
                handleSandboxTrigger('on-pointerup')
                if (sandboxState === 'pressed') {
                  const clickTransition = machine.transitions.find(
                    t => t.fromState === 'pressed' && t.trigger === 'on-click'
                  )
                  if (clickTransition) {
                    setSandboxState(clickTransition.targetState)
                  } else {
                    setSandboxState(machine.initial)
                  }
                }
              }}
              onClick={() => handleSandboxTrigger('on-click')}
            >
              <div className="sandbox-card">
                <MousePointerClick size={16} />
                <span>Hover, press, click, or Tab/Focus here</span>
              </div>
            </div>
          </div>

          {/* State Transitions List */}
          <div className="state-machine-transitions">
            <span className="state-bar-label">Spring Transitions ({machine.transitions.length})</span>
            {machine.transitions.length === 0 && (
              <p className="no-transitions-hint">No transitions configured yet. Click + to add one.</p>
            )}
            {machine.transitions.map(t => {
              const isExpanded = expandedTransitionId === t.id
              const duration = springDuration(t.spring)
              return (
                <div key={t.id} className="transition-card">
                  <div className="transition-summary">
                    <div className="transition-flow">
                      <span className="transition-state from">{t.fromState}</span>
                      <span className="transition-trigger-pill">
                        {STATE_TRIGGER_LABELS[t.trigger]}
                        <ArrowRight size={10} />
                      </span>
                      <span className="transition-state target">{t.targetState}</span>
                    </div>
                    <div className="transition-actions">
                      <button
                        type="button"
                        className={`quiet-button ${isExpanded ? 'active' : ''}`}
                        title="Configure spring physics curve"
                        aria-label={`Configure spring for ${t.fromState} to ${t.targetState}`}
                        disabled={disabled}
                        onClick={() => setExpandedTransitionId(isExpanded ? null : t.id)}
                      >
                        <Sliders size={12} />
                        {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        title="Delete transition"
                        aria-label={`Delete transition from ${t.fromState} to ${t.targetState}`}
                        disabled={disabled}
                        onClick={() => handleDeleteTransition(t.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="transition-spring-pill">
                    <span>
                      k: {t.spring.stiffness} · c: {t.spring.damping} · m: {t.spring.mass} · {duration}ms
                      {t.delay !== undefined ? ` · ${t.delay}ms delay` : ''}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="transition-spring-editor">
                      <SpringControls
                        value={t.spring}
                        onChange={nextSpring => handleUpdateTransition({ ...t, spring: nextSpring })}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Transition Form */}
          {adding && (
            <div className="add-transition-form">
              <div className="add-transition-row">
                <label className="prototype-field">
                  From
                  <select
                    className="property-input"
                    value={fromState}
                    onChange={e => setFromState(e.currentTarget.value)}
                  >
                    {availableStates.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="prototype-field">
                  Trigger
                  <select
                    className="property-input"
                    value={trigger}
                    onChange={e => setTrigger(e.currentTarget.value as ComponentStateTrigger)}
                  >
                    {DEFAULT_STATE_TRIGGERS.map(tr => (
                      <option key={tr} value={tr}>
                        {STATE_TRIGGER_LABELS[tr]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="prototype-field">
                  To
                  <select
                    className="property-input"
                    value={targetState}
                    onChange={e => setTargetState(e.currentTarget.value)}
                  >
                    {availableStates.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                {trigger === 'after-delay' && (
                  <label className="prototype-field">
                    Delay (ms)
                    <input
                      type="number"
                      className="property-input"
                      value={delay}
                      min={0}
                      max={60000}
                      step={50}
                      onChange={e => setDelay(e.currentTarget.valueAsNumber || 0)}
                    />
                  </label>
                )}
              </div>
              <div className="add-transition-actions">
                <button
                  type="button"
                  className="component-action primary"
                  disabled={disabled}
                  onClick={handleAddTransition}
                >
                  <Plus size={12} />
                  Add transition
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="component-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
