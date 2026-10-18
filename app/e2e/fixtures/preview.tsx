import React, { createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PreviewFrame, type PreviewFrameHandle } from '../../src/make/PreviewFrame'

const preview = createRef<PreviewFrameHandle>()
const events: unknown[] = []
export function Fixture() {
  const [html, setHtml] = useState('')
  const [status, setStatus] = useState('idle')
  Object.assign(window, { loadPreview: setHtml, preview, previewEvents: events })
  return <><p id="status">{status}</p><div style={{ height: '85vh' }}>
    <PreviewFrame ref={preview} html={html} onStatusChange={setStatus}
      onEvent={event => events.push(event)} />
  </div></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
