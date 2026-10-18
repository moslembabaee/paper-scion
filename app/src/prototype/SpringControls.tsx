import { useEffect, useMemo, useRef } from 'react'
import { Play } from 'lucide-react'
import { DEFAULT_SPRING, SPRING_LIMITS, SPRING_PRESETS, springCSS, springDuration, springState } from './spring'
import type { SpringParameters } from './types'

export function SpringControls({ value = DEFAULT_SPRING, onChange }: { value?: SpringParameters; onChange: (spring: SpringParameters) => void }) {
  const dotRef = useRef<HTMLSpanElement>(null), animationRef = useRef<Animation | null>(null)
  const { duration, path, restY, easing } = useMemo(() => {
    const duration = springDuration(value)
    const samples = Array.from({ length: 181 }, (_, index) => springState(duration * index / 180, value).position)
    const max = Math.max(1.1, ...samples) + .08
    const y = (position: number) => 90 - position / max * 80
    return { duration, path: samples.map((position, index) => `${index ? 'L' : 'M'}${(10 + index / 180 * 160).toFixed(2)} ${y(position).toFixed(2)}`).join(' '), restY: y(1), easing: springCSS(value, duration) }
  }, [value])
  useEffect(() => () => { animationRef.current?.cancel() }, [value])
  const preset = Object.entries(SPRING_PRESETS).find(([, item]) => Object.keys(SPRING_LIMITS).every(key => item.spring[key as keyof SpringParameters] === value[key as keyof SpringParameters]))?.[0] ?? 'custom'
  return <div className="prototype-spring">
    <label className="prototype-field">Feel<select aria-label="Spring preset" value={preset} onChange={event => {
      const next = SPRING_PRESETS[event.target.value as keyof typeof SPRING_PRESETS]
      if (next) onChange(next.spring)
    }}>{Object.entries(SPRING_PRESETS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}<option value="custom" disabled>Custom</option></select></label>
    <div className="prototype-spring-parameters">{(Object.keys(SPRING_LIMITS) as (keyof SpringParameters)[]).map(key => <label key={key} className="prototype-field">{key[0].toUpperCase() + key.slice(1)}<div className="prototype-number"><input type="number" aria-label={`Spring ${key}`} min={SPRING_LIMITS[key][0]} max={SPRING_LIMITS[key][1]} step={key === 'mass' ? .1 : 1} value={value[key]} onChange={event => {
      const next = event.currentTarget.valueAsNumber, [min, max] = SPRING_LIMITS[key]
      if (Number.isFinite(next) && next >= min && next <= max) onChange({ ...value, [key]: next })
    }} /></div></label>)}</div>
    <div className="prototype-curve prototype-spring-curve">
      <svg viewBox="0 0 180 100" role="img" aria-label="Spring response curve">
        <path className="curve-grid" d="M10 10H170M10 50H170M10 90H170M10 10V90M90 10V90M170 10V90" />
        <path className="curve-control" d={`M10 ${restY}H170`} />
        <path className="curve-line" d={path} /><circle cx="10" cy="90" r="3" />
      </svg>
      <span>{duration === 10000 ? '10,000 ms limit' : `${duration.toLocaleString()} ms to settle`} · {value.damping < 2 * Math.sqrt(value.stiffness * value.mass) ? 'With bounce' : 'No overshoot'}</span>
      <div className="prototype-spring-track" aria-hidden="true"><span ref={dotRef} /></div>
      <button type="button" className="prototype-spring-replay" onClick={() => {
        animationRef.current?.cancel()
        const dot = dotRef.current
        if (dot) animationRef.current = dot.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dot.parentElement!.clientWidth - 48}px)` }], { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration, easing, fill: 'both' })
      }}><Play size={11} />Preview spring</button>
    </div>
    <p className="prototype-motion-hint">Stiffness sets the pace. Damping softens the bounce. Mass adds weight. Timing follows the physics.</p>
  </div>
}
