import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function Dialog({ children, className, labelledBy, onClose, busy = false }: {
  children: ReactNode; className: string; labelledBy: string; onClose: () => void; busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} role="dialog" className={className} aria-labelledby={labelledBy} onCancel={event => {
    event.preventDefault()
    if (!busy) onClose()
  }} onClick={event => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!busy && event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose()
  }}>{children}</dialog>
}
