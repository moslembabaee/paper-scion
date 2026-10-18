import { useEffect, useRef, useState } from 'react'
import { Activity, Check, Zap } from 'lucide-react'
import type { ViewportController } from './ViewportController.ts'
import type { CanvasPhysicsConfig, CanvasPhysicsTelemetry, SpringPresetName } from './types.ts'

interface PhysicsHudProps {
  controller: ViewportController
}

const PRESETS: { id: SpringPresetName; label: string; desc: string }[] = [
  { id: 'paper', label: 'Paper Craft', desc: 'Balanced organic spring & momentum' },
  { id: 'snappy', label: 'Snappy', desc: 'Fast, responsive critical damping' },
  { id: 'fluid', label: 'Fluid', desc: 'Silky gliding with long inertia' },
  { id: 'gentle', label: 'Gentle', desc: 'Soft cinematic camera motion' },
  { id: 'direct', label: 'Direct', desc: 'Instant interpolation, no inertia' },
]

export function PhysicsHud({ controller }: PhysicsHudProps) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<CanvasPhysicsConfig>(() => controller.getPhysicsConfig())
  const [telemetry, setTelemetry] = useState<CanvasPhysicsTelemetry>(() => controller.getPhysicsTelemetry())
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return controller.subscribePhysics((t) => {
      setTelemetry(t)
    })
  }, [controller])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const handlePreset = (preset: SpringPresetName) => {
    controller.applyPhysicsPreset(preset)
    setConfig(controller.getPhysicsConfig())
  }

  const handleToggle = (key: 'momentumPanning' | 'kineticZoom' | 'edgeBouncing') => {
    const updated = { [key]: !config[key] }
    controller.setPhysicsConfig(updated)
    setConfig(controller.getPhysicsConfig())
  }

  const speedFormatted = Math.round(telemetry.speed)
  const statusLabel = telemetry.isBouncing
    ? 'BOUNCING'
    : telemetry.isCoasting
      ? 'COASTING'
      : telemetry.isSpringing
        ? 'SPRINGING'
        : 'AT REST'

  const isActiveMotion = telemetry.isCoasting || telemetry.isSpringing || telemetry.isBouncing

  return (
    <div className="viewport-physics-hud" ref={rootRef} data-testid="viewport-physics-hud">
      <button
        className={`viewport-icon-button physics-toggle-btn ${open ? 'active' : ''} ${isActiveMotion ? 'in-motion' : ''}`}
        aria-label="Canvas Physics & Momentum Navigation"
        title="Canvas Physics & Momentum Settings"
        data-testid="physics-toggle-btn"
        onClick={() => setOpen(!open)}
      >
        <Activity size={14} className={isActiveMotion ? 'animate-pulse' : ''} />
      </button>

      {open && (
        <div className="physics-popover" data-testid="physics-popover" role="dialog" aria-label="Canvas Physics Settings">
          <div className="physics-popover-header">
            <div className="physics-popover-title">
              <Zap size={13} className="text-accent" />
              <span>CANVAS PHYSICS ENGINE</span>
            </div>
            <span className={`physics-status-pill ${isActiveMotion ? 'active' : ''}`} data-testid="physics-status-pill">
              {statusLabel}
            </span>
          </div>

          <div className="physics-presets-grid" role="radiogroup" aria-label="Physics Presets">
            {PRESETS.map((p) => {
              const isSelected = config.preset === p.id
              return (
                <button
                  key={p.id}
                  className={`physics-preset-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handlePreset(p.id)}
                  data-testid={`physics-preset-${p.id}`}
                  role="radio"
                  aria-checked={isSelected}
                >
                  <div className="physics-preset-name">
                    <span>{p.label}</span>
                    {isSelected && <Check size={12} className="text-accent" />}
                  </div>
                  <div className="physics-preset-desc">{p.desc}</div>
                </button>
              )
            })}
          </div>

          <div className="physics-toggles-section">
            <div className="physics-section-label">INTERACTION MODES</div>
            <button
              className="physics-toggle-row"
              data-testid="toggle-momentum-panning"
              onClick={() => handleToggle('momentumPanning')}
            >
              <div className="physics-toggle-info">
                <span className="physics-toggle-title">Momentum Panning</span>
                <span className="physics-toggle-hint">Inertia flick gliding upon drag release</span>
              </div>
              <div className={`physics-switch ${config.momentumPanning ? 'on' : 'off'}`}>
                <div className="physics-switch-handle" />
              </div>
            </button>

            <button
              className="physics-toggle-row"
              data-testid="toggle-kinetic-zoom"
              onClick={() => handleToggle('kineticZoom')}
            >
              <div className="physics-toggle-info">
                <span className="physics-toggle-title">Kinetic Zoom</span>
                <span className="physics-toggle-hint">Smooth wheel smoothing & pinch momentum</span>
              </div>
              <div className={`physics-switch ${config.kineticZoom ? 'on' : 'off'}`}>
                <div className="physics-switch-handle" />
              </div>
            </button>

            <button
              className="physics-toggle-row"
              data-testid="toggle-edge-bouncing"
              onClick={() => handleToggle('edgeBouncing')}
            >
              <div className="physics-toggle-info">
                <span className="physics-toggle-title">Fluid Edge Bouncing</span>
                <span className="physics-toggle-hint">Spring rubber-band on zoom limits & bounds</span>
              </div>
              <div className={`physics-switch ${config.edgeBouncing ? 'on' : 'off'}`}>
                <div className="physics-switch-handle" />
              </div>
            </button>
          </div>

          <div className="physics-telemetry-hud" data-testid="physics-telemetry-hud">
            <div className="physics-telemetry-row">
              <span className="telemetry-label">SPEED:</span>
              <span className="telemetry-value font-mono" data-testid="telemetry-speed">
                {speedFormatted} <span className="telemetry-unit">px/s</span>
              </span>
            </div>
            <div className="physics-telemetry-row">
              <span className="telemetry-label">ZOOM VELOCITY:</span>
              <span className="telemetry-value font-mono" data-testid="telemetry-zoom-velocity">
                {telemetry.zoomVelocity.toFixed(2)} <span className="telemetry-unit">ln(z)/s</span>
              </span>
            </div>
            <div className="physics-telemetry-row">
              <span className="telemetry-label">SPRING ODE:</span>
              <span className="telemetry-value font-mono telemetry-specs">
                k={config.stiffness} c={config.damping} m={config.mass} μ={config.friction}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
