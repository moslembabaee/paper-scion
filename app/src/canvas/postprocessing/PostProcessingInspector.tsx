import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { POST_PROCESSING_PRESETS, createDefaultPostProcessing } from './presets.ts'
import { createPostProcessPass, MAX_POST_PROCESS_PASSES, postProcessDefinitions } from './model.ts'
import type { CanvasPostProcessingPipeline, PostProcessPass, PostProcessPassType } from './types.ts'
import './postprocessing.css'

function NumberControl({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const id = useId()
  const change = (value: number) => { if (Number.isFinite(value)) onChange(Math.max(min, Math.min(max, value))) }
  return <div className="shader-slider"><label htmlFor={id}>{label}</label>
    <input id={id} type="number" aria-label={`Post-process ${label}`} min={min} max={max} step={step} value={Number(value.toFixed(3))} onChange={e => change(e.currentTarget.valueAsNumber)} />
    <input type="range" aria-label={`Post-process ${label} slider`} min={min} max={max} step={step} value={value} onChange={e => change(e.currentTarget.valueAsNumber)} />
  </div>
}

export function PostProcessingInspector({ pipeline, onChange }: { pipeline?: CanvasPostProcessingPipeline; onChange: (pipeline: CanvasPostProcessingPipeline | undefined) => void }) {
  const update = (passes: readonly PostProcessPass[]) => { if (pipeline) onChange({ ...pipeline, preset: 'custom', passes }) }
  const patch = (id: string, changes: Partial<PostProcessPass>) => update(pipeline!.passes.map(pass => pass.id === id ? { ...pass, ...changes } as PostProcessPass : pass))
  const move = (index: number, offset: number) => {
    const passes = [...pipeline!.passes]
    ;[passes[index], passes[index + offset]] = [passes[index + offset], passes[index]]
    update(passes)
  }
  return <div className="post-processing-inspector">
    <div className="shader-divider" /><div className="shader-heading"><span className="section-caption">POST-PROCESSING</span><span className="shader-engine-mark">WEBGL / {String(pipeline?.passes.length ?? 0).padStart(2, '0')}</span></div>
    {!pipeline ? <><p className="shader-image-note">A finishing stack for this shader canvas. Light, texture and lens character.</p><button className="post-add" onClick={() => onChange(createDefaultPostProcessing())}>+ Add finishing stack</button></> : <>
      <label className="post-toggle"><span>Enable finishing stack</span><input type="checkbox" aria-label="Enable post-processing" checked={pipeline.enabled} onChange={e => onChange({ ...pipeline, enabled: e.currentTarget.checked })} /></label>
      <label className="property-select">Look<select aria-label="Post-processing preset" value={pipeline.preset} onChange={e => onChange(createDefaultPostProcessing(e.currentTarget.value))}>
        <option value="custom" disabled>Custom stack</option>{Object.values(POST_PROCESSING_PRESETS).map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
      </select></label>
      <p className="shader-image-note">{POST_PROCESSING_PRESETS[pipeline.preset]?.description ?? 'Passes run from top to bottom. Reorder to shape the finish.'}</p>
      <div className="post-stack" data-bypassed={!pipeline.enabled}>
        {pipeline.passes.map((pass, index) => <details key={pass.id} className="post-pass" open>
          <summary><span className="post-pass-index">{String(index + 1).padStart(2, '0')}</span><span>{postProcessDefinitions[pass.type].name}</span><i data-enabled={pass.enabled} /></summary>
          <div className="post-pass-body">
            <div className="post-pass-tools"><label className="post-toggle"><input type="checkbox" aria-label={`Enable ${pass.name}`} checked={pass.enabled} onChange={e => patch(pass.id, { enabled: e.currentTarget.checked })} />Enabled</label><span />
              <button aria-label={`Move ${pass.name} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
              <button aria-label={`Move ${pass.name} down`} disabled={index === pipeline.passes.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
              <button aria-label={`Duplicate ${pass.name}`} disabled={pipeline.passes.length >= MAX_POST_PROCESS_PASSES} onClick={() => update([...pipeline.passes.slice(0, index + 1), { ...pass, id: crypto.randomUUID() }, ...pipeline.passes.slice(index + 1)])}><Copy size={12} /></button>
              <button aria-label={`Remove ${pass.name}`} onClick={() => update(pipeline.passes.filter(p => p.id !== pass.id))}><Trash2 size={12} /></button>
            </div>
            {Object.entries(postProcessDefinitions[pass.type].controls).map(([key, control]) => {
              const params = pass.params as unknown as Record<string, number | boolean | string>
              const change = (value: number | boolean | string) => patch(pass.id, { params: { ...pass.params, [key]: value } } as Partial<PostProcessPass>)
              if (control.kind === 'number') return <NumberControl key={key} value={params[key] as number} {...control} onChange={change} />
              if (control.kind === 'boolean') return <label key={key} className="post-toggle">{control.label}<input type="checkbox" aria-label={`Post-process ${control.label}`} checked={params[key] as boolean} onChange={e => change(e.currentTarget.checked)} /></label>
              if (control.kind === 'select') return <label key={key} className="property-select">{control.label}<select aria-label={`Post-process ${control.label}`} value={params[key] as string} onChange={e => change(e.currentTarget.value)}>{control.options.map(opt => <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>)}</select></label>
              return <label key={key} className="post-toggle">{control.label}<input type="color" aria-label={`Post-process ${control.label}`} value={params[key] as string} onChange={e => change(e.currentTarget.value)} /></label>
            })}
            <NumberControl label="Mix" min={0} max={1} step={.01} value={pass.opacity} onChange={opacity => patch(pass.id, { opacity })} />
            <label className="property-select">Blend<select aria-label={`Post-process ${pass.name} blend`} value={pass.blendMode} onChange={e => patch(pass.id, { blendMode: e.currentTarget.value as PostProcessPass['blendMode'] })}>{['normal', 'screen', 'multiply', 'overlay'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
          </div>
        </details>)}
      </div>
      <label className="property-select">Add pass<select aria-label="Add post-process pass" value="" disabled={pipeline.passes.length >= MAX_POST_PROCESS_PASSES} onChange={e => update([...pipeline.passes, createPostProcessPass(e.currentTarget.value as PostProcessPassType)])}>
        <option value="" disabled>{pipeline.passes.length >= MAX_POST_PROCESS_PASSES ? 'Stack full · 8 passes' : 'Choose a pass…'}</option>{Object.entries(postProcessDefinitions).map(([type, def]) => <option key={type} value={type}>{def.name}</option>)}
      </select></label>
      <div className="shader-actions"><span className="shader-engine-mark">SOURCE → STACK → OUTPUT</span><button onClick={() => onChange(undefined)}>Remove stack</button></div>
    </>}
  </div>
}
