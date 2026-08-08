'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceAssistantSettings } from './useWorkspaceAssistantSettings'

const SETTINGS_WIDTH = 288
const SETTINGS_GAP = 8

export function WorkspaceAssistantSettings() {
  const t = useTranslations('assistantAgent')
  const popoverId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const settings = useWorkspaceAssistantSettings()

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    setStyle({
      position: 'fixed',
      top: rect.bottom + SETTINGS_GAP,
      left: Math.max(8, Math.min(rect.right - SETTINGS_WIDTH, viewportWidth - SETTINGS_WIDTH - 8)),
      width: SETTINGS_WIDTH,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, updatePlacement])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const required = settings.billingConfirmationRequired

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('panel.settings')}
        title={t('panel.settings')}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => {
          if (!open) updatePlacement()
          setOpen((current) => !current)
        }}
        className="absolute right-4 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white/90 text-[var(--glass-text-secondary)] shadow-[0_2px_10px_rgba(15,23,42,0.05)] transition hover:bg-white hover:text-[var(--glass-text-primary)]"
      >
        <AppIcon name="settingsHexMinor" className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={t('panel.settings')}
          style={style}
          className="glass-surface-modal z-[9999] rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 shadow-[0_14px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl"
        >
          <div className="px-1 pb-2 text-base font-semibold leading-6 text-[var(--glass-text-primary)]">
            {t('panel.settings')}
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-[var(--glass-bg-surface-soft)] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium leading-6 text-[var(--glass-text-primary)]">
                {t('panel.billingConfirmationTitle')}
              </div>
              <div className="mt-0.5 text-base leading-6 text-[var(--glass-text-tertiary)]">
                {t('panel.billingConfirmationDescription')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={required ?? true}
              aria-label={t('panel.billingConfirmationTitle')}
              disabled={required === null || settings.saving}
              onClick={() => {
                if (required !== null) void settings.updateBillingConfirmationRequired(!required)
              }}
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-50 ${required === false ? 'bg-slate-300' : 'bg-[var(--glass-accent-from)]'}`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${required === false ? 'translate-x-0' : 'translate-x-4'}`} />
            </button>
          </div>
          {settings.error ? (
            <button
              type="button"
              onClick={() => { void settings.reload() }}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--glass-tone-danger-fg)] hover:bg-[var(--glass-tone-soft)]"
            >
              {t('panel.settingsError')}
            </button>
          ) : null}
        </div>,
        document.body,
      )}
    </>
  )
}
