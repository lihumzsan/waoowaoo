'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

export function WorkspaceCanvasUploadDock({
  position,
  onUpload,
  onClose,
}: {
  readonly position: { readonly x: number; readonly y: number }
  readonly onUpload: () => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.upload')
  const dockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || dockRef.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', closeOnOutsidePointerDown, true)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true)
  }, [onClose])

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }

  return (
    <div
      ref={dockRef}
      className="nodrag nopan pointer-events-auto absolute"
      style={{ transform: `translate(${position.x}px, ${position.y}px)`, width: 180, zIndex: 50 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onKeyDown={closeOnEscape}
    >
      <div className="rounded-[18px] border border-slate-200 bg-white/96 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-sm font-medium text-[var(--glass-text-primary)] transition hover:bg-slate-100"
          onClick={onUpload}
          autoFocus
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]">
            <AppIcon name="upload" className="h-3.5 w-3.5" />
          </span>
          {t('openPicker')}
        </button>
      </div>
    </div>
  )
}
