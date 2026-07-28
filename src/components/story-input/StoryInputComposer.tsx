'use client'

import { useCallback, useEffect, useRef, type ClipboardEvent, type CompositionEvent, type ReactNode } from 'react'
import { resolveTextareaTargetHeight } from '@/lib/ui/textarea-height'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'

interface StoryInputComposerProps {
  variant?: 'surface' | 'plain'
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  minRows: number
  disabled?: boolean
  maxHeightViewportRatio?: number
  topRight?: ReactNode
  footer?: ReactNode
  secondaryActions?: ReactNode
  primaryAction: ReactNode
  onSubmit?: () => void | Promise<void>
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart?: () => void
  onCompositionEnd?: (event: CompositionEvent<HTMLTextAreaElement>) => void
  textareaClassName?: string
  containerClassName?: string
  textareaShellClassName?: string
  controlsClassName?: string
  actionsClassName?: string
  footerClassName?: string
}

export default function StoryInputComposer({
  variant = 'surface',
  value,
  onValueChange,
  placeholder,
  minRows,
  disabled = false,
  maxHeightViewportRatio = 0.5,
  topRight,
  footer,
  secondaryActions,
  primaryAction,
  onSubmit,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  textareaClassName,
  containerClassName,
  textareaShellClassName,
  controlsClassName,
  actionsClassName,
  footerClassName,
}: StoryInputComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaMinHeightRef = useRef<number | null>(null)

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el || typeof window === 'undefined') return

    const maxHeight = window.innerHeight * maxHeightViewportRatio
    const oldHeight = el.offsetHeight
    const oldScrollTop = el.scrollTop

    if (textareaMinHeightRef.current === null && oldHeight > 0) {
      textareaMinHeightRef.current = oldHeight
    }

    const minHeight = textareaMinHeightRef.current ?? oldHeight

    el.style.transition = 'none'
    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const targetHeight = resolveTextareaTargetHeight({
      minHeight,
      maxHeight,
      scrollHeight,
    })
    el.style.height = `${oldHeight}px`
    el.scrollTop = oldScrollTop

    requestAnimationFrame(() => {
      el.scrollTop = oldScrollTop
      el.style.transition = 'height 200ms ease-out'
      el.style.height = `${targetHeight}px`
      el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
    })
  }, [maxHeightViewportRatio])

  useEffect(() => {
    autoResizeTextarea()
  }, [value, autoResizeTextarea])

  const isPlain = variant === 'plain'
  const resolvedContainerClassName = containerClassName ?? (isPlain
    ? 'relative w-full'
    : 'relative w-full glass-surface-elevated rounded-2xl')
  const textareaShell = textareaShellClassName ?? (isPlain ? '' : 'p-6 pb-4')
  const textareaClass = textareaClassName ?? (
    isPlain
      ? 'min-h-[220px] rounded-lg border border-[var(--glass-stroke-base)] bg-white px-4 py-4 text-sm leading-6'
      : 'p-5 pb-3'
  )
  const controlsClass = controlsClassName ?? (
    isPlain
      ? 'mt-3 flex items-center gap-2 overflow-x-auto'
      : 'flex items-center gap-2 overflow-x-auto px-5 pb-4'
  )
  const footerClass = footerClassName ?? (isPlain ? 'mt-2' : 'px-6 pb-4')
  const textareaBaseClassName = isPlain
    ? 'w-full resize-none text-[var(--glass-text-primary)] outline-none placeholder:text-[var(--glass-text-tertiary)] app-scrollbar'
    : 'w-full resize-none border-none bg-transparent text-base text-[var(--glass-text-primary)] outline-none placeholder:text-[var(--glass-text-tertiary)] app-scrollbar'

  return (
    <div className={resolvedContainerClassName}>
      <div className={textareaShell}>
        {topRight && (
          <div className="mb-3 flex items-center justify-end">
            {topRight}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (!onSubmit) return
            submitFromEnterKey(event, () => { void onSubmit() })
          }}
          onPaste={onPaste}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
          rows={minRows}
          disabled={disabled}
          className={`${textareaBaseClassName} ${textareaClass}`}
        />
      </div>

      <div className={controlsClass}>
        <div className={actionsClassName ?? 'ml-auto flex min-w-max items-center gap-2'}>
          {secondaryActions}
          {primaryAction}
        </div>
      </div>

      {footer && (
        <div className={footerClass}>
          {footer}
        </div>
      )}
    </div>
  )
}
