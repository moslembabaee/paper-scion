import { memo, useLayoutEffect, useState } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import { getWorldMatrix } from '../scene/geometry'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import type { AgentActivity } from './protocol'
import './bridge.css'

/** Constant-width, screen-space outlines respect nested frame rotations. */
export const AgentOverlay = memo(function AgentOverlay(props: { store: SceneStore; controller: ViewportController; activity?: AgentActivity | null }) {
  return props.activity ? <ActiveAgentOverlay {...props} activity={props.activity} /> : null
})

function ActiveAgentOverlay({ store, controller, activity }: { store: SceneStore; controller: ViewportController; activity: AgentActivity }) {
  const state = useScene(store, snapshot => snapshot)
  const [camera, setCamera] = useState(() => controller.getSnapshot().camera)
  useLayoutEffect(() => controller.subscribe(snapshot => setCamera(snapshot.camera)), [controller])
  return <div className="agent-overlay" aria-hidden="true" data-testid="agent-overlay">
    {activity.ids.filter(id => state.elements[id] && store.isVisible(id)).map(id => {
      const node = state.elements[id]
      const [a, b, c, d, e, f] = getWorldMatrix(state, id)
      return <div key={id} className="agent-selection" data-agent-element-id={id} style={{ width: node.width * camera.zoom, height: node.height * camera.zoom, transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e * camera.zoom + camera.x}, ${f * camera.zoom + camera.y})` }}>
        <span className="agent-selection-label">✦ Agent</span>
      </div>
    })}
  </div>
}
